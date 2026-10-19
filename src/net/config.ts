// Alpha 1.8.1–1.8.2 — whether this build may talk to an accounts server at all, and where it is.
//
// Three environments (VITE_PRIME_ACCOUNTS — public build settings, never a secret):
//   local       the PocketBase on the developer's Mac (1.8.1): only the Vite dev server
//               (`npm run dev:accounts`), only http://127.0.0.1 / localhost, only a page opened
//               from that very computer. The accounts mode alone switches it on (a folder copied
//               in Finder loses the dot-file .env.accounts — the mode must be enough).
//   beta        the closed beta server (1.8.2, stage 2): any build — also the published one — but
//               only with an https:// API address (VITE_PRIME_API_URL, e.g. a permanent API domain).
//   production  the public server later: the same rules as beta.
// Anything else — no flag, an unknown value, beta without an https address — means no accounts at
// all: the game is the guest game, no account code runs, no request is made. The registration
// mode (closed beta by invite, …) is NOT a build setting: the server decides it (GET /api/prime/config).

export type AccountsMode = 'off' | 'local' | 'remote';
export type AccountsEnv = 'local' | 'beta' | 'production';

/** Why accounts are off: build (no accounts in this build), flag, no-url, url (local mode, not this computer), page (opened from another device), insecure (remote without https). */
export type NetworkOffCode = 'ok' | 'build' | 'flag' | 'no-url' | 'url' | 'page' | 'insecure';

export interface NetworkConfig {
  mode: AccountsMode;
  /** Which server this build talks to (null when off). */
  env: AccountsEnv | null;
  /** API base without a trailing slash ('' when off). */
  apiUrl: string;
  /** Why accounts are off (developer diagnostics). */
  reason: string;
  code: NetworkOffCode;
}

export const NETWORK_OFF: NetworkConfig = { mode: 'off', env: null, apiUrl: '', reason: 'accounts are off in this build', code: 'build' };

/** The local test backend of `npm run backend` (used when .env.accounts does not name another one). */
export const DEFAULT_LOCAL_API = 'http://127.0.0.1:8090';

/**
 * Is this a build that may run accounts at all? The local test: only the dev server in the accounts
 * mode (or with the flag). A beta / production build: when its flag says so (its API address is
 * checked next, in resolveNetwork). A published build without these settings never is.
 */
export function accountsSwitch(env: { dev: boolean; mode?: string; flag?: string }): boolean {
  return (env.dev && (env.mode === 'accounts' || env.flag === 'local')) || env.flag === 'beta' || env.flag === 'production';
}

/** The flag as the accounts mode implies it when .env.accounts is missing. */
export function effectiveFlag(mode: string | undefined, flag: string | undefined): string | undefined {
  return flag ?? (mode === 'accounts' ? 'local' : undefined);
}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '::1', '[::1]'];

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.includes(host.toLowerCase());
}

export function isLoopbackUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return (p.protocol === 'http:' || p.protocol === 'https:') && isLoopbackHost(p.hostname) && !p.username && !p.password;
  } catch {
    return false;
  }
}

/** A real server address: https, a host name or address, no user:password, no query or fragment. */
export function isSecureRemoteUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' && !!p.hostname && !isLoopbackHost(p.hostname) && !p.username && !p.password && !p.search && !p.hash;
  } catch {
    return false;
  }
}

export interface NetworkEnv {
  dev: boolean;
  flag?: string;
  url?: string;
  /** location.hostname of the page (undefined outside a browser). */
  pageHost?: string;
}

export function resolveNetwork(env: NetworkEnv): NetworkConfig {
  const off = (reason: string, code: NetworkOffCode): NetworkConfig => ({ mode: 'off', env: null, apiUrl: '', reason, code });
  const url = (env.url ?? '').trim();
  if (env.flag === 'beta' || env.flag === 'production') {
    if (!url) return off('VITE_PRIME_API_URL is empty', 'no-url');
    if (!isSecureRemoteUrl(url)) return off('the API address of a beta / production build must be https://<server> (no credentials, no query)', 'insecure');
    return { mode: 'remote', env: env.flag, apiUrl: url.replace(/\/+$/, ''), reason: '', code: 'ok' };
  }
  if (env.flag !== 'local') return off('VITE_PRIME_ACCOUNTS is not local / beta / production', 'flag');
  if (!env.dev) return off('local accounts exist only in the dev build', 'build');
  if (!url) return off('VITE_PRIME_API_URL is empty', 'no-url');
  if (!isLoopbackUrl(url)) return off('VITE_PRIME_API_URL must point at this computer (127.0.0.1 / localhost) in the local mode', 'url');
  if (env.pageHost !== undefined && !isLoopbackHost(env.pageHost)) return off('the page is not opened from this computer', 'page');
  return { mode: 'local', env: 'local', apiUrl: url.replace(/\/+$/, ''), reason: '', code: 'ok' };
}
