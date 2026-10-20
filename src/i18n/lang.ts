// Alpha 1.8.4 — the language of PRIME ID (registration, sign-in, documents, account messages). The rest
// of the game is in Russian for now. The first visit follows the browser (Russian for ru/uk/be/kk,
// English otherwise); the RU · EN switch remembers the choice on this device.

export type Lang = 'ru' | 'en';

const KEY = 'primetime-showdown-lang-v1';
let current: Lang | null = null;
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* storage unavailable: follow the browser */
  }
  const l = (typeof navigator !== 'undefined' ? navigator.language || '' : '').toLowerCase();
  return /^(ru|uk|be|kk)\b/.test(l) || l === '' ? 'ru' : 'en';
}

export function lang(): Lang {
  if (!current) current = detect();
  return current;
}

export function setLang(l: Lang): void {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* the choice lasts for this page only */
  }
  for (const fn of listeners) fn();
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The text in the current language. */
export const tr = (ru: string, en: string): string => (lang() === 'en' ? en : ru);
