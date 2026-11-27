// Beta 2.7 — LIVE DUELS over the INTERNET against STAGING (its public HTTPS address, Caddy, PocketBase realtime): two
// test accounts made for this run through STAGING's admin API (reached by an SSH tunnel), two clients running the
// game's own LiveSession / LiveDriver code from this computer, real fights in real time. The test accounts are deleted
// at the end (their rooms, matches, stats and mini cases go with them). Prints no password or token.
//
//   PRIME_REMOTE_PUBLIC=https://… PRIME_REMOTE_ADMIN=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/live-remote.ts

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { NodeEventSource } from './lib/sse';
import { replayLive, type LiveInput } from '../src/live/sim';
import { LiveSession, type LiveRealtime, type LiveTimers } from '../src/live/session';
import { LiveApi, type LiveRoom } from '../src/net/LiveApi';
import { PrimeApi } from '../src/net/PrimeApi';
import { stateHash } from '../src/league/replay';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { crypto, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as unknown as { EventSource: unknown }).EventSource = NodeEventSource;

const PUBLIC = proc.env.PRIME_REMOTE_PUBLIC ?? '';
const ADMIN = proc.env.PRIME_REMOTE_ADMIN ?? '';
const SU = { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' };
if (!/^https:\/\//.test(PUBLIC) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(ADMIN) || !SU.email || !SU.pw) {
  console.log('usage: PRIME_REMOTE_PUBLIC=https://… PRIME_REMOTE_ADMIN=http://127.0.0.1:<port> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/live-remote.ts');
  proc.exit(1);
}
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);
const same = (a: unknown, b: unknown) => canonicalJSON(a) === canonicalJSON(b);
const q = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN);
const PW = 'Remote27' + crypto.randomBytes(8).toString('hex');
const tag = crypto.randomBytes(3).toString('hex');

