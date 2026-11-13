// Alpha 1.9.7 — `npm run winter:server`: WINTER SHOWDOWN's server wallet (R-22, backend/pb_hooks/lib/season.js) on a REAL
// temporary PocketBase (its own data folder and ports; nothing of a real server is touched). The season's clock is a file
// (PRIME_SEASON_CLOCK_FILE, read only with PRIME_SERVER_ROLE=dev / staging), so the check walks through «before / during /
// after» the event. Proves: access rules, the event's dates by the server's clock, the clamped and rate-limited career
// reports, the daily caps, the quests (counted by the server, paid once), the grand prize, the atomic exchange (repeats,
// races, not enough canes), forged cloud saves refused, a guest's local canes worth nothing, the season's end, the off switch.
import PocketBase from 'pocketbase';
import { EVENTS } from '../src/config/events.config';
import { defaultSave, type SaveSystem } from '../src/meta/SaveSystem';
import { EventManager } from '../src/meta/EventManager';
import { PrimeApi } from '../src/net/PrimeApi';
import { SeasonRuntime } from '../src/game/SeasonRuntime';
import { canonicalJSON } from '../src/net/cloudSave';
import { REPORT_LIMITS } from '../src/season/seasonMath';
import { SEASON_MATH_FILE, SEASON_RULES_FILE, seasonMathSource, seasonRulesSource } from './backend';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, os, path, proc, sleep } from './lib/node';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
}
const section = (s: string) => console.log(`\n=== ${s}`);

const EV = EVENTS.find((e) => e.id === 'winter-2026')!;
const START = Date.parse(EV.start!);
const END = Date.parse(EV.end!);
const PORTS = { api: 19790, smtp: 11979, mailUi: 19791 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Winter2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-season-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
let pb: any = null;
const pbLog: string[] = [];
let clock = START;
const setClock = (t: number) => {
  clock = t;
  fs.writeFileSync(clockFile, String(t));
};
const tick = (ms: number) => setClock(clock + ms);

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_SEASON_CLOCK_FILE: clockFile, ...LEGACY_CHECK_ENV, ...extra } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}

interface User {
  id: string;
  token: string;
  session: { key: string; generation: number } | null;
  rev: number;
}
async function call(u: User | null, method: string, p: string, body?: Record<string, unknown>): Promise<{ status: number; j: any }> {
  const b = body && u?.session ? { ...body, session: u.session } : body;
  const r = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) });
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    j = null;
  }
  return { status: r.status, j };
}
const op = () => 'op_' + crypto.randomBytes(9).toString('hex');
const fight = (o: Record<string, unknown> = {}) => ({ outcome: 'win', method: 'ko', rating: 90, combos: 3, ultra: 0, perfects: 2, difficulty: 'pro', arena: 'holiday', seconds: 70, ...o });
const report = (u: User, f: Record<string, unknown> = {}, o = op()) => call(u, 'POST', '/api/prime/season/match', { event: EV.id, op: o, fight: fight(f) });
const state = async (u: User) => (await call(u, 'GET', `/api/prime/season?event=${EV.id}`)).j;
/** One fight's worth of real time (the time bank's step: the fight × realTime + the menus). */
const FIGHT_MS = (70 * REPORT_LIMITS.realTime + REPORT_LIMITS.overheadSeconds) * 1000 + 500;

