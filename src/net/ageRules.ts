import type { AgeConfig } from './PrimeApi';

// Alpha 1.8.4 — the age question of the PRIME ID form. The SERVER decides (backend/pb_hooks/
// lib/age_rules.js, the same rules); the game uses its numbers only to answer at once. The country is
// asked only when the answer depends on it (never by default) — and then only what the player names
// counts, never a guess from the address.

// the same list as the server (npm run public:test compares them); ZZ = «another country / not listed»
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW ZZ'
).split(' ');

/** Until a server says otherwise: PRIME ID from 14 (1.8.9.5), on one's own from 18. */
export const DEFAULT_AGE: AgeConfig = { min: 14, self: 18, rules: {}, closed: [] };

export type AgeDecision =
  | { ok: true; band: '14-17' | '18+' }
  | { ok: false; code: 'country_invalid' | 'country_required' | 'age_invalid' | 'age_too_young' | 'country_unavailable' | 'age_guardian_required' };

/** Does the answer for this age depend on the country (the same rule as the server's needsCountry)? */
export function needsCountry(cfg: AgeConfig, age: number): boolean {
  const ages = Object.values(cfg.rules);
  if (cfg.closed.length || ages.some((a) => a > cfg.self)) return true;
  return age < cfg.self && ages.length > 0;
}

/** The same decision as the server's (lib/age_rules.js); `country` may be '' (not asked). */
export function ageDecision(cfg: AgeConfig, country: string, age: number): AgeDecision {
  if (!Number.isInteger(age) || age < 1 || age > 120) return { ok: false, code: 'age_invalid' };
  if (age < cfg.min) return { ok: false, code: 'age_too_young' };
  if (!country) {
    if (needsCountry(cfg, age)) return { ok: false, code: 'country_required' };
  } else if (!COUNTRY_CODES.includes(country)) return { ok: false, code: 'country_invalid' };
  if (country && cfg.closed.includes(country)) return { ok: false, code: 'country_unavailable' };
  if (age < ((country && cfg.rules[country]) || cfg.self)) return { ok: false, code: 'age_guardian_required' };
  return { ok: true, band: age >= 18 ? '18+' : '14-17' };
}

/** The country's name in the player's language (the browser knows them all); the code if it does not. */
export function countryName(code: string, lang: 'ru' | 'en'): string {
  if (code === 'ZZ') return lang === 'ru' ? 'Другая страна / не указывать' : 'Another country / prefer not to say';
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The region of the browser's language («ru-RU» → RU) — only to put it first in the list, never chosen for the player. */
export function browserRegion(): string | null {
  const l = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  const m = /[-_]([A-Za-z]{2})$/.exec(l);
  const c = m ? m[1].toUpperCase() : '';
  return COUNTRY_CODES.includes(c) && c !== 'ZZ' ? c : null;
}

/** The list for the select: sorted by name, the browser's region first, «another country» last. */
export function countryOptions(lang: 'ru' | 'en'): { code: string; name: string }[] {
  const all = COUNTRY_CODES.filter((c) => c !== 'ZZ')
    .map((code) => ({ code, name: countryName(code, lang) }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
  const first = browserRegion();
  const top = first ? all.filter((c) => c.code === first) : [];
  return [...top, ...all.filter((c) => c.code !== first), { code: 'ZZ', name: countryName('ZZ', lang) }];
}
