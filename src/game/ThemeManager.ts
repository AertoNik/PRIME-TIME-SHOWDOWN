import { COSMETICS, type CosmeticId, type CosmeticSlot } from '../config/cosmetics.config';
import { themeById, type ThemeDef, type ThemeId } from '../config/themes.config';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Arena } from '../render/Arena';
import type { BattleView } from '../render/BattleView';
import type { Renderer } from '../render/Renderer';
import { BAT_SVG, cobwebSVG, frostCornerSVG } from '../ui/eventArt';

/**
 * One place that switches the whole look of the game:
 *  - UI design tokens (CSS custom properties) + data-theme on <html>
 *  - DOM decoration on menu screens (corners, a few floating glyphs)
 *  - 3D arena dressing, light colours, seasonal decor and ambient particles
 *  - VFX palette for combos/confetti, audio sting
 * plus the player's equipped cosmetics (data-card-style / data-frame).
 * Switching disposes everything the previous theme created.
 */
export class ThemeManager {
  private r: Renderer;
  private arena: Arena;
  private battle: BattleView;
  private audio: AudioSystem;
  private uiRoot: HTMLElement;
  private appliedVars: string[] = [];
  private decorEl: HTMLElement | null = null;
  current: ThemeDef | null = null;

  constructor(deps: { renderer: Renderer; arena: Arena; battleView: BattleView; audio: AudioSystem; uiRoot: HTMLElement }) {
    this.r = deps.renderer;
    this.arena = deps.arena;
    this.battle = deps.battleView;
    this.audio = deps.audio;
    this.uiRoot = deps.uiRoot;
  }

  get id(): ThemeId {
    return this.current?.id ?? 'default';
  }

  /** Apply a theme by id (unknown ids fall back to the standard look). Returns true if it changed. */
  apply(id: string): boolean {
    const t = themeById(id);
    if (this.current?.id === t.id) return false;
    this.current = t;
    const root = document.documentElement;
    // UI tokens: drop the previous theme's overrides, then set this theme's
    for (const k of this.appliedVars) root.style.removeProperty(k);
    this.appliedVars = [];
    for (const [k, v] of Object.entries(t.css)) {
      root.style.setProperty(k, v);
      this.appliedVars.push(k);
    }
    root.dataset.theme = t.id;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', t.css['--bg'] ?? '#070816');
    // 3D scene: the arena mixes the theme's light colours into the current studio set's lighting
    this.arena.applyTheme(t, this.r.quality === 'low');
    this.battle.style.combo = t.vfx.combo;
    this.battle.style.confetti = t.vfx.confetti;
    // menu decoration
    this.buildDecor(t);
    return true;
  }

  /** Low graphics preset thins out seasonal particles. */
  setLowQuality(low: boolean): void {
    this.arena.setLowQuality(low);
  }

  /** Camera "без тряски" also calms the decorative animations. */
  setMotion(intensity: number): void {
    document.documentElement.dataset.motion = intensity <= 0 ? 'off' : intensity < 1 ? 'reduced' : 'full';
    // studio sets (swinging lamps, bats, fog drift, roulette spin): the camera setting,
    // further calmed when the system asks for reduced motion
    const sys = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.arena.setMotion(sys ? Math.min(intensity, 0.3) : intensity);
  }

  sting(): void {
    if (this.current) this.audio.sting(this.current.sting);
  }

  /** Reflect equipped cosmetics in the UI and in the battle style. */
  applyCosmetics(equipped: Partial<Record<CosmeticSlot, CosmeticId>>): void {
    const root = document.documentElement;
    const card = equipped.cardStyle;
    if (card === 'card_pumpkin') root.dataset.cardStyle = 'pumpkin';
    else delete root.dataset.cardStyle;
    if (equipped.broadcastFrame === 'frame_spooky') root.dataset.frame = 'spooky';
    else delete root.dataset.frame;
    if (equipped.title === 'title_halloween_champion') root.dataset.title = 'halloween-champion';
    else if (equipped.title === 'title_prime_legend') root.dataset.title = 'prime-legend';
    else delete root.dataset.title;
    this.battle.style.dashFx = equipped.dashFx === 'dash_phantom' ? 'phantom' : null;
    this.battle.style.victoryFx = equipped.victoryFx === 'victory_pumpkin' ? 'pumpkin' : null;
  }

  /** Title text for the menu nameplate, if a title cosmetic is equipped. */
  static titleName(equipped: Partial<Record<CosmeticSlot, CosmeticId>>): string | null {
    const id = equipped.title;
    return id ? COSMETICS[id].name : null;
  }

  private buildDecor(t: ThemeDef): void {
    this.decorEl?.remove();
    this.decorEl = null;
    if (t.ui.decor === 'none') return;
    const el = document.createElement('div');
    el.className = `theme-decor decor-${t.ui.decor}`;
    el.setAttribute('aria-hidden', 'true');
    const corner = t.ui.decor === 'cobweb' ? cobwebSVG() : frostCornerSVG();
    let html = `<div class="td-corner l">${corner}</div><div class="td-corner r">${corner}</div>`;
    // a handful of floating glyphs: glowing motes + bats (halloween) or snowflakes (winter)
    const n = t.ui.decor === 'cobweb' ? 9 : 12;
    for (let i = 0; i < n; i++) {
      const left = ((i * 37) % 100) + (i % 3) * 3;
      const delay = -((i * 1.7) % 9);
      const dur = 9 + ((i * 2.3) % 6);
      const color = t.ui.particleColors[i % t.ui.particleColors.length] ?? '#fff';
      const size = 4 + ((i * 5) % 6);
      if (t.ui.decor === 'cobweb' && i % 3 === 2) {
        html += `<span class="td-bat" style="left:${left}%;top:${12 + ((i * 13) % 50)}%;animation-delay:${delay}s;animation-duration:${dur + 4}s">${BAT_SVG}</span>`;
      } else {
        html += `<span class="td-p" style="left:${left}%;--sz:${size}px;--c:${color};animation-delay:${delay}s;animation-duration:${dur}s"></span>`;
      }
    }
    el.innerHTML = html;
    this.uiRoot.prepend(el);
    this.decorEl = el;
  }
}
