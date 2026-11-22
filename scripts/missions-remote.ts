// Beta 2.6 — the signed-in scenarios of DAILY MISSIONS, the MINI CASE, SMART DEFENSE and the public mini profile on the
// REAL server machine (its Linux PocketBase, the 2.6 hooks and migrations of the server archive) against a THROWAWAY
// instance with an EMPTY database reached through an SSH tunnel — never STAGING's or PRODUCTION's data, only test accounts
// made here (they vanish with the instance). Real time (no test clock): the day change is covered by `npm run missions`.
//
//   PRIME_REMOTE_API=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/missions-remote.ts
//
// The instance runs with PRIME_MISSIONS / PRIME_CASES / PRIME_LEAGUE / PRIME_LEAGUE_TOKENS on, public registration (it is
// empty and unreachable from outside), mail off. Prints no password or token.
import PocketBase from 'pocketbase';
import { MISSIONS } from '../src/config/missions.config';
import { FIGHTERS } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { SIM_VERSION } from '../src/league/simVersion';
import { stateOf } from '../src/missions/missionMath';
import { registrationExtras } from './lib/backendKit';
import { crypto, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = proc.env.PRIME_REMOTE_API ?? '';
const SU = { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !SU.email || !SU.pw) {
  console.log('usage: PRIME_REMOTE_API=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/missions-remote.ts');
  proc.exit(1);
}
const PW = 'Remote2026' + crypto.randomBytes(6).toString('hex');
const tag = crypto.randomBytes(3).toString('hex');

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type User = { id: string; email: string; nick: string; token: string; session: { key: string; generation: number } };

async function main(): Promise<void> {
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  // a throwaway instance: the rate limits are raised for the test's own burst (the real ones are checked first)
  const st = (await admin.settings.getAll()).rateLimits;
  check('the 2.6 migration ran on this server: the missions rate limit (60 a minute) is there', st.rules.some((r: any) => r.label === '/api/prime/missions' && r.maxRequests === 60));
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  let n = 0;
  const user = async (fighters: FighterId[], rep = 0, verify = true): Promise<User> => {
    n++;
    const nick = `Rem${n}${tag}`;
    const email = `rem${n}-${tag}@isolated.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register: ${r.status}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.reputation = rep;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
    const login = await fetch(`${API}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) });
    const token = ((await login.json()) as any).token;
    const key = crypto.randomBytes(16).toString('hex');
    const cl = await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ key, label: 'remote', device: 'remote-' + n }) });
    const generation = cl.status === 200 ? (((await cl.json()) as any).generation as number) : 0;
    return { id: u.id, email, nick, token, session: { key, generation } };
  };
  const call = async (u: User | null, method: string, url: string, body?: any) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(u ? { ...body, session: body.session === undefined ? u.session : body.session } : body) });
    const text = await r.text();
    let j: any = {};
    try {
      j = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: r.status, j, text };
  };
  const op = () => 'ms_' + crypto.randomBytes(10).toString('hex');
  const missions = (u: User) => call(u, 'GET', '/api/prime/missions');
  const report = (u: User, f: Record<string, unknown> = {}, o = op()) => call(u, 'POST', '/api/prime/missions/report', { op: o, fight: { outcome: 'win', method: 'ko', rating: 82, combos: 3, perfects: 2, difficulty: 'rookie', mode: 'classic', fighter: 'ray', rival: 'dex', seconds: 75, ...f } });
  const rowOf = async (u: User) => (await admin.collection('prime_missions').getFullList({ filter: `owner = "${u.id}"`, sort: '-day' }))[0];
  const setList = async (u: User, spec: [string, number][]) => {
    const r = await rowOf(u);
    await admin.collection('prime_missions').update(r.id, { list: spec.map(([id, target]) => ({ ...stateOf(MISSIONS.find((m) => m.id === id)!), target })) });
  };
  const casesOf = async (u: User) => await admin.collection('prime_cases').getFullList({ filter: `owner = "${u.id}" && kind = "mission"` });

  section('Доступ');
  const cfg = await call(null, 'GET', '/api/prime/config');
  check('the server announces DAILY MISSIONS (config missions = 1)', cfg.j.missions === 1);
  check('a guest gets nothing (401) — missions, reports, a player card', (await call(null, 'GET', '/api/prime/missions')).status === 401 && (await call(null, 'POST', '/api/prime/missions/report', { op: op(), fight: {} })).status === 401 && (await call(null, 'GET', '/api/prime/league/player?id=abcdefghijkm')).status === 401);
  const unv = await user(['ray'], 0, false);
  check('an unconfirmed e-mail: 403 not_verified', (await missions(unv)).j.code === 'not_verified');

  section('Пять заданий дня');
  const A = await user(['ray', 'bruno', 'nika'], 200);
  const g1 = await missions(A);
  const ids = g1.j.missions?.map((m: any) => m.id) ?? [];
  check(`five different missions, the day's reset at 00:00 Moscow (${ids.join(', ')})`, g1.status === 200 && ids.length === 5 && new Set(ids).size === 5 && new Date(g1.j.resetsAt + 3 * 3600000).toISOString().slice(11, 19) === '00:00:00');
  const again = await Promise.all([missions(A), missions(A), missions(A)]);
  check('reloads / parallel requests: the same five, ONE row for the day', again.every((r) => JSON.stringify(r.j.missions.map((m: any) => m.id)) === JSON.stringify(ids)) && (await admin.collection('prime_missions').getFullList({ filter: `owner = "${A.id}"` })).length === 1);
  check('no league mission before joining the league', g1.j.missions.every((m: any) => !m.league));

  section('Отчёт боя карьеры');
  await setList(A, [['c_fights_8', 3], ['c_wins_7', 2], ['c_ko_6', 1], ['c_rivals_3', 2], ['c_fighter_wins_3', 2]]);
  const ex = op();
  const r0 = await report(A, { method: 'forfeit', outcome: 'loss', seconds: 5 }, ex);
  check('an exit from the fight counts NOTHING, and its op can never count later', r0.status === 200 && r0.j.counted === false && r0.j.state.missions.every((m: any) => m.progress === 0) && (await report(A, {}, ex)).j.duplicate === true, r0.text.slice(0, 200));
  check('a fight shorter than 30 s → 422 fight_too_short', (await report(A, { seconds: 12 })).j.code === 'fight_too_short');
  const r1 = await report(A, { fighter: 'ray', rival: 'dex' });
  check('a KO win moves every matching mission; the KO mission is done and its mini case is granted at once', r1.status === 200 && r1.j.counted && JSON.stringify(r1.j.state.missions.map((m: any) => m.progress)) === '[1,1,1,1,1]' && r1.j.completed.join() === 'c_ko_6' && (await casesOf(A)).length === 1, r1.text.slice(0, 300));
  const dupOp = op();
  const four = await Promise.all([0, 1, 2, 3].map(() => report(A, { fighter: 'lucien', rival: 'tank' }, dupOp)));
  check('the same report four times at once (a network retry): counted ONCE', four.every((x) => x.status === 200) && (await admin.collection('prime_mission_reports').getFullList({ filter: `owner = "${A.id}" && op = "${dupOp}"` })).length === 1 && (await rowOf(A)).list[1].progress === 2);
  check('a fighter the account does not own (LUCIEN) counts for no «different fighters»', (await rowOf(A)).list[4].progress === 1);
  await report(A, { fighter: 'bruno', rival: 'zoe', outcome: 'loss', method: 'time' });
  const r5 = await report(A, { fighter: 'nika', rival: 'crash', outcome: 'win', method: 'time' });
  check('all five done → exactly five mini cases (one per mission), never a sixth', r5.j.state.missions.every((m: any) => m.done && m.rewarded) && (await casesOf(A)).length === 5 && new Set((await casesOf(A)).map((c: any) => c.ref)).size === 5);
  await report(A, {});
  check('…a later fight adds nothing', (await casesOf(A)).length === 5);
  const stale = await call(A, 'POST', '/api/prime/missions/report', { op: op(), session: { key: crypto.randomBytes(16).toString('hex'), generation: A.session.generation }, fight: { outcome: 'win', method: 'ko', rating: 80, combos: 1, perfects: 1, difficulty: 'rookie', mode: 'classic', fighter: 'ray', rival: 'dex', seconds: 75 } });
  check('a page that lost the game session cannot report (409); no session at all — 426', stale.status === 409 && (await call(A, 'POST', '/api/prime/missions/report', { op: op(), session: null, fight: {} })).status === 426);

  section('Банк времени');
  const B = await user(['ray']);
  await missions(B);
  let sent = 0;
  let refused: any = null;
  for (let i = 0; i < 40 && !refused; i++) {
    const r = await report(B, {});
    if (r.status === 200) sent++;
    else refused = r;
  }
  check(`a burst of invented fights stops after ${sent} (15 minutes of reach; 429 fights_too_fast)`, refused?.status === 429 && refused.j.code === 'fights_too_fast' && sent >= 10 && sent <= 14);

  section('DAILY MISSION MINI CASE');
  const save = (await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0];
  const money0 = JSON.parse(save.data).money;
  const rep0 = JSON.parse(save.data).reputation;
  const caseOp = 'case_' + crypto.randomBytes(8).toString('hex');
  const o1 = await call(A, 'POST', '/api/prime/cases/open', { op: caseOp, kind: 'mission', base: save.revision });
  const o2 = await call(A, 'POST', '/api/prime/cases/open', { op: caseOp, kind: 'mission', base: save.revision });
  const res = o1.j.case?.result;
  const after = JSON.parse((await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0].data);
  check(`opens on the server: «${res?.label}» (${res?.kind} ${res?.amount}) from the mini table, written into the cloud save`, o1.status === 200 && ['m_money', 'm_rep', 'm_bonus'].includes(res?.outcome) && (res.kind === 'money' ? after.money === money0 + res.amount : after.reputation === rep0 + res.amount), o1.text.slice(0, 300));
  check('the same open request again (a lost answer): the same result, nothing drawn twice', o2.status === 200 && o2.j.duplicate === true && o2.j.case.id === o1.j.case.id && (await casesOf(A)).filter((c: any) => c.status === 'opened').length === 1);
  check('the real odds are shown: 4 still ready, without PRIME TOKENS (no league profile), summing to 100 %', o1.j.status.mission.ready === 4 && o1.j.status.mission.odds.every((x: any) => x.kind !== 'tokens') && o1.j.status.mission.odds.reduce((s: number, x: any) => s + x.share, 0) === 10000);
  let rev = (await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0].revision;
  let seq = 0;
  for (let i = 0; i < 4; i++) {
    const o = await call(A, 'POST', '/api/prime/cases/open', { op: 'case_' + crypto.randomBytes(8).toString('hex'), kind: 'mission', base: rev });
    if (o.status === 200 && !o.j.duplicate) seq++;
    rev = (await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0].revision;
  }
  const none = await call(A, 'POST', '/api/prime/cases/open', { op: 'case_' + crypto.randomBytes(8).toString('hex'), kind: 'mission', base: rev });
  check(`five openings one after another: ${1 + seq} of 5 opened, then «no case» (the sixth refused)`, seq === 4 && none.status !== 200 && (await casesOf(A)).every((c: any) => c.status === 'opened'), none.text.slice(0, 200));

  section('SMART DEFENSE');
  const L = await user(['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'ace']);
  const j1 = await call(L, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  check('7 open fighters join → 5 different defenders with 5 different tactics, built for the player, no problem on any slot', j1.status === 200 && j1.j.defense?.length === 5 && new Set(j1.j.defense.map((d: any) => d.fighter)).size === 5 && new Set(j1.j.defense.map((d: any) => d.tactic)).size === 5 && j1.j.defenseAuto === true && j1.j.defenseAutoNew === 5 && j1.j.defense.every((d: any) => !d.problem), j1.text.slice(0, 300));
  const rows = async (u: User) => (await admin.collection('league_defense').getFullList({ filter: `owner = "${u.id}"`, sort: 'slot' })).map((r: any) => `${r.slot}:${r.fighter}:${r.tactic}:${JSON.stringify(r.deck)}:${r.version}`);
  const s0 = await rows(L);
  const rep = await Promise.all([call(L, 'GET', '/api/prime/league/me'), call(L, 'GET', '/api/prime/league/me'), call(L, 'POST', '/api/prime/league/join', { accept: true, rules: 1 })]);
  check('reloads and a repeated join: nothing reshuffled', JSON.stringify(await rows(L)) === JSON.stringify(s0) && rep.every((r) => r.status === 200 && r.j.defenseAutoNew === 0));
  const mine = [{ slot: 1, fighter: 'bruno', deck: j1.j.defense.find((d: any) => d.fighter === 'bruno')?.deck ?? FIGHTERS.bruno.defaultDeck, tactic: 'fortress', enabled: true }];
  const put = await call(L, 'PUT', '/api/prime/league/defense', { slots: mine });
  const after2 = await call(L, 'GET', '/api/prime/league/me');
  check('a defence set by hand stays exactly as set (never rebuilt)', put.status === 200 && after2.j.defense.length === 1 && after2.j.defense[0].fighter === 'bruno' && after2.j.defenseAuto === false && after2.j.defenseAutoNew === 0, put.text.slice(0, 200));

  section('PRIME LEAGUE засчитывает сервер (реальное время)');
  const M = await user(['ray', 'vega']);
  await call(M, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  await missions(M);
  await setList(M, [['l_fights_3', 2], ['l_wins_4', 2], ['c_fights_8', 3], ['c_wins_7', 2], ['c_ko_6', 1]]);
  const start = async () => (await call(M, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: 'lg_' + crypto.randomBytes(10).toString('hex') })).j.match;
  const m1 = await start();
  await call(M, 'POST', `/api/prime/league/match/${m1?.id}/finish`, { inputs: [[0, -1]] });
  check('a league fight left at once (forfeit) counts nothing', !!m1 && (await rowOf(M)).list[0].progress === 0);
  const m2 = await start();
  let f2: any = null;
  for (let i = 0; i < 20; i++) {
    f2 = await call(M, 'POST', `/api/prime/league/match/${m2?.id}/finish`, { inputs: [] });
    if (f2.status === 409 && f2.j.code === 'too_early') {
      await sleep(Math.min(60000, (f2.j.wait ?? 5000) + 1500));
      continue;
    }
    if (f2.status === 409 && f2.j.code === 'finishing') {
      await sleep(2000);
      continue;
    }
    break;
  }
  const lrow = await rowOf(M);
  check(`a league fight replayed and settled by the server (${f2?.j.match?.outcome}, ${f2?.j.match?.method}) moves «league fights» 1/2; career missions untouched`, f2?.status === 200 && f2.j.match?.status === 'done' && lrow.list[0].progress === 1 && lrow.list[2].progress === 0, f2?.text.slice(0, 300));
  const f2b = await call(M, 'POST', `/api/prime/league/match/${m2?.id}/finish`, { inputs: [] });
  check('the same match finished again (a retry): counted once', f2b.status === 200 && (await rowOf(M)).list[0].progress === 1);

  section('Публичный мини-профиль');
  const board = await call(L, 'GET', '/api/prime/league/board');
  const rowM = board.j.rows?.find((r: any) => r.name === M.nick);
  check('the leaderboard names rows by a 12-letter public key, never an account id or e-mail', !!rowM && /^[a-z0-9]{12}$/.test(rowM.id) && !board.text.includes(M.id) && !board.text.includes(M.email), board.text.slice(0, 300));
  const card = await call(L, 'GET', `/api/prime/league/player?id=${rowM?.id}`);
  const keys = Object.keys(card.j).sort().join(',');
  check(`another player's card: only public fields (${keys})`, card.status === 200 && card.j.name === M.nick && card.j.me === false && keys === 'best,current,defense,draws,emblem,games,id,look,losses,me,name,peak,place,rank,rp,season,seasons,titles,winRate,wins');
  check('nothing private: no account id, e-mail, MMR, PRIME TOKENS, decks, stats, save', !card.text.includes(M.id) && !card.text.includes(M.email) && !/"mmr"|"tokens"|"decks"|"stats"|"owner"|"email"|"money"|"save"/.test(card.text));
  check('a broken key → 400; a key nobody has → 404', (await call(L, 'GET', '/api/prime/league/player?id=../x')).j.code === 'invalid_player' && (await call(L, 'GET', '/api/prime/league/player?id=zzzzzzzzzzzz')).j.code === 'player_not_found');

  section('Приватность');
  const generic = await Promise.all(['prime_missions', 'prime_mission_reports', 'league_profiles'].map((c) => call(A, 'GET', `/api/collections/${c}/records`)));
  check('the generic API lists no missions, reports or league profiles', generic.every((g) => g.status !== 200 || (g.j.items ?? []).length === 0));

  console.log(failed ? `\nmissions-remote: FAILED (${passed} passed, ${failed} failed)` : `\nmissions-remote: OK (${passed} passed, 0 failed)`);
  proc.exit(failed ? 1 : 0);
}

void main().catch((e) => {
  console.error(String(e).slice(0, 400));
  proc.exit(1);
});
