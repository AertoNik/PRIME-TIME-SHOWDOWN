// Alpha 1.8.8 (stage 3) — the public offer of PRIME SHOP: every published revision, newest last.
//
// A revision is added ONLY when the owner has approved its text and the page is really published on
// the game's site (public/legal/…): its address, the date it takes effect and the SHA-256 of the
// published file (`npm run checkout` checks that the file exists and the hash matches). Until then
// the list stays empty: the shop says the offer will be published before sales start, no link points
// to a missing page and no consent can be recorded.
//
// The same list is copied to the server (`npm run backend:rules` → backend/pb_hooks/lib/shop_rules.js):
// the server accepts a consent only for its current revision and keeps every acceptance (consents).

export interface OfferRevision {
  /** 1, 2, 3… — a new revision for every change of the text; consents name it. */
  revision: number;
  /** «Публичная оферта PRIME SHOP». */
  title: string;
  /** The published page (the game's own domain), e.g. https://primetimeshowdown.online/legal/ru/offer.html. */
  url: string;
  /** The day the revision takes effect, ISO (YYYY-MM-DD, 00:00 UTC). */
  effectiveFrom: string;
  /** SHA-256 (hex) of the published file — which exact text a player accepted. */
  sha256: string;
}

/**
 * Approved, published revisions (oldest first). Revision 1: approved by the owner on 24.10.2026 and installed by
 * `npm run legal:release -- --approved --date=2026-10-24` (the date of the planned publication — if the site goes out
 * on another day, re-run it with that date and copy the new date and SHA-256 here before publishing).
 */
export const SHOP_OFFERS: OfferRevision[] = [
  { revision: 1, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '2026-10-24', sha256: '2a6de21c5ed0452ce65667db792c1fc39c21675b0ac761ae785fb3b9a26b4625' },
];

/**
 * 1.8.8 stage 4 — STAGING ONLY: the stand-in a tester accepts before a TEST payment on a staging server
 * (Robokassa test mode). It is NOT an offer and has no page (url ''): the purchase window says «тест,
 * документа нет». A production server never uses it (backend lib/payments.js); its SHA-256 is the hash
 * of TEST_OFFER_TEXT, so the consent row on the staging database names exactly this text.
 */
export const TEST_OFFER_TEXT =
  'PRIME SHOP — тестовые условия оплаты (Robokassa, тестовый режим). Не оферта: деньги не списываются, товар выдаётся только на тестовом сервере. Редакция 9001.';
export const TEST_OFFER: OfferRevision = {
  revision: 9001,
  title: 'Тестовые условия оплаты PRIME SHOP',
  url: '',
  effectiveFrom: '2026-10-01',
  sha256: '2b7fa9fbdfa6508819f958ff95c29a3b3a98705675edcdd04ff5343b40be4231',
};

/**
 * 1.8.8 final — THE DEMONSTRATION ONLY (the official server in its demonstration mode): the stand-in a player accepts
 * before a demonstration payment (Robokassa's test mode, no money moves). It is NOT an offer and has no page:
 * the purchase window says what it is and links the published offer, if any, for reading. Its SHA-256 is the
 * hash of DEMO_OFFER_TEXT (`npm run checkout` checks it).
 */
export const DEMO_OFFER_TEXT =
  'PRIME SHOP — условия демонстрационной оплаты (Robokassa, тестовый режим). Не оферта и не покупка: деньги не списываются; предмет выдаётся для демонстрации и действует только до окончания демонстрационного режима. Редакция 9002.';
export const DEMO_OFFER: OfferRevision = {
  revision: 9002,
  title: 'Условия демонстрационной оплаты PRIME SHOP',
  url: '',
  effectiveFrom: '2026-10-23',
  sha256: '4598f6a0b6d6d5a54de71167bf52853cd0b0746ec44c68bad041223aab729f11',
};

/** The revision in force at `now` (null: none published yet). */
export function currentOffer(now: number = Date.now(), list: readonly OfferRevision[] = SHOP_OFFERS): OfferRevision | null {
  let cur: OfferRevision | null = null;
  for (const o of list) {
    const t = Date.parse(o.effectiveFrom.length <= 10 ? o.effectiveFrom + 'T00:00:00Z' : o.effectiveFrom);
    if (Number.isFinite(t) && t <= now && (!cur || o.revision > cur.revision)) cur = o;
  }
  return cur;
}

/** «12 ноября 2026» for the offer line. */
export function offerDate(o: OfferRevision): string {
  const t = Date.parse(o.effectiveFrom.length <= 10 ? o.effectiveFrom + 'T00:00:00Z' : o.effectiveFrom);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : o.effectiveFrom;
}
