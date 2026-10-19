// PRIME TIME: SHOWDOWN — Alpha 1.8.1: what the server accepts. Plain JS shared by the PocketBase
// hooks (goja) and the Node checks (`npm run accounts`), so both run exactly the same rules.
//
// The game still runs every fight in the browser: a save from a signed-in player is NOT proof of
// real wins or money. These checks only keep the stored data well-formed — types, ranges, known
// ids, the relations the game itself guarantees (decks, worn items, a seasonal star's purchase) —
// so a broken or hand-made file cannot be stored as a career. Competitive rankings (1.8.5) must be
// built from separately verified match results, never from SaveData.

const R = require('./save_rules.js');

const MAX_SAVE_BYTES = 512 * 1024;
const MAX_UNKNOWN_TOP_FIELDS = 24;
const BIG = 1e10; // money, fans
const COUNT = 1e8; // matches, wins, tokens …

const NICK_RE = /^[A-Za-z0-9_А-Яа-яЁё]{3,16}$/;
const LATIN_RE = /[A-Za-z]/;
const CYR_RE = /[А-Яа-яЁё]/;
const RESERVED = ['admin', 'administrator', 'moderator', 'support', 'system', 'root', 'guest', 'primetime', 'prime_time', 'primeid', 'pocketbase', 'null', 'undefined', 'админ', 'администратор', 'модератор', 'поддержка', 'гость'];
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"'.]{2,63}$/;

/** «NightProducer», «nightproducer» and «NIGHTPRODUCER» are one nickname (ё = е as well). */
function nicknameKey(nick) {
  return String(nick).toLowerCase().replace(/ё/g, 'е');
}

/** null when fine, otherwise an error code (the client shows its own text for each). */
function checkNickname(nick) {
  if (typeof nick !== 'string' || !nick.trim()) return 'nickname_empty';
  if (nick !== nick.trim()) return 'nickname_spaces';
  if (nick.length < 3) return 'nickname_short';
  if (nick.length > 16) return 'nickname_long';
  if (!NICK_RE.test(nick)) return 'nickname_chars';
  // one alphabet per nickname: «NightРroducer» with a Cyrillic Р must not pass for «NightProducer»
  if (LATIN_RE.test(nick) && CYR_RE.test(nick)) return 'nickname_mixed';
  if (!/[A-Za-zА-Яа-яЁё0-9]/.test(nick)) return 'nickname_chars';
  if (RESERVED.indexOf(nicknameKey(nick)) >= 0) return 'nickname_reserved';
  return null;
}

function checkEmail(email) {
  if (typeof email !== 'string' || !email.trim()) return 'email_empty';
  if (email.length > 254 || !EMAIL_RE.test(email)) return 'email_invalid';
  return null;
}

/** UTF-8 length (bcrypt reads at most 72 bytes). */
function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function checkPassword(password, confirm, email, nick) {
  if (typeof password !== 'string' || !password) return 'password_empty';
  if (password.length < 8) return 'password_short';
  if (password.length > 71 || utf8Length(password) > 72) return 'password_long';
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/[0-9]/.test(password)) return 'password_weak';
  const low = password.toLowerCase();
  if ((email && low === String(email).toLowerCase()) || (nick && low === String(nick).toLowerCase())) return 'password_weak';
  if (typeof confirm === 'string' && confirm !== password) return 'password_mismatch';
  return null;
}

// ------------------------------------------------------------------- invites (1.8.2)
/** Crockford base32 (no I, L, O, U): 26 characters = 130 random bits. */
const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const INVITE_LENGTH = 26;

/**
 * An invite as typed or pasted («PT-7K3QM-…», lower case, spaces, O for 0…) → its 26 canonical
 * characters, or null when it cannot be a code. Never says whether such a code exists.
 */
function normalizeInvite(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim().toUpperCase().replace(/[\s\-_.]/g, '');
  if (s.indexOf('PT') === 0 && s.length === INVITE_LENGTH + 2) s = s.slice(2);
  s = s.replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== INVITE_LENGTH) return null;
  for (let i = 0; i < s.length; i++) if (INVITE_ALPHABET.indexOf(s[i]) < 0) return null;
  return s;
}

