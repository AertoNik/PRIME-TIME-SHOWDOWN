// Alpha 1.8.8 stage 4 — `npm run payments:sandbox`: a LOCAL sandbox to see PRIME PAYMENTS end to end on this
// computer, without Robokassa, without staging, without any real secret.
//
//   PocketBase   a brand-new temporary database (deleted on exit) on 127.0.0.1:19290, server role «dev»,
//                payments in TEST mode with passwords made up for this run (printed nowhere), test prices;
//                LUCIEN's season ended (to see the paid way)
//   the account  one made-up PRIME ID (confirmed, documents accepted); its sign-in is written to a file in
//                the temporary folder, never printed
//   the emulator a stand-in for Robokassa's payment page on 127.0.0.1:19292 — the server sends the player
//                there ONLY because it runs as «dev» (PRIME_PAY_DEV_GATEWAY; staging and production always use
//                Robokassa's own page). It checks the form's signature, then — like Robokassa — sends the
//                server a ResultURL notification signed with the test Password#2 and returns the browser
//                through the server's SuccessURL / FailURL. It is NOT a payment: no money, no card, nothing
//                leaves this computer. It never goes into the game's build.
//
// `npm run payments:sandbox -- --demo` runs the official site's DEMONSTRATION instead (PRIME_PAY_MODE=demo: the
// approved prices are what the test payment asks, demo rights, cosmetics only, a last day 30 days ahead).
//
// Then start the game against it (another terminal):
//   VITE_PRIME_ACCOUNTS=local VITE_PRIME_API_URL=http://127.0.0.1:19290 npx vite --mode accounts --port 5179 --strictPort
// and open http://localhost:5179/?now=2026-11-10 (the date only for LUCIEN after his season; dev builds only).

import { HOOKS, ROOT, binariesReady, ensurePortsFree, ownServerStarted, spawnMailpit, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, nodeModule, os, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PORTS = { api: 19290, smtp: 11929, mailUi: 19291 };
const EMU = 19292;
const API = `http://127.0.0.1:${PORTS.api}`;
const GAME = 'http://localhost:5179/';
const LOGIN = 'primetimeshowdown';
const req = nodeModule.createRequire(import.meta.url);
const RK = req('../backend/pb_hooks/lib/robokassa.js');
const http = proc.getBuiltinModule('node:http');
const sha256 = (s: string) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const rnd = (n = 18) => crypto.randomBytes(n).toString('base64url');
const P1 = 'sandbox-p1-' + rnd();
const P2 = 'sandbox-p2-' + rnd();
const log = (s: string) => proc.stdout.write(s + '\n');
const DEMO = proc.argv.includes('--demo');
// 1.8.9.5: `-- --public` — public registration (no invite), PRIME ID from 14 (PRIME_AGE_DEFAULT=14), letters caught
// by the local Mailpit (http://127.0.0.1:19291) — to try the registration form against this temporary database
const PUBLIC = proc.argv.includes('--public');
const mskDay = (ms: number) => new Date(ms + 3 * 3600000).toISOString().slice(0, 10);

const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-payments-sandbox-'));
const dataDir = path.join(work, 'pb_data');
const hooksDir = path.join(work, 'pb_hooks');
let pb: any = null;
let mail: any = null;
let emu: any = null;

async function call(method: string, u: string, token = '', body?: unknown): Promise<any> {
  const r = await fetch(API + u, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => ({}));
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, inner: string): string {
  return `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f3f4f8;color:#1b1d2a}main{max-width:440px;margin:0 auto;padding:18px}
.badge{display:inline-block;padding:6px 10px;border-radius:8px;background:#ffe3f5;color:#a1006b;font-weight:700;font-size:12px;letter-spacing:.04em}
.card{background:#fff;border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 2px 10px rgba(0,0,0,.08)}h1{font-size:19px;margin:12px 0 4px}
.sum{font-size:28px;font-weight:800;margin:6px 0}dl{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:13px;margin:0}dt{color:#667}dd{margin:0;word-break:break-all}
button{display:block;width:100%;margin:8px 0;padding:14px;border:0;border-radius:12px;font-size:15px;font-weight:700;cursor:pointer}
.pay{background:#1fb26b;color:#fff}.alt{background:#e8e9f2;color:#1b1d2a}.no{background:#fff;color:#b3261e;box-shadow:inset 0 0 0 1.5px #e4b4b0}p.small{font-size:12px;color:#667}</style>
<main>${inner}</main></html>`;
}

async function notify(f: Record<string, string>): Promise<string> {
  // like Robokassa in test mode: OutSum with two decimals, signed with the TEST Password#2
  const sum = f.OutSum;
  const note: Record<string, string> = { OutSum: sum, InvId: f.InvId, SignatureValue: RK.hash('sha256', RK.resultBase(sum, f.InvId, P2, RK.shpList(f)), { sha256 }).toUpperCase(), Fee: '0.00', PaymentMethod: 'BankCard', IncCurrLabel: 'BankCardPSR', IsTest: '1' };
  for (const [k, v] of Object.entries(f)) if (k.startsWith('Shp_')) note[k] = v;
  const r = await fetch(API + '/api/prime/pay/robokassa/result', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(note).toString() });
  return `${r.status} ${await r.text()}`;
}

