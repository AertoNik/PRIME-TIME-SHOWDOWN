// PRIME TIME: SHOWDOWN — Alpha 1.8.8 «PRIME PAYMENTS»: the invoice ledger OUTSIDE the database.
// Loaded with require() inside every handler (PocketBase runs each handler in its own JS context).
//
// Why: restoring an older backup of pb_data rolls the orders back — and with them the highest invoice number.
// Robokassa still remembers every invoice it saw. Without a record that survives the restore, the next orders
// would reuse numbers Robokassa already paid (the buyer cannot pay: error 40) and a payment confirmed after the
// backup would be lost. So every invoice number is reserved HERE before its payment page is ever signed, and
// every verified payment and refund is noted here too:
//
//   <ledger>/<env>/mark          the highest invoice number ever issued in that environment (atomic replace)
//   <ledger>/<env>/<InvId>.json  one small file per order: who, what, how much, the order's id (= Shp_order);
//                                later «paid» (the verified payment) and «refunded» (a confirmed refund)
//
// <ledger> = PRIME_LEDGER_DIR, or `prime-ledger` NEXT TO pb_data (like the deletions note of lib/guard.js):
// restore.sh replaces pb_data and never this folder; backup.sh copies it into every archive. Only the server
// writes it (0600 files, 0700 folders). Account ids are removed from it when an account is deleted.
//
// Rules: issue() fails → no order, no payment page (the purchase is refused, never signed with a number that
// might come back). update() is best effort (logged): the database stays the primary record.

const ENVS = ['live', 'test', 'demo'];
const INV_RE = /^[1-9][0-9]{0,14}$/;
const ID_RE = /^[a-z0-9]{15}$/;

function env(k) {
  return String($os.getenv(k) || '').trim();
}

/** The ledger folder: PRIME_LEDGER_DIR or `prime-ledger` beside the data folder. */
function root(app) {
  const p = env('PRIME_LEDGER_DIR');
  if (p) return p.replace(/\/+$/, '');
  const dir = String(app.dataDir()).replace(/\/+$/, '');
  return dir.replace(/\/[^/]*$/, '') + '/prime-ledger';
}

function envDir(app, envName) {
  if (ENVS.indexOf(envName) < 0) throw new Error('ledger: unknown environment');
  return root(app) + '/' + envName;
}

function ensure(app, envName) {
  const d = envDir(app, envName);
  $os.mkdirAll(d, 448); // 0700
  return d;
}

/** Write a whole file atomically (a temp file renamed over it): a reader sees the old or the new text, never half. */
function atomicWrite(path, text) {
  const tmp = path + '.tmp-' + $security.randomStringWithAlphabet(8, 'abcdefghijklmnopqrstuvwxyz0123456789');
  $os.writeFile(tmp, text, 384); // 0600
  $os.rename(tmp, path);
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch (_) {
    return null;
  }
}

/**
 * The highest invoice number ever issued in `envName` (0: none yet). A mark that exists but cannot be read
 * throws — the caller then refuses the purchase rather than guess a number.
 */
function mark(app, envName) {
  const t = readText(envDir(app, envName) + '/mark');
  if (t === null) return 0;
  const s = t.trim();
  if (!INV_RE.test(s)) throw new Error('ledger: the mark is damaged');
  return Number(s);
}

function recordPath(app, envName, inv) {
  return envDir(app, envName) + '/' + String(inv) + '.json';
}

function read(app, envName, inv) {
  if (!INV_RE.test(String(inv))) return null;
  const t = readText(recordPath(app, envName, inv));
  if (t === null) return null;
  try {
    const r = JSON.parse(t);
    return r && r.inv === Number(inv) && r.env === envName ? r : null;
  } catch (_) {
    return null;
  }
}

/**
 * Reserve invoice `rec.inv` for order `rec.order` BEFORE its payment page is signed: the order's file first, then
 * the mark. Throws on any failure (the order is not made). The same number for another order → throws.
 * rec = { inv, env, order, user, sku, item, kind, kop, offer, offerHash, title, created }
 */
function issue(app, rec) {
  if (!INV_RE.test(String(rec.inv)) || !ID_RE.test(String(rec.order))) throw new Error('ledger: bad record');
  ensure(app, rec.env);
  const path = recordPath(app, rec.env, rec.inv);
  const had = readText(path);
  if (had !== null) {
    let old = null;
    try {
      old = JSON.parse(had);
    } catch (_) {
      old = null;
    }
    if (!old || old.order !== rec.order) throw new Error('ledger: invoice ' + rec.inv + ' is already taken');
  }
  const out = {
    v: 1,
    inv: Number(rec.inv),
    env: rec.env,
    order: rec.order,
    user: rec.user || '',
    sku: rec.sku,
    item: rec.item || '',
    kind: rec.kind || '',
    kop: rec.kop,
    offer: rec.offer || 0,
    offerHash: rec.offerHash || '',
    title: rec.title || '',
    created: rec.created,
    paid: null,
    refunded: null,
  };
  atomicWrite(path, JSON.stringify(out) + '\n');
  const m = mark(app, rec.env);
  if (Number(rec.inv) > m) atomicWrite(envDir(app, rec.env) + '/mark', String(rec.inv) + '\n');
}

/** Merge `patch` into the order's file (paid, refunded, user…). Best effort: false when it could not be written. */
function update(app, envName, inv, patch) {
  try {
    const r = read(app, envName, inv);
    if (!r) return false;
    for (const k of Object.keys(patch)) r[k] = patch[k];
    atomicWrite(recordPath(app, envName, inv), JSON.stringify(r) + '\n');
    return true;
  } catch (err) {
    app.logger().error('prime-pay: the invoice ledger could not be updated', 'inv', inv, 'error', String(err).slice(0, 200));
    return false;
  }
}

/** Every order file of an environment (oldest number first). */
function list(app, envName) {
  let entries = [];
  try {
    entries = $os.readDir(envDir(app, envName));
  } catch (_) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    const name = e.name();
    const m = /^([1-9][0-9]{0,14})\.json$/.exec(name);
    if (!m) continue;
    const r = read(app, envName, Number(m[1]));
    if (r) out.push(r);
  }
  out.sort((a, b) => a.inv - b.inv);
  return out;
}

/** A deleted PRIME ID: its id leaves the ledger (the order records stay, without the person — as in the database). */
function forgetUser(app, uid) {
  for (const envName of ENVS) {
    for (const r of list(app, envName)) if (r.user === uid) update(app, envName, r.inv, { user: '' });
  }
}

/** Can this server reserve invoice numbers? { ok, dir, problem } — the start-up log and `prime-shop status`. */
function health(app, envName) {
  try {
    const d = ensure(app, envName);
    mark(app, envName);
    const probe = d + '/.probe';
    $os.writeFile(probe, 'ok', 384);
    $os.remove(probe);
    return { ok: true, dir: d, problem: '' };
  } catch (err) {
    return { ok: false, dir: root(app), problem: String(err).slice(0, 160) };
  }
}

module.exports = { ENVS, root, mark, issue, update, read, list, forgetUser, health };
