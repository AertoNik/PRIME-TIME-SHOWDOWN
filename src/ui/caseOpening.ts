import { AdditiveBlending, AmbientLight, BufferGeometry, CanvasTexture, Color, DirectionalLight, Float32BufferAttribute, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Points, PointsMaterial, Scene } from 'three';
import { CASE_DEFS, CASE_RARITY_LABEL } from '../config/cases.config';
import { COSMETICS, type CosmeticId } from '../config/cosmetics.config';
import type { CaseKind, CaseRecord } from '../net/PrimeApi';
import type { CaseOutcome } from '../net/SyncManager';
import { buildCase, type CaseModel } from '../render/caseModels';
import { releaseCaseRenderer, takeCaseRenderer } from '../render/caseRenderer';
import { currencyArt } from './currencyArt';
import { esc } from './dom';
import { cosmeticPic } from './effectArt';

// Beta 2.4 — OPENING A REWARD CASE: a short show over the game. The case drops in and floats; the player taps it — it
// jumps and shakes, each tap charges its glow (three taps), then a flash: the lid flies open, light and sparks pour out
// and the reward rises from the case with its name, rarity and exact amount. «Дальше» goes on to the next
// case of that kind.
//
// THE RESULT IS THE SERVER'S. The open request leaves on the FIRST tap (SyncManager.openCase: the server draws, writes
// the reward into the cloud save / the token ledger and marks the case in one transaction); the taps only build the
// moment. More taps, a closed tab or a lost connection never give a second reward: a request without an answer is asked
// again with the same id (the same result) when the game is back online.
//
// Calm show (the system's «reduce motion» or the game's «без тряски»): no jumps, shakes or sparks — the case simply opens
// and the reward appears. «Пропустить» (after the first case): straight to the reward.

const reduced = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.motion === 'off';
const SEEN_KEY = 'pt_cases_seen_v1';
const seenBefore = (): boolean => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};
const markSeen = (): void => {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* private mode: the skip button just waits for the next time */
  }
};

export interface CaseShowOptions {
  kind: CaseKind;
  /** Opens one case on the server (SyncManager.openCase). */
  open: () => Promise<CaseOutcome>;
  /** How many cases of this kind still wait after the one just opened (for «Дальше»). */
  left: () => number;
  /** Closed (after a result or a cancel) — the caller refreshes its view. */
  onClose?: (opened: number) => void;
}

const RARITY_COLOR: Record<string, number> = { common: 0x3ff0d8, rare: 0x5aa2ff, epic: 0xc06bff, legendary: 0xffc84a };
const TAPS = 3;

/** The reward as the card shows it. */
function rewardHTML(r: CaseRecord): string {
  const res = r.result;
  if (!res) return '';
  const rarity = res.rarity;
  let pic = '';
  let big = '';
  let small = '';
  if (res.kind === 'money') {
    pic = currencyArt('money', 72, 'case-cur');
    big = `+${res.amount.toLocaleString('ru-RU')} $`;
    small = 'Карьерные доллары — уже на счету';
  } else if (res.kind === 'rep') {
    pic = currencyArt('rep', 72, 'case-cur');
    big = `+${res.amount} репутации`;
    small = 'Опыт продюсера — ближе к новому уровню';
  } else if (res.kind === 'tokens') {
    pic = currencyArt('tokens', 72, 'case-cur');
    big = `+${res.amount} PRIME TOKENS`;
    small = 'На балансе PRIME LEAGUE';
  } else if (res.kind === 'item' && res.item && res.item in COSMETICS) {
    const id = res.item as CosmeticId;
    pic = `<span class="case-item-pic">${cosmeticPic(id, 110)}</span>`;
    big = esc(COSMETICS[id].name);
    small = 'Эксклюзивный эффект рывка — уже в «Моей коллекции»';
  }
  return `<div class="case-reward rar-${rarity}" role="status" aria-live="polite">
      <div class="cr-rarity">${esc(CASE_RARITY_LABEL[rarity])} · ${esc(res.label)}</div>
      <div class="cr-pic">${pic}</div>
      <div class="cr-big">${big}</div>
      <div class="cr-small">${esc(small)}</div>
    </div>`;
}

