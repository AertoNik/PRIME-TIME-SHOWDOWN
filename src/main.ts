import Phaser from 'phaser';
import './style.css';
import { UI } from './ui';
import { Arena } from './arena';
import { Sound } from './audio';

function fit() {
  const viewport = document.querySelector<HTMLElement>('#cabinet')!;
  const scale = Math.min(viewport.clientWidth / 450, viewport.clientHeight / 800, 1.16);
  document.querySelector<HTMLElement>('#game-shell')!.style.transform = `scale(${scale})`;
}
fit(); window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit);

try {
  const ui = new UI();
  const scene = new Arena(ui, new Sound());
  new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: 450, height: 800,
    backgroundColor: '#0b1024', antialias: true,
    powerPreference: 'low-power',
    fps: { target: 60, smoothStep: true },
    render: { roundPixels: false, antialias: true },
    input: { activePointers: 2 }, audio: { noAudio: true },
    scene: [scene],
  });
} catch (error) {
  console.error(error);
  document.querySelector('#interface')!.innerHTML = '<div class="error-panel"><h1>Эфир временно прерван</h1><p>Не удалось создать игровую сцену. Попробуй обновить страницу в современном браузере.</p><button onclick="location.reload()">ПОВТОРИТЬ</button></div>';
}