/** How a canonical code is printed for people: PT-XXXXX-XXXXX-XXXXX-XXXXX-XXXXXX. */
function formatInvite(code) {
  return 'PT-' + code.slice(0, 5) + '-' + code.slice(5, 10) + '-' + code.slice(10, 15) + '-' + code.slice(15, 20) + '-' + code.slice(20);
}

/** The text that is hashed and stored (never the code itself). */
function inviteHashInput(code) {
  return 'prime-invite:v1:' + code;
}

/**
 * Registration mode of this server: only an exact, known, lower-case value counts (surrounding spaces
 * aside) — «Public», «open», «yes» or a missing variable all mean «disabled». Public registration
 * can never switch on by accident.
 */
function registrationMode(value) {
  const v = String(value || '').trim();
  return v === 'invite_only' || v === 'public' || v === 'disabled' ? v : 'disabled';
}

function checkRegistration(b) {
  return checkNickname(b.nickname) || checkEmail(b.email) || checkPassword(b.password, b.passwordConfirm, b.email, b.nickname);
}

// ---------------------------------------------------------------------------- SaveData
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function makeChecker() {
  const errs = [];
  const fail = (where, what) => {
    if (errs.length < 12) errs.push(where + ': ' + what);
  };
  const num = (v, where, max, opts) => {
    const o = opts || {};
    if (typeof v !== 'number' || !isFinite(v)) return fail(where, 'not a number');
    if (!o.signed && v < 0) return fail(where, 'negative');
    if (o.int && Math.floor(v) !== v) return fail(where, 'not an integer');
    if (max !== undefined && Math.abs(v) > max) return fail(where, 'too large');
  };
  const optNum = (o, k, where, max, opts) => {
    if (o[k] !== undefined) num(o[k], where + '.' + k, max, opts);
  };
  const bool = (v, where) => {
    if (typeof v !== 'boolean') fail(where, 'not a boolean');
  };
  const str = (v, where, max) => {
    if (typeof v !== 'string') return fail(where, 'not a string');
    if (v.length > max) fail(where, 'too long');
  };
  const oneOf = (v, list, where) => {
    if (list.indexOf(v) < 0) fail(where, 'unknown value');
  };
  const idList = (v, list, where, max) => {
    if (!Array.isArray(v)) return fail(where, 'not a list');
    if (v.length > max) return fail(where, 'too many');
    const seen = {};
    for (let i = 0; i < v.length; i++) {
      if (list.indexOf(v[i]) < 0) return fail(where, 'unknown id');
      if (seen[v[i]]) return fail(where, 'duplicate id');
      seen[v[i]] = true;
    }
  };
  return { errs, fail, num, optNum, bool, str, oneOf, idList };
}

/**
 * Check one save object (already JSON-parsed). Returns [] when the server may store it,
 * otherwise a short list of problems (for the logs and the developer — never shown to players).
 */
