import { PRODUCER_AVATARS, PRODUCER_BACKDROPS, PRODUCER_FRAMES, type ProducerLook } from '../config/producer.config';
import type { Game } from '../game/Game';
import { lang } from '../i18n/lang';
import { esc } from './dom';
import { producerSVG } from './producerArt';

// Alpha 1.9.0 — СТУДИЯ ПРОДЮСЕРА: the producer's look (avatar, frame, backdrop) with a live preview. SAVE writes to the
// server (one request at a time, with the revision it was based on); CANCEL closes without changing anything. A guest
// sees what it is and how to keep it (a PRIME ID) — no fake profile is created.

const tr = (ru: string, en: string) => (lang() === 'en' ? en : ru);
const nm = (x: { ru: string; en: string }) => (lang() === 'en' ? x.en : x.ru);

export function openProducerStudio(g: Game): void {
  const pr = g.producer;
  const av = g.account?.view();
  const nick = av && (av.kind === 'account' || av.kind === 'not-loaded' || av.kind === 'unverified') ? av.nickname : '';
  const pick3 = (l: ProducerLook): ProducerLook => ({ avatar: l.avatar, frame: l.frame, backdrop: l.backdrop });
  let draft: ProducerLook = pick3(pr.shown());
  let msg = '';
  let msgKind: 'ok' | 'err' | '' = '';
  const free = <T extends { access: string }>(l: T[]) => l.filter((x) => x.access === 'free');

  const html = () => {
    const can = pr.canSave();
    const dirty = JSON.stringify(draft) !== JSON.stringify(pick3(pr.shown()));
    const ava = free(PRODUCER_AVATARS)
      .map((a) => `<button class="ps-pick ${draft.avatar === a.id ? 'on' : ''}" data-k="avatar" data-v="${a.id}" aria-pressed="${draft.avatar === a.id}" aria-label="${esc(nm(a))}" title="${esc(nm(a))}">${producerSVG({ avatar: a.id, frame: 'studio', backdrop: draft.backdrop }, 64)}</button>`)
      .join('');
    const frames = free(PRODUCER_FRAMES)
      .map((f) => `<button class="ps-pick sm ${draft.frame === f.id ? 'on' : ''}" data-k="frame" data-v="${f.id}" aria-pressed="${draft.frame === f.id}">${producerSVG({ ...draft, frame: f.id }, 52)}<span>${esc(nm(f))}</span></button>`)
      .join('');
    const backs = free(PRODUCER_BACKDROPS)
      .map((b) => `<button class="ps-pick sm ${draft.backdrop === b.id ? 'on' : ''}" data-k="backdrop" data-v="${b.id}" aria-pressed="${draft.backdrop === b.id}">${producerSVG({ ...draft, backdrop: b.id }, 52)}<span>${esc(nm(b))}</span></button>`)
      .join('');
    const cur = PRODUCER_AVATARS.find((a) => a.id === draft.avatar);
    return `<div class="ps">
      <div class="ps-head"><span class="ps-k">PRIME ID</span><div class="h1">${tr('Студия продюсера', 'Producer Studio')}</div></div>
      <div class="ps-preview">${producerSVG(draft, 132, 'ps-big')}<div class="ps-who"><b>${esc(nick || tr('ГОСТЬ', 'GUEST'))}</b><span>${cur ? esc(nm(cur)) : ''}</span><small>${tr('Так вас видят в PRIME LEAGUE: в таблице, на афише и в итогах.', 'This is how PRIME LEAGUE shows you: the table, the bill and the results.')}</small></div></div>
      ${can ? '' : `<p class="ps-note">${pr.canSave() ? '' : tr('Войдите в PRIME ID и подтвердите email, чтобы сохранить образ — он будет одинаковым на всех устройствах.', 'Sign in to PRIME ID and confirm your email to keep your look — the same on every device.')}</p>`}
      <div class="ps-k">${tr('АВАТАР', 'AVATAR')}</div><div class="ps-grid">${ava}</div>
      <div class="ps-k">${tr('РАМКА', 'FRAME')}</div><div class="ps-row">${frames}</div>
      <div class="ps-k">${tr('ФОН', 'BACKDROP')}</div><div class="ps-row">${backs}</div>
      <small class="ps-fine">${tr('Образ — только внешний вид продюсера: он не влияет на бои, RP, награды и покупки. Любимый боец в профиле остаётся отдельно.', 'The look is the producer’s appearance only: it never affects fights, RP, rewards or purchases. Your favourite fighter stays separate.')}</small>
      ${msg ? `<div class="ps-msg ${msgKind}" role="status">${esc(msg)}</div>` : ''}
      <div class="modal-actions ps-actions"><button class="btn ghost" data-a="cancel">${tr('Отмена', 'Cancel')}</button><button class="btn teal" data-a="save" ${can && dirty && !pr.saving ? '' : 'disabled'}>${pr.saving ? tr('Сохраняем…', 'Saving…') : tr('Сохранить', 'Save')}</button></div>
    </div>`;
  };

  g.ui.modal(html(), (root, close) => {
    const panel = root.querySelector('.modal') as HTMLElement;
    // Esc closes like «Отмена» (keyboard players); the listener leaves with the window, however it was closed
    const onKey = (e: KeyboardEvent) => {
      if (!root.isConnected) return document.removeEventListener('keydown', onKey);
      if (e.key !== 'Escape' || pr.saving) return;
      document.removeEventListener('keydown', onKey);
      close();
    };
    document.addEventListener('keydown', onKey);
    const paint = () => {
      const y = (panel.querySelector('.ps') as HTMLElement | null)?.scrollTop ?? 0;
      panel.innerHTML = html();
      const ps = panel.querySelector('.ps') as HTMLElement | null;
      if (ps) ps.scrollTop = y;
    };
    panel.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      const pick = t.closest('[data-k]') as HTMLElement | null;
      if (pick) {
        draft = { ...draft, [pick.dataset.k as keyof ProducerLook]: pick.dataset.v! };
        msg = '';
        g.audio.ui('click');
        paint();
        (panel.querySelector(`[data-k="${pick.dataset.k}"][data-v="${pick.dataset.v}"]`) as HTMLElement | null)?.focus();
        return;
      }
      const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset.a;
      if (a === 'cancel') {
        close();
        return;
      }
      if (a === 'save') {
        paint();
        const r = await pr.save(draft);
        if (r === 'ok') {
          g.audio.ui('confirm');
          g.ui.toast(tr('Образ продюсера сохранён', 'Producer look saved'));
          close();
          return;
        }
        if (r === 'changed') {
          draft = pick3(pr.shown());
          msg = tr('Образ уже изменили в другой вкладке — показан сохранённый вариант. Выберите снова, если нужно.', 'The look was changed in another tab — the saved one is shown. Pick again if needed.');
        } else msg = r === 'too_many_changes' ? tr('Слишком много изменений подряд — попробуйте через несколько минут.', 'Too many changes in a row — try again in a few minutes.') : r === 'network' || r === 'timeout' ? tr('Нет связи с PRIME NETWORK. Выбор не потерян — нажмите «Сохранить» ещё раз.', 'No connection to PRIME NETWORK. Your choice is kept — press Save again.') : tr('Сервер не принял образ', 'The server refused the look') + ` (${r}).`;
        msgKind = 'err';
        paint();
      }
    });
  });
}
