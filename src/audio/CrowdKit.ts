/**
 * Alpha 1.6.6 — the audience's raw sounds, synthesised (no audio files): a hall full of hands
 * and a hall full of voices. Pure functions writing into Float32Arrays, so they can be checked
 * headless (npm run music); AudioSystem turns them into AudioBuffers once, after the first tap,
 * a slice at a time (never a hitch).
 *
 * Why this replaced the 1.6.5 applause: 24 spectators with a 0.6 ms attack and a 6–14 ms
 * decay made every clap a separate spike (crest ≈ 20 dB, very uneven from one 10 ms to the
 * next) — on a phone speaker a popcorn crackle, «пш-пш-пш». Now: about twice as many, softer
 * hands (2.5–5 ms attack, a 18–32 ms palm decay, a warmer and darker band), uneven pace and
 * strength per person — a wash of applause with a few nearer hands in it — plus human voices
 * (cheers, a roar, «ooh», «aww», shouts, a chattering hall) built from pitched, breathy, rough
 * voices through vowel formants, so the hall sounds like people and not like a noise machine.
 */

/** The sample rate of every crowd buffer: their content is below ~4 kHz, so 24 kHz is plenty (and half the work). */
export const CROWD_SR = 24000;

export interface Stereo {
  L: Float32Array;
  R: Float32Array;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** RBJ band-pass (constant 0 dB peak gain). */
function bandpass(f0: number, q: number, sr: number) {
  const w = (2 * Math.PI * f0) / sr;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  return { b0: alpha / a0, b2: -alpha / a0, a1: (-2 * Math.cos(w)) / a0, a2: (1 - alpha) / a0 };
}

/** Pan law (equal power) for a position in −1..1. */
function pan(p: number): [number, number] {
  return [Math.cos(((p + 1) * Math.PI) / 4), Math.sin(((p + 1) * Math.PI) / 4)];
}

/** Scale to a peak of `peak`. */
export function normalize(buf: Stereo, peak: number): void {
  let m = 0;
  for (let i = 0; i < buf.L.length; i++) m = Math.max(m, Math.abs(buf.L[i]), Math.abs(buf.R[i]));
  if (m <= 0) return;
  const k = peak / m;
  for (let i = 0; i < buf.L.length; i++) {
    buf.L[i] *= k;
    buf.R[i] *= k;
  }
}

// ------------------------------------------------------------------ hands
/**
 * Applause: `people` spectators, each clapping at their own uneven pace (2.8–4.4 claps/s,
 * drifting), with their own hands (a band-passed noise burst centred at 650–1600 Hz, darkened
 * above ~3 kHz) and their own place left / right; a few sit nearer (a little louder and
 * brighter). Written around the end of the buffer, so it loops without a seam. Call once per
 * person (`p` = index) — the caller yields between calls.
 */
export function addClapper(buf: Stereo, sr: number, p: number, people: number): void {
  const { L, R } = buf;
  const n = L.length;
  const secs = n / sr;
  const near = p < Math.max(2, Math.round(people * 0.08));
  const rate = rand(2.8, 4.4);
  const driftP = rand(2, 5);
  const driftPh = rand(0, Math.PI * 2);
  const [gl, gr] = pan(rand(-0.85, 0.85));
  const f = bandpass(rand(650, 1600) + (near ? 250 : 0), rand(0.8, 1.3), sr);
  const lp = Math.exp((-2 * Math.PI * (near ? 3800 : 3000)) / sr);
  const loud = (near ? 0.7 : 0.45) * rand(0.75, 1.1);
  const len = Math.round(0.06 * sr);
  let t = Math.random() / rate;
  while (t < secs) {
    const start = Math.round(t * sr);
    const atk = rand(0.0025, 0.005) * sr;
    const tau = rand(0.018, 0.032) * sr;
    const amp = loud * rand(0.55, 1);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    let l1 = 0;
    let l2 = 0;
    for (let i = 0; i < len; i++) {
      const env = (i < atk ? 0.5 - 0.5 * Math.cos((Math.PI * i) / atk) : Math.exp(-(i - atk) / tau)) * (i > len - 60 ? (len - i) / 60 : 1);
      const x = (Math.random() * 2 - 1) * env * amp;
      const y = f.b0 * x + f.b2 * x2 - f.a1 * y1 - f.a2 * y2;
      x2 = x1;
      x1 = x;
      y2 = y1;
      y1 = y;
      // two gentle one-pole low-passes: no crackle on top
      l1 = l1 * lp + y * (1 - lp);
      l2 = l2 * lp + l1 * (1 - lp);
      const k = (start + i) % n;
      L[k] += l2 * gl;
      R[k] += l2 * gr;
    }
    const pace = rate * (1 + 0.08 * Math.sin((2 * Math.PI * t) / driftP + driftPh));
    t += (1 / pace) * rand(0.82, 1.18);
  }
}

// ----------------------------------------------------------------- voices
type Vowel = 'a' | 'e' | 'o' | 'u' | 'i';
/** Formant bandwidths (Hz) and levels: F1 strongest, F3 faint. */
const BW = [110, 150, 220];
const FG = [1, 0.55, 0.28];
/** Formants (Hz) of an adult voice per vowel. */
const VOWELS: Record<Vowel, [number, number, number]> = {
  a: [750, 1200, 2500],
  e: [550, 1800, 2550],
  o: [520, 880, 2450],
  u: [340, 900, 2300],
  i: [310, 2150, 2900],
};

export interface VoiceSpec {
  /** How many people. */
  voices: number;
  /** Buffer length (s); `loop` writes around its end. */
  secs: number;
  loop?: boolean;
  /** When the voices start (s, spread) and how long each one shouts. */
  spread: number;
  dur: [number, number];
  /** Pitch raise of an excited voice (×). */
  excite: [number, number];
  /** Pitch shape over one shout (u = 0..1 → ×). */
  contour: (u: number) => number;
  /** Vowel at the start → at the end of a shout. */
  vowels: [Vowel, Vowel][];
  /** Breath noise and roughness (how shouty). */
  breath: number;
  rough: number;
  /** Chatter instead of shouts: syllables and pauses (the murmur of a hall). */
  chatter?: boolean;
}

export const VOICES: Record<'cheer' | 'roar' | 'ooh' | 'aww' | 'shout' | 'murmur', VoiceSpec> = {
  // «ye-eah!»: up and back down, eh → ah
  cheer: { voices: 18, secs: 2.2, spread: 0.35, dur: [0.6, 1.25], excite: [1.25, 1.6], contour: (u) => 0.95 + 0.28 * Math.sin(Math.PI * Math.min(1, u * 1.35)), vowels: [['e', 'a'], ['a', 'a'], ['o', 'a']], breath: 0.38, rough: 0.16 },
  // the big one: «wooo-aaah!», longer, higher, more people
  roar: { voices: 26, secs: 3, spread: 0.5, dur: [1.1, 2.2], excite: [1.4, 1.8], contour: (u) => 0.92 + 0.32 * Math.min(1, u * 1.6) - 0.1 * Math.max(0, u - 0.7), vowels: [['o', 'a'], ['u', 'a'], ['e', 'a']], breath: 0.42, rough: 0.2 },
  // «ooh!» — a near miss, a sharp move
  ooh: { voices: 12, secs: 1.4, spread: 0.2, dur: [0.45, 0.9], excite: [1.1, 1.3], contour: (u) => 0.98 + 0.16 * Math.sin(Math.PI * u), vowels: [['u', 'o'], ['o', 'o']], breath: 0.3, rough: 0.1 },
  // «aww…» — falling, ah → oh
  aww: { voices: 14, secs: 2, spread: 0.3, dur: [0.9, 1.5], excite: [1.0, 1.2], contour: (u) => 1.1 - 0.32 * u, vowels: [['a', 'o'], ['a', 'u']], breath: 0.34, rough: 0.12 },
  // one person: «hey!» / «woo!»
  shout: { voices: 1, secs: 0.75, spread: 0.02, dur: [0.35, 0.6], excite: [1.35, 1.7], contour: (u) => 0.9 + 0.4 * Math.min(1, u * 2), vowels: [['e', 'a'], ['u', 'o'], ['o', 'a']], breath: 0.3, rough: 0.12 },
  // people talking: syllables, pauses — a loop; never a steady wash
  murmur: { voices: 14, secs: 6, loop: true, spread: 6, dur: [0, 0], excite: [0.95, 1.1], contour: () => 1, vowels: [['a', 'o'], ['e', 'a'], ['o', 'u'], ['i', 'e']], breath: 0.3, rough: 0.12, chatter: true },
};

/**
 * One person of a voice spec: a pitched glottal buzz (saw) with breath noise and per-cycle
 * roughness, a little vibrato and drift, through three vowel formants that glide from the
 * first vowel to the second; a soft attack and release (chatter: syllables and pauses).
 * Call once per voice — the caller yields between calls.
 */
export function addVoice(buf: Stereo, sr: number, spec: VoiceSpec): void {
  const { L, R } = buf;
  const n = L.length;
  const female = Math.random() < 0.45;
  const f0 = (female ? rand(185, 270) : rand(105, 165)) * rand(spec.excite[0], spec.excite[1]);
  const fk = female ? 1.14 : 1;
  const [gl, gr] = pan(rand(-0.8, 0.8));
  const loud = rand(0.6, 1);
  const vibRate = rand(4.5, 6.5);
  const vibDepth = rand(0.012, 0.03);
  const lpTilt = Math.exp((-2 * Math.PI * 2600) / sr);
  // segments to sing: one shout, or a chatter of syllables
  const segs: { start: number; len: number; v0: Vowel; v1: Vowel; pitch: number }[] = [];
  const pickV = () => spec.vowels[Math.floor(Math.random() * spec.vowels.length)];
  if (spec.chatter) {
    let t = rand(0, 1.5);
    while (t < spec.secs) {
      const syl = 3 + Math.floor(Math.random() * 6);
      const phrasePitch = rand(0.9, 1.12);
      for (let s = 0; s < syl && t < spec.secs; s++) {
        const len = rand(0.1, 0.24);
        const [v0, v1] = pickV();
        segs.push({ start: t, len, v0, v1, pitch: phrasePitch * rand(0.95, 1.06) });
        t += len + rand(0.04, 0.12);
      }
      t += rand(0.45, 1.6);
    }
  } else {
    const [v0, v1] = pickV();
    segs.push({ start: rand(0, spec.spread), len: rand(spec.dur[0], spec.dur[1]), v0, v1, pitch: 1 });
  }
  let phase = Math.random();
  let drift = 0;
  let cycleAmp = 1;
  let tilt = 0;
  // formant filter state and coefficients, reused (no allocation in the sample loop)
  const st = new Float64Array(12);
  const cb0 = new Float64Array(3);
  const cb2 = new Float64Array(3);
  const ca1 = new Float64Array(3);
  const ca2 = new Float64Array(3);
  const setFormants = (A: [number, number, number], B: [number, number, number], g: number) => {
    for (let j = 0; j < 3; j++) {
      const F = (A[j] + (B[j] - A[j]) * g) * fk;
      const c = bandpass(F, F / BW[j], sr);
      cb0[j] = c.b0;
      cb2[j] = c.b2;
      ca1[j] = c.a1;
      ca2[j] = c.a2;
    }
  };
  const BLOCK = 32;
  for (const seg of segs) {
    const s0 = Math.round(seg.start * sr);
    const m = Math.round(seg.len * sr);
    const atk = (spec.chatter ? 0.02 : rand(0.05, 0.1)) * sr;
    const rel = (spec.chatter ? 0.04 : rand(0.2, 0.32)) * sr;
    const A = VOWELS[seg.v0];
    const B = VOWELS[seg.v1];
    for (let b = 0; b < m; b += BLOCK) {
      const u = b / m;
      // per block: the vowel glides (formants a little higher for higher voices, bands a bit
      // wide — a crowd, not a choir), pitch follows the shout's shape with vibrato and drift
      if ((b & 63) === 0) setFormants(A, B, Math.min(1, u * 1.4));
      drift = Math.max(-0.03, Math.min(0.03, drift + (Math.random() - 0.5) * 0.02));
      const tb = (s0 + b) / sr;
      const inc = (f0 * seg.pitch * spec.contour(u) * (1 + vibDepth * Math.sin(2 * Math.PI * vibRate * tb)) * (1 + drift)) / sr;
      const end = Math.min(m, b + BLOCK);
      for (let i = b; i < end; i++) {
        const k = s0 + i;
        if (!spec.loop && k >= n) break;
        phase += inc;
        if (phase >= 1) {
          phase -= 1;
          cycleAmp = 1 + (Math.random() * 2 - 1) * spec.rough;
        }
        tilt = tilt * lpTilt + (2 * phase - 1) * cycleAmp * (1 - lpTilt);
        const src = tilt * 1.6 + (Math.random() * 2 - 1) * spec.breath;
        let y = 0;
        for (let j = 0; j < 3; j++) {
          const o = j * 4;
          const v = cb0[j] * src + cb2[j] * st[o + 1] - ca1[j] * st[o + 2] - ca2[j] * st[o + 3];
          st[o + 1] = st[o];
          st[o] = src;
          st[o + 3] = st[o + 2];
          st[o + 2] = v;
          y += v * FG[j];
        }
        const env = (i < atk ? 0.5 - 0.5 * Math.cos((Math.PI * i) / atk) : 1) * (i > m - rel ? Math.max(0, (m - i) / rel) : 1);
        const out = y * env * loud;
        const w = spec.loop ? k % n : k;
        L[w] += out * gl;
        R[w] += out * gr;
      }
    }
  }
}

/** Is a buffer free of steps at its ends (a one-shot starts and ends at silence)? Max |sample| in the first / last 2 ms. */
export function edgeLevel(buf: Stereo, sr: number): number {
  const w = Math.round(0.002 * sr);
  let m = 0;
  for (let i = 0; i < w; i++) m = Math.max(m, Math.abs(buf.L[i]), Math.abs(buf.L[buf.L.length - 1 - i]));
  return m;
}
