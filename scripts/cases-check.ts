// Headless checks for Beta 2.4 REWARD CASES (npm run cases): the pure rules, then a REAL PocketBase in a temporary
// folder with the real game client (SaveSystem + SessionManager + SyncManager):
//   * the catalogue: lib/case_rules.js is exactly src/config/cases.config.ts; every table sums to 100 %; the player's
//     odds without an owned exclusive / without PRIME TOKENS are re-spread in proportion and still sum to 100 %; the
//     game and the server compute the same odds; amounts stay in their ranges; the save credit and its mark;
//   * PRIME INVITE CASE: an invitation confirmed by 60 verified minutes gives one case to the inviter and one to the
//     invitee — confirmed by the invitee's or the inviter's reading, never twice (re-reads, parallel reads); an
//     invitation confirmed BEFORE cases were switched on gets nothing automatically; the inviter sees progress without
//     names; cases accumulate; the invitee is rewarded as an invitee once;
//   * opening: the server draws, writes and marks the case in one go — dollars / reputation into the cloud save (same
//     text on the device), PRIME TOKENS into the league ledger, the exclusive into MY COLLECTION (proven by the case);
//     a lost answer is asked again with the same op (same result, never a second draw); parallel opens take different
//     cases or none; a wrong revision cannot «re-roll»; the exclusive comes once and then leaves the table;
//   * DAILY BROADCAST CASE: an ordinary day's dollars are replaced by the case (never both), the weekly gift and the
//     milestones keep theirs and add a case, one case per day, the tier grows with the streak; an older game (no
//     `cases`) keeps the old dollars;
//   * access, the generic API closed, «Мои данные», PRIME_CASES off by default.
import PocketBase, { BaseAuthStore } from 'pocketbase';
import { CASES, INVITE_EXCLUSIVE, dailyTierOf, oddsOf } from '../src/config/cases.config';
import { SaveSystem, defaultSave, sanitize } from '../src/meta/SaveSystem';
import { userProfile } from '../src/net/accountStore';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { SyncManager } from '../src/net/SyncManager';
import { caseRulesSource } from './backend';
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
const C = req('./cases.js');
const D = req('./daily.js');
const V = req('./validate.js');
const LEAGUE_RULES = req('./league_rules.js');
const DAY = 86400000;

