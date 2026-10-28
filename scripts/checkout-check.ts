// Alpha 1.8.8 stage 3 — `npm run checkout`: PRIME CHECKOUT.
//
//   model       every item and every state of the purchase window (buildCheckout): what blocks, in which
//               order; consent (never ticked by itself, an older revision does not count); the «back to
//               the item» note (only the item / source / step / time / account; stale, broken or
//               switched-account notes are dropped)
//   safety      no code path of the window grants, saves, records a consent or reports a payment; the
//               request carries only the sku; payments are off; the test preview is development-only
//               and absent from the production build (after `npm run build`)
//   server      a REAL PocketBase (the project's migrations and a COPY of its hooks with test rules), on
//               spare ports, with a brand-new temporary database deleted afterwards. Made-up accounts only
//               (…@checkout.test); the developer's backend/pb_data and the real server are never touched:
//               the offer revision, its acceptance (one row, the server's owner and time, the text's hash),
//               forged consents, the server's own price, LUCIEN's season, sales, the generated rules, the
//               migration down and up.

import { EVENTS } from '../src/config/events.config';
import { DEMO_OFFER, DEMO_OFFER_TEXT, SHOP_OFFERS, TEST_OFFER, TEST_OFFER_TEXT, currentOffer, type OfferRevision } from '../src/config/offer.config';
import { sha256 } from '../src/net/sha256';
import { SHOP_ITEMS, SHOP_SALES_OPEN, approvedPriceRub, formatKop, rubToKop, type ShopSku } from '../src/config/shop.config';
import {
  CHECKOUT_PENDING_KEY,
  CHECKOUT_PENDING_TTL_MS,
  CLIENT_PAYMENTS,
  buildCheckout,
  clearPending,
  consentOf,
  loadPending,
  maskEmail,
  resumeDecision,
  savePending,
  type CheckoutAccount,
  type CheckoutInput,
} from '../src/meta/Checkout';
import { setEntitlements } from '../src/meta/entitlements';
import { EventManager } from '../src/meta/EventManager';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { Shop } from '../src/meta/Shop';
import { shopRulesSource } from './backend';
import { HOOKS, MIGRATIONS, PB_BIN, ROOT, binariesReady, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, os, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 18990, smtp: 11990, mailUi: 18991 };
const API = `http://127.0.0.1:${PORTS.api}`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
function section(t: string): void {
  console.log(`\n— ${t}`);
}
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;

