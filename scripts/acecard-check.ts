// Beta 2.6.1 — `npm run acecard`: ACE's signature MAIN EVENT in PRIME LEAGUE (the owner's «the card is not mine» report).
//   1. the rules (pure): ACE and MAIN EVENT in the configs; the league's DECK rule (every fighter's signature, the six
//      basics, bought cards with a league kind) and its limits (the boss card and the three 1.9.8 universal cards stay
//      out); the fight is untouched — CARD_KIND of the AI and SIM_VERSION are the same bytes as Beta 2.6;
//   2. the game (code): the league deck editor, Defense Studio and the attack offer only what the server accepts, the
//      career deck used as a fallback is cleaned of league-foreign cards, the refusal names the real reason;
//   3. the server (a throwaway PocketBase): save the league deck with MAIN EVENT, read it back after a reload, attack
//      with it (the server replays the fight, MAIN EVENT played, the same bits), put ACE into the defence, SMART DEFENSE
//      gives ACE his signature; refusals stay: a card not bought, another fighter's signature, the boss card, the 1.9.8
//      cards, a fighter not signed; the PRIME CLOUD save with ACE's deck is valid.
import PocketBase from 'pocketbase';
import { Match } from '../src/combat/Match';
import { CARDS, UNIVERSAL_CARDS } from '../src/config/cards';
import { CARD_KIND, LEAGUE, LEAGUE_FIGHTERS } from '../src/config/league.config';
import { LEAGUE_DECK_KIND, isLeagueCard, leagueCards, leagueDeckFrom } from '../src/config/leagueDeck';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { leagueConfig, replayLeague, type LeagueInput, type LeagueSnapshot } from '../src/league/replay';
import { SIM_VERSION } from '../src/league/simVersion';
import { comboBot, type BotState } from './bots';
import { leagueAutoSource, leagueRulesSource, leagueSim, simVersionSource } from './backend';
import { LEGACY_CHECK_ENV, ROOT, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, nodeModule, os, path, proc } from './lib/node';
import { SIM_LOCK } from './lib/simLock';

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));

/* eslint-disable @typescript-eslint/no-explicit-any */
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);

const ACE_DECK = FIGHTERS.ace.defaultDeck.slice() as CardId[];

// ------------------------------------------------------------------ the server
// Remote mode (the server machine's own PocketBase and the deployed code, a THROWAWAY empty instance through an SSH
// tunnel, real time — never STAGING's or PRODUCTION's data):
//   PRIME_REMOTE_API=http://127.0.0.1:<tunnel> PRIME_REMOTE_SU_EMAIL=… PRIME_REMOTE_SU_PW=… npx tsx scripts/acecard-check.ts
const REMOTE = proc.env.PRIME_REMOTE_API ?? '';
if (REMOTE && !/^http:\/\/127\.0\.0\.1:\d+$/.test(REMOTE)) throw new Error('PRIME_REMOTE_API must be a local tunnel (http://127.0.0.1:<port>)');
const PORTS = { api: 19590, smtp: 11959, mailUi: 19591 };
const API = REMOTE || `http://127.0.0.1:${PORTS.api}`;
const PW = REMOTE ? 'AceRemote' + crypto.randomBytes(6).toString('hex') : 'AceCard2026pass';
const TAG = REMOTE ? crypto.randomBytes(3).toString('hex') : '';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-acecard-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
const SEASON1 = Date.parse(LEAGUE.season.epoch) + 2 * 86400000;
let clock = SEASON1;
const setClock = (t: number) => {
  clock = t;
  fs.writeFileSync(clockFile, String(t));
};
const tick = (ms: number) => setClock(clock + ms);
let pb: any = null;
const pbLog: string[] = [];

/**
 * Plays the snapshot with the deliberate bot, returns its taps; `signature`: the player also taps that card whenever it
 * is in hand with the energy for it (a player who loves MAIN EVENT). Counts the casts the fight really accepted.
 */
function botTaps(s: LeagueSnapshot, signature: CardId | null = null, react = 0.3): { taps: LeagueInput[]; cast: number } {
  const m = new Match(leagueConfig(s));
  const taps: LeagueInput[] = [];
  let cast = 0;
  const orig = m.playCard.bind(m);
  m.playCard = (side, i) => {
    if (side === 0) taps.push([m.steps, i]);
    const card = m.hands[side].hand[i];
    const r = orig(side, i);
    if (side === 0 && r === null && card === signature) cast++;
    return r;
  };
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  while (m.phase !== 'over' && m.steps < 60 * 90) {
    const h = m.hands[0];
    const at = signature ? h.hand.indexOf(signature) : -1;
    if (at >= 0 && m.phase === 'fight' && h.lockout <= 0 && h.energy >= CARDS[signature!].cost && m.steps % 20 === 0) m.playCard(0, at);
    comboBot(m, st, 1 / 60, react);
    m.step(1 / 60);
    m.drainEvents();
  }
  return { taps, cast };
}