// =============================================================== 1. the rules
function rulesChecks(): void {
  section('Правила (каталог и чистый код сервера)');
  check('lib/case_rules.js is exactly src/config/cases.config.ts (npm run backend:rules)', fs.readFileSync(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'case_rules.js'), 'utf8') === caseRulesSource());
  const tables = [CASES.invite, ...CASES.daily.map((d) => d.table)];
  check('every table sums to exactly 100 % (10 000 basis points), every outcome has a positive weight and a sane range', tables.every((t) => t.reduce((s, x) => s + x.weight, 0) === 10000 && t.every((x) => x.weight > 0 && x.min >= 1 && x.max >= x.min)));
  check('the invite table: dollars, reputation, PRIME TOKENS, a big fee and ONE exclusive item (legendary, 4 %)', CASES.invite.map((x) => x.kind).join() === 'money,rep,tokens,money,item' && CASES.invite[4].item === INVITE_EXCLUSIVE && CASES.invite[4].weight === 400 && CASES.invite[4].rarity === 'legendary');
  check('DAILY has no item and is worth less than INVITE (every amount range lower)', CASES.daily.every((d) => d.table.every((x) => x.kind !== 'item')) && Math.max(...CASES.daily.flatMap((d) => d.table.filter((x) => x.kind === 'money').map((x) => x.max))) < Math.min(...CASES.invite.filter((x) => x.kind === 'money').map((x) => x.min)) + 100);
  check('the DAILY tier grows with the streak: days 1–6 tier 1, 7–29 tier 2, 30+ tier 3 (server = game)', [1, 6, 7, 29, 30, 100].map((d) => C.dailyTier(d)).join() === '1,1,2,2,3,3' && [1, 6, 7, 29, 30, 100].every((d) => dailyTierOf(d).tier === C.dailyTier(d)));
  const sum = (o: { share: number }[]) => o.reduce((s: number, x) => s + x.share, 0);
  const full = C.oddsOf(CASES.invite, { owned: [], tokens: true });
  check('all available: the shares are the weights exactly (45 / 25 / 20 / 6 / 4 %)', full.map((x: any) => x.share).join() === '4500,2500,2000,600,400');
  const noItem = C.oddsOf(CASES.invite, { owned: [INVITE_EXCLUSIVE], tokens: true });
  check('the exclusive owned: it leaves the table, the rest re-spread in proportion, still 100 %', noItem.length === 4 && !noItem.some((x: any) => x.outcome.kind === 'item') && sum(noItem) === 10000 && Math.abs(noItem[0].share / noItem[1].share - 4500 / 2500) < 0.01);
  const noTok = C.oddsOf(CASES.invite, { owned: [], tokens: false });
  check('no PRIME TOKENS possible (no league profile / tokens off): tokens leave, 100 % kept', !noTok.some((x: any) => x.outcome.kind === 'tokens') && sum(noTok) === 10000);
  const same = [
    { owned: [], tokens: true },
    { owned: [INVITE_EXCLUSIVE], tokens: true },
    { owned: [], tokens: false },
    { owned: [INVITE_EXCLUSIVE], tokens: false },
  ].every((o) => tables.every((t) => JSON.stringify(C.oddsOf(t, o).map((x: any) => [x.outcome.id, x.share])) === JSON.stringify(oddsOf(t, o).map((x) => [x.outcome.id, x.share]))));
  check('the game shows exactly the server\'s odds (the same function in both)', same);
  const odds = C.oddsOf(CASES.invite, { owned: [], tokens: true });
  check('a roll lands where its share says: 0 → first, 4499 → first, 4500 → second, 9999 → last', C.pick(odds, 0).outcome.id === 'inv_money' && C.pick(odds, 4499).outcome.id === 'inv_money' && C.pick(odds, 4500).outcome.id === 'inv_rep' && C.pick(odds, 9999).outcome.id === 'inv_signal');
  const counts: Record<string, number> = {};
  for (let r = 0; r < 10000; r++) counts[C.pick(odds, r).outcome.id] = (counts[C.pick(odds, r).outcome.id] ?? 0) + 1;
  check('over every roll 0…9999 each outcome gets exactly its share (the odds shown are the odds drawn)', odds.every((o: any) => counts[o.outcome.id] === o.share));
  check('an amount stays inside its range for any roll', tables.flat().every((x) => [0, 1, 7, 123456789, 999999999].every((r) => C.amountOf(x, r) >= x.min && C.amountOf(x, r) <= x.max)) && C.amountOf({ min: 400, max: 700 }, 0) === 400 && C.amountOf({ min: 400, max: 700 }, 300) === 700);
  const save = { ...defaultSave(), money: 1000, reputation: 50 } as any;
  const m1 = C.creditSave(JSON.stringify(save), { kind: 'money', amount: 555 }, 1);
  const m2 = C.creditSave(m1.text, { kind: 'rep', amount: 40 }, 2);
  const m3 = C.creditSave(m2.text, { kind: 'item', amount: 1, item: INVITE_EXCLUSIVE }, 3);
  const m4 = C.creditSave(m3.text, { kind: 'item', amount: 1, item: INVITE_EXCLUSIVE }, 4);
  const o3 = JSON.parse(m3.text);
  check('the save credit: +dollars, +reputation, the exclusive into MY COLLECTION (owned + history), the mark 1 → 2 → 3', JSON.parse(m1.text).money === 1555 && JSON.parse(m2.text).reputation === 90 && o3.cosmetics.owned.includes(INVITE_EXCLUSIVE) && o3.cosmetics.history.some((h: any) => h.id === INVITE_EXCLUSIVE && h.event === 'referral' && h.at === 3) && m1.mark === 1 && m2.mark === 2 && m3.mark === 3);
  check('the exclusive is never listed twice; not a save → null', JSON.parse(m4.text).cosmetics.owned.filter((x: string) => x === INVITE_EXCLUSIVE).length === 1 && C.creditSave('[]', { kind: 'money', amount: 1 }, 1) === null && C.creditSave('nope', { kind: 'money', amount: 1 }, 1) === null);
  check('the server accepts a save with the case mark and refuses a malformed one', V.validateSave(sanitize(JSON.parse(m2.text))).length === 0 && V.validateSave({ ...sanitize(JSON.parse(m2.text)), cases: { n: -1 } }).length > 0);
  check('the game reads the mark defensively; an old save has none (0)', sanitize({ version: 12, cases: { n: 'x' } } as any).cases.n === 0 && sanitize({ version: 12 } as any).cases.n === 0 && sanitize({ version: 12, cases: { n: 4 } } as any).cases.n === 4);
  const day3 = D.apply(D.emptyState(), 100);
  const wd = D.withDailyCase(day3);
  check('DAILY with a case: an ordinary day pays 0 $ and the case replaces its 75 $ (never both); the total is the paid sum', wd.claim.money === 0 && wd.claim.replaced === 75 && wd.state.total === 0 && day3.claim.money === 75);
  let st = D.emptyState();
  for (let d = 0; d < 6; d++) st = D.apply(st, 200 + d).state;
  const w7 = D.apply(st, 206);
  check('the weekly gift (day 7) and the milestones keep their guaranteed dollars with a case', w7.claim.kind === 'milestone' && D.withDailyCase(w7).claim.money === 400 && D.withDailyCase(w7) === w7);
}