function successUrl(f: Record<string, string>): string {
  const sig = RK.hash('sha256', RK.resultBase(f.OutSum, f.InvId, P1, RK.shpList(f)), { sha256 });
  const q = new URLSearchParams({ OutSum: f.OutSum, InvId: f.InvId, SignatureValue: sig, Culture: 'ru' });
  for (const [k, v] of Object.entries(f)) if (k.startsWith('Shp_')) q.set(k, v);
  return `${API}/api/prime/pay/robokassa/success?${q.toString()}`;
}

function readBody(rq: any): Promise<string> {
  return new Promise((resolve) => {
    let b = '';
    rq.on('data', (c: any) => (b += String(c)));
    rq.on('end', () => resolve(b));
  });
}

function startEmulator(): void {
  emu = http.createServer(async (rq: any, rs: any) => {
    const u = new URL(rq.url, `http://127.0.0.1:${EMU}`);
    const body = rq.method === 'POST' ? await readBody(rq) : '';
    const f: Record<string, string> = RK.parseForm(body);
    const send = (code: number, html: string, headers: Record<string, string> = {}) => {
      rs.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
      rs.end(html);
    };
    if (u.pathname === '/pay' && rq.method === 'POST') {
      const shp = RK.shpList(f);
      const ok = f.SignatureValue === RK.hash('sha256', RK.paymentBase(f.MerchantLogin, f.OutSum, f.InvId, f.Receipt || '', P1, shp), { sha256 });
      const hidden = Object.entries(f)
        .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
        .join('');
      return send(
        200,
        page(
          'Эмулятор Robokassa',
          `<span class="badge">ЭМУЛЯТОР ROBOKASSA · ЛОКАЛЬНАЯ ПРОВЕРКА · НЕ ОПЛАТА</span>
          <div class="card"><h1>${esc(f.Description || '')}</h1><div class="sum">${esc(f.OutSum || '')} ₽</div>
          <dl><dt>Магазин</dt><dd>${esc(f.MerchantLogin || '')}</dd><dt>Счёт (InvId)</dt><dd>${esc(f.InvId || '')}</dd><dt>IsTest</dt><dd>${esc(f.IsTest || 'нет')}</dd><dt>Подпись</dt><dd>${ok ? 'верна (тестовый пароль №1)' : '<b style="color:#b3261e">НЕВЕРНА</b>'}</dd></dl></div>
          ${ok ? `<form method="POST" action="/pay/ok">${hidden}<button class="pay">Оплатить (тест)</button></form>
          <form method="POST" action="/pay/ok?delay=8">${hidden}<button class="alt">Оплатить — уведомление через 8 с</button></form>
          <form method="POST" action="/pay/ok?silent=1">${hidden}<button class="alt">Оплатить — уведомление не приходит</button></form>` : ''}
          <form method="POST" action="/pay/cancel">${hidden}<button class="no">Отменить оплату</button></form>
          <p class="small">Это локальная заглушка для разработки: денег нет, карта не нужна, данные не уходят с компьютера. В staging и production игра отправляет только на официальную страницу Robokassa.</p>`,
        ),
      );
    }
    if (u.pathname === '/pay/ok' && rq.method === 'POST') {
      const delay = Number(u.searchParams.get('delay') || 0);
      if (u.searchParams.get('silent')) log(`[emulator] InvId ${f.InvId}: «paid», the notification is NOT sent (to see «Подтверждение задерживается»)`);
      else if (delay) {
        log(`[emulator] InvId ${f.InvId}: notification in ${delay} s`);
        setTimeout(() => void notify(f).then((r) => log(`[emulator] ResultURL → ${r}`)), delay * 1000);
      } else log(`[emulator] InvId ${f.InvId}: ResultURL → ${await notify(f)}`);
      return send(303, '', { Location: successUrl(f) });
    }
    if (u.pathname === '/pay/cancel' && rq.method === 'POST') {
      log(`[emulator] InvId ${f.InvId}: cancelled`);
      return send(303, '', { Location: `${API}/api/prime/pay/robokassa/fail?OutSum=${encodeURIComponent(f.OutSum || '')}&InvId=${encodeURIComponent(f.InvId || '')}&Culture=ru` });
    }
    send(404, page('Эмулятор', '<p>Нет такой страницы.</p>'));
  });
  emu.listen(EMU, '127.0.0.1');
}

