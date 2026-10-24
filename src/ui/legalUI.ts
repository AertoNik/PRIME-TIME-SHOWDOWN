import { DEMO_OFFER, DEMO_OFFER_TEXT, TEST_OFFER, TEST_OFFER_TEXT, offerDate, type OfferRevision } from '../config/offer.config';
import type { Game } from '../game/Game';
import { lang, setLang, tr, type Lang } from '../i18n/lang';
import { DEFAULT_AGE, ageDecision, countryOptions, needsCountry } from '../net/ageRules';
import { CONTACT_EMAIL, LEGAL_DOCS, LEGAL_TITLE, legalPath, type LegalDocId } from '../net/legal';
import { sha256 } from '../net/sha256';
import { esc } from './dom';

// Alpha 1.8.4 — the legal side of PRIME ID, kept small: compact links, a document opened ON TOP of the
// current window (the form underneath keeps everything typed), the age question, the window that asks
// an existing account to accept the documents once, and «Мои данные» (download, delete).
// The texts themselves are the static pages of the site (public/legal/…) — one source for the site and
// the game.

const code = (e: unknown) => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : '');
const status = (e: unknown) => (e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : 0);
const kind = (e: unknown) => (e && typeof e === 'object' && typeof (e as { kind?: unknown }).kind === 'string' ? (e as { kind: string }).kind : '');

// ------------------------------------------------------------ document sheet
const DOC_RE = /(?:^|\/)(?:(ru|en)\/)?(terms|privacy|consent|parents)\.html(#.*)?$/;

/**
 * Open a document over whatever is on screen (inside the open window, if there is one — closing the
 * document returns to it unchanged). Scrolls on its own; closes with ×, «Закрыть», Esc or a tap outside.
 */
export function openLegalDoc(g: Game, doc: LegalDocId, docLang: Lang = lang()): void {
  const { sheet, close } = mountSheet(g);
  let current: { doc: LegalDocId; lang: Lang } = { doc, lang: docLang };
  const render = () => {
    const { doc: d, lang: l } = current;
    const title = LEGAL_TITLE[d][l];
    sheet.innerHTML = `<div class="legal-card panel">
        <div class="legal-top">
          <b id="legal-title">${esc(title)}</b>
          <span class="legal-lang">${(['ru', 'en'] as const).map((x) => `<button type="button" data-lang="${x}" class="${x === l ? 'on' : ''}" aria-pressed="${x === l}">${x.toUpperCase()}</button>`).join('')}</span>
          <button type="button" class="legal-x" data-close aria-label="${l === 'en' ? 'Close' : 'Закрыть'}">×</button>
        </div>
        <div class="legal-body" tabindex="0"><p class="muted">${l === 'en' ? 'Loading…' : 'Загрузка…'}</p></div>
        <div class="legal-foot">
          <a href="${legalPath(l, d)}" target="_blank" rel="noopener">${l === 'en' ? 'Open as a separate page' : 'Открыть отдельной страницей'}</a>
          <button type="button" class="btn wide" data-close>${l === 'en' ? 'Close' : 'Закрыть'}</button>
        </div>
      </div>`;
    sheet.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', close));
    sheet.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) =>
      b.addEventListener('click', () => {
        current = { doc: current.doc, lang: b.dataset.lang as Lang };
        render();
      }),
    );
    const body = sheet.querySelector('.legal-body') as HTMLElement;
    void loadDoc(l, d).then((main) => {
      if (!sheet.isConnected || current.doc !== d || current.lang !== l) return;
      body.innerHTML = '';
      if (!main) {
        body.innerHTML = `<p>${l === 'en' ? 'The document could not be loaded. Open it as a separate page (link below) or check the connection.' : 'Не удалось загрузить документ. Откройте его отдельной страницей (ссылка ниже) или проверьте соединение.'}</p>`;
        return;
      }
      body.appendChild(main);
      body.scrollTop = 0;
    });
    (sheet.querySelector('.legal-x') as HTMLElement).focus({ preventScroll: true });
  };
  // links between the documents stay inside the sheet; e-mail and other sites open as usual
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return close();
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a || !a.closest('.legal-body')) return;
    const href = a.getAttribute('href') ?? '';
    const m = DOC_RE.exec(href);
    if (m) {
      e.preventDefault();
      current = { doc: m[2] as LegalDocId, lang: (m[1] as Lang | undefined) ?? current.lang };
      render();
    } else if (/^https?:/.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener';
    }
  });
  render();
}

