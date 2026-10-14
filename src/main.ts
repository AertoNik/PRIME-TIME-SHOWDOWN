import './style.css';
import { startupErrorHtml } from './graphics';
import { Arena } from './arena';
import { Combat, type CombatEvent } from './combat';
import { BALANCE, CARDS, WEAPONS, type CardId, type WeaponId } from './data';
import { Audio } from './audio';
import { UI, type Screen } from './ui';
import { load, save, reward } from './storage';
import { escapeHtml } from './icons';
const game = document.querySelector<HTMLElement>('#game')!;
const ui = new UI(document.querySelector<HTMLElement>('#ui')!);
const audio = new Audio();
const profile = load(); audio.enabled = profile.sound;
let screen: Screen = 'home', match: Combat | undefined, arena: Arena;
let rewards: ReturnType<typeof reward> | undefined;
let countdown = 0, countdownValue = 0, paused = false, contextOk = true;
let resultDelay = 0, accumulator = 0, previous = performance.now(), frame = 0;
let announcementTimer = 0, toastTimer = 0;
let draft = [...profile.deck];
function persist() { if (!save(profile)) toast('Сохранение недоступно. Прогресс действует до закрытия вкладки.'); }
function toast(text: string) { const el = document.querySelector<HTMLElement>('#toast')!; el.textContent = text; el.classList.add('visible'); window.clearTimeout(toastTimer); toastTimer = window.setTimeout(() => el.classList.remove('visible'), 3200); }
function announce(text: string, sub = '', combo = false, duration = 1100) { const el = document.querySelector<HTMLElement>('#announcement'); if (!el) return; window.clearTimeout(announcementTimer); el.className = `announcement ${combo ? 'combo' : ''}`; el.innerHTML = `${escapeHtml(text)}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}`; void el.offsetWidth; el.classList.add('visible'); announcementTimer = window.setTimeout(() => el.classList.remove('visible'), duration); }
function show(next: Screen) {
  screen = next; if (arena) arena.preview = next === 'loadout'; game.dataset.screen = next; ui.render(next, next === 'loadout' ? { ...profile, deck: draft } : profile, match, rewards);
  if (next === 'home' || next === 'loadout' || next === 'intro') arena?.setMode('lobby', profile.weapon);
  if (next === 'home') { match = undefined; rewards = undefined; paused = false; }
}
function start() {
  profile.intro = true; persist(); match = new Combat(profile.weapon, [...profile.deck]); rewards = undefined;
  accumulator = 0; countdown = 3; countdownValue = 3; paused = false; resultDelay = 0;
  arena.setMode('battle', profile.weapon, match.enemy.weapon); show('battle'); ui.updateBattle(match, countdown > 0 || paused); announce('3', 'ПРИГОТОВЬСЯ К ЭФИРУ', false, 1000);
}
function pause() { if (screen !== 'battle' || !match || match.finished) return; paused = true; const p = document.querySelector<HTMLElement>('#pause-overlay'); if (p) p.hidden = false; }
function resume() { if (!contextOk) return; paused = false; accumulator = 0; previous = performance.now(); const p = document.querySelector<HTMLElement>('#pause-overlay'); if (p) p.hidden = true; audio.unlock(); }
function handleEvent(e: CombatEvent) {
  arena.event(e);
  if (e.type === 'shot') audio.shot(e.weapon!, !!e.heavy);
  if (e.type === 'hit') { audio.hit(); if (screen === 'battle') { const el = document.createElement('span'); el.className = `damage-label ${e.side === 'player' ? 'enemy' : ''}`; el.textContent = `−${e.damage}`; // Project world position into screen coordinates.
      const pos = arena.player.root.position.clone().set(e.x, 2.6, e.z).project(arena.camera); el.style.left = `${(pos.x + 1) * game.clientWidth / 2}px`; el.style.top = `${(-pos.y + 1) * game.clientHeight / 2}px`; document.querySelector('#combat-labels')?.append(el); window.setTimeout(() => el.remove(), 700); } }
  if (e.type === 'card') { audio.card(); if (e.card === 'shield') audio.shield(); const el = document.createElement('span'); el.className = `card-callout ${e.side === 'enemy' ? 'enemy' : ''}`; el.textContent = `${e.side === 'enemy' ? 'RIVAL / ' : ''}${CARDS[e.card!].name}`; document.querySelector('#combat-labels')?.append(el); window.setTimeout(() => el.remove(), 1000); }
  if (e.type === 'combo') { announce(e.text!, e.side === 'player' ? 'КОМБО! +50% УРОНА' : 'КОМБО СОПЕРНИКА', true); audio.crowd(); }
  if (e.type === 'showtime') { announce('SHOWTIME', 'ОБОИМ БОЙЦАМ: ЭНЕРГИЯ ×1,25', false, 1800); audio.crowd(); }
  if (e.type === 'finish') {
    rewards = reward(profile, match!); persist(); resultDelay = 1.6;
    announce(match!.winner === 'player' ? 'K.O. / YOU WIN' : match!.winner === 'draw' ? 'DRAW' : 'CUT! / YOU LOSE', 'ЭФИР ЗАВЕРШЁН', true, 1500);
    if (match!.winner === 'player') audio.win(); else audio.tone(200, 0.4, 'triangle', 0.06, 70); audio.crowd();
  }
}
ui.root.addEventListener('click', e => {
  const target = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!target || target.disabled) return;
  audio.unlock(); audio.click();
  if (target.dataset.weapon && screen === 'loadout') { profile.weapon = target.dataset.weapon as WeaponId; arena.player.setWeapon(profile.weapon); persist(); show('loadout'); return; }
  if (target.dataset.card && screen === 'loadout') { const id = target.dataset.card as CardId; if (draft.includes(id)) draft = draft.filter(c => c !== id); else if (draft.length < 4) draft.push(id); else { toast('В комплекте 4 карты. Сначала убери одну.'); return; } show('loadout'); return; }
  if (target.dataset.play !== undefined && screen === 'battle' && !paused && countdown <= 0) { if (!match?.play(Number(target.dataset.play))) toast('Недостаточно энергии или боец оглушён.'); if (match) ui.updateBattle(match, countdown > 0 || paused); return; }
  const action = target.dataset.action;
  if (action === 'play') { if (profile.intro) start(); else show('intro'); }
  if (action === 'start' || action === 'again') start();
  if (action === 'home') show('home');
  if (action === 'loadout') { draft = [...profile.deck]; show('loadout'); }
  if (action === 'save-loadout' && draft.length === 4) { profile.deck = [...draft]; persist(); show('home'); toast('Комплект сохранён. Всё готово к эфиру.'); }
  if (action === 'career' || action === 'settings') show(action);
  if (action === 'sound') { profile.sound = !profile.sound; audio.enabled = profile.sound; if (profile.sound) audio.unlock(); persist(); const button = target; button.classList.toggle('on', profile.sound); button.setAttribute('aria-checked', String(profile.sound)); }
  if (action === 'quality') { profile.quality = profile.quality === 'auto' ? 'low' : 'auto'; arena.setQuality(profile.quality === 'low'); persist(); target.textContent = profile.quality === 'auto' ? 'АВТО' : 'НИЗКАЯ'; }
  if (action === 'save-settings') { const input = document.querySelector<HTMLInputElement>('#nickname'); profile.name = input?.value.trim().slice(0, 16) || 'ROOKIE'; persist(); show('home'); }
  if (action === 'pause') pause();
  if (action === 'resume') resume();
  if (action === 'quit' && match && !match.finished) { paused = false; match.player.hp = 0; match.finish(); for (const ev of match.drainEvents()) handleEvent(ev); show('result'); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); previous = performance.now(); accumulator = 0; });
