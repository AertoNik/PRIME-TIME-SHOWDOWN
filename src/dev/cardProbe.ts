// Beta 2.6.2 — CARD PROBE (dev only: imported from the page by the measuring session, never by the game, so it is not in
// the production bundle). The battle hand measured the same way before and after a change, in the browser pane even
// when it is hidden (no requestAnimationFrame): the game's own frame is driven with a fixed step (perfProbe).
//   tap      one card tap: the pointerdown handler (play + hand DOM), the style + layout it leaves for the next frame
//            (forced right after, timed), the next game frame (events → VFX, HUD, audio + render, gl.finish)
//   reflows  forced synchronous layouts (offsetWidth/Height, getBoundingClientRect reads after a DOM write)
//   anims    CSS animations running in the hand, and which of them animate a property the compositor cannot run
//            (box-shadow, filter …: repainted on the main thread every frame, next to the WebGL frame)
//   burst    rapid taps across the hand with no frame between: what played, what was refused and why, and the DOM after
// Usage: const p = await import('/src/dev/cardProbe.ts'); p.start(window.__game, 'ace'); p.tapSeries(window.__game, 30)
import { measure } from './perfProbe';

/* eslint-disable @typescript-eslint/no-explicit-any */
type G = any;

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const q = (a: number[], p: number) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return r3(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
};
const stats = (a: number[]) => ({ p50: q(a, 0.5), p95: q(a, 0.95), max: r3(Math.max(0, ...a)), mean: r3(a.reduce((s, x) => s + x, 0) / Math.max(1, a.length)) });

/** Game.frame without its own render (a visible page renders inside it — the probe draws exactly once, itself). */
function step(g: G, dt = 1 / 60): void {
  const own = g.renderer.render;
  g.renderer.render = () => {};
  try {
    g.frame(dt, performance.now() / 1000);
  } finally {
    g.renderer.render = own;
  }
}

/** The last launch's own cost (ms): the match, the stage, BattleView + HUD setup (and the 2.6.2 warm-up). */
export let lastLaunchMs = 0;

/** A classic match with this fighter (and deck), stepped to the fight. */
export function start(g: G, fighter = 'ray', deck?: string[], rival = 'dex', difficulty = 'pro'): string {
  const d = deck ?? g.save.data.fighters[fighter].deck.slice();
  const a = performance.now();
  g.launch({ fighter, deck: d, rival, difficulty }, { kind: 'classic' });
  lastLaunchMs = Math.round(performance.now() - a);
  for (let i = 0; i < 4000 && g.match?.phase !== 'fight'; i++) step(g);
  return `${fighter} · ${d.join(',')} · ${g.match?.phase}`;
}

/** One game frame with its render, waited for on the GPU (ms). */
function frame(g: G, dt = 1 / 60): number {
  const a = performance.now();
  step(g, dt);
  g.renderer.render(dt);
  (g.renderer.renderer.getContext() as WebGL2RenderingContext).finish();
  return performance.now() - a;
}

// ---------------------------------------------------------------- forced layouts
let counting = false;
let reflows = 0;
let installed = false;
function installCounters(): void {
  if (installed) return;
  installed = true;
  for (const prop of ['offsetWidth', 'offsetHeight', 'offsetTop', 'offsetLeft']) {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)!;
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        if (counting) reflows++;
        return d.get!.call(this);
      },
    });
  }
  const gbr = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (counting) reflows++;
    return gbr.call(this);
  };
}
/** Layout reads made by `fn` (each after a DOM write forces a synchronous style + layout). */
export function countReflows(fn: () => void): number {
  installCounters();
  reflows = 0;
  counting = true;
  try {
    fn();
  } finally {
    counting = false;
  }
  return reflows;
}

