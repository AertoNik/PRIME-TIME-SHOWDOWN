// Alpha 1.8.1 — `npm run accounts`: the account layer without a server (seconds, no ports, no
// binaries). The same rules as the server where they are shared (backend/pb_hooks/lib/validate.js
// is loaded as is), the conflict decisions, the account copy of a save, the build switch, and both
// builds (1.8.2: made here in temporary folders): the normal one stays a guest-only game, the beta one
// (`--mode beta`, .env.beta) talks to the closed beta server. The real server: `npm run backend:test`.
// Saves are artificial fixtures in each version's format — not real players' files.

import { NEW_CARDS } from '../src/config/cards';
import { FIGHTER_ORDER } from '../src/config/fighters';
import { VERSION, SaveSystem, defaultSave, profileKeys, sanitize } from '../src/meta/SaveSystem';
import * as rules from '../src/net/accountRules';
import { ACCOUNTS_KEY, bootProfile, emptySyncMeta, readAccounts, readSync, userIdOf, userProfile, writeAccounts, writeSync } from '../src/net/accountStore';
import { canonicalJSON, cloudCopyOf, readCloudText } from '../src/net/cloudSave';
import { DEFAULT_LOCAL_API, accountsSwitch, effectiveFlag, isLoopbackUrl, resolveNetwork } from '../src/net/config';
import { sha256 } from '../src/net/sha256';
import { SessionManager } from '../src/net/SessionManager';
import { decideSync } from '../src/net/SyncManager';
import { CLOUD_SYNCED_MS, cloudPillPlan } from '../src/ui/cloudPill';
import { rulesSource } from './backend';
import { MemoryStorage, olderSave, save176 } from './lib/fixtures';
import { cp, crypto, fs, nodeModule, os, path, proc } from './lib/node';
import { DEV_ORIGINS, ROOT } from './lib/backendKit';

/* eslint-disable @typescript-eslint/no-explicit-any */

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}

const req = nodeModule.createRequire(path.join(ROOT, 'backend', 'pb_hooks', 'lib', 'x.js'));
const V = req('./validate.js');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8') as string;

