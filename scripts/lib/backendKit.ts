import { cp, crypto, fs, net, path, proc, sleep, url } from './node';

// Alpha 1.8.1 — the local backend toolkit shared by `npm run backend*` and `npm run backend:test`:
// where the tools live, how they are installed (pinned versions, SHA-256 checked) and how
// PocketBase and Mailpit are started — always on 127.0.0.1, never on a public interface.

export const ROOT: string = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
export const BACKEND: string = path.join(ROOT, 'backend');
export const BIN: string = path.join(BACKEND, 'bin');
export const PB_BIN: string = path.join(BIN, 'pocketbase');
export const MAILPIT_BIN: string = path.join(BIN, 'mailpit');
export const HOOKS: string = path.join(BACKEND, 'pb_hooks');
export const MIGRATIONS: string = path.join(BACKEND, 'pb_migrations');
export const DATA: string = path.join(BACKEND, 'pb_data');
export const RUN_DIR: string = path.join(BACKEND, '.run');
export const RUN_FILE: string = path.join(RUN_DIR, 'backend.json');
export const BACKUPS: string = path.join(BACKEND, 'backups');

export interface Ports {
  api: number;
  smtp: number;
  mailUi: number;
}

/** The development ports (the game's `.env.accounts` points at api). */
export const DEV_PORTS: Ports = { api: 8090, smtp: 1025, mailUi: 8025 };
/**
 * Pages allowed to call the API from a browser (CORS): the Vite dev server on this computer — on
 * 5173 or, when that port is busy, the next free ones Vite picks (5174…5180).
 */
export const DEV_PAGE_PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180];
export const DEV_ORIGINS = DEV_PAGE_PORTS.flatMap((p) => [`http://localhost:${p}`, `http://127.0.0.1:${p}`]);

interface ToolFile {
  file: string;
  sha256: string;
}
interface Tool {
  version: string;
  url: string;
  files: Record<string, ToolFile>;
}
interface Versions {
  pocketbase: Tool;
  mailpit: Tool;
}

export function versions(): Versions {
  return JSON.parse(fs.readFileSync(path.join(BACKEND, 'versions.json'), 'utf8')) as Versions;
}

/** darwin-x64 / darwin-arm64 — the only platforms 1.8.1 is set up for (the developer's Mac). */
export function platformKey(): string | null {
  if (proc.platform !== 'darwin') return null;
  if (proc.arch === 'x64') return 'darwin-x64';
  if (proc.arch === 'arm64') return 'darwin-arm64';
  return null;
}

