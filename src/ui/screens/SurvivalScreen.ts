import { arenaById } from '../../config/arenas.config';
import { GOALS } from '../../config/career';
import { DIFFICULTIES, FIGHTERS, RIVALS } from '../../config/fighters';
import { PERKS, SURVIVAL, type PerkId } from '../../config/modes.config';
import type { MatchResultData } from '../../combat/types';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { arenaAvailable } from '../../meta/ArenaSelection';
import type { SurvivalSummary, WaveOutcome } from '../../meta/GameModes';
import type { SurvivalRun } from '../../meta/SaveSystem';
import { countUp, el, esc, portraitHTML } from '../dom';
import { ICONS } from '../eventArt';
import { UI_ICONS } from '../icons';
import { MODE_ICONS, PERK_ICONS } from '../modeArt';
import { currencyIcon } from './EventsScreen';
import type { Screen } from '../UI';

export type SurvivalParams =
  | { kind: 'intermission'; wave: WaveOutcome; result: MatchResultData }
  | { kind: 'summary'; summary: SurvivalSummary; wave?: WaveOutcome | null; result?: MatchResultData }
  | { kind: 'menu' };

const END_TITLE: Record<SurvivalSummary['end'], { text: string; cls: string; sub: string }> = {
  complete: { text: 'LAST STAR STANDING', cls: 'win', sub: 'Все волны пройдены!' },
  defeat: { text: 'МАРАФОН ОКОНЧЕН', cls: 'loss', sub: 'Боец выбыл из эфира' },
  forfeit: { text: 'СНЯТ С ЭФИРА', cls: 'loss', sub: 'Продюсер остановил марафон' },
  retired: { text: 'МАРАФОН ЗАВЕРШЁН', cls: 'draw', sub: 'Продюсер забрал награду досрочно' },
  abandoned: { text: 'МАРАФОН ПРЕРВАН', cls: 'draw', sub: 'Игра была закрыта во время попытки' },
};

