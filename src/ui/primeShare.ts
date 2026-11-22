import { VICTORY_SETS } from '../config/animation';
import { isArenaId } from '../config/arenas.config';
import { COMBOS } from '../config/cards';
import { FIGHTERS } from '../config/fighters';
import { POSTER, POSTER_POSE, POSTER_SITE, SHARE_MIN_RATING } from '../config/primeShare';
import { SKINS } from '../config/shop.config';
import type { FighterId } from '../config/types';
import type { MatchResultData } from '../combat/types';
import type { Game } from '../game/Game';
import { lang } from '../i18n/lang';
import { gradeFor } from '../meta/CareerSystem';
import type { LeagueFinish, LeagueMatch } from '../net/LeagueApi';
import { renderHeroShot, type HeroFrame } from '../render/PosterStudio';
import { arenaPreviewUrl } from './arenaArt';
import { esc } from './dom';

// Beta 2.6.1 — PRIME SHARE: a personal poster of a PRIME LEAGUE victory, made on request from the league's result
// screen. Rules (src/config/primeShare.ts): a win the SERVER confirmed, fought to its end, show rating ≥ 80. The
// facts on it are those of THAT fight only — frozen when the server confirmed it (PosterFacts), so another screen, a
// later fight or a changed wardrobe never alters it. The picture is drawn in the browser at 1080 × 1350 (its own
// pixels, never the screen's), saved as PNG or handed to the system's share sheet; nothing is sent anywhere by the game.

const tr = (ru: string, en: string) => (lang() === 'en' ? en : ru);
const BASE = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';

// ------------------------------------------------------------------------ the rule
/** Why no poster is offered for this match (null — it is offered). */
export type PosterBlock = 'not_confirmed' | 'not_win' | 'not_played_out' | 'low_rating';

export function posterBlock(m: LeagueMatch | null | undefined): PosterBlock | null {
  if (!m || m.status !== 'done' || !m.result) return 'not_confirmed';
  if (m.outcome !== 'win') return 'not_win';
  // a forfeit or a fight the server finished at its deadline (the player left) was not fought to the end here
  if (m.method === 'forfeit' || m.how !== 'finish') return 'not_played_out';
  if (!(m.result.rating >= SHARE_MIN_RATING)) return 'low_rating';
  return null;
}

// ----------------------------------------------------------------------- the facts
export interface PosterFacts {
  match: string;
  fighter: FighterId;
  /** The look the fighter won in (rendering only). */
  look: string;
  /** The PRIME SHOP skin's name, when the look is one. */
  skin: string | null;
  headline: 'VICTORY' | 'TOURNAMENT WINNER';
  /** What was won, in the league's words (PRIME DUEL, PRIME SQUAD · 2–1 …). */
  context: string;
  rating: number;
  grade: string;
  method: 'ko' | 'time';
  /** Seconds. */
  duration: number;
  combos: number;
  /** The best combo's name — only when the fight on screen is bit for bit the one the server replayed. */
  bestCombo: string | null;
  opponent: string;
  opponentFighter: FighterId;
  /** The player's own PRIME ID nickname (their poster), or null. */
  producer: string | null;
  arena: string | null;
  /** When the result was confirmed (ms). */
  at: number;
}

const lookName = (look: string): string | null => {
  for (const s of Object.values(SKINS)) if (s.look === look) return s.name;
  return null;
};

/**
 * The poster's facts, taken once from the server's confirmed match (and the series it closed), or null when no poster
 * is offered. `local` — the fight as the game played it (for the best combo, used only when its hash is the server's).
 */
