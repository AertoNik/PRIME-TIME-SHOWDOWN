import { formatMoney } from '../core/math';
import type { AccountView, PlayGate } from '../game/AccountRuntime';
import type { Game } from '../game/Game';
import { VERSION, summarize, type SaveSummary } from '../meta/SaveSystem';
import type { LoginPlan } from '../net/AccountService';
import { accountText, checkEmail, checkInvite, checkRegistration, normalizeInvite } from '../net/accountRules';
import { readSync, userProfile } from '../net/accountStore';
import { browserStorage } from '../net/build';
import { readCloudText } from '../net/cloudSave';
import { PrimeApiError } from '../net/PrimeApi';
import type { SyncStatus } from '../net/SyncManager';
import type { CloudState } from './cloudPill';
import { esc } from './dom';
import { lang, tr } from '../i18n/lang';
import { acceptedVersions, ageFieldsHTML, ageLocked, ageText, bindAgeFields, bindConsent, consentHTML, legalAction, legalLinksHTML, lockAge, openLegalDoc, openMyData, readAge, showLegalAccept } from './legalUI';

// Alpha 1.8.1 — PRIME NETWORK in the interface: the account block of PRIME ID and its dialogs
// (create an account, sign in, password reset, moving the guest career, two saves, cloud copies,
// sign out). Only a `npm run dev:accounts` page ever shows any of it. Every text says plainly that
// this is a local test; nothing claims a sync the server has not confirmed.

/** Mailpit's web UI of the local backend (npm run backend) — only ever shown in the local test. */
const LOCAL_MAIL = import.meta.env.DEV ? 'http://127.0.0.1:8025' : '';

