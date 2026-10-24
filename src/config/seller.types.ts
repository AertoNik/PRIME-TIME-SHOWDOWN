// Alpha 1.8.8 final — the seller's public details (PRIME SHOP). Filled in src/config/seller.config.ts only by
// `npm run legal:release -- --approved`, after the owner approved the documents for publication.

export interface SellerInfo {
  /** Full name, as registered with the tax authority. */
  name: string;
  /** «Фамилия И. О.» for short lines. */
  nameShort: string;
  /** ИНН of the self-employed seller (12 digits). */
  inn: string;
  /** The day the seller was registered as a payer of the tax on professional income (YYYY-MM-DD). */
  npdSince: string;
  email: string;
  phone: string;
  /** Recommended by Robokassa (a city is enough for the self-employed); '' when not published. */
  city: string;
}