async function main(): Promise<void> {
  if (!binariesReady()) throw new Error('PocketBase is not installed: npm run backend:install');
  await ensurePortsFree([PORTS.api, PORTS.smtp, PORTS.mailUi, EMU]);
  fs.cpSync(HOOKS, hooksDir, { recursive: true });
  const rules: any = { exports: {} };
  new Function('module', fs.readFileSync(path.join(ROOT, 'backend/pb_hooks/lib/shop_rules.js'), 'utf8'))(rules);
  rules.exports.seasons.fighter_lucien.end = '2026-01-01T00:00:00Z';
  fs.writeFileSync(path.join(hooksDir, 'lib', 'shop_rules.js'), `module.exports = ${JSON.stringify(rules.exports, null, 2)};\n`);
  const su = { email: 'sandbox-admin@payments.test', pw: rnd() };
  upsertSuperuser(dataDir, su.email, su.pw, PORTS);
  if (PUBLIC) mail = spawnMailpit(PORTS);
  pb = spawnPocketBase({
    dir: dataDir,
    ports: PORTS,
    origins: ['http://localhost:5179', 'http://127.0.0.1:5179'],
    env: {
      PRIME_REGISTRATION: PUBLIC ? 'public' : 'disabled',
      PRIME_AGE_DEFAULT: PUBLIC ? '14' : '',
      PRIME_MAIL_LIMITS: PUBLIC ? 'relaxed' : '',
      PRIME_GAME_URL: GAME,
      PRIME_SERVER_ROLE: 'dev',
      PRIME_PAY_MODE: DEMO ? 'demo' : 'test',
      PRIME_DEMO_UNTIL: DEMO ? mskDay(Date.now() + 30 * 86400000) : '',
      ROBOKASSA_MERCHANT_LOGIN: LOGIN,
      ROBOKASSA_HASH_ALGORITHM: 'sha256',
      ROBOKASSA_TEST_PASSWORD_1: P1,
      ROBOKASSA_TEST_PASSWORD_2: P2,
      ROBOKASSA_PASSWORD_1: '',
      ROBOKASSA_PASSWORD_2: '',
      ROBOKASSA_PASSWORD_3: '',
      PRIME_SHOP_SALES: 'open',
      PRIME_PAY_DEV_GATEWAY: `http://127.0.0.1:${EMU}/pay`,
    },
    args: [`--hooksDir=${hooksDir}`, '--hooksWatch=false'],
  });
  const out: string[] = [];
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) out.push(l);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, out))) throw new Error('PocketBase did not start:\n' + out.slice(-10).join('\n'));
  const tok = (await call('POST', '/api/collections/_superusers/auth-with-password', '', { identity: su.email, password: su.pw })).token;
  const cfg = await call('GET', '/api/prime/config');
  const email = 'sandbox-buyer@payments.test';
  const pw = 'Sandbox' + crypto.randomBytes(8).toString('hex');
  const u = await call('POST', '/api/collections/users/records', tok, { email, password: pw, passwordConfirm: pw, verified: true });
  await call('POST', '/api/collections/profiles/records', tok, { user: u.id, nickname: 'SandboxBuyer', nicknameKey: 'sandboxbuyer' });
  for (const d of ['terms', 'consent']) await call('POST', '/api/collections/consents/records', tok, { user: u.id, doc: d, version: cfg.legal[d].v, lang: 'ru', action: 'register' });
  await call('POST', '/api/collections/consents/records', tok, { user: u.id, doc: 'age', version: 0, lang: 'ru', action: 'declared', ageBand: '18+' });
  const creds = path.join(work, 'sandbox-account.txt');
  fs.writeFileSync(creds, `${email}\n${pw}\n`, { mode: 0o600 });
  startEmulator();
  log(out.filter((l) => l.startsWith('PRIME') || /PRIME:/.test(l)).join('\n'));
  log(`\nПесочница PRIME PAYMENTS готова (временная база: ${work}).`);
  log(`  API          ${API}  (роль dev, ${DEMO ? 'ДЕМОНСТРАЦИЯ: утверждённые цены, только косметика' : 'тестовый режим, тестовые цены 10 ₽'}, сезон Люсьена завершён)`);
  log(`  эмулятор     http://127.0.0.1:${EMU}/pay  (вместо страницы Robokassa — только для роли dev)`);
  log(`  аккаунт      вход записан в ${creds} (не печатается)`);
  log(`  игра         VITE_PRIME_ACCOUNTS=local VITE_PRIME_API_URL=${API} npx vite --mode accounts --port 5179 --strictPort`);
  log(`               затем ${GAME}?now=2026-11-10`);
  if (PUBLIC) log(`  регистрация  публичная, PRIME ID с 14 лет; письма — http://127.0.0.1:${PORTS.mailUi}`);
  log('Ctrl+C — остановить и удалить временную базу.');
}

async function stop(): Promise<void> {
  try {
    emu?.close();
  } catch {
    /* gone */
  }
  await stopChild(pb).catch(() => {});
  await stopChild(mail).catch(() => {});
  fs.rmSync(work, { recursive: true, force: true });
}

proc.on('SIGINT', () => void stop().then(() => proc.exit(0)));
proc.on('SIGTERM', () => void stop().then(() => proc.exit(0)));
main().catch(async (e) => {
  log('Песочница не запустилась: ' + (e instanceof Error ? e.message : String(e)));
  await stop();
  proc.exit(1);
});
