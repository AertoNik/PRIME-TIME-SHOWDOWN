import { isArenaId, type ArenaId } from '../config/arenas.config';
import { FIGHTERS } from '../config/fighters';
import { LEAGUE } from '../config/league.config';
import { LOOKS } from '../config/looks';
import type { FighterId } from '../config/types';
import type { LeagueInput } from '../league/replay';
import { SIM_VERSION } from '../league/simVersion';
import { LeagueApi, type LeagueArenaPref, type LeagueFinish, type LeagueMatch, type LeagueMe } from '../net/LeagueApi';
import { PrimeApiError } from '../net/PrimeApi';
import type { Game } from './Game';

// Alpha 1.9.0 PRIME LEAGUE — the game's side of a league fight. It never decides anything: it plays the fight the
// server fixed (seed, set, both sides), records the player's taps with the fixed step they came before, sends them as
// checkpoints every few seconds (a lost connection loses nothing) and at the end; the SERVER replays them and answers
// with the result it computed. The fight on screen and the server's replay are the same code, bit for bit.

/**
 * Where «В БОЙ!» goes: the career's modes or PRIME LEAGUE (a per-device convenience — never in the save).
 * 1.9.1: only an EXPLICIT choice is kept — a card of the «Выберите эфир» window or the switch in a screen's head.
 * 1.9.0 wrote «career» on every visit of the career (also while the league was off), so its key is not read.
 */
const ENTRY_KEY = 'primetime-fight-entry-v2';
const OLD_ENTRY_KEY = 'primetime-fight-entry-v1';
export type FightEntry = 'career' | 'league';

export function lastEntry(): FightEntry | null {
  try {
    const v = localStorage.getItem(ENTRY_KEY);
    return v === 'career' || v === 'league' ? v : null;
  } catch {
    return null;
  }
}
export function rememberEntry(v: FightEntry): void {
  try {
    localStorage.setItem(ENTRY_KEY, v);
    localStorage.removeItem(OLD_ENTRY_KEY);
  } catch {
    /* this page only */
  }
}

/** 1.9.3: the league's permanent sets (league_rules.arenas) — all a server without a set list offers. */
export const LEAGUE_ARENAS: ArenaId[] = LEAGUE.arenas.filter((a) => isArenaId(a));

/**
 * 1.9.3: the sets the player may pick now — exactly the server's list (`me.arenas`, by the server's clock: permanent sets
 * plus a seasonal one while its event runs), in the catalogue's order; a set this game does not know is left out. A
 * server that sends no list (before 1.9.3) has the permanent sets only.
 */
export function leagueArenaList(me: LeagueMe | null | undefined): ArenaId[] {
  return Array.isArray(me?.arenas) ? me.arenas.filter((a): a is ArenaId => isArenaId(a)) : LEAGUE_ARENAS.slice();
}

/** 1.9.3: the set last chosen before a league fight (this browser only; RANDOM until one is chosen). */
const ARENA_KEY = 'primetime-league-arena-v1';
export function lastLeagueArena(): LeagueArenaPref {
  try {
    const v = localStorage.getItem(ARENA_KEY);
    // (whether it is open right now is the pre-start window's question: it offers the server's list)
    return isArenaId(v) ? v : 'random';
  } catch {
    return 'random';
  }
}
export function rememberLeagueArena(v: LeagueArenaPref): void {
  try {
    localStorage.setItem(ARENA_KEY, v);
  } catch {
    /* this page only */
  }
}

/**
 * 1.9.3: the look a league fighter is drawn in. A skin from the server is honoured only when this game knows it and it
 * is made for that very fighter; anything else (a newer skin, old data, a forged value) is the fighter's own look —
 * a picture is never allowed to break a fight (looks are rendering only, the server judges the fight without them).
 */
export function leagueLook(fighter: FighterId, look: string | null | undefined): string {
  const own = FIGHTERS[fighter]?.look ?? 'ray';
  if (!look || !LOOKS[look]) return own;
  return (LOOKS[look].base ?? look) === fighter ? look : own;
}

export type LeagueAccess =
  /** The server has no league (or it is switched off). */
  | 'off'
  /** No PRIME ID on this page (a guest career): the league can be read about, not played. */
  | 'guest'
  /** Signed in, email not confirmed yet. */
  | 'unverified'
  /** The account plays here, but its session / documents hold matches back (see AccountRuntime.gate). */
  | 'held'
  | 'ready';

export interface LeagueFight {
  view: LeagueMatch;
  taps: LeagueInput[];
  /** Taps the server already holds. */
  sent: number;
  lastCk: number;
}

