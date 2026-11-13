// Headless checks for Alpha 1.9.8 — NEON NEWSROOM (npm run newsroom): the new PERMANENT studio set with destructible
// cover. Its data and availability (every season, RANDOM, PRIME LEAGUE, the saved choice), the layout (point-symmetric,
// room to walk, never a squeeze, spawns and the centre lane clear, heights under the camera's rule), the four pieces
// (looks, hit points, blocking, collision gone with the piece), many automatic fights (nobody stuck or inside a piece,
// the cover goes down, the AI goes round and ducks only briefly), ranged and close-range fighters keep their balance
// against the original studio, MAGNET PULL and the other slides stop at cover, determinism (the league replays the same
// fight), the music, the BOSS FIGHT rule and the server's generated rules. In-memory, no browser (the look, the camera
// occlusion and the frame budget are checked in the browser — docs/ALPHA_1_9_8_WORKLOG.md).
import { ARENAS, ARENA_ORDER } from '../src/config/arenas.config';
import { ARENA, CARD_TUNING, COVER_TUNING, MATCH } from '../src/config/balance';
import { FIGHTERS, FIGHTER_ORDER, RIVAL_ORDER } from '../src/config/fighters';
import { LEAGUE } from '../src/config/league.config';
import { ARENA_MUSIC, MUSIC_TRACKS } from '../src/config/music.config';
import type { CardId, FighterId, RivalId } from '../src/config/types';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { stateHash } from '../src/league/replay';
import { availableArenas, resolveArena, validArenaPref } from '../src/meta/ArenaSelection';
import { leagueArenaCatalog, leagueArenasAt } from '../src/meta/LeagueArenas';
import { defaultSave, sanitize } from '../src/meta/SaveSystem';
import { ARENA_ART } from '../src/ui/arenaArt';
import { newsroomCoverModels } from '../src/render/stages/NewsroomStage';
import { Vector3 } from 'three';
import { AUTO, comboBot, type BotState } from './bots';
import { fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const DT = 1 / 60;
const NR = ARENAS.newsroom;
const COV = NR.covers ?? [];
const KINDS = ['newsdesk', 'techpanel', 'rack', 'pedestal'] as const;
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

/** A newsroom match at the FIGHT, both brains held (scripted scenes move the fighters by hand). */
function scene(fighter: FighterId = 'ray', deck?: CardId[], rival: RivalId = 'dex'): Match {
  const m = new Match({ fighter, deck: deck ?? FIGHTERS[fighter].defaultDeck, rival, difficulty: 'rookie', seed: 11, fans: 0, arena: 'newsroom' });
  while (m.phase !== 'fight') {
    m.step(DT);
    m.drainEvents();
  }
  m.ais[0].hold = true;
  m.ais[1].hold = true;
  return m;
}
const place = (m: Match, side: 0 | 1, x: number, z: number) => {
  const f = m.fighters[side];
  f.x = f.px = x;
  f.z = f.pz = z;
  f.vx = f.vz = 0;
};
/** Deepest a fighter got into any live piece (positive = inside). */
const depth = (m: Match): number => {
  let worst = -9;
  for (const f of m.fighters) for (const c of m.covers.list) if (c.alive) worst = Math.max(worst, f.radius - m.covers.gap(c, f.x, f.z));
  return worst;
};

// ================================================================ data, availability
{
  check('the seventh set, after HOLIDAY BROADCAST: id, name, show title, caption, Russian description', ARENA_ORDER.indexOf('newsroom') === 6 && NR.id === 'newsroom' && NR.name === 'NEON NEWSROOM' && NR.show === 'BREAKING SHOWDOWN' && NR.caption.includes('NEON NEWSROOM') && /студия новостей/i.test(NR.description));
  check('a PERMANENT set: no season, no event, no native seasonal dressing', NR.availability.kind === 'permanent' && !NR.nativeSeason);
  check('open in every season (standard, Halloween, winter) and in RANDOM; a saved choice always stays', (['default', 'halloween', 'winter'] as const).every((s) => availableArenas(s).includes('newsroom') && validArenaPref('newsroom', s) === 'newsroom') && resolveArena('newsroom', 'default', () => 0) === 'newsroom');
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) seen.add(resolveArena('random', 'default', () => i / 100));
  check('RANDOM can land on the newsroom', seen.has('newsroom'));
  check('saves: the choice round-trips by id (no new save fields, schema 12)', sanitize(JSON.parse(JSON.stringify({ ...defaultSave(), arena: 'newsroom' }))).arena === 'newsroom' && defaultSave().version === 12);
  check('picker: a thumbnail of its own (not a copy of another set), its own colours', ARENA_ART.newsroom?.startsWith('<svg') && ARENA_ORDER.every((id) => id === 'newsroom' || ARENA_ART[id] !== ARENA_ART.newsroom) && ARENA_ORDER.every((id) => id === 'newsroom' || ARENAS[id].colors.a !== NR.colors.a));
  check('palette: blue, cyan and violet light; red only as an accent of the set (not a light)', NR.lighting.fillA === 0x22d8ff && NR.lighting.fillB === 0x6a4dff && NR.lighting.rim === 0x5ab8ff);
  check('set pieces on the barrier: ON AIR (reactive), studio cameras (reactive), monitors and tally lamps — none on the floor, none respawning', new Set(NR.props.map((p) => p.kind)).size === 4 && NR.props.every((p) => (Math.abs(p.x) > ARENA.halfX || Math.abs(p.z) > ARENA.halfZ) && p.respawn === 0 && (!p.reactive || (p.cooldown ?? 0) > 0)));
  // PRIME LEAGUE: a permanent set of the league, catalogued without windows (open every day)
  const cat = leagueArenaCatalog();
  check('PRIME LEAGUE: the newsroom is one of the permanent league sets, open every day', (LEAGUE.arenas as readonly string[]).includes('newsroom') && cat.some((a) => a.id === 'newsroom' && !a.windows) && leagueArenasAt(cat, Date.parse('2026-12-01T12:00:00Z')).includes('newsroom') && leagueArenasAt(cat, Date.parse('2027-06-01T12:00:00Z')).includes('newsroom'));
  check('the server gets it from `npm run backend:rules`: saves (arena), league (catalogue + the fight with its cover), season rules', read('backend/pb_hooks/lib/save_rules.js').includes('"newsroom"') && read('backend/pb_hooks/lib/league_rules.js').includes('"newsroom"') && ['newsdesk', 'techpanel', 'pedestal'].every((k) => read('backend/pb_hooks/lib/league_sim.js').includes(k)) && read('backend/pb_hooks/lib/season_rules.js').includes('"newsroom"'));
}

