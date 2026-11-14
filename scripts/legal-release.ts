// Alpha 1.8.8 final — the PRIME SHOP documents: a private preview (default) or, after the OWNER's approval,
// installation on the site.
//
//   npm run legal:release
//       → docs/legal-drafts/site-preview/ru/*.html — the six pages filled from docs/legal-drafts/seller.json
//         and src/config/shop.config.ts, for reading in a browser (private: docs/legal-drafts never reaches
//         the publication); lists every detail and decision still missing.
//   npm run legal:release -- --candidate --date=YYYY-MM-DD
//       → 1.9.4: docs/legal-drafts/site-candidate/ru/*.html — the six pages EXACTLY as --approved would install them on
//         that day (same bytes, same SHA-256), for the owner's approval; private; public/ and the decisions untouched.
//   npm run legal:release -- --approved --date=YYYY-MM-DD [--replace-unpublished]
//       → public/legal/ru/{offer,refunds,seller,shop,terms,privacy}.html and src/config/seller.config.ts (the
//         seller's line under the game and in PRIME SHOP); prints the offer's SHA-256 for offer.config.ts and the
//         remaining steps. Refuses while a required detail is missing, the owner has not allowed publishing the
//         name and ИНН, a condition of docs/legal-drafts/decisions.json is still «proposed», or no date is given.
//
// Contacts follow the owner's recorded decisions (seller.json → decisions): a phone or a city appears only when
// it is filled in; an EMPTY phone is accepted only with the decision «not_published» — and every run then says
// plainly that Robokassa's published requirement (email AND phone visible on the site) is not met by the pages.
// The text of a REGISTERED offer revision is never lost: a changed offer needs a new revision number (the template's
// data-version and «Редакция №»), and the page it replaces is kept byte for byte as offer-r<N>.html (its SHA-256 is
// what buyers of that revision accepted).
// Nothing is published by this command: the site changes only with the usual publish:sync + commit + Sync.

import { SHOP_OFFERS } from '../src/config/offer.config';
import { BUNDLE_ITEMS, SHOP_ITEMS, SHOP_PRICES_APPROVED_LATER, SHOP_PRICES_APPROVED_ON, approvedPriceRub, bundleListRub, formatRub, shopItem, type ShopSku } from '../src/config/shop.config';
import { seasonOf } from '../src/config/seasonal';
import { ROOT } from './lib/backendKit';
import { crypto, fs, path, proc } from './lib/node';

const DRAFTS = path.join(ROOT, 'docs', 'legal-drafts');
// 1.9.7: + «Информация для родителей» and the separate consent to Yandex Metrika (Р-28)
const PAGES = ['offer', 'refunds', 'seller', 'shop', 'terms', 'privacy', 'parents', 'analytics'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const log = (s = '') => console.log(s);
const stop = (msg: string): never => {
  log('ОСТАНОВЛЕНО: ' + msg);
  return proc.exit(1);
};

const args = proc.argv.slice(2);
const approved = args.includes('--approved');
const candidate = !approved && args.includes('--candidate');
const dateArg = (args.find((a) => a.startsWith('--date=')) ?? '').slice(7);
// 1.9.5: the moment of the day the revision takes effect, Moscow time (UTC+3, no daylight saving). Default 03:00 — 00:00 UTC,
// the registry's day-only form as before; any other time is registered as its exact UTC moment (offer.config.ts effectiveFrom)
const timeArg = (args.find((a) => a.startsWith('--time=')) ?? '--time=03:00').slice(7);
const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(timeArg);
/** The registry's `effectiveFrom` for --date / --time: 'YYYY-MM-DD' at 03:00 Moscow time, else the exact UTC ISO moment. */
function effectiveFromOf(day: string, msk: string): string {
  if (msk === '03:00') return day;
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = msk.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh - 3, mm)).toISOString().replace('.000Z', 'Z');
}
// the newest revision is registered but NOT published yet (e.g. a new date): its text may be replaced, nothing archived
const replaceUnpublished = args.includes('--replace-unpublished');