function validateSave(s) {
  const c = makeChecker();
  const { fail, num, optNum, bool, str, oneOf, idList } = c;
  if (!isObj(s)) return ['save: not an object'];
  const fighterIds = Object.keys(R.fighters);
  const cosmeticIds = Object.keys(R.cosmetics);

  num(s.version, 'version', R.schemaMax, { int: true });
  if (typeof s.version === 'number' && s.version < 1) fail('version', 'below 1');
  str(s.orgName, 'orgName', 28);
  if (typeof s.orgName === 'string' && !s.orgName.trim()) fail('orgName', 'empty');
  num(s.money, 'money', BIG);
  num(s.reputation, 'reputation', BIG);
  for (const k of ['matches', 'wins', 'losses', 'draws', 'totalEarned', 'fansEarned', 'bestCombosInMatch', 'bestPerfectsInMatch', 'proWins', 'championWins']) {
    num(s[k], k, k === 'totalEarned' || k === 'fansEarned' ? BIG : COUNT);
  }
  num(s.bestRating, 'bestRating', 100);
  if (s.seed !== undefined) num(s.seed, 'seed', 1e15, { signed: true });

  // fighters: every id known, numbers sane, decks legal (basic six + own signature + bought cards)
  const owned = s.cards && Array.isArray(s.cards.owned) ? s.cards.owned : [];
  if (!isObj(s.cards)) fail('cards', 'missing');
  else idList(s.cards.owned, R.shopCards, 'cards.owned', R.shopCards.length);
  if (!isObj(s.fighters)) fail('fighters', 'missing');
  else {
    for (const id of Object.keys(s.fighters)) {
      if (fighterIds.indexOf(id) < 0) {
        fail('fighters.' + id, 'unknown fighter');
        continue;
      }
      const f = s.fighters[id];
      const w = 'fighters.' + id;
      if (!isObj(f)) {
        fail(w, 'not an object');
        continue;
      }
      bool(f.unlocked, w + '.unlocked');
      for (const k of ['wins', 'losses', 'draws', 'matches', 'classicWins', 'streak', 'bestStreak']) optNum(f, k, w, COUNT, { int: k === 'streak' || k === 'bestStreak' });
      optNum(f, 'fans', w, BIG);
      optNum(f, 'bestRating', w, 100);
      if (typeof f.classicWins === 'number' && typeof f.wins === 'number' && f.classicWins > f.wins) fail(w + '.classicWins', 'more than wins');
      if (typeof f.streak === 'number' && typeof f.bestStreak === 'number' && f.bestStreak < f.streak) fail(w + '.bestStreak', 'below the current streak');
      const allowed = R.universalCards.concat([R.fighters[id].signature], owned);
      if (!Array.isArray(f.deck) || f.deck.length !== 4) fail(w + '.deck', 'not four cards');
      else idList(f.deck, allowed, w + '.deck', 4);
      if (R.fighters[id].starter && f.unlocked !== true && id === 'ray') fail(w + '.unlocked', 'the first fighter is always signed');
    }
    // a seasonal star is opened only in its event's exchange — the purchase record must be there
    for (const id of fighterIds) {
      const f = s.fighters[id];
      if (!R.fighters[id].seasonal || !isObj(f) || f.unlocked !== true) continue;
      let bought = false;
      if (isObj(s.events)) {
        for (const e of Object.keys(s.events)) {
          const list = isObj(s.events[e]) && Array.isArray(s.events[e].fighters) ? s.events[e].fighters : [];
          for (const x of list) if (isObj(x) && x.id === id) bought = true;
        }
      }
      if (!bought) fail('fighters.' + id, 'seasonal star without its purchase record');
    }
  }
  if (typeof s.selected !== 'string' || fighterIds.indexOf(s.selected) < 0) fail('selected', 'unknown fighter');
  else if (isObj(s.fighters) && isObj(s.fighters[s.selected]) && s.fighters[s.selected].unlocked !== true) fail('selected', 'not signed');
  oneOf(s.difficulty, R.difficulties, 'difficulty');
  if (s.goals !== undefined) {
    if (!isObj(s.goals)) fail('goals', 'not an object');
    else
      for (const g of Object.keys(s.goals)) {
        if (R.goals.indexOf(g) < 0) fail('goals.' + g, 'unknown goal');
        else if (!isObj(s.goals[g])) fail('goals.' + g, 'not an object');
        else {
          bool(s.goals[g].done, 'goals.' + g + '.done');
          bool(s.goals[g].claimed, 'goals.' + g + '.claimed');
        }
      }
  }
  if (s.settings !== undefined && !isObj(s.settings)) fail('settings', 'not an object');
  oneOf(s.nextRival, R.rivals, 'nextRival');
  if (s.lastRival !== null && s.lastRival !== undefined) oneOf(s.lastRival, R.rivals, 'lastRival');
  if (s.hintsSeen !== undefined) bool(s.hintsSeen, 'hintsSeen');
  if (s.arena !== undefined && s.arena !== 'random') oneOf(s.arena, R.arenas, 'arena');
  if (s.careerClaimed !== undefined) idList(s.careerClaimed, R.stages, 'careerClaimed', R.stages.length);
  if (s.tutorial !== undefined) oneOf(s.tutorial, R.tutorial, 'tutorial');
  if (s.streak !== undefined) {
    if (!isObj(s.streak)) fail('streak', 'not an object');
    else {
      num(s.streak.current, 'streak.current', COUNT, { int: true });
      num(s.streak.best, 'streak.best', COUNT, { int: true });
      if (s.streak.best < s.streak.current) fail('streak.best', 'below the current streak');
      optNum(s.streak, 'since', 'streak', 1e14);
    }
  }

  // seasonal events
  if (s.events !== undefined) {
    if (!isObj(s.events)) fail('events', 'not an object');
    else {
      const ids = Object.keys(s.events);
      if (ids.length > 64) fail('events', 'too many');
      for (const id of ids) {
        const e = s.events[id];
        const w = 'events.' + id;
        if (id.length > 64 || !isObj(e)) {
          fail(w, 'bad entry');
          continue;
        }
        for (const k of ['tokens', 'earned', 'spent', 'dayTokens']) optNum(e, k, w, COUNT);
        if (e.bought !== undefined) idList(e.bought, cosmeticIds, w + '.bought', cosmeticIds.length);
        if (e.fighters !== undefined) {
          if (!Array.isArray(e.fighters) || e.fighters.length > fighterIds.length) fail(w + '.fighters', 'bad list');
          else for (const x of e.fighters) if (!isObj(x) || fighterIds.indexOf(x.id) < 0 || !R.fighters[x.id].seasonal) fail(w + '.fighters', 'not a seasonal star');
        }
        if (e.quests !== undefined && !isObj(e.quests)) fail(w + '.quests', 'not an object');
        if (e.grandClaimed !== undefined) bool(e.grandClaimed, w + '.grandClaimed');
      }
    }
  }

  // MY COLLECTION: owned items are known ids; worn items are owned; personal items belong to fighters
  if (s.cosmetics !== undefined) {
    const k = s.cosmetics;
    if (!isObj(k)) fail('cosmetics', 'not an object');
    else {
      idList(k.owned, cosmeticIds, 'cosmetics.owned', cosmeticIds.length);
      const ownedCos = Array.isArray(k.owned) ? k.owned : [];
      if (k.equipped !== undefined) {
        if (!isObj(k.equipped)) fail('cosmetics.equipped', 'not an object');
        else
          for (const slot of Object.keys(k.equipped)) {
            if (R.cosmeticSlots.indexOf(slot) < 0) fail('cosmetics.equipped.' + slot, 'unknown slot');
            else if (ownedCos.indexOf(k.equipped[slot]) < 0) fail('cosmetics.equipped.' + slot, 'not owned');
          }
      }
      if (k.seen !== undefined) idList(k.seen, cosmeticIds, 'cosmetics.seen', cosmeticIds.length);
      if (k.unassigned !== undefined) idList(k.unassigned, cosmeticIds, 'cosmetics.unassigned', cosmeticIds.length);
      if (k.history !== undefined && (!Array.isArray(k.history) || k.history.length > 500)) fail('cosmetics.history', 'bad list');
      if (k.personal !== undefined) {
        if (!isObj(k.personal)) fail('cosmetics.personal', 'not an object');
        else
          for (const id of Object.keys(k.personal)) {
            if (ownedCos.indexOf(id) < 0) fail('cosmetics.personal.' + id, 'not owned');
            idList(k.personal[id], fighterIds, 'cosmetics.personal.' + id, fighterIds.length);
          }
      }
      if (k.personalEquipped !== undefined) {
        if (!isObj(k.personalEquipped)) fail('cosmetics.personalEquipped', 'not an object');
        else
          for (const f of Object.keys(k.personalEquipped)) {
            if (fighterIds.indexOf(f) < 0) {
              fail('cosmetics.personalEquipped.' + f, 'unknown fighter');
              continue;
            }
            const worn = k.personalEquipped[f];
            if (!isObj(worn)) continue;
            for (const slot of Object.keys(worn)) {
              const id = worn[slot];
              const owners = isObj(k.personal) && Array.isArray(k.personal[id]) ? k.personal[id] : [];
              if (owners.indexOf(f) < 0) fail('cosmetics.personalEquipped.' + f, 'item not earned by this fighter');
            }
          }
      }
    }
  }

  // game modes
  if (s.modes !== undefined) {
    const m = s.modes;
    if (!isObj(m)) fail('modes', 'not an object');
    else {
      if (isObj(m.survival)) {
        const v = m.survival;
        for (const key of ['runs', 'completions', 'bestScore', 'recordAt']) optNum(v, key, 'modes.survival', key === 'recordAt' ? 1e14 : COUNT);
        optNum(v, 'bestWave', 'modes.survival', R.survivalWaves, { int: true });
        if (v.recordFighter !== null && v.recordFighter !== undefined) oneOf(v.recordFighter, fighterIds, 'modes.survival.recordFighter');
        if (v.active !== null && v.active !== undefined) {
          const a = v.active;
          if (!isObj(a)) fail('modes.survival.active', 'not an object');
          else {
            oneOf(a.fighter, fighterIds, 'modes.survival.active.fighter');
            if (fighterIds.indexOf(a.fighter) >= 0) {
              const allowed = R.universalCards.concat([R.fighters[a.fighter].signature], owned);
              idList(a.deck, allowed, 'modes.survival.active.deck', 4);
            }
            if (!Array.isArray(a.rivals) || a.rivals.length !== R.survivalWaves) fail('modes.survival.active.rivals', 'bad list');
            else for (const r of a.rivals) oneOf(r, R.rivals, 'modes.survival.active.rivals');
            optNum(a, 'wave', 'modes.survival.active', R.survivalWaves, { int: true });
            optNum(a, 'hpFrac', 'modes.survival.active', 1);
          }
        }
      } else if (m.survival !== undefined) fail('modes.survival', 'not an object');
      for (const group of ['challenges', 'boss']) {
        const g = m[group];
        if (g === undefined) continue;
        if (!isObj(g)) {
          fail('modes.' + group, 'not an object');
          continue;
        }
        const ids = Object.keys(g);
        if (ids.length > 64) fail('modes.' + group, 'too many');
        for (const id of ids) {
          const p = g[id];
          const w = 'modes.' + group + '.' + id;
          if (id.length > 48 || !isObj(p)) {
            fail(w, 'bad entry');
            continue;
          }
          const done = group === 'boss' ? 'wins' : 'clears';
          optNum(p, done, w, COUNT, { int: true });
          optNum(p, 'attempts', w, COUNT, { int: true });
          if (typeof p.attempts === 'number' && typeof p[done] === 'number' && p.attempts < p[done]) fail(w, 'more ' + done + ' than attempts');
          if (group === 'boss' && p.history !== undefined && (!Array.isArray(p.history) || p.history.length > 10)) fail(w + '.history', 'bad list');
        }
      }
    }
  }

  // forward compatibility: a few unknown top-level fields (a newer minor's additions) are kept
  const known = ['version', 'orgName', 'money', 'reputation', 'matches', 'wins', 'losses', 'draws', 'bestRating', 'totalEarned', 'fansEarned', 'bestCombosInMatch', 'bestPerfectsInMatch', 'proWins', 'championWins', 'fighters', 'selected', 'difficulty', 'goals', 'settings', 'nextRival', 'lastRival', 'seed', 'hintsSeen', 'events', 'cosmetics', 'modes', 'arena', 'careerClaimed', 'cards', 'tutorial', 'streak'];
  let unknown = 0;
  for (const k of Object.keys(s)) if (known.indexOf(k) < 0) unknown++;
  if (unknown > MAX_UNKNOWN_TOP_FIELDS) fail('save', 'too many unknown fields');
  return c.errs;
}

