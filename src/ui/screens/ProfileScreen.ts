import { COSMETICS } from '../../config/cosmetics.config';
import { FIGHTERS } from '../../config/fighters';
import type { FighterId } from '../../config/types';
import { formatMoney, formatNumber } from '../../core/math';
import type { Game } from '../../game/Game';
import { buildProfile, hallOfFame, type FighterRecord, type HallSort, type ProfileView } from '../../meta/ProducerProfile';
import { el, esc, portraitHTML, setScreenHTML } from '../dom';
import { UI_ICONS } from '../icons';
import type { Screen } from '../UI';
import { accountsOffNotice } from '../../net/build';

type Pane = 'overview' | 'hall' | 'collection';

const PANES: { id: Pane; label: string }[] = [
  { id: 'overview', label: 'Обзор' },
  { id: 'hall', label: 'Зал славы' },
  { id: 'collection', label: 'Коллекция' },
];
const SORTS: { id: HallSort; label: string }[] = [
  { id: 'wins', label: 'Победы' },
  { id: 'matches', label: 'Матчи' },
  { id: 'streak', label: 'Серия' },
];

const int = (n: number) => Math.floor(n).toLocaleString('ru-RU');
const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
/** Money in a tile: exact up to $99,999, then short ($1.2M) so it never overflows a narrow phone. */
const money = (n: number) => (n >= 100_000 ? '$' + formatNumber(n) : formatMoney(n));
const day = (t: number) => (t > 0 ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '');

/**
 * PRIME ID — PRODUCER PROFILE (Alpha 1.8): the producer's pass and dossier in the PRIME TIME
 * universe. Opened from the level badge in the main menu. It only reads the career data
 * (ProducerProfile.buildProfile / hallOfFame): opening it, switching sections or sorting the
 * Hall of Fame never changes or saves anything — unlike MY COLLECTION it does not even mark
 * items as seen. The pass is built for a guest now; in 1.8.1 the account fills its fields.
 */
export class ProfileScreen implements Screen {
  readonly el: HTMLElement;
  private g: Game;
  private pane: Pane = 'overview';
  private sort: HallSort = 'wins';
  /** The section slides in only when it changes (not when the Hall of Fame is re-sorted). */
  private enter = false;

  constructor(g: Game) {
    this.g = g;
    this.el = el('div', 'profile');
    this.el.addEventListener('click', (e) => this.onClick(e));
    // Alpha 1.8.1: the account block follows the sync status live
    g.account?.onChange(() => {
      if (g.ui.current === 'profile') this.render();
    });
  }

  onShow(): void {
    this.pane = 'overview';
    this.enter = true;
    // the dossier scrolls over the whole screen: the 3D fighter of the menu steps aside (back on leaving)
    this.g.showcase.hide();
    this.render(false);
  }

  private onClick(e: Event): void {
    const acc = (e.target as HTMLElement).closest('[data-acc]') as HTMLElement | null;
    if (acc && this.g.account) {
      this.g.account.action(acc.dataset.acc!);
      return;
    }
    const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    const g = this.g;
    const act = t.dataset.act!;
    if (act === 'back') {
      g.audio.ui('click');
      g.goto('menu');
    } else if (act === 'pane') {
      const p = t.dataset.pane as Pane;
      if (p === this.pane) return;
      g.audio.ui('swipe');
      this.pane = p;
      this.enter = true;
      this.render();
    } else if (act === 'sort') {
      const s = t.dataset.sort as HallSort;
      if (s === this.sort) return;
      g.audio.ui('click');
      this.sort = s;
      this.render();
    } else if (act === 'collection') {
      g.audio.ui('click');
      g.goto('collection');
    } else if (act === 'hall') {
      g.audio.ui('swipe');
      this.pane = 'hall';
      this.enter = true;
      this.render();
    }
  }

  private portrait(id: FighterId, cls = ''): string {
    const f = FIGHTERS[id];
    return portraitHTML(this.g.portraitOf(f.id), f.theme.main, f.theme.dark, cls);
  }

