import { Vector3 } from 'three';
import { arenaById } from '../../config/arenas.config';
import { MATCH } from '../../config/balance';
import { CARDS, COMBOS, comboFor } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import { PERKS, PERK_ORDER, challengeById, type ChallengeDef } from '../../config/modes.config';
import { bossById, type BossDef } from '../../config/boss.config';
import type { CardId, Side } from '../../config/types';
import type { Match } from '../../combat/Match';
import type { MatchEvent } from '../../combat/types';
import { damp, formatNumber } from '../../core/math';
import type { Game, ModeSession } from '../../game/Game';
import { cardHTML, el, esc, portraitHTML, vibrate } from '../dom';
import { ICONS } from '../eventArt';
import { UI_ICONS } from '../icons';
import { PERK_ICONS } from '../modeArt';
import type { Screen } from '../UI';

interface Floater {
  el: HTMLElement;
  /** Running total for aggregated rapid hits. */
  sum: number;
  side: number;
  /** Fighter a text callout belongs to (-1 for damage numbers). */
  callSide: number;
  /** Extra px lift so stacked callouts don't overlap. */
  lift: number;
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
  /** Combo explanation: which cards and what bonus. */
  detail?: string;
  tier: number;
}

interface RatingPop {
  el: HTMLElement;
  label: string;
  amount: number;
  t: number;
}