const when = (t: number) => (t > 0 ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const whenIso = (s: string) => (s ? when(Date.parse(s.replace(' ', 'T'))) : '—');

/** The page talks to a real (remote) server — no Mac-only hints then. */
let remote = false;
const rt = (g: Game) => {
  remote = g.account?.config.mode === 'remote';
  return g.account!;
};
const isLocal = (g: Game) => g.account?.config.mode === 'local';
/**
 * 1.8.2: does this server send email? Only when it says so — a server without email (or one too old
 * to say) gets no promise of a letter: the account waits until the organiser confirms it by hand.
 */
const mailOn = (g: Game) => g.account?.serverConfig?.mail === true;

/** The chip next to PRIME NETWORK: where this game's accounts live and how registration works. */
function chip(g: Game): string {
  const r = g.account;
  const beta = r?.serverConfig?.registration === 'invite_only';
  if (!r || r.config.env === 'local') return beta ? 'CLOSED BETA · ЛОКАЛЬНО' : 'ЛОКАЛЬНЫЙ ТЕСТ';
  return r.config.env === 'beta' || beta ? 'CLOSED BETA' : 'ONLINE';
}

function errText(e: unknown, ctx: 'login' | 'other' = 'other'): string {
  if (e instanceof PrimeApiError) {
    if (e.kind === 'network') return accountText(remote ? 'network_remote' : 'network');
    if (e.kind === 'rate') return accountText('rate_limited');
    if (ctx === 'login' && (e.kind === 'invalid' || e.kind === 'unauthorized')) return accountText('login_failed');
    if (e.kind === 'server') return accountText('server_error');
    return accountText(e.code);
  }
  return accountText('server_error');
}

// ----------------------------------------------------------------- statuses
export const SYNC_TEXT: Record<SyncStatus, string> = {
  idle: 'Проверка…',
  synced: 'Синхронизировано',
  pending: 'Есть несинхронизированные изменения',
  saving: 'Сохранение изменений…',
  offline: 'Нет подключения',
  conflict: 'Конфликт сохранений',
  newer: 'Нужна новая версия игры',
  'signed-out': 'Сессия завершена — войдите снова',
  unverified: 'Email не подтверждён',
  rejected: 'Сервер не принял сохранение',
  error: 'Ошибка сервера · повтор позже',
  superseded: 'PRIME ID активен на другом устройстве',
  outdated: 'Обновите страницу, чтобы продолжить синхронизацию',
};

type AccountState = Extract<AccountView, { kind: 'account' }>;

/** One line about the account save (PRIME ID pass and panel). */
export function syncLine(v: AccountState): string {
  // 1.8.3: the game session comes first — it decides whether this page may play at all
  if (v.gate === 'superseded') return SYNC_TEXT.superseded;
  // 1.8.4: the account's documents first
  if (v.gate === 'terms') return tr('Примите документы PRIME ID, чтобы продолжить', 'Accept the PRIME ID documents to continue');
  if (v.gate === 'loading') return 'PRIME CLOUD · загрузка прогресса…';
  if (v.gate === 'signed-out') return SYNC_TEXT['signed-out'];
  if (v.gate === 'offline') return v.unsynced ? 'Нет соединения · изменения ждут отправки' : 'Нет соединения с PRIME CLOUD';
  if (v.conflict === 'cloud-newer') return 'В аккаунте новый прогресс с другого устройства';
  if (v.conflict === 'damaged') return 'Облачное сохранение повреждено';
  if (v.conflict === 'missing') return 'В аккаунте нет сохранения';
  if (!v.signedIn) return SYNC_TEXT['signed-out'];
  if (v.status === 'offline') return v.unsynced ? 'Нет подключения · изменения ждут отправки' : 'Нет подключения';
  if (v.status === 'synced') return `Синхронизировано · ${when(v.syncedAt)}`;
  return SYNC_TEXT[v.status];
}

function tone(v: AccountState): string {
  if (v.gate === 'superseded') return 'bad';
  if (v.gate === 'loading') return 'wait';
  if (v.gate) return 'off';
  if (v.conflict || v.status === 'conflict' || v.status === 'newer' || v.status === 'rejected' || v.status === 'superseded' || v.status === 'outdated') return 'bad';
  if (!v.signedIn || v.status === 'offline' || v.status === 'error') return 'off';
  if (v.status === 'synced') return 'ok';
  return 'wait';
}

/**
 * 1.8.3: the PRIME CLOUD line of the main menu — short, and «синхронизировано» only after the
 * server confirmed the last write.
 */
export function cloudLabel(v: AccountState): CloudState {
  const t = tone(v);
  if (v.gate === 'superseded' || v.status === 'superseded') return { text: 'PRIME ID АКТИВЕН НА ДРУГОМ УСТРОЙСТВЕ', tone: 'bad', kind: 'superseded' };
  if (v.gate === 'terms') return { text: tr('PRIME CLOUD · ПРИМИТЕ ДОКУМЕНТЫ', 'PRIME CLOUD · ACCEPT THE DOCUMENTS'), tone: 'off', kind: 'issue' };
  if (v.gate === 'loading' || v.status === 'idle') return { text: 'PRIME CLOUD · ЗАГРУЗКА…', tone: 'wait', kind: 'loading' };
  if (v.gate === 'offline' || v.status === 'offline') return { text: 'PRIME CLOUD · НЕТ СОЕДИНЕНИЯ', tone: 'off', kind: 'offline' };
  if (v.gate === 'signed-out' || !v.signedIn) return { text: 'PRIME CLOUD · ВОЙДИТЕ СНОВА', tone: 'off', kind: 'signin' };
  if (v.status === 'saving') return { text: 'PRIME CLOUD · СОХРАНЕНИЕ…', tone: 'wait', kind: 'saving' };
  // (a change waiting a few seconds before it goes up: nothing to announce yet)
  if (v.status === 'pending' && !v.conflict) return { text: 'PRIME CLOUD · СОХРАНЕНИЕ…', tone: 'wait', kind: 'waiting' };
  if (v.status === 'synced' && !v.conflict) return { text: 'PRIME CLOUD · СИНХРОНИЗИРОВАНО', tone: 'ok', kind: 'synced' };
  return { text: 'PRIME CLOUD · ' + syncLine(v).toUpperCase(), tone: t, kind: 'issue' };
}

// ------------------------------------------------------------ PRIME ID block
export function accountPanelHTML(g: Game): string {
  const r = g.account;
  if (!r) return '';
  const v = r.view();
  rt(g);
  const head = `<div class="pid-acc-head"><span class="pid-acc-logo">PRIME<b>NETWORK</b></span><span class="pid-acc-env">${chip(g)}</span></div>`;
  const btn = (act: string, label: string, cls = 'ghost') => `<button class="btn ${cls} pid-acc-btn" data-acc="${act}">${label}</button>`;
  // 1.8.4: download / delete the signed-in account (servers that offer it)
  const dataBtn = r.serverConfig?.accountTools && r.api?.sessionRecord ? btn('data', tr('Мои данные', 'My data')) : '';
  let body = '';
  switch (v.kind) {
    case 'starting':
      body = `<p class="pid-acc-text">${isLocal(g) ? 'Подключение к локальному серверу аккаунтов…' : tr('Подключение к PRIME NETWORK…', 'Connecting to PRIME NETWORK…')}</p>`;
      break;
    case 'server-down': {
      const api = esc(r.config.apiUrl.replace(/^https?:\/\//, ''));
      body = !isLocal(g)
        ? `<p class="pid-acc-text">${tr('Сервер PRIME NETWORK сейчас недоступен. Игра продолжает работать как обычно, прогресс сохраняется на этом устройстве.', 'The PRIME NETWORK server is unavailable right now. The game keeps working; progress is saved on this device.')}</p>`
        : r.serverProblem === 'blocked'
          ? `<p class="pid-acc-text">Сервер аккаунтов работает (${api}), но не принимает запросы со страницы <b>${esc(location.host)}</b>. Перезапустите <b>npm run backend</b> из папки этой копии игры (он разрешает порты 5173–5180) или откройте игру по адресу http://localhost:5173/. Гостевая игра работает как обычно.</p>`
          : `<p class="pid-acc-text">Локальный сервер аккаунтов не отвечает (${api}). Запустите в отдельной вкладке терминала <b>npm run backend</b> и нажмите «Проверить снова». Гостевая игра работает как обычно.</p>`;
      body += `<div class="pid-acc-row">${btn('recheck', tr('Проверить снова', 'Check again'))}</div>`;
      break;
    }
    case 'guest': {
      const mode = r.serverConfig?.registration ?? 'disabled';
      if (mode === 'invite_only') {
        body = `<p class="pid-acc-text"><b>CLOSED BETA.</b> ${tr('Регистрация пока доступна только приглашённым участникам тестирования. Без приглашения можно играть как гость — весь прогресс сохраняется на этом устройстве.', 'Registration is open to invited testers only for now. Without an invite you can play as a guest — all progress is saved on this device.')}</p>
          <div class="pid-acc-row">${btn('register', tr('Есть приглашение — создать аккаунт', 'I have an invite — create account'), '')}${btn('login', tr('Войти', 'Sign in'))}</div>`;
      } else if (mode === 'public') {
        body = `<p class="pid-acc-text">${isLocal(g) ? 'Сохраните карьеру в аккаунте PRIME ID и продолжайте её в другом браузере. Аккаунты пока работают только на этом компьютере.' : tr('Сохраните карьеру в аккаунте PRIME ID и продолжайте её на другом устройстве.', 'Keep your career in a PRIME ID account and continue it on another device.')}</p>
          <div class="pid-acc-row">${btn('register', tr('Создать аккаунт', 'Create account'), '')}${btn('login', tr('Войти', 'Sign in'))}</div>`;
      } else {
        body = `<p class="pid-acc-text">${tr('Регистрация новых аккаунтов временно закрыта. Вход в существующий аккаунт работает, гостевая игра — как обычно.', 'New registrations are closed for now. Signing in to an existing account works; guest play works as usual.')}</p>
          <div class="pid-acc-row">${btn('login', tr('Войти', 'Sign in'), '')}</div>`;
      }
      break;
    }
    case 'unverified':
      body = mailOn(g)
        ? `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text">${tr('Email не подтверждён: откройте ссылку из письма. До этого карьера остаётся гостевой, облачное сохранение недоступно.', 'Email not confirmed: open the link from the email. Until then the guest career continues and the cloud save is unavailable.')} ${tr('Не получили письмо? Проверьте папку «Спам».', 'No email? Check your spam folder.')}</p>
        <div class="pid-acc-row">${btn('verified', tr('Я подтвердил', 'I confirmed'), '')}${btn('resend', tr('Отправить ещё раз', 'Send again'))}</div>
        <div class="pid-acc-row">${isLocal(g) ? btn('mail', 'Открыть тестовую почту') : ''}${dataBtn}${btn('signout', tr('Выйти', 'Sign out'))}</div>`
        : `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text"><b>Аккаунт ожидает проверки.</b> Организатор теста подтвердит его вручную, когда убедится, что этот email ваш. До этого карьера остаётся гостевой, облачное сохранение недоступно.</p>
        <div class="pid-acc-row">${btn('verified', 'Проверить статус', '')}${btn('signout', 'Выйти')}</div>`;
      break;
    case 'not-loaded':
      body = `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text">${tr('Вы вошли, но аккаунт ещё не загружен на этом устройстве — сейчас идёт гостевая карьера.', 'You are signed in, but the account is not loaded on this device yet — the guest career is playing.')}</p>
        <div class="pid-acc-row">${btn('load', tr('Загрузить аккаунт', 'Load account'), '')}${btn('signout', tr('Выйти', 'Sign out'))}</div>
        ${dataBtn ? `<div class="pid-acc-row">${dataBtn}</div>` : ''}`;
      break;
    case 'account': {
      const acts: string[] = [];
      if (v.gate === 'terms') acts.push(btn('terms', tr('Принять документы', 'Accept documents'), ''));
      else if (v.gate === 'superseded') acts.push(btn('here', tr('Продолжить здесь', 'Continue here'), ''));
      else if (v.gate === 'offline') acts.push(btn('retry', tr('Повторить', 'Retry'), ''));
      else if (!v.signedIn || v.gate === 'signed-out') acts.push(btn('login', tr('Войти снова', 'Sign in again'), ''));
      else if (v.conflict || v.status === 'conflict' || v.status === 'newer') acts.push(btn('decide', tr('Решить', 'Decide'), ''));
      else if (v.status === 'outdated') acts.push(btn('reload', tr('Обновить страницу', 'Reload page'), ''));
      else acts.push(btn('sync', tr('Синхронизировать', 'Sync'), ''));
      acts.push(btn('logout', tr('Выйти', 'Sign out')));
      // 1.8.3: say plainly what the session means — only when the server really enforces it
      const sess = v.cloud2 && !v.gate ? `<p class="pid-acc-text pid-acc-sess">${tr('PRIME CLOUD 2.0 · играть под этим PRIME ID сейчас можно только здесь. Откроете игру на другом устройстве — продолжите там, прогресс загрузится сам.', 'PRIME CLOUD 2.0 · this PRIME ID can be played only here right now. Open the game on another device to continue there — progress loads by itself.')}</p>` : '';
      body = `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-sync" data-tone="${tone(v)}"><i></i>${esc(syncLine(v))}</p>${sess}
        <div class="pid-acc-row">${acts.join('')}</div>
        ${dataBtn && v.signedIn ? `<div class="pid-acc-row">${dataBtn}</div>` : ''}`;
      break;
    }
  }
  // 1.8.4: the documents, the contact and the language — always within reach
  return `<section class="pid-acc" data-kind="${v.kind}">${head}${body}${v.kind === 'starting' ? '' : legalLinksHTML()}</section>`;
}

/** PRIME ID: a tap in the account block. */
export function accountAction(g: Game, act: string): void {
  const r = rt(g);
  g.audio.ui('click');
  // 1.8.4: documents, language, the account's own data
  if (legalAction(g, act)) return;
  if (act === 'data') return openMyData(g);
  if (act === 'terms') return r.askTerms(true);
  if (act === 'register') openRegister(g);
  else if (act === 'login') openLogin(g);
  else if (act === 'recheck') {
    void r.recheckServer().then((up) => g.ui.toast(up ? 'Сервер аккаунтов доступен' : 'Сервер аккаунтов всё ещё не отвечает'));
  } else if (act === 'verified') void recheckVerified(g);
  else if (act === 'resend') {
    void r
      .resendVerification()
      .then(() => g.ui.toast(isLocal(g) ? 'Письмо отправлено ещё раз (тестовая почта)' : tr('Письмо отправлено ещё раз. Не пришло — проверьте «Спам».', 'Email sent again. Not there? Check your spam folder.')))
      .catch((e) => g.ui.toast(errText(e)));
  } else if (act === 'mail' && LOCAL_MAIL) window.open(LOCAL_MAIL, '_blank', 'noopener');
  else if (act === 'signout') {
    r.signOutOnly();
    g.ui.toast(tr('Вы вышли из аккаунта', 'Signed out'));
  } else if (act === 'load') void recheckVerified(g);
  else if (act === 'sync') {
    const s = r.sync;
    if (!s) return;
    void s.syncNow().then((st) => g.ui.toast(st === 'synced' ? 'Синхронизировано' : SYNC_TEXT[st]));
  } else if (act === 'decide') showSyncDecision(g);
  else if (act === 'here') r.continueHere();
  else if (act === 'retry') void r.retry();
  else if (act === 'reload') r.reload();
  else if (act === 'logout') confirmLogout(g);
}

// --------------------------------------------------------------------- forms
const envNote = (g: Game) => `<div class="acc-env">PRIME NETWORK · ${chip(g)}</div>`;

function eyeButton(): string {
  return `<button type="button" class="acc-eye" data-eye aria-label="${tr('Показать пароль', 'Show password')}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
}

/** Wires a form: password eye, «Enter» submits, one request at a time, errors under the fields. */
function bindForm(root: HTMLElement, submit: (f: Record<string, string>, fail: (msg: string, field?: string) => void) => Promise<void>, canSubmit?: () => boolean): void {
  const form = root.querySelector('form') as HTMLFormElement;
  const errBox = root.querySelector('.acc-err') as HTMLElement;
  const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
  let busy = false;
  root.querySelectorAll<HTMLButtonElement>('[data-eye]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = b.parentElement!.querySelector('input')!;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? tr('Скрыть пароль', 'Hide password') : tr('Показать пароль', 'Show password'));
      b.classList.toggle('on', show);
    }),
  );
  form.addEventListener('input', (e) => {
    (e.target as HTMLElement).closest('.acc-field')?.classList.remove('bad');
    errBox.textContent = '';
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return;
    const data: Record<string, string> = {};
    new FormData(form).forEach((v, k) => (data[k] = String(v)));
    const fail = (msg: string, field?: string) => {
      errBox.textContent = msg;
      if (field) form.querySelector(`[name="${field}"]`)?.closest('.acc-field')?.classList.add('bad');
    };
    busy = true;
    submitBtn.disabled = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = tr('Подождите…', 'Please wait…');
    submit(data, fail).finally(() => {
      busy = false;
      if (submitBtn.isConnected) {
        // 1.8.4: a form with required ticks stays locked until they are ticked again
        submitBtn.disabled = canSubmit ? !canSubmit() : false;
        submitBtn.textContent = label;
      }
    });
  });
}

const FIELD_OF: Record<string, string> = { nickname: 'nickname', email: 'email', password: 'password', invite: 'invite' };
const fieldOf = (code: string) => (code === 'password_mismatch' ? 'passwordConfirm' : FIELD_OF[code.split('_')[0]]);

export function openRegister(g: Game): void {
  const r = rt(g);
  const mode = r.serverConfig?.registration ?? 'disabled';
  if (mode === 'disabled') {
    g.ui.modal(
      `<div class="h1">${tr('Регистрация закрыта', 'Registration closed')}</div>${envNote(g)}<p class="acc-note">${accountText('registration_closed')}</p>
       <div class="modal-actions"><button class="btn wide" data-a="login">${tr('Войти', 'Sign in')}</button><button class="btn teal wide" data-a="back">${tr('Назад', 'Back')}</button></div>`,
      (root, close) => {
        root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
        root.querySelector('[data-a="login"]')!.addEventListener('click', () => openLogin(g));
      },
    );
    return;
  }
  // 1.8.4: one form — the age is one of its fields (under 13 answered here earlier today: the refusal again)
  if (ageLocked()) return showAgeRefused(g, 'age_too_young');
  openRegisterForm(g);
}

/** PRIME ID is not available for that answer: say why, plainly; the guest game goes on. */
function showAgeRefused(g: Game, code: string): void {
  g.ui.modal(
    `<div class="h1">${tr('PRIME ID недоступен', 'PRIME ID unavailable')}</div>
     <p class="acc-note">${ageText(code)}</p>
     <div class="modal-actions">
       <button class="btn wide" data-a="ok">${tr('Играть как гость', 'Play as a guest')}</button>
       <button class="btn ghost wide" data-a="parents">${tr('Информация для родителей', 'Information for parents')}</button>
     </div>`,
    (root, close) => {
      root.querySelector('[data-a="ok"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="parents"]')!.addEventListener('click', () => openLegalDoc(g, 'parents'));
    },
  );
}

/**
 * The registration form: nickname, email, password ×2 (+ invite in the closed beta), the age (one
 * neutral field; the country only if the answer depends on it), two unticked boxes, «Создать аккаунт».
 */
function openRegisterForm(g: Game): void {
  const r = rt(g);
  const invite = r.serverConfig?.registration === 'invite_only';
  const note = [
    invite ? tr('<b>Регистрация пока доступна только приглашённым участникам тестирования.</b> Без кода можно продолжать играть как гость.', '<b>Registration is open to invited testers only for now.</b> Without a code you can keep playing as a guest.') : '',
    !mailOn(g)
      ? 'Тестовый сервер пока не отправляет писем: после регистрации организатор теста проверит, что email ваш, и подтвердит аккаунт вручную.'
      : isLocal(g)
        ? 'Аккаунт создаётся на тестовом сервере этого компьютера; письма приходят в локальную тестовую почту — настоящие письма не отправляются.'
        : tr('После регистрации на ваш email придёт письмо со ссылкой для подтверждения.', 'After registering you will get an email with a confirmation link.'),
  ]
    .filter(Boolean)
    .join(' ');
  // 1.8.4: the registration challenge is solved while the player types (about a second on a phone)
  let ctl = new AbortController();
  const solve = () => r.solveChallenge(ctl.signal).catch(() => undefined);
  let pow = solve();
  let ticked = false;
  g.ui.modal(
    `<div class="h1">${tr('Создать аккаунт', 'Create account')}</div>
     ${envNote(g)}
     <p class="acc-note">${note}</p>
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>${tr('Никнейм продюсера', 'Producer nickname')}</span><input name="nickname" maxlength="16" autocomplete="nickname" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"><small>${tr('3–16 символов: буквы одного алфавита, цифры, «_»', '3–16 characters: letters of one alphabet, digits, «_»')}</small></label>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
       <label class="acc-field"><span>${tr('Пароль', 'Password')}</span><span class="acc-pw"><input name="password" type="password" maxlength="71" autocomplete="new-password" enterkeyhint="next">${eyeButton()}</span><small>${tr('Минимум 8 символов, буквы и цифры', 'At least 8 characters, letters and digits')}</small></label>
       <label class="acc-field"><span>${tr('Повтор пароля', 'Repeat password')}</span><span class="acc-pw"><input name="passwordConfirm" type="password" maxlength="71" autocomplete="new-password" enterkeyhint="next">${eyeButton()}</span></label>
       ${
         invite
           ? `<label class="acc-field acc-invite"><span>${tr('Код приглашения', 'Invite code')}</span><input name="invite" maxlength="48" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done" placeholder="PT-XXXXX-XXXXX-…"><small>${tr('Код из сообщения организатора теста — можно вставить целиком. Нужен только один раз, при создании аккаунта.', 'The code from the organiser\'s message — paste it whole. Needed only once, to create the account.')}</small></label>`
           : ''
       }
       ${ageFieldsHTML()}
       <div class="acc-hp" aria-hidden="true"><label>Website <input name="website" tabindex="-1" autocomplete="off"></label></div>
       ${consentHTML(g)}
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit" disabled>${tr('Создать аккаунт', 'Create account')}</button>
         <button class="btn ghost wide" type="button" data-a="login">${tr('Уже есть аккаунт — войти', 'I have an account — sign in')}</button>
         <button class="btn teal wide" type="button" data-a="back">${tr('Назад', 'Back')}</button>
       </div>
     </form>`,
    (root, close) => {
      const form = root.querySelector('form') as HTMLFormElement;
      const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
      const leave = (then: () => void) => {
        ctl.abort();
        then();
      };
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => leave(close));
      root.querySelector('[data-a="login"]')!.addEventListener('click', () => leave(() => openLogin(g)));
      bindAgeFields(g, root);
      bindConsent(g, root, (all) => {
        ticked = all;
        submitBtn.disabled = !all;
      });
      bindForm(
        root,
        async (f, fail) => {
          const input = { nickname: (f.nickname ?? '').trim(), email: (f.email ?? '').trim(), password: f.password ?? '', passwordConfirm: f.passwordConfirm ?? '' };
          const bad = checkRegistration(input) ?? (invite ? checkInvite(f.invite ?? '') : null);
          if (bad) return fail(accountText(bad), fieldOf(bad));
          const a = readAge(g, root);
          if (!a.ok) {
            if (a.code === 'age_invalid') return fail(ageText(a.code), 'age');
            if (a.code === 'country_required' || a.code === 'country_invalid') {
              (root.querySelector('.acc-country') as HTMLElement).hidden = false;
              return fail(ageText(a.code), 'country');
            }
            ctl.abort();
            if (a.code === 'age_too_young') lockAge();
            return showAgeRefused(g, a.code);
          }
          if (!ticked) return fail(accountText('consent_required'));
          const code = invite ? normalizeInvite(f.invite ?? '') : null;
          const legal = r.serverConfig?.legal;
          const usePow = r.serverConfig?.pow === true;
          try {
            let solved = await pow;
            if (!solved && usePow) solved = await (pow = solve());
            const r = await rt(g).register({
              ...input,
              ...(code ? { invite: code } : {}),
              age: a.age,
              country: a.country,
              lang: lang(),
              accept: acceptedVersions(g, root),
              privacy: legal?.privacy.v,
              pow: solved,
              website: f.website ?? '',
            });
            ctl.abort();
            g.audio.ui('confirm');
            if (r.manual || !mailOn(g)) showPending(g, input.email.toLowerCase());
            else showCheckMail(g, input.email.toLowerCase(), r.mailSent, r.retryAfter);
          } catch (e) {
            // a used challenge never works twice: the next attempt gets a fresh one (solved meanwhile)
            ctl = new AbortController();
            pow = solve();
            const code = e instanceof PrimeApiError ? e.code : '';
            if (code === 'country_required') {
              (root.querySelector('.acc-country') as HTMLElement).hidden = false;
              return fail(ageText(code), 'country');
            }
            if (/^age_|^country_/.test(code)) return showAgeRefused(g, code);
            if (code === 'legal_outdated') await r.loadServerConfig();
            fail(errText(e), fieldOf(code));
          }
        },
        () => ticked,
      );
      (root.querySelector('input[name="nickname"]') as HTMLInputElement).focus({ preventScroll: true });
    },
    false,
  );
}

/** 1.8.4: «Отправить ещё раз» counts down to the moment the server allows the next letter. */
function resendTimer(btn: HTMLButtonElement, label: string, seconds: number): void {
  const until = Date.now() + Math.max(0, seconds) * 1000;
  const tick = () => {
    if (!btn.isConnected) return;
    const left = Math.ceil((until - Date.now()) / 1000);
    if (left <= 0) {
      btn.disabled = false;
      btn.textContent = label;
      return;
    }
    btn.disabled = true;
    btn.textContent = `${tr('Ещё раз через', 'Send again in')} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    setTimeout(tick, 500);
  };
  tick();
}

function showCheckMail(g: Game, email: string, mailSent: boolean, retryAfter = 60): void {
  const resendLabel = tr('Отправить письмо ещё раз', 'Send the email again');
  g.ui.modal(
    `<div class="h1">${tr('Подтвердите email', 'Confirm your email')}</div>
     ${envNote(g)}
     <p class="acc-note">${
       isLocal(g)
         ? `${mailSent ? `Письмо со ссылкой отправлено на <b>${esc(email)}</b>.` : `Аккаунт создан, но письмо не отправилось (локальная почта не запущена?). Нажмите «Отправить ещё раз», когда backend работает.`} В локальной версии письма приходят в тестовую почту Mailpit: <a href="${LOCAL_MAIL}" target="_blank" rel="noopener">127.0.0.1:8025</a>. Откройте письмо и нажмите «Подтвердить email».`
         : mailSent
           ? tr(`Письмо со ссылкой отправлено на <b>${esc(email)}</b>. Откройте его и нажмите «Подтвердить email».`, `An email with a link was sent to <b>${esc(email)}</b>. Open it and press «Confirm email».`)
           : tr('Аккаунт создан, но письмо пока не отправилось. Нажмите «Отправить ещё раз» чуть позже.', 'The account is created, but the email has not gone out yet. Press «Send again» a little later.')
     }</p>
     <p class="acc-note acc-spam">${tr('Не получили письмо? Проверьте папку «Спам».', 'Didn\'t get the email? Check your spam folder.')}</p>
     <p class="acc-note muted">${tr('Пока email не подтверждён, игра продолжается в гостевом профиле, облачное сохранение недоступно.', 'Until the email is confirmed, the game continues with the guest profile and the cloud save is unavailable.')}</p>
     <div class="acc-err" role="alert" aria-live="polite"></div>
     <div class="modal-actions">
       <button class="btn wide" data-a="done">${tr('Я подтвердил', 'I confirmed')}</button>
       <button class="btn ghost wide" data-a="resend">${resendLabel}</button>
       <button class="btn teal wide" data-a="later">${tr('Позже', 'Later')}</button>
     </div>`,
    (root, close) => {
      const err = root.querySelector('.acc-err') as HTMLElement;
      const resend = root.querySelector('[data-a="resend"]') as HTMLButtonElement;
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      if (mailSent) resendTimer(resend, resendLabel, retryAfter);
      resend.addEventListener('click', () => {
        resend.disabled = true;
        void rt(g)
          .resendVerification()
          .then((wait) => {
            err.textContent = tr('Письмо отправлено ещё раз.', 'The email was sent again.');
            resendTimer(resend, resendLabel, wait);
          })
          .catch((e) => {
            err.textContent = errText(e);
            const wait = e instanceof PrimeApiError ? Number(e.data.retryAfter) : 0;
            resendTimer(resend, resendLabel, Number.isFinite(wait) && wait > 0 ? Math.min(wait, 3600) : 0);
          });
      });
      root.querySelector('[data-a="done"]')!.addEventListener('click', () => void recheckVerified(g, err));
    },
    false,
  );
}

/** 1.8.2, a server without email: the account exists and waits for the organiser — no letter is promised. */
function showPending(g: Game, email: string): void {
  g.ui.modal(
    `<div class="h1">Аккаунт ожидает проверки</div>
     ${envNote(g)}
     <p class="acc-note">Аккаунт с адресом <b>${esc(email)}</b> создан. Тестовый сервер пока не отправляет писем: организатор теста подтвердит аккаунт вручную, когда убедится, что этот адрес ваш (например, уточнит у вас в личном сообщении). После этого нажмите «Проверить статус».</p>
     <p class="acc-note muted">Пока аккаунт не подтверждён, игра продолжается в гостевом профиле — прогресс сохраняется на этом устройстве. Облачное сохранение включится после подтверждения.</p>
     <div class="acc-err" role="alert" aria-live="polite"></div>
     <div class="modal-actions">
       <button class="btn wide" data-a="done">Проверить статус</button>
       <button class="btn teal wide" data-a="later">Позже</button>
     </div>`,
    (root, close) => {
      const err = root.querySelector('.acc-err') as HTMLElement;
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="done"]')!.addEventListener('click', () => void recheckVerified(g, err));
    },
    false,
  );
}

async function recheckVerified(g: Game, err?: HTMLElement): Promise<void> {
  try {
    const plan = await rt(g).recheckAccount();
    if (!plan) {
      openLogin(g);
      return;
    }
    if (plan.kind === 'unverified') {
      const msg = !mailOn(g)
        ? 'Аккаунт пока не подтверждён организатором теста. Попробуйте чуть позже.'
        : isLocal(g)
          ? 'Email ещё не подтверждён. Откройте ссылку из письма в тестовой почте.'
          : tr('Email ещё не подтверждён. Откройте ссылку из письма (и проверьте «Спам»).', 'The email is not confirmed yet. Open the link from the email (and check the spam folder).');
      if (err) err.textContent = msg;
      else g.ui.toast(msg);
      return;
    }
    proceed(g, plan);
  } catch (e) {
    if (err) err.textContent = errText(e);
    else g.ui.toast(errText(e));
  }
}

export function openLogin(g: Game): void {
  g.ui.modal(
    `<div class="h1">${tr('Вход в PRIME ID', 'Sign in to PRIME ID')}</div>
     ${envNote(g)}
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
       <label class="acc-field"><span>${tr('Пароль', 'Password')}</span><span class="acc-pw"><input name="password" type="password" maxlength="71" autocomplete="current-password" enterkeyhint="go">${eyeButton()}</span></label>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">${tr('Войти', 'Sign in')}</button>
         <button class="btn ghost wide" type="button" data-a="forgot">${tr('Забыли пароль?', 'Forgot password?')}</button>
         <button class="btn ghost wide" type="button" data-a="register">${tr('Создать аккаунт', 'Create account')}</button>
         <button class="btn teal wide" type="button" data-a="back">${tr('Назад', 'Back')}</button>
       </div>
     </form>
     <p class="acc-legal">${tr('Документы', 'Documents')}: <button type="button" class="acc-doc" data-doc="terms">${tr('Соглашение', 'Terms')}</button> · <button type="button" class="acc-doc" data-doc="privacy">${tr('Конфиденциальность', 'Privacy')}</button></p>`,
    (root, close) => {
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="register"]')!.addEventListener('click', () => openRegister(g));
      root.querySelector('[data-a="forgot"]')!.addEventListener('click', () => openForgot(g, (root.querySelector('input[name="email"]') as HTMLInputElement).value));
      root.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((b) => b.addEventListener('click', () => openLegalDoc(g, b.dataset.doc as 'terms' | 'privacy')));
      bindForm(root, async (f, fail) => {
        const email = (f.email ?? '').trim();
        const bad = checkEmail(email);
        if (bad) return fail(accountText(bad), 'email');
        if (!f.password) return fail(accountText('password_empty'), 'password');
        try {
          const plan = await rt(g).login(email, f.password);
          g.audio.ui('confirm');
          proceed(g, plan);
        } catch (e) {
          fail(errText(e, 'login'));
        }
      });
      (root.querySelector('input[name="email"]') as HTMLInputElement).focus({ preventScroll: true });
    },
    false,
  );
}

