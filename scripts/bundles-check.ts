// Beta 2.0 — `npm run bundles`: PRIME SHOP BUNDLES on a REAL PocketBase (the project's migrations, a COPY of its hooks),
// spare ports, a brand-new temporary database deleted afterwards, made-up accounts (…@bundles.test) and RANDOM test
// passwords made up for this run — never a real Robokassa secret, never the real server, no money anywhere.
//
//   rules       the bundles of shop.config.ts: 2–3 existing single items, no fighter, no seasonal item; the owner's
//               APPROVED prices (14.11.2026, Р-30) below the items' sum (an honest saving), within the 14–17 limit
//   closed      without PRIME_SHOP_BUNDLES=on, and under offer № 6 (an order = one digital item), a bundle has no price and
//               the checkout refuses it (bundles_closed) — live and test alike
//   offer № 7   the REAL registered revision 7 (Р-29) sells them: in force → the six approved prices, a live order with ONE
//               receipt line; before its moment (14.11.2026 13:00 UTC) the real rules still say «closed»
//   test mode   (staging rehearsal, its TEST-ONLY terms): ONE order and ONE payment for the bundle; delivery makes ONE
//               right (kind bundle) that owns every item; a repeated notification grants nothing more
//   ownership   a bundle with an item owned already is refused and names that item (no false saving); an item of an
//               owned bundle is never sold again; two open orders that would give one item are never both made
//   delivery    an item owned meanwhile (a late payment of an older order) → the bundle goes to review, nothing twice
//   refund      a refunded bundle takes all its items back
import { HOOKS, MIGRATIONS, PB_BIN, binariesReady, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, nodeModule, os, path, proc } from './lib/node';
import { BUNDLE_ITEMS, SHOP_ITEMS, SHOP_PRICES_APPROVED_LATER, SHOP_PRICE_STATUS, approvedPriceRub, bundleListRub, receiptNameOf } from '../src/config/shop.config';
import { SHOP_OFFERS } from '../src/config/offer.config';
import { seasonOf } from '../src/config/seasonal';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Buffer: any;

const PORTS = { api: 19390, smtp: 11939, mailUi: 19391 };
const API = `http://127.0.0.1:${PORTS.api}`;
const LOGIN = 'primetimeshowdown';
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);
const req = nodeModule.createRequire(import.meta.url);
const RK = req('../backend/pb_hooks/lib/robokassa.js');
const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const rnd = (n = 18) => crypto.randomBytes(n).toString('base64url');
const TEST_P1 = 'tp1-' + rnd();
const TEST_P2 = 'tp2-' + rnd();
const LIVE = { p1: 'lp1-' + rnd(), p2: 'lp2-' + rnd(), p3: 'lp3-' + rnd() };

const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-bundles-check-'));
const dataDir = path.join(work, 'pb_data');
const hooksDir = path.join(work, 'pb_hooks');
let pb: any = null;
const pbLog: string[] = [];
const CLEAN = Object.fromEntries(['PRIME_SERVER_ROLE', 'PRIME_PAY_MODE', 'ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_HASH_ALGORITHM', 'ROBOKASSA_TEST_PASSWORD_1', 'ROBOKASSA_TEST_PASSWORD_2', 'ROBOKASSA_PASSWORD_1', 'ROBOKASSA_PASSWORD_2', 'ROBOKASSA_PASSWORD_3', 'PRIME_SHOP_SALES', 'PRIME_PAY_DEV_GATEWAY', 'ROBOKASSA_RESULT_IPS', 'ROBOKASSA_RECEIPT', 'PRIME_PAY_REFUND_API', 'PRIME_DEMO_UNTIL', 'PRIME_PAY_RELAY_URL', 'PRIME_PAY_RELAY_PUBLIC_URL', 'PRIME_SHOP_MINORS', 'PRIME_SHOP_BUNDLES'].map((k) => [k, '']));
const TEST_ENV = { PRIME_SERVER_ROLE: 'dev', PRIME_PAY_MODE: 'test', ROBOKASSA_MERCHANT_LOGIN: LOGIN, ROBOKASSA_HASH_ALGORITHM: 'sha256', ROBOKASSA_TEST_PASSWORD_1: TEST_P1, ROBOKASSA_TEST_PASSWORD_2: TEST_P2, PRIME_SHOP_SALES: 'open' };
const LIVE_ENV = { PRIME_SERVER_ROLE: 'production', PRIME_PAY_MODE: 'live', ROBOKASSA_MERCHANT_LOGIN: LOGIN, ROBOKASSA_HASH_ALGORITHM: 'md5', ROBOKASSA_PASSWORD_1: LIVE.p1, ROBOKASSA_PASSWORD_2: LIVE.p2, ROBOKASSA_PASSWORD_3: LIVE.p3, PRIME_SHOP_SALES: 'open', ROBOKASSA_RECEIPT: 'on' };