/** The empty sheet over the screen (one at a time): Esc and × close it, focus goes back to what opened it. */
function mountSheet(g: Game): { sheet: HTMLElement; close: () => void } {
  const host = (g.ui.root.querySelector('.modal-root') as HTMLElement | null) ?? g.ui.root;
  host.querySelector('.legal-sheet')?.remove();
  const opener = document.activeElement as HTMLElement | null;
  const sheet = document.createElement('div');
  sheet.className = 'legal-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'legal-title');
  host.appendChild(sheet);
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    sheet.remove();
    opener?.focus?.({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && sheet.isConnected) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  return { sheet, close };
}

// ------------------------------------------------------------ PRIME CHECKOUT: the terms before paying
const SITE = 'https://primetimeshowdown.online/';
/** The offer's page on this very site (works the same on the official domain, a preview and localhost). */
const offerPage = (url: string) => (url.startsWith(SITE) ? './' + url.slice(SITE.length) : url);
/** The stand-in terms of Robokassa's test mode, carried by the build (no page): TEST (staging) and DEMO. */
const STAND_IN = new Map<number, string>([
  [TEST_OFFER.revision, TEST_OFFER_TEXT],
  [DEMO_OFFER.revision, DEMO_OFFER_TEXT],
]);

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  // crypto.subtle exists only on secure pages (https, localhost); the build's own SHA-256 elsewhere
  if (globalThis.crypto?.subtle) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256(new TextDecoder().decode(bytes));
}

/**
 * 1.8.8: the terms a PRIME CHECKOUT consent is about, read in place (phones included), over the same purchase window:
 * the public offer — its page, checked against the revision's SHA-256, so the text shown is exactly the one the
 * server records — or, in Robokassa's test mode (staging, the demonstration), the stand-in terms the build carries
 * (also checked against the server's SHA-256). Closing returns to the same purchase; nothing here ticks the consent.
 */
export function openOfferDoc(g: Game, o: OfferRevision): void {
  const { sheet, close } = mountSheet(g);
  const page = o.url ? offerPage(o.url) : '';
  sheet.innerHTML = `<div class="legal-card panel">
      <div class="legal-top">
        <b id="legal-title">${esc(o.title)}</b>
        <button type="button" class="legal-x" data-close aria-label="Закрыть">×</button>
      </div>
      <div class="legal-body" tabindex="0"><p class="muted">Загрузка…</p></div>
      <div class="legal-foot">
        ${page ? `<a href="${esc(page)}" target="_blank" rel="noopener">Открыть отдельной страницей</a>` : ''}
        <button type="button" class="btn wide" data-close>Закрыть</button>
      </div>
    </div>`;
  sheet.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', close));
  const body = sheet.querySelector('.legal-body') as HTMLElement;
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) return close();
    const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
    if (!a || !a.closest('.legal-body')) return;
    const href = a.getAttribute('href') ?? '';
    // within the offer: its own sections; the PRIME ID documents open in the same kind of sheet
    if (href.startsWith('#')) {
      e.preventDefault();
      (body.querySelector(`[id="${CSS.escape(href.slice(1))}"]`) as HTMLElement | null)?.scrollIntoView({ block: 'start' });
      return;
    }
    const m = DOC_RE.exec(href);
    if (m) {
      e.preventDefault();
      openLegalDoc(g, m[2] as LegalDocId, (m[1] as Lang | undefined) ?? 'ru');
    } else if (!/^mailto:/.test(href)) {
      a.href = new URL(href, new URL(page || './', location.href)).href;
      a.target = '_blank';
      a.rel = 'noopener';
    }
  });
  const meta = `Редакция ${o.revision} · действует с ${esc(offerDate(o))}`;
  void loadOffer(o, page).then((r) => {
    if (!sheet.isConnected) return;
    body.innerHTML = '';
    if (r === 'stale') {
      body.innerHTML = `<p>Текст условий в игре не совпадает с редакцией ${o.revision}, которую записывает сервер. Обновите страницу игры и откройте условия снова — до этого не подтверждайте согласие.</p>`;
    } else if (r === 'offline') {
      body.innerHTML = `<p>Не удалось загрузить условия. Проверьте соединение${page ? ' или откройте их отдельной страницей (ссылка ниже)' : ' и попробуйте ещё раз'}.</p>`;
    } else {
      r.insertAdjacentHTML('beforeend', `<p class="doc-meta">Это полный текст редакции ${o.revision}: именно её сервер записывает, когда вы отмечаете согласие.</p>`);
      if (!o.url) r.insertAdjacentHTML('afterbegin', `<h1>${esc(o.title)}</h1><p class="doc-meta">${meta}</p>`);
      body.appendChild(r);
    }
    body.scrollTop = 0;
  });
  (sheet.querySelector('.legal-x') as HTMLElement).focus({ preventScroll: true });
}