function openForgot(g: Game, email = ''): void {
  if (!mailOn(g)) {
    // no email on this server: say so instead of «the letter is on its way»
    g.ui.modal(
      `<div class="h1">Восстановить доступ</div>
       ${envNote(g)}
       <p class="acc-note">Восстановление пароля по email временно недоступно: тестовый сервер пока не отправляет писем. Напишите организатору теста — он поможет вернуть доступ к аккаунту.</p>
       <p class="acc-note muted">Прогресс на этом устройстве сохраняется, гостевая игра работает как обычно.</p>
       <div class="modal-actions"><button class="btn teal wide" data-a="back">Назад ко входу</button></div>`,
      (root) => root.querySelector('[data-a="back"]')!.addEventListener('click', () => openLogin(g)),
      false,
    );
    return;
  }
  g.ui.modal(
    `<div class="h1">${tr('Восстановить доступ', 'Restore access')}</div>
     ${envNote(g)}
     <p class="acc-note">${isLocal(g) ? `Укажите email аккаунта — придёт ссылка для нового пароля (в локальной версии — в тестовую почту <a href="${LOCAL_MAIL}" target="_blank" rel="noopener">127.0.0.1:8025</a>). Ссылка действует 30 минут.` : tr('Укажите email аккаунта — придёт ссылка для нового пароля. Ссылка действует 30 минут.', 'Enter the account email — a link for a new password will arrive. The link is valid for 30 minutes.')}</p>
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(email)}" enterkeyhint="send"></label>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">${tr('Отправить ссылку', 'Send the link')}</button>
         <button class="btn teal wide" type="button" data-a="back">${tr('Назад ко входу', 'Back to sign-in')}</button>
       </div>
     </form>`,
    (root) => {
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => openLogin(g));
      bindForm(root, async (f, fail) => {
        const em = (f.email ?? '').trim();
        const bad = checkEmail(em);
        if (bad) return fail(accountText(bad), 'email');
        try {
          await rt(g).requestPasswordReset(em);
          // the same answer whether or not the address has an account
          g.ui.modal(
            `<div class="h1">${tr('Проверьте почту', 'Check your email')}</div><p class="acc-note">${
              isLocal(g)
                ? `Если аккаунт с адресом <b>${esc(em.toLowerCase())}</b> существует, письмо со ссылкой уже в тестовой почте. Задайте новый пароль на открывшейся странице и войдите с ним.`
                : tr(`Если аккаунт с адресом <b>${esc(em.toLowerCase())}</b> существует, письмо со ссылкой уже отправлено. Задайте новый пароль на открывшейся странице и войдите с ним. Не пришло — проверьте «Спам».`, `If an account with <b>${esc(em.toLowerCase())}</b> exists, an email with a link is on its way. Set a new password on the page it opens, then sign in. Not there? Check your spam folder.`)
            }</p>
             <div class="modal-actions">${isLocal(g) ? '<button class="btn wide" data-a="mail">Открыть тестовую почту</button>' : ''}<button class="btn teal wide" data-a="login">${tr('Ко входу', 'To sign-in')}</button></div>`,
            (r2) => {
              r2.querySelector('[data-a="mail"]')?.addEventListener('click', () => window.open(LOCAL_MAIL, '_blank', 'noopener'));
              r2.querySelector('[data-a="login"]')!.addEventListener('click', () => openLogin(g));
            },
          );
        } catch (e) {
          fail(errText(e));
        }
      });
    },
    false,
  );
}

