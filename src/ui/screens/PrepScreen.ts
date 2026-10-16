import { CARDS, COMBOS } from '../../config/cards';
import { BEHAVIORS, DIFFICULTIES, DIFFICULTY_ORDER, FIGHTERS, FIGHTER_ORDER, RIVALS, RIVAL_ORDER, rivalFighterDef } from '../../config/fighters';
import { SURVIVAL, challengeById } from '../../config/modes.config';
import { bossById } from '../../config/boss.config';
import { COSMETICS } from '../../config/cosmetics.config';
import type { CardId, Difficulty } from '../../config/types';
import type { Game } from '../../game/Game';
import { formatChallengeValue } from '../../meta/GameModes';
import { cardHTML, el, esc, portraitHTML } from '../dom';
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
    this.g.showcase.show(f.look, f.theme.accent);
    this.render();
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
      // access: Classic Duel wins with the selected fighter
      const sel = g.save.data.selected;
      const acc = g.modes.bossAccess(def.id, sel);
      const roster = FIGHTER_ORDER.filter((id) => g.save.data.fighters[id].unlocked)
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

  private render(): void {
    const g = this.g;
    const s = g.save.data;
    const f = FIGHTERS[s.selected];
    const rival = RIVALS[s.nextRival];
    const rf = rivalFighterDef(rival);
    const available = g.career.availableCards(s.selected);
    const slots = [0, 1, 2, 3]
      .map((i) => {
        const c = this.deck[i];
        return `<div class="slot" data-act="slot" ${c ? `data-card="${c}"` : ''}>${c ? cardHTML(c, this.focus === c ? 'focus' : '', false) : '+'}</div>`;
      })
      .join('');
    const coll = available
      .map((c) => `<div data-act="coll" data-card="${c}">${cardHTML(c, `${this.deck.includes(c) ? 'in-deck' : ''} ${this.focus === c ? 'focus' : ''}`, false)}</div>`)
      .join('');
    const fc = this.focus ? CARDS[this.focus] : null;
    const combos = COMBOS.filter((c) => c.first.some((x) => this.deck.includes(x)) && c.second.some((x) => this.deck.includes(x)));
    const diffs = DIFFICULTY_ORDER.map((d) => {
      const def = DIFFICULTIES[d];
      const unlocked = g.career.difficultyUnlocked(d);
      return `<button data-act="diff" data-d="${d}" class="${this.diff === d ? 'on' : ''} ${unlocked ? '' : 'locked'}">
        ${unlocked ? '' : UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')}${def.label}
        <small>${unlocked ? `награда ×${def.rewardMult}` : `уровень ${def.unlockLevel}`}</small>
      </button>`;
    }).join('');

    const mp = this.modeParts();
    const diffSection = `<div class="section panel">
          <div class="section-title"><span class="h2">Сложность эфира</span><span class="muted" style="font-size:11.5px">${esc(DIFFICULTIES[this.diff].desc)}</span></div>
          <div class="seg-control" style="margin-top:8px">${diffs}</div>
        </div>`;
    this.el.classList.toggle('mode-prep', !!mp);
    this.el.classList.toggle('boss-prep', this.mode.kind === 'boss');
    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">${mp ? esc(mp.title) : 'Подготовка к эфиру'}</div>
      </div>
      <div class="fill scroll" style="padding-bottom:10px">
        <div class="matchup panel">
          <div class="mside a" data-act="roster" style="cursor:pointer">
            ${portraitHTML(g.portraits[f.look], f.theme.main, f.theme.dark)}
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
        ${this.mode.kind === 'survival' || this.mode.kind === 'boss' ? '' : diffSection}
        <div class="section panel">
          <div class="section-title"><span class="h2">Колода · ${this.deck.length}/4</span><span class="label">3 в руке + 1 в очереди</span></div>
          <div class="deck-slots">${slots}</div>
          <div class="label" style="margin:10px 4px 0">Доступные карты — нажмите, чтобы добавить</div>
          <div class="collection">${coll}</div>
          ${
            fc
              ? `<div class="card-detail"><div class="cd-head"><span class="cd-name">${esc(fc.name)}</span><span class="chip">${esc(fc.role)}</span><span class="chip teal">${fc.cost} ЭНЕРГИИ</span>${fc.exclusive ? '<span class="chip gold">ФИРМЕННАЯ</span>' : ''}</div><p>${esc(fc.desc)}</p></div>`
              : ''
          }
          <div class="label" style="margin:12px 4px 0">Комбо в этой колоде</div>
          <div class="combo-list">${
            combos.length
              ? combos.map((c) => `<div class="combo-item"><b>${esc(c.name)}</b><span>${esc(c.desc)}</span></div>`).join('')
              : '<div class="combo-item"><span>Нет пар для комбо. Попробуйте DASH + POWER SHOT или SHOCK + POWER SHOT.</span></div>'
          }</div>
        </div>
      </div>
      <div style="padding:8px 12px 0">
        <button class="btn big wide ${this.deck.length === 4 && !mp?.locked ? '' : 'disabled'}" data-act="start"><span class="shine"></span>${mp ? mp.start : 'Начать эфир'}</button>
      </div>`;
  }
}
