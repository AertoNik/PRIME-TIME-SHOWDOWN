// Alpha 1.9.8 — the studio name in «КАРЬЕРА ПРОДЮСЕРА» (npm run studio).
// Replays the event orders of a real iPhone through the editor the screen uses (src/ui/studioName.ts), the way
// CareerScreen wires them: pointerdown on ✓ / × → focusout (blur) → click / submit; «Готово» ABOVE the keyboard is a
// blur alone; Enter / «готово» ON the keyboard is a submit. The name goes through CareerSystem.rename into the save,
// survives a reload (serialize → sanitize) and is what PRIME CLOUD uploads (the save itself).
import { CareerSystem } from '../src/meta/CareerSystem';
import { defaultSave, sanitize, type SaveData, type SaveSystem } from '../src/meta/SaveSystem';
import { STUDIO_NAME_MAX, StudioNameEdit, cleanStudioName, type NameOutcome } from '../src/ui/studioName';
import { proc } from './lib/node';

const checks: [string, boolean, string?][] = [];
const check = (name: string, pass: boolean, info = '') => checks.push([name, pass, info]);

class MemSave {
  data: SaveData = defaultSave();
  writes = 0;
  save(): void {
    this.writes++;
    this.data = sanitize(JSON.parse(JSON.stringify(this.data)));
  }
  get persistent(): boolean {
    return true;
  }
  reset(): void {
    this.data = defaultSave();
  }
}

/**
 * The screen in miniature: the field's value and focus, the editor, and the handlers CareerScreen registers (same
 * order, same decisions). `toasts` collects what the player is told.
 */
function screen(start = 'NEON NIGHT PRODUCTIONS') {
  const mem = new MemSave();
  mem.data.orgName = start;
  const career = new CareerSystem(mem as unknown as SaveSystem);
  const ed = new StudioNameEdit(
    () => mem.data.orgName,
    (n) => career.rename(n),
  );
  const ui = { value: mem.data.orgName, readOnly: true, focused: false, toasts: [] as string[], settleArmed: false };
  const done = (r: NameOutcome | null) => {
    if (!r) return;
    ui.value = r.name;
    ui.readOnly = true;
    ui.focused = false;
    ui.settleArmed = false;
    if (r.kind === 'saved') ui.toasts.push('saved:' + r.name);
    if (r.kind === 'empty') ui.toasts.push('empty');
  };
  return {
    mem,
    ui,
    ed,
    /** tap on the pencil (or on the read-only name): the same field becomes editable and focused */
    pencil() {
      if (ed.editing) {
        ui.focused = true;
        return;
      }
      ui.focused = false; // a focused read-only field is let go first (no edit to end yet)
      ui.value = ed.begin();
      ui.readOnly = false;
      ui.focused = true;
    },
    type(v: string) {
      if (!ui.readOnly && ui.focused) ui.value = v;
    },
    /** the field loses the focus (CareerScreen's focusout handler) */
    blur() {
      if (!ui.focused) return;
      ui.focused = false;
      const r = ed.blurred(ui.value);
      if (r) done(r);
      else if (ed.editing) ui.settleArmed = true;
    },
    /** the 600 ms fallback after a press on ✓ / × whose click never came */
    settle() {
      if (ui.settleArmed && ed.editing && !ui.focused) done(ed.settle(ui.value));
    },
    pointerdown(on: 'save' | 'cancel' | 'other') {
      if (on !== 'other') ed.aim(on);
    },
    /** Enter / «готово» on the keyboard, or the click on ✓ (type=submit) */
    submit() {
      done(ed.submit(ui.value));
    },
    clickCancel() {
      done(ed.cancel());
    },
    escape() {
      if (ed.editing) done(ed.cancel());
    },
    /** leaving the screen (onHide) */
    leave() {
      if (ed.editing) done(ed.blurred(ui.value) ?? ed.settle(ui.value));
    },
  };
}

