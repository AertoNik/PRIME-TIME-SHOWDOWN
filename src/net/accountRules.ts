import { lang } from '../i18n/lang';

// Alpha 1.8.1 — the registration rules as the form checks them before sending (instant hints).
// The server checks the very same rules again (backend/pb_hooks/lib/validate.js) and stays the
// authority; `npm run accounts` runs both over the same cases so they cannot drift apart.

const NICK_RE = /^[A-Za-z0-9_А-Яа-яЁё]{3,16}$/;
const LATIN_RE = /[A-Za-z]/;
const CYR_RE = /[А-Яа-яЁё]/;
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'system', 'root', 'guest', 'primetime', 'prime_time', 'primeid', 'pocketbase', 'null', 'undefined', 'админ', 'администратор', 'модератор', 'поддержка', 'гость'];
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"'.]{2,63}$/;

export function nicknameKey(nick: string): string {
  return nick.toLowerCase().replace(/ё/g, 'е');
}

export function checkNickname(nick: string): string | null {
  if (!nick.trim()) return 'nickname_empty';
  if (nick !== nick.trim()) return 'nickname_spaces';
  if (nick.length < 3) return 'nickname_short';
  if (nick.length > 16) return 'nickname_long';
  if (!NICK_RE.test(nick)) return 'nickname_chars';
  if (LATIN_RE.test(nick) && CYR_RE.test(nick)) return 'nickname_mixed';
  if (!/[A-Za-zА-Яа-яЁё0-9]/.test(nick)) return 'nickname_chars';
  if (RESERVED.includes(nicknameKey(nick))) return 'nickname_reserved';
  return null;
}

export function checkEmail(email: string): string | null {
  if (!email.trim()) return 'email_empty';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'email_invalid';
  return null;
}

function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function checkPassword(password: string, confirm: string | null, email = '', nick = ''): string | null {
  if (!password) return 'password_empty';
  if (password.length < 8) return 'password_short';
  if (password.length > 71 || utf8Length(password) > 72) return 'password_long';
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/[0-9]/.test(password)) return 'password_weak';
  const low = password.toLowerCase();
  if ((email && low === email.toLowerCase()) || (nick && low === nick.toLowerCase())) return 'password_weak';
  if (confirm !== null && confirm !== password) return 'password_mismatch';
  return null;
}

export function checkRegistration(b: { nickname: string; email: string; password: string; passwordConfirm: string }): string | null {
  return checkNickname(b.nickname) || checkEmail(b.email) || checkPassword(b.password, b.passwordConfirm, b.email, b.nickname);
}

// ------------------------------------------------------------------- invites (1.8.2)
const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * An invite as typed or pasted → its 26 canonical characters, or null when it cannot be a code (the
 * same rule as the server's normalizeInvite — only the format; whether it exists only the server knows).
 */
export function normalizeInvite(input: string): string | null {
  let s = input.trim().toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.startsWith('PT') && s.length === 28) s = s.slice(2);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 26) return null;
  for (const ch of s) if (!INVITE_ALPHABET.includes(ch)) return null;
  return s;
}

export function checkInvite(input: string): string | null {
  if (!input.trim()) return 'invite_required';
  return normalizeInvite(input) ? null : 'invite_invalid';
}

