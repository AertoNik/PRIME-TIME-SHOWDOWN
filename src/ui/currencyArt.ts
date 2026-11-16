import { artImg, registerFallback } from './artIcons';
import { ICONS } from './eventArt';
import { UI_ICONS } from './icons';

// Beta 2.0 VISUAL EVOLUTION — the game currencies as the owner's pictures (PRIME_TIME_2_0_EFFECT_PREVIEWS):
//   money  — career dollars ($), a stack of green notes;
//   rep    — reputation (★, «звёзды шоу»), teal star tokens;
//   tokens — PRIME TOKENS, the league's gold T coin (a league currency only — never roubles, never PRIME SHOP).
//   candy_canes — Beta 2.2 final: WINTER SHOWDOWN's CANDY CANES (the season's currency on the server — never PRIME
//            TOKENS, never roubles); the picture of PRIME_TIME_2_3_WINTER_COLLECTION_ART/WINTER_EVENT_CANDY_CANE_TOKEN.png.
// Only the look changes: balances, earning rules and prices are untouched. The 1.x drawings are the fallback.

export type CurrencyKind = 'money' | 'rep' | 'tokens' | 'candy_canes';

/** 1.9.1 PRIME TOKEN coin (inline SVG) — the fallback of the picture. */
export function tokenCoinSvg(size: number): string {
  return `<svg viewBox="0 0 48 48" width="${size}" height="${size}" aria-hidden="true"><circle cx="24" cy="24" r="21" fill="#ffb21a"/><circle cx="24" cy="24" r="21" fill="none" stroke="#ffe9a8" stroke-width="2.5"/><circle cx="24" cy="24" r="15.5" fill="#ff8a1a" opacity=".55"/><path d="M16 15h16v5h-5.5v14h-5V20H16z" fill="#fff"/><path d="M9 18a17 17 0 0 1 9-10" stroke="#fff" stroke-width="2.4" stroke-linecap="round" fill="none" opacity=".6"/></svg>`;
}

const ALT: Record<CurrencyKind, string> = { money: 'Доллары', rep: 'Репутация', tokens: 'PRIME TOKENS', candy_canes: 'Карамельные трости' };

/** A currency's picture at `size` CSS px (decorative by default: the amount next to it carries the meaning). */
export function currencyArt(kind: CurrencyKind, size: number, cls = '', alt = false): string {
  return artImg('currency', kind, size, { cls: `cur-ico cur-${kind} ${cls}`, alt: alt ? ALT[kind] : '', fb: `cur|${kind}|${size}` });
}

registerFallback('cur', ([kind, s]) => {
  const n = Number(s);
  if (kind === 'tokens') return tokenCoinSvg(n);
  // (the cane's 1.9.7 drawing fills the box it is in — the boxes of the season's screens size it)
  if (kind === 'candy_canes') return ICONS.cane;
  const svg = kind === 'money' ? UI_ICONS.money : UI_ICONS.rep;
  return `<span class="ico ${kind} cur-old" style="width:${n}px;height:${n}px">${svg}</span>`;
});
