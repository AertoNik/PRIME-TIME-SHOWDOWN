import { AmbientLight, DirectionalLight, PerspectiveCamera, Scene, Vector2 } from 'three';
import { CASE_DEFS, CASE_RARITY_LABEL, shareLabel } from '../config/cases.config';
import type { Game } from '../game/Game';
import type { CaseKind, CaseOddsLine, CaseReward, CasesStatus } from '../net/PrimeApi';
import { buildCase } from '../render/caseModels';
import { caseRenderer, caseRendererBusy, parkCaseRenderer } from '../render/caseRenderer';
import { playCaseShow } from './caseOpening';
import { esc } from './dom';

// Beta 2.4 — REWARD CASES in the game's windows: the account's cases as the PRIME NETWORK server states them (a small
// store the menu badges and the windows read), a picture of each case (a real render of its 3D model, made once and
// kept as an image — no extra 3D on the menu), the odds table, and the opening show.

let status: CasesStatus | null = null;
let loading: Promise<CasesStatus | null> | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const f of listeners) f();
};

/** Is REWARD CASES on for this signed-in, verified account (server config + a session)? */
export function casesOn(g: Game): boolean {
  const a = g.account;
  return !!a?.serverConfig?.cases && !!a.api?.sessionRecord && a.playing === a.api.userId && !(a.me && !a.me.verified);
}

/** The cases as last read from the server (null: not read / off). */
export function casesStatus(): CasesStatus | null {
  return status;
}