// ================================================================ music
{
  const t = MUSIC_TRACKS.neon_newsroom;
  const file = 'public/audio/music/neon_newsroom.mp3';
  const ok = fs.existsSync(file);
  const head = ok ? (fs.readFileSync(file) as Uint8Array).subarray(0, 3) : new Uint8Array(3);
  check('music: the owner\'s neon_newsroom.mp3 is where the game loads it (an MP3 with an ID3 tag, not replaced)', ok && String.fromCharCode(head[0], head[1], head[2]) === 'ID3' && fs.statSync(file).size > 1_000_000 && t.file === 'audio/music/neon_newsroom.mp3');
  check('music: only the newsroom plays it; every other set keeps its own track', ARENA_MUSIC.newsroom === 'neon_newsroom' && ARENA_ORDER.filter((a) => ARENA_MUSIC[a] === 'neon_newsroom').join() === 'newsroom' && ARENA_MUSIC.original === 'prime_arena' && ARENA_MUSIC.holiday === 'winter_arena' && ARENA_MUSIC.graveyard === 'haunted_arena');
  check(`music: a fight track levelled by its measured loudness (${t.lufs} LUFS, phone ${t.phone})`, t.role === 'battle' && t.lufs === -11.51 && t.phone === -13.28);
}

// ================================================================ layout
{
  const m0 = scene();
  const CV = m0.covers;
  const R = MATCH.fighterRadius;
  const sym = COV.every((c) => COV.some((d) => d.kind === c.kind && Math.abs(d.x + c.x) < 1e-9 && Math.abs(d.z + c.z) < 1e-9));
  check(`layout: eight pieces — two of each kind (${KINDS.join(', ')}), point-symmetric: both ends see the same floor`, COV.length === 8 && sym && KINDS.every((k) => COV.filter((c) => c.kind === k).length === 2));
  let tight = 99;
  for (const a of CV.list)
    for (const b of CV.list) {
      if (a === b) continue;
      for (let k = 0; k <= 10; k++) tight = Math.min(tight, CV.gap(b, a.ax + ((a.bx - a.ax) * k) / 10, a.az + ((a.bz - a.az) * k) / 10) - a.radius - 2 * R);
    }
  check(`layout: not a maze — the narrowest passage between two pieces leaves ${tight.toFixed(2)} m beside a fighter (the cemetery's rule ≥ 0.35)`, tight >= 0.35);
  const walls = CV.list.map((a) => Math.min(ARENA.halfX - (Math.max(Math.abs(a.ax), Math.abs(a.bx)) + a.radius), ARENA.halfZ - (Math.max(Math.abs(a.az), Math.abs(a.bz)) + a.radius)) - 2 * R);
  check(`layout: beside the walls closed or clearly open, never a squeeze (${walls.map((x) => x.toFixed(2)).join(' ')})`, walls.every((x) => x <= 0 || x >= 0.35));
  // 1.9.8: the physical rule behind it — a fighter at the barrier (its movement limit, the rounded corners included) never
  // overlaps a piece: otherwise the cover pushes it out towards the barrier and the barrier pushes it back (pinned)
  let pin = 9;
  for (const a of CV.list)
    for (let k = 0; k <= 10; k++) {
      const px = a.ax + ((a.bx - a.ax) * k) / 10;
      const pz = a.az + ((a.bz - a.az) * k) / 10;
      const qx = Math.abs(px) - (ARENA.halfX - ARENA.cornerRadius);
      const qz = Math.abs(pz) - (ARENA.halfZ - ARENA.cornerRadius);
      const toLimit = qx > 0 && qz > 0 ? ARENA.cornerRadius - Math.hypot(qx, qz) : Math.min(ARENA.halfX - Math.abs(px), ARENA.halfZ - Math.abs(pz));
      pin = Math.min(pin, toLimit - a.radius - R);
    }
  check(`layout: nobody can be pinned between a piece and the barrier (${pin.toFixed(2)} m to spare beside the barrier, ≥ 0.2)`, pin >= 0.2);
  const spawnGap = Math.min(...CV.list.map((c) => Math.min(CV.gap(c, 0, MATCH.spawnZ), CV.gap(c, 0, -MATCH.spawnZ))));
  check(`layout: the spawn points stay clear (${spawnGap.toFixed(2)} m)`, spawnGap >= 1.2);
  check('layout: the centre lane is open (no part of a piece within 1.2 m of the line between the spawns)', CV.list.every((c) => Math.min(Math.abs(c.ax), Math.abs(c.bx)) - c.radius >= 1.2 - 1e-9 || Math.abs(c.z) > 4));
  const free = (() => {
    // the share of the floor a fighter's centre can stand on (cover takes little of it)
    let ok = 0;
    let n = 0;
    for (let x = -ARENA.halfX; x <= ARENA.halfX; x += 0.2)
      for (let z = -ARENA.halfZ; z <= ARENA.halfZ; z += 0.2) {
        n++;
        if (CV.clear(x, z, R)) ok++;
      }
    return ok / n;
  })();
  // the same measure on the two other sets with cover (the cemetery 81 %, the New Year set 79 %)
  const freeOn = (id: 'graveyard' | 'holiday') => {
    const o = new Match({ fighter: 'ray', deck: FIGHTERS.ray.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 1, fans: 0, arena: id });
    let ok = 0;
    let n = 0;
    for (let x = -ARENA.halfX; x <= ARENA.halfX; x += 0.2)
      for (let z = -ARENA.halfZ; z <= ARENA.halfZ; z += 0.2) {
        n++;
        if (o.covers.clear(x, z, R)) ok++;
      }
    return ok / n;
  };
  const fg = freeOn('graveyard');
  const fh = freeOn('holiday');
  check(`layout: room for fast fights — ${(free * 100).toFixed(1)}% of the floor stays free for a fighter (cemetery ${(fg * 100).toFixed(1)}%, New Year set ${(fh * 100).toFixed(1)}%: no less than the tighter of them)`, free >= Math.min(fg, fh) - 1e-9);
  check('view: every piece above the line of fire and never over 2.0 m (the battle camera\'s rule)', KINDS.every((k) => COVER_TUNING[k].height > ARENA.shotHeight && COVER_TUNING[k].height <= 2.0));
  check('view: the bodies are the looks — the desk and the tech panel capsules, the rack and the pedestal round', COVER_TUNING.newsdesk.half > 0 && COVER_TUNING.techpanel.half > 0 && COVER_TUNING.rack.half === 0 && COVER_TUNING.pedestal.half === 0);
  // 1.9.8 polish: the crafted pieces stay their bodies — every chunk (and the remains) inside the collision capsule / circle
  // in plan (≤ 5 cm over at a corner), no taller than the piece's height (+5 cm), so the look, the debris and the
  // collision agree
  {
    const models = newsroomCoverModels();
    const over: string[] = [];
    for (const k of KINDS) {
      const t = COVER_TUNING[k];
      const geos = [{ geo: models[k].remains, at: new Vector3() }, ...models[k].chunks];
      for (const [i, c] of geos.entries()) {
        const pos = c.geo.attributes.position;
        for (let v = 0; v < pos.count; v++) {
          const x = pos.getX(v) + c.at.x;
          const y = pos.getY(v) + c.at.y;
          const z = pos.getZ(v) + c.at.z;
          const ax = Math.max(-t.half, Math.min(t.half, x));
          const d = Math.hypot(x - ax, z) - t.radius;
          if (d > 0.05 || y > t.height + 0.05) {
            over.push(`${k}#${i} ${d.toFixed(2)}/${y.toFixed(2)}`);
            break;
          }
        }
      }
    }
    check(`view: every piece's chunks stay inside its collision body (plan ≤ +5 cm, height ≤ +5 cm)${over.length ? ' — ' + over.join(', ') : ''}`, over.length === 0);
  }
  check(`durability: pedestal < tech panel < desk < rack (${(['pedestal', 'techpanel', 'newsdesk', 'rack'] as const).map((k) => COVER_TUNING[k].hp).join(' / ')}), between the pumpkin and the clock column`, COVER_TUNING.pedestal.hp < COVER_TUNING.techpanel.hp && COVER_TUNING.techpanel.hp < COVER_TUNING.newsdesk.hp && COVER_TUNING.newsdesk.hp < COVER_TUNING.rack.hp && COVER_TUNING.pedestal.hp >= COVER_TUNING.pumpkin.hp && COVER_TUNING.rack.hp <= COVER_TUNING.clocktower.hp);
}