  // ------------------------------------------------------------------ render
  /** `keep`: an in-place update (scroll position kept); false: the screen was just opened. */
  private render(keep = true): void {
    const g = this.g;
    const p = buildProfile(g.save.data, g.career, g.collection, g.events);
    const body = this.pane === 'overview' ? this.overview(p) : this.pane === 'hall' ? this.hall() : this.collection(p);
    const enter = this.enter;
    this.enter = false;
    setScreenHTML(
      this.el,
      `
      <div class="screen-head" style="padding-right:62px">
        <button class="icon-btn" data-act="back" aria-label="Назад в главное меню">${UI_ICONS.back}</button>
        <div class="pid-head"><div class="h1">PRIME ID</div><div class="pid-sub">PRODUCER PROFILE</div></div>
      </div>
      <div class="fill scroll pid-scroll">
        ${this.pass(p, !keep)}
        ${g.account?.panelHTML() ?? this.accountsOff()}
        <div class="seg-control pid-tabs" role="tablist">${PANES.map((x) => `<button class="${this.pane === x.id ? 'on' : ''}" data-act="pane" data-pane="${x.id}" role="tab" aria-selected="${this.pane === x.id}">${x.label}</button>`).join('')}</div>
        <div class="pid-pane ${enter ? 'enter' : ''}" data-pane="${this.pane}" role="tabpanel">${body}</div>
      </div>`,
      keep,
    );
  }

  /**
   * Dev builds only (1.8.1): accounts are not running on this page — say why and how to switch
   * them on, instead of the block silently missing. Empty in the published game.
   */
  private accountsOff(): string {
    if (!import.meta.env.DEV) return '';
    const note = accountsOffNotice();
    if (!note) return '';
    return `<section class="pid-acc" data-kind="off">
        <div class="pid-acc-head"><span class="pid-acc-logo">PRIME<b>NETWORK</b></span><span class="pid-acc-env">РАЗРАБОТКА</span></div>
        <p class="pid-acc-text">${esc(note)}</p>
      </section>`;
  }

  /** The producer's pass: a TV-show participant card of the late 90s. */
  private pass(p: ProfileView, opening: boolean): string {
    const id = p.featured;
    const f = FIGHTERS[id];
    const fav = p.favourite !== null;
    const next = p.level.next;
    const repLine = next === null ? `${int(p.reputation)} · высший уровень` : `${int(p.reputation)} · ещё ${int(next - p.reputation)} до уровня ${p.level.level + 1}`;
    // Alpha 1.8.1: an account fills the producer field and the status; the guest pass stays as in 1.8
    const acc = this.g.account?.passInfo() ?? null;
    return `
      <section class="pid-card ${opening ? 'opening' : ''}" style="--pc:${f.theme.main};--pa:${f.theme.accent}">
        <div class="pid-band">
          <span class="pid-logo">PRIME<b>ID</b></span>
          <span class="pid-net">PRODUCER PASS</span>
          <span class="pid-onair">ON AIR</span>
        </div>
        <div class="pid-main">
          <div class="pid-photo">
            ${this.portrait(id, 'pid-portrait')}
            <span class="pid-photo-cap">${fav ? 'Любимый боец' : 'В эфире'}</span>
          </div>
          <div class="pid-fields">
            <div class="pid-field">
              <span>Продюсер</span>
              ${acc ? `<b class="pid-producer pid-nick">${esc(acc.nickname)}</b><small>Аккаунт PRIME ID</small>` : `<b class="pid-producer">GUEST PRODUCER</b><small>Гостевой продюсер</small>`}
            </div>
            <div class="pid-field">
              <span>Студия</span>
              <b class="pid-org">${esc(p.orgName)}</b>
            </div>
          </div>
        </div>
        <div class="pid-level">
          <span class="pid-hex">${p.level.level}</span>
          <div class="pid-lvl-text">
            <div class="pid-lvl-top"><b>${esc(p.level.title)}</b><span>Уровень ${p.level.level}</span></div>
            <div class="pid-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.levelProgress * 100)}" aria-label="Прогресс до следующего уровня"><i style="width:${Math.round(p.levelProgress * 100)}%"></i></div>
            <div class="pid-lvl-rep">${UI_ICONS.rep.replace('<svg', '<svg width="11" height="11"')} Репутация ${repLine}</div>
          </div>
        </div>
        <div class="pid-strip">
          <div><span>Любимый боец</span><b style="color:${f.theme.accent}">${fav ? esc(f.name) : '—'}</b></div>
          <div><span>Серия побед</span><b>${p.streak}</b></div>
          <div><span>Статус</span>${acc ? '<b class="pid-member">АККАУНТ</b>' : '<b class="pid-guest">ГОСТЬ</b>'}</div>
        </div>
        <div class="pid-foot">
          <span class="pid-code" aria-hidden="true"></span>
          <span class="pid-status">${acc ? `PRIME NETWORK · ${esc(acc.line)}` : 'Гостевой профиль · прогресс хранится в этом браузере'}</span>
        </div>
      </section>`;
  }

