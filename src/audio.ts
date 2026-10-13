import type { WeaponId } from './data';
export class Audio {
  private ctx?: AudioContext;
  enabled = true;
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
  shot(weapon: WeaponId, heavy: boolean) { this.tone(heavy ? 110 : weapon === 'shotgun' ? 85 : weapon === 'carbine' ? 880 : 200, heavy ? 0.25 : 0.09, weapon === 'carbine' ? 'sine' : 'sawtooth', heavy ? 0.08 : 0.035, 40); }
  card() { this.tone(260, 0.15, 'triangle', 0.06, 850); }
  hit() { this.tone(70, 0.07, 'triangle', 0.035, 30); }
  shield() { this.tone(450, 0.28, 'sine', 0.04, 1100); }
  win() { [330, 440, 554, 660].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.06, f, i * 0.12)); }
  crowd() { [90, 130, 180].forEach((f, i) => this.tone(f, 0.6, 'sawtooth', 0.012, f * 2, i * 0.08)); }
  dispose() { void this.ctx?.close(); }
}