/** The terms' text as a cleaned document — or why it is not shown (never a text other than the revision's). */
async function loadOffer(o: OfferRevision, page: string): Promise<HTMLElement | 'stale' | 'offline'> {
  if (!o.url) {
    const text = STAND_IN.get(o.revision);
    if (text === undefined || sha256(text) !== o.sha256) return 'stale';
    const out = document.createElement('div');
    out.className = 'legal-doc';
    out.innerHTML = `<p>${esc(text)}</p>`;
    return out;
  }
  try {
    const r = await fetch(page, { cache: 'no-cache', credentials: 'omit' });
    if (!r.ok) return 'offline';
    const bytes = await r.arrayBuffer();
    if ((await sha256Hex(bytes)) !== o.sha256) return 'stale';
    return cleanMain(new TextDecoder().decode(bytes)) ?? 'offline';
  } catch {
    return 'offline';
  }
}

const cache = new Map<string, string>();

/** A PRIME ID document's <main>, cleaned. */
async function loadDoc(l: Lang, d: LegalDocId): Promise<HTMLElement | null> {
  const url = legalPath(l, d);
  try {
    let html = cache.get(url);
    if (!html) {
      const r = await fetch(url, { cache: 'no-cache', credentials: 'omit' });
      if (!r.ok) return null;
      html = await r.text();
      cache.set(url, html);
    }
    return cleanMain(html);
  } catch {
    return null;
  }
}

/** The <main> of a document page, cleaned (the pages are ours, but nothing active is ever taken over). */
function cleanMain(html: string): HTMLElement | null {
  const main = new DOMParser().parseFromString(html, 'text/html').querySelector('main');
  if (!main) return null;
  main.querySelectorAll('script,iframe,object,embed,style,link,form,nav.doc-nav').forEach((n) => n.remove());
  main.querySelectorAll('*').forEach((n) => {
    for (const at of Array.from(n.attributes)) if (/^on/i.test(at.name) || (at.name === 'href' && /^\s*javascript:/i.test(at.value))) n.removeAttribute(at.name);
  });
  const out = document.createElement('div');
  out.className = 'legal-doc';
  out.innerHTML = main.innerHTML;
  return out;
}

