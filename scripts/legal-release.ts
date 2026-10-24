// Alpha 1.8.8 final — the PRIME SHOP documents: a private preview (default) or, after the OWNER's approval,
// installation on the site.
//
//   npm run legal:release
//       → docs/legal-drafts/site-preview/ru/*.html — the six pages filled from docs/legal-drafts/seller.json
//         and src/config/shop.config.ts, for reading in a browser (private: docs/legal-drafts never reaches
//         the publication); lists every detail and decision still missing.
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
import { SHOP_ITEMS, SHOP_PRICES_APPROVED_ON, approvedPriceRub, formatRub } from '../src/config/shop.config';
import { ROOT } from './lib/backendKit';
import { crypto, fs, path, proc } from './lib/node';

const DRAFTS = path.join(ROOT, 'docs', 'legal-drafts');
const PAGES = ['offer', 'refunds', 'seller', 'shop', 'terms', 'privacy'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const log = (s = '') => console.log(s);
const stop = (msg: string): never => {
  log('ОСТАНОВЛЕНО: ' + msg);
  return proc.exit(1);
};

const args = proc.argv.slice(2);
const approved = args.includes('--approved');
const dateArg = (args.find((a) => a.startsWith('--date=')) ?? '').slice(7);
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
if (approved && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) problems.push('дата публикации: --date=ГГГГ-ММ-ДД (дата фактической публикации на сайте)');

// a phone or a city appears only when it is filled in — never a stub, never «не указан»
const vals: Record<string, string> = {
  NAME: esc(seller.name),
  STATUS: esc(seller.status),
  INN: esc(seller.inn),
  NPD_SINCE: dayText(seller.npdSince),
  EMAIL: esc(seller.email),
  DATE: approved ? dayText(dateArg) : '<mark class="todo">[дата фактической публикации]</mark>',
  PRICES_DATE: dayText(SHOP_PRICES_APPROVED_ON),
};
vals.CONTACT_INLINE = `<a href="mailto:${vals.EMAIL}">${vals.EMAIL}</a>${phoneOk ? ` · тел. ${esc(phone)}` : ''}`;
vals.EXTRA_REQUISITES = `${city ? `<br />Город: ${esc(city)}` : ''}${phoneOk ? `<br />Телефон: ${esc(phone)}` : ''}`;
vals.EXTRA_ROWS = `${city ? `\n  <tr><th>Город</th><td>${esc(city)}</td></tr>` : ''}${phoneOk ? `\n  <tr><th>Телефон</th><td>${esc(phone)}</td></tr>` : ''}`;
vals.FOOTER = `Продавец: ${vals.NAME}, самозанятый (налог на профессиональный доход), ИНН ${vals.INN}${city ? `, г. ${esc(city)}` : ''} · <a href="mailto:${vals.EMAIL}">${vals.EMAIL}</a>${phoneOk ? ` · тел. ${esc(phone)}` : ''}`;
// the catalog: only what is really sold for money — approved price, never a fighter (LUCIEN: tokens only)
const sold = SHOP_ITEMS.filter((i) => !(i.fighter && !i.skin) && approvedPriceRub(i.sku) !== null);
vals.CATALOG = sold.map((i) => `  <tr><td><b>${esc(i.name)}</b><br /><small>${esc(i.kind)}</small></td><td>${esc(i.desc)}</td><td>${esc(formatRub(approvedPriceRub(i.sku)!))}</td></tr>`).join('\n');
if (sold.length !== 6) problems.push(`в каталоге ${sold.length} предметов вместо шести утверждённых`);

function fill(page: string): string {
  const tpl = fs.readFileSync(path.join(DRAFTS, 'site', 'ru', `${page}.html`), 'utf8') as string;
  const out = tpl.replace(/\{\{([A-Z_]+)\}\}/g, (_: string, k: string) => {
    if (!(k in vals)) stop(`${page}.html: неизвестное поле {{${k}}}`);
    return vals[k];
  });
  if (/\{\{[A-Z_]+\}\}/.test(out)) stop(`${page}.html: остались незаполненные поля`);
  if (approved && /class="todo"|ЧЕРНОВИК|\[⚑/.test(out)) stop(`${page}.html: в тексте осталась пометка черновика`);
  return out;
}

log(`Реквизиты (docs/legal-drafts/seller.json): ${seller.name}, ИНН указан, НПД с ${vals.NPD_SINCE}, ${seller.email}; телефон: ${phone ? 'указан' : 'не публикуется'}; город: ${city ? 'указан' : 'не указывается'}`);
for (const w of warnings) log('ВНИМАНИЕ: ' + w);
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
const pages = Object.fromEntries(PAGES.map((p) => [p, fill(p)])) as Record<string, string>;
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
const sha = sha256(fs.readFileSync(path.join(target, 'offer.html')) as Uint8Array);
log(`Установлено: public/legal/ru/{${PAGES.join(',')}}.html и src/config/seller.config.ts.`);
log('\nДальше (по порядку):');
for (const a of archived) log('Архив: ' + a);
const known = SHOP_OFFERS.find((o) => o.revision === revision);
log('1. src/config/offer.config.ts → SHOP_OFFERS' + (known ? (known.sha256 === sha ? ` — редакция № ${revision} уже записана с этим SHA-256` : ` — ОБНОВИТЬ редакцию № ${revision}:`) : ' — добавить:'));
if (!known || known.sha256 !== sha) log(`   { revision: ${revision}, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '${dateArg}', sha256: '${sha}' },`);
log('2. backend/pb_hooks/lib/legal.js → DOCS.<документ>.version = версия из data-version страниц terms/privacy (reaccept — только при существенном изменении правил);');
log('   EN-версии — тот же номер версии (data-version); scripts/public-check.ts — дата новой редакции.');
log('3. npm run backend:rules && npm run public:test && npm run checkout && npm run build');
log('4. Публикация — только обычным порядком (docs/RELEASE_1_8_8.md), по отдельному решению владельца.');