  private tile(label: string, value: string, cls = ''): string {
    return `<div class="pid-tile ${cls}"><b>${value}</b><span>${label}</span></div>`;
  }

  private overview(p: ProfileView): string {
    const fighterMini = (r: FighterRecord | null, label: string, line: (r: FighterRecord) => string) => {
      if (!r) return `<div class="pid-mini empty"><span class="pid-mini-label">${label}</span><b>—</b><small>Появится после первых матчей</small></div>`;
      const f = FIGHTERS[r.id];
      return `<button class="pid-mini" data-act="hall" style="--pa:${f.theme.accent}">
          ${this.portrait(r.id, 'pid-mini-portrait')}
          <span class="pid-mini-text"><span class="pid-mini-label">${label}</span><b>${esc(f.name)}</b><small>${line(r)}</small></span>
        </button>`;
    };
    const m = p.modes;
    return `
      <div class="pid-streaks">
        <div class="pid-streak now"><span>Текущая серия</span><b>${p.streak}</b><small>${p.streak === 1 ? 'победа подряд' : 'побед подряд'}</small></div>
        <div class="pid-streak best"><span>Рекорд серии</span><b>${p.bestStreak}</b><small>лучшая серия</small></div>
      </div>
      <div class="pid-note">Серии побед отслеживаются с Alpha 1.8${p.streakSince ? ` · с ${day(p.streakSince)}` : ''}</div>
      <div class="label pid-label">Карьера продюсера</div>
      <div class="pid-grid">
        ${this.tile('Матчей', int(p.matches))}
        ${this.tile('Побед', int(p.wins), 'win')}
        ${this.tile('Поражений', int(p.losses), 'loss')}
        ${this.tile('Ничьих', int(p.draws))}
        ${this.tile('Процент побед', pct(p.winRate), 'rate')}
        ${this.tile('Уровень', String(p.level.level))}
        ${this.tile('Репутация', int(p.reputation))}
        ${this.tile('Бойцов в составе', `${p.signed}/${p.visibleFighters}`)}
        ${this.tile('Фанаты бойцов', int(p.fans))}
        ${this.tile('Лучший рейтинг эфира', p.bestRating ? `${p.bestRating}<i>/100</i>` : '—')}
        ${this.tile('Комбо за матч', p.bestCombos ? String(p.bestCombos) : '—')}
        ${this.tile('Идеальных реакций', p.bestPerfects ? String(p.bestPerfects) : '—')}
        ${this.tile('Заработано', money(p.totalEarned))}
        ${this.tile('Побед на «Профи»', int(p.proWins))}
        ${this.tile('Побед на «Чемпионе»', int(p.championWins))}
      </div>
      <div class="label pid-label">Бойцы продюсера</div>
      <div class="pid-minis">
        ${fighterMini(p.favourite, 'Любимый боец', (r) => `${int(r.matches)} матчей · ${pct(r.winRate)} побед`)}
        ${fighterMini(p.mostWins, 'Самый победный', (r) => `${int(r.wins)} побед · рекорд серии ${r.bestStreak}`)}
      </div>
      <div class="label pid-label">Режимы эфира</div>
      <div class="pid-grid three">
        ${this.tile('Survival · лучшая волна', `${m.survivalBest}<i>/${m.survivalWaves}</i>`)}
        ${this.tile('Prime Challenge', `${m.challengesCleared}<i>/${m.challengesTotal}</i>`)}
        ${this.tile('Побед над боссом', int(m.bossWins))}
      </div>
      <p class="pid-foot-note">Матчи карьеры — Classic Duel, Prime Challenge и Boss Fight: из них складываются победы, поражения и серии. Волны Survival идут в рекорды марафона. Рейтинг эфира — оценка зрелищности матча, а не мировой рейтинг.</p>`;
  }