/** The compact row of documents (+ the language) for PRIME ID — every element carries data-acc. */
export function legalLinksHTML(): string {
  const l = lang();
  const short: Record<LegalDocId, [string, string]> = {
    terms: ['Соглашение', 'Terms'],
    privacy: ['Конфиденциальность', 'Privacy'],
    consent: ['Согласие', 'Consent'],
    parents: ['Родителям', 'Parents'],
  };
  const links = LEGAL_DOCS.map((d) => `<button type="button" data-acc="doc:${d}">${l === 'en' ? short[d][1] : short[d][0]}</button>`).join('<i>·</i>');
  const langs = (['ru', 'en'] as const).map((x) => `<button type="button" data-acc="lang:${x}" class="${x === l ? 'on' : ''}" aria-pressed="${x === l}">${x.toUpperCase()}</button>`).join('');
  return `<nav class="legal-links" aria-label="${l === 'en' ? 'Documents' : 'Документы'}">${links}<span class="legal-lang">${langs}</span></nav>
    <p class="legal-contact">${l === 'en' ? 'Questions about your data' : 'Вопросы о данных'}: <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a></p>`;
}

/** PRIME ID: «doc:terms», «lang:en» (see accountAction). */
export function legalAction(g: Game, act: string): boolean {
  if (act.startsWith('doc:')) {
    const d = act.slice(4) as LegalDocId;
    if ((LEGAL_DOCS as readonly string[]).includes(d)) openLegalDoc(g, d);
    return true;
  }
  if (act === 'lang:ru' || act === 'lang:en') {
    setLang(act.slice(5) as Lang);
    g.account?.refreshView();
    return true;
  }
  return false;
}

// ----------------------------------------------------------------- age question
/** Under 13 answered: the question is not offered again on this device for a day (no «try another age»). */
const AGE_LOCK_KEY = 'primetime-showdown-agegate-v1';
const AGE_LOCK_MS = 24 * 3600 * 1000;

export function ageLocked(): boolean {
  try {
    const t = Number(localStorage.getItem(AGE_LOCK_KEY) || 0);
    return t > Date.now();
  } catch {
    return false;
  }
}

export function lockAge(): void {
  try {
    localStorage.setItem(AGE_LOCK_KEY, String(Date.now() + AGE_LOCK_MS));
  } catch {
    /* this page only */
  }
}

/**
 * 1.8.4 (simplified): ONE neutral field — the age in full years (no hint of any limit) — and a country
 * select that stays hidden unless the answer depends on it (see needsCountry; never with the default
 * server settings). Both are part of the form itself: no separate screen.
 */
