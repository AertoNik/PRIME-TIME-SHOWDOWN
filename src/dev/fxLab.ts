// Beta 2.7.5 — the FX lab (dev builds only, never published): a cosmetic effect played by the PRIME SHOP fitting room's
// own «Рывок» / «Победа» button (the same code path a player sees), the frames stepped in game time to a chosen moment —
// «before / after» pictures of one effect show the same instant; MAIN EVENT in a real fight; portraits of a look.
//
//   await __fx.shot(<sku>, 420)   play, stop 420 ms (of game time) later
//   __fx.release()                 the game's own loop runs again
import { Color } from 'three';
import type { Game } from '../game/Game';
import { SHOP_ITEMS, type ShopSku } from '../config/shop.config';
import { LOOKS } from '../config/looks';
import { Rng } from '../core/math';
import { DASH_FX, VICTORY_FX, dashBurst, dashColor, victoryCelebration } from '../render/cosmeticFx';

const realSetTimeout = window.setTimeout.bind(window);
const realClearTimeout = window.clearTimeout.bind(window);
const wait = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));

/**
 * Timers on game time while the lab holds the loop: the effects schedule their later parts with setTimeout (a firework
 * shell, the second arc), and a background page runs real timers once a second — the pictures would miss them.
 */
const VIRTUAL = 1e9;
let vNow = 0;
let vNext = VIRTUAL;
let vQueue: { id: number; at: number; fn: () => void }[] = [];
function virtualTimers(on: boolean): void {
  const w = window as unknown as { setTimeout: unknown; clearTimeout: unknown };
  if (on) {
    w.setTimeout = (fn: (...a: unknown[]) => void, ms?: number, ...args: unknown[]) => {
      const id = ++vNext;
      vQueue.push({ id, at: vNow + (ms ?? 0), fn: () => fn(...args) });
      return id;
    };
    w.clearTimeout = (id?: number) => {
      if (id !== undefined && id > VIRTUAL) vQueue = vQueue.filter((q) => q.id !== id);
      else realClearTimeout(id);
    };
  } else {
    w.setTimeout = realSetTimeout;
    w.clearTimeout = realClearTimeout;
    // whatever is still pending goes back to real timers, with the time it had left
    const left = vQueue;
    vQueue = [];
    for (const q of left) realSetTimeout(q.fn, Math.max(0, q.at - vNow));
  }
}
function virtualAdvance(ms: number): void {
  vNow += ms;
  for (;;) {
    const due = vQueue.filter((q) => q.at <= vNow).sort((a, b) => a.at - b.at)[0];
    if (!due) break;
    vQueue = vQueue.filter((q) => q !== due);
    due.fn();
  }
}

