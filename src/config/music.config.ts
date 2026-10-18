// Alpha 1.6.3 — PRIME SOUNDTRACK: the game's music, MP3 files in public/audio/music/.
// One track per place: the main menu (Halloween Premiere has its own), one per studio set and
// the champion's BOSS FIGHT. src/audio/MusicPlayer.ts loads only the track that is needed,
// plays the whole song (its audible part — digital silence and the inaudible end of a fade-out
// are skipped) and repeats it. Game.ts picks the track: boss first, then the stage; the menu
// track follows the active seasonal event (EventManager), not the decoration of a screen.
//
// Replacing a song: keep the file name, then measure its loudness (integrated LUFS, EBU R128 /
// BS.1770 — any loudness meter) and write it into `lufs` below, and the same measured after a
// 250 Hz high-pass (a phone speaker) into `phone`; the player levels every track by the average
// of the two, so a hotter master — or a bass-heavy one on a phone — does not come out louder.
import type { ArenaId } from './arenas.config';

export type MusicId = 'prime_menu' | 'prime_menu_halloween' | 'prime_arena' | 'casino_arena' | 'movie_backlot' | 'haunted_arena' | 'victor_boss';

export interface MusicTrackDef {
  /** Path under public/ (relative, so it works from any sub-path of GitHub Pages). */
  file: string;
  /** Integrated loudness of the file, LUFS (measured offline, see above). */
  lufs: number;
  /**
   * Alpha 1.6.4: the same through a phone speaker (2nd-order 250 Hz high-pass before the
   * LUFS weighting) — bass-heavy songs lose more on an iPhone than LUFS predicts.
   */
  phone: number;
  /** Menu music sits a little louder than fight music, which leaves room for shots and cards. */
  role: 'menu' | 'battle';
}

export const MUSIC_TRACKS: Record<MusicId, MusicTrackDef> = {
  prime_menu: { file: 'audio/music/prime_menu.mp3', lufs: -11.84, phone: -14.23, role: 'menu' },
  prime_menu_halloween: { file: 'audio/music/prime_menu_halloween.mp3', lufs: -11.9, phone: -14.57, role: 'menu' },
  prime_arena: { file: 'audio/music/prime_arena.mp3', lufs: -12.4, phone: -14.94, role: 'battle' },
  casino_arena: { file: 'audio/music/casino_arena.mp3', lufs: -11.53, phone: -13.77, role: 'battle' },
  movie_backlot: { file: 'audio/music/movie_backlot.mp3', lufs: -12.27, phone: -15.02, role: 'battle' },
  haunted_arena: { file: 'audio/music/haunted_arena.mp3', lufs: -12.42, phone: -15.07, role: 'battle' },
  victor_boss: { file: 'audio/music/victor_boss.mp3', lufs: -12.25, phone: -14.27, role: 'battle' },
};

/** The playback gain of a track: its role level, levelled to `MUSIC_MIX.reference`. */
export function trackGain(id: MusicId): number {
  const t = MUSIC_TRACKS[id];
  return (t.role === 'menu' ? MUSIC_MIX.menu : MUSIC_MIX.battle) * Math.pow(10, (MUSIC_MIX.reference - (t.lufs + t.phone) / 2) / 20);
}

/** The fight music of each studio set (BOSS FIGHT always plays `victor_boss`). */
export const ARENA_MUSIC: Record<ArenaId, MusicId> = {
  original: 'prime_arena',
  casino: 'casino_arena',
  backlot: 'movie_backlot',
  haunted: 'haunted_arena',
  // Alpha 1.7.5: the second Halloween set shares the Halloween fight track (no new music)
  graveyard: 'haunted_arena',
};

const dB = (v: number) => Math.pow(10, v / 20);

export const MUSIC_MIX = {
  /** Every track is levelled to this loudness first (average of `lufs` and `phone`; the quietest of the seven). */
  reference: -13.75,
  /**
   * Then this gain per role, before the music bus (0.32) and the master (0.9). Set by
   * measurement (not by ear) against the old procedural soundtrack and the fight SFX, at the
   * music bus: ≈ −31 LUFS, 4.5 dB under the old fight music — a full song masks more than the
   * sparse synth did, so shots, hits and cards stay well on top (their loud moments ≈ 12 dB
   * over the music). Alpha 1.6.4: the menu at the same level as the fights (it was 1 dB louder,
   * and with no shots over it, it sounded much louder after a fight).
   */
  menu: dB(-8.7),
  battle: dB(-8.7),
  /** Seconds: a change of screen — the old track fades out completely before the new one fades in (no overlap). */
  fadeOut: 0.7,
  /** Alpha 1.6.4: the fight music fades out over this as soon as the fight ends (KO / time up / forfeit). */
  endFade: 1.8,
  /** Fade-in per role: a fight swells in over 1.5 s, the menu (after the results) comes in gently over 2 s. */
  fadeIn: { menu: 2.0, battle: 1.5 },
  /** Loop: the song ends where its fade-out falls this far under the track's average level. */
  tailDb: -30,
  /** At most this many encoded files stay in memory (decoded audio: only the playing track). */
  keepFiles: 3,
};
