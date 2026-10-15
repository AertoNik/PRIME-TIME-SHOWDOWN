import type { CardId, WeaponType } from '../config/types';

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
}

const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * Fully procedural audio (no files): SFX synthesised on demand, crowd
 * ambience and a small step-sequenced soundtrack. Starts only after the
 * first user gesture (browser autoplay policy).
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
  private seqTimer: number | null = null;
  private track: 'menu' | 'battle' | 'none' = 'none';
  private step = 0;
  private nextNoteTime = 0;
  intensity = 0.3;

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
    comp.connect(ctx.destination);
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

    // crowd bed
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 900;
    this.crowdFilter.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 250;
    lfo.connect(lfoGain).connect(this.crowdFilter.frequency);
    lfo.start();
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    src.connect(this.crowdFilter).connect(this.crowdGain).connect(this.sfx);
    src.start();
  }

  /** Pause all audio while the page is in the background. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend().catch(() => {});
    else {
      void this.ctx.resume().catch(() => {});
      this.nextNoteTime = this.ctx.currentTime + 0.05;
    }
  }

  setSound(on: boolean): void {
    this.soundOn = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1);
  }

  /** 0..1 crowd loudness. */
  setCrowd(level: number): void {
    if (!this.ctx) return;
    this.crowdGain.gain.setTargetAtTime(level * 0.11, this.ctx.currentTime, 0.4);
    this.crowdFilter.Q.value = 0.5 + level * 0.4;
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
    const t0 = ctx.currentTime + (o.delay ?? 0);
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
    node.connect(g).connect(o.bus === 'music' ? this.music : this.sfx);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx;
    if (!ctx || !this.soundOn) return;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
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
    src.connect(f).connect(g).connect(o.bus === 'music' ? this.music : this.sfx);
    src.start(t0, Math.random() * 1.5);
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
      case 'system_overload':
        for (let i = 0; i < 10; i++) {
          this.tone({ type: 'square', f0: 200 + Math.random() * 1800, dur: 0.05, gain: 0.06, delay: i * 0.04 });
        }
        this.electric(0.7, 0.25);
        this.tone({ type: 'sawtooth', f0: 1200, f1: 80, dur: 0.6, gain: 0.08, filter: { type: 'bandpass', f0: 800, q: 4 } });
        break;
    }
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
    this.cheer(ultra ? 1.3 : 0.9);
  }

  reaction(tier: number): void {
    if (!this.throttle('react', 250)) return;
    const base = tier >= 3 ? 74 : 70;
    [0, 7, 12].forEach((n, i) => this.tone({ type: 'sawtooth', f0: NOTE(base + n), dur: 0.5, gain: 0.05, delay: i * 0.02, attack: 0.01, filter: { type: 'lowpass', f0: 2500 } }));
    this.tone({ type: 'sine', f0: NOTE(base + 24), dur: 0.4, gain: 0.05, delay: 0.08 });
    this.cheer(tier >= 3 ? 1 : 0.6);
  }

  cheer(amount: number): void {
    if (!this.throttle('cheer', 400)) return;
    // a hotter show gets a louder crowd
    amount *= 0.6 + this.intensity * 0.8;
    this.noise({ dur: 1.4 + amount, gain: 0.16 * amount, type: 'bandpass', f0: 1100, f1: 900, q: 0.7, attack: 0.15 });
    this.noise({ dur: 1.2 + amount, gain: 0.08 * amount, type: 'bandpass', f0: 2400, f1: 1800, q: 1.2, attack: 0.2 });
  }

  ooh(): void {
    if (!this.throttle('ooh', 600)) return;
    this.noise({ dur: 0.9, gain: 0.1, type: 'bandpass', f0: 500, f1: 350, q: 2, attack: 0.1 });
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
      this.cheer(1);
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
    if (playerWon) this.cheer(1.4);
    else this.ooh();
  }

  victory(): void {
    const seq = [0, 4, 7, 12, 7, 12, 16, 19];
    seq.forEach((n, i) => this.tone({ type: 'square', f0: NOTE(67 + n), dur: 0.18, gain: 0.08, delay: i * 0.09, filter: { type: 'lowpass', f0: 3500 } }));
    [0, 4, 7].forEach((n) => this.tone({ type: 'sawtooth', f0: NOTE(67 + 12 + n), dur: 1.2, gain: 0.05, delay: 0.75, attack: 0.02, filter: { type: 'lowpass', f0: 2500 } }));
  }

  /** Short seasonal accent (opening the Events screen, season start). */
  sting(kind: 'none' | 'spooky' | 'frost'): void {
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
  playTrack(track: 'menu' | 'battle' | 'none'): void {
    if (this.track === track) return;
    this.track = track;
    if (!this.ctx) return;
    if (this.seqTimer !== null) {
      clearInterval(this.seqTimer);
      this.seqTimer = null;
    }
    if (track === 'none') return;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.seqTimer = window.setInterval(() => this.schedule(), 25);
  }

  /** Re-start the current track after unlock (playTrack before unlock is remembered). */
  resumeTrack(): void {
    const t = this.track;
    this.track = 'none';
    if (t !== 'none') this.playTrack(t);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bpm = this.track === 'battle' ? 124 : 96;
    const stepDur = 60 / bpm / 4;
    // After a background stall, skip the missed notes instead of firing them all at once.
    if (this.nextNoteTime < ctx.currentTime - 0.2) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const delay = Math.max(0, this.nextNoteTime - ctx.currentTime);
      if (this.musicOn && this.soundOn) {
        if (this.track === 'battle') this.battleStep(this.step, delay);
        else this.menuStep(this.step, delay);
      }
      this.nextNoteTime += stepDur;
      this.step = (this.step + 1) % 64;
    }
  }

  private mtone(o: ToneOpts): void {
    this.tone({ ...o, bus: 'music' });
  }
  private mnoise(o: NoiseOpts): void {
    this.noise({ ...o, bus: 'music' });
  }

  private battleStep(step: number, delay: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16);
    const I = this.intensity;
    // kick
    if (s % 4 === 0 || (s === 14 && bar % 2 === 1)) {
      this.mtone({ type: 'sine', f0: 150, f1: 42, dur: 0.22, gain: 0.9, delay });
    }
    // clap/snare
    if (s === 4 || s === 12) {
      this.mnoise({ dur: 0.16, gain: 0.35, type: 'bandpass', f0: 1800, q: 0.8, delay });
      this.mtone({ type: 'triangle', f0: 220, f1: 140, dur: 0.08, gain: 0.15, delay });
    }
    // hats
    if (s % 2 === 0 || I > 0.55) {
      this.mnoise({ dur: s % 4 === 2 ? 0.09 : 0.035, gain: s % 4 === 2 ? 0.12 : 0.07, type: 'highpass', f0: 7000, delay });
    }
    // bass (A minor riff)
    const riff = [45, 45, 57, 45, 48, 45, 55, 45, 43, 43, 55, 43, 40, 40, 52, 47];
    const roots = [0, 0, -2, -4];
    if (s % 2 === 0) {
      const n = riff[s] + roots[bar % 4];
      this.mtone({ type: 'sawtooth', f0: NOTE(n), dur: 0.16, gain: 0.22, delay, filter: { type: 'lowpass', f0: 380 + I * 900, q: 4 } });
    }
    // stabs when the show is hot
    if (I > 0.45 && (s === 3 || s === 11)) {
      const chord = [69, 72, 76].map((n) => n + roots[bar % 4]);
      chord.forEach((n) => this.mtone({ type: 'square', f0: NOTE(n), dur: 0.14, gain: 0.05, delay, filter: { type: 'lowpass', f0: 2600 } }));
    }
    // lead arp when legendary
    if (I > 0.75 && s % 2 === 1) {
      const arp = [81, 84, 88, 84, 81, 79, 76, 79];
      this.mtone({ type: 'triangle', f0: NOTE(arp[(s >> 1) % 8] + roots[bar % 4]), dur: 0.1, gain: 0.05, delay });
    }
  }

  private menuStep(step: number, delay: number): void {
    const s = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const prog = [
      [57, 60, 64],
      [53, 57, 60],
      [48, 52, 55],
      [55, 59, 62],
    ];
    if (s === 0) {
      prog[bar].forEach((n) =>
        this.mtone({ type: 'sawtooth', f0: NOTE(n + 12), dur: 2.4, gain: 0.04, delay, attack: 0.4, filter: { type: 'lowpass', f0: 900, q: 1 } }),
      );
      this.mtone({ type: 'sine', f0: NOTE(prog[bar][0] - 12), dur: 2.2, gain: 0.2, delay, attack: 0.05 });
    }
    if (s === 0 || s === 8) this.mtone({ type: 'sine', f0: 120, f1: 45, dur: 0.25, gain: 0.55, delay });
    if (s === 4 || s === 12) this.mnoise({ dur: 0.1, gain: 0.12, type: 'bandpass', f0: 2000, delay });
    if (s % 2 === 1) this.mnoise({ dur: 0.03, gain: 0.04, type: 'highpass', f0: 8000, delay });
    if (s === 6 || s === 14) {
      const n = prog[bar][(s >> 3) + 1] + 24;
      this.mtone({ type: 'triangle', f0: NOTE(n), dur: 0.3, gain: 0.05, delay });
    }
  }
}