/** What the player reads for every code the form or the server can return. */
export const ACCOUNT_TEXT: Record<string, string> = {
  nickname_empty: 'Введите никнейм продюсера.',
  nickname_spaces: 'Уберите пробелы в начале и в конце никнейма.',
  nickname_short: 'Никнейм — от 3 символов.',
  nickname_long: 'Никнейм — не длиннее 16 символов.',
  nickname_chars: 'В никнейме можно использовать буквы, цифры и «_».',
  nickname_mixed: 'Никнейм — либо латиницей, либо кириллицей (не вперемешку).',
  nickname_reserved: 'Этот никнейм зарезервирован. Выберите другой.',
  nickname_taken: 'Этот никнейм уже занят.',
  email_empty: 'Введите email.',
  email_invalid: 'Проверьте адрес email.',
  email_taken: 'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
  password_empty: 'Введите пароль.',
  password_short: 'Пароль — минимум 8 символов.',
  password_long: 'Слишком длинный пароль.',
  password_weak: 'В пароле нужны буквы и цифры; он не должен совпадать с email или никнеймом.',
  password_mismatch: 'Пароли не совпадают.',
  register_failed: 'Не удалось создать аккаунт. Повторите попытку.',
  invite_required: 'Введите код приглашения.',
  invite_invalid: 'Код приглашения неверный. Проверьте, что он скопирован целиком.',
  invite_used: 'Этот код приглашения уже использован.',
  invite_expired: 'Срок действия кода приглашения истёк. Попросите новый.',
  registration_closed: 'Регистрация временно недоступна. Вход в существующий аккаунт работает.',
  mail_unavailable: 'Тестовый сервер пока не отправляет писем: аккаунты подтверждает организатор теста.',
  network_remote: 'Не удалось связаться с сервером PRIME NETWORK. Проверьте интернет и повторите — игра продолжает работать.',
  rate_limited: 'Слишком много попыток. Подождите минуту и повторите.',
  network: 'Сервер аккаунтов недоступен. Проверьте, что локальный backend запущен (npm run backend).',
  login_failed: 'Неверный email или пароль.',
  server_error: 'Ошибка сервера. Повторите попытку позже.',
  // 1.8.4
  consent_required: 'Отметьте обязательные пункты: соглашение и согласие на обработку данных.',
  legal_outdated: 'Документы только что обновились. Обновите страницу, чтобы увидеть новую версию.',
  challenge_invalid: 'Проверка устарела. Нажмите «Создать аккаунт» ещё раз.',
  register_failed_retry: 'Не удалось создать аккаунт. Повторите попытку.',
  resend_wait: 'Письмо уже отправлено. Следующее можно запросить чуть позже.',
  resend_limit: 'На сегодня писем на этот адрес достаточно. Проверьте «Спам» или попробуйте завтра.',
  mail_failed: 'Не удалось отправить письмо. Попробуйте через несколько минут.',
  terms_required: 'Сначала примите документы PRIME ID.',
  busy: 'Сервер сейчас перегружен. Повторите через минуту.',
};

/** 1.8.4: the same texts in English (PRIME ID can be switched to English). */
export const ACCOUNT_TEXT_EN: Record<string, string> = {
  nickname_empty: 'Enter a producer nickname.',
  nickname_spaces: 'Remove the spaces at the start and end of the nickname.',
  nickname_short: 'The nickname needs at least 3 characters.',
  nickname_long: 'The nickname can be at most 16 characters.',
  nickname_chars: 'Use letters, digits and «_» in the nickname.',
  nickname_mixed: 'Use either Latin or Cyrillic letters in the nickname, not both.',
  nickname_reserved: 'This nickname is reserved. Choose another one.',
  nickname_taken: 'This nickname is already taken.',
  email_empty: 'Enter your email.',
  email_invalid: 'Check the email address.',
  email_taken: 'This email is already registered. Sign in or reset the password.',
  password_empty: 'Enter a password.',
  password_short: 'The password needs at least 8 characters.',
  password_long: 'The password is too long.',
  password_weak: 'Use letters and digits; the password must not match the email or nickname.',
  password_mismatch: 'The passwords do not match.',
  register_failed: 'The account could not be created. Please try again.',
  invite_required: 'Enter the invite code.',
  invite_invalid: 'The invite code is wrong. Check that it was copied completely.',
  invite_used: 'This invite code has already been used.',
  invite_expired: 'This invite code has expired. Ask for a new one.',
  registration_closed: 'Registration is temporarily unavailable. Signing in to an existing account works.',
  mail_unavailable: 'This server does not send email yet: accounts are confirmed by the organiser.',
  network_remote: 'Could not reach the PRIME NETWORK server. Check the internet and try again — the game keeps working.',
  rate_limited: 'Too many attempts. Please wait a little and try again.',
  network: 'The accounts server is unavailable.',
  login_failed: 'Wrong email or password.',
  server_error: 'Server error. Please try again later.',
  consent_required: 'Please tick the required boxes: the terms and the consent to data processing.',
  legal_outdated: 'The documents were just updated. Reload the page to see the new version.',
  challenge_invalid: 'The check expired. Press «Create account» again.',
  register_failed_retry: 'The account could not be created. Please try again.',
  resend_wait: 'The email was just sent. You can ask for another one a little later.',
  resend_limit: 'Enough emails to this address for today. Check the spam folder or try tomorrow.',
  mail_failed: 'The email could not be sent. Please try again in a few minutes.',
  terms_required: 'Please accept the PRIME ID documents first.',
  busy: 'The server is busy right now. Please try again in a minute.',
};

export function accountText(code: string): string {
  if (lang() === 'en') return ACCOUNT_TEXT_EN[code] ?? ACCOUNT_TEXT_EN.server_error;
  return ACCOUNT_TEXT[code] ?? ACCOUNT_TEXT.server_error;
}
