import { arenaById, type ArenaId, type ArenaPref } from '../config/arenas.config';
import { MATCH } from '../config/balance';
import { eventSettings, type EventSettings } from '../config/events.config';
import { FIGHTERS, RIVALS } from '../config/fighters';
import { challengeById, SURVIVAL } from '../config/modes.config';
import { ARENA_MUSIC, type MusicId } from '../config/music.config';
import { bossById } from '../config/boss.config';
import { bossPhaseFlash, bossPhaseSpots, championThemeFor } from '../config/themes.config';
import type { CardId, Difficulty, FighterId, RivalId } from '../config/types';
import { AudioSystem } from '../audio/AudioSystem';
import { Match, type MatchMods } from '../combat/Match';
import type { CardFailReason, MatchEvent } from '../combat/types';
import { Rng } from '../core/math';
import { arenaAvailable, resolveArena, validArenaPref } from '../meta/ArenaSelection';
import { CareerSystem } from '../meta/CareerSystem';
import type { Collection } from '../meta/Collection';
import { EventManager, type MatchEventOutcome } from '../meta/EventManager';
import { GameModes, type SurvivalSummary, type WaveSetup } from '../meta/GameModes';
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
import { CollectionScreen } from '../ui/screens/CollectionScreen';
import { EventsScreen } from '../ui/screens/EventsScreen';
import { MenuScreen } from '../ui/screens/MenuScreen';
import { ModesScreen } from '../ui/screens/ModesScreen';
import { PrepScreen } from '../ui/screens/PrepScreen';
import { ResultsScreen } from '../ui/screens/ResultsScreen';
import { RosterScreen } from '../ui/screens/RosterScreen';
import { SurvivalScreen } from '../ui/screens/SurvivalScreen';
import { TitleScreen } from '../ui/screens/TitleScreen';
import { UIManager } from '../ui/UI';
import { ThemeManager } from './ThemeManager';
import { FirstBroadcast, TUTORIAL } from './FirstBroadcast';
import { isBlockedLandscape, onLandscapeChange } from '../ui/viewport';

export type ScreenName = 'title' | 'menu' | 'roster' | 'prep' | 'career' | 'events' | 'collection' | 'modes' | 'battle' | 'results' | 'survival';

/** Which game mode the current fight belongs to (kept with the match, never global). */
export type ModeSession =
  | { kind: 'classic' }
  | { kind: 'survival'; runId: number; wave: WaveSetup }
  | { kind: 'challenge'; id: string }
  | { kind: 'boss'; id: string }
  /** Alpha 1.6.5 — FIRST BROADCAST: the first-run tutorial (no career, event, mode or deck progress). */
  | { kind: 'tutorial' };

/** Everything needed to set up one fight. */
interface LaunchSpec {
  fighter: FighterId;
  deck: CardId[];
  rival: RivalId;
  difficulty: Difficulty;
  mods?: MatchMods;
  boss?: string;
}

/**
 * Developer-only switches, read from the address bar in `npm run dev` only:
 *   ?event=halloween-2026 | winter-preview | none   force an event (manual mode)
 *   ?now=2026-10-25                                 pretend it is this date (auto mode)
 * The published build ignores them, so players cannot change seasons.
 */
function devEventOverrides(): { settings: EventSettings; clock?: () => number } {
  // published build: the config as written, and never preview rewards
  if (!import.meta.env.DEV) return { settings: { ...eventSettings, previewRewards: false } };
  const qs = new URLSearchParams(location.search);
  const ev = qs.get('event');
  const now = qs.get('now');
  const settings: EventSettings = ev ? { mode: 'manual', forcedEventId: ev, previewRewards: true } : eventSettings;
  const t = now ? Date.parse(now.length <= 10 ? now + 'T12:00:00Z' : now) : NaN;
  return Number.isFinite(t) ? { settings, clock: () => t + (performance.now() - bootT) } : { settings };
}
const bootT = performance.now();