// ---------------------------------------------------------------- one tap
/** Taps slot `i` the way a finger does (pointerdown on the slot). Energy is topped up and the guards reset first. */
export function tap(g: G, i: number, fill = true): { handler: number; style: number; frame: number; res: string; reflows: number; programs: number } {
  const m = g.match;
  const hud = g.hud;
  const h = m.hands[0];
  if (fill) {
    h.energy = 10;
    h.lockout = 0;
    hud.lastPlayAt = [-1e9, -1e9, -1e9];
  }
  const before = h.hand.slice();
  const prog0 = g.renderer.renderer.info.programs?.length ?? 0;
  let handler = 0;
  const rf = countReflows(() => {
    const a = performance.now();
    hud.slots[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    handler = performance.now() - a;
  });
  const b = performance.now();
  void document.body.offsetHeight; // the style + layout the tap left for the next frame
  const style = performance.now() - b;
  const fr = frame(g);
  const played = h.hand.join() !== before.join();
  return { handler: r3(handler), style: r3(style), frame: r3(fr), res: played ? `played ${before[i]}` : 'refused', reflows: rf, programs: (g.renderer.renderer.info.programs?.length ?? 0) - prog0 };
}

/**
 * `n` taps across the hand, `gap` frames apart (what a player does in a fight): every number per tap and the totals.
 * The first play of each card is reported apart (a first effect may compile shaders — a one-off spike).
 */
export function tapSeries(g: G, n = 30, gap = 24): any {
  const handler: number[] = [];
  const style: number[] = [];
  const fr: number[] = [];
  const firsts: Record<string, number> = {};
  const seen = new Set<string>();
  let rf = 0;
  let refused = 0;
  let progs = 0;
  for (let k = 0; k < n && g.match?.phase === 'fight'; k++) {
    const card = g.match.hands[0].hand[k % 3];
    const t = tap(g, k % 3);
    if (t.res === 'refused') refused++;
    rf += t.reflows;
    progs += t.programs;
    if (!seen.has(card)) {
      seen.add(card);
      firsts[card] = t.frame;
    } else {
      handler.push(t.handler);
      style.push(t.style);
      fr.push(t.frame);
    }
    for (let j = 0; j < gap && g.match?.phase === 'fight'; j++) frame(g);
  }
  return { taps: n, refused, reflowsPerTap: r3(rf / n), newPrograms: progs, handler: stats(handler), style: stats(style), frameAfterTap: stats(fr), firstPlayFrame: firsts };
}

/** The HUD update alone, `frames` frames (JS only: Game.frame without the render). */
export function hudUpdate(g: G, frames = 300): any {
  const hud = g.hud;
  const own = hud.update.bind(hud);
  const t: number[] = [];
  let rf = 0;
  hud.update = (dt: number) => {
    const a = performance.now();
    rf += countReflows(() => own(dt));
    t.push(performance.now() - a);
  };
  try {
    for (let i = 0; i < frames && g.match?.phase === 'fight'; i++) {
      // keep cards flipping between affordable / not (the real rhythm of a fight)
      if (i % 40 === 0) g.match.hands[0].energy = 0.5;
      step(g);
    }
  } finally {
    hud.update = own;
  }
  return { frames: t.length, ms: stats(t), reflows: rf };
}

/** CSS animations running in the battle hand, and the ones the compositor cannot run (repainted every frame). */
export function anims(g: G): any {
  const root = g.hud.el.querySelector('.hud-bottom');
  const list = document.getAnimations().filter((a: any) => a.effect?.target && root.contains(a.effect.target));
  const main = new Set(['box-shadow', 'boxShadow', 'filter', 'background', 'background-color', 'backgroundColor', 'background-position', 'backgroundPosition', 'width', 'height', 'top', 'left', 'color']);
  const out = list.map((a: any) => {
    const kf = a.effect.getKeyframes();
    const props = [...new Set(kf.flatMap((k: any) => Object.keys(k).filter((x) => !['offset', 'easing', 'composite', 'computedOffset'].includes(x))))] as string[];
    const t = a.effect.target as HTMLElement;
    return { name: a.animationName ?? a.id ?? 'waapi', on: `${t.tagName.toLowerCase()}.${[...t.classList].slice(0, 4).join('.')}`, props, mainThread: props.some((p) => main.has(p)), infinite: a.effect.getTiming().iterations === Infinity };
  });
  return { running: out.length, mainThread: out.filter((x: any) => x.mainThread).length, list: out };
}

/** Puts a combo in reach: plays the opener of a pair in hand (if any), so the second card glows («combo-ready»). */
export function primeCombo(g: G): string | null {
  const m = g.match;
  const h = m.hands[0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (i === j) continue;
      h.energy = 10;
      h.lockout = 0;
      const a = h.hand[i];
      const b = h.hand[j];
      if (!a || !b) continue;
      const cards = (window as any).__cards;
      if (cards && !cards.comboFor(a, b)) continue;
      g.hud.lastPlayAt = [-1e9, -1e9, -1e9];
      const t = tap(g, i);
      if (t.res !== 'refused') {
        for (let k = 0; k < 2; k++) frame(g);
        return `${a} → ${b}`;
      }
    }
  }
  return null;
}