// ------------------------------------------------------------------ build switch
{
  const off = resolveNetwork({ dev: false, flag: 'local', url: 'http://127.0.0.1:8090', pageHost: 'user.github.io' });
  const prodLocal = resolveNetwork({ dev: false, flag: 'local', url: 'http://127.0.0.1:8090', pageHost: '127.0.0.1' });
  const noFlag = resolveNetwork({ dev: true, url: 'http://127.0.0.1:8090', pageHost: 'localhost' });
  const remote = resolveNetwork({ dev: true, flag: 'local', url: 'https://api.example.com', pageHost: 'localhost' });
  const lan = resolveNetwork({ dev: true, flag: 'local', url: 'http://127.0.0.1:8090', pageHost: '192.168.1.20' });
  const ok = resolveNetwork({ dev: true, flag: 'local', url: 'http://127.0.0.1:8090/', pageHost: 'localhost' });
  check('build switch: a production build (GitHub Pages) never has accounts, even with the flag', off.mode === 'off' && prodLocal.mode === 'off');
  check('build switch: plain dev without the flag has no accounts', noFlag.mode === 'off');
  check('build switch: the local mode refuses a non-local API address and a page opened from another device', remote.mode === 'off' && lan.mode === 'off');
  check('build switch: dev + flag + 127.0.0.1 → local accounts (trailing slash trimmed)', ok.mode === 'local' && ok.apiUrl === 'http://127.0.0.1:8090');
  check('loopback check: 127.0.0.1 / localhost / [::1] only, no credentials in the URL', isLoopbackUrl('http://localhost:8090') && isLoopbackUrl('http://[::1]:8090') && !isLoopbackUrl('http://10.0.0.5:8090') && !isLoopbackUrl('http://u:p@127.0.0.1:8090') && !isLoopbackUrl('ftp://127.0.0.1'));
  const env = read('.env.accounts');
  check('.env.accounts: only the switch and the local address — no passwords, tokens or keys', /VITE_PRIME_ACCOUNTS=local/.test(env) && /VITE_PRIME_API_URL=http:\/\/127\.0\.0\.1:8090/.test(env) && !/(PASS|TOKEN|SECRET|KEY)\s*=/i.test(env.replace(/^#.*$/gm, '')));
  const build = read('src/net/build.ts');
  check('build.ts: local accounts need the dev build (accounts mode or flag); beta / production need their explicit flag', /\(import\.meta\.env\.DEV && \(import\.meta\.env\.MODE === 'accounts' \|\| import\.meta\.env\.VITE_PRIME_ACCOUNTS === 'local'\)\) \|\|\s*import\.meta\.env\.VITE_PRIME_ACCOUNTS === 'beta' \|\|\s*import\.meta\.env\.VITE_PRIME_ACCOUNTS === 'production'/.test(build));
  // 1.8.2: the future cloud server — https only, no default address, any page (GitHub Pages)
  const beta = resolveNetwork({ dev: false, flag: 'beta', url: 'https://api.example.com/', pageHost: 'aertonik.github.io' });
  const betaHttp = resolveNetwork({ dev: false, flag: 'beta', url: 'http://api.example.com', pageHost: 'aertonik.github.io' });
  const betaIp = resolveNetwork({ dev: false, flag: 'production', url: 'http://203.0.113.10:8090', pageHost: 'aertonik.github.io' });
  const betaNoUrl = resolveNetwork({ dev: false, flag: 'beta', url: '', pageHost: 'aertonik.github.io' });
  const betaCreds = resolveNetwork({ dev: false, flag: 'beta', url: 'https://user:pw@api.example.com', pageHost: 'aertonik.github.io' });
  check('beta / production builds: accounts only with an https API address (trailing slash trimmed); http, credentials or no address → guest game', beta.mode === 'remote' && beta.env === 'beta' && beta.apiUrl === 'https://api.example.com' && [betaHttp, betaIp, betaNoUrl, betaCreds].every((c) => c.mode === 'off'));
  check('a published build switches accounts on only with VITE_PRIME_ACCOUNTS=beta|production — never by itself', accountsSwitch({ dev: false, mode: 'production', flag: 'beta' }) && accountsSwitch({ dev: false, mode: 'production', flag: 'production' }) && !accountsSwitch({ dev: false, mode: 'production' }) && !accountsSwitch({ dev: false, mode: 'production', flag: 'Beta' }));
  // the 1.8.1 bug: `npm run dev:accounts` in a folder copied without the hidden .env.accounts
  const noEnvFile = accountsSwitch({ dev: true, mode: 'accounts' }) ? resolveNetwork({ dev: true, flag: effectiveFlag('accounts', undefined), url: DEFAULT_LOCAL_API, pageHost: 'localhost' }) : null;
  check('npm run dev:accounts without .env.accounts (dot-file lost in a copy) still switches accounts on', noEnvFile?.mode === 'local' && noEnvFile.apiUrl === 'http://127.0.0.1:8090');
  check('…while plain npm run dev and every production build stay without accounts', !accountsSwitch({ dev: true, mode: 'development' }) && !accountsSwitch({ dev: false, mode: 'accounts' }) && !accountsSwitch({ dev: false, mode: 'production', flag: 'local' }));
  check('the backend lets the game call it from Vite on 5173 and from the next ports Vite picks when 5173 is busy (5174…5180)', ['http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5174', 'http://localhost:5180'].every((o) => DEV_ORIGINS.includes(o)) && DEV_ORIGINS.every((o) => /^http:\/\/(localhost|127\.0\.0\.1):51\d\d$/.test(o)));
  const prof = read('src/ui/screens/ProfileScreen.ts');
  check('PRIME ID never hides the accounts block silently in a dev build: it explains why accounts are off', /g\.account\?\.panelHTML\(\) \?\? this\.accountsOff\(\)/.test(prof) && /if \(!import\.meta\.env\.DEV\) return null;/.test(build));
  const runtime = read('src/game/AccountRuntime.ts');
  check('the SDK is imported only inside a build-time condition (no SDK file in a build without accounts)', /if \(import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_PRIME_ACCOUNTS === 'beta' \|\| import\.meta\.env\.VITE_PRIME_ACCOUNTS === 'production'\) \{\s*const sdk = await import\('pocketbase'\)/.test(runtime));
  const game = read('src/game/Game.ts');
  check('Game: the account runtime exists only when ACCOUNTS_BUILD and the network config allow it', /ACCOUNTS_BUILD && net && net\.mode !== 'off' \? new AccountRuntime/.test(game) && /const profile = buildBootProfile\(\);/.test(game));
  const src = ['src/net/PrimeApi.ts', 'src/net/SyncManager.ts', 'src/net/AccountService.ts', 'src/game/AccountRuntime.ts', 'src/ui/accountUI.ts'].map(read).join('\n');
  check('client code holds no superuser / admin access and no secrets', !/_superusers|superuser|admin.*password|PB_ADMIN|secret\s*[:=]/i.test(src));
  // 1.8.2: both builds are made here, in temporary folders — the result no longer depends on what the
  // last `npm run build` (or `npm run build -- --mode beta`) left in dist/
  const guest = buildInto('production');
  check(`the normal build (npm run build — what GitHub Pages makes without .env.production): no PocketBase SDK file, no server address, no account requests (${guest.jsCount} js)`, guest.ok && !guest.files.some((f) => f.includes('pocketbase')) && !guest.js.includes('127.0.0.1:8090') && !guest.js.includes('/api/prime/') && !guest.js.includes('primetime-showdown-auth-v1') && /src="\.\/assets\//.test(guest.html), guest.error);
  const betaEnvFile = path.join(ROOT, '.env.beta');
  if (fs.existsSync(betaEnvFile)) {
    const betaEnv = read('.env.beta');
    const keys = betaEnv.split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#')).map((l: string) => l.split('=')[0].trim());
    const betaUrl = /^VITE_PRIME_API_URL=(\S+)$/m.exec(betaEnv)?.[1] ?? '';
    check(`.env.beta: only VITE_PRIME_ACCOUNTS=beta and an https VITE_PRIME_API_URL — public values, no passwords, tokens or keys (${keys.join(', ')})`, /^VITE_PRIME_ACCOUNTS=beta$/m.test(betaEnv) && /^https:\/\/[a-z0-9.-]+$/i.test(betaUrl) && keys.every((k: string) => k === 'VITE_PRIME_ACCOUNTS' || k === 'VITE_PRIME_API_URL'));
    const beta = buildInto('beta');
    check(`the beta build (--mode beta): PocketBase SDK, account requests and ${betaUrl || 'the server address'} are in; no local address, no Mailpit link; base ./ kept`, beta.ok && beta.files.some((f) => f.includes('pocketbase')) && beta.js.includes('/api/prime/') && !!betaUrl && beta.js.includes(betaUrl) && !beta.js.includes('http://127.0.0.1:8090') && !beta.js.includes('http://127.0.0.1:8025') && /src="\.\/assets\//.test(beta.html) && /connect-src 'self' https:/.test(beta.html), beta.error);
  } else console.log('INFO  .env.beta not here — the beta build check is skipped');
}

/** `vite build --mode <mode>` into a temporary folder (deleted afterwards): the bundle text to inspect. */
function buildInto(mode: string): { ok: boolean; files: string[]; js: string; html: string; jsCount: number; error: string } {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `prime-build-${mode}-`));
  try {
    const r = cp.spawnSync(proc.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', mode, '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) return { ok: false, files: [], js: '', html: '', jsCount: 0, error: String(r.stderr || r.stdout).slice(-300) };
    const assets = path.join(out, 'assets');
    const files = fs.readdirSync(assets) as string[];
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    return { ok: true, files, js: jsFiles.map((f) => fs.readFileSync(path.join(assets, f), 'utf8') as string).join('\n'), html: fs.readFileSync(path.join(out, 'index.html'), 'utf8'), jsCount: jsFiles.length, error: '' };
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------- SHA-256
{
  const samples = ['', 'abc', 'PRIME TIME: SHOWDOWN', 'Студия «Полночь» — ЛунныйПродюсер', '🎬📺 emoji', 'x'.repeat(100000)];
  const all = samples.every((s) => sha256(s) === crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  check('SHA-256 (game) = SHA-256 (Node crypto) on ASCII, Cyrillic, emoji and 100 KB text', all);
  check('SHA-256 test vector «abc»', sha256('abc') === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
}

// ---------------------------------------------------------- the account copy
{
  check('canonical JSON: the same data in any key order gives the same text', canonicalJSON({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } }) === canonicalJSON({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }));
  const st = new MemoryStorage();
  st.setItem(profileKeys('guest').save, JSON.stringify(save176()));
  const sys = new SaveSystem({ storage: st, lock: null });
  const copy = cloudCopyOf(sys.serialized());
  check('the account copy leaves the device settings out (sound, music, quality, camera stay on the device)', !('settings' in JSON.parse(copy.text)) && copy.hash === sha256(copy.text));
  // a copy written to a fresh slot (another device) gives the same copy again — no endless re-uploads
  const r = readCloudText(copy.text);
  const st2 = new MemoryStorage();
  const other = new SaveSystem({ profile: userProfile('abcdefghijklmno'), storage: st2, lock: null });
  const applied = r.ok && other.applyExternal(r.data, r.extra, 'cloud');
  check('round trip: cloud copy → another device → its own cloud copy is byte-identical (same hash)', applied && cloudCopyOf(other.serialized()).hash === copy.hash);
  check('…and the other device keeps its own settings', other.data.settings.quality === 'auto' && other.data.settings.sound === true);
  const fixtures: [string, Record<string, any>][] = [['default', JSON.parse(JSON.stringify({ ...defaultSave(), version: VERSION }))], ['1.7.6', save176()]];
  for (let v = 1; v <= 10; v++) fixtures.push([`v${v}`, olderSave(v)]);
  const richer = save176();
  richer.version = 12;
  richer.fighters.rina.unlocked = true;
  for (const id of FIGHTER_ORDER) richer.fighters[id].deck = richer.fighters[id].deck.slice();
  richer.cards.owned = NEW_CARDS.slice();
  richer.fighters.ray.deck = ['dash', NEW_CARDS[0], NEW_CARDS[1], NEW_CARDS[2]];
  fixtures.push(['all cards', richer]);
  const refused: string[] = [];
  const unstable: string[] = [];
  for (const [name, raw] of fixtures) {
    const s = new MemoryStorage();
    s.setItem(profileKeys('guest').save, JSON.stringify(raw));
    const c = cloudCopyOf(new SaveSystem({ storage: s, lock: null }).serialized());
    const res = V.checkSaveText(c.text);
    if (!res.ok) refused.push(`${name}: ${res.problems.join('; ')}`);
    const back = readCloudText(c.text);
    if (!back.ok || cloudCopyOf(JSON.stringify({ ...back.data, version: VERSION })).hash !== c.hash) unstable.push(name);
  }
  check(`the server accepts every save the game can write (default, 1.7.6, schemas 1–10, all shop cards: ${fixtures.length})`, refused.length === 0, refused.join(' | '));
  check('every one of them reads back to the very same copy', unstable.length === 0, unstable.join(', '));
  const newer = readCloudText(JSON.stringify({ ...JSON.parse(copy.text), version: VERSION + 1 }));
  const broken = readCloudText('{"version":12,"money":');
  check('a cloud save of a newer schema is not read (its fields would be lost); a broken one is «damaged»', !newer.ok && newer.reason === 'newer' && !broken.ok && broken.reason === 'damaged');
}

// --------------------------------------------------------- server validation
{
  const base = cloudCopyOf((() => {
    const s = new MemoryStorage();
    s.setItem(profileKeys('guest').save, JSON.stringify(save176()));
    return new SaveSystem({ storage: s, lock: null }).serialized();
  })());
  const tamper = (f: (o: any) => void) => {
    const o = JSON.parse(base.text);
    f(o);
    return V.checkSaveText(canonicalJSON(o));
  };
  const cases: [string, (o: any) => void][] = [
    ['negative money', (o) => (o.money = -1)],
    ['money as text', (o) => (o.money = '999999')],
    ['absurd money', (o) => (o.money = 1e300)],
    ['unknown fighter', (o) => (o.fighters.hacker = { unlocked: true })],
    ['another fighter\'s signature in a deck', (o) => (o.fighters.ray.deck = ['dash', 'power_shot', 'shield', 'knockout'])],
    ['a shop card not bought', (o) => ((o.cards.owned = []), (o.fighters.ray.deck = ['dash', 'power_shot', 'second_take', 'shield']))],
    ['LUCIEN without his purchase', (o) => (o.events = {})],
    ['worn item not owned', (o) => (o.cosmetics.equipped.title = 'title_none')],
    ['selected fighter not signed', (o) => (o.selected = 'rina')],
    ['streak record below the current streak', (o) => (o.streak = { current: 5, best: 2, since: 1 })],
    ['more classic wins than wins', (o) => (o.fighters.ray.classicWins = o.fighters.ray.wins + 1)],
    ['boss wins above attempts', (o) => (o.modes.boss.vale.wins = 99)],
  ];
  const bad = cases.filter(([, f]) => tamper(f).ok).map(([n]) => n);
  check(`the server refuses tampered saves (${cases.length} kinds: types, ranges, ids, decks, purchases, relations)`, bad.length === 0, bad.join(', '));
  check('a schema above the server\'s is «schema_unsupported», not stored', tamper((o) => (o.version = VERSION + 1)).code === 'schema_unsupported');
  check('a few unknown top-level fields are kept (a newer minor), dozens are refused', tamper((o) => (o.laterField = 1)).ok && !tamper((o) => { for (let i = 0; i < 40; i++) o['f' + i] = i; }).ok);
  check('more than 512 KB is refused', V.checkSaveText('x'.repeat(600 * 1024)).code === 'too_large');
}

// ----------------------------------------------- the same form rules both sides
{
  const nicks = ['NightProducer', 'nightproducer', 'ЛунныйПродюсер', 'Ёжик_77', 'ab', 'A23456789012345678', 'Night Producer', ' Night', 'NightРroducer', '<script>', '___', 'admin', 'Админ', 'Prime_Time', 'abc'];
  const emails = ['a@b.co', 'night@prime.test', 'not-an-email', 'a@b', 'x@y.z', '', 'a b@c.de', 'долгий@почта.рф'];
  const pws: [string, string][] = [
    ['Studio2026a', 'Studio2026a'],
    ['short1', 'short1'],
    ['abcdefghij', 'abcdefghij'],
    ['12345678901', '12345678901'],
    ['Studio2026a', 'Studio2026b'],
    ['Пароль2026', 'Пароль2026'],
    ['Я'.repeat(40) + '1', 'Я'.repeat(40) + '1'],
    ['', ''],
  ];
  const diff: string[] = [];
  for (const n of nicks) if (rules.checkNickname(n) !== V.checkNickname(n)) diff.push(`nick ${n}`);
  for (const e of emails) if (rules.checkEmail(e) !== V.checkEmail(e)) diff.push(`email ${e}`);
  for (const [p, c] of pws) if (rules.checkPassword(p, c, 'night@prime.test', 'NightProducer') !== V.checkPassword(p, c, 'night@prime.test', 'NightProducer')) diff.push(`pw ${p.slice(0, 6)}`);
  check(`the form and the server judge nicknames, emails and passwords the same way (${nicks.length + emails.length + pws.length} cases)`, diff.length === 0, diff.join(', '));
  check('nickname keys: case and ё/е do not make a second nickname', rules.nicknameKey('NightProducer') === rules.nicknameKey('NIGHTPRODUCER') && rules.nicknameKey('Ёжик') === rules.nicknameKey('ежик') && V.nicknameKey('Ёжик') === rules.nicknameKey('Ёжик'));
  check('every code the form or the server returns has a Russian text', ['nickname_taken', 'email_taken', 'password_mismatch', 'rate_limited', 'network', 'login_failed', 'nickname_mixed', 'nickname_reserved'].every((c) => rules.accountText(c) !== rules.ACCOUNT_TEXT.server_error));
}

// ------------------------------------------------------------ conflict rules
{
  const m = (revision: number, hash: string) => ({ revision, hash });
  const c = (revision: number, hash: string, schema = VERSION) => ({ revision, hash, schema });
  const cases: [string, ReturnType<typeof decideSync>, ReturnType<typeof decideSync>][] = [
    ['nothing changed anywhere', decideSync(m(3, 'A'), 'A', c(3, 'A')), 'in-sync'],
    ['only this device changed', decideSync(m(3, 'A'), 'B', c(3, 'A')), 'upload'],
    ['only the cloud changed', decideSync(m(3, 'A'), 'A', c(4, 'C')), 'fast-forward'],
    ['both changed', decideSync(m(3, 'A'), 'B', c(4, 'C')), 'conflict'],
    ['both changed to the same thing', decideSync(m(3, 'A'), 'C', c(4, 'C')), 'adopt'],
    ['first upload of an account', decideSync(m(0, ''), 'A', null), 'upload'],
    ['the cloud save disappeared', decideSync(m(5, 'A'), 'A', null), 'missing'],
    ['cloud from a newer game', decideSync(m(3, 'A'), 'A', c(4, 'C', VERSION + 1)), 'newer'],
    ['cloud unreadable', decideSync(m(3, 'A'), 'A', c(4, 'C'), false), 'damaged'],
    ['server behind this device (restored database)', decideSync(m(6, 'A'), 'A', c(4, 'C')), 'conflict'],
    ['cloud text changed without a revision (edited on the server), device unchanged', decideSync(m(3, 'A'), 'A', c(3, 'X')), 'fast-forward'],
    ['…and the device changed too', decideSync(m(3, 'A'), 'B', c(3, 'X')), 'conflict'],
    ['a never-synced slot meets an existing cloud save', decideSync(m(0, ''), 'B', c(2, 'C')), 'conflict'],
  ];
  const wrong = cases.filter(([, got, want]) => got !== want).map(([n, got, want]) => `${n}: ${got}≠${want}`);
  check(`conflict rules: never «last writer wins», never pick by money or level (${cases.length} situations)`, wrong.length === 0, wrong.join(' | '));
}

// ------------------------------------------------------- local account records
{
  const st = new MemoryStorage();
  check('a fresh browser plays the guest career', bootProfile(st) === 'guest' && readAccounts(st).active === 'guest');
  const p = userProfile('abcdefghijklmno');
  writeAccounts(st, { active: p, guestBound: null, names: {} });
  check('an account is played only when its local copy is really here (no empty slot that could be uploaded)', bootProfile(st) === 'guest');
  st.setItem(profileKeys(p).save, JSON.stringify({ ...defaultSave(), version: VERSION }));
  check('…with the copy in place, the page plays the account', bootProfile(st) === p);
  st.setItem(ACCOUNTS_KEY, '{"active":"user:../../evil","guestBound":{"user":"x"},"names":{"bad id":"x"}}');
  const a = readAccounts(st);
  check('damaged account records fall back to the guest (bad ids ignored)', a.active === 'guest' && a.guestBound === null && Object.keys(a.names).length === 0);
  let threw = false;
  try {
    userProfile('../evil');
  } catch {
    threw = true;
  }
  check('account ids are checked before they become storage keys', threw && userIdOf('guest') === null && userIdOf(p) === 'abcdefghijklmno');
  writeSync(st, p, { ...emptySyncMeta(), revision: 4, hash: 'h', pending: { op: 'op_x', hash: 'h2', base: 4 } });
  const m = readSync(st, p);
  check('sync records live beside the save, not inside it', m.revision === 4 && m.pending?.op === 'op_x' && !('revision' in JSON.parse(st.getItem(profileKeys(p).save)!)) && profileKeys(p).sync.endsWith(':sync'));
}

// ------------------------------------------------- SaveSystem hooks used by sync
{
  const st = new MemoryStorage();
  const sys = new SaveSystem({ storage: st, lock: null });
  let notes = 0;
  sys.onSaved = () => notes++;
  sys.data.money = 777;
  sys.save();
  check('every local write tells the sync layer (onSaved) — and is still written synchronously', notes === 1 && JSON.parse(st.getItem(profileKeys('guest').save)!).money === 777);
  sys.suspend();
  sys.data.money = 1;
  sys.save();
  check('a suspended save (profile switch → reload) writes nothing more', JSON.parse(st.getItem(profileKeys('guest').save)!).money === 777 && !sys.writable);
  const st2 = new MemoryStorage();
  const prevRaw = JSON.stringify(save176());
  st2.setItem(profileKeys('guest').save, prevRaw);
  const s2 = new SaveSystem({ storage: st2, lock: null });
  const r = readCloudText(cloudCopyOf(JSON.stringify({ ...defaultSave(), version: VERSION })).text);
  const ok = r.ok && s2.applyExternal(r.data, r.extra, 'cloud');
  // (the copy is not doubled when the newest local copy already holds exactly that text)
  check('a career from the account replaces the local one only after a local safety copy of it; device settings stay', ok && s2.backups().some((b) => b.raw === prevRaw) && s2.data.settings.quality === 'low' && s2.data.money !== 12345);
  check('no schema bump for accounts: the save format stays v12', VERSION === 12 && sanitize({}).version === 12);
}

// ------------------------------------------------------------ closed beta (1.8.2)
{
  const invites = ['PT-7K3QM-ABCDE-FGHJK-MNPQR-STVWXY', 'pt-7k3qm-abcde-fghjk-mnpqr-stvwxy', 'PT 7K3QM ABCDE FGHJK MNPQR STVWXY', '7K3QMABCDEFGHJKMNPQRSTVWXY', 'PT-7K3QM-ABCDE-FGHJK-MNPQR-STVWXO', 'PT-7K3QM-ABCDE-FGHJK-MNPQR-STVWXU', 'PT-7K3QM', '', '<b>x</b>', 'PT-IIIII-LLLLL-OOOOO-00000-111111'];
  const diff = invites.filter((c) => rules.normalizeInvite(c) !== V.normalizeInvite(c));
  check(`invite codes: the form and the server read a pasted code the same way (${invites.length} cases: case, spaces, O→0, I/L→1, U refused)`, diff.length === 0, diff.join(' | '));
  check('a canonical code is 26 symbols of the 32-letter alphabet (130 bits); printed as PT-XXXXX-…', V.formatInvite('7K3QMABCDEFGHJKMNPQRSTVWXY') === 'PT-7K3QM-ABCDE-FGHJK-MNPQR-STVWXY' && V.INVITE_ALPHABET.length === 32 && V.INVITE_LENGTH * 5 >= 128);
  const modes = ['invite_only', 'public', 'disabled', ' invite_only ', 'Public', 'PUBLIC', 'open', 'invite-only', '', undefined, 'yes'].map((m) => V.registrationMode(m));
  check(`registration mode: only the exact words count — anything else is «disabled» (${modes.join(',')})`, modes.join(',') === 'invite_only,public,disabled,invite_only,disabled,disabled,disabled,disabled,disabled,disabled,disabled');
  check('every registration error of the closed beta has its own Russian text', ['invite_required', 'invite_invalid', 'invite_used', 'invite_expired', 'registration_closed', 'network_remote'].every((c) => rules.accountText(c) !== rules.ACCOUNT_TEXT.server_error));
  const invitesJs = read('backend/pb_hooks/lib/invites.js');
  check('codes come from PocketBase\'s crypto-random generator and only their SHA-256 is stored', /\$security\.randomStringWithAlphabet\(V\.INVITE_LENGTH, V\.INVITE_ALPHABET\)/.test(invitesJs) && /r\.set\('codeHash', \$security\.sha256\(V\.inviteHashInput\(code\)\)\)/.test(invitesJs) && !/r\.set\('code'/.test(invitesJs));
  const prime = read('backend/pb_hooks/lib/prime.js');
  check('the invite is checked and used inside the same database transaction as the new account', /runInTransaction\(\(tx\) => \{\s*let invite = null;[\s\S]*inviteProblem\(invite\)[\s\S]*tx\.save\(user\)[\s\S]*tx\.save\(profile\)[\s\S]*invite\.set\('uses', invite\.getInt\('uses'\) \+ 1\)[\s\S]*tx\.save\(invite\)/.test(prime));
  const api = read('src/net/PrimeApi.ts');
  const ui = read('src/ui/accountUI.ts');
  const runtime = read('src/game/AccountRuntime.ts');
  check('no email on the server (or a server too old to say) = no letter promised: mail only when the server answers mail:true; unreadable config → mail:false', /mail: r\.mail === true/.test(api) && /this\.serverConfig = null;/.test(runtime) && /get cloud2\(\): boolean \{\s*return this\.serverConfig \? this\.serverConfig\.sessions : true;/.test(runtime) && /const mailOn = \(g: Game\) => g\.account\?\.serverConfig\?\.mail === true;/.test(ui));
  check('without email: registration → «Аккаунт ожидает проверки», password reset says it is unavailable and sends nothing, no «resend» button', /if \(r\.manual \|\| !mailOn\(g\)\) showPending/.test(ui) && /function openForgot[\s\S]{0,80}if \(!mailOn\(g\)\) \{[\s\S]*?return;\s*\}/.test(ui) && /else showPending\(g, plan\.me\.email\)/.test(ui) && /Аккаунт ожидает проверки/.test(ui));
  check('server without email: config says manual, registration attempts no letter, every outgoing letter is refused, «send a letter» endpoints answer 503', /mail: mailMode\(\) !== 'off'/.test(prime) && /if \(mailMode\(\) === 'off'\) return e\.json\(200, \{ ok: true, mailSent: false, verification: 'manual' \}\);\s*let mailSent/.test(prime) && /if \(m === 'off'\) throw new Error/.test(prime) && /request-\(verification\|password-reset\|email-change\)/.test(read('backend/pb_hooks/prime.pb.js')));
  const mig = read('backend/pb_migrations/1792400000_prime_closed_beta.js');
  check('migration 1.8.2: the invites collection has no API rule at all (server and superuser only); purely additive', (mig.match(/Rule: null/g) ?? []).length === 5 && !/app\.delete\(|truncate|DROP/i.test(mig.split('(app) => {\n    try')[0]));
}

// ------------------------------------------------------------ PRIME CLOUD 2.0 (1.8.3)
{
  const game = read('src/game/Game.ts');
  const starts = ['startMatch(): void {', 'startSurvival(): void {', 'startSurvivalWave(): void {', 'startChallenge(id: string, difficulty: Difficulty): void {', 'startBoss(id: string): void {'];
  check('every way into a match (Classic, Survival and each of its waves, Challenge, Boss) first asks the account gate', starts.every((sig) => new RegExp(sig.replace(/[()[\]{}.*+?^$|\\]/g, '\\$&') + '\\s*if \\(this\\.accountHolds\\(\\(\\) => this\\.' + sig.split('(')[0] + '\\(').test(game)));
  check('a match that ends after the page lost the game session pays nothing (checked before any career / event / mode result)', /if \(mode\.kind === 'tutorial'\) return;\s*(\/\/[^\n]*\n\s*)*if \(this\.account\?\.rewardsBlocked\(\)\) \{/.test(game) && game.indexOf('rewardsBlocked()') < game.indexOf('this.career.applyMatch(m.result'));
  check('only an account tab the player looks at takes the profile from another tab; the guest keeps the 1.8 rule', /takeOverLock: profile !== 'guest' && visible/.test(game));
  const sm = read('src/net/SessionManager.ts');
  const doBeat = sm.slice(sm.indexOf('private async doBeat'), sm.indexOf('markSuperseded('));
  check('the heartbeat never claims (no background tab can take the session back); the key is 128 random bits kept only in memory', !/claimSession|claim\(/.test(doBeat) && /crypto\.getRandomValues\(bytes\)/.test(sm) && /new Uint8Array\(16\)/.test(sm) && !/\b(localStorage|sessionStorage)\.|\.setItem\(/.test(sm));
  const rtm = read('src/game/AccountRuntime.ts');
  check('the account claims only when the game is opened (in front), on «Повторить» after a failed claim, or before a first upload the player asked for — never from a timer', (rtm.match(/session\.claim\(\)|s\.claim\(\)/g) ?? []).length === 3 && /if \(document\.visibilityState === 'visible'\) void this\.activate\(\);/.test(rtm) && /\} else if \(!this\.activated\) \{/.test(rtm) && !/setInterval/.test(rtm));
  check('a match cannot start before the account\'s progress is loaded and compared with PRIME CLOUD; unknown server = sessions assumed (no false freedom offline)', /if \(!this\.ready\) return s\.state === 'unconfirmed' \? 'offline' : 'loading';/.test(rtm) && /return this\.serverConfig \? this\.serverConfig\.sessions : true;/.test(rtm));
  const api = read('src/net/PrimeApi.ts');
  check('every cloud write (save, archive, restore) carries the page\'s game session', (api.match(/\.\.\.this\.sessionBody\(\)/g) ?? []).length === 3);
  const sync = read('src/net/SyncManager.ts');
  check('uploads only from the page holding the session; a refused write stops uploads; «Синхронизировано» only from the server', /if \(this\.o\.session && !this\.o\.session\.canWrite\) return this\.status;/.test(sync) && /case 'superseded':[\s\S]{0,300}this\.stop\(\);/.test(sync));
  const prime = read('backend/pb_hooks/lib/prime.js');
  check('server: save, archive and restore check the active session INSIDE their write transaction (after the repeat check, before any write)', (prime.match(/const lost = sessionProblem\(tx, uid, b\);/g) ?? []).length === 3 && /const done = applied\(tx, uid, cur, op\);[\s\S]{0,400}const lost = sessionProblem\(tx, uid, b\);/.test(prime));
  check('server: a claim raises the generation in a transaction; an old game without a session gets 426 (stops), a lost page 409', /runInTransaction[\s\S]{0,1600}const generation = rec\.getInt\('generation'\) \+ 1;/.test(prime) && /\[426, \{ code: 'session_required' \}\]/.test(prime) && /\[409, supersededBody\(rec\)\]/.test(prime));
  const mig = read('backend/pb_migrations/1792500000_prime_sessions.js');
  check('migration 1.8.3: game_sessions has no API rule at all, one record per account (unique index); purely additive', (mig.match(/Rule: null/g) ?? []).length === 5 && /CREATE UNIQUE INDEX `idx_game_sessions_user`/.test(mig) && !/app\.delete\(|truncate|DROP/i.test(mig.split('(app) => {\n    try')[0]));
}

// ------------------------------------------------------------ PRIME CLOUD POLISH (1.8.3.1)
{
  // the menu line: shows work and problems, «синхронизировано» only for a moment, problems never time out
  const plans = [cloudPillPlan(null, 'synced'), cloudPillPlan('saving', 'synced'), cloudPillPlan('loading', 'synced'), cloudPillPlan('synced', 'synced'), cloudPillPlan('synced', 'waiting'), cloudPillPlan('synced', 'saving'), cloudPillPlan('saving', 'offline'), cloudPillPlan('offline', 'superseded'), cloudPillPlan('synced', 'signin'), cloudPillPlan('synced', 'issue')];
  check(`PRIME CLOUD line: loaded / saved → «синхронизировано» for ${CLOUD_SYNCED_MS} ms; nothing new → hidden; saving, no connection, another device, sign-in, a decision → shown until it changes (${plans.join(',')})`, plans.join(',') === 'flash,flash,flash,hide,keep,show,show,show,show,show' && CLOUD_SYNCED_MS >= 2000 && CLOUD_SYNCED_MS <= 3000);
  const menu = read('src/ui/screens/MenuScreen.ts');
  check('…only the «синхронизировано» moment is ever hidden by a timer; the line keeps its place (fades, nothing in the menu moves)', (menu.match(/setTimeout\(/g) ?? []).length === 1 && /if \(el && this\.cloudKind === 'synced'\) this\.setCloud\(el, null, false\);/.test(menu) && /\.cloud-pill\.on \{\s*opacity: 1;\s*visibility: visible;/.test(read('src/styles/main.css')));
  // the session: quick while the player uses the page, slow when it only stays open, a check on touch
  let t = 1_000_000;
  const sm = new SessionManager({ api: {} as any, device: 'd', label: 'l', clock: () => t, heartbeatMs: 20000 });
  const quick = sm.nextDelay();
  t += 120_000;
  const idle = sm.nextDelay();
  sm.noteActivity();
  const back = sm.nextDelay();
  (sm as any).backoffUntil = t + 30_000;
  const slowed = sm.nextDelay();
  check(`session heartbeat: ${quick} ms while the player uses the page, ${idle} ms when it only stays open, ${back} ms again on a touch, ${slowed} ms after «too many requests»`, quick === 4000 && idle === 20000 && back === 4000 && slowed === 20000);
  const rtm = read('src/game/AccountRuntime.ts');
  check('a quick check (never a claim) on coming back, focus, a touch, a page from the browser cache — and before every match when the last confirmation is over 1 s old', /window\.addEventListener\('focus', nudge\)/.test(rtm) && /'pointerdown', nudge/.test(rtm) && /\.persisted && this\.activated && !document\.hidden\) this\.session\?\.resume\(\)/.test(rtm) && /const FRESH_MS = 1000;/.test(rtm) && /s\.check\(FRESH_MS\)/.test(rtm) && !/noteActivity[\s\S]{0,400}claim\(/.test(read('src/net/SessionManager.ts')));
  // one current progress: no picking old versions from the game
  const ui = read('src/ui/accountUI.ts');
  const care = read('src/ui/saveCare.ts');
  const accTools = care.slice(care.indexOf('function openAccountSaveTools'), care.indexOf('/** Choose a file'));
  const accDamaged = care.slice(care.indexOf('function showAccountDamaged'), care.indexOf('function showNewer'));
  check('no «Облачные копии» window and no restore of an old version for a PRIME ID career (local copies: download only; a damaged copy is loaded again from PRIME CLOUD)', !/Облачные копии/.test(ui) && !/openCloudHistory|\.restore\(h\)/.test(ui) && /if \(s\.profile !== 'guest'\) return openAccountSaveTools\(g, back\);/.test(care) && !/data-restore|data-a="import"/.test(accTools) && /reloadFromCloud\(\)/.test(accDamaged) && !/data-restore|data-a="fresh"/.test(accDamaged));
  check('…while the server keeps its history and the restore route for an emergency (nothing deleted)', /function restoreSave\(e\)/.test(read('backend/pb_hooks/lib/prime.js')) && /HISTORY_MAX = 10/.test(read('backend/pb_hooks/lib/prime.js')) && /async restore\(/.test(read('src/net/PrimeApi.ts')));
  const taken = ui.slice(ui.indexOf('export function showSessionTaken'), ui.indexOf('export function showKeptDevice'));
  check('«PRIME ID ОТКРЫТ НА ДРУГОМ УСТРОЙСТВЕ»: one short sentence and two buttons — no device names or technical details', /Вы продолжили игру в другой вкладке или на другом устройстве\./.test(taken) && !/holder|Облачн|session|сесси/i.test(taken.replace(/showSessionTaken/g, '')) && (taken.match(/<button /g) ?? []).length === 2);
}

// --------------------------------------------- browser security and deployment kit (1.8.2)
{
  const html = read('index.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const scriptSrc = /script-src ([^;]+)/.exec(csp)?.[1] ?? '';
  check('index.html has a Content Security Policy: scripts only from the game (no inline, no eval), no plugins, no foreign forms', scriptSrc.trim() === "'self'" && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp) && /form-action 'none'/.test(csp) && /connect-src 'self' https:/.test(csp));
  for (const page of ['backend/pb_public/auth/verify/index.html', 'backend/pb_public/auth/reset/index.html']) {
    const h = read(page);
    check(`${page.split('/').slice(-2).join('/')}: strict CSP (default-src 'none', script-src 'self'), no inline script`, /default-src 'none'; script-src 'self'/.test(h) && !/<script>[^<]/.test(h) && /<script src="\.\.\/auth\.js"><\/script>/.test(h));
  }
  const versions = JSON.parse(read('backend/versions.json'));
  const install = read('deploy/linux/install.sh');
  check('install.sh downloads exactly the pinned PocketBase for Linux (version and SHA-256 equal to backend/versions.json)', install.includes(`PB_VERSION="${versions.pocketbase.version}"`) && install.includes(versions.pocketbase.files['linux-x64'].sha256) && install.includes(versions.pocketbase.files['linux-arm64'].sha256) && /sha256sum -c/.test(install));
  const unit = read('deploy/linux/pocketbase.service');
  check('systemd: PocketBase as the unprivileged «pocketbase» user, only on 127.0.0.1, writes only its data folder, restarts by itself, settings encrypted', /User=pocketbase/.test(unit) && /--http=127\.0\.0\.1:8090/.test(unit) && /ReadWritePaths=\/var\/lib\/primetime/.test(unit) && /Restart=on-failure/.test(unit) && /NoNewPrivileges=true/.test(unit) && /--encryptionEnv=PB_ENCRYPTION_KEY/.test(unit) && /--hooksWatch=false/.test(unit) && /--automigrate=false/.test(unit) && /WantedBy=multi-user\.target/.test(unit));
  const caddy = read('deploy/linux/Caddyfile');
  check('Caddy: HTTPS reverse proxy to 127.0.0.1:8090; the dashboard and superuser endpoints answer 404 from the internet; body limit', /reverse_proxy 127\.0\.0\.1:8090/.test(caddy) && /@admin path \/_ \/_\/\* \/api\/collections\/_superusers\/\*/.test(caddy) && /respond @admin 404/.test(caddy) && /max_size 1MB/.test(caddy) && /Strict-Transport-Security/.test(caddy));
  const envEx = read('deploy/linux/pocketbase.env.example');
  check('server env template: closed beta by default, empty secrets, no real addresses', /^PRIME_REGISTRATION=invite_only$/m.test(envEx) && /^PB_ENCRYPTION_KEY=$/m.test(envEx) && /^PRIME_SMTP_PASSWORD=$/m.test(envEx) && /^PRIME_MAIL_MODE=$/m.test(envEx) && /^PRIME_ORIGINS=https:\/\/primetimeshowdown\.online,https:\/\/aertonik\.github\.io$/m.test(envEx) && !/^PRIME_ORIGINS=.*(\*|http:\/\/| )/m.test(envEx));
  const testers = ['scripts/backend-check.ts', 'scripts/closed-beta-check.ts'].map(read);
  check('the server checks never use 18090 (the documented SSH tunnel to the real server) and refuse to start when their ports are taken — their requests can never reach the real server', testers.every((t) => /await ensurePortsFree\(\[PORTS\.api, PORTS\.smtp, PORTS\.mailUi\]\)/.test(t) && /ownServerStarted\(pb, pbLog\)/.test(t) && !/api: 18090/.test(t)) && /ssh -N -L 18090:127\.0\.0\.1:8090/.test(read('docs/PRIME_CLOUD_DEPLOY.md')));
  const invSh = read('deploy/linux/invites.sh');
  check('invites.sh reads the server settings line by line like systemd (never runs them as shell code) and opens the base like the service', !/(^|[;&|]\s*)(\.|source)\s+\/etc\/primetime/m.test(invSh) && /done < "\$ENV_FILE"/.test(invSh) && /runuser -u pocketbase --/.test(invSh) && /--encryptionEnv=PB_ENCRYPTION_KEY/.test(invSh) && /--automigrate=false/.test(invSh) && /^PRIME_SENDER_NAME="[^"]+"$/m.test(envEx));
  const clientEx = read('.env.example');
  check('.env.example (game): only public settings, empty values, warns that VITE_* is public', /^VITE_PRIME_ACCOUNTS=$/m.test(clientEx) && /^VITE_PRIME_API_URL=$/m.test(clientEx) && /never a password/.test(clientEx) && !/(PASSWORD|TOKEN|SECRET|KEY)=\S/.test(clientEx));
  const backupSh = read('deploy/linux/backup.sh');
  const timer = read('deploy/linux/prime-backup.timer');
  const bsvc = read('deploy/linux/prime-backup.service');
  check('server backups: SQLite online backup + integrity check + sums, limited count, optional age encryption and outside upload, daily timer as the pocketbase user', /\.backup '/.test(backupSh) && /PRAGMA integrity_check/.test(backupSh) && /SHA256SUMS/.test(backupSh) && /PRIME_BACKUP_KEEP/.test(backupSh) && /age -r/.test(backupSh) && /PRIME_BACKUP_UPLOAD_CMD/.test(backupSh) && /OnCalendar=/.test(timer) && /User=pocketbase/.test(bsvc));
  const gi = read('.gitignore');
  check('.gitignore keeps the private database copies and real server env files out of git', gi.includes('backups-private/') && gi.includes('deploy/**/*.env') && fs.existsSync(path.join(ROOT, 'backups-private', '.gitignore')) ? read('backups-private/.gitignore').trim() === '*' : gi.includes('backups-private/'));
}

// ------------------------------------------------------- server rules in step
{
  const file = read('backend/pb_hooks/lib/save_rules.js');
  check('backend/pb_hooks/lib/save_rules.js matches the game config (else: npm run backend:rules)', file === rulesSource());
  const mig = read('backend/pb_migrations/1792330000_prime_accounts.js');
  check('migration: no generic writes to users / profiles / saves / save_history; owner-only reads', (mig.match(/createRule: null/g) ?? []).length >= 3 && /users\.createRule = null/.test(mig) && /users\.updateRule = null/.test(mig) && (mig.match(/owner = @request\.auth\.id/g) ?? []).length >= 4);
  check('migration: SMTP points at this computer only; the hook refuses any other host', /env\('PRIME_SMTP_HOST', '127\.0\.0\.1'\)/.test(mig) && /host !== '127\.0\.0\.1'/.test(read('backend/pb_hooks/lib/prime.js')));
  const gi = read('.gitignore');
  check('.gitignore keeps binaries, databases, test data, backups and local env files out of git', ['backend/bin/', 'backend/pb_data/', 'backend/backups/', 'backend/test-data/', '.env.*.local'].every((x) => gi.includes(x)));
}

console.log(`\n${failed === 0 ? 'accounts: OK' : 'accounts: FAILED'} (${passed} checks${failed ? `, ${failed} failed` : ''})`);
proc.exit(failed === 0 ? 0 : 1);
