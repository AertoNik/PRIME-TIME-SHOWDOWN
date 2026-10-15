import { CARDS, PASSIVES } from '../../config/cards';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import type { FighterId } from '../../config/types';
import { formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { cardHTML, el, esc, portraitHTML } from '../dom';
import { PASSIVE_ICONS, UI_ICONS } from '../icons';
import type { Screen } from '../UI';

const BAR_LABELS: [keyof (typeof FIGHTERS)['ray']['bars'], string][] = [
  ['health', 'Здоровье'],
  ['damage', 'Урон'],
  ['speed', 'Скорость'],
  ['range', 'Дальность'],
  ['control', 'Контроль'],
];

export class RosterScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private idx = 0;
  private dragId: number | null = null;
  private lastX = 0;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'roster');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('pointerdown', (e) => {
      const z = (e.target as HTMLElement).closest('.drag-zone');
      if (!z || (e.target as HTMLElement).closest('.nav-arrow')) return;
      this.dragId = e.pointerId;
      this.lastX = e.clientX;
      this.g.showcase.setDragging(true);
    });
    window.addEventListener('pointermove', (e) => {
      if (this.dragId !== e.pointerId) return;
      const dx = e.clientX - this.lastX;
      this.lastX = e.clientX;
      this.g.showcase.drag(dx);
    });
    const end = (e: PointerEvent) => {
      if (this.dragId !== e.pointerId) return;
      this.dragId = null;
      this.g.showcase.setDragging(false);
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  get viewing(): FighterId {
    return FIGHTER_ORDER[this.idx];
  }

  onShow(params?: unknown): void {
    const id = (typeof params === 'string' ? params : this.g.save.data.selected) as FighterId;
    this.idx = Math.max(0, FIGHTER_ORDER.indexOf(id));
    this.render();
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const act = t.dataset.act!;
    const g = this.g;
    if (act === 'back') {
      g.audio.ui('click');
      g.goto('menu');
    } else if (act === 'tab') {
      g.audio.ui('swipe');
      this.idx = Number(t.dataset.i);
      this.render();
    } else if (act === 'prev' || act === 'next') {
      g.audio.ui('swipe');
      this.idx = (this.idx + (act === 'next' ? 1 : FIGHTER_ORDER.length - 1)) % FIGHTER_ORDER.length;
      this.render();
    } else if (act === 'select') {
      if (g.career.select(this.viewing)) {
        g.audio.ui('confirm');
        g.ui.toast(`${FIGHTERS[this.viewing].name} выходит в эфир следующим!`);
        g.showcase.cheer();
        this.render();
      }
    } else if (act === 'sign') {
      const id = this.viewing;
      const c = g.career.canSign(id);
      if (!c.ok) {
        g.audio.ui('deny');
        g.ui.toast(c.reason);
        return;
      }
      const fresh = g.career.sign(id);
      g.audio.ui('level');
      g.ui.toast(`Контракт подписан! ${FIGHTERS[id].fullName} в вашей команде.`, true);
      if (fresh.length) setTimeout(() => g.ui.toast('Цель карьеры выполнена — заберите награду!', true), 900);
      g.showcase.cheer();
      this.render();
    }
  }

  private render(): void {
    const g = this.g;
    const s = g.save.data;
    const id = this.viewing;
    const f = FIGHTERS[id];
    const fp = s.fighters[id];
    g.showcase.show(f.look, f.theme.accent);
    const sig = CARDS[f.signature];
    const pas = PASSIVES[f.passive];
    const tabs = FIGHTER_ORDER.map((fid, i) => {
      const ff = FIGHTERS[fid];
      const locked = !s.fighters[fid].unlocked;
      return `<button class="roster-tab ${i === this.idx ? 'active' : ''} ${locked ? 'locked' : ''}" data-act="tab" data-i="${i}">
        ${portraitHTML(g.portraits[ff.look], ff.theme.main, ff.theme.dark)}
        ${locked ? `<span class="lock">${UI_ICONS.lock}</span>` : ''}
      </button>`;
    }).join('');
    const bars = BAR_LABELS.map(
      ([k, label]) =>
        `<div class="sl">${label}</div><div class="segs" style="--sc1:${f.theme.accent};--sc2:${f.theme.main}">${[0, 1, 2, 3, 4]
          .map((i) => `<i class="${i < f.bars[k] ? 'on' : ''}"></i>`)
          .join('')}</div>`,
    ).join('');

    let action = '';
    if (fp.unlocked) {
      action =
        s.selected === id
          ? `<button class="btn ghost wide disabled">${UI_ICONS.check.replace('<svg', '<svg width="16" height="16"')} Выбран для эфира</button>`
          : `<button class="btn teal wide" data-act="select">Выбрать бойца</button>`;
    } else {
      const c = g.career.canSign(id);
      const lvl = g.career.level().level;
      const needLvl = f.contract!.level;
      const cost = f.contract!.cost;
      const lvlOk = lvl >= needLvl;
      const moneyOk = s.money >= cost;
      action = `<div class="req-list">
          <span class="req ${lvlOk ? 'ok' : ''}">${lvlOk ? '✓' : '✗'} Уровень продюсера ${needLvl}${lvlOk ? '' : ` · у вас ${lvl}`}</span>
          <span class="req ${moneyOk ? 'ok' : ''}">${moneyOk ? '✓' : '✗'} Бюджет $${cost}${moneyOk ? '' : ` · у вас $${Math.floor(s.money)}`}</span>
        </div>
        <button class="btn wide ${c.ok ? '' : 'disabled'}" data-act="sign"><span class="shine"></span>Подписать контракт · $${cost}</button>
        ${c.ok ? '' : `<div class="center muted" style="font-size:11.5px;margin-top:8px">Побеждайте в эфирах, чтобы заработать репутацию и деньги</div>`}`;
    }

    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Мои бойцы</div>
      </div>
      <div class="roster-tabs">${tabs}</div>
      <div class="drag-zone">
        <button class="nav-arrow l" data-act="prev" aria-label="Предыдущий">${UI_ICONS.back}</button>
        <button class="nav-arrow r" data-act="next" aria-label="Следующий">${UI_ICONS.next}</button>
        <div class="drag-hint">ПОТЯНИТЕ, ЧТОБЫ ПОВЕРНУТЬ</div>
      </div>
      <div class="sheet panel scroll">
        <div class="title-row">
          <div class="fill">
            <div class="fname">${esc(f.name)}</div>
            <div class="fnick" style="color:${f.theme.accent}">«${esc(f.nickname)}»</div>
          </div>
          <div style="text-align:right">
            <span class="chip ${s.selected === id ? 'gold' : fp.unlocked ? 'teal' : 'orange'}">${s.selected === id ? '★ Выбран' : fp.unlocked ? 'В составе' : 'Свободный агент'}</span>
            <div class="label" style="margin-top:6px">${esc(f.style)}</div>
          </div>
        </div>
        <div class="proscons">${f.strengths.map((x) => `<span class="pro">+ ${esc(x)}</span>`).join('')}${f.weaknesses.map((x) => `<span class="con">− ${esc(x)}</span>`).join('')}</div>
        <p>${esc(f.bio)}</p>
        <div class="stat-bars">${bars}</div>
        <div class="ability">
          <div class="ab-ico">${PASSIVE_ICONS[f.passive]}</div>
          <div><b>ПАССИВ · ${esc(pas.name)}</b><span>${esc(pas.desc)}</span></div>
        </div>
        <div class="ability">
          <div style="width:46px;flex:none">${cardHTML(f.signature, '', false)}</div>
          <div><b>ФИРМЕННАЯ КАРТА · ${esc(sig.name)} · ${sig.cost}⚡</b><span>${esc(sig.desc)}</span></div>
        </div>
        <div class="kv-grid">
          <div class="kv"><div class="v">${formatNumber(fp.fans)}</div><div class="k">${esc(fameTier(fp.fans))}</div></div>
          <div class="kv"><div class="v">${fp.wins}-${fp.losses}${fp.draws ? '-' + fp.draws : ''}</div><div class="k">Победы-поражения</div></div>
          <div class="kv"><div class="v">${fp.bestRating || '—'}</div><div class="k">Лучший рейтинг</div></div>
        </div>
        <div class="spacer-8"></div>
        ${action}
      </div>`;
  }
}