export function posterFacts(view: LeagueMatch, res: LeagueFinish, local: MatchResultData | null, look: string, producer: string | null, at: number): PosterFacts | null {
  const m = res.match;
  if (posterBlock(m) || m.id !== view.id) return null;
  const r = m.result!;
  const ser = res.series;
  const squadWon = m.mode === 'squad' && !!ser && ser.kind === 'squad' && ser.status === 'done' && !!ser.done?.won;
  const qualified = m.mode === 'challenge' && (r.ceremony ?? []).some((c) => c.kind === 'rank' && !!c.challenge);
  const context = squadWon
    ? `PRIME SQUAD · ${ser!.wins}–${ser!.losses}`
    : qualified
      ? `PRIME CHALLENGE · ${tr('КВАЛИФИКАЦИЯ ПРОЙДЕНА', 'QUALIFIED')}`
      : m.mode === 'challenge'
        ? `PRIME CHALLENGE · ${tr('КВАЛИФИКАЦИЯ', 'QUALIFIER')}`
        : m.mode === 'squad'
          ? `PRIME SQUAD · ${tr('ДУЭЛЬ', 'DUEL')} ${m.round + 1}/3`
          : m.mode === 'rush'
            ? `PRIME RUSH · ${tr('ДУЭЛЬ', 'DUEL')} ${m.round + 1}`
            : 'PRIME DUEL';
  const same = !!local && local.outcome === 'win' && typeof r.clientHash === 'number' && r.clientHash === r.hash;
  const best = same && local!.bestCombo ? (COMBOS.find((c) => c.id === local!.bestCombo)?.name ?? null) : null;
  const fighter = m.attacker.fighter;
  const ownLook = look && (look === FIGHTERS[fighter].look || lookName(look)) ? look : FIGHTERS[fighter].look;
  return {
    match: m.id,
    fighter,
    look: ownLook,
    skin: lookName(ownLook),
    headline: squadWon || qualified ? 'TOURNAMENT WINNER' : 'VICTORY',
    context,
    rating: Math.round(r.rating),
    grade: gradeFor(r.rating),
    method: m.method === 'ko' ? 'ko' : 'time',
    duration: Math.max(0, Math.round(r.duration)),
    combos: Math.max(0, Math.round(r.combos)),
    bestCombo: best,
    opponent: lang() === 'en' && view.opponent.nameEn ? view.opponent.nameEn : view.opponent.name,
    opponentFighter: m.defender.fighter,
    producer,
    arena: isArenaId(m.arena) ? m.arena : null,
    at,
  };
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const day = (t: number) => {
  const d = new Date(t);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
};

// ---------------------------------------------------------------------- the picture
const C = {
  navy: '#070a1e',
  ink: '#0b0826',
  violet: '#7b3cff',
  magenta: '#c26bff',
  cyan: '#3fe0ff',
  gold: '#ffc23a',
  goldHi: '#fff1b8',
  orange: '#ff7a1a',
};
const DISPLAY = 'Unbounded, "Arial Black", system-ui, sans-serif';
const BODY = 'Rubik, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function loadImage(src: string, ms = 4000): Promise<HTMLImageElement | null> {
  return new Promise((done) => {
    const img = new Image();
    const t = setTimeout(() => done(null), ms);
    img.onload = () => {
      clearTimeout(t);
      done(img);
    };
    img.onerror = () => {
      clearTimeout(t);
      done(null);
    };
    img.decoding = 'async';
    img.src = src;
  });
}

async function fontsReady(text: string): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  const want = [`italic 900 120px Unbounded`, `900 120px Unbounded`, `700 40px Unbounded`, `700 40px Rubik`, `600 30px Rubik`, `400 30px Rubik`];
  await Promise.race([Promise.all(want.map((f) => fonts.load(f, text).catch(() => []))), new Promise((r) => setTimeout(r, 2500))]);
}

/** The largest size (≤ max) at which `text` fits `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, width: number, max: number, min = 12): number {
  let px = max;
  ctx.font = font(px);
  while (px > min && ctx.measureText(text).width > width) {
    px -= 2;
    ctx.font = font(px);
  }
  return px;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A soft glow from a silhouette: shrunk and blown up again (works on every browser — no canvas filters needed). */
