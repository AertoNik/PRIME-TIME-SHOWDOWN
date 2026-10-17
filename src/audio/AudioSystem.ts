import type { PropKind } from '../config/arenas.config';
import { MUSIC_MIX, type MusicId } from '../config/music.config';
import type { CardId, WeaponType } from '../config/types';
import { MusicFiles, MusicPlayer } from './MusicPlayer';

type Wave = OscillatorType;

interface ToneOpts {
  type?: Wave;
  f0: number;
  f1?: number;
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  detune?: number;
  filter?: { type: BiquadFilterType; f0: number; f1?: number; q?: number };
  bus?: 'sfx' | 'music';
  /** Alpha 1.6.4: a node of its own to play into (one crowd reaction), instead of the bus. */
  out?: AudioNode;
}

interface NoiseOpts {
  dur: number;
  gain?: number;
  attack?: number;
  delay?: number;
  type?: BiquadFilterType;
  f0?: number;
  f1?: number;
  q?: number;
  bus?: 'sfx' | 'music';
  /** Alpha 1.6.4: a node of its own to play into (one crowd reaction), instead of the bus. */
  out?: AudioNode;
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
/**
 * Alpha 1.6: every voice starts at least this far ahead of the audio clock. A voice whose start
 * falls on (or just behind) the clock — a sequencer tick that ran late after a stall of the main
 * thread, or an effect fired "now" — skips part of its attack ramp; measured offline, a kick 3 ms
 * late has a ~5× sharper first sample (an audible click). 10 ms is far below what the ear hears
 * as late.
 */
const MIN_LEAD = 0.01;

/**
 * Alpha 1.6.4 — the audience. A quiet murmur under the fight; short reactions to real moments,
 * one at a time, with pauses; applause for a win. Levels were set by measurement against the
 * music (≈ −31 LUFS) and the fight SFX (≈ −29 LUFS) — the bed sits ~20 dB under the music,
 * a small reaction ≈ −39, an expressive one ≈ −34, a spectacular one / the applause ≈ −30.
 */
const CROWD = {
  /** Murmur gain of the full fight bed (setCrowd(1)); a calm fight runs at `rest` of it. */
  bed: 0.022,
  rest: 0.75,
  /** Seconds a new reaction waits after the previous one: small / expressive / spectacular. */
  gap: [3.5, 1.2, 0] as const,
  /** An expressive reaction does not repeat sooner than this (a spectacular one may cut in). */
  gap2: 2.5,
  /** Small moments get a reaction only now and then. */
  smallChance: 0.55,
  /** A quiet murmur swell now and then while the fight goes on (seconds between). */
  ambient: [7, 15] as const,
  /** Voice gains per tier (formant layers) and clap gains. */
  voice: [0.2, 0.32, 0.5] as const,
  clap: [0.05, 0.075, 0.1] as const,
};

/**
 * Procedural SFX synthesised on demand and the crowd ambience; the soundtrack
 * (Alpha 1.6.3) is the MP3 music of public/audio/music, played by MusicPlayer
 * on the music bus. Starts only after the first user gesture (browser
 * autoplay policy).
 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private crowdGain!: GainNode;
  private crowdFilter!: BiquadFilterNode;
  private noiseBuf!: AudioBuffer;
  private last = new Map<string, number>();
  soundOn = true;
  musicOn = true;
  /** Alpha 1.6.3: the MP3 soundtrack (created with the context) and its files (relative URL: works with Vite base './'). */
  private player: MusicPlayer | null = null;
  private readonly musicFiles = new MusicFiles(import.meta.env.BASE_URL, MUSIC_MIX.keepFiles);
  /** The track asked for before the context existed. */
  private musicWant: MusicId | null = null;
  /** Show rating 0..1: a hotter show gets a slightly louder crowd. */
  intensity = 0.3;
  /** Alpha 1.6.4 crowd state (audio-clock times). */
  private crowdLast = -99;
  private crowdLast2 = -99;
  private crowdTier = 0;
  private crowdUntil = 0;
  private ambientAt = 0;
  private bedLevel = -1;
  /** The reaction playing now (its own gain node): a bigger moment fades it out before it starts. */
  private crowdBus: GainNode | null = null;

