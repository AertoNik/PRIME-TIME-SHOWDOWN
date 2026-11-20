// Beta 2.4 — a LOCAL demonstration server for REWARD CASES (dev only; npx tsx scripts/cases-demo.ts <dir>): a fresh
// PocketBase in <dir> on the dev port (127.0.0.1:8090) with REWARD CASES, referrals, PRIME LEAGUE and its tokens on, and
// two TEST accounts: «Demo Host» with three PRIME INVITE CASES waiting and «Demo Friend» (invited by the host, its hour
// of verified league play done) with one. Their passwords are written to <dir>/accounts.json — nothing is printed.
// For checking the game's screens with `npm run dev:accounts`; never touches backend/pb_data or any server.
import { DEV_ORIGINS, DEV_PORTS, LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, upsertSuperuser, waitHealthy } from './lib/backendKit';
import PocketBase from 'pocketbase';
import { crypto, fs, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const dir = path.resolve(proc.argv[2] ?? '');
if (!proc.argv[2] || fs.existsSync(path.join(dir, 'data.db'))) {
  console.log('usage: npx tsx scripts/cases-demo.ts <an empty folder>');
  proc.exit(1);
}
const API = `http://127.0.0.1:${DEV_PORTS.api}`;
let server: { kill(): void } | null = null;

async function main(): Promise<void> {
  if (!binariesReady()) throw new Error('npm run backend:install first');
  await ensurePortsFree([DEV_PORTS.api]);
  fs.mkdirSync(dir, { recursive: true });
  const su = { email: 'demo-admin@local.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dir, su.email, su.pw, DEV_PORTS);
  const forceFile = path.join(dir, 'force.txt');
  fs.writeFileSync(forceFile, '');
  const log: string[] = [];
  const pb = spawnPocketBase({ dir, ports: DEV_PORTS, origins: DEV_ORIGINS, env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_REFERRALS: 'on', PRIME_CASES: 'on', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_CASES_FORCE_FILE: forceFile, PRIME_GAME_URL: 'http://localhost:5173/', ...LEGACY_CHECK_ENV } });
  server = pb;
  pb.stdout.on('data', (b: unknown) => log.push(String(b)));
  pb.stderr.on('data', (b: unknown) => log.push(String(b)));
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, log))) throw new Error('PocketBase did not start:\n' + log.slice(-10).join(''));
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(su.email, su.pw);
  const accounts: Record<string, { email: string; password: string }> = {};
  const make = async (nick: string, email: string) => {
    const password = 'Demo2026' + crypto.randomBytes(6).toString('hex');
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password, passwordConfirm: password, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${String((await r.json().catch(() => ({}))).code ?? '')}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    accounts[nick] = { email, password };
    const c = new PocketBase(API);
    await c.collection('users').authWithPassword(email, password);
    return { id: u.id as string, token: c.authStore.token };
  };
  const host = await make('DemoHost', 'demo-host@local.test');
  const friend = await make('DemoFriend', 'demo-friend@local.test');
  const call = async (token: string, method: string, url: string, body?: unknown) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return (await r.json().catch(() => ({}))) as any;
  };
  const code = (await call(host.token, 'GET', '/api/prime/referral')).code;
  await call(friend.token, 'POST', '/api/prime/referral/claim', { code });
  const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${friend.id}"` }))[0];
  for (let i = 0; i < 49; i++)
    await admin.collection('league_matches').create({ attacker: friend.id, defKind: 'system', mode: 'duel', sim: 'a141348f2a0dea20', seed: 1, status: 'done', ranked: true, inputs: [[10, 0]], started: link.linkedAt + 1000 + i, expires: link.linkedAt + 300000, finished: link.linkedAt + 90000, outcome: 'win', method: 'ko', result: { duration: 75, cardsUsed: 3, steps: 4500 }, how: 'finish' });
  await call(host.token, 'GET', '/api/prime/referral');
  for (let i = 0; i < 2; i++) await admin.collection('prime_cases').create({ owner: host.id, kind: 'invite', ref: `demo:${i}`, source: 'inviter', status: 'ready', grantedAt: Date.now() + i, openedAt: 0, openOp: '', revision: 0, hash: '', tier: 0 });
  fs.writeFileSync(path.join(dir, 'accounts.json'), JSON.stringify({ accounts, forceFile }, null, 1));
  console.log(`cases demo ready on ${API} — accounts in ${path.join(dir, 'accounts.json')} (Ctrl+C stops)`);
  await new Promise(() => undefined);
}

main().catch((e) => {
  console.error(String(e));
  // never leave the demo server running after a failure
  server?.kill();
  proc.exit(1);
});