async function main(): Promise<void> {
  section('Правила сервера сгенерированы из events.config.ts');
  check('season_rules.js is up to date (npm run backend:rules)', fs.readFileSync(SEASON_RULES_FILE, 'utf8') === seasonRulesSource());
  check('season_math.js is the bundle of src/season/seasonMath.ts (the same rules as the game)', fs.readFileSync(SEASON_MATH_FILE, 'utf8') === seasonMathSource());
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'season-admin@season.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setClock(START - 3 * 86400000);
  await startPb();
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const register = async (nick: string, email: string, verify = true): Promise<User> => {
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: nick, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const rec = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(rec.id, { verified: true });
    const c = new PocketBase(API);
    await c.collection('users').authWithPassword(email, PW);
    const u: User = { id: rec.id, token: c.authStore.token, session: null, rev: 0 };
    if (verify) {
      const key = crypto.randomBytes(16).toString('hex');
      const s = await call(u, 'POST', '/api/prime/session/claim', { key, label: 'season-check', device: 'node' });
      if (s.status !== 200) throw new Error('session claim: ' + s.status + ' ' + JSON.stringify(s.j));
      u.session = { key, generation: s.j.generation };
    }
    return u;
  };
  const ledger = async (u: User, reason?: string) => admin.collection('season_ledger').getFullList({ filter: `owner = "${u.id}"${reason ? ` && reason = "${reason}"` : ''}` });
  const putSave = async (u: User, s: any) => {
    const text = canonicalJSON(s);
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const r = await call(u, 'PUT', '/api/prime/save', { base: u.rev, data: text, hash, op: op(), device: 'node', client: 'season-check', reason: 'test' });
    if (r.status === 200) u.rev = r.j?.revision ?? u.rev + 1;
    return r;
  };

  section('Доступ');
  const cfg = await call(null, 'GET', '/api/prime/config');
  check('the server announces the seasonal wallet of winter-2026 (config season)', cfg.j.season?.on === true && cfg.j.season.events.join() === EV.id);
  check('a guest has no wallet: every season route needs a PRIME ID (401)', (await call(null, 'GET', `/api/prime/season?event=${EV.id}`)).status === 401 && (await call(null, 'POST', '/api/prime/season/match', { event: EV.id, op: op(), fight: fight() })).status === 401);
  const late = await register('LateSnow', 'late@season.test', false);
  check('an unconfirmed email cannot earn (403 not_verified)', (await call(late, 'GET', `/api/prime/season?event=${EV.id}`)).j?.code === 'not_verified');
  const A = await register('SnowStar', 'star@season.test');
  check('nobody reads or writes the season tables through the generic API', (await call(A, 'GET', '/api/collections/season_wallets/records')).status !== 200 && (await call(A, 'POST', '/api/collections/season_ledger/records', { delta: 9999 } as any)).status !== 200);
  check('an unknown event is refused (404)', (await call(A, 'GET', '/api/prime/season?event=halloween-2026')).status === 404 && (await call(A, 'POST', '/api/prime/season/match', { event: 'nope', op: op(), fight: fight() })).status === 404);

  section('До начала (анонс): ничего не зарабатывается и не продаётся');
  const s0 = await state(A);
  check('three days before: phase «announce», balance 0', s0.phase === 'announce' && s0.balance === 0);
  check('a fight before the start pays nothing (409 season_not_started)', (await report(A)).j?.code === 'season_not_started');
  check('the exchange and the quests are closed before the start', (await call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'crax' })).j?.code === 'season_not_started' && (await call(A, 'POST', '/api/prime/season/quest', { event: EV.id, op: op(), quest: 'first_snow' })).j?.code === 'season_not_started');
  setClock(START - 1);
  check('one millisecond before 03.12 00:00 МСК: still closed', (await report(A)).j?.code === 'season_not_started');

  section('Во время события: бой карьеры');
  setClock(START + 3600000);
  const noSess = { ...A, session: null };
  check('a report without the game session is refused (only the page that plays may report)', [409, 426].includes((await report(noSess)).status));
  const o1 = op();
  const r1 = await report(A, {}, o1);
  if (r1.status !== 200) console.log('   report answer:', r1.status, JSON.stringify(r1.j)?.slice(0, 400), '\n', pbLog.slice(-8).join('\n'));
  check('a won fight on HOLIDAY BROADCAST, rating 90, 3 combos: 4 + 2 + 2 + 3 + 2 = 13 canes', r1.status === 200 && r1.j.paid === 13 && r1.j.state.balance === 13);
  check('…the server counted the quests itself (5 matches, 15 wins, combos, perfects, rating 80+, the set, «Профи», earned)', r1.j.state.quests.first_snow.p === 1 && r1.j.state.quests.holiday_hat_trick.p === 1 && r1.j.state.quests.garland_combo.p === 3 && r1.j.state.quests.frost_guard.p === 2 && r1.j.state.quests.midnight_rating.p === 1 && r1.j.state.quests.holiday_broadcast.p === 1 && r1.j.state.quests.champions_eve.p === 1 && r1.j.state.quests.cane_collector.p === 13 && r1.j.state.quests.league_snowfall.p === 0);
  const dup = await report(A, {}, o1);
  check('the same report again (a lost answer): «duplicate», nothing paid twice', dup.j?.duplicate === true && dup.j.state.balance === 13 && (await ledger(A, 'match')).length === 1);
  tick(FIGHT_MS);
  check('a 10-second «fight» is refused (422 fight_too_short)', (await report(A, { seconds: 10 })).j?.code === 'fight_too_short');
  check('a malformed fight is refused (400)', (await report(A, { outcome: 'flawless' })).status === 400);
  const forged = await report(A, { rating: 999, combos: 999, perfects: 999, ultra: 999, difficulty: 'champion' });
  check('a forged report is clamped: rating ≤ 100, at most 3 paid combos — still 13 canes, quests +30 combos at most', forged.j?.paid === 13 && forged.j.state.quests.garland_combo.p === 3 + REPORT_LIMITS.combos);
  // the TIME BANK: a fresh account may send a short offline session at once (≤ bankReachMinutes of fights), never more
  const D = await register('BurstSnow', 'burst@season.test');
  let sent = 0;
  let refused: any = null;
  for (let i = 0; i < 80 && !refused; i++) {
    const r = await report(D);
    if (r.status === 200) sent++;
    else refused = r;
  }
  const reach = Math.floor((REPORT_LIMITS.bankReachMinutes * 60) / (70 * REPORT_LIMITS.realTime + REPORT_LIMITS.overheadSeconds));
  check(`the TIME BANK: a burst of invented fights stops after ${sent} (a ${REPORT_LIMITS.bankReachMinutes}-minute offline session ≈ ${reach}; 429 fights_too_fast)`, refused?.status === 429 && refused.j?.code === 'fights_too_fast' && sent <= Math.min(reach, REPORT_LIMITS.maxPerHour) + 1 && sent >= 20);
  tick(3600000);
  check('…an hour later (the hourly limit renewed, the bank refilled) the same account reports again', (await report(D)).status === 200);

  section('Дневной лимит и задания (сервер)');
  let capped = false;
  for (let i = 0; i < 8; i++) {
    tick(FIGHT_MS);
    const r = await report(A);
    capped = capped || r.j?.capped === true;
  }
  const sDay = await state(A);
  check(`the career's daily cap: never more than ${EV.earnings!.dailyCap} canes of fights in a Moscow day (now ${sDay.dayCareer}, «capped» said)`, sDay.dayCareer === EV.earnings!.dailyCap && capped);
  setClock(START + 86400000 + 3600000);
  const nd = await report(A);
  check('the next Moscow day pays again (the day by the server\'s clock)', nd.j?.paid === 13 && nd.j.state.dayCareer === 13);
  // quests move with the first questReportsPerDay reports of a day only
  setClock(START + 2 * 86400000 + 3600000);
  let lastQ = true;
  for (let i = 0; i < REPORT_LIMITS.questReportsPerDay + 1; i++) {
    tick(FIGHT_MS);
    const r = await report(A, { combos: 30, perfects: 30 });
    if (r.status !== 200) throw new Error('report refused: ' + JSON.stringify(r.j));
    lastQ = r.j.quests;
  }
  check(`the ${REPORT_LIMITS.questReportsPerDay + 1}-th report of a day pays (within the cap) but moves no quest — a forger never outpaces the busiest player`, lastQ === false);
  const sq = await state(A);
  const done = EV.quests.filter((q) => sq.quests[q.id].p >= q.target).map((q) => q.id);
  check('seven career quests finished after a busy day (the league quests need real league fights)', done.length === 7 && !done.includes('league_snowfall') && !done.includes('cane_collector'));
  check('a quest that is not finished cannot be claimed (409 quest_not_done)', (await call(A, 'POST', '/api/prime/season/quest', { event: EV.id, op: op(), quest: 'league_snowfall' })).j?.code === 'quest_not_done');
  const before = (await state(A)).balance;
  const race = await Promise.all([0, 1, 2, 3, 4].map(() => call(A, 'POST', '/api/prime/season/quest', { event: EV.id, op: op(), quest: 'first_snow' })));
  const okQ = race.filter((r) => r.status === 200);
  const rowsQ = (await ledger(A, 'quest')).filter((l: any) => l.ref === 'first_snow');
  check('five simultaneous claims of one quest: it pays once (one ledger row, +30)', okQ.length >= 1 && rowsQ.length === 1 && (await state(A)).balance === before + 30);
  for (const id of done) if (id !== 'first_snow') await call(A, 'POST', '/api/prime/season/quest', { event: EV.id, op: op(), quest: id });
  const sAll = await state(A);
  check('every finished quest paid exactly its reward', sAll.balance === before + done.reduce((x, id) => x + EV.quests.find((q) => q.id === id)!.reward, 0));

  section('Главный приз');
  const B = await register('NewSnow', 'new@season.test');
  setClock(START + 2 * 86400000 + 9 * 3600000);
  check('the grand prize needs 7 finished quests (409 grand_not_ready for a new account)', (await call(B, 'POST', '/api/prime/season/grand', { event: EV.id, op: op() })).j?.code === 'grand_not_ready');
  const g1 = await call(A, 'POST', '/api/prime/season/grand', { event: EV.id, op: op() });
  const g2 = await call(A, 'POST', '/api/prime/season/grand', { event: EV.id, op: op() });
  check('WINTER CHAMPION: granted once (a repeat is «duplicate»), it costs nothing, the wallet names it', g1.j?.item === 'title_winter_champion' && g2.j?.duplicate === true && g1.j.state.grandClaimed === true && g1.j.state.owned.cosmetics.includes('title_winter_champion') && (await ledger(A, 'grand')).length === 1);

  // two and a half weeks of ordinary play (the daily cap every day) — enough for CRAX and a couple of items
  for (let d = 3; d <= 21; d++) {
    setClock(START + d * 86400000 + 3600000);
    for (let k = 0; k < 4; k++) {
      tick(FIGHT_MS);
      await report(A);
    }
  }
  const sWeeks = await state(A);
  check(`daily caps over the weeks: the wallet grows only by the caps (now ${sWeeks.balance} canes, ${sWeeks.fights} of them from fights)`, sWeeks.balance >= 1300 && sWeeks.fights <= 22 * EV.earnings!.dailyCap);

  section('Обмен: атомарно, один раз, по цене сервера');
  check('an unknown item is refused (400)', (await call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'frame_spooky' })).status === 400);
  check('the grand prize is never sold in the exchange', (await call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'title_winter_champion' })).status === 400);
  const poor = await call(B, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'crax' });
  check('not enough canes: refused with the price (409 not_enough), nothing written', poor.j?.code === 'not_enough' && poor.j.cost === 900 && (await ledger(B, 'exchange')).length === 0);
  const bal0 = (await state(A)).balance;
  const items = EV.shop.map((x) => x.cosmetic as string);
  // a race: the balance covers CRAX, then two cosmetics bought at the same moment from what is left
  const ex1 = await call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'crax' });
  check('CRAX for 900 canes: the balance goes down by the server\'s price, the ledger row once', ex1.j?.ok === true && ex1.j.kind === 'fighter' && ex1.j.state.balance === bal0 - 900 && ex1.j.state.owned.fighters.includes('crax'));
  const ex1b = await call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'crax' });
  check('a second purchase of CRAX: «duplicate», never charged again', ex1b.j?.duplicate === true && ex1b.j.state.balance === bal0 - 900 && (await ledger(A, 'exchange')).length === 1);
  const left = (await state(A)).balance;
  const burstEx = await Promise.all(items.map((it) => call(A, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: it })));
  const sEx = await state(A);
  const spent = items.filter((it, i) => burstEx[i].j?.ok === true).reduce((x, it) => x + EV.shop.find((s) => s.cosmetic === it)!.cost, 0);
  check(`four purchases at once with ${left} canes: the balance never goes below zero and equals what was left minus what was sold`, sEx.balance >= 0 && sEx.balance === left - spent && burstEx.every((r) => r.status === 200 || r.j?.code === 'not_enough'));

  // 1.9.7 (the owner's rule for the sale after the season): an item the season ledger holds is never sold for roubles —
  // PRIME CHECKOUT answers «owned» even before any cloud save carries it (lib/payments.js seasonOwned → the ledger)
  const boughtCos = items.find((it, i) => burstEx[i].j?.ok === true);
  const skuOf = (cos: string) => ({ card_clockwork_gold: 'season_clockwork_gold', dash_candy_comet: 'season_candy_comet', frame_frostlight_live: 'season_frostlight_live', victory_midnight_confetti: 'season_midnight_confetti' })[cos]!;
  const coCrax = await call(A, 'POST', '/api/prime/shop/checkout', { sku: 'fighter_crax' });
  const coCos = boughtCos ? await call(A, 'POST', '/api/prime/shop/checkout', { sku: skuOf(boughtCos) }) : null;
  const coOther = await call(B, 'POST', '/api/prime/shop/checkout', { sku: 'fighter_crax' });
  check('PRIME SHOP: CRAX and an item bought for canes are «owned» for that account (the ledger, no cloud save needed); another account is told «seasonal_only» — no quote, no order', coCrax.status === 409 && coCrax.j?.code === 'owned' && !!coCos && coCos.status === 409 && coCos.j?.code === 'owned' && coOther.status === 409 && coOther.j?.code === 'seasonal_only' && !coCrax.j?.quote);
  if (!(coCrax.j?.code === 'owned' && coCos?.j?.code === 'owned')) console.log('   ', JSON.stringify([coCrax.status, coCrax.j, coCos?.j, coOther.j]));

  section('PRIME CLOUD: предметы сезона только с доказательством сервера');
  const base: any = defaultSave();
  const C = await register('Forger', 'forger@season.test');
  const forgedSave = { ...base, cosmetics: { ...base.cosmetics, owned: ['frame_frostlight_live'] } };
  check('a save that lists a winter item the server never sold is refused', (await putSave(C, forgedSave)).status !== 200);
  const forgedCrax: any = JSON.parse(JSON.stringify(base));
  forgedCrax.fighters.crax.unlocked = true;
  forgedCrax.events = { 'winter-2026': { quests: {}, tokens: 99999, earned: 99999, spent: 900, dayTokens: 0, day: '', bought: [], fighters: [{ id: 'crax', at: clock }] } };
  check('a save that opens CRAX with a made-up purchase record is refused (the season ledger must have it)', (await putSave(C, forgedCrax)).status !== 200);
  const guestCanes: any = JSON.parse(JSON.stringify(base));
  guestCanes.events = { 'winter-2026': { quests: {}, tokens: 99999, earned: 99999, spent: 0, dayTokens: 0, day: '', bought: [], fighters: [] } };
  const pg = await putSave(C, guestCanes);
  const sC = await state(C);
  check('a guest career with 99 999 local canes moves into PRIME ID — and the wallet still holds 0 (local canes are worth nothing)', pg.status === 200 && sC.balance === 0 && (await call(C, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'card_clockwork_gold' })).j?.code === 'not_enough');
  const real: any = JSON.parse(JSON.stringify(base));
  real.fighters.crax.unlocked = true;
  real.selected = 'crax';
  real.cosmetics.owned = ['title_winter_champion', ...items.filter((it, i) => burstEx[i].j?.ok === true)];
  real.events = { 'winter-2026': { quests: {}, tokens: sEx.balance, earned: 0, spent: 0, dayTokens: 0, day: '', bought: [], fighters: [{ id: 'crax', at: clock }] } };
  check('the save with what the server really sold (CRAX, the title, the bought items) is accepted', (await putSave(A, real)).status === 200);
  const hw: any = JSON.parse(JSON.stringify(base));
  hw.fighters.lucien.unlocked = true;
  hw.cosmetics.owned = ['card_pumpkin', 'title_halloween_champion'];
  hw.events = { 'halloween-2026': { quests: {}, tokens: 0, earned: 600, spent: 620, dayTokens: 0, day: '', bought: ['card_pumpkin'], fighters: [{ id: 'lucien', at: Date.parse('2026-10-25T10:00:00Z') }], grandClaimed: true } };
  check('a Halloween 2026 save (LUCIEN, PUMPKIN items) is accepted as before — its rules are unchanged', (await putSave(B, hw)).status === 200);

  section('Клиент SeasonRuntime ↔ сервер (настоящий PrimeApi, отчёт, очередь без связи, задание, обмен)');
  {
    setClock(START + 25 * 86400000 + 3600000);
    const E = await register('ClientSnow', 'client@season.test');
    const pbc = new PocketBase(API);
    pbc.autoCancellation(false);
    await pbc.collection('users').authWithPassword('client@season.test', PW);
    let offline = false;
    const fetchImpl = (async (url: any, init?: any) => {
      if (offline && String(url).includes('/api/prime/season')) throw new TypeError('Failed to fetch');
      return fetch(url, init);
    }) as typeof fetch;
    const api = new PrimeApi(pbc, 8000, fetchImpl);
    api.session = { key: E.session!.key, generation: E.session!.generation } as any;
    const store = { data: defaultSave(), saves: 0, save() {
      this.saves++;
    } };
    const events = new EventManager(store as unknown as SaveSystem, { clock: () => clock, settings: { mode: 'auto', forcedEventId: 'none' } });
    const cfgE = await api.config();
    const game: any = { events, applyCosmetics() {}, account: { serverConfig: cfgE, api, playing: E.id, me: { verified: true }, termsNeeded: () => false, ready: true, sync: { blocked: false }, onChange() {} } };
    const rt = new SeasonRuntime(game);
    rt.sync();
    await rt.refresh(true);
    check('the game\'s runtime sees the event, holds the gate and mirrors the empty wallet', rt.gate() === 'ok' && events.secureOnline === true && rt.wallet?.balance === 0 && (store.data.events[EV.id]?.tokens ?? 0) === 0);
    const res: any = { outcome: 'win', method: 'ko', rating: 90, peakRating: 90, avgRating: 80, bestCombo: null, combos: 3, comboList: [], perfects: 2, damageDealt: 1, damageTaken: 1, cardsUsed: 2, duration: 70, playerHpFrac: 1, enemyHpFrac: 0, finisher: false };
    const out = events.applyMatch(EV.id, res, 'pro', 'holiday')!;
    const paid = await rt.report(out);
    check('a finished fight: the runtime reports it, the server pays 13, the save mirrors the balance', paid?.paid === 13 && store.data.events[EV.id].tokens === 13 && store.data.events[EV.id].quests.first_snow.p === 1);
    offline = true;
    tick(FIGHT_MS);
    const lost = await rt.report(events.applyMatch(EV.id, res, 'pro', 'holiday')!);
    check('without a connection the fight waits in the queue (nothing paid yet, «offline»)', lost === null && rt.error === 'offline' && store.data.events[EV.id].tokens === 13);
    offline = false;
    tick(FIGHT_MS);
    await rt.flush();
    await rt.refresh(true);
    check('back online: the queued fight is sent once and paid (26 canes)', store.data.events[EV.id].tokens === 26 && (await ledger(E, 'match')).length === 2);
    for (let k = 0; k < 3; k++) {
      tick(FIGHT_MS);
      await rt.report(events.applyMatch(EV.id, res, 'pro', 'holiday')!);
    }
    const q = await rt.act('quest', 'first_snow');
    check('a quest claimed through the runtime: +30 from the server, the mirror says claimed', q.ok && q.reward === 30 && store.data.events[EV.id].quests.first_snow.claimed);
    for (let d = 26; d <= 29; d++) {
      setClock(START + d * 86400000 + 3600000);
      for (let k = 0; k < 4; k++) {
        tick(FIGHT_MS);
        await rt.report(events.applyMatch(EV.id, res, 'pro', 'holiday')!);
      }
    }
    const buy = await rt.act('exchange', 'card_clockwork_gold');
    check('an exchange through the runtime: the server sells CLOCKWORK GOLD, the item arrives in MY COLLECTION and is worn', buy.ok && buy.kind === 'cosmetic' && events.owns('card_clockwork_gold') && events.isEquipped('card_clockwork_gold'));
    const again = await rt.act('exchange', 'card_clockwork_gold');
    check('…a second press: «duplicate» from the server, no second charge', again.ok && (await ledger(E, 'exchange')).length === 1);
    const crax = await rt.act('exchange', 'crax');
    check('CRAX without enough canes: a clear reason, nothing bought', !crax.ok && /Не хватает/.test(crax.reason ?? '') && !store.data.fighters.crax.unlocked);
    const cloud = await putSave(E, JSON.parse(JSON.stringify(store.data)));
    check('the save the runtime produced (mirror + the bought item) is accepted by PRIME CLOUD', cloud.status === 200);
  }

  section('После окончания: ничего не начисляется и не продаётся, полученное остаётся');
  setClock(END - 1);
  check('one millisecond before 04.01 00:00 МСК: still running', (await state(A)).phase === 'running');
  setClock(END);
  const sEnd = await state(A);
  check('at 04.01.2027 00:00 МСК: phase «over»; CRAX and the items stay in the wallet', sEnd.phase === 'over' && sEnd.owned.fighters.includes('crax') && sEnd.owned.cosmetics.includes('title_winter_champion'));
  check('after the end: fights, quests, the grand prize and the exchange are closed (409 season_closed)', (await report(B)).j?.code === 'season_closed' && (await call(B, 'POST', '/api/prime/season/quest', { event: EV.id, op: op(), quest: 'first_snow' })).j?.code === 'season_closed' && (await call(B, 'POST', '/api/prime/season/exchange', { event: EV.id, op: op(), item: 'crax' })).j?.code === 'season_closed');
  check('the owner\'s save with the season\'s items is still accepted after the end', (await putSave(A, { ...real, money: 7 })).status === 200);

  section('Выключатель PRIME_SEASON=off');
  await stopChild(pb);
  await sleep(300);
  await startPb({ PRIME_SEASON: 'off' });
  const offCfg = await call(null, 'GET', '/api/prime/config');
  check('PRIME_SEASON=off: every season route answers 404 season_off, the config says off; saves still work', (await call(A, 'GET', `/api/prime/season?event=${EV.id}`)).j?.code === 'season_off' && offCfg.j.season.on === false && (await call(A, 'GET', '/api/prime/me')).status === 200);
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  the check crashed: ' + (e instanceof Error ? e.stack : String(e)));
    if (pbLog.length) console.log(pbLog.slice(-20).join('\n'));
  })
  .finally(async () => {
    if (pb) await stopChild(pb);
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      /* keep */
    }
    console.log(`\nwinter:server: ${failed ? 'FAILED' : 'OK'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed ? 1 : 0);
  });
