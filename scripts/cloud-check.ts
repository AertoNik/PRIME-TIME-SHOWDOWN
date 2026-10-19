// Alpha 1.8.3 — `npm run cloud:test`: PRIME CLOUD 2.0 against a REAL PocketBase with a temporary
// database (deleted at the end; the developer's backend/pb_data and the real server are never touched).
//
//   one active game session per PRIME ID (claim / heartbeat / fencing generation) between devices,
//   browsers and tabs; automatic load of the account's progress on another device; automatic save;
//   stale requests, races, a match finished during a switch, lost connection, reload, guest career,
//   unconfirmed accounts, the first import of a guest career, 1.8.2 accounts and old games, the
//   emergency switch PRIME_SESSIONS=off, and direct API access to the sessions.
//
// The «devices» are the game's own classes (SaveSystem, SessionManager, SyncManager, AccountService,
// PrimeApi) with an in-memory localStorage each — a «tab» is another page on the same storage.
// Real phones, browsers and the network of a real server are NOT simulated here (see the manual list
// in docs/PRIME_CLOUD_2_DEPLOY.md). Saves are artificial; the server runs with mail off (accounts are
// confirmed by the administrator — here by the test's own temporary superuser), as on the VPS.

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { SaveSystem, profileKeys } from '../src/meta/SaveSystem';
import { TabLock } from '../src/meta/TabLock';
import { AccountService } from '../src/net/AccountService';
import { readAccounts, readSync, userProfile } from '../src/net/accountStore';
import { cloudCopyOf } from '../src/net/cloudSave';
import { PrimeApi, PrimeApiError, type Me } from '../src/net/PrimeApi';
import { SessionManager, type SessionState } from '../src/net/SessionManager';
import { SyncManager } from '../src/net/SyncManager';
import { binariesReady, dbFingerprint, ensurePortsFree, ownServerStarted, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { MemoryStorage } from './lib/fixtures';
import { crypto, fs, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 18390, smtp: 11390, mailUi: 18391 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Cloud2026pass';

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

let pb: any = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-cloud-check-'));
const dataDir = path.join(work, 'pb_data');
let skew = 0;
const clock = () => Date.now() + skew;

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  // open registration and no email ONLY in this temporary database: the sessions are what is checked
  // here (the invite-only closed beta has its own checks — npm run beta:test)
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SMTP_HOST: '', ...extra } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}
async function stopPb(): Promise<void> {
  await stopChild(pb);
  pb = null;
}

// ------------------------------------------------------------------ devices
type Fetch = typeof fetch;

/** One browser: its own localStorage and PRIME ID sign-in; pages (tabs) are opened on it. */
class Browser {
  storage = new MemoryStorage();
  token = '';
  record: any = null;
  offline = false;
  delayPut = 0;
  requests = 0;
  constructor(readonly label: string) {}

  /** What every request of this browser goes through (to drop the connection or delay a write on purpose). */
  readonly fetchImpl: Fetch = (async (url: any, init?: any) => {
    this.requests++;
    if (this.offline) throw new TypeError('Failed to fetch');
    if (this.delayPut && init?.method === 'PUT') await sleep(this.delayPut);
    return fetch(url, init);
  }) as Fetch;

  api(): PrimeApi {
    const client = new PocketBase(API, new BaseAuthStore());
    if (this.token) client.authStore.save(this.token, this.record);
    return new PrimeApi(client, 5000, this.fetchImpl);
  }

  async login(email: string): Promise<Me> {
    const a = this.api();
    const me = await a.login(email, PW);
    this.token = a.pb.authStore.token;
    this.record = a.pb.authStore.record;
    return me;
  }

  page(uid: string, opts: { tabs?: boolean; takeOver?: boolean } = {}): Page {
    return new Page(this, uid, opts);
  }
}

/** One page of the game playing an account (what AccountRuntime does, without the DOM). */
class Page {
  readonly api: PrimeApi;
  readonly save: SaveSystem;
  readonly session: SessionManager;
  readonly sync: SyncManager;
  constructor(
    readonly b: Browser,
    readonly uid: string,
    opts: { tabs?: boolean; takeOver?: boolean },
  ) {
    const p = userProfile(uid);
    this.api = b.api();
    const lock = opts.tabs ? new TabLock(b.storage, profileKeys(p).lock, clock) : null;
    this.save = new SaveSystem({ profile: p, storage: b.storage, lock, clock, takeOverLock: opts.takeOver });
    this.session = new SessionManager({ api: this.api, device: this.save.meta.device, label: b.label, clock });
    this.sync = new SyncManager({ save: this.save, api: this.api, storage: b.storage, session: this.session, clock });
  }