export function ageFieldsHTML(country = '', age = ''): string {
  const l = lang();
  const opts = countryOptions(l)
    .map((c) => `<option value="${c.code}"${c.code === country ? ' selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  return `<label class="acc-field acc-age"><span>${tr('Возраст', 'Age')}</span><input name="age" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" value="${esc(age)}" enterkeyhint="next"><small>${tr('Полных лет. Сохраняется только группа «13–17» или «18+».', 'In full years. Only the group «13–17» or «18+» is kept.')}</small></label>
    <label class="acc-field acc-country" hidden><span>${tr('Страна проживания', 'Country of residence')}</span><select name="country" autocomplete="country"><option value="">${tr('Выберите страну', 'Choose a country')}</option>${opts}</select><small>${tr('Для вашего возраста условия зависят от страны.', 'For your age the terms depend on the country.')}</small></label>`;
}

/** Show the country select only when the typed age needs it (and keep it shown once the player chose one). */
export function bindAgeFields(g: Game, root: HTMLElement): void {
  const age = root.querySelector('input[name="age"]') as HTMLInputElement | null;
  const box = root.querySelector('.acc-country') as HTMLElement | null;
  const sel = root.querySelector('select[name="country"]') as HTMLSelectElement | null;
  if (!age || !box || !sel) return;
  const cfg = g.account?.serverConfig?.age ?? DEFAULT_AGE;
  const update = () => {
    const n = /^\d{1,3}$/.test(age.value.trim()) ? Number(age.value.trim()) : NaN;
    const show = !!sel.value || (Number.isInteger(n) && n >= cfg.min && needsCountry(cfg, n));
    box.hidden = !show;
  };
  age.addEventListener('input', update);
  update();
}

/** What the player reads when PRIME ID is not available for the answer given. */
export function ageText(c: string): string {
  switch (c) {
    case 'age_too_young':
      return tr('PRIME ID доступен с 13 лет. Играть можно и без аккаунта — прогресс сохраняется на этом устройстве.', 'PRIME ID is available from the age of 13. You can still play without an account — your progress is saved on this device.');
    case 'age_guardian_required':
      return tr(
        'Для вашего возраста нужно согласие родителя или законного представителя. Такой порядок мы пока готовим, поэтому PRIME ID сейчас недоступен. Играйте как гость — прогресс сохранится на этом устройстве.',
        'At your age a parent or guardian has to agree first. We are still preparing that procedure, so PRIME ID is not available yet. Play as a guest — your progress is saved on this device.',
      );
    case 'country_unavailable':
      return tr('Регистрация PRIME ID из выбранной страны пока недоступна. Гостевая игра работает как обычно.', 'PRIME ID registration is not available in the country you chose yet. Guest play works as usual.');
    case 'country_invalid':
    case 'country_required':
      return tr('Выберите страну проживания.', 'Choose your country of residence.');
    default:
      return tr('Укажите возраст числом полных лет.', 'Enter your age in full years.');
  }
}

/** Read and check the age (and the country, if it is shown); the server decides again. */
export function readAge(g: Game, root: HTMLElement): { ok: true; country: string; age: number } | { ok: false; code: string } {
  const box = root.querySelector('.acc-country') as HTMLElement | null;
  const country = box && !box.hidden ? (root.querySelector('select[name="country"]') as HTMLSelectElement).value : '';
  const raw = (root.querySelector('input[name="age"]') as HTMLInputElement).value.trim();
  const age = /^\d{1,3}$/.test(raw) ? Number(raw) : NaN;
  const d = ageDecision(g.account?.serverConfig?.age ?? DEFAULT_AGE, country, age);
  return d.ok ? { ok: true, country, age } : { ok: false, code: d.code };
}

// ---------------------------------------------------------------- the ticks
/** The documents to tick (from the server), unticked; the privacy policy as a notice with its link. */
export function consentHTML(g: Game, docs: string[] = ['terms', 'consent']): string {
  const legal = g.account?.serverConfig?.legal;
  const required = docs.filter((d) => d === 'terms' || (d === 'consent' && (legal ? legal.consent.required : true)));
  const doc = (d: LegalDocId, ru: string, en: string) => `<button type="button" class="acc-doc" data-doc="${d}">${tr(ru, en)}</button>`;
  const rows = required.map((d) =>
    d === 'terms'
      ? `<label class="acc-check"><input type="checkbox" name="accept_terms" required><span>${tr('Принимаю', 'I accept the')} ${doc('terms', 'Пользовательское соглашение', 'Terms of Use')}</span></label>`
      : `<label class="acc-check"><input type="checkbox" name="accept_consent" required><span>${tr('Даю', 'I give my')} ${doc('consent', 'согласие на обработку персональных данных', 'consent to the processing of my personal data')}</span></label>`,
  );
  return `<div class="acc-checks">${rows.join('')}
      <p class="acc-small">${tr('Как мы обрабатываем данные — в', 'How we handle data is described in the')} ${doc('privacy', 'Политике конфиденциальности', 'Privacy Policy')}. ${tr('Если вам меньше 18 —', 'If you are under 18, see the')} ${doc('parents', 'информация для родителей', 'information for parents')}.</p>
    </div>`;
}

/** Wire the ticks: the documents open on top; `onChange` gets whether every required box is ticked. */
export function bindConsent(g: Game, root: HTMLElement, onChange: (all: boolean) => void): void {
  root.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    openLegalDoc(g, b.dataset.doc as LegalDocId);
  }));
  const boxes = Array.from(root.querySelectorAll<HTMLInputElement>('.acc-check input[type="checkbox"]'));
  const update = () => onChange(boxes.every((b) => b.checked));
  boxes.forEach((b) => b.addEventListener('change', update));
  update();
}

/** The versions the ticked boxes stand for (from the server; 1 for a server older than 1.8.4). */
export function acceptedVersions(g: Game, root: HTMLElement): Record<string, number> {
  const legal = g.account?.serverConfig?.legal;
  const out: Record<string, number> = {};
  if ((root.querySelector('input[name="accept_terms"]') as HTMLInputElement | null)?.checked) out.terms = legal?.terms.v ?? 1;
  if ((root.querySelector('input[name="accept_consent"]') as HTMLInputElement | null)?.checked) out.consent = legal?.consent.v ?? 1;
  return out;
}

// ------------------------------------------------------ accept once (existing accounts)
/**
 * An account made before 1.8.4 (or after a real change of the rules): accept the documents — and
 * answer the age question if it was never asked — before PRIME CLOUD continues. Nothing is lost
 * meanwhile; «Мои данные» (download / delete) stays available.
 */
export function showLegalAccept(g: Game, needs: string[], onDone: (accepted: boolean) => void): void {
  const r = g.account;
  if (!r) return;
  const askAge = needs.includes('age');
  const docs = needs.filter((d) => d !== 'age');
  const intro = docs.length
    ? tr('Чтобы продолжить с PRIME CLOUD, примите действующие документы PRIME ID. Ваш прогресс сохранён — ничего не теряется.', 'To continue with PRIME CLOUD, please accept the current PRIME ID documents. Your progress is safe — nothing is lost.')
    : tr('Чтобы продолжить с PRIME CLOUD, ответьте на вопрос о возрасте.', 'To continue with PRIME CLOUD, please answer the age question.');
  g.ui.modal(
    `<div class="h1">${tr('Документы PRIME ID', 'PRIME ID documents')}</div>
     <p class="acc-note">${intro}</p>
     <form class="acc-form" novalidate>
       ${askAge ? ageFieldsHTML() : ''}
       ${docs.length ? consentHTML(g, docs) : ''}
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide" type="submit">${tr('Принять и продолжить', 'Accept and continue')}</button>
         <button class="btn ghost wide" type="button" data-a="data">${tr('Мои данные', 'My data')}</button>
         <button class="btn teal wide" type="button" data-a="later">${tr('Позже', 'Later')}</button>
       </div>
     </form>`,
    (root, close) => {
      const form = root.querySelector('form') as HTMLFormElement;
      const err = root.querySelector('.acc-err') as HTMLElement;
      const submit = form.querySelector('[type="submit"]') as HTMLButtonElement;
      let ticked = !docs.length;
      if (docs.length) bindConsent(g, root, (all) => (ticked = all));
      if (askAge) bindAgeFields(g, root);
      root.querySelector('[data-a="later"]')!.addEventListener('click', () => {
        close();
        onDone(false);
      });
      root.querySelector('[data-a="data"]')!.addEventListener('click', () => openMyData(g));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        err.textContent = '';
        let age: { country: string; age: number } | null = null;
        if (askAge) {
          const a = readAge(g, root);
          if (!a.ok) {
            if (a.code === 'country_required') (root.querySelector('.acc-country') as HTMLElement).hidden = false;
            err.textContent = ageText(a.code);
            return;
          }
          age = a;
        }
        if (!ticked) {
          err.textContent = tr('Отметьте обязательные пункты.', 'Please tick the required boxes.');
          return;
        }
        submit.disabled = true;
        void r
          .acceptLegal({ accept: acceptedVersions(g, root), privacy: r.serverConfig?.legal?.privacy.v, lang: lang(), ...(age ?? {}) })
          .then((left) => {
            if (left.length) {
              err.textContent = tr('Сервер ждёт ещё подтверждения. Обновите страницу и попробуйте снова.', 'The server still needs a confirmation. Reload the page and try again.');
              return;
            }
            close();
            g.ui.toast(tr('Спасибо! PRIME CLOUD продолжает работу', 'Thank you! PRIME CLOUD continues'), true);
            onDone(true);
          })
          .catch((e) => {
            const c = code(e);
            if (c === 'legal_outdated') err.textContent = tr('Документы только что обновились. Обновите страницу, чтобы прочитать новую версию.', 'The documents were just updated. Reload the page to read the new version.');
            else if (/^age_|^country_/.test(c)) err.textContent = ageText(c) + ' ' + tr('Аккаунт и прогресс сохранены: их можно скачать или удалить в «Мои данные».', 'Your account and progress are kept: you can download or delete them under «My data».');
            else err.textContent = netText(e);
          })
          .finally(() => (submit.disabled = false));
      });
    },
    false,
  );
}

function netText(e: unknown): string {
  if (kind(e) === 'network') return tr('Нет связи с сервером PRIME NETWORK. Проверьте интернет и повторите.', 'No connection to the PRIME NETWORK server. Check the internet and try again.');
  if (kind(e) === 'rate' || status(e) === 429) return tr('Слишком много попыток. Подождите немного и повторите.', 'Too many attempts. Please wait a little and try again.');
  return tr('Ошибка сервера. Повторите попытку позже.', 'Server error. Please try again later.');
}

// ------------------------------------------------------------------- my data
/** «Мои данные»: download everything the server keeps about the account; delete the account. */
export function openMyData(g: Game): void {
  const r = g.account;
  if (!r) return;
  const tools = r.serverConfig?.accountTools === true;
  g.ui.modal(
    `<div class="h1">${tr('Мои данные', 'My data')}</div>
     <p class="acc-note">${tr(
       'Здесь можно скачать всё, что сервер PRIME NETWORK хранит о вашем аккаунте (JSON), или удалить аккаунт.',
       'Here you can download everything the PRIME NETWORK server keeps about your account (JSON) or delete the account.',
     )}</p>
     ${tools ? '' : `<p class="acc-note muted">${tr('Этот сервер ещё не поддерживает выгрузку и удаление из игры. Напишите на', 'This server does not support download and deletion from the game yet. Write to')} <a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>.</p>`}
     <div class="acc-err" role="alert" aria-live="polite"></div>
     <div class="modal-actions">
       ${tools ? `<button class="btn wide" data-a="export">${tr('Скачать мои данные', 'Download my data')}</button><button class="btn ghost wide acc-danger" data-a="delete">${tr('Удалить аккаунт…', 'Delete account…')}</button>` : ''}
       <button class="btn ghost wide" data-a="privacy">${tr('Политика конфиденциальности', 'Privacy Policy')}</button>
       <button class="btn teal wide" data-a="back">${tr('Назад', 'Back')}</button>
     </div>`,
    (root, close) => {
      const err = root.querySelector('.acc-err') as HTMLElement;
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      root.querySelector('[data-a="privacy"]')!.addEventListener('click', () => openLegalDoc(g, 'privacy'));
      root.querySelector('[data-a="delete"]')?.addEventListener('click', () => confirmDelete(g));
      const ex = root.querySelector('[data-a="export"]') as HTMLButtonElement | null;
      ex?.addEventListener('click', () => {
        ex.disabled = true;
        err.textContent = '';
        void r
          .exportData()
          .then((data) => {
            const nick = String(((data as { profile?: { nickname?: string } }).profile ?? {}).nickname ?? 'account').replace(/[^A-Za-z0-9_А-Яа-яЁё]/g, '');
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `prime-id-${nick || 'account'}-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            g.ui.toast(tr('Файл с данными сохранён', 'Your data file is saved'));
          })
          .catch((e) => (err.textContent = kind(e) === 'unauthorized' ? tr('Войдите в аккаунт ещё раз.', 'Please sign in again.') : netText(e)))
          .finally(() => (ex.disabled = false));
      });
    },
  );
}

