import { MUSIC_MIX, MUSIC_TRACKS, type MusicId } from '../config/music.config';

/** One scheduled pass through the song. */
interface Voice {
  src: AudioBufferSourceNode;
  env: GainNode;
}

/** The track that is playing (or fading in / out). */
interface Playing {
  id: MusicId;
  buffer: AudioBuffer;
  /** Track level × fades. */
  gain: GainNode;
  voices: Voice[];
  /** Loop window: the audible part of the song, seconds into the buffer. */
  a: number;
  b: number;
  /** Audio-clock time the next pass starts. */
  nextAt: number;
  alive: boolean;
}

/** Splice at the loop point: the old pass fades out over the last 40 ms, the new one fades in over 12 ms. */
const SEAM_OUT = 0.04;
const SEAM_IN = 0.012;
/** Every start is scheduled at least this far ahead of the audio clock (a start "now" can lose its first samples). */
const LEAD = 0.03;

/**
 * Alpha 1.6.3 — PRIME SOUNDTRACK. Plays the MP3 soundtrack through the game's AudioContext
 * (music bus → master → limiter), so the music and sound toggles, the background pause and
 * iOS unlocking work exactly like the SFX.
 *
 * - Loads only what is asked for: the encoded file is fetched once (the last `keepFiles` stay
 *   in memory), decoded when needed; only the playing track stays decoded.
 * - Each song plays through its audible part — leading digital silence, trailing silence and
 *   the inaudible end of a fade-out (`tailDb` under the track's average) are skipped — and
 *   repeats on a sample-accurate schedule with a few-millisecond splice: no gap, no click.
 *   The window is found in the decoded audio, so a replaced file needs no new numbers.
 * - A change of track fades the old one out completely, then fades the new one in; asking for
 *   the track that already plays changes nothing.
 * - A failed load or decode is reported once in the console and leaves the game silent of
 *   music — never broken.
 */
