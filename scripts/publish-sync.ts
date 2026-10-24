// Alpha 1.8.2 — move the project into the publish folder (the clone of the GitHub Pages repository)
// safely, instead of copying folders by hand in Finder.
//
//   npm run publish:sync -- "/Users/…/PRIME TIME SHOWDOWN"            dry run: shows what WOULD change
//   npm run publish:sync -- "/Users/…/PRIME TIME SHOWDOWN" --apply    copies, then checks git status
//
// What it does:
//   • copies ONLY the project's source files (a fixed list below) — never the database, backups,
//     programs, node_modules, dist, server bundles or any real env file; never deletes anything;
//   • copies the hidden files Finder silently skips (.gitignore, .env.example);
//   • writes .env.production in the publish folder from this folder's .env.beta (only
//     VITE_PRIME_ACCOUNTS=beta and an https VITE_PRIME_API_URL are accepted): GitHub Actions runs
//     `npm run build`, which reads .env.production — so the site becomes the closed beta while
//     `npm run build` HERE stays the guest game;
//   • refuses when a file to be copied looks like it holds a secret (keys, tokens, invite codes);
//   • after copying, asks git what it would commit and stops loudly if anything private shows up.
// It never commits, pushes or touches .git — that stays your step in VS Code.

import { ROOT } from './lib/backendKit';
import { cp, crypto, fs, path, proc } from './lib/node';

const DIRS = ['src', 'public', 'scripts', 'docs', 'backend/pb_hooks', 'backend/pb_migrations', 'backend/pb_public', 'deploy/linux'];
const FILES = ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'README.md', '.gitignore', '.env.example', 'backend/package.json', 'backend/versions.json', 'backend/.gitignore'];
/**
 * Never copied, even inside the folders above. 1.8.8: docs/legal-drafts — legal texts the owner has
 * not approved yet stay private (the public repository shows only published documents).
 */
const SKIP = (rel: string) => /(^|\/)(\.DS_Store|\._[^/]*)$/.test(rel) || /\.env$/.test(rel) || /\.(db|db-wal|db-shm|zip|age)$/.test(rel) || /\.tar\.gz$/.test(rel) || rel.startsWith('docs/legal-drafts/');
/** What git must never be about to commit in the publish folder. */
const PRIVATE = /(^|\/)(pb_data|bin|backups|backups-private|server-bundle|node_modules|dist|\.pnpm-store|\.run|test-data)\/|\.(db|db-wal|db-shm|zip|age)$|\.tar\.gz$|(^|\/)\.env(\.(?!example$|production$)[^/]*)?$/;
// (settings lines are matched only at the start of a line: the checks mention these names in regexes)
const SECRETS: [RegExp, string][] = [
  [/^\s*PB_ENCRYPTION_KEY=[0-9A-Za-z]{8,}/, 'ключ шифрования PocketBase'],
  [/^\s*PRIME_SMTP_PASSWORD=[^\s$]{3,}/, 'пароль SMTP'],
  [/AGE-SECRET-KEY-1[0-9A-Z]{20,}/, 'закрытый ключ age'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'закрытый ключ (SSH/TLS)'],
  [/pbinstall\/[A-Za-z0-9_-]{20,}/, 'ссылка установки суперпользователя'],
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'токен (JWT)'],
];
/** A real invite code (the tests use fixed fake codes, so scripts/ is not searched for these). */
const INVITE = /PT-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{6}/;

const log = (s = '') => console.log(s);
function stop(msg: string): never {
  log('\nОСТАНОВЛЕНО: ' + msg);
  return proc.exit(1);
}
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
function git(target: string, ...args: string[]): { ok: boolean; out: string } {
  const r = cp.spawnSync('/usr/bin/git', ['-C', target, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: String(r.stdout ?? '').trim() };
}
function walk(rel: string, out: string[]): void {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isFile()) {
    if (!SKIP(rel)) out.push(rel);
    return;
  }
  for (const name of (fs.readdirSync(abs) as string[]).sort()) walk(rel ? `${rel}/${name}` : name, out);
}

