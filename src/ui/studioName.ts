// Alpha 1.9.8 — the studio name editor of «КАРЬЕРА ПРОДЮСЕРА», as a small state machine (no DOM here, so the real
// event orders of an iPhone can be replayed in a test: scripts/studio-name-check.ts).
//
// Why 1.9.7 still failed on a real iPhone:
//   • iOS ends typing with «Готово» on the bar ABOVE the keyboard: that only takes the focus away (blur) — it never
//     submits the form. The field stayed open with the typed name unsaved, and leaving the screen dropped it.
//   • the pencil rebuilt the whole screen and focused a field created a moment before (the most fragile way to ask
//     iOS for the keyboard).
//   • on iOS a tap on × first takes the focus from the field (blur), the click comes after it.
// Now the field always exists (read-only until the pencil), and every way out is decided here:
//   Enter / «готово» on the keyboard, ✓ ............... save
//   «Готово» above the keyboard, a tap elsewhere,
//   leaving the screen (the field loses the focus) ..... save
//   ×, Escape ........................................... cancel — the previous name stays
//   an empty name ....................................... not saved — the previous name stays (said in a toast)
// A press on ✓ / × is seen at pointerdown, before the blur it causes, so a cancel is never saved first.

export type NameIntent = 'save' | 'cancel';

export type NameOutcome =
  /** The new name is stored (upper case, at most MAX characters). */
  | { kind: 'saved'; name: string }
  /** Same name as before — nothing to store. */
  | { kind: 'unchanged'; name: string }
  /** Empty: not stored, the previous name stays. */
  | { kind: 'empty'; name: string }
  /** × / Escape: the previous name stays. */
  | { kind: 'cancelled'; name: string };

export const STUDIO_NAME_MAX = 28;

/** The name as it is stored: trimmed, at most 28 characters, upper case (as the field shows it). */
export function cleanStudioName(v: string): string {
  return v.trim().slice(0, STUDIO_NAME_MAX).trim().toUpperCase();
}

export class StudioNameEdit {
  private open = false;
  private before = '';
  private aimed: NameIntent | null = null;

  /**
   * @param current the stored name now
   * @param store   writes a new name (CareerSystem.rename → the save → PRIME CLOUD)
   */
  constructor(
    private readonly current: () => string,
    private readonly store: (name: string) => void,
  ) {}

  get editing(): boolean {
    return this.open;
  }

  /** The pencil (or a tap on the name): editing starts from the stored name. */
  begin(): string {
    this.open = true;
    this.aimed = null;
    this.before = this.current();
    return this.before;
  }

  /** A finger / pointer came down on ✓ or × — before the field loses the focus because of it. */
  aim(intent: NameIntent): void {
    if (this.open) this.aimed = intent;
  }

  /** Enter / «готово» on the keyboard / ✓. */
  submit(value: string): NameOutcome | null {
    return this.open ? this.finish(value, 'save') : null;
  }

  /** × / Escape. */
  cancel(): NameOutcome | null {
    return this.open ? this.finish('', 'cancel') : null;
  }

  /**
   * The field lost the focus. Without a press on ✓ / × it is the iPhone's «Готово» above the keyboard, a tap
   * elsewhere or leaving the screen: the typed name is kept. After a press on ✓ / × the click decides (null) —
   * `settle` finishes it if that click never comes (the finger slid off the button).
   */
  blurred(value: string): NameOutcome | null {
    if (!this.open || this.aimed) return null;
    return this.finish(value, 'save');
  }

  /** A press on ✓ / × whose click never came: do what was aimed at. */
  settle(value: string): NameOutcome | null {
    if (!this.open) return null;
    return this.finish(value, this.aimed ?? 'save');
  }

  private finish(value: string, how: NameIntent): NameOutcome {
    this.open = false;
    this.aimed = null;
    const before = this.before;
    if (how === 'cancel') return { kind: 'cancelled', name: before };
    const name = cleanStudioName(value);
    if (!name) return { kind: 'empty', name: before };
    if (name === before) return { kind: 'unchanged', name: before };
    this.store(name);
    return { kind: 'saved', name: this.current() };
  }
}
