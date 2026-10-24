import { COSMETICS, COSMETIC_SLOTS, SLOT_LABELS, type CosmeticDef, type CosmeticId } from '../../config/cosmetics.config';
import { EVENTS } from '../../config/events.config';
import { FIGHTERS, FIGHTER_ORDER } from '../../config/fighters';
import { LOOKS } from '../../config/looks';
import { SKINS, SKU_OF_COSMETIC, SKU_OF_SKIN, type SkinId } from '../../config/shop.config';
import { paidSource } from '../../meta/entitlements';
import { inRoster } from '../../meta/roster';
import type { FighterId } from '../../config/types';
import type { Game } from '../../game/Game';
import type { AchievementView, CollectionTab, CosmeticView } from '../../meta/Collection';
import { el, esc, portraitHTML, setScreenHTML } from '../dom';
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
    this.render(false);
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
      // personal items are worn per fighter (the chip names who); common items by the producer
      const fighter = (t.dataset.f as FighterId | undefined) ?? g.save.data.selected;
      const personal = !!COSMETICS[id].personal;
      if (g.collection.setEquipped(id, act === 'equip', fighter)) {
        g.audio.ui(act === 'equip' ? 'confirm' : 'click');
        g.applyCosmetics();
        const who = personal ? ` (${FIGHTERS[fighter].name})` : '';
        g.ui.toast(act === 'equip' ? `${COSMETICS[id].name}${who}: надето` : `${COSMETICS[id].name}${who}: снято`);
        this.render();
      }
    } else if (act === 'assign') {
      // one-time: tie an old personal reward to the fighter who earned it
      const id = t.dataset.id as CosmeticId;
      const f = t.dataset.f as FighterId;
      g.confirm(
        'Привязать награду?',
        `«${COSMETICS[id].name}» станет личной наградой бойца ${FIGHTERS[f].name}. Выбор делается один раз.`,
        'Привязать',
        () => {
          if (g.collection.assignLegacy(id, f)) {
            g.audio.ui('confirm');
            g.applyCosmetics();
            g.ui.toast(`${COSMETICS[id].name}: теперь награда бойца ${FIGHTERS[f].name}`);
            this.render();
          }
        },
      );
    } else if (act === 'career') {
      g.audio.ui('click');
      g.goto('career');
    } else if (act === 'events') {
      g.audio.ui('click');
      g.goto('events');
    } else if (act === 'roster-star') {
      g.audio.ui('click');
      g.goto('roster', t.dataset.f);
    } else if (act === 'skin') {
      // 1.8.8: the wardrobe — an owned PRIME SHOP skin or the standard look (Shop refuses the rest)
      const f = t.dataset.f as FighterId;
      const skin = (t.dataset.skin || null) as SkinId | null;
      if (g.shop.setSkin(f, skin)) {
        g.audio.ui(skin ? 'confirm' : 'click');
        if (f === g.save.data.selected) g.showcase.show(g.fighterLook(f), FIGHTERS[f].theme.accent);
        g.ui.toast(`${FIGHTERS[f].name}: ${skin ? SKINS[skin].name : 'стандартный облик'}`);
        this.render();
      }
    } else if (act === 'shop') {
      g.audio.ui('click');
      g.goto('shop', { sku: t.dataset.sku, from: 'collection' });
    }
  }

  // ------------------------------------------------------------------ render
  private render(keep = true): void {
    const col = this.g.collection;
    const sel = this.g.save.data.selected;
    // only what may be shown: seasonal items appear once really obtained (no spoilers)
    const all = col.cosmetics(undefined, sel);
    const owned = all.filter((v) => v.owned);
    const ach = col.achievements();
    const achDone = ach.filter((a) => a.done);
    const slots = COSMETIC_SLOTS.map((slot) => {
      const id = col.equippedFor(slot, sel);
      return `<div class="ca-slot ${id ? 'on' : ''}"><span>${esc(SLOT_LABELS[slot])}</span><b>${id ? esc(COSMETICS[id].name) : 'Стандарт'}</b></div>`;
    }).join('');
    const legacy = col.unassigned().map((id) => this.legacyCard(id)).join('');
    let body = '';
    if (this.tab === 'all') body = this.renderAll(owned, achDone);
    else if (this.tab === 'cosmetics') body = this.renderCosmetics(all);
    else if (this.tab === 'achievements') body = this.renderAchievements(ach);
    else body = this.renderSeasons(all);
    setScreenHTML(
      this.el,
      `
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
          <div class="label ca-label">Сейчас в эфире · ${esc(FIGHTERS[sel].name)}</div>
          <div class="ca-slots">${slots}</div>
        </div>
        ${legacy}
        <div class="seg-control col-tabs">${TABS.map((t) => `<button class="${this.tab === t.id ? 'on' : ''}" data-act="tab" data-tab="${t.id}">${t.label}</button>`).join('')}</div>
        ${body}
      </div>`,
      keep,
    );
  }

  /**
   * Alpha 1.8.8 — fighter looks: each PRIME SHOP skin with the standard look next to it. An owned skin
   * is worn or taken off here; one not owned only links to the free fitting room in PRIME SHOP.
   */
  private wardrobe(): string {
    const g = this.g;
    const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');
    const cards = (Object.keys(SKINS) as SkinId[]).map((id) => {
      const sk = SKINS[id];
      const f = FIGHTERS[sk.fighter];
      const look = LOOKS[sk.look];
      const owned = g.shop.ownsSkin(id);
      const worn = g.shop.skinFor(sk.fighter) === id;
      const std = owned && !worn;
      const art = `<div class="cc-art">${portraitHTML(g.portraitFor(std ? f.look : sk.look), std ? f.theme.main : hex(look.top.accent), std ? f.theme.dark : hex(look.top.main))}</div>`;
      const src = paidSource(SKU_OF_SKIN[id]);
      // 1.8.8: a development grant and a test-mode (demonstration) right are never shown as a real purchase
      const head = `<div class="cc-top"><span class="cc-type">Облик бойца · ${esc(f.name)}</span><span class="cc-rarity">${src === 'dev' ? 'Тест (dev)' : src === 'test' ? 'Тестовая покупка' : 'PRIME SHOP'}</span></div>`;
      if (!owned) {
        return `<div class="col-card wr-card locked">${art}<div class="cc-body">${head}
            <div class="cc-name">${esc(f.name)}: ${esc(sk.name)}</div>
            <div class="cc-desc">Сейчас у бойца стандартный облик. Скин можно бесплатно примерить в PRIME SHOP — примерка ничего не открывает.</div>
            <div class="cc-foot"><span class="cc-state locked">${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} PRIME SHOP</span><button class="btn ghost cc-btn" data-act="shop" data-sku="${SKU_OF_SKIN[id]}">Примерить</button></div>
          </div></div>`;
      }
      return `<div class="col-card wr-card owned ${worn ? 'equipped' : ''}">${art}<div class="cc-body">${head}
          <div class="cc-name">${esc(f.name)}: ${worn ? esc(sk.name) : 'стандартный облик'}</div>
          <div class="wr-pick seg-control">
            <button class="${worn ? '' : 'on'}" data-act="skin" data-f="${sk.fighter}" data-skin="">Стандарт</button>
            <button class="${worn ? 'on' : ''}" data-act="skin" data-f="${sk.fighter}" data-skin="${id}">${esc(sk.name)}</button>
          </div>
          <div class="cc-meta">Облик виден в меню, составе, подготовке и в бою. Бой и характеристики не меняются.</div>
        </div></div>`;
    });
    return `<div class="col-section-title"><span class="h2">Облики бойцов</span><span class="label">${cards.length}</span></div><div class="col-list">${cards.join('')}</div>`;
  }

  private renderAll(owned: CosmeticView[], achDone: AchievementView[]): string {
    // Alpha 1.7: the seasonal stars the producer opened
    const stars = this.g.collection.seasonalFighters();
    const starBlock = stars.length
      ? `<div class="col-section-title"><span class="h2">Сезонные бойцы</span><span class="label">${stars.length}</span></div><div class="col-list">${stars.map((x) => this.starCard(x.id, x.eventId, x.at)).join('')}</div>`
      : '';
    if (!owned.length && !achDone.length && !stars.length) {
      return `${this.wardrobe()}<div class="col-empty panel">${UI_ICONS.trophy}<div class="h2">Архив пока пуст</div>
        <div class="muted">Сюда попадают все награды продюсера: косметика сезонных событий, трофей за победу над Виктором, карьерные этапы, пройденные марафоны и испытания.</div>
        <div class="col-empty-actions"><button class="btn ghost" data-act="career">Карьера</button><button class="btn ghost" data-act="events">События</button></div></div>`;
    }
    const cos = owned.length ? `<div class="col-section-title"><span class="h2">Косметика</span><span class="label">${owned.length}</span></div><div class="col-list">${owned.map((v) => this.cosmeticCard(v)).join('')}</div>` : '';
    const ach = achDone.length ? `<div class="col-section-title"><span class="h2">Достижения</span><span class="label">${achDone.length}</span></div><div class="col-list">${achDone.map((a) => this.achievementCard(a)).join('')}</div>` : '';
    return this.wardrobe() + starBlock + cos + ach;
  }

  /** Alpha 1.7: a seasonal star in the archive — who, from which season and when (kept for good). */
  private starCard(id: FighterId, eventId: string, at: number): string {
    const f = FIGHTERS[id];
    const ev = EVENTS.find((e) => e.id === eventId);
    const when = at > 0 ? ` · ${fmtDate(at)}` : '';
    return `<div class="col-card col-star owned">
        <div class="cc-art">${portraitHTML(this.g.portraitOf(f.id), f.theme.main, f.theme.dark)}</div>
        <div class="cc-body">
          <div class="cc-top"><span class="cc-type">Сезонный боец</span><span class="cc-rarity">Эксклюзив</span></div>
          <div class="cc-name">${esc(f.name)} · ${esc(f.nickname)}</div>
          <div class="cc-desc">${esc(f.style)}: трость-бластер, уколы вблизи и фирменная карта BAT BITE. В вашем составе навсегда.</div>
          <div class="cc-meta">${esc(ev?.title ?? f.seasonal?.title ?? '')}${when}</div>
          <div class="cc-foot"><span class="cc-state on">${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} В составе</span><button class="btn teal cc-btn" data-act="roster-star" data-f="${id}">Мои бойцы</button></div>
        </div>
      </div>`;
  }

  private renderCosmetics(all: CosmeticView[]): string {
    const owned = all.filter((v) => v.owned);
    const locked = all.filter((v) => !v.owned);
    return `<div class="col-hint muted">Надетый предмет меняет оформление игры. Снимите его — вернётся стандартное. В каждом слоте — один предмет.</div>
      <div class="col-list">${owned.map((v) => this.cosmeticCard(v)).join('')}</div>
      ${this.wardrobe()}
      ${locked.length ? `<div class="col-section-title"><span class="h2">Ещё не получено</span><span class="label">${locked.length}</span></div><div class="col-list">${locked.map((v) => this.cosmeticCard(v)).join('')}</div>` : ''}`;
  }

  private renderAchievements(ach: AchievementView[]): string {
    const done = ach.filter((a) => a.done);
    const todo = ach.filter((a) => !a.done);
    return `<div class="col-list">${done.map((a) => this.achievementCard(a)).join('')}</div>
      ${todo.length ? `<div class="col-section-title"><span class="h2">В процессе</span><span class="label">${todo.length}</span></div><div class="col-list">${todo.map((a) => this.achievementCard(a)).join('')}</div>` : ''}`;
  }

  /**
   * Alpha 1.5.5: only seasonal items the player really obtained (they stay forever). A running
   * event gets a short card pointing to «События», where its rewards are presented; nothing
   * of a future season is revealed here.
   */
  private renderSeasons(all: CosmeticView[]): string {
    const seasonal = all.filter((v) => v.def.source === 'season' && v.owned);
    const groups = new Map<string, CosmeticView[]>();
    for (const v of seasonal) {
      const list = groups.get(v.def.eventId) ?? [];
      list.push(v);
      groups.set(v.def.eventId, list);
    }
    // Alpha 1.7: seasonal stars sit with the season that gave them
    const stars = this.g.collection.seasonalFighters();
    for (const st of stars) if (!groups.has(st.eventId)) groups.set(st.eventId, []);
    const em = this.g.events;
    const out: string[] = [];
    const live = em.active && em.playable ? em.active : null;
    if (live && !groups.has(live.id)) {
      out.push(`<div class="col-season panel">
          <div class="cs-head"><div><div class="cs-name">${esc(live.title)}</div><div class="label">Сезонные награды — в экране события</div></div><span class="chip orange">Идёт сейчас</span></div>
          <button class="btn ghost wide cs-go" data-act="events">Задания и награды — в «Событиях»</button>
        </div>`);
    }
    for (const [eventId, items] of groups) {
      const ev = EVENTS.find((e) => e.id === eventId);
      const running = live?.id === eventId;
      const state = running ? '<span class="chip orange">Идёт сейчас</span>' : '<span class="chip">Сезон завершён</span>';
      const here = stars.filter((st) => st.eventId === eventId);
      out.push(`<div class="col-season panel">
          <div class="cs-head"><div><div class="cs-name">${esc(ev?.title ?? items[0]?.def.sourceLabel ?? '')}</div><div class="label">Получено: ${items.length + here.length} · награды остаются навсегда</div></div>${state}</div>
          ${running ? `<button class="btn ghost wide cs-go" data-act="events">Задания и награды — в «Событиях»</button>` : ''}
          <div class="col-list">${here.map((st) => this.starCard(st.id, st.eventId, st.at)).join('')}${items.map((v) => this.cosmeticCard(v)).join('')}</div>
        </div>`);
    }
    if (!out.length) out.push('<div class="col-hint muted">Сезонных наград пока нет. Они появятся здесь, когда вы получите их во время события.</div>');
    return out.join('');
  }

  /** An old personal reward the records could not tie to a fighter: the player picks once. */
  private legacyCard(id: CosmeticId): string {
    const c = COSMETICS[id];
    const s = this.g.save.data;
    const fighters = FIGHTER_ORDER.filter((f) => inRoster(s, f));
    return `<div class="col-legacy panel">
        <div class="cl-head"><div class="cc-art">${REWARD_ART[c.art]}</div>
          <div><div class="h2">${esc(c.name)}: чья это победа?</div>
          <div class="muted cl-text">Эта награда получена до появления личных наград, и сохранение не помнит, какой боец её заработал. Выберите бойца — один раз, награду не придётся зарабатывать заново.</div></div></div>
        <div class="cl-fighters">${fighters.map((f) => `<button class="btn ghost cl-f" data-act="assign" data-id="${id}" data-f="${f}">${esc(FIGHTERS[f].name)}</button>`).join('')}</div>
      </div>`;
  }

  private cosmeticCard(v: CosmeticView): string {
    const c = v.def;
    const fresh = this.freshOnOpen.has(c.id);
    let state: string;
    let btn = '';
    let owners = '';
    if (c.personal) {
      // a personal reward: who earned it (tap a fighter to put it on / take it off), who has not yet
      const col = this.g.collection;
      const sel = this.g.save.data.selected;
      const chips = v.owners
        .map((f) => {
          const on = col.isEquipped(c.id, f);
          return `<button class="cc-owner ${on ? 'on' : ''} ${f === sel ? 'sel' : ''}" data-act="${on ? 'unequip' : 'equip'}" data-id="${c.id}" data-f="${f}" aria-label="${on ? 'Снять' : 'Надеть'}: ${esc(FIGHTERS[f].name)}">${on ? UI_ICONS.check.replace('<svg', '<svg width="10" height="10"') : ''}${esc(FIGHTERS[f].name)}</button>`;
        })
        .join('');
      const missing = FIGHTER_ORDER.filter((f) => !v.owners.includes(f) && this.g.events.fighterVisible(f)).map((f) => FIGHTERS[f].name);
      owners = `<div class="cc-owners">${v.owners.length ? `<span class="cc-ol">Получено:</span>${chips}` : ''}</div>
        ${missing.length ? `<div class="cc-missing">${v.owners.length ? 'Ещё не получено' : 'Пока ни у кого'}: ${esc(missing.join(', '))}</div>` : ''}`;
      state = v.owners.length
        ? v.owners.includes(sel)
          ? `<span class="cc-state">Личная награда · нажмите на бойца, чтобы надеть или снять</span>`
          : `<span class="cc-state locked">Для бойца ${esc(FIGHTERS[sel].name)}: ещё не получено</span>`
        : `<span class="cc-state locked">${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} ${esc(c.howTo)}</span>`;
    } else if (v.owned) {
      // 1.8.8: a PRIME SHOP item lent by the development test grant is not shown as a real one
      const src = c.paid ? paidSource(SKU_OF_COSMETIC[c.id] ?? '') : null;
      const tag = src === 'dev' ? ' · тест (dev)' : src === 'test' ? ' · тестовая покупка' : '';
      state = v.equipped
        ? `<span class="cc-state on">${UI_ICONS.check.replace('<svg', '<svg width="11" height="11"')} Надето${tag}</span>`
        : `<span class="cc-state">${src === 'dev' ? 'Тестовый доступ (dev)' : src === 'test' ? 'Тестовая покупка' : 'В коллекции'}</span>`;
      btn = v.equipped
        ? `<button class="btn ghost cc-btn" data-act="unequip" data-id="${c.id}">Снять</button>`
        : `<button class="btn teal cc-btn" data-act="equip" data-id="${c.id}">Надеть</button>`;
    } else {
      state = `<span class="cc-state locked">${UI_ICONS.lock.replace('<svg', '<svg width="11" height="11"')} ${esc(c.howTo)}</span>`;
    }
    const when = v.owned && v.at ? ` · ${fmtDate(v.at)}` : '';
    const ownedHere = c.personal ? v.owners.length > 0 : v.owned;
    return `<div class="col-card rarity-${c.rarity} ${ownedHere ? 'owned' : 'locked'} ${v.equipped ? 'equipped' : ''}">
        <div class="cc-art">${REWARD_ART[c.art]}</div>
        <div class="cc-body">
          <div class="cc-top"><span class="cc-type">${esc(SLOT_LABELS[c.slot])}</span><span class="cc-rarity">${RARITY[c.rarity]}</span>${fresh ? '<span class="cc-new">NEW</span>' : ''}</div>
          <div class="cc-name">${esc(c.name)}</div>
          <div class="cc-desc">${esc(c.desc)}</div>
          <div class="cc-meta">${esc(c.sourceLabel)}${when} · ${esc(c.where)}</div>
          ${owners}
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