// -------------------------------------------------------- after signing in
/**
 * 1.8.4: an account that still has documents to accept (made before 1.8.4, or the rules changed)
 * accepts them first; «Позже» keeps it signed in without loading it (nothing is written meanwhile).
 */
function proceed(g: Game, plan: LoginPlan): void {
  const needs = rt(g).legalNeeds();
  if (!needs.length) return continueLogin(g, plan);
  showLegalAccept(g, needs, (accepted) => {
    if (accepted) continueLogin(g, plan);
  });
}

/** What signing in leads to: switch, ask about the guest career, or explain why not. */
export function continueLogin(g: Game, plan: LoginPlan): void {
  const r = rt(g);
  switch (plan.kind) {
    case 'unverified':
      if (mailOn(g)) showCheckMail(g, plan.me.email, true);
      else showPending(g, plan.me.email);
      return;
    case 'resume':
      g.ui.closeModal();
      g.ui.toast(tr(`С возвращением, ${plan.me.nickname ?? 'продюсер'}!`, `Welcome back, ${plan.me.nickname ?? 'producer'}!`), true);
      return;
    case 'switch':
      g.ui.modal(`<div class="h1">Загрузка аккаунта</div><p class="center muted acc-note">${esc(plan.me.nickname ?? '')}: карьера ${plan.from === 'cloud' ? 'загружена из аккаунта' : 'найдена на этом устройстве'}. Перезапуск игры…</p>`, () => {}, false);
      r.switchTo(userProfile(plan.me.id));
      return;
    case 'offer-transfer':
      showTransfer(g, plan.me, plan.guest);
      return;
    case 'new-career':
      showNewCareer(g, plan.me, plan.guestBoundTo);
      return;
    case 'cloud-newer':
      g.ui.modal(
        `<div class="h1">Нужна новая версия игры</div><p class="acc-note">Сохранение аккаунта записано более новой версией PRIME TIME: SHOWDOWN (схема ${plan.schema}, эта версия понимает до ${VERSION}). Чтобы ничего не потерять, оно не загружается. Обновите игру и войдите снова. Сейчас продолжается гостевая карьера.</p>
         <div class="modal-actions"><button class="btn wide" data-a="ok">Понятно</button></div>`,
        (root, close) => root.querySelector('[data-a="ok"]')!.addEventListener('click', () => close()),
      );
      return;
    case 'cloud-damaged':
      g.ui.modal(
        `<div class="h1">Сохранение аккаунта повреждено</div><p class="acc-note">Сервер вернул облачное сохранение, которое не удаётся прочитать. Его можно заменить — повреждённая версия останется в облачных копиях аккаунта.</p>
         <div class="acc-err" role="alert"></div>
         <div class="modal-actions"><button class="btn wide" data-a="guest">Заменить гостевым прогрессом</button><button class="btn ghost wide" data-a="new">Начать новую карьеру</button><button class="btn teal wide" data-a="later">Позже</button></div>`,
        (root, close) => {
          const err = root.querySelector('.acc-err') as HTMLElement;
          root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
          root.querySelector('[data-a="guest"]')!.addEventListener('click', () =>
            void r
              .replaceDamagedWithGuest(plan.me, plan.cloud)
              .then((ok) => (ok ? r.switchTo(userProfile(plan.me.id)) : (err.textContent = 'Сохранение аккаунта изменилось. Войдите снова.')))
              .catch((e) => (err.textContent = errText(e))),
          );
          root.querySelector('[data-a="new"]')!.addEventListener('click', () =>
            void r
              .startNewCareer(plan.me, plan.cloud.revision)
              .then((ok) => (ok ? r.reload() : (err.textContent = 'Сохранение аккаунта изменилось. Войдите снова.')))
              .catch((e) => (err.textContent = errText(e))),
          );
        },
        false,
      );
      return;
  }
}

