import { CanvasTexture, Color, Group, RepeatWrapping, SRGBColorSpace } from 'three';
import { arenaById, type ArenaId } from '../config/arenas.config';
import { THEMES, type Sponsor, type ThemeDef } from '../config/themes.config';
import type { Renderer } from './Renderer';
import { SeasonalDecor } from './SeasonalDecor';
import { BacklotStage } from './stages/BacklotStage';
import { CasinoStage } from './stages/CasinoStage';
import { GraveyardStage } from './stages/GraveyardStage';
import { HauntedStage } from './stages/HauntedStage';
import { OriginalStage } from './stages/OriginalStage';
import type { Stage, StageShared } from './stages/StageKit';
import { canvasTexture, makeCanvas } from './textures';
import type { VFX } from './VFX';

/** Scrolling LED ribbon: sponsors + one live broadcast segment redrawn with match data. */
function drawBoard(
  c: HTMLCanvasElement,
  live: { left: string; right: string; rating: number; mode: string },
  blink: boolean,
  sponsors: Sponsor[],
  idle: [string, string],
  accent: string,
): void {
  const g = c.getContext('2d')!;
  const W = c.width;
  const H = c.height;
  const segs = sponsors.length + 1;
  const seg = W / segs;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  sponsors.forEach((s, i) => {
    g.fillStyle = s.bg;
    g.fillRect(i * seg, 0, seg, H);
    g.fillStyle = s.fg;
    const size = Math.round(H * (s.text.length > 12 ? 0.36 : 0.5));
    g.font = `italic 900 ${size}px Unbounded, "Arial Black", sans-serif`;
    g.fillText(s.text, i * seg + seg / 2, H / 2 + 4);
  });
  // live segment
  const x0 = sponsors.length * seg;
  g.fillStyle = '#070a1c';
  g.fillRect(x0, 0, seg, H);
  g.fillStyle = blink ? '#ff2a4a' : '#7a1020';
  g.beginPath();
  g.arc(x0 + 30, H / 2, 12, 0, Math.PI * 2);
  g.fill();
  g.font = `900 ${Math.round(H * 0.34)}px Unbounded, "Arial Black", sans-serif`;
  g.textAlign = 'left';
  g.fillStyle = '#ffffff';
  if (live.mode === 'fight') {
    g.fillText(`LIVE  ${live.left} VS ${live.right}`, x0 + 52, H * 0.34);
    g.fillStyle = '#ffd23a';
    g.fillText(`★ РЕЙТИНГ ${Math.round(live.rating)}`, x0 + 52, H * 0.74);
  } else {
    g.fillText(`LIVE  ${idle[0]}`, x0 + 52, H * 0.34);
    g.fillStyle = accent;
    g.fillText(idle[1], x0 + 52, H * 0.74);
  }
  // LED dot mask
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let y = 0; y < H; y += 6) g.fillRect(0, y, W, 2);
}

export interface ScreenInfo {
  mode: 'menu' | 'fight' | 'result';
  left: string;
  right: string;
  leftColor: string;
  rightColor: string;
  rating: number;
  timer: string;
  headline: string;
}

const STAGE_TYPES: Record<ArenaId, new (sh: StageShared) => Stage> = {
  original: OriginalStage,
  casino: CasinoStage,
  backlot: BacklotStage,
  haunted: HauntedStage,
  graveyard: GraveyardStage,
};

const _a = new Color();
const _b = new Color();
function mixHex(a: number, b: number, k: number): number {
  return _a.setHex(a).lerp(_b.setHex(b), k).getHex();
}

/**
 * The TV studio (Alpha 1.4: ArenaManager role). Owns the active studio set
 * (src/render/stages/*), the live big-screen and LED-ribbon canvases every set
 * shows, the season/BOSS FIGHT theme layer with its decoration, and the studio
 * lighting. Exactly one set exists at a time; switching frees the previous one.
 */
/** Big-screen caption font, shrunk until the text fits the screen width. */
function fitFont(g: CanvasRenderingContext2D, text: string, size: number, max: number): string {
  const font = (px: number) => `italic 900 ${px}px Unbounded, "Arial Black", sans-serif`;
  g.font = font(size);
  const w = g.measureText(text).width;
  return w > max ? font(Math.max(14, Math.floor((size * max) / w))) : font(size);
}

