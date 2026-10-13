import { CARDS, WEAPONS, cardById, icon, type CardId, type WeaponId } from './data';
import { Match, type FighterState } from './combat';

export interface Preferences { weapon: WeaponId; deck: CardId[]; muted: boolean; fans: number; coins: number; }
export const defaults: Preferences = { weapon: 'pulse', deck: ['dash', 'power', 'shield', 'shock'], muted: false, fans: 0, coins: 0 };
export function loadPreferences(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem('prime-time-v1') || '{}');
    return { ...defaults, ...saved, weapon: WEAPONS.some(w => w.id === saved.weapon) ? saved.weapon : defaults.weapon,
      deck: Array.isArray(saved.deck) && saved.deck.length === 4 && new Set(saved.deck).size === 4 && saved.deck.every((id: CardId) => CARDS.some(c => c.id === id)) ? saved.deck : [...defaults.deck],
      fans: Number.isFinite(saved.fans) ? saved.fans : 0, coins: Number.isFinite(saved.coins) ? saved.coins : 0 };
  } catch { return { ...defaults, deck: [...defaults.deck] }; }
}
export class UI {
  root = document.querySelector<HTMLDivElement>('#interface')!;
  preferences = loadPreferences();
  onPlay = () => {};
  onCard = (_index: number) => {};
  onPause = (_paused: boolean) => {};
  onLobby = () => {};
  onSound = (_muted: boolean) => {};
  private lastHand = '';
  private toastTimer = 0;
  private warning = false;
  private mode = 'lobby';
  private lastBuffs = '';
  constructor() {
    this.root.innerHTML = `
      <header class="topbar"><div class="live"><i></i>LIVE ON AIR</div><div class="top-meta"><span>STUDIO 01</span><button class="icon-button sound-toggle" aria-label="Выключить звук"></button><button class="icon-button hidden" id="pause-button" aria-label="Пауза">${icon('pause')}</button></div></header>
      <section id="lobby" aria-label="Подготовка к матчу">
        <div class="lobby-title"><div class="eyebrow">THE WORLD IS WATCHING</div><h1>PRIME TIME<span>SHOWDOWN</span></h1></div>
        <div class="intro-tag">ТВОЙ ВЫХОД. ТВОЯ СЛАВА.</div>
        <div class="fighter-tag player"><b>NEON</b><span>ВОСХОДЯЩАЯ ЗВЕЗДА</span></div><div class="fighter-tag enemy"><b>VOLT</b><span>ЧЕМПИОН СТУДИИ</span></div>
        <div class="loadout"><div class="section-line">01 / ТВОЁ ОРУЖИЕ <small>АВТОМАТИЧЕСКИЙ ОГОНЬ</small></div><div class="weapons">${WEAPONS.map(w => `<button class="weapon" data-weapon="${w.id}" aria-pressed="false">${icon(w.id)}<span><b>${w.name}</b><small>${w.tag}</small></span></button>`).join('')}</div>
          <div class="section-line deck-label">02 / ТВОЯ ТАКТИКА <small class="deck-count"></small></div>
          <div class="deck-grid">${CARDS.map(c => `<button class="deck-card" style="--card:${c.color}" data-select="${c.id}" aria-pressed="false" aria-label="${c.name}: ${c.description} Стоимость: ${c.cost}.">${icon(c.id)}<span><b>${c.name}</b><span class="mini-cost">${c.cost} ЭНЕРГИИ</span></span><span class="check hidden">✓</span></button>`).join('')}</div>
          <div class="card-info" aria-live="polite">Выбери 4 карты. Применяй их в нужный момент.</div>
          <button class="play-button" id="play">PLAY ${icon('arrow')}</button><div class="lobby-foot">75 СЕКУНД <span>·</span> 2 БОЙЦА <span>·</span> ОДИН ПРЯМОЙ ЭФИР</div>
        </div>
      </section>
      <section id="match-hud" class="hidden" aria-label="Дуэль">
        <div class="match-brand">PRIME TIME <span>/ SHOWDOWN</span></div>
        <div class="scoreboard"><div class="competitor"><div class="name-row"><b>NEON</b><small>ТЫ</small></div><div class="health"><span id="player-health"></span></div><div class="hp-number" id="player-hp">1 200 / 1 200</div></div><div class="clock"><b id="timer">1:15</b><small>ON THE CLOCK</small></div><div class="competitor enemy"><div class="name-row"><b>VOLT</b><small>ИИ</small></div><div class="health"><span id="enemy-health"></span></div><div class="hp-number" id="enemy-hp">1 200 / 1 200</div></div></div>
        <div class="status-strip"><div class="status-side player-buffs"></div><div class="status-side enemy-buffs"></div></div>
        <div class="showtime-label hidden">★ SHOWTIME ★</div><div class="round-label"><span>MAIN EVENT / 01</span><strong>NEON DOME</strong></div>
        <div class="warning hidden" role="status"><b>ВНИМАНИЕ: МОЩНЫЙ ВЫСТРЕЛ</b><small>Рывок, щит или электрошок!</small></div>
        <div class="arena-tip">Бойцы атакуют сами. <strong>Момент решаешь ты.</strong></div>
        <div class="energy-panel"><div class="energy-title"><span>${icon('shock')}ЭНЕРГИЯ</span><b><span id="energy-number">6</span><small> / 10</small></b></div><div class="energy-track">${Array.from({ length: 10 }, () => '<div class="energy-cell"><i></i></div>').join('')}</div></div>
        <div class="hand" aria-label="Карты способностей"></div><div class="match-footer"><span><strong>ТВОИ КАРТЫ</strong> · НАЖМИ ДЛЯ АКТИВАЦИИ</span><span class="onair-bars"><i></i><i></i><i></i></span><span>ПРЯМОЙ ЭФИР</span></div>
      </section>
      <div id="countdown" class="overlay countdown hidden"><div><small>КАМЕРЫ ГОТОВЫ. А ТЫ?</small><div class="count-number">3</div><p>Бойцы двигаются и стреляют сами.<br>Нажимай карты, чтобы изменить ход боя.</p></div></div>
      <div id="pause" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="pause-title"><div class="dialog pause-dialog"><div class="eyebrow">BROADCAST ON HOLD</div><h2 id="pause-title">РЕКЛАМНАЯ ПАУЗА</h2><p>Эфир подождёт. Твоя энергия тоже.</p><button class="play-button" id="resume">ПРОДОЛЖИТЬ ${icon('arrow')}</button><button class="secondary" id="quit">К ВЫБОРУ СНАРЯЖЕНИЯ</button></div></div>
      <div id="result" class="overlay hidden" role="dialog" aria-modal="true" aria-label="Результат матча"></div><div class="toast hidden" role="status"></div>`;
    this.root.querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(btn => btn.onclick = () => {
      this.preferences.weapon = btn.dataset.weapon as WeaponId;
      this.updateLoadout(); this.save(); this.info(WEAPONS.find(w => w.id === this.preferences.weapon)!.description);
    });
    this.root.querySelectorAll<HTMLButtonElement>('[data-select]').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.select as CardId;
      if (this.preferences.deck.includes(id)) this.preferences.deck = this.preferences.deck.filter(c => c !== id);
      else if (this.preferences.deck.length < 4) this.preferences.deck.push(id);
      else { this.info('Сначала убери одну карту, чтобы добавить другую.'); return; }
      this.info(cardById(id).description); this.updateLoadout();
      if (this.preferences.deck.length === 4) this.save();
    });
    this.el<HTMLButtonElement>('#play').onclick = () => this.onPlay();
    this.el<HTMLButtonElement>('.sound-toggle').onclick = () => {
      this.preferences.muted = !this.preferences.muted; this.soundIcon(); this.save(); this.onSound(this.preferences.muted);
    };
    this.el<HTMLButtonElement>('#pause-button').onclick = () => this.onPause(true);
    this.el<HTMLButtonElement>('#resume').onclick = () => this.onPause(false);
    this.el<HTMLButtonElement>('#quit').onclick = () => this.onLobby();
    this.el('.hand').addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-slot]');
      if (button) this.onCard(Number(button.dataset.slot));
    });
    this.updateLoadout(); this.soundIcon();
  }
  el<T extends HTMLElement = HTMLElement>(query: string) { return this.root.querySelector<T>(query)!; }
  save() { try { localStorage.setItem('prime-time-v1', JSON.stringify(this.preferences)); } catch { /* Private browsing still works. */ } }
  private info(text: string) { this.el('.card-info').textContent = text; }
  private updateLoadout() {
    this.root.querySelectorAll<HTMLElement>('[data-weapon]').forEach(b => { const chosen = b.dataset.weapon === this.preferences.weapon; b.classList.toggle('selected', chosen); b.setAttribute('aria-pressed', String(chosen)); });
    this.root.querySelectorAll<HTMLElement>('[data-select]').forEach(b => { const chosen = this.preferences.deck.includes(b.dataset.select as CardId); b.classList.toggle('selected', chosen); b.setAttribute('aria-pressed', String(chosen)); b.querySelector('.check')!.classList.toggle('hidden', !chosen); });
    this.el('.deck-count').textContent = `${this.preferences.deck.length} / 4 ВЫБРАНО`;
    this.el<HTMLButtonElement>('#play').disabled = this.preferences.deck.length !== 4;
  }
  private soundIcon() {
    const b = this.el<HTMLButtonElement>('.sound-toggle');
    b.innerHTML = icon(this.preferences.muted ? 'muted' : 'sound');
    b.setAttribute('aria-label', this.preferences.muted ? 'Включить звук' : 'Выключить звук');
    b.setAttribute('aria-pressed', String(this.preferences.muted));
  }
  lobby() {
    this.mode = 'lobby'; this.show('#lobby', true); this.show('#match-hud', false); this.show('#pause-button', false);
    for (const id of ['#countdown', '#pause', '#result', '.toast']) this.show(id, false);
    this.updateLoadout();
  }
  begin(match: Match) {
    this.mode = 'countdown'; this.lastHand = ''; this.lastBuffs = ''; this.warning = false;
    this.show('#lobby', false); this.show('#match-hud', true); this.show('#result', false); this.show('#pause', false); this.show('.warning', false);
    this.show('.showtime-label', false); this.show('#pause-button', false); this.show('#countdown', true); this.update(match);
  }
  count(value: string) {
    const number = this.el('.count-number'); number.textContent = value;
    number.style.animation = 'none'; void number.offsetWidth; number.style.animation = '';
  }
  start() { this.mode = 'fight'; this.show('#countdown', false); this.show('#pause-button', true); }
  pause(value: boolean) { this.show('#pause', value); this.mode = value ? 'pause' : 'fight'; if (value) this.el('#resume').focus(); }
  show(selector: string, visible: boolean) { this.el(selector).classList.toggle('hidden', !visible); }
  toast(message: string) {
    this.el('.toast').textContent = message; this.show('.toast', true); window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.show('.toast', false), 2000);
  }
  update(match: Match) {
    for (const side of ['player', 'enemy'] as const) {
      this.el(`#${side}-health`).style.width = `${match[side].hp / match.maxHp * 100}%`;
      this.el(`#${side}-hp`).textContent = `${match[side].hp.toLocaleString('ru')} / 1 200`;
    }
    const sec = Math.ceil(match.remaining);
    this.el('#timer').textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    this.el('.clock').classList.toggle('urgent', sec <= 15);
    this.el('#energy-number').textContent = `${Math.floor(match.energy)}`;
    this.root.querySelectorAll<HTMLElement>('.energy-cell i').forEach((cell, i) => cell.style.width = `${Math.min(1, Math.max(0, match.energy - i)) * 100}%`);
    const handKey = match.hand.join();
    if (handKey !== this.lastHand) {
      match.hand.forEach((id, i) => {
        const current = this.el('.hand').children[i] as HTMLButtonElement | undefined;
        if (current?.dataset.card === id) return;
        const c = cardById(id), b = document.createElement('button');
        b.className = 'ability replacing'; b.style.setProperty('--card', c.color); b.dataset.slot = `${i}`; b.dataset.card = id;
        b.setAttribute('aria-label', `${c.name}. ${c.description} Стоимость: ${c.cost}.`);
        b.title = c.description;
        b.innerHTML = `<span class="key">${i + 1}</span><span class="cost">${c.cost}</span>${icon(c.id)}<b>${c.name}</b><small>${c.short}</small>`;
        if (current) current.replaceWith(b); else this.el('.hand').append(b);
      });
      this.lastHand = handKey;
    }
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b, i) => { b.disabled = this.mode !== 'fight' || !match.canPlay(i); });
    if (this.warning !== (match.warning > 0)) { this.warning = match.warning > 0; this.show('.warning', this.warning); }
    this.show('.showtime-label', match.showtime && !this.warning);
    const buffKey = [match.player, match.enemy].map(f => [f.shield, f.smoke, f.dodge, f.boost, f.stun].map(n => Math.ceil(n)).join()).join('|');
    if (buffKey !== this.lastBuffs) {
      const buffs = (f: FighterState) => (['shield', 'smoke', 'dodge', 'boost', 'stun'] as const).filter(b => f[b] > 0).map(b => `<span class="buff">${{ shield: 'ЩИТ', smoke: 'ДЫМ', dodge: 'РЫВОК', boost: 'БУСТ', stun: 'ОГЛУШЁН' }[b]} ${Math.ceil(f[b])}с</span>`).join('');
      this.el('.player-buffs').innerHTML = buffs(match.player); this.el('.enemy-buffs').innerHTML = buffs(match.enemy); this.lastBuffs = buffKey;
    }
  }
  finishing(winner: string) {
    this.mode = 'result'; this.show('#pause-button', false); this.show('.warning', false);
    this.root.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(b => b.disabled = true);
    const banner = document.createElement('div'); banner.className = 'end-banner';
    banner.textContent = winner === 'player' ? 'VICTORY!' : winner === 'draw' ? 'DRAW!' : 'KNOCKOUT!'; this.root.append(banner);
    window.setTimeout(() => banner.remove(), 1300);
  }
  result(match: Match) {
    const win = match.winner === 'player', draw = match.winner === 'draw';
    const fans = win ? 120 + match.stats.cards * 8 : draw ? 60 : 35 + match.stats.cards * 3;
    const coins = win ? 80 : draw ? 40 : 25;
    this.preferences.fans += fans; this.preferences.coins += coins; this.save();
    this.el('#result').innerHTML = `<div class="dialog result ${win ? '' : 'loss'}"><div class="trophy">${icon(win ? 'trophy' : 'shock')}</div><div class="eyebrow">${win ? 'A STAR IS BORN' : draw ? 'TOO CLOSE TO CALL' : 'THE COMEBACK STARTS HERE'}</div><h2>${win ? 'ТВОЙ ПРАЙМ-ТАЙМ' : draw ? 'НА РАВНЫХ' : 'ЕЩЁ ОДИН ДУБЛЬ'}</h2><p>${win ? 'Студия скандирует твоё имя. Это был твой эфир.' : draw ? 'Даже камеры не смогли выбрать победителя.' : 'VOLT забрал этот эфир. Смени тактику и вернись.'}</p><div class="rewards"><div class="reward">${icon('fans')}<b>+${fans}</b><small>НОВЫХ ФАНАТОВ</small></div><div class="reward">${icon('coin')}<b>+${coins}</b><small>ШОУ-КОИНОВ</small></div></div><div class="result-stats"><span><b>${match.stats.dealt.toLocaleString('ru')}</b>УРОНА</span><span><b>${match.stats.cards}</b>КАРТ СЫГРАНО</span><span><b>${Math.round(match.elapsed)}с</b>В ЭФИРЕ</span></div><button class="play-button" id="again">PLAY AGAIN ${icon('arrow')}</button><button class="secondary" id="edit-loadout">ИЗМЕНИТЬ СНАРЯЖЕНИЕ</button><p class="result-note">Демо-прогресс · ${this.preferences.fans.toLocaleString('ru')} фанатов · ${this.preferences.coins} монет всего</p></div>`;
    this.el<HTMLButtonElement>('#again').onclick = () => this.onPlay();
    this.el<HTMLButtonElement>('#edit-loadout').onclick = () => this.onLobby();
    this.show('#result', true); this.el('#again').focus();
  }
}
