// PRIME TIME: SHOWDOWN — Alpha 1.8.8 stage 4 «PRIME PAYMENTS × ROBOKASSA»: the Robokassa protocol as pure
// functions. No PocketBase API, no environment, no secrets of its own: lib/payments.js hands in the hash
// functions ($security) and the passwords; the Node checks (`npm run payments`) run this very file with
// Node's crypto — one implementation, tested both ways.
//
// Official documentation (read 23.10.2026): docs.robokassa.ru/ru/pay-interface (the payment page and its
// signature), /notifications-and-redirects (ResultURL, SuccessURL, FailURL), /testing-mode (IsTest=1, the
// test passwords), /xml-interfaces (OpStateExt), /refund-api (Refund API, Password3) and the OpenAPI
// specification docs.robokassa.ru/openapi/robokassa.yaml (1.3.0).
//
//   payment page  POST https://auth.robokassa.ru/Merchant/Index.aspx (a plain HTML form; GET works too)
//                 SignatureValue = HASH("MerchantLogin:OutSum:InvId[:Receipt]:Password#1[:Shp_k=v…]")
//   ResultURL     Robokassa → this server: OutSum, InvId, SignatureValue, Shp_* (+ Fee, EMail, PaymentMethod,
//                 IncCurrLabel…); SignatureValue = HASH("OutSum:InvId:Password#2[:Shp_k=v…]") over the EXACT
//                 OutSum text received ("149.000000" live, "149.00" in test mode); the answer is "OK{InvId}"
//   SuccessURL    the same fields signed with Password#1 — a page to come back to, never a proof of payment
//   FailURL       no signature at all — never a proof of anything
//   OpStateExt    GET …/Service.asmx/OpStateExt?MerchantLogin&InvoiceID&Signature = HASH("Login:InvId:Password#2")
//                 (live operations only: test payments are never returned)
//   Refund API    POST services.robokassa.ru/RefundService/Refund/Create, body: a JWT signed HS256 with Password3
//
// HASH is the algorithm chosen in the shop's technical settings — the SAME one for the live and the test
// passwords (testing-mode: «убедитесь, что выбранный алгоритм … совпадает с рабочим»). PocketBase computes
// md5, sha256 and sha512; RIPEMD160, SHA1 and SHA384 are not offered (the server refuses to take payments
// with them rather than guess). Shp_* parameters go into a signature sorted by name.

const PAY_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';
const OPSTATE_URL = 'https://auth.robokassa.ru/Merchant/WebService/Service.asmx/OpStateExt';
const REFUND_CREATE_URL = 'https://services.robokassa.ru/RefundService/Refund/Create';
const REFUND_STATE_URL = 'https://services.robokassa.ru/RefundService/Refund/GetState';

const ALGORITHMS = ['md5', 'sha256', 'sha512'];
const HEX_LENGTH = { md5: 32, sha256: 64, sha512: 128 };
/** 10 000 000 ₽ in kopecks — far above any price; every amount stays an exact integer. */
const MAX_KOP = 1000000000;
const INV_RE = /^[1-9][0-9]{0,14}$/;
const SUM_RE = /^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,6}))?$/;
const SHP_RE = /^Shp_[A-Za-z0-9_]{1,40}$/;
/** The fields a ResultURL notification may carry that this server reads (everything else is ignored). */
const RESULT_FIELDS = ['OutSum', 'InvId', 'SignatureValue', 'IsTest', 'Fee', 'EMail', 'PaymentMethod', 'IncCurrLabel', 'Culture'];

function isInt(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
}

// ------------------------------------------------------------------ money
/** Kopecks → the OutSum we send: 14900 → "149.00" (always two decimals, a dot). */
function outSum(kop) {
  if (!isInt(kop) || kop < 1 || kop > MAX_KOP) throw new Error('robokassa: bad amount');
  const c = String(kop % 100);
  return String(Math.floor(kop / 100)) + '.' + (c.length < 2 ? '0' + c : c);
}

/**
 * An OutSum text → kopecks, exactly (no floating point): "149", "149.0", "149.00", "149.000000" → 14900;
 * a fraction of a kopeck ("149.005"), a sign, an exponent or anything else → null.
 */
function sumKop(s) {
  if (typeof s !== 'string') return null;
  const m = SUM_RE.exec(s);
  if (!m) return null;
  const frac = m[2] || '';
  if (frac.length > 2 && !/^0+$/.test(frac.slice(2))) return null;
  const k = Number(m[1]) * 100 + Number((frac + '00').slice(0, 2));
  return k >= 1 && k <= MAX_KOP ? k : null;
}

