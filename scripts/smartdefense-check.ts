// Beta 2.6 — `npm run smartdefense`: SMART DEFENSE, the PRIME LEAGUE defence built for a new participant.
//   1. the builder (src/league/autoDefense.ts) with the game's real cards, fighters and tactics: 1 → 1, 2–4 → all,
//      5+ → 5 different fighters; six tactics kept different and suited to the fighter; every deck 4 different cards
//      the fighter may use, shaped by its tactic; random — two players' line-ups differ;
//   2. the server (a throwaway PocketBase): built on joining, never rebuilt by a reload / a second tab / a repeat, never
//      over a studio the player saved, built for an older account that has none, only from what the server says is
//      owned, the same checks as a player's own save; the generated league_auto.js is this file's bundle.
import PocketBase from 'pocketbase';
import { autoDefense, deckFor, poolOf, type AutoDefenseInput, type Kind } from '../src/league/autoDefense';
import { LEAGUE, LEAGUE_FIGHTERS, TACTICS, TACTIC_AFFINITY, TACTIC_ORDER } from '../src/config/league.config';
// Beta 2.6.1: the server builds with league_rules.cardKind = LEAGUE_DECK_KIND (CARD_KIND + ACE's MAIN EVENT)
import { LEAGUE_DECK_KIND as CARD_KIND } from '../src/config/leagueDeck';
import { COMBOS, UNIVERSAL_CARDS, NEW_CARDS } from '../src/config/cards';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { LEAGUE_AUTO_FILE, leagueAutoSource } from './backend';
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

/** A seeded random (mulberry32) — the server uses its cryptographic numbers, the checks a repeatable stream. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SIG: Record<string, string> = Object.fromEntries(LEAGUE_FIGHTERS.map((f) => [f, FIGHTERS[f].signature]));
const input = (fighters: string[], owned: string[] = []): AutoDefenseInput => ({
  fighters,
  universal: UNIVERSAL_CARDS as string[],
  signature: SIG,
  owned,
  cardKind: CARD_KIND as Record<string, Kind>,
  comboPairs: COMBOS.filter((c) => !c.after).map((c) => ({ first: c.first, second: c.second })),
  tactics: TACTIC_ORDER,
  affinity: TACTIC_AFFINITY,
  weights: Object.fromEntries(TACTIC_ORDER.map((t) => [t, TACTICS[t].weights])),
  slots: LEAGUE.defense.slots,
});
/** The server's own rule for a league deck (lib/league.js deckProblem), restated: 4 different allowed cards with a kind. */
function deckOk(fighter: string, deck: string[], owned: string[]): boolean {
  const allowed: string[] = (UNIVERSAL_CARDS as string[]).concat([SIG[fighter]], owned);
  return deck.length === 4 && new Set(deck).size === 4 && deck.every((c) => allowed.includes(c) && !!(CARD_KIND as any)[c]);
}
const kinds = (deck: string[]) => deck.map((c) => (CARD_KIND as any)[c] as Kind);
const count = (deck: string[], k: Kind) => kinds(deck).filter((x) => x === k).length;
const hasPair = (deck: string[]) => COMBOS.filter((c) => !c.after).some((c) => c.first.some((a) => deck.includes(a)) && c.second.some((b) => deck.includes(b) && b !== c.first.find((a) => deck.includes(a))));