/** Parse + check a save text as uploaded. { ok, save, schema } or { ok: false, code, problems }. */
function checkSaveText(text) {
  if (typeof text !== 'string' || !text) return { ok: false, code: 'invalid_data', problems: ['data: missing'] };
  if (utf8Length(text) > MAX_SAVE_BYTES) return { ok: false, code: 'too_large', problems: ['data: larger than 512 KB'] };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (_) {
    return { ok: false, code: 'invalid_json', problems: ['data: not JSON'] };
  }
  if (!isObj(obj)) return { ok: false, code: 'invalid_data', problems: ['data: not an object'] };
  if (typeof obj.version === 'number' && obj.version > R.schemaMax) return { ok: false, code: 'schema_unsupported', problems: ['version ' + obj.version + ' > ' + R.schemaMax] };
  const problems = validateSave(obj);
  if (problems.length) return { ok: false, code: 'invalid_data', problems };
  return { ok: true, save: obj, schema: obj.version };
}

module.exports = {
  MAX_SAVE_BYTES,
  INVITE_ALPHABET,
  INVITE_LENGTH,
  normalizeInvite,
  formatInvite,
  inviteHashInput,
  registrationMode,
  nicknameKey,
  checkNickname,
  checkEmail,
  checkPassword,
  checkRegistration,
  validateSave,
  checkSaveText,
  utf8Length,
};