export function onCases(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Read the account's cases again (after a claim, an invitation confirmed, an open). */
export function refreshCases(g: Game): Promise<CasesStatus | null> {
  if (!casesOn(g)) {
    if (status) {
      status = null;
      emit();
    }
    return Promise.resolve(null);
  }
  if (loading) return loading;
  loading = g
    .account!.api!.casesStatus()
    .then((s) => {
      status = s;
      emit();
      return s;
    })
    .catch(() => status)
    .finally(() => (loading = null));
  return loading;
}

/** Take a status the server sent with another answer (an open, a claim). */
export function takeCases(s: CasesStatus | null): void {
  if (!s) return;
  status = s;
  emit();
}

// ------------------------------------------------------------ pictures of the cases (a render of the real model)
const snaps: Partial<Record<CaseKind, string>> = {};
/**
 * A PNG of the case model, made once per session with the cases' one shared renderer (render/caseRenderer.ts — no extra
 * WebGL context is made or thrown away for it). '' when WebGL is not there right now (asked again next time).
 */
export function caseSnapshot(kind: CaseKind): string {
  if (snaps[kind] !== undefined) return snaps[kind]!;
  const r = caseRenderer();
  if (!r) return '';
  let url = '';
  const busy = caseRendererBusy();
  const size = r.getSize(new Vector2());
  const ratio = r.getPixelRatio();
  const m = buildCase(kind);
  try {
    r.setPixelRatio(1);
    r.setSize(360, 300, false);
    const scene = new Scene();
    scene.add(new AmbientLight(0xb8c8ff, 1.1));
    const key = new DirectionalLight(0xffffff, 2.4);
    key.position.set(1.6, 2.8, 2.4);
    scene.add(key);
    const fill = new DirectionalLight(0x6fa8ff, 0.9);
    fill.position.set(-2.2, 0.6, 1.2);
    scene.add(fill);
    m.root.rotation.set(0.14, -0.42, 0);
    m.setGlow(1.25);
    scene.add(m.root);
    const cam = new PerspectiveCamera(30, 360 / 300, 0.1, 50);
    cam.position.set(0, 0.62, 4.3);
    cam.lookAt(0, 0.02, 0);
    r.render(scene, cam);
    // read in the same task as the render — the drawing buffer is still there (no preserveDrawingBuffer needed)
    url = r.domElement.toDataURL('image/png');
    scene.remove(m.root);
  } catch {
    url = '';
  } finally {
    m.dispose();
    // a show running meanwhile gets its size back (it draws again next frame); otherwise the canvas is parked
    if (busy) {
      r.setPixelRatio(ratio);
      r.setSize(size.x, size.y, false);
    } else parkCaseRenderer();
  }
  // an empty picture (a context that could not draw) is not kept — the drawn case stands in, and it is asked again later
  if (url.length < 2000) return '';
  snaps[kind] = url;
  return url;
}

/** The case's picture as HTML (the render, or a drawn fallback when WebGL is missing). */
export function caseImg(kind: CaseKind, cls = ''): string {
  const url = caseSnapshot(kind);
  const alt = esc(CASE_DEFS[kind].name);
  return url ? `<img class="case-img ${cls}" src="${url}" alt="${alt}" draggable="false">` : `<span class="case-img case-img-fb kind-${kind} ${cls}" role="img" aria-label="${alt}"></span>`;
}

// ------------------------------------------------------------ the odds table
function amountText(l: CaseOddsLine): string {
  if (l.kind === 'item') return 'Эффект рывка';
  const range = l.min === l.max ? `${l.min.toLocaleString('ru-RU')}` : `${l.min.toLocaleString('ru-RU')}–${l.max.toLocaleString('ru-RU')}`;
  return l.kind === 'money' ? `${range} $` : l.kind === 'rep' ? `${range} репутации` : `${range} PRIME TOKENS`;
}

/**
 * «Что может выпасть»: every reward of the case for THIS player with its real share (the server's), its rarity, and a
 * line about what left the table (the exclusive already owned, PRIME TOKENS without PRIME LEAGUE).
 */
export function oddsHTML(lines: CaseOddsLine[], s: CasesStatus, kind: CaseKind): string {
  const rows = lines
    .map(
      (l) => `<li class="co-row rar-${l.rarity}">
        <span class="co-name"><b>${esc(l.label)}</b><small>${esc(amountText(l))}</small></span>
        <span class="co-rar">${esc(CASE_RARITY_LABEL[l.rarity])}</span>
        <span class="co-share">${shareLabel(l.share)}</span>
      </li>`,
    )
    .join('');
  const notes: string[] = [];
  if (kind === 'invite' && s.exclusive.owned) notes.push('INVITE SIGNAL уже у вас — он больше не выпадает, его доля распределена между остальными наградами.');
  if (!s.tokens) notes.push('PRIME TOKENS выпадают после входа в PRIME LEAGUE — до этого их доля распределена между остальными наградами.');
  return `<ul class="case-odds" aria-label="Что может выпасть и с какой вероятностью">${rows}</ul>
    <p class="co-note">Шансы — точные, для вашего аккаунта; результат определяет сервер PRIME NETWORK.${notes.length ? ' ' + esc(notes.join(' ')) : ''}</p>`;
}

/** A reward in one short line («+43 репутации», «INVITE SIGNAL») — the toast after a lost answer came back. */
export function caseRewardText(r: CaseReward | null | undefined): string {
  if (!r) return '';
  if (r.kind === 'item') return r.label;
  const n = r.amount.toLocaleString('ru-RU');
  return r.kind === 'money' ? `+${n} $` : r.kind === 'rep' ? `+${n} репутации` : `+${n} PRIME TOKENS`;
}

/** The rules every case window shows once. */
export const CASE_RULES_TEXT = 'Кейсы бесплатные: их нельзя купить, продать, передать другому игроку или обменять на деньги.';

// ------------------------------------------------------------ opening
/**
 * Open cases of `kind` one after another in the show (the server draws each). `onClose` — the windows refresh.
 */
export function openCaseShow(g: Game, kind: CaseKind, onClose?: () => void): void {
  const sync = g.account?.sync;
  if (!sync || !casesOn(g)) {
    g.ui.toast('Кейсы откроются, когда PRIME CLOUD подключится');
    return;
  }
  let left = kind === 'invite' ? (status?.invite.ready ?? 1) : (status?.daily.ready ?? 1);
  g.audio.ui('confirm');
  playCaseShow({
    kind,
    open: async () => {
      const r = await sync.openCase(kind);
      if (r.status) takeCases(r.status);
      left = r.status ? (kind === 'invite' ? r.status.invite.ready : r.status.daily.ready) : Math.max(0, left - (r.ok ? 1 : 0));
      if (r.ok) {
        const res = r.case.result;
        // the reward is in the save already (SyncManager) — the menu shows the new balance, the exclusive is wearable
        if (res?.kind === 'item') g.applyCosmetics();
        g.audio.ui(res && (res.rarity === 'epic' || res.rarity === 'legendary') ? 'level' : 'coin');
      } else g.audio.ui('deny');
      return r;
    },
    left: () => left,
    onClose: () => {
      void refreshCases(g);
      if (g.ui.current === 'menu') (g.ui.get('menu') as unknown as { onShow(): void }).onShow();
      onClose?.();
    },
  });
}
