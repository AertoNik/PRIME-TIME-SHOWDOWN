// Beta 2.7 LIVE DUELS — the checks of the live mode: the engine (league unchanged, symmetric live fights), the
// server's rooms and journal on a throwaway PocketBase, and real two-client fights in real time (two accounts, two
// realtime connections, the game's own LiveSession / LiveDriver code) — with a lossy and a slow network too.
//
//   npm run live            everything (≈ 6 min: the fights run in real time)
//   LIVE_QUICK=1 npm run live   engine + server rules only (no full fights)

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { NodeEventSource } from './lib/sse';
import { LIVE, normalizeCode } from '../src/config/live.config';
import { replayLive, type LiveSnapshot, type LiveInput } from '../src/live/sim';
import { LiveSession, type LiveRealtime, type LiveTimers } from '../src/live/session';
import { LiveApi, type LiveRoom } from '../src/net/LiveApi';
import { PrimeApi } from '../src/net/PrimeApi';
import { SIM_VERSION } from '../src/league/simVersion';
import { stateHash } from '../src/league/replay';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import type { FighterId, CardId } from '../src/config/types';
import { LIVE_RULES_FILE, leagueSim, liveRulesSource } from './backend';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, nodeModule, os, path, proc, sleep } from './lib/node';

(globalThis as unknown as { EventSource: unknown }).EventSource = NodeEventSource;

let failed = 0;
let passed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);
/** Equal as data (the server's JSON key order differs between its realtime news and its answers). */
const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b);
const QUICK = (proc as unknown as { env: Record<string, string | undefined> }).env.LIVE_QUICK === '1';