async function serverChecks(): Promise<void> {
  const remote = !!REMOTE;
  if (!remote && !binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  const SU = remote ? { email: proc.env.PRIME_REMOTE_SU_EMAIL ?? '', pw: proc.env.PRIME_REMOTE_SU_PW ?? '' } : { email: 'ace-admin@ace.test', pw: crypto.randomBytes(18).toString('base64url') };
  if (remote) console.log(`\nУдалённый временный экземпляр через туннель (реальное время)`);
  else await localServer(SU);
  await remoteOrLocal(SU, remote);
}

async function localServer(SU: { email: string; pw: string }): Promise<void> {
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setClock(SEASON1);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_CLOCK_FILE: clockFile, PRIME_LEAGUE_SEASON_START: '2026-11-02', PRIME_LEAGUE_BUDGET_SCALE: '1000', ...LEGACY_CHECK_ENV } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}

async function remoteOrLocal(SU: { email: string; pw: string }, remote: boolean): Promise<void> {
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  type User = { id: string; token: string };
  let n = 0;
  const user = async (fighters: FighterId[], cards: CardId[] = [], decks: Partial<Record<FighterId, CardId[]>> = {}): Promise<User> => {
    n++;
    const email = remote ? `ace${n}-${TAG}@isolated.test` : `ace${n}@ace.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Ace${n}${TAG}`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.cards.owned = cards;
    for (const [f, d] of Object.entries(decks)) s.fighters[f].deck = d;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
    const c = new PocketBase(API);
    await c.collection('users').authWithPassword(email, PW);
    return { id: u.id, token: c.authStore.token };
  };
  const call = async (u: User, method: string, url: string, body?: unknown) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: u.token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
  };
  const op = () => 'op_' + crypto.randomBytes(9).toString('hex');
  const join = (u: User) => call(u, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const me = (u: User) => call(u, 'GET', '/api/prime/league/me');
  const deckPut = (u: User, fighter: string, deck: string[]) => call(u, 'PUT', '/api/prime/league/deck', { fighter, deck });
  const start = (u: User, fighter: string, deck?: string[]) => call(u, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter, ...(deck ? { deck } : {}), sim: SIM_VERSION, op: op(), arena: 'random' });
  const snapFrom = (m: any): LeagueSnapshot => ({ seed: m.seed, arena: m.arena, attacker: m.attacker, defender: m.defender, hpMult: m.hpMult, dmgMult: m.dmgMult });
  const code = (r: { status: number; j: any }) => `${r.status} ${r.j?.code ?? ''}`.trim();

  section('Сервер: ACE и MAIN EVENT в колоде лиги (сообщение владельца)');
  const A = await user(['ray', 'ace']);
  await join(A);
  const put = await deckPut(A, 'ace', ACE_DECK);
  check(`ACE's league deck with MAIN EVENT (${ACE_DECK.join(', ')}) is saved`, put.status === 200 && JSON.stringify(put.j.decks?.ace) === JSON.stringify(ACE_DECK), code(put));
  const re = await me(A);
  check('after a reload (/league/me again) the deck is the same', JSON.stringify(re.j.decks?.ace) === JSON.stringify(ACE_DECK), JSON.stringify(re.j.decks));
  const order: CardId[] = ['main_event', 'shield', 'dash', 'power_shot'];
  const put2 = await deckPut(A, 'ace', order);
  check('another order and another basic card with MAIN EVENT first — saved as sent', put2.status === 200 && JSON.stringify((await me(A)).j.decks?.ace) === JSON.stringify(order), code(put2));
  await deckPut(A, 'ace', ACE_DECK);

  const B = await user(['ray', 'ace']);
  await join(B);
  const s0 = await start(B, 'ace');
  check('an attack with ACE and no league deck (the career deck, MAIN EVENT inside) starts', s0.status === 200 && JSON.stringify(s0.j.match?.attacker?.deck) === JSON.stringify(ACE_DECK), code(s0));
  if (s0.status === 200) await call(B, 'POST', `/api/prime/league/match/${s0.j.match.id}/finish`, { inputs: [[0, -1]] });

  const s1 = await start(A, 'ace', ACE_DECK);
  check('an attack with ACE and the saved deck starts', s1.status === 200, code(s1));
  if (s1.status === 200) {
    const m = s1.j.match;
    const { taps, cast } = botTaps(snapFrom(m), 'main_event');
    const out = replayLeague(snapFrom(m), taps);
    // the server refuses a finish sooner than the fight could last: the test clock locally, real time remotely
    if (remote) await new Promise((r) => setTimeout(r, Math.ceil((out.steps / 60) * 1000) + 2500));
    else tick(Math.ceil((out.steps / 60) * 1000) + 1000);
    const f = await call(A, 'POST', `/api/prime/league/match/${m.id}/finish`, { inputs: taps });
    check(`the fight is played to the end with MAIN EVENT really cast ${cast}× (the player's taps)`, cast >= 1);
    check(`the server replays it itself: ${f.j.match?.outcome} by ${f.j.match?.method}, the same bits as the game (hash ${f.j.match?.result?.hash})`, f.status === 200 && f.j.match?.status === 'done' && f.j.match?.result?.hash === out.hash && f.j.match?.outcome === out.outcome, code(f));
  }

  const def = await call(A, 'PUT', '/api/prime/league/defense', { slots: [{ slot: 1, fighter: 'ace', deck: ACE_DECK, tactic: 'adapt', enabled: true }] });
  check('ACE defends with MAIN EVENT in Defense Studio (saved, no problem on the slot)', def.status === 200 && def.j.defense?.[0]?.fighter === 'ace' && def.j.defense[0].deck.includes('main_event') && !def.j.defense[0].problem, code(def));

  section('Сервер: SMART DEFENSE даёт ACE его фирменную карту');
  const C = await user(['ace']);
  const jc = await join(C);
  const aceSlot = (jc.j.defense ?? []).find((d: any) => d.fighter === 'ace');
  check('a new participant with ACE: ACE\'s auto-built deck holds MAIN EVENT', !!aceSlot && aceSlot.deck.includes('main_event') && !aceSlot.problem, JSON.stringify(jc.j.defense));

  section('Сервер: запреты остаются');
  const D = await user(['ray', 'ace'], ['showtime', 'magnet_pull', 'safe_cut'] as CardId[]);
  await join(D);
  check('a card not bought (SPLIT SHOT) → 400 card_not_allowed', code(await deckPut(D, 'ace', ['dash', 'shield', 'split_shot', 'main_event'])) === '400 card_not_allowed');
  check('another fighter\'s signature (RAY with MAIN EVENT) → 400 card_not_allowed', code(await deckPut(D, 'ray', ['dash', 'shield', 'power_shot', 'main_event'])) === '400 card_not_allowed');
  check('ACE with RAY\'s signature ADRENALINE → 400 card_not_allowed', code(await deckPut(D, 'ace', ['dash', 'shield', 'adrenaline', 'main_event'])) === '400 card_not_allowed');
  check('the boss card DIRECTOR\'S CUT → 400 card_not_allowed', code(await deckPut(D, 'ace', ['dash', 'shield', 'directors_cut', 'main_event'])) === '400 card_not_allowed');
  for (const c of ['showtime', 'magnet_pull', 'safe_cut']) check(`the 1.9.8 card ${c.toUpperCase()}, bought, is still not a league card → 400 card_not_allowed`, code(await deckPut(D, 'ace', ['dash', 'shield', c, 'main_event'])) === '400 card_not_allowed');
  check('MAIN EVENT twice → 400 deck_duplicate', code(await deckPut(D, 'ace', ['dash', 'main_event', 'shield', 'main_event'])) === '400 deck_duplicate');
  const E = await user(['ray']);
  await join(E);
  check('ACE not signed → 400 fighter_not_owned (deck and attack)', code(await deckPut(E, 'ace', ACE_DECK)) === '400 fighter_not_owned' && code(await start(E, 'ace', ACE_DECK)) === '400 fighter_not_owned');
  const F = await user(['ray', 'ace'], [], { ace: ['dash', 'shield', 'overdrive', 'power_shot'] });
  await join(F);
  check('an attack with a forged deck (a card not bought) → 400 card_not_allowed', code(await start(F, 'ace', ['dash', 'shield', 'gravity_net', 'main_event'])) === '400 card_not_allowed');
}