export class MusicPlayer {
  private want: MusicId | null = null;
  private enabled = true;
  private cur: Playing | null = null;
  private fading: Playing[] = [];
  /** Audio-clock time the last fade-out is over: nothing new starts before it. */
  private quietAt = 0;
  private decoding = new Map<MusicId, Promise<AudioBuffer | null>>();
  private failed = new Set<MusicId>();
  /** A track decoded ahead of time (the menu music during the results sting). */
  private prepared: { id: MusicId; buffer: AudioBuffer } | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: AudioNode,
    private readonly files: MusicFiles,
  ) {
    // iOS / Safari: the context may start running only on a later tap (or after a call) —
    // the wanted track starts then
    ctx.addEventListener('statechange', () => this.sync());
  }

  /** The track the game asks for (null: no music). Asking again for the same track does nothing. */
  play(id: MusicId | null): void {
    if (id === this.want) return;
    this.want = id;
    // a file that failed (offline for a moment) gets another try when it is asked for again
    if (id) this.failed.delete(id);
    // something else was asked for: a track decoded ahead for later is not needed now
    if (id && this.prepared && this.prepared.id !== id) this.prepared = null;
    this.sync();
  }

  /**
   * Decode `id` now and keep it ready, so a later play(id) starts at once (the results screen
   * asks for the menu music while the win / lose sting plays). Only one such track is kept.
   */
  prepare(id: MusicId): void {
    if (!this.enabled || this.cur?.id === id || this.prepared?.id === id || this.ctx.state !== 'running') return;
    this.prepared = null;
    void this.decode(id).then((buffer) => {
      if (buffer && this.cur?.id !== id) this.prepared = { id, buffer };
    });
  }

  /** Music off (or all sound off): stop and free the decoded audio; back on: start the wanted track. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.sync();
  }

  /** For checks and debugging. */
  get state(): { want: MusicId | null; playing: MusicId | null; fading: number; window: [number, number] | null; gain: number; files: MusicId[] } {
    const p = this.cur;
    return {
      want: this.want,
      playing: p?.id ?? null,
      fading: this.fading.length,
      window: p ? [p.a, p.b] : null,
      gain: p ? p.gain.gain.value : 0,
      files: this.files.list,
    };
  }

  /** Bring what plays in line with what is wanted (also called when the context starts running). */
  sync(): void {
    const target = this.enabled ? this.want : null;
    if (this.cur?.id === target) return;
    if (this.cur) {
      this.fadeOut(this.cur);
      this.cur = null;
    }
    if (!target || this.failed.has(target)) {
      this.prepared = null;
      return;
    }
    if (this.ctx.state !== 'running') return; // started by sync() once the context runs
    const ready = this.prepared?.id === target ? Promise.resolve(this.prepared.buffer) : this.decode(target);
    void ready.then((buffer) => {
      const still = this.enabled ? this.want : null;
      if (!buffer || still !== target || this.cur) return;
      this.prepared = null;
      this.start(target, buffer);
    });
  }

  // ------------------------------------------------------------------ loading
  private decode(id: MusicId): Promise<AudioBuffer | null> {
    const pending = this.decoding.get(id);
    if (pending) return pending;
    const job = this.files
      .get(id)
      .then(
        (bytes) =>
          new Promise<AudioBuffer>((resolve, reject) => {
            // decodeAudioData detaches its input: decode a copy, keep the file for next time.
            // Callback form too: older Safari does not return a promise.
            const p = this.ctx.decodeAudioData(bytes.slice(0), resolve, reject);
            if (p && typeof p.catch === 'function') p.catch(reject);
          }),
      )
      .catch((err: unknown) => {
        this.failed.add(id);
        console.warn(`[music] ${MUSIC_TRACKS[id].file} could not be loaded — playing without it.`, err);
        return null;
      })
      .finally(() => this.decoding.delete(id));
    this.decoding.set(id, job);
    return job;
  }

  // ----------------------------------------------------------------- playback
  private start(id: MusicId, buffer: AudioBuffer): void {
    const ctx = this.ctx;
    const def = MUSIC_TRACKS[id];
    const level = (def.role === 'menu' ? MUSIC_MIX.menu : MUSIC_MIX.battle) * Math.pow(10, (MUSIC_MIX.reference - def.lufs) / 20);
    const [a, b] = loopWindow(buffer, MUSIC_MIX.tailDb);
    const gain = ctx.createGain();
    gain.connect(this.out);
    const when = Math.max(ctx.currentTime + LEAD, this.quietAt);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(level, when + MUSIC_MIX.fadeIn);
    const p: Playing = { id, buffer, gain, voices: [], a, b, nextAt: when, alive: true };
    this.cur = p;
    // one pass playing, the next one already queued
    this.pass(p);
    this.pass(p);
  }

  /** Schedule one pass of the song at `p.nextAt`. */
  private pass(p: Playing): void {
    const ctx = this.ctx;
    const len = p.b - p.a;
    const when = Math.max(p.nextAt, ctx.currentTime + LEAD);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(1, when + SEAM_IN);
    env.gain.setValueAtTime(1, when + len - SEAM_OUT);
    env.gain.linearRampToValueAtTime(0, when + len);
    env.connect(p.gain);
    const src = ctx.createBufferSource();
    src.buffer = p.buffer;
    src.connect(env);
    src.start(when, p.a, len);
    const v: Voice = { src, env };
    p.voices.push(v);
    // the next pass starts as this one fades: the splice overlaps by SEAM_IN
    p.nextAt = when + len - SEAM_IN;
    src.onended = () => {
      src.disconnect();
      env.disconnect();
      p.voices = p.voices.filter((x) => x !== v);
      if (p.alive) this.pass(p);
      else if (p.voices.length === 0) this.release(p);
    };
  }

  private fadeOut(p: Playing): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const g = p.gain.gain;
    p.alive = false;
    // hold the level it has right now (it may still be fading in), then ramp to silence
    if (typeof g.cancelAndHoldAtTime === 'function') g.cancelAndHoldAtTime(now);
    else {
      const v = g.value;
      g.cancelScheduledValues(now);
      g.setValueAtTime(v, now);
    }
    const end = now + MUSIC_MIX.fadeOut;
    g.linearRampToValueAtTime(0, end);
    this.quietAt = Math.max(this.quietAt, end);
    for (const v of p.voices) {
      try {
        v.src.stop(end + 0.02);
      } catch {
        // a queued pass that never started: stop() before start time is fine, a second stop() throws
      }
    }
    this.fading.push(p);
  }

  /** Drop the nodes and the decoded audio of a track that has faded out. */
  private release(p: Playing): void {
    p.gain.disconnect();
    this.fading = this.fading.filter((x) => x !== p);
  }
}