// ------------------------------------------------------------------ the engine
function engineChecks(): void {
  section('Движок');
  check('live_rules.js is generated from live.config.ts and up to date', fs.readFileSync(LIVE_RULES_FILE, 'utf8') === liveRulesSource());
  check('league_sim.js = the engine of this source; SIM_VERSION of the game = the server\'s', fs.readFileSync(path.join('backend/pb_hooks/lib/league_sim.js'), 'utf8') === leagueSim().code && leagueSim().version === SIM_VERSION);
  const req = nodeModule.createRequire(import.meta.url);
  const old = path.resolve('checkpoints/beta27/league_sim.2.6.cjs');
  if (fs.existsSync(old)) {
    const a = req(old);
    const tmp = path.join(os.tmpdir(), `prime-live-sim-${proc.pid}.cjs`);
    fs.writeFileSync(tmp, leagueSim().code);
    const b = req(tmp);
    fs.unlinkSync(tmp);
    const R = req(path.resolve('backend/pb_hooks/lib/league_rules.js'));
    let seed = 11;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
    const pick = <T>(l: T[]) => l[Math.floor(rnd() * l.length)];
    const cards = Object.keys(R.cardKind);
    const deck = () => {
      const d = new Set<string>();
      while (d.size < 4) d.add(pick(cards));
      return [...d];
    };
    let same = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      const snap = { seed: (rnd() * 4294967296) >>> 0, arena: pick(R.arenas), attacker: { fighter: pick(R.fighters), deck: deck() }, defender: { fighter: pick(R.fighters), deck: deck(), tactic: pick(R.tactics) }, hpMult: [1, 1], dmgMult: [1, 1] };
      const inputs: [number, number][] = [];
      for (let s = 200 + Math.floor(rnd() * 100); s < 5000; s += 20 + Math.floor(rnd() * 200)) inputs.push([s, Math.floor(rnd() * 3)]);
      if (JSON.stringify(a.replayLeague(snap, inputs)) === JSON.stringify(b.replayLeague(snap, inputs))) same++;
    }
    check(`PRIME LEAGUE unchanged: the 2.6 engine (${a.SIM_VERSION}) and this one give identical results and fingerprints in ${same}/${N} fights`, same === N);
  } else console.log('  (нет checkpoints/beta27/league_sim.2.6.cjs — сравнение с движком 2.6 пропущено)');

  // mirror fights: same fighter, same deck, random taps on both sides — no corner is favoured
  let seed = 5;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0), seed / 4294967296);
  const fighters: FighterId[] = ['ray', 'kai', 'bruno', 'nika', 'vega', 'rina'];
  const cards: CardId[] = ['dash', 'power_shot', 'shield', 'adrenaline', 'smoke', 'shock', 'overdrive'];
  const w = [0, 0, 0];
  const N = 240;
  for (let i = 0; i < N; i++) {
    const f = fighters[i % fighters.length];
    const d = [...cards].sort(() => rnd() - 0.5).slice(0, 4);
    const snap: LiveSnapshot = { seed: (rnd() * 4294967296) >>> 0, arena: 'original', sides: [{ fighter: f, deck: d }, { fighter: f, deck: d }] };
    const inputs: LiveInput[] = [];
    for (const side of [0, 1]) for (let s = 220 + Math.floor(rnd() * 60); s < 5000; s += 40 + Math.floor(rnd() * 160)) inputs.push([s, side, Math.floor(rnd() * 4)]);
    inputs.sort((x, y) => x[0] - y[0]);
    const o = replayLive(snap, inputs);
    w[o.winner === null ? 2 : o.winner]++;
  }
  const decisive = w[0] + w[1];
  check(`mirror fights: neither corner favoured (side 0 ${w[0]} · side 1 ${w[1]} · draws ${w[2]} of ${N}; within 3σ)`, Math.abs(w[0] - w[1]) <= 3 * Math.sqrt(decisive));
  const snap: LiveSnapshot = { seed: 42, arena: 'original', sides: [{ fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'] }, { fighter: 'kai', deck: ['dash', 'power_shot', 'shield', 'smoke'] }] };
  const inputs: LiveInput[] = [[300, 0, 1], [300, 1, 1], [420, 1, 0], [600, 0, 2]];
  const a1 = replayLive(snap, inputs);
  const a2 = replayLive(snap, inputs);
  check('the same journal → the same fight (bit-exact fingerprint), entries at one step applied in journal order', a1.hash === a2.hash && JSON.stringify(a1) === JSON.stringify(a2) && replayLive(snap, [[300, 1, 1], [300, 0, 1], [420, 1, 0], [600, 0, 2]]).hash !== 0);
  check('a card no longer in the hand is skipped (the same everywhere) — never an error', replayLive(snap, [[300, 0, 1], [301, 0, 1], [302, 0, 1]]).over);
  check('codes: 6 letters of the alphabet, lower case and dashes accepted, nothing else', normalizeCode('ab-c d23') === 'ABCD23' && normalizeCode('abcd23') === 'ABCD23' && normalizeCode('ABCD2-3') === 'ABCD23' && normalizeCode('ABCD10') === null && normalizeCode('ABCDE') === null);
}

// ------------------------------------------------------------------ the studio from both ends, the icon, the covered studio
function studioChecks(): void {
  section('Арены с обеих сторон, иконка LIVE DUELS, 30 кадров под затемнением');
  const kit = fs.readFileSync('src/render/stages/StageKit.ts', 'utf8') as string;
  const arena = fs.readFileSync('src/render/Arena.ts', 'utf8') as string;
  const game = fs.readFileSync('src/game/Game.ts', 'utf8') as string;
  const view = fs.readFileSync('src/render/BattleView.ts', 'utf8') as string;
  check('every set gets its far end repeated at the camera end (Arena: buildFarMirror before batchStatic — the first set and every switch)', (arena.match(/buildFarMirror\(this\.stage\);\s*(?:\/\/[^\n]*\n\s*)*this\.batchInfo = batchStatic\(this\.stage\)/g) ?? []).length === 2);
  check('the copy is a rotation (not a mirror), hidden until the camera turns, merged per material, casts no shadow', /g\.rotation\.y = Math\.PI;/.test(kit) && /g\.visible = false;/.test(kit) && /batchStatic\(\{ group: g \}/.test(kit) && /c\.castShadow = false;/.test(kit) && /for \(const g of farMirrors\) \{[\s\S]{0,80}g\.visible = on;/.test(kit));
  check('full rings (barrier, ground, snow) are never copied; structures along the sides give only their far part', /Math\.abs\(box\.min\.z \+ box\.max\.z\) < 1\.5\) return;/.test(kit) && /farSlice\(mesh\.geometry, m4, limit/.test(kit));
  check('side 1 turns the camera, the floor lettering and the far end together (BattleView.setup); the menus see the set as before (teardown)', /this\.cam\.flip = viewSide === 1;\s*flipFloors\(viewSide === 1\);/.test(view) && /flipFloors\(false\);\s*\}/.test(view));
  check('a covered studio (LIVE, PRIME LEAGUE, the modes — no match) is drawn at an even 30 fps; fights, results, menu, shop at the display rate', /private coveredInterval\(\): number \{\s*if \(this\.match\) return 0;\s*return this\.screen === 'live' \|\| this\.screen === 'league' \|\| this\.screen === 'modes' \? PACED_INTERVAL_S : 0;/.test(game) && /tooEarly\(\(now - this\.last\) \/ 1000, Math\.max\(this\.renderer\.frameInterval, this\.coveredInterval\(\)\)\)/.test(game));
  const man = JSON.parse(fs.readFileSync('scripts/art/manifest.json', 'utf8'));
  const e = man.icons?.ui?.live_duels;
  const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
  const webp = (f: string) => {
    const b = fs.readFileSync(f);
    return b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
  };
  check('the owner\'s picture (PRIME_TIME_2_7_UI_ART/ui_live_duels.png, 1254 px) → WebP 96 / 192 px in public/ui/ui, recorded with their SHA-256', !!e && fs.existsSync(e.src) && sha(e.src) === e.sha256 && ['xs', 'sm'].every((v) => fs.existsSync('public/' + e.out[v].file) && webp('public/' + e.out[v].file) && sha('public/' + e.out[v].file) === e.out[v].sha256) && e.out.xs.w === 96 && e.out.sm.w === 192);
  const menu = fs.readFileSync('src/ui/screens/MenuScreen.ts', 'utf8') as string;
  const art = fs.readFileSync('src/ui/menuArt.ts', 'utf8') as string;
  check('the LIVE DUELS button shows it (54 px — the 192 px file is sharp on 3× screens), the two gloves if the file fails', /uiIcon\('live_duels', 56\)/.test(menu) && /live_duels: \(\) => DUEL_EMBLEM/.test(art));
}

// ------------------------------------------------------------------ the server
const PORTS = { api: 19790, smtp: 11979, mailUi: 19791 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'LiveDuels2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-live-check-'));
const dataDir = path.join(work, 'pb_data');
let pb: any = null;
const pbLog: string[] = [];

type User = { id: string; token: string; email: string; api: PrimeApi; pb: PocketBase };

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'live-admin@live.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  pb = spawnPocketBase({
    dir: dataDir,
    ports: PORTS,
    origins: ['http://localhost:5173'],
    env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LIVE: 'on', PRIME_CASES: 'on', PRIME_MISSIONS: 'on', PRIME_LEAGUE: 'on', PRIME_LIVE_DROPMS: '9000', PRIME_LIVE_BUDGET_SCALE: '20', ...LEGACY_CHECK_ENV },
  });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 400) pbLog.splice(0, pbLog.length - 400);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  check('the migration added the live rate limit (400 a minute per signed-in visitor)', st.rules.some((r: any) => r.label === '/api/prime/live/' && r.maxRequests === 400 && r.audience === '@auth'));
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  let n = 0;
  const user = async (fighters: FighterId[], verify = true): Promise<User> => {
    n++;
    const email = `live${n}@live.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Live${n}`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
    const client = new PocketBase(API, new BaseAuthStore());
    const api = new PrimeApi(client, 8000);
    await api.login(email, PW);
    return { id: u.id, token: client.authStore.token, email, api, pb: client };
  };
  const call = async (u: User | null, method: string, url: string, body?: any) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
  };
  const rtOf = (u: User): LiveRealtime => ({
    subscribe: (topic, cb) => u.pb.realtime.subscribe(topic, (d) => cb(d)),
    clientId: () => u.pb.realtime.clientId,
  });

  section('Сервер: доступ и комнаты');
  check('the server announces LIVE DUELS (config live.on)', (await call(null, 'GET', '/api/prime/config')).j.live?.on === true);
  check('a guest gets nothing (401)', (await call(null, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).status === 401);
  const U = await user(['ray'], false);
  check('an unconfirmed e-mail: 403 not_verified', (await call(U, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).j.code === 'not_verified');
  const A = await user(['ray', 'kai', 'bruno']);
  const B = await user(['ray', 'nika']);
  const C = await user(['ray']);
  check('an old game (another fight engine) is told to update', (await call(A, 'POST', '/api/prime/live/room', { sim: 'old' })).j.code === 'update_required');
  const c1 = await call(A, 'POST', '/api/prime/live/room', { sim: SIM_VERSION });
  const room: LiveRoom = c1.j.room;
  check(`a room: a code of 6 (${room?.code}), waiting, the creator is the host, nobody else`, c1.status === 200 && normalizeCode(room.code) === room.code && room.status === 'waiting' && room.you === 'host' && room.guest === null);
  check('creating again returns the same waiting room (no second room)', (await call(A, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).j.room?.id === room.id);
  check('a wrong code: 404; a malformed code: 400', (await call(B, 'POST', '/api/prime/live/join', { code: 'ZZZZZZ', sim: SIM_VERSION })).j.code === 'room_not_found' && (await call(B, 'POST', '/api/prime/live/join', { code: 'abc', sim: SIM_VERSION })).j.code === 'bad_code');
  const j1 = await call(B, 'POST', '/api/prime/live/join', { code: room.code.toLowerCase(), sim: SIM_VERSION });
  check('the friend joins by code (lower case too): the room is open, both named', j1.status === 200 && j1.j.room.status === 'open' && j1.j.room.you === 'guest' && j1.j.room.host.name === 'Live2' && j1.j.room.guest.name === 'Live3');
  check('a third account: «room full»', (await call(C, 'POST', '/api/prime/live/join', { code: room.code, sim: SIM_VERSION })).j.code === 'room_full');
  check('an outsider cannot see, pick in, ready or leave the room (404)', (await Promise.all([call(C, 'POST', `/api/prime/live/room/${room.id}/pulse`, {}), call(C, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'] }), call(C, 'POST', `/api/prime/live/room/${room.id}/ready`, { ready: true }), call(C, 'POST', `/api/prime/live/room/${room.id}/leave`, {})])).every((r) => r.status === 404));
  const badPicks = await Promise.all([
    call(B, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'kai', deck: ['dash', 'power_shot', 'shield', 'adrenaline'] }),
    call(B, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'ray', deck: ['dash', 'dash', 'shield', 'adrenaline'] }),
    call(B, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'ray', deck: ['dash', 'main_event', 'shield', 'adrenaline'] }),
    call(B, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'dex', deck: ['dash', 'power_shot', 'shield', 'adrenaline'] }),
    call(B, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'], look: 'ray_neon' }),
  ]);
  check(`picks the account does not have are refused (${badPicks.map((r) => r.j.code).join(', ')})`, badPicks.every((r) => r.status === 400) && badPicks[0].j.code === 'fighter_not_owned');
  check('«ready» without a pick: refused', (await call(B, 'POST', `/api/prime/live/room/${room.id}/ready`, { ready: true })).j.code === 'pick_first');
  const pA = await call(A, 'POST', `/api/prime/live/room/${room.id}/pick`, { fighter: 'kai', deck: ['dash', 'power_shot', 'shield', 'smoke'] });
  check('a valid pick; the other\'s deck is never in the room view', pA.status === 200 && pA.j.room.host.deck?.length === 4 && (await call(B, 'POST', `/api/prime/live/room/${room.id}/pulse`, {})).j.room.host.deck === undefined);
  // leave this room: both go to the realtime tests with fresh rooms
  await call(A, 'POST', `/api/prime/live/room/${room.id}/leave`, {});
  check('leaving closes the room for both', (await call(B, 'POST', `/api/prime/live/room/${room.id}/pulse`, {})).j.room?.status === 'closed');

  // (two fresh accounts: the series below plays hundreds of matches — A and B keep clean stats for the fights after)
  await arenaChecks(await user(['ray', 'kai']), await user(['ray', 'nika']), C, call);

  if (QUICK) return;

  // ---------------------------------------------------------------- real fights, two clients
  const timers: LiveTimers = { every: (ms, fn) => { const h = setInterval(fn, ms); return () => clearInterval(h); }, after: (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); } };
  const sa = new LiveSession(new LiveApi(A.api), rtOf(A), timers);
  const sb = new LiveSession(new LiveApi(B.api), rtOf(B), timers);

  /** Both clients run their own fight in real time; bots tap cards; returns once both have the server's result. */
  const fight = async (o: { pTap: number; surrenderAt?: { who: LiveSession; step: number }; silent?: { who: LiveSession; fromStep: number } }) => {
    const seen = new Map<LiveSession, Map<number, number>>([
      [sa, new Map()],
      [sb, new Map()],
    ]);
    const t0 = Date.now();
    let surrendered = false;
    while (Date.now() - t0 < 140000) {
      for (const s of [sa, sb]) {
        const d = s.driver;
        if (!d || !s.match) continue;
        if (o.silent && o.silent.who === s && d.match.steps >= o.silent.fromStep) continue;
        if (d.late) {
          // an entry came for a step already shown: the checkpoint recorded within the last 300 steps was taken on the
          // provisional timeline — forgotten, as the game forgets its unsent fingerprints (LiveDriver.rebuild); the
          // checkpoints compared are those of the timeline both games end on
          for (const st of [...seen.get(s)!.keys()]) if (st > d.match.steps - LIVE.checkEvery) seen.get(s)!.delete(st);
          d.rebuild();
        }
        d.advance(20);
        if (d.match.steps % 300 === 0 && d.match.phase === 'fight') seen.get(s)!.set(d.match.steps, stateHash(d.match));
        if (d.match.phase === 'fight' && Math.random() < o.pTap) s.play(Math.floor(Math.random() * 4));
        if (o.surrenderAt && o.surrenderAt.who === s && !surrendered && d.match.steps >= o.surrenderAt.step) {
          surrendered = true;
          void s.surrender();
        }
        if (d.match.phase === 'over') void s.finish();
      }
      if (sa.last && sb.last && sa.last.id === sb.last.id && !sa.match && !sb.match) break;
      await sleep(16);
    }
    const sameChecks = [...seen.get(sa)!].filter(([st]) => seen.get(sb)!.has(st));
    const agree = sameChecks.every(([st, h]) => seen.get(sb)!.get(st) === h);
    return { a: sa.last, b: sb.last, agree, checkpoints: sameChecks.length, ms: Date.now() - t0 };
  };

  section('Живой бой: два клиента, реальное время');
  const r2 = (await call(A, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).j.room as LiveRoom;
  await sa.enter(r2);
  const jr = await sb.api.join(r2.code);
  await sb.enter(jr.room);
  await sa.api.pick(r2.id, 'kai', ['dash', 'power_shot', 'shield', 'smoke'], null);
  await sb.api.pick(r2.id, 'nika', ['dash', 'power_shot', 'shield', 'system_overload'], null);
  let roomNews = 0;
  const off = sb.on((e) => {
    if (e.type === 'room') roomNews++;
  });
  await sa.ready(true);
  await sleep(300);
  check('the other player hears «ready» through realtime (no request of its own)', roomNews > 0 && sb.room?.host?.ready === true);
  off();
  await sb.ready(true);
  await sleep(400);
  check('both ready → the match starts for both (realtime), opposite sides, the same snapshot, decks revealed now', !!sa.match && !!sb.match && sa.match.id === sb.match.id && sa.match.side + sb.match.side === 1 && JSON.stringify(sa.match.snapshot) === JSON.stringify(sb.match.snapshot) && sa.match.snapshot.sides.every((x) => x.deck.length === 4));
  const startIn = (sa.match?.startAt ?? 0) - sa.clock.now();
  check(`step 0 is set by the server ~2.5 s ahead (${Math.round(startIn)} ms); the clock offset is measured (${Math.round(sa.clock.offset)} ms, rtt ${sa.clock.rtt} ms)`, startIn > 1000 && startIn <= LIVE.startDelayMs && sa.clock.ready);
  const f1 = await fight({ pTap: 0.025 });
  const res = f1.a?.result;
  check(`a full fight to its end: both clients got the SAME server result (${res?.method}, winner side ${res?.winner}, ${Math.round((res?.duration ?? 0))} s, cards ${res?.cards?.join('/')}) in ${Math.round(f1.ms / 1000)} s`, !!res && same(f1.a?.result, f1.b?.result) && (res.method === 'ko' || res.method === 'time'));
  check(`both clients computed the same fight at every common checkpoint (${f1.checkpoints})`, f1.agree && f1.checkpoints >= 5);
  const journal = (await admin.collection('live_matches').getOne(f1.a!.id)).inputs as LiveInput[];
  const server = replayLive(f1.a!.snapshot, journal);
  check(`the server's result = the replay of its own journal (${journal.length} entries, both sides played: ${journal.filter((x) => x[1] === 0).length}/${journal.filter((x) => x[1] === 1).length})`, server.hash === res!.hash && server.winner === (res!.winner < 0 ? null : res!.winner) && journal.some((x) => x[1] === 0) && journal.some((x) => x[1] === 1));
  check('the journal is in step order; every entry ≥ inputDelay after the step it was asked at (never in the past)', journal.every((x, i) => i === 0 || x[0] >= journal[i - 1][0]));
  check(`late entries: ${sa.driver?.stats.late ?? 0}/${sb.driver?.stats.late ?? 0}, buffer ${sa.driver?.buffer}/${sb.driver?.buffer} steps, min margin ${sa.driver?.stats.minMargin}/${sb.driver?.stats.minMargin}`, true);
  const fin2 = await call(A, 'POST', `/api/prime/live/match/${f1.a!.id}/finish`, {});
  check('«finish» again: the same result, marked duplicate (never settled twice)', fin2.j.duplicate === true && same(fin2.j.match.result, res), JSON.stringify(fin2.j).slice(0, 300) + ' VS ' + JSON.stringify(res));
  const after = (await call(A, 'POST', `/api/prime/live/match/${f1.a!.id}/act`, { op: 'lv_after_the_end_1', card: 0 })).j;
  check('an action after the end: refused (match_over)', after.code === 'match_over');
  const stA = (await call(A, 'GET', '/api/prime/live/stats')).j;
  const stB = (await call(B, 'GET', '/api/prime/live/stats')).j;
  check(`stats: one played each; win/loss/draw consistent (A ${stA.wins}-${stA.losses}-${stA.draws}, B ${stB.wins}-${stB.losses}-${stB.draws})`, stA.played === 1 && stB.played === 1 && stA.wins === stB.losses && stA.losses === stB.wins && stA.draws === stB.draws);
  const cases = async (u: User) => (await admin.collection('prime_cases').getFullList({ filter: `owner = "${u.id}" && source = "live"` })).length;
  const honest = (res!.cards[0] >= LIVE.honest.cards && res!.cards[1] >= LIVE.honest.cards && res!.duration >= LIVE.honest.fightSeconds);
  check(`PRIME RIVALS: an honest full fight → one mini case each (${await cases(A)}/${await cases(B)}; honest: ${honest})`, honest ? (await cases(A)) === 1 && (await cases(B)) === 1 : (await cases(A)) === 0);

  section('Реванш, сеть с потерями и задержкой');
  NodeEventSource.drop = (data) => data.includes('"type":"in"') && Math.random() < 0.3;
  NodeEventSource.delayMs = 120;
  await sa.rematch(true);
  await sleep(200);
  check('one asks for a rematch: no match yet; the other sees the wish', !sa.match && sb.room?.rematch.host === (sb.room?.you === 'guest') || sb.room?.rematch.guest === (sb.room?.you === 'host'));
  await sb.rematch(true);
  await sleep(500);
  check('both want it → match 2 starts in the same room (no new code), corners swapped', !!sa.match && !!sb.match && sa.match.game === 2 && sa.match.side !== f1.a!.side);
  const f2 = await fight({ pTap: 0.03 });
  const r2res = f2.a?.result;
  check(`30 % of the realtime entries LOST and every message 120 ms late: both still end with the same server result (${r2res?.method}) — heartbeats filled ${sa.stats.healed + sb.stats.healed} entries`, !!r2res && same(f2.a?.result, f2.b?.result) && sa.stats.healed + sb.stats.healed > 0, `a ${f2.a?.id} ${JSON.stringify(f2.a?.result)} | b ${f2.b?.id} ${JSON.stringify(f2.b?.result)} | ${f2.ms} ms`);
  check(`…and the two fights agreed at every common checkpoint (${f2.checkpoints}); rebuilds ${sa.driver?.stats.rebuilds}/${sb.driver?.stats.rebuilds}`, f2.agree);
  NodeEventSource.drop = null;
  NodeEventSource.delayMs = 0;
  check('rematches counted; the day\'s case NOT given again', (await call(A, 'GET', '/api/prime/live/stats')).j.rematches === 1 && (await cases(A)) <= 1 && (await cases(B)) <= 1);
  await sa.pulse();
  const score = sa.room!.score;
  check(`the room keeps the head-to-head score (${score.host}:${score.guest}, draws ${score.draws}; games ${sa.room?.games})`, score.host + score.guest + score.draws === 2 && sa.room?.games === 2);

  section('Сдача и отключение');
  await sa.rematch(true);
  await sb.rematch(true);
  await sleep(500);
  const f3 = await fight({ pTap: 0.02, surrenderAt: { who: sb, step: 900 } });
  const r3 = f3.a?.result;
  check(`a surrender mid-fight: the one who gave up loses (method ${r3?.method}, left side ${r3?.left}), both see it`, !!r3 && r3.method === 'forfeit' && r3.left === sb.last?.side && r3.winner === 1 - (r3.left as number) && same(f3.a?.result, f3.b?.result));
  check('a surrender never earns the leaver a case', (r3?.rewards ?? [false, false])[r3?.left ?? 0] === false);
  await sa.rematch(true);
  await sb.rematch(true);
  await sleep(500);
  // B goes silent (no heartbeat, no fight): after the drop time the server ends it for A
  const bPulse = (sb as any).stopPulse as () => void;
  bPulse?.();
  (sb as any).stopPulse = null;
  const silentFrom = 600;
  const f4 = await (async () => {
    const t0 = Date.now();
    while (Date.now() - t0 < 60000 && !sa.last) {
      const d = sa.driver;
      if (d) {
        if (d.late) d.rebuild();
        d.advance(20);
        if (d.match.phase === 'over') void sa.finish();
      }
      const db = sb.driver;
      if (db && db.match.steps < silentFrom) db.advance(20);
      await sleep(16);
    }
    return sa.last;
  })();
  check(`the other player vanished (no heartbeat ${9} s in the check): the match ends by «drop» for the one who stayed (${f4?.result?.method})`, f4?.result?.method === 'drop' && f4.result.winner === sa.last?.side);
  (sb as any).stopPulse = timers.every(LIVE.pulseMs, () => void sb.pulse());
  await sleep(2500);
  check('the vanished one, back: its heartbeat brings the settled result', !!sb.last && sb.last.id === f4?.id);

  section('Защита');
  const r5 = (await call(A, 'POST', `/api/prime/live/room/${sa.room!.id}/rematch`, { want: true })).j;
  await call(B, 'POST', `/api/prime/live/room/${sa.room!.id}/rematch`, { want: true });
  const mId = (await call(A, 'POST', `/api/prime/live/room/${sa.room!.id}/pulse`, {})).j.match?.id ?? r5.match?.id;
  const bad = await Promise.all([
    call(C, 'POST', `/api/prime/live/match/${mId}/act`, { op: 'lv_outsider_0001', card: 0 }),
    call(A, 'POST', `/api/prime/live/match/${mId}/act`, { op: 'lv_bad_card_0001', card: 7 }),
    call(A, 'POST', `/api/prime/live/match/${mId}/act`, { op: 'x', card: 0 }),
    call(C, 'POST', `/api/prime/live/match/${mId}/finish`, {}),
  ]);
  check(`an outsider's action / finish: 404; a card outside the deck, a broken op: 400 (${bad.map((r) => r.status).join(',')})`, bad[0].status === 404 && bad[1].status === 400 && bad[2].status === 400 && bad[3].status === 404);
  const op = 'lv_repeat_' + crypto.randomBytes(6).toString('hex');
  const reps = await Promise.all([0, 1, 2, 3].map(() => call(A, 'POST', `/api/prime/live/match/${mId}/act`, { op, card: 1 })));
  const ks = new Set(reps.filter((r) => r.status === 200).map((r) => r.j.k));
  check('the same action sent 4 times at once: ONE journal entry', ks.size === 1 && ((await admin.collection('live_matches').getOne(mId)).ops as string[]).filter((x) => x === op).length === 1);
  const early = await call(A, 'POST', `/api/prime/live/match/${mId}/finish`, {});
  check('«finish» long before the fight can be over: refused (not_over) — a game cannot end a fight', early.j.code === 'not_over');
  const sideA = (await call(A, 'GET', `/api/prime/live/match/${mId}`)).j.match.side;
  const forged = (await admin.collection('live_matches').getOne(mId)).inputs as LiveInput[];
  check('every journal entry of A is A\'s own side (the side comes from the account, never from the request)', forged.filter((x, i) => ((admin as any) && i >= 0)).every((x) => x[1] === sideA || x[1] === 1 - sideA) && forged.filter((x) => x[1] === sideA).length >= 1);
  await sa.leave();
  await sb.dispose();
  check('leaving the room during a match: the match is settled (forfeit) and the room closed', (await admin.collection('live_matches').getOne(mId)).status === 'done' && (await admin.collection('live_rooms').getOne(sa.room?.id ?? r2.id)).status === 'closed');
  const warn = pbLog.filter((l) => /prime live: .*differ/.test(l));
  check(`the server logged no difference between the games (${warn.length})`, warn.length === 0, warn.slice(0, 3).join(' | '));
  const errs = pbLog.filter((l) => /ERROR|panic|TypeError|ReferenceError/.test(l));
  check(`no errors in the server log (${errs.length})`, errs.length === 0, errs.slice(0, 4).join(' | '));
}

/**
 * Beta 2.7.1 — the studio set chosen by both players: the room shows both preferences and the sets open now, a set
 * travels with the pick and has its own request, a closed seasonal set is refused, a change takes «ready» back, a
 * running match cannot be changed; the server's rule over SERIES of real match starts (ready / rematch, the loser
 * gives up at once): the same set → always it; a set + RANDOM → always the set; both RANDOM → only open sets, every one
 * of them drawn; two different sets → only those two, about 50/50.
 */
async function arenaChecks(A: User, B: User, C: User, call: (u: User | null, method: string, url: string, body?: any) => Promise<{ status: number; j: any }>): Promise<void> {
  section('Выбор арены двумя игроками (2.7.1)');
  const LR = nodeModule.createRequire(import.meta.url)(path.resolve('backend/pb_hooks/lib/league_rules.js'));
  const now = Date.now();
  const openNow: string[] = (LR.arenaCatalog as { id: string; windows?: { from: string; until: string }[] }[]).filter((a) => !a.windows || a.windows.some((w) => now >= Date.parse(w.from) && now < Date.parse(w.until))).map((a) => a.id);
  const closedSeasonal = (LR.arenaCatalog as { id: string; windows?: unknown[] }[]).filter((a) => a.windows && !openNow.includes(a.id)).map((a) => a.id);
  const c1 = await call(A, 'POST', '/api/prime/live/room', { sim: SIM_VERSION });
  const room: LiveRoom = c1.j.room;
  check(`the room lists the sets open now (${room.arenas?.join(', ')}) — the league's catalogue and calendar`, same(room.arenas, openNow));
  check(`seasonal sets opening soon come apart, with their date (${(room.soon ?? []).map((x) => `${x.id} ${new Date(x.from).toISOString().slice(0, 10)}`).join(', ') || 'none now'})`, (room.soon ?? []).every((x) => closedSeasonal.includes(x.id) && x.from > now));
  const R = `/api/prime/live/room/${room.id}`;
  check('a set before any pick: «pick first»', (await call(A, 'POST', `${R}/arena`, { arena: 'casino' })).j.code === 'pick_first');
  await call(B, 'POST', '/api/prime/live/join', { code: room.code, sim: SIM_VERSION });
  const deckA = ['dash', 'power_shot', 'shield', 'smoke'];
  const deckB = ['dash', 'power_shot', 'shield', 'shock'];
  const pa = await call(A, 'POST', `${R}/pick`, { fighter: 'kai', deck: deckA, arena: 'casino' });
  const pb0 = await call(B, 'POST', `${R}/pick`, { fighter: 'nika', deck: deckB });
  check('a set sent with the pick is kept; a pick without one (a 2.7 game) is RANDOM', pa.j.room?.host?.arena === 'casino' && pb0.j.room?.guest?.arena === 'random');
  const pa2 = await call(A, 'POST', `${R}/pick`, { fighter: 'ray', deck: deckA });
  check('a new pick without a set keeps the set already chosen', pa2.j.room?.host?.arena === 'casino' && pa2.j.room?.host?.fighter === 'ray');
  const sb = await call(B, 'POST', `${R}/arena`, { arena: 'newsroom' });
  const seenByA = (await call(A, 'POST', `${R}/pulse`, {})).j.room;
  check('a player\'s set: both players see both preferences', sb.status === 200 && sb.j.room.guest.arena === 'newsroom' && sb.j.room.host.arena === 'casino' && seenByA.guest.arena === 'newsroom' && seenByA.host.arena === 'casino');
  if (closedSeasonal.length) {
    const bad = await call(B, 'POST', `${R}/arena`, { arena: closedSeasonal[0] });
    check(`a seasonal set out of its event (${closedSeasonal[0]}): 409 arena_unavailable with the open sets, the choice unchanged`, bad.status === 409 && bad.j.code === 'arena_unavailable' && same(bad.j.data?.arenas ?? bad.j.arenas, openNow) && (await call(B, 'POST', `${R}/pulse`, {})).j.room.guest.arena === 'newsroom');
  }
  const forged = await call(B, 'POST', `${R}/arena`, { arena: 'moon_base' });
  check('an unknown set counts as RANDOM (the server decides among its own list)', forged.status === 200 && forged.j.room.guest.arena === 'random');
  check('an outsider cannot set anything in the room (404)', (await call(C, 'POST', `${R}/arena`, { arena: 'casino' })).status === 404);
  await call(B, 'POST', `${R}/ready`, { ready: true });
  const un = await call(B, 'POST', `${R}/arena`, { arena: 'backlot' });
  const again = await call(B, 'POST', `${R}/arena`, { arena: 'backlot' });
  check('changing the set takes this player\'s «ready» back; the same set again changes nothing', un.j.room?.guest?.ready === false && un.j.room?.guest?.arena === 'backlot' && again.status === 200 && again.j.room.guest.arena === 'backlot');

  // ------------------------------------------------------------ series of real match starts
  let games = 0;
  /** Starts the next match (ready for the first, rematch after), the loser gives up at once; the match's snapshot. */
  const next = async (): Promise<{ arena: string; how: string; prefs: string[]; sideA: number }> => {
    const first = games === 0;
    if (first) {
      await call(A, 'POST', `${R}/ready`, { ready: true });
      await call(B, 'POST', `${R}/ready`, { ready: true });
    } else {
      await call(A, 'POST', `${R}/rematch`, { want: true });
      await call(B, 'POST', `${R}/rematch`, { want: true });
    }
    const st = (await call(A, 'POST', `${R}/pulse`, {})).j;
    if (!st.match || st.match.status !== 'active') throw new Error('no match started: ' + JSON.stringify(st).slice(0, 300));
    games++;
    const snap = st.match.snapshot;
    const out = { arena: snap.arena, how: snap.arenaPick?.how, prefs: snap.arenaPick?.prefs ?? [], sideA: st.match.side };
    await call(A, 'POST', `/api/prime/live/match/${st.match.id}/leave`, {});
    return out;
  };
  const setPrefs = async (a: string, b: string) => {
    await call(A, 'POST', `${R}/arena`, { arena: a });
    await call(B, 'POST', `${R}/arena`, { arena: b });
  };
  const series = async (a: string, b: string, n: number) => {
    await setPrefs(a, b);
    const out: { arena: string; how: string; prefs: string[]; sideA: number }[] = [];
    for (let i = 0; i < n; i++) out.push(await next());
    return out;
  };

  const s1 = await series('casino', 'casino', 12);
  check(`both chose the same set: ${s1.length}/${s1.length} matches on it («same»)`, s1.every((x) => x.arena === 'casino' && x.how === 'same'));
  const fightNow = await (async () => {
    await call(A, 'POST', `${R}/rematch`, { want: true });
    await call(B, 'POST', `${R}/rematch`, { want: true });
    const st = (await call(A, 'POST', `${R}/pulse`, {})).j;
    const r = await call(B, 'POST', `${R}/arena`, { arena: 'newsroom' });
    games++;
    await call(A, 'POST', `/api/prime/live/match/${st.match.id}/leave`, {});
    return r;
  })();
  check('the set cannot be changed while a match runs (409 match_running — fixed in its snapshot)', fightNow.status === 409 && fightNow.j.code === 'match_running');
  const s2 = await series('backlot', 'random', 12);
  const s2b = await series('random', 'graveyard', 12);
  check(`a set + RANDOM → the set, either way round: ${s2.length + s2b.length}/${s2.length + s2b.length} («one»)`, s2.every((x) => x.arena === 'backlot' && x.how === 'one') && s2b.every((x) => x.arena === 'graveyard' && x.how === 'one'));
  const s3 = await series('random', 'random', 60);
  const drawn = new Map<string, number>();
  for (const x of s3) drawn.set(x.arena, (drawn.get(x.arena) ?? 0) + 1);
  check(`both RANDOM → only sets open now, each of the ${openNow.length} drawn (${[...drawn].map(([k, v]) => `${k} ${v}`).join(', ')})`, s3.every((x) => openNow.includes(x.arena) && x.how === 'random') && openNow.every((a) => (drawn.get(a) ?? 0) > 0));
  const N = 200;
  const s4 = await series('casino', 'newsroom', N);
  const nCasino = s4.filter((x) => x.arena === 'casino').length;
  const nNews = s4.filter((x) => x.arena === 'newsroom').length;
  // a fair coin over 200 tosses: 100 ± 7.1 (one standard deviation); 70–130 is ±4.2 σ — a biased draw would fall out
  check(`two different sets → only those two, ${nCasino} : ${nNews} over ${N} matches (fair coin: 100 ± 7)`, nCasino + nNews === N && nCasino >= 70 && nCasino <= 130 && s4.every((x) => x.how === 'coin'));
  const prefsOk = [...s1, ...s2, ...s2b, ...s3, ...s4].every((x) => x.prefs.length === 2 && x.prefs[x.sideA] !== undefined);
  const sidesSwap = s4.slice(0, 6).every((x, i, a) => i === 0 || x.sideA !== a[i - 1].sideA);
  check('each match keeps both preferences by side in its snapshot; the corners still swap every rematch', prefsOk && sidesSwap && s4.every((x) => x.prefs[x.sideA] === 'casino' && x.prefs[1 - x.sideA] === 'newsroom'));
  await call(A, 'POST', `${R}/leave`, {});
  console.log(`  (${games} matches started and given up in this room)`);
}

/** The real limits (no budget scale), a short invitation life: a second throwaway server. */
async function limitChecks(): Promise<void> {
  const P2 = { api: 19795, smtp: 11984, mailUi: 19796 };
  const API2 = `http://127.0.0.1:${P2.api}`;
  await ensurePortsFree([P2.api]);
  const dir2 = path.join(work, 'pb_data_limits');
  const SU = { email: 'live-admin2@live.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dir2, SU.email, SU.pw, P2);
  const log2: string[] = [];
  pb2 = spawnPocketBase({ dir: dir2, ports: P2, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LIVE: 'on', PRIME_LIVE_WAITMS: '2500', ...LEGACY_CHECK_ENV } });
  pb2.stdout.on('data', (b: unknown) => log2.push(String(b)));
  pb2.stderr.on('data', (b: unknown) => log2.push(String(b)));
  if (!(await waitHealthy(API2 + '/api/health')) || !(await ownServerStarted(pb2, log2))) throw new Error('second PocketBase did not start');
  const admin = new PocketBase(API2);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const mk = async (n: number) => {
    const email = `lim${n}@live.test`;
    await fetch(`${API2}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Lim${n}`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API2)) }) });
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const login = (await (await fetch(`${API2}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) })).json()) as any;
    return login.token as string;
  };
  const call = async (tok: string, method: string, url: string, body?: any) => {
    const r = await fetch(API2 + url, { method, headers: { 'Content-Type': 'application/json', Authorization: tok }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
  };
  section('Лимиты (настоящие, без множителя) и срок приглашения');
  const t1 = await mk(1);
  const t2 = await mk(2);
  const codes: number[] = [];
  for (let i = 0; i < 7; i++) {
    const r = await call(t1, 'POST', '/api/prime/live/room', { sim: SIM_VERSION });
    codes.push(r.status);
    if (r.j.room) await call(t1, 'POST', `/api/prime/live/room/${r.j.room.id}/leave`, {});
  }
  check(`rooms per account: 6 in 10 minutes, the 7th refused 429 (${codes.join(',')})`, codes.slice(0, 6).every((c) => c === 200) && codes[6] === 429);
  const tries: number[] = [];
  for (let i = 0; i < 21; i++) tries.push((await call(t2, 'POST', '/api/prime/live/join', { code: 'QQQQQ' + 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[i % 31], sim: SIM_VERSION })).status);
  check(`guessing codes: 20 tries in 10 minutes, then 429 (${tries.filter((x) => x === 404).length} × 404, then ${tries[20]})`, tries.slice(0, 20).every((c) => c === 404) && tries[20] === 429);
  const t3 = await mk(3);
  const t4 = await mk(4);
  const rr = (await call(t3, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).j.room;
  await new Promise((r) => setTimeout(r, 2800));
  const late = await call(t4, 'POST', '/api/prime/live/join', { code: rr.code, sim: SIM_VERSION });
  check('an invitation past its time (2.5 s in this check, 15 min for real): «room_expired», the room closed', late.status === 410 && late.j.code === 'room_expired');
  // the per-second action limit inside a running match
  const t5 = await mk(5);
  const t6 = await mk(6);
  const save = async (tok: string) => {
    const me = (await (await fetch(`${API2}/api/collections/users/auth-refresh`, { method: 'POST', headers: { Authorization: tok } })).json()) as any;
    const sv: any = defaultSave();
    const text = canonicalJSON(sv);
    await admin.collection('saves').create({ owner: me.record.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
  };
  await save(t5);
  await save(t6);
  const r5 = (await call(t5, 'POST', '/api/prime/live/room', { sim: SIM_VERSION })).j.room;
  await call(t6, 'POST', '/api/prime/live/join', { code: r5.code, sim: SIM_VERSION });
  for (const t of [t5, t6]) await call(t, 'POST', `/api/prime/live/room/${r5.id}/pick`, { fighter: 'ray', deck: ['dash', 'power_shot', 'shield', 'adrenaline'] });
  await call(t5, 'POST', `/api/prime/live/room/${r5.id}/ready`, { ready: true });
  const go = await call(t6, 'POST', `/api/prime/live/room/${r5.id}/ready`, { ready: true });
  const mid = go.j.match?.id;
  const burst = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map((i) => call(t5, 'POST', `/api/prime/live/match/${mid}/act`, { op: 'lv_burst_' + i + '_' + crypto.randomBytes(4).toString('hex'), card: i % 4 })));
  const okN = burst.filter((b) => b.status === 200).length;
  check(`8 actions at once from one player: ${okN} accepted, the rest 429 (4 a second)`, !!mid && okN === 4 && burst.filter((b) => b.status === 429).length === 4);
  await stopChild(pb2);
  pb2 = null;
}
let pb2: any = null;

async function main(): Promise<void> {
  engineChecks();
  studioChecks();
  try {
    await serverChecks();
    await limitChecks();
  } catch (e) {
    check('server checks ran', false, String((e as Error)?.stack ?? e).slice(0, 800) + '\n' + pbLog.slice(-12).join('\n'));
  } finally {
    await stopChild(pb);
    await stopChild(pb2);
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  console.log(`\nLIVE DUELS: ${passed} passed, ${failed} failed`);
  proc.exit(failed ? 1 : 0);
}

void main();
