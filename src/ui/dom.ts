import { CARDS } from '../config/cards';
import type { CardId } from '../config/types';
import { CARD_ICONS } from './icons';

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export function $(root: ParentNode, sel: string): HTMLElement {
  const e = root.querySelector(sel);
  if (!e) throw new Error('UI element not found: ' + sel);
  return e as HTMLElement;
}

export function cardHTML(id: CardId, extra = '', withTag = true): string {
  const c = CARDS[id];
  return `<div class="card ${c.exclusive ? 'exclusive' : ''} ${c.name.length > 8 ? 'long' : ''} ${extra}" data-card="${id}" style="--c1:${c.color};--c2:${c.color2}">
    <div class="art"><div class="ic">${CARD_ICONS[id]}</div>${withTag ? `<div class="tag">${esc(c.role)}</div>` : ''}<div class="nm">${esc(c.name)}</div></div>
    <div class="gem">${c.cost}</div>
  </div>`;
}

export function portraitHTML(url: string | undefined, main: string, dark: string, cls = ''): string {
  return `<div class="portrait ${cls}" style="--pc:${main};--pd:${dark}">${url ? `<img src="${url}" alt="" draggable="false"/>` : ''}</div>`;
}

/** Animate a number in an element from `from` to `to`. */
export function countUp(e: HTMLElement, from: number, to: number, dur: number, fmt: (n: number) => string, onTick?: () => void): void {
  const start = performance.now();
  let lastTick = 0;
  // timer-driven so it also completes when rAF is throttled
  const step = () => {
    const now = performance.now();
    const t = Math.min(1, (now - start) / (dur * 1000));
    const k = 1 - Math.pow(1 - t, 3);
    e.textContent = fmt(from + (to - from) * k);
    if (onTick && now - lastTick > 70 && t < 1) {
      lastTick = now;
      onTick();
    }
    if (t < 1) setTimeout(step, 16);
  };
  step();
}

export function vibrate(ms: number | number[]): void {
  try {
    const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
    if (ua && !ua.hasBeenActive) return;
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch {
    /* unsupported */
  }
}
