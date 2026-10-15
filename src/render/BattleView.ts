import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from 'three';
import { RECOIL } from '../config/animation';
import { ARENA } from '../config/balance';
import { CARDS } from '../config/cards';
import type { Side, WeaponType } from '../config/types';
import type { FighterSim } from '../combat/FighterSim';
import type { Match } from '../combat/Match';
import type { MatchEvent, Projectile } from '../combat/types';
import { damp, lerp, Rng } from '../core/math';
import type { Arena } from './Arena';
import type { CameraRig } from './CameraRig';
import { defaultInput, type AnimInput } from './FighterAnimator';
import type { CachedFighter, ModelCache } from './ModelCache';
import type { Renderer } from './Renderer';
import { glowTexture, shadowTexture, streakTexture, teamRingTexture } from './textures';
import type { FighterFX, VFX } from './VFX';

export const TEAM_COLORS: [Color, Color] = [new Color(0x2ad8ff), new Color(0xff3a3a)];

/** Season palette + the player's equipped battle cosmetics (set by Game before each match). */
export interface BattleStyle {
  combo: number[];
  confetti: number[];
  dashFx: 'phantom' | null;
  victoryFx: 'pumpkin' | null;
}

const PHANTOM = new Color(0xa855ff);
const PHANTOM_SPARK = new Color(0x9dff5c);

export interface TimeFx {
  hitstop: number;
  slowmo: number;
  slowScale: number;
}

interface ProjVis {
  group: Group;
  core: Mesh;
  coreMat: MeshBasicMaterial;
  streak: Mesh;
  streakMat: MeshBasicMaterial;
  streakLen: number;
  streakWidth: number;
  flicker: boolean;
  glow: Sprite;
  glowMat: SpriteMaterial;
  ring: Sprite;
  id: number;
  y: number;
  used: boolean;
}

interface Slot {
  side: Side;
  model: CachedFighter;
  fx: FighterFX;
  input: AnimInput;
  teamRing: Mesh;
  shadow: Mesh;
  accent: Color;
  /** DASH trail/afterimage colour (accent, or PURPLE PHANTOM for the player). */
  dashColor: Color;
  pos: Vector3;
  stunArcT: number;
  emberT: number;
  trailT: number;
  koHandled: boolean;
  victoryDelay: number;
}

const _v = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();
const _m4 = new Matrix4();
const _xa = new Vector3();
const _za = new Vector3();
const _c = new Color();
const rng = new Rng(99);

/** Renders a Match: fighters, projectiles and all reactive effects. */
export class BattleView {
  style: BattleStyle = { combo: [0xffd23a], confetti: [0x22f0e0, 0xff7a1a, 0xff4fd8, 0xffe14d, 0x7aa8ff, 0xffffff], dashFx: null, victoryFx: null };
  private r: Renderer;
  private arena: Arena;
  private vfx: VFX;
  private cam: CameraRig;
  private models: ModelCache;
  private timeFx: TimeFx;
  readonly root = new Group();
  private slots: Slot[] = [];
  private pvis: ProjVis[] = [];
  private pmap = new Map<number, ProjVis>();
  private decoys = new Map<number, CachedFighter>();
  private match: Match | null = null;
  private t = 0;
  private finishTimer = -1;

  constructor(r: Renderer, arena: Arena, vfx: VFX, cam: CameraRig, models: ModelCache, timeFx: TimeFx) {
    this.r = r;
    this.arena = arena;
    this.vfx = vfx;
    this.cam = cam;
    this.models = models;
    this.timeFx = timeFx;
    r.scene.add(this.root);
    const coreGeo = new SphereGeometry(1, 12, 8);
    const streakGeo = new PlaneGeometry(1, 1);
    streakGeo.translate(0, -0.5, 0); // head at origin, tail along -Y
    for (let i = 0; i < 48; i++) {
      const g = new Group();
      g.visible = false;
      const coreMat = new MeshBasicMaterial({ color: 0xffffff });
      const core = new Mesh(coreGeo, coreMat);
      g.add(core);
      const streakMat = new MeshBasicMaterial({
        map: streakTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      const streak = new Mesh(streakGeo, streakMat);
      streak.matrixAutoUpdate = false;
      streak.frustumCulled = false;
      streak.renderOrder = 6;
      g.add(streak);
      const glowMat = new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true });
      const glow = new Sprite(glowMat);
      g.add(glow);
      const ring = new Sprite(new SpriteMaterial({ map: glowTexture(), blending: AdditiveBlending, depthWrite: false, transparent: true }));
      g.add(ring);
      this.root.add(g);
      this.pvis.push({ group: g, core, coreMat, streak, streakMat, streakLen: 1, streakWidth: 0.15, flicker: false, glow, glowMat, ring, id: -1, y: 1.1, used: false });
    }
  }

  get active(): boolean {
    return this.match !== null;
  }