const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');

function rulesChecks(): void {
  section('Правила: ACE и его карта');
  check('ACE = fighter id `ace` (АЙЗ), signature `main_event` (MAIN EVENT, the GOLDEN ACE revolver), exclusive to ace, in his default deck', FIGHTERS.ace.name === 'АЙЗ' && FIGHTERS.ace.signature === 'main_event' && CARDS.main_event.exclusive === 'ace' && /GOLDEN ACE/.test(CARDS.main_event.desc) && ACE_DECK.includes('main_event'));
  check('ACE is a league fighter (roster of the character menu) — the league has to take his signature', LEAGUE_FIGHTERS.includes('ace'));
  check(`every league fighter's signature is a league card now (${LEAGUE_FIGHTERS.length}/${LEAGUE_FIGHTERS.length}; before 2.6.1 ACE's was the only one missing)`, LEAGUE_FIGHTERS.every((f) => isLeagueCard(FIGHTERS[f].signature)) && LEAGUE_FIGHTERS.filter((f) => !CARD_KIND[FIGHTERS[f].signature]).join() === 'ace');
  check('the league deck rule = the 29 cards of CARD_KIND + MAIN EVENT («attack»), nothing else', Object.keys(LEAGUE_DECK_KIND).length === 30 && LEAGUE_DECK_KIND.main_event === 'attack' && Object.entries(CARD_KIND).every(([c, k]) => (LEAGUE_DECK_KIND as any)[c] === k));
  check('still not league cards: DIRECTOR\'S CUT (the boss\'s), SHOWTIME, MAGNET PULL, SAFE CUT (1.9.8 — the fight would change)', (['directors_cut', 'showtime', 'magnet_pull', 'safe_cut'] as CardId[]).every((c) => !isLeagueCard(c)));

  section('Правила: бой и SIM не изменились');
  check(`the fight's card kinds (AI weights, inside SIM) unchanged: 29 cards, no MAIN EVENT`, Object.keys(CARD_KIND).length === 29 && !('main_event' in CARD_KIND));
  check('the AI already counts a card without a kind as an «attack» — the kind the deck rule gives MAIN EVENT', /CARD_KIND\[card\] \?\? 'attack'/.test(read('src/combat/FighterAI.ts')));
  check(`SIM_VERSION is the locked engine (scripts/lib/simLock.ts), the server's fight file is built from today's code`, SIM_VERSION === SIM_LOCK && read('backend/pb_hooks/lib/league_sim.js') === leagueSim().code && read('src/league/simVersion.ts') === simVersionSource());
  check('the deck rule is not part of the fight bundle (league_sim.js knows nothing of leagueDeck.ts)', !/LEAGUE_DECK_KIND|leagueDeckFrom/.test(read('backend/pb_hooks/lib/league_sim.js')) && !/leagueDeck/.test(read('src/league/server.ts')));
  const LR = req('./league_rules.js');
  check('the server reads exactly this rule (league_rules.cardKind = LEAGUE_DECK_KIND; the file is generated and up to date)', JSON.stringify(LR.cardKind) === JSON.stringify(LEAGUE_DECK_KIND) && read('backend/pb_hooks/lib/league_rules.js') === leagueRulesSource());
  check('SMART DEFENSE\'s builder on the server is today\'s bundle (league_auto.js)', read('backend/pb_hooks/lib/league_auto.js') === leagueAutoSource());

  section('Правила: какие карты игра предлагает для лиги');
  const aceCards = leagueCards('ace', []);
  check(`ACE with nothing bought: the six basics + MAIN EVENT (${aceCards.length})`, aceCards.length === 7 && aceCards.includes('main_event') && UNIVERSAL_CARDS.every((c) => aceCards.includes(c)));
  const mixed = leagueCards('ace', ['split_shot', 'showtime', 'magnet_pull', 'safe_cut', 'gravity_net'] as CardId[]);
  check('bought league cards are offered, the 1.9.8 cards are not, nothing twice', mixed.includes('split_shot') && mixed.includes('gravity_net') && !mixed.includes('showtime') && !mixed.includes('magnet_pull') && !mixed.includes('safe_cut') && new Set(mixed).size === mixed.length);
  check('another fighter\'s signature is never offered (RAY: no MAIN EVENT; ACE: no ADRENALINE)', !leagueCards('ray', []).includes('main_event') && !aceCards.includes('adrenaline'));
  const legal = (f: FighterId, d: CardId[], owned: CardId[]) => d.length === 4 && new Set(d).size === 4 && d.every((c) => leagueCards(f, owned).includes(c));
  check('ACE\'s career deck goes into the league as it is (MAIN EVENT kept, same order)', JSON.stringify(leagueDeckFrom('ace', ACE_DECK, [])) === JSON.stringify(ACE_DECK));
  const withShow = leagueDeckFrom('ray', ['dash', 'showtime', 'shield', 'adrenaline'] as CardId[], ['showtime'] as CardId[]);
  check(`a career deck with SHOWTIME: that card is replaced, the rest stays in place (${withShow.join(', ')})`, legal('ray', withShow, ['showtime'] as CardId[]) && withShow[0] === 'dash' && withShow[2] === 'shield' && withShow[3] === 'adrenaline' && withShow[1] !== 'showtime');
  const lost = leagueDeckFrom('kai', ['split_shot', 'bank_shot', 'bank_shot'] as CardId[], []);
  check(`a deck with a card no longer owned, a repeat and a missing slot → 4 different legal cards (${lost.join(', ')})`, legal('kai', lost, []) && lost.includes('bank_shot'));
  check('every fighter\'s default deck is a legal league deck', LEAGUE_FIGHTERS.every((f) => legal(f, leagueDeckFrom(f, FIGHTERS[f].defaultDeck, []), []) && JSON.stringify(leagueDeckFrom(f, FIGHTERS[f].defaultDeck, [])) === JSON.stringify(FIGHTERS[f].defaultDeck)));

  section('Игра: экран лиги');
  const ls = read('src/ui/screens/LeagueScreen.ts');
  check('the deck editor and Defense Studio offer leagueCards (the server\'s rule), not «basics + signature + everything bought»', /function allowedCards\([^)]*\): CardId\[\] \{\s*return leagueCards\(id, ownedCards\(g\)\);/.test(ls) && !/\.\.\.UNIVERSAL_CARDS, FIGHTERS\[id\]\.signature/.test(ls));
  check('the fallback deck (no league deck yet) is cleaned with leagueDeckFrom — attack, squad and new defence slots use it', /return leagueDeckFrom\(id, g\.save\.data\.fighters\[id\]\?\.deck \?\? FIGHTERS\[id\]\.defaultDeck, ownedCards\(g\)\)/.test(ls) && (ls.match(/deckOf\(g, /g) ?? []).length >= 5);
  check('the refusal names the real reason (not «a card your collection does not have»)', /card_not_allowed: \['В колоде есть карта, которую нельзя взять в PRIME LEAGUE/.test(ls) && !/которой нет в вашей коллекции/.test(ls));
  check('bought cards the league does not take are named under both editors (no silent gap)', (ls.match(/\$\{offLeagueNote\(/g) ?? []).length === 2);
  check('the career, Classic Duel, Survival, challenges and the boss keep their own decks (PrepScreen untouched by the league rule)', !/leagueDeck|isLeagueCard/.test(read('src/ui/screens/PrepScreen.ts')));

  section('PRIME CLOUD: сохранение с колодой ACE');
  const V = req('./validate.js');
  const s: any = defaultSave();
  s.fighters.ace.unlocked = true;
  s.fighters.ace.deck = ['main_event', 'dash', 'shield', 'power_shot'];
  check('the server accepts a save where ACE\'s deck holds MAIN EVENT', V.validateSave(JSON.parse(canonicalJSON(s))).length === 0, V.validateSave(JSON.parse(canonicalJSON(s))).join('; '));
  s.fighters.ace.deck = ['main_event', 'dash', 'shield', 'split_shot'];
  check('…and refuses one where ACE\'s deck holds a card not bought', V.validateSave(JSON.parse(canonicalJSON(s))).length > 0);
  s.fighters.ace.deck = ACE_DECK.slice();
  s.fighters.ray.deck = ['main_event', 'dash', 'shield', 'power_shot'];
  check('…and one where RAY holds ACE\'s signature', V.validateSave(JSON.parse(canonicalJSON(s))).length > 0);
}

async function main(): Promise<void> {
  rulesChecks();
  try {
    await serverChecks();
  } finally {
    await stopChild(pb);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failed ? `\nacecard: FAILED (${passed} passed, ${failed} failed)` : `\nacecard: OK (${passed} passed, 0 failed) — ${REMOTE ? 'удалённый временный экземпляр' : 'временная база удалена'}`);
  proc.exit(failed ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  void stopChild(pb).then(() => proc.exit(1));
});