  private hall(): string {
    const g = this.g;
    const hof = hallOfFame(g.save.data, g.events, this.sort);
    const b = hof.badges;
    const card = (r: FighterRecord) => {
      const f = FIGHTERS[r.id];
      const badges = [b.mostWins === r.id ? '<span class="pid-badge wins">MOST WINS</span>' : '', b.bestStreak === r.id ? '<span class="pid-badge streak">BEST STREAK</span>' : '', b.mostPlayed === r.id ? '<span class="pid-badge played">MOST PLAYED</span>' : ''].join('');
      const lockNote = f.seasonal ? 'Сезонная звезда · открывается в обмене события' : 'Не в составе · контракт в разделе «Бойцы»';
      return `<div class="pid-hof ${r.unlocked ? '' : 'locked'} ${badges ? 'star' : ''}" style="--pc:${f.theme.main};--pa:${f.theme.accent}">
          <div class="pid-hof-photo">${this.portrait(r.id, 'pid-hof-portrait')}${r.unlocked ? '' : `<span class="pid-lock">${UI_ICONS.lock}</span>`}</div>
          <div class="pid-hof-body">
            <div class="pid-hof-top"><b>${esc(f.name)}</b><span>«${esc(f.nickname)}»</span></div>
            ${badges ? `<div class="pid-badges">${badges}</div>` : ''}
            ${
              r.unlocked || r.matches > 0
                ? `<div class="pid-hof-stats">
                    <span><b>${int(r.matches)}</b>матчей</span>
                    <span class="win"><b>${int(r.wins)}</b>побед</span>
                    <span class="loss"><b>${int(r.losses)}</b>пораж.</span>
                    <span><b>${pct(r.winRate)}</b>доля побед</span>
                  </div>
                  <div class="pid-hof-line"><span>Серия <b>${r.streak}</b></span><span>Рекорд <b>${r.bestStreak}</b></span><span>${UI_ICONS.fans.replace('<svg', '<svg width="10" height="10"')} <b>${int(r.fans)}</b></span></div>`
                : `<div class="pid-hof-locked">${lockNote}</div>`
            }
          </div>
        </div>`;
    };
    return `
      <div class="pid-sort" role="group" aria-label="Сортировка">${SORTS.map((s) => `<button class="${this.sort === s.id ? 'on' : ''}" data-act="sort" data-sort="${s.id}">${s.label}</button>`).join('')}</div>
      <div class="pid-hof-list">${hof.cards.map(card).join('')}</div>
      <p class="pid-foot-note">Статистика бойцов — матчи карьеры (Classic Duel, Prime Challenge, Boss Fight). Серии побед отслеживаются с Alpha 1.8.</p>`;
  }

  private collection(p: ProfileView): string {
    const c = p.collection;
    const chips = (ids: string[], empty: string) => (ids.length ? ids.map((x) => `<span class="pid-chip">${esc(x)}</span>`).join('') : `<span class="pid-empty">${empty}</span>`);
    const personal = c.personal.map((x) => `${COSMETICS[x.id].name} — ${x.owners.map((f) => FIGHTERS[f].name).join(', ')}`);
    const seasonal = [...c.seasonalFighters.map((f) => `${FIGHTERS[f].name} · сезонная звезда`), ...c.seasonal.map((id) => COSMETICS[id].name)];
    const highlights = c.highlights.length
      ? c.highlights.map((a) => `<div class="pid-ach"><b>${esc(a.title)}</b><span>${esc(a.source)}</span><small>${esc(a.note)}</small></div>`).join('')
      : '<span class="pid-empty">Первые достижения появятся после Boss Fight, Survival, Prime Challenge и новых этапов карьеры.</span>';
    return `
      <div class="pid-grid">
        ${this.tile('Бойцов открыто', `${p.signed}<i>/${p.visibleFighters}</i>`)}
        ${this.tile('Предметов', `${c.owned}<i>/${c.shown}</i>`)}
        ${this.tile('Достижений', `${c.achievementsDone}<i>/${c.achievementsTotal}</i>`)}
      </div>
      <div class="pid-cards-line">
        <span>Карты для колоды</span>
        <b>${c.basicCards} базовых · ${c.signatureCards} фирменных · ${c.shopOwned}/${c.shopTotal} из магазина</b>
      </div>
      <div class="label pid-label">Титулы</div>
      <div class="pid-chips">${chips(c.titles.map((id) => COSMETICS[id].name), 'Пока нет титулов')}</div>
      <div class="label pid-label">Личные награды бойцов</div>
      <div class="pid-chips">${chips(personal, 'Пока нет личных наград')}</div>
      <div class="label pid-label">Сезонные награды</div>
      <div class="pid-chips">${chips(seasonal, 'Пока нет сезонных наград')}</div>
      <div class="label pid-label">Достижения</div>
      <div class="pid-achs">${highlights}</div>
      <button class="btn ghost wide pid-open" data-act="collection">${UI_ICONS.archive.replace('<svg', '<svg width="18" height="18"')} Открыть коллекцию</button>`;
  }
}
