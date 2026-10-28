// Alpha 1.8.9 — `npm run daily`: DAILY PRIME STREAK.
//
//   1. the rules (pure, the very lib/daily.js the server runs): Moscow game days, the streak, the free shield,
//      milestones 7 / 14 / 30 / 60 / 100 and on after 100, the reward table and its balance against the economy;
//   2. a REAL PocketBase with a temporary database (deleted at the end; the developer's backend/pb_data and every real
//      server are never touched) whose «now» comes from a test clock file (PRIME_SERVER_ROLE=dev only): first visit,
//      first reward, the same day again, the next day, a missed day forgiven, a second miss, milestones, day 100 and
//      after, reload, sign-in on another device, two devices at once, parallel requests, a lost answer, a lost request,
//      a forged request, guests and unconfirmed accounts, the account's export and deletion, the off switch.
//
// The «devices» are the game's own classes (SaveSystem, SessionManager, SyncManager, PrimeApi) with an in-memory
// localStorage each. Real phones and a real network are NOT simulated. All accounts and money here are test data.

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { DAILY, dailyReward, nextMilestone } from '../src/config/daily.config';
import { FIGHTERS } from '../src/config/fighters';
import { CARDS, NEW_CARDS } from '../src/config/cards';
import { CareerSystem } from '../src/meta/CareerSystem';
import { SaveSystem, defaultSave, sanitize, type SaveData } from '../src/meta/SaveSystem';
import { readSync, userProfile } from '../src/net/accountStore';
import { canonicalJSON, cloudCopyOf } from '../src/net/cloudSave';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { SyncManager } from '../src/net/SyncManager';
import { dailyRulesSource } from './backend';
import { LEGACY_CHECK_ENV, ROOT, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { MemoryStorage } from './lib/fixtures';
import { crypto, fs, nodeModule, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
function section(t: string): void {
  console.log(`\n— ${t}`);
}

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const D = req('./daily.js');
const RULES = req('./daily_rules.js');
const V = req('./validate.js');
const DAY = 86400000;

// =============================================================== 1. the rules (pure)
function rulesChecks(): void {
  section('Правила: дни, серия, защита, рубежи');
  check('the server rules are generated from src/config/daily.config.ts and up to date (npm run backend:rules)', fs.readFileSync(path.join(ROOT, 'backend/pb_hooks/lib/daily_rules.js'), 'utf8') === dailyRulesSource());
  const parity = Array.from({ length: 420 }, (_, i) => i + 1).every((n) => JSON.stringify(dailyReward(n)) === JSON.stringify(D.rewardFor(n)) && JSON.stringify(nextMilestone(n)) === JSON.stringify(D.nextMilestone(n)));
  check('the game and the server read the same table (days 1–420, rewards and next milestones identical)', parity);
  // Moscow game days: UTC+3, the day turns at 21:00 UTC
  const d = D.gameDay(Date.parse('2026-11-02T20:59:59Z'));
  check('game day = Moscow calendar day: 23:59:59 MSK and 00:00:00 MSK are two days; the day starts at 21:00 UTC', D.gameDay(Date.parse('2026-11-02T21:00:00Z')) === d + 1 && D.dayStart(d + 1) === Date.parse('2026-11-02T21:00:00Z') && D.gameDay(Date.parse('2026-11-02T00:30:00Z')) === d);

  let st = D.emptyState();
  const T = 20400; // any game day
  const a1 = D.apply(st, T);
  check('first reward: day 1 of the streak, $75, the record is 1', a1 && a1.claim.streakDay === 1 && a1.claim.money === DAILY.week[0] && a1.state.best === 1 && a1.state.claims === 1);
  st = a1.state;
  check('the same day again: nothing to take (claimed), no second reward', D.plan(st, T).state === 'claimed' && D.apply(st, T) === null);
  check('a day «from the future» on the record (the clock went back): nothing paid', D.plan({ ...st, lastDay: T + 3 }, T).state === 'clock' && D.apply({ ...st, lastDay: T + 3 }, T) === null);
  const a2 = D.apply(st, T + 1);
  check('the next day: day 2, $100', a2.claim.streakDay === 2 && a2.claim.money === DAILY.week[1] && !a2.claim.shield && !a2.claim.reset);
  st = a2.state;
  // one missed day (T+2): forgiven on T+3 — no reward for the missed day, the counter just goes on
  check('one missed day: the status says the shield will save the streak', D.view(st, T + 3, 0, []).willShield && D.view(st, T + 3, 0, []).streak === 2);
  const a3 = D.apply(st, T + 3);
  check('one missed day is forgiven by the free shield: day 3 (not 4 — the missed day pays nothing), shield spent on the missed day', a3.claim.streakDay === 3 && a3.claim.shield && a3.state.shieldDay === T + 2 && a3.state.claims === 3);
  st = a3.state;
  const v3 = D.view(st, T + 3, 0, []);
  check('after using it, the shield is recharging (ready again 7 days after the forgiven day)', !v3.shield.ready && v3.shield.readyOn === T + 2 + DAILY.shieldDays);
  st = D.apply(st, T + 4).state; // day 4
  // a second miss within 7 days (T+5 missed, claim T+6): the streak starts again, the record stays
  const r = D.apply(st, T + 6);
  check('a second miss within 7 days: the streak starts again from day 1, the record (4) and everything paid stay', r.claim.streakDay === 1 && r.claim.reset && !r.claim.shield && r.state.best === 4 && r.state.total === st.total + DAILY.week[0]);
  check('the status before such a claim says honestly that the streak broke', D.view(st, T + 6, 0, []).willReset && D.view(st, T + 6, 0, []).streak === 0);
  st = r.state;
  // two days missed at once: never forgiven
  const two = D.apply({ ...st, shieldDay: 0 }, T + 9);
  check('two days missed in a row: the streak starts again even with the shield ready', two.claim.streakDay === 1 && two.claim.reset && !two.claim.shield);
  // the shield is ready again 7 days after the last forgiven day
  let s7 = { ...D.emptyState(), streak: 10, best: 10, lastDay: 1000, shieldDay: 994, claims: 10 };
  check('the shield forgives again once 7 calendar days passed since the last forgiven day (and not one day sooner)', D.apply(s7, 1002).claim.shield === true && D.apply({ ...s7, shieldDay: 995 }, 1002).claim.reset === true);

  // a long streak, every day: milestones 7 / 14 / 30 / 60 / 100 and on after day 100
  let ls = D.emptyState();
  const paid: Record<number, any> = {};
  for (let i = 0; i < 205; i++) {
    const x = D.apply(ls, 30000 + i);
    paid[x.claim.streakDay] = x.claim;
    ls = x.state;
  }
  const m = (n: number) => DAILY.milestones.find((q) => q.day === n)!.money;
  check('day 7: the first milestone «7 ДНЕЙ В ЭФИРЕ!» ($400) — a first achievement', paid[7].kind === 'milestone' && paid[7].money === m(7) && paid[7].first && paid[7].label === '7 ДНЕЙ В ЭФИРЕ!');
  check('days 14, 30, 60, 100: their milestones ($600, $1 000, $1 500, $2 500), each a first achievement', [14, 30, 60, 100].every((n) => paid[n].kind === 'milestone' && paid[n].money === m(n) && paid[n].first));
  check('between milestones the weekly gift every 7th day ($250) and ordinary days go on', paid[21].kind === 'weekly' && paid[21].money === DAILY.week[6] && paid[22].kind === 'daily' && paid[22].money === DAILY.week[0]);
  check('after day 100 the streak goes on: day 101, the weekly gifts, and day 200 is a jubilee ($2 500)', paid[101].money === dailyReward(101).money && paid[105].kind === 'weekly' && paid[200].kind === 'milestone' && paid[200].money === DAILY.jubileeMoney && ls.streak === 205 && ls.best === 205);
  check('the milestones reached are remembered with their day', [7, 14, 30, 60, 100, 200].every((n) => ls.achieved[String(n)] > 0));
  // a broken streak keeps every achievement; reaching 7 again pays again but is not a new achievement
  let br = { ...ls, lastDay: ls.lastDay };
  br = D.apply(br, ls.lastDay + 5).state; // reset
  for (let i = 1; i < 7; i++) br = D.apply(br, ls.lastDay + 5 + i).state;
  check('a new streak reaching day 7 again: the milestone pays again, it is not a new achievement, the record stays 205', br.streak === 7 && br.best === 205 && br.achieved['7'] === ls.achieved['7'] && br.total === ls.total + [1, 2, 3, 4, 5, 6].reduce((t, n) => t + dailyReward(n).money, 0) + m(7));
  const vv = D.view(ls, ls.lastDay, 0, []);
  check('the status: claimed today, the next 7 rewards from tomorrow, the next milestone and how far', vv.claimedToday && !vv.canClaim && vv.upcoming.length === 7 && vv.upcoming[0].day === 206 && vv.nextMilestone.day === 300 && vv.nextMilestone.left === 95);
}

function balanceChecks(): void {
  section('Баланс: ежедневные награды и экономика карьеры');
  const career = new CareerSystem({ data: defaultSave(), save() {} } as any);
  const win = career.computeRewards({ outcome: 'win', method: 'ko', rating: 72, combos: 2, perfects: 1 } as any, 'ray', 'rookie').money;
  const week = Array.from({ length: 7 }, (_, i) => dailyReward(i + 1).money).reduce((a, b) => a + b, 0);
  const month = Array.from({ length: 30 }, (_, i) => dailyReward(i + 1).money).reduce((a, b) => a + b, 0);
  const contracts = Object.values(FIGHTERS).reduce((t, f) => t + (f.contract?.cost ?? 0), 0);
  const cards = NEW_CARDS.reduce((t, c) => t + (CARDS[c].shop?.price ?? 0), 0);
  console.log(`      typical rookie KO win $${win}; week of visits $${week}; first 30 days $${month}; all contracts $${contracts}; all shop cards $${cards}`);
  check(`a full week of visits ($${week}) is about two and a half rookie wins — under 3 wins`, week <= 3 * win && week >= 2 * win);
  check('a week of visits buys about one contract — never most of the roster or the card collection (< 25% of each)', week < contracts * 0.25 && week < cards * 0.25);
  check(`the first month ($${month}) stays well under half of everything there is to buy (contracts + cards $${contracts + cards})`, month < (contracts + cards) * 0.5);
  check('an ordinary day pays less than half a rookie win, the weekly gift less than one; milestones from about one win (day 7) to six (day 100)', Array.from({ length: 6 }, (_, i) => dailyReward(i + 1).money).every((x) => x < win / 2) && dailyReward(21).money < win && DAILY.milestones.every((q) => q.money >= win * 0.9 && q.money <= win * 6));
  check('only dollars: no new currency, no PRIME TOKENS, no paid items in the daily table', !/token|sku|skin|cosmetic/i.test(JSON.stringify(RULES)));
}

function saveChecks(): void {
  section('Сохранение: отметка награды, облачная копия, проверка сервера');
  const s = { ...defaultSave(), orgName: 'НЕОН · СТУДИЯ', money: 1234.5 } as any;
  const text = cloudCopyOf(JSON.stringify(s)).text;
  check('the server builds the cloud text exactly like the game (canonical JSON, Cyrillic, fractions)', D.canonicalJSON(JSON.parse(text)) === text && D.canonicalJSON(s) === canonicalJSON(s));
  const credited = D.creditSave(text, 75, 1, 20400);
  const o = JSON.parse(credited);
  check('the reward in the cloud save: money + amount, the claim mark; nothing else changes', o.money === 1234.5 + 75 && o.daily.claims === 1 && o.daily.day === 20400 && JSON.stringify({ ...o, money: 0, daily: 0 }) === JSON.stringify({ ...JSON.parse(text), money: 0, daily: 0 }));
  check('not a save → nothing is credited', D.creditSave('{oops', 75, 1, 1) === null && D.creditSave('{"x":1}', 75, 1, 1) === null);
  check('the server accepts a save with the mark, refuses a malformed one', V.validateSave(sanitize(o)).length === 0 && V.validateSave({ ...sanitize(o), daily: { claims: -1, day: 'x' } }).length > 0);
  const clean = sanitize({ version: 12, daily: { claims: 'x', day: -5 } });
  check('the game reads the mark defensively; an old save has none', clean.daily.claims === 0 && clean.daily.day === 0 && sanitize({ version: 11 }).daily.claims === 0);
}

// =============================================================== 2. a real PocketBase
const PORTS = { api: 19590, smtp: 11959, mailUi: 19591 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Daily2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-daily-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
const START = Date.parse('2026-11-02T09:00:00Z'); // 12:00 Moscow
let pb: any = null;
const pbLog: string[] = [];

function setDay(n: number, hourMsk = 12): number {
  const t = START + n * DAY + (hourMsk - 12) * 3600000;
  fs.writeFileSync(clockFile, String(t));
  return D.gameDay(t);
}

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_DAILY_CLOCK_FILE: clockFile, ...LEGACY_CHECK_ENV, ...extra } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}

type Fetch = typeof fetch;
class Browser {
  storage = new MemoryStorage();
  token = '';
  record: any = null;
  /** 'response': the claim reaches the server, its answer is lost; 'request': it never leaves. */
  drop: '' | 'response' | 'request' = '';
  constructor(readonly label: string) {}
  readonly fetchImpl: Fetch = (async (url: any, init?: any) => {
    const claim = String(url).includes('/api/prime/daily/claim');
    if (claim && this.drop === 'request') throw new TypeError('Failed to fetch');
    const r = await fetch(url, init);
    if (claim && this.drop === 'response') {
      await r.text();
      throw new TypeError('Failed to fetch');
    }
    return r;
  }) as Fetch;
  api(): PrimeApi {
    const client = new PocketBase(API, new BaseAuthStore());
    if (this.token) client.authStore.save(this.token, this.record);
    return new PrimeApi(client, 5000, this.fetchImpl);
  }
  async login(email: string): Promise<void> {
    const a = this.api();
    await a.login(email, PW);
    this.token = a.pb.authStore.token;
    this.record = a.pb.authStore.record;
  }
}

class Page {
  readonly api: PrimeApi;
  readonly save: SaveSystem;
  readonly session: SessionManager;
  readonly sync: SyncManager;
  constructor(
    readonly b: Browser,
    readonly uid: string,
  ) {
    this.api = b.api();
    this.save = new SaveSystem({ profile: userProfile(uid), storage: b.storage });
    this.session = new SessionManager({ api: this.api, device: this.save.meta.device, label: b.label });
    this.sync = new SyncManager({ save: this.save, api: this.api, storage: b.storage, session: this.session });
  }
  async open(): Promise<string> {
    const st = await this.session.claim();
    if (st !== 'active') return st;
    const r = await this.sync.reconcile();
    if (r === 'ok') this.sync.startSession();
    return r;
  }
  play(money: number): void {
    this.save.data.money += money;
    this.save.data.matches += 1;
    this.save.save();
  }
}

async function register(nickname: string, email: string): Promise<void> {
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
}
const cloudMoney = async (api: PrimeApi) => {
  const c = await api.getSave();
  return c ? (JSON.parse(c.text) as SaveData).money : -1;
};
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PrimeApiError ? e.code : 'thrown';
  }
};

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'daily-admin@daily.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setDay(0);
  await startPb();
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  check('the migration added the daily rate limit', st.rules.some((r: any) => r.label === '/api/prime/daily'));
  const verify = async (email: string) => {
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    return u.id as string;
  };
  const claimsOf = async (uid: string) => admin.collection('daily_claims').getFullList({ filter: `owner = "${uid}"`, sort: 'seq' });

  section('Сервер: доступ');
  const guest = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('the server announces DAILY PRIME STREAK (config daily = 1)', (await guest.config()).daily === true);
  check('a guest (no PRIME ID) gets nothing: status and claim need sign-in (401)', (await codeOf(guest.dailyStatus())) === 'unauthorized' && (await codeOf(guest.dailyClaim('daily_guest_try1', 0))) === 'unauthorized');
  check('nobody reads or writes the streak tables through the generic API', (await codeOf(guest.pb.collection('daily_claims').getList(1, 1))) !== 'ok' && (await codeOf(guest.pb.collection('daily_streaks').create({ streak: 99 }))) !== 'ok');
  await register('LateMail', 'late@daily.test');
  const late = new Browser('late');
  await late.login('late@daily.test');
  check('an account with an unconfirmed email cannot take rewards (403)', (await codeOf(late.api().dailyStatus())) === 'not_verified');

  section('Сервер: первый вход, первая награда, тот же день');
  await register('DailyStar', 'star@daily.test');
  const uid = await verify('star@daily.test');
  const phone = new Browser('iPhone');
  await phone.login('star@daily.test');
  const p1 = new Page(phone, uid);
  check('opening the game: the session claimed, the career compared with PRIME CLOUD', (await p1.open()) === 'ok');
  const s0 = await p1.api.dailyStatus();
  check('first visit: a gift waits — day 1, $75, streak 0, record 0, the shield ready', s0.canClaim && !s0.claimedToday && s0.streak === 0 && s0.best === 0 && s0.next.day === 1 && s0.next.money === 75 && s0.shield.ready && s0.upcoming.length === 7);
  p1.play(300); // a match played, not uploaded yet
  const before = p1.save.data.money;
  const c1 = await p1.sync.claimDaily();
  const m1 = readSync(phone.storage, userProfile(uid));
  const cloud1 = await p1.api.getSave();
  check('the first reward: paid by the server ($75) — the unsent match went up FIRST, then the reward on top of it', c1.ok && c1.claim.money === 75 && c1.claim.streakDay === 1 && p1.save.data.money === before + 75 && (await cloudMoney(p1.api)) === before + 75);
  check('this device holds exactly the cloud text (the same hash: no reload, no second upload, no conflict)', !!cloud1 && m1.hash === cloud1.hash && cloudCopyOf(p1.save.serialized()).hash === cloud1.hash && m1.revision === cloud1.revision && p1.sync.status === 'synced' && m1.daily === null);
  check('the cloud save carries the claim mark; the version before the reward is kept in the history', JSON.parse(cloud1!.text).daily.claims === 1 && (await admin.collection('save_history').getFullList({ filter: `owner = "${uid}" && reason = "daily"` })).length === 1);
  const again = await p1.sync.claimDaily();
  check('the same day again (a second tap, a reload): «already claimed», no money, no new revision', !again.ok && again.code === 'already_claimed' && p1.save.data.money === before + 75 && (await p1.api.getSave())!.revision === cloud1!.revision);
  const reload = new Page(phone, uid);
  check('reload: the progress and the reward are there, today is «received»', (await reload.open()) === 'ok' && reload.save.data.money === before + 75 && (await reload.api.dailyStatus()).claimedToday);

  section('Сервер: следующий день, подделанный запрос, повтор запроса, параллельные запросы');
  setDay(1);
  const sesBody = () => (reload.api as any).sessionBody();
  const forged = await fetch(`${API}/api/prime/daily/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: phone.token }, body: JSON.stringify({ op: 'daily_forged_req1', base: (await reload.api.getSave())!.revision, ...sesBody(), money: 999999, day: 1, streak: 50, streakDay: 50 }) });
  const fj = (await forged.json()) as any;
  check('the next day: day 2 — and a hand-made request naming its own money, day and streak is paid the table amount ($100, day 2)', forged.status === 200 && fj.claim.money === 100 && fj.claim.streakDay === 2 && fj.claim.day === setDay(1));
  const dup = await fetch(`${API}/api/prime/daily/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: phone.token }, body: JSON.stringify({ op: 'daily_forged_req1', base: 0, ...sesBody() }) });
  const dj = (await dup.json()) as any;
  check('the same request again (its answer was lost): the same claim, «duplicate», nothing paid twice', dup.status === 200 && dj.duplicate === true && dj.claim.seq === fj.claim.seq && (await claimsOf(uid)).length === 2);
  // the page did not hear that answer: its copy catches up from the cloud (the server wrote a newer revision)
  const p2 = new Page(phone, uid);
  check('a page opened after it loads the reward from the cloud', (await p2.open()) !== 'failed' && (await cloudMoney(p2.api)) === before + 175);
  setDay(2);
  const fresh = new Page(phone, uid);
  await fresh.open();
  const base = (await fresh.api.getSave())!.revision;
  const par = await Promise.allSettled([fresh.api.dailyClaim('daily_parallel_a1', base), fresh.api.dailyClaim('daily_parallel_b1', base), fresh.api.dailyClaim('daily_parallel_c1', base)]);
  const won = par.filter((x) => x.status === 'fulfilled');
  const lost = par.filter((x) => x.status === 'rejected').map((x: any) => x.reason?.code);
  check('three parallel requests on one day: exactly one is paid, the others are refused', won.length === 1 && lost.length === 2 && lost.every((c) => c === 'already_claimed' || c === 'conflict'), JSON.stringify(lost));
  check('…and the cloud money grew by one reward only (day 3, $125)', (await cloudMoney(fresh.api)) === before + 175 + 125 && (await claimsOf(uid)).length === 3);

  section('Сервер: два устройства');
  setDay(3);
  const mac = new Browser('Mac');
  await mac.login('star@daily.test');
  const pm = new Page(mac, uid);
  check('another device signs in: it takes the session and loads the same progress', (await pm.open()) !== 'failed' && (await pm.api.dailyStatus()).streak === 3);
  const oldPage = await fresh.sync.claimDaily();
  check('the page that lost the session cannot claim (the session belongs to the other device)', !oldPage.ok && oldPage.code === 'session');
  const onMac = await pm.sync.claimDaily();
  check('the active device claims day 4 ($100); the first one, coming back, sees «received» and cannot take it again', onMac.ok && onMac.claim.streakDay === 4 && (await new Page(phone, uid).api.dailyStatus()).claimedToday);

  section('Сервер: пропуски и защита серии');
  setDay(5); // day 4 (game) missed
  const sk = await pm.api.dailyStatus();
  check('one missed day: the status promises the shield (the streak is still 4, not broken)', sk.canClaim && sk.willShield && !sk.willReset && sk.streak === 4);
  const sh = await pm.sync.claimDaily();
  check('the reward after a missed day: the shield forgave it — day 5 ($150), not a reset; the missed day paid nothing', sh.ok && sh.claim.shield && sh.claim.streakDay === 5 && sh.claim.money === 150 && (await claimsOf(uid)).length === 5);
  const after = await pm.api.dailyStatus();
  check('the shield is recharging now: the window says when it is ready again', !after.shield.ready && after.shield.readyOn === after.today - 1 + DAILY.shieldDays);
  setDay(7); // missed again within 7 days
  const rs = await pm.api.dailyStatus();
  check('a second miss while the shield recharges: the status says the streak starts again, the record 5 stays', rs.willReset && rs.streak === 0 && rs.best === 5);
  const rc = await pm.sync.claimDaily();
  check('…and the reward is day 1 of a new streak; everything paid before stays in the save', rc.ok && rc.claim.reset && rc.claim.streakDay === 1 && pm.save.data.money === before + 175 + 125 + 100 + 150 + 75);

  section('Сервер: рубежи 7 / 14 / 30 / 60 / 100 и после 100');
  const walker = new Browser('Pixel');
  await register('Marathon', 'run@daily.test');
  const rid = await verify('run@daily.test');
  await walker.login('run@daily.test');
  const pw = new Page(walker, rid);
  await pw.open();
  const got: Record<number, any> = {};
  let sum = 0;
  let synced = true;
  for (let i = 0; i < 106; i++) {
    setDay(100 + i, i % 2 ? 23 : 1); // late at night and just after midnight — still one game day each
    const r = await pw.sync.claimDaily();
    if (!r.ok) {
      check(`day ${i + 1} paid`, false, r.code);
      break;
    }
    got[r.claim.streakDay] = r.claim;
    sum += r.claim.money;
    if (cloudCopyOf(pw.save.serialized()).hash !== readSync(walker.storage, userProfile(rid)).hash) synced = false;
  }
  check('106 days in a row: day 7 «7 ДНЕЙ В ЭФИРЕ!» $400 (a first achievement)', got[7]?.kind === 'milestone' && got[7].money === 400 && got[7].first);
  check('days 14, 30, 60 and 100 pay their milestones ($600, $1 000, $1 500, $2 500)', got[14]?.money === 600 && got[30]?.money === 1000 && got[60]?.money === 1500 && got[100]?.money === 2500 && got[100].label.includes('100 ДНЕЙ'));
  check('after day 100 the streak goes on with the ordinary week (day 101 $125 … day 105 the weekly gift $250 … 106)', got[101]?.money === dailyReward(101).money && got[101].money === 125 && got[105]?.kind === 'weekly' && got[105].money === 250 && got[106]?.streakDay === 106);
  const fin = await pw.api.dailyStatus();
  check('the server\'s total equals the table (no rounding, nothing extra) and the save holds every dollar', fin.total === sum && pw.save.data.money === defaultSave().money + sum && (await cloudMoney(pw.api)) === pw.save.data.money);
  check('every day the device stayed byte-for-byte in step with the cloud (no conflict, no reload)', synced && pw.sync.status === 'synced');
  check('the milestones reached are on the track with their day', fin.milestones.every((q) => q.reached && q.on > 0) && fin.best === 106 && fin.nextMilestone.day === 200);

  section('Сервер: обрыв соединения');
  setDay(300);
  walker.drop = 'response';
  const lostAns = await pw.sync.claimDaily();
  const pend = readSync(walker.storage, userProfile(rid)).daily;
  check('the answer is lost: the game says «offline», keeps the request id — and does not pretend anything was paid', !lostAns.ok && lostAns.code === 'offline' && !!pend && pw.save.data.daily.claims === 106);
  walker.drop = '';
  const moneyBefore = pw.save.data.money;
  const settle = await pw.sync.claimDaily();
  check('back online: the same id is asked again — the reward that DID land is applied here once (no second payment)', settle.ok && settle.applied && pw.save.data.money === moneyBefore + settle.claim.money && (await claimsOf(rid)).length === 107 && readSync(walker.storage, userProfile(rid)).daily === null);
  check('…and this device is in step with the cloud (same hash)', cloudCopyOf(pw.save.serialized()).hash === (await pw.api.getSave())!.hash);
  setDay(301);
  walker.drop = 'request';
  const neverSent = await pw.sync.claimDaily();
  check('the request never leaves: «offline», nothing paid on the server', !neverSent.ok && neverSent.code === 'offline' && (await claimsOf(rid)).length === 107);
  walker.drop = '';
  pw.play(50); // played meanwhile
  const sync2 = await pw.sync.syncNow();
  check('the next upload settles the waiting claim first (paid once), then the match goes up — in step, no conflict', sync2 === 'synced' && (await claimsOf(rid)).length === 108 && (await cloudMoney(pw.api)) === pw.save.data.money);

  section('Сервер: «Мои данные», удаление, выключатель');
  const exp = await fetch(`${API}/api/prime/account/export`, { headers: { Authorization: walker.token } });
  const ej = (await exp.json()) as any;
  check('«Мои данные»: the export lists the streak and every daily reward', exp.status === 200 && ej.daily?.claims?.length === 108 && ej.daily.best === 106);
  await admin.collection('users').delete(rid);
  check('deleting the PRIME ID deletes its streak and its daily rewards', (await admin.collection('daily_claims').getFullList({ filter: `owner = "${rid}"` })).length === 0 && (await admin.collection('daily_streaks').getFullList({ filter: `owner = "${rid}"` })).length === 0);
  await stopChild(pb);
  await startPb({ PRIME_DAILY: 'off' });
  check('PRIME_DAILY=off: the server announces no gift (config daily = 0) and refuses the routes', (await guest.config()).daily === false && (await codeOf(phone.api().dailyStatus())) === 'daily_disabled');
  await stopChild(pb);
  // a production server never reads the test clock
  fs.writeFileSync(clockFile, String(Date.parse('2031-01-01T12:00:00Z')));
  await startPb({ PRIME_SERVER_ROLE: 'production' });
  const ph = new Browser('prod-like');
  await ph.login('star@daily.test');
  const real = await ph.api().dailyStatus();
  check('a production server ignores the test clock: «today» is the real Moscow day', real.today === D.gameDay(Date.now()));
  await stopChild(pb);
  pb = null;
}

async function main(): Promise<void> {
  rulesChecks();
  balanceChecks();
  saveChecks();
  try {
    await serverChecks();
  } catch (e) {
    check('server checks ran to the end', false, String(e).slice(0, 400) + '\n' + pbLog.slice(-12).join('\n'));
  } finally {
    if (pb) await stopChild(pb);
    await sleep(200);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${failed ? `daily: FAILED (${passed} passed, ${failed} failed)` : `daily: OK (${passed} passed, 0 failed)`} — временная база удалена`);
  proc.exitCode = failed ? 1 : 0;
}

void main();
