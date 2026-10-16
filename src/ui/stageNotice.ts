import { COSMETICS } from '../config/cosmetics.config';
import type { StageId } from '../config/career';
import { stageById } from '../meta/careerStages';
import { esc } from './dom';
import { UI_ICONS } from './icons';

/** Alpha 1.5: the results-screen card for a newly reached producer career stage. */
export function stageNoticeHTML(id: StageId | null): string {
  const def = id ? stageById(id) : undefined;
  if (!def) return '';
  const r = def.reward;
  const reward = r ? `Награда $${r.money} · +${r.rep}★${r.cosmetic ? ` · «${esc(COSMETICS[r.cosmetic].name)}» в коллекцию` : ''} — заберите в разделе «Карьера»` : '';
  return `<div class="goal-done stage-done">${UI_ICONS.trophy}<div class="fill"><div class="label sd-kicker">Новый этап карьеры</div><div class="h2" style="font-size:13px">${esc(def.title)}</div><div class="muted" style="font-size:11px">${reward}</div></div></div>`;
}