// =============================================================== 2. a real PocketBase
const PORTS = { api: 19790, smtp: 11979, mailUi: 19791 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Cases2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-cases-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
const forceFile = path.join(work, 'force.txt');
const START = Date.parse('2026-12-07T09:00:00Z'); // 12:00 Moscow
let pb: any = null;
const pbLog: string[] = [];

function setDay(n: number): number {
  const t = START + n * DAY;
  fs.writeFileSync(clockFile, String(t));
  return D.gameDay(t);
}
const force = (id: string) => fs.writeFileSync(forceFile, id);

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({
    dir: dataDir,
    ports: PORTS,
    origins: ['http://localhost:5173'],
    env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_REFERRALS: 'on', PRIME_CASES: 'on', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_DAILY_CLOCK_FILE: clockFile, PRIME_CASES_FORCE_FILE: forceFile, ...LEGACY_CHECK_ENV, ...extra },
  });
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
  /** 'response': the open reaches the server, its answer is lost; 'request': it never leaves. */
  drop: '' | 'response' | 'request' = '';
  constructor(readonly label: string) {}
  readonly fetchImpl: Fetch = (async (url: any, init?: any) => {
    const open = String(url).includes('/api/prime/cases/open');
    if (open && this.drop === 'request') throw new TypeError('Failed to fetch');
    const r = await fetch(url, init);
    if (open && this.drop === 'response') {
      await r.text();
      throw new TypeError('Failed to fetch');
    }
    return r;
  }) as Fetch;
  api(): PrimeApi {
    const client = new PocketBase(API, new BaseAuthStore());
    if (this.token) client.authStore.save(this.token, this.record);
    return new PrimeApi(client, 8000, this.fetchImpl);
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
}