// ================================================================ blocking, collision, destruction
{
  // shots at a target behind a rack hit the rack, never the target (the cemetery's scene: both pinned, the player fires)
  const m = scene('ray');
  const rack = m.covers.list.find((c) => c.kind === 'rack' && c.z > 0)!;
  place(m, 0, rack.x, rack.z + 2.2);
  place(m, 1, rack.x, rack.z - 2.2);
  const foe = m.fighters[1].hp;
  const hp0 = rack.hp;
  m.ais[0].hold = false; // the player's brain aims and fires; it may try to step round, so pin it
  let hits = 0;
  for (let i = 0; i < 60 * 3; i++) {
    place(m, 0, rack.x, rack.z + 2.2);
    place(m, 1, rack.x, rack.z - 2.2);
    m.step(DT);
    for (const e of m.drainEvents()) if (e.type === 'cover' && e.side === 0) hits++;
  }
  check(`blocking: shots at a target behind a rack hit the rack (${hits} hits, ${Math.round(hp0 - rack.hp)} damage), never the target`, hits >= 3 && rack.hp < hp0 && m.fighters[1].hp === foe);
  // the ten-hit ladder and the shattered piece leaving no wall
  const s = scene();
  const desk = s.covers.list.find((c) => c.kind === 'newsdesk')!;
  const looks: string[] = [];
  for (let i = 0; i < 10; i++) {
    s.covers.damage(desk, desk.maxHp / 10, desk.x, desk.z + 0.4, 0, -1, false, 0);
    const e = s.drainEvents().filter((x): x is Extract<MatchEvent, { type: 'cover' }> => x.type === 'cover').pop();
    looks.push(e ? `${e.what[0]}${e.stage}` : '-');
  }
  check(`destruction: ten equal hits read hit… crack 1… crack 2… break (${looks.join(' ')})`, looks.join(' ') === 'h0 h0 h0 c1 h1 h1 c2 h2 h2 b3');
  check('destruction: a shattered piece is gone at once (no hit points, no collision, counted down)', !desk.alive && desk.hp === 0 && s.covers.live === COV.length - 1);
  place(s, 0, desk.x, desk.z);
  for (let i = 0; i < 20; i++) {
    s.step(DT);
    s.drainEvents();
  }
  const after = Math.hypot(s.fighters[0].x - desk.x, s.fighters[0].z - desk.z);
  check(`destruction: no invisible wall — a fighter stands on the desk's spot (${after.toFixed(2)} m)`, after < 0.3 && s.covers.clear(desk.x, desk.z, MATCH.fighterRadius));
  const live = scene();
  const ped = live.covers.list.find((c) => c.kind === 'pedestal')!;
  place(live, 0, ped.x, ped.z + 0.1);
  for (let i = 0; i < 5; i++) {
    live.step(DT);
    live.drainEvents();
  }
  const pushed = Math.hypot(live.fighters[0].x - ped.x, live.fighters[0].z - ped.z);
  check(`collision: a standing pedestal pushes a fighter out (${pushed.toFixed(2)} m from its axis)`, pushed >= ped.radius + MATCH.fighterRadius - 1e-6);
  // normal fire never breaks a piece in one or two shots; a POWER SHOT is a real dent
  const maxNormal = Math.max(...FIGHTER_ORDER.map((f) => FIGHTERS[f].stats.attack.damage * FIGHTERS[f].stats.attack.projectiles));
  check(`durability: no piece breaks from two normal volleys at point blank (max ${maxNormal})`, KINDS.every((k) => maxNormal * 2 < COVER_TUNING[k].hp));
  check(`durability: a POWER SHOT (${CARD_TUNING.power_shot.damage}) breaks no piece alone but takes at least a third of the toughest`, KINDS.every((k) => CARD_TUNING.power_shot.damage < COVER_TUNING[k].hp || k === 'pedestal') && CARD_TUNING.power_shot.damage * 3 >= COVER_TUNING.rack.hp);
}

