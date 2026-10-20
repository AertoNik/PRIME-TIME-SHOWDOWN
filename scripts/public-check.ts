// Alpha 1.8.4 — `npm run public:test`: PUBLIC REGISTRATION & ACCOUNT SAFETY against a REAL PocketBase
// (the project's migrations and hooks) and a real Mailpit, on spare ports, with brand-new temporary
// databases that are deleted afterwards. The developer's backend/pb_data is never opened; nothing is
// sent anywhere but to this computer. All addresses are made-up (…@public.test).
//
//   upgrade      a 1.8.3.1 database (from the local checkpoint, if there is one) → 1.8.4: accounts, saves
//                and history untouched; the old account signs in, accepts the documents once, plays on
//   public       registration without invites: age / country / documents / challenge checked by the
//                SERVER (a direct request cannot skip them); what is stored; the email; confirmation
//   letters      «send again» with its timer, per-address and daily limits, password reset, token reuse
//   sign-in      too many wrong passwords for one address → refused for a while (same for unknown ones)
//   invite_only  still works before the launch, now with the documents too
//   privacy      nobody reads another account's records; export = own data only
//   deletion     password again; one account goes with everything attached, the others stay; a restored
//                older backup cannot bring it back
//   cleanup      never-confirmed 1.8.4 registrations go after 7 days; older accounts are never touched

import PocketBase, { BaseAuthStore } from 'pocketbase';
import { cloudCopyOf } from '../src/net/cloudSave';
import { PrimeApi, PrimeApiError } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { powWord, solvePow } from '../src/net/pow';
import { sha256 } from '../src/net/sha256';
import { COUNTRY_CODES, ageDecision } from '../src/net/ageRules';
import { LEGAL_DOCS, legalPath } from '../src/net/legal';
import { HOOKS, MIGRATIONS, PB_BIN, ROOT, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnMailpit, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { save176 } from './lib/fixtures';
import { cp, crypto, fs, nodeModule, os, path, proc, sleep } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 18790, smtp: 11725, mailUi: 18725 };
const API = `http://127.0.0.1:${PORTS.api}`;
const MAIL = `http://127.0.0.1:${PORTS.mailUi}`;
const PW = 'PublicPass2026';
/** The current document versions (lib/legal.js), read at the start of the check. */
let V = { terms: 0, consent: 0, privacy: 0 };

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
    if (e instanceof PrimeApiError) return e.status;
    return typeof (e as { status?: number })?.status === 'number' ? (e as { status: number }).status : -1;
  }
}

// --------------------------------------------------------------- processes
let pb: any = null;
let mail: any = null;
const pbLog: string[] = [];
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-public-check-'));
const dataDir = path.join(work, 'pb_data');
const deletionsLog = path.join(work, 'prime-deletions.log');

async function startPb(registration: string, extra: Record<string, string> = {}, dirs: { hooks?: string; migrations?: string } = {}): Promise<void> {
  const env: Record<string, string> = { PRIME_REGISTRATION: registration, PRIME_GAME_URL: 'http://localhost:5173/', PRIME_TRUSTED_PROXY_HEADER: '', PRIME_MAIL_LIMITS: '', PRIME_POW_BITS: '12', ...extra };
  const args: string[] = [];
  if (dirs.hooks) args.push(`--hooksDir=${dirs.hooks}`);
  if (dirs.migrations) args.push(`--migrationsDir=${dirs.migrations}`);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env, args });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 400) pbLog.splice(0, pbLog.length - 400);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-20).join('\n'));
}
async function stopPb(): Promise<void> {
  await stopChild(pb);
  pb = null;
}

function cli(...args: string[]): string {
  const r = cp.spawnSync(PB_BIN, [...args, `--dir=${dataDir}`, `--hooksDir=${HOOKS}`, `--migrationsDir=${MIGRATIONS}`, '--automigrate=false'], {
    encoding: 'utf8',
    env: { ...proc.env, PRIME_SMTP_HOST: '127.0.0.1', PRIME_SMTP_PORT: String(PORTS.smtp), PRIME_APP_URL: API },
  });
  return String(r.stdout) + String(r.stderr);
}

/** One registration request as the game sends it (extras: age, country, documents, solved challenge). */
async function register(nickname: string, email: string, over: Record<string, unknown> = {}, extrasOver: Record<string, unknown> = {}): Promise<{ status: number; code: string; body: any }> {
  const extras = await registrationExtras(API, extrasOver);
  const body = { nickname, email, password: PW, passwordConfirm: PW, ...extras, ...over };
  for (const k of Object.keys(body)) if ((body as any)[k] === undefined) delete (body as any)[k];
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, code: j.ok ? 'ok' : (j.code ?? ''), body: j };
}

async function mails(email: string): Promise<any[]> {
  const j = (await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json()) as { messages?: any[] };
  return j.messages ?? [];
}
async function waitMails(email: string, count: number, ms = 6000): Promise<any[]> {
  const until = Date.now() + ms;
  let list: any[] = [];
  while (Date.now() < until) {
    list = await mails(email);
    if (list.length >= count) return list;
    await sleep(150);
  }
  return list;
}
async function newestHtml(email: string): Promise<string> {
  const list = (await mails(email)).sort((a, b) => String(b.Created).localeCompare(String(a.Created)));
  if (!list.length) return '';
  return ((await (await fetch(`${MAIL}/api/v1/message/${list[0].ID}`)).json()) as { HTML: string }).HTML;
}
const tokenIn = (html: string, page: 'verify' | 'reset') => new RegExp(`/auth/${page}/#([^"]+)"`).exec(html)?.[1] ?? '';