export class Arena {
  readonly group = new Group();
  private r: Renderer | null;
  private stage: Stage;
  /** The set currently built. */
  stageId: ArenaId = 'original';
  private shared: StageShared;
  private crowdUniforms = { uTime: { value: 0 }, uExcite: { value: 0.2 } };
  private boardTex: CanvasTexture;
  private boardCanvas: HTMLCanvasElement;
  private boardTimer = 0;
  private boardBlink = false;
  private screenCanvas: HTMLCanvasElement;
  private screenCtx: CanvasRenderingContext2D;
  private screenTex: CanvasTexture;
  private screenTimer = 0;
  private screenInfo: ScreenInfo = {
    mode: 'menu',
    left: '',
    right: '',
    leftColor: '#22f0e0',
    rightColor: '#ff7a1a',
    rating: 0,
    timer: '',
    headline: 'PRIME TIME: SHOWDOWN',
  };
  private theme: ThemeDef = THEMES.default;
  private decor: SeasonalDecor | null = null;
  private lowQuality = false;
  private motion = 1;
  private time = 0;
  excitement = 0.2;
  private flashBoost = 0;
  vfx: VFX | null = null;

  constructor(renderer: Renderer | null = null) {
    this.r = renderer;
    this.boardCanvas = makeCanvas(2560, 128).c;
    this.paintBoard(true);
    this.boardTex = canvasTexture(this.boardCanvas);
    this.boardTex.wrapS = RepeatWrapping;
    const sc = makeCanvas(1024, 512);
    this.screenCanvas = sc.c;
    this.screenCtx = sc.g;
    this.screenTex = canvasTexture(sc.c);
    this.screenTex.colorSpace = SRGBColorSpace;
    this.shared = {
      screenTex: this.screenTex,
      boardTex: this.boardTex,
      crowd: this.crowdUniforms,
      vfx: () => this.vfx,
      owned: new Set([this.screenTex, this.boardTex]),
    };
    this.stage = new OriginalStage(this.shared);
    this.group.add(this.stage.group);
    this.drawScreen();
    this.applyLights();
  }

  /**
   * Build another studio set (no-op if it is already up). The previous set is
   * disposed; the current theme, decoration and lighting are re-applied on the new one.
   */
  setStage(id: ArenaId): boolean {
    if (id === this.stageId) return false;
    this.stage.dispose();
    this.stageId = id;
    this.stage = new STAGE_TYPES[id](this.shared);
    this.stage.setQuality(this.lowQuality);
    this.stage.setMotion(this.motion);
    this.stage.setMenu(this.screenInfo.mode === 'menu');
    this.group.add(this.stage.group);
    this.applyTheme(this.theme, this.lowQuality, true);
    return true;
  }

  setScreen(info: Partial<ScreenInfo>): void {
    Object.assign(this.screenInfo, info);
    const menu = this.screenInfo.mode === 'menu';
    this.decor?.setMenuVisible(menu);
    this.stage.setMenu(menu);
  }

  private paintBoard(blink: boolean): void {
    const si = this.screenInfo;
    const th = this.theme.arena;
    drawBoard(this.boardCanvas, { left: si.left, right: si.right, rating: si.rating, mode: si.mode }, blink, th.sponsors, th.boardLive, th.screen.colorA);
  }

  /**
   * Re-dress the studio for a theme (season or BOSS FIGHT): signs, LED ribbon,
   * big-screen palette, spotlights, glow sticks, seasonal decoration placed for
   * the current set, and the light mix. Collisions never change; previous seasonal
   * objects are disposed.
   */
  applyTheme(theme: ThemeDef, lowQuality: boolean, force = false): void {
    const changed = force || theme !== this.theme;
    this.theme = theme;
    this.lowQuality = lowQuality;
    const th = theme.arena;
    this.stage.applyTheme(th, theme.id === 'default');
    this.paintBoard(this.boardBlink);
    this.boardTex.needsUpdate = true;
    this.drawScreen();
    if (changed) {
      this.decor?.dispose();
      this.decor = null;
      if (th.decor !== 'none' || th.ambient !== 'none') {
        const def = arenaById(this.stageId);
        const native = !!def.nativeSeason && (th.decor === 'pumpkins' || th.decor === 'championHalloween') && def.nativeSeason === 'halloween';
        this.decor = new SeasonalDecor(th.decor, th.ambient, th.ambientColors, lowQuality, this.stage.layout, native);
        this.decor.setMenuVisible(this.screenInfo.mode === 'menu');
        this.group.add(this.decor.group);
      }
    }
    this.applyLights();
  }

