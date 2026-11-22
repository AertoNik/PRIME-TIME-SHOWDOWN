// Beta 2.6 — `npm run profiles`: PLAYER MINI PROFILE (the PRIME LEAGUE leaderboard's rows open a public card).
// A throwaway PocketBase: the leaderboard names rows by a random public key (never an account id), the card answers
// only public league facts (no e-mail, account / record id, MMR, PRIME TOKENS, decks, stats, save), one's own card says
// «me», a broken or unknown key is refused, a guest and an unconfirmed account get nothing, an older profile without a key
// gets one, a participant of a past season shows the new season's zeros, the league's request budget limits it.
import PocketBase from 'pocketbase';
import { FIGHTERS } from '../src/config/fighters';
import { LEAGUE } from '../src/config/league.config';
import type { FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { SIM_VERSION } from '../src/league/simVersion';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, os, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);

const PORTS = { api: 19990, smtp: 11999, mailUi: 19991 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Profiles2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-profiles-check-'));
const dataDir = path.join(work, 'pb_data');
const leagueClock = path.join(work, 'league-clock.txt');
let pb: any = null;
const pbLog: string[] = [];
let clock = Date.parse(LEAGUE.season.epoch) + 3 * 86400000 + 9 * 3600000;
const tick = (ms: number) => {
  clock += ms;
  fs.writeFileSync(leagueClock, String(clock));
};

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  tick(0);
  const SU = { email: 'pc-admin@pc.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  // the league's own request budget as in production (no scale)
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_CLOCK_FILE: leagueClock, PRIME_LEAGUE_SEASON_START: '2026-11-02', ...LEGACY_CHECK_ENV } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  type User = { id: string; token: string; email: string; nick: string };
  let n = 0;
  const user = async (fighters: FighterId[], verify = true): Promise<User> => {
    n++;
    const email = `pc${n}@pc.test`;
    const nick = `Prof${n}`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
    const login = await fetch(`${API}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) });
    return { id: u.id, token: ((await login.json()) as any).token, email, nick };
  };
  const call = async (u: User | null, url: string, method = 'GET', body?: unknown) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, text: await r.text().catch(() => ''), j: {} as any };
  };
  const json = async (u: User | null, url: string, method = 'GET', body?: unknown) => {
    const r = await call(u, url, method, body);
    try {
      r.j = JSON.parse(r.text);
    } catch {
      r.j = {};
    }
    return r;
  };
  /** One finished league fight (the server replays it) so the account is in the season table. */
  const fight = async (u: User) => {
    const m = (await json(u, '/api/prime/league/match/start', 'POST', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: 'lg_' + crypto.randomBytes(10).toString('hex') })).j.match;
    tick(240000);
    return (await json(u, `/api/prime/league/match/${m.id}/finish`, 'POST', { inputs: [] })).j.match;
  };

  const A = await user(['ray', 'vega']);
  const B = await user(['ray', 'vega']);
  await json(A, '/api/prime/league/join', 'POST', { accept: true, rules: 1 });
  await json(B, '/api/prime/league/join', 'POST', { accept: true, rules: 1 });
  const fa = await fight(A);
  await fight(B);

  section('Таблица: публичные ключи');
  const board = await json(B, '/api/prime/league/board');
  const rowA = board.j.rows?.find((r: any) => r.name === A.nick);
  check('the leaderboard names each row by a 12-letter public key', !!rowA && /^[a-z0-9]{12}$/.test(rowA.id) && board.j.rows.every((r: any) => /^[a-z0-9]{12}$/.test(r.id)));
  check('…never by an account id, an e-mail or a record id', !board.text.includes(A.id) && !board.text.includes(A.email) && !board.text.includes((await admin.collection('league_profiles').getFullList({ filter: `owner = "${A.id}"` }))[0].id));

  section('Мини-профиль');
  const card = await json(B, `/api/prime/league/player?id=${rowA.id}`);
  const keys = Object.keys(card.j).sort().join(',');
  check(`B opens A's card: the nickname, rank, RP, this season's record (${card.j.wins}–${card.j.losses}${card.j.draws ? '–' + card.j.draws : ''}, ${card.j.winRate ?? '—'} %), not «me»`, card.status === 200 && card.j.name === A.nick && card.j.me === false && card.j.games === 1 && card.j.current === true && card.j.rank?.ru && typeof card.j.rp === 'number' && card.j.winRate === (fa.outcome === 'win' ? 100 : 0));
  check(`only public fields: ${keys}`, keys === 'best,current,defense,draws,emblem,games,id,look,losses,me,name,peak,place,rank,rp,season,seasons,titles,winRate,wins');
  check('nothing private in it: no account id, e-mail, MMR, PRIME TOKENS, decks, stats, save', !card.text.includes(A.id) && !card.text.includes(A.email) && !/"mmr"|"tokens"|"decks"|"stats"|"owner"|"email"|"money"|"save"/.test(card.text));
  const mine = await json(A, `/api/prime/league/player?id=${rowA.id}`);
  check('one\'s own card says «me»', mine.status === 200 && mine.j.me === true);
  check('a broken key → 400 invalid_player; a key nobody has → 404 player_not_found', (await json(B, '/api/prime/league/player?id=../x')).j.code === 'invalid_player' && (await json(B, '/api/prime/league/player?id=zzzzzzzzzzzz')).j.code === 'player_not_found');
  check('a guest gets nothing (401)', (await call(null, `/api/prime/league/player?id=${rowA.id}`)).status === 401);
  const U = await user(['ray'], false);
  check('an unconfirmed e-mail: 403', (await call(U, `/api/prime/league/player?id=${rowA.id}`)).status === 403);
  check('nobody lists the league profiles through the generic API', ((await json(B, '/api/collections/league_profiles/records')).j.items ?? []).length === 0);

  section('Старые и устаревшие профили');
  const profB = (await admin.collection('league_profiles').getFullList({ filter: `owner = "${B.id}"` }))[0];
  check('every profile got a key (the migration filled the existing ones, joining fills new ones)', /^[a-z0-9]{12}$/.test(profB.pub));
  await admin.collection('league_profiles').update(profB.id, { pub: '' });
  const b2 = await json(A, '/api/prime/league/board');
  const rowB = b2.j.rows.find((r: any) => r.name === B.nick);
  check('a profile still without a key gets one when the leaderboard shows it (and keeps it)', /^[a-z0-9]{12}$/.test(rowB?.id) && (await admin.collection('league_profiles').getOne(profB.id)).pub === rowB.id);
  await admin.collection('league_profiles').update(profB.id, { season: profB.season - 1 });
  const old = await json(A, `/api/prime/league/player?id=${rowB.id}`);
  check('a participant who has not fought this season: the card shows the season\'s zeros (current: false), never last season\'s RP as this one\'s', old.status === 200 && old.j.current === false && old.j.games === 0 && old.j.rp === 0 && old.j.winRate === null && old.j.place === null);

  section('Нагрузка');
  let limited = 0;
  for (let i = 0; i < 100 && !limited; i++) {
    const r = await call(B, `/api/prime/league/player?id=${rowA.id}`);
    if (r.status === 429) limited = i + 1;
  }
  check(`the league's request budget limits a flood of profile requests (429 after ${limited} in a minute; 90 is the budget)`, limited > 0 && limited <= 92);
}

function clientChecks(): void {
  section('Клиент');
  const ls = fs.readFileSync('src/ui/screens/LeagueScreen.ts', 'utf8') as string;
  const pc = fs.readFileSync('src/ui/playerCard.ts', 'utf8') as string;
  check('a leaderboard row with a public key is a focusable button that opens the card (click, Enter or Space)', /data-act="player" data-id="\$\{esc\(r\.id\)\}"[^`]*role="button" tabindex="0"/.test(ls) && /\(e\.key === 'Enter' \|\| e\.key === ' '\) && t\.matches\?\.\('li\[role="button"\]\[data-act\]'\)/.test(ls) && /openPlayerCard\(/.test(ls));
  check('the card asks only by the public key and says what went wrong (gone / busy / no connection → «Повторить»)', /player\(id\)/.test(pc) && /404/.test(pc) && /429/.test(pc));
}

async function main(): Promise<void> {
  clientChecks();
  try {
    await serverChecks();
  } finally {
    await stopChild(pb);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failed ? `\nprofiles: FAILED (${passed} passed, ${failed} failed)` : `\nprofiles: OK (${passed} passed, 0 failed) — временная база удалена`);
  proc.exit(failed ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  void stopChild(pb).then(() => proc.exit(1));
});
