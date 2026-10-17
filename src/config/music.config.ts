// Alpha 1.6.3 — PRIME SOUNDTRACK: the game's music, MP3 files in public/audio/music/.
// One track per place: the main menu (Halloween Premiere has its own), one per studio set and
// the champion's BOSS FIGHT. src/audio/MusicPlayer.ts loads only the track that is needed,
// plays the whole song (its audible part — digital silence and the inaudible end of a fade-out
// are skipped) and repeats it. Game.ts picks the track: boss first, then the stage; the menu
// track follows the active seasonal event (EventManager), not the decoration of a screen.
//
// Replacing a song: keep the file name, then measure its loudness (integrated LUFS, EBU R128 /
// BS.1770 — any loudness meter) and write it into `lufs` below; the player levels every track
// to the same loudness, so a hotter master does not come out louder in the game.
import type { ArenaId } from './arenas.config';

export type MusicId = 'prime_menu' | 'prime_menu_halloween' | 'prime_arena' | 'casino_arena' | 'movie_backlot' | 'haunted_arena' | 'victor_boss';

export interface MusicTrackDef {
  /** Path under public/ (relative, so it works from any sub-path of GitHub Pages). */
  file: string;
  /** Integrated loudness of the file, LUFS (measured offline, see above). */
  lufs: number;
  /** Menu music sits a little louder than fight music, which leaves room for shots and cards. */
  role: 'menu' | 'battle';
}

export const MUSIC_TRACKS: Record<MusicId, MusicTrackDef> = {
  prime_menu: { file: 'audio/music/prime_menu.mp3', lufs: -11.8, role: 'menu' },
  prime_menu_halloween: { file: 'audio/music/prime_menu_halloween.mp3', lufs: -11.9, role: 'menu' },
  prime_arena: { file: 'audio/music/prime_arena.mp3', lufs: -12.4, role: 'battle' },
  casino_arena: { file: 'audio/music/casino_arena.mp3', lufs: -11.5, role: 'battle' },
  movie_backlot: { file: 'audio/music/movie_backlot.mp3', lufs: -12.3, role: 'battle' },
  haunted_arena: { file: 'audio/music/haunted_arena.mp3', lufs: -12.4, role: 'battle' },
  victor_boss: { file: 'audio/music/victor_boss.mp3', lufs: -12.3, role: 'battle' },
};

/** The fight music of each studio set (BOSS FIGHT always plays `victor_boss`). */
export const ARENA_MUSIC: Record<ArenaId, MusicId> = {
  original: 'prime_arena',
  casino: 'casino_arena',
  backlot: 'movie_backlot',
  haunted: 'haunted_arena',
};

const dB = (v: number) => Math.pow(10, v / 20);

export const MUSIC_MIX = {
  /** Every track is levelled to this file loudness first (the quietest of the seven). */
  reference: -12.4,
  /**
   * Then this gain per role, before the music bus (0.32) and the master (0.9). Set by
   * measurement (not by ear) against the old procedural soundtrack and the fight SFX, at the
   * music bus: menu ≈ −30 LUFS (the old menu music); fight ≈ −31 LUFS, 4.5 dB under the old
   * fight music — a full song masks more than the sparse synth did, so shots, hits and cards
   * stay well on top (their loud moments ≈ 12 dB over the music).
   */
  menu: dB(-7.7),
  battle: dB(-8.7),
  /** Seconds: the old track fades out completely before the new one fades in (no overlap). */
  fadeOut: 0.7,
  fadeIn: 1.2,
  /** Loop: the song ends where its fade-out falls this far under the track's average level. */
  tailDb: -30,
  /** At most this many encoded files stay in memory (decoded audio: only the playing track). */
  keepFiles: 3,
};
