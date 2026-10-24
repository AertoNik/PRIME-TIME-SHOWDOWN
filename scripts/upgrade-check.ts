// Alpha 1.8.8 — the PRODUCTION update rehearsed on this Mac with made-up data (`npm run upgrade:test`):
//
//   1. a database made by the LIVE server code 1.8.4 (server-bundle/prime-server-1.8.4-alpha.tar.gz): accounts,
//      profiles, accepted documents, cloud saves with their history — through the 1.8.4 API itself;
//   2. the same data folder started by 1.8.8 (this project's hooks and migrations — what update.sh installs): the
//      new migrations apply on start; every account, password, profile, consent and save must come through
//      unchanged, sign-in and PRIME CLOUD keep working, payments stay off;
//   3. update.sh's way back: the 1.8.4 code on the UPGRADED database — it must start and serve the same accounts.
//
// A temporary folder and its own ports (19490/11949/19491); the real servers are never contacted.

import { BACKEND, HOOKS, MIGRATIONS, PB_BIN, ROOT, binariesReady, dbCounts, dbFingerprint, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, os, path, proc } from './lib/node';
import { defaultSave } from '../src/meta/SaveSystem';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 19490, smtp: 11949, mailUi: 19491 };
const API = `http://127.0.0.1:${PORTS.api}`;
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n== ${t}`);

const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-upgrade-check-'));
const dataDir = path.join(work, 'pb_data');
const db = path.join(dataDir, 'data.db');
let pb: any = null;
const pbLog: string[] = [];
const ENV = { PRIME_REGISTRATION: 'disabled', PRIME_SESSIONS: 'off', PRIME_GAME_URL: 'http://localhost:5173/', PRIME_PAY_MODE: '', PRIME_SERVER_ROLE: '' };

function sqlite(sql: string): string {
  return String(cp.spawnSync('/usr/bin/sqlite3', [db, sql], { encoding: 'utf8' }).stdout).trim();
}
async function start(dirs: { hooks: string; migrations: string }): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: ENV, args: [`--hooksDir=${dirs.hooks}`, `--migrationsDir=${dirs.migrations}`] });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
}
async function stop(): Promise<void> {
  await stopChild(pb);
  pb = null;
}
async function http(method: string, u: string, token = '', body?: unknown): Promise<{ status: number; j: any }> {
  const r = await fetch(API + u, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}
async function signIn(email: string, pw: string): Promise<string> {
  return (await http('POST', '/api/collections/users/auth-with-password', '', { identity: email, password: pw })).j.token ?? '';
}
async function putSave(tok: string, data: unknown, base: number): Promise<{ status: number; j: any }> {
  const text = JSON.stringify(data);
  return http('PUT', '/api/prime/save', tok, { base, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), op: 'op_' + crypto.randomBytes(6).toString('hex'), device: 'upgrade-check', reason: 'sync', client: 'upgrade-check' });
}

async function main(): Promise<void> {
  const bundle = path.join(ROOT, 'server-bundle', 'prime-server-1.8.4-alpha.tar.gz');
  if (!binariesReady() || !fs.existsSync(bundle)) {
    check('PocketBase installed and the live 1.8.4 server bundle present (server-bundle/prime-server-1.8.4-alpha.tar.gz)', false);
    return;
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  const old = path.join(work, 'v184');
  fs.mkdirSync(old);
  cp.execFileSync('tar', ['-xzf', bundle, '-C', old, 'backend/pb_hooks', 'backend/pb_migrations']);
  const OLD = { hooks: path.join(old, 'backend', 'pb_hooks'), migrations: path.join(old, 'backend', 'pb_migrations') };
  const NEW = { hooks: HOOKS, migrations: MIGRATIONS };

  // ---------------------------------------------------------------- 1.8.4: the data as production has it
  section('1.8.4 (код, который сейчас работает на production): аккаунты, документы, сохранения');
  const SU = { email: 'upgrade-admin@upgrade.test', pw: crypto.randomBytes(18).toString('base64url') };
  const su0 = cp.spawnSync(PB_BIN, ['superuser', 'upsert', `--dir=${dataDir}`, `--migrationsDir=${OLD.migrations}`, `--hooksDir=${OLD.hooks}`, '--automigrate=false', '--', SU.email, SU.pw], { encoding: 'utf8', cwd: BACKEND });
  check('(set-up) the 1.8.4 migrations create the database', su0.status === 0, String(su0.stderr).slice(0, 200));
  await start(OLD);
  const suTok = (await http('POST', '/api/collections/_superusers/auth-with-password', '', { identity: SU.email, password: SU.pw })).j.token as string;
  const cfg184 = (await http('GET', '/api/prime/config')).j;
  check('(set-up) the 1.8.4 server answers without PRIME SHOP payments', !!cfg184.legal && !cfg184.shop?.payments);
  const pw = 'Upgrade' + crypto.randomBytes(6).toString('hex');
  const players: { email: string; id: string; tok: string; rev: number }[] = [];
  for (const name of ['alpha', 'bravo', 'charlie']) {
    const email = `${name}@upgrade.test`;
    const u = (await http('POST', '/api/collections/users/records', suTok, { email, password: pw, passwordConfirm: pw, verified: true })).j;
    await http('POST', '/api/collections/profiles/records', suTok, { user: u.id, nickname: `Up${name}`, nicknameKey: `up${name}` });
    for (const d of ['terms', 'consent']) await http('POST', '/api/collections/consents/records', suTok, { user: u.id, doc: d, version: cfg184.legal[d].v, lang: 'ru', action: 'register' });
    await http('POST', '/api/collections/consents/records', suTok, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    const tok = await signIn(email, pw);
    const save = defaultSave() as any;
    save.coins = 1234;
    const s1 = await putSave(tok, save, 0);
    save.coins = 1500;
    const s2 = await putSave(tok, save, s1.j.revision ?? -1);
    players.push({ email, id: u.id, tok, rev: s2.j.revision ?? -1 });
  }
  check('(set-up) three PRIME ID with accepted documents and two cloud revisions each, written by the 1.8.4 API', players.every((p) => p.tok && p.rev === 2), JSON.stringify(players.map((p) => p.rev)));
  await stop();
  const before = dbFingerprint(db);
  const countsBefore = dbCounts(db);
  const consentsBefore = sqlite("select user||'|'||doc||'|'||version||'|'||action from consents order by user, doc;");
  const historyBefore = sqlite('select count(*) from save_history;');

  // ---------------------------------------------------------------- 1.8.8 on the same data
  section('1.8.8 на тех же данных: миграции, вход, PRIME CLOUD, оплата выключена');
  const fromNew = pbLog.length;
  await start(NEW);
  const applied = sqlite("select file from _migrations where file like '17927%' or file like '17928%' or file like '17929%' order by file;");
  check('the new migrations applied on start (checkout, payments, demonstration)', /1792700000_prime_checkout/.test(applied) && /1792800000_prime_payments/.test(applied) && /1792900000_prime_demo/.test(applied), applied);
  check('no error in the start log', !pbLog.slice(fromNew).some((l) => /ERROR|panic|failed to/i.test(l)), pbLog.slice(fromNew).filter((l) => /ERROR|panic|failed/i.test(l)).join(' | ').slice(0, 300));
  check('every account, password hash, token key, profile and save is byte-for-byte the same (fingerprint)', dbFingerprint(db) === before);
  check('the same counts: accounts, profiles, saves, history, superusers', JSON.stringify(dbCounts(db)) === JSON.stringify(countsBefore) && sqlite('select count(*) from save_history;') === historyBefore, JSON.stringify(dbCounts(db)));
  check('every accepted document stays as it was (nobody is asked again by this update)', sqlite("select user||'|'||doc||'|'||version||'|'||action from consents order by user, doc;") === consentsBefore);
  const cfg188 = (await http('GET', '/api/prime/config')).j;
  check('the server now knows PRIME SHOP — and takes no payment (no mode set: production, payments off, not selling)', cfg188.shop?.payments === 1 && cfg188.shop.selling === false && cfg188.shop.env === 'live' && cfg188.shop.prices.skin_ray_neon_runner === 9900 && pbLog.slice(fromNew).some((l) => /server role production, payments off/.test(l)));
  const tokA = await signIn(players[0].email, pw);
  const meA = (await http('GET', '/api/prime/me', tokA)).j;
  check('a 1.8.4 account signs in with its old password; /me shows its cloud save (revision 2), nothing to accept', !!tokA && meA.id === players[0].id && meA.save?.revision === 2 && Array.isArray(meA.legal?.needs) && meA.legal.needs.length === 0, JSON.stringify(meA).slice(0, 200));
  const s3 = await putSave(tokA, { ...defaultSave(), coins: 1700 }, 2);
  check('PRIME CLOUD keeps writing on the upgraded server (revision 3)', s3.status === 200 && s3.j.revision === 3, JSON.stringify(s3.j).slice(0, 200));
  const shopA = (await http('GET', '/api/prime/shop/status', tokA)).j;
  check('PRIME SHOP for an old account: owns nothing, no open order, payments off', Array.isArray(shopA.owned) && shopA.owned.length === 0 && shopA.orders.length === 0 && shopA.payments === false);
  check('the shop tables start empty; no invoice ledger yet (made only when payments run)', sqlite('select count(*) from shop_orders;') === '0' && sqlite('select count(*) from shop_entitlements;') === '0' && !fs.existsSync(path.join(work, 'prime-ledger', 'live', 'mark')));
  await stop();
  const afterNew = dbFingerprint(db);

  // ---------------------------------------------------------------- the way back: 1.8.4 on the upgraded data
  section('Откат (update.sh): код 1.8.4 на обновлённой базе');
  const fromOld = pbLog.length;
  await start(OLD);
  check('the 1.8.4 code starts on the upgraded database (the new tables do not stop it)', pbLog.slice(fromOld).every((l) => !/panic/i.test(l)));
  const tokB = await signIn(players[1].email, pw);
  const meB = (await http('GET', '/api/prime/me', tokB)).j;
  check('after the way back: the accounts sign in, their saves are there', !!tokB && meB.id === players[1].id && meB.save?.revision === 2);
  const s4 = await putSave(tokB, { ...defaultSave(), coins: 2000 }, 2);
  check('…and PRIME CLOUD writes again on 1.8.4', s4.status === 200 && s4.j.revision === 3, JSON.stringify(s4.j).slice(0, 200));
  await stop();
  check('nothing was lost on the way back (accounts, profiles unchanged)', dbCounts(db).users === countsBefore.users && dbCounts(db).profiles === countsBefore.profiles && afterNew.length > 0);
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
    console.log(`\n${failed ? 'upgrade: FAILED' : 'upgrade: OK'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed ? 1 : 0);
  });
