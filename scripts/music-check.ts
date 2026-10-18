// Headless checks for Alpha 1.6.3 — PRIME SOUNDTRACK (npm run music): the seven MP3 files are
// where the game loads them from, every place has its track, and the loop window (the audible
// part of a song that MusicPlayer repeats) is found correctly on synthetic songs.
// Alpha 1.6.4 — SOUND POLISH: levelling by full-range + phone-speaker loudness, menu no louder
// than the fights, the match-end fade, and the crowd's limits (bed level, one reaction at a time).
// The browser plays and decodes the real files; that part is checked in the game, not here.
import { ARENA_ORDER } from '../src/config/arenas.config';
import { ARENA_MUSIC, MUSIC_MIX, MUSIC_TRACKS, trackGain, type MusicId } from '../src/config/music.config';
import { loopWindow } from '../src/audio/MusicPlayer';
import { CROWD_SR, VOICES, addClapper, addVoice, edgeLevel, normalize, type Stereo } from '../src/audio/CrowdKit';

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
// (Alpha 1.7.5: the second Halloween set, GRAVEYARD BROADCAST, shares the Halloween fight track — no new music)
const OWN_TRACK = ARENA_ORDER.filter((a) => a !== 'graveyard');
check('mapping: every studio set has a fight track; the four classic sets each their own', ARENA_ORDER.every((a) => !!ARENA_MUSIC[a]) && new Set(OWN_TRACK.map((a) => ARENA_MUSIC[a])).size === OWN_TRACK.length);
check('mapping: GRAVEYARD BROADCAST plays the Halloween fight track (haunted_arena)', ARENA_MUSIC.graveyard === 'haunted_arena');
check('mapping: original → prime_arena, casino → casino_arena, backlot → movie_backlot, haunted → haunted_arena', ARENA_MUSIC.original === 'prime_arena' && ARENA_MUSIC.casino === 'casino_arena' && ARENA_MUSIC.backlot === 'movie_backlot' && ARENA_MUSIC.haunted === 'haunted_arena');
check('mapping: the menu tracks are menu music, the rest fight music', ids.every((id) => (MUSIC_TRACKS[id].role === 'menu') === id.startsWith('prime_menu')));
const game = readFileSync('src/game/Game.ts', 'utf8');
check("mapping: BOSS FIGHT plays victor_boss first, whatever the set", /spec\.boss \? 'victor_boss' : ARENA_MUSIC\[stage\]/.test(game));
check('mapping: the Halloween menu follows the active event (EventManager), not the theme of a screen', /events\.active\?\.themeId === 'halloween' \? 'prime_menu_halloween' : 'prime_menu'/.test(game));