const ALL_LOOKS = ['ray', 'bruno', 'nika', 'vega', 'kai', 'rina', 'lucien', 'dex', 'tank', 'zoe', 'crash', 'vale', 'bot'];

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
  /** MY COLLECTION (Alpha 1.5): owned cosmetics and achievements (state in save.cosmetics). */
  readonly collection: Collection;
  /** Survival marathon and Prime Challenge rules (Alpha 1.3). */
  readonly modes: GameModes;
  /** A Survival attempt closed at launch because the game was shut mid-run (shown once in the menu). */
  private abandoned: SurvivalSummary | null = null;
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
  private matchMeta: { fighter: FighterId; rival: RivalId; difficulty: Difficulty; mode: ModeSession } | null = null;
  /** Event that was running when the current match started (its quests get the result). */
  private matchEventId: string | null = null;
  private seasonCheckT = 0;
  private resultsShown = false;
  private acc = 0;
  private last = 0;
  private screen: ScreenName = 'title';
  private stage: HTMLElement;
  private title: TitleScreen;
  hud!: BattleHUD;
  /** Alpha 1.6.5 — FIRST BROADCAST while it runs. */
  private tutorial: FirstBroadcast | null = null;
  private started = false;
  private bootDone = false;
  private debugTimer = new URLSearchParams(location.search).has('timerloop');
  /** Debug: ?speed=4 fast-forwards the simulation (automated checks only). */
  private debugSpeed = Math.max(1, Math.min(8, Number(new URLSearchParams(location.search).get('speed')) || 1));

  constructor(stage: HTMLElement, uiRoot: HTMLElement) {
    this.stage = stage;
    this.career = new CareerSystem(this.save);
    this.events = new EventManager(this.save, devEventOverrides());
    this.collection = this.events.collection;
    this.modes = new GameModes(this.save, this.career, this.events);
    // A marathon interrupted by closing the game ends with the waves it really cleared.
    this.abandoned = this.modes.closeAbandoned();
    this.ui = new UIManager(uiRoot);
    this.ui.onSoundToggle = () => this.toggleSound();
    this.ui.setSoundIcon(this.save.data.settings.sound);
    this.audio.soundOn = this.save.data.settings.sound;
    this.audio.musicOn = this.save.data.settings.music;
    // Alpha 1.6.3: the menu music downloads while the title screen waits for the first tap
    if (this.save.data.settings.music && this.save.data.settings.sound) this.audio.prefetchMusic(this.menuMusic());
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
    this.arena = new Arena(this.renderer);
    this.renderer.scene.add(this.arena.group);
    this.title.setProgress(0.35);
    await nextFrame();
    this.vfx = new VFX(this.renderer.scene);
    this.arena.vfx = this.vfx;
    this.cam = new CameraRig(this.renderer);
    this.applyCameraMotion(this.save.data.settings.camera);
    this.showcase = new Showcase(this.models);
    this.renderer.scene.add(this.showcase.group);
    this.battleView = new BattleView(this.renderer, this.arena, this.vfx, this.cam, this.models, this.timeFx);
    this.themes = new ThemeManager({ renderer: this.renderer, arena: this.arena, battleView: this.battleView, audio: this.audio, uiRoot: this.ui.root });
    this.themes.apply(this.events.themeId);
    this.themes.setMotion(this.cam.intensity);
    // the menu studio shows the preferred set (a seasonal one only while its season runs)
    this.syncArenaPref();
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
    this.ui.register('collection', new CollectionScreen(this));
    this.ui.register('modes', new ModesScreen(this));
    this.ui.register('battle', this.hud);
    this.ui.register('results', new ResultsScreen(this));
    this.ui.register('survival', new SurvivalScreen(this));

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
    // Alpha 1.6.5: a brand-new player starts with FIRST BROADCAST (older careers never do — SaveSystem)
    if (this.save.data.tutorial === 'pending') {
      this.startTutorial();
      return;
    }
    this.goto('menu');
    if (this.abandoned) {
      const s = this.abandoned;
      this.abandoned = null;
      this.ui.get<SurvivalScreen>('survival').noticeAbandoned(s);
    }
  }

  // ------------------------------------------------------------ navigation
  goto(name: Exclude<ScreenName, 'title' | 'battle' | 'results' | 'survival'>, param?: unknown): void {
    if (this.screen === 'battle' || this.screen === 'results' || this.screen === 'survival') this.endBattleView();
    this.screen = name;
    this.refreshSeason();
    this.setChampionStage(false);
    // the selected fighter may have changed: show what that fighter wears
    this.applyCosmetics();
    const f = FIGHTERS[this.save.data.selected];
    this.showcase.show(f.look, f.theme.accent);
    this.cam.setMode('showcase', 1.0);
    this.cam.showcaseShift = name === 'roster' ? 0.205 : name === 'menu' ? 0.06 : 0.26;
    this.cam.showcaseDist = name === 'roster' ? 16 : name === 'menu' ? 9.6 : 10;
    this.arena.setScreen({ mode: 'menu', headline: this.save.data.orgName });
    this.audio.playTrack(this.menuMusic());
    this.audio.setCrowd(0.12);
    // Alpha 1.6.5: the winner's applause fades out as the results are left
    this.audio.stopCelebration();
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
    this.arena.resetProps();
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
    if (this.arena) this.syncArenaPref();
    // the event started or ended while the menus are open: the menu music follows it
    if (this.started && this.screen !== 'title' && this.screen !== 'battle' && this.screen !== 'results') this.audio.playTrack(this.menuMusic());
    const e = this.events.active;
    if (this.bootDone) {
      this.ui.toast(e ? `${e.title}: событие началось!` : 'Сезонное событие завершилось. Награды остаются в коллекции.', !!e);
      if (e) this.themes?.sting();
    }
    return true;
  }

  /**
   * BOSS FIGHT dresses the studio in the championship look (lights, banners, UI
   * palette); every other screen and mode shows the current season's theme.
   */
  private setChampionStage(on: boolean): void {
    if (!this.themes) return;
    // layered on top of whichever studio set hosts the fight: base set + championship + season
    if (on) this.themes.apply(championThemeFor(this.events.themeId));
    else if (this.themes.id === 'champion' || this.themes.id === 'champion_halloween') this.themes.apply(this.events.themeId);
  }

  // ---------------------------------------------------------------- arenas
  /** The studio-set preference that can be honoured right now (RANDOM, or an open set). */
  get arenaPref(): ArenaPref {
    return validArenaPref(this.save.data.arena, this.events.themeId);
  }

  /** Arena picker: remember the choice; the menu studio switches to it as a live preview. */
  setArenaPref(pref: ArenaPref): void {
    const p = validArenaPref(pref, this.events.themeId);
    this.save.data.arena = p;
    this.save.save();
    if (p !== 'random') this.arena.setStage(p);
  }

  /**
   * A seasonal set chosen during its season falls back to the original studio when
   * the season is over (the preference is rewritten, nothing else changes). The menu
   * studio follows the preference; RANDOM keeps the current set if it is still open.
   */
  private syncArenaPref(): void {
    const season = this.events.themeId;
    const p = validArenaPref(this.save.data.arena, season);
    if (p !== this.save.data.arena) {
      this.save.data.arena = p;
      this.save.save();
    }
    const cur = this.arena.stageId;
    this.arena.setStage(p !== 'random' ? p : arenaAvailable(arenaById(cur), season) ? cur : 'original');
  }

  /** Which set broadcasts this fight: Survival keeps its run's set, the rest follow the preference. */
  /**
   * Alpha 1.6.3: the menu music — the Halloween Premiere theme only while that event is
   * really active (EventManager's calendar), never because of a screen's decoration.
   */
  private menuMusic(): MusicId {
    return this.events.active?.themeId === 'halloween' ? 'prime_menu_halloween' : 'prime_menu';
  }

  private stageFor(mode: ModeSession, seed: number): ArenaId {
    // FIRST BROADCAST: the Original Prime Arena, always
    if (mode.kind === 'tutorial') return 'original';
    const season = this.events.themeId;
    if (mode.kind === 'survival') {
      const run = this.modes.activeRun;
      return run && arenaAvailable(arenaById(run.arena), season) ? run.arena : 'original';
    }
    const rng = new Rng(seed ^ 0x51ed27);
    const id = resolveArena(this.save.data.arena, season, () => rng.next());
    // Alpha 1.7.5: the champion is not fought among tombstones — BOSS FIGHT keeps its tuned open floor
    // (the cemetery's Halloween neighbour hosts it instead)
    if (mode.kind === 'boss' && arenaById(id).covers?.length) return 'haunted';
    return id;
  }

  /**
   * Push equipped cosmetics to the UI and the battle renderer — as `fighter` wears them
   * (Alpha 1.5.5: the producer's common items plus that fighter's own personal ones).
   */
  applyCosmetics(fighter: FighterId = this.save.data.selected): void {
    this.themes?.applyCosmetics(this.collection.effectiveEquipped(fighter));
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
  /** Classic Duel: the selected fighter against the career's next opponent (unchanged since Alpha 1.0). */
  startMatch(): void {
    const s = this.save.data;
    const fighter = s.selected;
    const difficulty = this.career.difficultyUnlocked(s.difficulty) ? s.difficulty : 'rookie';
    this.launch({ fighter, deck: s.fighters[fighter].deck.slice(), rival: s.nextRival, difficulty }, { kind: 'classic' });
  }

  /** SURVIVAL: start a new marathon with the selected fighter and deck. */
  startSurvival(): void {
    const s = this.save.data;
    const fighter = s.selected;
    if (!s.fighters[fighter].unlocked) return;
    // safety: an unfinished attempt is closed (and paid) before a new one starts
    const left = this.modes.closeAbandoned();
    if (left) this.ui.toast(`Прошлый марафон закрыт: волн пройдено ${left.cleared}/${SURVIVAL.waves.length}`);
    const eventId = this.events.playable ? this.events.active!.id : null;
    const seed = (s.seed + s.matches * 131 + Math.floor(performance.now())) >>> 0;
    // the set is picked once per attempt (RANDOM too) and kept for every wave
    const rng = new Rng(seed ^ 0x51ed27);
    const arena = resolveArena(s.arena, this.events.themeId, () => rng.next());
    this.modes.startRun(fighter, s.fighters[fighter].deck, eventId, seed, arena);
    this.startSurvivalWave();
  }

  /** SURVIVAL: fight the next wave of the active marathon. */
  startSurvivalWave(): void {
    const run = this.modes.activeRun;
    if (!run || run.pendingPerk) return;
    const w = this.modes.waveSetup(run);
    this.launch({ fighter: run.fighter, deck: run.deck, rival: w.rival, difficulty: w.difficulty, mods: w.mods }, { kind: 'survival', runId: run.id, wave: w });
    this.arena.setScreen({ headline: w.final ? 'SURVIVAL · FINAL WAVE' : `SURVIVAL · WAVE ${w.index + 1}/${w.total}` });
  }

  /** PRIME CHALLENGE: one special broadcast with its own rules. */
  startChallenge(id: string, difficulty: Difficulty): void {
    const def = challengeById(id);
    if (!def) return;
    const s = this.save.data;
    const fighter = s.selected;
    if (!s.fighters[fighter].unlocked) return;
    const diff = this.career.difficultyUnlocked(difficulty) ? difficulty : 'rookie';
    this.launch({ fighter, deck: s.fighters[fighter].deck.slice(), rival: def.rival, difficulty: diff, mods: this.modes.challengeMods(def) }, { kind: 'challenge', id });
    this.arena.setScreen({ headline: def.title });
  }

  /** BOSS FIGHT: the selected fighter against the legendary champion. */
  startBoss(id: string): void {
    const def = bossById(id);
    if (!def) return;
    const s = this.save.data;
    const fighter = s.selected;
    if (!s.fighters[fighter].unlocked) return;
    // the champion only takes challengers with a Classic Duel record (or who already beat him)
    const access = this.modes.bossAccess(def.id, fighter);
    if (!access.open) {
      this.audio.ui('deny');
      this.ui.toast(`Вызов откроется после ${access.need} побед в Classic Duel этим бойцом: ${access.wins}/${access.need}`);
      return;
    }
    this.launch(
      { fighter, deck: s.fighters[fighter].deck.slice(), rival: def.rival, difficulty: def.rewards.purseDifficulty, mods: this.modes.bossMods(def), boss: def.id },
      { kind: 'boss', id: def.id },
    );
    this.arena.setSpots(bossPhaseSpots(this.themes.id, 0, def.phases[0].spots));
    this.arena.setScreen({ headline: def.title });
    this.audio.sting('champion');
  }

  /**
   * Alpha 1.6.5 — FIRST BROADCAST: the short first-run tutorial (see FirstBroadcast). Runs for a
   * new player after the first tap, or from Settings → «Пройти обучение» (a replay changes
   * nothing but the tutorial itself). The player's real deck and progress are never touched:
   * the tutorial match brings its own deck and counts for nothing.
   */
  startTutorial(): void {
    this.tutorial?.close();
    const s = this.save.data;
    const fighter = s.fighters[s.selected]?.unlocked ? s.selected : 'ray';
    this.tutorial = new FirstBroadcast(this);
    this.launch({ fighter, deck: TUTORIAL.deck.slice(), rival: 'bot', difficulty: 'rookie', mods: TUTORIAL.mods }, { kind: 'tutorial' });
    this.arena.setScreen({ headline: 'FIRST BROADCAST' });
  }

  /** FIRST BROADCAST ended: remember it (a skip never undoes a finished run), back to the menu. */
  endTutorial(how: 'done' | 'skipped'): void {
    if (!this.tutorial) return;
    this.tutorial.close();
    this.tutorial = null;
    const s = this.save.data;
    if (how === 'done' || s.tutorial === 'pending') s.tutorial = how;
    this.save.save();
    this.goto('menu');
  }

  /** «ПРОПУСТИТЬ»: leave the tutorial now, no penalty. */
  skipTutorial(): void {
    if (!this.tutorial) return;
    this.audio.ui('click');
    this.endTutorial('skipped');
  }

  /** The end of the first broadcast: a TV flash and the audience on its feet. */
  tutorialCheer(): void {
    this.renderer.pulseFlash(0xffd76a, 1.2);
    this.audio.celebrate();
  }

  private launch(spec: LaunchSpec, mode: ModeSession): void {
    if (this.screen === 'battle' || this.screen === 'results' || this.screen === 'survival') this.endBattleView();
    this.audio.stopCelebration(0.6);
    const s = this.save.data;
    const { fighter, rival, difficulty } = spec;
    const seed = (s.seed + s.matches * 7919 + Math.floor(performance.now())) >>> 0;
    // studio set first, then the BOSS FIGHT / season dressing on top of it
    const stage = this.stageFor(mode, seed);
    const switched = this.arena.setStage(stage);
    this.setChampionStage(mode.kind === 'boss');
    const match = new Match({
      fighter,
      deck: spec.deck,
      rival,
      difficulty,
      seed,
      fans: s.fighters[fighter].fans,
      mods: spec.mods,
      boss: spec.boss,
      arena: stage,
    });
    this.match = match;
    this.matchMeta = { fighter, rival, difficulty, mode };
    this.applyCosmetics(fighter);
    // Survival reports to the seasonal event once per attempt (see GameModes), not per wave.
    this.matchEventId = mode.kind !== 'survival' && mode.kind !== 'tutorial' && this.events.playable ? this.events.active!.id : null;
    this.resultsShown = false;
    this.paused = false;
    this.acc = 0;
    this.timeFx.hitstop = 0;
    this.timeFx.slowmo = 0;
    this.timeFx.slowScale = 1;
    this.showcase.hide();
    this.battleView.setup(match);
    // TV caption of the set: when it changes, and on every new set except between Survival waves
    const showStage = mode.kind !== 'tutorial' && (switched || (stage !== 'original' && !(mode.kind === 'survival' && mode.wave.index > 0)));
    this.hud.setup(match, mode, { stage: showStage, halloween: this.themes.id === 'champion_halloween' });
    this.cam.setMode('battle', 1.9);
    this.cam.finishShift = 0.04;
    this.cam.finishDist = 7.5;
    this.screen = 'battle';
    this.ui.showSoundFab(false);
    this.ui.show('battle');
    this.updateLayoutFraming();
    // Alpha 1.6.3: the champion's theme always wins; otherwise the music of the studio set
    this.audio.playTrack(spec.boss ? 'victor_boss' : ARENA_MUSIC[stage]);
    this.audio.crowd(1);
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
      // Alpha 1.6.5: in FIRST BROADCAST the pause offers to skip the tutorial instead of a forfeit
      const tut = this.matchMeta?.mode.kind === 'tutorial';
      this.ui.modal(
        `<div class="h1">Пауза</div>
         <div class="toggle-row"><span>Звук</span><button class="switch ${s.sound ? 'on' : ''}" data-t="sound"></button></div>
         <div class="toggle-row"><span>Музыка</span><button class="switch ${s.music ? 'on' : ''}" data-t="music"></button></div>
         <div class="modal-actions">
           <button class="btn teal wide" data-a="resume">Продолжить</button>
           ${
             tut
               ? '<button class="btn ghost wide" data-a="skip">Пропустить обучение</button>'
               : '<button class="btn ghost wide" data-a="help">Как играть</button><button class="btn ghost wide" data-a="forfeit">Сдаться</button>'
           }
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
            } else if (a === 'skip') {
              close();
              this.paused = false;
              this.skipTutorial();
            } else if (a === 'help') {
              this.openHelp(() => this.pause());
            } else if (a === 'forfeit') {
              close();
              const kind = this.matchMeta?.mode.kind;
              const text =
                kind === 'survival'
                  ? 'Марафон закончится. Награда — только за уже пройденные волны.'
                  : kind === 'challenge'
                    ? 'Испытание не будет пройдено, а гонорар — урезан.'
                    : kind === 'boss'
                      ? 'Чемпион сохранит титул: бой засчитан как поражение, гонорар урезан.'
                      : 'Бой будет засчитан как поражение, а гонорар — урезан.';
              this.confirm('Сдаться?', text, 'Сдаться', () => {
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
    const mode = meta.mode;
    // Alpha 1.6.5: FIRST BROADCAST ends on its own («ГОТОВ К ЭФИРУ!» → menu): no results, no
    // career, money, fans, rating, Classic wins, boss access, events or modes — nothing counts
    if (mode.kind === 'tutorial') return;
    if (!this.save.data.hintsSeen) {
      this.save.data.hintsSeen = true;
      this.save.save();
    }
    if (mode.kind === 'survival') {
      const wave = this.modes.recordWave(mode.runId, m.result, m.fighters[0].hpFrac);
      this.enterResultsView(m.result.outcome);
      this.ui.show('survival', wave ? { kind: wave.summary ? 'summary' : 'intermission', wave, summary: wave.summary, result: m.result, mode } : { kind: 'menu' });
      return;
    }
    let challenge = null;
    let boss = null;
    let outcome;
    const stageBefore = this.career.stage().index;
    if (mode.kind === 'boss') {
      const def = bossById(mode.id)!;
      outcome = this.career.applyMatch(m.result, meta.fighter, meta.difficulty, meta.rival, {
        moneyMult: def.rewards.moneyMult,
        moneyLabel: 'Легендарный эфир',
        rotateRival: false,
      });
      boss = this.modes.recordBoss(mode.id, m.result, meta.fighter);
      outcome.levelAfter = this.career.level().level;
      if (boss?.cosmeticNew) this.applyCosmetics(meta.fighter);
    } else if (mode.kind === 'challenge') {
      const def = challengeById(mode.id)!;
      outcome = this.career.applyMatch(m.result, meta.fighter, meta.difficulty, meta.rival, {
        moneyMult: def.moneyMult,
        moneyLabel: 'Высокие ставки',
        rotateRival: false,
      });
      challenge = this.modes.recordChallenge(mode.id, m.result, meta.fighter);
      outcome.levelAfter = this.career.level().level;
    } else {
      outcome = this.career.applyMatch(m.result, meta.fighter, meta.difficulty, meta.rival, { classic: true });
    }
    // a boss win or a challenge clear (recorded after the match) can complete a career stage too
    outcome.newStage = this.career.newStageSince(stageBefore);
    // (Alpha 1.7.5: the set counts too — a real win on GRAVEYARD BROADCAST pays its small season bonus;
    // the event id is used up here, so a match never pays twice)
    const eventOutcome: MatchEventOutcome | null = this.events.applyMatch(this.matchEventId, m.result, meta.difficulty, m.cfg.arena);
    this.matchEventId = null;
    this.enterResultsView(m.result.outcome);
    this.ui.show('results', { result: m.result, outcome, event: eventOutcome, challenge, boss, ...meta });
  }

  /** Shared after-fight presentation: camera on the winner, results music, win/loss sting. */
  private enterResultsView(outcome: 'win' | 'loss' | 'draw'): void {
    this.screen = 'results';
    // Lift the celebrating winner above the results panels.
    this.cam.finishShift = 0.35;
    this.cam.finishDist = 18.5;
    this.ui.showSoundFab(true);
    // the fight music fades out under the sting; the menu music decodes meanwhile and comes in after it
    this.audio.playTrack(null);
    this.audio.prepareMusic(this.menuMusic());
    if (outcome === 'win') this.audio.victory();
    else if (outcome === 'loss') this.audio.defeat();
    else this.audio.reaction(2);
    setTimeout(() => {
      if (this.screen === 'results') this.audio.playTrack(this.menuMusic());
    }, 3000);
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
           <button class="btn ghost wide" data-a="tutorial">Пройти обучение</button>
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
            } else if (a === 'tutorial') {
              // Alpha 1.6.5: FIRST BROADCAST once more — no rewards, the real deck stays as it is
              this.audio.ui('confirm');
              close();
              this.startTutorial();
            } else if (a === 'reset') {
              this.confirm('Сбросить прогресс?', 'Деньги, бойцы, фанаты и цели будут удалены. Это действие нельзя отменить.', 'Сбросить', () => {
                // the tutorial already seen is not forced again after a reset
                const seen = this.save.data.tutorial !== 'pending';
                this.save.reset();
                if (seen) {
                  this.save.data.tutorial = 'done';
                  this.save.save();
                }
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
         <p><b style="color:var(--gold)">Режимы эфира:</b> кроме обычной дуэли есть <b>SURVIVAL</b> — пять боёв подряд одним бойцом, здоровье переносится между волнами, после каждой победы выбирается бонус, <b>PRIME CHALLENGE</b> — спецвыпуски с особыми правилами и наградой за первое прохождение — и <b>BOSS FIGHT</b>: бой с легендарным чемпионом в три фазы, победа только нокаутом. Вход — кнопка «Режимы эфира» в меню.</p>
         <p><b style="color:var(--btn-a)">События:</b> в праздничные сезоны в меню появляется раздел «События» с заданиями, сезонными жетонами, бесплатными косметическими наградами и сезонными бойцами (на Halloween Premiere — вампир LUCIEN). Полученные награды и бойцы остаются у вас навсегда.</p>
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
      for (const e of events) {
        this.handleEvent(e);
        this.tutorial?.onEvent(e);
      }
      this.tutorial?.update(paused ? 0 : dtReal);
      this.audio.intensity = m.broadcast.rating / 100;
      // Alpha 1.6.4: a quiet murmur, rising only a little with the show; small swells while the fight runs
      this.audio.crowdTick(m.phase === 'fight', m.broadcast.rating / 100);
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
    this.arena.update(dtReal, !!m && dt === 0);
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
        if (e.kind === 'zap') a.electric(0.35, 0.3);
        else a.shoot(e.weapon, e.kind === 'power' || e.kind === 'bank' || e.kind === 'split', e.side === 1);
        break;
      case 'zapCharge':
        a.zapCharge(e.duration);
        break;
      case 'hit':
        if (e.kind !== 'dot' && e.kind !== 'bleed') a.hit(e.heavy, e.crit, e.side === 0);
        // Alpha 1.6.4: the crowd answers a crit / combo hit; a plain heavy hit only gets an «oh!» now and then
        if (e.heavy && e.source === 0) a.crowd(e.crit || e.combo ? 2 : 1);
        break;
      case 'card':
        a.card(e.card);
        break;
      case 'block':
        a.block(e.perfect);
        break;
      case 'shieldBreak':
        a.shieldBreak();
        break;
      case 'propBreak':
      case 'propHit': {
        // studio-set pieces: each kind sounds like what it is (chips, plywood, stone…)
        const p = this.match?.props[e.index];
        if (p) a.prop(p.kind, e.type === 'propBreak', e.type === 'propHit' && e.heavy);
        break;
      }
      case 'cover': {
        // Alpha 1.7.5: cover on the floor sounds like the set's own stone and pumpkins (no new sounds):
        // every crack, break and heavy blow is heard; a plain chip only shows (no rattle under fire)
        const c = this.match?.covers.list[e.index];
        if (c && (e.what !== 'hit' || e.heavy)) a.prop(c.kind === 'pumpkin' ? 'pumpkin' : 'gravestone', e.what === 'break', e.heavy || c.kind === 'column');
        break;
      }
      case 'dodge':
        a.dodge(e.perfect);
        if (e.perfect && e.side === 0) a.crowd(2);
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
      // Alpha 1.6.4: the fight just ended (KO / time up / forfeit) — its music fades out from here
      case 'phase':
        if (e.phase === 'outro') a.endMatchMusic();
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
      // Alpha 1.5: BANK SHOT and FALSE START
      case 'bank':
        a.bank();
        break;
      case 'trickShot':
        a.trickShot();
        break;
      case 'feintCounter':
        a.feintCounter();
        break;
      case 'telegraph':
        // the champion's SPOTLIGHT SHOT gets its own warning sting
        if (e.side === 1 && this.match?.boss && e.card === 'charged_shot') a.bossWarn();
        break;
      case 'cutStart':
        a.cutStart(e.empowered);
        break;
      case 'cutAim':
        a.cutAim(e.aim, e.shot);
        break;
      case 'cutLock':
        a.cutLock(e.lock);
        break;
      case 'cutShot':
        a.cutShot(e.final, e.empowered);
        if (e.final && e.outcome === 'hit') this.timeFx.hitstop = Math.max(this.timeFx.hitstop, 0.08);
        break;
      // Alpha 1.6 — CARD REVOLUTION
      case 'tagHit':
        a.cardFx('tagHit');
        break;
      case 'push':
        if (e.hit) a.cardFx('push');
        break;
      case 'object':
        if (e.kind === 'net' && e.what === 'land') a.cardFx('netLand');
        else if (e.kind === 'mine' && e.what === 'arm') a.cardFx('mineArm');
        else if (e.kind === 'mine' && e.what === 'trigger') a.cardFx('mineBoom');
        else if (e.kind === 'barrier' && e.what === 'hit') a.cardFx('barrierHit');
        else if (e.kind === 'barrier' && e.what === 'break') a.cardFx('barrierBreak');
        else if (e.kind === 'prop' && e.what === 'land') a.cardFx('propLand');
        else if (e.kind === 'echo' && e.what === 'lock') a.cardFx('echoLock');
        else if (e.kind === 'echo' && e.what === 'fire') a.cardFx('echoFire');
        break;
      case 'tether':
        a.cardFx('tether');
        break;
      case 'tetherEnd':
        if (e.broke) a.cardFx('snap');
        break;
      case 'frameCatch':
        a.cardFx(e.first ? 'parry' : 'frameCatch');
        break;
      case 'disc':
        if (e.what === 'catch') a.cardFx('discCatch');
        break;
      case 'erase':
        a.cardFx('erase');
        break;
      // Alpha 1.7 — LUCIEN: the cane's swish, the swarm lunge, the bite
      case 'strike':
        a.caneSwish(e.variant);
        break;
      case 'bite':
        if (e.what === 'rush') a.batRush();
        else if (e.what === 'hit') a.bite();
        else if (e.what === 'barrier') a.cardFx('barrierHit');
        break;
      case 'bossPhase': {
        const ph = this.match?.boss?.def.phases[e.phase - 1];
        a.bossPhase(e.phase);
        this.timeFx.slowmo = 0.9;
        this.timeFx.slowScale = 0.35;
        this.renderer.pulseFlash(bossPhaseFlash(this.themes.id, e.phase), 4);
        this.cam.addTrauma(0.5);
        if (ph) this.arena.setSpots(bossPhaseSpots(this.themes.id, e.phase - 1, ph.spots));
        break;
      }
      default:
        break;
    }
  }
}
