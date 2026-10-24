import { APP_LABEL } from '../../config/version';
import { el } from '../dom';
import { sellerLinksHTML } from '../sellerLine';
import type { Screen } from '../UI';

export class TitleScreen implements Screen {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private hint: HTMLElement;
  private ready = false;

  constructor(onTap: () => void) {
    this.el = el(
      'div',
      'title-screen',
      `<div class="logo"><span class="live">LIVE</span><span class="l1">PRIME TIME</span><span class="l2">SHOWDOWN</span></div>
       <div class="loader-bar"><i></i></div>
       <div class="tap-hint" style="visibility:hidden">НАЖМИТЕ, ЧТОБЫ ВЫЙТИ В ЭФИР</div>
       <div class="title-pay-note" hidden></div>
       <div class="credits">${APP_LABEL}</div>
       ${sellerLinksHTML('title-docs')}`,
    );
    this.bar = this.el.querySelector('.loader-bar > i') as HTMLElement;
    this.hint = this.el.querySelector('.tap-hint') as HTMLElement;
    this.el.addEventListener('pointerup', (e) => {
      // (the document links open their pages; they never start the game)
      if ((e.target as HTMLElement | null)?.closest?.('a')) return;
      if (this.ready) onTap();
    });
  }

  setProgress(p: number): void {
    this.bar.style.width = Math.round(p * 100) + '%';
  }

  /** 1.8.8: back from Robokassa — which order the tap will check (nothing more: the server decides). */
  setNote(text: string): void {
    const n = this.el.querySelector('.title-pay-note') as HTMLElement;
    n.textContent = text;
    n.hidden = !text;
  }

  setReady(): void {
    this.ready = true;
    this.setProgress(1);
    (this.el.querySelector('.loader-bar') as HTMLElement).style.opacity = '0';
    this.hint.style.visibility = 'visible';
  }
}
