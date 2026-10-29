// Alpha 1.8.2 stage 1 — `npm run beta:test`: PRIME NETWORK CLOSED BETA against a REAL PocketBase
// (the project's migrations and hooks) and a real Mailpit, on spare ports, with a brand-new
// temporary database that is deleted afterwards. The developer's backend/pb_data is never opened.
//
//   invites: created by the administrator's console command, used once, atomically, never bypassable
//   registration modes: disabled / invite_only / public / missing or misspelt configuration
//   existing accounts: sign-in, email confirmation and password reset need no invite
//   a flaky internet: slow replies, server errors, a session that ends, a restart — no progress lost
//   backup while the server runs → restore into another folder → it starts and works
//
// All addresses are made-up test addresses (…@beta.test); codes exist only in the temporary database.

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { SaveSystem, profileKeys } from '../src/meta/SaveSystem';
import { AccountService } from '../src/net/AccountService';
import { bootProfile, readSync, userProfile } from '../src/net/accountStore';
import { cloudCopyOf } from '../src/net/cloudSave';
import { PrimeApi } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { SyncManager } from '../src/net/SyncManager';
import { HOOKS, LEGACY_CHECK_ENV, MIGRATIONS, PB_BIN, ROOT, binariesReady, dbFingerprint, ensurePortsFree, ownServerStarted, registrationExtras, snapshot, spawnMailpit, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { MemoryStorage, save176 } from './lib/fixtures';
import { cp, crypto, fs, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 18590, smtp: 11525, mailUi: 18525 };
const API = `http://127.0.0.1:${PORTS.api}`;
const MAIL = `http://127.0.0.1:${PORTS.mailUi}`;
const PW = 'BetaPass2026';

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

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : -1;
  }
}
// --------------------------------------------------------------- processes
type Child = any;
let pb: Child = null;
let mail: Child = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-beta-check-'));
const dataDir = path.join(work, 'pb_data');

/** Start PocketBase with a registration mode (undefined = the variable is missing altogether). */
async function startPb(registration: string | undefined, dir = dataDir, extra: Record<string, string> = {}, args: string[] = []): Promise<void> {
  const env: Record<string, string> = { PRIME_GAME_URL: 'http://localhost:5173/', ...LEGACY_CHECK_ENV, ...extra };
  if (registration !== undefined) env.PRIME_REGISTRATION = registration;
  const saved = proc.env.PRIME_REGISTRATION;
  delete proc.env.PRIME_REGISTRATION; // never inherited from the shell running the check
  pb = spawnPocketBase({ dir, ports: PORTS, origins: ['http://localhost:5173', 'https://aertonik.github.io'], env, args });
  if (saved !== undefined) proc.env.PRIME_REGISTRATION = saved;
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

/** The administrator's console command on the temporary database. */
function invitesCli(...args: string[]): { out: string; codes: string[]; ids: string[] } {
  const r = cp.spawnSync(PB_BIN, ['invites', ...args, `--dir=${dataDir}`, `--hooksDir=${HOOKS}`, `--migrationsDir=${MIGRATIONS}`, '--automigrate=false'], {
    encoding: 'utf8',
    env: { ...proc.env, PRIME_SMTP_HOST: '127.0.0.1', PRIME_SMTP_PORT: String(PORTS.smtp), PRIME_APP_URL: API },
  });
  const out = String(r.stdout) + String(r.stderr);
  return { out, codes: out.match(/PT-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}/g) ?? [], ids: [...out.matchAll(/\(id ([a-z0-9]{15})\)/g)].map((m) => m[1]) };
}

async function register(nickname: string, email: string, invite?: string): Promise<{ status: number; code: string }> {
  const r = await fetch(`${API}/api/prime/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // (1.8.4: plus the age, the documents and a solved challenge — see public-check for those rules)
    body: JSON.stringify({ nickname, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)), ...(invite !== undefined ? { invite } : {}) }),
  });
  const j = (await r.json().catch(() => ({}))) as { code?: string; ok?: boolean };
  return { status: r.status, code: j.ok ? 'ok' : (j.code ?? '') };
}

async function mailLink(email: string, page: 'verify' | 'reset', count: number): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const j = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as { messages?: any[] };
    // 1.8.9.5: the notice to an address that already has an account is not a link letter — never counted here
    const list = (j.messages ?? []).filter((m: any) => !/попытка регистрации/.test(String(m.Subject)));
    if (list.length >= count) {
      const newest = list.slice().sort((a, b) => String(b.Created).localeCompare(String(a.Created)))[0];
      const full = (await (await fetch(`${MAIL}/api/v1/message/${newest.ID}`)).json()) as { HTML: string };
      const m = new RegExp(`/auth/${page}/#([^"]+)"`).exec(full.HTML);
      return m ? m[1] : '';
    }
    await sleep(150);
  }
  return '';
}

