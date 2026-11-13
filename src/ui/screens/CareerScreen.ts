import { contractCost } from '../../config/careerPrices';
import { CAREER_STAGES, GOALS, type GoalId, type StageId } from '../../config/career';
import { COSMETICS } from '../../config/cosmetics.config';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { fameTier } from '../../meta/CareerSystem';
import { inRoster } from '../../meta/roster';
import type { StageView } from '../../meta/careerStages';
import { REWARD_ART } from '../eventArt';
import { el, esc, portraitHTML, setScreenHTML } from '../dom';
import { UI_ICONS } from '../icons';
import { currencyIcon } from './EventsScreen';
import { STUDIO_NAME_MAX, StudioNameEdit, type NameOutcome } from '../studioName';
import type { Screen } from '../UI';

export class CareerScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  /** 1.9.8: the studio name editor (src/ui/studioName.ts — why 1.9.7 failed on a real iPhone is written there). */
  private readonly name: StudioNameEdit;
  private settleTimer = 0;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'career');
    this.name = new StudioNameEdit(
      () => this.g.save.data.orgName,
      (n) => this.g.career.rename(n),
    );
    this.el.addEventListener('click', (e) => this.onClick(e));
    // Enter / «готово» ON the keyboard / ✓ submit the form
    this.el.addEventListener('submit', (e) => {
      e.preventDefault();
      this.done(this.name.submit(this.nameField()?.value ?? ''));
    });
    this.el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Escape' && this.name.editing) this.done(this.name.cancel());
    });
    // a press on ✓ / × is known before the blur it causes (iOS: pointerdown → blur → click)
    this.el.addEventListener(
      'pointerdown',
      (e) => {
        const aim = (e.target as HTMLElement).closest<HTMLElement>('[data-name-aim]')?.dataset.nameAim;
        if (aim === 'save' || aim === 'cancel') this.name.aim(aim);
      },
      { capture: true },
    );
    // the field lost the focus: «Готово» above the iPhone keyboard, a tap elsewhere — the typed name is kept
    this.el.addEventListener('focusout', (e) => {
      if (!(e.target as HTMLElement).matches?.('.org-name input')) return;
      const r = this.name.blurred((e.target as HTMLInputElement).value);
      if (r) {
        this.done(r);
        return;
      }
      // a press on ✓ / × whose click does not come (the finger slid off the button) still finishes the edit
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => {
        const f = this.nameField();
        if (this.name.editing && document.activeElement !== f) this.done(this.name.settle(f?.value ?? ''));
      }, 600);
    });
  }

  onHide(): void {
    // leaving the screen while typing = the field loses the focus: the typed name is kept (an empty one is not)
    if (this.name.editing) {
      const v = this.nameField()?.value ?? '';
      this.done(this.name.blurred(v) ?? this.name.settle(v));
    }
  }

  onShow(): void {
    if (this.name.editing) this.name.cancel();
    const s = this.g.save.data;
    const f = FIGHTERS[s.selected];
    this.g.showcase.show(this.g.fighterLook(f.id), f.theme.accent);
    this.render(false);
  }

  private nameField(): HTMLInputElement | null {
    return this.el.querySelector<HTMLInputElement>('.org-name input');
  }

  /**
   * The pencil, or a tap on the name: the SAME field (never rebuilt) becomes editable and takes the focus inside the
   * tap — iOS opens the keyboard only for a focus asked for inside the user's own gesture.
   */
  private beginName(): void {
    const input = this.nameField();
    const form = input?.form;
    if (!input || !form) return;
    clearTimeout(this.settleTimer);
    if (this.name.editing) {
      // already typing: a tap inside the field places the caret itself; the pencil only brings the keyboard back
      if (document.activeElement !== input) input.focus({ preventScroll: true });
      return;
    }
    // a tap on the read-only name already focused it without a keyboard: let it go BEFORE the edit starts (that blur
    // must not count as the end of an edit), then focus again once it is editable
    if (document.activeElement === input) input.blur();
    input.value = this.name.begin();
    input.readOnly = false;
    form.dataset.editing = '1';
    input.focus({ preventScroll: true });
    clearTimeout(this.settleTimer);
    const n = input.value.length;
    try {
      input.setSelectionRange(n, n);
    } catch {
      /* some keyboards refuse a caret position — the field is focused anyway */
    }
  }

  /** The edit is over: the field shows the stored name, read-only again; the player is told what happened. */
  private done(r: NameOutcome | null): void {
    if (!r) return;
    clearTimeout(this.settleTimer);
    const input = this.nameField();
    if (input) {
      input.value = r.name;
      input.readOnly = true;
      if (input.form) input.form.dataset.editing = '0';
      if (document.activeElement === input) input.blur();
    }
    if (r.kind === 'saved') {
      this.g.audio.ui('confirm');
      this.g.ui.toast(`Название студии сохранено: ${r.name}`);
    } else if (r.kind === 'empty') this.g.ui.toast('Название студии не может быть пустым — оставлено прежнее');
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
      if (!this.name.editing) g.audio.ui('click');
      this.beginName();
    } else if (act === 'cancel-name') {
      g.audio.ui('click');
      this.done(this.name.cancel());
    } else if (act === 'claim') {
      const id = t.dataset.goal as GoalId;
      const r = g.career.claim(id);
      if (r) {
        g.audio.ui('level');
        g.ui.toast(`Награда получена: +${formatMoney(r.money)} и +${r.rep} репутации`, true);
        this.render();
      }
    } else if (act === 'claim-stage') {
      const r = g.career.claimStage(t.dataset.stage as StageId);
      if (r) {
        g.audio.ui('level');
        if (r.cosmetic) g.applyCosmetics();
        const item = r.cosmetic ? ` · «${COSMETICS[r.cosmetic].name}» в коллекции` : '';
        g.ui.toast(`Этап карьеры: +${formatMoney(r.money)} и +${r.rep} репутации${item}`, true);
        this.render();
      }
    } else if (act === 'collection') {
      g.audio.ui('click');
      g.goto('collection');
    } else if (act === 'contract') {
      g.audio.ui('click');
      g.goto('roster', t.dataset.f);
    } else if (act === 'season') {
      // Alpha 1.7: the season's star is opened in the event's exchange
      g.audio.ui('click');
      g.goto('events', { tab: 'rewards' });
    }
  }

  private render(keep = true): void {
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
    // Alpha 1.7: a seasonal star shows only once owned or while its event runs (opened in «События»)
    const roster = FIGHTER_ORDER.filter((id) => g.events.fighterVisible(id));
    const contracts = roster.map((id) => {
      const f = FIGHTERS[id];
      const fp = s.fighters[id];
      const c = g.career.canSign(id);
      const open = inRoster(s, id);
      const offer = f.seasonal && !open ? g.events.fighterOffer(id) : null;
      let right = '';
      let note = open ? `${formatNumber(fp.fans)} фанатов · ${esc(fameTier(fp.fans))}` : esc(c.reason || 'Готов подписать');
      if (open) right = `<span class="chip teal">В составе</span>`;
      else if (offer) {
        right = `<button class="btn ${g.events.tokens(offer.event) >= offer.cost ? '' : 'ghost'}" data-act="season">${offer.cost}<span class="eq-coin">${currencyIcon(offer.event)}</span></button>`;
        note = `Сезонная звезда · ${esc(offer.event.title)}`;
      } else if (c.ok) right = `<button class="btn" data-act="contract" data-f="${id}"><span class="shine"></span>$${contractCost(id)}</button>`;
      else right = `<button class="btn ghost" data-act="contract" data-f="${id}">$${contractCost(id)}</button>`;
      return `<div class="contract">
        ${portraitHTML(g.portraitOf(f.id), f.theme.main, f.theme.dark)}
        <div class="cm">
          <div class="gt" style="font-family:var(--font-display);font-weight:800;font-size:13px">${esc(f.name)} <span style="color:${f.theme.accent};font-size:10.5px;white-space:nowrap">«${esc(f.nickname)}»</span></div>
          <div class="gd" style="font-size:11.5px;color:var(--muted)">${note}</div>
        </div>
        ${right}
      </div>`;
    }).join('');

    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">Карьера продюсера</div>
      </div>
      <div class="fill scroll" style="padding-bottom:14px">
        <div class="org-card panel">
          <form class="org-name" action="#" autocomplete="off" data-editing="0"><input type="text" name="studio" maxlength="${STUDIO_NAME_MAX}" value="${esc(s.orgName)}" readonly data-act="edit" aria-label="Название студии" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" enterkeyhint="done"/><button type="button" class="icon-btn org-edit" data-act="edit" aria-label="Переименовать">${UI_ICONS.pencil}</button><button type="submit" class="icon-btn org-x" data-name-aim="save" aria-label="Сохранить">${UI_ICONS.check}</button><button type="button" class="icon-btn org-x" data-act="cancel-name" data-name-aim="cancel" aria-label="Отменить"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg></button></form>
          <div class="row" style="margin-top:12px;gap:12px">
            <div class="lvl-badge" style="width:52px;height:52px;font-size:20px">${lvl.level}</div>
            <div class="fill">
              <div class="h2">${esc(lvl.title)}</div>
              <div class="label" style="margin:4px 0 6px">Репутация ${Math.floor(s.reputation)}${lvl.next !== null ? ` / ${lvl.next}` : ' · максимум'}</div>
              <div class="progress"><i style="transform:scaleX(${repInLevel})"></i></div>
            </div>
          </div>
        </div>
        ${this.renderStages()}
        <div class="stats-grid">
          <div class="kv"><div class="v" style="color:var(--gold)">${formatMoney(s.money)}</div><div class="k">Бюджет</div></div>
          <div class="kv"><div class="v">${s.wins}-${s.losses}-${s.draws}</div><div class="k">Победы-пор.-ничьи</div></div>
          <div class="kv"><div class="v">${s.bestRating || '—'}</div><div class="k">Лучший рейтинг</div></div>
          <div class="kv"><div class="v">${formatNumber(g.career.totalFans())}</div><div class="k">Фанаты команды</div></div>
          <div class="kv"><div class="v">${g.career.signedCount()}/${roster.length}</div><div class="k">Бойцов в составе</div></div>
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
      </div>`,
      keep,
    );
  }

  // ------------------------------------------------- career stages (1.5)
  private renderStages(): string {
    const g = this.g;
    const all = g.career.stages();
    const cur = g.career.stage();
    const next = g.career.nextStage();
    const track = all
      .map((st) => {
        const state = st.reached ? (st.index === cur.index ? 'cur' : 'done') : next && st.index === next.index ? 'next' : '';
        return `<div class="st-step ${state}"><span class="st-dot">${st.reached ? UI_ICONS.check.replace('<svg', '<svg width="11" height="11"') : st.index + 1}</span><span class="st-name">${esc(st.def.short)}</span></div>`;
      })
      .join('<i class="st-line"></i>');
    // rewards of reached stages that are still waiting
    const waiting = all
      .filter((st) => st.reached && !st.claimed)
      .map((st) => `<div class="stage-claim">
          <div class="fill"><div class="label">Этап достигнут</div><div class="h2">${esc(st.def.title)}</div><div class="sc-reward">${this.rewardText(st)}</div></div>
          <button class="btn" data-act="claim-stage" data-stage="${st.def.id}"><span class="shine"></span>Забрать</button>
        </div>`)
      .join('');
    let nextBlock: string;
    if (next) {
      const done = next.milestones.filter((m) => m.done).length;
      const rows = next.milestones
        .map((m) => {
          const pct = Math.min(1, m.value / m.def.target);
          const val = m.def.target > 1 ? `${formatNumber(Math.min(m.value, m.def.target))} / ${formatNumber(m.def.target)}` : m.done ? 'Готово' : 'Нет';
          return `<div class="ms-row ${m.done ? 'done' : ''}">
              <span class="ms-ico">${m.done ? UI_ICONS.check.replace('<svg', '<svg width="12" height="12"') : ''}</span>
              <div class="fill"><div class="row between"><span class="ms-label">${esc(m.def.label)}</span><span class="ms-val">${val}</span></div>
              <div class="progress ${m.done ? 'gold' : ''}"><i style="transform:scaleX(${pct})"></i></div></div>
            </div>`;
        })
        .join('');
      nextBlock = `<div class="stage-next">
          <div class="label">Следующий этап · условий ${done}/${next.milestones.length}</div>
          <div class="h2 sn-title">${esc(next.def.title)}</div>
          <div class="sn-reward">Награда: ${this.rewardText(next)}</div>
          <div class="muted sn-desc">${esc(next.def.desc)}</div>
          ${rows}
        </div>`;
    } else {
      nextBlock = `<div class="stage-next top"><div class="h2">Вершина карьеры</div><div class="muted sn-desc">Все этапы пройдены: ваша студия — легенда прайм-тайма.</div></div>`;
    }
    const art = cur.def.id === 'legendary' ? REWARD_ART.studio : cur.def.id === 'star' ? REWARD_ART.star : UI_ICONS.trophy;
    return `<div class="section panel stage-panel">
        <div class="section-title"><span class="h2">Путь продюсера</span><span class="label">этап ${cur.index + 1}/${CAREER_STAGES.length}</span></div>
        <div class="stage-cur">
          <div class="sc-art">${art}</div>
          <div class="fill"><div class="sc-title">${esc(cur.def.title)}</div><div class="label">${esc(cur.def.subtitle)}</div><div class="muted sc-desc">${esc(cur.def.desc)}</div></div>
        </div>
        <div class="stage-track">${track}</div>
        ${waiting}
        ${nextBlock}
      </div>`;
  }

  private rewardText(st: StageView): string {
    const r = st.def.reward;
    if (!r) return '';
    const item = r.cosmetic ? ` · <button class="link-btn" data-act="collection">«${esc(COSMETICS[r.cosmetic].name)}»</button>` : '';
    return `<span style="color:var(--gold)">$${r.money}</span> · <span style="color:var(--teal)">+${r.rep}★</span>${item}`;
  }
}
