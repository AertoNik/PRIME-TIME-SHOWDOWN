import type { Game } from '../game/Game';
import { PrimeApiError, type ReferralStatus } from '../net/PrimeApi';
import { esc } from './dom';
import { UI_ICONS } from './icons';

// Beta 2.2 — «ПРИГЛАСИТЬ ДРУГА»: the window over the menu. Everything it shows comes from the PRIME NETWORK server
// (lib/referral.js): the account's code, who invited it, the play time the SERVER verified since the link (PRIME LEAGUE
// fights it replayed — never a timer of this page), «Приглашение подтверждено» once there are 60 minutes, and how many
// the player invited. No reward is promised or given in Beta 2.2 — only the server's neutral notice.

/** «AB2CDE7K» → «PT-AB2C-DE7K» (what a player reads, copies and types; the server reads it either way). */
export function formatReferralCode(code: string): string {
  return code.length === 8 ? `PT-${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Whole minutes of verified play, never rounded up past what the server counted (3599 s → 59 мин). */
export function referralMinutes(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 60);
}

const ERRORS: Record<string, string> = {
  code_format: 'Это не похоже на код приглашения: 8 букв и цифр, например PT-AB2C-DE7K.',
  code_unknown: 'Такого кода нет. Проверьте, как он написан.',
  own_code: 'Это ваш собственный код — его вводит друг.',
  already_linked: 'Вас уже пригласил друг: пригласивший у PRIME ID может быть только один.',
  mutual: 'Этого игрока пригласили вы — пригласить друг друга нельзя.',
  not_verified: 'Подтвердите почту PRIME ID — после этого можно приглашать друзей.',
  terms_required: 'Примите обновлённые документы PRIME ID — и можно продолжить.',
  referral_disabled: 'Приглашения сейчас выключены на сервере.',
};

function errorText(e: unknown): string {
  if (e instanceof PrimeApiError) {
    if (e.code === 'too_many_attempts') {
      const s = Number((e.data as { retryAfter?: number } | undefined)?.retryAfter ?? 0);
      const min = Math.max(1, Math.ceil(s / 60));
      return `Слишком много неверных кодов подряд. Попробуйте через ${min} мин.`;
    }
    if (ERRORS[e.code]) return ERRORS[e.code];
  }
  return 'Не удалось связаться с PRIME NETWORK. Проверьте интернет и попробуйте ещё раз.';
}

function invitationHTML(st: ReferralStatus): string {
  const inv = st.invitedBy;
  if (!inv) {
    return `<section class="ref-card">
        <h3>У меня есть код друга</h3>
        <p class="muted">Введите код, которым с вами поделились. Пригласивший у PRIME ID может быть только один, и изменить его потом нельзя.</p>
        <form class="ref-form" data-ref-form>
          <input class="ref-input" name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="14" placeholder="PT-XXXX-XXXX" aria-label="Код приглашения друга" />
          <button class="btn teal" type="submit" data-ref-claim>Активировать</button>
        </form>
        <p class="ref-msg" data-ref-msg role="status" aria-live="polite"></p>
      </section>`;
  }
  const mins = referralMinutes(inv.seconds);
  const need = Math.round(inv.required / 60);
  const pct = Math.min(100, Math.floor((inv.seconds / Math.max(1, inv.required)) * 100));
  return `<section class="ref-card ${inv.qualified ? 'done' : ''}">
      <h3>Вас пригласил ${esc(inv.nickname || 'друг')}</h3>
      ${
        inv.qualified
          ? `<p class="ref-ok">${UI_ICONS.check} Приглашение подтверждено</p>`
          : `<div class="ref-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${need}" aria-valuenow="${mins}" aria-label="Подтверждённая игра"><i style="width:${pct}%"></i></div>
             <p class="ref-progress">Подтверждённая игра: <b>${mins}</b> из ${need} мин</p>`
      }
      <p class="muted ref-how">Засчитываются бои PRIME LEAGUE после привязки кода, проверенные сервером: доведённые до конца, с сыгранными картами. Открытая вкладка, простой и бои карьеры пока не засчитываются — их сервер не проверяет.</p>
    </section>`;
}

function bodyHTML(st: ReferralStatus): string {
  const code = formatReferralCode(st.code);
  return `<section class="ref-card ref-mine">
      <h3>Ваш код</h3>
      <div class="ref-code-row"><output class="ref-code" data-ref-code aria-label="Ваш код приглашения">${esc(code)}</output><button class="btn ghost ref-copy" data-ref-copy>Скопировать</button></div>
      <p class="muted">Друг вводит этот код в своём PRIME ID: «Пригласить друга» → «У меня есть код друга». Приглашение подтверждается, когда друг наберёт ${Math.round(st.required / 60)} минут игры, подтверждённой сервером.</p>
      <p class="ref-stats">Приглашено: <b>${st.invited.total}</b> · подтверждено: <b>${st.invited.confirmed}</b></p>
    </section>
    ${invitationHTML(st)}
    <p class="ref-notice">${esc(st.notice || 'Награды за приглашения появятся в будущих обновлениях.')}</p>`;
}

export function openReferral(g: Game): void {
  const r = g.account;
  let alive = true;
  g.ui.modal(
    `<div class="ref" role="dialog" aria-modal="true" aria-labelledby="ref-title">
      <div class="ref-head"><span class="ref-ico" aria-hidden="true">${UI_ICONS.invite}</span><h2 id="ref-title">Пригласить друга</h2></div>
      <div class="ref-body" data-ref-body><p class="muted">Загрузка…</p></div>
      <div class="modal-actions"><button class="btn ghost wide" data-ref-close>Закрыть</button></div>
    </div>`,
    (root, close) => {
      const body = root.querySelector('[data-ref-body]') as HTMLElement;
      root.querySelector('[data-ref-close]')?.addEventListener('click', () => {
        alive = false;
        close();
      });
      const api = r?.api;
      // a guest: the invitation lives in a PRIME ID
      if (!api || !api.sessionRecord) {
        body.innerHTML = `<p class="muted">Приглашать друзей и принимать приглашения можно с PRIME ID — код и прогресс хранит сервер, на любом устройстве.</p>
          <button class="btn teal wide" data-ref-signin>Войти в PRIME ID</button>
          <p class="ref-notice">Награды за приглашения появятся в будущих обновлениях.</p>`;
        body.querySelector('[data-ref-signin]')?.addEventListener('click', () => {
          alive = false;
          close();
          g.goto('profile');
        });
        return;
      }
      const load = async () => {
        body.innerHTML = '<p class="muted">Загрузка…</p>';
        try {
          const st = await api.referralStatus();
          if (!alive) return;
          paint(st);
        } catch (e) {
          if (!alive) return;
          body.innerHTML = `<p class="ref-err">${esc(errorText(e))}</p><button class="btn ghost wide" data-ref-retry>Попробовать ещё раз</button>`;
          body.querySelector('[data-ref-retry]')?.addEventListener('click', () => void load());
        }
      };
      const paint = (st: ReferralStatus) => {
        body.innerHTML = bodyHTML(st);
        body.querySelector('[data-ref-copy]')?.addEventListener('click', async () => {
          const text = formatReferralCode(st.code);
          try {
            await navigator.clipboard.writeText(text);
            g.ui.toast('Код скопирован');
          } catch {
            // no clipboard permission (an older Safari, an iframe): select the code so the player copies it himself
            const out = body.querySelector('[data-ref-code]') as HTMLElement | null;
            if (out) {
              const range = document.createRange();
              range.selectNodeContents(out);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(range);
            }
            g.ui.toast('Выделите код и скопируйте его');
          }
        });
        const form = body.querySelector('[data-ref-form]') as HTMLFormElement | null;
        form?.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const input = form.querySelector('input') as HTMLInputElement;
          const msg = body.querySelector('[data-ref-msg]') as HTMLElement;
          const btn = form.querySelector('[data-ref-claim]') as HTMLButtonElement;
          const code = input.value.trim();
          if (!code) {
            msg.textContent = 'Введите код друга.';
            return;
          }
          btn.disabled = true;
          msg.textContent = 'Проверяем код…';
          try {
            await api.referralClaim(code);
            if (!alive) return;
            g.ui.toast('Код друга активирован');
            await load();
          } catch (e) {
            if (!alive) return;
            msg.textContent = errorText(e);
            btn.disabled = false;
          }
        });
      };
      void load();
    },
  );
}