function device(fetchImpl?: typeof fetch, timeoutMs = 6000) {
  const storage = new MemoryStorage();
  const api = new PrimeApi(new PocketBase(API, new BaseAuthStore()), timeoutMs, fetchImpl);
  return { storage, api };
}

/** 1.8.3: what the game does before it writes an account's cloud save — it takes the account's game session. */
async function claim(api: PrimeApi): Promise<void> {
  const s = new SessionManager({ api, device: 'beta-check', label: 'Beta check' });
  if ((await s.claim()) !== 'active') throw new Error('no game session: ' + s.state);
}

async function main(): Promise<void> {
  if (!binariesReady()) {
    console.log('PocketBase / Mailpit не установлены. Сначала: npm run backend:install');
    proc.exit(1);
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  console.log(`Временная база: ${work}`);
  const SU = { email: 'beta-admin@beta.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  mail = spawnMailpit(PORTS);
  if (!(await waitHealthy(`${MAIL}/livez`))) throw new Error('Mailpit did not start');

  // ====================================================== missing configuration
  section('Режим регистрации задаёт сервер');
  await startPb(undefined);
  const cfg0 = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const r0 = await register('NoConfig', 'noconfig@beta.test');
  check('20 no PRIME_REGISTRATION at all → registration stays closed (config «disabled», register refused)', cfg0.registration === 'disabled' && r0.status === 403 && r0.code === 'registration_closed');
  await stopPb();
  const typos: string[] = [];
  for (const v of ['Public', 'PUBLIC', 'open', 'yes', 'invite-only', '']) {
    await startPb(v);
    typos.push(((await (await fetch(`${API}/api/prime/config`)).json()) as any).registration);
    await stopPb();
  }
  check(`20 a misspelt, capitalised or empty value («Public», «open», «invite-only»…) also means closed (${typos.join(',')})`, typos.every((t) => t === 'disabled'));

  // ========================================================= public (isolated)
  await startPb('public');
  const rPub = await register('PublicOne', 'public1@beta.test');
  check('19 PUBLIC: registration without a code works — only in this isolated temporary database', rPub.code === 'ok');
  await stopPb();

  // =============================================================== invite_only
  section('Приглашения (invite_only)');
  await startPb('invite_only');
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  // the functional scenarios register far faster than any person; the real limits are checked at the end
  const strict = (await admin.settings.getAll()).rateLimits;
  const relax = () => admin.settings.update({ rateLimits: { enabled: true, rules: strict.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  await relax();
  const cfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  check('18 the server tells the game «invite_only» (CLOSED BETA)', cfg.registration === 'invite_only' && cfg.inviteRequired === true && cfg.beta === true);
  const made = invitesCli('create', '6', 'days=14', 'note=beta-check');
  check(`1 the administrator creates invites with the console command (${made.codes.length} codes, printed once)`, made.codes.length === 6 && made.ids.length === 6 && /ОДИН раз/.test(made.out));
  const rows = await admin.collection('invites').getFullList();
  const dbBytes = fs.readFileSync(path.join(dataDir, 'data.db')).toString('latin1');
  const plainInDb = made.codes.some((c) => dbBytes.includes(c.replace(/-/g, '').slice(2)) || dbBytes.includes(c));
  check('1 only a SHA-256 of each code is stored — no code appears anywhere in the database file', rows.length === 6 && rows.every((r) => /^[a-f0-9]{64}$/.test(r.codeHash)) && !plainInDb);
  const many = invitesCli('create', '40', 'days=1');
  const allCodes = [...made.codes, ...many.codes];
  const alphabet = /^[0-9A-HJKMNP-TV-Z]+$/;
  check(
    `security: ${allCodes.length} codes — all different, 26 symbols of a 32-letter alphabet each (130 bits), no shared prefixes`,
    new Set(allCodes).size === allCodes.length && allCodes.every((c) => alphabet.test(c.replace(/^PT-/, '').replace(/-/g, '')) && c.replace(/^PT-/, '').replace(/-/g, '').length === 26) && new Set(allCodes.map((c) => c.slice(3, 8))).size > allCodes.length * 0.9,
  );
  const [cOk, cConc, cFail, cExp, cRev, cLow] = made.codes;
  const noCode = await register('NoCode', 'nocode@beta.test');
  check('3 no code → refused («invite_required»), nothing created', noCode.status === 400 && noCode.code === 'invite_required');
  const bogus = await register('Bogus', 'bogus@beta.test', 'PT-AAAAA-BBBBB-CCCCC-DDDDD-EEEEEE');
  const garbage = await register('Garbage', 'garbage@beta.test', '<script>alert(1)</script>');
  check('4 a wrong code (well-formed or garbage) → «invite_invalid», no detail about any real code', bogus.code === 'invite_invalid' && garbage.code === 'invite_invalid');
  const ok = await register('BetaFriend', 'friend@beta.test', cOk);
  const invOk = (await admin.collection('invites').getFullList({ filter: `id = "${made.ids[0]}"` }))[0];
  const friend = (await admin.collection('users').getFullList({ filter: 'email = "friend@beta.test"' }))[0];
  check('2 registration with a valid code: account + profile created, the invite is used by exactly that account', ok.code === 'ok' && !!friend && invOk.uses === 1 && invOk.usedBy.includes(friend.id) && !!invOk.usedAt);
  const again = await register('SecondTry', 'second@beta.test', cOk);
  check('7 the same one-time code again → «invite_used»', again.code === 'invite_used');
  const low = await register('Lowercase', 'lower@beta.test', cLow.toLowerCase().replace(/-/g, ' '));
  check('the code may be typed in lower case and with spaces instead of dashes (copy-paste friendly)', low.code === 'ok');
  // 8: two people, one code, at the same moment
  const both = await Promise.all([register('RaceOne', 'race1@beta.test', cConc), register('RaceTwo', 'race2@beta.test', cConc)]);
  const raceUsers = await admin.collection('users').getFullList({ filter: 'email = "race1@beta.test" || email = "race2@beta.test"' });
  const invConc = (await admin.collection('invites').getFullList({ filter: `id = "${made.ids[1]}"` }))[0];
  check(`8 two registrations with one code at the same moment: exactly one succeeds (${both.map((b) => b.code).join(' / ')})`, both.filter((b) => b.code === 'ok').length === 1 && both.some((b) => b.code === 'invite_used') && raceUsers.length === 1 && invConc.uses === 1);
  // 13: a failed registration does not burn the code
  const taken = await register('BetaFriend', 'other@beta.test', cFail);
  const takenEmail = await register('FreshNick', 'friend@beta.test', cFail);
  const invFail = (await admin.collection('invites').getFullList({ filter: `id = "${made.ids[2]}"` }))[0];
  const after = await register('FreshNick', 'fresh@beta.test', cFail);
  check('13 a registration that fails (nickname / email taken) leaves the code unused; it still works afterwards', taken.code === 'nickname_taken' && takenEmail.code === 'ok' && invFail.uses === 0 && after.code === 'ok' && (await admin.collection('users').getFullList({ filter: 'email = "friend@beta.test"' })).length === 1);
  // 5: expired
  await admin.collection('invites').update(made.ids[3], { expiresAt: new Date(Date.now() - 60000).toISOString() });
  const exp = await register('Expired', 'expired@beta.test', cExp);
  check('5 an expired code → «invite_expired»', exp.code === 'invite_expired');
  // 6: revoked
  const rev = invitesCli('revoke', made.ids[4]);
  const revUsed = invitesCli('revoke', made.ids[0]);
  const revoked = await register('Revoked', 'revoked@beta.test', cRev);
  check('6 a revoked code is refused (reads like a wrong one); a fully used code cannot be «revoked»', /отозвано/.test(rev.out) && /уже использовано/.test(revUsed.out) && revoked.code === 'invite_invalid');
  const stats = invitesCli('stats').out;
  const list = invitesCli('list', 'all').out;
  check('the administrator sees free / used / expired / revoked invites (stats, list all)', /свободных \d+ · использованных 4 · истёкших 1 · отозванных 1/.test(stats) && /revoked/.test(list) && /expired/.test(list), stats.trim().split('\n').pop());
  const regUsers = await admin.collection('users').getFullList({ filter: 'email ~ "@beta.test"' });
  check('no account was created by any refused attempt', regUsers.length === 5, regUsers.map((u) => u.email).join(','));

  // ====================================================== cannot be bypassed
  section('Обход приглашений через API');
  const anon = new PocketBase(API);
  anon.autoCancellation(false);
  const sAnon = await statusOf(anon.collection('users').create({ email: 'direct@beta.test', password: PW, passwordConfirm: PW }));
  const user = new PocketBase(API, new BaseAuthStore());
  user.autoCancellation(false);
  await user.collection('users').authWithPassword('friend@beta.test', PW);
  const sAuthed = await statusOf(user.collection('users').create({ email: 'direct2@beta.test', password: PW, passwordConfirm: PW }));
  const sBatch = await statusOf(anon.send('/api/batch', { method: 'POST', body: { requests: [{ method: 'POST', url: '/api/collections/users/records', body: { email: 'batch@beta.test', password: PW, passwordConfirm: PW } }] } }));
  const methods = (await anon.collection('users').listAuthMethods()) as any;
  check(`9 the generic API cannot create a player account — anonymous ${sAnon}, signed-in ${sAuthed}, batch ${sBatch}`, sAnon === 403 && sAuthed === 403 && sBatch !== 200);
  check('9 no other door: OAuth2 and one-time codes are off; only email + password sign-in exists', methods.password?.enabled === true && !methods.oauth2?.enabled && !methods.otp?.enabled);
  const sProf = await statusOf(user.collection('profiles').create({ user: friend.id, nickname: 'Fake', nicknameKey: 'fake' }));
  const sProfAnon = await statusOf(anon.collection('profiles').create({ nickname: 'Fake2', nicknameKey: 'fake2' }));
  check(`10 a profile cannot be created without the registration route (${sProf}/${sProfAnon})`, sProf === 403 && sProfAnon === 403);
  const sList = await statusOf(user.collection('invites').getList(1, 10));
  const sListAnon = await statusOf(anon.collection('invites').getList(1, 10));
  const sView = await statusOf(user.collection('invites').getOne(made.ids[5]));
  check(`11 nobody but the server and a superuser can list or open invites (${sList}/${sListAnon}/${sView})`, sList === 403 && sListAnon === 403 && sView === 403);
  const sCreate = await statusOf(user.collection('invites').create({ codeHash: '0'.repeat(64), maxUses: 99, uses: 0 }));
  const sUpd = await statusOf(user.collection('invites').update(made.ids[5], { uses: 0, maxUses: 99 }));
  const sDel = await statusOf(user.collection('invites').delete(made.ids[5]));
  check(`12 an ordinary user cannot create, change or delete invites (${sCreate}/${sUpd}/${sDel})`, [sCreate, sUpd, sDel].every((s) => s === 403));
  const bad = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"nickname": "x", ' });
  const big = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'Big', email: 'big@beta.test', password: PW, passwordConfirm: PW, ...(await registrationExtras(API)), invite: 'x'.repeat(20000) }) });
  check(`broken JSON and an oversized request are refused cleanly (${bad.status}/${big.status}), no server error`, bad.status === 400 && big.status === 413);
  await admin.settings.update({ rateLimits: strict });
  const flood: number[] = [];
  for (let i = 0; i < 8; i++) flood.push((await register('Guess' + i, `guess${i}@beta.test`, `PT-${'A'.repeat(5)}-${String(i).repeat(5)}-AAAAA-AAAAA-AAAAAA`)).status);
  check(`rate limit: guessing codes through registration is cut off with 429 (${flood.join(',')})`, flood.includes(429) && flood.filter((x) => x === 400).length <= 5);
  await relax();

  // ============================================== existing accounts, no invite
  section('Существующие аккаунты');
  const meOld = await user.send('/api/prime/me', { method: 'GET' });
  const oldLogin = new PocketBase(API, new BaseAuthStore());
  await oldLogin.collection('users').authWithPassword('public1@beta.test', PW);
  check('14 accounts made before (even in the public test) sign in without any code', meOld.email === 'friend@beta.test' && oldLogin.authStore.isValid);
  const vtoken = await mailLink('friend@beta.test', 'verify', 1);
  const vpage = await fetch(`${API}/auth/verify/`);
  const vhtml = await vpage.text();
  await anon.collection('users').confirmVerification(vtoken);
  check('15 email confirmation works in the closed beta: the link opens /auth/verify/ (own page, strict CSP) and confirms', vpage.status === 200 && /Content-Security-Policy/.test(vhtml) && (await admin.collection('users').getOne(friend.id)).verified === true);
  await anon.collection('users').requestPasswordReset('friend@beta.test');
  const rtoken = await mailLink('friend@beta.test', 'reset', 2);
  await anon.collection('users').confirmPasswordReset(rtoken, 'NewBeta2027', 'NewBeta2027');
  const relog = new PocketBase(API, new BaseAuthStore());
  await relog.collection('users').authWithPassword('friend@beta.test', 'NewBeta2027');
  check('16 password reset works in the closed beta (own /auth/reset/ page, then sign-in with the new password)', relog.authStore.isValid && (await fetch(`${API}/auth/reset/`)).status === 200);
  await stopPb();

  // =================================================================== disabled
  section('DISABLED');
  await startPb('disabled');
  const dis = await register('Closed', 'closed@beta.test', made.codes[5]);
  const disCfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const disLogin = new PocketBase(API, new BaseAuthStore());
  await disLogin.collection('users').authWithPassword('friend@beta.test', 'NewBeta2027');
  check('17 DISABLED: no new account even with a valid code; the game is told «disabled»; existing accounts still sign in', dis.code === 'registration_closed' && disCfg.registration === 'disabled' && disLogin.authStore.isValid);
  await stopPb();

  // ================================== no email yet (VPS before SMTP): the administrator confirms by hand
  section('Без почты: ручное подтверждение администратором');
  await startPb('invite_only', dataDir, { PRIME_SMTP_HOST: '' });
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const manCfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const manClientCfg = await device().api.config();
  check('a server without SMTP says so: /api/prime/config → mail:false, verification:manual (the game then promises no letter)', manCfg.mail === false && manCfg.verification === 'manual' && manClientCfg.mail === false);
  const mailCount = async () => ((await (await fetch(`${MAIL}/api/v1/messages`)).json()) as { total?: number }).total ?? -1;
  const mailBefore = await mailCount();
  const manCode = invitesCli('create', '1').codes[0];
  const manRaw = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'ManualOne', email: 'manual@beta.test', password: PW, passwordConfirm: PW, ...(await registrationExtras(API)), invite: manCode }) });
  const manReg = (await manRaw.json()) as any;
  const noInvite = await register('ManualTwo', 'manual2@beta.test');
  check('registration needs a valid invite as before; the answer says «manual» and no letter is even attempted', manRaw.status === 200 && manReg.ok === true && manReg.mailSent === false && manReg.verification === 'manual' && noInvite.code === 'invite_required');
  const letter = (p: string, email: string) => fetch(`${API}/api/collections/users/${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }).then(async (r) => `${r.status}:${((await r.json().catch(() => ({}))) as { code?: string }).code ?? ''}`);
  const asks = [await letter('request-verification', 'manual@beta.test'), await letter('request-verification', 'nobody@beta.test'), await letter('request-password-reset', 'manual@beta.test'), await letter('request-password-reset', 'nobody@beta.test')];
  await sleep(800);
  const mailAfter = await mailCount();
  check(`PocketBase's own «send a letter» requests: the same 503 «mail_unavailable» for an existing and an unknown address (${[...new Set(asks)].join(', ')}); Mailpit got nothing (${mailBefore} → ${mailAfter})`, asks.every((a) => a === '503:mail_unavailable') && mailBefore >= 0 && mailAfter === mailBefore);
  const tester = device();
  const meU = await tester.api.login('manual@beta.test', PW);
  const manText = cloudCopyOf(JSON.stringify({ ...save176(), version: 12 }));
  const putU = await statusOf(tester.api.putSave({ base: 0, text: manText.text, hash: manText.hash, op: 'op_manual_1', device: 'x', reason: 'sync' }));
  check(`before the administrator confirms: the tester signs in, the account reads «not verified», the cloud save is refused (${putU})`, meU.verified === false && putU === 403);
  const manUser = (await admin.collection('users').getFullList({ filter: 'email = "manual@beta.test"' }))[0];
  // the same request as the «Verified» switch in the PocketBase dashboard (superuser only)
  await admin.collection('users').update(manUser.id, { verified: true });
  const meV = await tester.api.refresh();
  await claim(tester.api);
  await tester.api.putSave({ base: 0, text: manText.text, hash: manText.hash, op: 'op_manual_2', device: 'x', reason: 'sync' });
  const cloudV = await tester.api.getSave();
  const otherVerify = await statusOf(new PocketBase(API, new BaseAuthStore()).collection('users').update(manUser.id, { verified: false }));
  check(`the administrator switches «Verified» on: «Проверить статус» sees it, the cloud save is accepted; nobody else can change that switch (${otherVerify})`, meV.verified === true && cloudV?.hash === manText.hash && otherVerify >= 400);
  await stopPb();

  // ===================================================== server settings from env
  section('Настройки сервера из окружения');
  await startPb('invite_only', dataDir, { PRIME_TRUSTED_PROXY_HEADER: 'X-Forwarded-For', PRIME_SENDER_ADDRESS: 'no-reply@beta.test' });
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = await admin.settings.getAll();
  check('the server applies its environment at start: proxy IP header (rate limits per visitor behind Caddy), sender, app URL, SMTP', st.trustedProxy.headers.join() === 'X-Forwarded-For' && st.meta.senderAddress === 'no-reply@beta.test' && st.meta.appURL === API && st.smtp.port === PORTS.smtp);

  // ================================================ a flaky internet connection
  section('Плохое соединение и синхронизация');
  // a fresh confirmed account with a cloud save
  const netInv = invitesCli('create', '1').codes[0];
  await register('NetTester', 'net@beta.test', netInv);
  await anon.collection('users').confirmVerification(await mailLink('net@beta.test', 'verify', 1));
  let slow = false;
  let fail503 = false;
  const flaky = (async (input: any, init?: any) => {
    if (slow) await sleep(1500);
    if (fail503 && String(init?.method ?? 'GET').toUpperCase() === 'PUT') {
      fail503 = false;
      return new Response('{"message":"temporarily unavailable"}', { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    return fetch(input, init);
  }) as typeof fetch;
  const d = device(flaky, 900);
  d.storage.setItem(profileKeys('guest').save, JSON.stringify({ ...save176(), version: 12 }));
  const guest = new SaveSystem({ profile: 'guest', storage: d.storage, lock: null });
  const service = new AccountService({ api: d.api, storage: d.storage, current: guest });
  const me = await d.api.login('net@beta.test', PW);
  await claim(d.api);
  const moved = await service.transferGuest(me);
  let save = new SaveSystem({ profile: bootProfile(d.storage), storage: d.storage, lock: null });
  let sync = new SyncManager({ save, api: d.api, storage: d.storage });
  await sync.start();
  check('setup: an invited account carries its career into the cloud', moved && save.profile === userProfile(me.id) && sync.status === 'synced');
  save.data.money += 10;
  save.save();
  slow = true;
  const sSlow = await sync.syncNow();
  slow = false;
  const sSlow2 = await sync.syncNow();
  const cloud1 = await d.api.getSave();
  check(`a reply slower than the timeout: «no connection», then the retry is recognised — one revision, nothing lost (${sSlow} → ${sSlow2})`, sSlow === 'offline' && sSlow2 === 'synced' && cloud1?.hash === cloudCopyOf(save.serialized()).hash && cloud1.revision === 2);
  save.data.money += 5;
  save.save();
  fail503 = true;
  const s503 = await sync.syncNow();
  const s503b = await sync.syncNow();
  check(`a server error (503) is retried later, «synchronised» only after it succeeds (${s503} → ${s503b})`, s503 === 'error' && s503b === 'synced' && (await d.api.getSave())?.revision === 3);
  // the session ends on the server (password changed elsewhere): no data lost, sign in again, upload resumes
  await admin.collection('users').update(me.id, { password: 'Changed2027x', passwordConfirm: 'Changed2027x' });
  save.data.money += 7;
  save.save();
  const sExpired = await sync.syncNow();
  check(`a session ended on the server → «войдите снова», the change stays on the device (${sExpired})`, sExpired === 'signed-out' && sync.hasUnsynced() && save.data.money === 12345 + 22);
  await d.api.login('net@beta.test', 'Changed2027x');
  sync.stop();
  sync = new SyncManager({ save, api: d.api, storage: d.storage });
  const sBack = await sync.start();
  check(`after signing in again the waiting change is uploaded (${sBack})`, sBack === 'synced' && (await d.api.getSave())?.hash === cloudCopyOf(save.serialized()).hash);
  // the backend restarts while a match result is waiting
  save.data.matches += 1;
  save.data.money += 100;
  save.save();
  await stopPb();
  const sDown = await sync.syncNow();
  save = new SaveSystem({ profile: bootProfile(d.storage), storage: d.storage, lock: null });
  const kept = save.data.money === 12345 + 122 && readSync(d.storage, save.profile).pending !== null;
  await startPb('invite_only');
  sync.stop();
  sync = new SyncManager({ save, api: d.api, storage: d.storage });
  const sUp = await sync.start();
  check(`internet gone right after a match, the page reloaded: the result is kept and uploaded after the restart (${sDown} → ${sUp})`, sDown === 'offline' && kept && sUp === 'synced');
  const before = await d.api.getSave();
  const other = device();
  await other.api.login('friend@beta.test', 'NewBeta2027');
  await claim(other.api);
  const otherText = cloudCopyOf(JSON.stringify({ ...save176(), version: 12, money: 1 }));
  await other.api.putSave({ base: 0, text: otherText.text, hash: otherText.hash, op: 'op_other_account_1', device: 'x', reason: 'sync' }).catch(() => null);
  const mine = await d.api.getSave();
  check('another signed-in account writes only into its own save — this account\'s cloud save is untouched', mine?.hash === before?.hash && mine?.revision === before?.revision);

  // a tester asks for their data to be deleted: the administrator deletes the account (dashboard over the SSH tunnel)
  const second = cloudCopyOf(JSON.stringify({ ...save176(), version: 12, money: 2 }));
  await other.api.putSave({ base: 1, text: second.text, hash: second.hash, op: 'op_other_account_2', device: 'x', reason: 'sync' }).catch(() => null);
  const gone = (await admin.collection('users').getFullList({ filter: 'email = "friend@beta.test"' }))[0];
  const owned = async () => ({
    profiles: (await admin.collection('profiles').getFullList({ filter: `user = "${gone.id}"` })).length,
    saves: (await admin.collection('saves').getFullList({ filter: `owner = "${gone.id}"` })).length,
    history: (await admin.collection('save_history').getFullList({ filter: `owner = "${gone.id}"` })).length,
    invites: (await admin.collection('invites').getFullList({ filter: `usedBy ~ "${gone.id}"` })).length,
  });
  const had = await owned();
  await admin.collection('users').delete(gone.id);
  const left = await owned();
  const goneLogin = await statusOf(new PocketBase(API, new BaseAuthStore()).collection('users').authWithPassword('friend@beta.test', 'NewBeta2027'));
  const mineAfter = await d.api.getSave();
  check(`deleting an account on request removes its profile, cloud save and history and its trace in the invite (had ${JSON.stringify(had)}); it cannot sign in; other accounts untouched`, had.profiles === 1 && had.saves === 1 && had.history >= 1 && had.invites === 1 && Object.values(left).every((n) => n === 0) && goneLogin === 400 && mineAfter?.hash === before?.hash);

  // ============================================ backup while running → restore
  section('Резервная копия при работающем сервере и восстановление');
  const printBefore = dbFingerprint(path.join(dataDir, 'data.db'));
  const snapDir = path.join(work, 'snapshot');
  const snap = snapshot(dataDir, snapDir);
  check(`a consistent copy while the server runs (SQLite online backup, integrity-checked): ${snap.counts.users} accounts, ${snap.counts.invites} invites`, snap.files.includes('data.db') && fs.existsSync(path.join(snapDir, 'SHA256SUMS')) && dbFingerprint(path.join(snapDir, 'data.db')) === printBefore);
  await stopPb();
  const restored = path.join(work, 'restored');
  fs.mkdirSync(restored);
  for (const f of ['data.db', 'auxiliary.db']) fs.copyFileSync(path.join(snapDir, f), path.join(restored, f));
  await startPb('invite_only', restored);
  const r1 = device();
  const meR = await r1.api.login('net@beta.test', 'Changed2027x');
  const cloudR = await r1.api.getSave();
  const anonRead = await statusOf(anon.collection('saves').getList(1, 5));
  const anonCount = (await anon.collection('saves').getList(1, 5)).totalItems;
  const invAfter = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const reuse = await register('AfterRestore', 'after@beta.test', cOk);
  check('the restored copy starts: the account signs in with its password, its latest save is there', meR.verified && cloudR?.hash === cloudCopyOf(save.serialized()).hash);
  check(`…access rules survive the restore: anonymous reading sees nothing (${anonRead}, ${anonCount} items), used codes stay used`, anonCount === 0 && reuse.code === 'invite_used' && invAfter.registration === 'invite_only');
  await stopPb();

  // ======================================== the future server's backup script
  section('Скрипт резервного копирования для VPS (на этом Mac)');
  const bk = path.join(work, 'server-backups');
  const script = path.join(ROOT, 'deploy', 'linux', 'backup.sh');
  const run = cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: dataDir, PRIME_BACKUP_DIR: bk, PRIME_BACKUP_KEEP: '2', PRIME_BACKUP_SKIP_SERVICE_CHECK: '1' } });
  cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: dataDir, PRIME_BACKUP_DIR: bk, PRIME_BACKUP_KEEP: '2', PRIME_BACKUP_SKIP_SERVICE_CHECK: '1' } });
  await sleep(1100);
  cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: dataDir, PRIME_BACKUP_DIR: bk, PRIME_BACKUP_KEEP: '2', PRIME_BACKUP_SKIP_SERVICE_CHECK: '1' } });
  const archives = fs.existsSync(bk) ? (fs.readdirSync(bk) as string[]).filter((f) => f.endsWith('.tar.gz')) : [];
  check(`deploy/linux/backup.sh: consistent archive with integrity check and sums, old ones pruned to the limit (${archives.length} kept)`, run.status === 0 && archives.length === 2 && /OK/.test(run.stdout), (run.stdout + run.stderr).slice(-300));
  const into = path.join(work, 'restore-sh');
  const rs = cp.spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'linux', 'restore.sh'), path.join(bk, archives.sort().pop() ?? '')], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: into, PRIME_RESTORE_SKIP_SERVICE: '1', PRIME_RESTORE_YES: '1' } });
  check('deploy/linux/restore.sh unpacks that archive into an empty data folder and checks it', rs.status === 0 && fs.existsSync(path.join(into, 'data.db')) && dbFingerprint(path.join(into, 'data.db')) === dbFingerprint(path.join(dataDir, 'data.db')), (rs.stdout + rs.stderr).slice(-300));
  // the outside copy: encrypted for the developer's key, uploaded only encrypted; local archives stay readable.
  // `age` is not installed on this Mac — a stand-in that marks its output is enough to test the script's logic.
  const fakeBin = path.join(work, 'fake-bin');
  fs.mkdirSync(fakeBin);
  fs.writeFileSync(path.join(fakeBin, 'age'), '#!/bin/sh\n# test stand-in: age -r KEY -o OUT IN\n{ echo "FAKE-AGE $2"; cat "$5"; } > "$4"\n', { mode: 0o755 });
  const outside = path.join(work, 'outside-storage');
  fs.mkdirSync(outside);
  const bkE = path.join(work, 'server-backups-enc');
  const encEnv = { ...proc.env, PATH: `${fakeBin}:${proc.env.PATH}`, PRIME_DATA_DIR: dataDir, PRIME_BACKUP_DIR: bkE, PRIME_BACKUP_KEEP: '2', PRIME_BACKUP_AGE_RECIPIENT: 'age1testrecipient', PRIME_BACKUP_UPLOAD_CMD: `cp "$1" '${outside}/'` };
  const e1 = cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: encEnv });
  await sleep(1100);
  cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: encEnv });
  await sleep(1100);
  cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: encEnv });
  const inBk = fs.readdirSync(bkE) as string[];
  const sent = fs.readdirSync(outside) as string[];
  const sentHead = sent[0] ? String(fs.readFileSync(path.join(outside, sent[0]))).slice(0, 8) : '';
  check(`backup.sh with an age key: readable local archives + encrypted copies, ${inBk.filter((f) => f.endsWith('.tar.gz')).length}+${inBk.filter((f) => f.endsWith('.age')).length} kept; only the encrypted copy is uploaded (${sent.length} sent)`, e1.status === 0 && inBk.filter((f) => f.endsWith('.tar.gz')).length === 2 && inBk.filter((f) => f.endsWith('.tar.gz.age')).length === 2 && sent.length === 3 && sent.every((f) => f.endsWith('.age')) && sentHead === 'FAKE-AGE' && /^OK: \S+\.tar\.gz /.test(e1.stdout), (e1.stdout + e1.stderr).slice(-300));
  const plainUp = cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { ...encEnv, PRIME_BACKUP_AGE_RECIPIENT: '', PRIME_BACKUP_DIR: path.join(work, 'server-backups-plain') } });
  check('…an upload command WITHOUT an age key is refused: nothing leaves the server unencrypted (the local archive is still made)', plainUp.status !== 0 && /незашифрованной/.test(plainUp.stderr) && (fs.readdirSync(path.join(work, 'server-backups-plain')) as string[]).some((f: string) => f.endsWith('.tar.gz')) && (fs.readdirSync(outside) as string[]).length === 3, plainUp.stderr.slice(-200));

  // ============================ moving the base to another server: the encryption key goes with it
  section('Перенос базы на другой сервер (ключ шифрования настроек)');
  const keyA = crypto.randomBytes(16).toString('hex');
  const keyB = crypto.randomBytes(16).toString('hex');
  const enc = ['--encryptionEnv=PB_ENCRYPTION_KEY'];
  const storedSettings = (dir: string) => cp.spawnSync('/usr/bin/sqlite3', [path.join(dir, 'data.db'), "select substr(value,1,1) from _params where id='settings';"], { encoding: 'utf8' }).stdout.trim();
  // «server A»: the restored base under the VPS settings (other API address → settings saved, encrypted)
  await startPb('invite_only', into, { PB_ENCRYPTION_KEY: keyA, PRIME_APP_URL: 'https://api.beta.test' }, enc);
  const onA = await device().api.login('net@beta.test', 'Changed2027x');
  await stopPb();
  check(`server A with PB_ENCRYPTION_KEY: the account signs in, the settings are stored encrypted (not JSON: «${storedSettings(into)}…»)`, onA.verified && storedSettings(into) !== '{' && storedSettings(into) !== '');
  const bkA = path.join(work, 'server-a-backups');
  const runA = cp.spawnSync('/bin/bash', [script], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: into, PRIME_BACKUP_DIR: bkA, PRIME_BACKUP_SKIP_SERVICE_CHECK: '1' } });
  const archA = fs.existsSync(bkA) ? (fs.readdirSync(bkA) as string[]).filter((f) => f.endsWith('.tar.gz'))[0] : '';
  const serverB = path.join(work, 'server-b');
  const rsB = cp.spawnSync('/bin/bash', [path.join(ROOT, 'deploy', 'linux', 'restore.sh'), path.join(bkA, archA ?? '')], { encoding: 'utf8', env: { ...proc.env, PRIME_DATA_DIR: serverB, PRIME_RESTORE_SKIP_SERVICE: '1', PRIME_RESTORE_YES: '1' } });
  // «server B» with the SAME key (the old pocketbase.env carried over): everything works
  await startPb('invite_only', serverB, { PB_ENCRYPTION_KEY: keyA, PRIME_APP_URL: 'https://api.beta.test' }, enc);
  const onB = await device().api.login('net@beta.test', 'Changed2027x');
  const cloudB = await device().api.config();
  await stopPb();
  check('backup.sh on server A → restore.sh on server B with the same key: the account signs in, closed beta still on', runA.status === 0 && rsB.status === 0 && onB.verified && cloudB.registration === 'invite_only', (runA.stderr + rsB.stderr).slice(-300));
  // «server B» with a NEW key (install.sh made a fresh pocketbase.env): PocketBase refuses to start
  const logFrom = pbLog.length;
  let startedWithWrongKey = true;
  try {
    await startPb('invite_only', serverB, { PB_ENCRYPTION_KEY: keyB }, enc);
  } catch {
    startedWithWrongKey = false;
  }
  await stopPb();
  const why = pbLog.slice(logFrom).join('\n');
  check('…with another key the server does not start («message authentication failed»), the data stay untouched — the key must travel with the backups', !startedWithWrongKey && /message authentication failed/.test(why) && dbFingerprint(path.join(serverB, 'data.db')) === dbFingerprint(path.join(into, 'data.db')), why.slice(-200));
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  the check crashed: ' + String((e as Error)?.stack ?? e));
    console.log('--- PocketBase log (last lines) ---\n' + pbLog.slice(-20).join('\n'));
  })
  .finally(async () => {
    await stopChild(pb).catch(() => undefined);
    await stopChild(mail).catch(() => undefined);
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed === 0 ? 'beta: OK' : 'beta: FAILED'} (${passed} passed, ${failed} failed) — временная база удалена`);
    proc.exit(failed === 0 ? 0 : 1);
  });
