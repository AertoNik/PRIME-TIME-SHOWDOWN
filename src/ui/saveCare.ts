import { VERSION, type BackupReason, type SaveBackup, type SaveSummary } from '../meta/SaveSystem';
import { formatMoney } from '../core/math';
import type { Game } from '../game/Game';
import { esc } from './dom';

// Alpha 1.8 SAVE FOUNDATION — the dialogs around the local save: a damaged save, a save from a
// newer version, the game open in another tab, safety copies, export and import. They never
// replace progress without the player's confirmation; whatever replaces it is copied first, and
// the page reloads afterwards so every system reads the new state from scratch.

const REASON: Record<BackupReason, string> = {
  auto: 'Автокопия',
  migration: 'Перед обновлением версии',
  reset: 'Перед сбросом',
  import: 'Перед импортом',
  restore: 'Перед восстановлением',
};

const when = (t: number) => (t > 0 ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

export function summaryLine(s: SaveSummary): string {
  return `${esc(s.orgName)} · ур. ${s.level} · ${formatMoney(s.money)} · матчей ${s.matches} · бойцов ${s.fighters}`;
}

function backupRow(b: SaveBackup): string {
  return `<div class="sc-row">
      <div class="sc-info"><b>${when(b.at)}</b><span>${REASON[b.reason]}</span><small>${summaryLine(b.summary)}</small></div>
      <button class="btn ghost sc-act" data-restore="${b.at}">Восстановить</button>
    </div>`;
}

/** Hand the player a file (iOS Safari 13+, Android and desktop browsers save it to downloads). */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function exportName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `primetime-showdown-save-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

function reloadSoon(): void {
  setTimeout(() => location.reload(), 350);
}

/** Is something wrong with the save that the player must hear about before playing? */
export function saveNeedsAttention(g: Game): boolean {
  return g.save.passive || g.save.status === 'damaged' || g.save.status === 'newer';
}

/** The problem found at launch, as a modal the player answers (one at a time: tab, damage, version). */
export function showSaveProblem(g: Game): void {
  const s = g.save;
  if (s.passive) return showOtherTab(g, false);
  if (s.status === 'damaged') return showDamaged(g);
  if (s.status === 'newer') return showNewer(g);
}

/** Another tab holds this profile (found at launch, or it was taken over while this tab played). */
export function showOtherTab(g: Game, takenAway: boolean): void {
  g.ui.modal(
    `<div class="h1">Игра открыта в другой вкладке</div>
     <p class="center muted sc-text">${
       takenAway
         ? 'Вы продолжили игру в другой вкладке. Чтобы вкладки не перезаписывали прогресс друг друга, здесь сохранение остановлено.'
         : 'Чтобы вкладки не перезаписывали прогресс друг друга, сохранять может только одна из них. В этой вкладке прогресс сейчас не сохраняется.'
     }</p>
     <div class="modal-actions"><button class="btn wide" data-a="here">Играть здесь</button></div>`,
    (root) => {
      root.querySelector('[data-a="here"]')!.addEventListener('click', () => {
        g.audio.ui('confirm');
        // take the profile back and read its latest save from scratch
        g.save.takeOver();
        reloadSoon();
      });
    },
    false,
  );
}

function showDamaged(g: Game): void {
  const s = g.save;
  const list = s.backups();
  g.ui.modal(
    `<div class="h1">Сохранение повреждено</div>
     <p class="center muted sc-text">Браузер вернул сохранение, которое не удаётся прочитать. Мы ничего не перезаписали: исходные данные отложены отдельно, их можно скачать для поддержки.</p>
     ${list.length ? `<div class="label sc-label">Резервные копии</div><div class="sc-list">${list.map(backupRow).join('')}</div>` : '<p class="center muted sc-text">Резервных копий на этом устройстве пока нет.</p>'}
     <div class="modal-actions">
       <button class="btn ghost wide" data-a="export">Скачать повреждённый файл</button>
       <button class="btn ghost wide" data-a="fresh">Начать новую карьеру</button>
     </div>`,
    (root) => {
      root.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const r = t.closest('[data-restore]') as HTMLElement | null;
        if (r) {
          g.audio.ui('confirm');
          if (s.restoreBackup(Number(r.dataset.restore))) {
            g.ui.toast('Копия восстановлена', true);
            reloadSoon();
          } else g.ui.toast('Эту копию не удалось прочитать');
          return;
        }
        const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset.a;
        if (a === 'export') {
          g.audio.ui('click');
          downloadText(exportName(), s.exportJSON());
        } else if (a === 'fresh') {
          g.confirm('Начать новую карьеру?', 'Повреждённые данные останутся отложенными в браузере, их по-прежнему можно скачать. Прогресс начнётся с нуля.', 'Начать заново', () => {
            if (s.startFresh()) reloadSoon();
          }, () => showDamaged(g));
        }
      });
    },
    false,
  );
}

function showNewer(g: Game): void {
  const s = g.save;
  g.ui.modal(
    `<div class="h1">Сохранение из новой версии игры</div>
     <p class="center muted sc-text">Ваш прогресс записан более новой версией PRIME TIME: SHOWDOWN (схема ${s.loadedVersion}, эта версия понимает до ${VERSION}). Чтобы ничего не потерять, эта версия его не перезаписывает. Обновите страницу, чтобы загрузить свежую версию игры.</p>
     <div class="modal-actions">
       <button class="btn wide" data-a="reload">Обновить страницу</button>
       <button class="btn ghost wide" data-a="export">Скачать копию сохранения</button>
       <button class="btn ghost wide" data-a="play">Продолжить без сохранения</button>
     </div>`,
    (root, close) => {
      root.addEventListener('click', (e) => {
        const a = ((e.target as HTMLElement).closest('[data-a]') as HTMLElement | null)?.dataset.a;
        if (a === 'reload') location.reload();
        else if (a === 'export') downloadText(exportName(), s.exportJSON());
        else if (a === 'play') {
          g.audio.ui('click');
          close();
          g.ui.toast('Прогресс этой сессии не сохраняется');
        }
      });
    },
    false,
  );
}

/** Settings → «Сохранение»: the profile, the safety copies, export and import. */
export function openSaveTools(g: Game, back: () => void): void {
  const s = g.save;
  const list = s.backups();
  const state = !s.persistent
    ? 'Браузер не даёт хранить данные: прогресс не сохраняется'
    : s.passive
      ? 'Игра открыта в другой вкладке: здесь прогресс не сохраняется'
      : `Последняя запись: ${when(s.meta.savedAt)}`;
  g.ui.modal(
    `<div class="h1">Сохранение</div>
     <div class="sc-profile">
       <b>Гостевой профиль</b>
       <span>Прогресс хранится только в этом браузере на этом устройстве.</span>
       <small>${esc(state)}</small>
     </div>
     <div class="label sc-label">Резервные копии · до 3</div>
     ${list.length ? `<div class="sc-list">${list.map(backupRow).join('')}</div>` : '<p class="muted sc-text">Копии появятся сами: раз в день и перед сбросом, импортом или восстановлением.</p>'}
     <div class="modal-actions">
       <button class="btn ghost wide" data-a="export">Скачать сохранение (JSON)</button>
       <button class="btn ghost wide" data-a="import" ${s.writable ? '' : 'disabled'}>Загрузить из файла</button>
       <button class="btn teal wide" data-a="back">Назад</button>
     </div>`,
    (root) => {
      root.addEventListener('click', (e) => {
        const t = e.target as HTMLElement;
        const r = t.closest('[data-restore]') as HTMLElement | null;
        if (r) {
          const b = list.find((x) => x.at === Number(r.dataset.restore));
          if (!b) return;
          g.confirm('Восстановить копию?', `${REASON[b.reason]} · ${when(b.at)}<br>${summaryLine(b.summary)}<br><br>Текущий прогресс сначала сохранится в резервную копию. Настройки устройства не изменятся.`, 'Восстановить', () => {
            if (s.restoreBackup(b.at)) {
              g.ui.toast('Копия восстановлена', true);
              reloadSoon();
            } else g.ui.toast('Эту копию не удалось прочитать');
          }, () => openSaveTools(g, back));
          return;
        }
        const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset.a;
        if (a === 'back') {
          g.audio.ui('click');
          back();
        } else if (a === 'export') {
          g.audio.ui('click');
          downloadText(exportName(), s.exportJSON());
          g.ui.toast('Файл сохранения скачан');
        } else if (a === 'import' && s.writable) {
          g.audio.ui('click');
          pickImport(g, back);
        }
      });
    },
  );
}

/** Choose a file, check it, show what it holds, replace only after a confirmation. */
function pickImport(g: Game, back: () => void): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    let text = '';
    try {
      text = await file.text();
    } catch {
      g.ui.toast('Не удалось прочитать файл');
      return;
    }
    const check = g.save.checkImport(text);
    if (!check.ok) {
      g.ui.toast(check.reason);
      return;
    }
    const cur = g.save.data;
    g.confirm(
      'Заменить прогресс?',
      `Сейчас: ${esc(cur.orgName)} · матчей ${cur.matches}<br>Из файла: ${summaryLine(check.summary)}<br><br>Текущий прогресс сначала сохранится в резервную копию. Настройки устройства не изменятся.`,
      'Заменить',
      () => {
        if (g.save.applyImport(check)) {
          g.ui.toast('Сохранение загружено', true);
          reloadSoon();
        } else g.ui.toast('Сейчас загрузить сохранение нельзя');
      },
      () => openSaveTools(g, back),
    );
  });
  input.click();
}