  get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.build();
    }
    // iOS reports 'interrupted' after calls/app switches; any non-running state needs a resume.
    // The music starts once the context really runs (MusicPlayer listens to statechange).
    if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') void this.ctx.resume().catch(() => {});
  }

  private build(): void {
    const ctx = this.ctx!;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    // Alpha 1.5.5: headroom on the very end. The glue compressor is not a limiter and the
    // browser adds make-up gain to it, so in a crowded moment (heavy hits + KO + crowd + kick)
    // the output measured up to 0.95–0.97 of full scale — one more voice and it clips (crackle).
    // A hard-knee limiter catches the peaks and a fixed trim keeps the result below the ceiling.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    const trim = ctx.createGain();
    trim.gain.value = 0.85;
    comp.connect(limiter);
    limiter.connect(trim);
    trim.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = this.soundOn ? 0.9 : 0;
    this.master.connect(comp);
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.75;
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = this.musicOn ? 0.32 : 0;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // crowd bed — Alpha 1.6.4: the low murmur of a full house, steady and quiet. Before, it was
    // band-passed noise swept by a 0.3 Hz filter LFO (the "sea waves"), looping a 2 s buffer
    // and rising with the show rating to within ~3 dB of the music (the constant "shhh").
    // Now: its own 9 s noise loop (no audible repetition), 140–650 Hz, no sweep.
    const bedLen = ctx.sampleRate * 9;
    const bedBuf = ctx.createBuffer(1, bedLen, ctx.sampleRate);
    const bd = bedBuf.getChannelData(0);
    for (let i = 0; i < bedLen; i++) bd[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = bedBuf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 140;
    hp.Q.value = 0.6;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'lowpass';
    this.crowdFilter.frequency.value = 650;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(hp).connect(this.crowdFilter).connect(this.crowdGain).connect(this.sfx);
    src.start();

    // Alpha 1.6.3: the soundtrack, on the music bus
    this.player = new MusicPlayer(ctx, this.music, this.musicFiles);
    this.player.setEnabled(this.musicOn && this.soundOn);
    this.player.play(this.musicWant);
  }

  /** Pause all audio while the page is in the background. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => {});
    else void this.ctx.resume().catch(() => {});
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
    // no sound at all: the soundtrack stops and frees its audio (it restarts when sound is back)
    this.player?.setEnabled(this.musicOn && on);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1);
    this.player?.setEnabled(on && this.soundOn);
  }

  /** For checks and debugging: what the soundtrack is doing. */
  get musicState(): MusicPlayer['state'] | null {
    return this.player?.state ?? null;
  }

  /** 0..1 loudness of the crowd murmur (1 = a fight at a hot show; menus run it very low). */
  setCrowd(level: number): void {
    if (!this.ctx || Math.abs(level - this.bedLevel) < 0.005) return;
    this.bedLevel = level;
    this.crowdGain.gain.setTargetAtTime(level * CROWD.bed, this.ctx.currentTime, 0.6);
  }

  /**
   * Alpha 1.6.4: the audience during a fight, every frame. The murmur rises only a little with
   * the show rating (+2.5 dB at most); while the fight runs, a quiet murmur swell comes now and
   * then — never right after a reaction.
   */
  crowdTick(fighting: boolean, rating: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.setCrowd(CROWD.rest + (1 - CROWD.rest) * Math.min(1, Math.max(0, rating)));
    if (!fighting || !this.soundOn) return;
    const now = ctx.currentTime;
    const [a, b] = CROWD.ambient;
    if (this.ambientAt === 0 || this.ambientAt - now > b) this.ambientAt = now + a + Math.random() * (b - a);
    if (now < this.ambientAt) return;
    this.ambientAt = now + a + Math.random() * (b - a);
    if (now - this.crowdLast < 4) return;
    // a ripple through the stands: a low swell, sometimes a few hands
    this.noise({ dur: 1.6, gain: 0.07, attack: 0.5, type: 'bandpass', f0: 480, f1: 420, q: 1.2 });
    if (Math.random() < 0.35) this.claps(3 + Math.floor(Math.random() * 3), 0.9, CROWD.clap[0] * 0.6, 0.2);
  }

  private throttle(key: string, ms: number): boolean {
    const now = performance.now();
    const l = this.last.get(key) ?? 0;
    if (now - l < ms) return false;
    this.last.set(key, now);
    return true;
  }

  // ------------------------------------------------------------- primitives
  private tone(o: ToneOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t0 = ctx.currentTime + Math.max(MIN_LEAD, o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.f0, t0);
    if (o.f1 !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t0 + o.dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    const atk = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    let node: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter.type;
      f.frequency.setValueAtTime(o.filter.f0, t0);
      if (o.filter.f1) f.frequency.exponentialRampToValueAtTime(o.filter.f1, t0 + o.dur);
      f.Q.value = o.filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(o.out ?? (o.bus === 'music' ? this.music : this.sfx));
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t0 = ctx.currentTime + Math.max(MIN_LEAD, o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const rate = 0.8 + Math.random() * 0.4;
    src.playbackRate.value = rate;
    // Alpha 1.5.5: the random start inside the 2 s noise buffer must leave room for the whole
    // sound — before, long noises (0.6–1.4 s) could run off the end of the buffer mid-envelope
    // and stop abruptly (an audible click). Very long ones simply loop the noise.
    const need = o.dur * rate + 0.03;
    const room = this.noiseBuf.duration - need;
    if (room < 0) src.loop = true;
    const offset = room > 0 ? Math.random() * Math.min(1.5, room) : 0;
    const f = ctx.createBiquadFilter();
    f.type = o.type ?? 'lowpass';
    f.frequency.setValueAtTime(o.f0 ?? 2000, t0);
    if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + o.dur);
    f.Q.value = o.q ?? 0.8;
    const g = ctx.createGain();
    const peak = o.gain ?? 0.3;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f).connect(g).connect(o.out ?? (o.bus === 'music' ? this.music : this.sfx));
    src.start(t0, offset);
    src.stop(t0 + o.dur + 0.02);
  }

  // ------------------------------------------------------------------- sfx
  shoot(weapon: WeaponType, heavy: boolean, enemy: boolean): void {
    if (!this.throttle('shoot' + weapon + enemy, heavy ? 0 : 45)) return;
    const v = enemy ? 0.7 : 1;
    if (heavy && weapon === 'pulse_rifle') {
      // CHARGED SHOT: rail crack with a bright zing tail
      this.tone({ type: 'sawtooth', f0: 2400, f1: 180, dur: 0.38, gain: 0.22 * v, filter: { type: 'lowpass', f0: 7000, f1: 600 } });
      this.tone({ type: 'sine', f0: 1800, f1: 3600, dur: 0.22, gain: 0.08 * v });
      this.tone({ type: 'sine', f0: 120, f1: 45, dur: 0.4, gain: 0.42 * v });
      this.noise({ dur: 0.25, gain: 0.24 * v, type: 'highpass', f0: 1800, f1: 600 });
      return;
    }
    if (heavy) {
      this.tone({ type: 'sawtooth', f0: 900, f1: 60, dur: 0.45, gain: 0.32 * v, filter: { type: 'lowpass', f0: 4000, f1: 300 } });
      this.tone({ type: 'sine', f0: 140, f1: 40, dur: 0.5, gain: 0.5 * v });
      this.noise({ dur: 0.35, gain: 0.28 * v, type: 'lowpass', f0: 5000, f1: 200 });
      return;
    }
    switch (weapon) {
      case 'twin_blasters':
        this.tone({ type: 'square', f0: 1500 + Math.random() * 200, f1: 320, dur: 0.09, gain: 0.09 * v, filter: { type: 'lowpass', f0: 5000 } });
        this.noise({ dur: 0.05, gain: 0.07 * v, type: 'highpass', f0: 2500 });
        break;
      case 'boom_cannon':
        this.noise({ dur: 0.28, gain: 0.32 * v, type: 'lowpass', f0: 2600, f1: 160 });
        this.tone({ type: 'sine', f0: 110, f1: 38, dur: 0.3, gain: 0.42 * v });
        this.tone({ type: 'square', f0: 220, f1: 60, dur: 0.12, gain: 0.08 * v });
        break;
      case 'pulse_rifle':
        // marksman crack: sharp transient + short metallic ring
        this.noise({ dur: 0.07, gain: 0.12 * v, type: 'highpass', f0: 2200 });
        this.tone({ type: 'square', f0: 1900 + Math.random() * 150, f1: 420, dur: 0.12, gain: 0.08 * v, filter: { type: 'lowpass', f0: 6000 } });
        this.tone({ type: 'sine', f0: 2600, f1: 2200, dur: 0.16, gain: 0.03 * v });
        break;
      case 'breaker':
        // heavy slug: a deep thump with a hard crack on top and a short metallic clank of the action
        this.noise({ dur: 0.16, gain: 0.24 * v, type: 'lowpass', f0: 3600, f1: 260 });
        this.tone({ type: 'sine', f0: 150, f1: 46, dur: 0.22, gain: 0.36 * v });
        this.tone({ type: 'square', f0: 820 + Math.random() * 90, f1: 210, dur: 0.07, gain: 0.07 * v, filter: { type: 'lowpass', f0: 4200 } });
        this.tone({ type: 'triangle', f0: 1650, f1: 1400, dur: 0.06, gain: 0.025 * v, delay: 0.05 });
        break;
      case 'ricochet':
        // Alpha 1.5 — Kai: a bright revolver crack with a little metallic "ting" off the fins
        this.noise({ dur: 0.06, gain: 0.1 * v, type: 'highpass', f0: 2600 });
        this.tone({ type: 'square', f0: 1300 + Math.random() * 120, f1: 300, dur: 0.1, gain: 0.08 * v, filter: { type: 'lowpass', f0: 5200 } });
        this.tone({ type: 'triangle', f0: 3200, f1: 2900, dur: 0.09, gain: 0.03 * v, delay: 0.03 });
        break;
      case 'stinger':
        // Alpha 1.5 — Rina: a tight snappy pop, one per barrel of the double tap
        this.tone({ type: 'square', f0: 1700 + Math.random() * 200, f1: 600, dur: 0.05, gain: 0.07 * v, filter: { type: 'bandpass', f0: 2600, q: 1.6 } });
        this.noise({ dur: 0.03, gain: 0.06 * v, type: 'highpass', f0: 3800 });
        break;
      case 'tech_carbine':
        // crisp electronic tick per round of the burst
        this.tone({ type: 'square', f0: 1100 + Math.random() * 120, f1: 520, dur: 0.06, gain: 0.07 * v, filter: { type: 'bandpass', f0: 2200, q: 2 } });
        this.tone({ type: 'sine', f0: 700, f1: 1500, dur: 0.05, gain: 0.05 * v });
        this.noise({ dur: 0.035, gain: 0.05 * v, type: 'highpass', f0: 3500 });
        break;
    }
  }

  hit(heavy: boolean, crit: boolean, toPlayer: boolean): void {
    if (!this.throttle('hit' + toPlayer, heavy ? 0 : 35)) return;
    if (heavy) {
      this.noise({ dur: 0.4, gain: 0.45, type: 'lowpass', f0: 3000, f1: 120 });
      this.tone({ type: 'sine', f0: 160, f1: 35, dur: 0.45, gain: 0.6 });
      this.tone({ type: 'square', f0: 90, f1: 40, dur: 0.18, gain: 0.12 });
      if (crit) this.tone({ type: 'triangle', f0: 1760, f1: 880, dur: 0.3, gain: 0.12, delay: 0.03 });
      return;
    }
    this.noise({ dur: 0.07, gain: toPlayer ? 0.14 : 0.12, type: 'bandpass', f0: toPlayer ? 1200 : 2400, q: 1.2 });
    this.tone({ type: 'triangle', f0: toPlayer ? 260 : 520, f1: 120, dur: 0.07, gain: 0.1 });
  }

  card(card: CardId): void {
    switch (card) {
      case 'dash':
        // airy whoosh + low push
        this.noise({ dur: 0.3, gain: 0.34, type: 'bandpass', f0: 500, f1: 4500, q: 2.2 });
        this.noise({ dur: 0.18, gain: 0.14, type: 'highpass', f0: 3000, delay: 0.04 });
        this.tone({ type: 'sine', f0: 140, f1: 70, dur: 0.16, gain: 0.22 });
        this.tone({ type: 'sine', f0: 320, f1: 1100, dur: 0.2, gain: 0.07 });
        break;
      case 'power_shot':
        this.tone({ type: 'sawtooth', f0: 120, f1: 900, dur: 0.28, gain: 0.12, filter: { type: 'lowpass', f0: 600, f1: 5000 } });
        break;
      case 'shield':
        [0, 4, 7, 12].forEach((n, i) => this.tone({ type: 'sine', f0: NOTE(72 + n), dur: 0.7, gain: 0.08, delay: i * 0.03, attack: 0.02 }));
        this.tone({ type: 'triangle', f0: 200, f1: 600, dur: 0.3, gain: 0.08 });
        break;
      case 'smoke':
        this.noise({ dur: 0.9, gain: 0.3, type: 'lowpass', f0: 600, f1: 2500, attack: 0.08 });
        this.noise({ dur: 0.5, gain: 0.12, type: 'highpass', f0: 3000, attack: 0.02 });
        break;
      case 'shock':
        this.electric(0.5, 0.35);
        break;
      case 'overdrive':
        this.tone({ type: 'sawtooth', f0: 80, f1: 640, dur: 0.6, gain: 0.16, filter: { type: 'lowpass', f0: 400, f1: 6000, q: 6 } });
        this.tone({ type: 'sawtooth', f0: 82, f1: 650, dur: 0.6, gain: 0.12, detune: 15, filter: { type: 'lowpass', f0: 400, f1: 6000, q: 6 } });
        this.noise({ dur: 0.5, gain: 0.15, type: 'bandpass', f0: 300, f1: 3000 });
        break;
      case 'adrenaline':
        [0, 3, 7, 10, 12, 15].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(76 + n), dur: 0.08, gain: 0.06, delay: i * 0.035 }));
        this.noise({ dur: 0.3, gain: 0.15, type: 'bandpass', f0: 1000, f1: 5000, q: 3 });
        break;
      case 'knockout':
        this.tone({ type: 'sawtooth', f0: 60, f1: 180, dur: 0.35, gain: 0.18, filter: { type: 'lowpass', f0: 300, f1: 1500 } });
        this.noise({ dur: 0.35, gain: 0.18, type: 'lowpass', f0: 400, f1: 1800 });
        break;
      case 'bank_shot':
        // Alpha 1.5: the drum spins up with a rising ratchet
        for (let i = 0; i < 5; i++) this.tone({ type: 'square', f0: 900 + i * 180, dur: 0.035, gain: 0.05, delay: i * 0.035, filter: { type: 'lowpass', f0: 4000 } });
        this.tone({ type: 'sawtooth', f0: 160, f1: 700, dur: 0.25, gain: 0.08, filter: { type: 'lowpass', f0: 500, f1: 3500 } });
        break;
      case 'false_start':
        // Alpha 1.5: a quick hushed feint whoosh with a sly two-note tag
        this.noise({ dur: 0.18, gain: 0.22, type: 'bandpass', f0: 2600, f1: 900, q: 2.6 });
        this.tone({ type: 'triangle', f0: NOTE(79), dur: 0.08, gain: 0.05 });
        this.tone({ type: 'triangle', f0: NOTE(74), dur: 0.1, gain: 0.05, delay: 0.07 });
        break;
      case 'system_overload':
        for (let i = 0; i < 10; i++) {
          this.tone({ type: 'square', f0: 200 + Math.random() * 1800, dur: 0.05, gain: 0.06, delay: i * 0.04 });
        }
        this.electric(0.7, 0.25);
        this.tone({ type: 'sawtooth', f0: 1200, f1: 80, dur: 0.6, gain: 0.08, filter: { type: 'bandpass', f0: 800, q: 4 } });
        break;
      // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
      case 'spotlight_tag':
        // a studio lamp clunks on, then the two-note TV chime
        this.noise({ dur: 0.06, gain: 0.14, type: 'lowpass', f0: 900 });
        this.tone({ type: 'sine', f0: NOTE(84), dur: 0.28, gain: 0.08, delay: 0.05 });
        this.tone({ type: 'sine', f0: NOTE(91), dur: 0.4, gain: 0.07, delay: 0.17 });
        break;
      case 'split_shot':
        [0, 5, 9].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(74 + n), dur: 0.07, gain: 0.05, delay: i * 0.025, filter: { type: 'lowpass', f0: 4500 } }));
        this.noise({ dur: 0.18, gain: 0.12, type: 'bandpass', f0: 1200, f1: 4200, q: 2 });
        break;
      case 'rebound_disc':
        this.tone({ type: 'sawtooth', f0: 260, f1: 980, dur: 0.32, gain: 0.07, filter: { type: 'bandpass', f0: 900, f1: 2400, q: 3 } });
        this.noise({ dur: 0.3, gain: 0.14, type: 'bandpass', f0: 700, f1: 3200, q: 2.5 });
        break;
      case 'prop_drop':
        // a call to the crew: walkie click and a falling two-tone whistle
        this.noise({ dur: 0.04, gain: 0.12, type: 'highpass', f0: 3000 });
        this.tone({ type: 'sine', f0: NOTE(88), f1: NOTE(76), dur: 0.9, gain: 0.06, delay: 0.1, attack: 0.04 });
        break;
      case 'pulse_push':
        this.tone({ type: 'sine', f0: 180, f1: 60, dur: 0.25, gain: 0.3 });
        this.noise({ dur: 0.22, gain: 0.2, type: 'bandpass', f0: 2600, f1: 600, q: 1.6 });
        break;
      case 'gravity_net':
        this.noise({ dur: 0.18, gain: 0.14, type: 'bandpass', f0: 800, f1: 2400, q: 2 });
        this.tone({ type: 'sine', f0: 70, f1: 110, dur: 0.6, gain: 0.12, delay: 0.25, attack: 0.08 });
        break;
      case 'pressure_mine':
        this.noise({ dur: 0.14, gain: 0.12, type: 'bandpass', f0: 900, f1: 2600, q: 2 });
        this.tone({ type: 'square', f0: NOTE(84), dur: 0.05, gain: 0.04, delay: 0.5, filter: { type: 'lowpass', f0: 3000 } });
        break;
      case 'stage_barrier':
        this.tone({ type: 'sine', f0: 200, f1: 1200, dur: 0.35, gain: 0.08 });
        [0, 7, 12].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(67 + n), dur: 0.5, gain: 0.05, delay: 0.12 + i * 0.03, attack: 0.02 }));
        break;
      case 'cable_snare':
        this.noise({ dur: 0.16, gain: 0.2, type: 'bandpass', f0: 1500, f1: 6000, q: 3 });
        this.tone({ type: 'triangle', f0: 2200, f1: 1700, dur: 0.06, gain: 0.06, delay: 0.02 });
        break;
      case 'holo_decoy':
        for (let i = 0; i < 6; i++) this.tone({ type: 'square', f0: 600 + Math.random() * 1600, dur: 0.04, gain: 0.04, delay: i * 0.035, filter: { type: 'lowpass', f0: 3500 } });
        this.tone({ type: 'sine', f0: NOTE(79), f1: NOTE(91), dur: 0.4, gain: 0.05, attack: 0.03 });
        break;
      case 'frame_catch':
        // a camera shutter
        this.noise({ dur: 0.04, gain: 0.2, type: 'highpass', f0: 2500 });
        this.noise({ dur: 0.05, gain: 0.14, type: 'highpass', f0: 2000, delay: 0.07 });
        this.tone({ type: 'triangle', f0: 1400, dur: 0.06, gain: 0.05 });
        break;
      case 'backtrack':
        // tape rewind: a fast warbling chirp
        this.tone({ type: 'sawtooth', f0: 1600, f1: 300, dur: 0.32, gain: 0.06, filter: { type: 'bandpass', f0: 1400, q: 2 } });
        this.tone({ type: 'square', f0: 900, f1: 2400, dur: 0.3, gain: 0.03, filter: { type: 'lowpass', f0: 3000 } });
        this.noise({ dur: 0.3, gain: 0.1, type: 'bandpass', f0: 3000, f1: 800, q: 2 });
        break;
      case 'high_stakes':
        [0, 4, 7, 12].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(72 + n), dur: 0.22, gain: 0.07, delay: i * 0.06 }));
        this.tone({ type: 'sine', f0: 90, f1: 50, dur: 0.4, gain: 0.18, delay: 0.25 });
        break;
      case 'second_take':
        // Alpha 1.6.1: a clapperboard clack, then the tape spooling back
        this.noise({ dur: 0.035, gain: 0.32, type: 'highpass', f0: 1800 });
        this.tone({ type: 'triangle', f0: 900, f1: 600, dur: 0.05, gain: 0.08 });
        this.tone({ type: 'sawtooth', f0: 300, f1: 1500, dur: 0.3, gain: 0.05, delay: 0.08, filter: { type: 'bandpass', f0: 1200, q: 2 } });
        this.noise({ dur: 0.28, gain: 0.08, type: 'bandpass', f0: 800, f1: 3000, q: 2, delay: 0.08 });
        break;
      case 'freeze_frame':
        // tape slowing down
        this.tone({ type: 'sine', f0: 880, f1: 110, dur: 0.6, gain: 0.08 });
        this.tone({ type: 'sine', f0: 1320, f1: 165, dur: 0.6, gain: 0.04 });
        this.noise({ dur: 0.5, gain: 0.1, type: 'lowpass', f0: 3000, f1: 300 });
        break;
    }
  }

  /** Alpha 1.6 — the key moments of the new cards (activation sounds are in card()). */
  cardFx(kind: 'tagHit' | 'push' | 'netLand' | 'mineArm' | 'mineBoom' | 'barrierHit' | 'barrierBreak' | 'propLand' | 'echoLock' | 'echoFire' | 'tether' | 'snap' | 'frameCatch' | 'parry' | 'discCatch' | 'erase'): void {
    if (!this.throttle('cfx-' + kind, 50)) return;
    switch (kind) {
      case 'tagHit':
        [0, 7, 12].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(84 + n), dur: 0.2, gain: 0.07, delay: i * 0.05 }));
        this.crowd(2);
        break;
      case 'push':
        this.noise({ dur: 0.12, gain: 0.14, type: 'lowpass', f0: 900 });
        break;
      case 'netLand':
        this.tone({ type: 'sine', f0: 220, f1: 330, dur: 0.3, gain: 0.08 });
        this.noise({ dur: 0.2, gain: 0.08, type: 'bandpass', f0: 2400, q: 3 });
        break;
      case 'mineArm':
        this.tone({ type: 'square', f0: NOTE(88), dur: 0.05, gain: 0.04, filter: { type: 'lowpass', f0: 3500 } });
        this.tone({ type: 'square', f0: NOTE(88), dur: 0.05, gain: 0.04, delay: 0.1, filter: { type: 'lowpass', f0: 3500 } });
        break;
      case 'mineBoom':
        this.noise({ dur: 0.45, gain: 0.4, type: 'lowpass', f0: 2600, f1: 140 });
        this.tone({ type: 'sine', f0: 130, f1: 38, dur: 0.45, gain: 0.5 });
        this.electric(0.25, 0.18);
        break;
      case 'barrierHit':
        this.tone({ type: 'triangle', f0: 1700, f1: 1200, dur: 0.1, gain: 0.05 });
        break;
      case 'barrierBreak':
        this.shieldBreak();
        break;
      case 'propLand':
        this.noise({ dur: 0.35, gain: 0.4, type: 'lowpass', f0: 1800, f1: 120 });
        this.tone({ type: 'sine', f0: 110, f1: 40, dur: 0.4, gain: 0.45 });
        this.tone({ type: 'triangle', f0: 520, f1: 260, dur: 0.12, gain: 0.06, delay: 0.04 });
        break;
      case 'echoLock':
        // the replay freezes on its frame: two dry ticks
        this.tone({ type: 'square', f0: NOTE(88), dur: 0.06, gain: 0.05, filter: { type: 'lowpass', f0: 4000 } });
        this.tone({ type: 'square', f0: NOTE(88), dur: 0.06, gain: 0.05, delay: 0.12, filter: { type: 'lowpass', f0: 4000 } });
        break;
      case 'echoFire':
        // the shot again, played through a tape: detuned and phasey
        this.tone({ type: 'sawtooth', f0: 900, f1: 180, dur: 0.28, gain: 0.1, filter: { type: 'lowpass', f0: 3500, f1: 400 } });
        this.tone({ type: 'sawtooth', f0: 930, f1: 190, dur: 0.28, gain: 0.06, filter: { type: 'lowpass', f0: 3500, f1: 400 } });
        this.noise({ dur: 0.1, gain: 0.1, type: 'bandpass', f0: 2200, q: 2 });
        break;
      case 'tether':
        this.tone({ type: 'triangle', f0: 600, f1: 300, dur: 0.18, gain: 0.08 });
        this.noise({ dur: 0.1, gain: 0.1, type: 'bandpass', f0: 2600, q: 3 });
        break;
      case 'snap':
        this.noise({ dur: 0.08, gain: 0.18, type: 'highpass', f0: 3000 });
        this.tone({ type: 'triangle', f0: 2000, f1: 900, dur: 0.12, gain: 0.05 });
        break;
      case 'frameCatch':
        this.tone({ type: 'triangle', f0: 1760, f1: 2640, dur: 0.18, gain: 0.1 });
        this.noise({ dur: 0.06, gain: 0.14, type: 'highpass', f0: 3000 });
        break;
      case 'parry':
        // Alpha 1.6.1: the parry itself — a bright metallic ring over the catch
        this.tone({ type: 'triangle', f0: NOTE(96), dur: 0.35, gain: 0.08 });
        this.tone({ type: 'sine', f0: NOTE(103), dur: 0.3, gain: 0.05, delay: 0.02 });
        this.noise({ dur: 0.05, gain: 0.2, type: 'highpass', f0: 3500 });
        break;
      case 'discCatch':
        this.tone({ type: 'triangle', f0: 1200, f1: 1600, dur: 0.1, gain: 0.05 });
        break;
      case 'erase':
        this.tone({ type: 'sine', f0: 2400, f1: 600, dur: 0.12, gain: 0.04 });
        break;
    }
  }

  /** Alpha 1.5 — BANK SHOT ricochet: a metallic ping off the barrier. */
  bank(): void {
    if (!this.throttle('bank', 60)) return;
    this.tone({ type: 'triangle', f0: 2400, f1: 1500, dur: 0.22, gain: 0.12 });
    this.tone({ type: 'sine', f0: 3600, f1: 3300, dur: 0.3, gain: 0.04, delay: 0.02 });
    this.noise({ dur: 0.05, gain: 0.12, type: 'highpass', f0: 3000 });
  }

  /** Alpha 1.5 — a BANK SHOT landed after the ricochet: a short brass "ta-da" over the crowd. */
  trickShot(): void {
    [0, 4, 7].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(79 + n), dur: 0.12, gain: 0.05, delay: 0.04 + i * 0.06, filter: { type: 'lowpass', f0: 4000 } }));
    this.crowd(2);
  }

  /** Alpha 1.5 — FALSE START read an attack: a whip-crack snap and a rising sting. */
  feintCounter(): void {
    this.noise({ dur: 0.05, gain: 0.26, type: 'highpass', f0: 2800 });
    this.tone({ type: 'sawtooth', f0: 400, f1: 1800, dur: 0.18, gain: 0.08, filter: { type: 'lowpass', f0: 5000 } });
    this.tone({ type: 'sine', f0: NOTE(86), dur: 0.25, gain: 0.05, delay: 0.08 });
    this.crowd(2);
  }

  /** Alpha 1.5.5 — Zoe's SHOCK charging in her hand: a rising buzz the player can react to. */
  zapCharge(dur: number): void {
    this.tone({ type: 'sawtooth', f0: 90, f1: 420, dur, gain: 0.07, attack: 0.03, filter: { type: 'bandpass', f0: 900, f1: 2600, q: 4 } });
    this.noise({ dur, gain: 0.12, type: 'bandpass', f0: 2000, f1: 5200, q: 3, attack: 0.04 });
  }

  electric(dur = 0.5, gain = 0.3): void {
    if (!this.throttle('elec', 60)) return;
    this.noise({ dur, gain, type: 'bandpass', f0: 3200, q: 3 });
    this.tone({ type: 'sawtooth', f0: 60, dur, gain: gain * 0.4, filter: { type: 'highpass', f0: 800 } });
    for (let i = 0; i < 5; i++) this.noise({ dur: 0.03, gain: gain * 0.8, type: 'highpass', f0: 4000, delay: Math.random() * dur * 0.8 });
  }

  /** Projectile glancing off an energy shield. */
  deflect(heavy: boolean): void {
    if (!this.throttle('deflect', 40)) return;
    const f = heavy ? 1500 : 2300 + Math.random() * 500;
    this.tone({ type: 'triangle', f0: f, f1: f * 0.55, dur: heavy ? 0.35 : 0.14, gain: heavy ? 0.14 : 0.07 });
    this.tone({ type: 'sine', f0: f * 2.01, dur: 0.12, gain: 0.04 });
    this.noise({ dur: 0.05, gain: 0.05, type: 'highpass', f0: 5000 });
  }

  block(perfect: boolean): void {
    if (!this.throttle('block', 50)) return;
    this.tone({ type: 'triangle', f0: perfect ? 1320 : 990, f1: perfect ? 1760 : 700, dur: perfect ? 0.4 : 0.16, gain: perfect ? 0.18 : 0.08 });
    this.tone({ type: 'sine', f0: perfect ? 2640 : 1980, dur: 0.2, gain: 0.05 });
  }

  shieldBreak(): void {
    this.noise({ dur: 0.5, gain: 0.32, type: 'highpass', f0: 1500 });
    for (let i = 0; i < 6; i++) this.tone({ type: 'triangle', f0: 1200 + Math.random() * 2000, dur: 0.18, gain: 0.05, delay: i * 0.03 });
  }

  /**
   * Alpha 1.4 studio-set pieces: each kind has its own sound. `broke` = the piece was
   * destroyed (or reached its damaged state), otherwise it took a hit / reacted.
   */
  prop(kind: PropKind, broke: boolean, heavy: boolean): void {
    if (!this.throttle(`prop-${kind}`, broke ? 60 : 110)) return;
    const k = heavy ? 1.2 : 1;
    switch (kind) {
      case 'speaker':
        this.shieldBreak();
        return;
      case 'chips':
        // a stack of clay chips tumbling: quick bright clicks
        for (let i = 0; i < (broke ? 9 : 3); i++) this.tone({ type: 'triangle', f0: 2400 + Math.random() * 1600, dur: 0.05, gain: 0.05 * k, delay: i * 0.035 + Math.random() * 0.02 });
        this.noise({ dur: 0.18, gain: 0.08, type: 'highpass', f0: 3500 });
        return;
      case 'neonSign':
        // electric buzz + spark crackle; the outage pops
        this.tone({ type: 'sawtooth', f0: 120, dur: 0.25, gain: 0.06, filter: { type: 'bandpass', f0: 900, q: 4 } });
        this.noise({ dur: 0.12, gain: 0.14 * k, type: 'highpass', f0: 4000 });
        if (broke) {
          this.noise({ dur: 0.08, gain: 0.25, type: 'highpass', f0: 2000, delay: 0.12 });
          this.tone({ type: 'sine', f0: 900, f1: 120, dur: 0.3, gain: 0.08, delay: 0.12 });
        }
        return;
      case 'roulette':
        // the wheel spins up with a ticking ball
        for (let i = 0; i < 8; i++) this.tone({ type: 'square', f0: 2600, dur: 0.02, gain: 0.03, delay: i * (0.05 + i * 0.012), filter: { type: 'lowpass', f0: 5000 } });
        this.tone({ type: 'sine', f0: 300, f1: 520, dur: 0.6, gain: 0.04, attack: 0.1 });
        return;
      case 'propWall':
      case 'crate':
        // plywood / wood: a dry crack and a hollow thud
        this.noise({ dur: broke ? 0.35 : 0.15, gain: (broke ? 0.3 : 0.16) * k, type: 'bandpass', f0: 900, f1: 300, q: 1.2 });
        this.tone({ type: 'sine', f0: kind === 'crate' ? 160 : 110, f1: 50, dur: 0.3, gain: 0.3 * k });
        if (broke) for (let i = 0; i < 4; i++) this.noise({ dur: 0.06, gain: 0.08, type: 'bandpass', f0: 1200 + i * 300, q: 2, delay: 0.12 + i * 0.07 });
        return;
      case 'spotlight':
        // the lamp swings with a metallic clank; broken: a pop and a buzzing filament
        this.tone({ type: 'triangle', f0: 620, f1: 410, dur: 0.25, gain: 0.08 * k });
        this.tone({ type: 'sine', f0: 1310, dur: 0.18, gain: 0.03 });
        if (broke) {
          this.noise({ dur: 0.1, gain: 0.25, type: 'highpass', f0: 2500 });
          this.tone({ type: 'sawtooth', f0: 100, dur: 0.5, gain: 0.04, delay: 0.1, filter: { type: 'bandpass', f0: 700, q: 5 } });
        }
        return;
      case 'clapper':
        // the clapperboard snap
        this.noise({ dur: 0.04, gain: 0.32, type: 'highpass', f0: 2500 });
        this.tone({ type: 'square', f0: 1400, f1: 900, dur: 0.05, gain: 0.07 });
        if (broke) this.tone({ type: 'sine', f0: 140, f1: 60, dur: 0.25, gain: 0.25, delay: 0.25 });
        return;
      case 'pumpkin':
        // a soft wet pop, never gory: thump + bright splash + spooky whiff
        this.tone({ type: 'sine', f0: 220, f1: 70, dur: 0.25, gain: 0.4 * k });
        this.noise({ dur: 0.3, gain: 0.18, type: 'bandpass', f0: 1400, f1: 500, q: 1.5 });
        this.tone({ type: 'sine', f0: NOTE(81), f1: NOTE(76), dur: 0.5, gain: 0.03, delay: 0.1, attack: 0.05, detune: 10 });
        return;
      case 'gravestone':
        // stone: a gritty crack; the fall ends with a heavy thud
        this.noise({ dur: 0.2, gain: 0.22 * k, type: 'bandpass', f0: 2200, f1: 700, q: 1.4 });
        this.tone({ type: 'triangle', f0: 260, f1: 180, dur: 0.12, gain: 0.08 });
        if (broke) {
          this.tone({ type: 'sine', f0: 90, f1: 30, dur: 0.5, gain: 0.45, delay: 0.42 });
          this.noise({ dur: 0.4, gain: 0.2, type: 'lowpass', f0: 900, f1: 100, delay: 0.42 });
        }
        return;
      case 'lantern':
        // glass tinkle and the flame snuffed out
        for (let i = 0; i < 5; i++) this.tone({ type: 'sine', f0: 3000 + Math.random() * 2500, dur: 0.12, gain: 0.03, delay: i * 0.03 });
        this.noise({ dur: 0.3, gain: 0.08, type: 'lowpass', f0: 600, f1: 150, delay: 0.08 });
        return;
      case 'fogGate':
        // the fog machine hisses, the gate creaks
        this.noise({ dur: 0.9, gain: 0.12, type: 'bandpass', f0: 3000, f1: 1200, q: 0.8, attack: 0.08 });
        this.tone({ type: 'sawtooth', f0: 180, f1: 130, dur: 0.6, gain: 0.03, filter: { type: 'bandpass', f0: 800, q: 6 } });
        return;
    }
  }

  wallSlam(): void {
    this.tone({ type: 'sine', f0: 120, f1: 28, dur: 0.6, gain: 0.7 });
    this.noise({ dur: 0.6, gain: 0.5, type: 'lowpass', f0: 1800, f1: 80 });
    this.tone({ type: 'square', f0: 70, f1: 30, dur: 0.3, gain: 0.14 });
  }

  telegraph(): void {
    this.tone({ type: 'square', f0: 880, dur: 0.07, gain: 0.07 });
    this.tone({ type: 'square', f0: 880, dur: 0.07, gain: 0.07, delay: 0.14 });
    this.tone({ type: 'sawtooth', f0: 200, f1: 1200, dur: 0.6, gain: 0.07, filter: { type: 'lowpass', f0: 1200 } });
  }

  dodge(perfect: boolean): void {
    this.noise({ dur: 0.2, gain: 0.18, type: 'bandpass', f0: 3000, f1: 800, q: 2 });
    if (perfect) {
      this.tone({ type: 'sine', f0: NOTE(84), dur: 0.25, gain: 0.08 });
      this.tone({ type: 'sine', f0: NOTE(91), dur: 0.3, gain: 0.07, delay: 0.06 });
    }
  }

  miss(): void {
    if (!this.throttle('miss', 120)) return;
    this.noise({ dur: 0.12, gain: 0.08, type: 'bandpass', f0: 4000, f1: 1500, q: 2 });
  }

  stun(): void {
    this.electric(0.6, 0.22);
  }

  passive(): void {
    [0, 7, 12].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(79 + n), dur: 0.15, gain: 0.06, delay: i * 0.05 }));
  }

  combo(ultra = false): void {
    [0, 4, 7, 12, 16].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(72 + n), dur: 0.16, gain: 0.08, delay: i * 0.05, filter: { type: 'lowpass', f0: 4000 } }));
    this.tone({ type: 'sawtooth', f0: NOTE(84), dur: 0.6, gain: 0.07, delay: 0.25, filter: { type: 'lowpass', f0: 3000 } });
    if (ultra) {
      // bigger stinger: rising sweep + bright major chord + sub hit
      this.tone({ type: 'sawtooth', f0: 200, f1: 1800, dur: 0.35, gain: 0.08, filter: { type: 'lowpass', f0: 600, f1: 6000, q: 5 } });
      [0, 4, 7, 11, 14].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(79 + n), dur: 0.9, gain: 0.045, delay: 0.32, attack: 0.02, filter: { type: 'lowpass', f0: 3800 } }));
      this.tone({ type: 'sine', f0: 110, f1: 40, dur: 0.5, gain: 0.5, delay: 0.3 });
    }
    this.crowd(ultra ? 3 : 2);
  }

  reaction(tier: number): void {
    if (!this.throttle('react', 250)) return;
    const base = tier >= 3 ? 74 : 70;
    [0, 7, 12].forEach((n, i) => this.tone({ type: 'sawtooth', f0: NOTE(base + n), dur: 0.5, gain: 0.05, delay: i * 0.02, attack: 0.01, filter: { type: 'lowpass', f0: 2500 } }));
    this.tone({ type: 'sine', f0: NOTE(base + 24), dur: 0.4, gain: 0.05, delay: 0.08 });
    this.crowd(tier >= 3 ? 3 : tier >= 2 ? 2 : 1);
  }

  /**
   * Alpha 1.6.4 — the audience reacts: 1 = a small «oh!» (only now and then), 2 = an
   * expressive «yeah!» with a few hands (combo, heavy crit, perfect dodge, trick shot),
   * 3 = a roar with applause (ultra combo, KO, boss phase). One reaction at a time: a smaller
   * or equal one never stacks on a reaction in progress, only a bigger moment cuts in.
   * (Before: a 2–3 s band of hiss on almost every event, re-triggered every 400 ms.)
   */
  crowd(tier: 1 | 2 | 3): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const now = ctx.currentTime;
    if (now < this.crowdUntil && tier <= this.crowdTier) return;
    if (now - this.crowdLast < CROWD.gap[tier - 1]) return;
    if (tier === 2 && now - this.crowdLast2 < CROWD.gap2) return;
    if (tier === 1 && Math.random() > CROWD.smallChance) return;
    const hot = 0.85 + 0.3 * Math.min(1, Math.max(0, this.intensity));
    const v = CROWD.voice[tier - 1] * hot;
    const len = tier === 1 ? 0.9 : tier === 2 ? 1.5 : 2.4;
    const out = this.openReaction(len + 2);
    this.crowdLast = now;
    if (tier >= 2) this.crowdLast2 = now;
    this.crowdTier = tier;
    this.crowdUntil = now + len * 0.8;
    // voices: two vowel formants ("ah" ~700 / ~1250 Hz), not broadband hiss
    this.noise({ dur: len, gain: v, attack: tier === 1 ? 0.06 : 0.12, type: 'bandpass', f0: 720, f1: 620, q: 1.4, out });
    this.noise({ dur: len * 0.85, gain: v * 0.45, attack: 0.1, type: 'bandpass', f0: 1250, f1: 1100, q: 2, out });
    if (tier === 3) this.noise({ dur: len * 0.7, gain: v * 0.2, attack: 0.15, type: 'bandpass', f0: 2100, f1: 1800, q: 2.5, out });
    // hands
    const claps = tier === 1 ? 3 + Math.floor(Math.random() * 3) : tier === 2 ? 12 : 30;
    this.claps(claps, tier === 1 ? 0.6 : tier === 2 ? 1.1 : 1.9, CROWD.clap[tier - 1] * hot, 0.05, out);
    if (tier === 3 && Math.random() < 0.6) this.whistle(0.25 + Math.random() * 0.4, out);
  }

  /** «Ooh» / «aww»: a missed big shot (now and then) or the player's fighter going down. */
  ooh(big = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const now = ctx.currentTime;
    if (!big && (now - this.crowdLast < CROWD.gap[0] || Math.random() > 0.5)) return;
    const out = this.openReaction(1.4);
    this.crowdLast = now;
    this.crowdTier = big ? 2 : 1;
    this.crowdUntil = now + 0.9;
    this.noise({ dur: big ? 1.4 : 1, gain: big ? 0.3 : 0.2, type: 'bandpass', f0: 520, f1: 330, q: 1.8, attack: 0.12, out });
  }

  /** Alpha 1.6.4 — a win: full applause for ~3.5 s (claps swelling and thinning out), voices and a whistle. */
  applause(): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const now = ctx.currentTime;
    const out = this.openReaction(3.7);
    this.crowdLast = this.crowdLast2 = now;
    this.crowdTier = 3;
    this.crowdUntil = now + 3;
    this.noise({ dur: 2.6, gain: CROWD.voice[2] * 0.6, attack: 0.25, type: 'bandpass', f0: 700, f1: 600, q: 1.4, out });
    this.noise({ dur: 2.2, gain: CROWD.voice[2] * 0.25, attack: 0.2, type: 'bandpass', f0: 1250, f1: 1100, q: 2, out });
    // ~75 hands over 3.6 s: dense at first, thinning towards the end
    for (let i = 0; i < 75; i++) {
      const t = 3.6 * Math.pow(Math.random(), 1.35);
      const fade = 1 - (t / 3.6) * 0.75;
      this.clap(t + 0.05, CROWD.clap[2] * 0.9 * fade, out);
    }
    this.whistle(0.3, out);
  }

  /**
   * A gain node for one reaction lasting `secs`. A reaction still sounding is faded out in
   * ~0.1 s first, so two never pile up (a combo and its hit in the same instant).
   */
  private openReaction(secs: number): GainNode {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const prev = this.crowdBus;
    if (prev && now < this.crowdUntil) {
      prev.gain.cancelScheduledValues(now);
      prev.gain.setTargetAtTime(0, now, 0.04);
    }
    const bus = ctx.createGain();
    bus.connect(this.sfx);
    this.crowdBus = bus;
    // let go of the node once everything in it has played
    setTimeout(() => {
      bus.disconnect();
      if (this.crowdBus === bus) this.crowdBus = null;
    }, (secs + 4.5) * 1000);
    return bus;
  }

  /** `n` hand claps spread over `spread` s (more of them early), from `delay` s. */
  private claps(n: number, spread: number, gain: number, delay: number, out?: AudioNode): void {
    for (let i = 0; i < n; i++) this.clap(delay + spread * Math.pow(Math.random(), 1.4), gain, out);
  }

  /** One hand clap: a 30–60 ms burst of band-passed noise with an instant attack. */
  private clap(delay: number, gain: number, out?: AudioNode): void {
    this.noise({ dur: 0.03 + Math.random() * 0.03, gain: gain * (0.55 + Math.random() * 0.45), attack: 0.0015, type: 'bandpass', f0: 1300 + Math.random() * 1300, q: 1.1, delay, out });
  }

  /** A fan's whistle: a quick rising glide. */
  private whistle(delay: number, out?: AudioNode): void {
    this.tone({ type: 'sine', f0: 1900 + Math.random() * 300, f1: 2700 + Math.random() * 300, dur: 0.32, gain: 0.025, attack: 0.04, delay, out });
  }

  countdown(n: number): void {
    if (n > 0) {
      this.tone({ type: 'square', f0: NOTE(76), dur: 0.15, gain: 0.1 });
      this.tone({ type: 'sine', f0: NOTE(88), dur: 0.15, gain: 0.05 });
    } else {
      this.tone({ type: 'sawtooth', f0: NOTE(64), dur: 0.8, gain: 0.12, filter: { type: 'lowpass', f0: 3000 } });
      this.tone({ type: 'sawtooth', f0: NOTE(71), dur: 0.8, gain: 0.1, filter: { type: 'lowpass', f0: 3000 } });
      this.tone({ type: 'sine', f0: 90, f1: 40, dur: 0.6, gain: 0.5 });
      this.noise({ dur: 0.8, gain: 0.25, type: 'lowpass', f0: 6000, f1: 300 });
      this.crowd(2);
    }
  }

  ko(playerWon: boolean): void {
    this.tone({ type: 'sine', f0: 100, f1: 25, dur: 1.2, gain: 0.7 });
    this.noise({ dur: 1.2, gain: 0.45, type: 'lowpass', f0: 3000, f1: 60 });
    // ring-side bell
    for (let i = 0; i < 3; i++) {
      this.tone({ type: 'triangle', f0: 880, dur: 0.9, gain: 0.12, delay: 0.12 + i * 0.28 });
      this.tone({ type: 'sine', f0: 2210, dur: 0.6, gain: 0.04, delay: 0.12 + i * 0.28 });
    }
    if (playerWon) this.crowd(3);
    else this.ooh(true);
  }

  victory(): void {
    const seq = [0, 4, 7, 12, 7, 12, 16, 19];
    seq.forEach((n, i) => this.tone({ type: 'square', f0: NOTE(67 + n), dur: 0.18, gain: 0.08, delay: i * 0.09, filter: { type: 'lowpass', f0: 3500 } }));
    [0, 4, 7].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(67 + 12 + n), dur: 1.2, gain: 0.05, delay: 0.75, attack: 0.02, filter: { type: 'lowpass', f0: 2500 } }));
    // Alpha 1.6.4: the house applauds the winner
    this.applause();
  }

  /** Short seasonal accent (opening the Events screen, season start). */
  sting(kind: 'none' | 'spooky' | 'frost' | 'champion'): void {
    if (kind === 'champion') {
      // championship fanfare: drum hit, brass power chord, rising gold shimmer
      this.tone({ type: 'sine', f0: 120, f1: 45, dur: 0.7, gain: 0.5 });
      this.noise({ dur: 0.5, gain: 0.18, type: 'lowpass', f0: 2500, f1: 200 });
      [0, 7, 12, 16].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(55 + n), dur: 1.1, gain: 0.05, delay: 0.05, attack: 0.03, filter: { type: 'lowpass', f0: 1800, f1: 3200 } }));
      [0, 4, 7, 12].forEach((n, i) => this.tone({ type: 'square', f0: NOTE(67 + n), dur: 0.22, gain: 0.05, delay: 0.55 + i * 0.09, filter: { type: 'lowpass', f0: 3500 } }));
      this.tone({ type: 'sine', f0: NOTE(91), dur: 1.2, gain: 0.035, delay: 0.95, attack: 0.01 });
      this.crowd(3);
      return;
    }
    if (kind === 'spooky') {
      // theremin-like glide over a minor arpeggio + a soft bell
      this.tone({ type: 'sine', f0: NOTE(76), f1: NOTE(69), dur: 0.9, gain: 0.07, attack: 0.08, detune: 12 });
      this.tone({ type: 'sine', f0: NOTE(88), f1: NOTE(81), dur: 0.9, gain: 0.025, attack: 0.1 });
      [0, 3, 7, 10].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(57 + n), dur: 0.5, gain: 0.06, delay: 0.08 + i * 0.11 }));
      this.tone({ type: 'sine', f0: NOTE(93), dur: 1.4, gain: 0.04, delay: 0.55, attack: 0.002 });
      this.tone({ type: 'sine', f0: NOTE(93) * 2.76, dur: 0.8, gain: 0.012, delay: 0.55, attack: 0.002 });
    } else if (kind === 'frost') {
      [0, 7, 12, 16, 19, 24].forEach((n, i) => this.tone({ type: 'sine', f0: NOTE(76 + n), dur: 0.6, gain: 0.045, delay: i * 0.07, attack: 0.002 }));
      this.noise({ dur: 0.6, gain: 0.025, type: 'highpass', f0: 6000, delay: 0.05 });
    }
  }

  /** BOSS FIGHT phase change: impact, rising siren-like sweep, minor power chord. */
  bossPhase(phase: number): void {
    this.tone({ type: 'sine', f0: 90, f1: 32, dur: 0.9, gain: 0.6 });
    this.noise({ dur: 0.9, gain: 0.3, type: 'lowpass', f0: 4000, f1: 120 });
    this.tone({ type: 'sawtooth', f0: 180, f1: phase >= 3 ? 1400 : 900, dur: 0.6, gain: 0.07, filter: { type: 'lowpass', f0: 500, f1: 5000, q: 6 } });
    const base = phase >= 3 ? 50 : 53;
    [0, 3, 7, 12].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(base + n), dur: 1.2, gain: 0.05, delay: 0.25, attack: 0.04, filter: { type: 'lowpass', f0: 2200 } }));
    this.crowd(3);
  }

  /** BOSS FIGHT signature move warning (SPOTLIGHT SHOT). */
  bossWarn(): void {
    if (!this.throttle('bossWarn', 500)) return;
    this.tone({ type: 'square', f0: NOTE(76), dur: 0.12, gain: 0.07, filter: { type: 'lowpass', f0: 3000 } });
    this.tone({ type: 'square', f0: NOTE(83), dur: 0.16, gain: 0.07, delay: 0.12, filter: { type: 'lowpass', f0: 3000 } });
    this.tone({ type: 'sawtooth', f0: NOTE(47), dur: 0.35, gain: 0.08, filter: { type: 'lowpass', f0: 900 } });
  }

  /** DIRECTOR'S CUT alert: a clapper snap, a brass stab and the rifle's charge spinning up. */
  cutStart(empowered: boolean): void {
    this.noise({ dur: 0.05, gain: 0.3, type: 'highpass', f0: 2500 });
    this.tone({ type: 'square', f0: 1400, f1: 900, dur: 0.05, gain: 0.08 });
    const base = empowered ? 50 : 52;
    [0, 7, 12].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(base + n), dur: 0.5, gain: 0.07, delay: 0.06, attack: 0.02, filter: { type: 'lowpass', f0: 2600, f1: 900 } }));
    this.tone({ type: 'sawtooth', f0: 90, f1: 420, dur: 0.6, gain: 0.07, delay: 0.1, attack: 0.3, filter: { type: 'lowpass', f0: 300, f1: 2400, q: 5 } });
    this.crowd(1);
  }

  /** A new DIRECTOR'S CUT line: a rising targeting whine over the tracking time. */
  cutAim(duration: number, shot: number): void {
    const d = Math.max(0.3, duration);
    this.tone({ type: 'sine', f0: 600 + shot * 120, f1: 1500 + shot * 200, dur: d, gain: 0.045, attack: d * 0.5 });
    this.tone({ type: 'square', f0: NOTE(81 + shot * 2), dur: 0.06, gain: 0.04, filter: { type: 'lowpass', f0: 3000 } });
  }

  /** The line froze: a hard double click and a held warning tone up to the shot. */
  cutLock(lock: number): void {
    this.noise({ dur: 0.03, gain: 0.22, type: 'highpass', f0: 4000 });
    this.noise({ dur: 0.03, gain: 0.18, type: 'highpass', f0: 3000, delay: 0.06 });
    this.tone({ type: 'square', f0: NOTE(88), dur: Math.max(0.2, lock * 0.9), gain: 0.035, attack: 0.01, filter: { type: 'lowpass', f0: 4000 } });
  }

  /** DIRECTOR'S CUT shot: a big rifle boom; the final one rolls on with a crowd roar. */
  cutShot(final: boolean, empowered: boolean): void {
    this.noise({ dur: final ? 0.6 : 0.4, gain: final ? 0.48 : 0.36, type: 'lowpass', f0: 5000, f1: 140 });
    this.tone({ type: 'sine', f0: final ? 120 : 150, f1: 32, dur: final ? 0.8 : 0.5, gain: final ? 0.66 : 0.5 });
    this.tone({ type: 'sawtooth', f0: 1600, f1: 120, dur: final ? 0.5 : 0.32, gain: 0.12, filter: { type: 'lowpass', f0: 6000, f1: 500 } });
    this.noise({ dur: 0.12, gain: 0.2, type: 'highpass', f0: 2600 });
    if (final) {
      [0, 7, 12].forEach((n, i) => this.tone({ type: 'sawtooth', f0: NOTE((empowered ? 50 : 52) + n), dur: 0.7, gain: 0.04, delay: 0.08 + i * 0.02, filter: { type: 'lowpass', f0: 2400 } }));
      this.crowd(2);
    }
  }

  /** Seasonal reward unlocked. */
  reward(): void {
    [0, 4, 7, 11, 14].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(72 + n), dur: 0.3, gain: 0.07, delay: i * 0.07 }));
    [0, 7, 12].forEach((n) => this.tone({ type: 'sine', f0: NOTE(84 + n), dur: 1.1, gain: 0.035, delay: 0.38, attack: 0.01 }));
    this.noise({ dur: 0.5, gain: 0.03, type: 'highpass', f0: 5000, delay: 0.36 });
  }

  defeat(): void {
    [7, 5, 3, 0].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(62 + n), dur: 0.35, gain: 0.1, delay: i * 0.22 }));
    this.tone({ type: 'sawtooth', f0: NOTE(50), dur: 1.4, gain: 0.06, delay: 0.85, filter: { type: 'lowpass', f0: 800 } });
  }

  ui(kind: 'click' | 'confirm' | 'error' | 'coin' | 'level' | 'swipe' | 'deny'): void {
    switch (kind) {
      case 'click':
        this.tone({ type: 'triangle', f0: 1100, f1: 900, dur: 0.05, gain: 0.08 });
        break;
      case 'confirm':
        this.tone({ type: 'square', f0: NOTE(79), dur: 0.08, gain: 0.06, filter: { type: 'lowpass', f0: 3500 } });
        this.tone({ type: 'square', f0: NOTE(86), dur: 0.12, gain: 0.06, delay: 0.07, filter: { type: 'lowpass', f0: 3500 } });
        break;
      case 'error':
      case 'deny':
        this.tone({ type: 'square', f0: 180, dur: 0.12, gain: 0.07, filter: { type: 'lowpass', f0: 1200 } });
        this.tone({ type: 'square', f0: 150, dur: 0.14, gain: 0.07, delay: 0.09, filter: { type: 'lowpass', f0: 1200 } });
        break;
      case 'coin':
        if (!this.throttle('coin', 40)) return;
        this.tone({ type: 'square', f0: NOTE(88), dur: 0.05, gain: 0.04 });
        this.tone({ type: 'square', f0: NOTE(93), dur: 0.08, gain: 0.04, delay: 0.04 });
        break;
      case 'level':
        [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => this.tone({ type: 'triangle', f0: NOTE(72 + n), dur: 0.2, gain: 0.08, delay: i * 0.06 }));
        break;
      case 'swipe':
        this.noise({ dur: 0.15, gain: 0.08, type: 'bandpass', f0: 1500, f1: 4000, q: 2 });
        break;
    }
  }

  // ----------------------------------------------------------------- music
  /**
   * Alpha 1.6.3: the soundtrack track for the current screen (null: none). The same track
   * again does nothing — it keeps playing. Before the first tap it is remembered.
   */
  playTrack(track: MusicId | null, fadeOut?: number): void {
    this.musicWant = track;
    this.player?.play(track, fadeOut);
  }

  /**
   * Alpha 1.6.4: the fight is over (KO, time up, forfeit) — its music starts fading out right
   * now, over MUSIC_MIX.endFade, so the KO, the fanfare and the applause come out clear and
   * the music never cuts off. Nothing brings the fight music back afterwards.
   */
  endMatchMusic(): void {
    this.playTrack(null, MUSIC_MIX.endFade);
  }

  /** Decode a track that is about to be needed, so it starts without waiting (see MusicPlayer.prepare). */
  prepareMusic(track: MusicId): void {
    this.player?.prepare(track);
  }

  /** Start downloading a track that is about to be needed (the menu music, during the title screen). */
  prefetchMusic(track: MusicId): void {
    this.musicFiles.get(track).catch(() => {});
  }
}
