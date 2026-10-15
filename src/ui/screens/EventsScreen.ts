import { COSMETICS, type CosmeticDef, type CosmeticId } from '../../config/cosmetics.config';
import type { EventDef } from '../../config/events.config';
import type { Game } from '../../game/Game';
import type { QuestView } from '../../meta/EventManager';
import { el, esc } from '../dom';
import { ICONS, REWARD_ART } from '../eventArt';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';

/** "5 д 12 ч", "3 ч 20 мин", "12 мин". */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  const m = Math.max(0, Math.floor(ms / 60000));
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d} д ${h} ч`;
  if (h > 0) return `${h} ч ${mm} мин`;
  return `${Math.max(1, mm)} мин`;
}

/** Icon of the event's currency (or of its theme for theme-only previews). */
export function currencyIcon(e: EventDef | null): string {
  const kind = e?.currency?.icon ?? (e?.themeId === 'winter' ? 'snowflake' : 'pumpkin');
  return kind === 'snowflake' ? ICONS.snowflake : ICONS.pumpkin;
}

const RARITY: Record<CosmeticDef['rarity'], string> = { rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };

/** Seasonal events: banner, countdown, currency, quests, reward exchange and the cosmetics collection. */
export class EventsScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private tab: 'quests' | 'rewards' = 'quests';
  private ticker: number | null = null;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'events');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  onShow(params?: unknown): void {
    const p = params as { tab?: 'quests' | 'rewards' } | undefined;
    if (p?.tab) this.tab = p.tab;
    const fresh = this.ticker === null;
    this.render();
    if (fresh) this.g.themes.sting();
    // keep the countdown fresh while the screen is open
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = window.setInterval(() => this.tick(), 15000);
  }

  onHide(): void {
    if (this.ticker !== null) clearInterval(this.ticker);
    this.ticker = null;
  }

  private tick(): void {
    if (this.g.refreshSeason()) {
      this.render();
      return;
    }
    const em = this.g.events;
    const t = this.el.querySelector('[data-countdown]');
    if (t && em.active) t.textContent = formatSpan(em.timeLeft());
    const st = this.el.querySelector('[data-start]');
    if (st && em.upcoming) st.textContent = formatSpan(em.timeToStart(em.upcoming));
  }

  private onClick(e: Event): void {
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const em = g.events;
    const act = t.dataset.act!;
    if (act === 'back') {
      g.audio.ui('click');
      g.goto('menu');
    } else if (act === 'tab') {
      g.audio.ui('swipe');
      this.tab = t.dataset.tab as 'quests' | 'rewards';
      this.render();
    } else if (act === 'claim') {
      const paid = em.claimQuest(t.dataset.q!);
      if (paid !== null) {
        g.audio.ui('coin');
        g.ui.toast(`+${paid} ${em.active?.currency?.name ?? ''}`, true);
        this.render();
        this.bumpWallet();
      }
    } else if (act === 'grand') {
      const id = em.claimGrand();
      if (id) {
        g.applyCosmetics();
        this.render();
        this.celebrate(id);
      }
    } else if (act === 'buy') {
      const id = t.dataset.id as CosmeticId;
      const r = em.buy(id);
      if (r.ok) {
        g.applyCosmetics();
        this.render();
        this.celebrate(id);
      } else {
        g.audio.ui('deny');
        g.ui.toast(r.reason);
      }
    } else if (act === 'equip' || act === 'unequip') {
      const id = t.dataset.id as CosmeticId;
      if (em.setEquipped(id, act === 'equip')) {
        g.audio.ui(act === 'equip' ? 'confirm' : 'click');
        g.applyCosmetics();
        g.ui.toast(act === 'equip' ? `${COSMETICS[id].name}: надето` : `${COSMETICS[id].name}: снято`);
        this.render();
      }
    } else if (act === 'play') {
      g.audio.ui('confirm');
      g.goto('prep');
    }
  }

  private bumpWallet(): void {
    const w = this.el.querySelector('.ev-wallet');
    w?.classList.remove('bump');
    void (w as HTMLElement | null)?.offsetWidth;
    w?.classList.add('bump');
  }

  /** Reward unlocked: big reveal with the item, already equipped. */
  private celebrate(id: CosmeticId): void {
    const c = COSMETICS[id];
    const g = this.g;
    g.audio.reward();
    g.ui.modal(
      `<div class="reward-pop rarity-${c.rarity}">
         <div class="rp-rays"></div>
         <div class="rp-art">${REWARD_ART[c.art]}</div>
         <div class="label rp-kind">Новая награда · ${RARITY[c.rarity]}</div>
         <div class="h1 rp-name">${esc(c.name)}</div>
         <p class="rp-desc">${esc(c.desc)}</p>
         <div class="rp-where">${UI_ICONS.check.replace('<svg', '<svg width="14" height="14"')} Уже надето · ${esc(c.where)}</div>
         <div class="modal-actions"><button class="btn teal wide" data-a="ok">Отлично!</button></div>
       </div>`,
      (root, close) => {
        root.querySelector('[data-a="ok"]')!.addEventListener('click', () => {
          g.audio.ui('click');
          close();
        });
      },
    );
  }

  // ------------------------------------------------------------------ render
  private render(): void {
    const em = this.g.events;
    const e = em.active;
    let body: string;
    if (e && em.playable) body = this.renderEvent(e);
    else body = this.renderIdle(e);
    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="h1">События</div>
      </div>
      <div class="fill scroll ev-scroll">${body}</div>`;
  }

  private banner(e: EventDef, live: boolean, sub: string): string {
    const art =
      e.themeId === 'winter'
        ? `<span class="evb-a a1">${ICONS.snowflake}</span><span class="evb-a a2">${ICONS.snowflake}</span><span class="evb-a a3">${ICONS.snowflake}</span>`
        : `<span class="evb-a moon">${ICONS.moon}</span><span class="evb-a a1">${ICONS.pumpkin}</span><span class="evb-a a2">${ICONS.pumpkin}</span><span class="evb-a a3">${ICONS.pumpkin}</span>`;
    const [w1, ...rest] = e.title.split(' ');
    return `<div class="ev-banner theme-${e.themeId}">
        <div class="evb-art">${art}</div>
        <div class="evb-top">${live ? '<span class="live">LIVE</span>' : '<span class="evb-soon">СКОРО</span>'}<span class="evb-time">${sub}</span></div>
        <div class="evb-title">${esc(w1)}<b>${esc(rest.join(' '))}</b></div>
        <div class="evb-sub">${esc(e.tagline)}</div>
      </div>`;
  }

  private renderEvent(e: EventDef): string {
    const em = this.g.events;
    const quests = em.quests(e);
    const done = quests.filter((q) => q.done).length;
    const pending = quests.filter((q) => q.done && !q.claimed).length + (em.canClaimGrand() ? 1 : 0);
    const left = em.timeLeft();
    const icon = currencyIcon(e);
    const tokens = em.tokens(e);
    const head = `
      ${this.banner(e, true, Number.isFinite(left) ? `до конца <b data-countdown>${formatSpan(left)}</b>` : 'тестовый режим')}
      <div class="ev-stats">
        <div class="ev-wallet"><span class="ev-coin">${icon}</span><span class="ev-wallet-n"><b>${tokens}</b><small>${esc(e.currency!.name)}</small></span></div>
        <div class="ev-overall">
          <div class="row between"><span class="label">Задания</span><span class="label" style="color:var(--text)">${done}/${quests.length}</span></div>
          <div class="progress gold"><i style="transform:scaleX(${quests.length ? done / quests.length : 0})"></i></div>
        </div>
      </div>
      <div class="seg-control ev-tabs" style="grid-template-columns:1fr 1fr">
        <button class="${this.tab === 'quests' ? 'on' : ''}" data-act="tab" data-tab="quests">Задания${pending ? `<span class="ev-dot">${pending}</span>` : ''}</button>
        <button class="${this.tab === 'rewards' ? 'on' : ''}" data-act="tab" data-tab="rewards">Награды</button>
      </div>`;
    return head + (this.tab === 'quests' ? this.renderQuests(e, quests) : this.renderRewards(e));
  }

  private renderQuests(e: EventDef, quests: QuestView[]): string {
    const em = this.g.events;
    const icon = currencyIcon(e);
    let grand = '';
    if (e.grandPrize) {
      const gp = COSMETICS[e.grandPrize.cosmetic];
      const need = e.grandPrize.questsNeeded;
      const done = Math.min(need, quests.filter((q) => q.done).length);
      const owned = em.owns(gp.id);
      const btn = owned
        ? `<span class="chip teal">${UI_ICONS.check.replace('<svg', '<svg width="10" height="10"')} Получено</span>`
        : em.canClaimGrand()
          ? `<button class="btn" data-act="grand"><span class="shine"></span>Забрать</button>`
          : `<span class="eg-lock">${ICONS.lock}</span>`;
      grand = `<div class="ev-grand ${owned ? 'owned' : ''} ${em.canClaimGrand() ? 'ready' : ''}">
          <div class="eg-art">${REWARD_ART[gp.art]}</div>
          <div class="eg-main">
            <div class="label eg-kind">Главный приз сезона</div>
            <div class="eg-name">${esc(gp.name)}</div>
            <div class="eg-desc">Выполните ${need} из ${quests.length} заданий · ${done}/${need}</div>
            <div class="progress gold"><i style="transform:scaleX(${done / need})"></i></div>
          </div>
          <div class="eg-side">${btn}</div>
        </div>`;
    }
    const rows = quests
      .slice()
      .sort((a, b) => Number(b.done && !b.claimed) - Number(a.done && !a.claimed) || Number(a.claimed) - Number(b.claimed))
      .map((q) => {
        const d = q.def;
        let side: string;
        if (q.claimed) side = `<span class="eq-ok">${ICONS.check}</span>`;
        else if (q.done) side = `<button class="btn eq-claim" data-act="claim" data-q="${d.id}"><span class="shine"></span>+${d.reward}<span class="eq-coin">${icon}</span></button>`;
        else side = `<span class="eq-reward">+${d.reward}<span class="eq-coin">${icon}</span></span>`;
        const prog = d.target > 1 ? `${q.progress}/${d.target}` : q.done ? 'Готово' : '0/1';
        return `<div class="ev-quest ${q.done ? 'done' : ''} ${q.claimed ? 'claimed' : ''}">
            <div class="eq-ico">${ICONS[d.icon]}</div>
            <div class="eq-main">
              <div class="eq-title">${esc(d.title)}</div>
              <div class="eq-desc">${esc(d.desc)}</div>
              <div class="eq-bar"><div class="progress ${q.done ? 'gold' : ''}"><i style="transform:scaleX(${q.progress / d.target})"></i></div><span>${prog}</span></div>
            </div>
            <div class="eq-side">${side}</div>
          </div>`;
      })
      .join('');
    const earn = e.earnings!;
    const how = `<div class="ev-how">
        <div class="label">Жетоны за бои во время события</div>
        <div class="ev-how-row"><span>Победа <b>+${earn.win}</b></span>${earn.rating.map(([min, v]) => `<span>Рейтинг ${min}+ <b>+${v}</b></span>`).join('')}<span>Комбо <b>+${earn.perCombo}</b> (до ${earn.comboCap})</span></div>
        <div class="muted" style="font-size:11px">Не больше ${earn.dailyCap} жетонов за бои в день. Сдача боя не приносит жетонов.</div>
      </div>`;
    return `${grand}<div class="ev-list">${rows}</div>${how}
      <button class="btn big wide ev-play" data-act="play"><span class="shine"></span>В бой</button>`;
  }

  private rewardCard(c: CosmeticDef, price: number | null, e: EventDef | null): string {
    const em = this.g.events;
    const owned = em.owns(c.id);
    const equipped = owned && em.isEquipped(c.id);
    let btn: string;
    if (owned) {
      btn = equipped
        ? `<button class="btn ghost er-btn" data-act="unequip" data-id="${c.id}">${UI_ICONS.check.replace('<svg', '<svg width="13" height="13"')} Надето</button>`
        : `<button class="btn teal er-btn" data-act="equip" data-id="${c.id}">Надеть</button>`;
    } else if (price !== null && e && em.playable) {
      const can = em.tokens(e) >= price;
      btn = `<button class="btn er-btn ${can ? '' : 'short'}" data-act="buy" data-id="${c.id}">${price}<span class="eq-coin">${currencyIcon(e)}</span></button>`;
    } else if (e?.grandPrize?.cosmetic === c.id) {
      btn = `<span class="er-lock">${ICONS.lock} Главный приз</span>`;
    } else {
      btn = `<span class="er-lock">${ICONS.lock} Недоступно</span>`;
    }
    return `<div class="ev-reward rarity-${c.rarity} ${owned ? 'owned' : ''} ${equipped ? 'equipped' : ''}">
        <div class="er-art">${REWARD_ART[c.art]}</div>
        <div class="er-rarity">${RARITY[c.rarity]}</div>
        <div class="er-name">${esc(c.name)}</div>
        <div class="er-desc">${esc(c.desc)}</div>
        <div class="er-where">${esc(c.where)}</div>
        ${btn}
      </div>`;
  }

  private renderRewards(e: EventDef): string {
    const items = e.shop.map((s) => this.rewardCard(COSMETICS[s.cosmetic], s.cost, e));
    if (e.grandPrize) items.push(this.rewardCard(COSMETICS[e.grandPrize.cosmetic], null, e));
    return `<div class="ev-hint muted">Обменивайте ${esc(e.currency!.name)} на косметику. Полученные предметы остаются у вас и после окончания события.</div>
      <div class="ev-rewards">${items.join('')}</div>`;
  }

  /** No playable event: upcoming teaser or theme preview, plus the player's collection. */
  private renderIdle(active: EventDef | null): string {
    const em = this.g.events;
    let top: string;
    if (active) {
      top = this.banner(active, true, esc(active.subtitle));
    } else if (em.upcoming) {
      const up = em.upcoming;
      top = `${this.banner(up, false, `начнётся через <b data-start>${formatSpan(em.timeToStart(up))}</b>`)}
        <div class="ev-hint">Задания, ${esc(up.currency?.name ?? 'жетоны')} и уникальные награды откроются в день премьеры.</div>`;
    } else {
      top = `<div class="ev-empty panel">${ICONS.calendar}<div class="h2">Сейчас нет события</div><div class="muted">Следите за обновлениями: новые сезоны PRIME TIME появляются в календаре автоматически.</div></div>`;
    }
    const owned = this.g.save.data.cosmetics.owned;
    const collection = owned.length
      ? `<div class="ev-rewards">${owned.map((id) => this.rewardCard(COSMETICS[id], null, null)).join('')}</div>`
      : `<div class="ev-hint muted">Здесь появятся косметические награды, полученные в событиях.</div>`;
    return `${top}<div class="section-title ev-coll-title"><span class="h2">Коллекция</span><span class="label">${owned.length} предм.</span></div>${collection}`;
  }
}