// ------------------------------------------------------------------ arguments and the target
const args = proc.argv.slice(2);
const apply = args.includes('--apply');
const targetArg = args.find((a) => !a.startsWith('--'));
if (!targetArg) stop('укажите папку публикации: npm run publish:sync -- "/путь/к/PRIME TIME SHOWDOWN" (сначала без --apply)');
const target = path.resolve(targetArg);
if (target === ROOT || target.startsWith(ROOT + path.sep)) stop('папка публикации не может быть внутри рабочей папки');
if (!fs.existsSync(path.join(target, '.git'))) stop(`${target} — не git-репозиторий (нет .git). Нужна папка, связанная с GitHub.`);
const origin = git(target, 'remote', 'get-url', 'origin').out;
if (!/PRIME-TIME-SHOWDOWN(\.git)?$/i.test(origin)) stop(`у этой папки другой репозиторий (${origin || 'нет origin'}) — ожидался …/PRIME-TIME-SHOWDOWN`);
const branch = git(target, 'branch', '--show-current').out;
const head = git(target, 'log', '-1', '--format=%h «%s» (%cd)', '--date=format:%d.%m.%Y %H:%M').out;
const dirty = git(target, 'status', '--porcelain').out.split('\n').filter(Boolean).length;

log(`Папка публикации: ${target}`);
log(`Репозиторий: ${origin} · ветка ${branch}`);
log(`Последний коммит (точка отката — то, что сейчас опубликовано, если после него не было Sync): ${head}`);
if (dirty) log(`Внимание: в папке публикации уже есть ${dirty} незакоммиченных изменений (например, от прошлого переноса). Они не теряются; откат — к коммиту выше.`);

// ------------------------------------------------------------------ the plan
const files: string[] = [];
for (const d of DIRS) walk(d, files);
for (const f of FILES) if (fs.existsSync(path.join(ROOT, f))) files.push(f);
const added: string[] = [];
const changed: string[] = [];
for (const rel of files) {
  const dst = path.join(target, rel);
  if (!fs.existsSync(dst)) added.push(rel);
  else if (sha(path.join(ROOT, rel)) !== sha(dst)) changed.push(rel);
}
// files the publish folder has in those folders but this project no longer does (never deleted here)
const extra: string[] = [];
for (const d of DIRS) {
  const there: string[] = [];
  const walkT = (rel: string) => {
    const abs = path.join(target, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isFile()) return void (SKIP(rel) || there.push(rel));
    for (const n of fs.readdirSync(abs) as string[]) walkT(`${rel}/${n}`);
  };
  walkT(d);
  for (const rel of there) if (!fs.existsSync(path.join(ROOT, rel))) extra.push(rel);
}

// secrets in what would be copied
const hits: string[] = [];
for (const rel of files) {
  const abs = path.join(ROOT, rel);
  if (fs.statSync(abs).size > 2_000_000 || /\.(mp3|png|jpg|jpeg|webp|woff2?|ico)$/i.test(rel)) continue;
  const text = String(fs.readFileSync(abs, 'utf8'));
  text.split('\n').forEach((line: string, i: number) => {
    for (const [re, what] of SECRETS) if (re.test(line)) hits.push(`${rel}:${i + 1} — похоже на ${what}`);
    const code = INVITE.exec(line)?.[0];
    if (code && !rel.startsWith('scripts/') && !/^X+$/.test(code.slice(3).replace(/-/g, ''))) hits.push(`${rel}:${i + 1} — похоже на настоящий код приглашения`);
  });
}

