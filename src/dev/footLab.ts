// Beta 2.2 — FOOT LAB (dev builds only: `npm run dev`, then /?footlab). A close-up of every fighter's lower legs in one
// pose, frozen at an exact moment, to see how the boots meet the legs — and the same with the Beta 2.1 rigid boots
// (&fix=0) for a before / after comparison. Never part of the published build (imported only under import.meta.env.DEV).
//
//   /?footlab&state=run&t=2.37&view=side&fix=1&looks=ray,bruno,…&cols=5
//   state: idle | walk | run | strafe | back | turn | dash | stun | hit | fire | victory
//   view:  side | front | back | q (three-quarter)
import { AmbientLight, Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { defaultInput, FighterAnimator } from '../render/FighterAnimator';
import { RIG_BUILD } from '../render/FighterModel';
import { ModelCache } from '../render/ModelCache';

const ALL = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien', 'dex', 'tank', 'zoe', 'crash', 'vale', 'bot', 'ace', 'crax', 'ray_neon_runner', 'bruno_casino_boss', 'nika_stage_idol', 'vega_star_pilot', 'kai_cue_master', 'rina_dune_mirage'];

interface LabParams {
  state: string;
  t: number;
  view: string;
  fix: boolean;
  looks: string[];
  cols: number;
}

function params(): LabParams {
  const q = new URLSearchParams(location.search);
  return {
    state: q.get('state') ?? 'run',
    t: Number(q.get('t') ?? 2.4),
    view: q.get('view') ?? 'q',
    fix: q.get('fix') !== '0',
    looks: (q.get('looks') ?? ALL.join(',')).split(',').filter(Boolean),
    cols: Number(q.get('cols') ?? 7),
  };
}

export function runFootLab(host: HTMLElement): void {
  // before the first rig is built: &fix=0 shows the Beta 2.1 legs (no tucked trouser leg, rigid boots)
  RIG_BUILD.legacy21 = !params().fix;
  FighterAnimator.rigidBoots = !params().fix;
  document.body.style.background = '#14162a';
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.setScissorTest(true);
  host.innerHTML = '';
  host.style.display = 'none';
  document.getElementById('ui')?.style.setProperty('display', 'none');
  renderer.domElement.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:1';
  document.body.appendChild(renderer.domElement);
  const labels = document.createElement('div');
  labels.style.cssText = 'position:fixed;inset:0;z-index:2;pointer-events:none;font:600 11px system-ui;color:#fff;text-shadow:0 1px 2px #000';
  document.body.appendChild(labels);
  const scene = new Scene();
  scene.background = new Color(0x23263f);
  scene.add(new HemisphereLight(0xdfe6ff, 0x30304a, 1.3));
  scene.add(new AmbientLight(0xffffff, 0.25));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 3);
  scene.add(key);
  const rim = new DirectionalLight(0x88ccff, 1.0);
  rim.position.set(-3, 2, -2);
  scene.add(rim);
  const cache = new ModelCache();

  const draw = (p: LabParams) => {
    FighterAnimator.rigidBoots = !p.fix;
    const W = innerWidth;
    const H = innerHeight;
    renderer.setSize(W, H);
    const rows = Math.ceil(p.looks.length / p.cols);
    const cw = W / p.cols;
    const ch = H / rows;
    labels.innerHTML = '';
    p.looks.forEach((look, i) => {
      const c = cache.get(look, i % 2 === 0 ? 0 : 1);
      for (const ch2 of scene.children.filter((o) => o.name.startsWith('fighter-'))) scene.remove(ch2);
      scene.add(c.rig.root);
      c.anim.reset(0);
      const inp = defaultInput();
      inp.combat = true;
      const dt = 1 / 120;
      let t = 0;
      let fired = false;
      while (t < p.t) {
        const s = p.state;
        inp.vx = s === 'walk' ? 1.6 : s === 'run' ? 4.5 : s === 'back' ? 0 : 0;
        inp.vz = s === 'strafe' ? 4 : s === 'back' ? -3.4 : 0;
        if (s === 'run' || s === 'walk') inp.facing = Math.PI / 2;
        else if (s === 'turn') inp.facing = t * 2.2;
        else inp.facing = 0;
        inp.stunned = s === 'stun' && t > 0.5;
        inp.victory = s === 'victory' && t > 0.3;
        if (!fired && s === 'dash' && t >= p.t - 0.14) (c.anim.dash(0, 1), (fired = true));
        if (!fired && s === 'hit' && t >= p.t - 0.12) (c.anim.hit(0.6, -0.8, true), (fired = true));
        if (s === 'fire' && Math.floor(t / 0.4) !== Math.floor((t + dt) / 0.4)) c.anim.fire(0, false);
        inp.x += inp.vx * dt;
        inp.z += inp.vz * dt;
        c.anim.update(dt, inp);
        t += dt;
      }
      // the camera: the lower legs, from the chosen side (around the fighter's own facing)
      const root = c.rig.root;
      root.updateMatrixWorld(true);
      // frame the ankles: the middle of the two feet, a little above the floor, about a metre of picture
      const fl = new Vector3().setFromMatrixPosition(c.rig.footL.matrixWorld);
      const fr = new Vector3().setFromMatrixPosition(c.rig.footR.matrixWorld);
      const sc = root.scale.y || 1;
      const at = fl.clone().add(fr).multiplyScalar(0.5).add(new Vector3(0, 0.13 * sc, 0));
      void Box3;
      const yaw = root.rotation.y + (p.view === 'side' ? Math.PI / 2 : p.view === 'back' ? Math.PI : p.view === 'front' ? 0 : Math.PI / 4);
      const cam = new PerspectiveCamera(30, cw / ch, 0.05, 50);
      const span = (0.5 + fl.distanceTo(fr) * 0.5) * sc * Number(new URLSearchParams(location.search).get('zoom') ?? 1);
      const dist = span / (2 * Math.tan((30 * Math.PI) / 360));
      cam.position.set(at.x + Math.sin(yaw) * dist, at.y + dist * 0.1, at.z + Math.cos(yaw) * dist);
      cam.lookAt(at);
      const x = (i % p.cols) * cw;
      const y = H - (Math.floor(i / p.cols) + 1) * ch;
      renderer.setViewport(x, y, cw, ch);
      renderer.setScissor(x, y, cw, ch);
      renderer.render(scene, cam);
      const l = document.createElement('div');
      l.textContent = `${look}`;
      l.style.cssText = `position:absolute;left:${x + 6}px;top:${H - y - ch + 4}px`;
      labels.appendChild(l);
    });
    const tag = document.createElement('div');
    tag.textContent = `${p.fix ? 'Beta 2.2 — гибкий ботинок' : 'Beta 2.1 — жёсткий ботинок'} · ${p.state} · t=${p.t}s · ${p.view}`;
    tag.style.cssText = 'position:absolute;right:8px;bottom:6px;font-size:13px;background:#000a;padding:3px 8px;border-radius:6px';
    labels.appendChild(tag);
  };
  draw(params());
  (window as unknown as { __footlab: (o: Partial<LabParams>) => void }).__footlab = (o) => draw({ ...params(), ...o });
}
