import type { Game } from '../game/Game';

// Alpha 1.8.8 (stage 1) — the first minutes of a new player: after «ВОЙТИ В ЭФИР» a brand-new career
// chooses between the existing FIRST BROADCAST tutorial and the menu. (The stage-1 «coming soon»
// window of PRIME SHOP is gone: stage 2 opens the real shop — src/ui/screens/ShopScreen.ts.)

/**
 * «ПЕРВЫЙ ЭФИР»: play the tutorial or skip it. Shown over the menu, only for a career whose tutorial
 * is still 'pending' (Game.afterTitle); the answer is written into the save (`tutorial`), so it is
 * not asked again in this browser — or in the PRIME ID the career moves to.
 */
export function showTutorialChoice(g: Game, onPlay: () => void, onSkip: () => void): void {
  g.ui.modal(
    `<div class="fb-choice">
       <div class="fbc-kicker"><i></i>LIVE · FIRST BROADCAST</div>
       <div class="h1">Первый эфир</div>
       <p class="fbc-lead"><b>Добро пожаловать в PRIME TIME: SHOWDOWN!</b></p>
       <p class="fbc-text">Научись управлять своим бойцом с помощью тактических карт или сразу приступай к игре.</p>
       <div class="modal-actions">
         <button class="btn wide" data-a="play"><span class="shine"></span>Пройти обучение</button>
         <button class="btn ghost wide" data-a="skip">Пропустить</button>
       </div>
       <p class="fbc-note">Обучение всегда можно пройти позже: Настройки → «Пройти обучение».</p>
     </div>`,
    (root, close) => {
      root.querySelector('[data-a="play"]')!.addEventListener('click', () => {
        g.audio.ui('confirm');
        close();
        onPlay();
      });
      root.querySelector('[data-a="skip"]')!.addEventListener('click', () => {
        g.audio.ui('click');
        close();
        onSkip();
      });
      (root.querySelector('[data-a="play"]') as HTMLElement).focus({ preventScroll: true });
    },
    false,
  );
}
