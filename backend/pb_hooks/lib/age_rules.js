// PRIME TIME: SHOWDOWN — Alpha 1.8.4: who may create a PRIME ID on their own. Plain JS shared by the
// PocketBase hooks (goja) and the Node checks; the game reads the same numbers from GET /api/prime/config.
//
// The product decision is «PRIME ID from 13». Whether a 13–17-year-old may sign up WITHOUT a parent
// depends on the country — and these rules are NOT decided here. Until the owner (with a lawyer)
// confirms a country's age, that country uses SELF_AGE (18): younger players keep the guest mode.
// Confirmed ages are set on the server, not in the code:
//
//   PRIME_AGE_RULES=US:13,GB:13          the minimum age for registering without a parent, per country
//                                        (13…25; a country not listed: 18)
//   PRIME_CLOSED_COUNTRIES=XX,YY         no new PRIME ID from these countries at all
//
// There is NO parental-consent procedure yet: a player below their country's age is told so and
// keeps playing as a guest — the game never pretends a checkbox is a parent's consent.
// Only the country the player names counts (never a guess from the IP). Nothing but «13-17» / «18+»
// and the country (if asked) is stored — never the exact age or a date of birth.
//
// 1.8.4 (simplified form): the age is ONE field of the registration form; the country is asked only
// when the answer depends on it — confirmed country ages exist and the player is 13–17, or some
// country is closed / needs more than 18. With the default settings nobody is asked for a country.

const MIN_AGE = 13;
const SELF_AGE = 18;
const MAX_AGE = 120;

// ISO 3166-1 alpha-2, plus XK (Kosovo, widely used) and ZZ («another country / prefer not to say»)
const COUNTRIES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO ' +
  'FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE ' +
  'JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO ' +
  'MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW ' +
  'PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM ' +
  'TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW ZZ'
).split(' ');

function isCountry(c) {
  return typeof c === 'string' && COUNTRIES.indexOf(c) >= 0;
}

/** «US:13,GB:13» → { US: 13, GB: 13 }; anything malformed is left out (and so stays at 18). */
function parseRules(text) {
  const out = {};
  for (const part of String(text || '').split(',')) {
    const m = /^\s*([A-Z]{2})\s*:\s*(\d{1,2})\s*$/.exec(part);
    if (!m || m[1] === 'ZZ' || !isCountry(m[1])) continue;
    const n = parseInt(m[2], 10);
    if (n >= MIN_AGE && n <= 25) out[m[1]] = n;
  }
  return out;
}

/** «XX,YY» → ['XX', 'YY'] (known codes only). */
function parseClosed(text) {
  const out = [];
  for (const part of String(text || '').split(',')) {
    const c = part.trim().toUpperCase();
    if (isCountry(c) && c !== 'ZZ' && out.indexOf(c) < 0) out.push(c);
  }
  return out;
}

/** Does the answer for this age depend on the country (with these server settings)? */
function needsCountry(age, rules, closed) {
  const r = rules || {};
  const codes = Object.keys(r);
  if ((closed || []).length) return true;
  for (const c of codes) if (r[c] > SELF_AGE) return true;
  return age < SELF_AGE && codes.length > 0;
}

/**
 * May this player create a PRIME ID on their own? { ok: true, band } or { code }:
 *   age_invalid / country_invalid      the request is malformed
 *   age_too_young                      under 13 — no PRIME ID at all (guest mode only)
 *   country_required                   the answer depends on the country — the form asks for it
 *   country_unavailable                registration from that country is closed
 *   age_guardian_required              under the country's age: a parent would have to agree — not available yet
 * `country` may be '' (not asked).
 */
function decide(country, age, rules, closed) {
  if (typeof age !== 'number' || !isFinite(age) || Math.floor(age) !== age || age < 1 || age > MAX_AGE) return { code: 'age_invalid' };
  if (age < MIN_AGE) return { code: 'age_too_young' };
  const c = typeof country === 'string' ? country : '';
  if (!c) {
    if (needsCountry(age, rules, closed)) return { code: 'country_required' };
  } else if (!isCountry(c)) return { code: 'country_invalid' };
  if (c && (closed || []).indexOf(c) >= 0) return { code: 'country_unavailable' };
  const self = c && rules && rules[c] ? rules[c] : SELF_AGE;
  if (age < self) return { code: 'age_guardian_required' };
  return { ok: true, band: age >= 18 ? '18+' : '13-17' };
}

module.exports = { MIN_AGE, SELF_AGE, MAX_AGE, COUNTRIES, isCountry, parseRules, parseClosed, needsCountry, decide };