// ================================================================ MAGNET PULL and slides at cover
{
  let worst = -9;
  let stopped = 0;
  let n = 0;
  for (const c of COV) {
    const m = scene('ray');
    const piece = m.covers.list.find((x) => x.x === c.x && x.z === c.z)!;
    // the rival just behind the piece, the puller 3 m beyond it on the other side
    const dir = piece.z <= 0 ? 1 : -1;
    const gap = piece.radius + MATCH.fighterRadius + 0.12;
    place(m, 1, piece.x, piece.z - dir * gap);
    place(m, 0, piece.x, piece.z + dir * 3.2);
    const h = m.hands[0];
    h.hand = ['magnet_pull', 'dash', 'shield'];
    h.energy = 10;
    h.lockout = 0;
    m.playCard(0, 0);
    for (let i = 0; i < 70; i++) {
      m.step(DT);
      m.drainEvents();
      worst = Math.max(worst, depth(m));
    }
    n++;
    if (dir > 0 ? m.fighters[1].z < piece.z : m.fighters[1].z > piece.z) stopped++;
  }
  check(`MAGNET PULL: behind every piece the slide stops at the cover (${stopped}/${n}), nobody ends inside it (${Math.max(0, worst).toFixed(3)} m)`, stopped === n && worst < 0.02);
}

