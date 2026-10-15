import { GOALS, type GoalId } from '../../config/career';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { el, esc, portraitHTML } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

export class CareerScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private editing = false;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'career');
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') this.commitName();
    });
  }

  onShow(): void {
    this.editing = false;
    const s = this.g.save.data;
    const f = FIGHTERS[s.selected];
    this.g.showcase.show(f.look, f.theme.accent);
    this.render();
  }

  private commitName(): void {
    const input = this.el.querySelector('input') as HTMLInputElement | null;
    if (input) this.g.career.rename(input.value);
    this.editing = false;
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
    } else if (act === 'edit') {
      g.audio.ui('click');
      this.editing = true;
      this.render();
      const input = this.el.querySelector('input') as HTMLInputElement | null;
      input?.focus();
      input?.select();
    } else if (act === 'save-name') {
      g.audio.ui('confirm');
      this.commitName();
    } else if (act === 'claim') {
      const id = t.dataset.goal as GoalId;
      const r = g.career.claim(id);
      if (r) {
        g.audio.ui('level');
        g.ui.toast(`Награда получена: +${formatMoney(r.money)} и +${r.rep} репутации`, true);
        this.render();
      }
    } else if (act === 'contract') {
      g.audio.ui('click');
      g.goto('roster', t.dataset.f);
    }
  }

  private render(): void {
    const g = this.g;
    const s = g.save.data;
    const lvl = g.career.level();
    const repInLevel = lvl.next === null ? 1 : lvl.progress;
    const goals = GOALS.map((goal) => {
      const st = s.goals[goal.id];
      const prog = g.career.goalProgress(goal);
      const pct = Math.min(1, prog / goal.target);
      const progText = goal.target > 1 ? `${formatNumber(prog)} / ${formatNumber(goal.target)}` : st.done ? 'Готово' : 'Не выполнено';
      let btn = `<span class="label">${progText}</span>`;
      if (st.done && !st.claimed) btn = `<button class="btn" data-act="claim" data-goal="${goal.id}"><span class="shine"></span>Забрать</button>`;
      else if (st.claimed) btn = `<span class="chip teal">${UI_ICONS.check.replace('<svg', '<svg width="10" height="10"')} Получено</span>`;
      return `<div class="goal ${st.done ? 'done' : ''} ${st.claimed ? 'claimed' : ''}">
        <div class="gi">${st.done ? UI_ICONS.trophy : UI_ICONS.star}</div>
        <div class="gm">
          <div class="gt">${esc(goal.title)}</div>
          <div class="gd">${esc(goal.desc)} · <span style="color:var(--gold)">$${goal.reward.money}</span> · <span style="color:var(--teal)">+${goal.reward.rep}★</span></div>
          <div class="progress ${st.done ? 'gold' : ''}"><i style="transform:scaleX(${pct})"></i></div>
        </div>
        ${btn}
      </div>`;
    }).join('');
    const contracts = FIGHTER_ORDER.map((id) => {
      const f = FIGHTERS[id];
      const fp = s.fighters[id];
      const c = g.career.canSign(id);
      let right = '';
      if (fp.unlocked) right = `<span class="chip teal">В составе</span>`;
      else if (c.ok) right = `<button class="btn" data-act="contract" data-f="${id}"><span class="shine"></span>$${f.contract!.cost}</button>`;
      else right = `<button class="btn ghost" data-act="contract" data-f="${id}">$${f.contract!.cost}</button>`;
      return `<div class="contract">
        ${portraitHTML(g.portraits[f.look], f.theme.main, f.theme.dark)}
        <div class="cm">
          <div class="gt" style="font-family:var(--font-display);font-weight:800;font-size:13px">${esc(f.name)} <span style="color:${f.theme.accent};font-size:10.5px;white-space:nowrap">«${esc(f.nickname)}»</span></div>
          <div class="gd" style="font-size:11.5px;color:var(--muted)">${fp.unlocked ? `${formatNumber(fp.fans)} фанатов · ${esc(fameTier(fp.fans))}` : esc(c.reason || 'Готов подписать')}</div>
        </div>
        ${right}
      </div>`;
    }).join('');

    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Карьера продюсера</div>
      </div>
      <div class="fill scroll" style="padding-bottom:14px">
        <div class="org-card panel">
          <div class="org-name">
            ${
              this.editing
                ? `<input maxlength="28" value="${esc(s.orgName)}" aria-label="Название студии"/><button class="icon-btn" data-act="save-name" aria-label="Сохранить">${UI_ICONS.check}</button>`
                : `<span class="fill">${esc(s.orgName)}</span><button class="icon-btn" data-act="edit" aria-label="Переименовать" style="width:34px;height:34px">${UI_ICONS.pencil}</button>`
            }
          </div>
          <div class="row" style="margin-top:12px;gap:12px">
            <div class="lvl-badge" style="width:52px;height:52px;font-size:20px">${lvl.level}</div>
            <div class="fill">
              <div class="h2">${esc(lvl.title)}</div>
              <div class="label" style="margin:4px 0 6px">Репутация ${Math.floor(s.reputation)}${lvl.next !== null ? ` / ${lvl.next}` : ' · максимум'}</div>
              <div class="progress"><i style="transform:scaleX(${repInLevel})"></i></div>
            </div>
          </div>
        </div>
        <div class="stats-grid">
          <div class="kv"><div class="v" style="color:var(--gold)">${formatMoney(s.money)}</div><div class="k">Бюджет</div></div>
          <div class="kv"><div class="v">${s.wins}-${s.losses}-${s.draws}</div><div class="k">Победы-пор.-ничьи</div></div>
          <div class="kv"><div class="v">${s.bestRating || '—'}</div><div class="k">Лучший рейтинг</div></div>
          <div class="kv"><div class="v">${formatNumber(g.career.totalFans())}</div><div class="k">Фанаты команды</div></div>
          <div class="kv"><div class="v">${g.career.signedCount()}/3</div><div class="k">Бойцов в составе</div></div>
          <div class="kv"><div class="v">${formatMoney(s.totalEarned)}</div><div class="k">Заработано</div></div>
        </div>
        <div class="section panel">
          <div class="section-title"><span class="h2">Контракты</span><span class="label">открываются с уровнем</span></div>
          ${contracts}
        </div>
        <div class="section panel">
          <div class="section-title"><span class="h2">Цели сезона</span><span class="label">${GOALS.filter((x) => s.goals[x.id].done).length}/${GOALS.length}</span></div>
          ${goals}
        </div>
      </div>`;
  }
}
