import type { Color, Group, Object3D } from 'three';
import type { GhostHost } from './cosmeticFx';
import type { FighterRig } from './FighterModel';
import type { CachedFighter, ModelCache, RigCopy } from './ModelCache';

// Beta 2.7.5 — PHANTOM DASH's hologram afterimages: copies of the fighter's own model (the hologram twins of ModelCache,
// one shared holo shader), each frozen in the pose the fighter had at the moment of the dash — copied bone by bone by
// name — standing along the dash path and fading. At most three, built once per look and reused (hidden when idle:
// no draw calls); the battle view and the fitting room's showcase each keep their own set.

const MAX = 3;
/** Hologram twin indices of ModelCache used here (0–2 belong to the decoys and SECOND TAKE's echo). */
const FIRST = 3;

const named = new WeakMap<Object3D, Map<string, Object3D>>();
function namesOf(root: Object3D): Map<string, Object3D> {
  let m = named.get(root);
  if (!m) {
    m = new Map();
    const map = m;
    root.traverse((o) => {
      if (o !== root && o.name && !map.has(o.name)) map.set(o.name, o);
    });
    named.set(root, m);
  }
  return m;
}

/** Puts `dst` (a rig of the same look) in the pose `src` has now: every named bone, and the root's turn. */
export function copyPose(src: Object3D, dst: Object3D): void {
  const a = namesOf(src);
  const b = namesOf(dst);
  for (const [n, o] of a) {
    const d = b.get(n);
    if (!d) continue;
    d.position.copy(o.position);
    d.quaternion.copy(o.quaternion);
    d.scale.copy(o.scale);
  }
  dst.quaternion.copy(src.quaternion);
  dst.scale.copy(src.scale);
}

interface Item {
  model: CachedFighter;
  t: number;
  delay: number;
  life: number;
  peak: number;
  on: boolean;
  /** The pose is taken when the copy appears (the fighter is in its dash by then — not the stance before it). */
  posed: boolean;
}

export class AfterImages implements GhostHost {
  private items: Item[] = [];
  private look = '';
  private copy: RigCopy = 0;
  private src: FighterRig | null = null;
  private next = 0;
  private time = 0;

  constructor(
    private readonly models: ModelCache,
    private readonly parent: Group,
  ) {}

  /** Whose afterimages: the look, its rig copy (a mirror match has two) and the live rig to copy poses from. */
  bind(look: string, copy: RigCopy, src: FighterRig): void {
    if (look !== this.look || copy !== this.copy) {
      this.clear();
      for (const it of this.items) if (it.model.rig.root.parent === this.parent) this.parent.remove(it.model.rig.root);
      this.items = [];
      this.next = 0;
    }
    this.look = look;
    this.copy = copy;
    this.src = src;
  }

  /** Builds the copies now (and puts them, hidden, in the scene) — so the warm-up compiles them before a fight. */
  warm(n = MAX): void {
    for (let k = this.items.length; k < Math.min(MAX, n); k++) this.item(k);
  }

  private item(k: number): Item {
    let it = this.items[k];
    if (!it) {
      const model = this.models.getHolo(this.look, FIRST + k, this.copy);
      model.rig.root.visible = false;
      if (model.rig.root.parent !== this.parent) this.parent.add(model.rig.root);
      it = { model, t: 0, delay: 0, life: 1, peak: 1, on: false, posed: false };
      this.items[k] = it;
    }
    return it;
  }

  ghost(x: number, z: number, delay: number, life: number, color: Color, peak: number): void {
    if (!this.src || !this.look) return;
    const it = this.item(this.next);
    this.next = (this.next + 1) % MAX;
    const root = it.model.rig.root;
    root.position.set(x, this.src.root.position.y, z);
    root.visible = false;
    it.posed = false;
    const hm = it.model.rig.holoMat;
    if (hm) {
      hm.uniforms.uColor.value.copy(color);
      hm.uniforms.uOpacity.value = 0;
    }
    it.t = 0;
    it.delay = delay;
    it.life = life;
    it.peak = peak;
    it.on = true;
  }

  update(dt: number): void {
    this.time += dt;
    for (const it of this.items) {
      if (!it.on) continue;
      const root = it.model.rig.root;
      if (it.delay > 0) {
        it.delay -= dt;
        continue;
      }
      if (!it.posed && this.src) {
        const x = root.position.x;
        const z = root.position.z;
        copyPose(this.src.root, root);
        root.position.set(x, this.src.root.position.y, z);
        it.posed = true;
      }
      it.t += dt;
      if (it.t >= it.life) {
        it.on = false;
        root.visible = false;
        continue;
      }
      root.visible = true;
      const k = it.t / it.life;
      const hm = it.model.rig.holoMat;
      if (hm) {
        hm.uniforms.uTime.value = this.time;
        // a quick flare on, then a fade that slows down at the end (the copy dissolves)
        hm.uniforms.uOpacity.value = it.peak * Math.min(1, it.t / 0.04) * Math.pow(1 - k, 1.6);
      }
      // the copy settles a hair as it dissolves
      root.position.y = (this.src?.root.position.y ?? 0) - 0.04 * k;
    }
  }

  /** Every copy hidden at once (a new fight, the shop closed). */
  clear(): void {
    for (const it of this.items) {
      it.on = false;
      it.model.rig.root.visible = false;
    }
  }
}
