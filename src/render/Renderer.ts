import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  type Material,
  NeutralToneMapping,
  type Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  type Texture,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { PACED_INTERVAL_S, PACING_WINDOW, pacingStep } from './framePacing';

export type QualityLevel = 'high' | 'medium' | 'low';
/** Beta 2.6.2: a stepped warm-up (Renderer.warmStep): the objects, how far compiled (i) and drawn (j), for which target. */
interface WarmJob {
  objs: Object3D[];
  i: number;
  j: number;
  bloom: boolean;
  shadows: boolean;
  /** Draw every object (a new target: nothing has been drawn there) — or only the hidden ones (the frame draws the rest). */
  drawAll: boolean;
  /** Materials this job has drawn already (a step draws at most six new ones: their driver setup is the cost). */
  drawn?: Set<Material>;
}
export type QualitySetting = 'auto' | QualityLevel;

interface QualityProfile {
  pixelRatio: number;
  /** Upper bound on rendered pixels (megapixels) so big tablets/desktops don't overdraw. */
  maxMegapixels: number;
  bloom: boolean;
  shadows: boolean;
  shadowSize: number;
}

const PROFILES: Record<QualityLevel, QualityProfile> = {
  high: { pixelRatio: 2, maxMegapixels: 2.4, bloom: true, shadows: true, shadowSize: 2048 },
  medium: { pixelRatio: 1.5, maxMegapixels: 1.5, bloom: true, shadows: true, shadowSize: 1024 },
  low: { pixelRatio: 1, maxMegapixels: 0.9, bloom: false, shadows: false, shadowSize: 512 },
};

/**
 * Owns the WebGL renderer, scene, camera, lights and post-processing.
 * Adapts quality automatically from measured frame times.
 */