// ================================================================ automatic fights
interface FightStats {
  ok: boolean;
  breaks: number;
  byKind: Record<string, number>;
  still: number;
  inside: number;
  hides: number;
  win: boolean;
  ko: boolean;
}
function autoFight(fighter: FighterId, rival: RivalId, seed: number, mode: 'smart' | 'combo', arena: 'newsroom' | 'original' = 'newsroom', deck?: CardId[]): FightStats {
  const m = new Match({ fighter, deck: deck ?? FIGHTERS[fighter].defaultDeck, rival, difficulty: 'pro', seed, fans: 500, autoPlayer: mode === 'combo' ? undefined : AUTO.smart, arena });
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  const stillT = [0, 0];
  let still = 0;
  let inside = -9;
  let breaks = 0;
  const byKind: Record<string, number> = {};
  let hides = 0;
  let ok = true;
  let steps = 0;
  while (m.phase !== 'over' && steps < 60 * (m.duration + 40)) {
    if (mode === 'combo') comboBot(m, st, DT);
    m.step(DT);
    for (const e of m.drainEvents()) {
      if (e.type === 'cover' && e.what === 'break') {
        breaks++;
        const k = m.covers.list[e.index].kind;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
    }
    steps++;
    if (m.phase !== 'fight') continue;
    for (const f of m.fighters) {
      if (!Number.isFinite(f.x) || !Number.isFinite(f.z) || !Number.isFinite(f.hp)) ok = false;
      inside = Math.max(inside, depth(m));
      const moving = Math.hypot(f.x - f.px, f.z - f.pz) / DT;
      // (a fighter held by a CABLE SNARE at the end of its line stands still on purpose — that is the card, not cover)
      if (f.intentSpeed > 0.5 && moving < 0.3 && f.action.kind === 'none' && f.stun <= 0 && f.knockback <= 0 && f.tether <= 0) {
        stillT[f.side] += DT;
        still = Math.max(still, stillT[f.side]);
      } else stillT[f.side] = 0;
    }
    if ((m.ais[1] as unknown as { hideT: number }).hideT > 0) hides++;
  }
  const r = m.result;
  return { ok: ok && !!r && r.method !== 'forfeit', breaks, byKind, still, inside, hides, win: r?.outcome === 'win', ko: r?.method === 'ko' };
}
{
  let n = 0;
  let ok = 0;
  let still = 0;
  let inside = -9;
  let breaks = 0;
  let wins = 0;
  let ko = 0;
  let hideFrames = 0;
  const kinds: Record<string, number> = {};
  for (const f of FIGHTER_ORDER)
    for (const r of RIVAL_ORDER)
      for (let i = 0; i < 2; i++) {
        const s = autoFight(f, r, 7100 + i * 97 + f.length * 13 + r.length, i % 2 ? 'combo' : 'smart');
        n++;
        if (s.ok) ok++;
        still = Math.max(still, s.still);
        inside = Math.max(inside, s.inside);
        breaks += s.breaks;
        hideFrames += s.hides;
        for (const k in s.byKind) kinds[k] = (kinds[k] ?? 0) + s.byKind[k];
        if (s.win) wins++;
        if (s.ko) ko++;
      }
  check(`fights: every fighter (ACE included) against every rival on the newsroom finishes normally (${ok}/${n})`, ok === n);
  check(`fights: nobody stuck — longest stand-still while trying to move ${still.toFixed(2)} s`, still < 1.0);
  check(`fights: nobody ever inside a piece (deepest ${Math.max(0, inside).toFixed(3)} m)`, inside < 0.02);
  check(`fights: the cover goes down in real fights (${(breaks / n).toFixed(1)} of ${COV.length} pieces a fight)`, breaks / n >= COV.length * 0.3);
  check(`fights: all four kinds get destroyed (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(', ')})`, KINDS.every((k) => (kinds[k] ?? 0) > 0));
  check(`fights: rivals take cover only briefly (${((hideFrames / (n * 60 * MATCH.duration)) * 100).toFixed(1)}% of fight time ducked)`, hideFrames > 0 && hideFrames / (n * 60 * MATCH.duration) < 0.08);
  check(`fights: results stay sane (${Math.round((wins / n) * 100)}% wins for the autopilot, ${Math.round((ko / n) * 100)}% by knockout)`, wins / n > 0.5 && ko > 0);
}
// the new cards and the movement / object cards next to cover
{
  const decks: [FighterId, CardId[]][] = [
    ['ace', ['showtime', 'magnet_pull', 'safe_cut', 'main_event']],
    ['lucien', ['dash', 'backtrack', 'magnet_pull', 'bat_bite']],
    ['ray', ['stage_barrier', 'prop_drop', 'dash', 'power_shot']],
    ['bruno', ['pulse_push', 'knockout', 'dash', 'shield']],
    ['nika', ['pressure_mine', 'gravity_net', 'holo_decoy', 'backtrack']],
    ['kai', ['rebound_disc', 'cable_snare', 'magnet_pull', 'charged_shot']],
  ];
  let worst = -9;
  let still = 0;
  let ok = 0;
  let n = 0;
  for (const [f, deck] of decks)
    for (let i = 0; i < 4; i++) {
      const s = autoFight(f, RIVAL_ORDER[i % 4], 5200 + i * 59 + f.length, 'smart', 'newsroom', deck);
      n++;
      if (s.ok) ok++;
      worst = Math.max(worst, s.inside);
      still = Math.max(still, s.still);
    }
  check(`cards: MAGNET PULL, SHOWTIME, SAFE CUT, MAIN EVENT, DASH, BACKTRACK, BAT BITE, barriers, props, pushes, mines, nets, discs, cables — ${ok}/${n} fights clean, never inside cover (${Math.max(0, worst).toFixed(3)} m), never stuck (${still.toFixed(2)} s)`, ok === n && worst < 0.02 && still < 1.0);
}
// ranged and close-range fighters: the cover must not swing the balance (the same fights on the original studio)
{
  const per: string[] = [];
  let worst = 0;
  let wN = 0;
  let wO = 0;
  let n = 0;
  for (const f of FIGHTER_ORDER) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < 8; i++) {
      const r = RIVAL_ORDER[i % 4];
      const seed = 8800 + i * 131 + f.length * 7;
      if (autoFight(f, r, seed, 'smart', 'newsroom').win) a++;
      if (autoFight(f, r, seed, 'smart', 'original').win) b++;
    }
    n += 8;
    wN += a;
    wO += b;
    worst = Math.max(worst, Math.abs(a - b) / 8);
    per.push(`${f} ${a}/${b}`);
  }
  check(`balance: per fighter, newsroom vs original within 3 of 8 fights (${per.join(', ')})`, worst <= 3 / 8 + 1e-9);
  check(`balance: overall ${Math.round((wN / n) * 100)}% vs ${Math.round((wO / n) * 100)}% — within 10 points`, Math.abs(wN - wO) / n <= 0.1 + 1e-9);
  const range = (f: FighterId) => FIGHTERS[f].stats.attack.range;
  const longest = [...FIGHTER_ORDER].sort((x, y) => range(y) - range(x))[0];
  const shortest = [...FIGHTER_ORDER].sort((x, y) => range(x) - range(y))[0];
  check(`balance: the longest-range (${longest}) and the shortest-range (${shortest}) fighters both still win most fights here`, per.some((p) => p.startsWith(longest + ' ') && Number(p.split(' ')[1].split('/')[0]) >= 4) && per.some((p) => p.startsWith(shortest + ' ') && Number(p.split(' ')[1].split('/')[0]) >= 4));
}