function sumRows(s: SaveSummary, extra: [string, string][] = []): string {
  const rows: [string, string][] = [
    ['Студия', esc(s.orgName)],
    ['Уровень', String(s.level)],
    ['Деньги', formatMoney(s.money)],
    ['Матчи', String(s.matches)],
    ['Бойцы в составе', String(s.fighters)],
    ...extra,
  ];
  return rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
}

function showTransfer(g: Game, me: LoginPlan['me'], guest: SaveSummary): void {
  const r = rt(g);
  const items = r.service!.guestSave().data.cosmetics.owned.length;
  g.ui.modal(
    `<div class="h1">Перенести прогресс в PRIME ID?</div>
     <p class="center muted acc-note">Аккаунт <b>${esc(me.nickname ?? '')}</b> пока пустой. На этом устройстве есть гостевая карьера:</p>
     <div class="acc-sum">${sumRows(guest, [['Коллекция', `${items} предм.`]])}</div>
     <p class="acc-note">Переносится вся карьера: бойцы и колоды, купленные карты, коллекция и титулы, сезонные жетоны и задания, рекорды режимов, серии побед. Звук, музыка, графика и камера остаются настройками этого устройства. Гостевая карьера останется на устройстве резервной копией.</p>
     <div class="acc-err" role="alert" aria-live="polite"></div>
     <div class="modal-actions">
       <button class="btn wide" data-a="move">Перенести прогресс</button>
       <button class="btn ghost wide" data-a="new">Начать новую карьеру</button>
       <button class="btn teal wide" data-a="later">Решить позже</button>
     </div>`,
    (root, close) => {
      const err = root.querySelector('.acc-err') as HTMLElement;
      const buttons = root.querySelectorAll<HTMLButtonElement>('.modal-actions .btn');
      const lock = (on: boolean) => buttons.forEach((b) => (b.disabled = on));
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="move"]')!.addEventListener('click', () => {
        lock(true);
        err.textContent = 'Перенос… дождитесь подтверждения сервера.';
        r
          .transferGuest(me)
          .then((ok) => {
            if (!ok) {
              lock(false);
              err.textContent = 'В аккаунте уже появилось сохранение (с другого устройства). Войдите снова, чтобы загрузить его.';
              return;
            }
            g.audio.ui('confirm');
            err.textContent = 'Прогресс перенесён. Перезапуск игры…';
            r.reload();
          })
          .catch((e) => {
            lock(false);
            err.textContent = errText(e) + ' Гостевая карьера не изменилась.';
          });
      });
      root.querySelector('[data-a="new"]')!.addEventListener('click', () =>
        g.confirm(
          'Начать новую карьеру?',
          'Аккаунт начнёт карьеру с нуля. Гостевая карьера не перенесётся, но останется на этом устройстве (вернётся после выхода из аккаунта).',
          'Начать с нуля',
          () => void startNew(g, me),
          () => showTransfer(g, me, guest),
        ),
      );
    },
    false,
  );
}

