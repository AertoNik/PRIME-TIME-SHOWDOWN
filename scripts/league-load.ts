// Alpha 1.9.0 — `npm run league:load`: a SMALL local load check of PRIME LEAGUE (never against a real server).
//
// A temporary PocketBase on 127.0.0.1 (deleted at the end) with 12 synthetic participants. Measures the server's replay:
//   1. 20 finishes one after another;
//   2. 8 finishes at the same moment (8 accounts), while health, the config, the table and a profile are read;
// and prints min / median / p95 / max, errors, the PocketBase process CPU and memory. The numbers are this Mac's, not
// the VPS's (a Timeweb vCPU is slower): STAGING repeats it with the same script parameters after permission.

import PocketBase from 'pocketbase';
import { FIGHTERS } from '../src/config/fighters';
import { LEAGUE } from '../src/config/league.config';
import type { FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { replayLeague, type LeagueInput, type LeagueSnapshot } from '../src/league/replay';
import { SIM_VERSION } from '../src/league/simVersion';
import { Match } from '../src/combat/Match';
import { leagueConfig } from '../src/league/replay';
import { comboBot, type BotState } from './bots';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { cp, crypto, fs, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PORTS = { api: 19790, smtp: 11979, mailUi: 19791 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'LeagueLoad2026';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-league-load-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
let clock = Date.parse(LEAGUE.season.epoch) + 86400000;
fs.writeFileSync(clockFile, String(clock));
const tick = (ms: number) => fs.writeFileSync(clockFile, String((clock += ms)));
let pb: any = null;
const log: string[] = [];

const stats = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return `n=${s.length} min ${s[0]} · median ${q(0.5)} · p95 ${q(0.95)} · max ${s[s.length - 1]} ms`;
};
async function call(tok: string, method: string, p: string, body?: unknown): Promise<{ status: number; j: any; ms: number }> {
  const t = performance.now();
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { status: r.status, j, ms: Math.round(performance.now() - t) };
}
function botTaps(s: LeagueSnapshot): LeagueInput[] {
  const m = new Match(leagueConfig(s));
  const taps: LeagueInput[] = [];
  const orig = m.playCard.bind(m);
  m.playCard = (side, i) => {
    if (side === 0) taps.push([m.steps, i]);
    return orig(side, i);
  };
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  while (m.phase !== 'over' && m.steps < 6000) {
    comboBot(m, st, 1 / 60);
    m.step(1 / 60);
    m.drainEvents();
  }
  return taps;
}
const snapOf = (m: any): LeagueSnapshot => ({ seed: m.seed, arena: m.arena, attacker: m.attacker, defender: m.defender, hpMult: m.hpMult, dmgMult: m.dmgMult });
function usage(): string {
  const r = cp.spawnSync('ps', ['-o', '%cpu=,rss=', '-p', String(pb.pid)], { encoding: 'utf8' });
  const [cpu, rss] = String(r.stdout).trim().split(/\s+/);
  return `CPU ${cpu}% · RSS ${Math.round(Number(rss) / 1024)} MB`;
}

async function main(): Promise<void> {
  if (!binariesReady()) throw new Error('PocketBase is not installed (npm run backend:install)');
  await ensurePortsFree([PORTS.api]);
  const SU = { email: 'load-admin@league.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_CLOCK_FILE: clockFile, PRIME_LEAGUE_SEASON_START: '2026-11-02', ...LEGACY_CHECK_ENV } });
  pb.stdout.on('data', (b: unknown) => log.push(String(b)));
  pb.stderr.on('data', (b: unknown) => log.push(String(b)));
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, log))) throw new Error('PocketBase did not start');
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const fighters: FighterId[] = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina'];
  const users: { id: string; tok: string; f: FighterId }[] = [];
  for (let i = 0; i < 12; i++) {
    const email = `load${i}@league.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Load${i}x`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error('register ' + (await r.text()));
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'load' });
    const c = new PocketBase(API);
    await c.collection('users').authWithPassword(email, PW);
    const f = fighters[i % fighters.length];
    users.push({ id: u.id, tok: c.authStore.token, f });
    await call(c.authStore.token, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
    await call(c.authStore.token, 'PUT', '/api/prime/league/defense', { slots: [{ slot: 1, fighter: f, deck: FIGHTERS[f].defaultDeck, tactic: 'balance', enabled: true }] });
  }
  const errors: string[] = [];
  const startFor = async (u: (typeof users)[number]) => {
    const r = await call(u.tok, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: u.f, deck: FIGHTERS[u.f].defaultDeck, sim: SIM_VERSION, op: 'load_' + crypto.randomBytes(8).toString('hex') });
    if (r.status !== 200) throw new Error('start ' + r.status + ' ' + JSON.stringify(r.j));
    return r.j.match;
  };

  // 1. 20 finishes in a row
  const seq: number[] = [];
  let same = 0;
  for (let i = 0; i < 20; i++) {
    const u = users[i % users.length];
    const m = await startFor(u);
    const taps = botTaps(snapOf(m));
    const out = replayLeague(snapOf(m), taps);
    tick(Math.ceil((out.steps / 60) * 1000) + 1000);
    const r = await call(u.tok, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: taps });
    if (r.status !== 200) errors.push(`seq ${r.status} ${r.j?.code}`);
    else if (r.j.match.result?.hash === out.hash) same++;
    seq.push(r.ms);
  }
  console.log(`1. 20 finishes in a row: ${stats(seq)} · server = game ${same}/20 · ${usage()}`);

  // 2. 8 finishes at once while other reads go on
  const eight = users.slice(0, 8);
  const ms = await Promise.all(eight.map((u) => startFor(u)));
  const tapsAll = ms.map((m) => botTaps(snapOf(m)));
  tick(120000);
  const reads: number[] = [];
  let reading = true;
  const reader = (async () => {
    while (reading) {
      const rs = await Promise.all([call('', 'GET', '/api/health'), call('', 'GET', '/api/prime/config'), call(users[9].tok, 'GET', '/api/prime/league/board'), call(users[10].tok, 'GET', '/api/prime/league/me')]);
      for (const r of rs) {
        reads.push(r.ms);
        if (r.status !== 200) errors.push(`read ${r.status}`);
      }
    }
  })();
  let peak = '';
  const sampler = setInterval(() => {
    peak = usage();
  }, 400);
  const par = await Promise.all(eight.map((u, i) => call(u.tok, 'POST', `/api/prime/league/match/${ms[i].id}/finish`, { inputs: tapsAll[i] })));
  reading = false;
  await reader;
  clearInterval(sampler);
  for (const r of par) if (r.status !== 200) errors.push(`par ${r.status} ${r.j?.code}`);
  const once = (await admin.collection('league_matches').getFullList({ filter: 'status = "done"' })).length;
  console.log(`2. 8 finishes at once: ${stats(par.map((r) => r.ms))} · ${peak} (sampled during)`);
  console.log(`   meanwhile health / config / table / profile: ${stats(reads)}`);
  console.log(`   matches settled ${once} (expected 28), errors ${errors.length}${errors.length ? ': ' + errors.slice(0, 5).join(', ') : ''}`);
  proc.exitCode = errors.length || once !== 28 ? 1 : 0;
}

main()
  .catch((e) => {
    console.log('league:load FAILED — ' + String(e).slice(0, 300));
    proc.exitCode = 1;
  })
  .finally(async () => {
    if (pb) await stopChild(pb);
    await sleep(200);
    fs.rmSync(work, { recursive: true, force: true });
    console.log('временная база удалена');
  });