interface Decision {
  value?: unknown;
  status?: string;
  title?: string;
}
interface Seller {
  name: string;
  nameShort: string;
  inn: string;
  status: string;
  npdSince: string;
  email: string;
  phone: string;
  city: string;
  decisions?: Record<string, Decision>;
}
const seller = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'seller.json'), 'utf8')) as Seller;
const decided = (k: string) => seller.decisions?.[k]?.value;
const conditions = JSON.parse(fs.readFileSync(path.join(DRAFTS, 'decisions.json'), 'utf8')) as Record<string, Decision>;
const pending = Object.entries(conditions).filter(([k, c]) => !k.startsWith('_') && c.status !== 'approved').map(([k, c]) => `${k.split('_')[0].replace('R', 'Р-')} ${c.title ?? k}`);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function dayText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} года`;
}

// ------------------------------------------------------------------ what is known, what is missing, what is risky
const problems: string[] = [];
const warnings: string[] = [];
if (!/^[А-ЯЁ][а-яё]+ [А-ЯЁ][а-яё]+( [А-ЯЁ][а-яё]+)?$/.test(seller.name)) problems.push('ФИО продавца (seller.json → name)');
if (!/^\d{12}$/.test(seller.inn)) problems.push('ИНН физического лица — 12 цифр (seller.json → inn)');
if (!/^\d{4}-\d{2}-\d{2}$/.test(seller.npdSince)) problems.push('дата постановки на учёт НПД (seller.json → npdSince)');
if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(seller.email)) problems.push('email для обращений (seller.json → email)');
if (decided('publishNameAndInn') !== true) problems.push('решение владельца о публикации ФИО и ИНН (seller.json → decisions.publishNameAndInn)');
const phone = seller.phone.trim();
const phoneOk = /^\+7 ?\(?\d{3}\)? ?\d{3}[- ]?\d{2}[- ]?\d{2}$/.test(phone);
if (phone && !phoneOk) problems.push('телефон в формате +7 999 123-45-67 (seller.json → phone)');
if (!phone && decided('phone') !== 'not_published') problems.push('телефон (seller.json → phone) — или явное решение владельца его не публиковать (decisions.phone = "not_published")');
if (!phone && decided('phone') === 'not_published') {
  warnings.push(
    'Телефон не публикуется (решение владельца). Опубликованные требования Robokassa: email И телефон для связи должны быть видны на сайте. ' +
      'Страницы этому требованию НЕ соответствуют; допустимость только email не подтверждена Robokassa — риск отказа или задержки модерации.',
  );
}
const city = seller.city.trim();
if (!city) warnings.push('Город не указан (решение владельца). Robokassa рекомендует указывать адрес; для самозанятого обычно достаточно города — риск низкий.');
if (pending.length) (approved ? problems : warnings).push('не утверждены условия документов (docs/legal-drafts/decisions.json): ' + pending.join('; '));
if ((approved || candidate) && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) problems.push('дата: --date=ГГГГ-ММ-ДД (день вступления в силу — не раньше фактической публикации на сайте)');
if (!timeOk) problems.push('время: --time=ЧЧ:ММ по московскому времени (по умолчанию 03:00)');

// a phone or a city appears only when it is filled in — never a stub, never «не указан»
const vals: Record<string, string> = {
  NAME: esc(seller.name),
  STATUS: esc(seller.status),
  INN: esc(seller.inn),
  NPD_SINCE: dayText(seller.npdSince),
  EMAIL: esc(seller.email),
  DATE: approved || candidate ? dayText(dateArg) : '<mark class="todo">[дата фактической публикации]</mark>',
  // 1.9.5: «с 09:00 по московскому времени» — the moment the revision takes effect (the registry carries the same moment)
  TIME_MSK: timeOk ? timeArg : '03:00',
  // 1.9.4: a price approved on another day is named with its own date (LUCIEN: 05.11.2026, the six: 23.10.2026)
  // 1.9.5: items approved on the same later day share one line («NIKA: STAGE IDOL, … — 6 ноября 2026 года»)
  PRICES_DATE: [
    dayText(SHOP_PRICES_APPROVED_ON),
    ...[...new Set(Object.entries(SHOP_PRICES_APPROVED_LATER).filter(([s]) => approvedPriceRub(s as ShopSku) !== null && SHOP_ITEMS.some((i) => i.sku === s)).map(([, d]) => d!))].map(
      (d) =>
        `${SHOP_ITEMS.filter((i) => SHOP_PRICES_APPROVED_LATER[i.sku] === d && approvedPriceRub(i.sku) !== null)
          .map((i) => esc(i.name))
          .join(', ')} — ${dayText(d)}`,
    ),
    // Beta 2.0: the bundles' own prices, approved on their day («комплекты NEON GLITCH, … — 14 ноября 2026 года»)
    ...[...new Set(BUNDLE_ITEMS.filter((b) => approvedPriceRub(b.sku) !== null && SHOP_PRICES_APPROVED_LATER[b.sku]).map((b) => SHOP_PRICES_APPROVED_LATER[b.sku]!))].map(
      (d) =>
        `комплекты ${BUNDLE_ITEMS.filter((b) => SHOP_PRICES_APPROVED_LATER[b.sku] === d && approvedPriceRub(b.sku) !== null)
          .map((b) => esc(b.name))
          .join(', ')} — ${dayText(d)}`,
    ),
  ].join('; '),
};
vals.CONTACT_INLINE = `<a href="mailto:${vals.EMAIL}">${vals.EMAIL}</a>${phoneOk ? ` · тел. ${esc(phone)}` : ''}`;
vals.EXTRA_REQUISITES = `${city ? `<br />Город: ${esc(city)}` : ''}${phoneOk ? `<br />Телефон: ${esc(phone)}` : ''}`;
vals.EXTRA_ROWS = `${city ? `\n  <tr><th>Город</th><td>${esc(city)}</td></tr>` : ''}${phoneOk ? `\n  <tr><th>Телефон</th><td>${esc(phone)}</td></tr>` : ''}`;
vals.FOOTER = `Продавец: ${vals.NAME}, самозанятый (налог на профессиональный доход), ИНН ${vals.INN}${city ? `, г. ${esc(city)}` : ''} · <a href="mailto:${vals.EMAIL}">${vals.EMAIL}</a>${phoneOk ? ` · тел. ${esc(phone)}` : ''}`;
// the catalog: only what is really sold for money — an approved price. 1.9.4: a playable character too (offer № 4 sells
// one; its row says what the purchase opens and that a character opened for the event's tokens is never sold again)
const sold = SHOP_ITEMS.filter((i) => approvedPriceRub(i.sku) !== null);
const isFighter = (i: (typeof SHOP_ITEMS)[number]) => !!i.fighter && !i.skin;
// 1.9.5: a seasonal effect or skin (an event's exchange item sold after its season — src/config/seasonal.ts) says the same
// 1.9.7 (revision 6): the event's own currency by name — PUMPKIN TOKENS for Halloween, КАРАМЕЛЬНЫЕ ТРОСТИ for WINTER SHOWDOWN
const currencyOf = (i: (typeof SHOP_ITEMS)[number]) => {
  const c = seasonOf(i)?.event.currency;
  return c ? `сезонную игровую валюту события (${c.name})` : 'сезонную игровую валюту события';
};
// 1.9.7: a seasonal item whose event has not ended by the page's date says from when it is sold for roubles (server time)
const saleFromText = (i: (typeof SHOP_ITEMS)[number]) => {
  const end = seasonOf(i)?.event.end;
  if (!end || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg) || Date.parse(end) <= Date.parse(dateArg + 'T00:00:00Z')) return '';
  const msk = new Date(Date.parse(end) + 3 * 3600000).toISOString();
  return ` За рубли — с ${dayText(msk.slice(0, 10))}, ${msk.slice(11, 16)} по московскому времени (после окончания события, по времени сервера Игры).`;
};
const what = (i: (typeof SHOP_ITEMS)[number]) =>
  isFighter(i)
    ? `${i.desc} Покупка открывает персонажа в составе бойцов учётной записи PRIME ID. Во время своего события персонаж открывался за ${currencyOf(i)}; учётной записи, открывшей его за эту валюту, он повторно не продаётся.${saleFromText(i)}`
    : seasonOf(i)
      ? `${i.desc} Во время своего события предмет получался за ${currencyOf(i)}; учётной записи, получившей его за эту валюту, он повторно не продаётся.${saleFromText(i)}`
      : i.desc;
vals.CATALOG = sold.map((i) => `  <tr><td><b>${esc(i.name)}</b><br /><small>${esc(i.kind)}</small></td><td>${esc(what(i))}</td><td>${esc(formatRub(approvedPriceRub(i.sku)!))}</td></tr>`).join('\n');
// Beta 2.0 (offer № 7): the bundles with an approved price — their items, the items' own prices and the bundle's price.
// A bundle is sold only while the revision in force sells bundles (offer.config.ts `bundles`, the server checks it).
const bundles = BUNDLE_ITEMS.filter((b) => approvedPriceRub(b.sku) !== null);
for (const b of bundles) {
  const sum = bundleListRub(b.sku);
  if (sum === null || approvedPriceRub(b.sku)! >= sum) problems.push(`комплект ${b.name}: цена должна быть ниже суммы утверждённых цен его предметов`);
}
vals.BUNDLES = bundles.length
  ? `<h2>Комплекты</h2>