export function installFxLab(g: Game): void {
  // The lab drives the frames itself (fixed 1/60 s, the game's own frame function): a hidden or background page runs its
  // timers once a second, and a picture taken «420 ms after» would then show any moment at all. The game's loop is held
  // meanwhile and restarted afterwards (the same way as the long-session probe of Beta 2.7); the page's timers run on the
  // same game time meanwhile (see virtualTimers).
  const anyG = g as unknown as Record<string, any>;
  let release: (() => void) | null = null;
  let clock = 0;
  const hold = () => {
    if (release) return;
    const loop = anyG.loop;
    anyG.loop = () => {};
    clock = performance.now() / 1000;
    virtualTimers(true);
    release = () => {
      virtualTimers(false);
      anyG.loop = loop;
      anyG.last = performance.now();
      anyG.scheduleNext?.();
      release = null;
    };
  };
  /** `ms` of game time, frame by frame (each frame updated AND drawn, as the game does). */
  const run = (ms: number) => {
    const n = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < n; i++) {
      clock += 1 / 60;
      virtualAdvance(1000 / 60);
      anyG.frame(1 / 60, clock);
    }
  };
  const lab = {
    hold,
    run,
    release(): void {
      release?.();
    },
    /** Opens the item page of `sku` (the fitting room) and waits for it to settle. */
    async open(sku: ShopSku, settle = 3200): Promise<void> {
      hold();
      g.goto('shop', { sku });
      // (the page's own automatic preview starts on a timer: let it fire, then run its effect out in game time)
      await wait(700);
      run(settle);
    },
    /** Plays the item's preview and freezes the scene `ms` later (opens the item first when needed). */
    async shot(sku: ShopSku, ms: number, reopen = true): Promise<string> {
      if (reopen) await lab.open(sku);
      const b = document.querySelector<HTMLButtonElement>('.screen [data-act="play"]');
      if (!b) return 'no play button';
      hold();
      b.click();
      run(ms);
      return 'at ' + ms;
    },
    /**
     * Any dash / victory cosmetic by its id — also those never sold (league, daily, invite, Halloween exchange) — played
     * the way the fitting room plays it, on the scene of the item page that is open (open one first: same framing).
     */
    async direct(id: string, ms: number): Promise<string> {
      const rng = new Rng(7);
      if (DASH_FX[id]) {
        hold();
        const fx = DASH_FX[id] ?? null;
        const color = dashColor(fx) ?? new Color(LOOKS[g.showcase.look]?.glow ?? 0x22f0e0);
        g.showcase.demoDash(0.95, -0.95);
        dashBurst(g.vfx, rng, fx, color, 0.95, 0.3, -0.95, 0.3, g.showcase.ghosts);
      } else if (VICTORY_FX[id]) {
        hold();
        g.showcase.cheer();
        run(380);
        victoryCelebration(g.vfx, VICTORY_FX[id] ?? null, 0, 0, g.battleView.style.confetti, () => true);
      } else return 'unknown id';
      hold();
      run(ms);
      return 'at ' + ms;
    },
    /**
     * The frame as the game draws it (the WebGL canvas, no page UI over it) → docs/beta275/<name>.jpg through the local
     * receiver of the lab (scratchpad shot-receiver.mjs, 127.0.0.1 only). Drawn and read in one go (no kept buffer).
     */
    async capture(name: string, crop: [number, number, number, number] = [0, 0, 1, 1], quality = 0.9): Promise<string> {
      g.renderer.render(0);
      const src = g.renderer.renderer.domElement;
      const [x0, y0, x1, y1] = crop;
      const w = Math.round(src.width * (x1 - x0));
      const h = Math.round(src.height * (y1 - y0));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(src, Math.round(src.width * x0), Math.round(src.height * y0), w, h, 0, 0, w, h);
      const url = c.toDataURL('image/jpeg', quality);
      const r = await fetch('http://127.0.0.1:18275/save', { method: 'POST', body: JSON.stringify({ name, url }) });
      return r.ok ? `${name}: ${(await r.json()).bytes} bytes` : `${name}: ${r.status}`;
    },
    /** One effect at several moments: the same start each time (the item page reopened), a picture per moment. */
    async series(key: string, how: { sku?: ShopSku; id?: string }, moments: number[], prefix: string, crop?: [number, number, number, number]): Promise<string[]> {
      const out: string[] = [];
      for (const ms of moments) {
        if (how.sku) await lab.shot(how.sku, ms);
        else {
          // (the fitting room of any item of the same slot — the lab names no paid item itself)
          const win = how.id!.startsWith('victory');
          const page = SHOP_ITEMS.find((i) => i.cosmetic && (win ? VICTORY_FX : DASH_FX)[i.cosmetic]);
          await lab.open(page!.sku);
          await lab.direct(how.id!, ms);
        }
        out.push(await lab.capture(`${prefix}-${key}-${ms}`, crop));
        lab.release();
      }
      return out;
    },
    /** A comparison sheet: per key a row of «before» then «after» pictures at the given moments → docs/beta275/<name>.jpg. */
    async sheet(name: string, keys: string[], moments: number[], cw: number, chFrac: number, pres: string[] = ['before', 'after']): Promise<string> {
      const load = (u: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = u + '?t=' + Date.now();
        });
      const ch = Math.round(cw * chFrac);
      const cols = pres.length * moments.length;
      const c = document.createElement('canvas');
      c.width = cw * cols;
      c.height = (ch + 22) * keys.length;
      const x = c.getContext('2d')!;
      x.fillStyle = '#05060f';
      x.fillRect(0, 0, c.width, c.height);
      x.font = 'bold 14px sans-serif';
      x.fillStyle = '#fff';
      let row = 0;
      for (const n of keys) {
        let col = 0;
        for (const pre of pres)
          for (const m of moments) {
            const im = await load(`/docs/beta275/${pre}-${n}-${m}.jpg`);
            x.drawImage(im, col * cw, row * (ch + 22) + 22, cw, ch);
            x.fillText(`${pre === 'before' ? 'ДО' : pre === 'after' ? 'ПОСЛЕ' : pre.toUpperCase()} · ${n} · ${m} мс`, col * cw + 6, row * (ch + 22) + 16);
            col++;
          }
        row++;
      }
      const r = await fetch('http://127.0.0.1:18275/save', { method: 'POST', body: JSON.stringify({ name, url: c.toDataURL('image/jpeg', 0.86) }) });
      return r.text();
    },
    /**
     * The fitting room's model on its own: turned `yaw` (0 = facing the camera), seen by a lab camera `dist` m away on
     * the line of the game's camera, aimed at `lookY` m above the stand — or at the gun (`target: 'gun'`).
     */
    async portrait(
      name: string,
      yaw: number,
      o: { dist?: number; camY?: number; lookY?: number; fov?: number; crop?: [number, number, number, number]; target?: 'gun'; side?: number } = {},
    ): Promise<string> {
      hold();
      const sc = g.showcase as unknown as {
        setDragging: (d: boolean) => void;
        yaw: number;
        group: { getWorldPosition: (v: unknown) => { x: number; y: number; z: number } };
        current: { rig: { weaponR?: { getWorldPosition: (v: unknown) => { x: number; y: number; z: number } } } } | null;
      };
      sc.setDragging(true);
      sc.yaw = yaw;
      run(300);
      const cam = g.renderer.camera;
      const p0 = cam.position.clone();
      const q0 = cam.quaternion.clone();
      const f0 = cam.fov;
      const c = sc.group.getWorldPosition(p0.clone());
      let hx = p0.x - c.x;
      let hz = p0.z - c.z;
      const L = Math.hypot(hx, hz) || 1;
      hx /= L;
      hz /= L;
      const dist = o.dist ?? 9;
      const t = o.target === 'gun' && sc.current?.rig.weaponR ? sc.current.rig.weaponR.getWorldPosition(p0.clone()) : { x: c.x, y: c.y + (o.lookY ?? 1.25), z: c.z };
      // (side: a sideways shift of the camera, in metres, along the line's right)
      const sd = o.side ?? 0;
      cam.position.set(t.x + hx * dist - hz * sd, c.y + (o.camY ?? 1.7), t.z + hz * dist + hx * sd);
      cam.lookAt(t.x, t.y, t.z);
      cam.fov = o.fov ?? 30;
      // (the shop's layout shifts the picture with a view offset — not for this camera)
      const view = cam.view;
      const viewOn = !!view?.enabled;
      if (view) view.enabled = false;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      g.vfx.update(0, cam);
      const r = await lab.capture(name, o.crop ?? [0, 0.2, 1, 0.8]);
      cam.position.copy(p0);
      cam.quaternion.copy(q0);
      cam.fov = f0;
      if (view) view.enabled = viewOn;
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      sc.setDragging(false);
      return r;
    },
    /** Rows of pictures: each row a file prefix (`<prefix>-<moment>.jpg`) with its caption, one column per moment. */
    async grid(name: string, rows: [string, string][], moments: string[], cw: number, chFrac: number): Promise<string> {
      const load = (u: string) =>
        new Promise<HTMLImageElement>((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = u + '?t=' + Date.now();
        });
      const ch = Math.round(cw * chFrac);
      const c = document.createElement('canvas');
      c.width = cw * moments.length;
      c.height = (ch + 22) * rows.length;
      const x = c.getContext('2d')!;
      x.fillStyle = '#05060f';
      x.fillRect(0, 0, c.width, c.height);
      x.font = 'bold 13px sans-serif';
      x.fillStyle = '#fff';
      for (let r = 0; r < rows.length; r++)
        for (let k = 0; k < moments.length; k++) {
          const im = await load(`/docs/beta275/${rows[r][1]}-${moments[k]}.jpg`);
          x.drawImage(im, k * cw, r * (ch + 22) + 22, cw, ch);
          x.fillText(`${rows[r][0]} · ${moments[k]}`, k * cw + 6, r * (ch + 22) + 16);
        }
      const res = await fetch('http://127.0.0.1:18275/save', { method: 'POST', body: JSON.stringify({ name, url: c.toDataURL('image/jpeg', 0.86) }) });
      return res.text();
    },
    /**
     * MAIN EVENT in a real fight: ACE (in `look`) against a rookie rival, the camera turned to look at ACE from the other
     * end (viewSide 1), MAIN EVENT played from his hand; a picture at each fraction of the wind-up in `at` (the fight
     * frozen at that exact progress), then at `after` ms past the shot. Pictures → docs/beta275/<prefix>-<k>.jpg.
     */
    async mainEvent(look: string, at: number[], after: number[], prefix: string, crop?: [number, number, number, number], close = 0, camY = 1.55, lookY = 0.95, yaw = 44): Promise<string[]> {
      const out: string[] = [];
      const orig = anyG.fighterLook.bind(g);
      anyG.fighterLook = (id: string) => (id === 'ace' ? look : orig(id));
      hold();
      anyG.launch({ fighter: 'ace', deck: ['main_event', 'dash', 'shield', 'power_shot'], rival: 'dex', difficulty: 'rookie' }, { kind: 'classic' });
      anyG.fighterLook = orig;
      // frame by frame until the condition holds (letting pending promises — model loads — settle now and then); a hidden
      // pane pauses the fight on its own, so the pause menu is closed again before every frame
      let quiet: (() => void) | null = null;
      const until = async (pred: () => boolean, maxMs = 15000) => {
        const max = Math.round(maxMs / (1000 / 60));
        for (let n = 0; n < max && !pred(); n++) {
          if (g.paused) {
            g.ui.closeModal();
            anyG.resume();
          }
          quiet?.();
          run(1000 / 60);
          if (n % 30 === 29) await wait(0);
        }
        return pred();
      };
      if (!(await until(() => g.match?.phase === 'fight'))) {
        lab.release();
        return ['no fight'];
      }
      const m = g.match!;
      const hands = (m as unknown as { hands: { hand: string[]; energy: number }[] }).hands;
      // the rival stays quiet (no card of theirs interrupts the wind-up in the pictures)
      // (and stands where it stood — it would walk into the close-up pictures)
      const rv = m.fighters[1] as unknown as { x: number; z: number; vx: number; vz: number };
      let hx = rv.x;
      let hz = rv.z;
      quiet = () => {
        hands[1].energy = 0;
        rv.x = hx;
        rv.z = hz;
        rv.vx = 0;
        rv.vz = 0;
      };
      await until(() => false, 500);
      g.battleView.setup(m, [look, null], 1, false);
      await until(() => false, 1200);
      hx = rv.x;
      hz = rv.z;
      const f = m.fighters[0];
      hands[0].energy = 10;
      const idx = hands[0].hand.indexOf('main_event');
      out.push(`hand ${hands[0].hand.join(',')} → ${idx} · ${String(m.playCard(0, idx))}`);
      const act = f.action as unknown as { dirX?: number; dirZ?: number };
      const dx = act.dirX ?? 0;
      const dz = act.dirZ ?? -1;
      // close > 0: a camera of the lab's own, `close` m from ACE (by default three-quarters from the front, gun-hand side)
      // (the battle camera sees him small, from far away); the game's camera is put back after every picture
      const snap = async (name: string): Promise<string> => {
        if (!close) return lab.capture(name, crop);
        const cam = g.renderer.camera;
        const p0 = cam.position.clone();
        const q0 = cam.quaternion.clone();
        const fov0 = cam.fov;
        const root = (g.battleView as unknown as { slots: { model: { rig: { root: { getWorldPosition: (v: typeof p0) => typeof p0 } } } }[] }).slots[0].model.rig.root;
        const at3 = root.getWorldPosition(p0.clone());
        // the direction from ACE to the lab camera: `yaw` degrees from his aim towards his right side (90 = side view)
        // (from the other side when that one is in the stands — the camera must stay over the floor)
        const dirTo = (deg: number) => {
          const cy = Math.cos((deg * Math.PI) / 180);
          const sy = Math.sin((deg * Math.PI) / 180);
          return [dx * cy - dz * sy, dz * cy + dx * sy];
        };
        let [ux, uz] = dirTo(yaw);
        const [vx, vz] = dirTo(-yaw);
        if (Math.hypot(at3.x + vx * close, at3.z + vz * close) < Math.hypot(at3.x + ux * close, at3.z + uz * close)) [ux, uz] = [vx, vz];
        cam.position.set(at3.x + ux * close, camY, at3.z + uz * close);
        cam.lookAt(at3.x + dx * 0.3, lookY, at3.z + dz * 0.3);
        cam.fov = 30;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        g.vfx.update(0, cam); // (billboards turned to this camera)
        const r = await lab.capture(name, crop);
        cam.position.copy(p0);
        cam.quaternion.copy(q0);
        cam.fov = fov0;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        g.vfx.update(0, cam);
        return r;
      };
      const prog = () => (f.action.kind === 'windup' && f.action.card === 'main_event' ? f.action.t / Math.max(0.05, f.action.total) : -1);
      for (const a of at) {
        if (!(await until(() => prog() >= a, 3000))) {
          out.push(`no wind-up at ${a} (action ${f.action.kind})`);
          break;
        }
        out.push(await snap(`${prefix}-w${Math.round(a * 100)}`));
      }
      await until(() => prog() < 0, 3000);
      let done = 0;
      for (const ms of after) {
        await until(() => false, ms - done);
        done = ms;
        out.push(await snap(`${prefix}-s${ms}`));
      }
      quiet = null;
      lab.release();
      return out;
    },
  };
  (window as unknown as { __fx: typeof lab }).__fx = lab;
}
