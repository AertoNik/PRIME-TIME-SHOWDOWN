// Alpha 1.8.8 stage 4 — `npm run payments`: PRIME PAYMENTS × ROBOKASSA.
//
//   protocol    backend/pb_hooks/lib/robokassa.js run in Node and compared with Node's own crypto: amounts in
//               kopecks (no floating point), the payment page's signature, the ResultURL check (right / wrong
//               signature, password, algorithm, amount, InvId, Shp_*, IsTest, missing fields, both OutSum
//               formats), the raw form parser, OpStateExt, the Refund API token
//   client      the game's side (src/meta/Payments.ts, entitlements, the roster): what an order means on
//               screen, the way back from Robokassa, the payment page allow-list, rights that follow the
//               signed-in PRIME ID only, a forged save / SuccessURL opening nothing
//   safety      no secret, no payment emulator and no admin tool in the game's code or production build
//   server      a REAL PocketBase (the project's migrations, a COPY of its hooks), on spare ports, with a
//               brand-new temporary database deleted afterwards; made-up accounts (…@payments.test) and
//               RANDOM test passwords made up for this run — never a real Robokassa secret, never the real
//               server: orders, idempotency, ResultURL, delivery, concurrency, failures, restarts, refunds,
//               environments (test never owns on production), account deletion, the migration down and up
//
// What this cannot prove: a real payment on Robokassa's page and a real notification from Robokassa's servers
// (that needs the staging server and the shop's test passwords — docs/ROBOKASSA_SETUP.md).

import { HOOKS, MIGRATIONS, PB_BIN, ROOT, binariesReady, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, nodeModule, os, path, proc } from './lib/node';
import { defaultSave } from '../src/meta/SaveSystem';
import { clientChecks } from './lib/paymentsClient';
import * as OFFERS from '../src/config/offer.config';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 19190, smtp: 11919, mailUi: 19191 };
const API = `http://127.0.0.1:${PORTS.api}`;
const GAME = 'http://localhost:5173/';
const LOGIN = 'primetimeshowdown';

let passed = 0;
let failed = 0;
export function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
export function section(t: string): void {
  console.log(`\n— ${t}`);
}
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;