// ---------------------------------------------------------------- signatures
/** Every Shp_* parameter of `params`, sorted by name: [[name, value]…]. */
function shpList(params) {
  const keys = Object.keys(params || {})
    .filter((k) => SHP_RE.test(k))
    .sort();
  return keys.map((k) => [k, String(params[k])]);
}

function shpTail(list) {
  let s = '';
  for (let i = 0; i < list.length; i++) s += ':' + list[i][0] + '=' + list[i][1];
  return s;
}

function paymentBase(login, sum, inv, receipt, password1, shp) {
  const parts = [login, sum, String(inv)];
  if (receipt) parts.push(receipt);
  parts.push(password1);
  return parts.join(':') + shpTail(shp);
}

function resultBase(sum, inv, password2, shp) {
  return sum + ':' + inv + ':' + password2 + shpTail(shp);
}

function opStateBase(login, inv, password2) {
  return login + ':' + inv + ':' + password2;
}

/** HASH(text) in lower-case hex with one of ALGORITHMS; H = { md5, sha256, sha512 } (text → hex). */
function hash(alg, text, H) {
  if (ALGORITHMS.indexOf(alg) < 0 || !H || typeof H[alg] !== 'function') throw new Error('robokassa: unsupported algorithm');
  return String(H[alg](text)).toLowerCase();
}