// ================================================================ the AI and cover
{
  let cleared = 0;
  let total = 0;
  for (let k = 0; k < 6; k++) {
    const m = new Match({ fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, rival: 'dex', difficulty: 'pro', seed: 300 + k, fans: 0, autoPlayer: AUTO.smart, arena: 'newsroom' });
    while (m.phase !== 'fight') {
      m.step(DT);
      m.drainEvents();
    }
    const rack = m.covers.list.find((c) => c.kind === 'rack' && c.z > 0)!;
    place(m, 0, rack.x + (k % 2 ? 0.1 : -0.1), rack.z + 2.6);
    place(m, 1, rack.x, rack.z - 2.2);
    m.ais[1].hold = true;
    let t = 0;
    while (t < 3 && m.covers.onLine(m.fighters[0].x, m.fighters[0].z, m.fighters[1].x, m.fighters[1].z, 0.1)) {
      m.step(DT);
      m.drainEvents();
      t += DT;
    }
    total++;
    if (t < 3) cleared++;
  }
  check(`AI: with a rack blocking the line it finds an angle within 3 s (${cleared}/${total})`, cleared >= total - 1);
}

// ================================================================ determinism, other sets, BOSS FIGHT
{
  const run = (seed: number) => {
    const m = new Match({ fighter: 'ace', deck: ['showtime', 'magnet_pull', 'safe_cut', 'main_event'], rival: 'dex', difficulty: 'pro', seed, fans: 500, autoPlayer: AUTO.smart, arena: 'newsroom', league: { foe: { fighter: 'kai', deck: ['magnet_pull', 'rebound_disc', 'dash', 'bank_shot'], tactic: 'balance' } } });
    let steps = 0;
    while (m.phase !== 'over' && steps < 60 * (m.duration + 40)) {
      m.step(DT);
      m.drainEvents();
      steps++;
    }
    return m;
  };
  const a = run(4242);
  const b = run(4242);
  check(`determinism: the same league fight on the newsroom replays bit for bit (stateHash ${stateHash(a)}) — the server replays it exactly`, stateHash(a) === stateHash(b) && a.result!.duration === b.result!.duration);
  const game = read('src/game/Game.ts');
  check('BOSS FIGHT is never held among the newsroom cover (→ the Original Prime Arena; the cemetery → HAUNTED as before)', game.includes("if (mode.kind === 'boss' && arenaById(id).covers?.length) return id === 'graveyard' ? 'haunted' : 'original';"));
  check('wiring: the stage is registered, the picker text names its pieces, the winter edition dresses it', read('src/render/Arena.ts').includes('newsroom: NewsroomStage,') && read('src/ui/screens/PrepScreen.ts').includes('столы ведущих, технические панели, стойки оборудования и камеры') && read('src/render/SeasonalDecor.ts').includes("} else if (st === 'newsroom') {"));
  const stage = read('src/render/stages/NewsroomStage.ts');
  check('view: trusses only ALONG the sides and behind the far wall (nothing across the set in front of the camera)', stage.includes('this.stat(new BoxGeometry(0.18, 0.18, 12), steel, -9.6, 11.5, -1);') && !/new BoxGeometry\(\s*[1-9]\d?(\.\d+)?,\s*0\.18,\s*0\.18\),\s*steel,\s*0,\s*11\.\d+,\s*-?[0-6]/.test(stage));
  check('mobile: static pieces merged (mergeStatic), LED tiles instanced, the living wall and the floor pools off on the low preset', stage.includes('mergeStatic(this.group, this.statics);') && stage.includes('new InstancedMesh(tileGeo') && stage.includes('if (tl && !this.low && mo > 0.2)') && stage.includes('for (const p of this.pools) p.mesh.visible = !low;'));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\nnewsroom: FAILED (${failed} of ${checks.length})` : `\nnewsroom: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
