import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  NeutralToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export type QualityLevel = 'high' | 'medium' | 'low';
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
    this.setting = s;
    this.applyQuality(s === 'auto' ? 'high' : s);
    this.frameTimes = [];
  }

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

  /** Feed real frame times; drops quality when the device struggles. */
  monitor(dtReal: number, now: number): void {
    // Background tabs run on throttled timers: those frame times say nothing about the GPU.
    if (this.setting !== 'auto' || document.hidden) return;
    this.frameTimes.push(dtReal);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (now - this.lastAdjust < 3 || this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    if (avg > 1 / 42 && this.quality !== 'low') {
      this.applyQuality(this.quality === 'high' ? 'medium' : 'low');
      this.frameTimes = [];
      this.lastAdjust = now;
    } else {
      this.lastAdjust = now;
    }
  }

  /** Seasonal light colours (intensities untouched, no extra lights). */
  applyLights(l: { hemiSky: number; hemiGround: number; fillA: number; fillB: number; rim: number; fog: number }): void {
    this.hemi.color.setHex(l.hemiSky);
    this.hemi.groundColor.setHex(l.hemiGround);
    this.fillA.color.setHex(l.fillA);
    this.fillB.color.setHex(l.fillB);
    this.rim.color.setHex(l.rim);
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

  render(dt: number): void {
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
