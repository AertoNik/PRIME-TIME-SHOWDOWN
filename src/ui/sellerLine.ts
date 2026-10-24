import { SELLER } from '../config/seller.config';
import { esc } from './dom';

// Alpha 1.8.8 final — the seller and the PRIME SHOP documents (only once the owner approved and published them:
// `npm run legal:release -- --approved` generates SELLER). Under the title: the document links only, «Продавец и
// реквизиты» among them; in PRIME SHOP: the seller's details in full (name, status, ИНН, email). The documents open
// as their own pages; offer.html and seller.html carry every detail too.

const DOCS: [string, string][] = [
  ['shop', 'Каталог и цены'],
  ['offer', 'Оферта'],
  ['refunds', 'Возврат и поддержка'],
  ['seller', 'Продавец и реквизиты'],
];

const docLinks = () => DOCS.map(([d, t]) => `<a href="./legal/ru/${d}.html" target="_blank" rel="noopener">${t}</a>`).join(' · ');

/** «Каталог и цены · Оферта · Возврат и поддержка · Продавец и реквизиты» — '' while not published. */
export function sellerLinksHTML(cls: string): string {
  return SELLER ? `<nav class="${cls}" aria-label="Документы PRIME SHOP">${docLinks()}</nav>` : '';
}

/** PRIME SHOP: «Информация о продавце» — full name, status, ИНН, email and the documents; '' while not published. */
export function sellerCardHTML(): string {
  if (!SELLER) return '';
  const mail = `<a href="mailto:${esc(SELLER.email)}">${esc(SELLER.email)}</a>`;
  return `<section class="sf-seller" aria-label="Информация о продавце">
      <b>Информация о продавце</b>
      <dl>
        <dt>Продавец</dt><dd>${esc(SELLER.name)}</dd>
        <dt>Статус</dt><dd>самозанятый — плательщик налога на профессиональный доход</dd>
        <dt>ИНН</dt><dd>${esc(SELLER.inn)}</dd>
        <dt>Email</dt><dd>${mail}</dd>
      </dl>
      <div class="sf-docs">${docLinks()}</div>
    </section>`;
}
