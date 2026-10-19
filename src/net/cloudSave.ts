import { VERSION, parseObject, sanitize, savedVersion, summarize, unknownFields, type SaveData, type SaveSummary } from '../meta/SaveSystem';
import { sha256 } from './sha256';

// Alpha 1.8.1 — the account copy of a save. The cloud keeps the very same SaveData the game writes
// locally (no second economy, no second set of counters), with two differences:
//   - the device settings (sound, music, quality, camera) stay on each device and are not sent;
//   - the JSON is canonical (keys sorted), so the same progress always has the same text and the
//     same SHA-256 on every device — «changed since the last upload?» is a hash comparison.

/** JSON with object keys sorted at every level (undefined dropped, like JSON.stringify). */
export function canonicalJSON(v: unknown): string {
  if (v === null || typeof v !== 'object') {
    const s = JSON.stringify(v);
    return s === undefined ? 'null' : s;
  }
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined || typeof x === 'function' ? 'null' : canonicalJSON(x))).join(',') + ']';
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined && typeof o[k] !== 'function')
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(o[k])).join(',') + '}';
}

export interface CloudCopy {
  text: string;
  hash: string;
}

/** The account copy of a save text as SaveSystem writes it (see SaveSystem.serialized). */
export function cloudCopyOf(serialized: string): CloudCopy {
  const obj = JSON.parse(serialized) as Record<string, unknown>;
  delete obj.settings;
  const text = canonicalJSON(obj);
  return { text, hash: sha256(text) };
}

export type CloudRead =
  | { ok: true; data: SaveData; extra: Record<string, unknown>; version: number; summary: SaveSummary }
  | { ok: false; reason: 'damaged' | 'newer'; version: number };

/**
 * Read a cloud save text with the game's own rules (sanitize — the same path as a local save or
 * an imported file). A newer schema is not read at all (its unknown fields would be lost).
 */
export function readCloudText(text: string): CloudRead {
  const obj = typeof text === 'string' ? parseObject(text) : null;
  if (!obj || !('fighters' in obj) || !('money' in obj)) return { ok: false, reason: 'damaged', version: 0 };
  const version = savedVersion(obj);
  if (version > VERSION) return { ok: false, reason: 'newer', version };
  const data = sanitize(obj);
  return { ok: true, data, extra: unknownFields(obj), version, summary: summarize(data, version) };
}
