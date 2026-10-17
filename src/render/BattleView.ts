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
import type { CastKind, Side, WeaponType } from '../config/types';
import { lineReach } from '../combat/CombatSystem';
import type { FighterSim } from '../combat/FighterSim';
import type { Match } from '../combat/Match';
import type { MatchEvent, Projectile } from '../combat/types';
import { clamp01, clampRoundedRect, damp, lerp, Rng, type ClampResult } from '../core/math';
import type { Arena } from './Arena';
import type { CameraRig } from './CameraRig';
import { CardVisuals } from './CardVisuals';
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
const _clamp: ClampResult = { x: 0, z: 0, hit: false, nx: 0, nz: 0 };
/** Shared animation input for holograms (PHANTOM STEP decoys, FALSE START afterimage): no per-frame allocation. */
const _holoInput: AnimInput = defaultInput();
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
  /** Alpha 1.5: FALSE START afterimage (visual only; one at a time, fades out in ~0.4 s). */
  private ghost: { model: CachedFighter; t: number; x: number; z: number; yaw: number } | null = null;
  private match: Match | null = null;
  private t = 0;
  private finishTimer = -1;
  /** Side whose DIRECTOR'S CUT line is on screen (-1 = none). */
  private cutOwner = -1;
  /** Alpha 1.6: nets, mines, barriers, props, cameras, freeze zones, tags, cables and frames. */
  private cards: CardVisuals;

  constructor(r: Renderer, arena: Arena, vfx: VFX, cam: CameraRig, models: ModelCache, timeFx: TimeFx) {
    this.r = r;
    this.arena = arena;
    this.vfx = vfx;
    this.cam = cam;
    this.models = models;
    this.timeFx = timeFx;
    r.scene.add(this.root);
    this.cards = new CardVisuals(this.root);
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
    this.arena.resetProps();
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
        onFlourish: (heavy) => {
          const p = slot.pos;
          if (heavy) {
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
    if (this.ghost) {
      this.root.remove(this.ghost.model.rig.root);
      this.ghost = null;
    }
    for (const p of this.pvis) {
      p.group.visible = false;
      p.used = false;
    }
    this.pmap.clear();
    for (const g of this.vfx.glitch) {
      g.on = 0;
      g.update(0, 0, 0);
    }
    this.vfx.cutLane.hide();
    this.cutOwner = -1;
    this.cards.reset();
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

    // Alpha 1.6: the new cards' set pieces and fighter states
    this.cards.update(dt, this.t, m, (side) => this.slots[side].pos);

    // FALSE START afterimage: stands where Rina feinted and fades out
    const gh = this.ghost;
    if (gh) {
      gh.t += dt;
      const life = 0.42;
      if (gh.t >= life) {
        this.root.remove(gh.model.rig.root);
        this.ghost = null;
      } else {
        const inp = _holoInput;
        inp.x = gh.x;
        inp.z = gh.z;
        inp.facing = gh.yaw;
        inp.combat = true;
        gh.model.anim.update(dt, inp);
        const hm = gh.model.rig.holoMat;
        if (hm) {
          hm.uniforms.uTime.value = this.t;
          hm.uniforms.uOpacity.value = (1 - gh.t / life) * 0.85;
        }
      }
    }
    // decoys
    for (const [id, d] of this.decoys) {
      const dec = m.decoys.find((x) => x.id === id);
      if (!dec) continue;
      const inp = _holoInput;
      inp.x = dec.x;
      inp.z = dec.z;
      inp.facing = dec.facing;
      inp.combat = true;
      d.anim.update(dt, inp);
      if (d.rig.holoMat) {
        d.rig.holoMat.uniforms.uTime.value = this.t;
        // Alpha 1.6 HOLO DECOY: digital interference — dropouts, harder after it soaked a volley
        const glitch = dec.kind === 'holo' ? (Math.sin(this.t * 53 + dec.id) > (dec.soak >= 0 ? 0.2 : 0.85) ? 0.25 : 1) : 1;
        d.rig.holoMat.uniforms.uOpacity.value = Math.min(1, (dec.duration - dec.t) * 2) * (0.8 + Math.sin(this.t * 30) * 0.2) * glitch;
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
    inp.cutStage = f.action.kind === 'cut' ? f.action.stage : null;
    inp.actionT = 't' in f.action ? f.action.t : 0;
    inp.actionTotal = 'total' in f.action ? f.action.total : 1;
    if (f.action.kind === 'rush' || f.action.kind === 'dash' || f.action.kind === 'feint' || f.action.kind === 'rewind') {
      inp.dashX = f.action.dirX;
      inp.dashZ = f.action.dirZ;
    }
    inp.reading = f.feint > 0;
    inp.fireIn = f.wantFire && !f.ko ? f.fireTimer : -1;
    inp.zap = f.zap > 0;
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
    const ca = f.action;
    const cutCharge = ca.kind === 'cut' && ca.stage === 'lock' ? 0.45 + clamp01(ca.t / ca.total) * 0.75 : ca.kind === 'cut' && ca.stage === 'prep' ? 0.35 : 0;
    // Alpha 1.5.5: Zoe's SHOCK charge glows in her hand until the bolt leaves
    const zapCharge = f.zap > 0 ? 0.9 + Math.sin(this.t * 40) * 0.3 : 0;
    fx.chargeOn = damp(fx.chargeOn, winding ? 0.4 + (f.action.kind === 'windup' ? f.action.t / f.action.total : 0) : Math.max(cutCharge, zapCharge), 12, dt);
    if (f.zap > 0 && rng.chance(dt * 30)) {
      const h = s.model.rig.handR.getWorldPosition(_v3);
      this.vfx.burst(h.x, h.y, h.z, _c.set(0xffe14d), 3, 2.5, 0.06, 0.18, 2.4);
    }
    // DIRECTOR'S CUT: the warning line is drawn straight from the simulation state every frame
    // (same origin, direction, width and barrier-clipped length as the hit test)
    if (ca.kind === 'cut' && (ca.stage === 'aim' || ca.stage === 'lock') && !f.ko) {
      const i = ca.shot;
      const len = lineReach(f.x, f.z, ca.dirX, ca.dirZ, ca.tune.length[i]);
      this.vfx.cutLane.show(this.t, f.x, f.z, ca.dirX, ca.dirZ, ca.tune.halfWidth[i], len, ca.stage === 'lock', clamp01(ca.t / ca.total), ca.empowered, i === 2);
      this.cutOwner = s.side;
    } else if (this.cutOwner === s.side) {
      this.vfx.cutLane.hide();
      this.cutOwner = -1;
    }
    // Alpha 1.5 — BANK SHOT telegraph: the line runs to the barrier, then the reflected leg
    // (drawn from the same simulation direction the round will take)
    let aimX = f.aimX;
    let aimZ = f.aimZ;
    const bankWind = ca.kind === 'windup' && ca.card === 'bank_shot' && !f.ko;
    fx.bankOn = bankWind ? 1 : 0;
    if (bankWind) {
      const len1 = lineReach(f.x, f.z, ca.dirX, ca.dirZ, 26);
      const bx = f.x + ca.dirX * len1;
      const bz = f.z + ca.dirZ * len1;
      clampRoundedRect(bx, bz, ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, _clamp);
      let nx = _clamp.nx;
      let nz = _clamp.nz;
      if (!_clamp.hit) {
        clampRoundedRect(bx + ca.dirX * 0.3, bz + ca.dirZ * 0.3, ARENA.wallX, ARENA.wallZ, ARENA.wallCorner, _clamp);
        nx = _clamp.nx;
        nz = _clamp.nz;
      }
      const vn = ca.dirX * nx + ca.dirZ * nz;
      const rx = ca.dirX - 2 * vn * nx;
      const rz = ca.dirZ - 2 * vn * nz;
      fx.laneLen = len1;
      fx.laneWidth = 0.7;
      fx.laneLocked = true;
      fx.laneDirX = ca.dirX;
      fx.laneDirZ = ca.dirZ;
      fx.bankX = bx;
      fx.bankZ = bz;
      fx.bankDX = rx;
      fx.bankDZ = rz;
      fx.bankLen = Math.min(7, lineReach(bx - nx * 0.1, bz - nz * 0.1, rx, rz, 7));
      aimX = x + ca.dirX;
      aimZ = z + ca.dirZ;
    }
    const muzzle = s.model.rig.muzzles[0].getWorldPosition(_v2);
    fx.update(dt, this.t, x, z, aimX, aimZ, muzzle);
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
      case 'slug':
        // CHAMPION BURST: a fat gold slug with a long hot tracer
        r = 0.13;
        elong = 3.2;
        v.streakLen = 2.1;
        v.streakWidth = 0.26;
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
      case 'bank':
        // Alpha 1.5 — BANK SHOT: a spinning copper disc with a warm tracer
        r = 0.2;
        elong = 0.5;
        v.streakLen = 2.4;
        v.streakWidth = 0.36;
        break;
      case 'counter':
        // Alpha 1.5 — FALSE START counter: a fast coral needle
        r = 0.11;
        elong = 4.4;
        v.streakLen = 2.8;
        v.streakWidth = 0.26;
        break;
      case 'zap':
        // Alpha 1.5.5 — Zoe's SHOCK bolt: a crackling yellow ball of lightning
        r = 0.24;
        elong = 1;
        v.streakLen = 1.6;
        v.streakWidth = 0.4;
        v.flicker = true;
        break;
      // Alpha 1.6 — card shots
      case 'split':
        // SPLIT SHOT: three bright green tracers
        r = 0.12;
        elong = 3;
        v.streakLen = 1.5;
        v.streakWidth = 0.24;
        break;
      case 'disc':
        // REBOUND DISC: a flat spinning disc with a short wake
        r = 0.36;
        elong = 0.22;
        v.streakLen = 1.1;
        v.streakWidth = 0.5;
        break;
      case 'cable':
        // CABLE SNARE: the clamp head with a long glowing cable behind it
        r = 0.15;
        elong = 1.4;
        v.streakLen = 7;
        v.streakWidth = 0.1;
        break;
      case 'cam':
        // SIDE CAM: a fat red studio bolt
        r = 0.2;
        elong = 2.4;
        v.streakLen = 2.6;
        v.streakWidth = 0.42;
        break;
      case 'release':
        // CATCH & RELEASE: the caught charge goes back white-gold
        r = 0.14;
        elong = 3.4;
        v.streakLen = 2.4;
        v.streakWidth = 0.3;
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
    if (p.kind === 'bank') _c.set(0xff9a4a).lerp(accent, 0.25);
    if (p.electric) _c.set(0xffe14d);
    // Alpha 1.6: card shots wear their card's colour
    if (p.kind === 'split') _c.set(0x7cff6b);
    else if (p.kind === 'disc') _c.set(0x38e1ff).lerp(accent, 0.2);
    else if (p.kind === 'cable') _c.set(0xe9ff70);
    else if (p.kind === 'cam') _c.set(0xff4f6d);
    else if (p.kind === 'release') _c.set(0xfff0a0);
    const big = p.kind === 'power' || p.kind === 'bank' || p.kind === 'zap' || p.kind === 'disc' || p.kind === 'cam';
    v.streakMat.color.copy(_c).multiplyScalar(big ? 2.4 : p.kind === 'counter' ? 2.6 : 1.9);
    v.glowMat.color.copy(_c).multiplyScalar(big ? 2.4 : 1.4);
    v.glow.scale.setScalar(p.kind === 'power' ? 2.2 : p.kind === 'bank' || p.kind === 'zap' ? 1.5 : p.kind === 'bolt' ? 0.8 : p.kind === 'slug' || p.kind === 'counter' ? 1 : 0.6);
    v.ring.visible = (p.kind === 'power' && p.weapon !== 'pulse_rifle') || p.kind === 'bank' || p.kind === 'zap' || p.kind === 'disc';
    (v.ring.material as SpriteMaterial).color.copy(_c).multiplyScalar(1.2);
    v.ring.scale.setScalar(3.2);
    v.streak.visible = true;
  }

  private syncProjectile(v: ProjVis, p: Projectile, alpha: number, dt: number): void {
    const x = lerp(p.px, p.x, alpha);
    const z = lerp(p.pz, p.z, alpha);
    v.y = damp(v.y, ARENA.shotHeight + (p.kind === 'power' ? 0.1 : 0), 6, dt);
    v.group.position.set(x, v.y, z);
    // the BANK SHOT disc spins on its edge as it flies; the REBOUND DISC spins flat
    if (p.kind === 'disc') v.core.rotation.set(Math.PI / 2, this.t * 26, 0);
    else v.core.rotation.set(0, Math.atan2(p.vx, p.vz), p.kind === 'bank' ? this.t * 30 : 0);

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
    const n = p.kind === 'power' ? 3 : p.kind === 'bank' || p.kind === 'disc' ? 2 : (p.kind === 'bolt' || p.kind === 'cable') && rng.chance(0.5) ? 1 : 0;
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
        p.electric ? _c.set(0xffe14d) : p.kind === 'bank' ? _c.set(0xffb070) : p.kind === 'disc' ? _c.set(0x7aeeff) : p.kind === 'cable' ? _c.set(0xe9ff70) : s.accent,
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
        const heavy = e.kind === 'power' || e.kind === 'bank' || e.kind === 'split';
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
        } else if (weapon === 'breaker') {
          // CHAMPION BURST slugs land with weight: a moderate jolt when they hit the player
          this.cam.addTrauma(e.side === 0 ? 0.08 : 0.03);
          if (e.side === 0) this.cam.kick(0.1);
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
        s.model.anim.cue('combo');
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
          s.model.anim.evade();
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
        if (e.perfect) s.model.anim.cue('brace');
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
      case 'cutStart': {
        // the champion raises PRIME BREAKER over his head: spotlight burst and a camera beat
        const s = this.slots[e.side];
        const gold = _c.set(0xffc23a);
        this.vfx.rays(s.pos.x, 2.2, s.pos.z, gold, 1, e.empowered ? 5.5 : 4.2, 0.6, 2.4);
        this.vfx.ring(s.pos.x, s.pos.z, gold, 0.6, e.empowered ? 5 : 4, 0.5, 2.8);
        this.vfx.flash(s.pos.x, 2.6, s.pos.z, _c.set(0xfff0c0), 1, 3.2, 0.3, 2.6);
        this.vfx.burst(s.pos.x, 2.4, s.pos.z, gold, 24, 5, 0.16, 0.5, 2.4, -2, 2);
        this.cam.focusAccent(s.pos, 0.5);
        this.cam.kick(0.25);
        this.arena.hype(0.6);
        break;
      }
      case 'cutAim': {
        const s = this.slots[e.side];
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xff4a2a), 0.4, 2.2, 0.3, 2);
        break;
      }
      case 'cutLock': {
        const s = this.slots[e.side];
        const mz = s.model.rig.muzzles[0].getWorldPosition(_v);
        this.vfx.flash(mz.x, mz.y, mz.z, _c.set(0xff5a3a), 0.6, 1.8, 0.16, 3);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xffd0c0), 0.5, 2.6, 0.25, 2.6);
        break;
      }
      case 'cutShot': {
        const s = this.slots[e.side];
        s.model.anim.fire(0, true);
        const from = s.model.rig.muzzles[0].getWorldPosition(_v);
        _v2.set(e.ex, ARENA.shotHeight, e.ez);
        const col = e.empowered ? _c.set(0xffb02a) : _c.set(0xff5a2a);
        this.vfx.cutBeam(from, _v2, col, e.final, e.empowered);
        if (e.outcome === 'miss' || e.outcome === 'dodged') this.vfx.wallHit(e.ex, e.ez, col, true);
        this.cam.addTrauma(e.final ? 0.42 : 0.22);
        this.cam.kick(e.final ? 0.75 : 0.35);
        this.r.pulseFlash(e.empowered ? 0xffc23a : 0xff7a4a, e.final ? 1.8 : 1.1);
        if (e.final) this.arena.hype(0.8);
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
        // Alpha 1.6: a HOLO DECOY uses its own twin, so it can stand next to a PHANTOM STEP decoy
        const kind = m.decoys.find((x) => x.id === e.id)?.kind ?? 'phantom';
        const holo = this.models.getHolo(look, kind === 'holo' ? 1 : 0);
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
      case 'propHit': {
        // a set piece took a hit but still stands (or a reactive piece answered)
        this.arena.propHit(e.index, e.hp, e.heavy, e.x, e.z);
        break;
      }
      case 'propBreak': {
        // each stage stages its own break (speaker blast, chip shower, pumpkin burst…)
        this.arena.propBreak(e.index, e.x, e.z);
        this.cam.addTrauma(0.15);
        break;
      }
      case 'propRespawn': {
        const p = this.match?.props[e.index];
        if (p) this.arena.propRespawn(e.index, p.x, p.z);
        break;
      }
      // Alpha 1.5 — BANK SHOT / FALSE START
      case 'bank': {
        const s = this.slots[e.side];
        this.vfx.bankSpark(e.x, e.z, e.nx, e.nz, _c.set(0xff9a4a).lerp(s.accent, 0.3));
        this.cam.addTrauma(0.08);
        break;
      }
      case 'trickShot': {
        const s = this.slots[e.side];
        s.model.anim.cue('trick');
        this.vfx.rays(e.x, ARENA.shotHeight, e.z, _c.set(0xffb070), 1, 3.4, 0.4, 2);
        this.vfx.ring(e.x, e.z, s.accent, 0.5, 3, 0.4, 2.2);
        this.arena.hype(0.8);
        break;
      }
      case 'feint': {
        // the afterimage stays where she was, she slips aside
        const s = this.slots[e.side];
        const f = m.fighters[e.side];
        if (this.ghost) this.root.remove(this.ghost.model.rig.root);
        const g = this.models.getGhost(f.look);
        g.anim.reset(f.facing);
        g.rig.root.position.set(e.x, 0, e.z);
        this.root.add(g.rig.root);
        this.ghost = { model: g, t: 0, x: e.x, z: e.z, yaw: f.facing };
        this.vfx.ring(e.x, e.z, s.accent, 0.35, 2.2, 0.35, 2);
        this.vfx.burst(e.x, 1.1, e.z, s.accent, 14, 3, 0.14, 0.35, 2.2);
        break;
      }
      case 'feintCounter': {
        const s = this.slots[e.side];
        s.model.anim.cue('counter');
        const p = this.chest(e.side, _v);
        this.vfx.flash(p.x, p.y, p.z, s.accent, 1.2, 3, 0.25, 2.6);
        this.vfx.rays(p.x, p.y, p.z, _c.set(0xffe3c2), 1, 3, 0.35, 2);
        this.vfx.ring(s.pos.x, s.pos.z, s.accent, 0.5, 3.2, 0.4, 2.4);
        this.requestTime(0.35, 0.18);
        this.cam.addTrauma(0.15);
        this.arena.hype(0.8);
        break;
      }
      // Alpha 1.5.5 — Zoe's SHOCK: a visible charge, then a dodgeable bolt
      case 'zapCharge': {
        const s = this.slots[e.side];
        const h = s.model.rig.handR.getWorldPosition(_v);
        this.vfx.flash(h.x, h.y, h.z, _c.set(0xffe14d), 0.8, 2.4, 0.2, 2.4);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xffe14d), 0.3, 2.4, e.duration, 2.2);
        break;
      }
      case 'zapFizzle': {
        const s = this.slots[e.side];
        this.vfx.burst(s.pos.x, 1.2, s.pos.z, _c.set(0xffe14d), 8, 2, 0.08, 0.3, 2);
        break;
      }
      case 'feintEnd': {
        const s = this.slots[e.side];
        this.vfx.burst(s.pos.x, 1.1, s.pos.z, s.accent, 6, 2, 0.1, 0.3, 1.6);
        break;
      }
      case 'reaction': {
        this.arena.hype(e.tier === 3 ? 1 : 0.5);
        break;
      }
      // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
      case 'cast': {
        const s = this.slots[e.side];
        const def = CARDS[e.card];
        const kind: CastKind = def.cast ?? 'device';
        s.model.anim.cast(kind, CAST_VARIANT[e.card] ?? 0);
        const col = _c.set(def.color);
        if (kind === 'device' || kind === 'signal') {
          const h = s.model.rig.elbowL.getWorldPosition(_v);
          this.vfx.flash(h.x, h.y, h.z, col, 0.3, 1.2, 0.22, 2.4);
        }
        break;
      }
      case 'tag': {
        const s = this.slots[e.side];
        const target = this.slots[e.target];
        const from = s.model.rig.elbowL.getWorldPosition(_v);
        _v2.set(target.pos.x, 2.4, target.pos.z);
        if (!e.hit) _v2.x += 1;
        const warm = _c.set(0xfff0b0);
        this.vfx.bolt(from, _v2, warm, 0.07, 0.3, 0.04, 2.6);
        if (e.hit) {
          this.vfx.flash(target.pos.x, 3.4, target.pos.z, warm, 0.5, 2.2, 0.3, 2.6);
          this.vfx.ring(target.pos.x, target.pos.z, warm, 0.4, 2.4, 0.4, 2.2);
        } else this.vfx.burst(_v2.x, _v2.y, _v2.z, warm, 8, 3, 0.1, 0.3, 2);
        break;
      }
      case 'tagHit': {
        const gold = _c.set(0xffe27a);
        this.vfx.rays(e.x, 1.4, e.z, gold, 1, 4, 0.5, 2.4);
        this.vfx.flash(e.x, 3.2, e.z, gold, 1, 3.4, 0.35, 3);
        this.vfx.ring(e.x, e.z, gold, 0.6, 4, 0.45, 2.6);
        this.arena.hype(0.7);
        break;
      }
      case 'push': {
        const col = _c.set(0xb18cff);
        this.vfx.cone(e.x + e.dx * 0.6, 1.1, e.z + e.dz * 0.6, e.dx, e.dz, col, 26, 9, 0.6, 0.16, 2.4);
        this.vfx.ring(e.x + e.dx * 1.2, e.z + e.dz * 1.2, col, 0.6, e.range * 1.4, 0.3, 2.4);
        if (e.hit) {
          const t = this.slots[1 - e.side];
          this.vfx.dust(t.pos.x, t.pos.z, 10, e.dx, e.dz);
          this.vfx.flash(t.pos.x, 1.2, t.pos.z, col, 0.6, 2.2, 0.2, 2.2);
          this.cam.addTrauma(0.18);
        }
        break;
      }
      case 'object':
        this.objectEvent(e);
        break;
      case 'tether': {
        const col = _c.set(0xe9ff70);
        this.vfx.flash(e.ax, 0.6, e.az, col, 0.6, 2.4, 0.25, 2.6);
        this.vfx.ring(e.ax, e.az, col, 0.5, e.radius * 2.2, 0.35, 2.2);
        this.slots[e.side].model.anim.hit(0, 0, false);
        break;
      }
      case 'tetherEnd': {
        if (!e.broke) break;
        const s = this.slots[e.side];
        this.vfx.burst(s.pos.x, 0.9, s.pos.z, _c.set(0xe9ff70), 18, 6, 0.12, 0.35, 2.4);
        break;
      }
      case 'frame': {
        const s = this.slots[e.side];
        const f = m.fighters[e.side];
        this.vfx.flash(s.pos.x + Math.sin(f.facing) * 0.9, 1.15, s.pos.z + Math.cos(f.facing) * 0.9, _c.set(0xc6ff4d), 0.6, 2.2, 0.2, 2.4);
        break;
      }
      case 'frameCatch': {
        const s = this.slots[e.side];
        const col = _c.set(0xc6ff4d);
        s.model.anim.cue('brace');
        this.vfx.flash(e.x, ARENA.shotHeight, e.z, col, 1, 2.8, 0.25, 3);
        this.vfx.burst(e.x, ARENA.shotHeight, e.z, col, 24, 7, 0.14, 0.4, 2.6);
        this.vfx.ring(s.pos.x, s.pos.z, col, 0.5, 3, 0.35, 2.4);
        this.cam.addTrauma(0.12);
        break;
      }
      case 'rewind': {
        const s = this.slots[e.side];
        const f = m.fighters[e.side];
        const col = _c.set(0xff7ad9);
        // a tape-rewind ghost stays where the fighter was, a scanline trail runs to where it goes
        if (this.ghost) this.root.remove(this.ghost.model.rig.root);
        const g = this.models.getGhost(f.look);
        g.anim.reset(f.facing);
        g.rig.root.position.set(e.fromX, 0, e.fromZ);
        this.root.add(g.rig.root);
        this.ghost = { model: g, t: 0, x: e.fromX, z: e.fromZ, yaw: f.facing };
        const dx = e.toX - e.fromX;
        const dz = e.toZ - e.fromZ;
        for (let i = 0; i < 8; i++) {
          const t = i / 8;
          this.vfx.sparks.spawn(e.fromX + dx * t, rng.range(0.3, 2), e.fromZ + dz * t, 0, rng.range(-0.3, 0.3), 0, 0.35, 0.22, 0.02, i % 2 ? col : _c.set(0x7af0ff), 2.2, 2, 0);
        }
        this.vfx.ring(e.toX, e.toZ, col, 0.4, 2.4, 0.35, 2.2);
        s.trailT = 0.3;
        break;
      }
      case 'stakes': {
        const s = this.slots[e.side];
        this.vfx.burst(s.pos.x, 1.2, s.pos.z, _c.set(0xff3a5c), 22, 4, 0.14, 0.6, 2.4, -3, 3);
        this.vfx.rays(s.pos.x, 1.6, s.pos.z, _c.set(0xffd23a), 1, 3.4, 0.45, 2.2);
        this.vfx.ring(s.pos.x, s.pos.z, _c.set(0xffd23a), 0.5, 3.4, 0.4, 2.4);
        this.r.pulseFlash(0xffd23a, 1);
        this.arena.hype(0.6);
        break;
      }
      case 'disc': {
        const col = _c.set(0x38e1ff);
        if (e.what === 'turn') this.vfx.ring(e.x, e.z, col, 0.3, 1.6, 0.25, 2);
        else this.vfx.flash(e.x, 1.2, e.z, col, 0.5, 1.6, 0.2, 2.2);
        break;
      }
      case 'breakFree': {
        this.vfx.ring(e.x, e.z, _c.set(0xffffff), 0.5, 3, 0.3, 2.4);
        this.vfx.burst(e.x, 1, e.z, _c.set(0xe9ff70), 16, 6, 0.12, 0.35, 2.2);
        break;
      }
      case 'erase': {
        this.vfx.burst(e.x, ARENA.shotHeight, e.z, _c.set(0xa6f0ff), 10, 3, 0.12, 0.3, 2.2);
        break;
      }
      default:
        break;
    }
  }

  /** Alpha 1.6: beats of the new set pieces (spawn, land, arm, fire, trigger, hit, break). */
  private objectEvent(e: Extract<MatchEvent, { type: 'object' }>): void {
    switch (e.kind) {
      case 'net':
        if (e.what === 'land') {
          const col = _c.set(0x4dffd2);
          this.vfx.ring(e.x, e.z, col, 0.5, 4, 0.4, 2.4);
          this.vfx.burst(e.x, 0.3, e.z, col, 16, 4, 0.12, 0.4, 2.2, 0, 2);
        }
        break;
      case 'mine':
        if (e.what === 'land') this.vfx.dust(e.x, e.z, 4);
        else if (e.what === 'arm') this.vfx.ring(e.x, e.z, _c.set(0xff4a6e), 0.3, 2.2, 0.3, 2);
        else if (e.what === 'trigger') {
          const col = _c.set(0xff4a6e);
          this.vfx.flash(e.x, 0.6, e.z, _c.set(0xffffff), 1, 3.4, 0.25, 3);
          this.vfx.burst(e.x, 0.4, e.z, col, 34, 9, 0.18, 0.5, 2.6, 4, 3);
          this.vfx.ring(e.x, e.z, col, 0.6, 4.4, 0.4, 2.8);
          this.vfx.scorch(e.x, e.z, 1.6, 3);
          this.cam.addTrauma(0.3);
          this.arena.hype(0.6);
        }
        break;
      case 'barrier': {
        const col = _c.set(0x6ec8ff);
        if (e.what === 'spawn') {
          this.vfx.burst(e.x, 0.2, e.z, col, 20, 5, 0.12, 0.4, 2.4, 0, 3);
          this.vfx.ring(e.x, e.z, col, 0.4, 2.8, 0.3, 2.2);
        } else if (e.what === 'hit') {
          this.cards.pulse(e.id);
          this.vfx.burst(e.x, ARENA.shotHeight, e.z, col, 8, 4, 0.1, 0.25, 2.4);
        } else if (e.what === 'break') {
          this.vfx.burst(e.x, 1, e.z, col, 36, 8, 0.16, 0.5, 2.6, 6);
          this.vfx.debrisBurst(e.x, 0.9, e.z, col, 10);
          this.cam.addTrauma(0.2);
        }
        break;
      }
      case 'prop':
        if (e.what === 'land') {
          const col = _c.set(0xffb02a);
          this.vfx.landImpact(e.x, e.z, 1, col);
          this.vfx.dust(e.x, e.z, 14);
          this.vfx.debrisBurst(e.x, 0.6, e.z, _c.set(0xffcf3f), 10);
          this.vfx.ring(e.x, e.z, col, 0.6, 4.2, 0.4, 2.6);
          this.cam.addTrauma(0.35);
          this.cam.kick(0.35);
          this.arena.hype(0.5);
        }
        break;
      case 'cam': {
        const col = _c.set(0xff3a4a);
        if (e.what === 'spawn') this.vfx.burst(e.x, 0.6, e.z, col, 10, 3, 0.1, 0.3, 2);
        else if (e.what === 'lock') this.vfx.flash(e.x, 1.4, e.z, col, 0.6, 2, 0.2, 2.6);
        else if (e.what === 'fire') {
          this.vfx.flash(e.x, 1.4, e.z, _c.set(0xffffff), 0.8, 2.6, 0.18, 3);
          this.vfx.burst(e.x, 1.4, e.z, col, 16, 6, 0.12, 0.3, 2.6);
          this.cam.addTrauma(0.12);
        }
        break;
      }
      case 'freeze':
        if (e.what === 'spawn') {
          const col = _c.set(0xa6f0ff);
          this.vfx.ring(e.x, e.z, col, 0.5, 5, 0.45, 2.6);
          this.vfx.rays(e.x, 1.2, e.z, col, 1, 3.2, 0.4, 2);
          this.r.pulseFlash(0xa6f0ff, 0.8);
        } else if (e.what === 'land') this.vfx.ring(e.x, e.z, _c.set(0xa6f0ff), 0.5, 4, 0.35, 2.4);
        break;
    }
  }
}

/** Alpha 1.6: gesture variants (FighterAnimator.cast): lobs, two-handed devices, crew calls, arms up. */
const CAST_VARIANT: Partial<Record<string, number>> = {
  gravity_net: 1,
  pressure_mine: 1,
  freeze_frame: 1,
  prop_drop: 1,
  side_cam: 1,
  high_stakes: 2,
};
