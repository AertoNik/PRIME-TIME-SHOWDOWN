// Headless checks for Alpha 1.6.3 — PRIME SOUNDTRACK (npm run music): the seven MP3 files are
// where the game loads them from, every place has its track, and the loop window (the audible
// part of a song that MusicPlayer repeats) is found correctly on synthetic songs.
// The browser plays and decodes the real files; that part is checked in the game, not here.
import { ARENA_ORDER } from '../src/config/arenas.config';
import { ARENA_MUSIC, MUSIC_MIX, MUSIC_TRACKS, type MusicId } from '../src/config/music.config';
import { loopWindow } from '../src/audio/MusicPlayer';

// Node's fs without @types/node (the project has none): the few calls this check needs
interface Fs {
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: 'utf8'): string;
  statSync(path: string): { size: number };
}
const { existsSync, readFileSync, statSync } = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as Fs;

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);

// ---------------------------------------------------------------- files
const ids = Object.keys(MUSIC_TRACKS) as MusicId[];
check(`files: exactly the 7 tracks of the soundtrack (${ids.length})`, ids.length === 7);
const bad: string[] = [];
for (const id of ids) {
  const def = MUSIC_TRACKS[id];
  const path = `public/${def.file}`;
  if (def.file !== `audio/music/${id}.mp3`) bad.push(`${id}: path ${def.file}`);
  if (!existsSync(path)) {
    bad.push(`${id}: missing ${path}`);
    continue;
  }
  const head = readFileSync(path).subarray(0, 3);
  const id3 = String.fromCharCode(head[0], head[1], head[2]) === 'ID3';
  const sync = head[0] === 0xff && (head[1] & 0xe0) === 0xe0;
  if (!id3 && !sync) bad.push(`${id}: not an MP3`);
  if (statSync(path).size < 200_000) bad.push(`${id}: suspiciously small`);
  if (!(def.lufs < -6 && def.lufs > -24)) bad.push(`${id}: loudness ${def.lufs}`);
}
check(`files: every track is a real MP3 in public/audio/music/ under its own name, relative path (GitHub Pages, base './')${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0);

// -------------------------------------------------------------- mapping
check('mapping: every studio set has its own fight track', ARENA_ORDER.every((a) => !!ARENA_MUSIC[a]) && new Set(ARENA_ORDER.map((a) => ARENA_MUSIC[a])).size === ARENA_ORDER.length);
check('mapping: original → prime_arena, casino → casino_arena, backlot → movie_backlot, haunted → haunted_arena', ARENA_MUSIC.original === 'prime_arena' && ARENA_MUSIC.casino === 'casino_arena' && ARENA_MUSIC.backlot === 'movie_backlot' && ARENA_MUSIC.haunted === 'haunted_arena');
check('mapping: the menu tracks are menu music, the rest fight music', ids.every((id) => (MUSIC_TRACKS[id].role === 'menu') === id.startsWith('prime_menu')));
const game = readFileSync('src/game/Game.ts', 'utf8');
check("mapping: BOSS FIGHT plays victor_boss first, whatever the set", /spec\.boss \? 'victor_boss' : ARENA_MUSIC\[stage\]/.test(game));
check('mapping: the Halloween menu follows the active event (EventManager), not the theme of a screen', /events\.active\?\.themeId === 'halloween' \? 'prime_menu_halloween' : 'prime_menu'/.test(game));

// ----------------------------------------------------------------- mix
const level = (id: MusicId) => (MUSIC_TRACKS[id].role === 'menu' ? MUSIC_MIX.menu : MUSIC_MIX.battle) * Math.pow(10, (MUSIC_MIX.reference - MUSIC_TRACKS[id].lufs) / 20);
const outLufs = ids.map((id) => MUSIC_TRACKS[id].lufs + 20 * Math.log10(level(id) * 0.32));
const menus = ids.filter((id) => MUSIC_TRACKS[id].role === 'menu').map((id) => outLufs[ids.indexOf(id)]);
const fights = ids.filter((id) => MUSIC_TRACKS[id].role === 'battle').map((id) => outLufs[ids.indexOf(id)]);
check(`mix: all menu tracks come out equally loud (${menus.map((v) => v.toFixed(1)).join(', ')} LUFS at the music bus)`, Math.max(...menus) - Math.min(...menus) < 0.05);
check(`mix: all fight tracks come out equally loud and quieter than the menu (${fights.map((v) => v.toFixed(1)).join(', ')})`, Math.max(...fights) - Math.min(...fights) < 0.05 && fights[0] < menus[0]);
check('mix: no track gain above unity (nothing is pushed into the limiter)', ids.every((id) => level(id) < 1));

// ------------------------------------------------------------ loop window
const SR = 48000;
function song(parts: { secs: number; amp: (t: number) => number }[]): { sampleRate: number; length: number; numberOfChannels: number; getChannelData: (c: number) => Float32Array } {
  const n = parts.reduce((a, p) => a + Math.round(p.secs * SR), 0);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    const m = Math.round(p.secs * SR);
    for (let i = 0; i < m; i++) {
      const t = i / SR;
      const v = p.amp(t / p.secs) * Math.sin(2 * Math.PI * 220 * (o + i) / SR);
      L[o + i] = v;
      R[o + i] = v * 0.9;
    }
    o += m;
  }
  return { sampleRate: SR, length: n, numberOfChannels: 2, getChannelData: (c) => (c ? R : L) };
}
const silent = (secs: number) => ({ secs, amp: () => 0 });
const loud = (secs: number) => ({ secs, amp: () => 0.5 });
// 0.4 s silence, 20 s music, 4 s fade to nothing (amplitude 0.5 → 0 linearly), 2 s silence
const faded = song([silent(0.4), loud(20), { secs: 4, amp: (u) => 0.5 * (1 - u) }, silent(2)]);
const [fa, fb] = loopWindow(faded as unknown as AudioBuffer, MUSIC_MIX.tailDb);
// average power = loud power × (20 s + 4 s · ⅓ for the linear fade) / 26.4 s; the fade's power is
// loud × (1 − u)², so it crosses tailDb under the average at 1 − u = √(share · 10^(tailDb/10))
const share = (20 + 4 / 3) / 26.4;
const expectB = 0.4 + 20 + 4 * (1 - Math.sqrt(share * Math.pow(10, MUSIC_MIX.tailDb / 10)));
check(`loop: leading digital silence is skipped (start ${fa.toFixed(3)} s ≈ 0.4)`, Math.abs(fa - 0.395) < 0.012);
check(`loop: a fade-out plays until it is ~30 dB down, the silence after it is skipped (end ${fb.toFixed(2)} s, expected ≈ ${expectB.toFixed(2)})`, Math.abs(fb - expectB) < 0.25 && fb < 0.4 + 24);
// a song that stops dead and is followed by 2.7 s of silence
const cut = song([silent(0.02), loud(30), silent(2.7)]);
const [, cb] = loopWindow(cut as unknown as AudioBuffer, MUSIC_MIX.tailDb);
check(`loop: a song that stops dead loops right at its last sound (end ${cb.toFixed(3)} s, sound ends at 30.020)`, cb >= 30.02 - 1e-6 && cb - 30.02 <= 0.0101);
// a whole-length song with no silence at all keeps every sample
const full = song([loud(12)]);
const [ua, ub] = loopWindow(full as unknown as AudioBuffer, MUSIC_MIX.tailDb);
check('loop: a song without silence is looped whole', ua === 0 && Math.abs(ub - 12) < 1e-9);
const tiny = song([silent(1), loud(2), silent(1)]);
const [ta, tb] = loopWindow(tiny as unknown as AudioBuffer, MUSIC_MIX.tailDb);
check('loop: a broken / very short file falls back to looping all of it', ta === 0 && Math.abs(tb - 4) < 1e-9);

// ------------------------------------------------------- old music gone
const audio = readFileSync('src/audio/AudioSystem.ts', 'utf8');
check('soundtrack: the procedural background music (step sequencer) is gone — no second music stream', !/menuStep|battleStep|seqTimer|setInterval/.test(audio));
check('soundtrack: one MusicPlayer, created with the AudioContext', (audio.match(/new MusicPlayer\(/g) ?? []).length === 1);

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `music: OK (${checks.length} checks)` : 'music: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
