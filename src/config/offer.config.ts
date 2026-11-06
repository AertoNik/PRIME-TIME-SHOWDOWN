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
  /**
   * When the revision takes effect: a day, ISO YYYY-MM-DD (00:00 UTC = 03:00 Moscow time), or — 1.9.5 — an exact moment,
   * ISO with time in UTC («2026-11-08T06:00:00Z» = 08.11.2026 09:00 Moscow time). The game and the server read both forms
   * the same way (currentOffer here, lib/checkout.js offerAt, lib/payments.js offerInForce).
   */
  effectiveFrom: string;
  /** SHA-256 (hex) of the published file — which exact text a player accepted. */
  sha256: string;
  /**
   * Alpha 1.8.9.5: this revision's text lets PRIME IDs aged 14–17 buy (its section on buyers under 18). Without
   * it the server sells only to 18+, whatever PRIME_SHOP_MINORS says (shop.config.ts MINOR_PURCHASES).
   */
  minors?: boolean;
  /**
   * Alpha 1.9.4: this revision's text sells playable characters for money (LUCIEN after his season) — its list of
   * goods names them and their price. Without it the server never charges for a fighter in live mode
   * (lib/payments.js fightersOffered): revisions 1–3 say the opposite (§3.4).
   */
  fighters?: boolean;
  /**
   * Alpha 1.9.4: this revision's own limits for buyers aged 14–17 (its section 5): at most `orderMaxRub` an order, at most
   * `per30DaysRub` over any 30 days, `characters` — playable characters too. Absent: the limits of revisions 1–3
   * (shop.config.ts MINOR_PURCHASES — cosmetics only). The server applies the limits of the revision in force.
   */
  minorLimits?: { orderMaxRub: number; per30DaysRub: number; characters: boolean };
  /**
   * Alpha 1.9.5: the goods of this revision's Appendix 1 (PRIME SHOP skus) — the server sells ONLY these while the
   * revision is in force (lib/payments.js itemOffered: live, and on a staging server too), whatever price the owner
   * approved for anything else. Each list is the published appendix of its revision, item for item.
   */
  items?: string[];
}

/** Appendix 1 of revisions 1–3 (published 24.10 / 30.10.2026): the two skins and the four effects. */
const GOODS_R1: string[] = ['skin_ray_neon_runner', 'skin_bruno_casino_boss', 'fx_prime_broadcast', 'fx_phantom_dash', 'fx_golden_confetti', 'fx_vhs_card_frame'];
/** Appendix 1 of revision 4 (in force 07.11.2026): the six and LUCIEN: THE NIGHT STAR. */
const GOODS_R4: string[] = [...GOODS_R1, 'fighter_lucien'];
/**
 * Alpha 1.9.5 — Appendix 1 of revision 5 (approved 06.11.2026, Р-18…Р-20): the seven of revision 4 and the eleven
 * approved on 06.11.2026, in catalog order.
 */
export const GOODS_R5: string[] = [
  'skin_ray_neon_runner',
  'skin_bruno_casino_boss',
  'skin_nika_stage_idol',
  'skin_vega_star_pilot',
  'fx_prime_broadcast',
  'fx_phantom_dash',
  'fx_golden_confetti',
  'fx_vhs_card_frame',
  'fx_studio_spotlights',
  'fx_neon_fireworks',
  'fx_glitch_dash',
  'fx_comet_trail',
  'fx_arcade_frame',
  'fx_holo_foil',
  'season_halloween_cards',
  'season_spooky_broadcast',
  'season_pumpkin_victory',
  'fighter_lucien',
];

/**
 * Approved, published revisions (oldest first). A revision is never edited once published: its text stays at its
 * own address with the same SHA-256 (what its buyers accepted), and any change of the text is a new revision.
 * 1 — approved by the owner and published on 24.10.2026; kept byte for byte as offer-r1.html.
 * 2 — the same terms with the seller's name in its passport spelling (24.10.2026), `legal:release --approved
 *     --date=2026-10-24`. If the site goes out on another day, re-run it with that date and copy the date and
 *     SHA-256 here before publishing.
 */
export const SHOP_OFFERS: OfferRevision[] = [
  { revision: 1, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer-r1.html', effectiveFrom: '2026-10-24', sha256: '2a6de21c5ed0452ce65667db792c1fc39c21675b0ac761ae785fb3b9a26b4625', items: GOODS_R1 },
  { revision: 2, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer-r2.html', effectiveFrom: '2026-10-24', sha256: 'a8ae91f4be0a99336180823e5dfc8c0bc168b103ccbc3f10a3f98c41996a76c2', items: GOODS_R1 },
  // Alpha 1.8.9.5: buyers from 14 (section 5: cosmetics, 299 ₽ an item, 1 500 ₽ in 30 days), effective 30.10.2026 00:00 UTC
  // (03:00 Moscow time) — until then the server still offers revision 2 at its archived address
  { revision: 3, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer-r3.html', effectiveFrom: '2026-10-30', sha256: '40681c01fb585828c920ec2e6a083e1ce3d936a5f6526e6ca48f73970661866d', minors: true, items: GOODS_R1 },
  // Alpha 1.9.4: playable characters (LUCIEN 249 ₽), seasonal goods, buyers 14–17 of every category within 500 ₽ an order /
  // 2 000 ₽ in 30 days; approved by the owner 06.11.2026, in force 07.11.2026 00:00 UTC (03:00 Moscow time) — until then the
  // server still sells under revision 3 at its archived address
  { revision: 4, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer-r4.html', effectiveFrom: '2026-11-07', sha256: 'e97d5b26b150dcbce08fe4ff816a0455a520b546e0b8d959df23d21b129d9d69', minors: true, fighters: true, minorLimits: { orderMaxRub: 500, per30DaysRub: 2000, characters: true }, items: GOODS_R4 },
  // Alpha 1.9.5: the eleven goods of PRIME SHOP EXPANSION and the Halloween items after their season (18 in all), the season
  // by the server's clock (3.5), looks and items obtained for tokens (9.5, 9.10); approved by the owner 06.11.2026 (Р-18…Р-20),
  // in force 08.11.2026 09:00 Moscow time — the exact moment (06:00 UTC); until then the server sells under revision 4 (and,
  // until 07.11.2026 00:00 UTC, revision 3) at their archived addresses
  { revision: 5, title: 'Публичная оферта PRIME SHOP', url: 'https://primetimeshowdown.online/legal/ru/offer.html', effectiveFrom: '2026-11-08T06:00:00Z', sha256: 'b27d40719feb62e6ef326dca1e8d2b956c708b99d2f1bd300e7b6b1211bd42b4', minors: true, fighters: true, minorLimits: { orderMaxRub: 500, per30DaysRub: 2000, characters: true }, items: GOODS_R5 },
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
  // 1.8.9.5: TEST ONLY — lets a staging server with PRIME_SHOP_MINORS=on check purchases by 14–17 on test payments
  // (no money). Never a production text: production uses SHOP_OFFERS only.
  minors: true,
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
  // 1.9.5: what its text demonstrated — the six cosmetics of 23.10.2026, nothing added since
  items: GOODS_R1,
};

/** 1.9.5: the revision lists the item in its Appendix 1 (a revision without a list: its whole catalogue, as before). */
export function offerSells(o: OfferRevision | null, sku: string): boolean {
  return !!o && (!Array.isArray(o.items) || o.items.includes(sku));
}

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
