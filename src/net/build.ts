import type { ProfileId, SaveStorage } from '../meta/SaveSystem';
import { bootProfile } from './accountStore';
import { DEFAULT_LOCAL_API, NETWORK_OFF, effectiveFlag, resolveNetwork, type NetworkConfig } from './config';

// Alpha 1.8.1–1.8.2 — the build-time switch for accounts (browser only; the checks use config.ts).
//   local:  `npm run dev:accounts` (the accounts mode alone is enough — a folder copied in Finder
//           loses the dot-file .env.accounts, which only overrides the defaults);
//   beta / production: VITE_PRIME_ACCOUNTS=beta|production + an https VITE_PRIME_API_URL at build
//           time (stage 2 — nothing sets them yet).
// Without those settings — every build today, the published game included — ACCOUNTS_BUILD is the
// literal `false`: every `if (ACCOUNTS_BUILD)` block is dropped and the account code and the
// PocketBase SDK never reach the bundle (`npm run accounts` checks dist/).

export const ACCOUNTS_BUILD: boolean =
  (import.meta.env.DEV && (import.meta.env.MODE === 'accounts' || import.meta.env.VITE_PRIME_ACCOUNTS === 'local')) ||
  import.meta.env.VITE_PRIME_ACCOUNTS === 'beta' ||
  import.meta.env.VITE_PRIME_ACCOUNTS === 'production';

export function networkConfig(): NetworkConfig {
  if (!ACCOUNTS_BUILD) return NETWORK_OFF;
  const flag = effectiveFlag(import.meta.env.MODE, import.meta.env.VITE_PRIME_ACCOUNTS);
  return resolveNetwork({
    dev: import.meta.env.DEV,
    flag,
    // the local Mac backend has a default address; a real server never does
    url: import.meta.env.VITE_PRIME_API_URL || (flag === 'local' ? DEFAULT_LOCAL_API : ''),
    pageHost: typeof location !== 'undefined' ? location.hostname : undefined,
  });
}

/**
 * Dev builds only: why PRIME NETWORK is not running on this page, in words for PRIME ID (instead of
 * the block silently missing). Null in a production build and when accounts do run.
 */
export function accountsOffNotice(): string | null {
  if (!import.meta.env.DEV) return null;
  if (!ACCOUNTS_BUILD) {
    return 'Эта копия игры запущена без аккаунтов (npm run dev). Чтобы появились «Создать аккаунт» и «Войти», остановите её (Ctrl+C) и запустите npm run dev:accounts, затем откройте адрес Local, который покажет Vite.';
  }
  const c = networkConfig();
  if (c.mode !== 'off') return null;
  if (c.code === 'page') return `Локальные аккаунты работают только на странице, открытой с этого компьютера. Откройте http://localhost:${location.port || '5173'}/ (сейчас открыто ${location.host}).`;
  if (c.code === 'url') return 'Адрес локального сервера аккаунтов (VITE_PRIME_API_URL в .env.accounts) должен быть на этом компьютере: http://127.0.0.1:8090.';
  if (c.code === 'no-url') return 'Не задан адрес сервера аккаунтов (VITE_PRIME_API_URL) — см. .env.example.';
  if (c.code === 'insecure') return 'Адрес облачного сервера (VITE_PRIME_API_URL) должен начинаться с https:// — см. .env.example.';
  return 'Аккаунты выключены в этом запуске. Запустите npm run dev:accounts.';
}

export function browserStorage(): SaveStorage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** The local profile this page plays: an account only in a build with accounts on. */
export function buildBootProfile(): ProfileId {
  if (!ACCOUNTS_BUILD || networkConfig().mode === 'off') return 'guest';
  return bootProfile(browserStorage());
}