/** Between waves: wave cleared, health carried over, pick one bonus. After the run: summary, records and rewards. */
export class SurvivalScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private picked: PerkId | null = null;
  private wave: WaveOutcome | null = null;
  private summary: SurvivalSummary | null = null;
  private timers: number[] = [];
  /** The heal bar animates once per intermission, not on every bonus tap. */
  private healShown = false;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'results survival-screen');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  onShow(params?: unknown): void {
    const p = (params ?? { kind: 'menu' }) as SurvivalParams;
    this.clearTimers();
    this.picked = null;
    this.summary = null;
    this.wave = null;
    this.healShown = false;
    if (p.kind === 'intermission' && this.g.modes.activeRun?.pendingPerk) {
      this.wave = p.wave;
      this.renderIntermission();
    } else if (p.kind === 'summary') {
      this.summary = p.summary;
      this.renderSummary();
    } else {
      this.el.innerHTML = `<div class="fill"></div><div class="result-actions"><button class="btn ghost" data-act="menu">Главное меню</button><button class="btn" data-act="modes">Режимы</button></div>`;
    }
  }

  onHide(): void {
    this.clearTimers();
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    const run = g.modes.activeRun;
    if (act === 'perk') {
      const id = t.dataset.id as PerkId;
      if (!run || run.perks[id] >= PERKS[id].maxStacks) {
        g.audio.ui('deny');
        return;
      }
      g.audio.ui('click');
      this.picked = id;
      this.renderIntermission();
    } else if (act === 'next') {
      if (!run || !this.picked) {
        g.audio.ui('deny');
        g.ui.toast('Сначала выберите бонус');
        return;
      }
      if (!g.modes.choosePerk(run.id, this.picked)) return;
      g.audio.ui('confirm');
      g.startSurvivalWave();
    } else if (act === 'retire') {
      if (!run) return;
      const cleared = run.waves.filter((w) => w.outcome === 'win').length;
      g.audio.ui('click');
      g.confirm('Завершить марафон?', `Вы получите награду за ${cleared} ${cleared === 1 ? 'пройденную волну' : 'пройденные волны'}. Попытка будет засчитана, продолжить её будет нельзя.`, 'Завершить', () => {
        const s = g.modes.retire(run.id);
        if (s) {
          this.summary = s;
          this.wave = null;
          this.renderSummary();
        }
      });
    } else if (act === 'again') {
      g.audio.ui('confirm');
      g.startSurvival();
    } else if (act === 'menu') {
      g.audio.ui('click');
      g.goto('menu');
    } else if (act === 'modes') {
      g.audio.ui('click');
      g.goto('modes');
    } else if (act === 'prep') {
      g.audio.ui('click');
      g.goto('prep', { mode: { kind: 'survival' } });
    } else if (act === 'events') {
      g.audio.ui('click');
      g.goto('events');
    }
  }

  // ------------------------------------------------------------ between waves
  private hpBar(run: SurvivalRun, still: boolean): string {
    const w = this.wave!;
    const fight = w.hpAfterFight;
    const heal = w.hpAfterHeal;
    const extra = this.picked === 'second_wind' ? Math.min(1, heal + PERKS.second_wind.value) : heal;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    return `<div class="sv-hp">
        <div class="row between"><span class="label">Здоровье ${esc(FIGHTERS[run.fighter].name)}</span><span class="sv-hp-num">${pct(fight)} <span class="muted">→</span> <b>${pct(extra)}</b></span></div>
        <div class="sv-hp-bar ${still ? 'still' : ''}"><i class="base" style="width:${fight * 100}%"></i><i class="heal" style="left:${fight * 100}%;width:${Math.max(0, heal - fight) * 100}%"></i><i class="wind" style="left:${heal * 100}%;width:${Math.max(0, extra - heal) * 100}%"></i></div>
        <div class="muted sv-hp-note">После победы +${Math.round(SURVIVAL.healBetween * 100)}%${this.picked === 'second_wind' ? ` · SECOND WIND +${Math.round(PERKS.second_wind.value * 100)}%` : ''} · максимум 100%</div>
      </div>`;
  }

  private renderIntermission(): void {
    const g = this.g;
    const run = g.modes.activeRun;
    const w = this.wave;
    if (!run || !w) return;
    const total = SURVIVAL.waves.length;
    const doneIdx = run.wave - 1;
    const setup = g.modes.waveSetup(run);
    const nextRival = RIVALS[setup.rival];
    const pips = Array.from({ length: total }, (_, i) => `<i class="${i < run.wave ? 'on' : i === run.wave ? 'next' : ''}"></i>`).join('');
    const perks = g.modes
      .perkOptions(run)
      .map((o) => {
        const id = o.def.id;
        const sel = this.picked === id;
        const stack = id === 'second_wind' ? '' : `<span class="pk-stack">${o.stacks}/${o.def.maxStacks}</span>`;
        return `<button class="perk-card p-${id} ${sel ? 'sel' : ''} ${o.available ? '' : 'maxed'}" data-act="perk" data-id="${id}" ${o.available ? '' : 'aria-disabled="true"'}>
            <span class="pk-ico">${PERK_ICONS[id]}</span>
            <span class="pk-name">${esc(o.def.name)}</span>
            <span class="pk-desc">${o.available ? esc(o.def.desc) : 'Максимум взят'}</span>
            ${stack}
          </button>`;
      })
      .join('');
    const last = run.waves[run.waves.length - 1];
    const still = this.healShown;
    this.healShown = true;
    this.el.classList.toggle('still', still);
    this.el.classList.add('inter');
    this.el.innerHTML = `
      <div class="fill scroll" style="padding-top:4px">
        <div class="result-title">
          <div class="rt win sv-rt">WAVE ${doneIdx + 1} CLEARED</div>
          <div class="rs">SURVIVAL · ${last ? `${last.method === 'ko' ? 'НОКАУТ' : 'ПО ОЧКАМ'} · VS ${esc(RIVALS[last.rival].name)} · РЕЙТИНГ ${last.rating}` : ''}</div>
        </div>
        <div class="section panel sv-panel" style="animation:lineIn .3s ease .2s both">
          <div class="row between"><span class="h2">Марафон</span><span class="wave-pips big">${pips}</span></div>
          ${this.hpBar(run, still)}
        </div>
        <div class="section panel sv-panel" style="animation:lineIn .3s ease .35s both">
          <div class="section-title"><span class="h2">Выберите бонус</span><span class="label">действует до конца марафона</span></div>
          <div class="perk-row">${perks}</div>
        </div>
        <div class="section panel sv-next" style="animation:lineIn .3s ease .5s both">
          ${portraitHTML(g.portraits[nextRival.look], nextRival.theme.main, nextRival.theme.dark)}
          <div class="fill" style="min-width:0">
            <div class="label">${setup.final ? 'Финальная волна' : `Волна ${setup.index + 1} из ${total}`}</div>
            <div class="sv-next-name">VS ${esc(nextRival.name)} «${esc(nextRival.nickname)}»</div>
            <div class="muted sv-next-meta">ИИ: ${esc(DIFFICULTIES[setup.difficulty].label.toLowerCase())}${setup.mods.rivalHpMult && setup.mods.rivalHpMult > 1 ? ` · +${Math.round((setup.mods.rivalHpMult - 1) * 100)}% здоровья` : ''}</div>
            <div class="muted sv-next-meta">Павильон марафона: ${esc(arenaById(arenaAvailable(arenaById(run.arena), g.events.themeId) ? run.arena : 'original').name)}</div>
          </div>
          ${setup.final ? '<span class="chip red">FINAL</span>' : ''}
        </div>
      </div>
      <div class="sv-actions">
        <button class="btn wide ${this.picked ? '' : 'disabled'}" data-act="next"><span class="shine"></span>${this.picked ? `Волна ${setup.index + 1} · в эфир` : 'Выберите бонус'}</button>
      </div>
      <div class="result-links">
        <button class="label" data-act="retire">Завершить марафон и забрать награду</button>
      </div>`;
  }

  // ---------------------------------------------------------------- summary
  private waveRows(run: SurvivalRun): string {
    return SURVIVAL.waves
      .map((_, i) => {
        const w = run.waves[i];
        const r = RIVALS[run.rivals[i]];
        if (!w) return `<div class="sv-wave none"><b>${i + 1}</b><span class="svw-name">—</span><span class="svw-res">не сыграна</span></div>`;
        const res =
          w.outcome === 'win' ? (w.method === 'ko' ? 'Победа · нокаут' : 'Победа · по очкам') : w.method === 'forfeit' ? 'Сдача' : w.outcome === 'draw' ? 'Ничья' : 'Поражение';
        return `<div class="sv-wave ${w.outcome}"><b>${i + 1}</b><span class="svw-name">${esc(r.name)}</span><span class="svw-res">${res}</span><span class="svw-rt">${w.rating}</span></div>`;
      })
      .join('');
  }

  private renderSummary(): void {
    const g = this.g;
    const s = this.summary;
    if (!s) return;
    const run = s.run;
    const total = SURVIVAL.waves.length;
    const t = END_TITLE[s.end];
    const rec = g.modes.survival;
    const f = FIGHTERS[run.fighter];
    const lines = s.lines
      .map(
        (l, i) => `<div class="reward-line" style="animation-delay:${0.6 + i * 0.06}s">
          <span class="rl-label">${esc(l.label)}${l.note ? ` <span class="rl-note">· ${esc(l.note)}</span>` : ''}</span>
          <span class="rl-val ${l.kind}">${l.kind === 'money' ? '+' + formatMoney(l.value) : '+' + formatNumber(l.value)}${l.kind === 'rep' ? ' ★' : ''}</span>
        </div>`,
      )
      .join('');
    const goals = s.grant.newGoals
      .map((id) => {
        const goal = GOALS.find((x) => x.id === id)!;
        return `<div class="goal-done">${UI_ICONS.star}<div class="fill"><div class="h2" style="font-size:12px">Цель выполнена: ${esc(goal.title)}</div><div class="muted" style="font-size:11px">Заберите $${goal.reward.money} и +${goal.reward.rep}★ в разделе «Карьера»</div></div></div>`;
      })
      .join('');
    let eventBlock = '';
    const eo = s.event;
    const ev = eo ? g.events.find(eo.eventId) : null;
    if (eo && ev) {
      const icon = currencyIcon(ev);
      const quests = eo.completed.map((q) => `<div class="evr-quest">${ICONS.check}<span>Задание выполнено: <b>${esc(q.title)}</b> · +${q.reward}</span></div>`).join('');
      eventBlock = `<div class="section panel ev-result" style="animation:lineIn .35s ease .5s both">
          <div class="row between"><span class="h2 evr-title"><span class="evr-ico">${icon}</span>${esc(ev.title)}</span><span class="evr-gain">+${eo.tokens}<span class="evr-coin">${icon}</span></span></div>
          <div class="muted evr-lines">Марафон засчитан как один эфир${eo.lines.length ? ': ' + eo.lines.map((l) => `${esc(l.label)} +${l.value}`).join(' · ') : ''}${eo.capped ? ' · дневной лимит жетонов достигнут' : ''}</div>
          ${quests}
          ${quests ? '<button class="label evr-link" data-act="events">Забрать награды в «Событиях» ›</button>' : ''}
        </div>`;
    }
    const pips = Array.from({ length: total }, (_, i) => `<i class="${i < s.cleared ? 'on' : run.waves[i] ? 'lost' : ''}"></i>`).join('');
    this.el.classList.remove('instant', 'inter', 'still');
    this.el.innerHTML = `
      <div class="fill scroll" style="padding-top:4px">
        <div class="result-title">
          <div class="rt ${t.cls} sv-rt">${t.text}</div>
          <div class="rs">${esc(t.sub)} · ${esc(f.name)} · ВОЛН ${s.cleared}/${total}</div>
        </div>
        ${s.newRecord ? `<div class="sv-record-badge">${MODE_ICONS.trophy}<span>НОВЫЙ РЕКОРД</span></div>` : ''}
        <div class="reward-tiles" style="animation:lineIn .3s ease .3s both">
          <div class="rtile money"><span class="rv" data-total>+$0</span><span class="rk">Гонорар</span></div>
          <div class="rtile fans"><span class="rv">+${formatNumber(s.reward.fans)}</span><span class="rk">Фанаты</span></div>
          <div class="rtile rep"><span class="rv">+${s.reward.rep}★</span><span class="rk">Репутация</span></div>
        </div>
        <div class="section panel">
          <div class="row between"><span class="h2">Волны</span><span class="wave-pips big">${pips}</span></div>
          <div class="sv-waves">${this.waveRows(run)}</div>
          <div class="sv-score"><span>Очки шоу (сумма рейтингов пройденных волн)</span><b>${s.score}</b></div>
        </div>
        <div class="section panel sv-records">
          <div class="section-title"><span class="h2">Рекорды Survival</span><span class="label">${MODE_ICONS.trophy.replace('<svg', '<svg width="12" height="12"')} last star standing</span></div>
          <div class="kv-grid sv-kv">
            <div class="kv"><div class="v">${rec.bestWave}/${total}</div><div class="k">Лучшая волна</div></div>
            <div class="kv"><div class="v">${rec.bestScore}</div><div class="k">Лучшие очки</div></div>
            <div class="kv"><div class="v">${rec.completions}</div><div class="k">Пройдено целиком</div></div>
          </div>
          ${s.firstClear ? '<div class="muted sv-first">Первое полное прохождение: бонус выплачен.</div>' : ''}
        </div>
        ${eventBlock}
        <div class="section panel">
          <div class="section-title"><span class="h2">Гонорар продюсера</span><span class="label">за марафон</span></div>
          <div class="reward-list">${lines}</div>
        </div>
        <div style="margin:0 12px">${goals}</div>
      </div>
      <div class="result-actions">
        <button class="btn ghost" data-act="menu">Главное меню</button>
        <button class="btn" data-act="again"><span class="shine"></span>Ещё марафон</button>
      </div>
      <div class="result-links">
        <button class="label" data-act="prep">Колода и боец</button>
        <button class="label" data-act="modes">Режимы эфира</button>
      </div>`;
    const totalEl = this.el.querySelector('[data-total]') as HTMLElement;
    this.timers.push(
      window.setTimeout(() => countUp(totalEl, 0, s.reward.money, 0.8, (n) => '+' + formatMoney(n), () => g.audio.ui('coin')), 350),
    );
    if (s.newRecord || s.end === 'complete') this.timers.push(window.setTimeout(() => g.audio.ui('level'), 700));
  }

  /** Shown once in the menu when an attempt was closed because the game had been shut mid-run. */
  noticeAbandoned(s: SurvivalSummary): void {
    const g = this.g;
    const total = SURVIVAL.waves.length;
    const paid = s.reward.money > 0 || s.reward.fans > 0 || s.reward.rep > 0;
    g.ui.modal(
      `<div class="h1">Марафон прерван</div>
       <p class="center muted" style="font-size:13px;line-height:1.4">Игра была закрыта во время SURVIVAL. Попытка засчитана с уже пройденными волнами: <b style="color:var(--text)">${s.cleared}/${total}</b>.</p>
       <p class="center" style="font-size:13px">${paid ? `Начислено: <b style="color:var(--gold)">+${formatMoney(s.reward.money)}</b> · <b style="color:#ff8ae6">+${formatNumber(s.reward.fans)}</b> фанатов · <b style="color:var(--teal)">+${s.reward.rep}★</b>` : 'Ни одна волна не пройдена — награды нет.'}</p>
       <div class="modal-actions"><button class="btn teal wide" data-a="ok">Понятно</button></div>`,
      (root, close) => {
        root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
          g.audio.ui('click');
          close();
          g.goto('menu');
        });
      },
    );
  }
}
