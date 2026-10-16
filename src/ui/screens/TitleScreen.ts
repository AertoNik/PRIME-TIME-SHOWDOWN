import { el } from '../dom';
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
       <div class="credits">ALPHA 1.5.5 · COMBAT EVOLUTION</div>`,
    );
    this.bar = this.el.querySelector('.loader-bar > i') as HTMLElement;
    this.hint = this.el.querySelector('.tap-hint') as HTMLElement;
    this.el.addEventListener('pointerup', () => {
      if (this.ready) onTap();
    });
  }

  setProgress(p: number): void {
    this.bar.style.width = Math.round(p * 100) + '%';
  }

  setReady(): void {
    this.ready = true;
    this.setProgress(1);
    (this.el.querySelector('.loader-bar') as HTMLElement).style.opacity = '0';
    this.hint.style.visibility = 'visible';
  }
}