/**
 * Rapid taps with no frame between (a finger drumming the hand): every slot `rounds` times; what the game took, what it
 * refused (the rules: 0.3 s lockout, energy, the 280 ms same-slot guard), and whether the hand's DOM stayed whole.
 */
export async function burst(g: G, rounds = 4): Promise<any> {
  const m = g.match;
  const hud = g.hud;
  const log: string[] = [];
  for (let r = 0; r < rounds; r++) {
    m.hands[0].energy = 10;
    m.hands[0].lockout = 0;
    for (const i of [0, 1, 2, 0]) {
      const before = m.hands[0].hand.join();
      hud.slots[i].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
      log.push(m.hands[0].hand.join() !== before ? 'P' : '.');
    }
    for (let j = 0; j < 30; j++) frame(g);
    await new Promise((x) => setTimeout(x, 400));
  }
  await new Promise((x) => setTimeout(x, 600));
  return { ...handDom(g), pattern: log.join('') };
}

/** The hand's DOM against the game's hand: one live card per slot, the right card, no ghost left behind. */
export function handDom(g: G): any {
  const hud = g.hud;
  const hand = g.match.hands[0].hand;
  const slots = hud.slots.map((s: HTMLElement, i: number) => {
    const live = s.querySelectorAll('.hand-card:not(.played)');
    const ghosts = s.querySelectorAll('.hand-card.played').length;
    const id = (live[0] as HTMLElement | undefined)?.dataset?.card ?? (live[0] as HTMLElement | undefined)?.getAttribute('data-id') ?? null;
    return { live: live.length, ghosts, tips: s.querySelectorAll('.deny-tip').length, card: hand[i], dom: id };
  });
  return { slots, ok: slots.every((s: any) => s.live === (s.card ? 1 : 0) && s.ghosts === 0) };
}

/** The whole fight frame (game + render) for `frames` frames with the bot-like rhythm of taps every `every` frames. */
export function fightFrames(g: G, frames = 600, every = 45): any {
  const ms: number[] = [];
  for (let i = 0; i < frames && g.match?.phase === 'fight'; i++) {
    if (i % every === 0) {
      const h = g.match.hands[0];
      h.energy = 10;
      h.lockout = 0;
      g.hud.lastPlayAt = [-1e9, -1e9, -1e9];
      g.hud.slots[i % 3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true }));
    }
    ms.push(frame(g));
  }
  return { frames: ms.length, ms: stats(ms), over16: ms.filter((x) => x > 16.7).length };
}

export { measure };

/** Forced layouts of a refused tap (the card shakes) and of a card turning affordable (the ready pulse). */
export function reflowCases(g: G): any {
  const m = g.match;
  const h = m.hands[0];
  const hud = g.hud;
  // refused: no energy
  h.energy = 0;
  h.lockout = 0;
  hud.lastPlayAt = [-1e9, -1e9, -1e9];
  const refused = countReflows(() => hud.slots[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1 })));
  // affordable: from 0 to full in one frame (all three cards turn ready)
  h.energy = 0;
  step(g);
  h.energy = 10;
  let ready = 0;
  const own = hud.update.bind(hud);
  hud.update = (dt: number) => {
    ready += countReflows(() => own(dt));
  };
  try {
    step(g);
  } finally {
    hud.update = own;
  }
  return { refusedTap: refused, threeCardsReady: ready };
}

/** CSS transitions the hand creates over `frames` frames while the energy refills (the drain curtains). */
export function transitions(g: G, frames = 60): any {
  const m = g.match;
  const root = g.hud.el.querySelector('.hud-bottom');
  m.hands[0].energy = 0;
  const seen = new Set<Animation>();
  for (let i = 0; i < frames && m.phase === 'fight'; i++) {
    step(g);
    for (const a of document.getAnimations()) if ((a as any).transitionProperty && root.contains((a.effect as KeyframeEffect)?.target as Node)) seen.add(a);
  }
  return { frames, created: seen.size };
}