// -------------------------------------------------------------- payment page
/** «без специальных символов», at most 100: letters, digits, spaces and a little punctuation. */
function description(text) {
  return String(text || '')
    .replace(/[^0-9A-Za-zА-Яа-яЁё .,:()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

/**
 * ExpirationDate («YYYY-MM-DDThh:mm») in Moscow time (UTC+3, no daylight saving). The documentation does
 * not name the time zone; Moscow time is the safe reading: were it read as UTC, the page would only stay
 * open three hours longer — it can never close before the order does.
 */
function expirationDate(ms) {
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 16);
}

/**
 * The payment page's form: { url, method: 'POST', fields }. o = { login, password1, alg, H, kop, inv, title,
 * test, shp: { Shp_order: … }, expires (ms or 0), receipt ('' = none), gateway ('' = Robokassa) }.
 * IsTest is not part of the signature: a test form signed with the test Password#1 cannot pass as a live
 * payment, nor the other way round (the passwords differ).
 */
function paymentForm(o) {
  const sum = outSum(o.kop);
  const shp = shpList(o.shp);
  const fields = {
    MerchantLogin: o.login,
    OutSum: sum,
    InvId: String(o.inv),
    Description: description(o.title),
    SignatureValue: hash(o.alg, paymentBase(o.login, sum, o.inv, o.receipt || '', o.password1, shp), o.H),
    Culture: 'ru',
  };
  if (o.receipt) fields.Receipt = o.receipt;
  if (o.expires) fields.ExpirationDate = expirationDate(o.expires);
  for (let i = 0; i < shp.length; i++) fields[shp[i][0]] = shp[i][1];
  if (o.test) fields.IsTest = '1';
  return { url: o.gateway || PAY_URL, method: 'POST', fields: fields };
}

/**
 * Prepared, OFF by default: the 54-ФЗ «Receipt» (one item, no VAT). A self-employed seller (НПД) gets the
 * receipt from Robokassa's «Робочеки СМЗ» without it; it is sent only if the owner switches it on after
 * Robokassa confirms it is needed (docs/PRIME_PAYMENTS.md, «Чеки НПД»). URL-encoded minimised JSON — the
 * very text that goes into the signature and the form field.
 */
function receipt(title, kop) {
  const sum = Number(outSum(kop));
  const json = JSON.stringify({ items: [{ name: description(title).slice(0, 128), quantity: 1, sum: sum, tax: 'none', payment_method: 'full_payment', payment_object: 'service' }] });
  return encodeURIComponent(json);
}

// ------------------------------------------------------------------ ResultURL
/** One field of the notification, exactly as received (strings only; anything else = missing). */
function field(p, k) {
  const v = p ? p[k] : undefined;
  return typeof v === 'string' ? v : '';
}

/**
 * Check a ResultURL notification. `p`: the parameters EXACTLY as received (strings). o = { password2, alg,
 * H, equal (constant-time), test, password1 (only to explain a mismatch in the log) }.
 *   { ok: true, inv, invText, kop, sum, shp }   — the signature holds; the caller still checks the order,
 *                                                 its environment, its amount and its Shp_order
 *   { ok: false, code, hint }                    — refused; `hint` explains a misconfiguration for the log
 *                                                 (another algorithm, Password#1 instead of #2) — the
 *                                                 notification is refused all the same
 */
function checkResult(p, o) {
  const sum = field(p, 'OutSum');
  const inv = field(p, 'InvId');
  const sig = field(p, 'SignatureValue');
  if (!sum || !inv || !sig) return { ok: false, code: 'missing_fields', hint: '' };
  if (!INV_RE.test(inv)) return { ok: false, code: 'bad_inv', hint: '' };
  const kop = sumKop(sum);
  if (kop === null) return { ok: false, code: 'bad_sum', hint: '' };
  if (!/^[0-9a-fA-F]{32,128}$/.test(sig)) return { ok: false, code: 'bad_signature', hint: 'format' };
  // IsTest is not signed: it can only refuse (a live notification on a test server, a test one on production)
  const flag = field(p, 'IsTest');
  if (flag !== '' && (o.test ? flag !== '1' : flag === '1')) return { ok: false, code: 'istest_mismatch', hint: '' };
  const shp = shpList(p);
  const got = sig.toLowerCase();
  if (o.equal(hash(o.alg, resultBase(sum, inv, o.password2, shp), o.H), got)) {
    const map = {};
    for (let i = 0; i < shp.length; i++) map[shp[i][0]] = shp[i][1];
    return { ok: true, inv: Number(inv), invText: inv, kop: kop, sum: sum, shp: map };
  }
  return { ok: false, code: 'bad_signature', hint: diagnose(sum, inv, shp, got, o) };
}

/** Why a signature did not match, for the server log only: another algorithm, or Password#1 used. */
function diagnose(sum, inv, shp, got, o) {
  const hints = [];
  if (HEX_LENGTH[o.alg] !== got.length) hints.push('length:' + got.length);
  for (let i = 0; i < ALGORITHMS.length; i++) {
    const a = ALGORITHMS[i];
    if (a !== o.alg && HEX_LENGTH[a] === got.length && hash(a, resultBase(sum, inv, o.password2, shp), o.H) === got) hints.push('algorithm:' + a);
  }
  if (o.password1) {
    for (let i = 0; i < ALGORITHMS.length; i++) {
      const a = ALGORITHMS[i];
      if (HEX_LENGTH[a] === got.length && hash(a, resultBase(sum, inv, o.password1, shp), o.H) === got) hints.push('password1' + (a === o.alg ? '' : '+algorithm:' + a));
    }
  }
  return hints.join(',');
}

/**
 * The parameters of a urlencoded text (a query string or a form body), exactly as sent: no type guessing
 * («123» stays the text «123», «149.000000» stays «149.000000»). The first value of a name wins.
 */
function parseForm(text, into) {
  const out = into || {};
  if (typeof text !== 'string' || !text) return out;
  const parts = text.split('&');
  for (let i = 0; i < parts.length && i < 64; i++) {
    if (!parts[i]) continue;
    const eq = parts[i].indexOf('=');
    const rawK = eq < 0 ? parts[i] : parts[i].slice(0, eq);
    const rawV = eq < 0 ? '' : parts[i].slice(eq + 1);
    let k;
    let v;
    try {
      k = decodeURIComponent(rawK.replace(/\+/g, ' '));
      v = decodeURIComponent(rawV.replace(/\+/g, ' '));
    } catch (_) {
      continue;
    }
    if (k.length > 64 || v.length > 2000) continue;
    if (!Object.prototype.hasOwnProperty.call(out, k)) out[k] = v;
  }
  return out;
}

// ---------------------------------------------------------------- OpStateExt
function opStateUrl(login, inv, password2, alg, H) {
  return OPSTATE_URL + '?MerchantLogin=' + encodeURIComponent(login) + '&InvoiceID=' + String(inv) + '&Signature=' + hash(alg, opStateBase(login, String(inv), password2), H);
}

function tag(src, name) {
  if (!src) return null;
  const m = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>').exec(src);
  return m ? m[1].trim() : null;
}

/** An ISO 8601 time with an offset and up to 7 fractional digits (Robokassa's StateDate) → ms, or NaN. */
function isoTime(s) {
  if (typeof s !== 'string') return NaN;
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/.exec(s.trim());
  if (!m) return NaN;
  return Date.parse(m[1] + '.' + ((m[2] || '') + '000').slice(0, 3) + m[3]);
}

/**
 * The OperationStateResponse: { result, state, stateDate, stateTime, outSum, incSum, opKey, fields }. result 0
 * = answered; state 5 initialised, 10 cancelled (no money), 20 held, 50 money received / being credited, 60
 * returned to the buyer, 80 suspended, 100 paid. `fields` = the operation's UserFields (the Shp_* sent with
 * the payment), names lower-cased. Anything unreadable → result null.
 */
function parseOpState(xml) {
  const text = typeof xml === 'string' ? xml : '';
  const res = tag(text, 'Result');
  const st = tag(text, 'State');
  const info = tag(text, 'Info') || '';
  const num = (v) => (v !== null && /^-?[0-9]{1,6}$/.test(v) ? Number(v) : null);
  const fields = {};
  const uf = tag(text, 'UserFields') || '';
  const re = /<Field(?:\s[^>]*)?>([\s\S]*?)<\/Field>/g;
  let m;
  while ((m = re.exec(uf)) !== null) {
    const name = tag(m[1], 'Name');
    const value = tag(m[1], 'Value');
    if (name && value !== null) fields[name.toLowerCase()] = value;
  }
  const stateDate = st ? tag(st, 'StateDate') : null;
  return {
    result: res ? num(tag(res, 'Code')) : null,
    state: st ? num(tag(st, 'Code')) : null,
    stateDate: stateDate,
    stateTime: isoTime(stateDate),
    outSum: tag(info, 'OutSum'),
    incSum: tag(info, 'IncSum'),
    opKey: tag(info, 'OpKey'),
    fields: fields,
  };
}

/**
 * Does Robokassa's answer about invoice N really describe THIS order's payment? (OpStateExt is asked by
 * invoice number only — an old operation under a number used again must never pay a new order.)
 *   paid (result 0, state 100), the operation's Shp_order is this order's id, and its time is not before the
 *   order was made (10 minutes of clock tolerance). Returns { ok, why }.
 */
function opStateBelongs(st, orderId, createdMs) {
  if (!st || st.result !== 0 || st.state !== 100) return { ok: false, why: 'not_paid' };
  const shp = st.fields ? st.fields.shp_order : undefined;
  if (typeof shp !== 'string' || shp !== orderId) return { ok: false, why: 'shp_order' };
  if (!isFinite(st.stateTime) || !isFinite(createdMs) || st.stateTime < createdMs - 10 * 60 * 1000) return { ok: false, why: 'older_than_order' };
  return { ok: true, why: '' };
}

// ---------------------------------------------------------------- Refund API
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function hexBytes(h) {
  const out = [];
  for (let i = 0; i + 1 < h.length; i += 2) out.push(parseInt(h.slice(i, i + 2), 16));
  return out;
}

/** Base64url without padding (JWT). */
function b64url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) s += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) s += B64[n & 63];
  }
  return s;
}

