// Alpha 1.8.1 — `npm run backend:test`: the accounts and cloud saves against a REAL local
// PocketBase (the project's migrations and hooks) and a real Mailpit, started on spare ports with a
// brand-new temporary database that is deleted afterwards. The developer's backend/pb_data is never
// touched. Every check goes through real HTTP requests as ordinary test users (the access rules too);
// the "browsers" are the game's own modules (SaveSystem, AccountService, SyncManager, PrimeApi) with
// separate in-memory localStorage. Saves are artificial fixtures, not real players' files.
//
// 1.8.3: these are the 1.8.2 cloud rules (two devices writing in turn, conflicts decided by the
// player…). The server keeps them behind its emergency switch PRIME_SESSIONS=off — so this suite runs
// with that switch and proves it still gives exactly the 1.8.2 behaviour. PRIME CLOUD 2.0 itself (one
// active game session per account, the server's default) is checked by `npm run cloud:test`.

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { CAREER_START } from '../src/config/career';
import { SaveSystem, profileKeys, type ProfileId } from '../src/meta/SaveSystem';
import { AccountService } from '../src/net/AccountService';
import { bootProfile, readAccounts, readSync, userProfile } from '../src/net/accountStore';
import { canonicalJSON, cloudCopyOf, readCloudText } from '../src/net/cloudSave';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { sha256 } from '../src/net/sha256';
import { SyncManager } from '../src/net/SyncManager';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnMailpit, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { MemoryStorage, save176 } from './lib/fixtures';
import { cp, crypto, fs, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 18190, smtp: 11125, mailUi: 18125 };
const API = `http://127.0.0.1:${PORTS.api}`;
const MAIL = `http://127.0.0.1:${PORTS.mailUi}`;

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

async function apiError(p: Promise<unknown>): Promise<PrimeApiError | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof PrimeApiError ? e : new PrimeApiError('network', String((e as Error)?.message ?? e), 0);
  }
}
/** HTTP status of a raw SDK call (200 when it succeeded). */
async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : -1;
  }
}

// ----------------------------------------------------------------- processes
type Child = any;
let pb: Child = null;
let mail: Child = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-backend-check-'));
const dataDir = path.join(work, 'pb_data');

async function startPb(dir = dataDir): Promise<void> {
  // the 1.8.1 account flows run with open registration — allowed ONLY in this isolated, temporary database
  // (the invite-only closed beta has its own checks: npm run beta:test)
  pb = spawnPocketBase({ dir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SESSIONS: 'off', ...LEGACY_CHECK_ENV } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 400) pbLog.splice(0, pbLog.length - 400);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
}

async function stopPb(kill = false): Promise<void> {
  if (!pb) return;
  if (kill) {
    const p = new Promise<void>((r) => pb.once('exit', () => r()));
    pb.kill('SIGKILL');
    await p;
  } else await stopChild(pb);
  pb = null;
}

// ---------------------------------------------------------------------- mail
async function mailsTo(email: string): Promise<any[]> {
  const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  const j = (await r.json()) as { messages?: any[] };
  return j.messages ?? [];
}
async function waitMails(email: string, count: number, ms = 5000): Promise<any[]> {
  const end = Date.now() + ms;
  let list: any[] = [];
  while (Date.now() < end) {
    list = await mailsTo(email);
    if (list.length >= count) return list;
    await sleep(150);
  }
  return list;
}
/** The link of the newest email of that kind to that address. */
async function mailLink(email: string, kind: 'verification' | 'password-reset', expectCount = 1): Promise<{ url: string; token: string; subject: string }> {
  const list = await waitMails(email, expectCount);
  if (!list.length) return { url: '', token: '', subject: '' };
  const newest = list.slice().sort((a, b) => String(b.Created).localeCompare(String(a.Created)))[0];
  const full = (await (await fetch(`${MAIL}/api/v1/message/${newest.ID}`)).json()) as { HTML: string };
  const page = kind === 'verification' ? 'verify' : 'reset';
  const m = new RegExp(`href="(http[^"]*/auth/${page}/#([^"]+))"`).exec(full.HTML);
  return { url: m ? m[1] : '', token: m ? m[2] : '', subject: String(newest.Subject) };
}

// ------------------------------------------------------------- a "browser"
class Device {
  storage = new MemoryStorage();
  dropNext = false;
  fetches = 0;
  replaced = 0;
  api: PrimeApi;
  save!: SaveSystem;
  service!: AccountService;
  sync: SyncManager | null = null;

  constructor(readonly name: string) {
    const f = (async (input: any, init?: any) => {
      this.fetches++;
      const res = await fetch(input, init);
      if (this.dropNext) {
        this.dropNext = false;
        await res.text().catch(() => '');
        throw new TypeError('reply lost (simulated)');
      }
      return res;
    }) as typeof fetch;
    this.api = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 6000, f);
    this.boot();
  }

  /** A page load: the profile from the account pointer, a fresh SaveSystem / AccountService / SyncManager. */
  boot(): void {
    this.sync?.stop();
    const p = bootProfile(this.storage);
    this.save = new SaveSystem({ profile: p, storage: this.storage, lock: null });
    this.service = new AccountService({ api: this.api, storage: this.storage, current: this.save });
    this.sync = p === 'guest' ? null : new SyncManager({ save: this.save, api: this.api, storage: this.storage, onReplaced: () => this.replaced++ });
  }

  setGuest(raw: unknown): void {
    this.storage.setItem(profileKeys('guest').save, JSON.stringify(raw));
    this.boot();
  }

  get profile(): ProfileId {
    return this.save.profile;
  }

  /** The account copy of what this device plays now. */
  copy() {
    return cloudCopyOf(this.save.serialized());
  }

  bump(money: number): void {
    this.save.data.money += money;
    this.save.save();
  }
}

const PW_A = 'Studio2026a';
const PW_A2 = 'NewStudio77';
const PW_B = 'Moonlight77';
const PW_X = 'Verify1234x';

