// Beta 2.6 — helper for the ISOLATED browser scenario (dev only): the real game against a THROWAWAY server instance with
// an EMPTY database (the 2.6 server archive on the server machine), reached through an SSH tunnel. Never STAGING's or
// PRODUCTION's data. Prints no password or token.
//
//   PRIME_REMOTE_API=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/missions-stage.ts host <file>
//     → a verified TEST player (7 fighters, producer level 3) who joined PRIME LEAGUE (SMART DEFENSE builds the line-up)
//       and finished today's five missions by real fight reports (five DAILY MISSION MINI CASES waiting);
//       its e-mail / password go to <file> (mode 600) — plus a second TEST player with one settled league fight, so the
//       leaderboard has another row whose mini profile can be opened.
//   … missions-stage.ts state <file>  → the player's missions, mission cases and league line-up (counts only)
import PocketBase from 'pocketbase';
import { MISSIONS } from '../src/config/missions.config';
import { FIGHTERS } from '../src/config/fighters';
import type { FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { SIM_VERSION } from '../src/league/simVersion';
import { stateOf } from '../src/missions/missionMath';
import { registrationExtras } from './lib/backendKit';
import { crypto, fs, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const API = proc.env.PRIME_REMOTE_API ?? '';
const SU = { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' };
const [cmd, file] = proc.argv.slice(2);
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(API) || !SU.email || !SU.pw || !cmd || !file) {
  console.log('usage: PRIME_REMOTE_API=http://127.0.0.1:<port> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/missions-stage.ts host|state <file>');
  proc.exit(1);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const tag = crypto.randomBytes(2).toString('hex');

  const user = async (nick: string, fighters: FighterId[], rep: number) => {
    const email = `${nick.toLowerCase()}@isolated.test`;
    const pw = 'Iso2026' + crypto.randomBytes(8).toString('hex');
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: pw, passwordConfirm: pw, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register: ${r.status}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.reputation = rep;
    s.money = 500;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'stage' });
    const login = await fetch(`${API}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) });
    const token = ((await login.json()) as any).token as string;
    const key = crypto.randomBytes(16).toString('hex');
    const cl = await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ key, label: 'stage', device: 'stage-' + nick }) });
    const generation = (((await cl.json()) as any).generation as number) ?? 0;
    return { id: u.id, email, pw, nick, token, session: { key, generation } };
  };
  type U = Awaited<ReturnType<typeof user>>;
  const call = async (u: U, method: string, url: string, body?: any) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: u.token }, body: body === undefined ? undefined : JSON.stringify({ ...body, session: u.session }) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
  };

  if (cmd === 'state') {
    const { email } = JSON.parse(fs.readFileSync(file, 'utf8'));
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    const row = (await admin.collection('prime_missions').getFullList({ filter: `owner = "${u.id}"`, sort: '-day' }))[0];
    const cases = await admin.collection('prime_cases').getFullList({ filter: `owner = "${u.id}" && kind = "mission"` });
    const def = await admin.collection('league_defense').getFullList({ filter: `owner = "${u.id}"` });
    console.log(`missions ${row?.list?.filter((m: any) => m.done).length ?? 0}/5 done · mission cases ${cases.length} (opened ${cases.filter((c: any) => c.status === 'opened').length}) · defenders ${def.length}`);
    return;
  }

  // the second player first: one settled league fight puts it on the leaderboard
  const R = await user(`Rival${tag}`, ['ray', 'vega'], 0);
  await call(R, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const m = (await call(R, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: 'lg_' + crypto.randomBytes(10).toString('hex') })).j.match;
  for (let i = 0; i < 20; i++) {
    const f = await call(R, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: [] });
    if (f.status === 409 && (f.j.code === 'too_early' || f.j.code === 'finishing')) {
      await sleep(Math.min(60000, (f.j.wait ?? 2000) + 1500));
      continue;
    }
    console.log(`rival: league fight ${f.j.match?.status} (${f.j.match?.outcome})`);
    break;
  }

  const P = await user(`Tester${tag}`, ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'ace'], 200);
  const j = await call(P, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  console.log(`player: joined, SMART DEFENSE built ${j.j.defenseAutoNew} defenders (${j.j.defense?.map((d: any) => `${d.fighter}/${d.tactic}`).join(', ')})`);
  await call(P, 'GET', '/api/prime/missions');
  // today's five, with targets of 1 so one honest report finishes all of them (real catalogue ids for the titles)
  const row = (await admin.collection('prime_missions').getFullList({ filter: `owner = "${P.id}"`, sort: '-day' }))[0];
  await admin.collection('prime_missions').update(row.id, { list: [['c_ko_6', 1], ['c_wins_7', 1], ['c_fights_8', 1], ['c_rivals_3', 1], ['c_fighter_wins_3', 1]].map(([id, target]) => ({ ...stateOf(MISSIONS.find((x) => x.id === id)!), target })) });
  const rep = await call(P, 'POST', '/api/prime/missions/report', { op: 'ms_' + crypto.randomBytes(10).toString('hex'), fight: { outcome: 'win', method: 'ko', rating: 82, combos: 3, perfects: 2, difficulty: 'rookie', mode: 'classic', fighter: 'ray', rival: 'dex', seconds: 75 } });
  console.log(`player: one fight report → ${rep.j.completed?.length ?? 0} missions done, mission cases ${(await admin.collection('prime_cases').getFullList({ filter: `owner = "${P.id}" && kind = "mission"` })).length}`);
  // the browser takes the game session over at sign-in; this helper's session simply ends
  fs.writeFileSync(file, JSON.stringify({ email: P.email, pw: P.pw, nick: P.nick, rival: R.nick }), { mode: 0o600 });
  console.log(`player ${P.nick}, rival ${R.nick} — credentials in the file (mode 600)`);
}

void main().catch((e) => {
  console.error(String(e).slice(0, 400));
  proc.exit(1);
});