function glowOf(src: HTMLCanvasElement, color: string, scale = 0.06): HTMLCanvasElement {
  const w = Math.max(8, Math.round(src.width * scale));
  const h = Math.max(8, Math.round(src.height * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const s = small.getContext('2d')!;
  s.imageSmoothingQuality = 'high';
  s.drawImage(src, 0, 0, w, h);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = color;
  s.fillRect(0, 0, w, h);
  return small;
}

/** A repeatable random stream from the match id (mulberry32). */
function seeded(key: string): () => number {
  let a = 0x9e3779b9;
  for (let i = 0; i < key.length; i++) a = Math.imul(a ^ key.charCodeAt(i), 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sparks and a few confetti flakes in the air above the stage — behind the fighter, never over the text. */
function sparks(ctx: CanvasRenderingContext2D, key: string, W: number, floor: number): void {
  const rnd = seeded(key);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const cols = ['255,214,110', '255,194,58', '63,224,255', '194,107,255', '255,255,255'];
  for (let i = 0; i < 54; i++) {
    const x = 40 + rnd() * (W - 80);
    const y = 170 + rnd() * (floor - 260);
    const r = 2 + rnd() * rnd() * 9;
    const c = cols[Math.floor(rnd() * cols.length)];
    const a = 0.25 + rnd() * 0.55;
    if (rnd() < 0.62) {
      // a four-point glint
      ctx.fillStyle = `rgba(${c},${a})`;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 2.2);
      ctx.quadraticCurveTo(x, y, x + r * 2.2, y);
      ctx.quadraticCurveTo(x, y, x, y + r * 2.2);
      ctx.quadraticCurveTo(x, y, x - r * 2.2, y);
      ctx.quadraticCurveTo(x, y, x, y - r * 2.2);
      ctx.fill();
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      halo.addColorStop(0, `rgba(${c},${a * 0.5})`);
      halo.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    } else {
      // a confetti flake
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rnd() * Math.PI);
      ctx.fillStyle = `rgba(${c},${a * 0.8})`;
      ctx.fillRect(-r * 1.2, -r * 0.45, r * 2.4, r * 0.9);
      ctx.restore();
    }
  }
  ctx.restore();
}

function beam(ctx: CanvasRenderingContext2D, x0: number, y0: number, xa: number, xb: number, y1: number, color: string, alpha: number): void {
  const g = ctx.createLinearGradient(x0, y0, (xa + xb) / 2, y1);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0 - 18, y0);
  ctx.lineTo(x0 + 18, y0);
  ctx.lineTo(xb, y1);
  ctx.lineTo(xa, y1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** The hero shot's pose for this fighter (its victory routine by name → index). */
function poseOf(fighter: FighterId): { variant: number; at: number } {
  const style = FIGHTERS[fighter].victoryStyle;
  const p = POSTER_POSE[style];
  const set = VICTORY_SETS[style] as readonly string[];
  const i = p ? set.indexOf(p.move) : -1;
  return { variant: i >= 0 ? i : 0, at: p?.at ?? 1.5 };
}

const FEET_Y = 1040;

/**
 * Draws the poster (POSTER.width × POSTER.height). The fighter is the game's own 3D model in its own look (render/
 * PosterStudio.ts); when WebGL cannot draw it now, the game's own portrait of that look is used instead — never
 * another picture.
 */
export async function drawPoster(g: Game, f: PosterFacts): Promise<HTMLCanvasElement> {
  const W = POSTER.width;
  const H = POSTER.height;
  const fd = FIGHTERS[f.fighter];
  const name = fd.name;
  await fontsReady(`VICTORY TOURNAMENT WINNER PRIME TIME SHOWDOWN ${name} ${f.opponent} ${FIGHTERS[f.opponentFighter].name} ${f.context} 0123456789:/–·«»`);
  const arenaUrl = f.arena ? arenaPreviewUrl(f.arena as never) : null;
  const [emblem, stage] = await Promise.all([loadImage(`${BASE}icon-512.png`), arenaUrl ? loadImage(arenaUrl) : Promise.resolve(null)]);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  // opaque: the PNG needs no alpha channel (a quarter smaller, the same pixels)
  const ctx = out.getContext('2d', { alpha: false })!;
  ctx.imageSmoothingQuality = 'high';
  const tour = f.headline === 'TOURNAMENT WINNER';
  // where the fighter stands: from just under the headline to the floor
  const top = tour ? 392 : 330;
  const frame: HeroFrame = { top, bottom: FEET_Y, cx: W / 2, maxWidth: W * 0.9 };

  // 1. the studio: deep night blue into violet, the arena of the fight far behind, out of focus
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0a0b26');
  bg.addColorStop(0.45, '#170b3c');
  bg.addColorStop(0.78, '#0d0a2a');
  bg.addColorStop(1, C.navy);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (stage) {
    const sw = W * 1.5;
    const sh = (sw * stage.naturalHeight) / stage.naturalWidth;
    ctx.save();
    ctx.globalAlpha = 0.34;
    ctx.drawImage(stage, (W - sw) / 2, FEET_Y - sh * 0.78, sw, sh);
    ctx.restore();
    const fade = ctx.createLinearGradient(0, FEET_Y - sh * 0.8, 0, FEET_Y + 120);
    fade.addColorStop(0, 'rgba(10,11,38,1)');
    fade.addColorStop(0.35, 'rgba(23,11,60,0.35)');
    fade.addColorStop(0.8, 'rgba(13,10,42,0.4)');
    fade.addColorStop(1, 'rgba(7,10,30,1)');
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, W, H);
  }
  // 2. the light: a violet bloom behind the fighter, cyan and violet side beams, a gold spot from above
  const bloom = ctx.createRadialGradient(W / 2, 640, 40, W / 2, 640, 620);
  bloom.addColorStop(0, 'rgba(123,60,255,0.55)');
  bloom.addColorStop(0.55, 'rgba(70,30,160,0.22)');
  bloom.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, W, H);
  beam(ctx, 120, -40, 300, 640, FEET_Y + 40, 'rgba(63,224,255,0.9)', 0.2);
  beam(ctx, W - 120, -40, 440, 780, FEET_Y + 40, 'rgba(194,107,255,0.9)', 0.22);
  beam(ctx, W / 2, -60, 300, 780, FEET_Y + 20, 'rgba(255,194,58,0.9)', 0.16);
  // the fighter's name, huge and faint, as the set's backdrop
  ctx.save();
  ctx.font = `italic 900 ${fit(ctx, name, (p) => `italic 900 ${p}px ${DISPLAY}`, W * 1.1, 300)}px ${DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(160,220,255,0.10)';
  ctx.strokeText(name, W / 2, 820);
  ctx.restore();

  // gold and neon sparks in the air (a seeded scatter: the same fight, the same poster)
  sparks(ctx, f.match, W, FEET_Y);

  // 3. the floor: a gold pool of light with a cyan ring
  const pool = ctx.createRadialGradient(W / 2, FEET_Y, 10, W / 2, FEET_Y, 360);
  pool.addColorStop(0, 'rgba(255,214,120,0.55)');
  pool.addColorStop(0.35, 'rgba(255,170,60,0.18)');
  pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.translate(W / 2, FEET_Y);
  ctx.scale(1, 0.2);
  ctx.translate(-W / 2, -FEET_Y);
  ctx.fillStyle = pool;
  ctx.fillRect(0, FEET_Y - 400, W, 800);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(63,224,255,0.55)';
  ctx.lineWidth = 4;
  ctx.shadowColor = C.cyan;
  ctx.shadowBlur = 24;
  ctx.beginPath();
  ctx.ellipse(W / 2, FEET_Y + 6, 300, 44, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 4. the headline (behind the fighter: a raised arm may cross it, like a magazine cover)
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const goldFill = (y0: number, y1: number) => {
    const gr = ctx.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, C.goldHi);
    gr.addColorStop(0.45, C.gold);
    gr.addColorStop(1, C.orange);
    return gr;
  };
  const headline = (text: string, base: number, max: number) => {
    const px = fit(ctx, text, (p) => `italic 900 ${p}px ${DISPLAY}`, W - 120, max);
    ctx.font = `italic 900 ${px}px ${DISPLAY}`;
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,170,40,0.75)';
    ctx.shadowBlur = 36;
    ctx.lineWidth = Math.max(6, px * 0.07);
    ctx.strokeStyle = '#2a0f00';
    ctx.strokeText(text, W / 2, base);
    ctx.shadowBlur = 0;
    ctx.fillStyle = goldFill(base - px * 0.8, base);
    ctx.fillText(text, W / 2, base);
  };
  if (tour) {
    headline('TOURNAMENT', 262, 112);
    headline('WINNER', 378, 128);
  } else headline('VICTORY', 318, 186);
  ctx.restore();

  // 5. the fighter: the 3D hero shot (or the game's own portrait of the look), with a two-colour rim glow
  const pose = poseOf(f.fighter);
  // a low camera at three quarters, close enough for a little heroic perspective (picked from test sheets)
  const hero = renderHeroShot(g.renderer, g.models, f.look, { width: W, height: H, variant: pose.variant, at: pose.at, facing: 0.32, orbit: 0.5, camY: -0.05, dist: 4.1, aimY: 1.38, fov: 45, frame });
  if (hero) {
    // a soft two-colour back glow: cyan from the left, violet from the right (wide and faint — light, not an outline)
    const halos: [string, number, number][] = [
      ['rgba(63,224,255,1)', -16, 0.5],
      ['rgba(194,107,255,1)', 18, 0.55],
    ];
    for (const [col, dx, a] of halos) {
      const halo = glowOf(hero.canvas, col, 0.03);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a;
      ctx.drawImage(halo, dx - 30, -40, W + 60, H + 80);
      ctx.restore();
      halo.width = halo.height = 0;
    }
    // a soft contact shadow under the feet
    const sh = ctx.createRadialGradient(W / 2, FEET_Y, 4, W / 2, FEET_Y, 170);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.translate(W / 2, FEET_Y);
    ctx.scale(1, 0.18);
    ctx.translate(-W / 2, -FEET_Y);
    ctx.fillStyle = sh;
    ctx.fillRect(W / 2 - 200, FEET_Y - 200, 400, 400);
    ctx.restore();
    ctx.drawImage(hero.canvas, 0, 0);
    hero.canvas.width = hero.canvas.height = 0;
  } else {
    const url = g.portraitFor(f.look, true);
    const img = url ? await loadImage(url) : null;
    if (img) {
      const s = Math.min(560, FEET_Y - top);
      ctx.drawImage(img, (W - s) / 2, FEET_Y - s, s, s);
    }
  }

  // 6. the lower third: a dark glass band for the facts
  const shade = ctx.createLinearGradient(0, FEET_Y - 40, 0, H);
  shade.addColorStop(0, 'rgba(7,10,30,0)');
  shade.addColorStop(0.25, 'rgba(7,10,30,0.82)');
  shade.addColorStop(1, 'rgba(5,6,18,0.98)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, FEET_Y - 40, W, H - FEET_Y + 40);
  const top3 = ctx.createLinearGradient(0, 0, 0, 200);
  top3.addColorStop(0, 'rgba(5,6,18,0.85)');
  top3.addColorStop(1, 'rgba(5,6,18,0)');
  ctx.fillStyle = top3;
  ctx.fillRect(0, 0, W, 200);

  // 7. the top bar: the emblem and the show's name; the league and what was won
  const M = 60;
  if (emblem) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(M + 46, 92, 46, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(emblem, M, 46, 92, 92);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(M + 46, 92, 46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  const lx = M + (emblem ? 112 : 0);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 900 40px ${DISPLAY}`;
  const pt = ctx.createLinearGradient(0, 52, 0, 92);
  pt.addColorStop(0, '#ffffff');
  pt.addColorStop(0.5, '#c9f6ff');
  pt.addColorStop(1, '#4fd8ff');
  ctx.shadowColor = 'rgba(34,200,255,0.6)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = pt;
  ctx.fillText('PRIME TIME', lx, 90);
  ctx.shadowBlur = 0;
  ctx.font = `italic 900 22px ${DISPLAY}`;
  const sdw = ctx.measureText('SHOWDOWN').width + 28;
  ctx.save();
  ctx.translate(lx, 102);
  ctx.transform(1, 0, -0.18, 1, 0, 0);
  const og = ctx.createLinearGradient(0, 0, sdw, 0);
  og.addColorStop(0, '#ff5a14');
  og.addColorStop(1, '#ff9a2a');
  ctx.fillStyle = og;
  ctx.shadowColor = 'rgba(255,106,26,0.6)';
  ctx.shadowBlur = 16;
  roundRect(ctx, 0, 0, sdw, 36, 7);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  ctx.fillText('SHOWDOWN', 14, 27);
  ctx.restore();
  ctx.textAlign = 'right';
  ctx.font = `700 26px ${DISPLAY}`;
  ctx.fillStyle = C.gold;
  ctx.fillText('PRIME LEAGUE', W - M, 84);
  const cpx = fit(ctx, f.context, (p) => `600 ${p}px ${BODY}`, 420, 24);
  ctx.font = `600 ${cpx}px ${BODY}`;
  ctx.fillStyle = C.cyan;
  ctx.fillText(f.context, W - M, 120);
  ctx.restore();

  // 8. who won and against whom
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  const npx = fit(ctx, name, (p) => `italic 900 ${p}px ${DISPLAY}`, 560, 70);
  ctx.font = `italic 900 ${npx}px ${DISPLAY}`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(63,224,255,0.55)';
  ctx.shadowBlur = 20;
  ctx.fillText(name, M, 1122);
  ctx.shadowBlur = 0;
  let nx = M + ctx.measureText(name).width + 18;
  const tag = f.skin ?? fd.nickname;
  ctx.font = `700 22px ${DISPLAY}`;
  const tw = ctx.measureText(tag).width + 26;
  if (nx + tw < W - 200) {
    ctx.fillStyle = f.skin ? 'rgba(255,194,58,0.16)' : 'rgba(63,224,255,0.14)';
    ctx.strokeStyle = f.skin ? C.gold : 'rgba(63,224,255,0.8)';
    ctx.lineWidth = 2;
    roundRect(ctx, nx, 1086, tw, 40, 20);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = f.skin ? C.goldHi : '#c9f6ff';
    ctx.fillText(tag, nx + 13, 1115);
    nx += tw;
  }
  const vs = `vs ${f.opponent} · ${FIGHTERS[f.opponentFighter].name}`;
  const vpx = fit(ctx, vs, (p) => `600 ${p}px ${BODY}`, W - M * 2 - 200, 30);
  ctx.font = `600 ${vpx}px ${BODY}`;
  ctx.fillStyle = 'rgba(220,230,255,0.78)';
  ctx.fillText(vs, M, 1162);
  ctx.restore();
  // a KO — only when the fight really ended by one
  if (f.method === 'ko') {
    ctx.save();
    const kx = W - M - 70;
    const ky = 1112;
    const kg = ctx.createRadialGradient(kx - 16, ky - 20, 6, kx, ky, 72);
    kg.addColorStop(0, '#fff3c4');
    kg.addColorStop(0.5, C.gold);
    kg.addColorStop(1, '#d97a10');
    ctx.shadowColor = 'rgba(255,170,40,0.8)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = kg;
    ctx.beginPath();
    ctx.arc(kx, ky, 64, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#2a0f00';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#2a0f00';
    ctx.textAlign = 'center';
    ctx.font = `italic 900 52px ${DISPLAY}`;
    ctx.fillText('KO', kx, ky + 19);
    ctx.restore();
  }

  // 9. the fight in numbers: the show rating, the time, the combos (the server's replay)
  const tiles: { k: string; v: string; sub?: string; gold?: boolean }[] = [
    { k: tr('ОЦЕНКА БОЯ', 'FIGHT SCORE'), v: `${f.rating}`, sub: `/100 · ${f.grade}`, gold: true },
    { k: f.method === 'ko' ? tr('НОКАУТ НА', 'KO AT') : tr('ВРЕМЯ БОЯ', 'FIGHT TIME'), v: clock(f.duration) },
    { k: tr('КОМБО', 'COMBOS'), v: String(f.combos) },
  ];
  const ty = 1186;
  const th = 88;
  const gap = 16;
  const tw3 = (W - M * 2 - gap * 2) / 3;
  tiles.forEach((t, i) => {
    const x = M + i * (tw3 + gap);
    ctx.save();
    const tg = ctx.createLinearGradient(0, ty, 0, ty + th);
    tg.addColorStop(0, t.gold ? 'rgba(255,194,58,0.20)' : 'rgba(120,140,255,0.14)');
    tg.addColorStop(1, 'rgba(255,255,255,0.03)');
    ctx.fillStyle = tg;
    ctx.strokeStyle = t.gold ? 'rgba(255,194,58,0.75)' : 'rgba(140,190,255,0.35)';
    ctx.lineWidth = 2;
    roundRect(ctx, x, ty, tw3, th, 18);
    ctx.fill();
    ctx.stroke();
    ctx.textBaseline = 'alphabetic';
    ctx.font = `italic 900 46px ${DISPLAY}`;
    ctx.fillStyle = t.gold ? C.goldHi : '#ffffff';
    ctx.fillText(t.v, x + 20, ty + 50);
    if (t.sub) {
      const vw = ctx.measureText(t.v).width;
      ctx.font = `700 22px ${DISPLAY}`;
      ctx.fillStyle = C.gold;
      ctx.fillText(t.sub, x + 24 + vw, ty + 48);
    }
    ctx.font = `600 19px ${BODY}`;
    ctx.fillStyle = 'rgba(200,214,255,0.72)';
    ctx.fillText(t.k, x + 20, ty + 77);
    ctx.restore();
  });

  // 10. the footer: the site; the best combo, the producer and the day
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `700 26px ${BODY}`;
  ctx.fillStyle = C.cyan;
  ctx.fillText(POSTER_SITE, M, H - 28);
  ctx.textAlign = 'right';
  const tail = [f.bestCombo ? `${tr('лучшее комбо', 'best combo')} ${f.bestCombo}` : '', f.producer ?? '', day(f.at)].filter(Boolean).join(' · ');
  const fpx = fit(ctx, tail, (p) => `500 ${p}px ${BODY}`, W - M * 2 - 380, 22, 14);
  ctx.font = `500 ${fpx}px ${BODY}`;
  ctx.fillStyle = 'rgba(200,214,255,0.7)';
  ctx.fillText(tail, W - M, H - 30);
  ctx.restore();
  return out;
}

/** The PNG of the poster. */
export function posterPng(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('toBlob'))), 'image/png'));
}

