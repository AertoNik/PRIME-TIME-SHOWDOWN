import { FAME_TIERS, type StageId } from '../config/career';
import { artImg, registerFallback } from './artIcons';
import { REWARD_ART } from './eventArt';
import { UI_ICONS } from './icons';

// Beta 2.0 VISUAL EVOLUTION — the career's pictures (the owner's PNGs, PRIME_TIME_2_0_RANK_ART → public/ui/…):
//   * a producer level 1–20 — its own badge (1–10 career_levels/level_NN, 11–20 the owner's level_NN of the final
//     Beta 2.0 set); the number is part of the picture;
//   * a level WITHOUT a picture (none today; a future extension) — a drawn prestige hexagon with the real number,
//     never another level's picture; the same hexagon is the fallback when a picture's file fails;
//   * the four «Путь продюсера» stages and the five fighter-fame tiers.
// The 1.x drawings (the CSS level hexagon, the trophy / star / studio art) stay as the fallback when a file fails.

/** The levels with the owner's picture (level → file id in public/ui/levels). */
export const LEVEL_ART: Readonly<Partial<Record<number, string>>> = {
  1: '01',
  2: '02',
  3: '03',
  4: '04',
  5: '05',
  6: '06',
  7: '07',
  8: '08',
  9: '09',
  10: '10',
  // Beta 2.0 final: the owner's badges of the extended career (PRIME_TIME_2_0_EFFECT_PREVIEWS/level_NN.png)
  11: '11',
  12: '12',
  13: '13',
  14: '14',
  15: '15',
  16: '16',
  17: '17',
  18: '18',
  19: '19',
  20: '20',
};

/** The producer level's badge at `size` CSS px. */
export function levelBadge(level: number, size: number, cls = ''): string {
  const id = LEVEL_ART[level];
  if (id) return artImg('levels', id, size, { cls: `lvl-art ${cls}`, alt: `Уровень ${level}`, fb: `level|${level}|${size}|${cls}` });
  return levelHex(level, size, cls);
}

/**
 * The drawn level badge: the 1.x cyan hexagon (the fallback of 1–10) or, beyond 10, a prestige hexagon (a metal rim
 * that warms every five levels) with the number — clearly not the picture of level 10.
 */
export function levelHex(level: number, size: number, cls = ''): string {
  const ext = level > 10 ? ` ext t${Math.min(4, Math.floor((level - 11) / 5) + 1)}` : '';
  const digits = String(level).length;
  return `<span class="lvl-hex${ext} d${digits} ${cls}" style="--lvl:${size}px" role="img" aria-label="Уровень ${level}"><b>${level}</b></span>`;
}

registerFallback('level', ([l, s, c]) => levelHex(Number(l), Number(s), c ?? ''));

/** The 1.5 stage art (now the fallback): ROOKIE / RISING a trophy, STAR the neon star, LEGENDARY the gold studio. */
function stageArtOld(id: string): string {
  return id === 'legendary' ? REWARD_ART.studio : id === 'star' ? REWARD_ART.star : UI_ICONS.trophy;
}

/** A «Путь продюсера» stage's emblem. */
export function stageArt(id: StageId, size: number, cls = ''): string {
  return artImg('stages', id, size, { cls: `stage-art ${cls}`, fb: `stage|${id}` });
}

registerFallback('stage', ([id]) => `<span class="stage-art-old">${stageArtOld(id)}</span>`);

/** The fame tier (0 = Новичок … 4 = Легенда) of a fighter with `fans`. */
export function fameIndex(fans: number): number {
  let k = 0;
  FAME_TIERS.forEach((t, i) => {
    if (fans >= t.min) k = i;
  });
  return k;
}

/** The small fame badge for a fighter with `fans` (decorative: the tier's name stays next to it as text). */
export function fameIcon(fans: number, size = 18, cls = ''): string {
  return artImg('fame', String(fameIndex(fans) + 1), size, { cls: `fame-ico ${cls}`, fb: 'none' });
}

// a decorative picture that failed simply goes away (its text stays)
registerFallback('none', () => '<i hidden></i>');
