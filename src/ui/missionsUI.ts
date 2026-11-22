import { CASE_DEFS } from '../config/cases.config';
import type { Game } from '../game/Game';
import type { MissionView, MissionsStatus } from '../net/PrimeApi';
import { caseImg, casesStatus, oddsHTML, onCases, openCaseShow, refreshCases } from './caseUI';
import { iconUrl } from './artIcons';
import { esc } from './dom';
import { UI_ICONS } from './icons';

// Beta 2.6 — DAILY MISSIONS («ЕЖЕДНЕВНЫЕ ЗАДАНИЯ»): the entry card in the daily window and the missions window itself.
// Everything shown is the PRIME NETWORK server's (g.missions.status): which five missions, how far each one is, which
// are done and gave their DAILY MISSION MINI CASE; the case opens in the shared REWARD CASES show (one 3D stage).
// The owner's picture (PRIME_TIME_2_6_UI_ART/ui_daily_missions.png → public/ui/missions/{xs,sm,md}) is a decoration of
// the entry and the header only: «contain», a fixed modest size, never cropped, never behind text.

/** The picture at the size it is shown (CSS px): the smallest copy still sharp on a 3× screen (artIcons.iconUrl). */
export function missionsArt(px: number, cls = ''): string {
  return `<img class="mis-art ${cls}" src="${iconUrl('missions', 'daily_missions', px)}" width="${px}" height="${px}" alt="" aria-hidden="true" draggable="false" decoding="async">`;
}

const TIER: Record<MissionView['tier'], string> = { easy: 'Лёгкое', medium: 'Среднее', hard: 'Сложное' };

function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** The entry card in the DAILY window (only where the server has missions and this player may have them). */
export function missionsEntryHTML(g: Game): string {
  if (g.missions.gate() !== 'ok') return '';
  const s = g.missions.status;
  const done = s ? s.missions.filter((m) => m.done).length : 0;
  const ready = casesStatus()?.mission.ready ?? s?.cases.ready ?? 0;
  const line = s ? `${done} из ${s.missions.length} выполнено${ready ? ` · мини-кейсов ждёт: <b>${ready}</b>` : ''}` : 'Пять заданий каждый день — мини-кейс за каждое';
  return `<button type="button" class="dps-missions ${ready ? 'ready' : ''}" data-dps="missions">
      <span class="dps-mis-art">${missionsArt(52)}</span>
      <span class="dps-mis-text"><b>ЕЖЕДНЕВНЫЕ ЗАДАНИЯ</b><small>${line}</small></span>
      <span class="dps-mis-go" aria-hidden="true">${UI_ICONS.next}</span>
      ${ready ? `<span class="badge-dot" aria-hidden="true">${ready > 9 ? '9+' : ready}</span>` : ''}
    </button>`;
}

function rowHTML(m: MissionView): string {
  const p = Math.min(m.target, m.progress);
  const pct = Math.round((p / m.target) * 100);
  const state = m.done ? (m.rewarded ? 'Кейс получен' : 'Выполнено') : `${p} / ${m.target}`;
  return `<li class="mis-row tier-${m.tier} ${m.done ? 'done' : ''}">
      <span class="mis-check" aria-hidden="true">${m.done ? UI_ICONS.check.replace('<svg', '<svg width="16" height="16"') : ''}</span>
      <span class="mis-body">
        <span class="mis-meta"><i class="mis-tier">${TIER[m.tier]}</i>${m.league ? '<i class="mis-tag">PRIME LEAGUE</i>' : ''}</span>
        <b class="mis-title">${esc(m.title)}</b>
        <span class="mis-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${m.target}" aria-valuenow="${p}" aria-label="${esc(m.title)}"><i style="transform:scaleX(${pct / 100})"></i></span>
      </span>
      <span class="mis-state">${state}</span>
    </li>`;
}