<p>Комплект — несколько определённых предметов в одном заказе по общей цене (раздел 1 и пп. 3.9–3.11 <a href="offer.html">публичной оферты</a>). Каждый предмет комплекта — тот же, что продаётся отдельно; доступ ко всем предметам предоставляется одновременно. Комплект продаётся только целиком и не предлагается, если хотя бы один его предмет уже есть в вашем PRIME ID — недостающие предметы можно купить отдельно. Комплекты продаются с ${vals.DATE}, ${vals.TIME_MSK} по московскому времени (по времени сервера Игры).</p>
<table class="doc-table">
  <tr><th>Комплект</th><th>Что получает покупатель</th><th>Цена</th></tr>
${bundles
  .map((b) => {
    const parts = (b.bundle ?? []).map((sku) => shopItem(sku));
    const list = parts.map((p) => `${esc(p.name)} (${esc(p.kind)}, отдельно ${esc(formatRub(approvedPriceRub(p.sku)!))})`).join('; ');
    return `  <tr><td><b>${esc(b.name)}</b><br /><small>Комплект · ${parts.length} предмета</small></td><td>${esc(b.desc)} Входят: ${list}. Сумма цен при отдельной покупке — ${esc(formatRub(bundleListRub(b.sku)!))}.</td><td>${esc(formatRub(approvedPriceRub(b.sku)!))}</td></tr>`;
  })
  .join('\n')}
