import type { SaveStorage } from '../../src/meta/SaveSystem';

// Artificial test data shared by the account checks (Alpha 1.8.1). These are hand-made saves in
// the format of each version — not files of real players. save176() is the rich Alpha 1.7.6 career
// of `npm run primeid` (seasonal star LUCIEN, shop cards in decks, Halloween tokens, a collection
// with personal rewards, mode records); olderSave(v) is the same career as version v wrote it.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** localStorage stand-in (one per simulated browser). */
export class MemoryStorage implements SaveStorage {
  map = new Map<string, string>();
  writes = 0;
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.writes++;
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

export function save176(): Record<string, any> {
  const t0 = Date.parse('2026-10-24T18:30:00Z');
  const fp = (unlocked: boolean, fans: number, wins: number, losses: number, draws: number, classicWins: number, bestRating: number, deck: string[]) => ({ unlocked, fans, wins, losses, draws, matches: wins + losses + draws, classicWins, bestRating, deck });
  return {
    version: 11,
    orgName: 'MIDNIGHT ROCKET STUDIO',
    money: 12345,
    reputation: 1850,
    matches: 140,
    wins: 96,
    losses: 40,
    draws: 4,
    bestRating: 97,
    totalEarned: 88000,
    fansEarned: 26000,
    bestCombosInMatch: 7,
    bestPerfectsInMatch: 5,
    proWins: 40,
    championWins: 12,
    fighters: {
      ray: fp(true, 9000, 40, 15, 1, 30, 97, ['dash', 'power_shot', 'second_take', 'split_shot']),
      bruno: fp(true, 6100, 20, 9, 1, 18, 88, ['shield', 'power_shot', 'overdrive', 'knockout']),
      nika: fp(true, 5200, 14, 8, 1, 12, 90, ['shock', 'power_shot', 'smoke', 'system_overload']),
      vega: fp(true, 4300, 10, 4, 1, 8, 92, ['dash', 'power_shot', 'backtrack', 'charged_shot']),
      kai: fp(true, 2500, 6, 2, 0, 6, 85, ['dash', 'shield', 'overdrive', 'bank_shot']),
      rina: fp(false, 1800, 0, 0, 0, 0, 0, ['dash', 'shield', 'smoke', 'false_start']),
      lucien: fp(true, 2600, 6, 2, 0, 5, 88, ['dash', 'shield', 'overdrive', 'bat_bite']),
    },
    selected: 'lucien',
    difficulty: 'champion',
    goals: { first_win: { done: true, claimed: true }, combo_3: { done: true, claimed: true }, rating_70: { done: true, claimed: false }, sign_second: { done: true, claimed: true } },
    settings: { sound: false, music: true, quality: 'low', camera: 'reduced' },
    nextRival: 'zoe',
    lastRival: 'tank',
    seed: 424242,
    hintsSeen: true,
    events: {
      'halloween-2026': {
        tokens: 120,
        earned: 720,
        spent: 600,
        quests: { first_night: { p: 3, claimed: true }, combo_carnival: { p: 10, claimed: false } },
        bought: ['card_pumpkin', 'dash_phantom'],
        fighters: [{ id: 'lucien', at: t0 }],
        grandClaimed: false,
        day: '2026-10-25',
        dayTokens: 34,
      },
    },
    cosmetics: {
      owned: ['title_prime_legend', 'card_pumpkin', 'dash_phantom', 'title_prime_star'],
      equipped: { cardStyle: 'card_pumpkin', dashFx: 'dash_phantom', title: 'title_prime_star' },
      history: [
        { id: 'title_prime_legend', event: 'boss-vale', at: t0 - 9e8, fighter: 'ray' },
        { id: 'title_prime_star', event: 'career-star', at: t0 - 5e8 },
        { id: 'card_pumpkin', event: 'halloween-2026', at: t0 - 2e8 },
        { id: 'dash_phantom', event: 'halloween-2026', at: t0 - 1e8 },
      ],
      seen: ['title_prime_legend', 'card_pumpkin'],
      personal: { title_prime_legend: ['ray', 'vega'] },
      personalEquipped: { ray: { title: 'title_prime_legend' } },
      unassigned: [],
    },
    modes: {
      survival: { runs: 9, completions: 2, bestWave: 5, bestScore: 420, recordAt: t0 - 3e8, recordFighter: 'ray', bestByFighter: { ray: 5, bruno: 3 }, firstClearPaid: true, active: null },
      challenges: { energy_rush: { attempts: 4, clears: 2, firstClearAt: t0 - 6e8, best: 9, bestAt: t0 - 6e8, bestFighter: 'nika' } },
      boss: {
        vale: {
          attempts: 12,
          wins: 3,
          firstWinAt: t0 - 9e8,
          bestTime: 71.5,
          bestRating: 91,
          bestPhase: 3,
          bestBossHp: 0,
          bestFighter: 'ray',
          winsByFighter: { ray: 2, vega: 1 },
          history: [{ at: t0 - 9e8, fighter: 'ray', won: true, time: 71.5, rating: 91, phase: 3, bossHp: 0 }],
        },
      },
    },
    arena: 'graveyard',
    careerClaimed: ['rookie', 'rising'],
    cards: { owned: ['second_take', 'split_shot', 'backtrack'] },
    tutorial: 'done',
  };
}

/** The same career a version earlier: drop what that version did not have yet. */
export function olderSave(version: number): Record<string, any> {
  const s = save176();
  s.version = version;
  if (version <= 10) {
    // 1.6: before 1.6.1 the SECOND TAKE card was SIDE CAM; before 1.6.5 / 1.7 no tutorial flag, no LUCIEN
    delete s.tutorial;
    delete s.fighters.lucien;
    s.selected = 'ray';
    delete s.events['halloween-2026'].fighters;
    s.cards.owned = ['side_cam', 'split_shot', 'backtrack'];
    s.fighters.ray.deck = ['dash', 'power_shot', 'side_cam', 'split_shot'];
  }
  if (version <= 9) {
    // 1.5.5: no card shop yet — decks of the basic six and the signature only
    delete s.cards;
    s.fighters.ray.deck = ['dash', 'power_shot', 'shield', 'adrenaline'];
    s.fighters.vega.deck = ['dash', 'power_shot', 'shield', 'charged_shot'];
  }
  if (version <= 8) {
    // 1.5: personal rewards were common items
    delete s.cosmetics.personal;
    delete s.cosmetics.personalEquipped;
    delete s.cosmetics.unassigned;
    s.cosmetics.equipped.title = 'title_prime_legend';
  }
  if (version <= 7) {
    // 1.4: no Kai and Rina, no "seen" marks, no career stages
    delete s.fighters.kai;
    delete s.fighters.rina;
    delete s.cosmetics.seen;
    delete s.careerClaimed;
    s.cosmetics.owned = ['title_prime_legend', 'card_pumpkin', 'dash_phantom'];
    s.cosmetics.history = s.cosmetics.history.filter((h: { id: string }) => h.id !== 'title_prime_star');
    s.cosmetics.equipped = { cardStyle: 'card_pumpkin', dashFx: 'dash_phantom', title: 'title_prime_legend' };
    s.modes.survival.active = { id: 77, fighter: 'bruno', deck: ['shield', 'power_shot', 'overdrive', 'knockout'], rivals: ['dex', 'tank', 'zoe', 'crash', 'dex'], wave: 2, hpFrac: 0.6, perks: { second_wind: 1, energy_boost: 0, power_surge: 0 }, waves: [], pendingPerk: false, eventId: null, startedAt: 1, arena: 'casino' };
  }
  if (version <= 6) {
    delete s.arena;
    delete s.modes.survival.active.arena;
  }
  if (version <= 5) for (const f of Object.values(s.fighters) as { classicWins?: number }[]) delete f.classicWins;
  if (version <= 4) delete s.modes.boss;
  if (version <= 3) delete s.modes;
  if (version <= 2) {
    delete s.events;
    delete s.cosmetics;
  }
  if (version <= 1) delete s.settings.camera;
  return s;
}
