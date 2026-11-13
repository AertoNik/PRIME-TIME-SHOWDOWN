// DEV ONLY (Alpha 1.9.8) — does anything of a set hang between the battle camera and the fighters?
//
// Loaded by main.ts only under `import.meta.env.DEV`, so it never reaches the published game. In the dev console:
//   __occlusion('backlot')   → { rays, blocked, objects: [...] }   (every set: __occlusionAll())
// It sweeps the battle camera over the poses CameraRig really takes (target clamp, pitch, the distance range of every
// screen shape) and casts a ray from the lens to points on the fighters' bodies all over the fighting area. Anything
// it hits ABOVE head height before reaching the fighter is reported: that is what covered a fighter on the phone
// (STUDIO BACKLOT's overhead trusses and lamps, 1.9.8; the cemetery's cross beams, 1.7.6). Low props — the barrier,
// the destructible cover — are part of the fight and are not reported.
import { Raycaster, Vector3, type Material, type Mesh, type Object3D } from 'three';
import { ARENA } from '../config/balance';
import { ARENA_ORDER, type ArenaId } from '../config/arenas.config';
import type { Game } from '../game/Game';

// the battle camera of CameraRig.battlePose (keep in step with it)
const PITCH = 0.93;
const LOOK_Y = 1.0;
const TARGET_X = 3.2;
const TARGET_Z = 6;
const DIST = [17.5, 21, 25, 32];
/** Only hits above this height count as «hanging over the fight». */
const OVERHEAD_Y = 3.2;

interface Found {
  what: string;
  rays: number;
  transparent: boolean;
}

function shown(o: Object3D | null): boolean {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function describe(o: Object3D): { key: string; what: string; transparent: boolean } {
  const m = o as Mesh;
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as (Material & { color?: { getHexString(): string }; opacity: number }) | undefined;
  const p = new Vector3();
  o.getWorldPosition(p);
  const geo = m.geometry?.type ?? o.type;
  const box = m.geometry?.boundingBox;
  const size = box ? `${(box.max.x - box.min.x).toFixed(1)}×${(box.max.y - box.min.y).toFixed(1)}×${(box.max.z - box.min.z).toFixed(1)}` : '';
  const what = `${o.name || geo} ${size} @(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}) #${mat?.color?.getHexString?.() ?? '—'}`;
  return { key: o.uuid, what, transparent: !!mat && (mat.transparent || mat.opacity < 1) };
}

export function probe(game: Game, id?: ArenaId): { arena: string; rays: number; blocked: number; objects: Found[] } {
  if (id) game.arena.setStage(id);
  const root = game.arena.group;
  root.updateMatrixWorld(true);
  const rc = new Raycaster();
  const found = new Map<string, Found>();
  let rays = 0;
  let blocked = 0;
  const cam = new Vector3();
  const pt = new Vector3();
  const dir = new Vector3();
  for (const tx of [-TARGET_X, 0, TARGET_X]) {
    for (const tz of [-TARGET_Z, -3, 0, 3, TARGET_Z]) {
      for (const d of DIST) {
        cam.set(tx, LOOK_Y + Math.sin(PITCH) * d, tz + Math.cos(PITCH) * d);
        for (let px = -ARENA.halfX; px <= ARENA.halfX + 1e-6; px += ARENA.halfX / 3) {
          for (let pz = -ARENA.halfZ; pz <= ARENA.halfZ + 1e-6; pz += ARENA.halfZ / 4) {
            // the camera frames the two fighters around its target: points far from it are never on screen
            if (Math.abs(px - tx) > 6.5 || Math.abs(pz - tz) > 7.5) continue;
            for (const h of [0.6, 1.6, 2.6]) {
              pt.set(px, h, pz);
              dir.subVectors(pt, cam);
              const dist = dir.length();
              rc.set(cam, dir.normalize());
              rc.far = dist - 0.2;
              rays++;
              const xs = rc.intersectObject(root, true).filter((x) => x.point.y > OVERHEAD_Y && shown(x.object));
              if (!xs.length) continue;
              blocked++;
              const seen = new Set<string>();
              for (const x of xs) {
                const dsc = describe(x.object);
                if (seen.has(dsc.key)) continue;
                seen.add(dsc.key);
                const f = found.get(dsc.key) ?? { what: dsc.what, rays: 0, transparent: dsc.transparent };
                f.rays++;
                found.set(dsc.key, f);
              }
            }
          }
        }
      }
    }
  }
  return { arena: id ?? 'current', rays, blocked, objects: [...found.values()].sort((a, b) => b.rays - a.rays) };
}

export function installOcclusionProbe(game: Game): void {
  const w = window as unknown as Record<string, unknown>;
  w.__occlusion = (id?: ArenaId) => probe(game, id);
  w.__occlusionAll = () => ARENA_ORDER.map((id) => {
    const r = probe(game, id);
    return { arena: id, rays: r.rays, blocked: r.blocked, solid: r.objects.filter((o) => !o.transparent).map((o) => `${o.rays}× ${o.what}`), transparent: r.objects.filter((o) => o.transparent).map((o) => `${o.rays}× ${o.what}`) };
  });
}