async function main(): Promise<void> {
  const admin = new PocketBase(ADMIN);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const cfg = (await (await fetch(PUBLIC + '/api/prime/config')).json()) as any;
  section(`STAGING ${PUBLIC}`);
  check('the server runs LIVE DUELS and this game\'s fight engine (config)', cfg.live?.on === true);
  // the HTTPS round trip from here (a warm connection)
  const rtts: number[] = [];
  for (let i = 0; i < 8; i++) {
    const a = performance.now();
    await fetch(PUBLIC + '/api/health');
    rtts.push(performance.now() - a);
  }
  console.log(`  HTTPS /api/health: p50 ${q(rtts.slice(1), 0.5).toFixed(0)} ms, max ${Math.max(...rtts.slice(1)).toFixed(0)} ms (first, with the handshake: ${rtts[0].toFixed(0)} ms)`);

  const made: string[] = [];
  const user = async (n: number, fighters: string[]) => {
    const email = `live-remote-${tag}-${n}@live.test`;
    const u = await admin.collection('users').create({ email, password: PW, passwordConfirm: PW, verified: true });
    made.push(u.id);
    await admin.collection('profiles').create({ user: u.id, nickname: `Remote${tag}${n}`, nicknameKey: `remote${tag}${n}` });
    for (const d of ['terms', 'consent']) await admin.collection('consents').create({ user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
    await admin.collection('consents').create({ user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
    const sv: any = defaultSave();
    for (const f of fighters) sv.fighters[f].unlocked = true;
    const text = canonicalJSON(sv);
    await admin.collection('saves').create({ owner: u.id, data: text, schema: 12, hash: crypto.createHash('sha256').update(text, 'utf8').digest('hex'), revision: 1, client: 'live-remote', reason: 'test' });
    const client = new PocketBase(PUBLIC, new BaseAuthStore());
    const api = new PrimeApi(client, 15000);
    await api.login(email, PW);
    return { id: u.id, api, pb: client };
  };
  try {
    const A = await user(1, ['ray', 'bruno', 'kai']);
    const B = await user(2, ['ray', 'nika']);
    const rtOf = (u: { pb: PocketBase }): LiveRealtime => ({ subscribe: (t, cb) => u.pb.realtime.subscribe(t, (d) => cb(d)), clientId: () => u.pb.realtime.clientId });
    const timers: LiveTimers = { every: (ms, fn) => { const h = setInterval(fn, ms); return () => clearInterval(h); }, after: (ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); } };
    const sa = new LiveSession(new LiveApi(A.api), rtOf(A), timers);
    const sb = new LiveSession(new LiveApi(B.api), rtOf(B), timers);
    // the delivery time of every realtime action: local arrival − the server's send time (on the estimated clock)
    const delivery: number[] = [];
    for (const s of [sa, sb]) {
      const orig = (s as any).onMessage.bind(s);
      (s as any).onMessage = (raw: any) => {
        const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (m && m.type === 'in' && typeof m.t === 'number') delivery.push(Date.now() + s.clock.offset - m.t);
        orig(raw);
      };
    }
    const fight = async (o: { pTap: number; surrender?: { who: LiveSession; step: number } }) => {
      const seen = new Map<LiveSession, Map<number, number>>([
        [sa, new Map()],
        [sb, new Map()],
      ]);
      const t0 = Date.now();
      const lastTap = new Map<LiveSession, number>();
      let given = false;
      while (Date.now() - t0 < 150000) {
        for (const s of [sa, sb]) {
          const d = s.driver;
          if (!d || !s.match) continue;
          if (d.late) d.rebuild();
          d.advance(20);
          if (d.match.steps % 300 === 0 && d.match.phase === 'fight') seen.get(s)!.set(d.match.steps, stateHash(d.match));
          // (a person: not more often than every 0.35 s — the server takes 4 a second)
          if (d.match.phase === 'fight' && Math.random() < o.pTap && Date.now() - (lastTap.get(s) ?? 0) > 350 && s.play(Math.floor(Math.random() * 4))) lastTap.set(s, Date.now());
          if (o.surrender && o.surrender.who === s && !given && d.match.steps >= o.surrender.step) {
            given = true;
            void s.surrender();
          }
          if (d.match.phase === 'over') void s.finish();
        }
        if (sa.last && sb.last && sa.last.id === sb.last.id && !sa.match && !sb.match) break;
        await sleep(16);
      }
      const common = [...seen.get(sa)!].filter(([st]) => seen.get(sb)!.has(st));
      return { a: sa.last, b: sb.last, agree: common.every(([st, h]) => seen.get(sb)!.get(st) === h), checkpoints: common.length, ms: Date.now() - t0 };
    };

    section('Комната и старт через интернет');
    const r = (await sa.api.create()).room as LiveRoom;
    await sa.enter(r);
    const j = await sb.api.join(r.code);
    await sb.enter(j.room);
    check(`a room on STAGING (code ${r.code.length} letters), the friend joined by code`, j.room.status === 'open');
    await sa.api.pick(r.id, 'kai', ['dash', 'power_shot', 'shield', 'bank_shot'], null);
    await sb.api.pick(r.id, 'nika', ['dash', 'power_shot', 'shield', 'system_overload'], null);
    await sa.ready(true);
    await sb.ready(true);
    await sleep(1500);
    check('both ready → the match started for both through realtime over HTTPS', !!sa.match && !!sb.match && sa.match.id === sb.match.id);
    console.log(`  clock: offset ${sa.clock.offset} / ${sb.clock.offset} ms, best round trip ${sa.clock.rtt} / ${sb.clock.rtt} ms`);
    const f1 = await fight({ pTap: 0.025 });
    const res = f1.a?.result;
    check(`full fight over the internet: both got the same server result (${res?.method}, ${Math.round(res?.duration ?? 0)} s, cards ${res?.cards?.join('/')}) in ${Math.round(f1.ms / 1000)} s`, !!res && same(f1.a?.result, f1.b?.result));
    check(`both clients computed the same fight at every common checkpoint (${f1.checkpoints})`, f1.agree && f1.checkpoints >= 5);
    const journal = (await admin.collection('live_matches').getOne(f1.a!.id)).inputs as LiveInput[];
    check(`the server's result = the replay of its journal here (${journal.length} entries) = both games' final fingerprint`, replayLive(f1.a!.snapshot, journal).hash === res!.hash && sa.driver?.overHash === res!.hash && sb.driver?.overHash === res!.hash);
    const da = sa.driver!.stats;
    const db = sb.driver!.stats;
    console.log(`  realtime delivery of actions: p50 ${q(delivery, 0.5).toFixed(0)} ms, p95 ${q(delivery, 0.95).toFixed(0)} ms, max ${Math.max(...delivery).toFixed(0)} ms (${delivery.length} messages)`);
    console.log(`  late entries ${da.late}/${db.late}, rebuilds ${da.rebuilds}/${db.rebuilds}, buffer ${sa.driver!.buffer}/${sb.driver!.buffer} steps, least margin ${da.minMargin}/${db.minMargin} steps, healed by heartbeat ${sa.stats.healed}/${sb.stats.healed}`);
    check(`no action lost: every card sent by a client is in the server journal (${sa.stats.actsSent + sb.stats.actsSent} sent)`, sa.stats.actsFailed + sb.stats.actsFailed === 0, JSON.stringify([sa.stats.failCodes, sb.stats.failCodes]));

    section('Реванш и сдача через интернет');
    await sa.rematch(true);
    await sb.rematch(true);
    await sleep(1500);
    const f2 = await fight({ pTap: 0.025, surrender: { who: sb, step: 1500 } });
    const r2 = f2.a?.result;
    check(`rematch in the same room, sides swapped, a surrender mid-fight: «${r2?.method}», the one who gave up lost, both see it`, !!r2 && r2.method === 'forfeit' && r2.winner === 1 - (r2.left as number) && same(f2.a?.result, f2.b?.result) && f2.a?.game === 2);
    await sa.leave();
    await sb.dispose();
  } finally {
    // the test accounts go (and with them everything LIVE made for them)
    for (const id of made) {
      try {
        await admin.collection('users').delete(id);
      } catch (e) {
        console.log('  cleanup: ' + String(e).slice(0, 120));
      }
    }
    console.log(`  test accounts deleted: ${made.length}`);
  }
  console.log(`\nLIVE REMOTE: ${passed} passed, ${failed} failed`);
  proc.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL  the run stopped: ' + String((e as Error)?.message ?? e).slice(0, 400));
  proc.exit(1);
});
