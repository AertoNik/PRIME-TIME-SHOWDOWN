import type { Match } from '../combat/Match';
import { LIVE } from '../config/live.config';
import type { Side } from '../config/types';
import { stateHash } from '../league/replay';
import { STEP, applyLiveInput, liveMatch, type LiveInput, type LiveSnapshot } from './sim';

const STEP_MS = STEP * 1000;

/** What became of a journal entry the game received. */
export type ReceiveResult = 'ok' | 'dup' | 'late' | 'gap';

/**
 * Beta 2.7 LIVE DUELS — the game's side of the lockstep. It runs the fight towards the step the SERVER's clock is at
 * (minus a small adaptive buffer), applying each journal entry at the step the server gave it. Pure: no DOM, no
 * network — the game (LiveRuntime) feeds it the journal and the clock; the checks run it in Node.
 *
 * An entry that arrives for a step already shown («late») or after a hole in the journal («gap») is never applied out
 * of place: `rebuild()` builds the fight anew from the snapshot and the journal (≈ 11 µs a step), the game swaps it in.
 */
export class LiveDriver {
  match: Match;
  /** Journal entries by number k (holes stay undefined until filled). */
  private journal: (LiveInput | undefined)[] = [];
  /** Entries 0…known-1 are all here. */
  private known = 0;
  /** Entries 0…applied-1 reached the fight. */
  private applied = 0;
  /** Steps behind the server clock the fight is shown (LIVE.buffer, adaptive). */
  buffer: number = LIVE.buffer.start;
  /** An entry came for a step already run — `rebuild()` before the next step. */
  late = false;
  /** Fingerprints at the checkpoints [step, hash] not yet reported to the server. */
  readonly hashes: [number, number][] = [];
  /** The fingerprint at the step the fight reached «over» (what the server's replay ends with). */
  overHash: number | null = null;
  /** Counters for the diagnostics panel and the checks. */
  readonly stats = { late: 0, gaps: 0, rebuilds: 0, minMargin: Infinity };
  private calmFor = 0;

  constructor(
    readonly snap: LiveSnapshot,
    readonly side: Side,
    readonly startAt: number,
    /** The server's clock as the game estimates it (ms). */
    private readonly now: () => number,
  ) {
    this.match = liveMatch(snap);
  }

  /** Entries 0…n-1 are all known (the next one the game is missing, if any, is n). */
  get count(): number {
    return this.known;
  }

  /** The step the server clock is at right now. */
  serverStep(): number {
    return Math.floor((this.now() - this.startAt) / STEP_MS);
  }

  /** The step the fight should be shown at now. */
  target(): number {
    return this.serverStep() - this.buffer;
  }

  /** A journal entry from the server (its answer to our own card, or the realtime news): k, step, side, card. */
  receive(k: number, s: number, p: number, c: number): ReceiveResult {
    if (!Number.isInteger(k) || k < 0 || this.journal[k]) return 'dup';
    this.journal[k] = [s, p, c];
    while (this.journal[this.known]) this.known++;
    if (k >= this.known) {
      this.stats.gaps++;
      return 'gap';
    }
    // the margin the entry arrived with (steps before it is due) — the buffer grows when it gets thin
    const margin = s - this.match.steps;
    this.stats.minMargin = Math.min(this.stats.minMargin, margin);
    if (s < this.match.steps && this.applied <= k) {
      this.late = true;
      this.stats.late++;
      this.buffer = Math.min(LIVE.buffer.max, this.buffer + 6);
      this.calmFor = 0;
      return 'late';
    }
    if (margin < 2) this.buffer = Math.min(LIVE.buffer.max, this.buffer + 2);
    return 'ok';
  }

  /** The journal as the game knows it (contiguous part). */
  inputs(): LiveInput[] {
    return this.journal.slice(0, this.known) as LiveInput[];
  }

  /** Beyond this step the fight must not run: an entry is missing and its step could be anything from here on. */
  private frontier(): number {
    if (this.known >= this.journal.length) return Infinity;
    return this.known > 0 ? (this.journal[this.known - 1] as LiveInput)[0] : 0;
  }

  /**
   * Runs the fight towards the target step, at most `max` steps now. Returns the steps run. The match's events stay
   * in it for the game to draw (or drop, when it is catching up). After «over» the bodies keep moving (no entries).
   */
  advance(max: number, dtMs = 16): number {
    if (this.late) return 0;
    const goal = Math.min(this.target(), this.frontier());
    const m = this.match;
    let n = 0;
    while (m.steps < goal && n < max) {
      if (m.phase !== 'over') {
        while (this.applied < this.known && (this.journal[this.applied] as LiveInput)[0] <= m.steps) {
          applyLiveInput(m, this.journal[this.applied] as LiveInput);
          this.applied++;
        }
      }
      const was = m.phase;
      m.step(STEP);
      n++;
      if (was !== 'over' && m.phase === 'over' && this.overHash === null) this.overHash = stateHash(m);
      if (m.steps % LIVE.checkEvery === 0 && m.phase !== 'over' && !m.result) this.hashes.push([m.steps, stateHash(m)]);
    }
    // a calm stretch lets the buffer shrink again (a step every 10 s)
    this.calmFor += dtMs;
    if (this.calmFor > 10000) {
      this.calmFor = 0;
      if (this.buffer > LIVE.buffer.min) this.buffer--;
    }
    return n;
  }

  /**
   * The fight anew from the snapshot with every known entry, run to `toStep` (default: where the shown fight was)
   * without drawing anything. The old match is dropped; the game binds the new one.
   */
  rebuild(toStep = this.match.steps): Match {
    const m = liveMatch(this.snap);
    let k = 0;
    const until = Math.min(toStep, this.frontier());
    this.overHash = null;
    while (m.steps < until) {
      if (m.phase !== 'over') {
        while (k < this.known && (this.journal[k] as LiveInput)[0] <= m.steps) {
          applyLiveInput(m, this.journal[k] as LiveInput);
          k++;
        }
      }
      const was = m.phase;
      m.step(STEP);
      m.drainEvents();
      if (was !== 'over' && m.phase === 'over' && this.overHash === null) this.overHash = stateHash(m);
    }
    this.match = m;
    this.applied = k;
    this.late = false;
    this.stats.rebuilds++;
    // (fingerprints taken before the rebuild may come from the shown, outdated fight — never reported)
    this.hashes.length = 0;
    return m;
  }

  /** How far behind the target the shown fight is (steps). */
  lag(): number {
    return Math.max(0, Math.min(this.target(), this.frontier()) - this.match.steps);
  }
}
