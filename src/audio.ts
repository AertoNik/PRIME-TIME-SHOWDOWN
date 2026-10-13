export class Sound {
  private context?: AudioContext;
  muted = false;
  unlock() {
    try { this.context ||= new AudioContext(); void this.context.resume(); } catch { /* Audio is optional. */ }
  }
  tone(freq: number, length = 0.08, type: OscillatorType = 'sine', gain = 0.04, endFreq?: number, delay = 0) {
    if (this.muted || !this.context || this.context.state !== 'running') return;
    const ctx = this.context, osc = ctx.createOscillator(), vol = ctx.createGain();
    const at = ctx.currentTime + delay;
    osc.type = type; osc.frequency.setValueAtTime(freq, at);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, at + length);
    vol.gain.setValueAtTime(gain, at); vol.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(vol); vol.connect(ctx.destination); osc.start(at); osc.stop(at + length);
  }
  shot(heavy = false) { this.tone(heavy ? 180 : 350, heavy ? 0.18 : 0.055, 'sawtooth', heavy ? 0.04 : 0.012, 60); }
  hit() { this.tone(85, 0.055, 'triangle', 0.025, 35); }
  card() { this.tone(420, 0.09, 'sine', 0.045, 850); this.tone(840, 0.1, 'triangle', 0.025, 1100, 0.07); }
  count(go = false) { this.tone(go ? 880 : 440, go ? 0.3 : 0.12, 'sine', 0.045); }
  warning() { this.tone(660, 0.12, 'square', 0.018); this.tone(880, 0.12, 'square', 0.018, undefined, 0.18); }
  win() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.045, undefined, i * 0.13)); }
  lose() { [330, 294, 220].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.035, undefined, i * 0.18)); }
}
