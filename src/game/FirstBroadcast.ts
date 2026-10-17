import type { CardId } from '../config/types';
import type { MatchMods } from '../combat/Match';
import type { MatchEvent } from '../combat/types';
import type { Game } from './Game';

/**
 * Alpha 1.6.5 — FIRST BROADCAST («ПЕРВЫЙ ЭФИР»): the first-run tutorial.
 *
 * A short staged fight on the ordinary engine — a real Match on the Original Prime Arena against
 * the PRIME TRAINING BOT (RIVALS.bot), in its own mode ('tutorial') that touches no career,
 * event, mode or deck progress. The player's fighter fights by itself; the tutorial only
 * captions it and opens one card at a time:
 *
 *   1. «БОЕЦ СРАЖАЕТСЯ САМ!» → «ТЫ — ПРОДЮСЕР. ИСПОЛЬЗУЙ КАРТЫ!» (≈3.5 s of watching, no taps)
 *   2. «НАЖМИ DASH!» — only DASH plays (full energy, the card is in hand)
 *   3. «ТЕПЕРЬ POWER SHOT!» — the bot stands still; DASH → POWER SHOT is the real COUNTER
 *      STRIKE of ComboSystem (the tutorial match only gives a beginner a 30 s combo window)
 *   4. the combo shot lands → the bot is knocked out → «ГОТОВ К ЭФИРУ!» → the main menu.
 *
 * Nothing waits on a timer for the player: a step ends when its card is played. «ПРОПУСТИТЬ»
 * (and the pause menu) end it at any moment; both mark it seen. Reloading mid-way simply
 * starts it again (nothing is saved until it ends).
 */
export const TUTORIAL = {
  /** Dealt in this order: DASH and POWER SHOT are in the hand from the start. */
  deck: ['dash', 'power_shot', 'shield', 'smoke'] as CardId[],
  mods: {
    // long enough that time never runs out; the fight ends with the scripted knockout
    duration: 900,
    introTime: 1.2,
    // the bot never gets energy, so it never plays a card (a SHIELD could eat the combo)
    rivalEnergyMult: 0,
    // a beginner may take a while to find the second card
    comboWindow: 30,
  } satisfies MatchMods,
  /** Seconds each opening caption stays. */
  watch: [1.8, 1.9] as const,
};

type Step = 'intro' | 'watch1' | 'watch2' | 'dash' | 'praise' | 'power' | 'combo' | 'down' | 'finale' | 'over';

export class FirstBroadcast {
  private step: Step = 'intro';
  private t = 0;
  /** When the bot goes down (tutorial seconds; −1 until the combo shot lands). */
  private koAt = -1;

  constructor(private readonly g: Game) {}

  get active(): boolean {
    return this.step !== 'over';
  }

  /** Every frame while the tutorial fight is on screen (real seconds; nothing moves while paused). */
  update(dt: number): void {
    const g = this.g;
    const m = g.match;
    if (!m || this.step === 'over' || g.paused) return;
    this.t += dt;
    const [me, bot] = m.fighters;
    // nobody can lose the first broadcast, and the bot never falls before the combo
    if (!me.ko && me.hp < me.maxHp * 0.5) me.hp = me.maxHp * 0.8;
    if (this.koAt < 0 && !bot.ko && bot.hp < bot.maxHp * 0.35) bot.hp = bot.maxHp * 0.6;
    switch (this.step) {
      case 'intro':
        if (m.phase === 'fight') this.go('watch1');
        break;
      case 'watch1':
        if (this.t >= TUTORIAL.watch[0]) this.go('watch2');
        break;
      case 'watch2':
        if (this.t >= TUTORIAL.watch[1]) this.go('dash');
        break;
      case 'praise':
        if (this.t >= 0.75) this.go('power');
        break;
      case 'combo':
        // the combo shot normally lands within a second; if it somehow does not, the show goes on
        if (this.koAt < 0 && this.t >= 3.5) this.koAt = this.t;
        if (this.koAt >= 0 && this.t >= this.koAt) {
          m.knockOut(bot, true);
          this.go('down');
        }
        break;
      case 'down':
        if (this.t >= 1.1) this.go('finale');
        break;
      case 'finale':
        if (this.t >= 3.4) g.endTutorial('done');
        break;
    }
  }

  /** Match events (after the HUD and the renderer have seen them). */
  onEvent(e: MatchEvent): void {
    if (this.step === 'over') return;
    switch (e.type) {
      case 'card':
        if (e.side !== 0) break;
        if (this.step === 'dash' && e.card === 'dash') this.go('praise');
        else if (this.step === 'power' && e.card === 'power_shot' && e.combo !== 'counter_strike') {
          // played too late for the combo (it never happens inside the 30 s window): once more
          this.go('dash', true);
        }
        break;
      case 'combo':
        if (e.side === 0 && e.combo === 'counter_strike' && this.step === 'power') this.go('combo');
        break;
      case 'hit':
        if (this.step === 'combo' && e.source === 0 && e.combo === 'counter_strike' && this.koAt < 0) {
          // the COUNTER STRIKE banner, the big number and the bot's stagger get their moment
          // (the audience answers in between), then it powers down
          this.koAt = this.t + 1.3;
        }
        break;
    }
  }

  /** The tutorial is over (finished, skipped or left): stop reacting. */
  close(): void {
    this.step = 'over';
  }

  private go(step: Step, again = false): void {
    const g = this.g;
    const m = g.match;
    const hud = g.hud;
    this.step = step;
    this.t = 0;
    switch (step) {
      case 'watch1':
        hud.tutorialCaption('БОЕЦ СРАЖАЕТСЯ САМ!');
        break;
      case 'watch2':
        hud.tutorialCaption('ТЫ — ПРОДЮСЕР', 'ИСПОЛЬЗУЙ КАРТЫ!');
        break;
      case 'dash':
        this.ready('dash');
        if (m) m.ais[1].hold = false;
        hud.tutorialCaption(again ? 'СНАЧАЛА DASH, ПОТОМ POWER SHOT' : 'ПЕРВАЯ КАРТА');
        hud.tutorialAsk('НАЖМИ DASH!', 'dash');
        break;
      case 'praise':
        hud.tutorialAsk(null, null);
        hud.tutorialCaption('ОТЛИЧНО!', 'А ТЕПЕРЬ — КОМБО');
        break;
      case 'power':
        this.ready('power_shot');
        // the bot keeps still so the first combo shot is sure to land
        if (m) m.ais[1].hold = true;
        hud.tutorialCaption('КОМБО: DASH → POWER SHOT');
        hud.tutorialAsk('ТЕПЕРЬ POWER SHOT!', 'power_shot');
        break;
      case 'combo':
        // the COUNTER STRIKE banner has the stage now
        hud.tutorialAsk(null, null);
        hud.tutorialCaption(null);
        break;
      case 'finale':
        hud.tutorialFinale();
        g.tutorialCheer();
        break;
    }
  }

  /** The card is in the hand and affordable right now (a beginner never waits for energy). */
  private ready(card: CardId): void {
    const m = this.g.match;
    if (!m) return;
    const h = m.hands[0];
    if (!h.hand.includes(card)) {
      // keep the hand as it is but put the card in the first slot that is not the other tutorial card
      const slot = h.hand.findIndex((c) => c !== 'dash' && c !== 'power_shot');
      h.hand[slot < 0 ? 0 : slot] = card;
      h.version++;
    }
    h.energy = Math.max(h.energy, 10);
    h.lockout = 0;
  }
}
