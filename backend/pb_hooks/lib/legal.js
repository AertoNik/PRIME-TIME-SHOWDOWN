// PRIME TIME: SHOWDOWN — Alpha 1.8.4: the documents of PRIME ID and what each account accepted.
//
//   terms     Пользовательское соглашение / Terms of Use — ACCEPTED (a checkbox, needed for an account)
//   consent   Согласие на обработку персональных данных — a SEPARATE document and checkbox (Russian
//             law wants a consent kept apart from other documents). `required` can be switched off
//             here if the owner's lawyer decides the account rests on the contract alone.
//   privacy   Политика конфиденциальности / Privacy Policy — a NOTICE: shown and linked, never «accepted»;
//             the version a player was shown is still written down.
//
// The texts live in the game's public folder (public/legal/<ru|en>/<doc>.html); their version must
// equal `version` below (npm run public:test checks it).
//   version   the current text. A small fix (typo, contact): raise `version` only — nobody is asked again.
//   reaccept  the oldest version still good enough. A real change of the rules: raise both — every
//             account then accepts the new text at its next start, before PRIME CLOUD continues.
//
// Records (collection «consents») are written only here, from the hooks: nobody can read or change
// them through the API, and they go with the account when it is deleted.

// version 2 (20.10.2026): the release texts replaced the version-1 drafts — a real change, so `reaccept`
// is 2 as well (an account that accepted the drafts accepts the release texts once)
// version 3 of terms and privacy (24.10.2026, Alpha 1.8.8): PRIME SHOP purchases added. The rules for playing
// do not change — every purchase rule lives in the public offer, which a buyer accepts separately in PRIME
// CHECKOUT — so terms keep `reaccept: 2`: nobody is stopped at the next start; new accounts accept version 3.
// terms 4, consent 3, privacy 4 (24.10.2026): the operator's name corrected to its passport spelling — a small fix,
// so `version` only: nobody is asked again; earlier records keep the version they name.
const DOCS = {
  terms: { version: 4, reaccept: 2, required: true },
  consent: { version: 3, reaccept: 2, required: true },
  privacy: { version: 4, reaccept: 0, required: false },
};

/** The documents a player must tick (in this order). */
function requiredDocs() {
  return Object.keys(DOCS).filter((d) => DOCS[d].required);
}

/** What /api/prime/config tells the game. */
function publicInfo() {
  const out = {};
  for (const d of Object.keys(DOCS)) out[d] = { v: DOCS[d].version, required: DOCS[d].required };
  return out;
}

function latest(app, uid, doc) {
  try {
    const list = app.findRecordsByFilter('consents', 'user = {:u} && doc = {:d}', '-version,-created', 1, 0, { u: uid, d: doc });
    return list && list.length ? list[0] : null;
  } catch (_) {
    return null;
  }
}

/**
 * What this account still has to do before PRIME CLOUD continues: ['terms', 'consent', 'age'] or
 * a part of it ([] = nothing). Accounts made before 1.8.4 have no records yet: they are asked once.
 */
function needs(app, uid) {
  const out = [];
  for (const d of requiredDocs()) {
    const r = latest(app, uid, d);
    if (!r || r.getInt('version') < DOCS[d].reaccept) out.push(d);
  }
  if (!latest(app, uid, 'age')) out.push('age');
  return out;
}

/**
 * The ticks a request carries: { terms: 1, consent: 1 } must name exactly the current versions of
 * the given documents. null = fine; otherwise the error code.
 */
function checkAccept(accept, docs) {
  const a = accept && typeof accept === 'object' ? accept : {};
  for (const d of docs) {
    if (d === 'age') continue;
    const v = a[d];
    if (typeof v !== 'number') return 'consent_required';
    if (v !== DOCS[d].version) return 'legal_outdated';
  }
  return null;
}

function add(tx, uid, fields) {
  const r = new Record(tx.findCollectionByNameOrId('consents'));
  r.set('user', uid);
  for (const k of Object.keys(fields)) r.set(k, fields[k]);
  tx.save(r);
}

/**
 * Write what was accepted (inside the caller's transaction): one row per document, the privacy
 * notice that was shown, and — if given — the age row (country + «13-17» / «18+», never the age).
 */
function record(tx, uid, docs, action, lang, privacyShown, age) {
  for (const d of docs) {
    if (d === 'age' || !DOCS[d]) continue;
    add(tx, uid, { doc: d, version: DOCS[d].version, lang: lang, action: action });
  }
  if (privacyShown === DOCS.privacy.version) add(tx, uid, { doc: 'privacy', version: DOCS.privacy.version, lang: lang, action: action === 'register' ? 'register' : 'notice' });
  if (age) add(tx, uid, { doc: 'age', version: 0, lang: lang, action: 'declared', country: age.country, ageBand: age.band });
}

module.exports = { DOCS, requiredDocs, publicInfo, needs, checkAccept, record };