async function startNew(g: Game, me: LoginPlan['me']): Promise<void> {
  try {
    const ok = await rt(g).startNewCareer(me);
    if (!ok) g.ui.toast('В аккаунте уже есть сохранение — войдите снова');
    else rt(g).reload();
  } catch (e) {
    g.ui.toast(errText(e));
  }
}

function showNewCareer(g: Game, me: LoginPlan['me'], boundTo: string | null): void {
  g.ui.modal(
    `<div class="h1">Новая карьера в PRIME ID</div>
     <p class="acc-note">${boundTo ? `Гостевой прогресс этого устройства уже перенесён в аккаунт <b>${esc(boundTo)}</b> и второй раз автоматически не переносится.` : 'На этом устройстве нет гостевого прогресса для переноса.'} Аккаунт <b>${esc(me.nickname ?? '')}</b> начнёт карьеру с нуля; гостевая карьера останется на устройстве.</p>
     <div class="modal-actions"><button class="btn wide" data-a="go">Начать карьеру</button><button class="btn teal wide" data-a="later">Позже</button></div>`,
    (root, close) => {
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="go"]')!.addEventListener('click', () => {
        (root.querySelector('[data-a="go"]') as HTMLButtonElement).disabled = true;
        void startNew(g, me);
      });
    },
    false,
  );
}