function device(): PrimeApi {
  return new PrimeApi(new PocketBase(API, new BaseAuthStore()), 8000);
}
async function claim(api: PrimeApi): Promise<string> {
  const s = new SessionManager({ api, device: 'public-check', label: 'Public check' });
  return s.claim();
}
async function putSave(api: PrimeApi, money: number, op: string): Promise<number> {
  const c = cloudCopyOf(JSON.stringify({ ...save176(), version: 12, money }));
  const base = (await api.getSave())?.revision ?? 0;
  return statusOf(api.putSave({ base, text: c.text, hash: c.hash, op, device: 'pc', reason: 'sync' }));
}

/** The 1.8.3.1 server code, from the local checkpoint made before 1.8.4 (if there is one). */
function oldServer(): { hooks: string; migrations: string } | null {
  const dir = path.join(ROOT, 'checkpoints');
  if (!fs.existsSync(dir)) return null;
  const tars = (fs.readdirSync(dir) as string[]).filter((f) => /^pre-1\.8\.4-.*\.tar\.gz$/.test(f)).sort();
  if (!tars.length) return null;
  const out = path.join(work, 'old');
  fs.mkdirSync(out);
  const r = cp.spawnSync('tar', ['-xzf', path.join(dir, tars[0]), '-C', out, './backend/pb_hooks', './backend/pb_migrations'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  return { hooks: path.join(out, 'backend', 'pb_hooks'), migrations: path.join(out, 'backend', 'pb_migrations') };
}

async function main(): Promise<void> {
  if (!binariesReady()) {
    console.log('PocketBase / Mailpit не установлены. Сначала: npm run backend:install');
    proc.exit(1);
  }
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi]);
  console.log(`Временная база: ${work}`);
  const SU = { email: 'public-admin@public.test', pw: crypto.randomBytes(18).toString('base64url') };
  mail = spawnMailpit(PORTS);
  if (!(await waitHealthy(`${MAIL}/livez`))) throw new Error('Mailpit did not start');
  proc.env.PRIME_DELETIONS_LOG = deletionsLog;

  // ================================================================== shared rules
  section('Общие правила клиента и сервера');
  const req = nodeModule.createRequire(import.meta.url);
  const AGE = req(path.join(HOOKS, 'lib', 'age_rules.js'));
  const LEGAL = req(path.join(HOOKS, 'lib', 'legal.js'));
  V = { terms: LEGAL.DOCS.terms.version, consent: LEGAL.DOCS.consent.version, privacy: LEGAL.DOCS.privacy.version };
  check(`the game and the server list the same ${AGE.COUNTRIES.length} countries`, JSON.stringify([...COUNTRY_CODES]) === JSON.stringify(AGE.COUNTRIES));
  const cases: [string, number, Record<string, number>, string[]][] = [
    ['RU', 12, {}, []],
    ['RU', 13, {}, []],
    ['US', 15, { US: 13 }, []],
    ['DE', 15, { DE: 16 }, []],
    ['ZZ', 30, {}, []],
    ['FR', 30, {}, ['FR']],
    ['GB', 17, {}, []],
    ['US', 0, {}, []],
    // 1.8.4 simplified form: no country unless the answer depends on it
    ['', 30, {}, []],
    ['', 15, {}, []],
    ['', 15, { US: 13 }, []],
    ['', 30, { US: 13 }, []],
    ['', 30, {}, ['FR']],
    ['', 19, { SG: 21 }, []],
    ['', 12, { US: 13 }, []],
    ['XX', 30, {}, []],
  ];
  const same = cases.every(([c, a, r, cl]) => {
    const s = AGE.decide(c, a, r, cl);
    const g = ageDecision({ min: 13, self: 18, rules: r, closed: cl }, c, a);
    return (s.ok ? 'ok:' + s.band : s.code) === (g.ok ? 'ok:' + g.band : g.code);
  });
  check('the age decision is the same in the game and on the server (under 13 / country age / closed country / adult)', same);
  check('under 13 → no PRIME ID; 13–17 → only where the country age is confirmed (default 18); 18+ → yes', AGE.decide('RU', 12, {}, []).code === 'age_too_young' && AGE.decide('RU', 15, {}, []).code === 'age_guardian_required' && AGE.decide('US', 15, AGE.parseRules('US:13'), []).band === '13-17' && AGE.decide('RU', 18, {}, []).band === '18+');
  check('malformed age rules are ignored (stay at 18): «US:12», «ZZ:13», «XX:16», «DE:sixteen»', JSON.stringify(AGE.parseRules('US:12,ZZ:13,XX:16,DE:sixteen,GB:13')) === '{"GB":13}');
  check(
    'the country is asked only when the answer depends on it: never with default settings; 13–17 once country ages exist; everybody once a country is closed or needs more than 18',
    AGE.decide('', 30, {}, []).band === '18+' &&
      AGE.decide('', 15, {}, []).code === 'age_guardian_required' &&
      AGE.decide('', 15, { US: 13 }, []).code === 'country_required' &&
      AGE.decide('', 30, { US: 13 }, []).band === '18+' &&
      AGE.decide('', 30, {}, ['FR']).code === 'country_required' &&
      AGE.decide('', 19, { SG: 21 }, []).code === 'country_required' &&
      AGE.decide('', 12, { US: 13 }, []).code === 'age_too_young',
  );
  let powSame = true;
  for (let n = 0; n < 3000; n++) if (parseInt(sha256('0123456789abcdef0123456789abcdef:' + n).slice(0, 8), 16) !== powWord('0123456789abcdef0123456789abcdef:', String(n))) powSame = false;
  check('the game\'s fast challenge hash is exactly SHA-256 (3000 numbers)', powSame);
  const pages: string[] = [];
  const drafts: string[] = [];
  for (const d of LEGAL_DOCS) for (const lang of ['ru', 'en'] as const) {
    const file = path.join(ROOT, 'public', legalPath(lang, d));
    const html = fs.existsSync(file) ? (fs.readFileSync(file, 'utf8') as string) : '';
    const v = /<meta name="prime-doc" content="([a-z]+)" data-version="(\d+)"/.exec(html);
    const want = LEGAL.DOCS[d] ? LEGAL.DOCS[d].version : null;
    if (!v || v[1] !== d || (want !== null && Number(v[2]) !== want) || !/primetimeshowdown\.official@gmail\.com/.test(html) || /<script/i.test(html)) pages.push(`${lang}/${d}`);
    // release texts: no draft banner, no placeholder, no note meant for the owner
    if (/doc-draft|class="todo"|TODO|\[(Уточнить|Требует|Confirm|To be confirmed)|Проект документа|Draft for review/.test(html)) drafts.push(`${lang}/${d}`);
    if (!/20 октября 2026|20 October 2026/.test(html)) drafts.push(`${lang}/${d}: date`);
  }
  check(`every legal page exists in RU and EN, names its document, carries the server's version and the contact, no scripts${pages.length ? ' (' + pages.join(', ') + ')' : ''}`, pages.length === 0);
  check(`the legal pages are release texts: dated 20.10.2026, no draft banners or placeholders${drafts.length ? ' (' + drafts.join(', ') + ')' : ''}`, drafts.length === 0);

  // ======================================================= upgrade from 1.8.3.1
  const old = oldServer();
  section('Обновление базы 1.8.3.1 → 1.8.4');
  let oldCounts: Record<string, number> = {};
  if (!old) {
    console.log('SKIP  нет локальной контрольной точки checkpoints/pre-1.8.4-*.tar.gz — обновление со старого кода не проверено');
  } else {
    upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
    await startPb('public', { PRIME_MAIL_LIMITS: 'relaxed' }, old);
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'OldFriend', email: 'old@public.test', password: PW, passwordConfirm: PW }) });
    const admin0 = new PocketBase(API);
    admin0.autoCancellation(false);
    await admin0.collection('_superusers').authWithPassword(SU.email, SU.pw);
    const u = (await admin0.collection('users').getFullList({ filter: 'email = "old@public.test"' }))[0];
    await admin0.collection('users').update(u.id, { verified: true });
    const oldApi = device();
    await oldApi.login('old@public.test', PW);
    await claim(oldApi);
    const p1 = await putSave(oldApi, 1111, 'op_old_save_1');
    const p2 = await putSave(oldApi, 2222, 'op_old_save_2');
    oldCounts = {};
    for (const c of ['users', 'profiles', 'saves', 'save_history']) oldCounts[c] = (await admin0.collection(c).getFullList()).length;
    check(`a 1.8.3.1 server (old code): an account with a cloud save and history (${r.status}, ${p1}/${p2}, ${JSON.stringify(oldCounts)})`, r.status === 200 && p1 === 200 && p2 === 200 && oldCounts.save_history >= 1);
    await stopPb();
  }

  await startPb('public');
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  if (!old) upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const strict = (await admin.settings.getAll()).rateLimits;
  const relax = () => admin.settings.update({ rateLimits: { enabled: true, rules: strict.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  await relax();
  const cols = (await admin.collections.getFullList()).map((c: any) => c.name);
  check('1.8.4 migration: consents, prime_limits, prime_challenges exist', ['consents', 'prime_limits', 'prime_challenges'].every((c) => cols.includes(c)));
  const settings = await admin.settings.getAll();
  check('1.8.4 migration: the request log is kept 7 days; limits for the new routes', settings.logs.maxDays === 7 && ['POST /api/prime/challenge', '/api/prime/verify/', '/api/prime/legal/', '/api/prime/account/'].every((l) => strict.rules.some((r: any) => r.label === l)));
  if (old) {
    const now: Record<string, number> = {};
    for (const c of ['users', 'profiles', 'saves', 'save_history']) now[c] = (await admin.collection(c).getFullList()).length;
    check(`1. the upgrade keeps every account, profile, cloud save and history copy (${JSON.stringify(now)})`, JSON.stringify(now) === JSON.stringify(oldCounts));
    const api = device();
    const me = await api.login('old@public.test', PW);
    const cloud = await api.getSave();
    const cl = await claim(api);
    check(`1. the old account signs in and reads its cloud save; PRIME CLOUD waits for the documents (${me.legalNeeds.join(',')}; claim ${cl})`, me.verified && JSON.parse(cloud?.text ?? '{}').money === 2222 && me.legalNeeds.join() === 'terms,consent,age' && cl !== 'active');
    const put0 = await putSave(api, 3333, 'op_old_before_accept');
    const exp0 = await statusOf(api.exportData());
    check(`1. before accepting: no cloud write (${put0}); export and deletion stay open (${exp0})`, put0 === 403 && exp0 === 200);
    const young = await statusOf(api.acceptLegal({ accept: { terms: V.terms, consent: V.consent }, privacy: V.privacy, lang: 'ru', age: 12, country: 'RU' }));
    const noAge = await statusOf(api.acceptLegal({ accept: { terms: V.terms, consent: V.consent }, privacy: V.privacy, lang: 'ru' }));
    const stale = await statusOf(api.acceptLegal({ accept: { terms: V.terms - 1, consent: V.consent }, privacy: V.privacy, lang: 'ru', age: 30, country: 'RU' }));
    const still = (await api.refresh()).legalNeeds;
    check(`1. the age is checked here too (12 → ${young}, none → ${noAge}); an old document version → ${stale}; nothing written`, young === 403 && noAge === 400 && stale === 409 && still.length === 3);
    const after = await api.acceptLegal({ accept: { terms: V.terms, consent: V.consent }, privacy: V.privacy, lang: 'ru', age: 30, country: 'RU' });
    const twice = await api.acceptLegal({ accept: { terms: V.terms, consent: V.consent }, privacy: V.privacy, lang: 'ru', age: 30, country: 'RU' });
    const cl2 = await claim(api);
    const put1 = await putSave(api, 4444, 'op_old_after_accept');
    const recs = await admin.collection('consents').getFullList({ filter: `user = "${me.id}"` });
    check(`1. accepted once: PRIME CLOUD continues (claim ${cl2}, save ${put1}); records terms/consent/privacy/age, a second tap adds nothing (${recs.length})`, after.length === 0 && twice.length === 0 && cl2 === 'active' && put1 === 200 && recs.length === 4 && recs.every((r: any) => r.action === 'reaccept' || r.action === 'notice' || r.action === 'declared'));
    const ageRec = recs.find((r: any) => r.doc === 'age');
    check('only the country and «18+» are stored — never the age itself', ageRec?.country === 'RU' && ageRec?.ageBand === '18+' && !JSON.stringify(recs).includes('"30"') && !Object.values(ageRec ?? {}).includes(30));
  }

  // ================================================================= public
  section('Публичная регистрация без приглашений');
  const cfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  check('the server says: public, documents with versions, age 13 / 18, a challenge, account tools', cfg.registration === 'public' && cfg.inviteRequired === false && cfg.legal.terms.v === V.terms && cfg.legal.consent.required === true && cfg.legal.privacy.required === false && cfg.age.min === 13 && cfg.age.self === 18 && cfg.pow === 1 && cfg.account === 1);
  const okReg = await register('PublicOne', 'one@public.test');
  check('4. a registration without any code works (isolated temporary database)', okReg.code === 'ok' && okReg.body.mailSent === true && okReg.body.retryAfter === 60);
  const one = (await admin.collection('users').getFullList({ filter: 'email = "one@public.test"' }))[0];
  const oneRecs = await admin.collection('consents').getFullList({ filter: `user = "${one.id}"`, sort: 'doc' });
  check(`the registration wrote its records in the same step: ${oneRecs.map((r: any) => `${r.doc}:${r.version}:${r.action}`).join(' ')}`, oneRecs.map((r: any) => r.doc).join() === 'age,consent,privacy,terms' && oneRecs.every((r: any) => r.action === 'register' || r.doc === 'age') && oneRecs.find((r: any) => r.doc === 'age')?.country === '' && oneRecs.find((r: any) => r.doc === 'age')?.ageBand === '18+');
  const html = await newestHtml('one@public.test');
  check('7. the verification email (Russian + English, privacy links, contact) arrives', /Подтвердить email/.test(html) && /Confirm email/.test(html) && /legal\/ru\/privacy\.html/.test(html) && /legal\/en\/privacy\.html/.test(html) && /primetimeshowdown\.official@gmail\.com/.test(html) && !!tokenIn(html, 'verify'));
  // 5: the server's own checks — direct requests that skip what the page asks
  const bypass: Record<string, string> = {};
  bypass.noAccept = (await register('NoAccept', 'b1@public.test', { accept: undefined })).code;
  bypass.halfAccept = (await register('HalfAccept', 'b2@public.test', { accept: { terms: V.terms } })).code;
  bypass.oldVersion = (await register('OldVersion', 'b3@public.test', { accept: { terms: V.terms - 1, consent: V.consent } })).code;
  bypass.noAge = (await register('NoAge', 'b4@public.test', { age: undefined })).code;
  bypass.textAge = (await register('TextAge', 'b5@public.test', { age: '30' })).code;
  bypass.noCountry = (await register('NoCountry', 'b6@public.test', { country: 'XX' })).code;
  bypass.noPow = (await register('NoPow', 'b7@public.test', { pow: undefined })).code;
  bypass.normal = (await register('NormalOne', 'b8@public.test')).code;
  const ch = (await (await fetch(`${API}/api/prime/challenge`, { method: 'POST' })).json()) as any;
  let wrong = 0;
  while (Math.clz32(powWord(ch.salt + ':', String(wrong))) >= ch.bits) wrong++;
  bypass.wrongNonce = (await register('WrongNonce', 'b9@public.test', { pow: { id: ch.id, nonce: String(wrong) } })).code;
  bypass.honeypot = (await register('Honey', 'b10@public.test', { website: 'http://spam.example' })).code;
  const nobody = (await admin.collection('users').getFullList({ filter: 'email ~ "b%@public.test"' })).length;
  check(
    `5. a direct request cannot skip anything: ${Object.entries(bypass)
      .map(([k, v]) => k + '=' + v)
      .join(' ')}; no account created (${nobody})`,
    bypass.noAccept === 'consent_required' && bypass.halfAccept === 'consent_required' && bypass.oldVersion === 'legal_outdated' && bypass.noAge === 'age_invalid' && bypass.textAge === 'age_invalid' && bypass.noCountry === 'country_invalid' && bypass.noPow === 'challenge_invalid' && bypass.normal === 'ok' && bypass.wrongNonce === 'challenge_invalid' && bypass.honeypot === 'register_failed' && nobody === 1,
  );
  // a challenge works once
  const ch2 = (await (await fetch(`${API}/api/prime/challenge`, { method: 'POST' })).json()) as any;
  const n2 = await solvePow(ch2.salt, ch2.bits);
  const first = await register('OnceOne', 'once1@public.test', { pow: { id: ch2.id, nonce: n2 } });
  const second = await register('OnceTwo', 'once2@public.test', { pow: { id: ch2.id, nonce: n2 } });
  const ch3 = (await (await fetch(`${API}/api/prime/challenge`, { method: 'POST' })).json()) as any;
  await admin.collection('prime_challenges').update(ch3.id, { expiresAt: Date.now() - 1000 });
  const expired = await register('Expired', 'expired@public.test', { pow: { id: ch3.id, nonce: await solvePow(ch3.salt, ch3.bits) } });
  check(`a challenge works exactly once (${first.code} / ${second.code}); an expired one is refused (${expired.code})`, first.code === 'ok' && second.code === 'challenge_invalid' && expired.code === 'challenge_invalid');
  // 6: age on the server
  const ages: Record<string, string> = {};
  ages.u12 = (await register('Twelve', 'age12@public.test', {}, { age: 12, country: 'RU' })).code;
  ages.t15 = (await register('Fifteen', 'age15@public.test', {}, { age: 15, country: 'US' })).code;
  ages.t17 = (await register('Seventeen', 'age17@public.test', {}, { age: 17, country: 'GB' })).code;
  ages.a18 = (await register('Eighteen', 'age18@public.test', {}, { age: 18, country: 'RU' })).code;
  ages.u12none = (await register('TwelveNo', 'age12n@public.test', {}, { age: 12 })).code;
  ages.t15none = (await register('FifteenNo', 'age15n@public.test', {}, { age: 15 })).code;
  ages.a40none = (await register('FortyNo', 'age40n@public.test', {}, { age: 40 })).code;
  check(`6. age rules on the server, default build (no confirmed country ages; the country is not needed): ${JSON.stringify(ages)}`, ages.u12 === 'age_too_young' && ages.t15 === 'age_guardian_required' && ages.t17 === 'age_guardian_required' && ages.a18 === 'ok' && ages.u12none === 'age_too_young' && ages.t15none === 'age_guardian_required' && ages.a40none === 'ok');
  // duplicates and a double tap
  const dupNick = await register('PUBLICONE', 'dup1@public.test');
  const dupMail = await register('Different', 'ONE@public.test');
  const race = await Promise.all([register('RaceA', 'race@public.test'), register('RaceB', 'race@public.test')]);
  const raceUsers = (await admin.collection('users').getFullList({ filter: 'email = "race@public.test"' })).length;
  const raceProfiles = (await admin.collection('profiles').getFullList({ filter: 'nickname = "RaceA" || nickname = "RaceB"' })).length;
  check(`no second profile: nickname (any case) and email stay unique (${dupNick.code}/${dupMail.code}); two taps at once → one account (${race.map((r) => r.code).join('/')})`, dupNick.code === 'nickname_taken' && dupMail.code === 'email_taken' && raceUsers === 1 && raceProfiles === 1);
  // unverified: no cloud
  const oneApi = device();
  await oneApi.login('one@public.test', PW);
  const unv = await statusOf(oneApi.putSave({ base: 0, text: '{}', hash: '0'.repeat(64), op: 'op_unverified', device: 'x', reason: 'sync' }));
  const unvClaim = await claim(oneApi);
  check(`cloud features only after the email is confirmed (save ${unv}, session ${unvClaim})`, unv === 403 && unvClaim !== 'active');

  // ================================================================= letters
  section('Письма: повторная отправка, лимиты, сброс пароля');
  const early = await oneApi.resendMine().catch((e: PrimeApiError) => e);
  check(`8. «send again» right after registering → wait, with the seconds left (${early instanceof PrimeApiError ? early.code + ' ' + String(early.data.retryAfter) : 'sent'})`, early instanceof PrimeApiError && early.code === 'resend_wait' && Number(early.data.retryAfter) > 0 && Number(early.data.retryAfter) <= 60);
  const pbReq = await fetch(`${API}/api/collections/users/request-verification`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'one@public.test' }) });
  const resetReq = await fetch(`${API}/api/collections/users/request-password-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'one@public.test' }) });
  const unknownReq = await fetch(`${API}/api/collections/users/request-password-reset`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@public.test' }) });
  await sleep(700);
  const oneMails = (await mails('one@public.test')).length;
  check(`PocketBase's own «send me a letter» within the minute: the same 204 as for an unknown address (${pbReq.status}/${resetReq.status}/${unknownReq.status}), but no extra letter (${oneMails})`, pbReq.status === 204 && resetReq.status === 204 && unknownReq.status === 204 && oneMails === 1);
  // shorten the minute: the last counter row of that address is moved back in time
  const back = (minutes: number) => cp.spawnSync('sqlite3', [path.join(dataDir, 'data.db'), `UPDATE prime_limits SET created = strftime('%Y-%m-%d %H:%M:%fZ', created, '-${minutes} minutes') WHERE kind = 'mail'`]);
  back(2);
  const again = await oneApi.resendMine();
  const two = await waitMails('one@public.test', 2);
  check(`8. after the minute «send again» sends and says when the next one is allowed (${again.retryAfter} s; letters ${two.length})`, again.retryAfter === 60 && two.length === 2);
  for (let i = 0; i < 6; i++) {
    back(2);
    await oneApi.resendMine().catch(() => null);
  }
  back(2);
  const capped = await oneApi.resendMine().catch((e: PrimeApiError) => e);
  const capCount = (await mails('one@public.test')).length;
  check(`8. at most 6 letters a day to one address (${capCount}); then «try later» (${capped instanceof PrimeApiError ? capped.code : 'sent'})`, capCount === 6 && capped instanceof PrimeApiError && capped.code === 'resend_limit');
  // 7: confirmation, and the link cannot be misused
  const vtoken = tokenIn(await newestHtml('one@public.test'), 'verify');
  await new PocketBase(API).collection('users').confirmVerification(vtoken);
  const reuse = await statusOf(new PocketBase(API).collection('users').confirmVerification(vtoken));
  const broken = await statusOf(new PocketBase(API).collection('users').confirmVerification(vtoken.slice(0, -4) + 'AAAA'));
  const meOne = await oneApi.refresh();
  check(`7. the email link confirms the account (verified ${meOne.verified}); used again it changes nothing (${reuse}); a changed link is refused (${broken})`, meOne.verified && broken === 400 && (reuse === 200 || reuse === 204 || reuse === 400));
  const verified = await oneApi.resendMine();
  check('«send again» for a confirmed account sends nothing', verified.verified === true);
  // 9: password reset (an address with no letter this minute: the upgraded account, or a fresh one)
  const resetMail = old ? 'old@public.test' : 'age18@public.test';
  if (!old) back(2);
  const before = (await mails(resetMail)).length;
  await new PocketBase(API).collection('users').requestPasswordReset(resetMail);
  const resetList = await waitMails(resetMail, before + 1);
  const rtoken = tokenIn(await newestHtml(resetMail), 'reset');
  await new PocketBase(API).collection('users').confirmPasswordReset(rtoken, 'Changed2027', 'Changed2027');
  const reuseReset = await statusOf(new PocketBase(API).collection('users').confirmPasswordReset(rtoken, 'Again20288', 'Again20288'));
  const relog = device();
  await relog.login(resetMail, 'Changed2027');
  const oldPw = await statusOf(device().login(resetMail, PW));
  check(`9. password reset works (letter ${resetList.length > before}, new password signs in); the link works once (${reuseReset}); the old password no longer (${oldPw})`, resetList.length > before && relog.signedIn && reuseReset === 400 && oldPw === 400);
  // global daily cap
  await stopPb();
  await startPb('public', { PRIME_MAIL_DAILY_CAP: '3' });
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const capReg = await register('CapTest', 'cap@public.test');
  check(`the server's daily email cap: the account is still created, the game is told the letter did not go (mailSent ${capReg.body.mailSent})`, capReg.code === 'ok' && capReg.body.mailSent === false);
  await stopPb();
  await startPb('public');
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);

  // ================================================================= sign-in
  section('Вход: перебор паролей');
  const tries: number[] = [];
  for (let i = 0; i < 11; i++) tries.push(await statusOf(device().login('race@public.test', 'WrongPass' + i)));
  const right = await statusOf(device().login('race@public.test', PW));
  const unknown: number[] = [];
  for (let i = 0; i < 11; i++) unknown.push(await statusOf(device().login('ghost@public.test', 'WrongPass' + i)));
  const other = await statusOf(device().login('one@public.test', PW));
  check(`10 wrong passwords for one address → refused for a while, even the right one (${tries.slice(-2).join(',')} → ${right}); an unknown address behaves the same (${unknown.slice(-2).join(',')}); other accounts are not affected (${other})`, tries.slice(0, 10).every((s) => s === 400) && tries[10] === 429 && right === 429 && unknown.slice(0, 10).every((s) => s === 400) && unknown[10] === 429 && other === 200);

  // ================================================================= privacy
  section('Чужие данные');
  const twoReg = await register('PublicTwo', 'two@public.test');
  const twoUser = (await admin.collection('users').getFullList({ filter: 'email = "two@public.test"' }))[0];
  await admin.collection('users').update(twoUser.id, { verified: true });
  const twoApi = device();
  await twoApi.login('two@public.test', PW);
  await claim(twoApi);
  const twoPut = await putSave(twoApi, 777, 'op_two_save_1');
  await putSave(twoApi, 778, 'op_two_save_2');
  const raw = twoApi.pb;
  const reads = [
    await statusOf(raw.collection('consents').getList(1, 50)),
    await statusOf(raw.collection('prime_limits').getList(1, 50)),
    await statusOf(raw.collection('prime_challenges').getList(1, 50)),
    await statusOf(raw.collection('consents').getOne(oneRecs[0].id)),
    await statusOf(raw.collection('consents').create({ user: twoUser.id, doc: 'terms', version: 99, action: 'register' })),
    await statusOf(raw.collection('consents').update(oneRecs[0].id, { version: 0 })),
  ];
  const otherSave = await raw.collection('saves').getList(1, 50);
  const otherUsers = await raw.collection('users').getList(1, 50);
  check(`10. records of consent / limits / challenges: no list, no read, no write — for anyone (${reads.join(',')})`, twoReg.code === 'ok' && twoPut === 200 && reads.every((s) => s === 403 || s === 404));
  check(`10. an account sees only its own save and account (${otherSave.items.length} save, ${otherUsers.items.length} account)`, otherSave.items.every((s: any) => s.owner === twoUser.id) && otherUsers.items.length === 1 && otherUsers.items[0].id === twoUser.id);
  const ex = (await twoApi.exportData()) as any;
  const exText = JSON.stringify(ex);
  check(
    `export: machine-readable JSON of this account only — account, profile, save, history (${ex.saveHistory?.length}), session, documents (${ex.acceptedDocuments?.length})`,
    ex.format === 'prime-id-export' && ex.account.id === twoUser.id && ex.account.email === 'two@public.test' && ex.profile.nickname === 'PublicTwo' && ex.cloudSave.data.money === 778 && ex.saveHistory.length >= 1 && ex.gameSession?.deviceName === 'Public check' && ex.acceptedDocuments.length === 4 && !exText.includes('one@public.test') && !exText.includes('PublicOne') && !/password"\s*:/.test(exText.replace('"notIncluded"', '')),
  );

  // ================================================================= saves
  section('Сохранения: без отката и без переноса поверх прогресса');
  const curTwo = (await twoApi.getSave())!;
  const histTwo = await twoApi.history();
  const restoreTwo = await twoApi.restore(histTwo[0].id, curTwo.revision, 'op_two_restore_1', 'pc').catch((e: PrimeApiError) => e);
  const guestText = cloudCopyOf(JSON.stringify({ ...save176(), version: 12, money: 999999 }));
  const transferTwo = await twoApi.putSave({ base: curTwo.revision, text: guestText.text, hash: guestText.hash, op: 'op_two_transfer_1', device: 'pc', reason: 'transfer' }).catch((e: PrimeApiError) => e);
  const afterTwo = (await twoApi.getSave())!;
  check(
    `a player cannot restore an earlier cloud version (${restoreTwo instanceof PrimeApiError ? restoreTwo.code : 'restored'}) nor «transfer» a guest career over existing cloud progress (${transferTwo instanceof PrimeApiError ? transferTwo.code : 'written'}); the cloud save is unchanged`,
    restoreTwo instanceof PrimeApiError && restoreTwo.code === 'restore_disabled' && transferTwo instanceof PrimeApiError && transferTwo.code === 'conflict' && afterTwo.revision === curTwo.revision && afterTwo.hash === curTwo.hash,
  );

  // ================================================================= deletion
  section('Удаление аккаунта');
  const snapshot = path.join(work, 'before-delete.db');
  cp.spawnSync('sqlite3', [path.join(dataDir, 'data.db'), `.backup '${snapshot}'`]);
  const countAll = async (uid: string) => {
    const out: number[] = [];
    out.push((await admin.collection('users').getFullList({ filter: `id = "${uid}"` })).length);
    out.push((await admin.collection('profiles').getFullList({ filter: `user = "${uid}"` })).length);
    out.push((await admin.collection('saves').getFullList({ filter: `owner = "${uid}"` })).length);
    out.push((await admin.collection('save_history').getFullList({ filter: `owner = "${uid}"` })).length);
    out.push((await admin.collection('game_sessions').getFullList({ filter: `user = "${uid}"` })).length);
    out.push((await admin.collection('consents').getFullList({ filter: `user = "${uid}"` })).length);
    return out;
  };
  const oneId = one.id;
  const oneBefore = await countAll(oneId);
  const twoBefore = await countAll(twoUser.id);
  const noConfirm = await fetch(`${API}/api/prime/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: twoApi.pb.authStore.token }, body: JSON.stringify({ password: PW }) });
  const wrongPw = await statusOf(twoApi.deleteAccount('NotMyPass1'));
  const anon = await fetch(`${API}/api/prime/account/delete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: PW, confirm: 'DELETE' }) });
  check(`deletion needs the explicit confirmation (${noConfirm.status}), the password again (${wrongPw}) and a signed-in account (${anon.status}) — nothing deleted`, noConfirm.status === 400 && wrongPw === 400 && anon.status === 401 && JSON.stringify(await countAll(twoUser.id)) === JSON.stringify(twoBefore));
  const twoToken = twoApi.pb.authStore.token;
  await twoApi.deleteAccount(PW);
  const twoAfter = await countAll(twoUser.id);
  const oneAfter = await countAll(oneId);
  const tokenAfter = await fetch(`${API}/api/prime/me`, { headers: { Authorization: twoToken } });
  const log = fs.existsSync(deletionsLog) ? (fs.readFileSync(deletionsLog, 'utf8') as string) : '';
  check(`11. the account goes with profile, save, history, session and records (${twoBefore} → ${twoAfter}); its sign-in is void (${tokenAfter.status})`, twoAfter.every((n) => n === 0) && tokenAfter.status === 401);
  check(`11. other accounts are untouched (${oneBefore} → ${oneAfter})`, JSON.stringify(oneBefore) === JSON.stringify(oneAfter));
  check('the deleted id (and only the id + time) is noted outside the database', log.includes(twoUser.id) && !log.includes('two@public.test') && /^[a-z0-9]{15}\t\d{4}-/.test(log.trim().split('\n')[0]));
  const reNick = await register('PublicTwo', 'two@public.test');
  check('after deletion the nickname and the address are free again', reNick.code === 'ok');
  // a restore of an older backup brings the account back — the server deletes it again at start
  await stopPb();
  fs.copyFileSync(snapshot, path.join(dataDir, 'data.db'));
  for (const f of ['data.db-wal', 'data.db-shm']) fs.rmSync(path.join(dataDir, f), { force: true });
  await startPb('public');
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const back2 = await countAll(twoUser.id);
  check(`after restoring a backup made before the deletion, the account is deleted again at start (${back2})`, back2.every((n) => n === 0) && pbLog.some((l) => /deleted again/.test(l)));
  check('…and the other accounts of that backup are there', (await countAll(oneId))[0] === 1);

  // ================================================================= cleanup
  section('Очистка неподтверждённых регистраций');
  await relax();
  const fresh = await register('NeverConfirmed', 'never@public.test');
  const freshUser = (await admin.collection('users').getFullList({ filter: 'email = "never@public.test"' }))[0];
  const legacy = await admin.collection('users').create({ email: 'legacy@public.test', password: PW, passwordConfirm: PW, verified: false });
  await admin.collection('profiles').create({ user: legacy.id, nickname: 'LegacyOne', nicknameKey: 'legacyone' });
  cp.spawnSync('sqlite3', [path.join(dataDir, 'data.db'), `UPDATE users SET created = strftime('%Y-%m-%d %H:%M:%fZ', 'now', '-8 days') WHERE id IN ('${freshUser.id}', '${legacy.id}')`]);
  const out = cli('prime-cleanup');
  const left = (await admin.collection('users').getFullList({ filter: `id = "${freshUser.id}" || id = "${legacy.id}" || id = "${oneId}"` })).map((u: any) => u.email).sort();
  check(`cleanup: a 1.8.4 registration never confirmed for 8 days goes; an older unconfirmed account and confirmed ones stay (${left.join(', ')})`, fresh.code === 'ok' && /OK: cleanup done/.test(out) && left.join() === 'legacy@public.test,one@public.test');

  // ================================================================= limits
  section('Лимиты запросов (как на сервере)');
  await admin.settings.update({ rateLimits: strict });
  const flood: number[] = [];
  for (let i = 0; i < 24; i++) flood.push((await fetch(`${API}/api/prime/challenge`, { method: 'POST' })).status);
  check(`challenges: at most 20 a minute per visitor (${flood.filter((s) => s === 429).length} refused of 24)`, flood.filter((s) => s === 200).length <= 20 && flood.slice(20).every((s) => s === 429));
  await relax();
  await stopPb();

  // ============================================================== invite_only
  section('invite_only до запуска');
  await startPb('invite_only');
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  await relax();
  const code = (/PT-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{5}-[0-9A-Z]{6}/.exec(cli('invites', 'create', '1')) ?? [''])[0];
  const noCode = await register('NoCodeYet', 'nocode@public.test');
  const withCode = await register('InvitedOne', 'invited@public.test', { invite: code });
  const invRecs = await admin.collection('consents').getFullList({ filter: `user.email = "invited@public.test"` });
  check(`3. invite_only: no code → ${noCode.code}; with a code → ${withCode.code}, and the documents are recorded as well (${invRecs.length})`, noCode.code === 'invite_required' && withCode.code === 'ok' && invRecs.length === 4);
  await stopPb();
  // public without email stays closed
  await startPb('public', { PRIME_SMTP_HOST: '' });
  const closedCfg = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const closedReg = await register('NoMail', 'nomail@public.test');
  check(`public without email does not open: the game is told «disabled», registration refused (${closedReg.code}), the log says why`, closedCfg.registration === 'disabled' && closedReg.code === 'registration_closed' && pbLog.some((l) => /registration stays CLOSED/.test(l)));
  await stopPb();
  // confirmed country ages, set on the server
  await startPb('public', { PRIME_AGE_RULES: 'US:13,DE:16', PRIME_CLOSED_COUNTRIES: 'FR' });
  const cfgAge = (await (await fetch(`${API}/api/prime/config`)).json()) as any;
  const us15 = await register('UsTeen', 'us15@public.test', {}, { age: 15, country: 'US' });
  const de15 = await register('DeTeen', 'de15@public.test', {}, { age: 15, country: 'DE' });
  const fr30 = await register('FrAdult', 'fr30@public.test', {}, { age: 30, country: 'FR' });
  const teenNone = await register('TeenNone', 'teennone@public.test', {}, { age: 15 });
  const adultNone = await register('AdultNone', 'adultnone@public.test', {}, { age: 30 });
  check(`6. country ages set on the server: US 15 → ${us15.code}, DE 15 → ${de15.code}, closed FR → ${fr30.code}; the game is told (${JSON.stringify(cfgAge.age.rules)})`, us15.code === 'ok' && de15.code === 'age_guardian_required' && fr30.code === 'country_unavailable' && cfgAge.age.rules.US === 13 && cfgAge.age.closed.includes('FR'));
  check(`…and then the country becomes required where it matters: 15 without a country → ${teenNone.code}; with a closed country even an adult is asked → ${adultNone.code}`, teenNone.code === 'country_required' && adultNone.code === 'country_required');
  const teen = (await admin.collection('consents').getFullList({ filter: 'user.email = "us15@public.test" && doc = "age"' }))[0];
  check('a 13–17 account is stored as «13-17» (no exact age)', teen?.ageBand === '13-17');
  await stopPb();
}

main()
  .catch((e) => {
    failed++;
    console.log('FAIL  проверка прервалась: ' + (e instanceof Error ? e.stack : String(e)));
    console.log(pbLog.slice(-25).join('\n'));
  })
  .finally(async () => {
    await stopChild(pb).catch(() => {});
    await stopChild(mail).catch(() => {});
    fs.rmSync(work, { recursive: true, force: true });
    console.log(`\n${failed ? 'ЕСТЬ ОШИБКИ' : 'OK'}: ${passed} проверок прошло, ${failed} не прошло. Временная база удалена.`);
    proc.exit(failed ? 1 : 0);
  });