export const posterFileName = (f: PosterFacts) => `prime-time-showdown-victory-${f.fighter}-${day(f.at).split('.').reverse().join('-')}.png`;

// ------------------------------------------------------------------------ the window
const ICON_POSTER = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 6.6l1.5 3.1 3.4.4-2.5 2.3.7 3.3-3.1-1.8-3.1 1.8.7-3.3-2.5-2.3 3.4-.4z" fill="currentColor"/><path d="M7.5 18.5h9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICON_SAVE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0l-4.5-4.5M12 14l4.5-4.5M4.5 16.5V20h15v-3.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SHARE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5m0 0L8 7.5m4-4l4 4M6 11H5v9.5h14V11h-1" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The small button of the result screen. */
export function posterButton(): string {
  return `<button type="button" class="ps-btn" data-act="poster">${ICON_POSTER}<span>${tr('Постер победы', 'Victory poster')}</span></button>`;
}

/** Can this browser hand an image file to the system's share sheet? */
function canShareFile(file: File): boolean {
  const n = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    return typeof n.share === 'function' && typeof n.canShare === 'function' && n.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/**
 * Opens the preview: the poster is drawn on open (a short «preparing» state), then «Save», «Share» (only where the
 * browser can share an image file) and «Close». Everything it made — the canvas, the PNG, its object URL — is let go
 * when the window closes, by any path (UI.modal's onClose).
 */
export function openPosterPreview(g: Game, f: PosterFacts): void {
  let alive = true;
  let url: string | null = null;
  let file: File | null = null;
  const free = () => {
    alive = false;
    if (url) URL.revokeObjectURL(url);
    url = null;
    file = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') g.ui.closeModal();
  };
  g.ui.modal(
    `<div class="ps" role="dialog" aria-modal="true" aria-labelledby="ps-title">
      <header class="ps-head"><h2 id="ps-title">${ICON_POSTER}${tr('Постер победы', 'Victory poster')}</h2><button type="button" class="ps-x" data-ps="close" aria-label="${tr('Закрыть', 'Close')}">×</button></header>
      <div class="ps-frame" data-ps-frame><div class="ps-wait"><i></i>${tr('Готовим постер…', 'Making the poster…')}</div></div>
      <div class="ps-acts" data-ps-acts hidden></div>
      <p class="ps-note" data-ps-note hidden></p>
    </div>`,
    (root) => {
      const modal = root.querySelector('.modal') as HTMLElement;
      modal.classList.add('ps-modal');
      document.addEventListener('keydown', onKey);
      const frame = modal.querySelector('[data-ps-frame]') as HTMLElement;
      const acts = modal.querySelector('[data-ps-acts]') as HTMLElement;
      const note = modal.querySelector('[data-ps-note]') as HTMLElement;
      const build = async () => {
        // a frame for the «preparing» state to show before the GPU work (a timer too: no frames come in a hidden tab)
        await new Promise<void>((r) => {
          let done = false;
          const go = () => {
            if (!done) {
              done = true;
              r();
            }
          };
          requestAnimationFrame(() => setTimeout(go, 30));
          setTimeout(go, 150);
        });
        if (!alive) return;
        let canvas: HTMLCanvasElement | null = null;
        try {
          canvas = await drawPoster(g, f);
          if (!alive) return;
          const blob = await posterPng(canvas);
          if (!alive) return;
          file = new File([blob], posterFileName(f), { type: 'image/png' });
          url = URL.createObjectURL(blob);
        } catch {
          if (!alive) return;
          frame.innerHTML = `<div class="ps-wait err">${tr('Не удалось нарисовать постер на этом устройстве. Попробуйте ещё раз.', 'The poster could not be drawn on this device. Try again.')}</div>`;
          acts.hidden = false;
          acts.innerHTML = `<button type="button" class="btn ghost" data-ps="retry">${tr('Повторить', 'Retry')}</button>`;
          return;
        } finally {
          if (canvas) canvas.width = canvas.height = 0;
        }
        const share = canShareFile(file);
        frame.innerHTML = `<img class="ps-img" src="${url}" width="${POSTER.width}" height="${POSTER.height}" alt="${esc(tr(`Постер победы: ${FIGHTERS[f.fighter].name}, оценка ${f.rating}/100`, `Victory poster: ${FIGHTERS[f.fighter].name}, score ${f.rating}/100`))}"/>`;
        acts.innerHTML = `<button type="button" class="btn teal" data-ps="save">${ICON_SAVE}<span>${tr('Сохранить', 'Save')}</span></button>${share ? `<button type="button" class="btn" data-ps="share">${ICON_SHARE}<span>${tr('Поделиться', 'Share')}</span></button>` : ''}`;
        acts.hidden = false;
        note.textContent = share
          ? tr('«Сохранить» — PNG 1080×1350 в загрузки. «Поделиться» — системное меню устройства: отправить картинку или сохранить её там, где оно позволяет.', '«Save» — a 1080×1350 PNG to your downloads. «Share» — your device’s share menu: send the picture or keep it wherever it offers.')
          : tr('«Сохранить» — PNG 1080×1350 в загрузки.', '«Save» — a 1080×1350 PNG to your downloads.');
        note.hidden = false;
      };
      root.addEventListener('click', (e) => {
        if (e.target === root) return;
        const t = (e.target as HTMLElement).closest('[data-ps]') as HTMLElement | null;
        if (!t) return;
        const act = t.dataset.ps;
        if (act === 'close') {
          g.audio.ui('click');
          g.ui.closeModal();
        } else if (act === 'retry') {
          frame.innerHTML = `<div class="ps-wait"><i></i>${tr('Готовим постер…', 'Making the poster…')}</div>`;
          acts.hidden = true;
          void build();
        } else if (act === 'save' && url && file) {
          g.audio.ui('click');
          const a = document.createElement('a');
          a.href = url;
          a.download = file.name;
          a.rel = 'noopener';
          document.body.appendChild(a);
          a.click();
          a.remove();
        } else if (act === 'share' && file) {
          g.audio.ui('click');
          // straight from the tap (the browser's user gesture); a closed sheet is not an error
          navigator.share({ files: [file], title: 'PRIME TIME: SHOWDOWN', text: `${tr('Моя победа в PRIME LEAGUE', 'My PRIME LEAGUE victory')} — ${POSTER_SITE}` }).catch((err: unknown) => {
            if ((err as { name?: string })?.name !== 'AbortError' && alive) g.ui.toast(tr('Не получилось открыть меню «Поделиться». Сохраните постер кнопкой «Сохранить».', 'The share menu did not open. Save the poster with «Save».'));
          });
        }
      });
      void build();
    },
    true,
    free,
  );
}