</table>`
  : '';
// 1.9.5: every item of the catalog has an approved price (Р-18) — none may be missing from Appendix 1
if (sold.length !== SHOP_ITEMS.length) problems.push(`в каталоге ${sold.length} предметов из ${SHOP_ITEMS.length}: у остальных цена не утверждена`);

/**
 * 1.9.4: a page whose text is the installed one but for its date keeps the installed file byte for byte — an unchanged
 * document is never re-dated (privacy v5 stays «от 30 октября», refunds № 2 «действует с 30 октября»).
 */
function keepUnchanged(page: string, out: string): string {
  const live = path.join(ROOT, 'public', 'legal', 'ru', `${page}.html`);
  if (!fs.existsSync(live) || !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) return out;
  const was = fs.readFileSync(live, 'utf8') as string;
  const day = /\d{1,2} (января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) \d{4} года/;
  const oldDay = day.exec(was)?.[0];
  return oldDay && out.split(dayText(dateArg)).join('\u0000') === was.split(oldDay).join('\u0000') ? was : out;
}

function fill(page: string): string {
  const tpl = fs.readFileSync(path.join(DRAFTS, 'site', 'ru', `${page}.html`), 'utf8') as string;
  const out = tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_: string, k: string) => {
    if (!(k in vals)) stop(`${page}.html: неизвестное поле {{${k}}}`);
    return vals[k];
  });
  if (/\{\{[A-Z_]+\}\}/.test(out)) stop(`${page}.html: остались незаполненные поля`);
  if ((approved || candidate) && /class="todo"|ЧЕРНОВИК|\[⚑/.test(out)) stop(`${page}.html: в тексте осталась пометка черновика`);
  return out;
}

log(`Реквизиты (docs/legal-drafts/seller.json): ${seller.name}, ИНН указан, НПД с ${vals.NPD_SINCE}, ${seller.email}; телефон: ${phone ? 'указан' : 'не публикуется'}; город: ${city ? 'указан' : 'не указывается'}`);
for (const w of warnings) log('ВНИМАНИЕ: ' + w);
if (candidate) {
  // everything but the owner's approval: the details and a date must be there; what waits for the owner is listed
  const missing = problems.filter((p) => !p.startsWith('не утверждены условия'));
  if (missing.length) stop('не хватает данных:\n  • ' + missing.join('\n  • '));
  const dir = path.join(DRAFTS, 'site-candidate', 'ru');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'public', 'legal', 'legal.css'), path.join(DRAFTS, 'site-candidate', 'legal.css'));
  const pages = Object.fromEntries(PAGES.map((p) => [p, keepUnchanged(p, fill(p))])) as Record<string, string>;
  for (const p of PAGES) fs.writeFileSync(path.join(dir, `${p}.html`), pages[p]);
  const kept = PAGES.filter((p) => fs.existsSync(path.join(ROOT, 'public', 'legal', 'ru', `${p}.html`)) && pages[p] === fs.readFileSync(path.join(ROOT, 'public', 'legal', 'ru', `${p}.html`), 'utf8'));
  if (kept.length) log(`Без изменений (как на сайте, с прежней датой): ${kept.join(', ')}`);
  const rev = Number(/<meta name="prime-doc" content="offer" data-version="(\d+)"/.exec(pages.offer)?.[1] ?? 0);
  const sha = crypto.createHash('sha256').update(pages.offer).digest('hex') as string;
  log(`Кандидат (действует с ${dayText(dateArg)}, ${timeArg} МСК): docs/legal-drafts/site-candidate/ru/ — ${PAGES.length} страниц; приватно, public/ не изменён.`);
  log(`Оферта, редакция № ${rev}: SHA-256 ${sha}`);
  log(`   { revision: ${rev}, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '${effectiveFromOf(dateArg, timeArg)}', sha256: '${sha}' }`);
  if (pending.length) log('Ожидает одобрения владельца (до него --approved не установит страницы): ' + pending.join('; '));
  proc.exit(0);
}
if (!approved) {
  const dir = path.join(DRAFTS, 'site-preview', 'ru');
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'public', 'legal', 'legal.css'), path.join(DRAFTS, 'site-preview', 'legal.css'));
  for (const p of PAGES) fs.writeFileSync(path.join(dir, `${p}.html`), fill(p));
  log(`Предпросмотр: docs/legal-drafts/site-preview/ru/ (${PAGES.length} страниц; приватно, в публикацию не попадает).`);
  if (problems.length) log('Не хватает для публикации:\n  • ' + problems.join('\n  • '));
  log('Публикация — только после утверждения владельцем: npm run legal:release -- --approved --date=ГГГГ-ММ-ДД');
  proc.exit(0);
}

if (problems.length) stop('не хватает данных или решений:\n  • ' + problems.join('\n  • '));
const target = path.join(ROOT, 'public', 'legal', 'ru');
const sha256 = (b: Uint8Array | string) => crypto.createHash('sha256').update(b).digest('hex') as string;
// the offer: its revision number comes from the template; a registered revision's text is kept, never overwritten
const pages = Object.fromEntries(PAGES.map((p) => [p, keepUnchanged(p, fill(p))])) as Record<string, string>;
const revision = Number(/<meta name="prime-doc" content="offer" data-version="(\d+)"/.exec(pages.offer)?.[1] ?? 0);
if (!revision || !pages.offer.includes(`Редакция № ${revision} `)) stop('offer.html: номер редакции в data-version и в строке «Редакция № …» должен совпадать');
const archived: string[] = [];
const livePath = path.join(target, 'offer.html');
if (fs.existsSync(livePath)) {
  const live = fs.readFileSync(livePath) as Uint8Array;
  const was = SHOP_OFFERS.find((o) => o.sha256 === sha256(live));
  if (was && sha256(pages.offer) !== was.sha256) {
    const sameUnpublished = was.revision === revision && replaceUnpublished;
    if (was.revision >= revision && !sameUnpublished) stop(`текст оферты изменился, а редакция № ${was.revision} уже зарегистрирована — увеличьте номер редакции в шаблоне (data-version и «Редакция №»); только если редакция № ${was.revision} ещё НЕ опубликована на сайте — --replace-unpublished`);
  }
  if (was && sha256(pages.offer) !== was.sha256 && was.revision < revision) {
    const keep = path.join(target, `offer-r${was.revision}.html`);
    if (fs.existsSync(keep) && sha256(fs.readFileSync(keep) as Uint8Array) !== was.sha256) stop(`public/legal/ru/offer-r${was.revision}.html уже есть, но её SHA-256 не совпадает с редакцией № ${was.revision}`);
    if (!fs.existsSync(keep)) fs.copyFileSync(livePath, keep);
    archived.push(`редакция № ${was.revision} сохранена без изменений: public/legal/ru/offer-r${was.revision}.html (SHA-256 ${was.sha256.slice(0, 8)}…) → в offer.config.ts её url: https://primetimeshowdown.online/legal/ru/offer-r${was.revision}.html`);
  }
}
for (const p of PAGES) fs.writeFileSync(path.join(target, `${p}.html`), pages[p]);
const sellerTs = [
  '// GENERATED by `npm run legal:release -- --approved` from docs/legal-drafts/seller.json after the owner approved the',
  '// PRIME SHOP documents for publication. The seller line under the game and in PRIME SHOP (Robokassa asks for the',
  "// seller's full name and ИНН at the foot of the site). Do not edit by hand.",
  '',
  "import type { SellerInfo } from './seller.types';",
  '',
  `export const SELLER: SellerInfo | null = ${JSON.stringify({ name: seller.name, nameShort: seller.nameShort, inn: seller.inn, npdSince: seller.npdSince, email: seller.email, phone: phoneOk ? phone : '', city }, null, 2)};`,
  '',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'src', 'config', 'seller.config.ts'), sellerTs);