const req = nodeModule.createRequire(import.meta.url);
const RK = req('../backend/pb_hooks/lib/robokassa.js');
// (payments.js loads in Node too: its pure parts — invoice numbers, the game address — are checked here)
const PAYJS = req('../backend/pb_hooks/lib/payments.js');
const H = {
  md5: (s: string) => crypto.createHash('md5').update(s, 'utf8').digest('hex'),
  sha256: (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
  sha512: (s: string) => crypto.createHash('sha512').update(s, 'utf8').digest('hex'),
};
const equal = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const hmacHex = (t: string, k: string) => crypto.createHmac('sha256', k).update(t, 'utf8').digest('hex');
declare const Buffer: any;

// random, made up for this run only (never a real Robokassa password)
const rnd = (n = 18) => crypto.randomBytes(n).toString('base64url');
const TEST_P1 = 'tp1-' + rnd();
const TEST_P2 = 'tp2-' + rnd();
const LIVE_P1 = 'lp1-' + rnd();
const LIVE_P2 = 'lp2-' + rnd();
const LIVE_P3 = 'lp3-' + rnd();
const SECRETS = [TEST_P1, TEST_P2, LIVE_P1, LIVE_P2, LIVE_P3];

// ======================================================================== protocol
function protocolChecks(): void {
  section('Протокол Robokassa (lib/robokassa.js в Node, сверка с crypto)');
  check('kopecks → OutSum: 14900 → "149.00", 1 → "0.01", 1000 → "10.00"', RK.outSum(14900) === '149.00' && RK.outSum(1) === '0.01' && RK.outSum(1000) === '10.00' && RK.outSum(14950) === '149.50');
  let threw = 0;
  for (const bad of [0, -1, 1.5, NaN, 2e9]) {
    try {
      RK.outSum(bad);
    } catch {
      threw++;
    }
  }
  check('an amount that is not a whole positive number of kopecks is never sent', threw === 5);
  const sums: [string, number | null][] = [
    ['149', 14900],
    ['149.0', 14900],
    ['149.00', 14900],
    ['149.000000', 14900],
    ['149.5', 14950],
    ['0.01', 1],
    ['149.005', null],
    ['149.0000001', null],
    ['1e3', null],
    ['-149.00', null],
    ['149,00', null],
    [' 149.00', null],
    ['0', null],
    ['', null],
  ];
  const bad = sums.filter(([s, k]) => RK.sumKop(s) !== k);
  check('OutSum text → kopecks exactly (both formats "149.00" / "149.000000"; no fractions of a kopeck, signs, exponents, commas)', bad.length === 0, bad.map((b) => b[0]).join('|'));

  // the official example of the notification base string (notifications-and-redirects)
  const base = RK.resultBase('100.000000', '450009', 'Пароль#2', RK.shpList({ Shp_oplata: '1', Shp_login: 'Vasya', OutSum: 'x' }));
  check('ResultURL base string = the documentation example "100.000000:450009:Пароль#2:Shp_login=Vasya:Shp_oplata=1" (Shp_* sorted)', base === '100.000000:450009:Пароль#2:Shp_login=Vasya:Shp_oplata=1', base);
  check('payment base string "MerchantLogin:OutSum:InvId:Пароль#1:Shp_…" (pay-interface); with Receipt between InvId and the password', RK.paymentBase('demo', '149.00', 5, '', 'P1', [['Shp_order', 'o1']]) === 'demo:149.00:5:P1:Shp_order=o1' && RK.paymentBase('demo', '149.00', 5, 'RCPT', 'P1', []) === 'demo:149.00:5:RCPT:P1');
  check('OpStateExt base "MerchantLogin:InvoiceID:Пароль#2" (xml-interfaces)', RK.opStateBase('demo', '7', 'P2') === 'demo:7:P2');
  check('hashes = Node crypto for md5 / sha256 / sha512 (UTF-8, lower-case hex)', ['md5', 'sha256', 'sha512'].every((a) => RK.hash(a, base, H) === (H as any)[a](base)));
  let unsupported = false;
  try {
    RK.hash('ripemd160', 'x', H);
  } catch {
    unsupported = true;
  }
  check('an algorithm PocketBase cannot compute (RIPEMD160, SHA1, SHA384) is refused, never replaced by another', unsupported && RK.ALGORITHMS.join() === 'md5,sha256,sha512');

  const form = RK.paymentForm({ login: LOGIN, password1: TEST_P1, alg: 'sha256', H, kop: 1000, inv: 900000001, title: 'PRIME TIME SHOWDOWN: RAY: NEON RUNNER «тест»', test: true, shp: { Shp_order: 'abc123def456ghi' }, expires: Date.parse('2026-10-23T12:00:00Z'), receipt: '', gateway: '' });
  const f = form.fields;
  check('payment form: Robokassa\'s own page, POST, MerchantLogin / OutSum / InvId / Description / SignatureValue / Culture / Shp_order / IsTest=1', form.url === 'https://auth.robokassa.ru/Merchant/Index.aspx' && form.method === 'POST' && f.MerchantLogin === LOGIN && f.OutSum === '10.00' && f.InvId === '900000001' && f.Shp_order === 'abc123def456ghi' && f.IsTest === '1' && f.Culture === 'ru');
  check('payment form signature = SHA256("login:10.00:900000001:<test Password#1>:Shp_order=…")', f.SignatureValue === H.sha256(`${LOGIN}:10.00:900000001:${TEST_P1}:Shp_order=abc123def456ghi`));
  check('Description: ≤ 100 characters, no special characters («», quotes…)', f.Description.length <= 100 && !/[«»"'<>&]/.test(f.Description) && f.Description.includes('RAY: NEON RUNNER'));
  check('ExpirationDate in Moscow time (UTC+3), "YYYY-MM-DDThh:mm"', f.ExpirationDate === '2026-10-23T15:00');
  check('no password, no Receipt by default, nothing else in the form', !Object.values(f).some((v: any) => SECRETS.includes(v)) && !('Receipt' in f) && Object.keys(f).sort().join() === 'Culture,Description,ExpirationDate,InvId,IsTest,MerchantLogin,OutSum,Shp_order,SignatureValue');
  const liveForm = RK.paymentForm({ login: LOGIN, password1: LIVE_P1, alg: 'md5', H, kop: 14900, inv: 1000001, title: 'x', test: false, shp: { Shp_order: 'o' }, expires: 0, receipt: '', gateway: '' });
  check('live form: no IsTest at all, MD5 when the shop says MD5', !('IsTest' in liveForm.fields) && liveForm.fields.SignatureValue === H.md5(`${LOGIN}:149.00:1000001:${LIVE_P1}:Shp_order=o`));
  const rc = RK.receipt('PRIME TIME SHOWDOWN: RAY', 14900);
  const withRc = RK.paymentForm({ login: LOGIN, password1: LIVE_P1, alg: 'sha256', H, kop: 14900, inv: 1000002, title: 'x', test: false, shp: {}, expires: 0, receipt: rc, gateway: '' });
  check('prepared (off by default) Receipt: URL-encoded minimised JSON, one item, the order sum, signed between InvId and the password', JSON.parse(decodeURIComponent(rc)).items[0].sum === 149 && withRc.fields.Receipt === rc && withRc.fields.SignatureValue === H.sha256(`${LOGIN}:149.00:1000002:${rc}:${LIVE_P1}`));

  // ---- the «Receipt» (nomenclature for «Робочеки СМЗ»): exact content, UTF-8, the signature with Shp_*, the transport
  const NAME = 'Цифровой облик бойца RAY: NEON RUNNER для игры PRIME TIME: SHOWDOWN';
  const rcRay = RK.receipt(NAME, 9900);
  const rj = JSON.parse(decodeURIComponent(rcRay));
  check('Receipt for НПД: exactly one item with exactly {name, quantity 1, sum, tax none} — no «sno», «payment_method», «payment_object» (Robokassa support, «Робочеки СМЗ»)', Object.keys(rj).join() === 'items' && rj.items.length === 1 && Object.keys(rj.items[0]).join() === 'name,quantity,sum,tax' && rj.items[0].quantity === 1 && rj.items[0].tax === 'none' && !/sno|payment_method|payment_object/.test(decodeURIComponent(rcRay)), decodeURIComponent(rcRay));
  check('Receipt: no payment_object to choose — the old list and its third argument are gone', !('RECEIPT_OBJECTS' in RK) && RK.receipt.length === 2 && (RK.receipt as any)(NAME, 9900, 'goods') === rcRay);
  check('Receipt: the Cyrillic name travels as UTF-8 and comes back unchanged; the text is pure ASCII (the signature hashes exactly these bytes)', rj.items[0].name === NAME && /^[\x21-\x7e]+$/.test(rcRay) && rcRay.includes('%D0%A6%D0%B8%D1%84'));
  check('Receipt: the sum is the order\'s own kopecks in roubles — the same number as OutSum (99 → 99, 99.50 → 99.5, 49 → 49)', rj.items[0].sum === Number(RK.outSum(9900)) && JSON.parse(decodeURIComponent(RK.receipt(NAME, 9950))).items[0].sum === 99.5 && RK.outSum(9950) === '99.50' && JSON.parse(decodeURIComponent(RK.receipt(NAME, 4900))).items[0].sum === 49);
  check('Receipt: an item without a name is never sent', (() => { try { RK.receipt('«»', 4900); return false; } catch { return true; } })());
  const shpRc = { Shp_order: 'ord000000000001', Shp_a: 'x' };
  const fRc = RK.paymentForm({ login: LOGIN, password1: TEST_P1, alg: 'sha256', H, kop: 9900, inv: 500000000000123, title: NAME, test: true, shp: shpRc, expires: 0, receipt: rcRay, gateway: '' }).fields;
  check('SHA256 with Receipt and Shp_*: HASH("MerchantLogin:OutSum:InvId:Receipt:Password#1:Shp_a=…:Shp_order=…") — Receipt after InvId, the Shp_* after the password, sorted by name (pay-interface)', fRc.SignatureValue === H.sha256(`${LOGIN}:99.00:500000000000123:${rcRay}:${TEST_P1}:Shp_a=x:Shp_order=ord000000000001`) && fRc.SignatureValue.length === 64);
  check('the form field Receipt is the very text in the signature; IsTest=1 is in the form, never in the signature', fRc.Receipt === rcRay && fRc.IsTest === '1' && !H.sha256(`${LOGIN}:99.00:500000000000123:${rcRay}:${TEST_P1}:IsTest=1:Shp_a=x:Shp_order=ord000000000001`).includes(fRc.SignatureValue));
  const posted = new URLSearchParams(Object.entries(fRc) as [string, string][]).toString();
  check('the POST form transport (application/x-www-form-urlencoded) delivers to Robokassa exactly the Receipt that was signed', new URLSearchParams(posted).get('Receipt') === rcRay && new URLSearchParams(posted).get('SignatureValue') === fRc.SignatureValue);
  check('the signature takes the Receipt URL-encoded exactly once — neither the raw JSON nor a twice-encoded text', fRc.SignatureValue !== H.sha256(`${LOGIN}:99.00:500000000000123:${decodeURIComponent(rcRay)}:${TEST_P1}:Shp_a=x:Shp_order=ord000000000001`) && fRc.SignatureValue !== H.sha256(`${LOGIN}:99.00:500000000000123:${encodeURIComponent(rcRay)}:${TEST_P1}:Shp_a=x:Shp_order=ord000000000001`));
  check('on the wire the Receipt is encoded twice — the POST body as a GET link would carry it ("%7B%22items" → "%257B%2522items"); one decoding of the transport gives back the signed text', posted.includes('Receipt=%257B%2522items%2522') && new URL(RK.PAY_URL + '?' + posted).searchParams.get('Receipt') === rcRay && decodeURIComponent(new URL(RK.PAY_URL + '?' + posted).searchParams.get('Receipt')!) === decodeURIComponent(rcRay));
  const fLive = RK.paymentForm({ login: LOGIN, password1: LIVE_P1, alg: 'sha256', H, kop: 9900, inv: 10000000123, title: NAME, test: false, shp: shpRc, expires: 0, receipt: rcRay, gateway: '' }).fields;
  check('the same Receipt signed in live mode: the LIVE Password#1, no IsTest — a test form can never pass for a live one', !('IsTest' in fLive) && fLive.SignatureValue === H.sha256(`${LOGIN}:99.00:10000000123:${rcRay}:${LIVE_P1}:Shp_a=x:Shp_order=ord000000000001`) && fLive.SignatureValue !== fRc.SignatureValue);
  const rules = realRules();
  const sold = Object.keys(rules.catalog).filter((k: string) => rules.prices[k] !== null);
  check('nomenclature: every item on sale gets its own receipt name (≤ 128, unchanged by the character rule), its approved price as the sum; LUCIEN has no price — never a receipt', sold.length === 6 && !sold.includes('fighter_lucien') && sold.every((k: string) => {
    const n = PAYJS.receiptName(k);
    const j2 = JSON.parse(decodeURIComponent(RK.receipt(n, Math.round(rules.prices[k] * 100))));
    return j2.items[0].name === n && n.length <= 128 && RK.description(n) === n && j2.items[0].sum === rules.prices[k] && n.includes(rules.titles[k]);
  }));
  check('ResultURL is untouched by the Receipt: its signature stays "OutSum:InvId:Password#2[:Shp_*]"', RK.checkResult(signedNote(500000000000123, '99.00', 'ord000000000001'), { password2: TEST_P2, password1: TEST_P1, alg: 'sha256', H, equal: (a: string, b: string) => a === b, test: true }).ok === true);

  // ResultURL
  const sign = (sum: string, inv: string, pw: string, shp: Record<string, string>, alg = 'sha256') => (H as any)[alg](RK.resultBase(sum, inv, pw, RK.shpList(shp))).toUpperCase();
  const note = (o: Record<string, string> = {}) => ({ OutSum: '10.000000', InvId: '900000001', Shp_order: 'ord1', SignatureValue: sign('10.000000', '900000001', TEST_P2, { Shp_order: 'ord1' }), ...o });
  const opt = { password2: TEST_P2, password1: TEST_P1, alg: 'sha256', H, equal, test: true };
  const good = RK.checkResult(note(), opt);
  check('ResultURL: a right signature (upper-case hex, as Robokassa sends it) → ok, InvId, 1000 kopecks, Shp_order', good.ok && good.inv === 900000001 && good.kop === 1000 && good.shp.Shp_order === 'ord1');
  const test2 = RK.checkResult(note({ OutSum: '10.00', SignatureValue: sign('10.00', '900000001', TEST_P2, { Shp_order: 'ord1' }) }), opt);
  check('ResultURL: the test-mode format "10.00" is checked over its exact text too', test2.ok && test2.kop === 1000);
  const refusals: [string, Record<string, string>, any, string][] = [
    ['wrong signature', { SignatureValue: 'A'.repeat(64) }, opt, 'bad_signature'],
    ['wrong password (#1 instead of #2)', { SignatureValue: sign('10.000000', '900000001', TEST_P1, { Shp_order: 'ord1' }) }, opt, 'bad_signature'],
    ['the LIVE Password#2 on a test server (secrets mixed up)', { SignatureValue: sign('10.000000', '900000001', LIVE_P2, { Shp_order: 'ord1' }) }, opt, 'bad_signature'],
    ['another algorithm (MD5 while the server is set to SHA256)', { SignatureValue: sign('10.000000', '900000001', TEST_P2, { Shp_order: 'ord1' }, 'md5') }, opt, 'bad_signature'],
    ['changed amount', { OutSum: '1.000000' }, opt, 'bad_signature'],
    ['changed InvId', { InvId: '900000002' }, opt, 'bad_signature'],
    ['changed Shp_order', { Shp_order: 'ord2' }, opt, 'bad_signature'],
    ['an extra Shp_ parameter', { Shp_free: '1' }, opt, 'bad_signature'],
    ['IsTest=0 on a test server', { IsTest: '0' }, opt, 'istest_mismatch'],
    ['missing SignatureValue', { SignatureValue: '' }, opt, 'missing_fields'],
    ['missing OutSum', { OutSum: '' }, opt, 'missing_fields'],
    ['InvId not a number', { InvId: '9e9' }, opt, 'bad_inv'],
    ['OutSum not an amount', { OutSum: '10,00' }, opt, 'bad_sum'],
  ];
  for (const [name, o, op, code] of refusals) {
    const r = RK.checkResult(note(o), op);
    check(`ResultURL refused: ${name} → ${code}`, !r.ok && r.code === code, JSON.stringify(r));
  }
  const live = RK.checkResult(note({ IsTest: '1', SignatureValue: sign('10.000000', '900000001', LIVE_P2, { Shp_order: 'ord1' }) }), { ...opt, password2: LIVE_P2, password1: LIVE_P1, test: false });
  check('ResultURL on a LIVE server: IsTest=1 is refused even with a valid live signature (a test payment never counts)', !live.ok && live.code === 'istest_mismatch');
  const noFlag = RK.checkResult(note(), opt);
  check('ResultURL without IsTest on a test server: decided by the TEST Password#2 signature alone (the documentation does not promise the flag)', noFlag.ok);
  const why = RK.checkResult(note({ SignatureValue: sign('10.000000', '900000001', TEST_P2, { Shp_order: 'ord1' }, 'md5') }), opt);
  const why1 = RK.checkResult(note({ SignatureValue: sign('10.000000', '900000001', TEST_P1, { Shp_order: 'ord1' }) }), opt);
  check('a refused signature explains a misconfiguration for the server log (algorithm:md5, password1) — and is still refused', !why.ok && /algorithm:md5/.test(why.hint) && !why1.ok && /password1/.test(why1.hint));
  const parsed = RK.parseForm('OutSum=10.000000&InvId=000123&SignatureValue=AB&Shp_order=o%201&IsTest=1&Fee=0.5&EMail=a%40b.ru&OutSum=99');
  check('raw form parser keeps the exact texts ("000123", "10.000000", "0.5"), decodes, first value wins', parsed.OutSum === '10.000000' && parsed.InvId === '000123' && parsed.Shp_order === 'o 1' && parsed.Fee === '0.5' && parsed.EMail === 'a@b.ru');

  const xml = `<?xml version="1.0" encoding="utf-8"?><OperationStateResponse xmlns="http://merchant.roboxchange.com/WebService/"><Result><Code>0</Code></Result><State><Code>100</Code><RequestDate>2026-10-23T10:00:00+03:00</RequestDate><StateDate>2026-10-23T09:59:00+03:00</StateDate></State><Info><IncCurrLabel>BankCardPSR</IncCurrLabel><IncSum>149.000000</IncSum><IncAccount>4***1111</IncAccount><PaymentMethod><Code>BankCard</Code><Description>Банковская карта</Description></PaymentMethod><OutCurrLabel>RUR</OutCurrLabel><OutSum>149.000000</OutSum><OpKey>A1B2-C3</OpKey></Info></OperationStateResponse>`;
  const st = RK.parseOpState(xml);
  const nf = RK.parseOpState('<OperationStateResponse><Result><Code>3</Code><Description>Не удалось найти операцию</Description></Result></OperationStateResponse>');
  check('OpStateExt answer: result 0, state 100, OutSum, OpKey; «not found» → result 3; garbage → nothing', st.result === 0 && st.state === 100 && st.outSum === '149.000000' && st.opKey === 'A1B2-C3' && nf.result === 3 && nf.state === null && RK.parseOpState('nonsense').result === null);
  const u = new URL(RK.opStateUrl(LOGIN, 1000001, LIVE_P2, 'sha256', H));
  check('OpStateExt request: MerchantLogin, InvoiceID, Signature = SHA256("login:InvId:Password#2") — the password itself never in the URL', u.origin + u.pathname === 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt' && u.searchParams.get('Signature') === H.sha256(`${LOGIN}:1000001:${LIVE_P2}`) && !u.href.includes(LIVE_P2));
  const jwt = RK.refundToken({ OpKey: 'op-1', RefundSum: 74.5 }, LIVE_P3, hmacHex);
  const [h, p, s] = jwt.split('.');
  check('Refund API token: HS256 JWT, payload {OpKey, RefundSum}, signature = HMAC-SHA256(Password3) in base64url', JSON.parse(Buffer.from(h, 'base64url').toString()).alg === 'HS256' && JSON.parse(Buffer.from(p, 'base64url').toString()).RefundSum === 74.5 && s === crypto.createHmac('sha256', LIVE_P3).update(`${h}.${p}`).digest('base64url'));
  check('Refund state: finished / processing / canceled, anything else unknown', RK.refundState({ label: 'finished' }) === 'finished' && RK.refundState({ label: 'canceled' }) === 'canceled' && RK.refundState({ label: 'weird' }) === null && RK.refundState(null) === null);

  // ---- OpStateExt describes an INVOICE NUMBER: it must be THIS order's payment
  const opXml = (shp: string, date: string) =>
    `<OperationStateResponse><Result><Code>0</Code></Result><State><Code>100</Code><StateDate>${date}</StateDate></State><Info><OutSum>149.000000</OutSum><OpKey>K1</OpKey></Info><UserFields><Field><Name>shp_order</Name><Value>${shp}</Value></Field></UserFields></OperationStateResponse>`;
  const created = Date.parse('2026-11-20T10:00:00Z');
  const mine = RK.parseOpState(opXml('ord000000000001', '2026-11-20T13:05:00.1234567+03:00'));
  check('OpStateExt: the operation\'s UserFields (Shp_order) and StateDate (7 fractional digits, +03:00) are read', mine.fields.shp_order === 'ord000000000001' && mine.stateTime === Date.parse('2026-11-20T10:05:00.123Z'));
  check('OpStateExt counts only for THIS order: paid + its Shp_order + not older than the order', RK.opStateBelongs(mine, 'ord000000000001', created).ok);
  const foreign = RK.opStateBelongs(RK.parseOpState(opXml('ord000000000099', '2026-11-20T13:05:00+03:00')), 'ord000000000001', created);
  const old = RK.opStateBelongs(RK.parseOpState(opXml('ord000000000001', '2026-10-01T09:00:00+03:00')), 'ord000000000001', created);
  const bare = RK.opStateBelongs(RK.parseOpState(opXml('', '2026-11-20T13:05:00+03:00').replace(/<UserFields>[\s\S]*<\/UserFields>/, '')), 'ord000000000001', created);
  check('…an old payment under a reused invoice number (another Shp_order, older than the order, no fields) never pays a new order', !foreign.ok && foreign.why === 'shp_order' && !old.ok && old.why === 'older_than_order' && !bare.ok);

  // ---- invoice numbers that survive a restored backup
  const t0 = Date.parse('2026-10-23T12:00:00Z');
  const fl = PAYJS.invFloor('live', t0);
  const ft = PAYJS.invFloor('test', t0);
  check('invoice numbers: live 10 000 000 000 + 10/s since 2026, test 500 000 000 000 000 + 10/s — above every first-stage number (1 000 001… / 900 000 001…)', fl === 10000000000 + Math.floor((t0 - Date.UTC(2026, 0, 1)) / 1000) * 10 && ft === 500000000000000 + (fl - 10000000000) && fl > 999999999 && ft > 900999999);
  check('…disjoint for centuries and exact (below PocketBase\'s field limit and 2^53)', PAYJS.invFloor('live', Date.UTC(2226, 0, 1)) < 500000000000000 && PAYJS.invFloor('test', Date.UTC(2226, 0, 1)) < 999999999999999 && Number.isSafeInteger(PAYJS.invFloor('test', Date.UTC(2226, 0, 1))));
  check('next number = max(database last + 1, ledger mark + 1, clock floor): an older database cannot bring a number back', PAYJS.pickInv('live', fl + 50, 0, t0) === fl + 51 && PAYJS.pickInv('live', fl - 900, fl + 77, t0) === fl + 78 && PAYJS.pickInv('live', 0, 0, t0) === fl && PAYJS.pickInv('test', 900000003, 0, t0) === ft);
  check('…and a clock set back is covered by the database and the ledger (never a smaller number)', PAYJS.pickInv('live', fl + 5, fl + 9, t0 - 86400000) === fl + 10);

  // ---- the game address after Robokassa (PRIME_GAME_URL)
  const g = (x: string) => PAYJS.normalizeGameUrl(x);
  const urls: [string, string][] = [
    ['https://primetimeshowdown.online', 'https://primetimeshowdown.online/'],
    ['https://primetimeshowdown.online/', 'https://primetimeshowdown.online/'],
    ['http://localhost:4173', 'http://localhost:4173/'],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'],
    ['https://aertonik.github.io/PRIME-TIME-SHOWDOWN', 'https://aertonik.github.io/PRIME-TIME-SHOWDOWN/'],
    ['https://example.test/game/index.html', 'https://example.test/game/index.html'],
    ['https://example.test/?build=staging#x', 'https://example.test/?build=staging'],
    ['  https://primetimeshowdown.online/  ', 'https://primetimeshowdown.online/'],
    ['http://192.168.1.5:4173/', ''],
    ['http://primetimeshowdown.online/', ''],
    ['javascript:alert(1)', ''],
    ['https://evil.example/"><script>', ''],
    ['', ''],
  ];
  const wrong = urls.filter(([a, b]) => g(a) !== b);
  check('PRIME_GAME_URL: https anywhere, http only for this computer; «/» added after a bare host or folder; #fragment dropped; anything else refused', wrong.length === 0, wrong.map((w) => w[0] + ' → ' + g(w[0])).join(' | '));
  const pubs: [string, string][] = [
    ['https://primetime-showdown-staging.duckdns.org', 'https://primetime-showdown-staging.duckdns.org'],
    [' https://Staging.Example.test:8443/ ', 'https://staging.example.test:8443'],
    ['https://xn--80ak6aa92e.xn--p1ai', 'https://xn--80ak6aa92e.xn--p1ai'],
    ['http://primetime-showdown-staging.duckdns.org', ''],
    ['http://127.0.0.1:8091', ''],
    ['https://127.0.0.1:8091', ''],
    ['https://10.0.0.5', ''],
    ['https://[::1]:8091', ''],
    ['https://localhost:8091', ''],
    ['https://staging.localhost', ''],
    ['https://staging', ''],
    ['https://staging.example.test/api', ''],
    ['https://user@staging.example.test', ''],
    ['https://staging.example.test?x=1', ''],
    ['https://evil.example/"><script>', ''],
    ['', ''],
  ];
  const wrongPub = pubs.filter(([a, b]) => PAYJS.publicOrigin(a) !== b);
  check('PRIME_PAY_RELAY_PUBLIC_URL (the player\'s way back to staging): an https DNS name only — never http, an IP address, localhost, a path, a user name or a query', wrongPub.length === 0, wrongPub.map((w) => w[0] + ' → ' + PAYJS.publicOrigin(w[0])).join(' | '));
  check('invoice ranges name their environment before any signature: demo ≥ 700 000 000 000 000, test ≥ 500 000 000 000 000, live ≥ 10 000 000 000; the first scheme: test 900 000 001…, live 1 000 001…', PAYJS.envOfInv(PAYJS.invFloor('demo', Date.now())) === 'demo' && PAYJS.envOfInv(PAYJS.invFloor('test', Date.now())) === 'test' && PAYJS.envOfInv(PAYJS.invFloor('live', Date.now())) === 'live' && PAYJS.envOfInv(900000001) === 'test' && PAYJS.envOfInv(1000001) === 'live' && PAYJS.envOfInv(0) === '' && PAYJS.invFloor('test', Date.UTC(2226, 0, 1)) < PAYJS.INV_SCHEME.base.demo && PAYJS.invFloor('demo', Date.UTC(2226, 0, 1)) <= 999999999999999);
  const sha = (t: string) => crypto.createHash('sha256').update(t, 'utf8').digest('hex');
  check('the stand-in terms are hashed from their own text (staging: revision 9001, the demonstration: 9002) — neither is an offer (no page)', sha(OFFERS.TEST_OFFER_TEXT) === OFFERS.TEST_OFFER.sha256 && sha(OFFERS.DEMO_OFFER_TEXT) === OFFERS.DEMO_OFFER.sha256 && OFFERS.DEMO_OFFER.revision === 9002 && OFFERS.DEMO_OFFER.url === '' && realRules().demo.offer.sha256 === OFFERS.DEMO_OFFER.sha256);
  const rnames = Object.keys(realRules().catalog).map((k: string) => PAYJS.receiptName(k));
  check('every receipt name (server rules) survives Robokassa\'s Description rule unchanged and fits 100 characters (what the buyer sees = what the receipt says)', rnames.length === 7 && rnames.every((n: string) => RK.description(n) === n && n.length <= 100 && /PRIME TIME: SHOWDOWN$/.test(n)), rnames.join(' | '));
}

// ======================================================================== safety
function safetyChecks(): void {
  section('Безопасность: секреты, эмулятор и инструменты администратора вне игры');
  const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? walk(path.join(dir, e.name)) : /\.ts$/.test(e.name) ? [path.join(dir, e.name)] : []));
  const src = walk('src').map((f) => [f, read(f)] as const);
  const leaks = src.filter(([, t]) => /ROBOKASSA_|PASSWORD_1|PASSWORD_2|Password3|prime-shop |PRIME_PAY_MODE/.test(t)).map(([f]) => f);
  check('the game\'s code never names a Robokassa secret, the payment mode or the admin command', leaks.length === 0, leaks.join());
  const sig = src.filter(([, t]) => /md5|sha512|SignatureValue\s*=|createHmac/.test(t) && !/net\/sha256\.ts$/.test('')).map(([f]) => f).filter((f) => !/net\/(sha256|pow|cloudSave)\.ts$/.test(f));
  check('the game never computes a payment signature (only the server does)', sig.every((f) => !/resultBase|paymentBase|Password/.test(read(f))), sig.join());
  check('no VITE_* setting carries anything about payments', !fs.readdirSync(ROOT).filter((f: string) => f.startsWith('.env')).some((f: string) => /ROBOKASSA|PAY/i.test(read(f))));
  const pay = read('backend/pb_hooks/lib/payments.js');
  check('server: the passwords are read only from the environment, never logged or returned (publicConfig has none)', !/logger\(\)\.\w+\([^)]*\bp[123]\b/.test(pay) && !/console\.log\([^)]*\bp[123]\b/.test(pay) && /function publicConfig/.test(pay) && !/p1:|p2:|p3:/.test(pay.slice(pay.indexOf('function publicConfig'), pay.indexOf('function shopEnv'))));
  check('server: a test server refuses to hold the live passwords and the other way round; no fallback to another mode', /live_secrets_on_test_server/.test(pay) && /test_secrets_on_live_server/.test(pay) && /test_on_production/.test(pay) && /live_outside_production/.test(pay));
  check('server: the local payment-page emulator is honoured only on a dev server and only on 127.0.0.1', /r === 'dev' && \/\^http:\\\/\\\/127\\\.0\\\.0\\\.1:/.test(pay));
  const dist = path.join(ROOT, 'dist', 'assets');
  if (fs.existsSync(dist)) {
    const js = fs.readdirSync(dist).filter((f: string) => f.endsWith('.js')).map((f: string) => fs.readFileSync(path.join(dist, f), 'utf8') as string).join('\n');
    const bad2 = ['ROBOKASSA_', 'PRIME_PAY_', 'prime-shop refund', 'refund-done', 'robokassaEmulator', 'Эмулятор', '127.0.0.1:1919', 'checkoutpreview', 'shopgrant', '__game', ...SECRETS].filter((s) => js.includes(s));
    check('production build (dist/): no secret, no payment emulator, no admin tool, no test preview', bad2.length === 0, bad2.join());
    check('production build: the only payment address is Robokassa\'s official page', js.includes('https://auth.robokassa.ru/Merchant/Index.aspx') && !/http:\/\/127\.0\.0\.1:\\d/.test(js));
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, 'dist', 'index.html'), 'utf8'))?.[1] ?? '';
    check('production build: the page may send forms ONLY to Robokassa (CSP form-action https://auth.robokassa.ru; the dev-only emulator address is not there)', /form-action https:\/\/auth\.robokassa\.ru(;|$)/.test(csp) && !/form-action[^;]*127\.0\.0\.1/.test(csp), csp.slice(-80));
  } else check('production build present for the check (run npm run build first)', false);
}

