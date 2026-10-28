import { DAILY, dailyReward, nextMilestone } from '../config/daily.config';
import { plural } from '../config/events.config';
import { formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import type { DailyClaim, DailyRewardInfo, DailyStatus } from '../net/PrimeApi';
import type { DailyOutcome } from '../net/SyncManager';
import { openLogin } from './accountUI';
import { countUp, esc } from './dom';
import { UI_ICONS } from './icons';
import type { MenuScreen } from './screens/MenuScreen';

// Alpha 1.8.9 — the DAILY PRIME STREAK window («ЕЖЕДНЕВНЫЙ ЭФИР»): the streak, the record, today's gift, the next
// days, the milestone track 7 / 14 / 30 / 60 / 100 and the free shield. Everything shown comes from the PRIME NETWORK
// server (g.daily.status); the gift's show plays only after the server confirmed the reward.

const DAYS: [string, string, string] = ['день', 'дня', 'дней'];
/** Calm show: the system's «reduce motion» or the game's own «Движение камеры: без тряски» (data-motion = off). */
const reduced = () => (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.dataset.motion === 'off';
const money = (n: number) => formatMoney(n);
const icon = (svg: string, size: number) => svg.replace('<svg', `<svg width="${size}" height="${size}"`);

/** Where a milestone day sits on the track (the five milestones evenly; anything past the last at the end). */
function trackPos(n: number): number {
  const ms = DAILY.milestones.map((m) => m.day);
  if (n <= 0) return 0;
  let prev = 0;
  for (let i = 0; i < ms.length; i++) {
    if (n <= ms[i]) return ((i + (n - prev) / (ms[i] - prev)) / ms.length) * 100;
    prev = ms[i];
  }
  return 100;
}

function chipHTML(r: DailyRewardInfo, state: 'done' | 'today' | 'next' | 'soon'): string {
  const special = r.kind === 'milestone' ? 'milestone' : r.kind === 'weekly' ? 'weekly' : '';
  const glyph = state === 'done' ? icon(UI_ICONS.check, 12) : r.kind === 'daily' ? '<i class="dps-coin" aria-hidden="true"></i>' : icon(UI_ICONS.gift, 18);
  const tag = state === 'today' ? 'Сегодня' : state === 'next' ? 'Завтра' : `День ${r.day}`;
  return `<li class="dps-chip ${state} ${special}" aria-label="${esc(tag)}: ${money(r.money)}${state === 'done' ? ', получено' : ''}">
      <span class="dps-chip-day">Д.${r.day}</span>
      <span class="dps-chip-ico">${glyph}</span>
      <b>${money(r.money)}</b>
    </li>`;
}

function headHTML(): string {
  return `<header class="dps-head">
      <span class="dps-live" aria-hidden="true"><i></i>LIVE</span>
      <div class="dps-brand"><b id="dps-title">DAILY PRIME STREAK</b><small>Ежедневный эфир</small></div>
      <button type="button" class="dps-x" data-dps="close" aria-label="Закрыть">×</button>
    </header>`;
}

/** The milestone track: 7 / 14 / 30 / 60 / 100, the current streak's progress, the milestones ever reached. */
function trackHTML(streak: number, reached: Record<number, boolean>): string {
  const nm = nextMilestone(streak);
  const left = nm.day - streak;
  const nodes = DAILY.milestones
    .map((m) => {
      const cls = streak >= m.day ? 'passed' : reached[m.day] ? 'reached' : '';
      return `<span class="dps-node ${cls}" style="left:${trackPos(m.day)}%"><b>${m.day}</b><small>${money(m.money)}</small></span>`;
    })
    .join('');
  const goal = streak >= DAILY.milestones[DAILY.milestones.length - 1].day ? `Юбилей ${nm.day} дней — ещё ${left} ${plural(left, DAYS)}` : `До рубежа «${esc(nm.short)}» — ${left} ${plural(left, DAYS)}`;
  return `<section class="dps-track" aria-label="Рубежи серии">
      <div class="dps-track-head"><b>Рубежи серии</b><span>${goal}</span></div>
      <div class="dps-rail"><i style="width:${trackPos(streak)}%"></i>${nodes}</div>
    </section>`;
}

/** Signed out / not ready: what the streak gives, and the way in. */
function gateHTML(g: Game): string {
  const gate = g.daily.gate();
  const week = Array.from({ length: 7 }, (_, i) => dailyReward(i + 1));
  const preview = `<ol class="dps-strip" aria-label="Первая неделя">${week.map((r) => chipHTML(r, 'soon')).join('')}</ol>${trackHTML(0, {})}`;
  let msg = '';
  let action = '';
  if (gate === 'guest') {
    msg = '<b>Подарки ждут в PRIME ID</b><span>Войдите в свой аккаунт: награды начисляются на сервере PRIME NETWORK и хранятся в PRIME CLOUD — на любом устройстве.</span>';
    action = g.account?.api?.sessionRecord ? '' : '<button type="button" class="btn wide dps-claim" data-dps="login">Войти в PRIME ID</button>';
    if (!action) msg = '<b>Это карьера другого аккаунта</b><span>Ежедневные награды начисляются только в карьеру PRIME ID, в который выполнен вход.</span>';
  } else if (gate === 'unverified') {
    msg = '<b>Подтвердите почту</b><span>Ежедневные награды открываются после подтверждения адреса электронной почты PRIME ID.</span>';
    action = '<button type="button" class="btn wide ghost" data-dps="profile">Открыть PRIME ID</button>';
  } else if (gate === 'terms') {
    msg = '<b>Примите актуальные документы</b><span>PRIME CLOUD продолжит работу и подарки станут доступны сразу после этого.</span>';
    action = '<button type="button" class="btn wide ghost" data-dps="profile">Открыть PRIME ID</button>';
  } else {
    msg = '<b>PRIME CLOUD подключается…</b><span>Прогресс аккаунта сверяется с облаком. Подарок станет доступен через несколько секунд.</span>';
    action = '<button type="button" class="btn wide ghost" data-dps="retry">Проверить ещё раз</button>';
  }
  return `${headHTML()}<div class="dps-gate" role="note">${icon(UI_ICONS.gift, 44)}<p>${msg}</p></div>${preview}<div class="dps-foot">${action}</div>`;
}

function shieldHTML(s: DailyStatus): string {
  let cls = 'ready';
  let text = 'Защита серии готова: один пропущенный день будет прощён.';
  if (s.willShield) {
    cls = 'used';
    text = 'Вчерашний пропуск прощён защитой — серия продолжается!';
  } else if (!s.shield.ready) {
    const missDay = s.claimedToday ? s.today + 1 : s.today;
    const n = Math.max(1, s.shield.readyOn - missDay);
    cls = 'wait';
    text = `Защита серии восстановится через ${n} ${plural(n, DAYS)}. Пока она перезаряжается, пропуск прервёт серию.`;
  }
  return `<div class="dps-shield ${cls}">${icon(UI_ICONS.shieldMini, 18)}<span>${text}</span></div>`;
}

function clockText(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function statusHTML(s: DailyStatus, note: string, bump: boolean): string {
  const claimed = s.claimedToday;
  const ready = s.canClaim;
  // the strip: the last days of this streak already received, then the coming ones
  // (only this streak's own days: the last two claims, at most two game days back)
  const done = s.history.filter((h) => h.day >= s.today - 2 && h.streakDay > 0 && h.streakDay <= s.streak && s.streak - h.streakDay < 2).sort((a, b) => a.streakDay - b.streakDay);
  const doneChips = done.map((h) => chipHTML({ day: h.streakDay, money: h.money, kind: h.kind === 'milestone' ? 'milestone' : h.kind === 'weekly' ? 'weekly' : 'daily', milestone: h.milestone, label: '' }, 'done'));
  const nextChips = s.upcoming.slice(0, 7 - doneChips.length).map((r, i) => chipHTML(r, i === 0 ? (ready ? 'today' : 'next') : 'soon'));
  const hero = s.next;
  const heroKind = hero.kind === 'milestone' ? 'milestone' : hero.kind === 'weekly' ? 'weekly' : '';
  const reached: Record<number, boolean> = {};
  for (const m of s.milestones) reached[m.day] = m.reached;
  let foot = '';
  if (ready) foot = `<button type="button" class="btn big wide dps-claim" data-dps="claim"><span class="shine"></span><span class="dps-claim-text">Забрать награду</span></button>`;
  else if (claimed) foot = `<button type="button" class="btn wide dps-done" disabled>${icon(UI_ICONS.check, 16)} Получено</button><div class="dps-next">Следующий подарок через <b data-dps-timer>—</b></div>`;
  else foot = `<div class="dps-next">PRIME NETWORK сверяет часы — попробуйте чуть позже.</div>`;
  const warn = s.willReset ? `<div class="dps-warn">Серия прервалась — сегодня начинается новая. Рекорд ${s.best} ${plural(s.best, DAYS)} сохранён.</div>` : '';
  return `${headHTML()}
    <div class="dps-stats">
      <div class="dps-stat streak"><span>Серия</span><b class="${bump ? 'bump' : ''}">${s.streak}</b><small>${plural(s.streak, DAYS)} подряд</small></div>
      <div class="dps-stat best"><span>Рекорд</span><b>${s.best}</b><small>${plural(s.best, DAYS)}</small></div>
      <div class="dps-stat today ${claimed ? 'done' : ready ? 'ready' : ''}"><span>Сегодня</span><b>${claimed ? icon(UI_ICONS.check, 22) : ready ? icon(UI_ICONS.gift, 26) : '—'}</b><small>${claimed ? 'получено' : ready ? 'подарок ждёт' : '—'}</small></div>
    </div>
    <section class="dps-hero ${heroKind} ${claimed ? 'done' : ready ? 'ready' : ''}">
      <div class="dps-hero-gift">${icon(UI_ICONS.gift, 58)}</div>
      <div class="dps-hero-text">
        <span class="dps-hero-day">${claimed ? 'Завтра · ' : ready ? 'Сегодня · ' : ''}день ${hero.day}</span>
        <b>+${money(hero.money)}</b>
        <small>${esc(hero.label)}</small>
      </div>
    </section>
    <ol class="dps-strip" aria-label="Ближайшие награды">${doneChips.join('')}${nextChips.join('')}</ol>
    ${trackHTML(s.streak, reached)}
    <div class="dps-foot">
      ${warn}
      ${foot}
      ${note ? `<div class="dps-note" role="alert">${esc(note)}</div>` : ''}
      ${shieldHTML(s)}
    </div>`;
}

const FAIL: Record<string, string> = {
  offline: 'Нет связи с PRIME NETWORK. Если подарок уже был начислен, он не потеряется — попробуйте ещё раз.',
  already_claimed: 'Сегодняшний подарок уже получен — возможно, на другом устройстве.',
  conflict: 'PRIME CLOUD обновляет прогресс — повторите через пару секунд.',
  no_cloud_save: 'Прогресс ещё не сохранён в PRIME CLOUD — повторите через пару секунд.',
  session: 'Игра этого PRIME ID продолжается на другом устройстве — подарок можно забрать там.',
  not_ready: 'PRIME CLOUD ещё подключается — повторите через пару секунд.',
  refused: 'PRIME NETWORK не принял запрос. Попробуйте позже.',
};

/** The gift's show: only after the server confirmed the reward (never on an error). */
function reveal(g: Game, host: HTMLElement, c: DailyClaim, done: () => void): void {
  const big = c.kind === 'milestone';
  const calm = reduced();
  const sparks = calm ? '' : Array.from({ length: big ? 16 : 10 }, (_, i) => `<i style="--a:${(360 / (big ? 16 : 10)) * i}deg;--d:${0.08 * (i % 4)}s"></i>`).join('');
  const confetti = calm || !big ? '' : Array.from({ length: 18 }, (_, i) => `<i style="--x:${(i * 37) % 100}%;--d:${(i % 6) * 0.07}s;--r:${(i * 47) % 360}deg"></i>`).join('');
  const headline = big ? esc(c.label) : `День ${c.streakDay} в эфире`;
  const extra = c.shield ? '<small class="dps-reveal-note">Защита серии сохранила серию</small>' : c.reset ? '<small class="dps-reveal-note">Новая серия началась</small>' : '';
  const ov = document.createElement('div');
  ov.className = `dps-reveal ${big ? 'big' : ''} ${calm ? 'calm' : ''}`;
  ov.setAttribute('role', 'status');
  ov.setAttribute('aria-live', 'polite');
  ov.innerHTML = `<div class="dps-rays" aria-hidden="true"></div>
      <div class="dps-sparks" aria-hidden="true">${sparks}</div>
      <div class="dps-confetti" aria-hidden="true">${confetti}</div>
      <div class="dps-reveal-box">${icon(UI_ICONS.gift, big ? 96 : 84)}</div>
      <div class="dps-reveal-head">${headline}</div>
      <b class="dps-reveal-sum">+${money(0)}</b>
      <small class="dps-reveal-label">${esc(big ? (c.first ? 'Особое достижение серии!' : 'Рубеж снова взят!') : c.label)}</small>
      ${extra}
      <button type="button" class="btn wide dps-continue" data-dps="continue">Продолжить</button>`;
  // over exactly what the player sees of the window (it may be scrolled on a short screen), no scrolling meanwhile
  const modal = host.parentElement as HTMLElement;
  ov.style.top = `${modal.scrollTop}px`;
  ov.style.bottom = 'auto';
  ov.style.height = `${modal.clientHeight}px`;
  modal.style.overflowY = 'hidden';
  modal.appendChild(ov);
  g.audio.ui(big ? 'level' : 'confirm');
  const sum = ov.querySelector('.dps-reveal-sum') as HTMLElement;
  const start = () => countUp(sum, 0, c.money, calm ? 0.25 : big ? 1.1 : 0.8, (n) => '+' + money(n), () => g.audio.ui('coin'));
  if (calm) start();
  else setTimeout(start, 380);
  (ov.querySelector('[data-dps="continue"]') as HTMLElement).focus({ preventScroll: true });
  ov.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('[data-dps="continue"]')) return;
    e.stopPropagation();
    ov.remove();
    modal.style.overflowY = '';
    done();
  });
}

