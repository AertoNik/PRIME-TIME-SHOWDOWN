import { Vector3 } from 'three';
import { MATCH } from '../../config/balance';
import { CARDS, COMBOS } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import type { CardId, Side } from '../../config/types';
import type { Match } from '../../combat/Match';
import type { MatchEvent } from '../../combat/types';
import { damp, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { cardHTML, el, esc, portraitHTML, vibrate } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

interface Floater {
  el: HTMLElement;
  /** Running total for aggregated rapid hits. */
  sum: number;
  side: number;
  x: number;
  y: number;
  z: number;
  t: number;
  life: number;
  ox: number;
  rise: number;
  active: boolean;
}

interface Banner {
  text: string;
  sub?: string;
  tier: number;
}

const _v = new Vector3();
const _p = { x: 0, y: 0 };

/** In-battle HUD: health, timer, show rating, cards, energy and all feedback text. */
export class BattleHUD implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private m: Match | null = null;

  private hpVal: HTMLElement[] = [];
  private hpLag: HTMLElement[] = [];
  private hpNum: HTMLElement[] = [];
  private status: HTMLElement[] = [];
  private lag = [1, 1];
  private timeEl!: HTMLElement;
  private timerBox!: HTMLElement;
  private ratingFill!: HTMLElement;
  private ratingNum!: HTMLElement;
  private ratingMeter!: HTMLElement;
  private viewersEl!: HTMLElement;
  private pops!: HTMLElement;
  private slots: HTMLElement[] = [];
  private nextSlot!: HTMLElement;
  private energyNum!: HTMLElement;
  private energyBar!: HTMLElement;
  private energySegs: HTMLElement[] = [];
  private comboStrip!: HTMLElement;
  private comboName!: HTMLElement;
  private comboTrack!: HTMLElement;
  private fx!: HTMLElement;
  private bannerZone!: HTMLElement;
  private bigCenter!: HTMLElement;
  private flashEl!: HTMLElement;
  private vignette!: HTMLElement;
  private glitchEl!: HTMLElement;
  private hintEl: HTMLElement | null = null;
  private headTags: HTMLElement[] = [];
  private headBars: HTMLElement[] = [];

  private rendered: (CardId | null)[] = [null, null, null];
  private renderedNext: CardId | null = null;
  private affordable = [false, false, false];
  private floaters: Floater[] = [];
  private bannerQueue: Banner[] = [];
  private bannerT = 0;
  private displayRating = 0;
  private lastSecond = -1;
  private flash = 0;
  private hints = { start: false, telegraph: false, combo: false };
  private hintT = 0;
  private statusKey = ['', ''];
  private enemyWarn = false;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'hud');
    this.build();
  }

  private build(): void {
    this.el.innerHTML = `
      <div class="fx-layer"></div>
      <div class="screen-flash"></div>
      <div class="vignette"></div>
      <div class="glitch-overlay"></div>
      <div class="hud-top">
        <div class="hp-box left">
          <div data-portrait="0"></div>
          <div class="hp-col">
            <div class="hp-name" data-name="0"></div>
            <div class="hp-bar"><div class="lag"></div><div class="val"></div></div>
            <div class="hp-num" data-hp="0"></div>
            <div class="status-row" data-status="0"></div>
          </div>
        </div>
        <div class="timer-box" data-act="pause">
          <span class="live">LIVE</span>
          <span class="time">1:15</span>
        </div>
        <div class="hp-box right">
          <div data-portrait="1"></div>
          <div class="hp-col">
            <div class="hp-name" data-name="1"></div>
            <div class="hp-bar"><div class="lag"></div><div class="val"></div></div>
            <div class="hp-num" data-hp="1"></div>
            <div class="status-row" data-status="1"></div>
          </div>
        </div>
      </div>
      <div class="rating-row">
        <button class="icon-btn pause-btn" data-act="pause" aria-label="Пауза">${UI_ICONS.pause}</button>
        <div class="rating-meter">
          <div class="fill" style="transform:scaleX(0.3)"></div>
          <div class="marks"><i style="left:50%"></i><i style="left:75%"></i><i style="left:90%"></i></div>
          <div class="txt"><span>РЕЙТИНГ ШОУ</span><span data-rating>30</span></div>
        </div>
        <div class="viewers">${UI_ICONS.eye}<span data-viewers>0</span></div>
      </div>
      <div class="rating-pops"></div>
      <div class="banner-zone"></div>
      <div class="big-center"></div>
      <div class="hud-bottom">
        <div class="combo-strip"><span class="cname"></span><div class="ctrack"><i></i></div></div>
        <div class="hand-row">
          <div class="next-slot"><div class="label" style="font-size:8px">ДАЛЕЕ</div><div data-next style="width:100%"></div></div>
          <div class="hand-slot" data-slot="0"></div>
          <div class="hand-slot" data-slot="1"></div>
          <div class="hand-slot" data-slot="2"></div>
        </div>
        <div class="energy-row">
          <div class="energy-num">0</div>
          <div class="energy-bar">${'<i><b></b></i>'.repeat(10)}</div>
        </div>
      </div>`;
    const q = (s: string) => this.el.querySelector(s) as HTMLElement;
    this.fx = q('.fx-layer');
    this.flashEl = q('.screen-flash');
    this.vignette = q('.vignette');
    this.glitchEl = q('.glitch-overlay');
    for (const side of [0, 1]) {
      const box = this.el.querySelectorAll('.hp-box')[side] as HTMLElement;
      this.hpVal[side] = box.querySelector('.val') as HTMLElement;
      this.hpLag[side] = box.querySelector('.lag') as HTMLElement;
      this.hpNum[side] = q(`[data-hp="${side}"]`);
      this.status[side] = q(`[data-status="${side}"]`);
    }
    this.timeEl = q('.timer-box .time');
    this.timerBox = q('.timer-box');
    this.ratingMeter = q('.rating-meter');
    this.ratingFill = q('.rating-meter .fill');
    this.ratingNum = q('[data-rating]');
    this.viewersEl = q('[data-viewers]');
    this.pops = q('.rating-pops');
    this.bannerZone = q('.banner-zone');
    this.bigCenter = q('.big-center');
    this.comboStrip = q('.combo-strip');
    this.comboName = q('.combo-strip .cname');
    this.comboTrack = q('.combo-strip .ctrack i');
    this.nextSlot = q('[data-next]');
    this.energyNum = q('.energy-num');
    this.energyBar = q('.energy-bar');
    this.energySegs = Array.from(this.energyBar.querySelectorAll('b')) as HTMLElement[];
    this.slots = [0, 1, 2].map((i) => q(`[data-slot="${i}"]`));

    for (let i = 0; i < 28; i++) {
      const e = el('div', 'dmg');
      e.style.display = 'none';
      this.fx.appendChild(e);
      this.floaters.push({ el: e, sum: 0, side: -1, x: 0, y: 0, z: 0, t: 0, life: 1, ox: 0, rise: 1, active: false });
    }
    for (const side of [0, 1]) {
      const tag = el('div', `head-tag p${side}`, `<div class="ht-warn">!</div><div class="ht-bar"><i></i></div>`);
      this.fx.appendChild(tag);
      this.headTags.push(tag);
      this.headBars.push(tag.querySelector('.ht-bar i') as HTMLElement);
    }

    // Cards respond on pointerdown for instant feel.
    this.slots.forEach((slot, i) => {
      slot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.tapCard(i);
      });
    });
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act="pause"]');
      if (t) this.g.pause();
    });
  }

  // --------------------------------------------------------------- setup
  setup(m: Match): void {
    this.m = m;
    const g = this.g;
    const pf = FIGHTERS[m.cfg.fighter];
    const rv = m.rival;
    (this.el.querySelector('[data-portrait="0"]') as HTMLElement).innerHTML = portraitHTML(g.portraits[pf.look], pf.theme.main, pf.theme.dark);
    (this.el.querySelector('[data-portrait="1"]') as HTMLElement).innerHTML = portraitHTML(g.portraits[rv.look], rv.theme.main, rv.theme.dark);
    (this.el.querySelector('[data-name="0"]') as HTMLElement).textContent = pf.name;
    (this.el.querySelector('[data-name="1"]') as HTMLElement).textContent = rv.name;
    this.rendered = [null, null, null];
    this.renderedNext = null;
    this.lag = [1, 1];
    this.displayRating = m.broadcast.rating;
    this.lastSecond = -1;
    this.bannerQueue = [];
    this.bannerT = 0;
    this.bannerZone.innerHTML = '';
    this.bigCenter.innerHTML = '';
    this.pops.innerHTML = '';
    this.statusKey = ['', ''];
    this.hints = { start: false, telegraph: false, combo: false };
    this.hintEl?.remove();
    this.hintEl = null;
    for (const f of this.floaters) {
      f.active = false;
      f.el.style.display = 'none';
    }
    this.syncHand(true);
    // Matchup intro
    const intro = el(
      'div',
      'matchup-intro',
      `<div class="mi"><span class="side a">${esc(pf.name)}</span><span class="vs">VS</span><span class="side b">${esc(rv.name)}</span></div>`,
    );
    this.el.appendChild(intro);
    setTimeout(() => intro.remove(), 3100);
  }

  tapCard(i: number): void {
    const m = this.m;
    if (!m || this.g.paused) return;
    const card = m.hands[0].hand[i];
    const res = this.g.playCard(i);
    const slot = this.slots[i];
    const cardEl = slot.firstElementChild as HTMLElement | null;
    if (res === null) {
      vibrate(12);
      if (cardEl) {
        const ghost = cardEl.cloneNode(true) as HTMLElement;
        ghost.classList.remove('enter', 'combo-ready', 'disabled');
        ghost.classList.add('played');
        ghost.style.position = 'absolute';
        ghost.style.inset = '0';
        ghost.style.pointerEvents = 'none';
        slot.style.position = 'relative';
        slot.appendChild(ghost);
        setTimeout(() => ghost.remove(), 350);
      }
      this.syncHand(false);
    } else if (cardEl && res !== 'phase') {
      cardEl.classList.remove('shake');
      void cardEl.offsetWidth;
      cardEl.classList.add('shake');
      const msg: Record<string, string> = {
        energy: `Нужно ${CARDS[card].cost} энергии`,
        stunned: 'Боец оглушён!',
        glitched: 'Система взломана!',
        busy: 'Боец занят',
        cooldown: '',
      };
      if (msg[res]) this.callout(0, msg[res], '#ff8a8a');
    }
  }

  private syncHand(force: boolean): void {
    const m = this.m;
    if (!m) return;
    const hand = m.hands[0];
    for (let i = 0; i < 3; i++) {
      const c = hand.hand[i] ?? null;
      if (force || c !== this.rendered[i]) {
        const old = this.slots[i].querySelector('.hand-card:not(.played)');
        old?.remove();
        if (c) {
          const wrap = document.createElement('div');
          wrap.innerHTML = cardHTML(c, 'hand-card enter', false);
          const cardEl = wrap.firstElementChild as HTMLElement;
          cardEl.insertAdjacentHTML('beforeend', `<div class="drain"></div><div class="combo-ribbon">COMBO</div><div class="lock-overlay"></div>`);
          this.slots[i].prepend(cardEl);
          setTimeout(() => cardEl.classList.remove('enter'), 320);
        }
        this.rendered[i] = c;
        this.affordable[i] = false;
      }
    }
    const nx = hand.next;
    if (force || nx !== this.renderedNext) {
      this.nextSlot.innerHTML = nx ? cardHTML(nx, '', false) : '';
      this.renderedNext = nx;
    }
  }

  // ------------------------------------------------------------- update
  update(dt: number): void {
    const m = this.m;
    if (!m) return;
    const g = this.g;
    this.el.classList.toggle('outro', m.phase === 'outro' || m.phase === 'over');
    // health
    for (const side of [0, 1] as Side[]) {
      const f = m.fighters[side];
      const frac = f.hpFrac;
      this.hpVal[side].style.transform = `scaleX(${frac})`;
      this.lag[side] = this.lag[side] > frac ? damp(this.lag[side], frac, 3, dt) : frac;
      this.hpLag[side].style.transform = `scaleX(${this.lag[side]})`;
      const txt = `${Math.ceil(f.hp).toLocaleString('ru-RU')}`;
      if (this.hpNum[side].textContent !== txt) this.hpNum[side].textContent = txt;
      // statuses
      const st: string[] = [];
      if (f.shield > 0) st.push('<span class="st" style="color:#9ad8ff">ЩИТ</span>');
      if (f.overdrive > 0) st.push('<span class="st" style="color:#ffa060">РАЗГОН</span>');
      if (f.adrenaline > 0) st.push('<span class="st" style="color:#22f0e0">АДРЕНАЛИН</span>');
      if (f.stun > 0) st.push('<span class="st" style="color:#ffe14d">ОГЛУШЁН</span>');
      if (f.glitch > 0) st.push('<span class="st" style="color:#ff4fd8">ВЗЛОМ</span>');
      if (f.momentum > 0) st.push('<span class="st" style="color:#22f0e0">MOMENTUM</span>');
      if (f.ironSkin > 0) st.push('<span class="st" style="color:#c8d4ea">IRON SKIN</span>');
      if (f.overclock > 0) st.push('<span class="st" style="color:#ff8ae6">OVERCLOCK</span>');
      if (m.inOwnSmoke(f)) st.push('<span class="st" style="color:#b8b0e0">В ДЫМУ</span>');
      const key = st.join('');
      if (key !== this.statusKey[side]) {
        this.statusKey[side] = key;
        this.status[side].innerHTML = key;
      }
    }
    // timer
    const sec = Math.ceil(m.phase === 'intro' ? MATCH.duration : m.timeLeft);
    if (sec !== this.lastSecond) {
      this.lastSecond = sec;
      this.timeEl.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
      this.timerBox.classList.toggle('hurry', sec <= 10 && m.phase === 'fight');
      if (sec <= 5 && sec > 0 && m.phase === 'fight') g.audio.countdown(1);
    }
    // rating
    const rt = m.broadcast.rating;
    this.displayRating = damp(this.displayRating, rt, 8, dt);
    this.ratingFill.style.transform = `scaleX(${Math.max(0.02, rt / 100)})`;
    const rTxt = String(Math.round(this.displayRating));
    if (this.ratingNum.textContent !== rTxt) this.ratingNum.textContent = rTxt;
    this.ratingMeter.classList.toggle('hot', rt >= 75);
    const viewers = formatNumber(m.broadcast.viewers(m.cfg.fans));
    if (this.viewersEl.textContent !== viewers) this.viewersEl.textContent = viewers;

    // hand + energy
    this.syncHand(false);
    const hand = m.hands[0];
    const p = m.fighters[0];
    const energy = hand.energy;
    const eTxt = String(Math.floor(energy));
    if (this.energyNum.textContent !== eTxt) this.energyNum.textContent = eTxt;
    for (let i = 0; i < 10; i++) {
      const fill = Math.max(0, Math.min(1, energy - i));
      this.energySegs[i].style.transform = `scaleX(${fill})`;
    }
    this.energyBar.classList.toggle('full', energy >= MATCH.maxEnergy - 0.01);
    let comboPrimed: string | null = null;
    for (let i = 0; i < 3; i++) {
      const c = hand.hand[i];
      const cardEl = this.slots[i].querySelector('.hand-card:not(.played)') as HTMLElement | null;
      if (!c || !cardEl) continue;
      const cost = CARDS[c].cost;
      const can = energy >= cost;
      if (can && !this.affordable[i]) {
        cardEl.classList.remove('ready');
        void cardEl.offsetWidth;
        cardEl.classList.add('ready');
      }
      this.affordable[i] = can;
      cardEl.classList.toggle('disabled', !can);
      const drain = cardEl.querySelector('.drain') as HTMLElement;
      drain.style.transform = `scaleY(${can ? 0 : 1 - energy / cost})`;
      const combo = m.phase === 'fight' ? m.combos.wouldCombo(0, c, m.time) : null;
      cardEl.classList.toggle('combo-ready', !!combo);
      if (combo) {
        const rib = cardEl.querySelector('.combo-ribbon') as HTMLElement;
        if (rib.textContent !== combo.name) rib.textContent = combo.name;
        comboPrimed = combo.name;
      }
      const stunned = (p.stun > 0 || p.knockback > 0) && c !== 'shield';
      const glitched = p.glitch > 0;
      cardEl.classList.toggle('stunned', stunned && !glitched);
      cardEl.classList.toggle('glitched', glitched);
      const lock = cardEl.querySelector('.lock-overlay') as HTMLElement;
      const lt = glitched ? 'ERROR' : stunned ? 'STUN' : '';
      if (lock.textContent !== lt) lock.textContent = lt;
    }
    const win = m.combos.windowLeft(0, m.time);
    this.comboStrip.classList.toggle('on', !!comboPrimed && win > 0);
    if (comboPrimed) {
      this.comboName.textContent = `КОМБО: ${comboPrimed}`;
      this.comboTrack.style.transform = `scaleX(${win / MATCH.comboWindow})`;
      if (!this.hints.combo && !g.save.data.hintsSeen) {
        this.hints.combo = true;
        this.showHint('<b>КОМБО ГОТОВО</b><br/>Золотая карта сработает как комбо — сыграйте её, пока не истёк таймер!');
      }
    }
    this.glitchEl.classList.toggle('on', p.glitch > 0);
    const lowHp = p.hpFrac < 0.25 && !p.ko && m.phase === 'fight';
    this.vignette.style.opacity = String(Math.max(lowHp ? 0.35 + Math.sin(performance.now() / 300) * 0.15 : 0, this.flashVignette));
    this.flashVignette = Math.max(0, this.flashVignette - dt * 1.5);

    // flash
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.5);
      this.flashEl.style.opacity = String(this.flash);
    }

    // floating text
    const view = g.battleView;
    for (const f of this.floaters) {
      if (!f.active) continue;
      f.t += dt;
      if (f.t >= f.life) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      view.project(f.x, f.y, f.z, _p);
      const k = f.t / f.life;
      const rise = f.rise * (1 - Math.pow(1 - k, 3)) * 60;
      const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.8 : k < 0.3 ? 1.3 - ((k - 0.15) / 0.15) * 0.3 : 1;
      f.el.style.transform = `translate3d(${_p.x + f.ox}px, ${_p.y - rise}px, 0) translate(-50%, -50%) scale(${sc})`;
      f.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
    // head tags
    for (const side of [0, 1] as Side[]) {
      const f = m.fighters[side];
      const tag = this.headTags[side];
      view.headPos(side, _v);
      view.project(_v.x, _v.y, _v.z, _p);
      tag.style.transform = `translate3d(${_p.x}px, ${_p.y}px, 0) translate(-50%, -100%)`;
      tag.style.display = f.ko || m.phase !== 'fight' ? 'none' : '';
      this.headBars[side].style.transform = `scaleX(${f.hpFrac})`;
      const warn = side === 1 && f.action.kind === 'windup';
      if (warn !== this.enemyWarn && side === 1) {
        this.enemyWarn = warn;
        tag.classList.toggle('warn', warn);
      }
    }

    // banners
    if (this.bannerT > 0) this.bannerT -= dt;
    if (this.bannerT <= 0 && this.bannerQueue.length) {
      const b = this.bannerQueue.shift()!;
      this.showBanner(b);
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) {
        this.hintEl?.remove();
        this.hintEl = null;
      }
    }
  }

  private flashVignette = 0;

  // ------------------------------------------------------------ feedback
  private spawnFloater(text: string, cls: string, x: number, y: number, z: number, life = 0.9, rise = 1): Floater {
    const f = this.floaters.find((q) => !q.active) ?? this.floaters[0];
    f.active = true;
    f.t = 0;
    f.life = life;
    f.x = x;
    f.y = y;
    f.z = z;
    f.ox = (Math.random() - 0.5) * 34;
    f.rise = rise;
    f.el.className = cls;
    f.el.textContent = text;
    f.el.style.color = '';
    f.el.style.display = '';
    f.sum = 0;
    f.side = -1;
    return f;
  }

  callout(side: Side, text: string, color = '#fff'): void {
    const m = this.m;
    if (!m) return;
    const f = m.fighters[side];
    this.spawnFloater(text, 'callout', f.x, 2.9, f.z, 1.1, 0.6).el.style.color = color;
  }

  private showBanner(b: Banner): void {
    const e = el('div', `banner t${b.tier}${b.text.length > 14 ? ' long' : ''}`, `<span class="bt">${esc(b.text)}</span>${b.sub ? `<span class="bs">${esc(b.sub)}</span>` : ''}`);
    this.bannerZone.innerHTML = '';
    this.bannerZone.appendChild(e);
    this.bannerT = b.tier >= 3 ? 1.3 : 0.9;
    setTimeout(() => e.remove(), 1750);
    this.g.audio.reaction(b.tier);
  }

  private queueBanner(b: Banner): void {
    if (b.tier >= 3) {
      this.bannerQueue = this.bannerQueue.filter((x) => x.tier >= 3);
      this.bannerQueue.push(b);
    } else if (this.bannerQueue.length < 2) {
      this.bannerQueue.push(b);
    }
  }

  big(text: string, cls = ''): void {
    this.bigCenter.innerHTML = `<span class="txt ${cls}">${esc(text)}</span>`;
  }

  screenFlash(v: number): void {
    this.flash = Math.max(this.flash, v);
    this.flashEl.style.opacity = String(this.flash);
  }

  private showHint(html: string, dur = 4.5): void {
    this.hintEl?.remove();
    this.hintEl = el('div', 'hint', html);
    this.el.appendChild(this.hintEl);
    this.hintT = dur;
  }

  private ratingPop(amount: number, label: string): void {
    const e = el('div', 'rating-pop' + (amount < 0 ? ' neg' : ''), `${amount > 0 ? '+' : ''}${amount} ${esc(label)}`);
    e.style.left = `${40 + Math.random() * 20}%`;
    this.pops.appendChild(e);
    setTimeout(() => e.remove(), 1250);
  }

  onEvent(e: MatchEvent): void {
    const m = this.m;
    if (!m) return;
    switch (e.type) {
      case 'countdown':
        this.big(e.n > 0 ? String(e.n) : 'FIGHT!', e.n > 0 ? '' : 'fight');
        break;
      case 'phase':
        if (e.phase === 'fight' && !this.hints.start && !this.g.save.data.hintsSeen) {
          this.hints.start = true;
          setTimeout(
            () => this.showHint('<b>ВЫ — ПРОДЮСЕР</b><br/>Боец сражается сам. Нажимайте карточки внизу — это ваши команды. Энергия копится автоматически.', 5.5),
            700,
          );
        }
        break;
      case 'hit': {
        const crit = e.crit;
        const cls = e.side === 0 ? 'dmg player-hit' + (e.heavy ? ' heavy' : '') : crit ? 'dmg crit' : e.heavy ? 'dmg heavy' : 'dmg';
        if (!e.heavy) {
          // Rapid small hits on the same target merge into one growing number.
          const agg = this.floaters.find((q) => q.active && q.side === e.side && q.t < 0.35);
          if (agg) {
            agg.sum += e.damage;
            agg.el.textContent = String(agg.sum);
            agg.t = Math.min(agg.t, 0.12);
            agg.x = e.x;
            agg.z = e.z;
            break;
          }
          const f = this.spawnFloater(String(e.damage), e.kind === 'dot' ? 'dmg' : cls, e.x, 2.2, e.z, 0.7, 0.8);
          f.sum = e.damage;
          f.side = e.side;
        } else {
          this.spawnFloater(crit ? `${e.damage}!` : String(e.damage), cls, e.x, 2.2, e.z, 1.15, 1.3);
        }
        if (e.side === 0 && e.heavy) {
          this.flashVignette = 0.8;
          vibrate([20, 30, 20]);
        }
        if (e.source === 0 && e.heavy) {
          this.screenFlash(crit ? 0.35 : 0.18);
          vibrate(25);
        }
        break;
      }
      case 'block':
        this.spawnFloater(e.perfect ? 'PERFECT BLOCK' : 'БЛОК', 'dmg block', e.x, 2.3, e.z, 0.8, 0.8);
        break;
      case 'miss':
        this.spawnFloater('МИМО', 'dmg miss', e.x, 2.3, e.z, 0.7, 0.8);
        break;
      case 'dodge':
        if (e.perfect) this.callout(e.side, 'PERFECT DODGE', '#9af6ff');
        else if (e.heavy) this.callout(e.side, 'НА ВОЛОСОК', '#c8d4ff');
        break;
      case 'stun':
        this.callout(e.side, 'ОГЛУШЕНИЕ', '#ffe14d');
        break;
      case 'interrupt':
        this.callout(e.side, 'ПРЕРВАН!', '#ffffff');
        break;
      case 'whiff':
        this.callout(e.side, 'ПРОМАХ!', '#c8c0ff');
        break;
      case 'passive':
        this.callout(e.side, e.passive === 'momentum' ? 'MOMENTUM' : e.passive === 'iron_skin' ? 'IRON SKIN' : 'OVERCLOCK', '#22f0e0');
        break;
      case 'shieldBreak':
        this.callout(e.side, 'ЩИТ СЛОМАН', '#9ad8ff');
        break;
      case 'decoyPop':
        if (e.hit) this.spawnFloater('ПРИМАНКА!', 'callout', e.x, 2.4, e.z, 0.9, 0.6);
        break;
      case 'telegraph':
        if (e.side === 1) {
          this.g.audio.telegraph();
          if (!this.hints.telegraph && !this.g.save.data.hintsSeen) {
            this.hints.telegraph = true;
            this.showHint(
              '<b>⚠ СОПЕРНИК ЗАРЯЖАЕТ УДАР</b><br/>Красная зона — опасность! <b>DASH</b> — уклониться, <b>SHIELD</b> — блок, <b>SHOCK</b> — прервать.',
              4.5,
            );
          }
        }
        break;
      case 'combo':
        if (e.side === 1) {
          const c = COMBOS.find((x) => x.id === e.combo)!;
          this.callout(1, c.name, '#ff8a7a');
        }
        break;
      case 'rating':
        if (e.label && Math.abs(e.amount) >= 1) this.ratingPop(e.amount, e.label);
        break;
      case 'reaction':
        this.queueBanner({ text: e.text, sub: e.sub, tier: e.tier });
        break;
      case 'ko':
        this.big('K.O.!', 'fight ko');
        this.screenFlash(0.8);
        vibrate([40, 40, 80]);
        break;
      case 'timeUp':
        this.big('ВРЕМЯ!', 'fight');
        break;
      case 'card': {
        const c = CARDS[e.card];
        this.callout(e.side, c.name + (e.side === 1 ? '!' : ''), e.side === 0 ? c.color : '#ff8a7a');
        break;
      }
      case 'cardFail':
        break;
      default:
        break;
    }
  }

  onHide(): void {
    this.hintEl?.remove();
    this.hintEl = null;
  }
}
