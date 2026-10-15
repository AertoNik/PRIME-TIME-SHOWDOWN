import { MATCH } from '../config/balance';
import { eventSettings, type EventSettings } from '../config/events.config';
import { FIGHTERS, RIVALS } from '../config/fighters';
import type { Difficulty, FighterId, RivalId } from '../config/types';
import { AudioSystem } from '../audio/AudioSystem';
import { Match } from '../combat/Match';
import type { CardFailReason, MatchEvent } from '../combat/types';
import { CareerSystem } from '../meta/CareerSystem';
import { EventManager, type MatchEventOutcome } from '../meta/EventManager';
import { SaveSystem, type CameraMotion } from '../meta/SaveSystem';
import { Arena } from '../render/Arena';
import { BattleView, type TimeFx } from '../render/BattleView';
import { CameraRig } from '../render/CameraRig';
import { ModelCache } from '../render/ModelCache';
import { renderPortraits } from '../render/PortraitStudio';
import { Renderer, type QualitySetting } from '../render/Renderer';
import { Showcase } from '../render/Showcase';
import { VFX } from '../render/VFX';
import { BattleHUD } from '../ui/screens/BattleHUD';
import { CareerScreen } from '../ui/screens/CareerScreen';
import { EventsScreen } from '../ui/screens/EventsScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { PrepScreen } from '../ui/screens/PrepScreen';
import { ResultsScreen } from '../ui/screens/ResultsScreen';
import { RosterScreen } from '../ui/screens/RosterScreen';
import { TitleScreen } from '../ui/screens/TitleScreen';
import { UIManager } from '../ui/UI';
import { ThemeManager } from './ThemeManager';
import { isBlockedLandscape, onLandscapeChange } from '../ui/viewport';

export type ScreenName = 'title' | 'menu' | 'roster' | 'prep' | 'career' | 'events' | 'battle' | 'results';

/**
 * Developer-only switches, read from the address bar in `npm run dev` only:
 *   ?event=halloween-2026 | winter-preview | none   force an event (manual mode)
 *   ?now=2026-10-25                                 pretend it is this date (auto mode)
 * The published build ignores them, so players cannot change seasons.
 */
function devEventOverrides(): { settings: EventSettings; clock?: () => number } {
  if (!import.meta.env.DEV) return { settings: eventSettings };
  const qs = new URLSearchParams(location.search);
  const ev = qs.get('event');
  const now = qs.get('now');
  const settings: EventSettings = ev ? { mode: 'manual', forcedEventId: ev } : eventSettings;
  const t = now ? Date.parse(now.length <= 10 ? now + 'T12:00:00Z' : now) : NaN;
  return Number.isFinite(t) ? { settings, clock: () => t + (performance.now() - bootT) } : { settings };
}
const bootT = performance.now();

const ALL_LOOKS = ['ray', 'bruno', 'nika', 'vega', 'dex', 'tank', 'zoe', 'crash'];

/** Next frame, with a timer fallback in case rAF is throttled or paused. */
const nextFrame = () =>
  new Promise<void>((r) => {
    let done = false;
    const go = () => {
      if (!done) {
        done = true;
        r();
      }
    };
    if (!document.hidden) requestAnimationFrame(go);
    setTimeout(go, 40);
  });

/** Top-level state machine wiring simulation, rendering, UI, audio and career. */
export class Game {
  readonly ui: UIManager;
  readonly audio = new AudioSystem();
  readonly save = new SaveSystem();
  readonly career: CareerSystem;
  readonly events: EventManager;
  themes!: ThemeManager;
  renderer!: Renderer;
  arena!: Arena;
  vfx!: VFX;
  cam!: CameraRig;
  models = new ModelCache();
  battleView!: BattleView;
  showcase!: Showcase;
  readonly timeFx: TimeFx = { hitstop: 0, slowmo: 0, slowScale: 1 };
  portraits: Record<string, string> = {};

  match: Match | null = null;
  paused = false;
  private matchMeta: { fighter: FighterId; rival: RivalId; difficulty: Difficulty } | null = null;
  /** Event that was running when the current match started (its quests get the result). */
  private matchEventId: string | null = null;
  private seasonCheckT = 0;
  private resultsShown = false;
  private acc = 0;
  private last = 0;
  private screen: ScreenName = 'title';
  private stage: HTMLElement;
  private title: TitleScreen;
  private hud!: BattleHUD;
  private started = false;
  private bootDone = false;
  private debugTimer = new URLSearchParams(location.search).has('timerloop');
  /** Debug: ?speed=4 fast-forwards the simulation (automated checks only). */
  private debugSpeed = Math.max(1, Math.min(8, Number(new URLSearchParams(location.search).get('speed')) || 1));