/** `pocketbase --version` / `mailpit version` → "0.40.5" (null when missing or broken). */
export function installedVersion(tool: 'pocketbase' | 'mailpit'): string | null {
  const bin = tool === 'pocketbase' ? PB_BIN : MAILPIT_BIN;
  if (!fs.existsSync(bin)) return null;
  // (mailpit: --no-release-check — no request to GitHub just to print the local version)
  const r = cp.spawnSync(bin, tool === 'pocketbase' ? ['--version'] : ['version', '--no-release-check'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const m = /v?(\d+\.\d+\.\d+)/.exec(String(r.stdout));
  return m ? m[1] : null;
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** Download, verify and unpack one tool into backend/bin (nothing is executed before the hash matches). */
function installTool(name: 'pocketbase' | 'mailpit', log: (s: string) => void): void {
  const v = versions()[name];
  const key = platformKey();
  if (!key || !v.files[key]) throw new Error(`Нет сборки ${name} для этой системы (${proc.platform}/${proc.arch}).`);
  if (installedVersion(name) === v.version) {
    log(`${name} ${v.version} уже установлен`);
    return;
  }
  const f = v.files[key];
  const work = path.join(BACKEND, '.download');
  fs.mkdirSync(work, { recursive: true });
  const archive = path.join(work, f.file);
  log(`Скачивание ${f.file} (${v.url})…`);
  // the system curl (it follows GitHub's redirect to its file CDN reliably); nothing runs before the hash check
  const dl = cp.spawnSync('/usr/bin/curl', ['-fsSL', '--retry', '2', '--connect-timeout', '20', '--max-time', '600', '-o', archive, v.url + f.file], { stdio: 'inherit' });
  if (dl.status !== 0 || !fs.existsSync(archive)) throw new Error(`Не удалось скачать ${f.file} (curl, код ${dl.status}). Проверьте интернет и повторите.`);
  const got = sha256File(archive);
  if (got !== f.sha256) {
    fs.rmSync(archive, { force: true });
    throw new Error(`SHA-256 не совпадает для ${f.file}: ожидалось ${f.sha256}, получено ${got}. Файл удалён.`);
  }
  log(`SHA-256 совпадает (${got.slice(0, 16)}…)`);
  const out = path.join(work, name);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const unpack = f.file.endsWith('.zip') ? cp.spawnSync('/usr/bin/unzip', ['-q', '-o', archive, '-d', out]) : cp.spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', out]);
  if (unpack.status !== 0) throw new Error(`Не удалось распаковать ${f.file}`);
  fs.mkdirSync(BIN, { recursive: true });
  const target = name === 'pocketbase' ? PB_BIN : MAILPIT_BIN;
  fs.copyFileSync(path.join(out, name), target);
  fs.chmodSync(target, 0o755);
  fs.rmSync(work, { recursive: true, force: true });
  const now = installedVersion(name);
  if (now !== v.version) throw new Error(`${name} установлен, но не запускается (версия: ${now ?? 'нет ответа'}).`);
  log(`${name} ${now} установлен в backend/bin`);
}

export function install(log: (s: string) => void): void {
  installTool('pocketbase', log);
  installTool('mailpit', log);
}

export function binariesReady(): boolean {
  const v = versions();
  return installedVersion('pocketbase') === v.pocketbase.version && installedVersion('mailpit') === v.mailpit.version;
}

// ------------------------------------------------------------------ processes
export interface PbOptions {
  dir: string;
  ports: Ports;
  origins: string[];
  /** Extra environment for the migrations (SMTP host/port, app URL). */
  env?: Record<string, string>;
  /** Extra `serve` flags, e.g. --encryptionEnv like the VPS service. */
  args?: string[];
}

/** `pocketbase serve` bound to 127.0.0.1 with the project's migrations and hooks (no auto-generated migrations). */
export function spawnPocketBase(o: PbOptions) {
  const args = [
    'serve',
    `--http=127.0.0.1:${o.ports.api}`,
    `--dir=${o.dir}`,
    `--hooksDir=${HOOKS}`,
    `--migrationsDir=${MIGRATIONS}`,
    `--publicDir=${path.join(BACKEND, 'pb_public')}`,
    '--automigrate=false',
    `--origins=${o.origins.join(',')}`,
    ...(o.args ?? []),
  ];
  return cp.spawn(PB_BIN, args, { cwd: BACKEND, env: pbEnv(o.ports, o.env), stdio: ['ignore', 'pipe', 'pipe'] });
}

/** What the migrations read: the app URL in the emails and the local SMTP catcher. */
function pbEnv(ports: Ports, extra: Record<string, string> = {}): Record<string, string | undefined> {
  return {
    ...proc.env,
    PRIME_APP_URL: `http://127.0.0.1:${ports.api}`,
    PRIME_SMTP_HOST: '127.0.0.1',
    PRIME_SMTP_PORT: String(ports.smtp),
    ...extra,
  };
}

/** Mailpit: catches every email on 127.0.0.1 (nothing is relayed anywhere), web UI on 127.0.0.1 too. */
export function spawnMailpit(ports: Ports) {
  return cp.spawn(MAILPIT_BIN, ['--listen', `127.0.0.1:${ports.mailUi}`, '--smtp', `127.0.0.1:${ports.smtp}`, '--disable-version-check', '--quiet'], {
    cwd: BACKEND,
    env: proc.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export async function healthy(u: string, timeoutMs = 800): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(u, { signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export async function waitHealthy(u: string, totalMs = 15000): Promise<boolean> {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    if (await healthy(u)) return true;
    await sleep(150);
  }
  return false;
}

/**
 * The isolated checks run their own PocketBase / Mailpit on fixed ports of this computer. If anything
 * already listens there — an SSH tunnel to the REAL server (ssh -L …), another backend — their requests
 * would reach THAT instead. So they refuse to start at all.
 */
export async function ensurePortsFree(ports: number[]): Promise<void> {
  const busy: number[] = [];
  for (const p of ports) {
    const free = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (!free) busy.push(p);
  }
  if (busy.length) {
    throw new Error(
      `порт ${busy.join(', ')} на этом компьютере уже занят (например, SSH-туннелем к серверу или другим backend). ` +
        `Проверка остановлена, ничего не запущено и никуда не отправлено — иначе её запросы ушли бы не на временный сервер. ` +
        `Кто занял порт: lsof -nP -iTCP:${busy[0]} -sTCP:LISTEN. Закройте его и запустите проверку снова.`,
    );
  }
}

/**
 * «Healthy» is not enough: something else could answer on that port. Our own PocketBase prints
 * «Server started at» once it listens — wait for that line (false if the process ended instead).
 */
export async function ownServerStarted(child: { exitCode: number | null }, logs: string[], totalMs = 8000): Promise<boolean> {
  const end = Date.now() + totalMs;
  while (Date.now() < end) {
    if (logs.some((l) => l.includes('Server started at'))) return child.exitCode === null;
    if (child.exitCode !== null) return false;
    await sleep(100);
  }
  return false;
}

/** Create or update a superuser of a data dir from the CLI (used by the isolated tests only). */
export function upsertSuperuser(dir: string, email: string, password: string, ports: Ports): void {
  const r = cp.spawnSync(PB_BIN, ['superuser', 'upsert', email, password, `--dir=${dir}`, `--migrationsDir=${MIGRATIONS}`, `--hooksDir=${HOOKS}`, '--automigrate=false'], {
    encoding: 'utf8',
    env: pbEnv(ports),
  });
  if (r.status !== 0) throw new Error('superuser upsert failed: ' + String(r.stderr).slice(0, 300));
}

export function stopChild(child: { exitCode: number | null; kill(sig?: string): boolean; once(ev: string, fn: () => void): void } | null): Promise<void> {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* gone */
      }
      resolve();
    }, 4000);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export function isAlive(pid: number): boolean {
  try {
    proc.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------- snapshots (1.8.2)
export interface SnapshotInfo {
  dir: string;
  files: string[];
  counts: Record<string, number>;
  migrations: string[];
}

function sqlite(db: string, sql: string): string {
  const r = cp.spawnSync('/usr/bin/sqlite3', [db, sql], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`sqlite3 failed on ${path.basename(db)}: ${String(r.stderr).trim()}`);
  return String(r.stdout).trim();
}

/** Row counts of the PRIME collections (missing tables count as -1). */
export function dbCounts(db: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ['users', 'profiles', 'saves', 'save_history', 'invites', 'game_sessions', '_superusers']) {
    try {
      out[t] = Number(sqlite(db, `select count(*) from ${t};`));
    } catch {
      out[t] = -1;
    }
  }
  return out;
}

/** A fingerprint of the account data that must survive any migration or move unchanged. */
export function dbFingerprint(db: string): string {
  const parts = [
    sqlite(db, "select id||'|'||email||'|'||verified||'|'||password||'|'||tokenKey from users order by id;"),
    sqlite(db, "select user||'|'||nickname||'|'||nicknameKey from profiles order by user;"),
    sqlite(db, "select owner||'|'||revision||'|'||schema||'|'||hash||'|'||length(data) from saves order by owner;"),
    sqlite(db, "select owner||'|'||revision||'|'||reason||'|'||hash from save_history order by id;"),
  ];
  return crypto.createHash('sha256').update(parts.join('\n')).digest('hex');
}

/**
 * A consistent copy of a PocketBase data folder, safe while the server runs: SQLite's own online
 * backup (`.backup`) for data.db and auxiliary.db — never a raw copy of a database that may be
 * mid-write in its WAL — plus uploaded files (storage/). Each copy is integrity-checked; SHA-256
 * sums and a small manifest are written beside them.
 */
export function snapshot(dataDir: string, outDir: string): SnapshotInfo {
  fs.mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const name of ['data.db', 'auxiliary.db']) {
    const src = path.join(dataDir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(outDir, name);
    if (dst.includes("'")) throw new Error('the backup path must not contain an apostrophe');
    sqlite(src, `.backup '${dst}'`);
    const ok = sqlite(dst, 'PRAGMA integrity_check;');
    if (ok !== 'ok') throw new Error(`integrity check failed for the copy of ${name}: ${ok}`);
    files.push(name);
  }
  if (!files.includes('data.db')) throw new Error(`no data.db in ${dataDir}`);
  const storage = path.join(dataDir, 'storage');
  if (fs.existsSync(storage)) {
    fs.cpSync(storage, path.join(outDir, 'storage'), { recursive: true });
    files.push('storage/');
  }
  const sums = files
    .filter((f) => !f.endsWith('/'))
    .map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, f))).digest('hex')}  ${f}`)
    .join('\n');
  fs.writeFileSync(path.join(outDir, 'SHA256SUMS'), sums + '\n');
  const db = path.join(outDir, 'data.db');
  const counts = dbCounts(db);
  const migrations = sqlite(db, "select file from _migrations where file like '%prime%' order by file;").split('\n').filter(Boolean);
  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ kind: 'prime-pocketbase-snapshot', createdAt: new Date().toISOString(), pocketbase: versions().pocketbase.version, source: dataDir, counts, migrations, files }, null, 2) + '\n',
  );
  return { dir: outDir, files, counts, migrations };
}