export class LeagueRuntime {
  me: LeagueMe | null = null;
  fight: LeagueFight | null = null;
  /** The last settled fight (the results screen reads it). */
  last: LeagueFinish | null = null;
  /** The fingerprint of the fight this page showed (sent for diagnostics; the server never trusts it). */
  localHash: number | null = null;
  private listeners = new Set<() => void>();
  private ckBusy = false;

  constructor(private readonly g: Game) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  access(): LeagueAccess {
    const acc = this.g.account;
    const cfg = acc?.serverConfig;
    if (!acc || !cfg || !cfg.league.on) return 'off';
    const v = acc.view();
    if (v.kind === 'unverified') return 'unverified';
    if (v.kind !== 'account') return 'guest';
    if (v.gate) return 'held';
    return 'ready';
  }

  /** The server runs other fight rules than this page (the page is older or newer): ask to reload. */
  outdated(): boolean {
    const s = this.g.account?.serverConfig?.league.sim;
    return !!s && s !== SIM_VERSION;
  }

  api(): LeagueApi | null {
    const a = this.g.account?.api;
    return a ? new LeagueApi(a) : null;
  }

  async refresh(): Promise<LeagueMe | null> {
    const api = this.api();
    if (!api || this.access() !== 'ready') return null;
    this.me = await api.me();
    this.emit();
    return this.me;
  }

  setMe(me: LeagueMe | undefined): void {
    if (!me) return;
    this.me = me;
    this.emit();
  }

  /** Starts showing a fight the server fixed (a new one, or one resumed after a reload with the taps it holds). */
  begin(view: LeagueMatch): void {
    const held = (view.inputs ?? []).slice() as LeagueInput[];
    this.fight = { view, taps: held, sent: held.length, lastCk: 0 };
    this.last = null;
    this.g.launchLeague(view, held);
  }

  /** A tap that reached the fight (Game.playCard) — recorded with the fixed step it came before. */
  tap(step: number, index: number): void {
    if (this.fight && this.fight.taps.length < LEAGUE.match.maxInputs) this.fight.taps.push([step, index]);
  }
  forfeitTap(step: number): void {
    if (this.fight) this.fight.taps.push([step, -1]);
  }

  /** Called every frame of a league fight: a checkpoint every few seconds of fight while new taps wait. */
  tick(step: number): void {
    const f = this.fight;
    if (!f || this.ckBusy || f.taps.length <= f.sent || step - f.lastCk < LEAGUE.match.checkpointSeconds * 60) return;
    const api = this.api();
    if (!api) return;
    f.lastCk = step;
    const taps = f.taps.slice();
    this.ckBusy = true;
    api
      .checkpoint(f.view.id, taps)
      .then(() => {
        if (this.fight === f) f.sent = Math.max(f.sent, taps.length);
      })
      .catch(() => {
        /* the next checkpoint or the finish carries them */
      })
      .finally(() => {
        this.ckBusy = false;
      });
  }

  /**
   * The end of the fight on screen: the taps go to the server, which replays them. A finish sent sooner than the
   * fight lasted in real time is answered «too_early» with the wait; a lost connection is retried (the finish is
   * idempotent — a repeat gets the stored result). Resolves with the server's result.
   */
  async finish(onWait?: (ms: number) => void): Promise<LeagueFinish> {
    const f = this.fight;
    if (!f) throw new PrimeApiError('network', 'no_fight', 0);
    const api = this.api();
    if (!api) throw new PrimeApiError('unauthorized', 'signed_out', 401);
    let tries = 0;
    for (;;) {
      try {
        const r = await api.finish(f.view.id, f.taps, this.localHash ?? undefined);
        this.last = r;
        this.fight = null;
        if (r.profile) this.me = r.profile;
        this.emit();
        return r;
      } catch (e) {
        const err = e instanceof PrimeApiError ? e : null;
        if (err?.code === 'too_early' || err?.code === 'finishing') {
          const wait = Math.min(15000, Math.max(500, Number(err.data.wait) || 1000));
          onWait?.(wait);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        // a rare 429 (a busy shared address or a burst): wait as the server says — a few times, never a tight loop; the
        // finish is idempotent, so a repeat can never settle or pay twice
        if (err?.kind === 'rate' && tries < 3) {
          tries++;
          const wait = Math.min(20000, Math.max(1000, Number(err.data.wait) || 2000 * tries));
          onWait?.(wait);
          await new Promise((r) => setTimeout(r, wait));
          continue;
        }
        if ((!err || err.kind === 'network') && tries < 4) {
          tries++;
          await new Promise((r) => setTimeout(r, 1500 * tries));
          continue;
        }
        throw e;
      }
    }
  }

  /** The fight left without an end (the page closes): the server settles it from the checkpoint at its deadline. */
  abandon(): void {
    this.fight = null;
  }
}