  /**
   * Studio lights = the set's own lighting, recoloured by a season / BOSS FIGHT
   * theme as strongly as the set allows (the original studio: fully, as before).
   */
  private applyLights(): void {
    if (!this.r) return;
    const def = arenaById(this.stageId);
    const st = def.lighting;
    const tl = this.theme.arena.lights;
    const k = this.theme.id === 'default' ? 0 : def.themeTint;
    this.r.applyLights(
      {
        hemiSky: mixHex(st.hemiSky, tl.hemiSky, k),
        hemiGround: mixHex(st.hemiGround, tl.hemiGround, k),
        fillA: mixHex(st.fillA, tl.fillA, k),
        fillB: mixHex(st.fillB, tl.fillB, k),
        rim: mixHex(st.rim, tl.rim, k),
        fog: mixHex(st.fog, tl.fog, k),
        key: st.key,
      },
      st.intensity,
    );
  }

  setLowQuality(low: boolean): void {
    this.lowQuality = low;
    this.decor?.setQuality(low);
    this.stage.setQuality(low);
  }

  /** Camera "без тряски" / reduced motion also calms the set animations. */
  setMotion(intensity: number): void {
    this.motion = Math.max(0, Math.min(1, intensity));
    this.stage.setMotion(this.motion);
  }

  /** Recolour the moving spotlights (BOSS FIGHT phases) without rebuilding the theme. */
  setSpots(colors: number[]): void {
    this.stage.setSpots(colors);
  }

  // set pieces (events from the simulation)
  propHit(i: number, hp: number, heavy: boolean, x: number, z: number): void {
    this.stage.propHit(i, hp, heavy, x, z);
  }

  propBreak(i: number, x: number, z: number): void {
    this.stage.propBreak(i, x, z);
  }

  propRespawn(i: number, x: number, z: number): void {
    this.stage.propRespawn(i, x, z);
  }

  /** Alpha 1.7.5: cover on the fighting floor (GRAVEYARD BROADCAST) reacted to a hit. */
  coverEvent(i: number, what: 'hit' | 'crack' | 'break', stage: number, x: number, z: number, dx: number, dz: number, heavy: boolean): void {
    this.stage.coverEvent(i, what, stage, x, z, dx, dz, heavy);
  }

  /** All set pieces intact again (every new fight / wave and back in the menu). */
  resetProps(): void {
    this.stage.resetProps();
  }

  private drawScreen(): void {
    const g = this.screenCtx;
    const W = this.screenCanvas.width;
    const H = this.screenCanvas.height;
    const s = this.screenInfo;
    const th = this.theme.arena.screen;
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, th.bgTop);
    bg.addColorStop(1, th.bgBottom);
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    // moving diagonal stripes
    g.save();
    g.globalAlpha = 0.08;
    g.fillStyle = th.colorA;
    const off = (this.time * 60) % 80;
    for (let x = -H; x < W + H; x += 80) {
      g.beginPath();
      g.moveTo(x + off, 0);
      g.lineTo(x + off + 30, 0);
      g.lineTo(x + off + 30 - H, H);
      g.lineTo(x + off - H, H);
      g.fill();
    }
    g.restore();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // LIVE tag
    g.fillStyle = '#ff2a4a';
    g.beginPath();
    g.roundRect(28, 26, 150, 52, 10);
    g.fill();
    g.fillStyle = '#fff';
    g.font = '900 30px Unbounded, "Arial Black", sans-serif';
    g.fillText(Math.floor(this.time * 2) % 2 ? '● LIVE' : '  LIVE', 103, 54);

