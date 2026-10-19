import { formatMoney } from '../core/math';
import type { AccountView, PlayGate } from '../game/AccountRuntime';
import type { Game } from '../game/Game';
import { VERSION, summarize, type SaveSummary } from '../meta/SaveSystem';
import type { LoginPlan } from '../net/AccountService';
import { accountText, checkEmail, checkInvite, checkRegistration, normalizeInvite } from '../net/accountRules';
import { readSync, userProfile } from '../net/accountStore';
import { browserStorage } from '../net/build';
import { readCloudText } from '../net/cloudSave';
import { PrimeApiError, type HistoryEntry } from '../net/PrimeApi';
import type { SyncStatus } from '../net/SyncManager';
import { esc } from './dom';

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
export function cloudLabel(v: AccountState): { text: string; tone: string } {
  const t = tone(v);
  if (v.gate === 'superseded' || v.status === 'superseded') return { text: 'PRIME ID АКТИВЕН НА ДРУГОМ УСТРОЙСТВЕ', tone: 'bad' };
  if (v.gate === 'loading' || v.status === 'idle') return { text: 'PRIME CLOUD · ЗАГРУЗКА…', tone: 'wait' };
  if (v.gate === 'offline' || v.status === 'offline') return { text: 'PRIME CLOUD · НЕТ СОЕДИНЕНИЯ', tone: 'off' };
  if (v.gate === 'signed-out' || !v.signedIn) return { text: 'PRIME CLOUD · ВОЙДИТЕ СНОВА', tone: 'off' };
  if (v.status === 'saving' || v.status === 'pending') return { text: 'PRIME CLOUD · СОХРАНЕНИЕ…', tone: 'wait' };
  if (v.status === 'synced' && !v.conflict) return { text: 'PRIME CLOUD · СИНХРОНИЗИРОВАНО', tone: 'ok' };
  return { text: 'PRIME CLOUD · ' + syncLine(v).toUpperCase(), tone: t };
}

