// Headless checks for Beta 2.2 «ПРИГЛАСИТЬ ДРУГА» (npm run referral) on a REAL PocketBase in a temporary folder:
//   * the code: one per account, made by the server, stable on every device and after a restart; the format and the
//     lenient spelling a player may type (PT-…, spaces, lower case);
//   * linking: never one's own code, a code that does not exist, a second inviter, two accounts inviting each other —
//     refused; an account registered long ago may link; parallel requests link once (the unique index); guessing codes
//     is stopped after a few tries (per account and per address), a correct code too while the wait lasts;
//   * the 60 minutes: ONLY PRIME LEAGUE fights the server replayed and the player finished himself, after the link, with
//     cards played, no forfeit; 3599 s — not yet, 3600 s — «Приглашение подтверждено», written once; idle / expired /
//     forfeited / void / earlier fights and other players' fights add nothing; a fight counts at most 180 s;
//   * nothing is rewarded in Beta 2.2: no money, no item, no save revision; the notice is neutral;
//   * «Мои данные» lists it, deleting a PRIME ID deletes its code and links; PRIME_REFERRALS=off hides everything.
import PocketBase, { BaseAuthStore } from 'pocketbase';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { LEGACY_CHECK_ENV, ROOT, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
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
const R = req('./referral.js');

function rulesChecks(): void {
  section('Правила (чистый код сервера)');
  check('a code is 8 letters / digits of an alphabet without look-alikes (no I, L, O, 0, 1)', R.ALPHABET === 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' && R.CODE_LEN === 8 && !/[ILO01]/.test(R.ALPHABET));
  check('a typed code is read leniently: «pt-ab2c de7k», «AB2C-DE7K», «PTAB2CDE7K» → AB2CDE7K; anything else is not a code', R.normalizeCode('pt-ab2c de7k') === 'AB2CDE7K' && R.normalizeCode('AB2C-DE7K') === 'AB2CDE7K' && R.normalizeCode('PTAB2CDE7K') === 'AB2CDE7K' && R.normalizeCode('AB2CDE7I') === '' && R.normalizeCode('AB2CDE7') === '' && R.normalizeCode(12345678) === '' && R.normalizeCode('x'.repeat(50)) === '');
  const ok = { id: 'a', status: 'done', how: 'finish', method: 'ko', started: 100, finished: 200, result: { cardsUsed: 3, duration: 75.6 } };
  check('a fight counts its whole replayed seconds (75.6 → 75)', R.fightSeconds(ok, 100) === 75);
  check('a fight the server settled after the player left (expired), a forfeit, a void one, one before the link, one with fewer than 2 cards — 0', R.fightSeconds({ ...ok, how: 'expired' }, 100) === 0 && R.fightSeconds({ ...ok, method: 'forfeit' }, 100) === 0 && R.fightSeconds({ ...ok, result: { ...ok.result, method: 'forfeit' } }, 100) === 0 && R.fightSeconds({ ...ok, status: 'void' }, 100) === 0 && R.fightSeconds(ok, 101) === 0 && R.fightSeconds({ ...ok, result: { cardsUsed: 1, duration: 75 } }, 100) === 0);
  check('a fight never counts more than 180 s; a broken duration counts 0', R.fightSeconds({ ...ok, result: { cardsUsed: 4, duration: 900 } }, 100) === 180 && R.fightSeconds({ ...ok, result: { cardsUsed: 4, duration: 'x' } }, 100) === 0 && R.fightSeconds({ ...ok, result: { cardsUsed: 4, duration: -5 } }, 100) === 0);
  check('the same fight twice counts once (by its id)', R.sumSeconds([ok, ok, { ...ok, id: 'b' }], 100) === 150);
  check('the threshold is 3600 s (60 minutes) and nothing is rewarded (the notice says so neutrally)', R.REQUIRED_SECONDS === 3600 && R.NOTICE === 'Награды за приглашения появятся в будущих обновлениях.');
}

const PORTS = { api: 19690, smtp: 11969, mailUi: 19691 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Invite2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-referral-check-'));
const dataDir = path.join(work, 'pb_data');
let pb: any = null;
const pbLog: string[] = [];

async function startPb(extra: Record<string, string> = {}): Promise<void> {
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_REFERRALS: 'on', ...LEGACY_CHECK_ENV, ...extra } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
}

async function register(nickname: string, email: string): Promise<void> {
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
}

/** One signed-in device of an account (its own token). */
async function device(email: string): Promise<PrimeApi> {
  const a = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 8000);
  await a.login(email, PW);
  return a;
}
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof PrimeApiError ? e.code : 'thrown:' + String(e).slice(0, 80);
  }
};
const raw = async (a: PrimeApi | null, method: string, url: string, body?: unknown) => {
  const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(a ? { Authorization: a.pb.authStore.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
};

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'ref-admin@ref.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  await startPb();
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  check('the migration added the referral rate limit (30 a minute)', st.rules.some((r: any) => r.label === '/api/prime/referral' && r.maxRequests === 30));
  // (the per-IP rate limits are raised for this run: the checks below are many requests from one address)
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const verify = async (email: string) => {
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    await admin.collection('users').update(u.id, { verified: true });
    return u.id as string;
  };

  section('Сервер: доступ');
  const guest = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  check('the server announces «Пригласить друга» (config referrals = 1)', (await guest.config()).referrals === true);
  check('a guest gets nothing: status and claim need a PRIME ID (401)', (await codeOf(guest.referralStatus())) === 'unauthorized' && (await codeOf(guest.referralClaim('AB2CDE7K'))) === 'unauthorized');
  check('nobody reads or writes the referral tables through the generic API', (await codeOf(guest.pb.collection('referral_codes').getList(1, 1))) !== 'ok' && (await codeOf(guest.pb.collection('referral_links').getList(1, 1))) !== 'ok');
  await register('Unconfirmed', 'late@ref.test');
  const late = await device('late@ref.test');
  check('an account with an unconfirmed email cannot open or use it (403 not_verified)', (await codeOf(late.referralStatus())) === 'not_verified' && (await codeOf(late.referralClaim('AB2CDE7K'))) === 'not_verified');

  section('Сервер: код приглашения');
  // an «old» account: registered and playing before linking (its earlier fight must not count)
  await register('OldTimer', 'old@ref.test');
  const oldId = await verify('old@ref.test');
  await register('Inviter', 'host@ref.test');
  const hostId = await verify('host@ref.test');
  await register('Newbie', 'new@ref.test');
  const newId = await verify('new@ref.test');
  const host = await device('host@ref.test');
  const hostTablet = await device('host@ref.test');
  const s1 = await host.referralStatus();
  const s2 = await hostTablet.referralStatus();
  check('the server makes one code per account: 8 characters of its alphabet, the same on the second device', /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/.test(s1.code) && s2.code === s1.code && (await admin.collection('referral_codes').getFullList({ filter: `owner = "${hostId}"` })).length === 1);
  check('the status: nobody invited it yet, 0 invited, the 60 minutes, the source (PRIME LEAGUE), no rewards, the neutral notice', s1.invitedBy === null && s1.invited.total === 0 && s1.required === 3600 && s1.source === 'league' && s1.rewards === false && s1.notice === 'Награды за приглашения появятся в будущих обновлениях.');
  const newbie = await device('new@ref.test');
  const newCode = (await newbie.referralStatus()).code;
  check('another account gets another code', newCode !== s1.code && newCode.length === 8);

  section('Сервер: привязка — ошибки');
  check('not a code at all → code_format (not counted as a guess)', (await codeOf(newbie.referralClaim('hello'))) === 'code_format');
  check('a code nobody has → code_unknown', (await codeOf(newbie.referralClaim('ZZZZ2222'))) === 'code_unknown');
  check('one\'s own code → own_code', (await codeOf(newbie.referralClaim(newCode))) === 'own_code');

  section('Сервер: привязка');
  const linked = await newbie.referralClaim(`pt-${s1.code.slice(0, 4).toLowerCase()} ${s1.code.slice(4)}`);
  check('the friend\'s code (typed «pt-xxxx xxxx») links: the inviter\'s nickname, 0 of 3600 s, not confirmed yet', linked?.nickname === 'Inviter' && linked.seconds === 0 && linked.required === 3600 && !linked.qualified);
  const link = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${newId}"` }))[0];
  check('the link is stored once: invitee, inviter, the code, the server\'s time', !!link && link.inviter === hostId && link.code === s1.code && link.linkedAt > Date.now() - 60000 && link.qualifiedAt === 0);
  const old = await device('old@ref.test');
  const oldCode = (await old.referralStatus()).code;
  check('a second inviter is refused (already_linked) — the same code again too', (await codeOf(newbie.referralClaim(oldCode))) === 'already_linked' && (await codeOf(newbie.referralClaim(s1.code))) === 'already_linked');
  check('two accounts cannot invite each other: the inviter cannot link to its invitee\'s code (mutual)', (await codeOf(host.referralClaim(newCode))) === 'mutual');
  const hs = await host.referralStatus();
  check('the inviter sees 1 invited, 0 confirmed (counts only — no names of the invited)', hs.invited.total === 1 && hs.invited.confirmed === 0 && !('list' in (hs.invited as any)));

  section('Сервер: давно зарегистрированный аккаунт');
  const mkFight = async (uid: string, started: number, o: Partial<{ how: string; method: string; status: string; duration: number; cards: number; mode: string }> = {}) =>
    admin.collection('league_matches').create({
      attacker: uid,
      defKind: 'system',
      mode: o.mode ?? 'duel',
      sim: 'a141348f2a0dea20',
      seed: 1,
      status: o.status ?? 'done',
      ranked: true,
      inputs: [[10, 0], [200, 1]],
      started,
      expires: started + 300000,
      finished: started + 90000,
      outcome: 'win',
      method: o.method ?? 'ko',
      result: { duration: o.duration ?? 75, cardsUsed: o.cards ?? 3, steps: 4500 },
      how: o.how ?? 'finish',
    });
  await mkFight(oldId, Date.now() - 3600000, { duration: 170 }); // played before linking
  await mkFight(oldId, Date.now() - 1800000, { duration: 170 });
  const ol = await old.referralClaim(s1.code);
  check('an account registered long ago links too — and its fights from before the link count nothing (0 s)', ol?.nickname === 'Inviter' && ol.seconds === 0);

  section('Сервер: 60 минут подтверждённой игры');
  const t0 = link.linkedAt + 1000;
  // fights that must NOT count
  await mkFight(newId, link.linkedAt - 5000, { duration: 180 }); // before the link
  await mkFight(newId, t0, { how: 'expired', duration: 75 }); // the player left: the server finished it from held taps
  await mkFight(newId, t0, { method: 'forfeit', duration: 60 });
  await mkFight(newId, t0, { status: 'void', duration: 75 });
  await mkFight(newId, t0, { cards: 1, duration: 75 }); // idle: one card
  await mkFight(newId, t0, { cards: 0, duration: 75 }); // idle: no cards
  await mkFight(hostId, t0, { duration: 75 }); // somebody else's fight
  // 47 × 75 + 74 = 3599 s
  for (let i = 0; i < 47; i++) await mkFight(newId, t0 + i * 100, { duration: 75, mode: i % 5 === 0 ? 'challenge' : 'duel' });
  await mkFight(newId, t0 + 5000, { duration: 74.9 });
  const a3599 = (await newbie.referralStatus()).invitedBy!;
  check('3599 verified seconds: not confirmed yet (the progress says 3599 of 3600)', a3599.seconds === 3599 && !a3599.qualified && a3599.qualifiedAt === 0);
  check('idle, expired, forfeited, void, earlier and other players\' fights added nothing', a3599.seconds === 47 * 75 + 74);
  const parallel = await Promise.all([1, 2, 3].map(() => newbie.referralStatus()));
  check('reading it many times in parallel changes nothing (still 3599, not confirmed)', parallel.every((p) => p.invitedBy?.seconds === 3599 && !p.invitedBy.qualified));
  await mkFight(newId, t0 + 6000, { duration: 1 });
  const a3600 = (await newbie.referralStatus()).invitedBy!;
  check('one more verified second: 3600 → «Приглашение подтверждено» (qualified, the server\'s time)', a3600.seconds === 3600 && a3600.qualified && a3600.qualifiedAt > 0);
  const stored = (await admin.collection('referral_links').getFullList({ filter: `invitee = "${newId}"` }))[0];
  check('the confirmation is written once into the link (qualifiedAt, 3600 s)', stored.qualifiedAt === a3600.qualifiedAt && stored.seconds === 3600);
  const again = await Promise.all([1, 2, 3, 4].map(() => newbie.referralStatus()));
  check('later reads (parallel) never write it again: the same moment', again.every((p) => p.invitedBy?.qualifiedAt === a3600.qualifiedAt));
  const hs2 = await host.referralStatus();
  check('the inviter sees 2 invited, 1 confirmed', hs2.invited.total === 2 && hs2.invited.confirmed === 1);
  const newTablet = await device('new@ref.test');
  check('the invitee\'s second device shows the same: confirmed, the same moment', (await newTablet.referralStatus()).invitedBy?.qualifiedAt === a3600.qualifiedAt);

  section('Сервер: параллельные запросы и перебор кодов');
  await register('Racer', 'race@ref.test');
  const raceId = await verify('race@ref.test');
  const racer = await device('race@ref.test');
  const codes = [s1.code, oldCode, s1.code, oldCode, s1.code, oldCode];
  const res = await Promise.all(codes.map((c) => codeOf(racer.referralClaim(c))));
  const links = await admin.collection('referral_links').getFullList({ filter: `invitee = "${raceId}"` });
  check(`six parallel links of one account (two codes): exactly one stored, the rest already_linked (${res.join(',')})`, links.length === 1 && res.filter((x) => x === 'ok').length === 1 && res.filter((x) => x === 'already_linked').length === 5);
  // Beta 2.2 final: two accounts typing EACH OTHER's code in the same instant — the mutual rule is checked again inside
  // the transaction (PocketBase runs write transactions one at a time), so exactly one of the two links is stored
  const pairs: string[] = [];
  let pairsOk = true;
  for (let i = 0; i < 4; i++) {
    await register(`MutA${i}`, `muta${i}@ref.test`);
    await register(`MutB${i}`, `mutb${i}@ref.test`);
    const aId = await verify(`muta${i}@ref.test`);
    const bId = await verify(`mutb${i}@ref.test`);
    const a = await device(`muta${i}@ref.test`);
    const b = await device(`mutb${i}@ref.test`);
    const [ca, cb] = [(await a.referralStatus()).code, (await b.referralStatus()).code];
    const r = await Promise.all([codeOf(a.referralClaim(cb)), codeOf(b.referralClaim(ca))]);
    const stored = await admin.collection('referral_links').getFullList({ filter: `invitee = "${aId}" || invitee = "${bId}"` });
    pairs.push(r.join('/'));
    if (stored.length !== 1 || r.filter((x) => x === 'ok').length !== 1 || r.filter((x) => x === 'mutual').length !== 1) pairsOk = false;
  }
  check(`two accounts claiming each other's code at the same moment: exactly one link, the other «mutual» (4 pairs: ${pairs.join(' ')})`, pairsOk);
  await register('Guesser', 'guess@ref.test');
  await verify('guess@ref.test');
  const guesser = await device('guess@ref.test');
  const tries: string[] = [];
  for (const c of ['AAAA2222', 'AAAA3333', 'AAAA4444', 'AAAA5555', 'AAAA6666']) tries.push(await codeOf(guesser.referralClaim(c)));
  const sixth = await raw(guesser, 'POST', '/api/prime/referral/claim', { code: 'AAAA7777' });
  const right = await codeOf(guesser.referralClaim(s1.code));
  check('guessing: 5 wrong codes, then too_many_attempts (429, a wait in seconds) — even the right code waits', tries.every((x) => x === 'code_unknown') && sixth.status === 429 && sixth.json.code === 'too_many_attempts' && sixth.json.retryAfter > 0 && right === 'too_many_attempts');

  section('Сервер: перезапуск');
  await stopChild(pb);
  await startPb();
  const after = await device('new@ref.test');
  const ra = await after.referralStatus();
  check('after a restart: the same code, the same invitation, confirmed at the same moment', ra.code === newCode && ra.invitedBy?.qualifiedAt === a3600.qualifiedAt && ra.invitedBy?.nickname === 'Inviter');
  const hostAfter = await device('host@ref.test');
  check('the inviter\'s code survives the restart', (await hostAfter.referralStatus()).code === s1.code);

  section('Сервер: никаких наград в Beta 2.2');
  const sav = await admin.collection('saves').getFullList({ filter: `owner = "${newId}" || owner = "${hostId}"` });
  const ents = await admin.collection('shop_entitlements').getFullList({ filter: `user = "${newId}" || user = "${hostId}"` });
  check('no cloud save written, no item granted for the invitation (inviter or invitee)', sav.length === 0 && ents.length === 0);
  check('the answers promise nothing: rewards false, the notice only', ra.rewards === false && !/скин|₽|руб|\$|валют/i.test(ra.notice));

  section('Сервер: данные аккаунта');
  const ex = await raw(after, 'GET', '/api/prime/account/export');
  check('«Мои данные» lists the code, who invited the account and when it was confirmed', ex.status === 200 && ex.json.referral?.code === newCode && ex.json.referral?.invitedBy?.code === s1.code && !!ex.json.referral?.invitedBy?.confirmedAt);
  const hostBefore = (await hostAfter.referralStatus()).invited.total;
  await admin.collection('users').delete(newId);
  const hostLeft = (await admin.collection('referral_links').getFullList({ filter: `inviter = "${hostId}"` })).length;
  check(`deleting a PRIME ID deletes its code and its link (cascade); the inviter counts one fewer (${hostBefore} → ${hostLeft})`, (await admin.collection('referral_codes').getFullList({ filter: `owner = "${newId}"` })).length === 0 && (await admin.collection('referral_links').getFullList({ filter: `invitee = "${newId}"` })).length === 0 && hostLeft === hostBefore - 1 && (await hostAfter.referralStatus()).invited.total === hostLeft);

  section('Сервер: выключено');
  await stopChild(pb);
  await startPb({ PRIME_REFERRALS: 'off' });
  const g2 = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000);
  const offHost = await device('host@ref.test');
  check('PRIME_REFERRALS=off: config referrals = 0, the routes answer referral_disabled', (await g2.config()).referrals === false && (await codeOf(offHost.referralStatus())) === 'referral_disabled' && (await codeOf(offHost.referralClaim(oldCode))) === 'referral_disabled');
  await stopChild(pb);
  await startPb({ PRIME_REFERRALS: '' });
  check('the default (no PRIME_REFERRALS) is off', (await new PrimeApi(new PocketBase(API, new BaseAuthStore()), 5000).config()).referrals === false);
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
  console.log(`\n${failed ? `referral: FAILED (${passed} passed, ${failed} failed)` : `referral: OK (${passed} passed, 0 failed)`} — временная база удалена`);
  proc.exitCode = failed ? 1 : 0;
}

void main();
