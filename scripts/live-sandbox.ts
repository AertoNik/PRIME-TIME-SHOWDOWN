// Beta 2.7 — `npm run live:sandbox`: a LOCAL sandbox to play LIVE DUELS between two browser tabs on this computer.
//
//   PocketBase   a brand-new temporary database (deleted on exit) on 127.0.0.1:19290, role «dev», PRIME_LIVE=on,
//                PRIME_CASES / PRIME_MISSIONS on (the PRIME RIVALS mini case)
//   accounts     two made-up PRIME IDs (confirmed, documents accepted, a cloud career with several fighters); their
//                sign-ins are written to backend/.run/live-sandbox/acc-1.json and acc-2.json (git-ignored, 0600),
//                never printed — a dev page reads them itself (the Vite dev server serves the project folder)
//
// Then the game (another terminal / the preview «prime-sandbox-client»):
//   VITE_PRIME_ACCOUNTS=local VITE_PRIME_API_URL=http://127.0.0.1:19290 npx vite --mode accounts --port 5179 --strictPort
// and two origins = two separate browsers: http://localhost:5179 (account 1) and http://127.0.0.1:5179 (account 2).

import { binariesReady, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy, DEV_ORIGINS, ROOT } from './lib/backendKit';
import { crypto, fs, os, path, proc } from './lib/node';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 19290, smtp: 11929, mailUi: 19291 };
const API = `http://127.0.0.1:${PORTS.api}`;
const OUT = path.join(ROOT, 'backend', '.run', 'live-sandbox');
const log = (s: string) => console.log(s);
let pb: any = null;
let work = '';

async function call(method: string, url: string, token = '', body?: unknown): Promise<any> {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${url}: ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

async function main(): Promise<void> {
  if (!binariesReady()) throw new Error('npm run backend:install first');
  await ensurePortsFree([PORTS.api]);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-live-sandbox-'));
  const su = { email: 'live-sandbox@live.test', pw: crypto.randomBytes(18).toString('base64url') };
  const dataDir = path.join(work, 'pb_data');
  upsertSuperuser(dataDir, su.email, su.pw, PORTS);
  const drop = proc.argv.find((a) => a.startsWith('--drop='));
  pb = spawnPocketBase({
    dir: dataDir,
    ports: PORTS,
    origins: DEV_ORIGINS,
    env: {
      PRIME_REGISTRATION: 'public',
      PRIME_MAIL_LIMITS: 'relaxed',
      PRIME_POW_BITS: '10',
      PRIME_SERVER_ROLE: 'dev',
      PRIME_LIVE: 'on',
      PRIME_CASES: 'on',
      PRIME_MISSIONS: 'on',
      PRIME_LEAGUE: 'on',
      PRIME_LIVE_BUDGET_SCALE: '10',
      ...(drop ? { PRIME_LIVE_DROPMS: drop.slice(7) } : {}),
    },
  });
  const out: string[] = [];
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) out.push(l);
    if (out.length > 300) out.splice(0, out.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, out))) throw new Error('PocketBase did not start:\n' + out.slice(-10).join('\n'));
  const tok = (await call('POST', '/api/collections/_superusers/auth-with-password', '', { identity: su.email, password: su.pw })).token;
  const cfg = await call('GET', '/api/prime/config');
  fs.mkdirSync(OUT, { recursive: true });
  const people = [
    { nick: 'NeonHost', fighters: ['ray', 'bruno', 'nika', 'kai'] },
    { nick: 'GoldGuest', fighters: ['ray', 'vega', 'rina'] },
  ];
  for (let i = 0; i < people.length; i++) {
    const p = people[i];
    const email = `live-sandbox-${i + 1}@live.test`;
    const pw = 'Live' + crypto.randomBytes(9).toString('hex');
    const u = await call('POST', '/api/collections/users/records', tok, { email, password: pw, passwordConfirm: pw, verified: true });
    await call('POST', '/api/collections/profiles/records', tok, { user: u.id, nickname: p.nick, nicknameKey: p.nick.toLowerCase() });
    for (const d of ['terms', 'consent']) await call('POST', '/api/collections/consents/records', tok, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
    await call('POST', '/api/collections/consents/records', tok, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    const sv: any = defaultSave();
    for (const f of p.fighters) sv.fighters[f].unlocked = true;
    sv.money = 1500;
    sv.orgName = p.nick.toUpperCase() + ' STUDIO';
    sv.tutorial = 'done';
    const text = canonicalJSON(sv);
    await call('POST', '/api/collections/saves/records', tok, { owner: u.id, data: text, schema: 12, hash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), revision: 1, client: 'sandbox', reason: 'sandbox' });
    fs.writeFileSync(path.join(OUT, `acc-${i + 1}.json`), JSON.stringify({ email, password: pw, nick: p.nick }), { mode: 0o600 });
  }
  // the superuser too (the checks read the database through it; never printed)
  fs.writeFileSync(path.join(OUT, 'admin.json'), JSON.stringify(su), { mode: 0o600 });
  log(`\nПесочница LIVE DUELS готова (временная база: ${work}).`);
  log(`  API       ${API}  (роль dev, PRIME_LIVE=on${drop ? `, обрыв через ${drop.slice(7)} мс` : ''})`);
  log(`  аккаунты  NeonHost / GoldGuest — вход в ${OUT}/acc-1.json и acc-2.json (не печатается)`);
  log('  игра      VITE_PRIME_ACCOUNTS=local VITE_PRIME_API_URL=http://127.0.0.1:19290 npx vite --mode accounts --port 5179');
  log('            http://localhost:5179 и http://127.0.0.1:5179 — два разных «браузера»');
  log('Ctrl+C — остановить и удалить временную базу.');
  const warn = setInterval(() => {
    const bad = out.filter((l) => /ERROR|panic|TypeError|ReferenceError|differ/.test(l));
    if (bad.length) {
      log('[server] ' + bad.join('\n[server] '));
      out.length = 0;
    }
  }, 3000);
  const stop = async () => {
    clearInterval(warn);
    await stopChild(pb);
    try {
      fs.rmSync(work, { recursive: true, force: true });
      fs.rmSync(OUT, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    proc.exit(0);
  };
  proc.on('SIGINT', () => void stop());
  proc.on('SIGTERM', () => void stop());
}

main().catch(async (e) => {
  console.error(String((e as Error)?.stack ?? e));
  await stopChild(pb);
  proc.exit(1);
});
