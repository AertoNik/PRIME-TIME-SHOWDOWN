import { BEHAVIORS, RIVALS } from '../../config/fighters';
import { CHALLENGES, SURVIVAL } from '../../config/modes.config';
import type { Game } from '../../game/Game';
import { formatChallengeValue } from '../../meta/GameModes';
import { el, esc } from '../dom';
import { UI_ICONS } from '../icons';
import { MODE_ICONS } from '../modeArt';
import type { Screen } from '../UI';

const DATE = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

/** "Режимы эфира": Classic Duel, Survival marathon and the Prime Challenge specials, with records. */
export class ModesScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'modes');
    this.el.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.act;
      if (act === 'back') {
        this.g.audio.ui('click');
        this.g.goto('menu');
      } else if (act === 'classic') {
        this.g.audio.ui('confirm');
        this.g.goto('prep', { mode: { kind: 'classic' } });
      } else if (act === 'survival') {
        this.g.audio.ui('confirm');
        this.g.goto('prep', { mode: { kind: 'survival' } });
      } else if (act === 'challenge') {
        this.g.audio.ui('confirm');
        this.g.goto('prep', { mode: { kind: 'challenge', id: t.dataset.id! } });
      }
    });
  }

  onShow(): void {
    const g = this.g;
    const s = g.save.data;
    const rival = RIVALS[s.nextRival];
    const rec = g.modes.survival;
    const total = SURVIVAL.waves.length;
    const pips = Array.from({ length: total }, (_, i) => `<i class="${i < rec.bestWave ? 'on' : ''}"></i>`).join('');
    const cleared = CHALLENGES.filter((c) => g.modes.progress(c.id).firstClearAt > 0).length;
    const challenges = CHALLENGES.map((c) => {
      const p = g.modes.progress(c.id);
      const done = p.firstClearAt > 0;
      const r = RIVALS[c.rival];
      const status = done
        ? `<span class="chip teal">${UI_ICONS.check.replace('<svg', '<svg width="10" height="10"')} Пройдено</span>`
        : `<span class="chip gold">+$${c.firstClear.money} · +${c.firstClear.rep}★</span>`;
      const best = done && p.best ? `<span class="chr-best">${MODE_ICONS.trophy}${esc(formatChallengeValue(c, p.best))}</span>` : '';
      return `<button class="ch-row ${done ? 'done' : ''}" data-act="challenge" data-id="${c.id}">
          <span class="chr-ico">${MODE_ICONS[c.icon]}</span>
          <span class="chr-main">
            <b>${esc(c.title)}</b>
            <small>${esc(c.quote)}</small>
            <span class="chr-meta">VS ${esc(r.name)} · ${esc(c.goalShort)}${best}</span>
          </span>
          <span class="chr-side">${status}<span class="chr-go">${UI_ICONS.next}</span></span>
        </button>`;
    }).join('');
    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Режимы эфира</div>
      </div>
      <div class="fill scroll modes-scroll">
        <section class="mode-card classic">
          <div class="mc-head">
            <span class="mc-ico">${MODE_ICONS.classic}</span>
            <span class="mc-titles"><span class="mc-kicker">Основной эфир</span><span class="mc-title">CLASSIC DUEL</span></span>
          </div>
          <p class="mc-desc">Обычная дуэль 1 на 1, как всегда: боец сражается сам, вы командуете картами.</p>
          <div class="mc-facts">
            <span><i>Соперник</i>${esc(rival.name)} · ${esc(BEHAVIORS[rival.behavior].label.toLowerCase())}</span>
            <span><i>Награда</i>гонорар, фанаты, репутация</span>
          </div>
          <button class="btn teal wide mc-cta" data-act="classic">К бою</button>
        </section>

        <section class="mode-card survival">
          <div class="mc-head">
            <span class="mc-ico">${MODE_ICONS.survival}</span>
            <span class="mc-titles"><span class="mc-kicker">${esc(SURVIVAL.subtitle)}</span><span class="mc-title">SURVIVAL</span></span>
            ${rec.runs ? '' : '<span class="chip gold mc-new">NEW</span>'}
          </div>
          <p class="mc-desc">${esc(SURVIVAL.tagline)}</p>
          <ul class="mc-rules">
            <li><b>${total} волн</b> подряд, каждая сильнее</li>
            <li>Здоровье переносится · после победы +${Math.round(SURVIVAL.healBetween * 100)}%</li>
            <li>Бонус на выбор после каждой волны</li>
          </ul>
          <div class="mc-facts">
            <span><i>Цель</i>пережить все ${total} волн</span>
            <span><i>Награда</i>за каждую волну · финал +$${SURVIVAL.completion.money}${rec.firstClearPaid ? '' : ` · первый раз +$${SURVIVAL.firstClear.money}`}</span>
          </div>
          <div class="mc-record">
            <span class="mcr-label">${MODE_ICONS.trophy}Рекорд</span>
            <span class="wave-pips">${pips}</span>
            <span class="mcr-val">${rec.runs ? `волна ${rec.bestWave}/${total} · очки ${rec.bestScore}` : 'ещё нет'}</span>
          </div>
          ${rec.runs ? `<div class="mcr-sub">Попыток ${rec.runs} · пройдено целиком ${rec.completions}${rec.recordAt ? ` · рекорд ${DATE(rec.recordAt)}` : ''}</div>` : ''}
          <button class="btn wide mc-cta" data-act="survival"><span class="shine"></span>Марафон</button>
        </section>

        <section class="mode-card challenge">
          <div class="mc-head">
            <span class="mc-ico">${MODE_ICONS.challenge}</span>
            <span class="mc-titles"><span class="mc-kicker">Special broadcasts</span><span class="mc-title">PRIME CHALLENGE</span></span>
            <span class="chip mc-count">${cleared}/${CHALLENGES.length}</span>
          </div>
          <p class="mc-desc">Спецвыпуски с особыми правилами. Награда за первое прохождение — один раз, повторы приносят обычный гонорар.</p>
          <div class="ch-list">${challenges}</div>
        </section>
      </div>`;
  }
}
