import type { Game } from '../game/Game';
import { lang } from '../i18n/lang';
import type { LeaguePlayer, LeaguePlayerRank } from '../net/LeagueApi';
import { PrimeApiError } from '../net/PrimeApi';
import { esc } from './dom';
import { rankEmblem } from './leagueArt';
import { producerSVG } from './producerArt';
import { leagueTitleArt } from './rewardArt';

// Beta 2.6 — PLAYER MINI PROFILE: a participant's public league card, opened from the PRIME LEAGUE leaderboard
// (GET /api/prime/league/player by the row's public key). Everything shown is the server's answer of public league
// facts — rank, RP, the season's record, the peak and best rank, the defence's record, titles reached, past seasons;
// a field the server does not give is simply left out. No separate page: a compact window, quick to open and close.

const tr = (ru: string, en: string) => (lang() === 'en' ? en : ru);
const DEFAULT_LOOK = { avatar: 'portrait_01', frame: 'studio', backdrop: 'violet' } as const;

function rankLine(r: LeaguePlayerRank, size: number): string {
  return `<span class="pc-rank" style="--rk:${r.color}">${rankEmblem(r.index, r.division, size)}<b>${esc(lang() === 'en' ? r.en : r.ru)}${r.division ? ` ${esc(r.division)}` : ''}</b></span>`;
}

function cardHTML(p: LeaguePlayer, own: boolean, g: Game): string {
  const look = own ? g.producer.shown() : (p.look ?? DEFAULT_LOOK);
  const record = p.current && p.games > 0;
  const stat = (k: string, v: string, cls = '') => `<div class="pc-stat ${cls}"><b>${v}</b><span>${k}</span></div>`;
  const titles = p.titles.length
    ? `<div class="pc-sec"><div class="pc-k">${tr('ТИТУЛЫ СЕЗОНА', 'SEASON TITLES')}</div><div class="pc-titles">${p.titles
        .slice(-4)
        .map((t) => `<span class="pc-title">${leagueTitleArt(t, 26) ?? ''}<i>${esc(t)}</i></span>`)
        .join('')}${p.emblem ? `<span class="pc-title em"><i>${tr('ЭМБЛЕМА СЕЗОНА', 'SEASON EMBLEM')}</i></span>` : ''}</div></div>`
    : '';
  const seasons = p.seasons.length
    ? `<div class="pc-sec"><div class="pc-k">${tr('ПРОШЛЫЕ СЕЗОНЫ', 'PAST SEASONS')}</div><ul class="pc-seasons">${p.seasons
        .map((s) => `<li><span>${tr('Сезон', 'Season')} ${s.season}</span>${rankLine(s.rank, 18)}<small>${s.wins}/${s.games}</small></li>`)
        .join('')}</ul></div>`
    : '';
  return `<header class="pc-head">
      <span class="pc-ava">${producerSVG(look, 64)}</span>
      <div class="pc-id"><h2 id="pc-title">${esc(p.name)}${own ? `<i class="pc-me">${tr('ЭТО ВЫ', 'YOU')}</i>` : ''}</h2>${rankLine(p.rank, 28)}<small>${p.rp} RP${p.place ? ` · ${tr('место', 'place')} ${p.place}` : ''} · ${tr('сезон', 'season')} ${p.season}</small></div>
      <button type="button" class="pc-x" data-pc="close" aria-label="${tr('Закрыть', 'Close')}">×</button>
    </header>
    ${
      record
        ? `<div class="pc-stats">${stat(tr('победы', 'wins'), String(p.wins), 'w')}${stat(tr('поражения', 'losses'), String(p.losses), 'l')}${p.draws ? stat(tr('ничьи', 'draws'), String(p.draws)) : ''}${stat(tr('побед', 'win rate'), p.winRate === null ? '—' : `${p.winRate}%`, 'r')}</div>`
        : `<p class="pc-none">${tr('В этом сезоне ещё нет рейтинговых боёв.', 'No ranked fights this season yet.')}</p>`
    }
    <div class="pc-sec pc-ranks">${p.peak ? `<div><div class="pc-k">${tr('ПИК СЕЗОНА', 'SEASON PEAK')}</div>${rankLine(p.peak, 20)}</div>` : ''}${p.best ? `<div><div class="pc-k">${tr('ЛУЧШИЙ РАНГ', 'BEST RANK')}</div>${rankLine(p.best, 20)}</div>` : ''}<div><div class="pc-k">${tr('ЗАЩИТА', 'DEFENCE')}</div><b class="pc-def">${p.defense.wins}–${p.defense.losses}</b></div></div>
    ${titles}
    ${seasons}`;
}

/**
 * Opens the card of the participant with public key `id` (a leaderboard row). `fallback` — the row's own name, shown
 * while the card loads. Errors (offline, a key that no longer exists after a reset) are said in the window.
 */
export function openPlayerCard(g: Game, id: string, fallback: string): void {
  const api = g.league.api();
  let alive = true;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    if (!alive) return;
    alive = false;
    document.removeEventListener('keydown', onKey);
    g.ui.closeModal();
  };
  g.ui.modal(`<div class="pc" role="dialog" aria-modal="true" aria-labelledby="pc-title"><header class="pc-head"><div class="pc-id"><h2 id="pc-title">${esc(fallback)}</h2><small>${tr('Загружаем профиль…', 'Loading the profile…')}</small></div><button type="button" class="pc-x" data-pc="close" aria-label="${tr('Закрыть', 'Close')}">×</button></header></div>`, (root) => {
    const modal = root.querySelector('.modal') as HTMLElement;
    modal.classList.add('pc-modal');
    const host = modal.querySelector('.pc') as HTMLElement;
    document.addEventListener('keydown', onKey);
    const load = () => {
      if (!api) {
        host.innerHTML += `<p class="pc-none">${tr('PRIME LEAGUE недоступна.', 'PRIME LEAGUE is unavailable.')}</p>`;
        return;
      }
      api
        .player(id)
        .then((p) => {
          if (!alive || !root.isConnected) return;
          host.innerHTML = cardHTML(p, p.me, g);
        })
        .catch((e) => {
          if (!alive || !root.isConnected) return;
          const gone = e instanceof PrimeApiError && (e.code === 'player_not_found' || e.status === 404);
          const busy = e instanceof PrimeApiError && e.status === 429;
          host.innerHTML = `<header class="pc-head"><div class="pc-id"><h2 id="pc-title">${esc(fallback)}</h2></div><button type="button" class="pc-x" data-pc="close" aria-label="${tr('Закрыть', 'Close')}">×</button></header>
            <p class="pc-none">${gone ? tr('Этого участника больше нет в таблице сезона — обновите рейтинг.', 'This participant is no longer in the season table — refresh the leaderboard.') : busy ? tr('Слишком много запросов — попробуйте через минуту.', 'Too many requests — try again in a minute.') : tr('Нет связи с PRIME NETWORK — профиль не загрузился.', 'No connection to PRIME NETWORK — the profile did not load.')}</p>
            ${gone ? '' : `<button type="button" class="btn wide ghost" data-pc="retry">${tr('Повторить', 'Retry')}</button>`}`;
        });
    };
    root.addEventListener('click', (e) => {
      if (e.target === root) return close();
      const t = (e.target as HTMLElement).closest('[data-pc]') as HTMLElement | null;
      if (!t) return;
      if (t.dataset.pc === 'close') {
        g.audio.ui('click');
        close();
      } else if (t.dataset.pc === 'retry') {
        g.audio.ui('click');
        load();
      }
    });
    load();
  });
}