const withoutSettings = (d: unknown) => {
  const o = JSON.parse(JSON.stringify(d)) as Record<string, unknown>;
  delete o.settings;
  return canonicalJSON(o);
};

async function main(): Promise<void> {
  if (!binariesReady()) {
    console.log('PocketBase / Mailpit не установлены. Сначала: npm run backend:install');
    proc.exit(1);
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  console.log(`Временная база: ${work}`);
  const SU_EMAIL = 'check-admin@prime.test';
  const SU_PW = crypto.randomBytes(18).toString('base64url');
  upsertSuperuser(dataDir, SU_EMAIL, SU_PW, PORTS);
  mail = spawnMailpit(PORTS);
  if (!(await waitHealthy(`${MAIL}/livez`))) throw new Error('Mailpit did not start');
  await startPb();
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  const adminLogin = () => admin.collection('_superusers').authWithPassword(SU_EMAIL, SU_PW);
  await adminLogin();

  // the functional checks send far more requests than a player: the limits are raised for them and
  // put back (exactly as the migration set them) for the rate-limit check at the end
  const strict = (await admin.settings.getAll()).rateLimits;
  check('migration: rate limiting is on, with the PRIME rules', strict.enabled && strict.rules.some((r: any) => r.label === '/api/prime/register'));
  await admin.settings.update({ rateLimits: { enabled: true, rules: strict.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const smtp = (await admin.settings.getAll()).smtp;
  check('migration: email goes only to the local catcher (127.0.0.1, no password)', smtp.enabled && smtp.host === '127.0.0.1' && smtp.port === PORTS.smtp && !smtp.username);
  const usersCol = await admin.collections.getOne('users');
  check(
    'migration: users cannot be created / changed / deleted through the generic API; each sees only itself',
    usersCol.createRule === null && usersCol.updateRule === null && usersCol.deleteRule === null && usersCol.listRule === 'id = @request.auth.id' && usersCol.viewRule === 'id = @request.auth.id',
  );
  for (const name of ['profiles', 'saves', 'save_history']) {
    const c = await admin.collections.getOne(name);
    check(`migration: ${name} — read by the owner only, no generic create/update/delete`, c.createRule === null && c.updateRule === null && c.deleteRule === null && /= @request\.auth\.id$/.test(String(c.viewRule)));
  }

  // ======================================================== REGISTRATION (1–9)
  section('Регистрация');
  const d1 = new Device('mac-chrome');
  const reg = async (dev: Device, nickname: string, email: string, password: string, confirm = password) => dev.api.register({ nickname, email, password, passwordConfirm: confirm, ...((await registrationExtras(API)) as object) });
  const r1 = await reg(d1, 'NightProducer', 'Night@Prime.test', PW_A);
  const aUser = (await admin.collection('users').getFullList({ filter: 'email = "night@prime.test"' }))[0];
  const aProfile = aUser ? (await admin.collection('profiles').getFullList({ filter: `user = "${aUser.id}"` }))[0] : null;
  check('1 a new account: user + profile in one go, the verification email sent', r1.mailSent && !!aUser && aUser.verified === false && aProfile?.nickname === 'NightProducer' && aProfile?.nicknameKey === 'nightproducer');
  check('1 the email is stored lower-case; the user record exposes no password; the profile holds no email', aUser?.email === 'night@prime.test' && !('password' in aUser) && !('email' in (aProfile ?? {})));
  const e2 = await apiError(reg(d1, 'Somebody', 'NIGHT@prime.test', PW_A));
  check('2 the same email again (other letter case) → «email_taken»', e2?.code === 'email_taken');
  const nickCases: [string, string][] = [
    ['nightPRODUCER', 'nickname_taken'],
    ['NightРroducer', 'nickname_mixed'],
    ['<b>Night</b>', 'nickname_chars'],
    ['Night Producer', 'nickname_chars'],
    ['   ', 'nickname_empty'],
    ['ab', 'nickname_short'],
    ['A23456789012345678', 'nickname_long'],
    ['Admin', 'nickname_reserved'],
    ['___', 'nickname_chars'],
  ];
  const nickRes: string[] = [];
  for (const [n, code] of nickCases) {
    const e = await apiError(reg(d1, n, `n${nickRes.length}@prime.test`, PW_A));
    nickRes.push(`${n}:${e?.code}`);
    if (e?.code !== code) check(`3 nickname «${n}» → ${code}`, false, `got ${e?.code}`);
  }
  check(`3 nicknames: taken (any letter case), mixed alphabets, HTML, spaces, length, reserved — all refused (${nickCases.length})`, nickRes.every((x, i) => x.endsWith(':' + nickCases[i][1])));
  const dbDup = await statusOf(admin.collection('profiles').create({ user: aUser.id, nickname: 'NIGHTPRODUCER', nicknameKey: 'nightproducer' }));
  check('3 uniqueness lives in the database: even a superuser cannot store a second «nightproducer»', dbDup === 400, `status ${dbDup}`);
  const pwCases: [string, string, string, string][] = [
    ['short1', 'short1', 'p1@prime.test', 'password_short'],
    ['abcdefghij', 'abcdefghij', 'p2@prime.test', 'password_weak'],
    ['12345678901', '12345678901', 'p3@prime.test', 'password_weak'],
    [PW_A, PW_A + 'x', 'p4@prime.test', 'password_mismatch'],
    [PW_A, PW_A, 'not-an-email', 'email_invalid'],
    ['', '', 'p5@prime.test', 'password_empty'],
  ];
  let pwOk = true;
  for (const [p1, p2, em, code] of pwCases) {
    const e = await apiError(reg(d1, 'Tester' + code.length, em, p1, p2));
    if (e?.code !== code) {
      pwOk = false;
      check(`4 password/email case → ${code}`, false, `got ${e?.code}`);
    }
  }
  check('4 short / letters-only / digits-only password, mismatch, bad email, empty — refused with their own codes', pwOk);
  const tried = ['p1', 'p2', 'p3', 'p4', 'p5', ...nickCases.map((_, i) => 'n' + i)].map((x) => `email = "${x}@prime.test"`).join(' || ');
  const ghost = await admin.collection('users').getFullList({ filter: `${tried} || email = "not-an-email"` });
  check('4 refused registrations created nothing', ghost.length === 0, `${ghost.length} users`);

  // 5 — email confirmation through the local mail catcher
  const link = await mailLink('night@prime.test', 'verification');
  check('5 the verification email reached Mailpit (local catcher), in Russian', link.subject.includes('подтвердите email'), link.subject);
  check('5 the link opens the game\'s own confirmation page on the API (1.8.2: not the PocketBase dashboard)', link.url.startsWith(`${API}/auth/verify/#`));
  const exp = JSON.parse(atob((link.token.split('.')[1] ?? '').replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
  const hours = (exp * 1000 - Date.now()) / 3600e3;
  check(`5 the link expires after 24 h (${hours.toFixed(1)} h left)`, hours > 23.5 && hours <= 24.01);
  const anon = new PocketBase(API);
  anon.autoCancellation(false);
  await anon.collection('users').confirmVerification(link.token);
  check('5 opening the link confirms the account', (await admin.collection('users').getOne(aUser.id)).verified === true);
  const again = await statusOf(anon.collection('users').confirmVerification(link.token));
  check('5 opening it again does no harm (the account just stays confirmed)', again === 200 && (await admin.collection('users').getOne(aUser.id)).verified === true, `status ${again}`);
  // an expired link: shorten the lifetime for a moment
  const col = await admin.collections.getOne('users');
  const minDur = (await statusOf(admin.collections.update('users', { verificationToken: { duration: 3 } }))) === 200 ? 3 : 10;
  if (minDur === 10) await admin.collections.update('users', { verificationToken: { duration: 10 } });
  await reg(d1, 'Expiry', 'expiry@prime.test', PW_X);
  const expLink = await mailLink('expiry@prime.test', 'verification');
  await sleep(minDur * 1000 + 1500);
  const expSt = await statusOf(anon.collection('users').confirmVerification(expLink.token));
  await admin.collections.update('users', { verificationToken: { duration: col.verificationToken.duration } });
  check(`5 an expired link is refused (lifetime set to ${minDur} s for the check, then back to 24 h)`, expSt === 400 && (await admin.collection('users').getFirstListItem('email = "expiry@prime.test"')).verified === false, `status ${expSt}`);

  // 6 — signed in before confirming: no cloud writes
  const d2 = new Device('mac-safari');
  await reg(d2, 'ЛунныйПродюсер', 'moon@prime.test', PW_B);
  const meB0 = await d2.api.login('moon@prime.test', PW_B);
  const planB0 = await d2.service.planFor(meB0);
  check('6 signing in before confirming works — the game stays on the guest career', planB0.kind === 'unverified' && d2.profile === 'guest' && meB0.nickname === 'ЛунныйПродюсер');
  const someText = d2.copy();
  const eUnv = await apiError(d2.api.putSave({ base: 0, text: someText.text, hash: someText.hash, op: 'op_unverified_1', device: 'x', reason: 'transfer' }));
  const eUnvA = await apiError(d2.api.archive(someText.text, someText.hash, 'conflict-device', 'x'));
  const eUnvR = await apiError(d2.api.restore('aaaaaaaaaaaaaaa', 0, 'op_unverified_2', 'x'));
  // (1.8.4: restoring an earlier version is refused for every player — see 26)
  check('6/34 an unconfirmed account cannot upload or archive (403 not_verified), nor restore (403)', eUnv?.kind === 'unverified' && eUnvA?.kind === 'unverified' && eUnvR?.code === 'restore_disabled');
  check('6 …and nothing was stored for it', (await admin.collection('saves').getFullList({ filter: `owner = "${meB0.id}"` })).length === 0);
  await d2.api.resendVerification('Moon@Prime.test');
  const linkB = await mailLink('moon@prime.test', 'verification', 2); // the resend is delivered in the background
  check('5 «send again» delivers a second email', (await mailsTo('moon@prime.test')).length === 2 && !!linkB.token);
  await anon.collection('users').confirmVerification(linkB.token);

  // 7 — after confirming
  const meB = await d2.api.refresh();
  const planB = await d2.service.planFor(meB);
  check('7 after confirming: signed in and confirmed; a new account with no guest progress → a new career', meB.verified && planB.kind === 'new-career');

  // 8 — password reset
  const before8 = (await mailsTo('night@prime.test')).length;
  await d1.api.requestPasswordReset('night@prime.test');
  const reset = await mailLink('night@prime.test', 'password-reset', before8 + 1);
  check('8 the reset email reaches the local catcher, the link opens the game\'s own reset page', reset.url.startsWith(`${API}/auth/reset/#`));
  await anon.collection('users').confirmPasswordReset(reset.token, PW_A2, PW_A2);
  const oldPw = await apiError(d1.api.login('night@prime.test', PW_A));
  const meA = await d1.api.login('night@prime.test', PW_A2);
  check('8 the new password works, the old one no longer does', oldPw?.kind === 'invalid' && meA.id === aUser.id);
  const reuse = await statusOf(anon.collection('users').confirmPasswordReset(reset.token, 'Another999', 'Another999'));
  check('8 the reset link works once', reuse === 400, `status ${reuse}`);
  const meAUpper = await d1.api.login('NIGHT@Prime.Test', PW_A2);
  check('8 sign-in ignores the email letter case (the game lower-cases it like the registration)', meAUpper.id === aUser.id);

  // ============================================================== SAVES (10–28)
  section('Перенос гостевого прогресса и облако');
  const rich = save176();
  rich.version = 12;
  rich.streak = { current: 3, best: 5, since: Date.parse('2026-10-18T10:00:00Z') };
  rich.fighters.ray.streak = 2;
  rich.fighters.ray.bestStreak = 4;
  rich.fighters.lucien.streak = 1;
  rich.fighters.lucien.bestStreak = 3;
  d1.setGuest(rich);
  const guestRaw = d1.storage.getItem(profileKeys('guest').save);
  const guestCopy = d1.copy();
  const plan10 = await d1.service.planFor(meA);
  check('10 first sign-in to a new confirmed account with guest progress → the transfer offer with a summary', plan10.kind === 'offer-transfer' && plan10.guest.money === 12345 && plan10.guest.matches === 140 && plan10.guest.fighters === 6);
  check('10 nothing moved yet (no cloud save before the player agrees)', !(await d1.api.getSave()));
  const moved = await d1.service.transferGuest(meA);
  const cloudA1 = await d1.api.getSave();
  check('10 «ПЕРЕНЕСТИ ПРОГРЕСС»: the server confirmed revision 1 with exactly the guest career', moved && cloudA1?.revision === 1 && cloudA1.hash === guestCopy.hash && cloudA1.text === guestCopy.text);
  const accs = readAccounts(d1.storage);
  // (the copy is skipped only when the newest local copy already holds exactly this text — e.g. today's auto copy)
  check('10 the guest career is left as it was, and a local safety copy of exactly it exists', d1.storage.getItem(profileKeys('guest').save) === guestRaw && new SaveSystem({ profile: 'guest', storage: d1.storage, lock: null }).backups().some((b) => b.raw === guestRaw));
  check('10 the guest career is marked as moved into this account; the browser now plays the account', accs.guestBound?.user === aUser.id && accs.active === userProfile(aUser.id));
  d1.boot();
  check('10 after the reload: the account profile with the whole career (every saved field) and this device\'s settings', d1.profile === userProfile(aUser.id) && d1.copy().text === guestCopy.text && d1.save.data.settings.quality === 'low' && d1.save.data.settings.sound === false);
  await d1.sync!.start();
  check('10 sync status after the switch: «Синхронизировано» (confirmed by the server)', d1.sync!.status === 'synced');

  // 11–16: another browser signs in to the same account
  const d3 = new Device('other-browser');
  const meA3 = await d3.api.login('night@prime.test', PW_A2);
  const plan16 = await d3.service.planFor(meA3);
  check('16 another browser, same account: the cloud save is written to its local slot first, then it switches', plan16.kind === 'switch' && plan16.from === 'cloud' && readAccounts(d3.storage).active === 'guest');
  d3.service.activate(userProfile(meA3.id));
  d3.boot();
  const a1 = d1.save.data;
  const a3 = d3.save.data;
  check('16 the same progress on the second browser (all fields but the device settings)', withoutSettings(a1) === withoutSettings(a3) && d3.copy().hash === cloudA1!.hash);
  check('16 …the second browser kept its own device settings (not the first one\'s)', a3.settings.quality === 'auto' && a3.settings.sound === true);
  check('11 LUCIEN came with the account (signed, with his Halloween purchase record)', a3.fighters.lucien.unlocked && (a3.events['halloween-2026']?.fighters ?? []).some((f) => f.id === 'lucien'));
  check('12 custom decks (shop cards, BAT BITE) are the same', ['ray', 'vega', 'lucien', 'bruno'].every((id) => a3.fighters[id as 'ray'].deck.join() === a1.fighters[id as 'ray'].deck.join()) && a3.fighters.lucien.deck.includes('bat_bite'));
  check('13 seasonal tokens and quests are the same', a3.events['halloween-2026'].tokens === 120 && a3.events['halloween-2026'].quests.first_night?.claimed === true);
  check('14 the collection (items, worn items, personal rewards) is the same', a3.cosmetics.owned.length === 4 && a3.cosmetics.equipped.cardStyle === 'card_pumpkin' && (a3.cosmetics.personal.title_prime_legend ?? []).join() === 'ray,vega');
  check('15 win streaks (producer and fighters, current and best) are the same', a3.streak.current === 3 && a3.streak.best === 5 && a3.fighters.ray.streak === 2 && a3.fighters.ray.bestStreak === 4 && a3.fighters.lucien.bestStreak === 3);
  await d3.sync!.start();
  check('16 the second browser is in sync too', d3.sync!.status === 'synced');

  // 17–19: a second account on the same computer, sign out and back in
  section('Второй аккаунт, выход и вход');
  const aSlotBefore = d1.storage.getItem(profileKeys(userProfile(aUser.id)).save);
  d1.sync!.stop();
  d1.service.logout();
  d1.boot();
  check('9 sign out: the session is gone, the browser plays the guest career again, the account copy stays', !d1.api.signedIn && d1.profile === 'guest' && d1.storage.getItem(profileKeys(userProfile(aUser.id)).save) === aSlotBefore);
  await reg(d1, 'Третий', 'third@prime.test', PW_X);
  await anon.collection('users').confirmVerification((await mailLink('third@prime.test', 'verification')).token);
  const meT = await d1.api.login('third@prime.test', PW_X);
  const planT = await d1.service.planFor(meT);
  check('17 a different new account on this computer is NOT offered the guest career again (it went into NightProducer)', planT.kind === 'new-career' && planT.guestBoundTo === 'NightProducer');
  d1.api.logout();
  const created = await d2.service.startNewCareer(meB);
  d2.boot();
  await d2.sync!.start();
  const b2 = d2.save.data;
  check('17 second account «ЛунныйПродюсер»: a new career in the cloud (revision 1) and on its device', created && d2.profile === userProfile(meB.id) && (await d2.api.getSave())?.revision === 1 && b2.money === CAREER_START.money && d2.sync!.status === 'synced');
  const meB1 = await d1.api.login('moon@prime.test', PW_B);
  const planB1 = await d1.service.planFor(meB1);
  if (planB1.kind === 'switch') d1.service.activate(userProfile(meB1.id));
  d1.boot();
  const b1 = d1.save.data;
  check('18 B on the first computer: B\'s own career only — no A money, no LUCIEN, default decks, no collection', planB1.kind === 'switch' && b1.money === CAREER_START.money && !b1.fighters.lucien.unlocked && b1.cosmetics.owned.length === 0 && b1.fighters.ray.deck.join() === b2.fighters.ray.deck.join());
  check('18 …A\'s local copy on this computer is untouched', d1.storage.getItem(profileKeys(userProfile(aUser.id)).save) === aSlotBefore);
  await d1.sync!.start();
  d1.bump(777);
  await d1.sync!.syncNow();
  const cloudB = await d1.api.getSave();
  const cloudAafterB = await d3.api.getSave();
  check('18 B plays and syncs: only B\'s cloud save changes, A\'s stays exactly as it was', cloudB?.revision === 2 && cloudB.hash === d1.copy().hash && cloudAafterB?.revision === 1 && cloudAafterB.hash === cloudA1!.hash);
  d1.sync!.stop();
  d1.service.logout();
  d1.boot();
  const meA4 = await d1.api.login('night@prime.test', PW_A2);
  const planA4 = await d1.service.planFor(meA4);
  if (planA4.kind === 'switch') d1.service.activate(userProfile(meA4.id));
  d1.boot();
  await d1.sync!.start();
  check('19 sign out and back in as A: A\'s copy on this computer is used, A\'s money and LUCIEN are back', planA4.kind === 'switch' && planA4.from === 'local' && d1.save.data.money === 12345 && d1.save.data.fighters.lucien.unlocked && d1.sync!.status === 'synced');

  // 20–21: offline and back
  section('Без интернета');
  d1.bump(100);
  await stopPb();
  const st20 = await d1.sync!.syncNow();
  const m20 = readSync(d1.storage, d1.profile);
  check('20 server unreachable: the game keeps the change locally, status «Нет подключения», the upload waits', st20 === 'offline' && d1.save.data.money === 12445 && m20.pending !== null && d1.sync!.hasUnsynced());
  d1.boot();
  const st20b = await d1.sync!.start();
  check('20 a reload while offline keeps the unsynced change (nothing lost, still waiting)', st20b === 'offline' && d1.save.data.money === 12445 && d1.sync!.hasUnsynced());
  await startPb();
  await adminLogin();
  const st21 = await d1.sync!.syncNow();
  const c21 = await d1.api.getSave();
  check('21 the server is back: the waiting change is uploaded (revision 2), «Синхронизировано» only now', st21 === 'synced' && c21?.revision === 2 && c21.hash === d1.copy().hash);

  // 22: conflict between two devices
  section('Конфликт двух устройств');
  const st22a = await d3.sync!.check();
  check('22 the other browser notices the newer cloud save (it has no changes of its own) and does not upload', st22a === 'conflict' && readSync(d3.storage, d3.profile).conflict?.kind === 'cloud-newer');
  await d3.sync!.useCloud();
  d3.boot();
  await d3.sync!.start();
  check('22 …it takes the cloud version (the page reloads) and is in sync', d3.replaced === 1 && d3.save.data.money === 12445 && d3.sync!.status === 'synced');
  d1.bump(1);
  await d1.sync!.syncNow();
  const r22 = (await d1.api.getSave())!.revision;
  d3.bump(2);
  const st22b = await d3.sync!.syncNow();
  const c22 = await d1.api.getSave();
  check('22 both changed: the second upload is refused by the server and becomes a conflict (nothing merged, nothing picked by money)', st22b === 'conflict' && readSync(d3.storage, d3.profile).conflict?.kind === 'diverged' && c22?.revision === r22 && c22.hash === d1.copy().hash);
  const st22c = await d3.sync!.syncNow();
  check('22 «Решить позже»: no automatic upload while the conflict is open, both versions intact', st22c === 'conflict' && (await d1.api.getSave())?.revision === r22 && d3.save.data.money === 12447);
  const lostHash = c22!.hash;
  const ok22 = await d3.sync!.useDevice();
  const c22b = await d1.api.getSave();
  const h22 = await d3.api.history();
  check('22 «Использовать это устройство» still passes the server revision check: new revision, the replaced cloud version kept in the history', ok22 && c22b?.revision === r22 + 1 && c22b.hash === d3.copy().hash && h22.some((h) => h.hash === lostHash && h.reason === 'conflict-cloud'));
  await d1.sync!.check();
  await d1.sync!.useCloud();
  d1.boot();
  await d1.sync!.start();
  check('22 the first device takes the chosen version', d1.save.data.money === 12447 && d1.sync!.status === 'synced');
  d1.bump(3);
  await d1.sync!.syncNow();
  d3.bump(4);
  await d3.sync!.syncNow();
  const devHash = d3.copy().hash;
  const ok22d = await d3.sync!.useCloud();
  const h22d = await d3.api.history();
  check('22 «Использовать облако»: this device\'s version goes to the account history first, then the cloud one is loaded', ok22d && h22d.some((h) => h.hash === devHash && h.reason === 'conflict-device') && readCloudText((await d3.api.getSave())!.text).ok);
  d3.boot();
  await d3.sync!.start();
  check('22 …and the device is in sync with the cloud version', d3.save.data.money === 12450 && d3.sync!.status === 'synced');

  // 23: the reply was lost
  section('Повтор запроса после потери ответа');
  d1.bump(5);
  const histBefore = (await d1.api.history()).length;
  const revBefore = (await d1.api.getSave())!.revision;
  d1.dropNext = true;
  const st23 = await d1.sync!.syncNow();
  const landed = await d1.api.getSave();
  check('23 the server stored the upload but the reply was lost: the game does not claim «synchronised»', st23 === 'offline' && landed?.revision === revBefore + 1 && readSync(d1.storage, d1.profile).pending !== null);
  const histMid = (await d1.api.history()).length;
  const st23b = await d1.sync!.syncNow();
  const after23 = await d1.api.getSave();
  check('23 the retry (same request id) is recognised: no second write, no extra revision, no extra history', st23b === 'synced' && after23?.revision === revBefore + 1 && (await d1.api.history()).length === histMid && histMid <= histBefore + 1);
  d1.bump(6);
  d1.dropNext = true;
  await d1.sync!.syncNow();
  d1.bump(7);
  const st23c = await d1.sync!.syncNow();
  check('23 a lost reply followed by more play: no false conflict — the landed write is recognised, then the new one is uploaded', st23c === 'synced' && (await d1.api.getSave())?.hash === d1.copy().hash && (await d1.api.getSave())?.revision === revBefore + 3);

  // 24: damaged cloud save
  section('Повреждённое облачное сохранение');
  const saveRec = (await admin.collection('saves').getFullList({ filter: `owner = "${aUser.id}"` }))[0];
  const broken = '{"version":12,"money":';
  await admin.collection('saves').update(saveRec.id, { data: broken, hash: sha256(broken) });
  const localBefore24 = d1.copy().text;
  const st24 = await d1.sync!.check();
  check('24 an unreadable cloud save is detected; this device\'s progress is not touched or overwritten automatically', st24 === 'conflict' && readSync(d1.storage, d1.profile).conflict?.kind === 'damaged' && d1.copy().text === localBefore24);
  const d4 = new Device('fresh-browser');
  const plan24 = await d4.service.planFor(await d4.api.login('night@prime.test', PW_A2));
  check('24 a fresh browser signing in is told the account save is damaged (no empty career is made)', plan24.kind === 'cloud-damaged' && readAccounts(d4.storage).active === 'guest');
  const ok24 = await d1.sync!.useDevice();
  check('24 replacing it from this device: a new revision; the damaged text stays in the history', ok24 && (await d1.api.getSave())?.hash === d1.copy().hash && (await d1.api.history()).some((h) => h.text === broken && h.reason === 'damaged'));

  // 25: newer schema in the cloud
  section('Более новая схема сохранения');
  const cur25 = (await admin.collection('saves').getFullList({ filter: `owner = "${aUser.id}"` }))[0];
  const future = JSON.parse(cur25.data);
  future.version = 13;
  future.futureCurrency = { gems: 40 };
  const futureText = canonicalJSON(future);
  await admin.collection('saves').update(cur25.id, { data: futureText, hash: sha256(futureText), schema: 13 });
  const st25 = await d1.sync!.check();
  d1.bump(1);
  const st25b = await d1.sync!.syncNow();
  const c25 = await d1.api.getSave();
  check('25 the cloud holds schema 13 (this game knows 12): «нужно обновить игру», no download, no automatic upload', st25 === 'newer' && st25b === 'newer' && c25?.schema === 13 && c25.text === futureText);
  const force = await apiError(d1.api.putSave({ base: c25!.revision, text: d1.copy().text, hash: d1.copy().hash, op: 'op_force_downgrade', device: 'x', reason: 'sync' }));
  check('25 even a forced upload of schema 12 over 13 is refused by the server (unknown fields would be lost)', force?.code === 'schema_downgrade');
  await admin.collection('saves').update(cur25.id, { data: cur25.data, hash: cur25.hash, schema: cur25.schema });
  const st25c = await d1.sync!.check();
  check('25 once the cloud is readable again, the waiting change is uploaded', st25c === 'synced' && (await d1.api.getSave())?.hash === d1.copy().hash);

  // 26: 1.8.4 — a player cannot put an earlier version back (rewards / currency would return)
  section('Восстановление резервной версии (1.8.4: только организатор)');
  const hist = await d1.sync!.history();
  const pick = hist.find((h) => h.reason === 'previous' && h.schema === 12 && readCloudText(h.text).ok);
  const before26 = await d1.api.getSave();
  const e26own = pick ? await apiError(d1.api.restore(pick.id, before26!.revision, 'op_restore_own', 'x')) : null;
  const after26 = await d1.api.getSave();
  check('26 restoring an earlier version of one\'s own save is refused (403 restore_disabled); the cloud save is unchanged, the history stays', !!pick && e26own?.code === 'restore_disabled' && after26?.revision === before26?.revision && after26?.hash === before26?.hash && (await d1.api.history()).length === hist.length);
  const bHist = await d2.api.history();
  const foreign = bHist[0] ?? null;
  const e26 = foreign ? await apiError(d1.api.restore(foreign.id, (await d1.api.getSave())!.revision, 'op_steal_restore', 'x')) : null;
  check('26/31 restoring another account\'s copy is refused too', !!foreign && e26?.code === 'restore_disabled');

  // 27: interrupted import / transfer
  section('Прерванный импорт и перенос');
  const bad = d1.save.checkImport('{"hello":"world"}');
  check('27 a wrong import file is refused before anything changes', !bad.ok && d1.copy().hash === (await d1.api.getSave())!.hash);
  const fileText = JSON.stringify({ format: 'primetime-showdown-save', save: { ...save176(), version: 12, money: 54321 } });
  const good = d1.save.checkImport(fileText);
  await stopPb();
  const applied = d1.save.applyImport(good);
  const st27 = await d1.sync!.syncNow();
  await startPb();
  await adminLogin();
  const c27a = await d1.api.getSave();
  check('27 import while the server is down: local progress replaced (with a local safety copy), the cloud untouched, the upload waits', applied && d1.save.data.money === 54321 && st27 === 'offline' && c27a?.hash !== d1.copy().hash && d1.save.backups().some((b) => b.reason === 'import'));
  const st27b = await d1.sync!.syncNow();
  check('27 …uploaded once the server is back', st27b === 'synced' && (await d1.api.getSave())?.hash === d1.copy().hash);
  const d5 = new Device('transfer-interrupted');
  d5.setGuest({ ...save176(), version: 12, orgName: 'INTERRUPTED TV' });
  const g5 = d5.storage.getItem(profileKeys('guest').save);
  await reg(d5, 'Прерванный', 'cut@prime.test', PW_X);
  await anon.collection('users').confirmVerification((await mailLink('cut@prime.test', 'verification')).token);
  const me5 = await d5.api.login('cut@prime.test', PW_X);
  await stopPb();
  const e27 = await apiError(d5.service.transferGuest(me5));
  await startPb();
  await adminLogin();
  check('27 the transfer is interrupted (server down): the guest career is intact, nothing switched, no account copy', e27?.kind === 'network' && d5.storage.getItem(profileKeys('guest').save) === g5 && readAccounts(d5.storage).active === 'guest' && d5.storage.getItem(profileKeys(userProfile(me5.id)).save) === null);
  const ok27 = await d5.service.transferGuest(me5);
  check('27 …the retry completes it', ok27 && (await d5.api.getSave())?.revision === 1 && readAccounts(d5.storage).active === userProfile(me5.id));

  // 28: the server dies in the middle of a write
  section('Отключение сервера во время записи');
  d1.bump(9);
  const rev28 = (await d1.api.getSave())!.revision;
  const inflight = d1.sync!.syncNow();
  await sleep(2);
  await stopPb(true);
  const st28 = await inflight;
  await startPb();
  await adminLogin();
  const st28b = await d1.sync!.syncNow();
  const c28 = await d1.api.getSave();
  check(`28 server killed during the upload (${st28}): after the restart exactly one new revision, the cloud equals the device`, st28b === 'synced' && c28?.revision === rev28 + 1 && c28.hash === d1.copy().hash && readCloudText(c28.text).ok);

  // ============================================================ SECURITY (29–36)
  section('Безопасность (запросы обычных пользователей)');
  const pbA = d1.api.pb;
  const pbB = d2.api.pb;
  const aSave = (await pbA.collection('saves').getList(1, 5)).items;
  const bSave = (await pbB.collection('saves').getList(1, 5)).items;
  check('29 each account lists only its own save', aSave.length === 1 && aSave[0].owner === aUser.id && bSave.length === 1 && bSave[0].owner === meB.id);
  check('29 A cannot open B\'s save by id (404), nor find it with a filter', (await statusOf(pbA.collection('saves').getOne(bSave[0].id))) === 404 && (await pbA.collection('saves').getList(1, 5, { filter: `owner = "${meB.id}"` })).totalItems === 0);
  const bRev = bSave[0].revision;
  const upd = await statusOf(pbA.collection('saves').update(bSave[0].id, { data: '{}' }));
  const del = await statusOf(pbA.collection('saves').delete(bSave[0].id));
  const crt = await statusOf(pbA.collection('saves').create({ owner: meB.id, data: '{}', schema: 12, hash: '0'.repeat(64), revision: 99 }));
  check(`30 A cannot change, delete or create B's save through the API (${upd}/${del}/${crt})`, [403, 404].includes(upd) && [403, 404].includes(del) && crt === 403);
  const sneaky = d1.copy();
  await pbA.send('/api/prime/save', { method: 'PUT', body: { base: (await d1.api.getSave())!.revision, data: sneaky.text, hash: sneaky.hash, op: 'op_owner_spoof_1', owner: meB.id, user: meB.id, reason: 'sync' } });
  const bAfter = (await pbB.collection('saves').getList(1, 5)).items[0];
  check('30 a PUT naming B as owner still writes only A\'s own save (the owner is always the signed-in user)', bAfter.revision === bRev && bAfter.hash === bSave[0].hash);
  const aHist = (await pbA.collection('save_history').getList(1, 50)).items;
  const bHistAll = (await pbB.collection('save_history').getList(1, 50)).items;
  check('31 history: each account sees only its own copies; B\'s copies cannot be opened by A', aHist.every((h) => h.owner === aUser.id) && (bHistAll.length === 0 || (await statusOf(pbA.collection('save_history').getOne(bHistAll[0].id))) === 404));
  check('29 A sees only itself among users and profiles (no other emails)', (await pbA.collection('users').getList(1, 50)).items.length === 1 && (await statusOf(pbA.collection('users').getOne(meB.id))) === 404 && (await pbA.collection('profiles').getList(1, 50)).items.every((p) => p.user === aUser.id));
  const curRev = (await d1.api.getSave())!.revision;
  const t32 = d1.copy();
  const bases: unknown[] = [999, -1, 1.5, '3', null];
  const res32: string[] = [];
  for (const b of bases) {
    res32.push(String(await statusOf(pbA.send('/api/prime/save', { method: 'PUT', body: { base: b, data: t32.text, hash: t32.hash, op: 'op_base_' + res32.length + '_x', reason: 'sync' } }))));
  }
  check(`32 the server accepts no made-up revision (${res32.join(',')}) and the cloud did not move`, res32[0] === '409' && res32.slice(1).every((s) => s === '400') && (await d1.api.getSave())!.revision === curRev);
  // 33: ten simultaneous writes on the same revision
  const histRev = async () => (await d1.api.history()).filter((h) => h.revision === curRev).length;
  const before33 = await histRev();
  const texts = Array.from({ length: 10 }, (_, i) => {
    const o = JSON.parse(d1.copy().text);
    o.money = 1000 + i;
    const text = canonicalJSON(o);
    return { text, hash: sha256(text) };
  });
  const results = await Promise.allSettled(texts.map((t, i) => d1.api.putSave({ base: curRev, text: t.text, hash: t.hash, op: `op_race_${i}_${Date.now()}`, device: 'race', reason: 'sync' })));
  const wins = results.filter((r) => r.status === 'fulfilled').length;
  const conflicts = results.filter((r) => r.status === 'rejected' && (r.reason as PrimeApiError).code === 'conflict').length;
  const after33 = await d1.api.getSave();
  check(`33 ten simultaneous uploads on one revision: exactly one wins, nine get «conflict» (${wins}/${conflicts})`, wins === 1 && conflicts === 9 && after33?.revision === curRev + 1 && (await histRev()) === before33 + 1);
  await d1.sync!.check();
  if (readSync(d1.storage, d1.profile).conflict) await d1.sync!.useDevice();
  // server-side data checks
  const tamper = async (mutate: (o: any) => void) => {
    const o = JSON.parse(d1.copy().text);
    mutate(o);
    const text = canonicalJSON(o);
    return apiError(d1.api.putSave({ base: (await d1.api.getSave())!.revision, text, hash: sha256(text), op: 'op_t_' + crypto.randomBytes(6).toString('hex'), device: 'x', reason: 'sync' }));
  };
  const tampers = [
    await tamper((o) => (o.money = -5)),
    await tamper((o) => (o.fighters.hacker = { unlocked: true, deck: [] })),
    await tamper((o) => (o.fighters.ray.deck = ['dash', 'power_shot', 'shield', 'knockout'])),
    await tamper((o) => (o.events = {})),
    await tamper((o) => (o.cosmetics.equipped.title = 'title_prime_legend_x')),
    await tamper((o) => (o.matches = 'many')),
    await tamper((o) => (o.money = 1e300)),
  ];
  check(
    `anti-cheat basics: negative money, unknown fighter, another fighter's signature card, LUCIEN without his purchase, unknown item, wrong types, absurd values — all refused (${tampers.map((t) => t?.code).join(',')})`,
    tampers.every((t) => t?.code === 'invalid_data'),
  );
  const big = 'x'.repeat(600 * 1024);
  const eBig = await apiError(d1.api.putSave({ base: 1, text: big, hash: sha256(big), op: 'op_big_payload', device: 'x', reason: 'sync' }));
  const t2 = d1.copy();
  const eHash = await apiError(d1.api.putSave({ base: 1, text: t2.text, hash: sha256('other'), op: 'op_bad_hash_1', device: 'x', reason: 'sync' }));
  check(`anti-cheat basics: an oversized upload and a text that does not match its hash are refused (${eBig?.status}/${eHash?.code})`, eBig?.kind === 'invalid' && eHash?.code === 'hash_mismatch');
  const aSaveRec = (await pbA.collection('saves').getList(1, 1)).items[0];
  const s35a = await statusOf(pbA.collection('saves').update(aSaveRec.id, { revision: 999 }));
  const s35b = await statusOf(pbA.collection('profiles').update(aProfile!.id, { nickname: 'Hacker' }));
  const s35c = await statusOf(pbA.collection('users').update(aUser.id, { verified: false }));
  const s35d = await statusOf(new PocketBase(API).collection('users').create({ email: 'direct@prime.test', password: PW_X, passwordConfirm: PW_X }));
  check(`35 the client cannot touch service fields: own revision, nickname, verified flag, direct sign-up (${s35a}/${s35b}/${s35c}/${s35d})`, s35a === 403 && s35b === 403 && s35c === 403 && s35d === 403);
  check('35 …and none of it changed', (await pbA.collection('saves').getOne(aSaveRec.id)).revision === aSaveRec.revision && (await admin.collection('profiles').getOne(aProfile!.id)).nickname === 'NightProducer');
  // 36: the guest game needs no server
  const dg = new Device('guest-only');
  await stopPb();
  dg.save.data.money += 1;
  dg.save.data.matches += 1;
  dg.save.save();
  const guestOk = new SaveSystem({ profile: 'guest', storage: dg.storage, lock: null }).data.money === CAREER_START.money + 1;
  check('36 the guest game saves and loads with the server switched off, without a single network request', guestOk && dg.fetches === 0 && dg.sync === null);
  await startPb();
  await adminLogin();

  // =========================================================== infrastructure
  section('Почта, лимиты, копия базы');
  const mailsBefore = (await mailsTo('expiry@prime.test')).length;
  await admin.settings.update({ smtp: { enabled: true, host: 'smtp.example.com', port: 587 } });
  await statusOf(anon.collection('users').requestVerification('expiry@prime.test'));
  await sleep(800);
  await admin.settings.update({ smtp: { enabled: true, host: '127.0.0.1', port: PORTS.smtp } });
  // PocketBase writes its log in batches: give it a few seconds
  let logs = '';
  for (let i = 0; i < 16 && !logs.includes('allowed only to the local test catcher'); i++) {
    await sleep(500);
    logs = JSON.stringify((await admin.logs.getList(1, 200, { sort: '-created' })).items);
  }
  check('mail guard: with any SMTP host but this computer no email leaves (the hook refuses to send)', (await mailsTo('expiry@prime.test')).length === mailsBefore && logs.includes('allowed only to the local test catcher'));
  await admin.settings.update({ rateLimits: strict });
  const rl: number[] = [];
  for (let i = 0; i < 8; i++) rl.push((await apiError(reg(d4, 'Flood' + i, `flood${i}@prime.test`, PW_X)))?.status ?? 200);
  check(`rate limit: registration floods are cut off with 429 (${rl.join(',')})`, rl.includes(429) && rl.filter((s) => s === 200).length <= 5);
  const lf: number[] = [];
  // (1.8.4: guessing also locks the guessed address for 15 minutes — so not an address signed in to below)
  for (let i = 0; i < 14; i++) lf.push((await apiError(d4.api.login('flood0@prime.test', 'WrongPass' + i)))?.status ?? 200);
  check(`rate limit: password guessing is cut off with 429 (${lf.slice(-4).join(',')})`, lf.includes(429) && lf.every((s) => s === 400 || s === 429));

  // a backup of the database, restored into a new folder
  const revA = (await d1.api.getSave())!.revision;
  await stopPb();
  const zip = path.join(work, 'backup.zip');
  const z = cp.spawnSync('/usr/bin/zip', ['-r', '-q', zip, '.', '-x', 'types.d.ts'], { cwd: dataDir });
  const restoredDir = path.join(work, 'pb_restored');
  fs.mkdirSync(restoredDir);
  const u = cp.spawnSync('/usr/bin/unzip', ['-q', zip, '-d', restoredDir]);
  await startPb(restoredDir);
  const dr = new Device('after-restore');
  const meR = await dr.api.login('night@prime.test', PW_A2);
  check('backup: the zipped database restored into a new folder holds the accounts and the latest save', z.status === 0 && u.status === 0 && meR.id === aUser.id && (await dr.api.getSave())?.revision === revA);
  await stopPb();
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  the check crashed: ' + String((e as Error)?.stack ?? e));
    console.log('--- PocketBase log (last lines) ---\n' + pbLog.slice(-25).join('\n'));
  })
  .finally(async () => {
    await stopPb().catch(() => undefined);
    await stopChild(mail).catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed === 0 ? 'backend: OK' : 'backend: FAILED'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed === 0 ? 0 : 1);
  });
