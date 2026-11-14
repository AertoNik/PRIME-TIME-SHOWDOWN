import { REWARDS } from '../../config/career';
import { ARENA_ORDER, arenaById, type ArenaPref } from '../../config/arenas.config';
import { COMBO_FRESH_NOTE, COMBO_ROLE_LABEL, deckCombos } from '../../config/cards';
import { BEHAVIORS, DIFFICULTIES, DIFFICULTY_ORDER, FIGHTERS, FIGHTER_ORDER, RIVALS, RIVAL_ORDER, rivalFighterDef } from '../../config/fighters';
import { SURVIVAL, challengeById } from '../../config/modes.config';
import { bossById } from '../../config/boss.config';
import { COSMETICS } from '../../config/cosmetics.config';
import type { CardId, Difficulty } from '../../config/types';
import type { Game } from '../../game/Game';
import { arenaAvailable, availableArenas } from '../../meta/ArenaSelection';
import { inRoster } from '../../meta/roster';
import { formatChallengeValue } from '../../meta/GameModes';
import { ARENA_ART } from '../arenaArt';
import { cardCatalog, cardDetailHTML, cardStanding, catalogStats } from '../cardCatalog';
import { preloadCardArt } from '../cardArt';
import { cardHTML, el, esc, portraitHTML, setScreenHTML } from '../dom';
import { UI_ICONS } from '../icons';
import { MODE_ICONS } from '../modeArt';
import type { Screen } from '../UI';

/** What the prep screen is preparing: a Classic Duel, a Survival marathon or one Prime Challenge. */
export type PrepMode = { kind: 'classic' } | { kind: 'survival' } | { kind: 'challenge'; id: string } | { kind: 'boss'; id: string };

const WAVE_LABEL = (i: number) => {
  const w = SURVIVAL.waves[i];
  const base = DIFFICULTIES[w.difficulty].label;
  return w.hpMult > 1.0 ? `${base}+` : base;
};

