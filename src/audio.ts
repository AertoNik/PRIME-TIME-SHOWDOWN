import type { WeaponId, CardId } from './data';
export class Audio {
  private ctx?: AudioContext;
  enabled = true;
  private noiseBuffer?: AudioBuffer;
  unlock() { if (!this.enabled) return; try { this.ctx ??= new AudioContext(); if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => {}); } catch { /* Silent browsers remain playable. */ } }
  tone(frequency: number, duration = 0.08, type: OscillatorType = 'sine', volume = 0.07, end = frequency / 2, delay = 0) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime + delay, osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
    osc.type = type; osc.frequency.setValueAtTime(frequency, t); osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + duration);
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain); gain.connect(this.ctx.destination); osc.start(t); osc.stop(t + duration);
    osc.onended = () => { osc.disconnect(); gain.disconnect(); };
  }
  click() { this.tone(650, 0.04, 'triangle', 0.04); }
  noise(duration: number, volume: number, frequency = 1000) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    if (!this.noiseBuffer) {
      this.noiseBuffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0); for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const t = this.ctx.currentTime, source = this.ctx.createBufferSource(), filter = this.ctx.createBiquadFilter(), gain = this.ctx.createGain();
    source.buffer = this.noiseBuffer; filter.type = 'bandpass'; filter.frequency.value = frequency; filter.Q.value = 0.7;
    gain.gain.setValueAtTime(volume, t); gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter); filter.connect(gain); gain.connect(this.ctx.destination); source.start(t); source.stop(t + duration);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  shot(weapon: WeaponId, heavy: boolean) {
    if (heavy) { this.tone(145, 0.24, 'sawtooth', 0.065, 35); this.tone(680, 0.16, 'triangle', 0.04, 110); this.noise(0.18, 0.11, 700); return; }
    if (weapon === 'carbine') { this.tone(1100, 0.065, 'sine', 0.045, 330); this.tone(180, 0.05, 'triangle', 0.025, 90); }
    else if (weapon === 'shotgun') { this.noise(0.14, 0.11, 450); this.tone(100, 0.14, 'triangle', 0.06, 30); }
    else { this.noise(0.06, 0.075, 1600); this.tone(240, 0.07, 'triangle', 0.04, 55); }
  }
  card(id?: CardId) {
    if (id === 'shock') { this.tone(1200, 0.16, 'sawtooth', 0.04, 180); this.noise(0.12, 0.035, 2400); }
    else if (id === 'dash') this.tone(180, 0.18, 'sine', 0.06, 1400);
    else if (id === 'smoke') this.noise(0.3, 0.055, 700);
    else if (id === 'overdrive') { this.tone(250, 0.12, 'triangle', 0.06, 500); this.tone(500, 0.18, 'triangle', 0.04, 1000, 0.1); }
    else this.tone(260, 0.15, 'triangle', 0.06, 850);
  }
  hit(heavy = false, blocked = false) { this.tone(blocked ? 850 : heavy ? 65 : 90, heavy ? 0.12 : 0.06, 'triangle', 0.035, blocked ? 450 : 30); }
  shield() { this.tone(450, 0.28, 'sine', 0.04, 1100); }
  win() { [330, 440, 554, 660].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.06, f, i * 0.12)); }
  lose() { [330, 277, 220].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.04, f * 0.8, i * 0.16)); }
  countdown(value: number) { this.tone(value > 0 ? 440 : 880, 0.12, 'sine', 0.055, value > 0 ? 400 : 1100); if (!value) this.noise(0.25, 0.04, 600); }
  combo() { this.tone(554, 0.18, 'triangle', 0.06, 660); this.tone(880, 0.2, 'triangle', 0.04, 1100, 0.12); }
  showtime() { [440, 660, 880].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.055, f, i * 0.1)); this.crowd(); }
  crowd() { this.noise(0.65, 0.055, 800); this.noise(0.6, 0.025, 1800); }
  dispose() { void this.ctx?.close(); }
}