function bodyHTML(g: Game, s: MissionsStatus | null, note: string): string {
  const gate = g.missions.gate();
  const head = `<header class="mis-head">
      ${missionsArt(84, 'mis-head-art')}
      <div class="mis-head-text"><h2 id="mis-title">ЕЖЕДНЕВНЫЕ ЗАДАНИЯ</h2><p>Пять заданий на сегодня. За каждое выполненное — бесплатный ${esc(CASE_DEFS.mission.name)}.</p></div>
      <button type="button" class="mis-x" data-mis="close" aria-label="Закрыть">×</button>
    </header>`;
  if (gate !== 'ok') {
    const text = gate === 'guest' ? 'Ежедневные задания доступны с PRIME ID: войдите, и прогресс будет засчитываться на сервере.' : gate === 'unverified' ? 'Подтвердите почту PRIME ID — после этого появятся ежедневные задания.' : gate === 'off' ? 'Ежедневные задания появятся, когда PRIME NETWORK их включит.' : 'PRIME CLOUD подключается — задания появятся через пару секунд.';
    return `${head}<div class="mis-empty"><p>${text}</p></div>`;
  }
  if (!s) return `${head}<div class="mis-empty"><p>${g.missions.error ? 'Нет связи с PRIME NETWORK — задания не загрузились.' : '<span class="dps-spin"></span>Загружаем задания…'}</p>${g.missions.error ? '<button type="button" class="btn wide ghost" data-mis="retry">Повторить</button>' : ''}</div>`;
  const cs = casesStatus();
  const ready = cs?.mission.ready ?? s.cases.ready;
  const done = s.missions.filter((m) => m.done).length;
  const rewarded = s.missions.filter((m) => m.rewarded).length;
  const odds = cs && cs.mission.odds.length ? `<details class="mis-odds"><summary>Что может выпасть в мини-кейсе</summary>${oddsHTML(cs.mission.odds, cs, 'mission')}</details>` : '';
  return `${head}
    <div class="mis-sum"><span><b>${done}</b> из ${s.missions.length} выполнено</span><span>Обновятся через <b data-mis-timer>${clockText(s.resetsAt - Date.now())}</b></span></div>
    <ol class="mis-list">${s.missions.map(rowHTML).join('')}</ol>
    <div class="mis-cases ${ready ? 'ready' : ''}">
      <span class="mis-case-img">${caseImg('mission', 'mis-case')}</span>
      <span class="mis-case-text"><b>${esc(CASE_DEFS.mission.name)}</b><small>${ready ? `Ждёт открытия: <b>${ready}</b>` : rewarded ? `Получено сегодня: ${rewarded} из ${s.missions.length}` : 'Выполните задание — кейс появится здесь'}</small></span>
      <button type="button" class="btn teal" data-mis="open" ${ready ? '' : 'disabled'}>Открыть</button>
    </div>
    ${odds}
    <p class="mis-foot">Засчитываются только бои, доведённые до конца: выход из боя не считается. Бои карьеры засчитывает сервер PRIME NETWORK, бои PRIME LEAGUE — его собственный повтор боя. Задания меняются каждый день в 00:00 по Москве.</p>
    ${note ? `<div class="dps-note" role="alert">${esc(note)}</div>` : ''}
    <button type="button" class="btn wide ghost mis-back" data-mis="back">Назад к ежедневному эфиру</button>`;
}

/** The missions window. `back` reopens the window it came from (the daily window). */
export function openMissions(g: Game, back?: () => void): void {
  let note = '';
  let offM: (() => void) | null = null;
  let offC: (() => void) | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const cleanup = () => {
    offM?.();
    offC?.();
    offM = offC = null;
    if (timer) clearInterval(timer);
    timer = null;
    document.removeEventListener('keydown', onKey);
  };
  const close = () => {
    g.ui.closeModal();
    cleanup();
  };
  g.ui.modal(`<div class="mis" role="dialog" aria-modal="true" aria-labelledby="mis-title"></div>`, (root) => {
    const modal = root.querySelector('.modal') as HTMLElement;
    modal.classList.add('mis-modal');
    const host = modal.querySelector('.mis') as HTMLElement;
    const gone = () => {
      if (root.isConnected) return false;
      cleanup();
      return true;
    };
    const render = () => {
      if (gone()) return;
      host.innerHTML = bodyHTML(g, g.missions.status, note);
    };
    timer = setInterval(() => {
      if (gone()) return;
      const s = g.missions.status;
      const el = host.querySelector('[data-mis-timer]') as HTMLElement | null;
      if (!s || !el) return;
      const left = s.resetsAt - Date.now();
      el.textContent = clockText(left);
      // the day turned while the window is open: the server's new five
      if (left <= 0) void g.missions.refresh(true);
    }, 1000);
    document.addEventListener('keydown', onKey);
    offM = g.missions.onChange(render);
    offC = onCases(render);
    root.addEventListener('click', (e) => {
      if (e.target === root) return void setTimeout(gone, 0);
      const t = (e.target as HTMLElement).closest('[data-mis]') as HTMLElement | null;
      if (!t) return;
      const act = t.dataset.mis;
      if (act === 'close') {
        g.audio.ui('click');
        close();
      } else if (act === 'back') {
        g.audio.ui('click');
        close();
        back?.();
      } else if (act === 'retry') {
        g.audio.ui('click');
        note = '';
        void g.missions.refresh(true);
      } else if (act === 'open') {
        openCaseShow(g, 'mission', () => {
          void g.missions.refresh(true);
          render();
        });
      }
    });
    render();
    void g.missions.flush().then(() => g.missions.refresh(true));
    void refreshCases(g).then(() => render());
  });
}
