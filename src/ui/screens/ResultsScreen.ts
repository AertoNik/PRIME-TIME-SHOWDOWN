import { GOALS } from '../../config/career';
import { COMBOS } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import type { Difficulty, FighterId, RivalId } from '../../config/types';
import type { MatchResultData } from '../../combat/types';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { gradeFor, levelFor, type MatchOutcome } from '../../meta/CareerSystem';
import { countUp, el, esc } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

export interface ResultsParams {
  result: MatchResultData;
  outcome: MatchOutcome;
  fighter: FighterId;
  rival: RivalId;
  difficulty: Difficulty;
}

export class ResultsScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'results');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'again') {
        this.g.audio.ui('confirm');
        this.g.startMatch();
      } else if (act === 'menu') {
        this.g.audio.ui('click');
        this.g.goto('menu');
      } else if (act === 'prep') {
        this.g.audio.ui('click');
        this.g.goto('prep');
      } else if (act === 'career') {
        this.g.audio.ui('click');
        this.g.goto('career');
      }
    });
  }

  onShow(params?: unknown): void {
    const p = params as ResultsParams;
    const r = p.result;
    const o = p.outcome;
    const f = FIGHTERS[p.fighter];
    const titles = { win: 'ПОБЕДА', loss: 'ПОРАЖЕНИЕ', draw: 'НИЧЬЯ' };
    const methods = { ko: 'НОКАУТ', time: 'ПО ОЧКАМ · ВРЕМЯ ВЫШЛО', forfeit: 'ПРОДЮСЕР СНЯЛ БОЙЦА' };
    const grade = gradeFor(r.rating);
    const bestCombo = r.bestCombo ? COMBOS.find((c) => c.id === r.bestCombo)!.name : '—';
    const lvlAfter = levelFor(this.g.save.data.reputation);
    const lvlBefore = levelFor(o.repBefore);
    const levelUp = o.levelAfter > o.levelBefore;
    const lines = o.rewards.lines
      .map(
        (l, i) =>
          `<div class="reward-line" style="animation-delay:${0.9 + i * 0.12}s">
            <span class="rl-label">${esc(l.label)}${l.note ? ` <span class="rl-note">· ${esc(l.note)}</span>` : ''}</span>
            <span class="rl-val ${l.kind}">${l.kind === 'money' ? (l.value ? '+' + formatMoney(l.value) : '') : '+' + formatNumber(l.value)}${l.kind === 'rep' ? ' ★' : ''}</span>
          </div>`,
      )
      .join('');
    const goals = o.newGoals
      .map((id) => {
        const g = GOALS.find((x) => x.id === id)!;
        return `<div class="goal-done">${UI_ICONS.star}<div class="fill"><div class="h2" style="font-size:12px">Цель выполнена: ${esc(g.title)}</div><div class="muted" style="font-size:11px">Заберите $${g.reward.money} и +${g.reward.rep}★ в разделе «Карьера»</div></div></div>`;
      })
      .join('');
    const delayAfterLines = 0.9 + o.rewards.lines.length * 0.12;

    this.el.innerHTML = `
      <div class="fill scroll" style="padding-top:4px">
        <div class="result-title">
          <div class="rt ${r.outcome}">${titles[r.outcome]}</div>
          <div class="rs">${methods[r.method]} · ${esc(f.name)} VS ${esc(this.g.rivalName(p.rival))}</div>
        </div>
        <div class="rating-card panel">
          <div class="grade ${grade}">${grade}</div>
          <div class="fill" style="min-width:0">
            <div class="label">Рейтинг шоу</div>
            <div class="rating-big"><span data-rating>0</span><span class="muted" style="font-size:15px">/100</span></div>
            <div class="label" style="margin-top:4px">Пик ${r.peakRating} · Ср. ${r.avgRating}</div>
            <div class="label" style="margin-top:6px">Комбо: <span style="color:var(--gold)">${esc(bestCombo)}</span></div>
          </div>
        </div>
        <div class="stats-grid">
          <div class="kv"><div class="v">${formatNumber(r.damageDealt)}</div><div class="k">Урон нанесён</div></div>
          <div class="kv"><div class="v">${r.combos}</div><div class="k">Комбо</div></div>
          <div class="kv"><div class="v">${r.perfects}</div><div class="k">Идеальные приёмы</div></div>
        </div>
        <div class="section panel">
          <div class="section-title"><span class="h2">Гонорар продюсера</span><span class="label">почему столько</span></div>
          <div class="reward-list">${lines}</div>
          <div class="total-row" style="animation:lineIn .3s ease ${delayAfterLines}s both">
            <span class="h2">Итого</span>
            <span class="display" style="font-size:20px;color:var(--gold)" data-total>+$0</span>
          </div>
        </div>
        <div class="section panel" style="animation:lineIn .35s ease ${delayAfterLines + 0.2}s both">
          <div class="row between">
            <span class="h2">${esc(f.name)}: фанаты</span>
            <span class="display" style="font-size:13px;color:#ff8ae6"><span data-fans>${formatNumber(o.fighterFansBefore)}</span></span>
          </div>
          <div class="row between" style="margin-top:12px">
            <span class="h2">Уровень продюсера ${lvlAfter.level}${levelUp ? ' <span class="chip gold" style="margin-left:6px">LEVEL UP!</span>' : ''}</span>
            <span class="label">${Math.floor(this.g.save.data.reputation)}${lvlAfter.next !== null ? ' / ' + lvlAfter.next : ''} ★</span>
          </div>
          <div class="progress" style="margin-top:8px"><i data-lvl style="transform:scaleX(${levelUp ? 0 : lvlBefore.progress})"></i></div>
          ${levelUp ? `<div class="muted" style="font-size:12px;margin-top:8px">Новые возможности: проверьте контракты и сложность «${lvlAfter.level >= 4 ? 'Чемпион' : 'Профи'}».</div>` : ''}
        </div>
        <div style="margin:0 12px">${goals}</div>
      </div>
      <div class="result-actions">
        <button class="btn ghost" data-act="menu">Главное меню</button>
        <button class="btn" data-act="again"><span class="shine"></span>Ещё бой</button>
      </div>
      <div class="center" style="margin-top:10px">
        <button class="label" data-act="prep" style="color:var(--teal);padding:6px 10px">Изменить колоду / сложность</button>
      </div>`;

    const ratingEl = this.el.querySelector('[data-rating]') as HTMLElement;
    const totalEl = this.el.querySelector('[data-total]') as HTMLElement;
    const fansEl = this.el.querySelector('[data-fans]') as HTMLElement;
    const lvlBar = this.el.querySelector('[data-lvl]') as HTMLElement;
    setTimeout(() => countUp(ratingEl, 0, r.rating, 1.1, (n) => String(Math.round(n))), 350);
    setTimeout(
      () => countUp(totalEl, 0, o.rewards.money, 1.0, (n) => '+' + formatMoney(n), () => this.g.audio.ui('coin')),
      delayAfterLines * 1000,
    );
    setTimeout(
      () => countUp(fansEl, o.fighterFansBefore, o.fighterFansBefore + o.rewards.fans, 1.0, (n) => formatNumber(n) + (n >= o.fighterFansBefore + o.rewards.fans - 0.5 ? `  (+${formatNumber(o.rewards.fans)})` : '')),
      (delayAfterLines + 0.3) * 1000,
    );
    setTimeout(() => {
      lvlBar.style.transform = `scaleX(${lvlAfter.progress})`;
      if (levelUp) this.g.audio.ui('level');
    }, (delayAfterLines + 0.5) * 1000);
  }
}
