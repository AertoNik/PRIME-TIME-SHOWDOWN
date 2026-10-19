// Alpha 1.8.2 — the PRIME NETWORK server bundle: exactly the files a VPS needs, packed on the Mac.
//
//   npm run server:bundle      → server-bundle/prime-server-<version>.tar.gz (+ .sha256)
//
// Inside: backend/pb_hooks, backend/pb_migrations, backend/pb_public, backend/versions.json,
// deploy/linux (scripts, systemd, Caddy, env TEMPLATE) and docs/PRIME_CLOUD_*.md.
// Never inside: the database, backups, programs (backend/bin), real env files, macOS service files.
// macOS «._name» files matter: PocketBase would load «._prime.pb.js» as a hook and refuse to start.
// The archive is checked after packing; on any doubt it is deleted and the command fails.

import { APP_VERSION } from '../src/config/version';
import { ROOT } from './lib/backendKit';
import { cp, crypto, fs, path, proc } from './lib/node';

const OUT_DIR = path.join(ROOT, 'server-bundle');
const ITEMS = ['backend/pb_hooks', 'backend/pb_migrations', 'backend/pb_public', 'backend/versions.json', 'deploy/linux'];
const log = (s: string) => console.log(s);

function fail(msg: string, file?: string): never {
  if (file) fs.rmSync(file, { force: true });
  log('ОШИБКА: ' + msg);
  return proc.exit(1);
}

const docs = (fs.readdirSync(path.join(ROOT, 'docs')) as string[]).filter((f) => /^PRIME_CLOUD_.+\.md$/.test(f)).map((f) => `docs/${f}`);
for (const item of ITEMS) if (!fs.existsSync(path.join(ROOT, item))) fail(`нет ${item}`);
if (docs.length === 0) fail('нет docs/PRIME_CLOUD_*.md');

// a real server env file next to the template would end up on the server and in the archive
const realEnv = (fs.readdirSync(path.join(ROOT, 'deploy', 'linux')) as string[]).filter((f) => /\.env$/.test(f));
if (realEnv.length) fail(`в deploy/linux лежит настоящий файл настроек (${realEnv.join(', ')}) — уберите его из папки проекта, в архив он попасть не должен`);

fs.mkdirSync(OUT_DIR, { recursive: true });
const name = `prime-server-${APP_VERSION}.tar.gz`;
const file = path.join(OUT_DIR, name);
fs.rmSync(file, { force: true });

const tar = cp.spawnSync(
  '/usr/bin/tar',
  ['--no-mac-metadata', '--no-xattrs', '--exclude', '.DS_Store', '--exclude', '._*', '--exclude', '*.env', '-czf', file, ...ITEMS, ...docs],
  { cwd: ROOT, encoding: 'utf8', env: { ...proc.env, COPYFILE_DISABLE: '1' } },
);
if (tar.status !== 0) fail('tar: ' + String(tar.stderr).trim(), file);

const list = String(cp.spawnSync('/usr/bin/tar', ['-tzf', file], { encoding: 'utf8' }).stdout)
  .split('\n')
  .filter(Boolean);
const bad = list.filter((p) => /(^|\/)\._|\.DS_Store$|(^|\/)pb_data\/|(^|\/)bin\/|(^|\/)backups(-private)?\/|\.env$|\.db$|(^|\/)node_modules\//.test(p));
if (bad.length) fail('в архив попало лишнее: ' + bad.slice(0, 5).join(', '), file);
const must = ['backend/pb_hooks/prime.pb.js', 'backend/pb_migrations/1792400000_prime_closed_beta.js', 'backend/pb_public/auth/verify/index.html', 'deploy/linux/install.sh', 'deploy/linux/pocketbase.env.example'];
const missing = must.filter((m) => !list.includes(m));
if (missing.length) fail('в архиве нет: ' + missing.join(', '), file);

const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(file + '.sha256', `${sha}  ${name}\n`);
const kb = Math.round(fs.statSync(file).size / 1024);
log(`Архив для сервера: server-bundle/${name} (${kb} КБ, файлов: ${list.filter((p) => !p.endsWith('/')).length})`);
log(`SHA-256: ${sha}`);
log('Внутри только код сервера, шаблоны и инструкции — без базы, копий, программ и настоящих настроек.');
log('Как загрузить на сервер: docs/PRIME_CLOUD_DEPLOY.md, шаг «Загрузить файлы на сервер».');