/** All the per-match numbers in one go (the same protocol before and after). */
export async function baseline(g: G, fighter = 'ray', deck = ['dash', 'power_shot', 'shield', 'adrenaline']): Promise<any> {
  const heap = () => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576);
  const t0 = performance.now();
  start(g, fighter, deck);
  const setup = Math.round(performance.now() - t0);
  for (let j = 0; j < 10; j++) frame(g);
  const nodes0 = g.hud.el.querySelectorAll('*').length;
  const h0 = heap();
  const series = tapSeries(g, 30, 20);
  await new Promise((x) => setTimeout(x, 700));
  for (let j = 0; j < 5; j++) frame(g);
  const nodes1 = g.hud.el.querySelectorAll('*').length;
  const hud = hudUpdate(g, 240);
  const rf = reflowCases(g);
  const tr = transitions(g, 60);
  for (let j = 0; j < 30; j++) frame(g);
  primeCombo(g);
  for (let j = 0; j < 3; j++) frame(g);
  g.match.hands[0].energy = 10;
  frame(g);
  const an = anims(g);
  const bu = await burst(g, 3);
  return { setup, series, hud, reflows: rf, drainTransitions: tr, anims: { running: an.running, mainThread: an.mainThread, main: an.list.filter((a: any) => a.mainThread).map((a: any) => `${a.name}[${a.props}]`) }, burst: bu, hudNodes: [nodes0, nodes1], heapMB: [h0, heap()] };
}

/** The first play of every card of seven decks (33 cards), on a fresh page: frame, programs and textures compiled in the fight. */
export function firstUse(g: G): any {
  const R = g.renderer.renderer;
  const info = () => ({ p: R.info.programs?.length ?? 0, t: R.info.memory.textures });
  const decks: [string, string[]][] = [
    ['ray', ['dash', 'power_shot', 'shield', 'adrenaline']],
    ['nika', ['shock', 'system_overload', 'gravity_net', 'pressure_mine']],
    ['rina', ['false_start', 'stage_barrier', 'holo_decoy', 'frame_catch']],
    ['kai', ['bank_shot', 'split_shot', 'rebound_disc', 'prop_drop']],
    ['bruno', ['knockout', 'pulse_push', 'cable_snare', 'backtrack']],
    ['lucien', ['bat_bite', 'high_stakes', 'second_take', 'freeze_frame']],
    ['ace', ['main_event', 'showtime', 'magnet_pull', 'safe_cut']],
    ['vega', ['charged_shot', 'smoke', 'spotlight_tag', 'overdrive']],
    ['crax', ['twelfth_strike', 'dash', 'shield', 'power_shot']],
  ];
  const rows: [string, number, number, number][] = [];
  const launches: number[] = [];
  const warms: any[] = [];
  for (const [fighter, deck] of decks) {
    start(g, fighter, deck);
    launches.push(lastLaunchMs);
    warms.push(g.battleView.lastWarm ? `${g.battleView.lastWarm.programs}p/${g.battleView.lastWarm.ms}ms` : '—');
    const seen = new Set<string>();
    // every card of the deck once: tap the slot holding a card not played yet
    for (let k = 0; k < 8 && seen.size < deck.length && g.match?.phase === 'fight'; k++) {
      const hand = g.match.hands[0].hand as string[];
      const i = hand.findIndex((c) => !seen.has(c));
      if (i < 0) {
        tap(g, 0);
        for (let j = 0; j < 20; j++) step(g);
        continue;
      }
      seen.add(hand[i]);
      const a = info();
      const t = tap(g, i);
      const b = info();
      rows.push([hand[i] ?? t.res, Math.round(t.frame), b.p - a.p, b.t - a.t]);
      for (let j = 0; j < 20; j++) step(g);
    }
  }
  const ms = rows.map((r) => r[1]);
  return {
    plays: rows.length,
    over50: ms.filter((x) => x > 50).length,
    over100: ms.filter((x) => x > 100).length,
    max: Math.max(...ms),
    sum: ms.reduce((s, x) => s + x, 0),
    programsInFight: rows.reduce((s, r) => s + r[2], 0),
    texturesInFight: rows.reduce((s, r) => s + r[3], 0),
    launches,
    warms,
    slow: rows.filter((r) => r[1] > 30 || r[2] || r[3]).map((r) => `${r[0]} ${r[1]}ms +${r[2]}p +${r[3]}t`),
  };
}