class MemSave {
  data: SaveData = defaultSave();
  saves = 0;
  save(): void {
    this.saves++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}
const T = (iso: string) => Date.parse(iso);
function world(at: string, data?: SaveData) {
  const store = new MemSave();
  if (data) store.data = data;
  let now = T(at);
  const events = new EventManager(store as unknown as SaveSystem, { clock: () => now });
  const shop = new Shop(store as unknown as SaveSystem, events, events.collection);
  return { store, events, shop, setNow: (iso: string) => ((now = T(iso)), events.refresh()) };
}
const ACC = (state: CheckoutAccount['state'], id: string | null = state === 'guest' || state === 'none' ? null : 'acc_a'): CheckoutAccount => ({ state, id, nickname: id ? 'Buyer' : '', email: id ? 'bu•••@checkout.test' : '' });
const OFFER1: OfferRevision = { revision: 1, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '2026-01-01', sha256: 'a'.repeat(64) };
const SKUS = SHOP_ITEMS.map((i) => i.sku);

// =================================================================== the model
function modelChecks(): void {
  section('Модель окна PRIME CHECKOUT');
  setEntitlements([]);
  const w = world('2026-10-22T12:00:00Z');
  const real = (sku: ShopSku, account: CheckoutAccount): CheckoutInput => ({
    sku,
    state: w.shop.state(SHOP_ITEMS.find((i) => i.sku === sku)!),
    priceRub: approvedPriceRub(sku),
    salesOpen: SHOP_SALES_OPEN,
    offer: currentOffer(),
    account,
    acceptedRevision: 0,
    // (1.8.8 stage 4: the build can pay, the SERVER decides — payments are off there today)
    paymentsReady: CLIENT_PAYMENTS && false,
    consentTicked: false,
  });
  // all seven items, as the game is configured today
  const today = SKUS.map((s) => [s, buildCheckout(real(s, ACC('guest'))), buildCheckout(real(s, ACC('ready')))] as const);
  check('all 7 items open the window (name, price line, RUB)', today.every(([, a]) => !!a.item && a.priceText.length > 0 && a.currency === 'RUB'));
  check('today: nothing can be paid for any item, guest or signed in, until the SERVER takes payments (the release only allows sales)', today.every(([, a, b]) => !a.canPay && !b.canPay));
  check('today: the six cosmetics show their APPROVED price; a guest is asked for PRIME ID, a signed-in player waits for the server\'s payments (LUCIEN: the season, tokens only)', today.every(([s, a, b]) => (s === 'fighter_lucien' ? a.block === 'seasonal_only' && b.block === 'seasonal_only' : a.block === 'guest' && b.block === 'payments_unavailable' && a.priceText === formatKop(rubToKop(approvedPriceRub(s))!))), today.map(([s, a]) => s + ':' + a.block + ':' + a.priceText).join(' '));
  check('an unknown item is «недоступен», never sold', buildCheckout({ ...real('skin_ray_neon_runner', ACC('ready')), sku: 'skin_free_gold', state: null }).block === 'unavailable');
  // the order of the reasons, with test data in place of the missing approvals
  const open = (o: Partial<CheckoutInput> = {}): CheckoutInput => ({ ...real('skin_ray_neon_runner', ACC('ready')), priceRub: 199, salesOpen: true, offer: OFFER1, ...o });
  check('missing price blocks even with sales open and an offer', buildCheckout(open({ priceRub: null })).block === 'price_pending');
  check('sales closed block', buildCheckout(open({ salesOpen: false })).block === 'sales_closed');
  check('no published offer blocks the real purchase', buildCheckout(open({ offer: null })).block === 'offer_missing' && !buildCheckout(open({ offer: null, paymentsReady: true, consentTicked: true })).canPay);
  const acc: [CheckoutAccount['state'], string][] = [
    ['guest', 'guest'],
    ['expired', 'session_expired'],
    ['unverified', 'unverified'],
    ['terms', 'legal_required'],
    ['elsewhere', 'session_elsewhere'],
    ['offline', 'offline'],
    ['connecting', 'connecting'],
    ['none', 'no_network'],
  ];
  check('every account state has its own reason (guest → PRIME ID, expired, unverified email, documents, other device, offline, connecting, no network)', acc.every(([st, b]) => buildCheckout(open({ account: ACC(st), paymentsReady: true, consentTicked: true })).block === b));
  check('a guest can never pay, even if everything else were ready', !buildCheckout(open({ account: ACC('guest'), paymentsReady: true, consentTicked: true, acceptedRevision: 1 })).canPay);
  check('an unconfirmed email is not bypassed (ticked, accepted, payments ready — still blocked)', !buildCheckout(open({ account: ACC('unverified'), paymentsReady: true, consentTicked: true, acceptedRevision: 1 })).canPay);
  check('another PRIME ID than the one the purchase was started with → «начать заново»', buildCheckout(open({ startedFor: 'acc_a', account: ACC('ready', 'acc_b'), paymentsReady: true })).block === 'account_changed');
  check('payments not connected → the last reason, never a payment', buildCheckout(open()).block === 'payments_unavailable' && !buildCheckout(open({ consentTicked: true, acceptedRevision: 1 })).canPay);
  check('stage 4: the build can hand a purchase to Robokassa (CLIENT_PAYMENTS), but «Перейти к оплате» also needs the SERVER\'s «payments»', CLIENT_PAYMENTS === true && /paymentsReady: CLIENT_PAYMENTS && !!s\?\.payments/.test(read('src/ui/checkoutUI.ts')));
  // consent
  check('consent: no offer → nothing to accept; the current revision accepted → accepted; an older one → renew; none → needed', consentOf(null, 3) === 'none' && consentOf(OFFER1, 1) === 'accepted' && consentOf({ ...OFFER1, revision: 2 }, 1) === 'renew' && consentOf(OFFER1, 0) === 'needed');
  check('consent: the box starts unticked — without a tick (and not accepted before) there is no payment', !buildCheckout(open({ paymentsReady: true })).canPay && buildCheckout(open({ paymentsReady: true, consentTicked: true })).canPay);
  check('consent: accepting revision 1 does not count for revision 2', !buildCheckout(open({ offer: { ...OFFER1, revision: 2 }, acceptedRevision: 1, paymentsReady: true })).canPay && buildCheckout(open({ offer: { ...OFFER1, revision: 2 }, acceptedRevision: 1, paymentsReady: true })).consent === 'renew');
  check('consent: an accepted current revision is not asked again (no tick needed)', buildCheckout(open({ acceptedRevision: 1, paymentsReady: true })).canPay);
  // owned items
  setEntitlements(['skin_ray_neon_runner']);
  const owned = buildCheckout(open({ state: w.shop.state(SHOP_ITEMS[0]), paymentsReady: true, consentTicked: true }));
  setEntitlements([]);
  check('an item the account owns (confirmed by the server) is not offered again', owned.block === 'owned' && !owned.canPay);
  // (with test approvals everywhere — a price, sales, an offer, payments — to see what the calendar alone decides)
  const ls = (at: string, unlocked = false, approved = true) => {
    const d = defaultSave();
    if (unlocked) d.fighters.lucien.unlocked = true;
    const lw = world(at, d);
    const it = SHOP_ITEMS.find((i) => i.sku === 'fighter_lucien')!;
    const base = approved ? open() : real(it.sku, ACC('ready'));
    return buildCheckout({ ...base, sku: it.sku, state: lw.shop.state(it), paymentsReady: approved, consentTicked: true });
  };
  const ev = EVENTS.find((e) => e.fighters?.some((f) => f.fighter === 'lucien'))!;
  check(`LUCIEN (EventManager calendar ${(ev.start ?? "").slice(0, 10)} – ${(ev.end ?? "").slice(0, 10)}): before and during the season — tokens only; opened — owned; after the season — the paid way (today: price not approved)`, ls('2026-10-10T12:00:00Z').block === 'seasonal_only' && ls('2026-10-25T12:00:00Z').block === 'seasonal_only' && ls('2026-10-25T12:00:00Z', true).block === 'owned' && ls('2026-11-10T12:00:00Z', true).block === 'owned' && ls('2026-11-10T12:00:00Z').block === null && ls('2026-11-10T12:00:00Z', false, false).block === 'price_pending');
  check('email shown masked (never the full address): ' + maskEmail('player@example.test'), maskEmail('player@example.test') === 'pl•••@example.test' && maskEmail('x@y.z') === 'x•••@y.z' && maskEmail('bad') === '');
  // Shop.requestPurchase uses the same rules
  check('Shop.requestPurchase (stage 2) now follows the same rules: today every item is refused', SKUS.every((s) => w.shop.requestPurchase(s, true).ok === false && w.shop.requestPurchase(s, false).ok === false));
}

// ============================================================ the «back to the item» note
function noteChecks(): void {
  section('Возврат к товару после PRIME ID');
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
  const t0 = T('2026-10-23T10:00:00Z');
  savePending(store, { sku: 'skin_ray_neon_runner', from: 'menu', step: 'checkout', at: t0, account: null });
  const raw = JSON.parse(mem.get(CHECKOUT_PENDING_KEY)!);
  check('the note keeps only the item, the source, the step, the time and the account id', Object.keys(raw).sort().join() === 'account,at,from,sku,step,v');
  check('…no password, token, price, payment data or ownership', !/password|token|price|card|owned|entitle/i.test(JSON.stringify(raw)));
  const p = loadPending(store, t0 + 60_000);
  check('read back within its time', p?.sku === 'skin_ray_neon_runner' && p.step === 'checkout');
  check('signed in now (the note was started as a guest) → back to the item', !!p && resumeDecision(p, ACC('ready', 'acc_a')) === 'resume' && resumeDecision(p, ACC('unverified', 'acc_x')) === 'resume');
  check('still a guest (PRIME ID closed without signing in) → nothing happens', !!p && resumeDecision(p, ACC('guest')) === 'wait' && resumeDecision(p, ACC('expired')) === 'wait');
  savePending(store, { sku: 'fx_phantom_dash', from: 'collection', step: 'checkout', at: t0, account: 'acc_a' });
  const pa = loadPending(store, t0 + 1000)!;
  check('started under account A, signed in as B → the purchase starts afresh (reset)', resumeDecision(pa, ACC('ready', 'acc_b')) === 'reset' && resumeDecision(pa, ACC('ready', 'acc_a')) === 'resume');
  check(`a note older than ${CHECKOUT_PENDING_TTL_MS / 60000} minutes is dropped (and removed)`, loadPending(store, t0 + CHECKOUT_PENDING_TTL_MS + 1) === null && !mem.has(CHECKOUT_PENDING_KEY));
  mem.set(CHECKOUT_PENDING_KEY, '{"v":1,"sku":"skin_free_gold","from":"menu","step":"checkout","at":' + t0 + ',"account":null}');
  const unknown = loadPending(store, t0 + 1000);
  mem.set(CHECKOUT_PENDING_KEY, '{not json');
  const broken = loadPending(store, t0 + 1000);
  mem.set(CHECKOUT_PENDING_KEY, JSON.stringify({ v: 1, sku: 'skin_ray_neon_runner', from: 'menu', step: 'checkout', at: t0 + 999_999, account: null }));
  const future = loadPending(store, t0);
  check('an unknown item, a broken note or a note from the future are dropped', unknown === null && broken === null && future === null && !mem.has(CHECKOUT_PENDING_KEY));
  savePending(store, { sku: 'skin_ray_neon_runner', from: 'menu', step: 'checkout', at: t0, account: null });
  clearPending(store);
  check('used once: cleared after resuming', !mem.has(CHECKOUT_PENDING_KEY));
  const shop = read('src/ui/screens/ShopScreen.ts');
  const game = read('src/game/Game.ts');
  check('the shop and the title flow consume the note once before acting (no loop between PRIME ID and the shop)', /const p = loadPending\(store\);\s*if \(!p\) return;\s*clearPending\(store\);/.test(shop) && /resumeDecision\(note, checkoutAccount\(this\)\) === 'wait'\) clearPending/.test(game));
  check('the sign-in itself goes through the existing PRIME ID forms (openLogin / openRegister / accountAction), no second sign-in', /openLogin\(g\)/.test(read('src/ui/checkoutUI.ts')) && /openRegister\(g\)/.test(read('src/ui/checkoutUI.ts')) && !/authWithPassword|\.login\(/.test(read('src/ui/checkoutUI.ts')));
}

// ======================================================================== safety
function safetyChecks(): void {
  section('Безопасность клиента');
  const ui = read('src/ui/checkoutUI.ts');
  const model = read('src/meta/Checkout.ts');
  const prev = read('src/ui/checkoutPreview.ts');
  const code = (s: string) => s.replace(/^\s*(\/\/|\*).*$/gm, '');
  check('the window and the model never grant, wear or save: no setEntitlements / devGrant / grant / setSkin / setEquipped / save()', [ui, model, prev].every((s) => !/setEntitlements\(|devGrant\(|\.grant\(|setSkin\(|setEquipped\(|\.save\(\)/.test(code(s))));
  // the phrases a fake success would use — nowhere in the game
  const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const fake = /Оплата прошла|Заказ оплачен|Товар начислен|Покупка завершена|успешно оплачен|оплата успешна|Покупка успешна/i;
  const hits = walk('src').filter((f) => fake.test(read(f)));
  check('no «оплата прошла / заказ оплачен / товар начислен / покупка завершена» anywhere in the game', hits.length === 0, hits.join());
  const api = read('src/net/PrimeApi.ts');
  check('the purchase request carries only the sku (never a price, an account or a status)', /\/api\/prime\/shop\/checkout', \{ \.\.\.o, method: 'POST', body: \{ sku \} \}/.test(api));
  check('an answer to the purchase request without a real order is treated as «not available» (never a guess)', /if \(!order\) throw new PrimeApiError\('server', 'payments_unavailable', 503\)/.test(api));
  check('«Перейти к оплате» acts only when canPay (or again for the SAME open order); the test preview only shows a notice', /if \(!again && !v\.canPay\) return;/.test(ui) && /if \(DEV_PREVIEW\) \{\s*g\.ui\.toast\('Тестовый предпросмотр: оплата не выполняется, заказ не создаётся'\);\s*return;/.test(ui));
  check('the test preview exists only in a development build (?checkoutpreview), separate from ?shopgrant', /const DEV_PREVIEW = import\.meta\.env\.DEV && /.test(ui) && /checkoutpreview/.test(ui) && !/shopgrant/.test(ui) && !/checkoutpreview/.test(read('src/meta/Shop.ts')));
  check('never asked by the test preview; a stage-3 server is not asked while nothing could be sold (a stage-4 server knows its own prices)', /if \(DEV_PREVIEW \|\| !api \|\| !cfg\?\.shopCheckout \|\| this\.checking \|\| this\.orderInv !== null\) return;/.test(ui) && /if \(!cfg\.shopPayments\) \{/.test(ui));
  // the save is untouched by everything the window does
  const w = world('2026-10-22T12:00:00Z');
  const before = JSON.stringify(w.store.data);
  for (const s of SKUS) for (const st of ['guest', 'ready', 'unverified', 'expired'] as const) buildCheckout({ sku: s, state: w.shop.state(SHOP_ITEMS.find((i) => i.sku === s)!), priceRub: 199, salesOpen: true, offer: OFFER1, account: ACC(st), acceptedRevision: 0, paymentsReady: true, consentTicked: true });
  check('opening, ticking and closing the window change nothing in the save', JSON.stringify(w.store.data) === before && w.store.saves === 0);
  // offer registry
  // every approved revision (1 — 24.10.2026; 2 — the seller's name in its passport spelling): numbered 1…N, the newest
  // at offer.html, each older one kept at its own offer-r<N>.html; the newest is in force from its day (not before)
  const lastRev = SHOP_OFFERS[SHOP_OFFERS.length - 1];
  const dayOf = (o: OfferRevision) => Date.parse(o.effectiveFrom + 'T00:00:00Z');
  check('offer registry: revisions 1…N, the newest at /legal/ru/offer.html, every older one kept at its own offer-r<N>.html; the newest is in force from its day', SHOP_OFFERS.length >= 1 && SHOP_OFFERS.every((o, i) => o.revision === i + 1 && /^[0-9a-f]{64}$/.test(o.sha256) && o.url === `https://primetimeshowdown.online/legal/ru/${o === lastRev ? 'offer' : `offer-r${o.revision}`}.html` && (i === 0 || dayOf(o) >= dayOf(SHOP_OFFERS[i - 1]))) && currentOffer(dayOf(lastRev))?.revision === lastRev.revision && currentOffer(dayOf(SHOP_OFFERS[0]) - 1) === null);
  const bad = SHOP_OFFERS.filter((o) => {
    const rel = o.url.replace(/^https:\/\/primetimeshowdown\.online\//, '');
    const file = path.join(ROOT, 'public', rel);
    return rel === o.url || !fs.existsSync(file) || crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') !== o.sha256;
  });
  check('every published revision points to a real page on the game domain whose SHA-256 matches', bad.length === 0, bad.map((o) => o.revision).join());
  check('server rules (backend/pb_hooks/lib/shop_rules.js) match the game config (else: npm run backend:rules)', read('backend/pb_hooks/lib/shop_rules.js') === shopRulesSource());
  // 1.8.8 final: the release pages (docs/legal-drafts/site) reach public/ only through `npm run legal:release -- --approved`
  const offerPage = path.join(ROOT, 'public/legal/ru/offer.html');
  const installedOk = !fs.existsSync(offerPage) || (SHOP_OFFERS.some((o) => /\/legal\/ru\/offer\.html$/.test(o.url) && o.sha256 === crypto.createHash('sha256').update(fs.readFileSync(offerPage)).digest('hex')) && !/\{\{|class="todo"|ЧЕРНОВИК/.test(read('public/legal/ru/offer.html')));
  check('the legal drafts stay private: in docs/legal-drafts (never served by the site), skipped by publish:sync, every file marked private («ЧЕРНОВИК. НЕ ОПУБЛИКОВАН.» or «УТВЕРЖДЕН… НА САЙТЕ ЕЩЁ НЕ ОПУБЛИКОВАН»); an offer page on the site only as an approved, registered, complete revision', fs.existsSync(path.join(ROOT, 'docs/legal-drafts/PRIME_SHOP_OFFER_DRAFT.md')) && installedOk && /rel\.startsWith\('docs\/legal-drafts\/'\)/.test(read('scripts/publish-sync.ts')) && fs.readdirSync(path.join(ROOT, 'docs/legal-drafts')).filter((f: string) => f.endsWith('.md')).every((f: string) => /^> \*\*(ЧЕРНОВИК\. НЕ ОПУБЛИКОВАН\.|УТВЕРЖДЕН[АО]? ВЛАДЕЛЬЦЕМ [^*]*НА САЙТЕ ЕЩЁ НЕ ОПУБЛИКОВАН)/m.test(read(`docs/legal-drafts/${f}`))));
  // the seller's details (ИНН…) are published only after the owner's approval: until then nowhere outside the drafts
  const sellerJson = JSON.parse(read('docs/legal-drafts/seller.json')) as { inn: string };
  const seller = read('src/config/seller.config.ts');
  const scan = (dir: string): string[] => (fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? (dir === 'docs' && e.name === 'legal-drafts' ? [] : scan(path.join(dir, e.name))) : /\.(ts|js|html|md|css|json|sh|example)$/.test(e.name) ? [path.join(dir, e.name)] : [])) : []);
  const innAt = ['src', 'public', 'docs', 'scripts', 'backend/pb_hooks', 'backend/pb_migrations', 'deploy'].flatMap(scan).concat(['index.html', 'README.md']).filter((f) => f !== 'src/config/seller.config.ts' && !/^public\/legal\/ru\/(offer|offer-r\d+|refunds|seller|shop|terms|privacy)\.html$/.test(f) && read(f).includes(sellerJson.inn));
  const sellerPublished = !/export const SELLER: SellerInfo \| null = null;/.test(seller);
  check(sellerPublished ? 'the seller\'s details are published (approved): the seller page, the offer and the game\'s line carry the same ИНН' : 'the seller\'s ИНН stays private until the owner approves publication: SELLER is null and the ИНН is nowhere outside docs/legal-drafts', innAt.length === 0 && (sellerPublished ? fs.existsSync(path.join(ROOT, 'public/legal/ru/seller.html')) && read('public/legal/ru/seller.html').includes(sellerJson.inn) && seller.includes(sellerJson.inn) : !fs.existsSync(path.join(ROOT, 'public/legal/ru/seller.html'))), innAt.join());
  // 24.10.2026: the seller's name in its passport spelling («Артем»); the old spelling stays only in the archived offer
  // revision 1 (its text is what was accepted then)
  const sellerName = (JSON.parse(read('docs/legal-drafts/seller.json')) as { name: string }).name;
  const oldName = ['src', 'public', 'docs/legal-drafts/site'].flatMap(scan).concat(['index.html']).filter((f) => !/^public\/legal\/ru\/offer-r\d+\.html$/.test(f) && /Артём Юрьевич|Artyom/.test(read(f)));
  check(`the seller's name is written one way everywhere (seller.json = seller.config.ts = the pages); the old spelling only in archived offer revisions${oldName.length ? ' (' + oldName.join(', ') + ')' : ''}`, oldName.length === 0 && (!sellerPublished || (seller.includes(JSON.stringify(sellerName)) && read('public/legal/ru/seller.html').includes(sellerName) && read('public/legal/ru/offer.html').includes(sellerName))));
  // 24.10.2026: the terms are read in place before paying (phones): a sheet over the purchase window, never a new
  // tab; the text shown must hash to the revision the server records (the game's own SHA-256 for the stand-ins);
  // the sheet never touches the consent box
  const pcoSrc = read('src/ui/checkoutUI.ts');
  const sheetSrc = read('src/ui/legalUI.ts');
  const offerSheet = sheetSrc.slice(sheetSrc.indexOf('export function openOfferDoc'), sheetSrc.indexOf('const cache = new Map'));
  check('PRIME CHECKOUT: the terms (the offer; TEST/DEMO stand-ins) open in a sheet over the window, checked against the revision\'s SHA-256, without ticking the consent', (pcoSrc.match(/data-pco="doc"/g) ?? []).length === 2 && /if \(t\.dataset\.pco === 'doc'\) e\.preventDefault\(\)/.test(pcoSrc) && /case 'doc':[\s\S]{0,120}openOfferDoc\(g, o\)/.test(pcoSrc) && /sha256\(text\) !== o\.sha256/.test(offerSheet) && /\(await sha256Hex\(bytes\)\) !== o\.sha256/.test(offerSheet) && !/consent|ticked|checked/.test(offerSheet.replace(/отмечаете согласие|согласие/g, '')) && sha256(DEMO_OFFER_TEXT) === DEMO_OFFER.sha256 && sha256(TEST_OFFER_TEXT) === TEST_OFFER.sha256);
  const tpl = ['offer', 'refunds', 'seller', 'shop', 'terms', 'privacy'].map((p) => read(`docs/legal-drafts/site/ru/${p}.html`));
  check('the six release pages use only the fields legal:release fills, name their document, carry the contact and no script', tpl.every((t) => (t.match(/\{\{([A-Z_]+)\}\}/g) ?? []).every((m) => /^\{\{(NAME|STATUS|INN|NPD_SINCE|EMAIL|DATE|PRICES_DATE|FOOTER|CATALOG|CONTACT_INLINE|EXTRA_REQUISITES|EXTRA_ROWS)\}\}$/.test(m)) && /<meta name="prime-doc" content="[a-z]+" data-version="\d+"/.test(t) && /\{\{(EMAIL|CONTACT_INLINE)\}\}/.test(t) && !/<script/i.test(t)));
  // the owner's decisions (24.10.2026): email is the only public contact — no phone or city written into a page,
  // no made-up number; a phone or a city would appear only from seller.json, through legal:release
  check('the release pages carry no phone number or stub of their own (contacts come only from seller.json)', tpl.every((t) => !/\+7[\s(-]*\d|тел\.\s*\{|\{\{(PHONE|CITY)\}\}|\[(не указан|телефон)/i.test(t)));
  check('the offer and the catalog sell exactly what the shop sells: LUCIEN is named only as NOT sold for money', /3\.4\.[^<]*не продаются[^<]*LUCIEN/.test(tpl[0].replace(/<\/?b>/g, '')) && !/Открытие игрового персонажа[^<]*(может быть предложен|за плату он)/.test(tpl[0]) && /LUCIEN: THE NIGHT STAR открывается только за жетоны/.test(tpl[3]));
  const rel = read('scripts/legal-release.ts');
  check('legal:release never installs pages while a condition of decisions.json is «proposed», the name/ИНН is not allowed, or an empty phone has no recorded decision — and it prints the Robokassa phone risk', /decisions\.json/.test(rel) && /\(approved \? problems : warnings\)\.push\('не утверждены условия/.test(rel) && /decided\('publishNameAndInn'\) !== true/.test(rel) && /decided\('phone'\) !== 'not_published'/.test(rel) && /Страницы этому требованию НЕ соответствуют/.test(rel));
  // the production build (after npm run build)
  const dist = path.join(ROOT, 'dist', 'assets');
  if (fs.existsSync(dist)) {
    const js = fs.readdirSync(dist).filter((f: string) => f.endsWith('.js')).map((f: string) => fs.readFileSync(path.join(dist, f), 'utf8') as string).join('\n');
    const dev = ['checkoutpreview', 'Тестовый предпросмотр', 'shopgrant', '__game', 'TEST PRODUCER'].filter((s) => js.includes(s));
    check('production build (dist/): no test preview, no ?shopgrant, no debug handle', dev.length === 0, dev.join());
  } else check('production build present for the check (run npm run build first)', false);
}

// ======================================================================== server
let pb: any = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-checkout-check-'));
const dataDir = path.join(work, 'pb_data');
const hooksDir = path.join(work, 'pb_hooks');

/** The project's hooks, copied, with test shop rules (prices, an offer…) — the real files stay as they are. */
function testHooks(rules: Record<string, unknown> | null): void {
  fs.rmSync(hooksDir, { recursive: true, force: true });
  fs.cpSync(HOOKS, hooksDir, { recursive: true });
  if (rules) fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(rules, null, 2)};\n`);
}
async function startPb(env: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_SHOP_SALES: '', ...env }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
}
async function stopPb(): Promise<void> {
  await stopChild(pb);
  pb = null;
}
function cli(...args: string[]): string {
  // (`migrate down` asks «y/N»: answered on stdin)
  const r = cp.spawnSync(PB_BIN, [...args, `--dir=${dataDir}`, `--hooksDir=${hooksDir}`, `--migrationsDir=${MIGRATIONS}`, '--automigrate=false'], { encoding: 'utf8', input: 'y\n', env: { ...proc.env } });
  return String(r.stdout) + String(r.stderr);
}
function sqlite(sql: string): string {
  const r = cp.spawnSync('/usr/bin/sqlite3', [path.join(dataDir, 'data.db'), sql], { encoding: 'utf8' });
  return String(r.stdout).trim();
}

async function http(method: string, url: string, token = '', body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}

const H1 = crypto.createHash('sha256').update('test offer, revision 1').digest('hex');
const H2 = crypto.createHash('sha256').update('test offer, revision 2').digest('hex');
const realRules = (): any => {
  const m = { exports: {} as any };
  // the generated file is CommonJS: evaluate it as such (it is plain data)
  new Function('module', read('backend/pb_hooks/lib/shop_rules.js'))(m);
  return m.exports;
};
function rulesWith(o: { prices?: boolean; salesOpen?: boolean; offers?: unknown[]; seasonEnd?: string }): any {
  const r = JSON.parse(JSON.stringify(realRules()));
  if (o.prices) r.prices = { skin_ray_neon_runner: 199, skin_bruno_casino_boss: 199, fx_prime_broadcast: 99, fx_phantom_dash: 99, fx_golden_confetti: 99, fx_vhs_card_frame: null, fighter_lucien: 299 };
  if (o.salesOpen !== undefined) r.salesOpen = o.salesOpen;
  if (o.offers) r.offers = o.offers;
  if (o.seasonEnd) r.seasons.fighter_lucien.end = o.seasonEnd;
  return r;
}
const offer = (revision: number, hash: string, from = '2026-01-01') => ({ revision, title: 'Тестовая оферта', url: 'https://primetimeshowdown.online/legal/ru/offer-test.html', effectiveFrom: from, sha256: hash });

async function serverChecks(): Promise<void> {
  section('Сервер PRIME NETWORK (временная база, копия hooks с тестовыми правилами)');
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  const SU = { email: 'checkout-admin@checkout.test', pw: crypto.randomBytes(18).toString('base64url') };
  // phase 1: test prices, sales open (release flag AND server switch), offer revision 1, LUCIEN's season running
  testHooks(rulesWith({ prices: true, salesOpen: true, offers: [offer(1, H1)], seasonEnd: '2099-01-01T00:00:00Z' }));
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  await startPb({ PRIME_SHOP_SALES: 'open' });
  const su = (await http('POST', '/api/collections/_superusers/auth-with-password', '', { identity: SU.email, password: SU.pw })).j.token as string;
  const cfg = (await http('GET', '/api/prime/config')).j;
  check('the server tells the game it knows PRIME CHECKOUT (config shop.checkout = 1)', cfg.shop?.checkout === 1);
  const cols = (await http('GET', '/api/collections?perPage=200', su)).j.items.map((c: any) => c.name);
  const consentsCol = (await http('GET', '/api/collections/consents', su)).j;
  check('1.8.8 migration: consents.docHash and the unique offer index; (stage 4) the order collections exist, no API rule', consentsCol.fields.some((f: any) => f.name === 'docHash') && consentsCol.indexes.some((i: string) => /idx_consents_shop_offer/.test(i) && /UNIQUE/i.test(i)) && ['shop_orders', 'shop_entitlements', 'shop_payment_events'].every((c) => cols.includes(c)));
  const pw = 'Checkout' + crypto.randomBytes(6).toString('hex');
  const mk = async (email: string, verified: boolean, docs: boolean) => {
    const u = (await http('POST', '/api/collections/users/records', su, { email, password: pw, passwordConfirm: pw, verified })).j;
    if (docs) {
      for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
      await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    }
    const tok = (await http('POST', '/api/collections/users/auth-with-password', '', { identity: email, password: pw })).j.token as string;
    return { id: u.id as string, tok };
  };
  const A = await mk('a@checkout.test', true, true);
  const B = await mk('b@checkout.test', true, true);
  const U = await mk('u@checkout.test', false, true);
  const L = await mk('l@checkout.test', true, false);

  const pub = await http('GET', '/api/prime/shop/offer');
  check('the offer revision in force is public (readable without buying or signing in)', pub.status === 200 && pub.j.offer?.revision === 1 && pub.j.offer.sha256 === H1);
  check('status needs a signed-in account (401)', (await http('GET', '/api/prime/shop/status')).status === 401);
  const st = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('status of a confirmed account: verified, no documents due, offer 1, nothing accepted, sales open, payments off, nothing owned', st.verified === true && st.legal.needs.length === 0 && st.offer.revision === 1 && st.accepted === 0 && st.sales === true && st.payments === false && Array.isArray(st.owned) && st.owned.length === 0);
  const c1 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  check('before accepting the offer: refused «offer_consent_required», with the SERVER price', c1.status === 409 && c1.j.code === 'offer_consent_required' && c1.j.quote?.priceRub === 199 && c1.j.quote.currency === 'RUB');
  const forged = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner', priceRub: 1, price: 1, user: B.id, owner: B.id, status: 'paid', paid: true });
  check('a request with its own price / account / «paid» changes nothing: the server price 199, still refused', forged.status === 409 && forged.j.code === 'offer_consent_required' && forged.j.quote.priceRub === 199);
  check('an item without an approved price → price_pending', (await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_vhs_card_frame' })).j.code === 'price_pending');
  const unk = [await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_free_gold' }), await http('POST', '/api/prime/shop/checkout', A.tok, { sku: "x' OR 1=1" }), await http('POST', '/api/prime/shop/checkout', A.tok, {})];
  check('an unknown or malformed item → 404 unknown_item', unk.every((r) => r.status === 404 && r.j.code === 'unknown_item'));
  const luc = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fighter_lucien' });
  check('LUCIEN during his season → seasonal_only (tokens only, the server reads the same calendar)', luc.status === 409 && luc.j.code === 'seasonal_only' && luc.j.event === EVENTS.find((e) => e.fighters?.length)!.id);
  check('unconfirmed email: no consent, no checkout (403 not_verified)', (await http('POST', '/api/prime/shop/offer/accept', U.tok, { revision: 1, sha256: H1 })).j.code === 'not_verified' && (await http('POST', '/api/prime/shop/checkout', U.tok, { sku: 'skin_ray_neon_runner' })).j.code === 'not_verified');
  check('PRIME ID documents not accepted → legal_required', (await http('POST', '/api/prime/shop/checkout', L.tok, { sku: 'skin_ray_neon_runner' })).j.code === 'legal_required');
  check('a guest (no session) cannot accept or check out (401)', (await http('POST', '/api/prime/shop/offer/accept', '', { revision: 1, sha256: H1 })).status === 401 && (await http('POST', '/api/prime/shop/checkout', '', { sku: 'skin_ray_neon_runner' })).status === 401);
  const wrong = [await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 1, sha256: H2 }), await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 2, sha256: H1 }), await http('POST', '/api/prime/shop/offer/accept', A.tok, {})];
  check('accepting a wrong text or revision → 409 offer_changed (with the revision in force)', wrong.every((r) => r.status === 409 && r.j.code === 'offer_changed' && r.j.offer?.revision === 1));
  const acc = await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 1, sha256: H1, lang: 'ru', user: B.id, created: '2000-01-01 00:00:00.000Z' });
  const again = await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 1, sha256: H1 });
  check('accepting the current revision: recorded once; repeated → «duplicate», nothing new', acc.status === 200 && acc.j.accepted === 1 && acc.j.duplicate === false && again.status === 200 && again.j.duplicate === true);
  const rowsA = (await http('GET', `/api/collections/consents/records?filter=${encodeURIComponent(`doc="shop_offer"`)}&perPage=50`, su)).j.items;
  check('the row: owner = the signed-in account (not the «user» in the request), revision, the text hash, server time, «checkout»', rowsA.length === 1 && rowsA[0].user === A.id && rowsA[0].version === 1 && rowsA[0].docHash === H1 && rowsA[0].action === 'checkout' && !rowsA[0].created.startsWith('2000'));
  const par = await Promise.all(Array.from({ length: 6 }, () => http('POST', '/api/prime/shop/offer/accept', B.tok, { revision: 1, sha256: H1 })));
  const rowsB = (await http('GET', `/api/collections/consents/records?filter=${encodeURIComponent(`doc="shop_offer" && user="${B.id}"`)}`, su)).j.items;
  check(`six parallel «accept» of one account → one row (${rowsB.length}), every answer OK`, rowsB.length === 1 && par.every((r) => r.status === 200 && r.j.accepted === 1));
  const listA = await http('GET', '/api/collections/consents/records', A.tok);
  const makeA = await http('POST', '/api/collections/consents/records', A.tok, { user: B.id, doc: 'shop_offer', version: 9, docHash: H1, action: 'checkout' });
  const editA = await http('PATCH', `/api/collections/consents/records/${rowsB[0].id}`, A.tok, { user: A.id });
  const delA = await http('DELETE', `/api/collections/consents/records/${rowsB[0].id}`, A.tok);
  check(`nobody reads, forges, moves or deletes consents through the API (list ${listA.status}, create ${makeA.status}, update ${editA.status}, delete ${delA.status})`, listA.status >= 400 && makeA.status >= 400 && editA.status >= 400 && delA.status >= 400);
  const stA = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('status after accepting: accepted = 1 (only the own record counts)', stA.accepted === 1 && (await http('GET', '/api/prime/shop/status', U.tok)).j.accepted === 0);
  const before = sqlite('select count(*) from consents;');
  const c2 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  check('everything checked → 503 payments_unavailable: no order, no payment, nothing written', c2.status === 503 && c2.j.code === 'payments_unavailable' && c2.j.quote.priceRub === 199 && c2.j.quote.offerRevision === 1 && sqlite('select count(*) from consents;') === before);
  const exp = (await http('GET', '/api/prime/account/export', A.tok)).j;
  check('«Мои данные» export shows the accepted offer revision with its text hash', exp.acceptedDocuments.some((d: any) => d.document === 'shop_offer' && d.version === 1 && d.textSha256 === H1));
  // A has LUCIEN in the cloud save (opened for tokens) — for the next phase
  const save = JSON.parse(JSON.stringify(defaultSave()));
  save.fighters.lucien.unlocked = true;
  const text = JSON.stringify(save);
  await http('POST', '/api/collections/saves/records', su, { owner: A.id, revision: 1, schema: 12, hash: crypto.createHash('sha256').update(text).digest('hex'), data: text, client: 'checkout-check', device: 'cc', reason: 'sync' });
  await stopPb();

  // phase 2: a new offer revision; LUCIEN's season is over
  testHooks(rulesWith({ prices: true, salesOpen: true, offers: [offer(1, H1), offer(2, H2, '2026-02-01')], seasonEnd: '2026-03-01T00:00:00Z' }));
  await startPb({ PRIME_SHOP_SALES: 'open' });
  const st2 = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  const c3 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  check('a new offer revision: the old consent does not count (status: offer 2, accepted 1; checkout → offer_consent_required)', st2.offer.revision === 2 && st2.accepted === 1 && c3.j.code === 'offer_consent_required');
  check('accepting the old revision now → offer_changed', (await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 1, sha256: H1 })).j.code === 'offer_changed');
  const a2 = await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 2, sha256: H2 });
  const historyA = (await http('GET', `/api/collections/consents/records?filter=${encodeURIComponent(`doc="shop_offer" && user="${A.id}"`)}&sort=version`, su)).j.items.map((r: any) => r.version);
  check('accepting revision 2 keeps the history (rows for 1 and 2)', a2.j.accepted === 2 && historyA.join() === '1,2');
  const lucA = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fighter_lucien' });
  const lucB = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'fighter_lucien' });
  check('after the season: LUCIEN already opened for tokens → owned (never sold again); not opened → the paid way goes on to its next check', lucA.j.code === 'owned' && lucB.j.code === 'offer_consent_required' && lucB.j.quote.priceRub === 299);
  await stopPb();

  // phase 3: the release would open sales, but this server's administrator has not (no PRIME_SHOP_SALES)
  testHooks(rulesWith({ prices: true, salesOpen: true, offers: [offer(1, H1)] }));
  await startPb({});
  check('sales need the server switch too: without PRIME_SHOP_SALES=open → sales_closed', (await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' })).j.code === 'sales_closed' && (await http('GET', '/api/prime/shop/status', A.tok)).j.sales === false);
  await stopPb();

  // phase 4: the REAL generated rules of this release (approved prices, sales closed, offer revision 1)
  testHooks(null);
  await startPb({ PRIME_SHOP_SALES: 'open' });
  const real4 = await Promise.all(SKUS.filter((s) => s !== 'fighter_lucien').map((s) => http('POST', '/api/prime/shop/checkout', A.tok, { sku: s })));
  check('this release on a server with the switch open but no Robokassa: every cosmetic → payments_unavailable with its approved price — no order', real4.every((r, i) => r.status === 503 && r.j.code === 'payments_unavailable' && r.j.quote?.priceKop === rubToKop(approvedPriceRub(SKUS.filter((s) => s !== 'fighter_lucien')[i]))), real4.map((r) => r.j.code + ':' + r.j.quote?.priceKop).join(' '));
  const pubRev = SHOP_OFFERS[SHOP_OFFERS.length - 1];
  const pubOffer = (await http('GET', '/api/prime/shop/offer')).j.offer;
  check(`…the server names the published offer (revision ${pubRev?.revision}, ${pubRev?.effectiveFrom}) and accepts consent only to exactly that text (another hash → offer_changed)`, !!pubRev && pubOffer?.revision === pubRev.revision && pubOffer?.sha256 === pubRev.sha256 && pubOffer?.url === pubRev.url && (await http('POST', '/api/prime/shop/offer/accept', B.tok, { revision: pubRev.revision, sha256: H1 })).j.code === 'offer_changed');
  await stopPb();

  // the migration can be undone and applied again (consents and accounts stay); every later migration (stage 4, the
  // demonstration, 1.8.9's DAILY PRIME STREAK …) sits on top and goes down first
  const users = sqlite('select count(*) from users;');
  const onTop = fs.readdirSync(MIGRATIONS).filter((f: string) => /^\d+_.*\.js$/.test(f) && f >= '1792700000_prime_checkout.js').length;
  const downOut = cli('migrate', 'down', String(onTop));
  const afterDown = sqlite('select count(*) from pragma_table_info("consents") where name="docHash";');
  const upOut = cli('migrate', 'up');
  const afterUp = sqlite('select count(*) from pragma_table_info("consents") where name="docHash";');
  check('the 1.8.8 migration goes down and up again; accounts and their rows stay', afterDown === '0' && afterUp === '1' && sqlite('select count(*) from users;') === users, (downOut + upOut).slice(0, 200));
}

async function main(): Promise<void> {
  modelChecks();
  noteChecks();
  safetyChecks();
  await serverChecks();
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  проверка прервалась: ' + (e instanceof Error ? e.stack : String(e)));
    console.log(pbLog.slice(-25).join('\n'));
  })
  .finally(async () => {
    await stopChild(pb).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed ? 'checkout: FAILED' : 'checkout: OK'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed ? 1 : 0);
  });