    if (s.mode === 'menu') {
      g.font = 'italic 900 92px Unbounded, "Arial Black", sans-serif';
      g.fillStyle = '#ffffff';
      g.shadowColor = th.colorA;
      g.shadowBlur = 24;
      g.fillText(th.title, W / 2, H / 2 - 50);
      g.shadowColor = th.colorB;
      g.fillStyle = th.colorB;
      g.font = 'italic 900 72px Unbounded, "Arial Black", sans-serif';
      g.fillText(th.subtitle, W / 2, H / 2 + 50);
      g.shadowBlur = 0;
      g.font = '700 28px Rubik, Arial, sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.fillText(s.headline, W / 2, H - 50);
    } else {
      g.font = 'italic 900 64px Unbounded, "Arial Black", sans-serif';
      g.fillStyle = s.leftColor;
      g.shadowColor = s.leftColor;
      g.shadowBlur = 18;
      g.fillText(s.left, W * 0.27, H * 0.42);
      g.fillStyle = s.rightColor;
      g.shadowColor = s.rightColor;
      g.fillText(s.right, W * 0.73, H * 0.42);
      g.shadowBlur = 0;
      g.fillStyle = '#fff';
      g.font = 'italic 900 54px Unbounded, "Arial Black", sans-serif';
      g.fillText('VS', W / 2, H * 0.42);
      g.font = '900 40px Unbounded, "Arial Black", sans-serif';
      g.fillText(s.timer, W / 2, 54);
      // rating bar
      const bx = 160;
      const bw = W - 320;
      const by = H * 0.74;
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath();
      g.roundRect(bx, by, bw, 30, 15);
      g.fill();
      const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
      grd.addColorStop(0, '#22f0e0');
      grd.addColorStop(1, '#ff7a1a');
      g.fillStyle = grd;
      g.beginPath();
      g.roundRect(bx, by, Math.max(30, (bw * s.rating) / 100), 30, 15);
      g.fill();
      g.font = '800 26px Rubik, Arial, sans-serif';
      g.fillStyle = '#fff';
      g.fillText(`РЕЙТИНГ ШОУ ${Math.round(s.rating)}`, W / 2, by + 62);
      if (th.fightHeadline) {
        g.font = fitFont(g, th.fightHeadline, 30, W - 60);
        g.fillStyle = th.colorB;
        g.fillText(th.fightHeadline, W / 2, H - 34);
      }
      if (s.headline) {
        g.font = fitFont(g, s.headline, 40, W - 60);
        g.fillStyle = '#ffe14d';
        g.fillText(s.headline, W / 2, H * 0.2);
      }
    }
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    this.screenTex.needsUpdate = true;
  }

  /** Short celebration burst (big reactions). */
  hype(amount = 1): void {
    this.flashBoost = Math.max(this.flashBoost, amount);
  }

  /** `fightPaused`: debris of broken set pieces waits while the fight is paused. */
  update(dt: number, fightPaused = false): void {
    this.stage.debrisFrozen = fightPaused;
    this.time += dt;
    const t = this.time;
    this.flashBoost = Math.max(0, this.flashBoost - dt * 0.8);
    const ex = Math.min(1, this.excitement + this.flashBoost * 0.6);
    this.crowdUniforms.uTime.value = t;
    this.crowdUniforms.uExcite.value += (ex - this.crowdUniforms.uExcite.value) * Math.min(1, dt * 2);
    this.boardTex.offset.x = (t * 0.03) % 1;
    this.stage.update(dt, ex, this.flashBoost);
    this.decor?.update(dt, ex);

    this.boardTimer -= dt;
    if (this.boardTimer <= 0) {
      this.boardTimer = 0.5;
      this.boardBlink = !this.boardBlink;
      this.paintBoard(this.boardBlink);
      this.boardTex.needsUpdate = true;
    }
    this.screenTimer -= dt;
    if (this.screenTimer <= 0) {
      this.screenTimer = 0.25;
      this.drawScreen();
    }
  }

  dispose(): void {
    this.decor?.dispose();
    this.decor = null;
    this.stage.dispose();
    this.screenTex.dispose();
    this.boardTex.dispose();
  }
}
