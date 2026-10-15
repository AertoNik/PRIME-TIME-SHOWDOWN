import { GOALS } from '../../config/career';
import { COMBOS } from '../../config/cards';
import { FIGHTERS } from '../../config/fighters';
import type { Difficulty, FighterId, RivalId } from '../../config/types';
import type { MatchResultData } from '../../combat/types';
import type { MatchEventOutcome } from '../../meta/EventManager';
import { ICONS } from '../eventArt';
import { currencyIcon } from './EventsScreen';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game, ModeSession } from '../../game/Game';
import { gradeFor, levelFor, type MatchOutcome } from '../../meta/CareerSystem';
import { formatChallengeValue, type ChallengeOutcome } from '../../meta/GameModes';
import { MODE_ICONS } from '../modeArt';
import { countUp, el, esc } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

export interface ResultsParams {
  result: MatchResultData;
  outcome: MatchOutcome;
  fighter: FighterId;
  rival: RivalId;
  difficulty: Difficulty;
  event?: MatchEventOutcome | null;
  /** Game mode of the fight (absent / classic for a Classic Duel). */
  mode?: ModeSession;
  /** Prime Challenge verdict, records and first-clear reward. */
  challenge?: ChallengeOutcome | null;
}

export class ResultsScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  /** The fight being shown (to replay a challenge with the same settings). */
  private last: ResultsParams | null = null;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'results');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) {
        this.skip?.();
        return;
      }
      const act = t.dataset.act;
      const mode = this.last?.mode;
      if (act === 'again') {
        this.g.audio.ui('confirm');
        if (mode?.kind === 'challenge') this.g.startChallenge(mode.id, this.last!.difficulty);
        else this.g.startMatch();
      } else if (act === 'menu') {
        this.g.audio.ui('click');
        this.g.goto('menu');
      } else if (act === 'prep') {
        this.g.audio.ui('click');
        this.g.goto('prep', { mode: mode?.kind === 'challenge' ? { kind: 'challenge', id: mode.id } : { kind: 'classic' } });
      } else if (act === 'modes') {
        this.g.audio.ui('click');
        this.g.goto('modes');
      } else if (act === 'events') {
        this.g.audio.ui('click');
        this.g.goto('events');
      } else if (act === 'roster') {
        this.g.audio.ui('click');
        this.g.goto('roster', { back: 'prep' });
      } else if (act === 'career') {
        this.g.audio.ui('click');
        this.g.goto('career');
      }
    });
  }

  private skip: (() => void) | null = null;

  onShow(params?: unknown): void {
    const p = params as ResultsParams;
    this.last = p;
    const r = p.result;
    const o = p.outcome;
    const f = FIGHTERS[p.fighter];
    const titles = { win: 'ПОБЕДА', loss: 'ПОРАЖЕНИЕ', draw: 'НИЧЬЯ' };
    const methods = { ko: 'НОКАУТ', time: 'ПО ОЧКАМ · ВРЕМЯ ВЫШЛО', forfeit: 'ПРОДЮСЕР СНЯЛ БОЙЦА' };
    const grade = gradeFor(r.rating);
    const lvlAfter = levelFor(this.g.save.data.reputation);
    const lvlBefore = levelFor(o.repBefore);
    const levelUp = o.levelAfter > o.levelBefore;
    // quick, readable reveal (skippable with a tap)
    const T0 = 0.45;
    const STEP = 0.07;
    const lines = o.rewards.lines
      .map(
        (l, i) =>
          `<div class="reward-line" style="animation-delay:${T0 + 0.3 + i * STEP}s">
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
    // combos landed this match, best first
    const counts = new Map<string, number>();
    for (const c of r.comboList) counts.set(c, (counts.get(c) ?? 0) + 1);
    const comboChips = [...counts.entries()]
      .sort((a, b) => (b[0] === r.bestCombo ? 1 : 0) - (a[0] === r.bestCombo ? 1 : 0) || b[1] - a[1])
      .map(([id, n]) => {
        const def = COMBOS.find((c) => c.id === id)!;
        const ultra = id === 'superstar' || id === 'electro_blast';
        return `<span class="combo-chip ${ultra ? 'ultra' : ''} ${id === r.bestCombo ? 'best' : ''}">${esc(def.name)}${n > 1 ? ` ×${n}` : ''}</span>`;
      })
      .join('');
    const delayAfterLines = T0 + 0.3 + o.rewards.lines.length * STEP;
    // One concrete way to raise the show rating next time.
    let tip = '';
    if (r.rating < 70) {
      if (r.combos === 0) tip = '<b>Совет:</b> карта с меткой «КОМБО ▸» начинает комбо — затем сыграйте засветившуюся золотом карту. Комбо дают больше всего рейтинга.';
      else if (r.perfects === 0) tip = '<b>Совет:</b> когда под соперником красная зона, сыграйте DASH или SHIELD — идеальная реакция поднимает рейтинг.';
      else tip = '<b>Совет:</b> не копите энергию до упора и чередуйте разные карты — зрители не любят простой и повторы.';
    }

    // seasonal event block: currency earned + quests finished by this match
    let eventBlock = '';
    const eo = p.event;
    const ev = eo ? this.g.events.find(eo.eventId) : null;
    if (eo && ev) {
      const icon = currencyIcon(ev);
      const parts = eo.lines.map((l) => `${esc(l.label)} +${l.value}`).join(' · ');
      const quests = eo.completed
        .map((q) => `<div class="evr-quest">${ICONS.check}<span>Задание выполнено: <b>${esc(q.title)}</b> · +${q.reward}</span></div>`)
        .join('');
      eventBlock = `<div class="section panel ev-result" style="animation:lineIn .35s ease ${T0 + 0.15}s both">
          <div class="row between"><span class="h2 evr-title"><span class="evr-ico">${icon}</span>${esc(ev.title)}</span><span class="evr-gain">+${eo.tokens}<span class="evr-coin">${icon}</span></span></div>
          <div class="muted evr-lines">${parts || 'Победы, высокий рейтинг и комбо приносят жетоны'}${eo.capped ? ' · дневной лимит жетонов за бои достигнут' : ''}</div>
          ${quests}
          ${quests ? '<button class="label evr-link" data-act="events">Забрать награды в «Событиях» ›</button>' : ''}
        </div>`;
    }
    // Prime Challenge verdict: every condition with its own tick, first clear and personal best
    let challengeBlock = '';
    const ch = p.challenge;
    if (ch) {
      const d = ch.def;
      const checks = ch.checks
        .map((c) => `<div class="chk ${c.ok ? 'ok' : 'no'}"><span class="chk-i">${c.ok ? '✓' : '✕'}</span><span>${esc(c.label)}</span></div>`)
        .join('');
      const bestTxt = ch.progress.best ? formatChallengeValue(d, ch.progress.best) : '—';
      challengeBlock = `<div class="section panel ch-result ${ch.cleared ? 'cleared' : 'failed'}" style="animation:lineIn .35s ease ${T0 + 0.1}s both">
          <div class="row between"><span class="h2 ch-title"><span class="ch-ico">${MODE_ICONS[d.icon]}</span>${esc(d.title)}</span><span class="ch-stamp">${ch.cleared ? 'ПРОЙДЕНО' : 'НЕ ПРОЙДЕНО'}</span></div>
          <div class="ch-checks">${checks}</div>
          ${ch.firstClear ? `<div class="ch-first">${UI_ICONS.star}<span>Первое прохождение: <b>+${formatMoney(ch.firstClear.money)}</b> и <b>+${ch.firstClear.rep}★</b></span></div>` : ''}
          <div class="ch-best">${ch.newBest && ch.value !== null ? `<span class="chip gold">${MODE_ICONS.trophy.replace('<svg', '<svg width="11" height="11"')} Новый рекорд</span>` : ''}<span class="muted">Рекорд: <b>${esc(bestTxt)}</b> · пройдено ${ch.progress.clears} из ${ch.progress.attempts}</span></div>
        </div>`;
    }
    const champion = r.outcome === 'win' && this.g.save.data.cosmetics.equipped.title === 'title_halloween_champion';
    this.el.classList.toggle('champion', champion);
    this.el.classList.remove('instant');
    this.el.innerHTML = `
      <div class="fill scroll" style="padding-top:4px">
        <div class="result-title">
          <div class="rt ${r.outcome}">${titles[r.outcome]}</div>
          ${champion ? `<div class="champ-ribbon">${ICONS.crown}<span>HALLOWEEN CHAMPION</span></div>` : ''}
          <div class="rs">${p.challenge ? `${esc(p.challenge.def.title)} · ` : ''}${methods[r.method]} · ${esc(f.name)} VS ${esc(this.g.rivalName(p.rival))}</div>
        </div>
        ${challengeBlock}
        <div class="reward-tiles" style="animation:lineIn .3s ease ${T0}s both">
          <div class="rtile money"><span class="rv" data-total>+$0</span><span class="rk">Гонорар</span></div>
          <div class="rtile fans"><span class="rv">+${formatNumber(o.rewards.fans)}</span><span class="rk">Фанаты</span></div>
          <div class="rtile rep"><span class="rv">+${o.rewards.rep}★</span><span class="rk">Репутация</span></div>
        </div>
        <div class="rating-card panel">
          <div class="grade ${grade}">${grade}</div>
          <div class="fill" style="min-width:0">
            <div class="label">Рейтинг шоу</div>
            <div class="rating-big"><span data-rating>0</span><span class="muted" style="font-size:15px">/100</span></div>
            <div class="label" style="margin-top:4px">Пик ${r.peakRating} · Среднее ${r.avgRating}</div>
            <div class="label" style="margin-top:3px">Урон ${formatNumber(r.damageDealt)} · Идеальных реакций ${r.perfects}</div>
          </div>
        </div>
        ${eventBlock}
        ${tip ? `<div class="result-tip">${tip}</div>` : ''}
        <div class="section panel combos-panel">
          <div class="section-title"><span class="h2">Комбо эфира · ${r.combos}</span><span class="label">${r.bestCombo ? 'лучшее — золотом' : ''}</span></div>
          <div class="combo-chips">${comboChips || '<span class="muted" style="font-size:12px">Без комбо. Золотая подсветка карты подскажет момент.</span>'}</div>
        </div>
        <div class="section panel">
          <div class="section-title"><span class="h2">Гонорар продюсера</span><span class="label">почему столько</span></div>
          <div class="reward-list">${lines}</div>
        </div>
        <div class="section panel" style="animation:lineIn .35s ease ${delayAfterLines}s both">
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
        <button class="btn" data-act="again"><span class="shine"></span>${p.challenge ? 'Повторить' : 'Ещё бой'}</button>
      </div>
      <div class="result-links">
        <button class="label" data-act="prep">Колода и сложность</button>
        ${p.challenge ? '<button class="label" data-act="modes">Режимы эфира</button>' : '<button class="label" data-act="roster">Сменить бойца</button>'}
      </div>`;

    const ratingEl = this.el.querySelector('[data-rating]') as HTMLElement;
    const totalEl = this.el.querySelector('[data-total]') as HTMLElement;
    const fansEl = this.el.querySelector('[data-fans]') as HTMLElement;
    const lvlBar = this.el.querySelector('[data-lvl]') as HTMLElement;
    const fansAfter = o.fighterFansBefore + o.rewards.fans;
    const timers: number[] = [];
    const later = (sec: number, fn: () => void) => timers.push(window.setTimeout(fn, sec * 1000));
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach((t) => clearTimeout(t));
      this.el.classList.add('instant');
      ratingEl.textContent = String(r.rating);
      totalEl.textContent = '+' + formatMoney(o.rewards.money);
      fansEl.textContent = `${formatNumber(fansAfter)}  (+${formatNumber(o.rewards.fans)})`;
      lvlBar.style.transform = `scaleX(${lvlAfter.progress})`;
    };
    this.skip = finish;
    later(0.25, () => countUp(ratingEl, 0, r.rating, 0.8, (n) => String(Math.round(n))));
    later(T0, () => countUp(totalEl, 0, o.rewards.money, 0.8, (n) => '+' + formatMoney(n), () => this.g.audio.ui('coin')));
    later(delayAfterLines, () =>
      countUp(fansEl, o.fighterFansBefore, fansAfter, 0.7, (n) => formatNumber(n) + (n >= fansAfter - 0.5 ? `  (+${formatNumber(o.rewards.fans)})` : '')),
    );
    later(delayAfterLines + 0.2, () => {
      lvlBar.style.transform = `scaleX(${lvlAfter.progress})`;
      if (levelUp) this.g.audio.ui('level');
    });
    later(delayAfterLines + 1.2, () => {
      finished = true;
    });
  }

  onHide(): void {
    this.skip?.();
    this.skip = null;
  }
}