/** Open the DAILY PRIME STREAK window (from the gift in the menu). */
export function openDaily(g: Game): void {
  const d = g.daily;
  let note = '';
  let bump = false;
  let revealing = false;
  let off: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !revealing) g.ui.closeModal();
  };
  const cleanup = () => {
    off?.();
    off = null;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('keydown', onKey);
    // the menu shows the new balance (its dollars roll up) once the window is gone
    if (g.ui.current === 'menu') g.ui.get<MenuScreen>('menu').onShow();
  };
  g.ui.modal(`<div class="dps" role="dialog" aria-modal="true" aria-labelledby="dps-title"></div>`, (root) => {
    const modal = root.querySelector('.modal') as HTMLElement;
    modal.classList.add('dps-modal');
    root.classList.add('dps-root');
    const host = modal.querySelector('.dps') as HTMLElement;
    const gone = () => {
      if (root.isConnected) return false;
      cleanup();
      return true;
    };
    const render = () => {
      if (gone() || revealing) return;
      const s = d.status;
      if (d.gate() !== 'ok') host.innerHTML = gateHTML(g);
      else if (!s) host.innerHTML = `${headHTML()}<div class="dps-gate">${d.error ? `<p><b>Нет связи с PRIME NETWORK</b><span>Не удалось загрузить ежедневный эфир.</span></p><button type="button" class="btn wide ghost" data-dps="retry">Повторить</button>` : '<p class="dps-loading"><span class="dps-spin"></span>Загружаем ежедневный эфир…</p>'}</div>`;
      else host.innerHTML = statusHTML(s, note, bump);
      bump = false;
      tickTimer();
    };
    const tickTimer = () => {
      const el = host.querySelector('[data-dps-timer]') as HTMLElement | null;
      if (!el) return;
      const ms = d.msToNextDay();
      el.textContent = ms === null ? '—' : clockText(ms);
    };
    timer = setInterval(() => {
      if (!gone()) tickTimer();
    }, 1000);
    document.addEventListener('keydown', onKey);
    off = d.onChange(render);
    root.addEventListener('click', async (e) => {
      if (e.target === root) return void setTimeout(gone, 0);
      const t = (e.target as HTMLElement).closest('[data-dps]') as HTMLElement | null;
      if (!t || revealing) return;
      const act = t.dataset.dps;
      if (act === 'close') {
        g.audio.ui('click');
        g.ui.closeModal();
        cleanup();
      } else if (act === 'login') {
        g.audio.ui('click');
        g.ui.closeModal();
        cleanup();
        openLogin(g);
      } else if (act === 'profile') {
        g.audio.ui('click');
        g.ui.closeModal();
        cleanup();
        g.goto('profile');
      } else if (act === 'retry') {
        g.audio.ui('click');
        if (d.gate() === 'wait') void g.account?.retry();
        void d.refresh(true);
      } else if (act === 'claim') {
        note = '';
        (t as HTMLButtonElement).disabled = true;
        t.classList.add('busy');
        (t.querySelector('.dps-claim-text') as HTMLElement).innerHTML = '<span class="dps-spin"></span>Выходим в эфир…';
        g.audio.ui('click');
        const r: DailyOutcome = await d.claim();
        if (!root.isConnected) {
          // the window was closed meanwhile: the reward is in anyway — say so
          if (r.ok) g.ui.toast(`DAILY PRIME STREAK: +${money(r.claim.money)}`, true);
          return;
        }
        if (r.ok) {
          revealing = true;
          reveal(g, host, r.claim, () => {
            revealing = false;
            bump = true;
            render();
          });
        } else {
          g.audio.ui('deny');
          note = FAIL[r.code] ?? FAIL.refused;
          render();
        }
      }
    });
    render();
    void d.refresh();
  });
}