// 1.9.7 (Р-28): Yandex Metrika goes live together with its documents — the EN pages, the switch in public/metrika.js, the
// two script hosts and the pixel hosts in index.html's CSP, and the privacy notice version on the server (lib/legal.js)
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dateEn = `${Number(dateArg.slice(8, 10))} ${MONTHS_EN[Number(dateArg.slice(5, 7)) - 1]} ${dateArg.slice(0, 4)}`;
for (const p of ['privacy', 'parents', 'analytics']) {
  const src = path.join(DRAFTS, 'site-analytics', 'en', `${p}.html`);
  const tpl = fs.readFileSync(src, 'utf8') as string;
  const html = tpl.split('{{DATE_EN}}').join(dateEn);
  if (/\{\{|class="todo"|DRAFT/.test(html)) stop(`en/${p}.html: осталась пометка черновика или незаполненное поле`);
  // Beta 2.0: an unchanged English page keeps its installed file and date (offer № 7 must not re-date privacy v6)
  const out = path.join(ROOT, 'public', 'legal', 'en', `${p}.html`);
  const was = fs.existsSync(out) ? (fs.readFileSync(out, 'utf8') as string) : '';
  const parts = tpl.split('{{DATE_EN}}');
  const wasDate = was && parts.length > 1 && was.startsWith(parts[0]) ? was.slice(parts[0].length).split(parts[1].slice(0, 40))[0] : '';
  const same = !!wasDate && /^\d{1,2} [A-Z][a-z]+ \d{4}$/.test(wasDate) && tpl.split('{{DATE_EN}}').join(wasDate) === was;
  if (!same) fs.writeFileSync(out, html);
}
const ymPath = path.join(ROOT, 'public', 'metrika.js');
fs.writeFileSync(ymPath, (fs.readFileSync(ymPath, 'utf8') as string).replace('var ENABLED = false;', 'var ENABLED = true;'));
const YM_IMG = ['ru', 'az', 'by', 'co.il', 'com', 'com.am', 'com.ge', 'com.tr', 'ee', 'fr', 'kg', 'kz', 'lt', 'lv', 'md', 'tj', 'tm', 'uz'].map((d) => `https://mc.yandex.${d}`).join(' ');
const idxPath = path.join(ROOT, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8') as string;
if (!/script-src 'self' https:\/\/mc\.yandex\.ru https:\/\/yastatic\.net;/.test(idx)) idx = idx.replace("script-src 'self';", "script-src 'self' https://mc.yandex.ru https://yastatic.net;");
if (!/img-src 'self' data: blob: https:\/\/mc\.yandex/.test(idx)) idx = idx.replace("img-src 'self' data: blob:;", `img-src 'self' data: blob: ${YM_IMG};`);
fs.writeFileSync(idxPath, idx);
const privacyV = Number(/<meta name="prime-doc" content="privacy" data-version="(\d+)"/.exec(pages.privacy)?.[1] ?? 0);
const legalPath = path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'legal.js');
fs.writeFileSync(legalPath, (fs.readFileSync(legalPath, 'utf8') as string).replace(/privacy: \{ version: \d+,/, `privacy: { version: ${privacyV},`));
log(`Яндекс Метрика: public/metrika.js ENABLED = true, CSP index.html — хосты Метрики, EN privacy/parents/analytics (${dateEn}), lib/legal.js privacy ${privacyV}.`);
const sha = sha256(fs.readFileSync(path.join(target, 'offer.html')) as Uint8Array);
log(`Установлено: public/legal/ru/{${PAGES.join(',')}}.html и src/config/seller.config.ts.`);
log('\nДальше (по порядку):');
for (const a of archived) log('Архив: ' + a);
const known = SHOP_OFFERS.find((o) => o.revision === revision);
log('1. src/config/offer.config.ts → SHOP_OFFERS' + (known ? (known.sha256 === sha ? ` — редакция № ${revision} уже записана с этим SHA-256` : ` — ОБНОВИТЬ редакцию № ${revision}:`) : ' — добавить:'));
if (!known || known.sha256 !== sha) log(`   { revision: ${revision}, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '${effectiveFromOf(dateArg, timeArg)}', sha256: '${sha}' },`);
log('2. backend/pb_hooks/lib/legal.js → DOCS.<документ>.version = версия из data-version страниц terms/privacy (reaccept — только при существенном изменении правил);');
log('   EN-версии — тот же номер версии (data-version); scripts/public-check.ts — дата новой редакции.');
log('3. npm run backend:rules && npm run public:test && npm run checkout && npm run build');
log('4. Публикация — только обычным порядком (docs/RELEASE_1_8_8.md), по отдельному решению владельца.');