/**
 * The encoded MP3 files: fetched on first use (or prefetched — the menu track while the title
 * screen loads, before an AudioContext may exist), the last `keep` stay in memory.
 */
export class MusicFiles {
  private files = new Map<MusicId, Promise<ArrayBuffer>>();

  constructor(
    private readonly base: string,
    private readonly keep: number,
  ) {}

  get(id: MusicId): Promise<ArrayBuffer> {
    let f = this.files.get(id);
    if (f) this.files.delete(id); // most recently used goes last
    else {
      f = fetch(this.base + MUSIC_TRACKS[id].file).then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      });
      // a failed download is forgotten, so the next request tries again
      f.catch(() => {
        if (this.files.get(id) === f) this.files.delete(id);
      });
    }
    this.files.set(id, f);
    while (this.files.size > this.keep) this.files.delete(this.files.keys().next().value!);
    return f;
  }

  get list(): MusicId[] {
    return [...this.files.keys()];
  }
}

/**
 * The audible part of a song [start, end] in seconds: from the first sound (−60 dBFS) to the
 * point where its ending has fallen `tailDb` under the song's average level for good. Cheap
 * (it runs on the main thread): the average is taken on every 32nd sample, the ends are
 * scanned in short windows.
 */
export function loopWindow(buf: AudioBuffer, tailDb: number): [number, number] {
  const sr = buf.sampleRate;
  const n = buf.length;
  const ch: Float32Array[] = [];
  for (let c = 0; c < buf.numberOfChannels; c++) ch.push(buf.getChannelData(c));
  const power = (from: number, to: number, stride: number): number => {
    let s = 0;
    let k = 0;
    for (let i = Math.max(0, from); i < Math.min(n, to); i += stride) {
      for (const d of ch) s += d[i] * d[i];
      k += ch.length;
    }
    return k ? s / k : 0;
  };
  const avg = power(0, n, 32);
  // start: first 10 ms window above −60 dBFS (5 ms earlier, to keep the attack whole)
  const w0 = Math.round(0.01 * sr);
  let a = 0;
  for (let s = 0; s < Math.min(n, 5 * sr); s += w0) {
    if (power(s, s + w0, 1) > 1e-6) {
      a = Math.max(0, s - Math.round(0.005 * sr));
      break;
    }
  }
  // end: last 100 ms window (within the final 30 s) still above avg + tailDb
  const w1 = Math.round(0.1 * sr);
  const floor = avg * Math.pow(10, tailDb / 10);
  let b = n;
  for (let s = n - w1; s > Math.max(a, n - 30 * sr); s -= w1) {
    if (power(s, s + w1, 4) > floor) {
      // refine inside that window to 10 ms, so a song that stops dead loops without a breath
      b = Math.min(n, s + w1);
      while (b - w0 > s && power(b - w0, b, 1) <= floor) b -= w0;
      break;
    }
  }
  // a broken or very short file: just loop all of it
  if (b - a < 5 * sr) return [0, n / sr];
  return [a / sr, b / sr];
}