/** Deleting: what it means, the password again, an explicit tick — nothing happens before all three. */
function confirmDelete(g: Game): void {
  const r = g.account;
  if (!r) return;
  g.ui.modal(
    `<div class="h1">${tr('Удалить аккаунт?', 'Delete the account?')}</div>
     <ul class="acc-list">
       <li>${tr('Удаляются навсегда: аккаунт PRIME ID, никнейм, облачное сохранение и его копии, сведения о сессии и принятых документах.', 'Deleted for good: the PRIME ID account, nickname, cloud save and its copies, session and accepted-document records.')}</li>
       <li>${tr('Прогресс этого аккаунта на этом устройстве тоже удаляется. Гостевой профиль не меняется.', 'This account\'s progress on this device is removed too. The guest profile stays as it is.')}</li>
       <li>${tr('Резервные копии сервера хранятся ограниченное время для восстановления после сбоев; если сервер восстановят из такой копии, аккаунт будет удалён снова автоматически.', 'Server backups are kept for a limited time for incident recovery; if the server is ever restored from one, the account is deleted again automatically.')}</li>
       <li>${tr('Отменить удаление нельзя. Сначала можно скачать свои данные.', 'This cannot be undone. You can download your data first.')}</li>
     </ul>
     <form class="acc-form" novalidate>
       <label class="acc-field"><span>${tr('Пароль аккаунта', 'Account password')}</span><input name="password" type="password" maxlength="71" autocomplete="current-password" enterkeyhint="done"></label>
       <label class="acc-check"><input type="checkbox" name="sure"><span>${tr('Понимаю, что аккаунт и прогресс будут удалены без возможности восстановления', 'I understand that the account and progress will be deleted and cannot be restored')}</span></label>
       <div class="acc-err" role="alert" aria-live="polite"></div>
       <div class="modal-actions">
         <button class="btn wide acc-danger-fill" type="submit" disabled>${tr('Удалить навсегда', 'Delete forever')}</button>
         <button class="btn teal wide" type="button" data-a="back">${tr('Отмена', 'Cancel')}</button>
       </div>
     </form>`,
    (root, close) => {
      const form = root.querySelector('form') as HTMLFormElement;
      const pw = form.querySelector('input[name="password"]') as HTMLInputElement;
      const sure = form.querySelector('input[name="sure"]') as HTMLInputElement;
      const submit = form.querySelector('[type="submit"]') as HTMLButtonElement;
      const err = root.querySelector('.acc-err') as HTMLElement;
      const update = () => (submit.disabled = !(sure.checked && pw.value.length > 0));
      pw.addEventListener('input', update);
      sure.addEventListener('change', update);
      root.querySelector('[data-a="back"]')!.addEventListener('click', () => close());
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (submit.disabled) return;
        submit.disabled = true;
        err.textContent = '';
        void r
          .deleteAccount(pw.value)
          .then((reload) => {
            g.ui.modal(
              `<div class="h1">${tr('Аккаунт удалён', 'Account deleted')}</div><p class="acc-note">${tr('Аккаунт PRIME ID и его данные удалены. Игра продолжается в гостевом профиле.', 'The PRIME ID account and its data are deleted. The game continues with the guest profile.')}</p>
               <div class="modal-actions"><button class="btn wide" data-a="ok">${tr('Понятно', 'OK')}</button></div>`,
              // (the page that played the account starts again with the guest career)
              (r2, c2) => r2.querySelector('[data-a="ok"]')!.addEventListener('click', () => (reload ? location.reload() : c2())),
              false,
            );
          })
          .catch((e) => {
            const c = code(e);
            err.textContent =
              c === 'password_wrong'
                ? tr('Неверный пароль.', 'Wrong password.')
                : kind(e) === 'unauthorized'
                  ? tr('Сессия истекла: войдите в аккаунт ещё раз и повторите.', 'The session has expired: sign in again and retry.')
                  : netText(e);
            update();
          });
      });
      pw.focus({ preventScroll: true });
    },
    false,
  );
}