/**
 * The Refund API request body: a JWT {"alg":"HS256","typ":"JWT"} signed with Password3. payload =
 * { OpKey, RefundSum? (roubles; omitted = the whole payment) }. hs256(text, secret) → hex (PocketBase's
 * $security.hs256). The caller sends it as a JSON string.
 */
function refundToken(payload, password3, hs256) {
  const head = b64url(utf8(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(utf8(JSON.stringify(payload)));
  return head + '.' + body + '.' + b64url(hexBytes(String(hs256(head + '.' + body, password3))));
}

/** GetState's label → finished (money returned) | processing | canceled (in Robokassa's cabinet) | null. */
function refundState(json) {
  const l = json && typeof json.label === 'string' ? json.label.toLowerCase() : '';
  return l === 'finished' || l === 'processing' || l === 'canceled' ? l : null;
}

module.exports = {
  PAY_URL,
  OPSTATE_URL,
  REFUND_CREATE_URL,
  REFUND_STATE_URL,
  ALGORITHMS,
  HEX_LENGTH,
  MAX_KOP,
  RESULT_FIELDS,
  outSum,
  sumKop,
  shpList,
  paymentBase,
  resultBase,
  opStateBase,
  hash,
  description,
  expirationDate,
  paymentForm,
  receipt,
  checkResult,
  parseForm,
  opStateUrl,
  parseOpState,
  opStateBelongs,
  isoTime,
  b64url,
  utf8,
  refundToken,
  refundState,
};
