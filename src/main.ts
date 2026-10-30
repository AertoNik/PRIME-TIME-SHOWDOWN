// Only the Latin + Cyrillic subsets are bundled (UI is Russian, brand text is Latin).
import '@fontsource/unbounded/latin-700.css';
import '@fontsource/unbounded/cyrillic-700.css';
import '@fontsource/unbounded/latin-900.css';
import '@fontsource/unbounded/cyrillic-900.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/cyrillic-400.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/cyrillic-600.css';
import '@fontsource/rubik/latin-700.css';
import '@fontsource/rubik/cyrillic-700.css';
import './styles/main.css';
import { Game } from './game/Game';
import { installViewport } from './ui/viewport';

// 1.8.4: the game's own domain only over HTTPS. GitHub Pages' «Enforce HTTPS» is the real switch; this
// covers a page opened by an old http:// link before it is on (the API never accepts http pages anyway).
if (location.protocol === 'http:' && /(^|\.)primetimeshowdown\.online$/.test(location.hostname)) {
  location.replace('https://' + location.host + location.pathname + location.search + location.hash);
}

function showFatal(msg: string): void {
  const d = document.createElement('div');
  d.style.cssText =
    'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#05060f;color:#eef2ff;font:600 15px/1.5 system-ui;z-index:999';
  d.innerHTML = `<div><div style="font-size:22px;font-weight:900;margin-bottom:10px">PRIME TIME: SHOWDOWN</div>${msg}</div>`;
  document.body.appendChild(d);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

installViewport();

const stage = document.getElementById('stage');
const ui = document.getElementById('ui');
if (!stage || !ui) {
  showFatal('Ошибка загрузки страницы.');
} else if (!webglAvailable()) {
  showFatal('Ваш браузер не поддерживает WebGL. Попробуйте открыть игру в свежей версии Chrome, Safari или Firefox.');
} else {
  const game = new Game(stage, ui);
  document.getElementById('boot')?.remove();
  game.boot().catch((err) => {
    console.error(err);
    showFatal('Не удалось запустить игру. Обновите страницу.<br/><small style="opacity:.6">' + String(err?.message ?? err) + '</small>');
  });
  // debugging handle for local development only (Alpha 1.8: not in the published build).
  // This is not an anti-cheat: the progress lives in the browser and can still be edited there.
  if (import.meta.env.DEV) (window as unknown as { __game: Game }).__game = game;
  // 1.9.1: ?preview=league — the league screens with made-up data, no server (dev builds only, never published)
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('preview')) void import('./dev/leaguePreview').then((m) => m.installLeaguePreview(game));
}