function errorText(code: string): string {
  switch (code) {
    case 'offline':
      return 'Связь прервалась. Награда уже закреплена за вами на сервере — она появится, как только связь вернётся.';
    case 'no_case':
      return 'Кейсов этого вида больше нет.';
    case 'conflict':
      return 'Сохранение только что обновилось. Попробуйте открыть ещё раз.';
    case 'session':
      return 'Игра открыта на другом устройстве — откройте кейс там или вернитесь сюда.';
    case 'no_cloud_save':
      return 'Сначала нужно сохранение в PRIME CLOUD — сыграйте бой и попробуйте снова.';
    case 'disabled':
      return 'Кейсы сейчас выключены на сервере.';
    default:
      return 'Не удалось открыть кейс. Попробуйте ещё раз чуть позже.';
  }
}

/** A soft round sprite for the sparks and the halo (drawn once, no image files). */
function glowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  return t;
}

const SPARKS = 140;

/**
 * The show's stage, kept for the page: the scene, its lights, the halo, the sparks and one model of each case — made on
 * the first show and reused by every later one (and by «Дальше»). Nothing is rebuilt or recompiled per show, nothing
 * grows: two models, one halo, one spark cloud. Each frame sets every value it draws, so a reused model carries nothing
 * over from the show before.
 */
interface Stage {
  scene: Scene;
  camera: PerspectiveCamera;
  halo: Mesh;
  haloMat: MeshBasicMaterial;
  pgeo: BufferGeometry;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  col: Float32Array;
  models: Partial<Record<CaseKind, CaseModel>>;
  /** The kinds whose shaders are compiled in the cases' renderer (the first show of a kind compiles before it starts). */
  compiled: Set<CaseKind>;
}
let stage: Stage | null = null;

