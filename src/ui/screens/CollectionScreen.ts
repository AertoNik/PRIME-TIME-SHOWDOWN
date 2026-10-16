import { COSMETICS, COSMETIC_SLOTS, SLOT_LABELS, type CosmeticDef, type CosmeticId } from '../../config/cosmetics.config';
import { EVENTS } from '../../config/events.config';
import type { Game } from '../../game/Game';
import type { AchievementView, CollectionTab, CosmeticView } from '../../meta/Collection';
import { el, esc } from '../dom';
import { REWARD_ART } from '../eventArt';
import { UI_ICONS } from '../icons';
import { MODE_ICONS } from '../modeArt';
import type { Screen } from '../UI';

const RARITY: Record<CosmeticDef['rarity'], string> = { rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный' };
const TABS: { id: CollectionTab; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'cosmetics', label: 'Косметика' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'seasons', label: 'Сезоны' },
];

const fmtDate = (t: number) => (t > 0 ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/**
 * MY COLLECTION — PRIME TIME STAR ARCHIVE (Alpha 1.5). Every reward the producer has
 * earned, whatever gave it (seasonal events, BOSS FIGHT, the career), in one archive:
 * look at it, equip it into its slot or take it off. Events only hand rewards out;
 * this screen is where they live.
 */
export class CollectionScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private tab: CollectionTab = 'all';
  /** Items that were new when the screen opened keep their NEW tag until it closes. */
  private freshOnOpen = new Set<CosmeticId>();

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'archive-screen');
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  onShow(params?: unknown): void {
    const p = params as { tab?: CollectionTab } | undefined;
    if (p?.tab) this.tab = p.tab;
    const col = this.g.collection;
    this.freshOnOpen = new Set(col.cosmetics().filter((v) => v.fresh).map((v) => v.def.id));
    col.markAllSeen();
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
    } else if (act === 'tab') {
      g.audio.ui('swipe');
      this.tab = t.dataset.tab as CollectionTab;
      this.render();
    } else if (act === 'equip' || act === 'unequip') {
      const id = t.dataset.id as CosmeticId;
      if (g.collection.setEquipped(id, act === 'equip')) {
        g.audio.ui(act === 'equip' ? 'confirm' : 'click');
        g.applyCosmetics();
        g.ui.toast(act === 'equip' ? `${COSMETICS[id].name}: надето` : `${COSMETICS[id].name}: снято, вернулось стандартное оформление`);
        this.render();
      }
    } else if (act === 'career') {
      g.audio.ui('click');
      g.goto('career');
    } else if (act === 'events') {
      g.audio.ui('click');
      g.goto('events');
    }
  }

  // ------------------------------------------------------------------ render
  private render(): void {
    const col = this.g.collection;
    const all = col.cosmetics();
    const owned = all.filter((v) => v.owned);
    const ach = col.achievements();
    const achDone = ach.filter((a) => a.done);
    const slots = COSMETIC_SLOTS.map((slot) => {
      const id = col.equipped(slot);
      return `<div class="ca-slot ${id ? 'on' : ''}"><span>${esc(SLOT_LABELS[slot])}</span><b>${id ? esc(COSMETICS[id].name) : 'Стандарт'}</b></div>`;
    }).join('');
    let body = '';
    if (this.tab === 'all') body = this.renderAll(owned, achDone);
    else if (this.tab === 'cosmetics') body = this.renderCosmetics(all);
    else if (this.tab === 'achievements') body = this.renderAchievements(ach);
    else body = this.renderSeasons(all);
    this.el.innerHTML = `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад">${UI_ICONS.back}</button>
        <div class="col-head"><div class="h1">Моя коллекция</div><div class="col-sub">PRIME TIME STAR ARCHIVE</div></div>
      </div>
      <div class="fill scroll col-scroll">
        <div class="col-archive panel">
          <div class="ca-top">
            <div class="ca-org">${esc(this.g.save.data.orgName)}</div>
            <div class="ca-count"><span><b>${owned.length}</b>/${all.length} предметов</span><span><b>${achDone.length}</b>/${ach.length} достижений</span></div>
          </div>
          <div class="label ca-label">Сейчас в эфире</div>
          <div class="ca-slots">${slots}</div>
        </div>
        <div class="seg-control col-tabs">${TABS.map((t) => `<button class="${this.tab === t.id ? 'on' : ''}" data-act="tab" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
        ${body}
      </div>`;
  }

  private renderAll(owned: CosmeticView[], achDone: AchievementView[]): string {
    if (!owned.length && !achDone.length) {
      return `<div class="col-empty panel">${UI_ICONS.trophy}<div class="h2">Архив пока пуст</div>
        <div class="muted">Сюда попадают все награды продюсера: косметика сезонных событий, трофей за победу над Виктором, карьерные этапы, пройденные марафоны и испытания.</div>
        <div class="col-empty-actions"><button class="btn ghost" data-act="career">Карьера</button><button class="btn ghost" data-act="events">События</button></div></div>`;
    }
    const cos = owned.length ? `<div class="col-section-title"><span class="h2">Косметика</span><span class="label">${owned.length}</span></div><div class="col-list">${owned.map((v) => this.cosmeticCard(v)).join('')}</div>` : '';
    const ach = achDone.length ? `<div class="col-section-title"><span class="h2">Достижения</span><span class="label">${achDone.length}</span></div><div class="col-list">${achDone.map((a) => this.achievementCard(a)).join('')}</div>` : '';
    return cos + ach;
  }

  private renderCosmetics(all: CosmeticView[]): string {
    const owned = all.filter((v) => v.owned);
    const locked = all.filter((v) => !v.owned);
    return `<div class="col-hint muted">Надетый предмет меняет оформление игры. Снимите его — вернётся стандартное. В каждом слоте — один предмет.</div>
      <div class="col-list">${owned.map((v) => this.cosmeticCard(v)).join('')}</div>
      ${locked.length ? `<div class="col-section-title"><span class="h2">Ещё не получено</span><span class="label">${locked.length}</span></div><div class="col-list">${locked.map((v) => this.cosmeticCard(v)).join('')}</div>` : ''}`;
  }

  private renderAchievements(ach: AchievementView[]): string {
    const done = ach.filter((a) => a.done);
    const todo = ach.filter((a) => !a.done);
    return `<div class="col-list">${done.map((a) => this.achievementCard(a)).join('')}</div>
      ${todo.length ? `<div class="col-section-title"><span class="h2">В процессе</span><span class="label">${todo.length}</span></div><div class="col-list">${todo.map((a) => this.achievementCard(a)).join('')}</div>` : ''}`;
  }

  private renderSeasons(all: CosmeticView[]): string {
    const seasonal = all.filter((v) => v.def.source === 'season');
    const groups = new Map<string, CosmeticView[]>();
    for (const v of seasonal) {
      const list = groups.get(v.def.eventId) ?? [];
      list.push(v);
      groups.set(v.def.eventId, list);
    }
    const em = this.g.events;
    const out: string[] = [];
    for (const [eventId, items] of groups) {
      const ev = EVENTS.find((e) => e.id === eventId);
      const running = em.active?.id === eventId && em.playable;
      const ended = !!ev?.end && Date.parse(ev.end) <= em.now();
      const state = running ? '<span class="chip orange">Идёт сейчас</span>' : ended ? '<span class="chip">Сезон завершён</span>' : '<span class="chip">Скоро</span>';
      const got = items.filter((v) => v.owned).length;
      out.push(`<div class="col-season panel">
          <div class="cs-head"><div><div class="cs-name">${esc(items[0].def.sourceLabel)}</div><div class="label">Получено ${got}/${items.length} · награды остаются навсегда</div></div>${state}</div>
          ${running ? `<button class="btn ghost wide cs-go" data-act="events">Задания и обмен — в «Событиях»</button>` : ''}
          <div class="col-list">${items.map((v) => this.cosmeticCard(v)).join('')}</div>
        </div>`);
    }
    if (!out.length) out.push('<div class="col-hint muted">Сезонных наград пока нет.</div>');
    return out.join('');
  }

  private cosmeticCard(v: CosmeticView): string {
    const c = v.def;
    const fresh = this.freshOnOpen.has(c.id);
    let state: string;
    let btn = '';
    if (v.owned) {
      state = v.equipped ? `<span class="cc-state on">${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} Надето</span>` : '<span class="cc-state">В коллекции</span>';
      btn = v.equipped
        ? `<button class="btn ghost cc-btn" data-act="unequip" data-id="${c.id}">Снять</button>`
        : `<button class="btn teal cc-btn" data-act="equip" data-id="${c.id}">Надеть</button>`;
    } else {
      state = `<span class="cc-state locked">${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} ${esc(c.howTo)}</span>`;
    }
    const when = v.owned && v.at ? ` · ${fmtDate(v.at)}` : '';
    return `<div class="col-card rarity-${c.rarity} ${v.owned ? 'owned' : 'locked'} ${v.equipped ? 'equipped' : ''}">
        <div class="cc-art">${REWARD_ART[c.art]}</div>
        <div class="cc-body">
          <div class="cc-top"><span class="cc-type">${esc(SLOT_LABELS[c.slot])}</span><span class="cc-rarity">${RARITY[c.rarity]}</span>${fresh ? '<span class="cc-new">NEW</span>' : ''}</div>
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-desc">${esc(c.desc)}</div>
          <div class="cc-meta">${esc(c.sourceLabel)}${when} · ${esc(c.where)}</div>
          <div class="cc-foot">${state}${btn}</div>
        </div>
      </div>`;
  }

  private achievementCard(a: AchievementView): string {
    const art =
      a.art === 'belt' || a.art === 'star' || a.art === 'studio'
        ? REWARD_ART[a.art]
        : a.art === 'survival'
          ? MODE_ICONS.survival
          : a.art === 'challenge'
            ? MODE_ICONS.challenge
            : REWARD_ART.star;
    const reward = a.reward ? `<span class="cc-reward">Награда: <b>${esc(COSMETICS[a.reward].name)}</b>${this.g.collection.owns(a.reward) ? ' · в коллекции' : ''}</span>` : '';
    return `<div class="col-card ach ${a.done ? 'owned' : 'locked'}">
        <div class="cc-art ach-${a.art}">${art}</div>
        <div class="cc-body">
          <div class="cc-top"><span class="cc-type">${esc(a.source)}</span>${a.done ? '<span class="cc-rarity">Достижение</span>' : ''}</div>
          <div class="cc-name">${esc(a.title)}</div>
          <div class="cc-desc">${esc(a.desc)}</div>
          <div class="cc-meta">${esc(a.note)}${a.done && a.at ? ` · ${fmtDate(a.at)}` : ''}</div>
          <div class="cc-foot">${a.done ? `<span class="cc-state on">${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} Получено</span>` : '<span class="cc-state">В процессе</span>'}${reward}</div>
        </div>
      </div>`;
  }
}