// ======================================================================== server
let pb: any = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-payments-check-'));
const dataDir = path.join(work, 'pb_data');
const hooksDir = path.join(work, 'pb_hooks');

function testHooks(rules: Record<string, unknown> | null): void {
  fs.rmSync(hooksDir, { recursive: true, force: true });
  fs.cpSync(HOOKS, hooksDir, { recursive: true });
  if (rules) fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(rules, null, 2)};\n`);
}
const TEST_ENV = { PRIME_SERVER_ROLE: 'dev', PRIME_PAY_MODE: 'test', ROBOKASSA_MERCHANT_LOGIN: LOGIN, ROBOKASSA_HASH_ALGORITHM: 'sha256', ROBOKASSA_TEST_PASSWORD_1: TEST_P1, ROBOKASSA_TEST_PASSWORD_2: TEST_P2, PRIME_SHOP_SALES: 'open' };
const LIVE_ENV = { PRIME_SERVER_ROLE: 'production', PRIME_PAY_MODE: 'live', ROBOKASSA_MERCHANT_LOGIN: LOGIN, ROBOKASSA_HASH_ALGORITHM: 'md5', ROBOKASSA_PASSWORD_1: LIVE_P1, ROBOKASSA_PASSWORD_2: LIVE_P2, ROBOKASSA_PASSWORD_3: LIVE_P3, PRIME_SHOP_SALES: 'open', ROBOKASSA_RECEIPT: 'on' };
const CLEAN = Object.fromEntries(['PRIME_SERVER_ROLE', 'PRIME_PAY_MODE', 'ROBOKASSA_MERCHANT_LOGIN', 'ROBOKASSA_HASH_ALGORITHM', 'ROBOKASSA_TEST_PASSWORD_1', 'ROBOKASSA_TEST_PASSWORD_2', 'ROBOKASSA_PASSWORD_1', 'ROBOKASSA_PASSWORD_2', 'ROBOKASSA_PASSWORD_3', 'PRIME_SHOP_SALES', 'PRIME_PAY_DEV_GATEWAY', 'ROBOKASSA_RESULT_IPS', 'ROBOKASSA_RECEIPT', 'PRIME_PAY_REFUND_API', 'PRIME_DEMO_UNTIL', 'PRIME_PAY_RELAY_URL', 'PRIME_PAY_RELAY_PUBLIC_URL'].map((k) => [k, '']));

async function startPb(env: Record<string, string>): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { ...CLEAN, PRIME_REGISTRATION: 'disabled', PRIME_GAME_URL: GAME, PRIME_SESSIONS: 'off', ...env }, args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'] });
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
function sqlite(sql: string, db = 'data.db'): string {
  const r = cp.spawnSync('/usr/bin/sqlite3', [path.join(dataDir, db), sql], { encoding: 'utf8' });
  return String(r.stdout).trim();
}
/** The server's own log (PocketBase keeps it in auxiliary.db, written in batches): the «prime-pay» lines. */
async function payLog(): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const t = sqlite("select message||' '||data from _logs where message like 'prime-pay%' order by created;", 'auxiliary.db');
    if (t) return t;
    await new Promise((r) => setTimeout(r, 200));
  }
  return '';
}
/** A line matching `re` in the server's console output since `from` (bootstrap lines may come a moment late). */
async function waitLog(re: RegExp, from: number): Promise<boolean> {
  for (let i = 0; i < 25; i++) {
    if (pbLog.slice(from).some((l) => re.test(l))) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}
async function http(method: string, u: string, token = '', body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + u, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
/** Robokassa's notification, as a form POST (or GET with ?query). */
async function notify(fields: Record<string, string>, method: 'POST' | 'GET' = 'POST'): Promise<{ status: number; text: string }> {
  const qs = new URLSearchParams(fields).toString();
  const r =
    method === 'POST'
      ? await fetch(API + '/api/prime/pay/robokassa/result', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: qs })
      : await fetch(API + '/api/prime/pay/robokassa/result?' + qs);
  return { status: r.status, text: await r.text() };
}
function signedNote(inv: number | string, sum: string, shp: string, pw = TEST_P2, alg = 'sha256', extra: Record<string, string> = {}): Record<string, string> {
  const SignatureValue = (H as any)[alg](RK.resultBase(sum, String(inv), pw, [['Shp_order', shp]])).toUpperCase();
  return { OutSum: sum, InvId: String(inv), SignatureValue, Shp_order: shp, Fee: '0.40', EMail: 'buyer@payments.test', PaymentMethod: 'BankCard', IncCurrLabel: 'BankCardPSR', ...extra };
}
const realRules = (): any => {
  const m = { exports: {} as any };
  new Function('module', read('backend/pb_hooks/lib/shop_rules.js'))(m);
  return m.exports;
};
const OFFER_H = crypto.createHash('sha256').update('payments-check offer 1').digest('hex');
function rulesWith(o: { seasonEnded?: boolean; live?: boolean; testPrice?: number }): any {
  const r = JSON.parse(JSON.stringify(realRules()));
  if (o.seasonEnded) r.seasons.fighter_lucien.end = '2026-01-01T00:00:00Z';
  if (o.live) {
    r.prices = { skin_ray_neon_runner: 149, skin_bruno_casino_boss: 149, fx_prime_broadcast: 79, fx_phantom_dash: 79, fx_golden_confetti: 99, fx_vhs_card_frame: 49.5, fighter_lucien: 199 };
    r.salesOpen = true;
    r.offers = [{ revision: 1, title: 'Тестовая оферта', url: 'https://primetimeshowdown.online/legal/ru/offer-test.html', effectiveFrom: '2026-01-01', sha256: OFFER_H }];
  }
  if (o.testPrice) for (const k of Object.keys(r.test.prices)) r.test.prices[k] = o.testPrice;
  return r;
}

async function serverChecks(): Promise<void> {
  section('Сервер PRIME NETWORK: заказы, ResultURL, выдача (временная база, тестовый режим, роль dev)');
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  const SU = { email: 'payments-admin@payments.test', pw: rnd() };
  testHooks(rulesWith({ seasonEnded: true }));
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  await startPb(TEST_ENV);
  const su = (await http('POST', '/api/collections/_superusers/auth-with-password', '', { identity: SU.email, password: SU.pw })).j.token as string;
  // the migration's rate limit for Robokassa's notifications — then the limits relaxed for this check only
  // (every request of the check comes from one address, far faster than a person)
  const strict = (await http('GET', '/api/settings', su)).j.rateLimits;
  check('migration: a rate limit for /api/prime/pay/ (120 a minute); the shop limit stays', strict.rules.some((r: any) => r.label === '/api/prime/pay/' && r.maxRequests === 120) && strict.rules.some((r: any) => r.label === '/api/prime/shop/'));
  await http('PATCH', '/api/settings', su, { rateLimits: { enabled: true, rules: strict.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const cfg = (await http('GET', '/api/prime/config')).j;
  check('the server tells the game it has PRIME PAYMENTS (config shop.payments = 1)', cfg.shop?.checkout === 1 && cfg.shop?.payments === 1);
  check('the public config carries the catalog\'s truth: selling, the mode, the OFFICIAL prices (RAY 99 ₽; LUCIEN not approved) apart from what a test payment asks (10 ₽)', cfg.shop.selling === true && cfg.shop.env === 'test' && cfg.shop.prices.skin_ray_neon_runner === 9900 && cfg.shop.prices.fighter_lucien === null && cfg.shop.charge.skin_ray_neon_runner === 1000 && cfg.shop.charge.fighter_lucien === 1000 && cfg.shop.demoUntil === '', JSON.stringify(cfg.shop));
  check('the start log names the role and the payment mode — and no password', pbLog.some((l) => /PRIME: server role dev, payments test \(Robokassa, sha256\)/.test(l)) && !pbLog.some((l) => SECRETS.some((s) => l.includes(s))));
  const cols = (await http('GET', '/api/collections?perPage=200', su)).j.items as any[];
  const col = (n: string) => cols.find((c) => c.name === n);
  check('migration: shop_orders, shop_entitlements, shop_payment_events exist without ANY API rule', ['shop_orders', 'shop_entitlements', 'shop_payment_events'].every((n) => col(n) && ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'].every((k) => col(n)[k] === null)));
  check('migration: unique InvId, one open order per account/item/environment, one right per order, one active right per account/item/environment', /UNIQUE.*idx_shop_orders_inv/.test(col('shop_orders').indexes.join()) && /UNIQUE.*idx_shop_orders_open.*pending_payment/.test(col('shop_orders').indexes.join()) && /UNIQUE.*idx_shop_ent_order/.test(col('shop_entitlements').indexes.join()) && /UNIQUE.*idx_shop_ent_active.*active/.test(col('shop_entitlements').indexes.join()));
  const pw = 'Payments' + crypto.randomBytes(6).toString('hex');
  const mk = async (email: string, verified = true, docs = true) => {
    const u = (await http('POST', '/api/collections/users/records', su, { email, password: pw, passwordConfirm: pw, verified })).j;
    await http('POST', '/api/collections/profiles/records', su, { user: u.id, nickname: email.split('@')[0].replace(/[^A-Za-z0-9_]/g, '').slice(0, 16), nicknameKey: email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 16) });
    if (docs) {
      for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
      await http('POST', '/api/collections/consents/records', su, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    }
    const tok = (await http('POST', '/api/collections/users/auth-with-password', '', { identity: email, password: pw })).j.token as string;
    return { id: u.id as string, tok, email };
  };
  const A = await mk('buyera@payments.test');
  const B = await mk('buyerb@payments.test');
  const U = await mk('unverified@payments.test', false);
  const TERMS = (await http('GET', '/api/prime/shop/offer')).j.offer;
  check('test mode: the terms are the stand-in TEST terms (revision 9001, no document)', TERMS?.revision === 9001 && TERMS.url === '' && /Тестовые условия/.test(TERMS.title));
  const st0 = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('status: env test, payments on, sales on, server prices in kopecks (10 ₽ = 1000), nothing owned, no open order', st0.env === 'test' && st0.payments === true && st0.sales === true && st0.prices.skin_ray_neon_runner === 1000 && st0.owned.length === 0 && st0.orders.length === 0);

  // ---------------------------------------------------------------- orders
  section('Заказы: доступ, цена, согласие, идемпотентность');
  check('1. a guest (no session) cannot create an order (401)', (await http('POST', '/api/prime/shop/checkout', '', { sku: 'skin_ray_neon_runner' })).status === 401);
  check('2. an unconfirmed PRIME ID cannot (403 not_verified)', (await http('POST', '/api/prime/shop/checkout', U.tok, { sku: 'skin_ray_neon_runner' })).j.code === 'not_verified');
  check('3. an unknown sku is refused (404 unknown_item)', (await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_gold_free' })).status === 404);
  const c0 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  check('10. the terms not accepted → offer_consent_required, no order', c0.j.code === 'offer_consent_required' && sqlite('select count(*) from shop_orders;') === '0');
  await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  await http('POST', '/api/prime/shop/offer/accept', B.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  const c1 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner', priceRub: 1, priceKop: 1, amountKop: 1, user: B.id, accountId: B.id, status: 'paid' });
  const o1 = c1.j.order;
  const f1 = c1.j.payment?.fields ?? {};
  check('4–6. order made: the SERVER price (1000 kopecks), owner = the session (not «user»/«accountId» of the request), status pending_payment', c1.status === 200 && o1.amountKop === 1000 && o1.status === 'pending_payment' && sqlite(`select user from shop_orders where invId=${o1.inv};`) === A.id);
  check('order: a test invoice number of the final scheme (500 000 000 000 000 + clock), RUB, environment test, the receipt name kept', o1.inv >= PAYJS.invFloor('test', Date.now() - 60000) && o1.inv <= PAYJS.invFloor('test', Date.now()) + 100 && o1.currency === 'RUB' && o1.env === 'test' && o1.title === 'Цифровой облик бойца RAY: NEON RUNNER для игры PRIME TIME: SHOWDOWN', String(o1.inv));
  const ledgerDir = path.join(work, 'prime-ledger', 'test');
  const lrec = JSON.parse(fs.existsSync(path.join(ledgerDir, `${o1.inv}.json`)) ? fs.readFileSync(path.join(ledgerDir, `${o1.inv}.json`), 'utf8') : '{}');
  check('the invoice number is reserved OUTSIDE the database first (prime-ledger next to pb_data): the order\'s id, the buyer, the amount; the mark', lrec.order === sqlite(`select id from shop_orders where invId=${o1.inv};`) && lrec.user === A.id && lrec.kop === 1000 && lrec.paid === null && Number(fs.readFileSync(path.join(ledgerDir, 'mark'), 'utf8')) >= o1.inv);
  const orderId = sqlite(`select id from shop_orders where invId=${o1.inv};`);
  check('payment page: Robokassa\'s address, IsTest=1, OutSum 10.00, Shp_order = the order, SignatureValue with the TEST Password#1', c1.j.payment.url === 'https://auth.robokassa.ru/Merchant/Index.aspx' && f1.IsTest === '1' && f1.OutSum === '10.00' && f1.Shp_order === orderId && f1.SignatureValue === H.sha256(`${LOGIN}:10.00:${o1.inv}:${TEST_P1}:Shp_order=${orderId}`));
  check('the payment page names the item exactly as the order and the receipt will (Description = the receipt name, unchanged by Robokassa\'s character rule)', f1.Description === o1.title && f1.Description === PAYJS.receiptName('skin_ray_neon_runner'), f1.Description);
  check('the answer carries no password and no internal order field', !JSON.stringify(c1.j).includes(TEST_P1) && !JSON.stringify(c1.j).includes(TEST_P2) && !('opKey' in o1) && !('user' in o1));
  const c2 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  const par = await Promise.all(Array.from({ length: 8 }, () => http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' })));
  check('11. «Купить» again and 8 parallel taps → the SAME order (same InvId, same signature), one row', c2.j.order.inv === o1.inv && c2.j.reused === true && par.every((r) => r.status === 200 && r.j.order.inv === o1.inv && r.j.payment.fields.SignatureValue === f1.SignatureValue) && sqlite(`select count(*) from shop_orders where user='${A.id}';`) === '1');
  const stA = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('status lists the open order (to pay or to check later)', stA.orders.length === 1 && stA.orders[0].inv === o1.inv);
  check('another account cannot see the order (404), lists none', (await http('GET', `/api/prime/shop/orders/${o1.inv}`, B.tok)).status === 404 && (await http('GET', '/api/prime/shop/purchases', B.tok)).j.orders.length === 0);
  const apiTries = [
    await http('GET', '/api/collections/shop_orders/records', A.tok),
    await http('POST', '/api/collections/shop_orders/records', A.tok, { user: A.id, invId: 5, env: 'test', sku: 'skin_ray_neon_runner', amountKop: 1, status: 'paid' }),
    await http('PATCH', `/api/collections/shop_orders/records/${orderId}`, A.tok, { status: 'paid', amountKop: 1 }),
    await http('DELETE', `/api/collections/shop_orders/records/${orderId}`, A.tok),
    await http('POST', '/api/collections/shop_entitlements/records', A.tok, { user: A.id, sku: 'skin_ray_neon_runner', env: 'test', status: 'active', source: 'purchase' }),
    await http('GET', '/api/collections/shop_entitlements/records', A.tok),
    await http('GET', '/api/collections/shop_payment_events/records', A.tok),
  ];
  check(`players cannot read, create, change or delete orders / rights / the trail through the API (${apiTries.map((r) => r.status).join(',')})`, apiTries.every((r) => r.status >= 400) && sqlite(`select status from shop_orders where id='${orderId}';`) === 'pending_payment');

  // ---------------------------------------------------------------- ResultURL
  section('ResultURL: подпись, сумма, повторы');
  const bad = [
    await notify({ ...signedNote(o1.inv, '10.000000', orderId), SignatureValue: 'F'.repeat(64) }),
    await notify(signedNote(o1.inv, '10.000000', orderId, TEST_P1)),
    await notify(signedNote(o1.inv, '10.000000', orderId, LIVE_P2)),
    await notify(signedNote(o1.inv, '10.000000', orderId, TEST_P2, 'md5')),
    await notify({ ...signedNote(o1.inv, '10.000000', orderId), OutSum: '1.000000' }),
    await notify({ ...signedNote(o1.inv, '10.000000', orderId), InvId: String(o1.inv + 1) }),
    await notify({ ...signedNote(o1.inv, '10.000000', orderId), Shp_order: 'otherorder12345' }),
    await notify(signedNote(o1.inv, '10.000000', orderId, TEST_P2, 'sha256', { IsTest: '0' })),
    await notify({ OutSum: '10.000000', InvId: String(o1.inv) }),
  ];
  check(`refused with 400, nothing paid: wrong signature, Password#1, live password, MD5, changed sum, changed InvId, changed Shp_order, IsTest=0, missing fields (${bad.map((r) => r.status).join(',')})`, bad.every((r) => r.status === 400 && !r.text.startsWith('OK')) && sqlite(`select status from shop_orders where id='${orderId}';`) === 'pending_payment' && sqlite('select count(*) from shop_entitlements;') === '0');
  const plog = await payLog();
  check('the server log explains the misconfiguration (algorithm:md5, password1) without any secret', /notification refused/.test(plog) && /algorithm:md5/.test(plog) && /password1/.test(plog) && !SECRETS.some((x) => plog.includes(x)), plog.slice(0, 300));
  check('refusals are in the order\'s trail', Number(sqlite(`select count(*) from shop_payment_events where "order"='${orderId}' and kind='result_refused';`)) >= 7);
  const succ = await fetch(`${API}/api/prime/pay/robokassa/success?OutSum=10.000000&InvId=${o1.inv}&SignatureValue=${'A'.repeat(64)}&Shp_order=${orderId}`, { redirect: 'manual' });
  const failR = await fetch(`${API}/api/prime/pay/robokassa/fail`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `OutSum=10.00&InvId=${o1.inv}`, redirect: 'manual' });
  check('SuccessURL / FailURL: 303 back to the game (PRIME_GAME_URL) with the order number — and nothing paid or granted (a forged SuccessURL opens nothing)', succ.status === 303 && succ.headers.get('location') === `${GAME}?prime_pay=success&inv=${o1.inv}` && failR.status === 303 && failR.headers.get('location') === `${GAME}?prime_pay=fail&inv=${o1.inv}` && sqlite(`select status from shop_orders where id='${orderId}';`) === 'pending_payment' && sqlite('select count(*) from shop_entitlements;') === '0');
  const evil = await fetch(`${API}/api/prime/pay/robokassa/success?InvId=1&next=https://evil.example`, { redirect: 'manual' });
  check('the way back never follows an address from the request (no open redirect)', evil.headers.get('location') === `${GAME}?prime_pay=success&inv=1`);
  const ok1 = await notify(signedNote(o1.inv, '10.000000', orderId));
  const ent1 = sqlite(`select user||'|'||sku||'|'||env||'|'||status||'|'||source from shop_entitlements where "order"='${orderId}';`);
  check('a valid notification → «OK<InvId>»; order fulfilled; one active right for the buyer (test environment)', ok1.status === 200 && ok1.text === `OK${o1.inv}` && sqlite(`select status||'|'||paidSum||'|'||paidVia from shop_orders where id='${orderId}';`) === 'fulfilled|10.000000|result' && ent1 === `${A.id}|skin_ray_neon_runner|test|active|purchase`);
  check('no email and no card data stored with the order (only method, fee and the exact OutSum)', !sqlite(`select * from shop_orders where id='${orderId}';`).includes('buyer@payments.test') && sqlite(`select paymentMethod||'|'||fee from shop_orders where id='${orderId}';`) === 'BankCard|0.40');
  const again = await Promise.all([notify(signedNote(o1.inv, '10.000000', orderId)), notify(signedNote(o1.inv, '10.000000', orderId), 'GET'), notify(signedNote(o1.inv, '10.000000', orderId))]);
  check('repeated notifications (POST and GET) → «OK…» again, no second right, the history intact', again.every((r) => r.status === 200 && r.text === `OK${o1.inv}`) && sqlite('select count(*) from shop_entitlements;') === '1' && sqlite(`select status from shop_orders where id='${orderId}';`) === 'fulfilled');
  const pA = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  const pA2 = (await http('GET', '/api/prime/shop/purchases', (await http('POST', '/api/collections/users/auth-with-password', '', { identity: A.email, password: pw })).j.token)).j;
  check('the buyer\'s PRIME ID owns it — the same on another sign-in (another browser / device)', pA.owned.join() === 'skin_ray_neon_runner' && pA2.owned.join() === 'skin_ray_neon_runner' && pA.orders[0].status === 'fulfilled');
  check('another PRIME ID owns nothing of it', (await http('GET', '/api/prime/shop/purchases', B.tok)).j.owned.length === 0);
  check('7. an owned item is not sold again (409 owned)', (await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' })).j.code === 'owned');

  // two notifications at exactly the same time (a second order)
  const c3 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_phantom_dash' });
  const id3 = sqlite(`select id from shop_orders where invId=${c3.j.order.inv};`);
  const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => notify(signedNote(c3.j.order.inv, i % 2 ? '10.00' : '10.000000', id3), i % 3 === 2 ? 'GET' : 'POST')));
  check(`six simultaneous notifications (both OutSum formats, POST and GET) → all «OK», exactly one right (${sqlite(`select count(*) from shop_entitlements where "order"='${id3}';`)})`, burst.every((r) => r.status === 200 && r.text === `OK${c3.j.order.inv}`) && sqlite(`select count(*) from shop_entitlements where "order"='${id3}';`) === '1' && sqlite(`select status from shop_orders where id='${id3}';`) === 'fulfilled');

  // a validly signed notification with another amount → review, nothing granted
  const c4 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_golden_confetti' });
  const id4 = sqlite(`select id from shop_orders where invId=${c4.j.order.inv};`);
  const r4 = await notify(signedNote(c4.j.order.inv, '20.000000', id4));
  check('a VALID notification with another amount → recorded for review (requires_review, amount_mismatch), nothing granted', r4.status === 200 && sqlite(`select status||'|'||reviewReason from shop_orders where id='${id4}';`) === 'requires_review|amount_mismatch' && sqlite(`select count(*) from shop_entitlements where "order"='${id4}';`) === '0');

  // a valid notification for an invoice this database does not know
  const orphan = await notify(signedNote(900009999, '10.000000', 'nosuchorder0000'));
  check('a valid notification for an unknown invoice → not «OK», noted once for the administrator, nothing granted', orphan.status === 404 && sqlite("select count(*) from shop_payment_events where kind='result_orphan';") === '1');

  // ---------------------------------------------------------------- expiry, late payment, double payment
  section('Истёкшие заказы, поздняя оплата, двойная оплата');
  const c5 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'fx_vhs_card_frame' });
  const id5 = sqlite(`select id from shop_orders where invId=${c5.j.order.inv};`);
  await http('PATCH', `/api/collections/shop_orders/records/${id5}`, su, { expiresAt: Date.now() - 3600 * 1000 });
  const house = cli(TEST_ENV, 'prime-shop', 'reconcile');
  check('12. an unpaid order past its time is closed by the housekeeping (expired)', /expired 1/.test(house) && sqlite(`select status from shop_orders where id='${id5}';`) === 'expired', house.slice(0, 200));
  const c6 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'fx_vhs_card_frame' });
  check('…the next «Купить» makes a NEW order (a new InvId) — a stuck order never blocks the player', c6.status === 200 && c6.j.order.inv !== c5.j.order.inv && c6.j.reused === false);
  const late = await notify(signedNote(c5.j.order.inv, '10.000000', id5));
  check('a late, verified payment of the expired order (the tab was closed, the notification came later) → delivered, «OK»', late.text === `OK${c5.j.order.inv}` && sqlite(`select status||'|'||paidVia from shop_orders where id='${id5}';`) === 'fulfilled|result' && (await http('GET', '/api/prime/shop/purchases', B.tok)).j.owned.includes('fx_vhs_card_frame'));
  const id6 = sqlite(`select id from shop_orders where invId=${c6.j.order.inv};`);
  const dbl = await notify(signedNote(c6.j.order.inv, '10.000000', id6));
  check('the second order paid too (a double payment) → «OK», kept for review (already_owned) — no duplicate right; the administrator refunds', dbl.text === `OK${c6.j.order.inv}` && sqlite(`select status||'|'||reviewReason from shop_orders where id='${id6}';`) === 'requires_review|already_owned' && sqlite(`select count(*) from shop_entitlements where user='${B.id}' and sku='fx_vhs_card_frame' and status='active';`) === '1');

  // ---------------------------------------------------------------- failures and restarts
  section('Сбои: ошибка записи выдачи, перезапуск, повтор');
  const c7 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'fx_prime_broadcast' });
  const id7 = sqlite(`select id from shop_orders where invId=${c7.j.order.inv};`);
  // a database failure exactly at the delivery step: a required field the server does not fill
  const entCol = (await http('GET', '/api/collections/shop_entitlements', su)).j;
  await http('PATCH', '/api/collections/shop_entitlements', su, { fields: [...entCol.fields, { name: 'faultprobe', type: 'text', required: true }] });
  const f7 = await notify(signedNote(c7.j.order.inv, '10.000000', id7));
  check('delivery fails (a database error) → the payment alone is kept (paid), «OK» — nothing is lost', f7.text === `OK${c7.j.order.inv}` && sqlite(`select status from shop_orders where id='${id7}';`) === 'paid' && sqlite(`select count(*) from shop_entitlements where "order"='${id7}';`) === '0');
  const f7b = await notify(signedNote(c7.j.order.inv, '10.000000', id7));
  check('the repeated notification while delivery still fails → «OK», still paid, no partial right', f7b.text === `OK${c7.j.order.inv}` && sqlite(`select status from shop_orders where id='${id7}';`) === 'paid');
  await http('PATCH', '/api/collections/shop_entitlements', su, { fields: entCol.fields });
  await stopPb();
  await startPb(TEST_ENV);
  check('after a server restart the paid order is delivered by itself (the start-up check) — no new notification needed', sqlite(`select status from shop_orders where id='${id7}';`) === 'fulfilled' && sqlite(`select count(*) from shop_entitlements where "order"='${id7}' and status='active';`) === '1');
  // the order page delivers too
  const c8 = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: 'skin_bruno_casino_boss' });
  const id8 = sqlite(`select id from shop_orders where invId=${c8.j.order.inv};`);
  await http('PATCH', '/api/collections/shop_entitlements', su, { fields: [...entCol.fields, { name: 'faultprobe', type: 'text', required: true }] });
  await notify(signedNote(c8.j.order.inv, '10.000000', id8));
  await http('PATCH', '/api/collections/shop_entitlements', su, { fields: entCol.fields });
  const os8 = (await http('GET', `/api/prime/shop/orders/${c8.j.order.inv}`, B.tok)).j;
  check('…or when the player\'s game asks for the order (the purchase window stays honest: fulfilled only now)', os8.order?.status === 'fulfilled' && os8.owned.includes('skin_bruno_casino_boss'));

  // ---------------------------------------------------------------- LUCIEN
  section('Люсьен: сезон, жетоны, платное открытие');
  const C = await mk('lucienpaid@payments.test');
  const D = await mk('lucientoken@payments.test');
  for (const x of [C, D]) await http('POST', '/api/prime/shop/offer/accept', x.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  const def = JSON.parse(JSON.stringify(defaultSave()));
  // LUCIEN opened in the event's exchange: the fighter, the event's purchase record and the spent tokens together
  const tokenSave = JSON.parse(JSON.stringify(def));
  tokenSave.fighters.lucien.unlocked = true;
  tokenSave.events = { ...(tokenSave.events ?? {}), 'halloween-2026': { tokens: 0, earned: 500, spent: 500, quests: {}, bought: [], fighters: [{ id: 'lucien', at: Date.parse('2026-10-25T12:00:00Z') }], grandClaimed: false, day: '', dayTokens: 0 } };
  const putSave = async (who: { tok: string }, data: any, base: number) => {
    const text = JSON.stringify(data);
    return http('PUT', '/api/prime/save', who.tok, { base, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), op: 'op_' + rnd(8).replace(/[^A-Za-z0-9]/g, 'x'), device: 'payments-check', reason: 'sync', client: 'payments-check' });
  };
  const dPut = await putSave(D, tokenSave, 0);
  check('(set-up) a player who opened LUCIEN for PUMPKIN TOKENS has him in the cloud save', dPut.status === 200, JSON.stringify(dPut.j).slice(0, 200));
  check('LUCIEN opened for tokens → never sold (409 owned)', (await http('POST', '/api/prime/shop/checkout', D.tok, { sku: 'fighter_lucien' })).j.code === 'owned');
  const cl = await http('POST', '/api/prime/shop/checkout', C.tok, { sku: 'fighter_lucien' });
  const idL = sqlite(`select id from shop_orders where invId=${cl.j.order?.inv};`);
  const okL = await notify(signedNote(cl.j.order.inv, '10.000000', idL));
  check('after his season: LUCIEN paid → the fighter right (kind fighter), «OK»', okL.text === `OK${cl.j.order.inv}` && sqlite(`select kind||'|'||item||'|'||status from shop_entitlements where "order"='${idL}';`) === 'fighter|lucien|active');
  const selSave = JSON.parse(JSON.stringify(def));
  selSave.selected = 'lucien';
  const cPut = await putSave(C, selSave, 0);
  const bPut = await putSave(B, selSave, 0);
  check('the paid LUCIEN may be the selected fighter in the cloud save (the purchase itself is NOT in the save); without the purchase the same save is refused', cPut.status === 200 && bPut.status === 400 && /selected/.test(JSON.stringify(bPut.j)), `${cPut.status} ${bPut.status}`);
  const forged = JSON.parse(JSON.stringify(def));
  forged.cosmetics = { ...forged.cosmetics, owned: [...(forged.cosmetics?.owned ?? []), 'dash_prime_phantom'] };
  check('a forged save listing a PRIME SHOP item as owned is refused by the server', (await putSave(B, forged, 0)).status === 400);

  // ---------------------------------------------------------------- refunds
  section('Возвраты и отзыв права');
  const notYet = cli(TEST_ENV, 'prime-shop', 'refund', String(c3.j.order.inv), 'reason=player asked');
  check('refund started → refund_pending; the item is NOT revoked yet (the money is not back yet)', /refund_pending/.test(notYet) && sqlite(`select status from shop_orders where id='${id3}';`) === 'refund_pending' && sqlite(`select status from shop_entitlements where "order"='${id3}';`) === 'active', notYet.slice(0, 200));
  check('a repeated notification during the refund changes nothing', (await notify(signedNote(c3.j.order.inv, '10.000000', id3))).text === `OK${c3.j.order.inv}` && sqlite(`select status from shop_orders where id='${id3}';`) === 'refund_pending');
  const done = cli(TEST_ENV, 'prime-shop', 'refund-done', String(c3.j.order.inv));
  const ownedA = (await http('GET', '/api/prime/shop/purchases', A.tok)).j.owned;
  check('refund confirmed → refunded; ONLY this order\'s right revoked (PHANTOM DASH gone, NEON RUNNER stays)', /refunded/.test(done) && sqlite(`select status from shop_orders where id='${id3}';`) === 'refunded' && sqlite(`select status||'|'||revokeReason from shop_entitlements where "order"='${id3}';`) === 'revoked|refunded' && ownedA.includes('skin_ray_neon_runner') && !ownedA.includes('fx_phantom_dash'));
  check('a refunded order cannot be refunded or paid again', /nothing to refund/.test(cli(TEST_ENV, 'prime-shop', 'refund', String(c3.j.order.inv), 'reason=x')) && (await notify(signedNote(c3.j.order.inv, '10.000000', id3))).text === `OK${c3.j.order.inv}` && sqlite(`select status from shop_orders where id='${id3}';`) === 'refunded');
  cli(TEST_ENV, 'prime-shop', 'refund', String(c1.j.order.inv), 'reason=test');
  const back = cli(TEST_ENV, 'prime-shop', 'refund-failed', String(c1.j.order.inv));
  check('a refund that did not happen → the order is back to fulfilled, the item stays', /back as it was/.test(back) && sqlite(`select status from shop_orders where id='${orderId}';`) === 'fulfilled' && sqlite(`select status from shop_entitlements where "order"='${orderId}';`) === 'active');
  // independent rights: LUCIEN for tokens in the save + (made up for the check) a paid LUCIEN order → refund
  const fakeOrder = (await http('POST', '/api/collections/shop_orders/records', su, { user: D.id, invId: 900000500, env: 'test', provider: 'robokassa', sku: 'fighter_lucien', item: 'lucien', kind: 'fighter', title: 'LUCIEN', amountKop: 1000, currency: 'RUB', status: 'fulfilled', hashAlg: 'sha256', expiresAt: Date.now() })).j;
  await http('POST', '/api/collections/shop_entitlements/records', su, { user: D.id, sku: 'fighter_lucien', item: 'lucien', kind: 'fighter', order: fakeOrder.id, source: 'purchase', env: 'test', status: 'active', grantedAt: Date.now() });
  const dSaveBefore = sqlite(`select hash from saves where owner='${D.id}';`);
  cli(TEST_ENV, 'prime-shop', 'refund', '900000500', 'reason=check');
  cli(TEST_ENV, 'prime-shop', 'refund-done', '900000500');
  check('refunding a paid LUCIEN never touches LUCIEN opened for tokens (the save is unchanged; only the paid right is revoked)', sqlite(`select hash from saves where owner='${D.id}';`) === dSaveBefore && dSaveBefore !== '' && sqlite(`select status from shop_entitlements where "order"='${fakeOrder.id}';`) === 'revoked' && sqlite(`select data from saves where owner='${D.id}';`).includes('"lucien":{"unlocked":true'));
  const rv = cli(TEST_ENV, 'prime-shop', 'review', String(c4.j.order.inv), 'deliver');
  check('an order under review is decided only by the administrator\'s console command (deliver)', /delivered/.test(rv) && sqlite(`select status from shop_orders where id='${id4}';`) === 'fulfilled' && sqlite(`select source from shop_entitlements where "order"='${id4}';`) === 'support');

  // ---------------------------------------------------------------- account deletion and export
  section('Удаление PRIME ID, выгрузка данных');
  const E = await mk('deleteme@payments.test');
  await http('POST', '/api/prime/shop/offer/accept', E.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  const e1 = await http('POST', '/api/prime/shop/checkout', E.tok, { sku: 'fx_golden_confetti' });
  const idE1 = sqlite(`select id from shop_orders where invId=${e1.j.order.inv};`);
  await notify(signedNote(e1.j.order.inv, '10.000000', idE1));
  const e2 = await http('POST', '/api/prime/shop/checkout', E.tok, { sku: 'fx_prime_broadcast' });
  const idE2 = sqlite(`select id from shop_orders where invId=${e2.j.order.inv};`);
  const exp = (await http('GET', '/api/prime/account/export', E.tok)).j;
  check('«Мои данные» lists the account\'s orders and rights (no card data)', exp.purchases?.orders?.length === 2 && exp.purchases.rights.length === 1 && exp.purchases.rights[0].sku === 'fx_golden_confetti');
  const del = await http('POST', '/api/prime/account/delete', E.tok, { confirm: 'DELETE', password: pw });
  check('deleting the PRIME ID: the rights go with it; the orders stay without the link to the person; the open one is closed', del.status === 200 && sqlite(`select count(*) from shop_entitlements where user='${E.id}';`) === '0' && sqlite(`select user||'|'||status from shop_orders where id='${idE1}';`) === '|fulfilled' && sqlite(`select user||'|'||status from shop_orders where id='${idE2}';`) === '|canceled', JSON.stringify(del.j));
  const lateE = await notify(signedNote(e2.j.order.inv, '10.000000', idE2));
  check('a payment that still arrives for a deleted account → kept for review (account_deleted), «OK», nothing granted', lateE.text === `OK${e2.j.order.inv}` && sqlite(`select status||'|'||reviewReason from shop_orders where id='${idE2}';`) === 'requires_review|account_deleted');
  const ledgerKnowsE = fs.readdirSync(ledgerDir).filter((f: string) => f.endsWith('.json')).some((f: string) => fs.readFileSync(path.join(ledgerDir, f), 'utf8').includes(E.id));
  const recE1 = JSON.parse(fs.readFileSync(path.join(ledgerDir, `${e1.j.order.inv}.json`), 'utf8'));
  check('…the invoice ledger forgets the deleted account too: its records stay (number, amount, payment), without the account id', !ledgerKnowsE && recE1.user === '' && recE1.paid !== null && recE1.kop === 1000);

  // ---------------------------------------------------------------- the console command
  section('Команда администратора');
  const self = cli(TEST_ENV, 'prime-shop', 'selftest');
  const want = [
    'md5    ' + H.md5(RK.resultBase('100.000000', '450009', 'test-password-2', [['Shp_login', 'Vasya'], ['Shp_oplata', '1']])),
    'sha256 ' + H.sha256(RK.paymentBase('demo', '149.00', 900000001, '', 'test-password-1', [['Shp_order', 'abc123def456ghi']])),
    'sha512 ' + H.sha512(RK.opStateBase('demo', '1000001', 'test-password-2')),
    'hs256  ' + RK.refundToken({ OpKey: 'demo-op-key', RefundSum: 10 }, 'test-password-3', hmacHex),
  ];
  check('`prime-shop selftest`: PocketBase\'s md5 / sha256 / sha512 / HMAC give exactly Node\'s signatures (the same code on the server)', want.every((w) => self.includes(w)), self.slice(0, 300));
  const status = cli(TEST_ENV, 'prime-shop', 'status');
  check('`prime-shop status`: role, mode, algorithm, counts — and not a single password', /role: dev/.test(status) && /mode: test/.test(status) && /algorithm: sha256/.test(status) && !SECRETS.some((s) => status.includes(s)));
  const one = cli(TEST_ENV, 'prime-shop', 'order', String(o1.inv));
  check('`prime-shop order`: the order, its trail and its right, without email', /fulfilled/.test(one) && /order_created/.test(one) && /right: skin_ray_neon_runner active/.test(one) && !one.includes('buyer@payments.test'));
  const ledgerCli = cli(TEST_ENV, 'prime-shop', 'ledger');
  check('`prime-shop ledger`: the ledger folder, its mark against the database\'s last number, the next number, paid orders missing in the database (none)', /ledger: \S*prime-ledger\/test/.test(ledgerCli) && /mark: \d+, database last: \d+, next: \d+/.test(ledgerCli) && /orders in the ledger: \d+, paid: \d+/.test(ledgerCli) && /paid but missing in the database: 0/.test(ledgerCli), ledgerCli.slice(0, 300));

  // ---------------------------------------------------------------- an older backup restored
  section('Восстановление старой копии (backup.sh → restore.sh): номера счетов не повторяются, оплаты и возвраты не теряются');
  const F = await mk('restore@payments.test');
  await http('POST', '/api/prime/shop/offer/accept', F.tok, { revision: TERMS.revision, sha256: TERMS.sha256 });
  const ordersBefore = sqlite('select count(*) from shop_orders;');
  fs.chmodSync(ledgerDir, 0o500);
  const noLedger = await http('POST', '/api/prime/shop/checkout', F.tok, { sku: 'fx_golden_confetti' });
  fs.chmodSync(ledgerDir, 0o700);
  check('the ledger cannot be written → no order, no payment page (503 ledger_unavailable): a number is never signed unreserved', noLedger.status === 503 && noLedger.j.code === 'ledger_unavailable' && !noLedger.j.payment && sqlite('select count(*) from shop_orders;') === ordersBefore, JSON.stringify(noLedger.j).slice(0, 200));
  const fr1 = await http('POST', '/api/prime/shop/checkout', F.tok, { sku: 'fx_golden_confetti' });
  const idF1 = sqlite(`select id from shop_orders where invId=${fr1.j.order.inv};`);
  await notify(signedNote(fr1.j.order.inv, '10.000000', idF1));
  const usersBefore = sqlite('select count(*) from users;');
  const savesBefore = sqlite('select count(*) from saves;');
  const bkDir = path.join(work, 'backups');
  const bsh = cp.spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'linux', 'backup.sh')], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: dataDir, PRIME_BACKUP_DIR: bkDir, PRIME_BACKUP_KEEP: '3', PRIME_BACKUP_AGE_RECIPIENT: '', PRIME_BACKUP_UPLOAD_CMD: '' } });
  const archive = path.join(bkDir, (fs.existsSync(bkDir) ? fs.readdirSync(bkDir) : []).find((f: string) => f.endsWith('.tar.gz')) ?? 'none');
  const inArchive = String(cp.spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' }).stdout);
  check('backup.sh while the server runs: the archive holds the invoice ledger (mark + order files) and counts the orders', bsh.status === 0 && /заказов \d+/.test(bsh.stdout) && /prime-ledger\/test\/mark/.test(inArchive) && inArchive.includes(`prime-ledger/test/${fr1.j.order.inv}.json`), (bsh.stdout + bsh.stderr).slice(-300));
  const bcheck = (extra: Record<string, string>) => cp.spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'linux', 'backup-check.sh')], { encoding: 'utf8', env: { ...proc.env, PRIME_BACKUP_DIR: bkDir, PRIME_DATA_DIR: dataDir, PRIME_ENV_FILE: path.join(work, 'no-such.env'), PRIME_BACKUP_AGE_RECIPIENT: '', PRIME_BACKUP_UPLOAD_CMD: '', ...extra } });
  const bc1 = bcheck({});
  check('backup-check.sh (read-only): fresh, unpacks, sums + SQLite integrity, accounts against the live base, the ledger inside — and the honest problem «no encrypted copy outside the server» (exit 1)', bc1.status === 1 && /OK: свежая копия/.test(bc1.stdout) && /OK: копия читается/.test(bc1.stdout) && /сейчас в базе: аккаунтов \d+/.test(bc1.stdout) && /OK: журнал счетов в копии/.test(bc1.stdout) && /нет PRIME_BACKUP_AGE_RECIPIENT/.test(bc1.stderr), (bc1.stdout + bc1.stderr).slice(-400));
  fs.writeFileSync(archive + '.age', 'FAKE-AGE');
  const bc2 = bcheck({ PRIME_BACKUP_AGE_RECIPIENT: 'age1testrecipient', PRIME_BACKUP_UPLOAD_CMD: 'true' });
  const bc3 = bcheck({ PRIME_BACKUP_AGE_RECIPIENT: 'age1testrecipient', PRIME_BACKUP_UPLOAD_CMD: 'true', PRIME_BACKUP_MAX_AGE_H: '-1' });
  fs.rmSync(archive + '.age');
  check('…with an encrypted copy and its upload configured → exit 0; a copy older than allowed → a problem (exit 1)', bc2.status === 0 && /резервные копии в порядке/.test(bc2.stdout) && bc3.status === 1 && /последней копии/.test(bc3.stderr), (bc2.stdout + bc2.stderr + bc3.stderr).slice(-400));
  // after the copy: a paid order (F2), an open one (F3), the refund of an older one (F1)
  const f2 = await http('POST', '/api/prime/shop/checkout', F.tok, { sku: 'fx_prime_broadcast' });
  const idF2 = sqlite(`select id from shop_orders where invId=${f2.j.order.inv};`);
  await notify(signedNote(f2.j.order.inv, '10.000000', idF2));
  const f3 = await http('POST', '/api/prime/shop/checkout', F.tok, { sku: 'fx_phantom_dash' });
  const idF3 = sqlite(`select id from shop_orders where invId=${f3.j.order.inv};`);
  cli(TEST_ENV, 'prime-shop', 'refund', String(fr1.j.order.inv), 'reason=restore drill');
  cli(TEST_ENV, 'prime-shop', 'refund-done', String(fr1.j.order.inv));
  const markBefore = Number(fs.readFileSync(path.join(ledgerDir, 'mark'), 'utf8'));
  check('(set-up) after the copy: F2 paid and delivered, F3 open, F1 refunded; the mark covers them', sqlite(`select status from shop_orders where id='${idF2}';`) === 'fulfilled' && sqlite(`select status from shop_orders where id='${idF3}';`) === 'pending_payment' && sqlite(`select status from shop_orders where id='${idF1}';`) === 'refunded' && markBefore >= f3.j.order.inv);
  await stopPb();
  const rsh = cp.spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'linux', 'restore.sh'), archive], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: dataDir, PRIME_RESTORE_SKIP_SERVICE: '1', PRIME_RESTORE_YES: '1', PRIME_ENV_FILE: path.join(work, 'no-such.env') } });
  check('restore.sh: the older database is back (F2, F3 unknown to it, F1 not refunded in it), the counts shown — the ledger MERGED, its mark not lowered', rsh.status === 0 && /Журнал счетов объединён/.test(rsh.stdout) && /Сейчас на сервере: аккаунтов/.test(rsh.stdout) && sqlite(`select count(*) from shop_orders where id in ('${idF2}','${idF3}');`) === '0' && sqlite(`select status from shop_orders where id='${idF1}';`) === 'fulfilled' && Number(fs.readFileSync(path.join(ledgerDir, 'mark'), 'utf8')) === markBefore && fs.existsSync(path.join(ledgerDir, `${f3.j.order.inv}.json`)), (rsh.stdout + rsh.stderr).slice(-400));
  const fromRestore = pbLog.length;
  await startPb(TEST_ENV);
  const reapplied = await waitLog(/invoice ledger re-applied — orders rebuilt 1, delivered 1, refunds 1, problems 0/, fromRestore);
  const ownF = (await http('GET', '/api/prime/shop/purchases', F.tok)).j.owned as string[];
  check('the first start after the restore re-applies the ledger by itself: F2 rebuilt with its id and delivered, F1 refunded again (its right revoked)', reapplied && sqlite(`select status from shop_orders where id='${idF2}';`) === 'fulfilled' && sqlite(`select status from shop_entitlements where "order"='${idF2}';`) === 'active' && sqlite(`select status from shop_orders where id='${idF1}';`) === 'refunded' && sqlite(`select status||'|'||revokeReason from shop_entitlements where "order"='${idF1}';`) === 'revoked|refunded' && ownF.includes('fx_prime_broadcast') && !ownF.includes('fx_golden_confetti'), pbLog.slice(fromRestore).filter((l) => /ledger/.test(l)).join(' | '));
  const forged3 = await notify(signedNote(f3.j.order.inv, '10.000000', 'zzzzzzzzzzzzzzz'));
  const wrongSum3 = await notify(signedNote(f3.j.order.inv, '149.000000', idF3));
  check('a notification for a number the database lost, but with another Shp_order or another amount → not rebuilt, not «OK» (orphan for the administrator)', forged3.status === 404 && wrongSum3.status === 404 && sqlite(`select count(*) from shop_orders where invId=${f3.j.order.inv};`) === '0');
  const paid3 = await notify(signedNote(f3.j.order.inv, '10.000000', idF3));
  check('the payment of F3 (opened after the copy) → the order rebuilt from the ledger with its id, «OK», delivered to its buyer', paid3.text === `OK${f3.j.order.inv}` && sqlite(`select status||'|'||user from shop_orders where id='${idF3}';`) === `fulfilled|${F.id}` && /restored/.test(sqlite(`select group_concat(kind) from shop_payment_events where "order"='${idF3}';`)) && ((await http('GET', '/api/prime/shop/purchases', F.tok)).j.owned as string[]).includes('fx_phantom_dash'));
  const high = PAYJS.invFloor('test', Date.now()) + 1000000;
  fs.writeFileSync(path.join(ledgerDir, 'mark'), `${high}\n`);
  const f4 = await http('POST', '/api/prime/shop/checkout', F.tok, { sku: 'fx_vhs_card_frame' });
  check('the next order: a NEW number above everything issued before — the ledger mark wins even over the clock (mark + 1)', f4.status === 200 && f4.j.order.inv === high + 1 && f4.j.order.inv > markBefore, String(f4.j.order?.inv));
  check('accounts and saves are exactly as before the restore (none lost)', sqlite('select count(*) from users;') === usersBefore && sqlite('select count(*) from saves;') === savesBefore);
  const recover2 = cli(TEST_ENV, 'prime-shop', 'recover');
  check('`prime-shop recover` again changes nothing (re-applying the ledger is idempotent)', /rebuilt 0, delivered 0, refunds re-applied 0, problems 0/.test(recover2), recover2.slice(0, 200));
  await stopPb();

  // ---------------------------------------------------------------- environments
  section('Окружения: тест никогда не владеет в production, ошибки настройки → оплаты нет');
  const off = async (env: Record<string, string>, label: string, problem: string) => {
    const from = pbLog.length;
    await startPb(env);
    const s = (await http('GET', '/api/prime/shop/status', A.tok)).j;
    const n = await notify(signedNote(o1.inv, '10.000000', orderId));
    const logged = pbLog.slice(from).some((l) => l.includes('payments off') && l.includes(problem));
    await stopPb();
    check(`${label} → no payments (status payments=false, notifications 503), the reason «${problem}» in the start log`, s.payments === false && n.status === 503 && logged);
  };
  await off({ ...TEST_ENV, PRIME_SERVER_ROLE: 'production' }, 'test mode on a production server', 'test_on_production');
  await off({ ...TEST_ENV, PRIME_SERVER_ROLE: '' }, 'test mode without a server role (= production)', 'test_on_production');
  await off({ ...TEST_ENV, ROBOKASSA_PASSWORD_1: LIVE_P1 }, 'test mode with a LIVE password present', 'live_secrets_on_test_server');
  await off({ ...TEST_ENV, ROBOKASSA_TEST_PASSWORD_2: '' }, 'test mode without the test Password#2', 'passwords_missing');
  await off({ ...TEST_ENV, ROBOKASSA_HASH_ALGORITHM: '' }, 'no signature algorithm configured (never assumed)', 'algorithm_missing');
  await off({ ...TEST_ENV, ROBOKASSA_HASH_ALGORITHM: 'ripemd160' }, 'an algorithm the server cannot compute', 'algorithm_unsupported');
  await off({ ...TEST_ENV, ROBOKASSA_TEST_PASSWORD_2: TEST_P1 }, 'Password#1 = Password#2', 'passwords_equal');
  await off({ ...LIVE_ENV, PRIME_SERVER_ROLE: 'staging' }, 'live mode outside production', 'live_outside_production');
  await off({ ...LIVE_ENV, ROBOKASSA_TEST_PASSWORD_1: TEST_P1 }, 'live mode with a test password present', 'test_secrets_on_live_server');
  await off({ ...TEST_ENV, PRIME_PAY_MODE: 'testing' }, 'a misspelt mode', 'mode_unknown');
  const markFile = path.join(ledgerDir, 'mark');
  const markText = fs.readFileSync(markFile, 'utf8');
  fs.writeFileSync(markFile, 'damaged\n');
  await off(TEST_ENV, 'an unreadable invoice ledger (damaged mark) — never a guessed number', 'ledger_unavailable');
  fs.writeFileSync(markFile, markText);

  // ---- «Receipt» switched on (test mode, IsTest=1 — no money): the form, the signature, the payment, the right
  section('Чек: Receipt в тестовом режиме (IsTest=1)');
  // (ROBOKASSA_RECEIPT_OBJECT is no setting any more: a stray value changes nothing)
  await startPb({ ...TEST_ENV, ROBOKASSA_RECEIPT: 'on', ROBOKASSA_RECEIPT_OBJECT: 'goods' });
  const stB = (await http('GET', '/api/prime/shop/status', B.tok)).j;
  const rcSku = ['fx_golden_confetti', 'fx_vhs_card_frame', 'fx_phantom_dash', 'fx_prime_broadcast', 'skin_bruno_casino_boss', 'skin_ray_neon_runner'].find((k) => !stB.owned.includes(k) && !(stB.orders ?? []).some((o: any) => o.sku === k && o.status === 'pending_payment'))!;
  const cR = await http('POST', '/api/prime/shop/checkout', B.tok, { sku: rcSku, priceKop: 1, amountKop: 1, Receipt: 'forged' });
  const oR = cR.j.order;
  const fR = cR.j.payment?.fields ?? {};
  const jR = fR.Receipt ? JSON.parse(decodeURIComponent(fR.Receipt)) : null;
  const idR = oR ? sqlite(`select id from shop_orders where invId=${oR.inv};`) : '';
  check('order with the Receipt: one item {name = the order\'s receipt name, quantity 1, sum = the SERVER sum (= OutSum = the order\'s kopecks), tax none} and nothing else', cR.status === 200 && !!jR && jR.items.length === 1 && Object.keys(jR).join() === 'items' && Object.keys(jR.items[0]).join() === 'name,quantity,sum,tax' && jR.items[0].name === oR.title && oR.title === PAYJS.receiptName(rcSku) && jR.items[0].quantity === 1 && jR.items[0].sum === Number(fR.OutSum) && Math.round(jR.items[0].sum * 100) === oR.amountKop && jR.items[0].tax === 'none', JSON.stringify({ status: cR.status, j: cR.j?.code, jR }));
  check('…signed with the TEST Password#1 over "login:OutSum:InvId:Receipt:Password#1:Shp_order=…", IsTest=1; the request\'s own «Receipt» and price are ignored', fR.IsTest === '1' && fR.SignatureValue === H.sha256(`${LOGIN}:${fR.OutSum}:${oR.inv}:${fR.Receipt}:${TEST_P1}:Shp_order=${idR}`) && fR.Receipt !== 'forged' && !JSON.stringify(cR.j).includes(TEST_P1));
  check('…no right before the payment is confirmed', !(await http('GET', '/api/prime/shop/status', B.tok)).j.owned.includes(rcSku));
  const nR = await notify(signedNote(oR.inv, fR.OutSum, idR));
  const afterR = (await http('GET', '/api/prime/shop/status', B.tok)).j;
  check('…the signed test notification (IsTest=1, Password#2, no Receipt in it) confirms it: «OK{InvId}», the item is granted once', nR.status === 200 && nR.text === `OK${oR.inv}` && afterR.owned.includes(rcSku) && sqlite(`select count(*) from shop_entitlements where sku='${rcSku}' and status='active' and env='test' and user='${B.id}';`) === '1');
  check('…a repeated notification grants nothing more', (await notify(signedNote(oR.inv, fR.OutSum, idR))).text === `OK${oR.inv}` && sqlite(`select count(*) from shop_entitlements where sku='${rcSku}' and user='${B.id}';`) === '1');
  // (LUCIEN and the real rules: the nomenclature check above and «the real 1.8.8 rules on a live production server» below)
  await stopPb();

  // the way back from Robokassa with an incomplete or wrong PRIME_GAME_URL: never a blank page
  const backWith = async (env: Record<string, string>, kind: 'success' | 'fail' = 'success', inv: number = o1.inv) => {
    const from = pbLog.length;
    await startPb(env);
    const r = await fetch(API + `/api/prime/pay/robokassa/${kind}?InvId=${inv}`, { redirect: 'manual' });
    const out = { status: r.status, location: r.headers.get('location') ?? '', html: await r.text(), warned: pbLog.slice(from).some((l) => /PRIME WARNING: PRIME_GAME_URL is INVALID/.test(l)) };
    await stopPb();
    return out;
  };
  const noSlash = await backWith({ ...TEST_ENV, PRIME_GAME_URL: 'http://localhost:5173' });
  check('PRIME_GAME_URL without the final «/» (http://localhost:5173) → 303 to http://localhost:5173/?prime_pay=success&inv=…', noSlash.status === 303 && noSlash.location === `http://localhost:5173/?prime_pay=success&inv=${o1.inv}`, noSlash.location);
  const badDev = await backWith({ ...TEST_ENV, PRIME_GAME_URL: 'http://192.168.1.20:5173' });
  check('a wrong PRIME_GAME_URL (plain http to a network address) → the PRIME return page (200, never blank), no button to a guessed address, the hint; a warning at start', badDev.status === 200 && /Проверяем оплату/.test(badDev.html) && !/class="btn"/.test(badDev.html) && /PRIME_GAME_URL/.test(badDev.html) && badDev.html.includes(`№${o1.inv}`) && badDev.warned);
  // (production's own invoice — a test-range one is staging's and has its own way back)
  const prodInv = PAYJS.invFloor('live', Date.now());
  const badProd = await backWith({ PRIME_SERVER_ROLE: 'production', PRIME_GAME_URL: 'primetimeshowdown.online' }, 'success', prodInv);
  check('…on a production server the return page\'s button leads to the official game https://primetimeshowdown.online/?prime_pay=success&inv=…', badProd.status === 200 && badProd.html.includes(`href="https://primetimeshowdown.online/?prime_pay=success&amp;inv=${prodInv}"`) && /Вернуться в игру/.test(badProd.html));
  const failNone = await backWith({ ...TEST_ENV, PRIME_GAME_URL: '' }, 'fail');
  check('FailURL without any PRIME_GAME_URL → «Оплата не завершена», nothing promised (the order can be paid again from the game)', failNone.status === 200 && /Оплата не завершена/.test(failNone.html) && /предмет не выдан/.test(failNone.html) && !/class="btn"/.test(failNone.html));

  // the SAME database on a production server: the test rights do not exist there
  testHooks(rulesWith({ live: true }));
  await startPb({ PRIME_SERVER_ROLE: 'production', PRIME_SHOP_SALES: 'open' });
  const prodA = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  const prodSt = (await http('GET', '/api/prime/shop/status', A.tok)).j;
  check('17.3 the same database on a PRODUCTION server: every test right counts for nothing (owned = [])', prodA.owned.length === 0 && prodSt.owned.length === 0 && prodA.env === 'live');
  const prodCfg = (await http('GET', '/api/prime/config')).j.shop;
  check('…its public config: env live, the approved prices (149 ₽ = 14900 kopecks), selling = false (payments not set up) — the catalog promises nothing', prodCfg.env === 'live' && prodCfg.selling === false && prodCfg.prices.skin_ray_neon_runner === 14900, JSON.stringify(prodCfg));
  await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: 1, sha256: OFFER_H });
  const prodC = (await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' })).j;
  check('…payments off there (no mode set): every check passes, then payments_unavailable with the REAL price (14900) — no order', prodC.code === 'payments_unavailable' && prodC.quote?.priceKop === 14900 && prodC.quote.env === 'live' && sqlite("select count(*) from shop_orders where env='live';") === '0');
  await stopPb();
  await startPb(LIVE_ENV);
  const lv = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'skin_ray_neon_runner' });
  const idLv = sqlite(`select id from shop_orders where invId=${lv.j.order?.inv};`);
  const lvRc = lv.j.payment?.fields?.Receipt ? JSON.parse(decodeURIComponent(lv.j.payment.fields.Receipt)) : null;
  check('live mode on production (ROBOKASSA_RECEIPT=on): the real price (149 ₽ = 14900 kopecks), a LIVE invoice number (10 000 000 000 + clock), no IsTest, the Receipt (149, tax none), MD5 with the live Password#1 over "login:OutSum:InvId:Receipt:Password#1:Shp_order"', lv.status === 200 && lv.j.order.amountKop === 14900 && lv.j.order.inv >= PAYJS.invFloor('live', Date.now() - 60000) && lv.j.order.inv < 500000000000000 && lv.j.order.env === 'live' && !('IsTest' in lv.j.payment.fields) && lvRc?.items[0].sum === 149 && lvRc.items[0].tax === 'none' && lv.j.payment.fields.SignatureValue === H.md5(`${LOGIN}:149.00:${lv.j.order.inv}:${lv.j.payment.fields.Receipt}:${LIVE_P1}:Shp_order=${idLv}`), JSON.stringify(lv.j).slice(0, 200));
  const vhs = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_vhs_card_frame' });
  check('a price with kopecks (49.50 ₽) is exact: 4950 kopecks, OutSum "49.50"', vhs.j.order?.amountKop === 4950 && vhs.j.payment.fields.OutSum === '49.50');
  const testOnLive = await notify(signedNote(lv.j.order.inv, '149.00', idLv, TEST_P2, 'md5', { IsTest: '1' }));
  const testFlagLive = await notify(signedNote(lv.j.order.inv, '149.000000', idLv, LIVE_P2, 'md5', { IsTest: '1' }));
  check('a TEST notification on production (test password, IsTest=1) is refused; even a live signature with IsTest=1 is refused', testOnLive.status === 400 && testFlagLive.status === 400 && sqlite(`select status from shop_orders where id='${idLv}';`) === 'pending_payment');
  const liveOk = await notify(signedNote(lv.j.order.inv, '149.000000', idLv, LIVE_P2, 'md5'));
  check('a live notification (MD5, live Password#2, "149.000000") → «OK<InvId>», a LIVE right', liveOk.text === `OK${lv.j.order.inv}` && sqlite(`select env||'|'||status from shop_entitlements where "order"='${idLv}';`) === 'live|active' && (await http('GET', '/api/prime/shop/purchases', A.tok)).j.owned.join() === 'skin_ray_neon_runner');
  const idVhs = sqlite(`select id from shop_orders where invId=${vhs.j.order.inv};`);
  await notify(signedNote(vhs.j.order.inv, '49.500000', idVhs, LIVE_P2, 'md5'));
  check('a live payment of 49.50 ₽ ("49.500000") → a live right', sqlite(`select env||'|'||status from shop_entitlements where "order"='${idVhs}';`) === 'live|active');
  const held = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_golden_confetti' });
  const idHeld = sqlite(`select id from shop_orders where invId=${held.j.order?.inv};`);
  check('(set-up) a live order left waiting for its payment', held.status === 200 && !!idHeld && sqlite(`select status from shop_orders where id='${idHeld}';`) === 'pending_payment', JSON.stringify(held.j).slice(0, 160));
  await stopPb();
  // fail closed: LIVE without ROBOKASSA_RECEIPT=on makes no order and no payment page; what exists goes on
  section('LIVE без Receipt: новые заказы запрещены (receipt_required_for_live)');
  const liveOrders = sqlite("select count(*) from shop_orders where env='live';");
  for (const rcOff of ['', 'off']) {
    await startPb({ ...LIVE_ENV, ROBOKASSA_RECEIPT: rcOff });
    const noRc = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_phantom_dash' });
    const noRcAgain = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_golden_confetti' });
    check(`ROBOKASSA_RECEIPT=${rcOff || '(missing)'} in LIVE: a new order is refused on the server — 503 receipt_required_for_live, no payment page, no order, no invoice number`, noRc.status === 503 && noRc.j.code === 'receipt_required_for_live' && !noRc.j.payment && !noRc.j.order && sqlite("select count(*) from shop_orders where env='live';") === liveOrders, JSON.stringify(noRc.j).slice(0, 160));
    check('…nor a payment page for the order already waiting (it stays as it was)', noRcAgain.status === 503 && noRcAgain.j.code === 'receipt_required_for_live' && !noRcAgain.j.payment && sqlite(`select status from shop_orders where id='${idHeld}';`) === 'pending_payment');
    check('…the server\'s own diagnosis names it (prime-shop status)', /receipt: off — LIVE refuses new orders \(receipt_required_for_live\)/.test(cli({ ...LIVE_ENV, ROBOKASSA_RECEIPT: rcOff }, 'prime-shop', 'status')) && pbLog.some((l) => /PRIME WARNING: LIVE payments without ROBOKASSA_RECEIPT=on/.test(l)));
    await stopPb();
  }
  await startPb({ ...LIVE_ENV, ROBOKASSA_RECEIPT: '' });
  const heldOk = await notify(signedNote(held.j.order.inv, '99.000000', idHeld, LIVE_P2, 'md5'));
  check('…ResultURL is unchanged: the waiting order paid before the switch is confirmed — «OK{InvId}», a live right', heldOk.text === `OK${held.j.order.inv}` && sqlite(`select env||'|'||status from shop_entitlements where "order"='${idHeld}';`) === 'live|active', heldOk.text);
  await stopPb();
  // the shop's real setting is SHA256 (the runs above use MD5 on purpose: the algorithm follows the setting)
  section('LIVE + SHA256 + Receipt: форма и ResultURL (искусственные пароли)');
  await startPb({ ...LIVE_ENV, ROBOKASSA_HASH_ALGORITHM: 'sha256' });
  const s256 = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_phantom_dash' });
  const f256 = s256.j.payment?.fields ?? {};
  const id256 = sqlite(`select id from shop_orders where invId=${s256.j.order?.inv};`);
  const j256 = f256.Receipt ? JSON.parse(decodeURIComponent(f256.Receipt)) : null;
  const base256 = `${LOGIN}:79.00:${s256.j.order?.inv}:${f256.Receipt}:${LIVE_P1}:Shp_order=${id256}`;
  check('live + sha256: SignatureValue = SHA256("login:OutSum:InvId:Receipt:Password#1:Shp_order=…") with the LIVE Password#1, 64 hex; the Receipt in it is the form\'s own field, URL-encoded once; no IsTest', s256.status === 200 && f256.SignatureValue === H.sha256(base256) && /^[0-9a-f]{64}$/.test(f256.SignatureValue) && f256.SignatureValue !== H.md5(base256) && f256.OutSum === '79.00' && !('IsTest' in f256) && f256.Shp_order === id256 && f256.Receipt.startsWith('%7B%22items%22') && sqlite(`select hashAlg from shop_orders where id='${id256}';`) === 'sha256', JSON.stringify(s256.j).slice(0, 200));
  check('…its Receipt: one item {name = the order\'s receipt name, quantity 1, sum 79 = OutSum, tax none}', !!j256 && Object.keys(j256.items[0]).join() === 'name,quantity,sum,tax' && j256.items[0].name === s256.j.order.title && j256.items[0].sum === 79 && j256.items[0].tax === 'none');
  check('…sent as the browser sends it (POST, x-www-form-urlencoded): the Receipt arrives twice-encoded, one decoding gives the signed text', new URLSearchParams(new URLSearchParams(f256).toString()).get('Receipt') === f256.Receipt && new URLSearchParams(f256).toString().includes('Receipt=%257B%2522items%2522'));
  const bad256 = await notify(signedNote(s256.j.order.inv, '79.000000', id256, LIVE_P2, 'md5'));
  const ok256 = await notify(signedNote(s256.j.order.inv, '79.000000', id256, LIVE_P2, 'sha256'));
  check('…ResultURL with SHA256 (live Password#2, "79.000000", Shp_order): «OK{InvId}», a live right; an MD5 signature is refused', bad256.status === 400 && ok256.text === `OK${s256.j.order.inv}` && sqlite(`select env||'|'||status from shop_entitlements where "order"='${id256}';`) === 'live|active', `${bad256.status} ${ok256.text}`);
  await stopPb();
  // ---------------------------------------------------------------- 1.8.9: PRIME SHOP for every PRIME ID, real money
  section('PUBLIC LIVE: настоящие продажи для всех PRIME ID (правила этого релиза, SHA256, Receipt, искусственные пароли)');
  testHooks(null);
  const PUB_ENV = { ...LIVE_ENV, ROBOKASSA_HASH_ALGORITHM: 'sha256' };
  await startPb(PUB_ENV);
  const P = await mk('player@payments.test');
  const M = await mk('minor@payments.test', true, false);
  for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', su, { user: M.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
  await http('POST', '/api/collections/consents/records', su, { user: M.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '13-17' });
  const realCfg = (await http('GET', '/api/prime/config')).j.shop;
  const realPrices = { skin_ray_neon_runner: 9900, skin_bruno_casino_boss: 14900, fx_prime_broadcast: 4900, fx_phantom_dash: 4900, fx_golden_confetti: 4900, fx_vhs_card_frame: 4900, fighter_lucien: null };
  check('the release\'s own rules on a live production server (sales flag + PRIME_SHOP_SALES=open + Receipt): selling to everyone, env live, the approved prices = what is charged (RAY 99, BRUNO 149, four effects 49 ₽; LUCIEN none)', realCfg.selling === true && realCfg.env === 'live' && Object.entries(realPrices).every(([k, v]) => realCfg.prices[k] === v && realCfg.charge[k] === v), JSON.stringify(realCfg));
  const liveOffer = (await http('GET', '/api/prime/shop/offer', P.tok)).j.offer;
  check('…the terms are the published offer (revision 2, /legal/ru/offer.html, its SHA-256) — never the test 9001 or the demo 9002 stand-in', liveOffer?.revision === 2 && liveOffer.url === 'https://primetimeshowdown.online/legal/ru/offer.html' && liveOffer.sha256.startsWith('a8ae91f4'), JSON.stringify(liveOffer));
  const noConsent = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'fx_prime_broadcast' });
  check('an ordinary PRIME ID (verified, documents, 18+) without the offer accepted → offer_consent_required, no order', noConsent.status === 409 && noConsent.j.code === 'offer_consent_required' && noConsent.j.quote?.priceKop === 4900 && sqlite(`select count(*) from shop_orders where user='${P.id}';`) === '0');
  await http('POST', '/api/prime/shop/offer/accept', M.tok, { revision: liveOffer.revision, sha256: liveOffer.sha256 });
  const minor = await http('POST', '/api/prime/shop/checkout', M.tok, { sku: 'fx_prime_broadcast' });
  check('a PRIME ID declared «13-17» → 403 adult_only (the offer sells to adults only), no order', minor.status === 403 && minor.j.code === 'adult_only' && sqlite(`select count(*) from shop_orders where user='${M.id}';`) === '0');
  const acc = await http('POST', '/api/prime/shop/offer/accept', P.tok, { revision: liveOffer.revision, sha256: liveOffer.sha256 });
  check('…accepting the offer is recorded by the server (consents: shop_offer, revision 2, its hash)', acc.status === 200 && sqlite(`select count(*) from consents where user='${P.id}' and doc='shop_offer' and version=2 and docHash='${liveOffer.sha256}';`) === '1');
  const pb1 = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'fx_prime_broadcast', priceKop: 1, amountKop: 1, IsTest: '1', Receipt: 'forged' });
  const pf = pb1.j.payment?.fields ?? {};
  const pId = sqlite(`select id from shop_orders where invId=${pb1.j.order?.inv};`);
  const pRc = pf.Receipt ? JSON.parse(decodeURIComponent(pf.Receipt)) : null;
  check('…then a REAL order: 49 ₽ from the server catalog (the request\'s price / IsTest / Receipt ignored), a LIVE invoice number, env live, no IsTest', pb1.status === 200 && pb1.j.order.amountKop === 4900 && pf.OutSum === '49.00' && pb1.j.order.env === 'live' && pb1.j.order.inv >= PAYJS.invFloor('live', Date.now() - 60000) && pb1.j.order.inv < 500000000000000 && !('IsTest' in pf), JSON.stringify(pb1.j).slice(0, 200));
  check('…SHA256 over "login:49.00:InvId:Receipt:<LIVE Password#1>:Shp_order=…"; the Receipt is {name = the receipt name, quantity 1, sum 49, tax none}', pf.SignatureValue === H.sha256(`${LOGIN}:49.00:${pb1.j.order.inv}:${pf.Receipt}:${LIVE_P1}:Shp_order=${pId}`) && !!pRc && Object.keys(pRc.items[0]).join() === 'name,quantity,sum,tax' && pRc.items[0].sum === 49 && pRc.items[0].name === 'Цифровой предмет оформления PRIME BROADCAST для игры PRIME TIME: SHOWDOWN' && pRc.items[0].tax === 'none');
  const realLucien = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'fighter_lucien' });
  check('…LUCIEN is never sold for roubles (seasonal_only during his season, price_pending after it), no order', realLucien.status === 409 && ['seasonal_only', 'price_pending'].includes(realLucien.j.code) && sqlite(`select count(*) from shop_orders where sku='fighter_lucien' and env='live';`) === '0', realLucien.j.code);
  const pInv = pb1.j.order.inv;
  const pForged = [
    await notify(signedNote(pInv, '49.000000', pId, TEST_P2, 'sha256')),
    await notify({ ...signedNote(pInv, '49.000000', pId, LIVE_P2, 'sha256'), OutSum: '1.000000' }),
    await notify(signedNote(pInv, '49.000000', pId, LIVE_P2, 'sha256', { IsTest: '1' })),
    await notify(signedNote(pInv, '49.000000', 'abcdefghijklmno', LIVE_P2, 'sha256')),
    await notify({ ...signedNote(pInv, '49.000000', pId, LIVE_P2, 'sha256'), SignatureValue: '0'.repeat(64) }),
  ];
  const pSucc = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${pInv}&OutSum=49.00&Shp_order=${pId}&SignatureValue=${H.sha256(`49.00:${pInv}:${LIVE_P1}:Shp_order=${pId}`)}`, { redirect: 'manual' });
  check('forged ResultURLs (a test password, a changed sum, IsTest=1, another order, a broken signature) and SuccessURL grant nothing; the order still waits', pForged.every((r: any) => r.text !== `OK${pInv}`) && pSucc.status === 303 && sqlite(`select status from shop_orders where id='${pId}';`) === 'pending_payment' && sqlite(`select count(*) from shop_entitlements where user='${P.id}';`) === '0', pForged.map((r: any) => r.status).join(','));
  const okP = await notify(signedNote(pInv, '49.000000', pId, LIVE_P2, 'sha256'));
  const againP = await notify(signedNote(pInv, '49.000000', pId, LIVE_P2, 'sha256'));
  check('the signed live ResultURL (SHA256, live Password#2, "49.000000") → «OK{InvId}», one LIVE right; a repeated one → «OK», still one', okP.text === `OK${pInv}` && againP.text === `OK${pInv}` && sqlite(`select env||'|'||status||'|'||count(*) from shop_entitlements where user='${P.id}';`) === 'live|active|1');
  const relog = (await http('POST', '/api/collections/users/auth-with-password', '', { identity: P.email, password: pw })).j.token as string;
  check('…kept in the account: a new sign-in (another device) sees it owned; buying it again → 409 owned', (await http('GET', '/api/prime/shop/purchases', relog)).j.owned.includes('fx_prime_broadcast') && (await http('POST', '/api/prime/shop/checkout', relog, { sku: 'fx_prime_broadcast' })).j.code === 'owned');
  const pRay = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'skin_ray_neon_runner' });
  const rayId = sqlite(`select id from shop_orders where invId=${pRay.j.order?.inv};`);
  check('(set-up) a real order for RAY (99 ₽) left waiting for its payment', pRay.status === 200 && pRay.j.order.amountKop === 9900 && pRay.j.payment.fields.OutSum === '99.00');
  await stopPb();
  // the emergency switch: PRIME_SHOP_SALES=closed (a restart) — no new order; paid and waiting orders go on
  for (const closed of ['closed', '']) {
    await startPb({ ...PUB_ENV, PRIME_SHOP_SALES: closed });
    const cCfg = (await http('GET', '/api/prime/config')).j.shop;
    const cNew = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'fx_phantom_dash' });
    const cWait = await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'skin_ray_neon_runner' });
    check(`PRIME_SHOP_SALES=${closed || '(missing)'}: selling off at once, a new order → sales_closed, no payment page even for the waiting order — which stays as it was`, cCfg.selling === false && cNew.status === 409 && cNew.j.code === 'sales_closed' && !cNew.j.payment && cWait.j.code === 'sales_closed' && !cWait.j.payment && sqlite(`select status from shop_orders where id='${rayId}';`) === 'pending_payment' && sqlite(`select count(*) from shop_orders where user='${P.id}';`) === '2');
    await stopPb();
  }
  await startPb({ ...PUB_ENV, PRIME_SHOP_SALES: 'closed' });
  const rayOk = await notify(signedNote(pRay.j.order.inv, '99.000000', rayId, LIVE_P2, 'sha256'));
  check('…sales closed: the signed ResultURL of the order made before is still confirmed and delivered; the earlier right stays', rayOk.text === `OK${pRay.j.order.inv}` && (await http('GET', '/api/prime/shop/purchases', P.tok)).j.owned.sort().join() === 'fx_prime_broadcast,skin_ray_neon_runner');
  const rf = cli({ ...PUB_ENV, PRIME_SHOP_SALES: 'closed' }, 'prime-shop', 'refund', String(pRay.j.order.inv), 'reason=check');
  const rfDone = cli({ ...PUB_ENV, PRIME_SHOP_SALES: 'closed' }, 'prime-shop', 'refund-done', String(pRay.j.order.inv));
  check('…a live refund still works: refund_pending (manual, in the Robokassa cabinet) → refund-done → refunded, only that right revoked, the trail kept', /refund_pending/.test(rf) && sqlite(`select status from shop_orders where id='${rayId}';`) === 'refunded' && sqlite(`select status||'|'||revokeReason from shop_entitlements where "order"='${rayId}';`) === 'revoked|refunded' && (await http('GET', '/api/prime/shop/purchases', P.tok)).j.owned.join() === 'fx_prime_broadcast' && Number(sqlite(`select count(*) from shop_payment_events where "order"='${rayId}';`)) >= 4, rf + ' / ' + rfDone);
  await stopPb();
  await startPb({ ...PUB_ENV, ROBOKASSA_RECEIPT: '' });
  const noRcCfg = (await http('GET', '/api/prime/config')).j.shop;
  const noRcSt = (await http('GET', '/api/prime/shop/status', P.tok)).j;
  check('LIVE without ROBOKASSA_RECEIPT=on: the game is told nothing is on sale (selling false, payments false) — and the server refuses anyway', noRcCfg.selling === false && noRcSt.payments === false && (await http('POST', '/api/prime/shop/checkout', P.tok, { sku: 'fx_phantom_dash' })).j.code === 'receipt_required_for_live');
  await stopPb();
  await off({ ...PUB_ENV, ROBOKASSA_PASSWORD_2: '' }, 'LIVE without the live Password#2', 'passwords_missing');
  await off({ ...PUB_ENV, ROBOKASSA_HASH_ALGORITHM: '' }, 'LIVE without the signature algorithm', 'algorithm_missing');
  await off({ ...PUB_ENV, ROBOKASSA_MERCHANT_LOGIN: '' }, 'LIVE without the shop login', 'merchant_login_missing');
  // ---------------------------------------------------------------- the official site's demonstration
  section('Демонстрация на официальном сайте (PRIME_PAY_MODE=demo): тестовый режим Robokassa, свои заказы и права');
  const mskDay = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);
  const DEMO_ENV = { PRIME_SERVER_ROLE: 'production', PRIME_PAY_MODE: 'demo', PRIME_DEMO_UNTIL: mskDay(Date.now() + 30 * 86400000), ROBOKASSA_MERCHANT_LOGIN: LOGIN, ROBOKASSA_HASH_ALGORITHM: 'sha256', ROBOKASSA_TEST_PASSWORD_1: TEST_P1, ROBOKASSA_TEST_PASSWORD_2: TEST_P2, PRIME_SHOP_SALES: 'open' };
  await off({ ...DEMO_ENV, PRIME_DEMO_UNTIL: '' }, 'a demonstration without its last day (never open-ended)', 'demo_until_missing');
  await off({ ...DEMO_ENV, PRIME_DEMO_UNTIL: mskDay(Date.now() - 86400000) }, 'a demonstration past its last day', 'demo_expired');
  await off({ ...DEMO_ENV, PRIME_DEMO_UNTIL: mskDay(Date.now() + 120 * 86400000) }, 'a demonstration longer than 92 days', 'demo_until_too_far');
  await off({ ...DEMO_ENV, PRIME_DEMO_UNTIL: '2026-02-30' }, 'a demonstration day that does not exist', 'demo_until_invalid');
  await off({ ...DEMO_ENV, ROBOKASSA_PASSWORD_1: LIVE_P1 }, 'a demonstration with a LIVE password present (it can only ever sign test pages)', 'live_secrets_on_demo_server');
  await off({ ...TEST_ENV, PRIME_SERVER_ROLE: 'production' }, '…and plain test mode on production stays forbidden', 'test_on_production');
  testHooks(rulesWith({ seasonEnded: true }));
  const fromDemo = pbLog.length;
  await startPb(DEMO_ENV);
  const dcfg = (await http('GET', '/api/prime/config')).j.shop;
  check('demonstration on a production server: the start log says so plainly, with its last day', (await waitLog(/PRIME: DEMONSTRATION payments \(Robokassa TEST mode, no money moves, demo rights counted\) until \d{4}-\d{2}-\d{2}/, fromDemo)) && pbLog.slice(fromDemo).some((l) => /payments demo \(Robokassa, sha256\), rights counted: demo/.test(l)));
  check('the public config: env demo, selling, the REAL prices are what the test payment asks (RAY 99 ₽, BRUNO 149 ₽, cosmetics 49 ₽), LUCIEN never; the last day', dcfg.env === 'demo' && dcfg.selling === true && dcfg.prices.skin_ray_neon_runner === 9900 && dcfg.charge.skin_ray_neon_runner === 9900 && dcfg.charge.skin_bruno_casino_boss === 14900 && dcfg.charge.fx_vhs_card_frame === 4900 && dcfg.charge.fighter_lucien === null && dcfg.demoUntil === DEMO_ENV.PRIME_DEMO_UNTIL, JSON.stringify(dcfg));
  const dOffer = (await http('GET', '/api/prime/shop/offer')).j.offer;
  check('the demonstration\'s own stand-in terms (revision 9002, no page) — not the offer, not the staging terms', dOffer?.revision === 9002 && dOffer.url === '' && /демонстрационной оплаты/.test(dOffer.title));
  const dBefore = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  check('a demonstration counts only demo rights: A\'s test rights (staging) and live rights count for nothing here', dBefore.env === 'demo' && dBefore.owned.length === 0, JSON.stringify(dBefore.owned));
  await http('POST', '/api/prime/shop/offer/accept', A.tok, { revision: dOffer.revision, sha256: dOffer.sha256 });
  const dl = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fighter_lucien' });
  check('a demonstration never opens a fighter (LUCIEN after his season → not_in_demo, no order)', dl.status === 409 && dl.j.code === 'not_in_demo' && sqlite("select count(*) from shop_orders where env='demo';") === '0', JSON.stringify(dl.j));
  const dc = await http('POST', '/api/prime/shop/checkout', A.tok, { sku: 'fx_prime_broadcast' });
  const dOrd = dc.j.order ?? {};
  const dId = sqlite(`select id from shop_orders where invId=${dOrd.inv};`);
  const df = dc.j.payment?.fields ?? {};
  check('demo order: env demo, an invoice of the demo range (700 000 000 000 000 + clock), the REAL price (49 ₽ = 4900 kopecks)', dc.status === 200 && dOrd.env === 'demo' && PAYJS.envOfInv(dOrd.inv) === 'demo' && dOrd.inv >= PAYJS.invFloor('demo', Date.now() - 60000) && dOrd.amountKop === 4900, JSON.stringify(dc.j).slice(0, 300));
  check('the payment page: Robokassa\'s own, IsTest=1 ALWAYS, OutSum 49.00, signed with the TEST Password#1 (a live page cannot be made here)', dc.j.payment?.url === 'https://auth.robokassa.ru/Merchant/Index.aspx' && df.IsTest === '1' && df.OutSum === '49.00' && df.SignatureValue === H.sha256(`${LOGIN}:49.00:${dOrd.inv}:${TEST_P1}:Shp_order=${dId}`) && df.Description === 'Цифровой предмет оформления PRIME BROADCAST для игры PRIME TIME: SHOWDOWN');
  const dLedger = path.join(work, 'prime-ledger', 'demo', `${dOrd.inv}.json`);
  check('the demo invoice is reserved in its OWN ledger (prime-ledger/demo), apart from test and live', fs.existsSync(dLedger) && JSON.parse(fs.readFileSync(dLedger, 'utf8')).env === 'demo' && !fs.existsSync(path.join(work, 'prime-ledger', 'live', `${dOrd.inv}.json`)) && !fs.existsSync(path.join(work, 'prime-ledger', 'test', `${dOrd.inv}.json`)));
  const dFlag0 = await notify(signedNote(dOrd.inv, '49.00', dId, TEST_P2, 'sha256', { IsTest: '0' }));
  const dLive = await notify(signedNote(dOrd.inv, '49.000000', dId, LIVE_P2, 'sha256'));
  check('refused: a notification saying IsTest=0, one signed with a LIVE password — nothing granted', dFlag0.status === 400 && dLive.status === 400 && sqlite(`select status from shop_orders where id='${dId}';`) === 'pending_payment');
  const dSucc = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${dOrd.inv}`, { redirect: 'manual' });
  check('SuccessURL alone grants nothing: 303 back to the official game with the order number, the order still unpaid', dSucc.status === 303 && dSucc.headers.get('location') === `${GAME}?prime_pay=success&inv=${dOrd.inv}` && sqlite(`select status from shop_orders where id='${dId}';`) === 'pending_payment');
  const dOk = await notify(signedNote(dOrd.inv, '49.00', dId, TEST_P2, 'sha256', { IsTest: '1' }));
  const dAfter = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  check('the TEST notification (test Password#2, IsTest=1) → «OK», fulfilled, a DEMO right — in the account\'s demonstration collection', dOk.text === `OK${dOrd.inv}` && sqlite(`select env||'|'||status||'|'||source from shop_entitlements where "order"='${dId}';`) === 'demo|active|purchase' && dAfter.owned.join() === 'fx_prime_broadcast' && dAfter.env === 'demo');
  const dRepeat = await notify(signedNote(dOrd.inv, '49.00', dId, TEST_P2, 'sha256', { IsTest: '1' }));
  check('a repeated demo notification changes nothing (one right)', dRepeat.text === `OK${dOrd.inv}` && sqlite(`select count(*) from shop_entitlements where "order"='${dId}';`) === '1');
  const stagingInv = PAYJS.invFloor('test', Date.now()) + 77;
  const dStaging = await notify(signedNote(stagingInv, '10.00', 'abcdefghijklmno', TEST_P2, 'sha256', { IsTest: '1' }));
  check('a valid TEST notification for a staging invoice is never taken here without a relay (404, nothing granted)', dStaging.status === 404 && sqlite(`select count(*) from shop_orders where invId=${stagingInv};`) === '0');
  await stopPb();
  // the demonstration ends → live: demo rights count for nothing; demo-end revokes them for good
  testHooks(rulesWith({ live: true }));
  await startPb(LIVE_ENV);
  const liveAfterDemo = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  check('live sales after the demonstration: the demo item counts for nothing — only real (live) rights', liveAfterDemo.env === 'live' && !liveAfterDemo.owned.includes('fx_prime_broadcast') && liveAfterDemo.owned.includes('skin_ray_neon_runner'), JSON.stringify(liveAfterDemo.owned));
  const demoEnd = cli(LIVE_ENV, 'prime-shop', 'demo-end');
  check('`prime-shop demo-end`: every demo right revoked (kept in the history, demo_ended); live rights untouched', /demo rights revoked: 1/.test(demoEnd) && sqlite(`select status||'|'||revokeReason from shop_entitlements where "order"='${dId}';`) === 'revoked|demo_ended' && sqlite(`select count(*) from shop_entitlements where env='live' and status='active';`) !== '0', demoEnd.slice(0, 200));
  await stopPb();

  // ---------------------------------------------------------------- one Robokassa shop: the relay to staging
  section('Одни адреса Robokassa: production передаёт тестовые счета staging (сам ничего не засчитывает)');
  const http2 = proc.getBuiltinModule('node:http');
  const RELAY_PORT = 19196;
  const relayed: { url: string; body: string; relayHeader: string }[] = [];
  const fakeStaging = http2.createServer((req: any, res: any) => {
    let body = '';
    req.on('data', (c: any) => (body += c));
    req.on('end', () => {
      relayed.push({ url: req.url, body, relayHeader: String(req.headers['x-prime-relay'] || '') });
      const inv = /InvId=(\d+)/.exec(body)?.[1] ?? '';
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK' + inv);
    });
  });
  await new Promise<void>((r) => fakeStaging.listen(RELAY_PORT, '127.0.0.1', () => r()));
  await startPb({ PRIME_SERVER_ROLE: 'production', PRIME_PAY_RELAY_URL: `http://127.0.0.1:${RELAY_PORT}` });
  const tInv = PAYJS.invFloor('test', Date.now()) + 5;
  const tNote = signedNote(tInv, '10.00', 'abcdefghijklmno', TEST_P2, 'sha256', { IsTest: '1' });
  const rel = await notify(tNote);
  const got1 = relayed[0];
  check('production (payments OFF) passes a TEST-range notification to staging untouched and answers with staging\'s own «OK…»', rel.status === 200 && rel.text === `OK${tInv}` && got1?.url === '/api/prime/pay/robokassa/result' && got1.relayHeader === '1' && new URLSearchParams(got1.body).get('SignatureValue') === tNote.SignatureValue && new URLSearchParams(got1.body).get('OutSum') === '10.00' && new URLSearchParams(got1.body).get('Shp_order') === 'abcdefghijklmno', JSON.stringify(got1 ?? {}).slice(0, 300));
  check('…production itself records and grants nothing for it', sqlite(`select count(*) from shop_orders where invId=${tInv};`) === '0' && sqlite(`select count(*) from shop_payment_events where invId=${tInv};`) === '0');
  const notRel = await notify(signedNote(PAYJS.invFloor('demo', Date.now()), '49.00', 'abcdefghijklmno', TEST_P2));
  check('a demo- or live-range number is never passed on (here: payments off → 503)', notRel.status === 503 && relayed.length === 1);
  const relBack = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${tInv}&OutSum=10.00&SignatureValue=x`, { redirect: 'manual' });
  const ownBack = await fetch(API + `/api/prime/pay/robokassa/fail?InvId=${PAYJS.invFloor('live', Date.now())}`, { redirect: 'manual' });
  const relFail = await fetch(API + `/api/prime/pay/robokassa/fail?InvId=${tInv}`, { redirect: 'manual' });
  const relBody = await relBack.text();
  check('the way back without PRIME_PAY_RELAY_PUBLIC_URL: a staging invoice gets the return page (200, no redirect) — never the relay\'s loopback address', relBack.status === 200 && !relBack.headers.get('location') && !relBody.includes('127.0.0.1') && relBody.includes('STAGING') && relFail.status === 200 && !relFail.headers.get('location') && !(await relFail.text()).includes('127.0.0.1'));
  check('…the rest (live, demo) still goes to this server\'s game', ownBack.status === 303 && (ownBack.headers.get('location') ?? '').startsWith(GAME));
  const loop = await fetch(API + '/api/prime/pay/robokassa/result', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Prime-Relay': '1' }, body: new URLSearchParams(tNote).toString() });
  check('a relayed request is never relayed again (a misconfigured loop → 508)', loop.status === 508 && relayed.length === 1);
  await stopPb();
  // the player's way back to staging: its PUBLIC https address (the server-to-server relay stays loopback)
  const STG = 'https://primetime-showdown-staging.duckdns.org';
  await startPb({ PRIME_SERVER_ROLE: 'production', PRIME_PAY_RELAY_URL: `http://127.0.0.1:${RELAY_PORT}`, PRIME_PAY_RELAY_PUBLIC_URL: STG + '/', PRIME_GAME_URL: GAME });
  const pubOk = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${tInv}&OutSum=10.00&SignatureValue=x&Shp_order=abcdefghijklmno&next=https://evil.example/`, { redirect: 'manual' });
  const pubFail = await fetch(API + `/api/prime/pay/robokassa/fail`, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `InvId=${tInv}&OutSum=10.00&Culture=ru` });
  check('TEST SuccessURL on production → 303 to staging\'s PUBLIC SuccessURL with only the order number (nothing else from the request)', pubOk.status === 303 && pubOk.headers.get('location') === `${STG}/api/prime/pay/robokassa/success?InvId=${tInv}`, String(pubOk.headers.get('location')));
  check('TEST FailURL on production (POST) → 303 to staging\'s PUBLIC FailURL', pubFail.status === 303 && pubFail.headers.get('location') === `${STG}/api/prime/pay/robokassa/fail?InvId=${tInv}`, String(pubFail.headers.get('location')));
  const demoBack = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${PAYJS.invFloor('demo', Date.now())}`, { redirect: 'manual' });
  const liveBack = await fetch(API + `/api/prime/pay/robokassa/fail?InvId=${PAYJS.invFloor('live', Date.now())}`, { redirect: 'manual' });
  check('…DEMO and LIVE invoices are untouched: back to this server\'s own game', demoBack.status === 303 && (demoBack.headers.get('location') ?? '').startsWith(GAME + '?prime_pay=success') && liveBack.status === 303 && (liveBack.headers.get('location') ?? '').startsWith(GAME + '?prime_pay=fail'));
  check('…the ResultURL relay is unchanged: still server-to-server over loopback, never a redirect', (await notify(tNote)).text === `OK${tInv}` && relayed.length === 2 && relayed[1].url === '/api/prime/pay/robokassa/result');
  const selfBack = await new Promise<{ status: number; location: string }>((r) => {
    const rq = http2.request({ host: '127.0.0.1', port: Number(new URL(API).port), path: `/api/prime/pay/robokassa/success?InvId=${tInv}`, headers: { Host: 'primetime-showdown-staging.duckdns.org' } }, (res: any) => {
      res.resume();
      r({ status: res.statusCode, location: String(res.headers.location ?? '') });
    });
    rq.end();
  });
  check('…a public address that is this very server never loops: the return page instead', selfBack.status === 200 && !selfBack.location, JSON.stringify(selfBack));
  check('…prime-shop status names the public way back', /relayReturn: https:\/\/primetime-showdown-staging\.duckdns\.org \(players back/.test(cli({ PRIME_SERVER_ROLE: 'production', PRIME_PAY_RELAY_PUBLIC_URL: STG }, 'prime-shop', 'status')));
  await stopPb();
  for (const badPub of ['http://127.0.0.1:8091', 'https://10.0.0.5:8091', 'http://primetime-showdown-staging.duckdns.org']) {
    await startPb({ PRIME_SERVER_ROLE: 'production', PRIME_PAY_RELAY_URL: `http://127.0.0.1:${RELAY_PORT}`, PRIME_PAY_RELAY_PUBLIC_URL: badPub });
    const b = await fetch(API + `/api/prime/pay/robokassa/success?InvId=${tInv}`, { redirect: 'manual' });
    const bt = await b.text();
    check(`an unacceptable public address (${badPub}) is never used: the return page, no redirect, no internal address in it`, b.status === 200 && !b.headers.get('location') && !bt.includes('127.0.0.1') && !bt.includes('10.0.0.5'));
    await stopPb();
  }
  await startPb({ ...TEST_ENV, PRIME_PAY_RELAY_URL: `http://127.0.0.1:${RELAY_PORT}` });
  const relayedBefore = relayed.length;
  const stagingOwn = await notify(signedNote(tInv, '10.00', 'abcdefghijklmno', TEST_P2, 'sha256', { IsTest: '1' }));
  check('a non-production server never relays (staging decides its own invoices)', stagingOwn.status === 404 && relayed.length === relayedBefore);
  await stopPb();
  await new Promise<void>((r) => fakeStaging.close(() => r()));

  testHooks(rulesWith({ live: true }));
  await startPb(TEST_ENV);
  const stagingA = (await http('GET', '/api/prime/shop/purchases', A.tok)).j;
  check('back on the staging (test) server: A owns exactly its TEST items — the live VHS CARD FRAME counts for nothing there', stagingA.env === 'test' && JSON.stringify(stagingA.owned.slice().sort()) === JSON.stringify(['fx_golden_confetti', 'skin_ray_neon_runner']), JSON.stringify(stagingA.owned));
  await stopPb();
  const allLog = sqlite("select message||' '||data from _logs;", 'auxiliary.db');
  check('no password ever reached the server log (console and the log database) during the whole run', !pbLog.some((l) => SECRETS.some((x) => l.includes(x))) && allLog.length > 0 && !SECRETS.some((x) => allLog.includes(x)));

  // ---------------------------------------------------------------- the migration
  const users = sqlite('select count(*) from users;');
  const consents = sqlite('select count(*) from consents;');
  // (after the restore drill PocketBase's fresh log database is applied anew at every start — newer than the
  // payments migration: then the last two are reverted, the log one is re-created by itself)
  let down = '';
  for (let i = 0; i < 4 && !/Reverted 1792800000_prime_payments/.test(down); i++) down += cli({}, 'migrate', 'down', i ? '2' : '1');
  const gone = sqlite("select count(*) from sqlite_master where name in ('shop_orders','shop_entitlements','shop_payment_events');");
  const up = cli({}, 'migrate', 'up');
  const back2 = sqlite("select count(*) from sqlite_master where name in ('shop_orders','shop_entitlements','shop_payment_events');");
  const demoPattern = sqlite("select fields from _collections where name='shop_orders';");
  check('the 1.8.8 stage-4 and demonstration migrations go down and up again; accounts and consents stay; «demo» is an allowed environment again', gone === '0' && back2 === '3' && sqlite('select count(*) from users;') === users && sqlite('select count(*) from consents;') === consents && demoPattern.includes('^(test|live|demo)$'), (down + up).slice(0, 300));
}

async function main(): Promise<void> {
  protocolChecks();
  await clientChecks(check, section);
  safetyChecks();
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
    console.log(`\n${failed ? 'payments: FAILED' : 'payments: OK'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed ? 1 : 0);
  });