// ----------------------------------------------------------------- mix
const at = (id: MusicId, key: 'lufs' | 'phone') => MUSIC_TRACKS[id][key] + 20 * Math.log10(trackGain(id) * 0.32);
const fullRange = ids.map((id) => at(id, 'lufs'));
const phone = ids.map((id) => at(id, 'phone'));
const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
check(`mix: the seven tracks come out within 0.5 dB of each other on a phone speaker (${phone.map((v) => v.toFixed(1)).join(', ')} dB at the music bus)`, spread(phone) <= 0.5);
check(`mix: …and within 0.5 dB full-range (${fullRange.map((v) => v.toFixed(1)).join(', ')} LUFS at the music bus)`, spread(fullRange) <= 0.5);
check('mix: the menu is not louder than the fights (same role level)', MUSIC_MIX.menu <= MUSIC_MIX.battle);
check(`mix: the music sits around −31 LUFS at the music bus (${(fullRange.reduce((a, v) => a + v, 0) / fullRange.length).toFixed(1)})`, Math.abs(fullRange.reduce((a, v) => a + v, 0) / fullRange.length + 31) < 0.6);
check('mix: no track gain above unity (nothing is pushed into the limiter)', ids.every((id) => trackGain(id) < 1));
check(`fades: a fight swells in over 1–2 s (${MUSIC_MIX.fadeIn.battle} s), the match end fades out over 1.5–2 s (${MUSIC_MIX.endFade} s)`, MUSIC_MIX.fadeIn.battle >= 1 && MUSIC_MIX.fadeIn.battle <= 2 && MUSIC_MIX.endFade >= 1.5 && MUSIC_MIX.endFade <= 2);
check("fades: the fight music starts fading the moment the fight ends (phase 'outro'), not at the results", /case 'phase':\s*if \(e\.phase === 'outro'\) a\.endMatchMusic\(\);/.test(game));

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
check('soundtrack: the procedural background music (step sequencer) is gone — no second music stream', !/menuStep|battleStep|seqTimer/.test(audio));
check('soundtrack: one MusicPlayer, created with the AudioContext', (audio.match(/new MusicPlayer\(/g) ?? []).length === 1);

// --------------------------------------------------------------- crowd
check('crowd: the bed is no longer swept by a filter LFO (the "sea waves") and loops its own 9 s buffer', !/createOscillator\(\)[\s\S]{0,200}crowdFilter\.frequency/.test(audio) && /bedLen = ctx\.sampleRate \* 9/.test(audio));
check('crowd: the old hiss cheer (re-triggered every 400 ms) is gone — every reaction goes through crowd(tier)', !/cheer\(/.test(audio) && !/\.cheer\(/.test(game));
check('crowd: one reaction at a time — a smaller or equal one never stacks on a reaction in progress', /if \(now < this\.crowdUntil && tier <= this\.crowdTier\) return;/.test(audio));
check('crowd: a plain heavy hit only gets a small, occasional reaction; crits / combo hits and perfect dodges an expressive one', /a\.crowd\(e\.crit \|\| e\.combo \? 2 : 1\)/.test(game) && /e\.perfect && e\.side === 0\) a\.crowd\(2\)/.test(game));
check('crowd: the win gets a celebration (ovation, then warm applause while the results stay on screen)', /victory\(\): void \{[\s\S]{0,700}this\.celebrate\(\);/.test(audio));
check('crowd: the celebration ends when the results are left (menu, a new fight, sound off)', /setCrowd\(0\.12\);[\s\S]{0,200}stopCelebration\(\)/.test(game) && /private launch\([\s\S]{0,300}stopCelebration\(/.test(game) && /if \(!on\) this\.stopCelebration/.test(audio));
check('crowd: the audience answers 0.45–0.8 s after the moment (the hit / combo sound is heard first)', /delay: \[\s*\[0\.45, 0\.6\],\s*\[0\.55, 0\.75\],\s*\[0\.6, 0\.8\],\s*\]/.test(audio));
check('crowd: a second expressive moment soon after applause gets voices only (no second round)', /tier === 2 && now - this\.handsLast >= CROWD\.fresh/.test(audio));
check('crowd: a TV banner gets at most an expressive reaction (the moment itself owns the spectacular one)', /this\.crowd\(tier >= 2 \? 2 : 1\);/.test(audio));
check('crowd: the knockout roar always cuts in (never swallowed by a reaction a moment before)', /if \(playerWon\) this\.crowd\(3, true\);/.test(audio));
// Alpha 1.6.6 — the crowd's sounds themselves (CrowdKit), synthesised here exactly as the game does
{
  const sr = CROWD_SR;
  const mk = (secs: number): Stereo => ({ L: new Float32Array(Math.round(secs * sr)), R: new Float32Array(Math.round(secs * sr)) });
  const measure = (b: Stereo) => {
    const L = b.L;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < L.length; i++) {
      sum += L[i] * L[i];
      peak = Math.max(peak, Math.abs(L[i]));
    }
    const rms = Math.sqrt(sum / L.length);
    // how uneven it is from one 10 ms to the next: a wash of applause is low, separate «pops» are high
    const w = Math.round(0.01 * sr);
    const win: number[] = [];
    for (let i = 0; i + w <= L.length; i += w) {
      let q = 0;
      for (let j = i; j < i + w; j++) q += L[j] * L[j];
      win.push(Math.sqrt(q / w));
    }
    const mean = win.reduce((x, y) => x + y, 0) / win.length;
    const sd = Math.sqrt(win.reduce((x, y) => x + (y - mean) ** 2, 0) / win.length);
    return { crest: 20 * Math.log10(peak / rms), grain: sd / mean, peak };
  };
  // (Alpha 1.7: the synthesis draws on Math.random — the check runs it on fixed seeds and averages
  // four takes, so the verdict is the same on every run; the game itself is not changed)
  const seeded = <T>(seed: number, fn: () => T): T => {
    const keep = Math.random;
    let a = seed >>> 0;
    Math.random = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    try {
      return fn();
    } finally {
      Math.random = keep;
    }
  };
  const hands = (people: number) => {
    let crest = 0;
    let grain = 0;
    for (const seed of [1, 2, 3, 4]) {
      const m = seeded(seed * 7919 + people, () => {
        const b = mk(6);
        for (let p = 0; p < people; p++) addClapper(b, sr, p, people);
        normalize(b, 0.8);
        return measure(b);
      });
      crest += m.crest / 4;
      grain += m.grain / 4;
    }
    return { crest, grain };
  };
  const dense = hands(64);
  const light = hands(26);
  // 1.6.5 measured: dense crest 19.5 dB / grain 0.57, light 21.6 dB / 0.94 (the «popcorn»)
  check(`crowd: applause is a soft wash, not popcorn — dense crest ${dense.crest.toFixed(1)} dB (was 19.5), grain ${dense.grain.toFixed(2)} (was 0.57)`, dense.crest < 17 && dense.grain < 0.36);
  check(`crowd: the calmer applause too — crest ${light.crest.toFixed(1)} dB (was 21.6), grain ${light.grain.toFixed(2)} (was 0.94)`, light.crest < 19 && light.grain < 0.5);
  const bad: string[] = [];
  for (const [name, spec] of Object.entries(VOICES)) {
    const b = mk(spec.secs);
    for (let v = 0; v < spec.voices; v++) addVoice(b, sr, spec);
    normalize(b, 0.7);
    const m = measure(b);
    if (!(m.peak <= 0.7001)) bad.push(`${name}: peak ${m.peak.toFixed(2)}`);
    if (!spec.loop && edgeLevel(b, sr) > 0.001) bad.push(`${name}: starts / ends with a step`);
    if (spec.chatter && m.grain < 0.3) bad.push(`${name}: a steady wash (grain ${m.grain.toFixed(2)})`);
  }
  check(`crowd: people's voices (cheer, roar, «ooh», «aww», shout, a talking hall) — safe peaks, one-shots start and end in silence, the hall talks in syllables (no steady wash)${bad.length ? ' — ' + bad.join('; ') : ''}`, bad.length === 0);
  check('crowd: the sounds are made once after the first tap, one person per frame (no stutter), and the hall stays quiet until they are ready', /void this\.buildCrowd\(\);/.test(audio) && /await frame\(\);/.test(audio) && /if \(!k\.handsDense\) return;/.test(audio));
  check('crowd: every reaction is people — voices first, the hands a beat later, then the hall talking', /k\.ooh\) this\.playCrowd\(k\.ooh/.test(audio) && /k\.cheers\) this\.playCrowd\(k\.cheers/.test(audio) && /k\.roar\) this\.playCrowd\(k\.roar/.test(audio) && /this\.handsOnce\(out, delay \+ 0\.12/.test(audio) && /CROWD\.murmur\.big : CROWD\.murmur\.small/.test(audio));
  check('crowd: during a fight the talking hall is only a short snippet now and then — the bed stays the quiet murmur (no sea waves)', /len: 2\.2, attack: 0\.6/.test(audio) && /this\.crowdFilter\.type = 'lowpass';/.test(audio));
}
check('crowd: the end of the fight cancels a waiting small / expressive reaction', /endMatchMusic\(\): void \{[\s\S]{0,200}this\.cancelReactions\(\);/.test(audio));

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `music: OK (${checks.length} checks)` : 'music: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