// ------------------------------------------------------------ PRIME ID block
export function accountPanelHTML(g: Game): string {
  const r = g.account;
  if (!r) return '';
  const v = r.view();
  rt(g);
  const head = `<div class="pid-acc-head"><span class="pid-acc-logo">PRIME<b>NETWORK</b></span><span class="pid-acc-env">${chip(g)}</span></div>`;
  const btn = (act: string, label: string, cls = 'ghost') => `<button class="btn ${cls} pid-acc-btn" data-acc="${act}">${label}</button>`;
  let body = '';
  switch (v.kind) {
    case 'starting':
      body = `<p class="pid-acc-text">${isLocal(g) ? 'Подключение к локальному серверу аккаунтов…' : 'Подключение к PRIME NETWORK…'}</p>`;
      break;
    case 'server-down': {
      const api = esc(r.config.apiUrl.replace(/^https?:\/\//, ''));
      body = !isLocal(g)
        ? `<p class="pid-acc-text">Сервер PRIME NETWORK сейчас недоступен. Игра продолжает работать как обычно, прогресс сохраняется на этом устройстве.</p>`
        : r.serverProblem === 'blocked'
          ? `<p class="pid-acc-text">Сервер аккаунтов работает (${api}), но не принимает запросы со страницы <b>${esc(location.host)}</b>. Перезапустите <b>npm run backend</b> из папки этой копии игры (он разрешает порты 5173–5180) или откройте игру по адресу http://localhost:5173/. Гостевая игра работает как обычно.</p>`
          : `<p class="pid-acc-text">Локальный сервер аккаунтов не отвечает (${api}). Запустите в отдельной вкладке терминала <b>npm run backend</b> и нажмите «Проверить снова». Гостевая игра работает как обычно.</p>`;
      body += `<div class="pid-acc-row">${btn('recheck', 'Проверить снова')}</div>`;
      break;
    }
    case 'guest': {
      const mode = r.serverConfig?.registration ?? 'disabled';
      if (mode === 'invite_only') {
        body = `<p class="pid-acc-text"><b>CLOSED BETA.</b> Регистрация пока доступна только приглашённым участникам тестирования. Без приглашения можно играть как гость — весь прогресс сохраняется на этом устройстве.</p>
          <div class="pid-acc-row">${btn('register', 'Есть приглашение — создать аккаунт', '')}${btn('login', 'Войти')}</div>`;
      } else if (mode === 'public') {
        body = `<p class="pid-acc-text">Сохраните карьеру в аккаунте PRIME ID и продолжайте её ${isLocal(g) ? 'в другом браузере. Аккаунты пока работают только на этом компьютере.' : 'на другом устройстве.'}</p>
          <div class="pid-acc-row">${btn('register', 'Создать аккаунт', '')}${btn('login', 'Войти')}</div>`;
      } else {
        body = `<p class="pid-acc-text">Регистрация новых аккаунтов временно закрыта. Вход в существующий аккаунт работает, гостевая игра — как обычно.</p>
          <div class="pid-acc-row">${btn('login', 'Войти', '')}</div>`;
      }
      break;
    }
    case 'unverified':
      body = mailOn(g)
        ? `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text">Email не подтверждён: откройте ссылку из письма. До этого карьера остаётся гостевой, облачное сохранение недоступно.</p>
        <div class="pid-acc-row">${btn('verified', 'Я подтвердил', '')}${btn('resend', 'Отправить ещё раз')}</div>
        <div class="pid-acc-row">${isLocal(g) ? btn('mail', 'Открыть тестовую почту') : ''}${btn('signout', 'Выйти')}</div>`
        : `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text"><b>Аккаунт ожидает проверки.</b> Организатор теста подтвердит его вручную, когда убедится, что этот email ваш. До этого карьера остаётся гостевой, облачное сохранение недоступно.</p>
        <div class="pid-acc-row">${btn('verified', 'Проверить статус', '')}${btn('signout', 'Выйти')}</div>`;
      break;
    case 'not-loaded':
      body = `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-text">Вы вошли, но аккаунт ещё не загружен на этом устройстве — сейчас идёт гостевая карьера.</p>
        <div class="pid-acc-row">${btn('load', 'Загрузить аккаунт', '')}${btn('signout', 'Выйти')}</div>`;
      break;
    case 'account': {
      const acts: string[] = [];
      if (v.gate === 'superseded') acts.push(btn('here', 'Продолжить здесь', ''));
      else if (v.gate === 'offline') acts.push(btn('retry', 'Повторить', ''));
      else if (!v.signedIn || v.gate === 'signed-out') acts.push(btn('login', 'Войти снова', ''));
      else if (v.conflict || v.status === 'conflict' || v.status === 'newer') acts.push(btn('decide', 'Решить', ''));
      else if (v.status === 'outdated') acts.push(btn('reload', 'Обновить страницу', ''));
      else acts.push(btn('sync', 'Синхронизировать', ''));
      if (v.signedIn && v.gate !== 'superseded') acts.push(btn('history', 'Облачные копии'));
      acts.push(btn('logout', 'Выйти'));
      // 1.8.3: say plainly what the session means — only when the server really enforces it
      const sess = v.cloud2 && !v.gate ? '<p class="pid-acc-text pid-acc-sess">PRIME CLOUD 2.0 · играть под этим PRIME ID сейчас можно только здесь. Откроете игру на другом устройстве — продолжите там, прогресс загрузится сам.</p>' : '';
      body = `<p class="pid-acc-who"><b>${esc(v.nickname)}</b><span>${esc(v.email)}</span></p>
        <p class="pid-acc-sync" data-tone="${tone(v)}"><i></i>${esc(syncLine(v))}</p>${sess}
        <div class="pid-acc-row">${acts.join('')}</div>`;
      break;
    }
  }
  return `<section class="pid-acc" data-kind="${v.kind}">${head}${body}</section>`;
}

/** PRIME ID: a tap in the account block. */
export function accountAction(g: Game, act: string): void {
  const r = rt(g);
  g.audio.ui('click');
  if (act === 'register') openRegister(g);
  else if (act === 'login') openLogin(g);
  else if (act === 'recheck') {
    void r.recheckServer().then((up) => g.ui.toast(up ? 'Сервер аккаунтов доступен' : 'Сервер аккаунтов всё ещё не отвечает'));
  } else if (act === 'verified') void recheckVerified(g);
  else if (act === 'resend') {
    void r
      .resendVerification()
      .then(() => g.ui.toast(isLocal(g) ? 'Письмо отправлено ещё раз (тестовая почта)' : 'Письмо отправлено ещё раз'))
      .catch((e) => g.ui.toast(errText(e)));
  } else if (act === 'mail' && LOCAL_MAIL) window.open(LOCAL_MAIL, '_blank', 'noopener');
  else if (act === 'signout') {
    r.signOutOnly();
    g.ui.toast('Вы вышли из аккаунта');
  } else if (act === 'load') void recheckVerified(g);
  else if (act === 'sync') {
    const s = r.sync;
    if (!s) return;
    void s.syncNow().then((st) => g.ui.toast(st === 'synced' ? 'Синхронизировано' : SYNC_TEXT[st]));
  } else if (act === 'decide') showSyncDecision(g);
  else if (act === 'here') r.continueHere();
  else if (act === 'retry') void r.retry();
  else if (act === 'reload') r.reload();
  else if (act === 'history') void openCloudHistory(g);
  else if (act === 'logout') confirmLogout(g);
}

// --------------------------------------------------------------------- forms
const envNote = (g: Game) => `<div class="acc-env">PRIME NETWORK · ${chip(g)}</div>`;

function eyeButton(): string {
  return `<button type="button" class="acc-eye" data-eye aria-label="Показать пароль"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button>`;
}

/** Wires a form: password eye, «Enter» submits, one request at a time, errors under the fields. */
function bindForm(root: HTMLElement, submit: (f: Record<string, string>, fail: (msg: string, field?: string) => void) => Promise<void>): void {
  const form = root.querySelector('form') as HTMLFormElement;
  const errBox = root.querySelector('.acc-err') as HTMLElement;
  const submitBtn = form.querySelector('[type="submit"]') as HTMLButtonElement;
  let busy = false;
  root.querySelectorAll<HTMLButtonElement>('[data-eye]').forEach((b) =>
    b.addEventListener('click', () => {
      const input = b.parentElement!.querySelector('input')!;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.setAttribute('aria-label', show ? 'Скрыть пароль' : 'Показать пароль');
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
    submitBtn.textContent = 'Подождите…';
    submit(data, fail).finally(() => {
      busy = false;
      if (submitBtn.isConnected) {
        submitBtn.disabled = false;
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
      `<div class="h1">Регистрация закрыта</div>${envNote(g)}<p class="acc-note">${accountText('registration_closed')}</p>
       <div class="modal-actions"><button class="btn wide" data-a="login">Войти</button><button class="btn teal wide" data-a="back">Назад</button></div>`,
      (root, close) => {
        root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
        root.querySelector('[data-a="login"]')!.addEventListener('click', () => openLogin(g));
      },
    );
    return;
  }
  const invite = mode === 'invite_only';
  const note = [
    invite ? '<b>Регистрация пока доступна только приглашённым участникам тестирования.</b> Без кода можно продолжать играть как гость.' : '',
    !mailOn(g)
      ? 'Тестовый сервер пока не отправляет писем: после регистрации организатор теста проверит, что email ваш, и подтвердит аккаунт вручную.'
      : isLocal(g)
        ? 'Аккаунт создаётся на тестовом сервере этого компьютера; письма приходят в локальную тестовую почту — настоящие письма не отправляются.'
        : 'После регистрации на ваш email придёт письмо со ссылкой для подтверждения.',
  ]
    .filter(Boolean)
    .join(' ');
  g.ui.modal(
    `<div class="h1">Создать аккаунт</div>
     ${envNote(g)}
     <p class="acc-note">${note}</p>
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>Никнейм продюсера</span><input name="nickname" maxlength="16" autocomplete="nickname" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"><small>3–16 символов: буквы одного алфавита, цифры, «_»</small></label>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="email" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
       <label class="acc-field"><span>Пароль</span><span class="acc-pw"><input name="password" type="password" maxlength="71" autocomplete="new-password" enterkeyhint="next">${eyeButton()}</span><small>Минимум 8 символов, буквы и цифры</small></label>
       <label class="acc-field"><span>Повтор пароля</span><span class="acc-pw"><input name="passwordConfirm" type="password" maxlength="71" autocomplete="new-password" enterkeyhint="${invite ? 'next' : 'go'}">${eyeButton()}</span></label>
       ${
         invite
           ? `<label class="acc-field acc-invite"><span>Код приглашения</span><input name="invite" maxlength="48" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="PT-XXXXX-XXXXX-…"><small>Код из сообщения организатора теста — можно вставить целиком. Нужен только один раз, при создании аккаунта.</small></label>`
           : ''
       }
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">Создать аккаунт</button>
         <button class="btn ghost wide" type="button" data-a="login">Уже есть аккаунт — войти</button>
         <button class="btn teal wide" type="button" data-a="back">Назад</button>
       </div>
     </form>
     <p class="acc-legal">Тестовая версия: пользовательское соглашение и политика конфиденциальности появятся перед публичным запуском. Название студии в игре не меняется.</p>`,
    (root, close) => {
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="login"]')!.addEventListener('click', () => openLogin(g));
      bindForm(root, async (f, fail) => {
        const input = { nickname: (f.nickname ?? '').trim(), email: (f.email ?? '').trim(), password: f.password ?? '', passwordConfirm: f.passwordConfirm ?? '' };
        const bad = checkRegistration(input) ?? (invite ? checkInvite(f.invite ?? '') : null);
        if (bad) return fail(accountText(bad), fieldOf(bad));
        const code = invite ? normalizeInvite(f.invite ?? '') : null;
        try {
          const r = await rt(g).register(code ? { ...input, invite: code } : input);
          g.audio.ui('confirm');
          if (r.manual || !mailOn(g)) showPending(g, input.email.toLowerCase());
          else showCheckMail(g, input.email.toLowerCase(), r.mailSent);
        } catch (e) {
          const code = e instanceof PrimeApiError ? e.code : '';
          fail(errText(e), fieldOf(code));
        }
      });
      (root.querySelector('input[name="nickname"]') as HTMLInputElement).focus({ preventScroll: true });
    },
    false,
  );
}

function showCheckMail(g: Game, email: string, mailSent: boolean): void {
  g.ui.modal(
    `<div class="h1">Подтвердите email</div>
     ${envNote(g)}
     <p class="acc-note">${
       isLocal(g)
         ? `${mailSent ? `Письмо со ссылкой отправлено на <b>${esc(email)}</b>.` : `Аккаунт создан, но письмо не отправилось (локальная почта не запущена?). Нажмите «Отправить ещё раз», когда backend работает.`} В локальной версии письма приходят в тестовую почту Mailpit: <a href="${LOCAL_MAIL}" target="_blank" rel="noopener">127.0.0.1:8025</a>. Откройте письмо и нажмите «Подтвердить email».`
         : mailSent
           ? `Письмо со ссылкой отправлено на <b>${esc(email)}</b>. Откройте его и нажмите «Подтвердить email». Если письма нет несколько минут — проверьте «Спам» или нажмите «Отправить ещё раз».`
           : `Аккаунт создан, но письмо пока не отправилось. Нажмите «Отправить ещё раз» чуть позже.`
     }</p>
     <p class="acc-note muted">Пока email не подтверждён, игра продолжается в гостевом профиле, облачное сохранение недоступно.</p>
     <div class="acc-err" role="alert" aria-live="polite"></div>
     <div class="modal-actions">
       <button class="btn wide" data-a="done">Я подтвердил</button>
       <button class="btn ghost wide" data-a="resend">Отправить письмо ещё раз</button>
       <button class="btn teal wide" data-a="later">Позже</button>
     </div>`,
    (root, close) => {
      const err = root.querySelector('.acc-err') as HTMLElement;
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="resend"]')!.addEventListener('click', () => {
        void rt(g)
          .resendVerification()
          .then(() => (err.textContent = 'Письмо отправлено ещё раз.'))
          .catch((e) => (err.textContent = errText(e)));
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
          : 'Email ещё не подтверждён. Откройте ссылку из письма.';
      if (err) err.textContent = msg;
      else g.ui.toast(msg);
      return;
    }
    continueLogin(g, plan);
  } catch (e) {
    if (err) err.textContent = errText(e);
    else g.ui.toast(errText(e));
  }
}

export function openLogin(g: Game): void {
  g.ui.modal(
    `<div class="h1">Вход в PRIME ID</div>
     ${envNote(g)}
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
       <label class="acc-field"><span>Пароль</span><span class="acc-pw"><input name="password" type="password" maxlength="71" autocomplete="current-password" enterkeyhint="go">${eyeButton()}</span></label>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">Войти</button>
         <button class="btn ghost wide" type="button" data-a="forgot">Забыли пароль?</button>
         <button class="btn ghost wide" type="button" data-a="register">Создать аккаунт</button>
         <button class="btn teal wide" type="button" data-a="back">Назад</button>
       </div>
     </form>`,
    (root, close) => {
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="register"]')!.addEventListener('click', () => openRegister(g));
      root.querySelector('[data-a="forgot"]')!.addEventListener('click', () => openForgot(g, (root.querySelector('input[name="email"]') as HTMLInputElement).value));
      bindForm(root, async (f, fail) => {
        const email = (f.email ?? '').trim();
        const bad = checkEmail(email);
        if (bad) return fail(accountText(bad), 'email');
        if (!f.password) return fail(accountText('password_empty'), 'password');
        try {
          const plan = await rt(g).login(email, f.password);
          g.audio.ui('confirm');
          continueLogin(g, plan);
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
    `<div class="h1">Восстановить доступ</div>
     ${envNote(g)}
     <p class="acc-note">Укажите email аккаунта — придёт ссылка для нового пароля${isLocal(g) ? ` (в локальной версии — в тестовую почту <a href="${LOCAL_MAIL}" target="_blank" rel="noopener">127.0.0.1:8025</a>)` : ''}. Ссылка действует 30 минут.</p>
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>Email</span><input name="email" type="email" inputmode="email" maxlength="254" autocomplete="username" autocapitalize="off" spellcheck="false" value="${esc(email)}" enterkeyhint="send"></label>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">Отправить ссылку</button>
         <button class="btn teal wide" type="button" data-a="back">Назад ко входу</button>
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
            `<div class="h1">Проверьте почту</div><p class="acc-note">Если аккаунт с адресом <b>${esc(em.toLowerCase())}</b> существует, письмо со ссылкой ${isLocal(g) ? 'уже в тестовой почте' : 'уже отправлено'}. Задайте новый пароль на открывшейся странице и войдите с ним.</p>
             <div class="modal-actions">${isLocal(g) ? '<button class="btn wide" data-a="mail">Открыть тестовую почту</button>' : ''}<button class="btn teal wide" data-a="login">Ко входу</button></div>`,
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
      g.ui.toast(`С возвращением, ${plan.me.nickname ?? 'продюсер'}!`, true);
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
            ? 'Сервер вернул сохранение, которое не удаётся прочитать. Его можно заменить прогрессом этого устройства — повреждённая версия останется в облачных копиях.'
            : kind === 'missing'
              ? 'На сервере больше нет сохранения этого аккаунта. Прогресс этого устройства можно сохранить в аккаунт заново.'
              : 'Прогресс на этом устройстве и в аккаунте изменился независимо. Выберите версию — вторая сохранится в облачных копиях. Ничего не объединяется автоматически.';
      const actions =
        kind === 'cloud-newer'
          ? `<button class="btn wide" data-a="cloud">Загрузить из аккаунта</button><button class="btn teal wide" data-a="later">Позже</button>`
          : kind === 'damaged' || kind === 'missing'
            ? `<button class="btn wide" data-a="device">${kind === 'missing' ? 'Сохранить прогресс устройства' : 'Заменить прогрессом устройства'}</button>${kind === 'damaged' ? '<button class="btn ghost wide" data-a="history">Облачные копии</button>' : ''}<button class="btn teal wide" data-a="later">Позже</button>`
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
          root.querySelector('[data-a="history"]')?.addEventListener('click', () => void openCloudHistory(g));
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

// ----------------------------------------------------------- cloud copies
const HISTORY_REASON: Record<string, string> = {
  previous: 'Предыдущая версия',
  'conflict-cloud': 'Версия аккаунта до решения конфликта',
  'conflict-device': 'Версия устройства из конфликта',
  'before-restore': 'Перед восстановлением',
  'before-restore-device': 'Устройство перед восстановлением',
  'session-device': 'С этого устройства · не попало в облако',
  damaged: 'Повреждённая версия',
};

async function openCloudHistory(g: Game): Promise<void> {
  const s = rt(g).sync;
  if (!s) return;
  let list: HistoryEntry[];
  try {
    list = await s.history();
  } catch (e) {
    g.ui.toast(errText(e));
    return;
  }
  const rows = list
    .map((h, i) => {
      const read = readCloudText(h.text);
      const line = read.ok ? `${esc(read.summary.orgName)} · ур. ${read.summary.level} · ${formatMoney(read.summary.money)} · матчей ${read.summary.matches}` : read.reason === 'newer' ? 'Сохранение более новой версии игры' : 'Не читается';
      return `<div class="sc-row"><div class="sc-info"><b>${whenIso(h.created)}</b><span>${HISTORY_REASON[h.reason] ?? 'Копия'} · ревизия ${h.revision}</span><small>${line}</small></div>
        <button class="btn ghost sc-act" data-i="${i}" ${read.ok ? '' : 'disabled'}>Восстановить</button></div>`;
    })
    .join('');
  g.ui.modal(
    `<div class="h1">Облачные копии</div>
     <p class="center muted acc-note">До 10 прошлых версий сохранения аккаунта на сервере. Восстановление создаёт новую версию — текущая тоже останется в копиях.</p>
     ${list.length ? `<div class="sc-list">${rows}</div>` : '<p class="muted acc-note">Копий пока нет: они появляются, когда сохранение аккаунта заменяется новым.</p>'}
     <div class="modal-actions"><button class="btn teal wide" data-a="back">Закрыть</button></div>`,
    (root, close) => {
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      root.querySelectorAll<HTMLButtonElement>('[data-i]').forEach((b) =>
        b.addEventListener('click', () => {
          const h = list[Number(b.dataset.i)];
          g.confirm(
            'Восстановить копию?',
            `${HISTORY_REASON[h.reason] ?? 'Копия'} · ${whenIso(h.created)}<br><br>Сохранение аккаунта станет этой версией (новой ревизией); текущая версия и несинхронизированный прогресс устройства сохранятся в облачных копиях. Игра перезапустится.`,
            'Восстановить',
            () =>
              void s.restore(h).then((ok) => {
                if (!ok) g.ui.toast(s.status === 'offline' ? 'Нет подключения — повторите позже' : 'Не удалось восстановить копию');
              }),
            () => void openCloudHistory(g),
          );
        }),
      );
    },
  );
}

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
  if (why === 'superseded') return showSessionTaken(g, r.session?.holder ?? '');
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
export function showSessionTaken(g: Game, holder: string): void {
  const r = rt(g);
  const unsynced = r.sync?.hasUnsynced() ?? false;
  g.ui.modal(
    `<div class="h1">PRIME ID ОТКРЫТ НА ДРУГОМ УСТРОЙСТВЕ</div>
     <p class="acc-note">Ваш игровой аккаунт сейчас используется в другой вкладке или на другом устройстве${holder ? ` (<b>${esc(holder)}</b>)` : ''}. Чтобы продолжить игру здесь, нажмите «Продолжить здесь».</p>
     ${unsynced ? '<p class="acc-note muted">Прогресс этой вкладки, который не успел попасть в PRIME CLOUD, не пропадёт: после «Продолжить здесь» он отправится в облако или, если на другом устройстве уже играли, сохранится в «Облачных копиях».</p>' : ''}
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
      root.querySelector('[data-a="guest"]')!.addEventListener('click', () => confirmGuest(g, () => showSessionTaken(g, holder)));
    },
    false,
  );
}

/** After the cloud replaced this device's unsent progress (another device had played on). */
export function showKeptDevice(g: Game): void {
  g.ui.modal(
    `<div class="h1">PRIME CLOUD</div>
     <p class="acc-note">Пока эта вкладка была неактивна, PRIME ID продолжили на другом устройстве. Загружен актуальный прогресс аккаунта.</p>
     <p class="acc-note muted">Изменения этого устройства, которые не успели попасть в облако, не удалены: они сохранены отдельно — PRIME ID → «Облачные копии» (и в резервных копиях на этом устройстве).</p>
     <div class="modal-actions"><button class="btn wide" data-a="ok">Понятно</button></div>`,
    (root, close) => root.querySelector('[data-a="ok"]')!.addEventListener('click', () => close()),
  );
}
