import { el } from './dom';
import { UI_ICONS } from './icons';

export interface Screen {
  readonly el: HTMLElement;
  onShow?(params?: unknown): void;
  onHide?(): void;
  update?(dt: number): void;
}

/** Owns screen switching, toasts, modals and the global sound button. */
export class UIManager {
  readonly root: HTMLElement;
  private screens = new Map<string, Screen>();
  current: string | null = null;
  private toastZone: HTMLElement;
  private modalEl: HTMLElement | null = null;
  readonly soundFab: HTMLButtonElement;
  onSoundToggle: () => void = () => {};

  constructor(root: HTMLElement) {
    this.root = root;
    this.toastZone = el('div', 'toast-zone');
    root.appendChild(this.toastZone);
    this.soundFab = el('button', 'icon-btn sound-fab') as HTMLButtonElement;
    this.soundFab.setAttribute('aria-label', 'Звук');
    this.soundFab.addEventListener('click', () => this.onSoundToggle());
    root.appendChild(this.soundFab);
    const rotate = el('div', 'rotate-note', '<div>ПОВЕРНИТЕ ТЕЛЕФОН ВЕРТИКАЛЬНО</div><div class="muted" style="font-size:11px">Игра создана для портретного режима</div>');
    document.body.appendChild(rotate);
  }

  setSoundIcon(on: boolean): void {
    this.soundFab.innerHTML = on ? UI_ICONS.soundOn : UI_ICONS.soundOff;
  }

  showSoundFab(show: boolean): void {
    this.soundFab.style.display = show ? '' : 'none';
  }

  register(name: string, s: Screen): void {
    this.screens.set(name, s);
    s.el.classList.add('screen');
    this.root.insertBefore(s.el, this.toastZone);
  }

  get<T extends Screen>(name: string): T {
    return this.screens.get(name) as T;
  }

  show(name: string, params?: unknown): void {
    if (this.current && this.current !== name) {
      const prev = this.screens.get(this.current);
      prev?.el.classList.remove('active');
      prev?.onHide?.();
    }
    const s = this.screens.get(name);
    if (!s) return;
    this.current = name;
    s.onShow?.(params);
    s.el.classList.add('active');
  }

  update(dt: number): void {
    if (!this.current) return;
    this.screens.get(this.current)?.update?.(dt);
  }

  toast(text: string, gold = false): void {
    const t = el('div', 'toast' + (gold ? ' gold' : ''), text);
    this.toastZone.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }

  modal(html: string, bind: (root: HTMLElement, close: () => void) => void, dismissable = true): void {
    this.closeModal();
    const r = el('div', 'modal-root');
    r.innerHTML = `<div class="modal panel">${html}</div>`;
    const close = () => this.closeModal();
    if (dismissable) {
      r.addEventListener('click', (e) => {
        if (e.target === r) close();
      });
    }
    this.root.appendChild(r);
    this.modalEl = r;
    bind(r, close);
  }

  closeModal(): void {
    this.modalEl?.remove();
    this.modalEl = null;
  }

  get modalOpen(): boolean {
    return this.modalEl !== null;
  }
}