// .env.production for GitHub Actions, from .env.beta
const betaPath = path.join(ROOT, '.env.beta');
if (!fs.existsSync(betaPath)) stop('нет .env.beta в рабочей папке — без него сайт останется гостевой версией');
const betaLines = String(fs.readFileSync(betaPath, 'utf8')).split('\n').map((l: string) => l.trim()).filter((l: string) => l && !l.startsWith('#'));
const betaMap = new Map(betaLines.map((l: string) => [l.split('=')[0].trim(), l.slice(l.indexOf('=') + 1).trim()] as [string, string]));
const apiUrl = betaMap.get('VITE_PRIME_API_URL') ?? '';
if (betaMap.get('VITE_PRIME_ACCOUNTS') !== 'beta' || !/^https:\/\/[a-z0-9.-]+$/i.test(apiUrl) || [...betaMap.keys()].some((k) => k !== 'VITE_PRIME_ACCOUNTS' && k !== 'VITE_PRIME_API_URL')) {
  stop('.env.beta должен содержать ровно две строки: VITE_PRIME_ACCOUNTS=beta и VITE_PRIME_API_URL=https://… (без паролей и ключей)');
}
const envProd = `# PRIME TIME: SHOWDOWN — the closed beta build of GitHub Pages (written by npm run publish:sync from .env.beta).\n# Public values only: everything VITE_* is visible in the published game. No passwords, keys or tokens here.\n# Remove this file (and commit) to publish the guest game without accounts again.\nVITE_PRIME_ACCOUNTS=beta\nVITE_PRIME_API_URL=${apiUrl}\n`;
const envProdPath = path.join(target, '.env.production');
const envState = !fs.existsSync(envProdPath) ? 'будет создан' : String(fs.readFileSync(envProdPath, 'utf8')) === envProd ? 'уже такой' : 'будет обновлён';

// deploy.yml is not part of the copy — just make sure the site is still built the same way
const wf = path.join(target, '.github', 'workflows', 'deploy.yml');
const wfText = fs.existsSync(wf) ? String(fs.readFileSync(wf, 'utf8')) : '';
const wfOk = /npm ci/.test(wfText) && /npm run build/.test(wfText) && /path: \.?\/?dist/.test(wfText);

log('');
log(`Файлов проекта: ${files.length} · новых: ${added.length} · изменённых: ${changed.length} · без изменений: ${files.length - added.length - changed.length}`);
const show = (title: string, list: string[]) => {
  if (!list.length) return;
  log(`${title}:`);
  for (const f of list.slice(0, 40)) log('  ' + f);
  if (list.length > 40) log(`  … и ещё ${list.length - 40}`);
};
show('Новые', added);
show('Изменённые', changed);
log(`.env.production (сборка сайта = закрытая бета, сервер ${apiUrl}): ${envState}`);
log(`.github/workflows/deploy.yml: ${wfOk ? 'не трогается; собирает npm run build и публикует dist — как раньше' : 'НЕ НАЙДЕН или изменён — проверьте вручную, скрипт его не меняет'}`);
if (extra.length) {
  log('');
  show('Есть в папке публикации, но уже нет в проекте (НЕ удаляются — посмотрите сами, если сборка на GitHub упадёт)', extra);
}
if (hits.length) {
  log('');
  show('Похоже на секреты', hits);
  stop('уберите это из файлов проекта — ничего не скопировано');
}

if (!apply) {
  log('\nЭто пробный запуск: ничего не изменено. Чтобы скопировать, повторите с --apply.');
  proc.exit(0);
}

// ------------------------------------------------------------------ copy
for (const rel of [...added, ...changed]) {
  const dst = path.join(target, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, rel), dst);
}
fs.writeFileSync(envProdPath, envProd);
log(`\nСкопировано файлов: ${added.length + changed.length}; .env.production записан.`);

// ------------------------------------------------------------------ what git would commit now
const pending = git(target, 'status', '--porcelain', '--untracked-files=all').out.split('\n').filter(Boolean).map((l: string) => l.slice(3).replace(/^"|"$/g, ''));
const leaks = pending.filter((p: string) => PRIVATE.test(p));
if (leaks.length) {
  show('git видит приватные файлы', leaks);
  stop('НЕ КОММИТЬТЕ: эти файлы не должны попасть в GitHub. Проверьте .gitignore в папке публикации.');
}
log(`git в папке публикации видит ${pending.length} изменённых/новых файлов — ни базы, ни копий, ни ключей среди них нет.`);
log('Дальше: VS Code → папка публикации → Source Control → просмотреть изменения → один коммит → Sync. Инструкция: docs/PRIME_BETA_PUBLISH.md');