function hooks(rules: any | null): void {
  fs.rmSync(hooksDir, { recursive: true, force: true });
  fs.cpSync(HOOKS, hooksDir, { recursive: true });
  if (rules) fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(rules, null, 2)};\n`);
}
const realRules = (): any => {
  const m = { exports: {} as any };
  new Function('module', fs.readFileSync(path.join(HOOKS, 'lib', 'shop_rules.js'), 'utf8'))(m);
  return JSON.parse(JSON.stringify(m.exports));
};
async function startPb(env: Record<string, string>): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { ...CLEAN, PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_SESSIONS: 'off', ...env }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 2000) pbLog.splice(0, pbLog.length - 2000);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
}
async function stopPb(): Promise<void> {
  await stopChild(pb);
  pb = null;
}
function cli(env: Record<string, string>, ...args: string[]): string {
  const r = cp.spawnSync(PB_BIN, [...args, `--dir=${dataDir}`, `--hooksDir=${hooksDir}`, `--migrationsDir=${MIGRATIONS}`, '--automigrate=false'], { encoding: 'utf8', input: 'y\n', env: { ...proc.env, ...CLEAN, ...env } });
  return String(r.stdout) + String(r.stderr);
}
function sqlite(sql: string): string {
  return String(cp.spawnSync('/usr/bin/sqlite3', [path.join(dataDir, 'data.db'), sql], { encoding: 'utf8' }).stdout).trim();
}
async function http(method: string, u: string, token = '', body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + u, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function pay(inv: number, sum: string, shp: string): Promise<string> {
  const SignatureValue = sha256(RK.resultBase(sum, String(inv), TEST_P2, [['Shp_order', shp]])).toUpperCase();
  const qs = new URLSearchParams({ OutSum: sum, InvId: String(inv), SignatureValue, Shp_order: shp, Fee: '0.10', PaymentMethod: 'BankCard', IncCurrLabel: 'BankCardPSR' }).toString();
  const r = await fetch(API + '/api/prime/pay/robokassa/result', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs });
  return r.text();
}
const orderId = (inv: number) => sqlite(`select id from shop_orders where invId=${inv};`);
const rights = (uid: string) => sqlite(`select sku||':'||kind||':'||status from shop_entitlements where user='${uid}' order by created;`);

// ---------------------------------------------------------------------- rules
function ruleChecks(): void {
  section('Правила комплектов (src/config/shop.config.ts → shop_rules.js)');
  const R = realRules();
  check('six bundles, each its own sku (no new id for an item it contains)', BUNDLE_ITEMS.length === 6 && BUNDLE_ITEMS.every((b) => b.sku.startsWith('bundle_') && !SHOP_ITEMS.some((i) => i.sku === b.sku)));
  check('2–3 distinct existing single items each — no fighter, no seasonal or exclusive item', BUNDLE_ITEMS.every((b) => b.bundle!.length >= 2 && b.bundle!.length <= 3 && new Set(b.bundle).size === b.bundle!.length && b.bundle!.every((s) => { const it = SHOP_ITEMS.find((i) => i.sku === s); return !!it && !(it.fighter && !it.skin) && !seasonOf(it) && approvedPriceRub(s) !== null; })));
  const table = BUNDLE_ITEMS.map((b) => `${b.sku}: ${b.bundle!.map((s) => `${s} ${approvedPriceRub(s)}`).join(' + ')} = ${bundleListRub(b.sku)} → ${(R.test.prices[b.sku] && SHOP_PRICE_STATUS[b.sku]) ? '' : ''}`).join('; ');
  const OWNER: Record<string, number> = { bundle_ray_glitch: 129, bundle_bruno_spotlights: 179, bundle_nika_fireworks: 179, bundle_vega_comet: 169, bundle_kai_phantom: 159, bundle_broadcast_trio: 119 };
  check('the six prices are the owner\'s (Р-30, 14.11.2026): NEON GLITCH 129, CASINO SPOTLIGHT 179, IDOL FIREWORKS 179, STAR PILOT COMET 169, CUE MASTER PHANTOM 159, PRIME BROADCAST SET 119 — approved, and the server rules carry exactly them', BUNDLE_ITEMS.every((b) => SHOP_PRICE_STATUS[b.sku] === 'approved' && SHOP_PRICES_APPROVED_LATER[b.sku] === '2026-11-14' && approvedPriceRub(b.sku) === OWNER[b.sku] && R.prices[b.sku] === OWNER[b.sku]) && BUNDLE_ITEMS.map((b) => b.name).join() === 'NEON GLITCH,CASINO SPOTLIGHT,IDOL FIREWORKS,STAR PILOT COMET,CUE MASTER PHANTOM,PRIME BROADCAST SET', table);
  check('the composition is the development report\'s: RAY+GLITCH, BRUNO+SPOTLIGHTS, NIKA+FIREWORKS, VEGA+COMET, KAI+PHANTOM, BROADCAST+PHANTOM+CONFETTI', BUNDLE_ITEMS.map((b) => b.bundle!.join('+')).join(' ') === 'skin_ray_neon_runner+fx_glitch_dash skin_bruno_casino_boss+fx_studio_spotlights skin_nika_stage_idol+fx_neon_fireworks skin_vega_star_pilot+fx_comet_trail skin_kai_cue_master+fx_phantom_dash fx_prime_broadcast+fx_phantom_dash+fx_golden_confetti');
  check('each price is below the sum of its items\' approved prices (an honest saving of 15–25 %): 158→129, 218→179, 218→179, 208→169, 198→159, 147→119', BUNDLE_ITEMS.every((b) => { const p = approvedPriceRub(b.sku)!; const sum = bundleListRub(b.sku)!; return p < sum && (sum - p) / sum >= 0.15 && (sum - p) / sum <= 0.25; }) && BUNDLE_ITEMS.map((b) => `${bundleListRub(b.sku)}→${approvedPriceRub(b.sku)}`).join(' ') === '158→129 218→179 218→179 208→169 198→159 147→119');
  check('the single items keep their prices (99 / 149 / 59 / 69 / 49)', ['skin_ray_neon_runner:99', 'skin_bruno_casino_boss:149', 'skin_nika_stage_idol:149', 'skin_vega_star_pilot:149', 'skin_kai_cue_master:149', 'fx_glitch_dash:59', 'fx_comet_trail:59', 'fx_studio_spotlights:69', 'fx_neon_fireworks:69', 'fx_phantom_dash:49', 'fx_prime_broadcast:49', 'fx_golden_confetti:49'].every((x) => { const [k, v] = x.split(':'); return approvedPriceRub(k as never) === Number(v) && R.prices[k] === Number(v); }));
  const r7 = SHOP_OFFERS.find((o) => o.revision === 7);
  check('every bundle is within the 14–17 limit of the revision that sells it (≤ 500 ₽ an order)', !!r7?.minorLimits && BUNDLE_ITEMS.every((b) => approvedPriceRub(b.sku)! <= r7.minorLimits!.orderMaxRub));
  check('the server catalog: kind bundle, its items, the receipt name of a bundle (≤ 100 characters)', BUNDLE_ITEMS.every((b) => R.catalog[b.sku]?.kind === 'bundle' && JSON.stringify(R.catalog[b.sku].items) === JSON.stringify(b.bundle) && R.receiptNames[b.sku] === receiptNameOf(b) && receiptNameOf(b).length <= 100));
  check('offers № 1–6 do not sell bundles; № 7 (Р-29) does, from 2026-11-14T13:00:00Z (16:00 МСК), and the server rules say the same; the staging TEST-ONLY terms rehearse them, a demonstration never', SHOP_OFFERS.filter((o) => o.revision <= 6).every((o) => o.bundles !== true) && r7?.bundles === true && r7.effectiveFrom === '2026-11-14T13:00:00Z' && R.offers.filter((o: any) => o.bundles === true).map((o: any) => `${o.revision}@${o.effectiveFrom}`).join() === '7@2026-11-14T13:00:00Z' && R.test.offer.bundles === true && R.demo.offer.bundles !== true);
  check('test amounts: below the sum of the items\' test amounts', BUNDLE_ITEMS.every((b) => R.test.prices[b.sku] < b.bundle!.reduce((a: number, s: string) => a + R.test.prices[s], 0)));
}

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  const SU = { email: 'bundles-admin@bundles.test', pw: rnd() };
  hooks(null);
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);

  // ------------------------------------------------------------ closed
  section('Закрыто: без PRIME_SHOP_BUNDLES и под опубликованной офертой № 6');
  await startPb(TEST_ENV);
  const su = (await http('POST', '/api/collections/_superusers/auth-with-password', '', { identity: SU.email, password: SU.pw })).j.token as string;
  const strict = (await http('GET', '/api/settings', su)).j.rateLimits;
  await http('PATCH', '/api/settings', su, { rateLimits: { enabled: true, rules: strict.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const cfg = (await http('GET', '/api/prime/config')).j;
  const pw = 'Bundles' + crypto.randomBytes(6).toString('hex');
  const mk = async (email: string) => {
    const u = (await http('POST', '/api/collections/users/records', su, { email, password: pw, passwordConfirm: pw, verified: true })).j;
    await http('POST', '/api/collections/profiles/records', su, { user: u.id, nickname: email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 16), nicknameKey: email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) });
    for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
    await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    const tok = (await http('POST', '/api/collections/users/auth-with-password', '', { identity: email, password: pw })).j.token as string;
    return { id: u.id as string, tok };
  };
  const A = await mk('bundlea@bundles.test');
  const B = await mk('bundleb@bundles.test');
  const C = await mk('bundlec@bundles.test');
  const TERMS = (await http('GET', '/api/prime/shop/offer')).j.offer;
  for (const x of [A, B, C]) await http('POST', '/api/prime/shop/offer/accept', x.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  const st0 = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('PRIME_SHOP_BUNDLES off: no bundle has a price, the items keep theirs', BUNDLE_ITEMS.every((b) => st0.prices[b.sku] === null) && st0.prices.skin_ray_neon_runner === 1000);
  const closed = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'bundle_ray_glitch' });
  check('…the checkout refuses a bundle (409 bundles_closed), no order', closed.status === 409 && closed.j.code === 'bundles_closed' && sqlite('select count(*) from shop_orders;') === '0', JSON.stringify(closed.j));
  await stopPb();

  // a LIVE production server, the APPROVED bundle prices, bundles switched on — closed while revision 6 is the one in force
  // (its order is one item); open under the REAL revision 7 (a copy whose moment has come)
  const real = realRules();
  const live6 = JSON.parse(JSON.stringify(real));
  live6.offers = live6.offers.filter((o: any) => o.revision <= 6);
  hooks(live6);
  await startPb({ ...LIVE_ENV, PRIME_SHOP_BUNDLES: 'on' });
  const lc = (await http('GET', '/api/prime/config')).j.shop;
  check('LIVE, the approved prices, PRIME_SHOP_BUNDLES=on — under offer № 6 no charge for any bundle (its order is one item)', lc && BUNDLE_ITEMS.every((b) => lc.charge[b.sku] === null) && lc.charge.skin_ray_neon_runner === 9900, JSON.stringify(lc?.charge ?? {}).slice(0, 200));
  const lco = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'bundle_ray_glitch' });
  check('…and its checkout refuses a bundle (no order is made)', lco.status >= 400 && sqlite("select count(*) from shop_orders where kind='bundle';") === '0', JSON.stringify(lco.j));
  await stopPb();
  const live7 = JSON.parse(JSON.stringify(real));
  const rev7 = live7.offers.find((o: any) => o.revision === 7);
  rev7.effectiveFrom = '2026-01-01T00:00:00Z';
  hooks(live7);
  await startPb({ ...LIVE_ENV, PRIME_SHOP_BUNDLES: 'on' });
  const lc7 = (await http('GET', '/api/prime/config')).j.shop;
  check('…under the real revision 7 in force: the six approved prices are charged (12 900 / 17 900 / 17 900 / 16 900 / 15 900 / 11 900 kopecks)', lc7 && BUNDLE_ITEMS.map((b) => lc7.charge[b.sku]).join() === '12900,17900,17900,16900,15900,11900', JSON.stringify(lc7?.charge ?? {}).slice(0, 300));
  // a real-money order (nothing is paid: the payment page is never opened) — consent to № 7, one order, ONE receipt line
  const T7 = (await http('GET', '/api/prime/shop/offer')).j.offer;
  check('…the offer in force is revision 7 at offer.html with its registered SHA-256', T7?.revision === 7 && T7.sha256 === r7sha() && /legal\/ru\/offer\.html$/.test(T7.url), JSON.stringify(T7));
  await http('POST', '/api/prime/shop/offer/accept', C.tok, { revision: T7.revision, sha256: T7.sha256 });
  const lo = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'bundle_bruno_spotlights' });
  const rc = lo.j.payment?.fields?.Receipt ? JSON.parse(decodeURIComponent(lo.j.payment.fields.Receipt)) : null;
  check('…a live order: 179 ₽ (17 900), the consent to № 7 recorded on it, Robokassa fields with ONE receipt line «Комплект цифровых предметов CASINO SPOTLIGHT (2 шт.)…» at 179', lo.status === 200 && lo.j.order?.amountKop === 17900 && lo.j.payment?.fields?.OutSum === '179.00' && sqlite(`select offerRevision from shop_orders where invId=${lo.j.order?.inv};`) === '7' && rc?.items?.length === 1 && rc.items[0].sum === 179 && rc.items[0].quantity === 1 && rc.items[0].name === receiptNameOf(BUNDLE_ITEMS[1]) && lo.j.payment.fields.IsTest === undefined, JSON.stringify(lo.j).slice(0, 400));
  sqlite(`update shop_orders set status='cancelled' where invId=${lo.j.order?.inv};`);
  await stopPb();
  hooks(live7);
  await startPb({ ...LIVE_ENV });
  const lcOff = (await http('GET', '/api/prime/config')).j.shop;
  check('…and without PRIME_SHOP_BUNDLES=on nothing, whatever the rules say', lcOff && BUNDLE_ITEMS.every((b) => lcOff.charge[b.sku] === null));
  await stopPb();
  // the REAL rules as they are: closed before revision 7's moment, open from it (the server's own clock)
  hooks(real);
  await startPb({ ...LIVE_ENV, PRIME_SHOP_BUNDLES: 'on' });
  const lcNow = (await http('GET', '/api/prime/config')).j.shop;
  const open7 = Date.now() >= Date.parse('2026-11-14T13:00:00Z');
  check(`the real rules now (${new Date().toISOString().slice(0, 16)}Z): ${open7 ? 'revision 7 in force — bundles priced' : 'before 14.11.2026 13:00 UTC — revision 6 in force, no bundle priced'}`, lcNow && BUNDLE_ITEMS.every((b) => (lcNow.charge[b.sku] === null) === !open7));
  await stopPb();

  // ------------------------------------------------------------ test mode
  section('Тестовый режим (репетиция стенда): один заказ, одна оплата, одно право на комплект');
  hooks(null);
  await startPb({ ...TEST_ENV, PRIME_SHOP_BUNDLES: 'on' });
  const st = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('status: the bundle\'s TEST amount (15 ₽ = 1500), its items 10 ₽ each', st.prices.bundle_ray_glitch === 1500 && st.prices.skin_ray_neon_runner === 1000 && st.prices.fx_glitch_dash === 1000, JSON.stringify(st.prices).slice(0, 160));
  const c1 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'bundle_ray_glitch', priceKop: 1 });
  const o1 = c1.j.order;
  check('one order for the bundle: the server\'s amount (1500), kind bundle, the bundle\'s receipt name on the payment page', c1.status === 200 && o1.amountKop === 1500 && sqlite(`select kind from shop_orders where invId=${o1.inv};`) === 'bundle' && c1.j.payment.fields.Description === receiptNameOf(BUNDLE_ITEMS[0]), JSON.stringify(c1.j).slice(0, 220));
  const c1b = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'bundle_ray_glitch' });
  check('a repeated «buy» gets the SAME order (one InvId, Robokassa never takes two payments)', c1b.j.order?.inv === o1.inv && c1b.j.reused === true);
  const ov = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_glitch_dash' });
  check('an item of the open bundle order cannot get an order of its own (409 overlap_open_order, names the bundle)', ov.status === 409 && ov.j.code === 'overlap_open_order' && ov.j.sku === 'bundle_ray_glitch', JSON.stringify(ov.j));
  const paid = await pay(o1.inv, '15.000000', orderId(o1.inv));
  check('the verified payment → OK, delivered: ONE right (the bundle, kind bundle)', paid === `OK${o1.inv}` && rights(A.id) === 'bundle_ray_glitch:bundle:active' && sqlite(`select status from shop_orders where invId=${o1.inv};`) === 'fulfilled', rights(A.id));
  const again = await pay(o1.inv, '15.000000', orderId(o1.inv));
  check('a repeated notification changes nothing (still one right)', again === `OK${o1.inv}` && rights(A.id) === 'bundle_ray_glitch:bundle:active');
  const stA = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('the game sees the bundle AND each of its items as owned', ['bundle_ray_glitch', 'skin_ray_neon_runner', 'fx_glitch_dash'].every((s) => stA.owned.includes(s)) && !stA.owned.includes('fx_comet_trail'), JSON.stringify(stA.owned));
  const one = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  check('an item of an owned bundle is never sold again (409 owned)', one.status === 409 && one.j.code === 'owned');

  section('Владение: комплект только целиком');
  const cb = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'fx_studio_spotlights' });
  await pay(cb.j.order.inv, '10.000000', orderId(cb.j.order.inv));
  const part = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'bundle_bruno_spotlights' });
  check('a bundle with an item owned is refused and names the item (409 bundle_owned [fx_studio_spotlights])', part.status === 409 && part.j.code === 'bundle_owned' && JSON.stringify(part.j.owned) === '["fx_studio_spotlights"]', JSON.stringify(part.j));
  const k1 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'bundle_kai_phantom' });
  const k2 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'bundle_broadcast_trio' });
  check('two open bundles sharing an item (PHANTOM DASH) are never both made (overlap_open_order)', k1.status === 200 && k2.status === 409 && k2.j.code === 'overlap_open_order' && k2.j.sku === 'bundle_kai_phantom', JSON.stringify(k2.j));

  section('Выдача: предмет, полученный тем временем → проверка, ничего дважды');
  const s1 = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'fx_comet_trail' });
  // the single order closes unpaid (its time is over) — then the bundle may be ordered…
  sqlite(`update shop_orders set expiresAt=${Date.now() - 1000} where invId=${s1.j.order.inv};`);
  const bv = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'bundle_vega_comet' });
  // …and the old page is still paid late (a verified payment is a payment all the same — 1.8.8)
  await pay(s1.j.order.inv, '10.000000', orderId(s1.j.order.inv));
  const late = await pay(bv.j.order.inv, '15.000000', orderId(bv.j.order.inv));
  check('the bundle paid after one of its items was delivered → requires_review (a refund), no bundle right, the item once', bv.status === 200 && late === `OK${bv.j.order.inv}` && sqlite(`select status||':'||reviewReason from shop_orders where invId=${bv.j.order.inv};`) === 'requires_review:already_owned' && rights(C.id) === 'fx_comet_trail:cosmetic:active', `${sqlite(`select status||':'||reviewReason from shop_orders where invId=${bv.j.order.inv};`)} | ${rights(C.id)}`);

  section('Часть цены комплекта (недостаток одного предмета, оферта № 7 п. 9.3): предметы остаются');
  await pay(k1.j.order.inv, '15.000000', orderId(k1.j.order.inv));
  cli({ ...TEST_ENV, PRIME_SHOP_BUNDLES: 'on' }, 'prime-shop', 'refund', String(k1.j.order.inv), '3.75', 'reason=bundles-check-share');
  cli({ ...TEST_ENV, PRIME_SHOP_BUNDLES: 'on' }, 'prime-shop', 'refund-done', String(k1.j.order.inv));
  const stP = (await http('GET', '/api/prime/shop/status', B.tok)).j;
  check('a part of the bundle\'s price refunded (3.75 of 15 ₽): the order says so, the bundle right and both items stay', sqlite(`select status||':'||refundKop from shop_orders where invId=${k1.j.order.inv};`) === 'refunded:375' && /bundle_kai_phantom:bundle:active/.test(rights(B.id)) && ['bundle_kai_phantom', 'skin_kai_cue_master', 'fx_phantom_dash'].every((x) => stP.owned.includes(x)), `${sqlite(`select status||':'||refundKop from shop_orders where invId=${k1.j.order.inv};`)} | ${rights(B.id)}`);

  section('Возврат комплекта забирает все его предметы');
  cli({ ...TEST_ENV, PRIME_SHOP_BUNDLES: 'on' }, 'prime-shop', 'refund', String(o1.inv), 'reason=bundles-check');
  cli({ ...TEST_ENV, PRIME_SHOP_BUNDLES: 'on' }, 'prime-shop', 'refund-done', String(o1.inv));
  const stR = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('the refunded bundle: its right revoked, neither the bundle nor its items owned any more', sqlite(`select status from shop_orders where invId=${o1.inv};`) === 'refunded' && rights(A.id) === 'bundle_ray_glitch:bundle:revoked' && !['bundle_ray_glitch', 'skin_ray_neon_runner', 'fx_glitch_dash'].some((s) => stR.owned.includes(s)), `${rights(A.id)} | ${JSON.stringify(stR.owned)}`);
  check('no password or secret in the server log', !pbLog.some((l) => [TEST_P1, TEST_P2, LIVE.p1, LIVE.p2, LIVE.p3].some((s) => l.includes(s))));
  await stopPb();
}

function r7sha(): string {
  return SHOP_OFFERS.find((o) => o.revision === 7)?.sha256 ?? '';
}

async function main(): Promise<void> {
  ruleChecks();
  await serverChecks();
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  проверка прервалась: ' + (e instanceof Error ? e.stack : String(e)));
    console.log(pbLog.slice(-30).join('\n'));
  })
  .finally(async () => {
    await stopChild(pb).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed ? 'bundles: FAILED' : 'bundles: OK'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed ? 1 : 0);
  });