// ---------------------------------------------------- two saves / decisions
/** The decision the account save is waiting for (conflict, newer cloud, damaged, missing, newer schema). */
export function showSyncDecision(g: Game): void {
  const r = rt(g);
  const s = r.sync;
  if (!s || !r.api) return;
  const m = readSync(browserStorage(), g.save.profile);
  const kind = m.conflict?.kind ?? (s.status === 'newer' ? 'newer' : null);
  if (!kind) return;
  if (kind === 'newer') {
    g.ui.modal(
      `<div class="h1">Сохранение аккаунта из новой версии</div><p class="acc-note">В аккаунте сохранение более новой версии игры (схема ${m.newer || '—'}, эта версия понимает до ${VERSION}). Чтобы не потерять его данные, эта версия ничего не загружает и не отправляет. Обновите игру.</p>
       <div class="modal-actions"><button class="btn wide" data-a="reload">Обновить страницу</button><button class="btn teal wide" data-a="later">Позже</button></div>`,
      (root, close) => {
        root.querySelector('[data-a="reload"]')!.addEventListener('click', () => location.reload());
        root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      },
    );
    return;
  }
  void r.api
    .getSave()
    .then((cloud) => {
      const local = summarize(g.save.data, VERSION);
      const read = cloud ? readCloudText(cloud.text) : null;
      const cloudSum = read && read.ok ? read.summary : null;
      const localCol = `<div class="acc-ver"><b>Это устройство</b>${sumRows(local, [['Изменено', when(g.save.meta.savedAt)]])}</div>`;
      const cloudCol = cloudSum ? `<div class="acc-ver"><b>Сохранение аккаунта</b>${sumRows(cloudSum, [['Изменено', whenIso(cloud!.updated)]])}</div>` : '';
      const title =
        kind === 'cloud-newer' ? 'В аккаунте новый прогресс' : kind === 'damaged' ? 'Облачное сохранение повреждено' : kind === 'missing' ? 'В аккаунте нет сохранения' : 'Обнаружены два сохранения';
      const text =
        kind === 'cloud-newer'
          ? 'Карьеру продолжили на другом устройстве. На этом устройстве изменений нет — загрузите версию аккаунта.'
          : kind === 'damaged'
            ? 'Сервер вернул сохранение, которое не удаётся прочитать. Его можно заменить прогрессом этого устройства — повреждённая версия останется в резервной копии на сервере.'
            : kind === 'missing'
              ? 'На сервере больше нет сохранения этого аккаунта. Прогресс этого устройства можно сохранить в аккаунт заново.'
              : 'Прогресс на этом устройстве и в аккаунте изменился независимо. Выберите версию — вторая не удаляется, она останется в резервной копии на сервере. Ничего не объединяется автоматически.';
      const actions =
        kind === 'cloud-newer'
          ? `<button class="btn wide" data-a="cloud">Загрузить из аккаунта</button><button class="btn teal wide" data-a="later">Позже</button>`
          : kind === 'damaged' || kind === 'missing'
            ? `<button class="btn wide" data-a="device">${kind === 'missing' ? 'Сохранить прогресс устройства' : 'Заменить прогрессом устройства'}</button><button class="btn teal wide" data-a="later">Позже</button>`
            : `<button class="btn wide" data-a="cloud">Использовать облако</button><button class="btn ghost wide" data-a="device">Использовать это устройство</button><button class="btn teal wide" data-a="later">Решить позже</button>`;
      g.ui.modal(
        `<div class="h1">${title}</div>
         <p class="center muted acc-note">${text}</p>
         <div class="acc-compare">${localCol}${cloudCol}</div>
         <div class="acc-err" role="alert" aria-live="polite"></div>
         <div class="modal-actions">${actions}</div>`,
        (root, close) => {
          const err = root.querySelector('.acc-err') as HTMLElement;
          const lock = (on: boolean) => root.querySelectorAll<HTMLButtonElement>('.modal-actions .btn').forEach((b) => (b.disabled = on));
          root.querySelector('[data-a="later"]')?.addEventListener('click', () => {
            g.audio.ui('click');
            close();
          });
          root.querySelector('[data-a="cloud"]')?.addEventListener('click', () => {
            lock(true);
            err.textContent = 'Загрузка версии аккаунта…';
            void s.useCloud().then((ok) => {
              if (ok) err.textContent = 'Готово. Перезапуск игры…';
              else {
                lock(false);
                err.textContent = s.status === 'offline' ? 'Нет подключения. Обе версии сохранены — повторите позже.' : 'Не получилось. Обе версии сохранены — повторите позже.';
              }
            });
          });
          root.querySelector('[data-a="device"]')?.addEventListener('click', () => {
            lock(true);
            err.textContent = 'Отправка на сервер…';
            void s.useDevice().then((ok) => {
              if (ok) {
                g.ui.toast('Сохранение аккаунта обновлено с этого устройства', true);
                close();
              } else if (readSync(browserStorage(), g.save.profile).conflict) {
                // the cloud moved again meanwhile: ask again with fresh figures
                close();
                showSyncDecision(g);
              } else {
                lock(false);
                err.textContent = s.status === 'offline' ? 'Нет подключения. Обе версии сохранены — повторите позже.' : 'Не получилось. Обе версии сохранены — повторите позже.';
              }
            });
          });
        },
        false,
      );
    })
    .catch(() => g.ui.toast('Нет подключения к серверу аккаунтов — решить можно позже'));
}