  // ---------------------------------------------------------------- setup
  setup(match: Match): void {
    this.teardown();
    this.match = match;
    this.finishTimer = -1;
    for (const f of match.fighters) {
      const model = this.models.get(f.look);
      this.root.add(model.rig.root);
      model.anim.reset(f.facing);
      model.rig.root.visible = true;
      model.rig.root.position.set(f.x, 0, f.z);
      const accent = new Color(model.rig.look.glow);
      let fx = this.vfx.fighterFX[f.side];
      if (!fx) fx = this.vfx.addFighterFX(TEAM_COLORS[f.side], accent);
      fx.shieldOn = fx.auraOn = fx.laneOn = fx.chargeOn = 0;
      (fx.charge.material as SpriteMaterial).color.copy(accent).multiplyScalar(2);
      const teamRing = new Mesh(
        new PlaneGeometry(1.7, 1.7),
        new MeshBasicMaterial({
          map: teamRingTexture(),
          color: TEAM_COLORS[f.side].clone().multiplyScalar(1.3),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      teamRing.rotation.x = -Math.PI / 2;
      teamRing.renderOrder = 2;
      this.root.add(teamRing);
      const shadow = new Mesh(new PlaneGeometry(1.5, 1.5), new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2;
      shadow.renderOrder = 1;
      this.root.add(shadow);
      const input = defaultInput();
      input.combat = true;
      input.maxSpeed = f.stats.moveSpeed;
      const slot: Slot = {
        side: f.side,
        model,
        fx,
        input,
        teamRing,
        shadow,
        accent,
        dashColor: f.side === 0 && this.style.dashFx === 'phantom' ? PHANTOM.clone() : accent,
        pos: new Vector3(f.x, 0, f.z),
        stunArcT: 0,
        emberT: 0,
        trailT: 0,
        koHandled: false,
        victoryDelay: -1,
      };
      this.slots.push(slot);
      fx.trail.color.copy(accent);
      fx.trail.clear();
      model.anim.events = {
        onStep: () => this.vfx.stepDust(slot.pos.x, slot.pos.z),
        onLand: (strength) => {
          this.vfx.landImpact(slot.pos.x, slot.pos.z, strength, slot.accent);
          if (strength > 0.6) {
            this.vfx.scorch(slot.pos.x, slot.pos.z, 2.2, 3.5);
            this.cam.addTrauma(0.3);
          }
        },
        onFlourish: () => {
          const p = slot.pos;
          if (model.anim.victoryStyle === 'flex') {
            this.vfx.landImpact(p.x, p.z, 1, _c.set(0xff7a1a));
            this.cam.addTrauma(0.2);
          } else {
            this.vfx.burst(p.x, 1.6, p.z, slot.accent, 30, 5, 0.18, 0.5, 2.6, 0, 1);
            this.vfx.rays(p.x, 1.3, p.z, slot.accent, 1, 3.2, 0.5, 1.6);
          }
        },
      };
    }
    this.vfx.glitch[0].setColor(new Color(0xff4fd8));
    this.vfx.glitch[1].setColor(new Color(0xff4fd8));
    const rivalAccent = this.slots[1].accent;
    if (match.rival.archetype === 'nika') this.vfx.glitch[0].setColor(rivalAccent);
    this.cam.snapBattle(this.slots[0].pos, this.slots[1].pos);
    this.arena.setScreen({
      mode: 'fight',
      left: match.fighters[0].name,
      right: match.fighters[1].name,
      leftColor: '#2ad8ff',
      rightColor: '#ff5a4a',
      headline: '',
    });
  }

  teardown(): void {
    for (const s of this.slots) {
      s.model.anim.events = {};
      s.fx.trail.clear();
      s.fx.starsOn = 0;
      this.root.remove(s.model.rig.root);
      this.root.remove(s.teamRing);
      this.root.remove(s.shadow);
      s.teamRing.geometry.dispose();
      (s.teamRing.material as MeshBasicMaterial).dispose();
      s.shadow.geometry.dispose();
      (s.shadow.material as MeshBasicMaterial).dispose();
      s.fx.shieldOn = s.fx.auraOn = s.fx.laneOn = s.fx.chargeOn = 0;
      s.fx.update(0, 0, 0, 0, 0, 0, _v);
    }
    for (const d of this.decoys.values()) this.root.remove(d.rig.root);
    this.decoys.clear();
    for (const p of this.pvis) {
      p.group.visible = false;
      p.used = false;
    }
    this.pmap.clear();
    for (const g of this.vfx.glitch) {
      g.on = 0;
      g.update(0, 0, 0);
    }
    this.slots = [];
    this.match = null;
  }

  /** World→screen (CSS px, relative to canvas). */
  project(x: number, y: number, z: number, out: { x: number; y: number }): boolean {
    _v.set(x, y, z).project(this.r.camera);
    const { w, h } = this.r.size;
    out.x = (_v.x * 0.5 + 0.5) * w;
    out.y = (-_v.y * 0.5 + 0.5) * h;
    return _v.z < 1;
  }

  headPos(side: Side, out: Vector3): Vector3 {
    const s = this.slots[side];
    if (!s) return out.set(0, 0, 0);
    return out.set(s.pos.x, 2.55, s.pos.z);
  }

  fighterPos(side: Side): Vector3 {
    return this.slots[side]?.pos ?? _v.set(0, 0, 0);
  }

  // --------------------------------------------------------------- update
  update(dt: number, alpha: number): void {
    const m = this.match;
    if (!m) return;
    this.t += dt;
    for (const s of this.slots) {
      const f = m.fighters[s.side];
      this.syncFighter(s, f, alpha, dt);
    }
    // camera
    const a = this.slots[0].pos;
    const b = this.slots[1].pos;
    if (this.finishTimer >= 0) {
      this.finishTimer += dt;
      const winner = m.winner;
      if (winner !== null && this.finishTimer > 1.1) {
        this.cam.finishFocus.copy(this.slots[winner].pos);
      }
    }
    this.cam.update(dt, a, b);
    this.arena.excitement = 0.15 + (m.broadcast.rating / 100) * 0.85;
    if (m.phase === 'fight' || m.phase === 'outro') {
      const tl = Math.ceil(m.timeLeft);
      this.arena.setScreen({ rating: m.broadcast.rating, timer: `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` });
    }

    // projectiles
    for (const p of this.pvis) p.used = false;
    for (const pr of m.projectiles) {
      if (!pr.alive) continue;
      let v = this.pmap.get(pr.id);
      if (!v) {
        v = this.pvis.find((x) => x.id === -1 || !this.pmap.has(x.id));
        if (!v) continue;
        this.initProjectile(v, pr);
        this.pmap.set(pr.id, v);
      }
      v.used = true;
      this.syncProjectile(v, pr, alpha, dt);
    }
    for (const p of this.pvis) {
      if (!p.used && p.id !== -1) {
        this.pmap.delete(p.id);
        p.id = -1;
        p.group.visible = false;
      }
    }

    // decoys
    for (const [id, d] of this.decoys) {
      const dec = m.decoys.find((x) => x.id === id);
      if (!dec) continue;
      const inp = defaultInput();
      inp.x = dec.x;
      inp.z = dec.z;
      inp.facing = dec.facing;
      inp.combat = true;
      d.anim.update(dt, inp);
      if (d.rig.holoMat) {
        d.rig.holoMat.uniforms.uTime.value = this.t;
        d.rig.holoMat.uniforms.uOpacity.value = Math.min(1, (dec.duration - dec.t) * 2) * (0.8 + Math.sin(this.t * 30) * 0.2);
      }
    }
  }

  private syncFighter(s: Slot, f: FighterSim, alpha: number, dt: number): void {
    const inp = s.input;
    const x = lerp(f.px, f.x, alpha);
    const z = lerp(f.pz, f.z, alpha);
    s.pos.set(x, 0, z);
    inp.x = x;
    inp.z = z;
    inp.vx = f.vx;
    inp.vz = f.vz;
    inp.facing = f.facing;
    inp.action = f.action.kind;
    inp.actionCard = f.action.kind === 'windup' ? f.action.card : null;
    inp.actionT = 't' in f.action ? f.action.t : 0;
    inp.actionTotal = 'total' in f.action ? f.action.total : 1;
    if (f.action.kind === 'rush' || f.action.kind === 'dash') {
      inp.dashX = f.action.dirX;
      inp.dashZ = f.action.dirZ;
    }
    inp.stunned = f.stun > 0;
    inp.knockback = f.knockback > 0;
    inp.ko = f.ko;
    inp.glitch = f.glitch > 0;
    inp.overdrive = f.overdrive > 0 || f.adrenaline > 0;
    inp.combat = !f.victory;
    if (s.victoryDelay >= 0) {
      s.victoryDelay -= dt;
      if (s.victoryDelay < 0) s.model.anim.victory();
    }
    s.model.anim.update(dt, inp);
    s.model.rig.root.updateMatrixWorld(true);

    // ground decals
    s.teamRing.position.set(x, 0.04, z);
    s.teamRing.rotation.z += dt * 0.6;
    (s.teamRing.material as MeshBasicMaterial).opacity = f.ko ? 0 : 0.85;
    s.shadow.position.set(x, 0.03, z);

    // status effects
    const fx = s.fx;
    fx.shieldOn = damp(fx.shieldOn, f.shield > 0 ? 1 : 0, 12, dt);
    fx.auraOn = damp(fx.auraOn, f.overdrive > 0 ? 1 : f.adrenaline > 0 ? 0.7 : f.ironSkin > 0 ? 0.5 : 0, 8, dt);
    if (f.adrenaline > 0) fx.auraMat.uniforms.uColor.value.copy(s.accent);
    else if (f.ironSkin > 0 && f.overdrive <= 0) fx.auraMat.uniforms.uColor.value.set(0xb8c4d8);
    else fx.auraMat.uniforms.uColor.value.set(0xff6a1a);
    const winding = f.action.kind === 'windup';
    fx.laneOn = damp(fx.laneOn, winding ? 1 : 0, winding ? 14 : 20, dt);
    fx.chargeOn = damp(fx.chargeOn, winding ? 0.4 + (f.action.kind === 'windup' ? f.action.t / f.action.total : 0) : 0, 12, dt);
    const muzzle = s.model.rig.muzzles[0].getWorldPosition(_v2);
    fx.update(dt, this.t, x, z, f.aimX, f.aimZ, muzzle);
    const g = this.vfx.glitch[s.side];
    g.on = damp(g.on, f.glitch > 0 ? 1 : 0, 8, dt);
    g.update(this.t, x, z);
    fx.starsOn = damp(fx.starsOn, f.stun > 0 && f.glitch <= 0 && !f.ko ? 1 : 0, 10, dt);

    // motion trail: dashes, charges and speed buffs
    if (s.trailT > 0) s.trailT -= dt;
    const fast = Math.hypot(f.vx, f.vz) > f.stats.moveSpeed * 1.05;
    const buffed = (f.overdrive > 0 || f.adrenaline > 0 || f.momentum > 0) && fast;
    const emit = !f.ko && (s.trailT > 0 || f.action.kind === 'rush' || buffed);
    const tr = fx.trail;
    if (f.action.kind === 'rush') {
      tr.width = 1.1;
      tr.color.set(0xff5a2a);
    } else if (s.trailT > 0) {
      tr.width = s.dashColor !== s.accent ? 1.05 : 0.9;
      tr.color.copy(s.dashColor);
    } else if (f.overdrive > 0) {
      tr.width = 0.5;
      tr.color.set(0xff7a1a);
    } else {
      tr.width = 0.45;
      tr.color.copy(s.accent);
    }
    _v3.set(x, 1.0, z);
    tr.update(dt, _v3, emit, this.r.camera.position);

    // continuous emitters
    if (f.stun > 0 && !f.ko) {
      s.stunArcT -= dt;
      if (s.stunArcT <= 0) {
        s.stunArcT = 0.07;
        const a = rng.range(0, 6.28);
        _v.set(x + Math.cos(a) * 0.5, rng.range(0.4, 2.2), z + Math.sin(a) * 0.5);
        _v2.set(x + Math.cos(a + 2) * 0.55, rng.range(0.4, 2.2), z + Math.sin(a + 2) * 0.55);
        this.vfx.bolt(_v, _v2, _c.set(0xffe14d), 0.06, 0.12, 0.25, 3);
      }
    }
    if ((f.overdrive > 0 || f.adrenaline > 0 || f.momentum > 0) && !f.ko) {
      s.emberT -= dt;
      if (s.emberT <= 0) {
        s.emberT = 0.03;
        const col = f.overdrive > 0 ? _c.set(0xff7a1a) : s.accent;
        this.vfx.sparks.spawn(x + rng.range(-0.4, 0.4), rng.range(0.2, 1.8), z + rng.range(-0.4, 0.4), rng.range(-0.3, 0.3), rng.range(1, 3), rng.range(-0.3, 0.3), rng.range(0.3, 0.6), 0.16, 0.02, col, 2.2, 1, 0);
      }
    }
  }

  private initProjectile(v: ProjVis, p: Projectile): void {
    const s = this.slots[p.owner];
    v.id = p.id;
    v.group.visible = true;
    const muzzle = s.model.rig.muzzles[0].getWorldPosition(_v);
    v.y = Math.max(0.7, Math.min(1.5, muzzle.y));
    const accent = s.accent;
    const enemy = p.owner === 1;
    // Per-weapon tracer identity: thin pistol needles, short hot pellets,
    // flickering carbine bolts, fat power shots.
    let r = 0.11;
    let elong = 3.4;
    v.flicker = false;
    switch (p.kind) {
      case 'pellet':
        r = 0.1;
        elong = 2.6;
        v.streakLen = 0.8;
        v.streakWidth = 0.17;
        break;
      case 'bolt':
        r = 0.12;
        elong = 2.2;
        v.streakLen = 1.05;
        v.streakWidth = 0.16;
        v.flicker = true;
        break;
      case 'rail':
        r = 0.075;
        elong = 5;
        v.streakLen = 2.4;
        v.streakWidth = 0.11;
        break;
      case 'power':
        if (p.weapon === 'pulse_rifle') {
          // CHARGED SHOT: a long white-hot rail beam
          r = 0.18;
          elong = 4.5;
          v.streakLen = 5.5;
          v.streakWidth = 0.42;
          break;
        }
        r = 0.32;
        elong = 1.6;
        v.streakLen = 2.9;
        v.streakWidth = 0.62;
        break;
      case 'adrenaline':
        r = 0.12;
        elong = 4;
        v.streakLen = 2.2;
        v.streakWidth = 0.2;
        break;
      default:
        r = 0.095;
        elong = 3.6;
        v.streakLen = 1.6;
        v.streakWidth = 0.14;
    }
    v.core.scale.set(r, r, r * elong);
    v.coreMat.color.copy(accent).lerp(_c.set(0xffffff), 0.55).multiplyScalar(p.kind === 'power' ? 4 : 3);
    _c.copy(accent);
    if (enemy) _c.lerp(TEAM_COLORS[1], 0.3);
    if (p.electric) _c.set(0xffe14d);
    v.streakMat.color.copy(_c).multiplyScalar(p.kind === 'power' ? 2.4 : 1.9);
    v.glowMat.color.copy(_c).multiplyScalar(p.kind === 'power' ? 2.4 : 1.4);
    v.glow.scale.setScalar(p.kind === 'power' ? 2.2 : p.kind === 'bolt' ? 0.8 : p.kind === 'pellet' ? 0.6 : 0.6);
    v.ring.visible = p.kind === 'power' && p.weapon !== 'pulse_rifle';
    (v.ring.material as SpriteMaterial).color.copy(_c).multiplyScalar(1.2);
    v.ring.scale.setScalar(3.2);
    v.streak.visible = true;
  }

  private syncProjectile(v: ProjVis, p: Projectile, alpha: number, dt: number): void {
    const x = lerp(p.px, p.x, alpha);
    const z = lerp(p.pz, p.z, alpha);
    v.y = damp(v.y, ARENA.shotHeight + (p.kind === 'power' ? 0.1 : 0), 6, dt);
    v.group.position.set(x, v.y, z);
    v.core.rotation.set(0, Math.atan2(p.vx, p.vz), 0);

    // camera-facing tracer streak oriented along travel
    const sp = Math.hypot(p.vx, p.vz) || 1;
    _v.set(p.vx / sp, 0, p.vz / sp);
    _za.subVectors(this.r.camera.position, v.group.position);
    _za.addScaledVector(_v, -_za.dot(_v)).normalize();
    _xa.crossVectors(_v, _za).normalize();
    const len = Math.min(v.streakLen, p.traveled + 0.25);
    const w = v.streakWidth * (v.flicker ? 0.75 + 0.5 * Math.abs(Math.sin(this.t * 55 + p.id)) : 1);
    _m4.makeBasis(_xa, _v, _za);
    _m4.scale(_v2.set(w, len, 1));
    v.streak.matrix.copy(_m4);
    v.streak.matrixWorldNeedsUpdate = true;

    // sparse particle wake (power shots and bolts only — tracers do the rest)
    const s = this.slots[p.owner];
    const n = p.kind === 'power' ? 3 : p.kind === 'bolt' && rng.chance(0.5) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      this.vfx.sparks.spawn(
        x - p.vx * 0.01 + rng.range(-0.05, 0.05),
        v.y + rng.range(-0.05, 0.05),
        z - p.vz * 0.01 + rng.range(-0.05, 0.05),
        -p.vx * 0.05 + rng.range(-0.4, 0.4),
        rng.range(-0.2, 0.4),
        -p.vz * 0.05 + rng.range(-0.4, 0.4),
        p.kind === 'power' ? 0.35 : 0.2,
        p.kind === 'power' ? 0.45 : 0.14,
        0.02,
        p.electric ? _c.set(0xffe14d) : s.accent,
        2,
        2,
        0,
      );
    }
  }

  // --------------------------------------------------------------- events
  private requestTime(scale: number, dur: number): void {
    if (scale < 0.1) this.timeFx.hitstop = Math.max(this.timeFx.hitstop, dur);
    else {
      this.timeFx.slowmo = Math.max(this.timeFx.slowmo, dur);
      this.timeFx.slowScale = Math.min(this.timeFx.slowScale === 1 ? scale : this.timeFx.slowScale, scale);
    }
  }

  private chest(side: Side, out: Vector3): Vector3 {
    const s = this.slots[side];
    return out.set(s.pos.x, 1.15, s.pos.z);
  }

  onEvent(e: MatchEvent): void {
    const m = this.match;
    if (!m) return;
    switch (e.type) {
      case 'shot': {
        const s = this.slots[e.side];
        const heavy = e.kind === 'power';
        s.model.anim.fire(e.muzzle, heavy);
        const mz = s.model.rig.muzzles[e.muzzle] ?? s.model.rig.muzzles[0];
        mz.getWorldPosition(_v);
        this.vfx.muzzleFor(e.weapon, _v, e.dx, e.dz, s.accent, heavy);
        const rp = RECOIL[e.weapon];
        if (heavy) {
          this.cam.kick(0.4);
          this.cam.addTrauma(0.18);
          this.r.pulseFlash(s.accent.getHex(), 1.2);
        } else if (rp.shake > 0) {
          this.cam.addTrauma(rp.shake * (e.side === 0 ? 0.6 : 1));
          if (e.weapon === 'boom_cannon') this.r.pulseFlash(0xffb060, 0.35);
        }
        break;
      }
      case 'hit': {
        const s = this.slots[e.side];
        const src = this.slots[e.source];
        if (e.kind !== 'dot') s.model.anim.hit(e.dx, e.dz, e.heavy);
        const p = this.chest(e.side, _v);
        const col = e.electric ? _c.set(0xffe14d) : src.accent;
        if (e.kind === 'dot') {
          this.vfx.burst(p.x, p.y, p.z, _c.set(0xff4fd8), 4, 3, 0.12, 0.3, 2);
          break;
        }
        const weapon: WeaponType | null = e.kind === 'auto' || e.kind === 'adrenaline' ? src.model.rig.look.weapon : null;
        this.vfx.impactFor(weapon, p.x + e.dx * -0.3, p.y, p.z + e.dz * -0.3, col, e.heavy, e.crit);
        if (e.electric) {
          for (let i = 0; i < 4; i++) {
            const a = rng.range(0, 6.28);
            _v2.set(p.x + Math.cos(a) * 1.4, rng.range(0.2, 2), p.z + Math.sin(a) * 1.4);
            this.vfx.bolt(p, _v2, _c.set(0xfff27a), 0.09, 0.25, 0.35, 3);
          }
        }
        if (e.heavy) {
          this.cam.addTrauma(e.crit ? 0.5 : 0.36);
          this.cam.kick(e.crit ? 0.9 : 0.55);
          this.requestTime(0, e.crit ? 0.1 : 0.065);
          this.r.pulseFlash(col.getHex(), e.crit ? 2 : 1.3);
          this.arena.hype(e.crit ? 0.8 : 0.4);
        } else if (weapon === 'boom_cannon') {
          this.cam.addTrauma(0.025);
        } else {
          this.cam.addTrauma(e.side === 0 ? 0.04 : 0.02);
        }
        break;
      }
      case 'impact': {
        const s = this.slots[e.side];
        if (e.kind === 'wall') this.vfx.wallHit(e.x, e.z, s.accent, e.heavy);
        else if (e.kind === 'shield') {
          const target = this.slots[1 - e.side];
          const fx = target.fx;
          fx.shieldMat.uniforms.uHit.value = e.heavy ? 1.3 : 0.9;
          (fx.shieldMat.uniforms.uHitDir.value as Vector3).set(e.x - target.pos.x, 0.25, e.z - target.pos.z).normalize();
          this.vfx.burst(e.x, ARENA.shotHeight, e.z, _c.set(0x7ac8ff), e.heavy ? 22 : 8, e.heavy ? 8 : 4, 0.14, 0.35, 2.4);
          this.vfx.flash(e.x, ARENA.shotHeight, e.z, _c.set(0x9ad8ff), 0.3, e.heavy ? 1.6 : 0.8, 0.12, 2.4);
        } else if (e.kind === 'decoy') {
          this.vfx.burst(e.x, 1.1, e.z, s.accent, 8, 4, 0.14, 0.3, 2);
        } else {
          this.vfx.glow(e.x, ARENA.shotHeight, e.z, s.accent, 0.4, 0.05, 0.15, 1.4);
        }
        break;
      }
      case 'card': {
        const s = this.slots[e.side];
        const col = _c.set(CARDS[e.card].color);
        this.vfx.ring(s.pos.x, s.pos.z, col, 0.8, 3.2, 0.4, 2.2);
        this.vfx.glow(s.pos.x, 1.2, s.pos.z, col, 0.6, 2.4, 0.25, 1.4);
        break;
      }
      case 'combo': {
        const s = this.slots[e.side];
        const ultra = e.combo === 'superstar' || e.combo === 'electro_blast';
        const gold = _c.set(0xffd23a);
        this.vfx.ring(s.pos.x, s.pos.z, gold, 1, ultra ? 7.5 : 6, 0.6, 3);
        this.vfx.burst(s.pos.x, 1.2, s.pos.z, gold, ultra ? 46 : 30, ultra ? 9 : 7, 0.2, 0.6, 2.6, 0, 2);
        this.vfx.rays(s.pos.x, 1.3, s.pos.z, gold, 1, ultra ? 6 : 4.2, ultra ? 0.7 : 0.5, 2.2);
        if (ultra) {
          this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xff4fd8), 0.6, 5.5, 0.55, 3);
          this.vfx.rays(s.pos.x, 1.3, s.pos.z, _c.set(0xff4fd8), 0.6, 4.4, 0.6, 1.8);
        }
        if (e.side === 0) {
          // seasonal accent: an extra burst in the event palette
          const pal = this.style.combo;
          for (let i = 1; i < pal.length; i++) this.vfx.burst(s.pos.x, 1.3, s.pos.z, _c.set(pal[i]), ultra ? 14 : 9, ultra ? 8 : 6, 0.18, 0.7, 2.4, -1.5, 2.5);
          this.requestTime(ultra ? 0.3 : 0.42, ultra ? 0.5 : 0.35);
          this.cam.kick(ultra ? 0.8 : 0.5);
          this.cam.focusAccent(s.pos, ultra ? 1 : 0.6);
          this.arena.hype(1);
        }
        break;
      }
      case 'dodge': {
        const s = this.slots[e.side];
        if (e.perfect) {
          this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xffffff), 0.6, 3.5, 0.35, 2.5);
          this.vfx.glow(s.pos.x, 1.2, s.pos.z, s.accent, 1, 3, 0.25, 1.6);
          if (e.side === 0 && e.heavy) this.requestTime(0.35, 0.4);
        }
        break;
      }
      case 'miss': {
        const s = this.slots[e.side];
        this.vfx.glow(s.pos.x, 1.2, s.pos.z, _c.set(0x9a90c8), 0.4, 1.4, 0.2, 1);
        break;
      }
      case 'block': {
        const s = this.slots[e.side];
        s.fx.shieldMat.uniforms.uHit.value = e.perfect ? 1.6 : 0.8;
        if (e.perfect) {
          this.vfx.ring(s.pos.x, s.pos.z, _c.set(0x7ac8ff), 1, 4.5, 0.4, 3);
          this.cam.addTrauma(0.25);
          this.requestTime(0, 0.06);
        }
        break;
      }
      case 'shieldUp': {
        const s = this.slots[e.side];
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0x5ab8ff), 0.5, 3, 0.45, 2.6);
        this.vfx.burst(s.pos.x, 1.1, s.pos.z, _c.set(0x7ac8ff), 18, 5, 0.14, 0.4, 2.2);
        break;
      }
      case 'shieldBreak': {
        const s = this.slots[e.side];
        s.fx.shieldOn = 0;
        this.vfx.burst(s.pos.x, 1.1, s.pos.z, _c.set(0x9ad8ff), 40, 9, 0.18, 0.6, 2.6, 6);
        this.vfx.debrisBurst(s.pos.x, 1.1, s.pos.z, _c.set(0x7ac8ff), 10);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0x7ac8ff), 1, 4, 0.35, 2.5);
        this.cam.addTrauma(0.2);
        break;
      }
      case 'shieldBurst': {
        const s = this.slots[e.side];
        s.fx.shieldOn = 0;
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0x7ac8ff), 1, 8, 0.6, 3);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xff7a1a), 0.6, 6.5, 0.5, 3);
        this.vfx.burst(s.pos.x, 1, s.pos.z, _c.set(0x9ad8ff), 50, 12, 0.2, 0.6, 2.6);
        this.cam.addTrauma(0.5);
        this.cam.kick(0.8);
        this.r.pulseFlash(0x7ac8ff, 2);
        break;
      }
      case 'stun': {
        const s = this.slots[e.side];
        this.vfx.glow(s.pos.x, 1.4, s.pos.z, _c.set(0xffe14d), 1, 2.5, 0.3, 1.6);
        break;
      }
      case 'interrupt': {
        const s = this.slots[e.side];
        this.vfx.flash(s.pos.x, 1.5, s.pos.z, _c.set(0xffffff), 1, 3, 0.25, 3);
        this.vfx.burst(s.pos.x, 1.4, s.pos.z, _c.set(0xffe14d), 26, 8, 0.18, 0.5, 2.6);
        s.fx.laneOn = 0;
        s.fx.chargeOn = 0;
        this.cam.addTrauma(0.3);
        break;
      }
      case 'telegraph': {
        const s = this.slots[e.side];
        const ko = e.card === 'knockout';
        s.fx.laneLocked = false;
        s.fx.laneLen = ko ? 5.8 : e.player ? 6 : 11;
        s.fx.laneWidth = ko ? 1.5 : 1.0;
        s.fx.laneMat.color.copy(e.side === 1 ? _c.set(0xff3a2a) : _c.set(0x2ad8ff)).multiplyScalar(e.player ? 0.9 : 1.6);
        s.fx.ringMat.color.copy(s.fx.laneMat.color);
        break;
      }
      case 'aimLock': {
        const s = this.slots[e.side];
        s.fx.laneLocked = true;
        s.fx.laneDirX = e.dx;
        s.fx.laneDirZ = e.dz;
        this.vfx.flash(s.pos.x, 1.3, s.pos.z, _c.set(0xff3a2a), 0.8, 2, 0.15, 2.4);
        break;
      }
      case 'release': {
        const s = this.slots[e.side];
        s.fx.laneOn = 0;
        s.fx.chargeOn = 0;
        break;
      }
      case 'dash': {
        const s = this.slots[e.side];
        const dx = e.toX - e.fromX;
        const dz = e.toZ - e.fromZ;
        const l = Math.hypot(dx, dz) || 1;
        s.model.anim.dash(dx / l, dz / l);
        const dc = s.dashColor;
        const phantom = dc !== s.accent;
        s.trailT = phantom ? 0.42 : 0.32;
        this.vfx.dust(e.fromX, e.fromZ, 8, dx / l, dz / l);
        this.vfx.ring(e.fromX, e.fromZ, dc, 0.4, 2.2, 0.3, 2);
        for (let i = 0; i < 10; i++) {
          const t = i / 10;
          this.vfx.sparks.spawn(e.fromX + dx * t, rng.range(0.4, 1.8), e.fromZ + dz * t, (dx / l) * 2, 0, (dz / l) * 2, 0.22 + t * 0.15, 0.2, 0.02, phantom && i % 3 === 0 ? PHANTOM_SPARK : dc, 2, 4, 0);
        }
        if (phantom) {
          // PURPLE PHANTOM: fading ghost silhouettes along the dash path
          for (let i = 1; i <= 3; i++) {
            const t = i / 4;
            this.vfx.glow(e.fromX + dx * t, 1.1, e.fromZ + dz * t, PHANTOM, 1.4, 0.6, 0.35 + i * 0.06, 1.8);
          }
          this.vfx.burst(e.fromX, 1.0, e.fromZ, PHANTOM_SPARK, 10, 3, 0.14, 0.4, 2.2, -1, 1);
        }
        if (e.style === 'blink') {
          this.vfx.burst(e.fromX, 1.1, e.fromZ, dc, 20, 4, 0.2, 0.35, 2.6);
          this.vfx.burst(e.toX, 1.1, e.toZ, dc, 20, 4, 0.2, 0.35, 2.6);
        }
        break;
      }
      case 'rush': {
        const s = this.slots[e.side];
        this.vfx.dust(e.x, e.z, 12, e.dx, e.dz);
        this.vfx.ring(e.x, e.z, s.accent, 0.5, 2.8, 0.3, 2.2);
        this.cam.addTrauma(0.14);
        break;
      }
      case 'whiff': {
        this.vfx.dust(e.x, e.z, 10);
        break;
      }
      case 'wallSlam': {
        const wx = e.x + e.nx * 0.6;
        const wz = e.z + e.nz * 0.6;
        this.vfx.flash(wx, 1, wz, _c.set(0xffffff), 1.5, 4, 0.3, 3);
        this.vfx.burst(wx, 0.8, wz, _c.set(0xffa040), 40, 10, 0.2, 0.6, 2.6, 8, 2);
        this.vfx.debrisBurst(wx, 0.5, wz, _c.set(0x2a3060), 14);
        this.vfx.ring(e.x, e.z, _c.set(0xff7a1a), 1, 5, 0.5, 3);
        this.cam.addTrauma(0.65);
        this.cam.kick(1);
        this.requestTime(0, 0.12);
        this.arena.hype(1);
        break;
      }
      case 'smoke': {
        this.vfx.smokeCloud(e.id, e.x, e.z, e.radius, e.duration, this.slots[e.side].accent);
        break;
      }
      case 'decoy': {
        const look = m.fighters[e.side].look;
        const holo = this.models.getHolo(look);
        holo.anim.reset(m.fighters[e.side].facing);
        holo.rig.root.position.set(e.x, 0, e.z);
        this.root.add(holo.rig.root);
        this.decoys.set(e.id, holo);
        this.vfx.burst(e.x, 1.1, e.z, this.slots[e.side].accent, 24, 5, 0.18, 0.4, 2.4);
        break;
      }
      case 'decoyPop': {
        const d = this.decoys.get(e.id);
        if (d) {
          this.root.remove(d.rig.root);
          this.decoys.delete(e.id);
        }
        this.vfx.burst(e.x, 1.1, e.z, this.slots[e.side].accent, e.hit ? 36 : 16, e.hit ? 7 : 3, 0.18, 0.5, 2.4);
        if (e.hit) this.vfx.ring(e.x, e.z, this.slots[e.side].accent, 0.6, 3, 0.4, 2.4);
        break;
      }
      case 'shock': {
        const s = this.slots[e.side];
        const from = s.model.rig.muzzles[0].getWorldPosition(_v);
        const target = this.slots[1 - e.side];
        _v2.set(target.pos.x, 1.2, target.pos.z);
        if (!e.hit) _v2.x += 1.2;
        for (let i = 0; i < 3; i++) this.vfx.bolt(from, _v2, _c.set(i === 0 ? 0xffffff : 0xffe14d), i === 0 ? 0.08 : 0.16, 0.4, 0.7, 3.2);
        this.vfx.flash(_v2.x, _v2.y, _v2.z, _c.set(0xffe14d), 1, 3, 0.25, 3);
        this.r.pulseFlash(0xffe14d, 1.6);
        this.cam.addTrauma(0.25);
        break;
      }
      case 'overload': {
        const s = this.slots[e.side];
        const from = s.model.rig.muzzles[0].getWorldPosition(_v);
        _v2.set(e.x, 1.2, e.z);
        const col = s.accent;
        for (let i = 0; i < 4; i++) this.vfx.bolt(from, _v2, i % 2 ? col : _c.set(0x22f0e0), 0.12, 0.6, 1.1, 3);
        if (e.hit) {
          this.vfx.ring(e.x, e.z, col, 0.5, 4, 0.5, 3);
          this.vfx.burst(e.x, 1.2, e.z, col, 40, 8, 0.2, 0.6, 2.8);
          this.cam.addTrauma(0.35);
          this.r.pulseFlash(col.getHex(), 2);
        }
        break;
      }
      case 'buff': {
        const s = this.slots[e.side];
        const col = e.buff === 'overdrive' ? _c.set(0xff6a1a) : s.accent;
        this.vfx.ring(s.pos.x, s.pos.z, col, 0.5, 4.5, 0.5, 3);
        this.vfx.burst(s.pos.x, 1, s.pos.z, col, 30, 7, 0.2, 0.5, 2.6, 0, 3);
        this.cam.kick(0.3);
        break;
      }
      case 'passive': {
        const s = this.slots[e.side];
        const col = e.passive === 'iron_skin' ? _c.set(0xc8d4ea) : s.accent;
        this.vfx.ring(s.pos.x, s.pos.z, col, 0.4, 2.6, 0.35, 2.2);
        this.vfx.burst(s.pos.x, 1.2, s.pos.z, col, 14, 4, 0.14, 0.4, 2.2);
        break;
      }
      case 'ko': {
        const s = this.slots[e.side];
        s.model.anim.ko();
        s.fx.shieldOn = s.fx.auraOn = s.fx.laneOn = s.fx.chargeOn = 0;
        this.vfx.flash(s.pos.x, 1.2, s.pos.z, _c.set(0xffffff), 2, 6, 0.4, 3);
        this.vfx.burst(s.pos.x, 1.2, s.pos.z, s.accent, 80, 14, 0.25, 0.9, 2.8, 6, 2);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xffffff), 1, 9, 0.7, 3);
        this.vfx.debrisBurst(s.pos.x, 1, s.pos.z, s.accent, 16);
        this.cam.addTrauma(0.8);
        this.cam.kick(1.4);
        this.requestTime(0.25, 1.15);
        this.r.pulseFlash(0xffffff, 3);
        this.arena.hype(1.5);
        this.cam.finishFocus.copy(s.pos);
        this.cam.setMode('finish', 0.9);
        this.finishTimer = 0;
        const winner = this.slots[1 - e.side];
        winner.victoryDelay = 0.9;
        if (e.side === 1) {
          this.vfx.confetti(s.pos.x, 2, s.pos.z, 120, this.style.confetti);
        }
        break;
      }
      case 'timeUp': {
        this.finishTimer = 0.6;
        this.cam.setMode('finish', 1.2);
        break;
      }
      case 'phase': {
        if (e.phase === 'outro' && m.winner !== null) {
          const w = this.slots[m.winner];
          if (w.victoryDelay < 0) w.victoryDelay = m.fighters[1 - m.winner].ko ? 0.9 : 0.2;
          this.cam.finishFocus.copy(w.pos);
          if (m.winner === 0) {
            const pumpkin = this.style.victoryFx === 'pumpkin';
            setTimeout(() => {
              if (this.match !== m) return;
              this.vfx.confetti(w.pos.x, 3, w.pos.z, pumpkin ? 110 : 160, pumpkin ? [0xff8a1f, 0xb45cff, 0xa8ff60, 0xffd27a] : this.style.confetti);
              if (pumpkin) {
                // PUMPKIN VICTORY
                this.vfx.pumpkins(w.pos.x, 1.6, w.pos.z, 14);
                setTimeout(() => this.match === m && this.vfx.pumpkins(w.pos.x, 1.6, w.pos.z, 8), 700);
                this.vfx.ring(w.pos.x, w.pos.z, _c.set(0xff8a1f), 1, 6, 0.8, 2.6);
                this.vfx.rays(w.pos.x, 1.4, w.pos.z, _c.set(0xb45cff), 1, 5, 0.8, 1.8);
              }
            }, 900);
          }
        } else if (e.phase === 'outro') {
          this.cam.finishFocus.set(0, 0, 0);
        }
        break;
      }
      case 'propBreak': {
        this.arena.breakProp(e.index);
        const col = e.z < 0 ? _c.set(0xff5a2a) : _c.set(0x22d8ff);
        this.vfx.debrisBurst(e.x, 0.5, e.z, _c.set(0x1a1f3d), 10);
        this.vfx.debrisBurst(e.x, 0.9, e.z, col, 5);
        this.vfx.flash(e.x, 0.8, e.z, col, 1, 3, 0.3, 3);
        this.vfx.burst(e.x, 0.8, e.z, col, 30, 7, 0.16, 0.5, 2.4, 8, 2);
        this.cam.addTrauma(0.15);
        break;
      }
      case 'propRespawn': {
        this.arena.respawnProp(e.index);
        const p = ARENA.props[e.index];
        this.vfx.ring(p.x, p.z, _c.set(0x22f0e0), 0.3, 2, 0.4, 2);
        break;
      }
      case 'reaction': {
        this.arena.hype(e.tier === 3 ? 1 : 0.5);
        break;
      }
      default:
        break;
    }
  }
}