  constructor(stage: HTMLElement, uiRoot: HTMLElement) {
    this.stage = stage;
    this.career = new CareerSystem(this.save);
    this.events = new EventManager(this.save, devEventOverrides());
    this.ui = new UIManager(uiRoot);
    this.ui.onSoundToggle = () => this.toggleSound();
    this.ui.setSoundIcon(this.save.data.settings.sound);
    this.audio.soundOn = this.save.data.settings.sound;
    this.audio.musicOn = this.save.data.settings.music;
    this.title = new TitleScreen(() => this.onTitleTap());
    this.ui.register('title', this.title);
    this.ui.show('title');
    window.addEventListener('keydown', (e) => this.onKey(e));
    // iOS Safari only unlocks audio inside certain gestures: retry on any tap.
    const retryAudio = () => {
      if (this.started) this.audio.unlock();
    };
    window.addEventListener('touchend', retryAudio, { passive: true });
    window.addEventListener('click', retryAudio);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.screen === 'battle' && this.match?.phase === 'fight' && !this.paused) this.pause();
      if (!this.debugTimer) this.audio.setHidden(document.hidden);
      if (!document.hidden) this.onReturn();
    });
    // Coming back from the bfcache (iOS back/forward, app switcher) may skip visibilitychange.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        this.audio.setHidden(false);
        this.onReturn();
      }
    });
    // Phone turned sideways: the rotate overlay covers the game, so stop the fight.
    onLandscapeChange((blocked) => {
      if (blocked && this.screen === 'battle' && this.match?.phase === 'fight' && !this.paused) this.pause();
    });
  }

  /** Tab/app is visible again: fresh frame timing and quality stats, re-fit the layout. */
  private onReturn(): void {
    this.last = performance.now();
    if (!this.bootDone) return;
    this.renderer.resetMonitor(this.last / 1000);
    this.updateLayoutFraming();
  }

  // ------------------------------------------------------------------ boot
  async boot(): Promise<void> {
    this.title.setProgress(0.05);
    try {
      await Promise.race([
        Promise.all([document.fonts.load('900 64px Unbounded', 'PRIME TIME'), document.fonts.load('700 28px Rubik', 'РЕЙТИНГ')]),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      /* fonts are optional */
    }
    this.title.setProgress(0.15);
    await nextFrame();
    this.renderer = new Renderer(this.stage);
    this.renderer.setQualitySetting(this.save.data.settings.quality);
    this.arena = new Arena();
    this.renderer.scene.add(this.arena.group);
    this.title.setProgress(0.35);
    await nextFrame();
    this.vfx = new VFX(this.renderer.scene);
    this.cam = new CameraRig(this.renderer);
    this.applyCameraMotion(this.save.data.settings.camera);
    this.showcase = new Showcase(this.models);
    this.renderer.scene.add(this.showcase.group);
    this.battleView = new BattleView(this.renderer, this.arena, this.vfx, this.cam, this.models, this.timeFx);
    this.themes = new ThemeManager({ renderer: this.renderer, arena: this.arena, battleView: this.battleView, audio: this.audio, uiRoot: this.ui.root });
    this.themes.apply(this.events.themeId);
    this.themes.setMotion(this.cam.intensity);
    this.applyCosmetics();
    this.renderer.onQuality = (q) => this.themes?.setLowQuality(q === 'low');
    for (let i = 0; i < ALL_LOOKS.length; i++) {
      this.models.get(ALL_LOOKS[i]);
      this.title.setProgress(0.4 + (i / ALL_LOOKS.length) * 0.35);
      await nextFrame();
    }
    this.portraits = renderPortraits(this.renderer, this.models, ALL_LOOKS);
    this.title.setProgress(0.85);
    await nextFrame();

    this.hud = new BattleHUD(this);
    this.renderer.onResize = () => this.updateLayoutFraming();
    this.ui.register('menu', new MenuScreen(this));
    this.ui.register('roster', new RosterScreen(this));
    this.ui.register('prep', new PrepScreen(this));
    this.ui.register('career', new CareerScreen(this));
    this.ui.register('events', new EventsScreen(this));
    this.ui.register('battle', this.hud);
    this.ui.register('results', new ResultsScreen(this));

    const f = FIGHTERS[this.save.data.selected];
    this.showcase.show(f.look, f.theme.accent);
    this.cam.showcaseShift = 0.05;
    this.cam.showcaseDist = 9.5;
    // Warm up shaders with one render so the first menu frame doesn't hitch.
    this.renderer.render(0.016);
    this.last = performance.now();
    this.loop();
    this.bootDone = true;
    this.title.setReady();
    // Debug: ?autostart jumps straight into a match (used for automated checks).
    const qs = new URLSearchParams(location.search);
    if (qs.has('autostart')) {
      this.onTitleTap();
      this.startMatch();
    }
  }

  /** Desktop shortcuts: 1/2/3 play cards, Esc pauses, Enter/Space starts. */
  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
    if (this.screen === 'title' && (e.key === 'Enter' || e.key === ' ')) {
      this.onTitleTap();
      return;
    }
    if (this.screen !== 'battle') return;
    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (this.paused) {
        this.ui.closeModal();
        this.resume();
      } else this.pause();
      return;
    }
    const idx = ['1', '2', '3'].indexOf(e.key);
    if (idx >= 0 && !this.paused) this.hud.tapCard(idx);
  }

  private onTitleTap(): void {
    if (this.started || !this.bootDone) return;
    this.started = true;
    this.audio.unlock();
    this.audio.setSound(this.save.data.settings.sound);
    this.audio.setMusic(this.save.data.settings.music);
    this.audio.ui('confirm');
    this.goto('menu');
  }

  // ------------------------------------------------------------ navigation
  goto(name: Exclude<ScreenName, 'title' | 'battle' | 'results'>, param?: unknown): void {
    if (this.screen === 'battle' || this.screen === 'results') this.endBattleView();
    this.screen = name;
    this.refreshSeason();
    const f = FIGHTERS[this.save.data.selected];
    this.showcase.show(f.look, f.theme.accent);
    this.cam.setMode('showcase', 1.0);
    this.cam.showcaseShift = name === 'roster' ? 0.205 : name === 'menu' ? 0.06 : 0.26;
    this.cam.showcaseDist = name === 'roster' ? 16 : name === 'menu' ? 9.6 : 10;
    this.arena.setScreen({ mode: 'menu', headline: this.save.data.orgName });
    this.audio.playTrack('menu');
    this.audio.setCrowd(0.12);
    this.ui.showSoundFab(true);
    this.ui.show(name, param);
    this.frameShowcase();
  }

  /**
   * Fit the 3D fighter into the free gap of the menu/roster layout, so it is
   * neither hidden behind panels on short phones nor tiny on tall ones.
   */
  private frameShowcase(): void {
    const sel = this.screen === 'menu' ? '.menu .fill.pass' : this.screen === 'roster' ? '.roster .drag-zone' : null;
    const gap = sel ? (this.ui.root.querySelector(sel) as HTMLElement | null) : null;
    const h = this.renderer.size.h;
    if (!gap || h < 100) return;
    // offsetTop is relative to the screen (= frame) and ignores the slide-in transform.
    const top = gap.offsetTop;
    const gh = gap.offsetHeight;
    const CHAR_H = 2.35; // world units, feet to hair
    const LOOK_H = this.cam.showcaseHeight;
    const K = 1.58; // px per world unit = K * h / distance (fov 34)
    const fill = this.screen === 'roster' ? 0.86 : 0.9;
    const charPx = Math.min(h * 0.46, Math.max(gh * fill, h * 0.2));
    const dist = Math.min(18, Math.max(6.5, (K * h * CHAR_H) / charPx));
    const ppu = (K * h) / dist;
    const feetY = top + (gh + CHAR_H * ppu) / 2;
    const lookY = feetY - LOOK_H * ppu;
    this.cam.showcaseDist = dist;
    this.cam.showcaseShift = Math.max(-0.2, Math.min(0.4, 0.5 - lookY / h));
  }

  private endBattleView(): void {
    this.battleView.teardown();
    this.match = null;
    this.matchMeta = null;
    this.paused = false;
    this.ui.closeModal();
    this.timeFx.hitstop = 0;
    this.timeFx.slowmo = 0;
    this.timeFx.slowScale = 1;
  }

  /**
   * Re-check the event calendar; when a season starts or ends, switch the theme.
   * Never called mid-fight, so a match always finishes in the look it started with.
   */
  refreshSeason(): boolean {
    if (!this.events.refresh()) return false;
    this.themes?.apply(this.events.themeId);
    const e = this.events.active;
    if (this.bootDone) {
      this.ui.toast(e ? `${e.title}: событие началось!` : 'Сезонное событие завершилось. Награды остаются в коллекции.', !!e);
      if (e) this.themes?.sting();
    }
    return true;
  }

  /** Push equipped cosmetics to the UI and the battle renderer. */
  applyCosmetics(): void {
    this.themes?.applyCosmetics(this.save.data.cosmetics.equipped);
  }

  /** Re-fit the camera to the HUD after layout changes (rotation, address bar, window resize). */
  private updateLayoutFraming(): void {
    if (!this.hud) return;
    if (this.screen === 'menu' || this.screen === 'roster') this.frameShowcase();
    const ins = this.hud.measureInsets();
    if (ins) {
      this.cam.hudTop = ins.top;
      this.cam.hudBottom = ins.bottom;
    }
  }

  rivalName(id: RivalId): string {
    return RIVALS[id].name;
  }

  // ---------------------------------------------------------------- battle
  startMatch(): void {
    if (this.screen === 'battle' || this.screen === 'results') this.endBattleView();
    const s = this.save.data;
    const fighter = s.selected;
    const difficulty = this.career.difficultyUnlocked(s.difficulty) ? s.difficulty : 'rookie';
    const rival = s.nextRival;
    const match = new Match({
      fighter,
      deck: s.fighters[fighter].deck.slice(),
      rival,
      difficulty,
      seed: (s.seed + s.matches * 7919 + Math.floor(performance.now())) >>> 0,
      fans: s.fighters[fighter].fans,
    });
    this.match = match;
    this.matchMeta = { fighter, rival, difficulty };
    this.matchEventId = this.events.playable ? this.events.active!.id : null;
    this.resultsShown = false;
    this.paused = false;
    this.acc = 0;
    this.timeFx.hitstop = 0;
    this.timeFx.slowmo = 0;
    this.timeFx.slowScale = 1;
    this.showcase.hide();
    this.battleView.setup(match);
    this.hud.setup(match);
    this.cam.setMode('battle', 1.9);
    this.cam.finishShift = 0.04;
    this.cam.finishDist = 7.5;
    this.screen = 'battle';
    this.ui.showSoundFab(false);
    this.ui.show('battle');
    this.updateLayoutFraming();
    this.audio.playTrack('battle');
    this.audio.cheer(1);
    // Started while the phone is sideways (overlay visible): wait paused.
    if (isBlockedLandscape()) this.pause();
  }

  playCard(index: number): CardFailReason | null {
    if (!this.match || this.paused) return 'phase';
    return this.match.playCard(0, index);
  }

  pause(): void {
    if (!this.match || this.screen !== 'battle' || this.match.phase === 'over' || this.paused) return;
    this.paused = true;
    this.audio.ui('click');
    const render = () => {
      const s = this.save.data.settings;
      this.ui.modal(
        `<div class="h1">Пауза</div>
         <div class="toggle-row"><span>Звук</span><button class="switch ${s.sound ? 'on' : ''}" data-t="sound"></button></div>
         <div class="toggle-row"><span>Музыка</span><button class="switch ${s.music ? 'on' : ''}" data-t="music"></button></div>
         <div class="modal-actions">
           <button class="btn teal wide" data-a="resume">Продолжить</button>
           <button class="btn ghost wide" data-a="help">Как играть</button>
           <button class="btn ghost wide" data-a="forfeit">Сдаться</button>
         </div>`,
        (root, close) => {
          root.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const tg = t.closest('[data-t]') as HTMLElement | null;
            if (tg) {
              if (tg.dataset.t === 'sound') this.toggleSound();
              else this.toggleMusic();
              render();
              return;
            }
            const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset.a;
            if (a === 'resume') {
              close();
              this.resume();
            } else if (a === 'help') {
              this.openHelp(() => this.pause());
            } else if (a === 'forfeit') {
              close();
              this.confirm('Сдаться?', 'Бой будет засчитан как поражение, а гонорар — урезан.', 'Сдаться', () => {
                this.paused = false;
                this.match?.forfeit();
              }, () => {
                this.paused = false;
                this.pause();
              });
            }
          });
        },
        false,
      );
    };
    render();
  }

  resume(): void {
    this.paused = false;
    this.last = performance.now();
    this.audio.ui('click');
  }

  private finishMatch(): void {
    const m = this.match;
    if (!m || !m.result || !this.matchMeta || this.resultsShown) return;
    this.resultsShown = true;
    const meta = this.matchMeta;
    const outcome = this.career.applyMatch(m.result, meta.fighter, meta.difficulty, meta.rival);
    const eventOutcome: MatchEventOutcome | null = this.events.applyMatch(this.matchEventId, m.result, meta.difficulty);
    if (!this.save.data.hintsSeen) {
      this.save.data.hintsSeen = true;
      this.save.save();
    }
    this.screen = 'results';
    // Lift the celebrating winner above the results panels.
    this.cam.finishShift = 0.35;
    this.cam.finishDist = 18.5;
    this.ui.showSoundFab(true);
    this.audio.playTrack('none');
    if (m.result.outcome === 'win') this.audio.victory();
    else if (m.result.outcome === 'loss') this.audio.defeat();
    else this.audio.reaction(2);
    setTimeout(() => {
      if (this.screen === 'results') this.audio.playTrack('menu');
    }, 3000);
    this.ui.show('results', { result: m.result, outcome, event: eventOutcome, ...meta });
  }

  // -------------------------------------------------------------- settings
  toggleSound(): void {
    const s = this.save.data.settings;
    s.sound = !s.sound;
    this.audio.unlock();
    this.audio.setSound(s.sound);
    this.ui.setSoundIcon(s.sound);
    this.save.save();
    if (s.sound) this.audio.ui('click');
  }

  toggleMusic(): void {
    const s = this.save.data.settings;
    s.music = !s.music;
    this.audio.setMusic(s.music);
    this.save.save();
  }

  applyCameraMotion(c: CameraMotion): void {
    this.cam.intensity = c === 'full' ? 1 : c === 'reduced' ? 0.45 : 0;
    this.themes?.setMotion(this.cam.intensity);
  }

  setCameraMotion(c: CameraMotion): void {
    this.save.data.settings.camera = c;
    this.save.save();
    this.applyCameraMotion(c);
  }

  setQuality(q: QualitySetting): void {
    this.save.data.settings.quality = q;
    this.save.save();
    this.renderer.setQualitySetting(q);
  }

  openSettings(): void {
    const render = () => {
      const s = this.save.data.settings;
      const qBtn = (q: QualitySetting, label: string) => `<button class="${s.quality === q ? 'on' : ''}" data-q="${q}">${label}</button>`;
      const camBtn = (c: CameraMotion, label: string) => `<button class="${s.camera === c ? 'on' : ''}" data-cam="${c}">${label}</button>`;
      this.ui.modal(
        `<div class="h1">Настройки</div>
         <div class="toggle-row"><span>Звук</span><button class="switch ${s.sound ? 'on' : ''}" data-t="sound"></button></div>
         <div class="toggle-row"><span>Музыка</span><button class="switch ${s.music ? 'on' : ''}" data-t="music"></button></div>
         <div style="padding:12px 0 4px" class="label">Качество графики</div>
         <div class="seg-control" style="grid-template-columns:repeat(4,1fr)">${qBtn('auto', 'Авто')}${qBtn('high', 'Высок.')}${qBtn('medium', 'Средн.')}${qBtn('low', 'Низк.')}</div>
         <div style="padding:12px 0 4px" class="label">Движение камеры</div>
         <div class="seg-control">${camBtn('full', 'Полное')}${camBtn('reduced', 'Сниженное')}${camBtn('off', 'Без тряски')}</div>
         <div class="muted" style="font-size:11px;margin-top:6px">Сейчас: ${this.renderer.quality === 'high' ? 'высокое' : this.renderer.quality === 'medium' ? 'среднее' : 'низкое'}${this.save.persistent ? '' : ' · ⚠ сохранения недоступны в этом режиме браузера'}</div>
         <div class="modal-actions">
           <button class="btn ghost wide" data-a="help">Как играть</button>
           <button class="btn ghost wide" data-a="reset">Сбросить прогресс</button>
           <button class="btn teal wide" data-a="close">Готово</button>
         </div>`,
        (root, close) => {
          root.addEventListener('click', (e) => {
            const t = e.target as HTMLElement;
            const tg = t.closest('[data-t]') as HTMLElement | null;
            if (tg) {
              if (tg.dataset.t === 'sound') this.toggleSound();
              else this.toggleMusic();
              render();
              return;
            }
            const cb = t.closest('[data-cam]') as HTMLElement | null;
            if (cb) {
              this.audio.ui('click');
              this.setCameraMotion(cb.dataset.cam as CameraMotion);
              render();
              return;
            }
            const qb = t.closest('[data-q]') as HTMLElement | null;
            if (qb) {
              this.audio.ui('click');
              this.setQuality(qb.dataset.q as QualitySetting);
              render();
              return;
            }
            const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset.a;
            if (a === 'close') {
              this.audio.ui('click');
              close();
            } else if (a === 'help') {
              this.openHelp(() => this.openSettings());
            } else if (a === 'reset') {
              this.confirm('Сбросить прогресс?', 'Деньги, бойцы, фанаты и цели будут удалены. Это действие нельзя отменить.', 'Сбросить', () => {
                this.save.reset();
                this.applyCosmetics();
                this.ui.toast('Прогресс сброшен. Новый сезон начинается!');
                this.goto('menu');
              });
            }
          });
        },
      );
    };
    render();
  }

  openHelp(back: () => void): void {
    this.ui.modal(
      `<div class="h1">Как играть</div>
       <div class="scroll" style="max-height:calc(var(--app-h) * 0.52);font-size:13px;line-height:1.45;color:#c8d0f4">
         <p><b style="color:var(--teal)">Вы — продюсер.</b> Боец сам двигается, стреляет и уклоняется. Вы управляете тактикой с помощью карт.</p>
         <p><b style="color:var(--teal)">Энергия</b> копится сама (≈1 в 1.25 с, максимум 10). Карты стоят 2–6. В руке 3 карты, четвёртая ждёт в очереди.</p>
         <p><b style="color:var(--gold)">Комбо:</b> карта с меткой «КОМБО ▸» начинает связку. Сыграйте её, и вторая карта засветится золотом — успейте сыграть её за ${MATCH.comboWindow} секунды. DASH → POWER SHOT, SHOCK → POWER SHOT, SHIELD → OVERDRIVE, SMOKE → DASH, OVERDRIVE → фирменная.</p>
         <p><b style="color:#ff8a8a">Карта не сработала?</b> Над ней появится причина: не хватает энергии, боец оглушён или занят.</p>
         <p><b style="color:#ff8a7a">Красная зона</b> — соперник заряжает мощный удар. DASH уклоняется, SHIELD блокирует, SHOCK прерывает заряд. Удачные реакции дают бонус рейтинга.</p>
         <p><b style="color:var(--pink)">Рейтинг шоу</b> растёт за комбо, идеальные уклонения и блоки, мощные попадания, разнообразие приёмов и эффектный финиш. Простой и бездействие снижают его. Рейтинг определяет гонорар и новых фанатов.</p>
         <p><b style="color:var(--teal)">Карьера:</b> зарабатывайте деньги и репутацию, подписывайте новых бойцов, открывайте сложность «Профи» и «Чемпион».</p>
         <p><b style="color:var(--btn-a)">События:</b> в праздничные сезоны в меню появляется раздел «События» с заданиями, сезонными жетонами и бесплатными косметическими наградами. Полученные предметы остаются у вас навсегда.</p>
       </div>
       <div class="modal-actions"><button class="btn teal wide" data-a="ok">Понятно</button></div>`,
      (root) => {
        root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
          this.audio.ui('click');
          this.ui.closeModal();
          back();
        });
      },
      false,
    );
  }

  confirm(title: string, text: string, okLabel: string, onOk: () => void, onCancel?: () => void): void {
    this.ui.modal(
      `<div class="h1">${title}</div><p class="center muted" style="font-size:13px;line-height:1.4">${text}</p>
       <div class="modal-actions"><button class="btn wide" data-a="ok">${okLabel}</button><button class="btn ghost wide" data-a="cancel">Отмена</button></div>`,
      (root, close) => {
        root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
          this.audio.ui('confirm');
          close();
          onOk();
        });
        root.querySelector('[data-a="cancel"]')!.addEventListener('click', () => {
          this.audio.ui('click');
          close();
          onCancel?.();
        });
      },
      false,
    );
  }

  // ------------------------------------------------------------------ loop
  private loop = (): void => {
    const now = performance.now();
    const dtReal = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.frame(dtReal, now / 1000);
    this.scheduleNext();
  };

  /** rAF when visible, with a watchdog timer so the game never freezes if rAF stalls. */
  private scheduleNext(): void {
    let done = false;
    const run = () => {
      if (done) return;
      done = true;
      this.loop();
    };
    if (document.hidden || this.debugTimer) {
      setTimeout(run, 16);
      return;
    }
    requestAnimationFrame(run);
    setTimeout(run, 40);
  }

  private frame(dtReal: number, nowSec: number): void {
    this.renderer.monitor(dtReal, nowSec);
    let scale = 1;
    if (this.timeFx.hitstop > 0) {
      this.timeFx.hitstop -= dtReal;
      scale = 0.03;
    } else if (this.timeFx.slowmo > 0) {
      this.timeFx.slowmo -= dtReal;
      scale = this.timeFx.slowScale;
      if (this.timeFx.slowmo <= 0) this.timeFx.slowScale = 1;
    }
    const m = this.match;
    const paused = this.paused || this.ui.modalOpen;
    const dt = paused ? 0 : dtReal * scale * this.debugSpeed;
    let alpha = 1;
    if (m && !paused) {
      this.acc += dt;
      const step = MATCH.fixedStep;
      let n = 0;
      const maxSteps = 8 * this.debugSpeed;
      while (this.acc >= step && n < maxSteps) {
        m.step(step);
        this.acc -= step;
        n++;
      }
      if (n >= maxSteps) this.acc = 0;
      alpha = this.acc / step;
    }
    if (m && this.battleView.active) {
      this.battleView.update(dt, alpha);
      const events = m.drainEvents();
      for (const e of events) this.handleEvent(e);
      this.audio.intensity = m.broadcast.rating / 100;
      this.audio.setCrowd(0.22 + (m.broadcast.rating / 100) * 0.7);
      if (m.phase === 'over' && !this.resultsShown) this.finishMatch();
    } else {
      this.showcase.update(dtReal);
      const p = this.showcase.group.position;
      this.cam.update(dtReal, p, p);
      // seasons start/end on their own: check the calendar now and then outside fights
      this.seasonCheckT -= dtReal;
      if (this.seasonCheckT <= 0 && this.bootDone && this.screen !== 'title' && this.screen !== 'results') {
        this.seasonCheckT = 30;
        if (this.refreshSeason() && (this.screen === 'menu' || this.screen === 'events')) this.ui.show(this.screen);
      }
    }
    this.arena.update(dtReal);
    this.vfx.update(dt === 0 && m ? 0 : m ? dt : dtReal, this.renderer.camera);
    this.vfx.setViewport(this.renderer.size.h * this.renderer.renderer.getPixelRatio(), this.renderer.camera.fov);
    this.ui.update(dtReal);
    // Nothing to see in a background tab: skip the GPU work.
    if (!document.hidden) this.renderer.render(dtReal);
  }

  private handleEvent(e: MatchEvent): void {
    this.battleView.onEvent(e);
    this.hud.onEvent(e);
    const a = this.audio;
    switch (e.type) {
      case 'shot':
        a.shoot(e.weapon, e.kind === 'power', e.side === 1);
        break;
      case 'hit':
        if (e.kind !== 'dot') a.hit(e.heavy, e.crit, e.side === 0);
        if (e.heavy && e.source === 0) a.cheer(0.5);
        break;
      case 'card':
        a.card(e.card);
        break;
      case 'block':
        a.block(e.perfect);
        break;
      case 'shieldBreak':
      case 'propBreak':
        a.shieldBreak();
        break;
      case 'dodge':
        a.dodge(e.perfect);
        if (e.perfect && e.side === 0) a.cheer(0.6);
        break;
      case 'miss':
        a.miss();
        break;
      case 'stun':
        a.stun();
        break;
      case 'combo':
        if (e.side === 0) a.combo(e.combo === 'superstar' || e.combo === 'electro_blast');
        break;
      case 'impact':
        if (e.kind === 'shield') a.deflect(e.heavy);
        break;
      case 'wallSlam':
        a.wallSlam();
        break;
      case 'passive':
        a.passive();
        break;
      case 'countdown':
        a.countdown(e.n);
        break;
      case 'ko':
        a.ko(e.side === 1);
        break;
      case 'timeUp':
        a.countdown(0);
        break;
      case 'interrupt':
        a.electric(0.3, 0.25);
        break;
      case 'whiff':
        a.ooh();
        break;
      default:
        break;
    }
  }
}