window.addEventListener('keydown', e => { if (e.code === 'Escape') { if (paused) resume(); else pause(); } if (screen === 'battle' && !paused && countdown <= 0 && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) match?.play(Number(e.code.slice(-1)) - 1); });
function loop(now: number) {
  frame = requestAnimationFrame(loop); const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000)); previous = now;
  if (!contextOk || document.hidden) return;
  if (screen === 'battle' && match && !paused) {
    if (countdown > 0) { countdown -= dt; const value = Math.ceil(countdown); if (value !== countdownValue && value >= 0) { countdownValue = value; announce(value > 0 ? String(value) : 'ON AIR!', value > 0 ? 'ЗАЙМИ СВОЁ МЕСТО' : 'ПОРА ДЕЛАТЬ ШОУ', false, 850); audio.tone(value > 0 ? 440 : 880, 0.1); } }
    else if (!match.finished) { accumulator += dt; let steps = 0; while (accumulator >= BALANCE.fixedStep && steps++ < 4) { match.update(BALANCE.fixedStep); accumulator -= BALANCE.fixedStep; } for (const e of match.drainEvents()) handleEvent(e); }
    else if (resultDelay > 0) { resultDelay -= dt; if (resultDelay <= 0) show('result'); }
    ui.updateBattle(match, countdown > 0 || paused);
  }
  arena.render(paused ? 0 : dt, match);
}
try {
  arena = new Arena(document.querySelector<HTMLElement>('#stage')!, ok => {
    contextOk = ok;
    const fatal = document.querySelector<HTMLElement>('#fatal')!;
    if (!ok) { pause(); fatal.innerHTML = '<h2>СИГНАЛ ПОТЕРЯН</h2><p>WebGL восстанавливает сцену. Матч на паузе.</p><button class="primary" onclick="location.reload()">ПЕРЕЗАГРУЗИТЬ</button>'; fatal.hidden = false; }
    else { fatal.hidden = true; toast('Сигнал восстановлен. Продолжи матч с паузы.'); }
  });
  document.querySelector('#boot')?.remove(); arena.setQuality(profile.quality === 'low'); show('home'); frame = requestAnimationFrame(loop);
} catch (error) { document.querySelector('#boot')?.remove(); console.error(error); const fatal = document.querySelector<HTMLElement>('#fatal')!; fatal.innerHTML = startupErrorHtml(error); fatal.hidden = false; }
window.addEventListener('pagehide', e => { persist(); if (!e.persisted) { cancelAnimationFrame(frame); arena?.dispose(); audio.dispose(); } });