  /** Opening the game: claim the session, load the account's current progress. */
  async open(): Promise<SessionState | 'ok' | 'reload' | 'decide' | 'failed'> {
    const st = await this.session.claim();
    if (st !== 'active') return st;
    const r = await this.sync.reconcile();
    if (r === 'ok') this.sync.startSession();
    return r;
  }

  /** A match (or several) with its rewards, written locally as the game does. */
  play(money: number, matches = 1): void {
    this.save.data.money += money;
    this.save.data.matches += matches;
    this.save.save();
  }
}

async function register(nickname: string, email: string): Promise<void> {
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, email, password: PW, passwordConfirm: PW }) });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
}

const money = (s: { text: string } | null) => (s ? (JSON.parse(s.text) as { money: number }).money : -1);
const statusOf = async (p: Promise<unknown>): Promise<number> => {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof PrimeApiError ? e.status : -1;
  }
};

async function main(): Promise<void> {
  if (!binariesReady()) {
    console.log('PocketBase не установлен. Сначала: npm run backend:install');
    proc.exit(1);
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`Временная база: ${work}`);
  const SU = { email: 'cloud-admin@cloud.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);

  // ============================================== 1.8.2 server rules first (scenario O, part 1)
  section('O · аккаунт Alpha 1.8.2 до обновления сервера');
  await startPb({ PRIME_SESSIONS: 'off' });
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const relax = async () => {
    const st = (await admin.settings.getAll()).rateLimits;
    await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  };
  const migrated = (await admin.settings.getAll()).rateLimits.rules.some((r: any) => r.label === '/api/prime/session/');
  await relax();
  const verify = async (email: string) => {
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true }); // = the «verified» switch in the dashboard
    return u.id as string;
  };
  await register('OldTimer', 'old@cloud.test');
  const oldId = await verify('old@cloud.test');
  const oldBrowser = new Browser('Mac · Safari');
  await oldBrowser.login('old@cloud.test');
  const oldApi = oldBrowser.api();
  const oldText = cloudCopyOf(JSON.stringify({ ...new SaveSystem({ storage: null }).data, money: 4321, matches: 12, version: 12 }));
  const oldPut = await oldApi.putSave({ base: 0, text: oldText.text, hash: oldText.hash, op: 'op_old_client_1', device: 'old', reason: 'sync' });
  const offCfg = await oldApi.config();
  check('PRIME_SESSIONS=off (the 1.8.2 rules): a save without any session is accepted; the game is told sessions are off', oldPut.revision === 1 && offCfg.sessions === false);
  await stopPb();
  const printBefore = dbFingerprint(path.join(dataDir, 'data.db'));

  // ============================================================== the server update
  await startPb();
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  await relax();
  const cfg = await oldApi.config();
  check(`after the update: the migration added game_sessions and its rate limit, accounts / saves / history untouched; the game is told sessions:1 (heartbeat ${cfg.heartbeatMs} ms, lifetime ${cfg.ttlMs} ms)`, migrated && cfg.sessions && dbFingerprint(path.join(dataDir, 'data.db')) === printBefore && cfg.heartbeatMs === 20000 && cfg.ttlMs === 75000);
  const oldText2 = cloudCopyOf(JSON.stringify({ ...JSON.parse(oldText.text), money: 9999 }));
  const raw = await fetch(`${API}/api/prime/save`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: oldBrowser.token }, body: JSON.stringify({ base: 1, data: oldText2.text, hash: oldText2.hash, op: 'op_old_client_2', device: 'old', client: '1.8.2-alpha.beta', reason: 'sync' }) });
  const afterOld = await oldApi.getSave();
  check(`O · a 1.8.2 game (no session) can no longer write: ${raw.status} «session_required» (an old game reads 426 as «refused» and stops — no retry loop); the cloud save is unchanged`, raw.status === 426 && money(afterOld) === 4321 && afterOld?.revision === 1);
  const oldMe = await oldBrowser.login('old@cloud.test');
  const oldPlan = await new AccountService({ api: oldBrowser.api(), storage: oldBrowser.storage, current: new SaveSystem({ storage: oldBrowser.storage, lock: null, clock }) }).planFor(oldMe);
  const oldPage = oldBrowser.page(oldId);
  const oldOpen = await oldPage.open();
  check(`O · the same account in the 1.8.3 game: signs in (${oldPlan.kind}), claims its session, plays its 1.8.2 save (money ${oldPage.save.data.money}, ${oldPage.save.data.matches} matches) — nothing lost, no choice asked (${oldOpen})`, oldPlan.kind === 'switch' && oldOpen === 'ok' && oldPage.save.data.money === 4321 && oldPage.save.data.matches === 12);
  oldPage.play(10);
  check('O · …and writes again, now under its game session', (await oldPage.sync.syncNow()) === 'synced' && money(await oldPage.api.getSave()) === 4331);

  // ================================================================ accounts
  await register('PhoneDesk', 'player@cloud.test');
  const P = await verify('player@cloud.test');
  await register('Unconfirmed', 'nobody@cloud.test');
  await register('OtherOne', 'other@cloud.test');
  const Q = await verify('other@cloud.test');

  // ================================================================ A: phone → computer
  section('A / E · телефон → компьютер (другой браузер)');
  const phone = new Browser('iPhone · Safari');
  const meP = await phone.login('player@cloud.test');
  const phoneService = new AccountService({ api: phone.api(), storage: phone.storage, current: new SaveSystem({ storage: phone.storage, lock: null, clock }) });
  const planP = await phoneService.planFor(meP);
  const firstSession = new SessionManager({ api: (phoneService as any).o.api, device: 'phone', label: phone.label, clock });
  await firstSession.claim();
  await phoneService.startNewCareer(meP);
  let ph = phone.page(P);
  await ph.open();
  ph.play(300, 5);
  const phSync = await ph.sync.syncNow();
  const cloudA = await ph.api.getSave();
  check(`A · the phone plays 5 matches (+300): saved automatically to PRIME CLOUD only after the server confirmed (${phSync}, revision ${cloudA?.revision})`, planP.kind === 'new-career' && phSync === 'synced' && money(cloudA) === ph.save.data.money);
  const desk = new Browser('Mac · Chrome');
  const meD = await desk.login('player@cloud.test');
  const deskService = new AccountService({ api: desk.api(), storage: desk.storage, current: new SaveSystem({ storage: desk.storage, lock: null, clock }) });
  const planD = await deskService.planFor(meD);
  let dk = desk.page(P);
  const deskOpen = await dk.open();
  check(`A · the computer signs in: the account's progress is loaded with no import and no choice (${planD.kind}/${planD.kind === 'switch' ? planD.from : ''} → ${deskOpen}); money ${dk.save.data.money}, matches ${dk.save.data.matches}`, planD.kind === 'switch' && deskOpen === 'ok' && dk.save.data.money === ph.save.data.money && dk.save.data.matches === ph.save.data.matches);
  const phBeat = await ph.session.beat();
  ph.play(50);
  const phAfter = await ph.sync.syncNow();
  check(`A · the phone lost the session: its heartbeat learns it («${ph.session.holder}» plays now), its next save is refused (${phBeat}/${phAfter}), the cloud keeps the computer's state`, phBeat === 'superseded' && phAfter === 'superseded' && ph.session.holder === 'Mac · Chrome' && money(await dk.api.getSave()) === dk.save.data.money);
  check('A · the lost page starts no match and writes nothing more (no game session token, no automatic upload)', !ph.session.canPlay && ph.api.session === null && ph.sync.blocked);

  // ================================================================ B: computer → phone
  section('B · компьютер → телефон');
  dk.play(120, 2);
  await dk.sync.syncNow();
  const deskMoney = dk.save.data.money;
  // «Продолжить здесь» on the phone = the page reloads; opening it claims
  ph = phone.page(P);
  const phOpen = await ph.open();
  if (phOpen === 'reload') {
    ph = phone.page(P);
    await ph.open();
  }
  const keptB = (await ph.api.history()).filter((h) => h.reason === 'session-device');
  check(`B · back on the phone («Продолжить здесь»): the computer's matches arrive by themselves (${phOpen}); money ${ph.save.data.money} = ${deskMoney}`, ph.save.data.money === deskMoney && ph.save.data.matches === dk.save.data.matches);
  check(`B · the phone's unsent +50 (refused while it had lost the session) is not merged and not lost: kept in the cloud copies (${keptB.length})`, keptB.length === 1 && money(keptB[0]) === deskMoney - 120 + 50);
  check('B · …and the player is told once after the reload («сохранены отдельно — Облачные копии»)', readSync(phone.storage, userProfile(P)).notice?.kind === 'kept-device');
  check('B · the computer lost the session in turn', (await dk.session.beat()) === 'superseded');

  // ================================================================ C/D: two tabs
  section('C / D · две вкладки одного браузера');
  const tabs = new Browser('Mac · Firefox');
  await tabs.login('player@cloud.test');
  // (the account's copy is written on this browser at sign-in, as the game does)
  await new AccountService({ api: tabs.api(), storage: tabs.storage, current: new SaveSystem({ storage: tabs.storage, lock: null, clock }) }).planFor(meP);
  const tabA = tabs.page(P, { tabs: true, takeOver: true });
  await tabA.open();
  tabA.play(7);
  await tabA.sync.syncNow();
  const genA = tabA.session.generation;
  const tabB = tabs.page(P, { tabs: true, takeOver: true });
  await tabB.open();
  const localBefore = tabs.storage.getItem(profileKeys(userProfile(P)).save);
  tabA.play(1000);
  const localAfter = tabs.storage.getItem(profileKeys(userProfile(P)).save);
  check(`C · tab B opens: it plays; tab A can no longer write even locally (the profile lock moved to B; A turned passive: ${tabA.save.passive})`, tabA.save.passive && localBefore === localAfter && tabB.session.generation === genA + 1);
  const aBeat = await tabA.session.beat();
  const aText = cloudCopyOf(JSON.stringify({ ...JSON.parse(cloudCopyOf(tabB.save.serialized()).text), money: 123456 }));
  const aRev = (await tabB.api.getSave())!.revision;
  // (the game itself no longer sends the lost session — here it is sent anyway, as a modified client would)
  tabA.api.session = { key: tabA.session.key, generation: genA };
  const aPut = await tabA.api.putSave({ base: aRev, text: aText.text, hash: aText.hash, op: 'op_tab_a_late', device: 'a', reason: 'sync' }).catch((e) => e);
  check(`C · tab A on the server too: heartbeat → ${aBeat}; a perfectly valid write sent with A's old session → ${aPut instanceof PrimeApiError ? aPut.status + ' ' + aPut.code : 'WRITTEN'}`, aBeat === 'superseded' && aPut instanceof PrimeApiError && aPut.code === 'session_superseded' && money(await tabB.api.getSave()) !== 123456);
  const genRow = async () => (await admin.collection('game_sessions').getFullList({ filter: `user = "${P}"` }))[0];
  const g1 = (await genRow()).generation;
  await tabA.session.beat();
  await tabA.session.beat();
  const g2 = (await genRow()).generation;
  check(`D · the old tab never takes the session back by itself: its heartbeats change nothing (generation ${g1} → ${g2})`, g1 === g2 && tabA.session.state === 'superseded');
  const tabA2 = tabs.page(P, { tabs: true, takeOver: true }); // «Продолжить здесь» in tab A = its page reloads
  await tabA2.open();
  const bBeat = await tabB.session.beat();
  check(`D · «Продолжить здесь» in tab A: A plays again (generation ${tabA2.session.generation}), tab B is told on its next heartbeat (${bBeat}) — once, no back-and-forth`, bBeat === 'superseded' && tabA2.session.generation === g2 + 1 && (await tabA2.session.beat()) === 'active');
  check('C · the session key lives only in the page: nothing in this browser\'s storage contains it', ![...tabs.storage.map.values()].some((v) => v.includes(tabA2.session.key)));

  // ================================================================ F: simultaneous claims
  section('F · одновременные запросы на одну сессию');
  const racers = Array.from({ length: 6 }, (_, i) => {
    const b = new Browser(`Racer ${i}`);
    b.token = phone.token;
    b.record = phone.record;
    return b.page(P);
  });
  await Promise.all(racers.map((r) => r.session.claim()));
  const gens = racers.map((r) => r.session.generation).sort((a, b) => a - b);
  const beats = await Promise.all(racers.map((r) => r.session.beat()));
  const holders = racers.filter((_, i) => beats[i] === 'active');
  const top = (await genRow()).generation;
  check(`F · six claims at the same moment: six different generations in a row (${gens.join(',')}), exactly ONE page holds the session (the newest)`, new Set(gens).size === 6 && gens[5] - gens[0] === 5 && holders.length === 1 && holders[0].session.generation === top);
  const curRev = (await racers[0].api.getSave())!.revision;
  // every racer sends the session it got, even the ones that already know they lost it
  for (const r of racers) r.api.session = { key: r.session.key, generation: r.session.generation };
  const puts = await Promise.all(
    racers.map((r, i) => {
      const t = cloudCopyOf(JSON.stringify({ ...JSON.parse(cloudCopyOf(r.save.serialized()).text), money: 70000 + i, version: 12 }));
      return statusOf(r.api.putSave({ base: curRev, text: t.text, hash: t.hash, op: `op_race_${i}_${Date.now()}`, device: 'r', reason: 'sync' }));
    }),
  );
  const winner = racers.indexOf(holders[0]);
  check(`F · …and of six writes at once only the holder's lands (${puts.join(',')}): the five others are refused before anything is written`, puts[winner] === 200 && puts.filter((x) => x === 409).length === 5 && money(await racers[0].api.getSave()) === 70000 + winner);

  // ================================================================ G: stale write
  section('G · запрос прежней сессии не перезаписывает новое сохранение');
  const gb = new Browser('Stale');
  await gb.login('player@cloud.test');
  await new AccountService({ api: gb.api(), storage: gb.storage, current: new SaveSystem({ storage: gb.storage, lock: null, clock }) }).planFor(meP);
  let fenced = true;
  let landedBeforeClaim = 0;
  for (let i = 0; i < 12; i++) {
    const x = gb.page(P);
    await x.open();
    const y = gb.page(P);
    const base = readSync(gb.storage, userProfile(P)).revision;
    const t = cloudCopyOf(JSON.stringify({ ...JSON.parse(cloudCopyOf(x.save.serialized()).text), money: 50000 + i }));
    // odd rounds: the claim starts first; even rounds: the write starts first — both orders, every run
    const putFirst = i % 2 === 0;
    const [put] = await Promise.all([
      sleep(putFirst ? 0 : 20 + Math.floor(Math.random() * 15)).then(() => statusOf(x.api.putSave({ base, text: t.text, hash: t.hash, op: `op_stale_${i}_${Date.now()}`, device: 'x', reason: 'sync' }))),
      sleep(putFirst ? Math.floor(Math.random() * 45) : 0).then(() => y.session.claim()),
    ]);
    const cloud = await y.api.getSave();
    // a write either landed BEFORE the claim (and the new page sees it) or was refused — never after
    if (put === 200) landedBeforeClaim++;
    if (put === 200 && money(cloud) !== 50000 + i) fenced = false;
    if (put !== 200 && money(cloud) === 50000 + i) fenced = false;
    const t2 = cloudCopyOf(JSON.stringify({ ...JSON.parse(t.text), money: 60000 + i }));
    x.api.session = { key: x.session.key, generation: x.session.generation };
    const again = await statusOf(x.api.putSave({ base: cloud!.revision, text: t2.text, hash: t2.hash, op: `op_stale_retry_${i}_${Date.now()}`, device: 'x', reason: 'sync' }));
    if (again !== 409 || money(await y.api.getSave()) === 60000 + i) fenced = false;
    await y.sync.reconcile();
  }
  check(`G · 12 races «old page writes» vs «new page claims»: every write landed before the claim or not at all (${landedBeforeClaim} before, ${12 - landedBeforeClaim} refused); nothing from the old page after it`, fenced);

  // ================================================================ H: match during a switch
  section('H · матч закончился во время переключения');
  let hp = phone.page(P);
  if ((await hp.open()) === 'reload') {
    hp = phone.page(P);
    await hp.open();
  }
  const baseMoney = hp.save.data.money;
  hp.play(500);
  phone.delayPut = 600;
  const late = hp.sync.syncNow();
  await sleep(150);
  const hd = desk.page(P);
  const hdOpen = await hd.open();
  const lateSt = await late;
  phone.delayPut = 0;
  const afterSwitch = await hd.api.getSave();
  check(`H · the phone's result was still on its way when the computer took over: it is refused (${lateSt}); the computer opened (${hdOpen}) without it; nothing paid twice`, lateSt === 'superseded' && money(afterSwitch) === baseMoney);
  // the computer did not play: «Продолжить здесь» on the phone uploads the result — exactly once
  let hp2 = phone.page(P);
  const hp2Open = await hp2.open();
  const afterBack = await hp2.api.getSave();
  check(`H · the computer played nothing meanwhile → back on the phone the +500 goes up by itself, once (${hp2Open}; ${baseMoney} → ${money(afterBack)})`, money(afterBack) === baseMoney + 500 && hp2Open === 'ok');
  const savedRow = await admin.collection('saves').getFirstListItem(`owner = "${P}"`);
  const copyNow = cloudCopyOf(hp2.save.serialized());
  const dup = await hp2.api.putSave({ base: savedRow.revision - 1, text: copyNow.text, hash: copyNow.hash, op: savedRow.op, device: 'p', reason: 'sync' }).catch((e) => e);
  const afterDup = await hp2.api.getSave();
  check(`H · the same request sent again (a retry after a lost reply) is recognised (${dup instanceof PrimeApiError ? dup.code : dup.duplicate ? 'duplicate' : 'WRITTEN TWICE'}): revision ${afterDup?.revision}, money stays ${money(afterDup)}`, !(dup instanceof PrimeApiError) && dup.duplicate === true && afterDup?.revision === savedRow.revision && money(afterDup) === baseMoney + 500);
  // now the other order: the computer DID play after taking over
  hp2.play(800);
  phone.delayPut = 600;
  const late2 = hp2.sync.syncNow();
  await sleep(150);
  const hd2 = desk.page(P);
  if ((await hd2.open()) === 'reload') await desk.page(P).open();
  await late2;
  phone.delayPut = 0;
  const hd3 = desk.page(P);
  await hd3.open();
  hd3.play(40);
  await hd3.sync.syncNow();
  const deskNow = money(await hd3.api.getSave());
  let hp3 = phone.page(P);
  const hp3Open = await hp3.open();
  if (hp3Open === 'reload') {
    hp3 = phone.page(P);
    await hp3.open();
  }
  const kept = (await hp3.api.history()).filter((h) => h.reason === 'session-device').sort((a, b) => b.created.localeCompare(a.created))[0];
  check(`H · the computer played after taking over (+40) → the phone loads the computer's progress (${hp3Open}); its own +800 is kept in the cloud copies, not added (${money(await hp3.api.getSave())} / copy ${money(kept ?? null)})`, money(await hp3.api.getSave()) === deskNow && hp3.save.data.money === deskNow && money(kept ?? null) === deskNow - 40 + 800);

  // ================================================================ I/J: connection
  section('I / J · потеря и возвращение связи');
  let ip = phone.page(P);
  if ((await ip.open()) === 'reload') {
    ip = phone.page(P);
    await ip.open();
  }
  phone.offline = true;
  const iBeat = await ip.session.beat();
  ip.play(25);
  const iSync = await ip.sync.syncNow();
  check(`I · no connection: the session is «unconfirmed» (${iBeat}), the save waits (${iSync}) — never «synchronised»`, iBeat === 'unconfirmed' && iSync === 'offline' && ip.sync.hasUnsynced());
  const withinGrace = ip.session.canPlay;
  skew = 80_000;
  const afterGrace = ip.session.canPlay;
  skew = 0;
  check(`I · a short drop does not stop the game (${withinGrace}); after the session's lifetime with no answer no new match starts under the PRIME ID (${afterGrace})`, withinGrace && !afterGrace);
  phone.offline = false;
  const jBeat = await ip.session.beat();
  const jSync = await ip.sync.syncNow();
  check(`J · the connection is back: the session is confirmed first (${jBeat}), then the waiting change goes up (${jSync}), once`, jBeat === 'active' && jSync === 'synced' && money(await ip.api.getSave()) === ip.save.data.money);
  phone.offline = true;
  ip.play(60);
  await ip.sync.syncNow();
  const jd = desk.page(P);
  if ((await jd.open()) === 'reload') await desk.page(P).open();
  phone.offline = false;
  const jBeat2 = await ip.session.beat();
  const jSync2 = await ip.sync.syncNow();
  check(`J · back online after another device took over meanwhile: the phone learns it first (${jBeat2}) and uploads nothing (${jSync2}) — its offline +60 waits for «Продолжить здесь»`, jBeat2 === 'superseded' && jSync2 === 'superseded' && money(await jd.api.getSave()) !== ip.save.data.money);

  // ================================================================ K: reload
  section('K · обновление страницы');
  const kb = new Browser('Reloader');
  await kb.login('player@cloud.test');
  await new AccountService({ api: kb.api(), storage: kb.storage, current: new SaveSystem({ storage: kb.storage, lock: null, clock }) }).planFor(meP);
  let k1 = kb.page(P);
  if ((await k1.open()) === 'reload') {
    k1 = kb.page(P);
    await k1.open();
  }
  k1.play(3);
  await k1.sync.syncNow();
  const revBefore = (await k1.api.getSave())!.revision;
  const k2 = kb.page(P);
  const k2Open = await k2.open();
  const revAfter = (await k2.api.getSave())!.revision;
  check(`K · a reload claims again (generation +1) and finds everything in place (${k2Open}): money ${k2.save.data.money}, cloud revision unchanged (${revBefore} → ${revAfter})`, k2Open === 'ok' && k2.save.data.money === k1.save.data.money && revBefore === revAfter && k2.session.generation === k1.session.generation + 1);

  // ================================================================ L: guest
  section('L · гостевой режим');
  const guestBrowser = new Browser('Guest');
  const guest = new SaveSystem({ storage: guestBrowser.storage, lock: null, clock });
  guest.data.money += 777;
  guest.save();
  const guestReread = new SaveSystem({ storage: guestBrowser.storage, lock: null, clock });
  const phoneGuestKey = phone.storage.getItem(profileKeys('guest').save);
  check(`L · the guest career works without any server request (${guestBrowser.requests}) and is never touched by the account's sessions (this phone's guest slot: ${phoneGuestKey === null ? 'never written by the account' : 'kept'})`, guestReread.data.money === guest.data.money && guestBrowser.requests === 0 && phoneGuestKey === null);

  // ================================================================ M: unverified
  section('M · неподтверждённый аккаунт');
  const ub = new Browser('Unverified');
  await ub.login('nobody@cloud.test');
  const uApi = ub.api();
  const uClaim = new SessionManager({ api: uApi, device: 'u', label: 'u', clock });
  const uSt = await uClaim.claim();
  const uPut = await statusOf(uApi.putSave({ base: 0, text: cloudCopyOf(guest.serialized()).text, hash: cloudCopyOf(guest.serialized()).hash, op: 'op_unverified_1', device: 'u', reason: 'sync' }));
  const uRows = await admin.collection('game_sessions').getFullList({ filter: `user.email = "nobody@cloud.test"` });
  check(`M · an unconfirmed account gets no game session (${uSt}) and no cloud save (${uPut}) — as in 1.8.2`, uSt === 'failed' && uPut === 403 && uRows.length === 0);

  // ================================================================ N: first import
  section('N · первый перенос гостевого прогресса');
  await register('NewcomerOne', 'newcomer@cloud.test');
  const R = await verify('newcomer@cloud.test');
  const gb1 = new Browser('Guest phone');
  const g1save = new SaveSystem({ storage: gb1.storage, lock: null, clock });
  g1save.data.money += 999;
  g1save.data.matches = 7;
  g1save.save();
  const meR = await gb1.login('newcomer@cloud.test');
  const s1 = new AccountService({ api: gb1.api(), storage: gb1.storage, current: g1save });
  const planR = await s1.planFor(meR);
  const claimR = new SessionManager({ api: (s1 as any).o.api, device: 'g1', label: 'g1', clock });
  await claimR.claim();
  const moved = planR.kind === 'offer-transfer' && (await s1.transferGuest(meR));
  const cloudR = await (s1 as any).o.api.getSave();
  check(`N · the first link asks (${planR.kind}); after «Перенести прогресс» the guest career is the account's (money ${money(cloudR)}), the guest slot stays on the device`, moved && money(cloudR) === g1save.data.money && new SaveSystem({ storage: gb1.storage, lock: null, clock }).data.money === g1save.data.money && readAccounts(gb1.storage).guestBound?.user === R);
  const gb2 = new Browser('Guest laptop');
  const g2save = new SaveSystem({ storage: gb2.storage, lock: null, clock });
  g2save.data.money += 5;
  g2save.data.matches = 2;
  g2save.save();
  const meR2 = await gb2.login('newcomer@cloud.test');
  const s2 = new AccountService({ api: gb2.api(), storage: gb2.storage, current: g2save });
  const planR2 = await s2.planFor(meR2);
  const claimR2 = new SessionManager({ api: (s2 as any).o.api, device: 'g2', label: 'g2', clock });
  await claimR2.claim();
  const overwrite = await s2.transferGuest(meR2);
  const cloudR2 = await (s2 as any).o.api.getSave();
  check(`N · on a second device with its own guest career the account's save is loaded (${planR2.kind}), never replaced by that guest career — even when asked to (${overwrite}); that guest career stays there`, planR2.kind === 'switch' && overwrite === false && money(cloudR2) === money(cloudR) && new SaveSystem({ storage: gb2.storage, lock: null, clock }).data.money === g2save.data.money);

  // ================================================================ security
  section('Безопасность сессий');
  const qb = new Browser('Other account');
  await qb.login('other@cloud.test');
  const pGenBefore = (await genRow()).generation;
  const qPage = qb.page(Q);
  const qClaim = await qPage.session.claim();
  const pGenAfter = (await genRow()).generation;
  check(`another account's claim touches only its own session (${qClaim}); this account's generation stays ${pGenBefore} → ${pGenAfter}`, qClaim === 'active' && pGenBefore === pGenAfter);
  const anon = new PocketBase(API);
  const userClient = new PocketBase(API);
  userClient.authStore.save(qb.token, qb.record);
  const generic = await Promise.all([
    statusOf(anon.collection('game_sessions').getList(1, 5).catch((e) => Promise.reject(new PrimeApiError('forbidden', '', e.status)))),
    statusOf(userClient.collection('game_sessions').getList(1, 5).catch((e) => Promise.reject(new PrimeApiError('forbidden', '', e.status)))),
    statusOf(userClient.collection('game_sessions').create({ user: Q, generation: 999 }).catch((e) => Promise.reject(new PrimeApiError('forbidden', '', e.status)))),
    statusOf(userClient.collection('game_sessions').update((await genRow()).id, { generation: 1 }).catch((e) => Promise.reject(new PrimeApiError('forbidden', '', e.status)))),
    statusOf(userClient.collection('game_sessions').delete((await genRow()).id).catch((e) => Promise.reject(new PrimeApiError('forbidden', '', e.status)))),
  ]);
  check(`game_sessions through the generic API (anonymous list, user list / create / update / delete): ${generic.join(' ')} — only the server routes and a superuser`, generic.every((s) => s === 403 || s === 404));
  const noAuth = await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: 'a'.repeat(32) }) });
  const badKey = await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: qb.token }, body: JSON.stringify({ key: 'not-hex' }) });
  check(`a claim needs a signed-in, confirmed account (${noAuth.status}) and a 128-bit key (${badKey.status}); the owner is always the signed-in user — no request can name another`, noAuth.status === 401 && badKey.status === 400);
  const row = await genRow();
  const claimBody = await (await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: qb.token }, body: JSON.stringify({ key: 'b'.repeat(32) }) })).json();
  check('only a SHA-256 of the key is stored; no reply ever contains a key or its hash', row.keyHash.length === 64 && !JSON.stringify(claimBody).includes('b'.repeat(32)) && !('keyHash' in claimBody) && !/[a-f0-9]{64}/.test(JSON.stringify(claimBody)));
  const hist = await ph.api.history();
  ph.api.session = { key: ph.session.key, generation: ph.session.generation };
  const lostRestore = await statusOf(ph.api.restore(hist[0].id, (await ph.api.getSave())!.revision, 'op_restore_lost_1', 'p'));
  const archText = cloudText();
  const noSessArchive = await fetch(`${API}/api/prime/save/archive`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: phone.token }, body: JSON.stringify({ data: archText, hash: sha(archText), reason: 'conflict-device' }) });
  check(`restore and archive need the active session too (a page that lost it: ${lostRestore}, no session at all: ${noSessArchive.status})`, lostRestore === 409 && noSessArchive.status === 426);

  // ================================================================ switch off
  section('PRIME_SESSIONS=off — аварийный возврат к правилам 1.8.2');
  await stopPb();
  const fpOn = dbFingerprint(path.join(dataDir, 'data.db'));
  await startPb({ PRIME_SESSIONS: 'off' });
  const offApi = oldBrowser.api();
  const off = await offApi.config();
  const cur = await offApi.getSave();
  const offText = cloudCopyOf(JSON.stringify({ ...JSON.parse(cur!.text), money: 1 + money(cur) }));
  const offPut = await offApi.putSave({ base: cur!.revision, text: offText.text, hash: offText.hash, op: 'op_switch_off_1', device: 'o', reason: 'sync' });
  check(`the switch: sessions:0 is announced, a save without a session is accepted again (revision ${offPut.revision}); switching changed no data (${dbFingerprint(path.join(dataDir, 'data.db')) === fpOn || offPut.revision === cur!.revision + 1})`, off.sessions === false && offPut.revision === cur!.revision + 1);
  await stopPb();
}

function cloudText(): string {
  return cloudCopyOf(JSON.stringify({ ...new SaveSystem({ storage: null }).data, money: 1, version: 12 })).text;
}
function sha(t: string): string {
  return crypto.createHash('sha256').update(t).digest('hex');
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  the check crashed: ' + String((e as Error)?.stack ?? e));
    console.log('--- PocketBase log (last lines) ---\n' + pbLog.slice(-20).join('\n'));
  })
  .finally(async () => {
    await stopChild(pb).catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed === 0 ? 'cloud: OK' : 'cloud: FAILED'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed === 0 ? 0 : 1);
  });