function builderChecks(): void {
  section('Состав: сколько бойцов');
  const all = LEAGUE_FIGHTERS.slice();
  for (const n of [1, 2, 3, 4, 5, 6, 9]) {
    const own = all.slice(0, n);
    const ok = Array.from({ length: 40 }, (_, s) => autoDefense(input(own), seeded(100 + s))).every((l) => l.length === Math.min(5, n) && new Set(l.map((x) => x.fighter)).size === l.length && l.every((x) => (own as string[]).includes(x.fighter)) && l.every((x, i) => x.slot === i + 1 && x.enabled));
    check(`${n} open ${n === 1 ? 'fighter' : 'fighters'} → ${Math.min(5, n)} different defenders, only owned ones, slots 1…${Math.min(5, n)} (40 seeds)`, ok);
  }
  check('no league fighter owned → no defence (nothing invented)', autoDefense(input([]), seeded(1)).length === 0);
  check('a fighter that is not a league fighter (a rival, a boss) is never fielded', autoDefense(input(['dex', 'tank', 'ray'] as any), seeded(2)).every((x) => x.fighter === 'ray'));

  section('Тактики: шесть стилей');
  const lines = Array.from({ length: 400 }, (_, s) => autoDefense(input(all), seeded(1000 + s)));
  check('five defenders always have five different tactics, all from the six', lines.every((l) => new Set(l.map((x) => x.tactic)).size === l.length && l.every((x) => TACTIC_ORDER.includes(x.tactic as any))));
  const used = new Set(lines.flatMap((l) => l.map((x) => x.tactic)));
  check(`all six tactics appear across players (${[...used].join(', ')})`, used.size === 6);
  const fit = lines.flatMap((l) => l).filter((x) => (TACTIC_AFFINITY as any)[x.fighter].includes(x.tactic)).length / (lines.length * 5);
  check(`a fighter mostly gets a tactic that suits it (${Math.round(fit * 100)} % of 2 000 defenders; the rest where its tactics were taken)`, fit >= 0.7);
  const single = Array.from({ length: 60 }, (_, s) => autoDefense(input(['bruno']), seeded(50 + s))[0]);
  check('one defender takes a tactic of its own style (BRUNO: fortress / assault / balance)', single.every((x) => TACTIC_AFFINITY.bruno.includes(x.tactic as any)));
  const keys = new Set(lines.map((l) => l.map((x) => `${x.fighter}:${x.tactic}:${x.deck.join('+')}`).join('|')));
  check(`line-ups differ between players: ${keys.size} different of ${lines.length}`, keys.size >= lines.length * 0.95);
  const fighters = new Set(lines.flatMap((l) => l.map((x) => x.fighter)));
  check(`with 9 fighters every one of them is picked for someone (${fighters.size} of 9)`, fighters.size === 9);

  section('Колоды');
  const allBought = NEW_CARDS.slice() as string[];
  const decks = Array.from({ length: 300 }, (_, s) => autoDefense(input(all, s % 2 ? allBought : []), seeded(5000 + s))).flatMap((l, s) => l.map((x) => ({ ...x, owned: s % 2 ? allBought : [] })));
  check('every deck is legal by the server\'s rule: 4 different cards, basics + signature + bought only, each with a league kind', decks.every((x) => deckOk(x.fighter, x.deck, x.owned)));
  check('without bought cards a deck uses only the six basics and the fighter\'s signature', decks.filter((x) => !x.owned.length).every((x) => x.deck.every((c) => (UNIVERSAL_CARDS as string[]).includes(c) || c === SIG[x.fighter])));
  check('with bought cards they do appear in decks', decks.filter((x) => x.owned.length).some((x) => x.deck.some((c) => allBought.includes(c))));
  // Beta 2.6.1: the league takes every fighter's signature now — ACE's MAIN EVENT included (was: «never, no league kind»)
  check('the fighter\'s own signature card is in its deck, every fighter (ACE\'s MAIN EVENT too since 2.6.1)', decks.every((x) => x.deck.includes(SIG[x.fighter])) && (CARD_KIND as any).main_event === 'attack' && decks.some((x) => x.fighter === 'ace'));
  const by = (t: string) => decks.filter((x) => x.tactic === t);
  check('ASSAULT: at least 2 attack cards', by('assault').length > 0 && by('assault').every((x) => count(x.deck, 'attack') >= 2));
  check('FORTRESS: at least 2 defence cards (SHIELD, DASH…) and an attack', by('fortress').length > 0 && by('fortress').every((x) => count(x.deck, 'defense') >= 2 && count(x.deck, 'attack') >= 1));
  check('COUNTER: attack, control and defence', by('counter').length > 0 && by('counter').every((x) => count(x.deck, 'attack') >= 1 && count(x.deck, 'control') >= 1 && count(x.deck, 'defense') >= 1));
  check('BALANCE and ADAPT: every kind', [...by('balance'), ...by('adapt')].every((x) => count(x.deck, 'attack') >= 1 && count(x.deck, 'control') >= 1 && count(x.deck, 'defense') >= 1));
  check('COMBO: a real combo pair of the game\'s table (the director can build it)', by('combo').length > 0 && by('combo').every((x) => hasPair(x.deck)));
  check('every deck can deal damage (an attack card)', decks.every((x) => count(x.deck, 'attack') >= 1));
  const deckVariety = new Set(decks.filter((x) => x.fighter === 'ray' && x.tactic === 'balance' && !x.owned.length).map((x) => x.deck.slice().sort().join('+')));
  check(`decks vary within one fighter and tactic too (RAY · BALANCE, basics only: ${deckVariety.size} different)`, deckVariety.size >= 3);
  check('the pool is exactly basics + signature + bought (no boss card, nothing without a league kind)', poolOf(input(['vega'], ['director_cut' as any]), 'vega').every((c) => !!(CARD_KIND as any)[c]) && !poolOf(input(['vega'], ['director_cut' as any]), 'vega').includes('director_cut'));
  check('a tactic the builder does not know still gives a legal deck', deckOk('ray', deckFor(input(['ray']), 'ray', 'unknown', seeded(9)), []));
  check('the server runs exactly this builder: backend/pb_hooks/lib/league_auto.js is its bundle (npm run backend:rules)', fs.readFileSync(LEAGUE_AUTO_FILE, 'utf8') === leagueAutoSource());
}

