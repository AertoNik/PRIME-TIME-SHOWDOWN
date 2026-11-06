// Alpha 1.9.5 — the PRIME NETWORK server's clock for the seasonal calendar.
//
// The seasonal exchange (tokens) closes and the paid way opens at the end of an event BY THE SERVER'S CLOCK
// (lib/checkout.js «seasonal_only» uses it; a cloud save with an exchange purchase made after the end is refused —
// lib/prime.js). So that a device clock set back or forward cannot reopen the exchange or close it early, the game
// takes the server's time from GET /api/prime/config (`time`, ms) and keeps the difference to the device clock.
// Without a server answer (offline, guest, a server older than 1.9.5) the device clock is used, as before.

let offset = 0;
let known = false;

/**
 * The server's `time` read from a response that left at `sentAt` and came back at `receivedAt` (device ms). The
 * answer's moment is taken as the middle of the round trip; a trip longer than 10 s or a missing time changes nothing.
 */
export function noteServerTime(serverMs: unknown, sentAt: number, receivedAt: number): boolean {
  if (typeof serverMs !== 'number' || !Number.isFinite(serverMs) || serverMs <= 0) return false;
  const trip = receivedAt - sentAt;
  if (!(trip >= 0) || trip > 10000) return false;
  offset = Math.round(serverMs - (sentAt + trip / 2));
  known = true;
  return true;
}

/** «Now» for the seasonal calendar: the server's clock once known, the device's otherwise. */
export function serverNow(): number {
  return Date.now() + offset;
}

/** The server's time is known (an answer of a 1.9.5+ server this session). */
export function serverTimeKnown(): boolean {
  return known;
}

/** How far the device clock is from the server's (ms; + = the device is behind). 0 while unknown. */
export function serverOffset(): number {
  return offset;
}

/** Tests only. */
export function resetServerClock(): void {
  offset = 0;
  known = false;
}
