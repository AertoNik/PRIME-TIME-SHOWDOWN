import { CARDS, COMBOS } from '../../config/cards';
import { BEHAVIORS, DIFFICULTIES, DIFFICULTY_ORDER, FIGHTERS, RIVALS, rivalFighterDef } from '../../config/fighters';
import type { CardId, Difficulty } from '../../config/types';
import type { Game } from '../../game/Game';
import { cardHTML, el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

export class PrepScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private deck: CardId[] = [];
  private focus: CardId | null = null;
  private diff: Difficulty = 'rookie';

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'prep');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  onShow(): void {
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
      g.goto('menu');
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
      s.difficulty = this.diff;
      g.save.save();
      g.audio.ui('confirm');
      g.startMatch();
    }
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

    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Подготовка к эфиру</div>
      </div>
      <div class="fill scroll" style="padding-bottom:10px">
        <div class="matchup panel">
          <div class="mside a" data-act="roster" style="cursor:pointer">
            ${portraitHTML(g.portraits[f.look], f.theme.main, f.theme.dark)}
            <div class="mname">${esc(f.name)}</div>
            <button class="chip teal" aria-label="Сменить бойца">⇄ Сменить</button>
          </div>
          <div class="vs">VS</div>
          <div class="mside b">
            ${portraitHTML(g.portraits[rival.look], rival.theme.main, rival.theme.dark)}
            <div class="mname">${esc(rival.name)}</div>
            <span class="chip red">${esc(BEHAVIORS[rival.behavior].label)}</span>
          </div>
          <div class="center rival-note" style="grid-column:1/-1;max-width:none;margin-top:6px">«${esc(rival.nickname)}» · стиль: ${esc(rf.style.toLowerCase())}. ${esc(rival.bio)}</div>
        </div>
        <div class="section panel">
          <div class="section-title"><span class="h2">Сложность эфира</span><span class="muted" style="font-size:11.5px">${esc(DIFFICULTIES[this.diff].desc)}</span></div>
          <div class="seg-control" style="margin-top:8px">${diffs}</div>
        </div>
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
        <button class="btn big wide ${this.deck.length === 4 ? '' : 'disabled'}" data-act="start"><span class="shine"></span>Начать эфир</button>
      </div>`;
  }
}