async function register(nickname: string, email: string): Promise<void> {
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
}
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PrimeApiError ? e.code : 'thrown:' + String(e).slice(0, 80);
  }
};
const cloudOf = async (api: PrimeApi) => {
  const c = await api.getSave();
  return c ? { ...JSON.parse(c.text), _rev: c.revision, _hash: c.hash } : null;
};

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'cases-admin@cases.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setDay(0);
  force('');
  // first WITHOUT cases: an invitation confirmed now must not give cases later
  await startPb({ PRIME_CASES: '' });
  let admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const rl = (await admin.settings.getAll()).rateLimits;
  check('the migration added the cases rate limit (40 a minute)', rl.rules.some((r: any) => r.label === '/api/prime/cases' && r.maxRequests === 40));
  await admin.settings.update({ rateLimits: { enabled: true, rules: rl.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const verify = async (email: string) => {
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    return u.id as string;
  };
  const mkFight = async (uid: string, started: number, duration: number) =>
    admin.collection('league_matches').create({ attacker: uid, defKind: 'system', mode: 'duel', sim: 'a141348f2a0dea20', seed: 1, status: 'done', ranked: true, inputs: [[10, 0], [200, 1]], started, expires: started + 300000, finished: started + 90000, outcome: 'win', method: 'ko', result: { duration, cardsUsed: 3, steps: 4500 }, how: 'finish' });
  /** 60 verified minutes after the link (49 × 75 s = 3675 s). */
  const playHour = async (uid: string) => {
    const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${uid}"` }))[0];
    for (let i = 0; i < 49; i++) await mkFight(uid, link.linkedAt + 1000 + i, 75);
  };
  const casesOf = async (uid: string, filter = '') => admin.collection('prime_cases').getFullList({ filter: `owner = "${uid}"${filter ? ' && ' + filter : ''}`, sort: 'grantedAt' });

  section('Сервер: приглашение, подтверждённое до включения кейсов');
  await register('Host', 'host@cases.test');
  const hostId = await verify('host@cases.test');
  await register('Early', 'early@cases.test');
  const earlyId = await verify('early@cases.test');
  const hostB = new Browser('host-phone');
  await hostB.login('host@cases.test');
  const host = new Page(hostB, hostId);
  check('the inviter opens the game (session, cloud save)', (await host.open()) === 'ok');
  const hostCode = (await host.api.referralStatus()).code;
  const earlyB = new Browser('early');
  await earlyB.login('early@cases.test');
  const early = new Page(earlyB, earlyId);
  await early.open();
  await early.api.referralClaim(hostCode);
  await playHour(earlyId);
  const eq = (await early.api.referralStatus()).invitedBy!;
  check('PRIME_CASES off: the invitation is confirmed as in 2.2, no case, the 2.2 notice', eq.qualified && (await casesOf(earlyId)).length === 0 && (await casesOf(hostId)).length === 0 && (await early.api.referralStatus()).rewards === false);
  const guest0 = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('PRIME_CASES off: config cases = 0, the routes answer cases_disabled', (await guest0.config()).cases === false && (await codeOf(host.api.casesStatus())) === 'cases_disabled');

  await stopChild(pb);
  await startPb();
  admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  await admin.settings.update({ rateLimits: { enabled: true, rules: rl.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  section('Сервер: доступ');
  const guest = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('the server announces cases (config cases = 1)', (await guest.config()).cases === true);
  check('a guest gets nothing: status and open need a PRIME ID (401)', (await codeOf(guest.casesStatus())) === 'unauthorized' && (await codeOf(guest.caseOpen('case_guest_try1', 'invite', 0))) === 'unauthorized');
  check('nobody reads or writes cases through the generic API', (await codeOf(guest.pb.collection('prime_cases').getList(1, 1))) !== 'ok' && (await codeOf(host.api.pb.collection('prime_cases').getList(1, 1))) !== 'ok' && (await codeOf(host.api.pb.collection('prime_cases').create({ owner: hostId, kind: 'invite', ref: 'x', source: 'inviter', status: 'ready', grantedAt: 1 }))) !== 'ok');
  const hostAgain = new Page(hostB, hostId);
  await hostAgain.open();
  const s0 = await hostAgain.api.referralStatus();
  check('an invitation confirmed before cases were on gives nothing automatically (the owner decides — docs §legacy)', (await casesOf(earlyId)).length === 0 && (await casesOf(hostId)).length === 0 && s0.rewards === true);

  section('Сервер: PRIME INVITE CASE — 60 минут и выдача');
  await register('Friend', 'friend@cases.test');
  const friendId = await verify('friend@cases.test');
  const friendB = new Browser('friend');
  await friendB.login('friend@cases.test');
  const friend = new Page(friendB, friendId);
  await friend.open();
  await friend.api.referralClaim(hostCode);
  const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${friendId}"` }))[0];
  for (let i = 0; i < 47; i++) await mkFight(friendId, link.linkedAt + 1000 + i, 75);
  await mkFight(friendId, link.linkedAt + 2000, 74);
  const hs = await hostAgain.api.referralStatus();
  const f1 = hs.friends.find((f) => f.linkedAt === link.linkedAt);
  check('the inviter sees the friend\'s progress — 3599 of 3600 s, not confirmed — and no name', !!f1 && f1.seconds === 3599 && !f1.qualified && !('nickname' in (f1 as any)) && hs.notice.includes('PRIME INVITE CASE'));
  check('3599 s: no case for anybody', (await casesOf(friendId)).length === 0 && (await casesOf(hostId)).length === 0);
  await mkFight(friendId, link.linkedAt + 3000, 1);
  // the INVITER reads first: his reading of the friend's progress records the confirmation (and the two cases)
  const parallel = await Promise.all([hostAgain.api.referralStatus(), friend.api.referralStatus(), hostAgain.api.referralStatus(), friend.api.referralStatus()]);
  check('3600 s: confirmed (read by both, in parallel)', parallel.every((p) => (p.invitedBy ? p.invitedBy.qualified : p.friends.some((f) => f.qualified))));
  const hc = await casesOf(hostId);
  const fc = await casesOf(friendId);
  check('exactly one PRIME INVITE CASE each: the inviter («inviter») and the invitee («invitee»), ready', hc.length === 1 && fc.length === 1 && hc[0].kind === 'invite' && hc[0].source === 'inviter' && hc[0].status === 'ready' && fc[0].source === 'invitee' && hc[0].ref === `link:${link.id}:inviter` && fc[0].ref === `link:${link.id}:invitee`);
  for (let i = 0; i < 3; i++) await Promise.all([hostAgain.api.referralStatus(), friend.api.referralStatus()]);
  check('reading again and again never gives a second case', (await casesOf(hostId)).length === 1 && (await casesOf(friendId)).length === 1);

  section('Сервер: накопление кейсов');
  const others: string[] = [];
  for (const n of ['Buddy', 'Pal']) {
    await register(n, `${n.toLowerCase()}@cases.test`);
    const id = await verify(`${n.toLowerCase()}@cases.test`);
    const b = new Browser(n);
    await b.login(`${n.toLowerCase()}@cases.test`);
    const p = new Page(b, id);
    await p.open();
    await p.api.referralClaim(hostCode);
    await playHour(id);
    others.push(id);
  }
  // only the INVITER looks: his friends' confirmations are recorded by his reading
  const hs2 = await hostAgain.api.referralStatus();
  check('two more friends played their hour: the inviter now holds 3 cases (no limit), each friend 1 (4 confirmed — one before cases, without a case)', (await casesOf(hostId)).length === 3 && (await casesOf(others[0])).length === 1 && (await casesOf(others[1])).length === 1 && hs2.invited.confirmed === 4);
  const st1 = await hostAgain.api.casesStatus();
  check('the status: 3 PRIME INVITE CASES ready, 0 opened, the real odds summing to 100 %', st1.invite.ready === 3 && st1.invite.opened === 0 && st1.invite.odds.reduce((s, x) => s + x.share, 0) === 10000);
  check('no league profile: PRIME TOKENS are not in this player\'s odds (and still 100 %)', st1.tokens === false && !st1.invite.odds.some((x) => x.kind === 'tokens'));

  section('Сервер: открытие — доллары, репутация, повтор, потерянный ответ');
  force('inv_money');
  const before = hostAgain.save.data.money;
  const o1 = await hostAgain.sync.openCase('invite');
  const cloud1 = await cloudOf(hostAgain.api);
  // (Beta 2.5.5, case rules version 2: the invite fee 850–1 400 $, was 400–700 $ — the range is the config's own)
  const fee = CASES.invite[0];
  check(`a case opens: the server drew «Гонорар» (${fee.min}–${fee.max} $) and wrote it into the cloud save`, fee.id === 'inv_money' && fee.min === 850 && fee.max === 1400 && o1.ok && o1.case.result!.kind === 'money' && o1.case.result!.amount >= fee.min && o1.case.result!.amount <= fee.max && cloud1.money === before + o1.case.result!.amount);
  check('this device got the same change once: the same money, the case mark 1, the same text as the cloud (synced)', o1.ok && hostAgain.save.data.money === cloud1.money && hostAgain.save.data.cases.n === 1 && hostAgain.sync.status === 'synced');
  const r1 = (await casesOf(hostId, 'status = "opened"'))[0];
  check('the case is marked opened with its result, the request id and the save revision it went into', !!r1 && r1.openOp.startsWith('case_') && r1.result.kind === 'money' && r1.revision === cloud1._rev && (await admin.collection('save_history').getFullList({ filter: `owner = "${hostId}" && reason = "case"` })).length === 1);
  const dup = await hostAgain.api.caseOpen(r1.openOp, 'invite', 0);
  check('the same request again: the same case and amount (duplicate), nothing drawn or paid twice', dup.duplicate && dup.case.id === r1.id && o1.ok && dup.case.result!.amount === o1.case.result!.amount && (await cloudOf(hostAgain.api)).money === cloud1.money && (await casesOf(hostId, 'status = "ready"')).length === 2);
  force('inv_rep');
  hostB.drop = 'response';
  const lost = await hostAgain.sync.openCase('invite');
  hostB.drop = '';
  const cloudLost = await cloudOf(hostAgain.api);
  check('the answer is lost (the connection dropped during the animation): «offline», the server already wrote it', !lost.ok && lost.code === 'offline' && cloudLost.reputation > hostAgain.save.data.reputation);
  const later = await hostAgain.sync.settleCase();
  check('back online: the SAME result comes (duplicate) and is applied once — reputation equal to the cloud', !!later && later.ok && later.duplicate && later.case.result!.kind === 'rep' && hostAgain.save.data.reputation === cloudLost.reputation && hostAgain.save.data.cases.n === 2);
  check('nothing was drawn twice: 2 opened, 1 ready', (await casesOf(hostId, 'status = "opened"')).length === 2 && (await casesOf(hostId, 'status = "ready"')).length === 1);
  const reload = new Page(hostB, hostId);
  check('a reload after all that: the progress and both rewards are there', (await reload.open()) === 'ok' && reload.save.data.reputation === cloudLost.reputation && reload.save.data.money === cloud1.money);

  section('Сервер: защита — неверная ревизия, параллельные открытия, чужие кейсы');
  force('');
  const wrong = await codeOf(reload.api.caseOpen('case_wrong_rev1', 'invite', 1));
  check('a wrong save revision is refused BEFORE any draw (conflict) — the case stays ready (no «re-roll»)', wrong === 'conflict' && (await casesOf(hostId, 'status = "ready"')).length === 1);
  const rev = (await reload.api.getSave())!.revision;
  const par = await Promise.all([reload.api.caseOpen('case_par_aaaa1', 'invite', rev).catch((e) => e), reload.api.caseOpen('case_par_bbbb2', 'invite', rev).catch((e) => e)]);
  const okN = par.filter((x) => !(x instanceof PrimeApiError)).length;
  check('two different opens at once for the last case: one opens it, the other finds none or a moved revision', okN === 1 && par.some((x) => x instanceof PrimeApiError && (x.code === 'no_case' || x.code === 'conflict')) && (await casesOf(hostId, 'status = "ready"')).length === 0);
  check('no case left: «no_case»', (await codeOf(reload.api.caseOpen('case_none_left1', 'invite', (await reload.api.getSave())!.revision))) === 'no_case');
  check('the friend\'s case is untouched by all of it (only owners open their own)', (await casesOf(friendId, 'status = "ready"')).length === 1);

  section('Сервер: PRIME TOKENS и эксклюзив');
  await fetch(`${API}/api/prime/league/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: friend.api.pb.authStore.token }, body: JSON.stringify({ accept: true, rules: LEAGUE_RULES.version }) });
  const fs1 = await friend.api.casesStatus();
  check('with a league profile PRIME TOKENS are in the odds', fs1.tokens && fs1.invite.odds.some((x) => x.kind === 'tokens'));
  force('inv_tokens');
  await friend.sync.reconcile();
  const revF = (await friend.api.getSave())!.revision;
  const t1 = await friend.sync.openCase('invite');
  const led = await admin.collection('league_ledger').getFullList({ filter: `owner = "${friendId}" && reason = "case"` });
  const prof = (await admin.collection('league_profiles').getFullList({ filter: `owner = "${friendId}"` }))[0];
  check('PRIME TOKENS go into the league ledger (reason «case», ref = the case), the balance grows; the save is not rewritten', t1.ok && t1.case.result!.kind === 'tokens' && led.length === 1 && led[0].ref === t1.case.id && led[0].delta === t1.case.result!.amount && prof.tokens === t1.case.result!.amount && (await friend.api.getSave())!.revision === revF);
  // the exclusive: friend gets more cases (as an inviter of his own friend — the invitee is rewarded as invitee once)
  await register('Second', 'second@cases.test');
  const secondId = await verify('second@cases.test');
  const secB = new Browser('second');
  await secB.login('second@cases.test');
  const sec = new Page(secB, secondId);
  await sec.open();
  const friendCode = (await friend.api.referralStatus()).code;
  await sec.api.referralClaim(friendCode);
  await playHour(secondId);
  await friend.api.referralStatus();
  check('the invitee later invites his own friend: as an inviter he gets a case again (as an invitee — once)', (await casesOf(friendId)).length === 2 && (await casesOf(friendId, 'source = "invitee"')).length === 1);
  force('inv_signal');
  const x1 = await friend.sync.openCase('invite');
  const cx = await cloudOf(friend.api);
  check('the exclusive INVITE SIGNAL: into MY COLLECTION on the server and on this device (same text), proven by its case', x1.ok && x1.case.result!.item === INVITE_EXCLUSIVE && cx.cosmetics.owned.includes(INVITE_EXCLUSIVE) && friend.save.data.cosmetics.owned.includes(INVITE_EXCLUSIVE) && friend.sync.status === 'synced');
  const fs2 = await friend.api.casesStatus();
  check('owned now: it leaves this player\'s odds (shown and drawn), the rest still 100 %', fs2.exclusive.owned && !fs2.invite.odds.some((x) => x.kind === 'item') && fs2.invite.odds.reduce((s, x) => s + x.share, 0) === 10000);
  // more cases for the friend, the exclusive forced again: it is no longer in the odds → never given twice
  for (let i = 0; i < 4; i++) await admin.collection('prime_cases').create({ owner: friendId, kind: 'invite', ref: `test:${i}`, source: 'inviter', status: 'ready', grantedAt: Date.now() + i, openedAt: 0, openOp: '', revision: 0, hash: '', tier: 0 });
  let again = 0;
  for (let i = 0; i < 4; i++) {
    const r = await friend.sync.openCase('invite');
    if (r.ok && r.case.result!.kind === 'item') again++;
  }
  const cx2 = await cloudOf(friend.api);
  check('the exclusive is never given twice — 4 more opens with it «forced» gave something else, the case not lost', again === 0 && cx2.cosmetics.owned.filter((x: string) => x === INVITE_EXCLUSIVE).length === 1 && (await casesOf(friendId, 'status = "ready"')).length === 0);
  const cheat = { ...JSON.parse((await host.api.getSave())!.text) };
  cheat.cosmetics.owned.push(INVITE_EXCLUSIVE);
  check('another account cannot write the exclusive into its save by hand (not earned)', (await codeOf(hostAgain.api.putSave({ base: (await hostAgain.api.getSave())!.revision, text: JSON.stringify(cheat), hash: crypto.createHash('sha256').update(JSON.stringify(cheat)).digest('hex'), op: 'cheat' + crypto.randomBytes(6).toString('hex'), device: hostAgain.save.meta.device, reason: 'sync' }))) !== 'ok');

  section('Сервер: DAILY BROADCAST CASE');
  force('');
  await register('Daily', 'daily@cases.test');
  const dId = await verify('daily@cases.test');
  const dB = new Browser('daily');
  await dB.login('daily@cases.test');
  const dp = new Page(dB, dId);
  await dp.open();
  const d0 = await dp.api.dailyStatus();
  check('the DAILY status says the server gives cases', d0.cases === true);
  const m0 = dp.save.data.money;
  const c1 = await dp.sync.claimDaily();
  check('day 1: the case REPLACES the 75 $ (0 $ paid, 75 replaced), one DAILY case of tier 1', c1.ok && c1.claim.money === 0 && c1.claim.replaced === 75 && c1.claim.case?.tier === 1 && dp.save.data.money === m0 && (await casesOf(dId, 'kind = "daily"')).length === 1);
  check('the same day again: «already claimed», no second case', !(await dp.sync.claimDaily()).ok && (await casesOf(dId, 'kind = "daily"')).length === 1);
  const dc = await dp.sync.openCase('daily');
  check('the DAILY case opens: a small reward of tier 1 (≤ 300 $ / ≤ 18 rep / ≤ 8 tokens)', dc.ok && ((dc.case.result!.kind === 'money' && dc.case.result!.amount <= 300) || (dc.case.result!.kind === 'rep' && dc.case.result!.amount <= 18)));
  for (let d = 1; d < 6; d++) {
    setDay(d);
    await dp.sync.claimDaily();
  }
  setDay(6);
  const w = await dp.sync.claimDaily();
  check('day 7 (a milestone): its guaranteed 400 $ AND a DAILY case of tier 2 (the streak grew)', w.ok && w.claim.money === 400 && w.claim.kind === 'milestone' && w.claim.case?.tier === 2);
  const ds = await dp.api.casesStatus();
  check('seven days, seven DAILY cases (one per day): 6 ready, 1 opened', ds.daily.ready === 6 && ds.daily.opened === 1);
  // an older game (no cases flag): the old dollars, no case
  await register('OldGame', 'oldgame@cases.test');
  const ogId = await verify('oldgame@cases.test');
  const ogB = new Browser('old-game');
  await ogB.login('oldgame@cases.test');
  const og = new Page(ogB, ogId);
  await og.open();
  const rev0 = (await og.api.getSave())!.revision;
  const oldClaim = await fetch(`${API}/api/prime/daily/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: og.api.pb.authStore.token }, body: JSON.stringify({ op: 'daily_oldgame_1', base: rev0, ...(og.api as any).sessionBody() }) });
  const oj = (await oldClaim.json()) as any;
  check('an older game (2.3, no «cases»): the day pays its 75 $ as before and no case — never both', oldClaim.status === 200 && oj.claim.money === 75 && !oj.claim.case && (await casesOf(ogId)).length === 0);

  section('Сервер: «Мои данные», выключение');
  const ex = await hostAgain.api.exportData();
  check('«Скачать мои данные» lists the account\'s cases and what they gave', Array.isArray((ex as any).cases) && (ex as any).cases.length === 3 && (ex as any).cases.every((c: any) => c.kind === 'invite'));
  await stopChild(pb);
  await startPb({ PRIME_CASES: 'off' });
  const g2 = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('PRIME_CASES=off: config cases = 0, the routes answer cases_disabled, the daily day pays dollars again', (await g2.config()).cases === false && (await codeOf(friend.api.casesStatus())) === 'cases_disabled');
  await stopChild(pb);
  pb = null;
}

async function main(): Promise<void> {
  rulesChecks();
  try {
    await serverChecks();
  } catch (e) {
    check('server checks ran to the end', false, String(e).slice(0, 400) + '\n' + pbLog.slice(-12).join('\n'));
  } finally {
    if (pb) await stopChild(pb);
    await sleep(200);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(`\n${failed ? `cases: FAILED (${passed} passed, ${failed} failed)` : `cases: OK (${passed} passed, 0 failed)`} — временная база удалена`);
  proc.exitCode = failed ? 1 : 0;
}

void main();
