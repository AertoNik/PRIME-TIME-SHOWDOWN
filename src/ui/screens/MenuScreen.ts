import { FIGHTERS, RIVALS, BEHAVIORS } from '../../config/fighters';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { CARDS, PASSIVES } from '../../config/cards';
import { countUp, el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

export class MenuScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private shownMoney = -1;
  private shownRep = -1;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'menu');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      this.g.audio.ui(act === 'fight' ? 'confirm' : 'click');
      if (act === 'fight') this.g.goto('prep');
      else if (act === 'roster') this.g.goto('roster');
      else if (act === 'career') this.g.goto('career');
      else if (act === 'settings') this.g.openSettings();
    });
  }

  onShow(): void {
    const g = this.g;
    const s = g.save.data;
    const lvl = g.career.level();
    const f = FIGHTERS[s.selected];
    const fp = s.fighters[s.selected];
    const rival = RIVALS[s.nextRival];
    const unclaimed = g.career.unclaimed();
    this.el.innerHTML = `
      <div class="topbar" style="padding-right:62px">
        <div class="lvl-badge" title="Уровень продюсера">${lvl.level}</div>
        <div class="stat-pill"><span class="ico money">${UI_ICONS.money}</span><span data-money>${formatMoney(this.shownMoney < 0 ? s.money : this.shownMoney)}</span></div>
        <div class="stat-pill"><span class="ico rep">${UI_ICONS.rep}</span><span data-rep>${Math.floor(this.shownRep < 0 ? s.reputation : this.shownRep)}</span></div>
      </div>
      <div class="menu-head">
        <div class="logo"><span class="live">LIVE</span><span class="l1">PRIME TIME</span><span class="l2">SHOWDOWN</span></div>
        <div class="label" style="margin-top:2px">${esc(s.orgName)} · ${esc(lvl.title)}</div>
      </div>
      <div class="fill pass"></div>
      <div class="fighter-plate panel" data-act="roster" style="cursor:pointer">
        ${portraitHTML(g.portraits[f.look], f.theme.main, f.theme.dark)}
        <div class="meta">
          <div class="name">${esc(f.name)}</div>
          <div class="nick" style="color:${f.theme.accent}">«${esc(f.nickname)}» · ${esc(f.style)}</div>
          <div class="row" style="margin-top:6px;gap:6px;flex-wrap:wrap">
            <span class="chip gold">${UI_ICONS.fans.replace('<svg', '<svg width="11" height="11" style="color:#ff4fd8"')} ${formatNumber(fp.fans)} фанатов</span>
            <span class="chip">${esc(fameTier(fp.fans))}</span>
          </div>
          <div class="plate-abilities"><span>◆ ${esc(PASSIVES[f.passive].name)}</span><span style="color:${CARDS[f.signature].color}">★ ${esc(CARDS[f.signature].name)}</span></div>
        </div>
      </div>
      <div class="next-bout">
        <span>След. эфир</span>
        <b>VS ${esc(rival.name)} «${esc(rival.nickname)}»</b>
        <span class="chip red">${esc(BEHAVIORS[rival.behavior].label)}</span>
      </div>
      <div class="spacer-8"></div>
      <div class="menu-actions">
        <button class="btn big wide" data-act="fight"><span class="shine"></span>В БОЙ</button>
        <div class="menu-nav">
          <button class="btn ghost" data-act="roster">${UI_ICONS.users.replace('<svg', '<svg width="18" height="18"')} Бойцы</button>
          <button class="btn ghost" data-act="career" style="position:relative">${UI_ICONS.career.replace('<svg', '<svg width="18" height="18"')} Карьера${unclaimed ? `<span class="badge-dot">${unclaimed}</span>` : ''}</button>
          <button class="icon-btn" data-act="settings" aria-label="Настройки" style="width:50px;height:46px">${UI_ICONS.gear}</button>
        </div>
      </div>`;
    // currencies roll up to their new values after a match
    const moneyEl = this.el.querySelector('[data-money]') as HTMLElement;
    const repEl = this.el.querySelector('[data-rep]') as HTMLElement;
    if (this.shownMoney >= 0 && this.shownMoney !== s.money) {
      countUp(moneyEl, this.shownMoney, s.money, 0.9, (n) => formatMoney(n), () => g.audio.ui('coin'));
      moneyEl.parentElement!.classList.add('bump');
    }
    if (this.shownRep >= 0 && this.shownRep !== s.reputation) countUp(repEl, this.shownRep, s.reputation, 0.9, (n) => String(Math.floor(n)));
    this.shownMoney = s.money;
    this.shownRep = s.reputation;
  }
}