// ------------------------------------------------------------------ the server
const PORTS = { api: 19790, smtp: 11979, mailUi: 19791 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Defense2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-smartdefense-check-'));
const dataDir = path.join(work, 'pb_data');
let pb: any = null;
const pbLog: string[] = [];

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'def-admin@def.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_SEASON_START: '2026-11-02', PRIME_LEAGUE_BUDGET_SCALE: '1000', ...LEGACY_CHECK_ENV } });
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

  type User = { id: string; token: string };
  let n = 0;
  const user = async (fighters: FighterId[], cards: CardId[] = []): Promise<User> => {
    n++;
    const email = `def${n}@def.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Def${n}`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.cards.owned = cards;
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
  const join = (u: User) => call(u, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const me = (u: User) => call(u, 'GET', '/api/prime/league/me');
  const rows = async (u: User) => (await admin.collection('league_defense').getFullList({ filter: `owner = "${u.id}"`, sort: 'slot' })).map((r: any) => `${r.slot}:${r.fighter}:${r.tactic}:${JSON.stringify(r.deck)}:${r.version}`);
  const statsOf = async (u: User) => (await admin.collection('league_profiles').getFullList({ filter: `owner = "${u.id}"` }))[0]?.stats ?? {};

  section('Сервер: вступление');
  const guestLike = await user([]);
  const before = await me(guestLike);
  check('before joining: no profile, no defence is built (the rules are not accepted)', before.j.joined === false && (await rows(guestLike)).length === 0);
  const j1 = await join(guestLike);
  check('a new account (only RAY) joins → 1 defender RAY at once, «built for you», a legal deck', j1.status === 200 && j1.j.defense.length === 1 && j1.j.defense[0].fighter === 'ray' && j1.j.defenseAuto === true && j1.j.defenseAutoNew === 1 && !j1.j.defense[0].problem && deckOk('ray', j1.j.defense[0].deck, []));
  for (const [k, list] of [[2, ['ray', 'bruno']], [3, ['ray', 'nika', 'vega']], [4, ['ray', 'bruno', 'kai', 'rina']]] as [number, FighterId[]][]) {
    const u = await user(list);
    const r = await join(u);
    const f = r.j.defense.map((d: any) => d.fighter).sort();
    check(`${k} open fighters → all ${k} defend, different tactics, no problem on any slot`, r.j.defense.length === k && JSON.stringify(f) === JSON.stringify(list.slice().sort()) && new Set(r.j.defense.map((d: any) => d.tactic)).size === k && r.j.defense.every((d: any) => !d.problem));
  }
  const bought: CardId[] = ['split_shot', 'gravity_net', 'holo_decoy'] as CardId[];
  const big = await user(['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'ace'], bought);
  const rb = await join(big);
  check('7 open fighters → 5 different defenders, 5 different tactics, every deck legal by the server (bought cards allowed)', rb.j.defense.length === 5 && new Set(rb.j.defense.map((d: any) => d.fighter)).size === 5 && new Set(rb.j.defense.map((d: any) => d.tactic)).size === 5 && rb.j.defense.every((d: any) => !d.problem && deckOk(d.fighter, d.deck, bought)));
  check('the account\'s profile remembers it was built automatically (stats.defense = auto)', (await statsOf(big)).defense === 'auto');

  section('Сервер: ничего не переставляется');
  const s0 = await rows(big);
  const again = await Promise.all([me(big), me(big), me(big), join(big)]);
  check('reloads, a second tab, a repeated join: the same defenders, decks, tactics and versions', JSON.stringify(await rows(big)) === JSON.stringify(s0) && again.every((r) => r.status === 200 && r.j.defenseAutoNew === 0));
  const race = await user(['ray', 'bruno', 'nika', 'vega', 'kai', 'rina']);
  await call(race, 'POST', '/api/prime/league/join', { accept: true, rules: 1 }).then(() => null);
  // a fresh account whose first two requests arrive at once: one line-up only
  const race2 = await user(['ray', 'bruno', 'nika', 'vega', 'kai', 'rina']);
  const both = await Promise.all([join(race2), me(race2), me(race2)]);
  const r2 = await rows(race2);
  check(`requests at the same moment build ONE line-up (${r2.length} defenders, slots 1–5 once each)`, r2.length === 5 && new Set(r2.map((x) => x.split(':')[0])).size === 5 && both.every((r) => r.status === 200));

  section('Сервер: ручная настройка — навсегда');
  const mine = [{ slot: 1, fighter: 'bruno', deck: ['dash', 'power_shot', 'shield', 'knockout'], tactic: 'fortress', enabled: true }];
  const put = await call(big, 'PUT', '/api/prime/league/defense', { slots: mine });
  check('the player saves their own studio (one defender) — accepted, now «manual»', put.status === 200 && put.j.defense.length === 1 && (await statsOf(big)).defense === 'manual');
  const after = await me(big);
  check('…and it is never rebuilt: me() keeps the player\'s one defender, «built for you» is gone', after.j.defense.length === 1 && after.j.defense[0].fighter === 'bruno' && after.j.defenseAuto === false && after.j.defenseAutoNew === 0);
  const bad = await call(big, 'PUT', '/api/prime/league/defense', { slots: [{ slot: 1, fighter: 'lucien', deck: ['dash', 'power_shot', 'shield', 'cane_strike'], tactic: 'fortress', enabled: true }] });
  check('the client is still never trusted: a fighter not owned is refused, the studio stays', bad.status === 400 && bad.j.code === 'fighter_not_owned' && (await rows(big)).length === 1);

  section('Сервер: старые аккаунты');
  const old = await user(['ray', 'nika', 'crax']);
  await join(old);
  // an account that joined before 2.6: no defender, no SMART DEFENSE mark
  for (const r of await admin.collection('league_defense').getFullList({ filter: `owner = "${old.id}"` })) await admin.collection('league_defense').delete(r.id);
  const p = (await admin.collection('league_profiles').getFullList({ filter: `owner = "${old.id}"` }))[0];
  await admin.collection('league_profiles').update(p.id, { stats: {} });
  const o2 = await me(old);
  check('an account that joined before 2.6 without any defender gets one built at its next visit (3 fighters)', o2.j.defense.length === 3 && o2.j.defenseAutoNew === 3 && o2.j.defense.every((d: any) => !d.problem));
  const kept = await user(['ray', 'kai']);
  await join(kept);
  for (const r of await admin.collection('league_defense').getFullList({ filter: `owner = "${kept.id}"` })) await admin.collection('league_defense').delete(r.id);
  await admin.collection('league_defense').create({ owner: kept.id, slot: 1, fighter: 'kai', deck: ['dash', 'power_shot', 'shield', 'bank_shot'], tactic: 'combo', look: '', enabled: true, version: 3 });
  const kp = (await admin.collection('league_profiles').getFullList({ filter: `owner = "${kept.id}"` }))[0];
  await admin.collection('league_profiles').update(kp.id, { stats: {} });
  const k2 = await me(kept);
  check('an older account WITH a defence set up before 2.6 keeps it exactly (nothing added or changed)', k2.j.defense.length === 1 && k2.j.defense[0].fighter === 'kai' && k2.j.defense[0].version === 3 && k2.j.defenseAutoNew === 0);
  const nosave = await user([]);
  await admin.collection('saves').delete((await admin.collection('saves').getFullList({ filter: `owner = "${nosave.id}"` }))[0].id);
  const ns = await join(nosave);
  check('an account without a cloud save: the starter RAY only (the server\'s ownership, nothing assumed)', ns.j.defense.length === 1 && ns.j.defense[0].fighter === 'ray');
  check('nobody reads or writes the defence through the generic API', (await fetch(`${API}/api/collections/league_defense/records`, { headers: { Authorization: big.token } })).status !== 200 || ((await (await fetch(`${API}/api/collections/league_defense/records`, { headers: { Authorization: big.token } })).json()) as any).totalItems === 0);
}

async function main(): Promise<void> {
  builderChecks();
  try {
    await serverChecks();
  } finally {
    await stopChild(pb);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failed ? `\nsmartdefense: FAILED (${passed} passed, ${failed} failed)` : `\nsmartdefense: OK (${passed} passed, 0 failed) — временная база удалена`);
  proc.exit(failed ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  void stopChild(pb).then(() => proc.exit(1));
});
