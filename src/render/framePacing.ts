// Beta 2.5.5 — FRAME PACING: the automatic quality's decision, kept apart from WebGL so it can be tested with recorded
// frame-time traces (scripts/pacing-check.ts).
//
// Until 2.5 the automatic quality looked only at the AVERAGE frame time of the last 90 frames (slower than 42 fps → one
// step down). A device that alternates quick and long frames (16 / 33 ms — judder) can average under that line and
// never step down, although the picture stutters. The owner's rule for 2.5.5: an even 30 fps is better than an uneven
// 40–60. So:
//   1. frequent LONG frames count as struggling too — a fifth of the window over 25 ms → one quality step down, as a
//      slow average always did (a single hitch — a screen change, a set being built — is one frame of 90 and changes
//      nothing);
//   2. a device that still struggles at the LOWEST quality is paced to an even 30 fps: the game draws on every second
//      screen refresh (every fourth at 120 Hz) instead of whenever it can. The fight itself is untouched — the
//      simulation runs on its fixed step and the picture is interpolated, at any frame rate.
// Only in the «Авто» quality setting; choosing a quality by hand turns both off. Never goes back up in a session (as
// before: a device that struggled once will again).

/** The window of frames looked at (as before). */
export const PACING_WINDOW = 90;
/** Slower than this on average → struggling (1 / 42 s, as before). */
export const SLOW_AVG_S = 1 / 42;
/** A frame over this is a long one (25 ms — a missed refresh at 60 Hz and then some). */
export const LONG_FRAME_S = 1 / 40;
/** This share of long frames in the window → struggling, whatever the average says. */
export const LONG_SHARE = 0.2;
/** The paced frame interval (30 fps) and the slack a refresh may come early by. */
export const PACED_INTERVAL_S = 1 / 30;
export const PACED_SLACK_S = 0.004;

export type PacingStep = 'down' | 'pace30' | null;

/** What the automatic quality does after a full window of frame times (seconds). */
export function pacingStep(frameTimes: readonly number[], quality: 'high' | 'medium' | 'low', paced: boolean): PacingStep {
  if (frameTimes.length < PACING_WINDOW) return null;
  const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
  const long = frameTimes.filter((t) => t > LONG_FRAME_S).length / frameTimes.length;
  const struggling = avg > SLOW_AVG_S || long >= LONG_SHARE;
  if (!struggling) return null;
  if (quality !== 'low') return 'down';
  return paced ? null : 'pace30';
}

/** With pacing on: is it too early for the next frame (`elapsed` s since the last one)? */
export function tooEarly(elapsed: number, interval: number): boolean {
  return interval > 0 && elapsed < interval - PACED_SLACK_S;
}