/** Status chips under the health bars, most important first; only the top 3 show. */
const STATUS_ORDER: { key: string; label: string; color: string }[] = [
  { key: 'stun', label: 'ОГЛУШЁН', color: '#ffe14d' },
  // Alpha 1.5.5: Zoe's SHOCK charge — the cue for DASH or SHIELD
  { key: 'zap', label: 'ШОКЕР!', color: '#ffe14d' },
  { key: 'glitch', label: 'ВЗЛОМ', color: '#ff4fd8' },
  { key: 'shield', label: 'ЩИТ', color: '#9ad8ff' },
  // Alpha 1.5: FALSE START read window (the next suitable attack is answered) and RIPOSTE ready
  { key: 'feint', label: 'ФИНТ', color: '#ff8a7a' },
  { key: 'overdrive', label: 'РАЗГОН', color: '#ffa060' },
  { key: 'adrenaline', label: 'АДРЕНАЛИН', color: '#22f0e0' },
  { key: 'smoke', label: 'В ДЫМУ', color: '#b8b0e0' },
  { key: 'momentum', label: 'MOMENTUM', color: '#22f0e0' },
  { key: 'ironSkin', label: 'IRON SKIN', color: '#c8d4ea' },
  { key: 'overclock', label: 'OVERCLOCK', color: '#ff8ae6' },
  { key: 'riposte', label: 'РИПОСТ', color: '#ffb0a0' },
];
const MAX_STATUS = 3;


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
  private tierEl!: HTMLElement;
  private tierText = '';
  private edgeGlow!: HTMLElement;
  private hpBoxes: HTMLElement[] = [];
  private energyNeedT = 0;
  private viewersEl!: HTMLElement;
  private pops!: HTMLElement;
  private slots: HTMLElement[] = [];
  private nextSlot!: HTMLElement;
  private energyNum!: HTMLElement;
  private energyBar!: HTMLElement;
  private energySegs: HTMLElement[] = [];
  private hudBottomEl!: HTMLElement;
  /** px below the top bars; world-space labels never float above this line. */
  private safeTop = 0;
  private comboStrip!: HTMLElement;
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
  private bannerTier = 0;
  private displayRating = 0;
  private lastSecond = -1;
  private flash = 0;
  private hints = { start: false, telegraph: false, combo: false, opener: false };
  private ratingPops: RatingPop[] = [];
  /** Last card the player played (to explain combos). */
  private prevCard: CardId | null = null;
  private pendingCombo: { name: string; detail: string } | null = null;
  private denyTips: (HTMLElement | null)[] = [null, null, null];
  private lastPlayAt = [-1e9, -1e9, -1e9];
  private hintT = 0;
  private statusKey = ['', ''];
  private enemyWarn = false;
  /** Game-mode strip under the rating (Survival wave / challenge goal). */
  private modeStrip!: HTMLElement;
  private modeLive: HTMLElement | null = null;
  private modeLiveTxt = '';
  private challenge: ChallengeDef | null = null;
  /** BOSS FIGHT: the champion's data (phases, move names) and the warning strip. */
  private bossDef: BossDef | null = null;
  private bossWarnEl: HTMLElement | null = null;
  private bossWarnTimer: number | null = null;
  /** DIRECTOR'S CUT: the big alert and the live shot tracker under the mode strip. */
  private cutAlertEl: HTMLElement | null = null;
  private cutEl: HTMLElement | null = null;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'hud');
    this.build();
  }

  private build(): void {
    this.el.innerHTML = `
      <div class="fx-layer"></div>
      <div class="screen-flash"></div>
      <div class="edge-glow"></div>
      <div class="vignette"></div>
      <div class="glitch-overlay"></div>
      <div class="bc-frame" aria-hidden="true"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
      <div class="hud-top">
        <div class="hp-box left">
          <div class="hp-main">
            <div data-portrait="0"></div>
            <div class="hp-col">
              <div class="hp-name" data-name="0"></div>
              <div class="hp-bar"><div class="lag"></div><div class="val"></div></div>
              <div class="hp-num" data-hp="0"></div>
            </div>
          </div>
          <div class="status-row" data-status="0"></div>
        </div>
        <div class="timer-box" data-act="pause">
          <span class="live">LIVE</span>
          <span class="time">1:15</span>
        </div>
        <div class="hp-box right">
          <div class="hp-main">
            <div data-portrait="1"></div>
            <div class="hp-col">
              <div class="hp-name" data-name="1"></div>
              <div class="hp-bar"><div class="lag"></div><div class="val"></div></div>
              <div class="hp-num" data-hp="1"></div>
            </div>
          </div>
          <div class="status-row" data-status="1"></div>
        </div>
      </div>
      <div class="rating-row">
        <button class="icon-btn pause-btn" data-act="pause" aria-label="Пауза">${UI_ICONS.pause}</button>
        <div class="rating-meter">
          <div class="fill" style="transform:scaleX(0.3)"></div>
          <div class="marks"><i style="left:50%"></i><i style="left:75%"></i><i style="left:90%"></i></div>
          <div class="txt"><span class="tier"><span class="rt-pre">РЕЙТИНГ · </span><span data-tier>ТИХО</span></span><span data-rating>30</span></div>
        </div>
        <div class="viewers">${UI_ICONS.eye}<span data-viewers>0</span></div>
      </div>
      <div class="mode-strip"></div>
      <div class="rating-pops"></div>
      <div class="banner-zone"></div>
      <div class="big-center"></div>
      <div class="hud-bottom">
        <div class="combo-strip"><span class="cname">ВРЕМЯ НА КОМБО</span><div class="ctrack"><i></i></div></div>
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
      this.hpBoxes[side] = box;
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
    this.tierEl = q('[data-tier]');
    this.edgeGlow = q('.edge-glow');
    this.viewersEl = q('[data-viewers]');
    this.pops = q('.rating-pops');
    this.bannerZone = q('.banner-zone');
    this.bigCenter = q('.big-center');
    this.comboStrip = q('.combo-strip');
    this.comboTrack = q('.combo-strip .ctrack i');
    this.nextSlot = q('[data-next]');
    this.energyNum = q('.energy-num');
    this.energyBar = q('.energy-bar');
    this.energySegs = Array.from(this.energyBar.querySelectorAll('b')) as HTMLElement[];
    this.slots = [0, 1, 2].map((i) => q(`[data-slot="${i}"]`));
    this.hudBottomEl = q('.hud-bottom');
    this.modeStrip = q('.mode-strip');

    for (let i = 0; i < 28; i++) {
      const e = el('div', 'dmg');
      e.style.display = 'none';
      this.fx.appendChild(e);
      this.floaters.push({ el: e, sum: 0, side: -1, callSide: -1, lift: 0, x: 0, y: 0, z: 0, t: 0, life: 1, ox: 0, rise: 1, active: false });
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
  /**
   * @param dress Alpha 1.4 broadcast dressing: `stage` shows the TV caption of the
   * studio set (NEXT BROADCAST — …), `halloween` gives BOSS FIGHT its HALLOWEEN SPECIAL card.
   */
  setup(m: Match, mode: ModeSession = { kind: 'classic' }, dress: { stage?: boolean; halloween?: boolean } = {}): void {
    this.m = m;
    const g = this.g;
    const pf = FIGHTERS[m.cfg.fighter];
    const rv = m.rival;
    (this.el.querySelector('[data-portrait="0"]') as HTMLElement).innerHTML = portraitHTML(g.portraits[pf.look], pf.theme.main, pf.theme.dark);
    (this.el.querySelector('[data-portrait="1"]') as HTMLElement).innerHTML = portraitHTML(g.portraits[rv.look], rv.theme.main, rv.theme.dark);
    (this.el.querySelector('[data-name="0"]') as HTMLElement).textContent = pf.name;
    (this.el.querySelector('[data-name="1"]') as HTMLElement).textContent = rv.name;
    for (const side of [0, 1] as Side[]) {
      // one tick per 1000 HP so damage reads at a glance
      const bar = this.hpBoxes[side].querySelector('.hp-bar') as HTMLElement;
      bar.style.setProperty('--tick', `${(1000 / m.fighters[side].maxHp) * 100}%`);
    }
    this.rendered = [null, null, null];
    this.renderedNext = null;
    // Survival: the bar starts at the carried-over health, without a fake damage trail.
    this.lag = [m.fighters[0].hpFrac, m.fighters[1].hpFrac];
    this.displayRating = m.broadcast.rating;
    this.lastSecond = -1;
    this.bannerQueue = [];
    this.bannerT = 0;
    this.bannerZone.innerHTML = '';
    this.bigCenter.innerHTML = '';
    this.pops.innerHTML = '';
    this.statusKey = ['', ''];
    this.hints = { start: false, telegraph: false, combo: false, opener: false };
    this.hintEl?.remove();
    this.hintEl = null;
    this.ratingPops = [];
    this.prevCard = null;
    this.pendingCombo = null;
    this.denyTips.forEach((t) => t?.remove());
    this.denyTips = [null, null, null];
    for (const f of this.floaters) {
      f.active = false;
      f.el.style.display = 'none';
    }
    this.syncHand(true);
    const caption = this.setupMode(mode);
    // TV transition: which studio set the broadcast comes from
    const set = arenaById(m.cfg.arena);
    const [capHead, capSet] = set.caption.includes(' — ') ? set.caption.split(' — ') : ['NEXT BROADCAST', set.name];
    const stageCap = dress.stage ? `<div class="mi-stage st-${set.id}"><i>${esc(capHead)}</i><b>${esc(capSet)}</b><span>${esc(set.show)}</span></div>` : '';
    // Matchup intro (modes add a TV caption: wave number or challenge name)
    const sides = `<span class="side a">${esc(pf.name)}</span><span class="vs">VS</span><span class="side b">${esc(rv.name)}</span>`;
    if (this.bossDef) {
      // BOSS FIGHT: a short championship presentation instead of the plain VS card
      // (LEGENDARY SHOWDOWN — CHAMPIONSHIP EDITION, or its HALLOWEEN SPECIAL in season)
      const def = this.bossDef;
      const hw = !!dress.halloween;
      const intro = el(
        'div',
        'boss-intro' + (hw ? ' halloween' : ''),
        `<div class="bi-card">
           <div class="bi-kicker">${esc(def.title)}</div>
           <div class="bi-edition">${hw ? `<i>${ICONS.pumpkin}</i>HALLOWEEN SPECIAL<i>${ICONS.pumpkin}</i>` : '★ CHAMPIONSHIP EDITION ★'}</div>
           <div class="bi-face">${portraitHTML(g.portraits[rv.look], rv.theme.main, rv.theme.dark)}</div>
           <div class="bi-name">${esc(rv.fullName)}</div>
           <div class="bi-sub">${esc(def.kicker)} · 3 фазы · только нокаут</div>
           <div class="bi-vs"><span class="side a">${esc(pf.name)}</span><span class="vs">VS</span><span class="side b">${esc(rv.name)}</span></div>
           <div class="bi-stage">LIVE FROM ${esc(set.name)}</div>
         </div>`,
      );
      this.el.appendChild(intro);
      setTimeout(() => intro.remove(), 3300);
      return;
    }
    const intro = el(
      'div',
      'matchup-intro',
      caption || stageCap ? `<div class="mi mi-col">${stageCap}${caption}<div class="mi-row">${sides}</div></div>` : `<div class="mi">${sides}</div>`,
    );
    this.el.appendChild(intro);
    setTimeout(() => intro.remove(), 3100);
  }

  /** Mode strip text for the champion's current phase. */
  private bossStrip(phase: number): void {
    const def = this.bossDef;
    if (!def) return;
    const ph = def.phases[phase - 1];
    this.modeStrip.innerHTML = `<span class="ms-tag boss">BOSS</span><span class="ms-main">ФАЗА <b>${phase}</b>/${def.phases.length} · ${esc(ph.title)}</span>`;
    for (let i = 1; i <= def.phases.length; i++) this.el.classList.toggle(`boss-p${i}`, i === phase);
  }

  /** Short on-screen warning while the champion charges a signature move. */
  private bossWarn(name: string, counter: string, seconds: number): void {
    this.bossWarnEl?.remove();
    if (this.bossWarnTimer !== null) clearTimeout(this.bossWarnTimer);
    const w = el('div', 'boss-warn', `<b>⚠ ${esc(name)}</b><span>${esc(counter)}</span>`);
    // just below the mode strip, whatever the phone's safe area and HUD height
    w.style.top = `${Math.round(this.modeStrip.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top + 8)}px`;
    this.el.appendChild(w);
    this.bossWarnEl = w;
    this.bossWarnTimer = window.setTimeout(() => {
      w.remove();
      if (this.bossWarnEl === w) this.bossWarnEl = null;
      this.bossWarnTimer = null;
    }, Math.max(700, seconds * 1000 + 250));
  }

  /** DIRECTOR'S CUT alert: the clapper card in the middle of the screen while the rifle goes up. */
  private cutAlert(prep: number, empowered: boolean): void {
    this.cutAlertEl?.remove();
    const a = el(
      'div',
      'cut-alert' + (empowered ? ' final' : ''),
      `<div class="ca-clap"><i></i><i></i><i></i><i></i><i></i></div><b>DIRECTOR'S CUT!</b><span>${empowered ? 'FINAL CUT · ' : ''}3 выстрела по линиям прицела</span>`,
    );
    this.el.appendChild(a);
    // a third of the way down, but never over the shot tracker (short phones)
    const host = this.el.getBoundingClientRect();
    const below = this.cutEl ? this.cutEl.getBoundingClientRect().bottom - host.top + 12 : 0;
    a.style.top = `${Math.round(Math.max(host.height * 0.34, below))}px`;
    this.cutAlertEl = a;
    window.setTimeout(() => {
      a.remove();
      if (this.cutAlertEl === a) this.cutAlertEl = null;
    }, Math.max(1100, prep * 1000 + 650));
  }

  /** Live DIRECTOR'S CUT tracker: which shot, and whether its line still follows or has frozen. */
  private cutStatus(shot: number, state: 'prep' | 'aim' | 'lock' | 'gap', empowered: boolean): void {
    if (!this.cutEl) {
      this.bossWarnEl?.remove();
      this.bossWarnEl = null;
      if (this.bossWarnTimer !== null) clearTimeout(this.bossWarnTimer);
      this.bossWarnTimer = null;
      const w = el('div', 'boss-warn cut-warn');
      w.style.top = `${Math.round(this.modeStrip.getBoundingClientRect().bottom - this.el.getBoundingClientRect().top + 8)}px`;
      this.el.appendChild(w);
      this.cutEl = w;
    }
    const done = state === 'gap' ? shot + 1 : shot;
    const pips = [0, 1, 2].map((i) => `<i class="${i < done ? 'done' : i === shot && state !== 'gap' ? 'now' : ''}"></i>`).join('');
    const text =
      state === 'prep'
        ? 'Чемпион вскидывает винтовку'
        : state === 'aim'
          ? 'Линия следит за вами'
          : state === 'lock'
            ? 'ЗАСТЫЛА! DASH или SHIELD'
            : shot >= 2
              ? 'Чемпион открыт!'
              : 'Следующая линия…';
    this.cutEl.className = `boss-warn cut-warn ${state}${empowered ? ' final' : ''}`;
    this.cutEl.innerHTML = `<span class="cw-row"><b>⚠ DIRECTOR'S CUT</b><span class="cw-pips">${pips}</span></span><span class="cw-txt">${text}</span>`;
  }

  private clearCut(): void {
    this.cutAlertEl?.remove();
    this.cutAlertEl = null;
    this.cutEl?.remove();
    this.cutEl = null;
  }

  /** Fill the mode strip for Survival / Prime Challenge; returns the intro caption (empty for Classic). */
  private setupMode(mode: ModeSession): string {
    this.challenge = null;
    this.bossDef = null;
    this.modeLive = null;
    this.modeLiveTxt = '';
    this.bossWarnEl?.remove();
    this.bossWarnEl = null;
    this.clearCut();
    this.el.querySelectorAll('.phase-mark').forEach((x) => x.remove());
    this.el.classList.remove('boss-p1', 'boss-p2', 'boss-p3');
    this.el.classList.toggle('has-mode', mode.kind !== 'classic');
    this.el.dataset.mode = mode.kind;
    if (mode.kind === 'boss') {
      const def = bossById(mode.id);
      if (!def) return '';
      this.bossDef = def;
      this.bossStrip(1);
      // phase thresholds on the champion's health bar (it drains towards the right)
      const bar = this.hpBoxes[1].querySelector('.hp-bar') as HTMLElement;
      for (const ph of def.phases.slice(1)) {
        const mark = el('i', 'phase-mark');
        mark.style.left = `${(1 - ph.at) * 100}%`;
        bar.appendChild(mark);
      }
      return '';
    }
    if (mode.kind === 'survival') {
      const w = mode.wave;
      const run = this.g.modes.activeRun;
      const perks = run
        ? PERK_ORDER.filter((id) => id !== 'second_wind' && run.perks[id] > 0)
            .map((id) => `<span class="ms-perk p-${id}">${PERK_ICONS[id]}+${Math.round(run.perks[id] * PERKS[id].value * 100)}%</span>`)
            .join('')
        : '';
      this.modeStrip.innerHTML = `<span class="ms-tag">SURVIVAL</span><span class="ms-main">${w.final ? 'ФИНАЛЬНАЯ ВОЛНА' : `ВОЛНА <b>${w.index + 1}</b>/${w.total}`}</span>${perks ? `<span class="ms-perks">${perks}</span>` : ''}`;
      return `<div class="mi-cap ${w.final ? 'final' : ''}">${w.final ? 'SURVIVAL · FINAL WAVE' : `SURVIVAL · WAVE ${w.index + 1}/${w.total}`}</div>`;
    }
    if (mode.kind === 'challenge') {
      const def = challengeById(mode.id);
      this.challenge = def;
      if (!def) return '';
      const extra = def.goal.minRating !== undefined ? '<span class="ms-live" data-ms-live></span>' : def.mods.energyMult ? `<span class="ms-live on">⚡×${String(def.mods.energyMult).replace('.', ',')}</span>` : def.moneyMult !== 1 ? `<span class="ms-live on">$×${String(def.moneyMult).replace('.', ',')}</span>` : '';
      this.modeStrip.innerHTML = `<span class="ms-tag ch">${esc(def.hudTag)}</span><span class="ms-main"><i>Цель</i>${esc(def.goalShort)}</span>${extra}`;
      this.modeLive = this.modeStrip.querySelector('[data-ms-live]');
      return `<div class="mi-cap ch">PRIME CHALLENGE · ${esc(def.title)}</div>`;
    }
    this.modeStrip.innerHTML = '';
    return '';
  }

  /**
   * Screen fractions covered by the HUD: top bars and the hand at the bottom.
   * The battle camera frames the fighters inside what is left.
   */
  measureInsets(): { top: number; bottom: number } | null {
    const root = this.el.getBoundingClientRect();
    if (root.height < 100) return null;
    const below = this.el.classList.contains('has-mode') ? this.modeStrip : (this.el.querySelector('.rating-row') as HTMLElement);
    const top = below.getBoundingClientRect().bottom - root.top;
    const bottom = root.bottom - this.hudBottomEl.getBoundingClientRect().top;
    this.safeTop = top;
    return { top: Math.min(0.4, top / root.height), bottom: Math.min(0.45, bottom / root.height) };
  }

  tapCard(i: number): void {
    const m = this.m;
    if (!m || this.g.paused) return;
    // Real-time double-tap guard: the card that slides into this slot must not
    // be played by the second half of an accidental double tap.
    const now = performance.now();
    if (now - this.lastPlayAt[i] < 280) return;
    const card = m.hands[0].hand[i];
    const res = this.g.playCard(i);
    const slot = this.slots[i];
    const cardEl = slot.firstElementChild as HTMLElement | null;
    if (res === null) {
      this.lastPlayAt[i] = now;
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
    } else if (cardEl && res !== 'phase' && res !== 'cooldown') {
      // 'cooldown' is the short guard after a play: it only swallows accidental double taps.
      cardEl.classList.remove('shake');
      void cardEl.offsetWidth;
      cardEl.classList.add('shake');
      if (res === 'energy') this.flashEnergyNeed(CARDS[card].cost);
      const need = Math.ceil(CARDS[card].cost - m.hands[0].energy);
      const msg: Record<string, string> = {
        energy: `Ещё ${Math.max(1, need)} ⚡`,
        stunned: 'Боец оглушён',
        glitched: 'Система взломана',
        busy: 'Боец занят',
      };
      if (msg[res]) this.denyTip(i, msg[res]);
    }
  }

  /** Short reason above a card that could not be played. */
  private denyTip(i: number, text: string): void {
    this.denyTips[i]?.remove();
    const tip = el('div', 'deny-tip', esc(text));
    this.slots[i].appendChild(tip);
    this.denyTips[i] = tip;
    setTimeout(() => {
      tip.remove();
      if (this.denyTips[i] === tip) this.denyTips[i] = null;
    }, 950);
  }

  /** Light up the segments the player is still missing. */
  private flashEnergyNeed(cost: number): void {
    const m = this.m;
    if (!m) return;
    const have = Math.floor(m.hands[0].energy);
    const segs = this.energyBar.querySelectorAll('i');
    segs.forEach((seg, i) => seg.classList.toggle('need', i >= have && i < cost));
    this.energyBar.classList.remove('deny');
    void this.energyBar.offsetWidth;
    this.energyBar.classList.add('deny');
    this.energyNeedT = 0.6;
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
          cardEl.insertAdjacentHTML(
            'beforeend',
            `<div class="drain"></div><div class="combo-ribbon">COMBO</div><div class="combo-link">КОМБО ▸</div><div class="lock-overlay"></div>`,
          );
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
      this.hpBoxes[side].classList.toggle('low', frac < 0.25 && !f.ko);
      this.lag[side] = this.lag[side] > frac ? damp(this.lag[side], frac, 3, dt) : frac;
      this.hpLag[side].style.transform = `scaleX(${this.lag[side]})`;
      const txt = `${Math.ceil(f.hp).toLocaleString('ru-RU')}`;
      if (this.hpNum[side].textContent !== txt) this.hpNum[side].textContent = txt;
      // statuses: only the most important few, so the top bar stays readable
      const on: Record<string, boolean> = {
        stun: f.stun > 0,
        glitch: f.glitch > 0,
        shield: f.shield > 0,
        overdrive: f.overdrive > 0,
        adrenaline: f.adrenaline > 0,
        smoke: m.inOwnSmoke(f),
        momentum: f.momentum > 0,
        ironSkin: f.ironSkin > 0,
        overclock: f.overclock > 0,
        feint: f.feint > 0,
        zap: f.zap > 0,
        riposte: f.riposte,
      };
      const st: string[] = [];
      for (const s of STATUS_ORDER) {
        if (on[s.key] && st.length < MAX_STATUS) st.push(`<span class="st" style="color:${s.color}">${s.label}</span>`);
      }
      const key = st.join('');
      if (key !== this.statusKey[side]) {
        this.statusKey[side] = key;
        this.status[side].innerHTML = key;
      }
    }
    // timer
    const sec = Math.ceil(m.phase === 'intro' ? m.duration : m.timeLeft);
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
    const tier = rt >= 75 ? 'PRIME TIME' : rt >= 50 ? 'ЖАРКО' : rt >= 32 ? 'ИНТЕРЕСНО' : 'ТИХО';
    if (tier !== this.tierText) {
      this.tierText = tier;
      this.tierEl.textContent = tier;
    }
    if (this.energyNeedT > 0) {
      this.energyNeedT -= dt;
      if (this.energyNeedT <= 0) this.energyBar.querySelectorAll('i.need').forEach((s) => s.classList.remove('need'));
    }
    const viewers = formatNumber(m.broadcast.viewers(m.cfg.fans));
    if (this.viewersEl.textContent !== viewers) this.viewersEl.textContent = viewers;
    // PRIME SPOTLIGHT: the final rating as the results screen will compute it right now
    if (this.modeLive && this.challenge?.goal.minRating !== undefined) {
      const proj = m.broadcast.finalRating();
      const t = `ИТОГ ${proj}`;
      if (t !== this.modeLiveTxt) {
        this.modeLiveTxt = t;
        this.modeLive.textContent = t;
        this.modeLive.classList.toggle('on', proj >= this.challenge.goal.minRating);
      }
    }

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
    const primedNow = m.phase === 'fight' && hand.hand.some((c) => !!c && !!m.combos.wouldCombo(0, c, m.time));
    let openers = 0;
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
      // Chain badge: this card opens a combo with another card already in hand
      // (same rules as ComboSystem). Hidden while a combo is primed.
      const opener = m.phase === 'fight' && !primedNow && hand.hand.some((o, j) => j !== i && !!o && !!comboFor(c, o));
      cardEl.classList.toggle('opener', opener);
      if (opener) openers++;
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
    this.comboStrip.classList.toggle('urgent', !!comboPrimed && win > 0 && win < 1);
    if (comboPrimed) {
      this.comboTrack.style.transform = `scaleX(${win / MATCH.comboWindow})`;
      if (!this.hints.combo && !g.save.data.hintsSeen) {
        this.hints.combo = true;
        this.showHint(`<b>КОМБО ГОТОВО</b><br/>Золотая карта сработает как комбо — сыграйте её за ${MATCH.comboWindow} с, пока идёт полоска!`);
      }
    } else if (openers > 0 && !this.hints.opener && !this.hintEl && m.time > 8 && !g.save.data.hintsSeen) {
      this.hints.opener = true;
      this.showHint('<b><span class="hint-link">КОМБО ▸</span> ПОДСКАЗКА</b><br/>Карта с этой меткой начинает комбо. Сыграйте её — и вторая карта пары засветится золотом.', 5);
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
      const rise = f.rise * (1 - Math.pow(1 - k, 3)) * 60 + f.lift;
      const sc = k < 0.15 ? 0.5 + (k / 0.15) * 0.8 : k < 0.3 ? 1.3 - ((k - 0.15) / 0.15) * 0.3 : 1;
      // keep clear of the top bars and the rating pops right under them
      const y = Math.max(this.safeTop + 40, _p.y - rise);
      f.el.style.transform = `translate3d(${_p.x + f.ox}px, ${y}px, 0) translate(-50%, -50%) scale(${sc})`;
      f.el.style.opacity = String(k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1);
    }
    // head tags
    for (const side of [0, 1] as Side[]) {
      const f = m.fighters[side];
      const tag = this.headTags[side];
      view.headPos(side, _v);
      view.project(_v.x, _v.y, _v.z, _p);
      const minY = this.safeTop + (side === 1 && this.enemyWarn ? 36 : 10);
      tag.style.transform = `translate3d(${_p.x}px, ${Math.max(minY, _p.y)}px, 0) translate(-50%, -100%)`;
      tag.style.display = f.ko || m.phase !== 'fight' ? 'none' : '';
      this.headBars[side].style.transform = `scaleX(${f.hpFrac})`;
      const warn = side === 1 && f.action.kind === 'windup';
      if (warn !== this.enemyWarn && side === 1) {
        this.enemyWarn = warn;
        tag.classList.toggle('warn', warn);
      }
    }

    // rating pops age out
    for (let i = this.ratingPops.length - 1; i >= 0; i--) {
      const p = this.ratingPops[i];
      p.t += dt;
      if (p.t > 1.25) {
        p.el.remove();
        this.ratingPops.splice(i, 1);
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
    f.lift = 0;
    f.callSide = -1;
    f.el.className = cls;
    f.el.textContent = text;
    f.el.style.color = '';
    f.el.style.display = '';
    f.sum = 0;
    f.side = -1;
    return f;
  }

  /** Text above a fighter. At most two per fighter, stacked instead of overlapping. */
  callout(side: Side, text: string, color = '#fff'): void {
    const m = this.m;
    if (!m) return;
    const f = m.fighters[side];
    const mine = this.floaters.filter((q) => q.active && q.callSide === side).sort((a, b) => b.t - a.t);
    if (mine.length >= 2) {
      mine[0].active = false;
      mine[0].el.style.display = 'none';
      mine.shift();
    }
    const c = this.spawnFloater(text, 'callout', f.x, 2.9, f.z, 1.1, 0.6);
    c.el.style.color = color;
    c.callSide = side;
    c.ox = 0;
    c.lift = mine.length ? Math.max(...mine.map((q) => q.lift)) + 22 : 0;
  }

  private showBanner(b: Banner): void {
    const ultra = b.text === 'ELECTRO BLAST' || b.text === 'SUPERSTAR MOVE';
    const e = el(
      'div',
      `banner t${b.tier}${b.text.length > 12 ? ' long' : ''}${ultra ? ' ultra' : ''}${b.detail ? ' has-detail' : ''}`,
      `<span class="bt">${esc(b.text)}</span>${b.sub ? `<span class="bs">${esc(b.sub)}</span>` : ''}${b.detail ? `<span class="bd">${esc(b.detail)}</span>` : ''}`,
    );
    this.bannerZone.innerHTML = '';
    this.bannerZone.appendChild(e);
    this.bannerT = b.tier >= 3 ? 1.3 : 0.9;
    this.bannerTier = b.tier;
    setTimeout(() => e.remove(), b.detail ? 2300 : 1750);
    this.g.audio.reaction(b.tier);
  }

  private queueBanner(b: Banner): void {
    if (b.tier >= 3) {
      this.bannerQueue = this.bannerQueue.filter((x) => x.tier >= 3);
      this.bannerQueue.push(b);
      // A big moment cuts a minor banner short instead of waiting behind it.
      if (this.bannerTier < 3) this.bannerT = 0;
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

  /** Tutorial hint, docked just above the hand so it never covers the cards. */
  private showHint(html: string, dur = 4.5): void {
    this.hintEl?.remove();
    this.hintEl = el('div', 'hint', html);
    this.hudBottomEl.appendChild(this.hintEl);
    this.hintT = dur;
  }

  /** Rating changes under the meter: same reasons merge, at most two at once. */
  private ratingPop(amount: number, label: string): void {
    const same = this.ratingPops.find((p) => p.label === label && p.t < 0.9 && Math.sign(p.amount) === Math.sign(amount));
    if (same) {
      same.amount += amount;
      same.t = 0;
      same.el.textContent = `${same.amount > 0 ? '+' : ''}${same.amount} ${label}`;
      same.el.style.animation = 'none';
      void same.el.offsetWidth;
      same.el.style.animation = '';
      return;
    }
    if (this.ratingPops.length >= 2) this.ratingPops.shift()!.el.remove();
    const e = el('div', 'rating-pop' + (amount < 0 ? ' neg' : ''));
    e.textContent = `${amount > 0 ? '+' : ''}${amount} ${label}`;
    this.pops.appendChild(e);
    this.ratingPops.push({ el: e, label, amount, t: 0 });
  }

  onEvent(e: MatchEvent): void {
    const m = this.m;
    if (!m) return;
    switch (e.type) {
      case 'countdown':
        this.big(e.n > 0 ? String(e.n) : 'FIGHT!', e.n > 0 ? '' : 'fight');
        break;
      case 'phase':
        if (e.phase === 'outro') this.clearCut();
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
        // The player's perfect dodge already gets a banner and a rating pop.
        if (e.perfect && e.side === 1) this.callout(1, 'PERFECT DODGE', '#9af6ff');
        else if (!e.perfect && e.heavy) this.callout(e.side, 'НА ВОЛОСОК', '#c8d4ff');
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
        // Passives show as status chips under the health bar (less overlap over the fighters).
        break;
      case 'shieldBreak':
        this.callout(e.side, 'ЩИТ СЛОМАН', '#9ad8ff');
        break;
      case 'decoyPop':
        if (e.hit) this.spawnFloater('ПРИМАНКА!', 'callout', e.x, 2.4, e.z, 0.9, 0.6);
        break;
      case 'telegraph':
        if (e.side === 1 && this.bossDef && e.card === 'charged_shot' && !this.cutEl) {
          const mv = this.bossDef.moves.find((x) => x.id === 'spotlight');
          if (mv) this.bossWarn(mv.name, 'Уйдите с красной линии рывком DASH', e.duration);
        }
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
        if (e.side === 0) {
          const ultra = e.combo === 'superstar' || e.combo === 'electro_blast';
          this.edgeGlow.className = 'edge-glow';
          void this.edgeGlow.offsetWidth;
          this.edgeGlow.className = 'edge-glow on' + (ultra ? ' ultra' : '');
          vibrate(ultra ? [20, 40, 30] : 18);
        }
        break;
      case 'rating':
        if (e.label && Math.abs(e.amount) >= 1) this.ratingPop(e.amount, e.label);
        break;
      case 'reaction': {
        const pc = this.pendingCombo;
        const detail = pc && pc.name === e.text ? pc.detail : undefined;
        if (detail) this.pendingCombo = null;
        this.queueBanner({ text: e.text, sub: e.sub, tier: e.tier, detail });
        break;
      }
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
        if (e.side === 0) {
          if (e.combo && this.prevCard) {
            // Explain the payoff: which two cards made it and what it gives.
            const def = COMBOS.find((x) => x.id === e.combo)!;
            this.pendingCombo = { name: def.name, detail: `${CARDS[this.prevCard].name} → ${c.name} · ${def.bonus}` };
          }
          this.prevCard = e.card;
          // The combo banner already names the move; skip the duplicate card callout.
          if (!e.combo) this.callout(0, c.name, c.color);
        } else {
          // Rival combos name the combo instead of the card (one label, not two);
          // the champion's cards carry his signature names.
          const rc = e.combo ? COMBOS.find((x) => x.id === e.combo)! : null;
          const bossName = this.bossDef?.cardNames[e.card];
          // DIRECTOR'S CUT has its own big alert
          if (e.card !== 'directors_cut' || rc) this.callout(1, (rc ? rc.name : (bossName ?? c.name)) + '!', bossName ? '#ffd76a' : '#ff8a7a');
        }
        break;
      }
      case 'bossPhase': {
        const def = this.bossDef;
        if (!def) break;
        const ph = def.phases[e.phase - 1];
        this.bossStrip(e.phase);
        this.queueBanner({ text: ph.title, sub: `ФАЗА ${e.phase} · ${def.phases.length === e.phase ? 'ФИНАЛ' : 'НОВЫЙ ТЕМП'}`, tier: 3 });
        this.screenFlash(0.5);
        vibrate([30, 40, 30]);
        break;
      }
      case 'bossMove':
        if (e.move === 'star') this.callout(1, 'STAR POWER!', '#ffd76a');
        break;
      case 'cutStart':
        this.cutStatus(0, 'prep', e.empowered);
        this.cutAlert(e.prep, e.empowered);
        vibrate(20);
        break;
      case 'cutAim':
        this.cutStatus(e.shot, 'aim', e.empowered);
        break;
      case 'cutLock':
        this.cutStatus(e.shot, 'lock', e.empowered);
        vibrate(14);
        break;
      case 'cutShot':
        this.cutStatus(e.shot, 'gap', e.empowered);
        if (e.outcome === 'decoy') this.callout(0, 'ПРИМАНКА ПРИНЯЛА!', '#c8a0ff');
        break;
      case 'cutEnd':
        this.cutEl?.remove();
        this.cutEl = null;
        this.cutAlertEl?.remove();
        this.cutAlertEl = null;
        if (e.completed) this.callout(e.side, 'ЧЕМПИОН ОТКРЫТ!', '#9dff5c');
        break;
      case 'cardFail':
        break;
      default:
        break;
    }
  }

  onHide(): void {
    this.hintEl?.remove();
    this.hintEl = null;
    this.bossWarnEl?.remove();
    this.bossWarnEl = null;
    this.clearCut();
    if (this.bossWarnTimer !== null) clearTimeout(this.bossWarnTimer);
    this.bossWarnTimer = null;
  }
}