// ------------------------------------------------------------ cloud copies
// 1.8.3.1: the account has ONE current progress, loaded automatically — the player no longer picks
// earlier versions. The server keeps its history (and every device its local safety copies) for an
// emergency restore by the organiser: docs/PRIME_CLOUD_2_DEPLOY.md, «Восстановление прогресса».

function confirmLogout(g: Game): void {
  const r = rt(g);
  const unsynced = r.sync?.hasUnsynced() ?? false;
  g.confirm(
    'Выйти из аккаунта?',
    `${unsynced ? 'Есть изменения, которые ещё не подтверждены сервером. Попробуем отправить их сейчас; если не получится — они останутся на этом устройстве и отправятся, когда вы снова войдёте здесь.<br><br>' : ''}После выхода игра продолжится в гостевом профиле этого устройства. Копия аккаунта на устройстве не удаляется.`,
    'Выйти',
    () => void r.logout(),
  );
}


// ------------------------------------------------- 1.8.3 PRIME CLOUD 2.0 dialogs
const spinner = '<div class="cloud-spin" aria-hidden="true"><i></i><i></i><i></i></div>';

/**
 * Why a match under the PRIME ID cannot start (or the title waits): loading → «Синхронизация…»
 * (closes by itself when ready and runs `then`), offline, another device, signed out.
 */
export function explainGate(g: Game, why: PlayGate, then?: () => void): void {
  const r = rt(g);
  if (why === 'superseded') return showSessionTaken(g);
  // 1.8.4: the account's documents first (the same window as at the start)
  if (why === 'terms') return r.askTerms(true);
  if (why === 'loading') {
    g.ui.modal(
      `<div class="cloud-head"><span class="pid-acc-logo">PRIME<b>CLOUD</b></span></div>
       ${spinner}
       <p class="center acc-note cloud-msg">Синхронизация игрового прогресса…</p>`,
      (root, close) => {
        const off = r.onChange(() => {
          if (!root.isConnected) return void off();
          const now = r.gate();
          if (now === 'loading') return;
          off();
          if (now === null) {
            close();
            g.ui.toast('PRIME CLOUD · Синхронизировано', true);
            then?.();
          } else explainGate(g, now, then);
        });
      },
      false,
    );
    return;
  }
  const unsynced = r.sync?.hasUnsynced() ?? false;
  const goMenu = then ?? (() => {});
  if (why === 'offline') {
    g.ui.modal(
      `<div class="h1">PRIME CLOUD · НЕТ СОЕДИНЕНИЯ</div>
       <p class="acc-note">Не удалось связаться с сервером. Пока связь не восстановится, матчи под PRIME ID не начинаются: так прогресс не разойдётся между устройствами. Всё, что сервер уже подтвердил, на месте.${unsynced ? ' Изменения этого устройства ждут отправки.' : ''}</p>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" data-a="retry">Повторить</button>
         <button class="btn ghost wide" data-a="guest">Играть как гость</button>
         <button class="btn teal wide" data-a="menu">${then ? 'В меню' : 'Закрыть'}</button>
       </div>`,
      (root, close) => {
        const err = root.querySelector('.acc-err') as HTMLElement;
        const retry = root.querySelector('[data-a="retry"]') as HTMLButtonElement;
        retry.addEventListener('click', () => {
          retry.disabled = true;
          err.textContent = 'Проверяем связь…';
          void r.retry().then(() => {
            const now = r.gate();
            if (now === null) {
              close();
              g.ui.toast('PRIME CLOUD · Синхронизировано', true);
              then?.();
            } else if (now === 'offline') {
              retry.disabled = false;
              err.textContent = 'Сервер всё ещё недоступен. Попробуйте чуть позже.';
            } else explainGate(g, now, then);
          });
        });
        root.querySelector('[data-a="guest"]')!.addEventListener('click', () => confirmGuest(g, () => explainGate(g, why, then)));
        root.querySelector('[data-a="menu"]')!.addEventListener('click', () => {
          close();
          goMenu();
        });
      },
      false,
    );
    return;
  }
  // signed out
  g.ui.modal(
    `<div class="h1">Войдите в PRIME ID</div>
     <p class="acc-note">Сессия PRIME ID на этом устройстве завершена. Войдите снова, чтобы продолжить карьеру аккаунта, — или играйте как гость.${unsynced ? ' Изменения этого устройства ждут отправки и уйдут после входа.' : ''}</p>
     <div class="modal-actions">
       <button class="btn wide" data-a="login">Войти</button>
       <button class="btn ghost wide" data-a="guest">Играть как гость</button>
       <button class="btn teal wide" data-a="menu">${then ? 'В меню' : 'Закрыть'}</button>
     </div>`,
    (root, close) => {
      root.querySelector('[data-a="login"]')!.addEventListener('click', () => openLogin(g));
      root.querySelector('[data-a="guest"]')!.addEventListener('click', () => confirmGuest(g, () => explainGate(g, why, then)));
      root.querySelector('[data-a="menu"]')!.addEventListener('click', () => {
        close();
        goMenu();
      });
    },
    false,
  );
}

function confirmGuest(g: Game, back: () => void): void {
  g.confirm(
    'Играть как гость?',
    'Игра перезапустится с гостевой карьерой этого устройства — это отдельный прогресс, он не попадает в PRIME ID. Вход в аккаунт сохранится: вернуться к нему можно в PRIME ID → «Загрузить аккаунт».',
    'Играть как гость',
    () => void rt(g).playAsGuest(),
    back,
  );
}

/** This page lost the account's game session: nothing more happens here until «Продолжить здесь». */
export function showSessionTaken(g: Game): void {
  const r = rt(g);
  g.ui.modal(
    `<div class="h1">PRIME ID ОТКРЫТ НА ДРУГОМ УСТРОЙСТВЕ</div>
     <p class="acc-note">Вы продолжили игру в другой вкладке или на другом устройстве. Чтобы играть здесь, нажмите «Продолжить здесь» — прогресс загрузится сам.</p>
     <div class="modal-actions">
       <button class="btn wide" data-a="here">Продолжить здесь</button>
       <button class="btn ghost wide" data-a="guest">Играть как гость</button>
     </div>`,
    (root) => {
      const here = root.querySelector('[data-a="here"]') as HTMLButtonElement;
      here.addEventListener('click', () => {
        g.audio.ui('confirm');
        here.disabled = true;
        r.continueHere();
      });
      root.querySelector('[data-a="guest"]')!.addEventListener('click', () => confirmGuest(g, () => showSessionTaken(g)));
    },
    false,
  );
}

/** After the cloud replaced this device's unsent progress (another device had played on). */
export function showKeptDevice(g: Game): void {
  g.ui.modal(
    `<div class="h1">PRIME CLOUD</div>
     <p class="acc-note">Пока здесь не было связи с сервером, в PRIME ID играли на другом устройстве. Загружен актуальный прогресс аккаунта.</p>
     <p class="acc-note muted">Изменения с этого устройства, которые не успели сохраниться, не удалены — они хранятся в резервной копии. Если чего-то не хватает, напишите организатору теста.</p>
     <div class="modal-actions"><button class="btn wide" data-a="ok">Понятно</button></div>`,
    (root, close) => root.querySelector('[data-a="ok"]')!.addEventListener('click', () => close()),
  );
}