// 1. Enter / «готово» ON the keyboard
{
  const s = screen();
  s.pencil();
  check('the pencil makes the same field editable and focused (nothing rebuilt), starting from the stored name', s.ed.editing && !s.ui.readOnly && s.ui.focused && s.ui.value === 'NEON NIGHT PRODUCTIONS');
  s.type('Midnight Studio');
  s.submit();
  s.blur(); // the keyboard closing after the submit
  check('Enter / «готово» on the keyboard: saved once, upper case, the field read-only again', s.mem.data.orgName === 'MIDNIGHT STUDIO' && s.ui.toasts.join() === 'saved:MIDNIGHT STUDIO' && s.ui.readOnly && !s.ed.editing && s.mem.writes === 1, s.ui.toasts.join());
}
// 2. «Готово» ABOVE the keyboard (iOS accessory bar): only a blur — 1.9.7 kept the field open and lost the name
{
  const s = screen();
  s.pencil();
  s.type('Frost Studio 7');
  s.blur();
  check('iPhone «Готово» above the keyboard (a blur, no submit): the typed name IS saved — 1.9.7 left it unsaved', s.mem.data.orgName === 'FROST STUDIO 7' && s.ui.toasts.join() === 'saved:FROST STUDIO 7' && !s.ed.editing);
}
// 3. × on iOS: pointerdown → blur → click
{
  const s = screen();
  s.pencil();
  s.type('Something Else');
  s.pointerdown('cancel');
  s.blur();
  check('× on iOS — the blur that comes BEFORE the click saves nothing', s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS' && s.ed.editing && s.mem.writes === 0);
  s.clickCancel();
  check('…then the click on × cancels: the previous name stays and is shown, nothing written', s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS' && s.ui.value === 'NEON NIGHT PRODUCTIONS' && s.ui.readOnly && !s.ed.editing && s.mem.writes === 0 && !s.ui.toasts.length);
  s.settle();
  check('…and the late fallback timer does nothing more', s.mem.writes === 0);
}
// 4. ✓ on iOS: pointerdown → blur → click (submit) — saved exactly once
{
  const s = screen();
  s.pencil();
  s.type('Prime Wave');
  s.pointerdown('save');
  s.blur();
  check('✓ on iOS — the blur before the click does not save on its own…', s.mem.writes === 0 && s.ed.editing);
  s.submit();
  check('…the click on ✓ saves exactly once', s.mem.data.orgName === 'PRIME WAVE' && s.mem.writes === 1 && s.ui.toasts.join() === 'saved:PRIME WAVE');
}
// 5. the finger slid off × (pointerdown, blur, no click)
{
  const s = screen();
  s.pencil();
  s.type('Half Typed');
  s.pointerdown('cancel');
  s.blur();
  s.settle();
  check('a press on × whose click never comes: the fallback cancels (the previous name stays)', s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS' && !s.ed.editing && s.ui.readOnly);
}
// 6. the finger slid off ✓
{
  const s = screen();
  s.pencil();
  s.type('Slid Off');
  s.pointerdown('save');
  s.blur();
  s.settle();
  check('a press on ✓ whose click never comes: the fallback saves', s.mem.data.orgName === 'SLID OFF' && !s.ed.editing);
}
// 7. empty
{
  const s = screen();
  s.pencil();
  s.type('   ');
  s.submit();
  check('an empty name is never saved: the previous name stays, the player is told', s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS' && s.ui.value === 'NEON NIGHT PRODUCTIONS' && s.ui.toasts.join() === 'empty' && s.mem.writes === 0);
}
// 8. Escape
{
  const s = screen();
  s.pencil();
  s.type('Escaped');
  s.escape();
  s.blur();
  check('Escape cancels; the blur after it saves nothing', s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS' && s.mem.writes === 0);
}
// 9. leaving the screen while typing
{
  const s = screen();
  s.pencil();
  s.type('Left Mid Edit');
  s.leave();
  check('leaving the screen while typing keeps the typed name (as any blur) — never a half-open field', s.mem.data.orgName === 'LEFT MID EDIT' && !s.ed.editing);
}
// 10. unchanged
{
  const s = screen();
  s.pencil();
  s.submit();
  check('the same name again: nothing written, no «saved» claim', s.mem.writes === 0 && !s.ui.toasts.length && !s.ed.editing);
}
// 11. nothing happens without an edit
{
  const s = screen();
  s.blur();
  s.submit();
  s.clickCancel();
  s.leave();
  check('no edit open: blur, submit, × and leaving do nothing', s.mem.writes === 0 && s.mem.data.orgName === 'NEON NIGHT PRODUCTIONS');
}
// 12. the pencil while already typing keeps the typed text
{
  const s = screen();
  s.pencil();
  s.type('Keep Me');
  s.pencil();
  check('the pencil while typing only brings the keyboard back — the typed text stays', s.ui.value === 'Keep Me' && s.ed.editing);
}
// 13. limits
check(`at most ${STUDIO_NAME_MAX} characters, trimmed, upper case`, cleanStudioName('  a'.padEnd(60, 'b') + '  ').length === STUDIO_NAME_MAX && cleanStudioName('  x y  ') === 'X Y');
// 14. survives a reload and travels with the save (PRIME CLOUD uploads the save itself)
{
  const s = screen();
  s.pencil();
  s.type('Cloud Bound');
  s.blur();
  const reloaded = sanitize(JSON.parse(JSON.stringify(s.mem.data)));
  check('after a reload (serialize → sanitize) the new name is there — the same save PRIME CLOUD uploads', reloaded.orgName === 'CLOUD BOUND');
}
// 15. 28 characters of the field reach the save intact
{
  const s = screen();
  s.pencil();
  s.type('Z'.repeat(STUDIO_NAME_MAX));
  s.submit();
  check('a full-length name (28) is stored intact', s.mem.data.orgName === 'Z'.repeat(STUDIO_NAME_MAX));
}

let failed = 0;
for (const [name, pass, info] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${!pass && info ? ' — ' + info : ''}`);
}
console.log(failed ? `studio: FAILED (${failed} of ${checks.length})` : `studio: OK (${checks.length} checks)`);
proc.exitCode = failed ? 1 : 0;