function stageOf(): Stage {
  if (stage) return stage;
  const scene = new Scene();
  const camera = new PerspectiveCamera(34, 1, 0.1, 50);
  camera.position.set(0, 0.55, 4.2);
  camera.lookAt(0, 0.05, 0);
  scene.add(new AmbientLight(0xb8c8ff, 1.1));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(1.6, 2.8, 2.4);
  scene.add(key);
  const fill = new DirectionalLight(0x6fa8ff, 0.9);
  fill.position.set(-2.2, 0.6, 1.2);
  scene.add(fill);
  const tex = glowTexture();
  // the halo behind the case
  const haloMat = new MeshBasicMaterial({ map: tex, color: new Color(0x3ff0d8), transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const halo = new Mesh(new PlaneGeometry(2.7, 2.7), haloMat);
  halo.position.set(0, 0.05, -1.2);
  scene.add(halo);
  // sparks
  const pos = new Float32Array(SPARKS * 3);
  const vel = new Float32Array(SPARKS * 3);
  const life = new Float32Array(SPARKS);
  const col = new Float32Array(SPARKS * 3);
  const pgeo = new BufferGeometry();
  pgeo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  pgeo.setAttribute('color', new Float32BufferAttribute(col, 3));
  const pmat = new PointsMaterial({ size: 0.09, map: tex, vertexColors: true, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
  const points = new Points(pgeo, pmat);
  points.frustumCulled = false;
  scene.add(points);
  stage = { scene, camera, halo, haloMat, pgeo, pos, vel, life, col, models: {}, compiled: new Set() };
  return stage;
}

/** The stage's model of this kind (built once), the only case in the scene. */
function modelOf(st: Stage, kind: CaseKind): CaseModel {
  for (const k of Object.keys(st.models) as CaseKind[]) if (k !== kind) st.scene.remove(st.models[k]!.root);
  const m = (st.models[kind] ??= buildCase(kind));
  st.scene.add(m.root);
  return m;
}

export function playCaseShow(o: CaseShowOptions): void {
  const host = document.getElementById('frame') ?? document.body;
  const calm = reduced();
  const def = CASE_DEFS[o.kind];
  const wrap = document.createElement('div');
  wrap.className = `case-show kind-${o.kind}${calm ? ' calm' : ''}`;
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', def.name);
  wrap.innerHTML = `
    <div class="cs-title"><b>${esc(def.name)}</b><span>${esc(def.tagline)}</span></div>
    <div class="cs-stage" data-cs-stage></div>
    <div class="cs-flash" aria-hidden="true"></div>
    <div class="cs-hint" data-cs-hint>${calm ? 'Коснитесь, чтобы открыть' : 'Коснитесь кейса'}</div>
    <div class="cs-pips" aria-hidden="true">${'<i></i>'.repeat(TAPS)}</div>
    <div class="cs-result" data-cs-result></div>
    <div class="cs-actions">
      <button class="btn ghost cs-skip" data-cs-skip ${seenBefore() && !calm ? '' : 'hidden'}>Пропустить</button>
      <button class="btn ghost cs-close" data-cs-close>Закрыть</button>
    </div>`;
  host.appendChild(wrap);
  const stageEl = wrap.querySelector('[data-cs-stage]') as HTMLElement;
  const hint = wrap.querySelector('[data-cs-hint]') as HTMLElement;
  const pips = [...wrap.querySelectorAll('.cs-pips i')] as HTMLElement[];
  const resultEl = wrap.querySelector('[data-cs-result]') as HTMLElement;
  const flash = wrap.querySelector('.cs-flash') as HTMLElement;
  const skipBtn = wrap.querySelector('[data-cs-skip]') as HTMLButtonElement;
  const closeBtn = wrap.querySelector('[data-cs-close]') as HTMLButtonElement;

  // ------------------------------------------------------------ the little scene
  // the cases' one shared renderer (render/caseRenderer.ts): taken for the show, given back on close — never thrown away.
  // No WebGL right now: a drawn case stands in; the taps, the server's result and the reward card work all the same.
  const token = {};
  const renderer = takeCaseRenderer(token);
  let canvas: HTMLElement;
  if (renderer) {
    canvas = renderer.domElement;
    canvas.className = 'cs-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  } else {
    canvas = document.createElement('div');
    canvas.className = 'cs-canvas cs-flat';
    canvas.innerHTML = `<span class="case-img case-img-fb kind-${o.kind}" aria-hidden="true"></span>`;
  }
  stageEl.replaceWith(canvas);
  const st = stageOf();
  const { scene, camera, halo, haloMat, pgeo, pos, vel, life, col } = st;
  const model: CaseModel = modelOf(st, o.kind);
  haloMat.color.set(o.kind === 'invite' ? 0x3ff0d8 : 0x7ff6ff);
  // sparks: none left from the show before; the calm show makes none
  const N = calm ? 0 : SPARKS;
  life.fill(0);
  for (let k = 0; k < SPARKS; k++) pos[k * 3 + 1] = -99;
  const sparkCol = new Color();
  let next = 0;
  const spawn = (n: number, speed: number, color: number, y = 0.1) => {
    if (!N) return;
    sparkCol.set(color);
    for (let i = 0; i < n; i++) {
      const k = next++ % N;
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random() * 0.9;
      pos[k * 3] = (Math.random() - 0.5) * 0.4;
      pos[k * 3 + 1] = y + Math.random() * 0.2;
      pos[k * 3 + 2] = (Math.random() - 0.5) * 0.3;
      vel[k * 3] = Math.cos(a) * speed * (0.5 + Math.random());
      vel[k * 3 + 1] = up * speed * 1.4;
      vel[k * 3 + 2] = Math.sin(a) * speed * 0.6;
      life[k] = 0.7 + Math.random() * 0.8;
      col[k * 3] = sparkCol.r;
      col[k * 3 + 1] = sparkCol.g;
      col[k * 3 + 2] = sparkCol.b;
    }
  };
  // the first show of a kind compiles its shaders before the case drops in (in parallel where the browser can) — the
  // drop is smooth, not a frozen first frame; later shows find them ready
  let ready = !renderer || st.compiled.has(o.kind);
  if (!ready && renderer) {
    const go = () => {
      if (ready) return;
      ready = true;
      st.compiled.add(o.kind);
      last = performance.now();
      pt = 0;
    };
    renderer.compileAsync(scene, camera).then(go, go);
    window.setTimeout(go, 1500);
  }

  const resize = () => {
    const r = wrap.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height * 0.62));
    renderer?.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / h;
    // a narrow phone sees the whole case
    camera.position.z = camera.aspect < 0.75 ? 5.4 : 4.2;
    camera.updateProjectionMatrix();
  };
  resize();
  const onResize = () => resize();
  window.addEventListener('resize', onResize);

  // ------------------------------------------------------------ the show's state
  type Phase = 'appear' | 'idle' | 'charge' | 'burst' | 'result' | 'error';
  let phase: Phase = 'appear';
  let pt = 0;
  let taps = 0;
  let jump = 0;
  let jumpV = 0;
  let shake = 0;
  let charge = 0;
  let lid = 0;
  let opened = 0;
  let pending: Promise<CaseOutcome> | null = null;
  let outcome: CaseOutcome | null = null;
  let alive = true;
  let raf = 0;
  let last = performance.now();

  const start = () => {
    if (pending) return;
    pending = o.open().then((r) => (outcome = r));
    pending.catch(() => (outcome = { ok: false, code: 'refused', status: null }));
  };
  const setPips = () => pips.forEach((p, i) => p.classList.toggle('on', i < taps));
  const tap = () => {
    if (!alive) return;
    if (phase === 'appear' || phase === 'idle' || phase === 'charge') {
      start();
      if (calm) {
        taps = TAPS;
        phase = 'charge';
        pt = 0;
        return;
      }
      if (taps < TAPS) {
        taps++;
        setPips();
        jumpV = 2.6 + taps * 0.5;
        shake = 0.5 + taps * 0.25;
        charge = taps / TAPS;
        spawn(8 + taps * 6, 1.3 + taps * 0.4, o.kind === 'invite' ? 0x3ff0d8 : 0x7ff6ff);
        if (navigator.vibrate) navigator.vibrate(12 + taps * 8);
        hint.textContent = taps < TAPS ? `Ещё ${TAPS - taps}…` : 'Открываем…';
      }
      if (taps >= TAPS) {
        phase = 'charge';
        pt = 0;
      }
    }
  };
  canvas.addEventListener('pointerdown', tap);
  hint.addEventListener('click', tap);
  skipBtn.addEventListener('click', () => {
    start();
    taps = TAPS;
    setPips();
    phase = 'charge';
    pt = 0.6;
    skipBtn.hidden = true;
  });

  const showResult = () => {
    const r = outcome;
    if (!r) return;
    if (!r.ok) {
      phase = 'error';
      hint.textContent = '';
      resultEl.innerHTML = `<div class="case-reward err"><div class="cr-big">${r.code === 'offline' ? 'Нет связи' : 'Кейс не открыт'}</div><div class="cr-small">${esc(errorText(r.code))}</div></div>
        <div class="cs-next"><button class="btn teal" data-cs-done>Закрыть</button></div>`;
      wrap.classList.add('has-result');
      resultEl.querySelector('[data-cs-done]')?.addEventListener('click', close);
      return;
    }
    opened++;
    markSeen();
    phase = 'burst';
    pt = 0;
    const rar = r.case.result?.rarity ?? 'common';
    hint.textContent = '';
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    spawn(calm ? 0 : 90, 2.6, RARITY_COLOR[rar] ?? 0x3ff0d8, 0.2);
    spawn(calm ? 0 : 40, 1.8, 0xffffff, 0.2);
    haloMat.color.set(RARITY_COLOR[rar] ?? 0x3ff0d8);
    window.setTimeout(
      () => {
        if (!alive) return;
        phase = 'result';
        const more = o.left();
        resultEl.innerHTML = `${rewardHTML(r.case)}
          <div class="cs-next">${more > 0 ? `<button class="btn teal" data-cs-next>Дальше · ${more}</button>` : ''}<button class="btn ${more > 0 ? 'ghost' : 'teal'}" data-cs-done>Готово</button></div>`;
        wrap.classList.add('has-result');
        resultEl.querySelector('[data-cs-done]')?.addEventListener('click', close);
        resultEl.querySelector('[data-cs-next]')?.addEventListener('click', again);
      },
      calm ? 150 : 520,
    );
  };

  /** The next case of this kind: a fresh case drops in. */
  const again = () => {
    wrap.classList.remove('has-result');
    resultEl.innerHTML = '';
    // the same model drops in again (every frame sets its lid, glow and light — nothing to rebuild)
    phase = 'appear';
    pt = 0;
    taps = 0;
    charge = 0;
    lid = 0;
    jump = 0;
    jumpV = 0;
    shake = 0;
    pending = null;
    outcome = null;
    setPips();
    haloMat.color.set(o.kind === 'invite' ? 0x3ff0d8 : 0x7ff6ff);
    hint.textContent = calm ? 'Коснитесь, чтобы открыть' : 'Коснитесь кейса';
    skipBtn.hidden = calm;
  };

  const close = () => {
    if (!alive) return;
    // an open still on its way is not cancelled — its result is kept by the server and comes back to this device
    alive = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    // the stage (scene, models, halo, sparks) stays for the next show — kept, not rebuilt; nothing here grows
    canvas.removeEventListener('pointerdown', tap);
    // the shared renderer goes back (parked, 1×1) — the context stays for the next show; nothing is lost on purpose
    releaseCaseRenderer(token);
    wrap.remove();
    o.onClose?.(opened);
  };
  closeBtn.addEventListener('click', close);

  // ------------------------------------------------------------ the loop
  const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
  const back = (x: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const t = Math.min(1, Math.max(0, x));
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  };
  const frame = (now: number) => {
    if (!alive) return;
    if (!ready) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    pt += dt;
    const t = now / 1000;
    const root = model.root;
    // appear: drops in with a bounce
    const app = phase === 'appear' ? back(pt / 0.7) : 1;
    if (phase === 'appear' && pt >= 0.7) {
      phase = taps >= TAPS ? 'charge' : 'idle';
      pt = 0;
    }
    // a tap's jump (a small ballistic hop) and shake
    jumpV -= 14 * dt;
    jump = Math.max(0, jump + jumpV * dt);
    if (jump === 0 && jumpV < 0) jumpV = 0;
    shake = Math.max(0, shake - dt * 2.4);
    // charging: the result is on its way — the case trembles harder until it comes (or at least 0.5 s)
    if (phase === 'charge') {
      charge = Math.min(1.4, charge + dt * 0.8);
      shake = Math.max(shake, calm ? 0 : 0.35 + Math.min(0.6, pt));
      if (outcome && pt > (calm ? 0.05 : 0.5)) showResult();
    }
    if (phase === 'burst' || phase === 'result') lid = Math.min(1, lid + dt * (calm ? 4 : 2.6));
    const s = calm ? 1 : app;
    root.scale.setScalar(Math.max(0.001, s));
    const float = calm ? 0 : Math.sin(t * 1.6) * 0.04;
    root.position.y = (phase === 'appear' && !calm ? (1 - ease(pt / 0.7)) * 0.9 : 0) + jump * 0.12 + float;
    const shk = calm ? 0 : shake * 0.06;
    root.position.x = Math.sin(t * 47) * shk;
    root.rotation.z = Math.sin(t * 39) * shk * 0.9;
    root.rotation.y = (calm ? -0.35 : -0.35 + Math.sin(t * 0.7) * 0.18) + (phase === 'burst' || phase === 'result' ? lid * 0.25 : 0);
    root.rotation.x = 0.12;
    model.lid.rotation.x = -back(lid) * 1.75;
    const glow = 0.85 + charge * 0.9 + (phase === 'charge' && !calm ? Math.sin(t * 18) * 0.25 : 0) + (lid > 0 ? 0.8 : 0);
    model.setGlow(glow);
    const innerMat = model.inner.material as MeshBasicMaterial;
    innerMat.opacity = Math.min(0.95, lid * 1.2);
    model.inner.scale.set(1, 1 + lid * 6, 1);
    haloMat.opacity = 0.18 + charge * 0.25 + lid * 0.45 + (calm ? 0 : Math.sin(t * 2) * 0.04);
    halo.scale.setScalar(1 + lid * 0.35 + charge * 0.12);
    // sparks
    if (N) {
      for (let k = 0; k < N; k++) {
        if (life[k] <= 0) {
          pos[k * 3 + 1] = -99;
          continue;
        }
        life[k] -= dt;
        vel[k * 3 + 1] -= 3.2 * dt;
        pos[k * 3] += vel[k * 3] * dt;
        pos[k * 3 + 1] += vel[k * 3 + 1] * dt;
        pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      }
      // the open case keeps breathing a few sparks
      if ((phase === 'result' || phase === 'burst') && Math.random() < dt * 14) spawn(1, 0.8, 0xfff3c4, 0.25);
      (pgeo.getAttribute('position') as Float32BufferAttribute).needsUpdate = true;
      (pgeo.getAttribute('color') as Float32BufferAttribute).needsUpdate = true;
    }
    renderer?.render(scene, camera);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
}