export class PrepScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private deck: CardId[] = [];
  private focus: CardId | null = null;
  private diff: Difficulty = 'rookie';
  /** Kept when returning from the roster, so a mode setup is not lost. */
  private mode: PrepMode = { kind: 'classic' };

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'prep');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  /** params: { mode } to open a specific setup; without params the last setup stays (e.g. back from the roster). */
  onShow(params?: unknown): void {
    const pm = (params as { mode?: PrepMode } | undefined)?.mode;
    if (pm) this.mode = (pm.kind === 'challenge' && !challengeById(pm.id)) || (pm.kind === 'boss' && !bossById(pm.id)) ? { kind: 'classic' } : pm;
    const s = this.g.save.data;
    this.deck = s.fighters[s.selected].deck.slice();
    this.focus = this.deck[0] ?? null;
    this.diff = this.g.career.difficultyUnlocked(s.difficulty) ? s.difficulty : 'rookie';
    const f = FIGHTERS[s.selected];
    this.g.showcase.show(this.g.fighterLook(f.id), f.theme.accent);
    this.render(false);
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    if (act === 'back') {
      g.audio.ui('click');
      if (this.mode.kind === 'classic') g.goto('menu');
      else g.goto('modes');
      return;
    }
    if (act === 'arena') {
      g.audio.ui('click');
      this.openArenaPicker();
      return;
    }
    if (act === 'roster') {
      g.audio.ui('click');
      g.goto('roster', { back: 'prep' });
      return;
    }
    if (act === 'diff') {
      const d = t.dataset.d as Difficulty;
      if (!g.career.difficultyUnlocked(d)) {
        g.audio.ui('deny');
        g.ui.toast(`Откроется на уровне продюсера ${DIFFICULTIES[d].unlockLevel}`);
        return;
      }
      g.audio.ui('click');
      this.diff = d;
      this.render();
      return;
    }
    if (act === 'cards') {
      // Alpha 1.9.8: buying and browsing cards moved to the CARDS section of the main menu — the deck built so far is kept
      g.audio.ui('click');
      if (this.deck.length === 4) g.career.setDeck(g.save.data.selected, this.deck);
      g.goto('cards', { back: 'prep' });
      return;
    }
    if (act === 'coll') {
      const c = t.dataset.card as CardId;
      this.focus = c;
      const i = this.deck.indexOf(c);
      if (i >= 0) {
        this.deck.splice(i, 1);
        g.audio.ui('swipe');
      } else if (this.deck.length < 4) {
        this.deck.push(c);
        g.audio.ui('click');
      } else {
        g.audio.ui('deny');
        g.ui.toast('В колоде максимум 4 карты — уберите одну из слотов');
      }
      this.render();
      return;
    }
    if (act === 'slot') {
      const c = t.dataset.card as CardId | undefined;
      if (c) {
        this.deck.splice(this.deck.indexOf(c), 1);
        this.focus = c;
        g.audio.ui('swipe');
        this.render();
      }
      return;
    }
    if (act === 'start') {
      if (this.deck.length !== 4) {
        g.audio.ui('deny');
        g.ui.toast('Соберите колоду из 4 карт');
        return;
      }
      const s = g.save.data;
      g.career.setDeck(s.selected, this.deck);
      g.audio.ui('confirm');
      if (this.mode.kind === 'survival') {
        g.startSurvival();
        return;
      }
      if (this.mode.kind === 'challenge') {
        g.startChallenge(this.mode.id, this.diff);
        return;
      }
      if (this.mode.kind === 'boss') {
        g.startBoss(this.mode.id);
        return;
      }
      s.difficulty = this.diff;
      g.save.save();
      g.startMatch();
    }
  }

  // ------------------------------------------------------------ arenas (1.4)
  /** The studio set for the broadcast: the current choice and the way to the picker. */
  private arenaSection(): string {
    const g = this.g;
    const pref = g.arenaPref;
    const def = pref === 'random' ? null : arenaById(pref);
    const n = availableArenas(g.events.themeId).length;
    const halloween = g.events.themeId === 'halloween';
    // Alpha 1.7.5: the cemetery has cover on the floor (1.9.7: and the New Year set)
    const covers = !!def?.covers?.length;
    const randomCovers = pref === 'random' && availableArenas(g.events.themeId).some((id) => !!arenaById(id).covers?.length);
    const holiday = def?.id === 'holiday';
    // Alpha 1.9.8: NEON NEWSROOM — the champion is fought in the Original Prime Arena, as on the New Year set
    const newsroom = def?.id === 'newsroom';
    const where = holiday ? 'В праздничной студии' : newsroom ? 'В студии новостей' : 'На кладбище';
    const pieces = holiday ? 'подарки, снежные пушки, часовые колонны и пульты студии' : newsroom ? 'столы ведущих, технические панели, стойки оборудования и камеры' : 'надгробия, колонны и тыквы';
    const coverSets = availableArenas(g.events.themeId).filter((id) => !!arenaById(id).covers?.length).map((id) => arenaById(id).show);
    const note =
      this.mode.kind === 'survival'
        ? `Павильон выбирается при старте марафона и остаётся на все 5 волн.${covers ? ` ${where} стоят разрушаемые укрытия.` : ''}`
        : this.mode.kind === 'challenge'
          ? `Правила испытания одинаковы в любом павильоне.${covers ? ` ${where} стоят разрушаемые укрытия.` : ''}`
          : this.mode.kind === 'boss'
            ? `Чемпион оформит павильон в стиле LEGENDARY SHOWDOWN — ${halloween ? 'HALLOWEEN SPECIAL' : 'CHAMPIONSHIP EDITION'}.${covers || randomCovers ? (holiday || newsroom ? ' Среди укрытий чемпион не выступает: бой пройдёт в ORIGINAL PRIME ARENA.' : covers ? ' Среди надгробий чемпион не выступает: вместо кладбища бой пройдёт в HAUNTED PRIME SET.' : ' Среди укрытий чемпион не выступает: кладбище заменит HAUNTED PRIME SET, другие павильоны с укрытиями — ORIGINAL PRIME ARENA.') : ''}`
            : covers
              ? `${where} стоят разрушаемые укрытия: ${pieces} останавливают выстрелы, пока их не разобьют.`
              : randomCovers
                ? `Павильоны отличаются оформлением; разрушаемые укрытия есть только в ${coverSets.join(' и ')}.`
                : 'Павильон меняет только оформление: размеры арены, правила и баланс везде одинаковы.';
    return `<div class="section panel arena-pick" data-act="arena" role="button" aria-label="Выбрать павильон эфира">
        <div class="ap-thumb">${ARENA_ART[pref]}</div>
        <div class="ap-info">
          <span class="label">Павильон эфира</span>
          <b>${def ? esc(def.name) : 'СЛУЧАЙНЫЙ ПАВИЛЬОН'}</b>
          <span class="ap-show">${def ? esc(def.show) : `любой из ${n} доступных`}</span>
          <span class="chip teal ap-btn">⇄ Сменить</span>
        </div>
        <div class="ap-note">${esc(note)}</div>
      </div>`;
  }

  /** Arena picker: every set with its preview, type and availability, plus RANDOM. */
  private openArenaPicker(): void {
    const g = this.g;
    const season = g.events.themeId;
    const cur = g.arenaPref;
    const card = (id: ArenaPref): string => {
      const def = id === 'random' ? null : arenaById(id);
      const open = !def || arenaAvailable(def, season);
      const seasonal = def?.availability.kind === 'seasonal' ? def.availability : null;
      const type = !def
        ? '<span class="chip">Случайный</span>'
        : seasonal
          ? `<span class="chip orange">Сезонная · ${esc(seasonal.event)}</span>`
          : '<span class="chip teal">Постоянная</span>';
      const status = !open
        ? `<span class="ac-lock">${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} Доступна только во время ${esc(seasonal!.event)}</span>`
        : id === cur
          ? `<span class="ac-on">${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} Выбрано</span>`
          : '<span class="ac-pick">Выбрать</span>';
      const desc = def ? def.description : `Каждый бой — один из доступных павильонов (сейчас: ${availableArenas(season).length}). Сезонные — только во время своего события.`;
      // Alpha 1.7.5: cover on the floor, and the season's bonus for a win there while the event pays
      const cover = def?.covers?.length ? '<span class="chip cover">Разрушаемые укрытия</span>' : '';
      const bonus = def && open ? g.events.arenaBonus(def.id) : null;
      const bonusChip = bonus ? `<span class="chip gold">+${bonus.tokens} ${esc(bonus.unit)} за победу</span>` : '';
      return `<button class="arena-card ${id === cur ? 'on' : ''} ${open ? '' : 'locked'} ac-${id}" data-arena="${id}" ${open ? '' : 'aria-disabled="true"'}>
          <span class="ac-thumb">${ARENA_ART[id]}</span>
          <span class="ac-body">
            <span class="ac-name">${def ? esc(def.name) : 'СЛУЧАЙНЫЙ ПАВИЛЬОН'}</span>
            <span class="ac-show">${def ? esc(def.show) : 'RANDOM ARENA'}</span>
            <span class="ac-desc">${esc(desc)}</span>
            <span class="ac-foot">${type}${cover}${bonusChip}${status}</span>
          </span>
        </button>`;
    };
    g.ui.modal(
      `<div class="arena-picker">
         <div class="h1">Павильон эфира</div>
         <div class="ap-list">${[...ARENA_ORDER, 'random' as const].map(card).join('')}</div>
         <div class="modal-actions"><button class="btn ghost wide" data-a="close">Готово</button></div>
       </div>`,
      (root, close) => {
        root.querySelector('[data-a="close"]')!.addEventListener('click', () => {
          g.audio.ui('click');
          close();
        });
        root.querySelectorAll<HTMLElement>('[data-arena]').forEach((b) =>
          b.addEventListener('click', () => {
            const id = b.dataset.arena as ArenaPref;
            const def = id === 'random' ? null : arenaById(id);
            if (def && !arenaAvailable(def, g.events.themeId)) {
              g.audio.ui('deny');
              g.ui.toast(`${def.name} открывается только во время ${def.availability.kind === 'seasonal' ? def.availability.event : 'события'}`);
              return;
            }
            g.audio.ui('confirm');
            g.setArenaPref(id);
            close();
            g.ui.toast(def ? def.caption : 'RANDOM ARENA — павильон выберется перед боем', true);
            this.render();
          }),
        );
      },
    );
  }

  /** Right side of the matchup and the middle section for the game modes. */
  private modeParts(): { title: string; side: string; note: string; section: string; start: string; locked?: boolean } | null {
    const g = this.g;
    const mode = this.mode;
    if (mode.kind === 'survival') {
      const rec = g.modes.survival;
      const faces = RIVAL_ORDER.map((id) => {
        const r = RIVALS[id];
        return `<span class="pool-face">${portraitHTML(g.portraits[r.look], r.theme.main, r.theme.dark)}</span>`;
      }).join('');
      const ladder = SURVIVAL.waves
        .map((w, i) => `<div class="wave-step ${i === SURVIVAL.waves.length - 1 ? 'final' : ''}"><b>${i + 1}</b><span>${esc(WAVE_LABEL(i))}</span></div>`)
        .join('');
      return {
        title: 'SURVIVAL · Подготовка',
        side: `<div class="mside b"><div class="pool-faces">${faces}</div><div class="mname">5 волн</div><span class="chip red">Марафон</span></div>`,
        note: 'Соперники выходят по очереди в случайном порядке. Каждая следующая волна сильнее.',
        section: `<div class="section panel">
            <div class="section-title"><span class="h2">Правила марафона</span><span class="label">${MODE_ICONS.survival.replace('<svg', '<svg width="14" height="14"')} last star standing</span></div>
            <div class="wave-ladder">${ladder}</div>
            <ul class="mode-rules">
              <li>Пять дуэлей подряд одним бойцом и одной колодой.</li>
              <li>Здоровье переносится между волнами: после победы +${Math.round(SURVIVAL.healBetween * 100)}%, не больше максимума.</li>
              <li>После каждой победы — один бонус на выбор: SECOND WIND, ENERGY BOOST или POWER SURGE. Действует до конца марафона.</li>
              <li>Поражение или ничья завершают марафон. Награда — за пройденные волны.</li>
            </ul>
            <div class="mode-tip"><b>Совет:</b> в марафоне колода решает больше, чем в одном бою. Защита (DASH, SHIELD) сберегает здоровье до финала, а связки комбо быстрее закрывают волны.</div>
            <div class="mode-facts"><span>Полное прохождение <b>+$${SURVIVAL.completion.money}</b></span>${rec.firstClearPaid ? '' : `<span>Первое прохождение <b>+$${SURVIVAL.firstClear.money} +${SURVIVAL.firstClear.rep}★</b></span>`}<span>Рекорд <b>${rec.bestWave}/${SURVIVAL.waves.length}</b></span></div>
          </div>`,
        start: 'Начать марафон',
      };
    }
    if (mode.kind === 'boss') {
      const def = bossById(mode.id)!;
      const rival = RIVALS[def.rival];
      const p = g.modes.bossProgress(def.id);
      const fw = def.rewards.firstWin;
      const phases = def.phases
        .map((ph) => `<div class="bp-phase p${ph.n}"><b>${ph.n}</b><span><i>${esc(ph.title)}</i>${esc(ph.desc)}</span></div>`)
        .join('');
      const moves = def.moves
        .map((mv) => `<div class="bp-move"><span class="bp-mname">${esc(mv.name)}<small>с фазы ${mv.from}</small></span><span class="bp-mdesc">${esc(mv.desc)}</span><span class="bp-mcounter">${esc(mv.counter)}</span></div>`)
        .join('');
      // a short, deck-aware hint: the champion's heavy shots are answered with DASH / SHIELD
      const d = this.deck;
      let tip = '';
      if (!d.includes('dash') && !d.includes('shield'))
        tip = d.includes('shock')
          ? 'В колоде нет ни DASH, ни SHIELD: против DIRECTOR\'S CUT остаётся только сорвать серию SHOCK, пока чемпион вскидывает винтовку.'
          : 'В колоде нет ни DASH, ни SHIELD — от выстрелов DIRECTOR\'S CUT и луча SPOTLIGHT SHOT будет нечем защититься.';
      else if (!d.includes('shield')) tip = 'SHIELD гасит выстрелы DIRECTOR\'S CUT и помогает пережить STAR POWER. Против чемпиона он очень полезен.';
      else if (!d.includes('dash')) tip = 'DASH в момент, когда линия прицела застыла, уводит от выстрела DIRECTOR\'S CUT и возвращает 1 энергию.';
      else if (d.includes('adrenaline') && !d.includes('overdrive')) tip = 'Бой длинный: OVERDRIVE чаще окупается против чемпиона, чем ADRENALINE.';
      // Alpha 1.7: the champion shakes the bleed off twice as fast and the lunge walks into his rifle
      else if (d.includes('bat_bite')) tip = 'Чемпион вдвое быстрее справляется с кровотечением BAT BITE, а рывок подводит Люсьена под его винтовку. Против Виктора надёжнее POWER SHOT вместо укуса.';
      // access: Classic Duel wins with the selected fighter
      const sel = g.save.data.selected;
      const acc = g.modes.bossAccess(def.id, sel);
      const roster = FIGHTER_ORDER.filter((id) => inRoster(g.save.data, id))
        .map((id) => {
          const a = g.modes.bossAccess(def.id, id);
          return `<span class="ba-f ${a.open ? 'open' : ''} ${id === sel ? 'sel' : ''}">${esc(FIGHTERS[id].name)} <b>${a.open ? '✓' : `${a.wins}/${a.need}`}</b></span>`;
        })
        .join('');
      const lock = acc.open
        ? ''
        : `<div class="boss-lock">${UI_ICONS.lock.replace('<svg', '<svg width="18" height="18"')}<div>
            <b>Вызов закрыт · ${esc(FIGHTERS[sel].name)} ${acc.wins}/${acc.need}</b>
            <span>Чемпион принимает вызов от бойцов, у которых ${acc.need} побед в Classic Duel. Побеждайте в обычных дуэлях этим бойцом или выберите другого кнопкой «Сменить».</span>
            <div class="ba-roster">${roster}</div>
          </div></div>`;
      return {
        title: 'Boss Fight',
        side: `<div class="mside b boss-side">${portraitHTML(g.portraits[rival.look], rival.theme.main, rival.theme.dark)}<div class="mname">${esc(rival.name)}</div><span class="chip gold">ЛЕГЕНДА</span></div>`,
        note: `<b class="bp-full">${esc(rival.fullName)}</b> · ${esc(def.kicker)}. ${esc(rival.bio)}`,
        section: `${lock}<div class="section panel boss-rules">
            <div class="section-title"><span class="h2">${esc(def.title)}</span><span class="label">3 фазы</span></div>
            <div class="bp-phases">${phases}</div>
            <ul class="mode-rules">
              <li>Бой длится ${Math.floor(def.duration / 60)}:${String(def.duration % 60).padStart(2, '0')}. Победа — только нокаутом: если время выйдет, титул останется у чемпиона.</li>
              <li>Каждый мощный выстрел чемпион показывает линией прицела и предупреждением на экране: линия следит за бойцом, застывает — и выстрел идёт ровно по ней.</li>
              <li>Легенда держит удар: оглушение и SYSTEM OVERLOAD действуют на чемпиона вдвое короче, а отброс не прерывает DIRECTOR'S CUT — серию срывают только оглушение и SYSTEM OVERLOAD.</li>
            </ul>
            <div class="label bp-label">Фирменные приёмы</div>
            <div class="bp-moves">${moves}</div>
            ${tip ? `<div class="mode-tip"><b>Совет:</b> ${esc(tip)}</div>` : ''}
            <div class="mode-facts">${
              p.firstWinAt
                ? `<span>Побед <b>${p.wins}</b></span><span>Лучшее время <b>${p.bestTime} с</b></span><span>Повтор <b>гонорар ×${String(def.rewards.moneyMult).replace('.', ',')}</b></span>`
                : `<span>Первая победа <b>+$${fw.money} · +${fw.fans} фанатов · +${fw.rep}★</b></span><span>Титул <b>${esc(COSMETICS[fw.cosmetic].name)}</b></span>${p.attempts ? `<span>Лучшее <b>фаза ${p.bestPhase}/3</b></span>` : ''}`
            }</div>
          </div>`,
        start: acc.open ? 'Выйти на бой' : `Закрыто · ${acc.wins}/${acc.need}`,
        locked: !acc.open,
      };
    }
    if (mode.kind === 'challenge') {
      const def = challengeById(mode.id)!;
      const rival = RIVALS[def.rival];
      const p = g.modes.progress(def.id);
      return {
        title: `Prime Challenge`,
        side: `<div class="mside b">${portraitHTML(g.portraits[rival.look], rival.theme.main, rival.theme.dark)}<div class="mname">${esc(rival.name)}</div><span class="chip red">${esc(BEHAVIORS[rival.behavior].label)}</span></div>`,
        note: `«${esc(def.quote)}»`,
        section: `<div class="section panel ch-rules">
            <div class="section-title"><span class="h2 ch-title"><span class="ch-ico">${MODE_ICONS[def.icon]}</span>${esc(def.title)}</span>${p.firstClearAt ? `<span class="chip teal">${UI_ICONS.check.replace('<svg', '<svg width="10" height="10"')} Пройдено</span>` : '<span class="chip gold">Новое</span>'}</div>
            <ul class="mode-rules">${def.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
            <div class="mode-facts">${
              p.firstClearAt
                ? `<span>Рекорд <b>${p.best ? esc(formatChallengeValue(def, p.best)) : '—'}</b></span><span>Пройдено <b>${p.clears}×</b></span>`
                : `<span>Первое прохождение <b>+$${def.firstClear.money} +${def.firstClear.rep}★</b></span>`
            }<span>Повтор <b>обычный гонорар${def.moneyMult !== 1 ? ` ×${String(def.moneyMult).replace('.', ',')}` : ''}</b></span></div>
          </div>`,
        start: 'Начать испытание',
      };
    }
    return null;
  }

  /** What the focused deck card does and how to answer it (the same description as in the CARDS section; no purchase here). */
  private cardDetail(c: CardId): string {
    const g = this.g;
    return cardDetailHTML(cardStanding(g.career, g.save.data, c, (f) => inRoster(g.save.data, f)), { buy: false });
  }

  /**
   * Alpha 1.9.8: the prep screen builds the deck only — new cards are browsed and bought in the CARDS section of the main
   * menu. A short line here says how many can be bought now and leads there (the deck built so far is kept).
   */
  private cardsLink(): string {
    const g = this.g;
    const st = catalogStats(cardCatalog(g.career, g.save.data, (f) => inRoster(g.save.data, f)));
    const line = st.bought === st.shop ? `Все ${st.shop} новых карт ваши.` : st.buyable ? `Можно купить сейчас: ${st.buyable}.` : `Куплено новых карт: ${st.bought} из ${st.shop}.`;
    return `<button class="section panel cards-link" data-act="cards">
        <span class="cl-ico">${UI_ICONS.cards}</span>
        <span class="cl-text"><b>Новые карты — в разделе «Карты»</b><small>${esc(line)} Эффекты, комбо и покупка за гонорары.</small></span>
        ${st.buyable ? `<span class="badge-dot">${st.buyable}</span>` : ''}
        <span class="cl-go">${UI_ICONS.next}</span>
      </button>`;
  }

  private render(keep = true): void {
    const g = this.g;
    const s = g.save.data;
    const f = FIGHTERS[s.selected];
    const rival = RIVALS[s.nextRival];
    const rf = rivalFighterDef(rival);
    const available = g.career.availableCards(s.selected);
    // 1.9.9: the deck's battle-hand pictures load while the player is still here
    preloadCardArt(this.deck, 'md');
    const slots = [0, 1, 2, 3]
      .map((i) => {
        const c = this.deck[i];
        return `<div class="slot" data-act="slot" ${c ? `data-card="${c}"` : ''}>${c ? cardHTML(c, this.focus === c ? 'focus' : '', false) : '+'}</div>`;
      })
      .join('');
    const coll = available
      .map((c) => `<div data-act="coll" data-card="${c}">${cardHTML(c, `${this.deck.includes(c) ? 'in-deck' : ''} ${this.focus === c ? 'focus' : ''}`, false)}</div>`)
      .join('');
    const focusAvail = this.focus !== null && available.includes(this.focus) ? this.focus : null;
    // Alpha 1.6: the same registry the fight uses (chains like HIGH STAKES → SHIELD → POWER SHOT need all their cards)
    const combos = deckCombos(this.deck);
    const diffs = DIFFICULTY_ORDER.map((d) => {
      const def = DIFFICULTIES[d];
      const unlocked = g.career.difficultyUnlocked(d);
      return `<button data-act="diff" data-d="${d}" class="${this.diff === d ? 'on' : ''} ${unlocked ? '' : 'locked'}">
        ${unlocked ? '' : UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')}${def.label}
        <small>${unlocked ? `гонорар ×${String(REWARDS.difficultyMoney?.[d] ?? def.rewardMult).replace('.', ',')}` : `уровень ${def.unlockLevel}`}</small>
      </button>`;
    }).join('');

    const mp = this.modeParts();
    const diffSection = `<div class="section panel">
          <div class="section-title"><span class="h2">Сложность эфира</span><span class="muted" style="font-size:11.5px">${esc(DIFFICULTIES[this.diff].desc)}</span></div>
          <div class="seg-control" style="margin-top:8px">${diffs}</div>
        </div>`;
    this.el.classList.toggle('mode-prep', !!mp);
    this.el.classList.toggle('boss-prep', this.mode.kind === 'boss');
    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">${mp ? esc(mp.title) : 'Подготовка к эфиру'}</div>
      </div>
      <div class="fill scroll" style="padding-bottom:10px">
        <div class="matchup panel">
          <div class="mside a" data-act="roster" style="cursor:pointer">
            ${portraitHTML(g.portraitOf(f.id), f.theme.main, f.theme.dark)}
            <div class="mname">${esc(f.name)}</div>
            <button class="chip teal" aria-label="Сменить бойца">⇄ Сменить</button>
          </div>
          <div class="vs">VS</div>
          ${
            mp
              ? mp.side
              : `<div class="mside b">
            ${portraitHTML(g.portraits[rival.look], rival.theme.main, rival.theme.dark)}
            <div class="mname">${esc(rival.name)}</div>
            <span class="chip red">${esc(BEHAVIORS[rival.behavior].label)}</span>
          </div>`
          }
          <div class="center rival-note" style="grid-column:1/-1;max-width:none;margin-top:6px">${mp ? mp.note : `«${esc(rival.nickname)}» · стиль: ${esc(rf.style.toLowerCase())}. ${esc(rival.bio)}`}</div>
        </div>
        ${mp ? mp.section : ''}
        ${this.arenaSection()}
        ${this.mode.kind === 'survival' || this.mode.kind === 'boss' ? '' : diffSection}
        <div class="section panel">
          <div class="section-title"><span class="h2">Колода · ${this.deck.length}/4</span><span class="label">3 в руке + 1 в очереди</span></div>
          <div class="deck-slots">${slots}</div>
          <div class="label" style="margin:10px 4px 0">Доступные карты (${available.length}) — нажмите, чтобы добавить</div>
          <div class="collection">${coll}</div>
          ${focusAvail ? this.cardDetail(focusAvail) : ''}
          <div class="label" style="margin:12px 4px 0">Комбо в этой колоде</div>
          <div class="combo-list">${
            combos.length
              ? combos
                  .map(
                    (c) =>
                      `<div class="combo-item"><b>${esc(c.name)}<small class="cmb-role r-${c.role}">${COMBO_ROLE_LABEL[c.role]}</small></b><span>${c.tag ? `<i>${esc(c.tag)}</i> ` : ''}${esc(c.desc)}</span></div>`,
                  )
                  .join('')
              : '<div class="combo-item"><span>Нет пар для комбо. Попробуйте DASH + POWER SHOT или SHOCK + POWER SHOT.</span></div>'
          }</div>
          ${combos.length ? `<p class="combo-fresh">${esc(COMBO_FRESH_NOTE)}</p>` : ''}
        </div>
        ${this.cardsLink()}
      </div>
      <div style="padding:8px 12px 0">
        <button class="btn big wide ${this.deck.length === 4 && !mp?.locked ? '' : 'disabled'}" data-act="start"><span class="shine"></span>${mp ? mp.start : 'Начать эфир'}</button>
      </div>`,
      keep,
    );
  }
}