export class Renderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly key: DirectionalLight;
  readonly rim: DirectionalLight;
  readonly hemi: HemisphereLight;
  readonly fillA: DirectionalLight;
  readonly fillB: DirectionalLight;
  /** Flash light for big hits (intensity animated, never removed). */
  readonly flash: DirectionalLight;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private container: HTMLElement;
  private width = 1;
  private height = 1;
  quality: QualityLevel = 'high';
  setting: QualitySetting = 'auto';
  /** Screen-space vertical offset (px) for HUD-aware framing. */
  viewShift = 0;

  private frameTimes: number[] = [];
  private lastAdjust = 0;
  private flashIntensity = 0;
  private observer: ResizeObserver | null = null;
  /** Called after the drawing buffer changed size (layout-dependent framing). */
  onResize: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping ?? ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(0x05060f, 1);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x070816);
    this.scene.fog = new Fog(0x070816, 26, 60);

    this.camera = new PerspectiveCamera(38, 9 / 16, 0.1, 200);
    this.camera.position.set(0, 16, 13);
    this.camera.lookAt(0, 0, 0);

    this.hemi = new HemisphereLight(0x9fb6ff, 0x3a1f4a, 1.35);
    this.scene.add(this.hemi);

    this.key = new DirectionalLight(0xfff2e0, 2.4);
    this.key.position.set(-6, 16, 9);
    this.key.castShadow = true;
    const sc = this.key.shadow.camera;
    sc.left = -10;
    sc.right = 10;
    sc.top = 12;
    sc.bottom = -12;
    sc.near = 1;
    sc.far = 45;
    this.key.shadow.bias = -0.0006;
    this.key.shadow.normalBias = 0.02;
    this.key.shadow.radius = 3;
    this.scene.add(this.key);
    this.scene.add(this.key.target);

    this.rim = new DirectionalLight(0x6fe8ff, 1.5);
    this.rim.position.set(4, 8, -12);
    this.scene.add(this.rim);

    // Directional fills (point lights band badly on toon shading).
    this.fillA = new DirectionalLight(0x22d8ff, 0.85);
    this.fillA.position.set(-10, 5, 3);
    this.scene.add(this.fillA);
    this.fillB = new DirectionalLight(0xff6a2a, 0.85);
    this.fillB.position.set(10, 5, -4);
    this.scene.add(this.fillB);

    this.flash = new DirectionalLight(0xffffff, 0);
    this.flash.position.set(0, 10, 8);
    this.scene.add(this.flash);

    this.applyQuality('high');
    window.addEventListener('resize', this.resize);
    window.visualViewport?.addEventListener('resize', this.resize);
    // The frame can change size without a window resize (address bar, CSS var updates).
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
    }
    this.resize();
  }

  private resize = (): void => {
    const r = this.container.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    const dpr = this.targetPixelRatio(w, h);
    if (w === this.width && h === this.height && dpr === this.renderer.getPixelRatio() && this.sized) return;
    this.sized = true;
    this.width = w;
    this.height = h;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = this.width + 'px';
    this.renderer.domElement.style.height = this.height + 'px';
    this.camera.aspect = this.width / this.height;
    this.updateProjection();
    if (this.composer) {
      this.composer.setSize(this.width, this.height);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
    this.bloom?.resolution.set(this.width, this.height);
    this.onResize?.();
  };

  private sized = false;

  /** Device pixel ratio capped by the quality profile and a total pixel budget. */
  private targetPixelRatio(w: number, h: number): number {
    const p = PROFILES[this.quality];
    const budget = Math.sqrt((p.maxMegapixels * 1e6) / Math.max(1, w * h));
    const dpr = Math.min(window.devicePixelRatio || 1, p.pixelRatio, Math.max(1, budget));
    return Math.round(dpr * 100) / 100;
  }

  get size(): { w: number; h: number } {
    return { w: this.width, h: this.height };
  }

  updateProjection(): void {
    if (Math.abs(this.viewShift) > 0.5) {
      this.camera.setViewOffset(this.width, this.height, 0, this.viewShift, this.width, this.height);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  setQualitySetting(s: QualitySetting): void {
    // (Beta 2.6.2: the player's own choice wins over an automatic drop still being prepared)
    this.downTo = null;
    this.setting = s;
    this.applyQuality(s === 'auto' ? 'high' : s);
    this.frameTimes = [];
    this.frameInterval = 0;
  }

  /**
   * Beta 2.5.5 — the paced frame interval in seconds (0: draw on every screen refresh). The automatic quality sets it
   * to 1/30 s when the device still struggles at the lowest quality (src/render/framePacing.ts); Game.loop keeps to it.
   */
  frameInterval = 0;

  /** Called after the quality level changes (auto downgrade or settings). */
  onQuality: ((q: QualityLevel) => void) | null = null;

  applyQuality(q: QualityLevel): void {
    this.quality = q;
    this.onQuality?.(q);
    const p = PROFILES[q];
    this.renderer.shadowMap.enabled = p.shadows;
    this.key.castShadow = p.shadows;
    if (p.shadows && this.key.shadow.mapSize.x !== p.shadowSize) {
      this.key.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    if (p.bloom && !this.composer) {
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new Vector2(this.width, this.height), 0.62, 0.5, 1.3);
      composer.addPass(this.bloom);
      composer.addPass(new OutputPass());
      this.composer = composer;
    } else if (!p.bloom && this.composer) {
      this.composer.dispose();
      this.composer = null;
      this.bloom?.dispose();
      this.bloom = null;
    }
    this.sized = false;
    this.resize();
  }

  /** Forget frame-time history (e.g. after the tab was in the background). */
  resetMonitor(now: number): void {
    this.frameTimes = [];
    this.lastAdjust = now;
  }

  /**
   * Feed real frame times; drops quality when the device struggles — a slow average or (Beta 2.5.5) frequent long
   * frames — and, at the lowest quality, paces the game to an even 30 fps (src/render/framePacing.ts).
   */
  monitor(dtReal: number, now: number): void {
    // Background tabs run on throttled timers: those frame times say nothing about the GPU.
    if (this.setting !== 'auto' || document.hidden) return;
    this.frameTimes.push(dtReal);
    if (this.frameTimes.length > PACING_WINDOW) this.frameTimes.shift();
    if (now - this.lastAdjust < 3 || this.frameTimes.length < PACING_WINDOW) return;
    const step = pacingStep(this.frameTimes, this.quality, this.frameInterval > 0);
    if (step === 'down') {
      this.stepDown(this.quality === 'high' ? 'medium' : 'low');
      this.frameTimes = [];
    } else if (step === 'pace30') {
      this.frameInterval = PACED_INTERVAL_S;
      this.frameTimes = [];
    }
    this.lastAdjust = now;
  }

  /**
   * Beta 2.6.2 — the automatic drop to a quality WITHOUT bloom (medium → low) changes where the frame is drawn (the bloom
   * buffer → the screen), and every shader then compiled again for the screen in the first frame after the switch — a
   * 0.2–0.7 s freeze (measured) mid-fight, on exactly the phone that was already struggling; each effect's first show
   * after it compiled again too. Now the shaders for the screen are compiled first, two new programs a frame at most
   * (prepareDown, from render), while the frame is still drawn as before; the switch itself then compiles nothing, and the hidden
   * effects get their one draw for the screen at once. A drop that keeps bloom (high → medium) switches at once, as before.
   */
  private stepDown(q: QualityLevel): void {
    if (this.downTo) return;
    if (PROFILES[q].bloom === !!this.composer) {
      this.applyQuality(q);
      return;
    }
    const objs: Object3D[] = [];
    this.scene.traverse((o) => {
      if ((o as { material?: unknown }).material) objs.push(o);
    });
    this.downTo = { q, objs, i: 0, j: 0, bloom: PROFILES[q].bloom, shadows: PROFILES[q].shadows, drawAll: true };
  }
  private downTo: (WarmJob & { q: QualityLevel }) | null = null;

  /** One step of the prepared drop, before the frame is drawn (render); the last one switches the quality. */
  private prepareDown(): void {
    const d = this.downTo!;
    this.warmStep(d);
    if (d.i < d.objs.length || d.j < d.objs.length) return;
    this.downTo = null;
    this.applyQuality(d.q);
    // everything has been drawn once for the screen: the match warm-up need not draw it again
    this.warmed = new WeakSet<Material>();
    this.markWarmed(this.scene);
  }

  /**
   * One step of a stepped warm-up for a target (`bloom`: the bloom pass's buffer, else the screen) and shadows: first the
   * new programs (two a step at most — each is ~20–30 ms of driver work the next frame waits for; programs that exist are
   * only looked up), then every object drawn once (six new materials a step — the driver's per-draw setup for that
   * target — and any number of objects whose materials are drawn already, 64 at most) on a layer of
   * its own so nothing else is drawn, hidden ones shown and off-view ones not culled for that draw. The bloom buffer is
   * redrawn by the frame that follows; a draw into the screen is covered by that frame too (or by the caller). Returns
   * whether it drew.
   */
  private warmStep(d: WarmJob): boolean {
    const gl = this.renderer;
    const prev = gl.getRenderTarget();
    const shadows = gl.shadowMap.enabled;
    const cast = this.key.castShadow;
    const LAYER = 31;
    const lights = [this.hemi, this.key, this.rim, this.fillA, this.fillB, this.flash];
    const camMask = this.camera.layers.mask;
    const shown: Object3D[] = [];
    const culled: Object3D[] = [];
    const tagged: Object3D[] = [];
    let drew = false;
    try {
      gl.setRenderTarget(d.bloom && this.composer ? this.composer.readBuffer : null);
      gl.shadowMap.enabled = d.shadows;
      this.key.castShadow = d.shadows;
      if (d.i < d.objs.length) {
        const p0 = gl.info.programs?.length ?? 0;
        for (let k = 0; d.i < d.objs.length && k < 48 && (gl.info.programs?.length ?? 0) - p0 < 2; d.i++, k++) {
          if (d.objs[d.i].parent) gl.compile(d.objs[d.i], this.camera, this.scene);
        }
        // finish THIS step's programs now (a status query waits for them): otherwise the queued ones all landed on the
        // first draw step at once — one long frame instead of short ones (measured 0.4–0.8 s at boot)
        const progs = (gl.info.programs ?? []) as unknown as { program: WebGLProgram }[];
        const ctx = gl.getContext();
        for (let k = p0; k < progs.length; k++) ctx.getProgramParameter(progs[k].program, ctx.LINK_STATUS);
      } else {
        const drawn = (d.drawn ??= new Set<Material>());
        let fresh = 0;
        for (let n = 0; d.j < d.objs.length && n < 64 && fresh < 6; d.j++) {
          const o = d.objs[d.j];
          if (!o.parent) continue;
          if (!d.drawAll) {
            let seen = true;
            for (let p: Object3D | null = o; p && p !== this.scene; p = p.parent) if (!p.visible) seen = false;
            if (seen) continue;
          }
          n++;
          const m = (o as { material?: Material | Material[] }).material;
          for (const x of m ? (Array.isArray(m) ? m : [m]) : []) {
            if (!drawn.has(x)) {
              drawn.add(x);
              fresh++;
            }
          }
          o.layers.enable(LAYER);
          tagged.push(o);
          for (let p: Object3D | null = o; p && p !== this.scene; p = p.parent) {
            if (!p.visible) {
              p.visible = true;
              shown.push(p);
            }
          }
          if (o.frustumCulled) {
            o.frustumCulled = false;
            culled.push(o);
          }
        }
        for (const l of lights) l.layers.enable(LAYER);
        this.camera.layers.set(LAYER);
        if (tagged.length) {
          gl.render(this.scene, this.camera);
          drew = true;
        }
      }
    } catch {
      d.i = d.j = d.objs.length;
    } finally {
      this.camera.layers.mask = camMask;
      for (const l of lights) l.layers.disable(LAYER);
      for (const o of tagged) o.layers.disable(LAYER);
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      gl.setRenderTarget(prev);
      gl.shadowMap.enabled = shadows;
      this.key.castShadow = cast;
    }
    return drew;
  }

  /**
   * Studio light colours (seasons) and, per studio set (Alpha 1.4), the key colour
   * and intensities. Never adds lights: the same five directional/hemisphere lights.
   */
  applyLights(
    l: { hemiSky: number; hemiGround: number; fillA: number; fillB: number; rim: number; fog: number; key?: number },
    intensity?: { hemi: number; key: number; fill: number; rim: number },
  ): void {
    this.hemi.color.setHex(l.hemiSky);
    this.hemi.groundColor.setHex(l.hemiGround);
    this.fillA.color.setHex(l.fillA);
    this.fillB.color.setHex(l.fillB);
    this.rim.color.setHex(l.rim);
    if (l.key !== undefined) this.key.color.setHex(l.key);
    if (intensity) {
      this.hemi.intensity = intensity.hemi;
      this.key.intensity = intensity.key;
      this.fillA.intensity = intensity.fill;
      this.fillB.intensity = intensity.fill;
      this.rim.intensity = intensity.rim;
    }
    (this.scene.fog as Fog).color.setHex(l.fog);
    (this.scene.background as Color).setHex(l.fog);
  }

  setBloomStrength(v: number): void {
    if (this.bloom) this.bloom.strength = v;
  }

  pulseFlash(color: number, intensity: number): void {
    this.flash.color.setHex(color);
    this.flashIntensity = Math.max(this.flashIntensity, intensity);
  }

  /**
   * Beta 2.6.2 — compiles, ahead of the fight, the shaders of everything the scene holds (the effect pools, card props,
   * fighter FX hidden until their first show) and uploads their textures. Until 2.6.1 each compiled on its first show:
   * the first SHIELD, SHOCK, FALSE START, PRESSURE MINE … of a session froze the fight for 0.2–1 s (docs/BETA_2_6_2_*).
   * A program depends on where the frame is drawn — the bloom pass's buffer at high / medium quality, the screen at
   * low — so it compiles for the target the frame really uses now. A compiled program is not all: the GPU driver builds
   * the rest of its pipeline on the first DRAW (as for the fighters in 2.5 — Game.warmRig), so the hidden objects are
   * also drawn once, into that same target: the bloom buffer is redrawn by the next frame before anything is shown; at
   * low quality (the screen) the true frame is drawn over it at once. Programs already compiled are only looked up — a
   * later fight costs a few ms.
   */
  warmPrograms(): { programs: number; textures: number; drawn: number; ms: number } {
    const gl = this.renderer;
    const t = performance.now();
    const before = gl.info.programs?.length ?? 0;
    const tex0 = gl.info.memory.textures;
    // only what has not been warmed yet (at boot: all of it; a later fight: its few new objects, or nothing)
    const fresh: Object3D[] = [];
    const mats = new Set<Material>();
    this.scene.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material;
      if (!m) return;
      let any = false;
      for (const x of Array.isArray(m) ? m : [m]) {
        if (this.warmed.has(x)) continue;
        mats.add(x);
        any = true;
      }
      if (any) fresh.push(o);
    });
    if (!fresh.length) return { programs: 0, textures: 0, drawn: 0, ms: Math.round(performance.now() - t) };
    const prev = gl.getRenderTarget();
    const target = this.composer ? this.composer.readBuffer : null;
    const shown: Object3D[] = [];
    const culled: Object3D[] = [];
    try {
      gl.setRenderTarget(target);
      if (fresh.length > 48) gl.compile(this.scene, this.camera);
      else for (const o of fresh) gl.compile(o, this.camera, this.scene);
      // their pictures too: a texture uploads on its first draw (a few ms each, mid-fight) — now here
      for (const m of mats) {
        for (const v of Object.values(m as unknown as Record<string, unknown>)) if (v && (v as Texture).isTexture) gl.initTexture(v as Texture);
        const u = (m as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
        if (u) for (const k of Object.keys(u)) if (u[k]?.value && (u[k].value as Texture).isTexture) gl.initTexture(u[k].value as Texture);
      }
      // one draw of what is hidden among them, wherever it stands (off the view too), into the frame's own target
      for (const o of fresh) {
        let hidden = false;
        for (let p: Object3D | null = o; p && p !== this.scene; p = p.parent) {
          if (!p.visible) {
            p.visible = true;
            shown.push(p);
            hidden = true;
          }
        }
        if (hidden && o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      }
      if (shown.length) gl.render(this.scene, this.camera);
      for (const m of mats) this.warmed.add(m);
    } catch {
      /* no warm-up: each effect is set up on its first show, as before */
    } finally {
      for (const o of shown) o.visible = false;
      for (const o of culled) o.frustumCulled = true;
      gl.setRenderTarget(prev);
    }
    // the screen held that draw (low quality): the true frame over it before the browser shows anything
    if (!target && shown.length) {
      try {
        this.render(0);
      } catch {
        /* the next frame draws it anyway */
      }
    }
    return { programs: (gl.info.programs?.length ?? 0) - before, textures: gl.info.memory.textures - tex0, drawn: shown.length, ms: Math.round(performance.now() - t) };
  }
  /**
   * The boot's warm-up (behind the loading screen), in steps (warmStep) one frame apart — `next` is the boot's own
   * «wait a frame»: two new programs a frame at most, then every object drawn once, two dozen a frame. In one piece it
   * held the loading screen still for ~0.9 s (measured: the first status query waits for all the queued compiles).
   */
  async warmProgramsAsync(next: () => Promise<void>): Promise<{ programs: number; steps: number; ms: number }> {
    const t = performance.now();
    const p0 = this.renderer.info.programs?.length ?? 0;
    const objs: Object3D[] = [];
    this.scene.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material;
      if (m && (Array.isArray(m) ? m : [m]).some((x) => !this.warmed.has(x))) objs.push(o);
    });
    const job = { objs, i: 0, j: 0, bloom: !!this.composer, shadows: PROFILES[this.quality].shadows, drawAll: false };
    let steps = 0;
    while (job.i < objs.length || job.j < objs.length) {
      if (this.warmStep(job)) {
        // the screen held that draw (no bloom): the true frame over it before the browser shows anything
        if (!job.bloom) this.render(0);
      }
      steps++;
      // (a hidden page has nobody to freeze for — and its timers run once a second: the steps go on at once)
      if (!document.hidden) await next();
    }
    this.markWarmed(this.scene);
    return { programs: (this.renderer.info.programs?.length ?? 0) - p0, steps, ms: Math.round(performance.now() - t) };
  }

  /** Materials already compiled and drawn once by warmPrograms (a later fight only looks them up). */
  private warmed = new WeakSet<Material>();
  /** Beta 2.6.2: what Game.warmRig drew (a fighter, its hidden parts too) needs no second warm-up in a fight. */
  markWarmed(root: Object3D): void {
    root.traverse((o) => {
      const m = (o as { material?: Material | Material[] }).material;
      if (m) for (const x of Array.isArray(m) ? m : [m]) this.warmed.add(x);
    });
  }

  render(dt: number): void {
    if (this.downTo) this.prepareDown();
    this.flashIntensity = Math.max(0, this.flashIntensity - dt * this.flashIntensity * 9 - dt * 2);
    this.flash.intensity = this.flashIntensity;
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
    this.observer?.disconnect();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
