// Headless checks for Alpha 1.9.9 — CARD EVOLUTION, the arena polish (npm run arenapolish):
//   HOLIDAY BROADCAST — the dressed cover (ribbons, candy stripes, gear rings, bells, tinsel, a tiny tree) stays inside
//   every piece's collision body; the bodies, positions, hit points and break rules are 1.9.8's; the barrier presents keep
//   their place and break; the far-side TV riser stands outside the barrier, behind the fight and low;
//   NEON NEWSROOM — the studio kit (guide lines, PAR cans, the light arch, camera jibs, softboxes, monitor carts) stands
//   outside the barrier and never over the fight; the cover is the one approved in 1.9.8;
//   both — the music files, the winter calendar and the sets' availability are untouched.
// Geometry only (no browser); the look, the battle camera (__occlusion: 0 opaque obstructions on both sets) and the
// phone sizes were checked in the browser — docs/ALPHA_1_9_9_WORKLOG.md.
import { Box3, Vector3, type BufferGeometry } from 'three';
import { ARENAS, arenaById } from '../src/config/arenas.config';
import { ARENA, COVER_TUNING } from '../src/config/balance';
import { EVENTS } from '../src/config/events.config';
import { MUSIC_TRACKS } from '../src/config/music.config';
import { arenaAvailable } from '../src/meta/ArenaSelection';
import { upcomingNote } from '../src/meta/Shop';
import { approvedPriceRub } from '../src/config/shop.config';
import { FAR, holidayCoverModels, holidayFarSideParts, presentParts } from '../src/render/stages/HolidayStage';
import { NEWSROOM_KIT, newsroomCoverModels } from '../src/render/stages/NewsroomStage';
import { GROUND_Y } from '../src/render/stages/StageKit';
import { crypto, fs, proc } from './lib/node';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;
const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') as string;
const box = (g: BufferGeometry, at?: Vector3) => {
  g.computeBoundingBox();
  const b = (g.boundingBox as Box3).clone();
  if (at) b.translate(at);
  return b;
};
/** Distance in plan from the body's axis (a point for a round piece, a segment along x for a capsule). */
function planReach(b: Box3, half: number): number {
  const xs = [b.min.x, b.max.x];
  const zs = [b.min.z, b.max.z];
  let worst = 0;
  for (const x of xs)
    for (const z of zs) {
      const dx = Math.max(0, Math.abs(x) - half);
      worst = Math.max(worst, Math.hypot(dx, z));
    }
  return worst;
}
const OUTER_X = ARENA.wallX + 0.45;
const OUTER_Z = ARENA.wallZ + 0.45;

// ===================================================== HOLIDAY BROADCAST — the cover
{
  const models = holidayCoverModels();
  const over: string[] = [];
  let dressed = 0;
  for (const kind of ['gift', 'snowgen', 'clocktower', 'console'] as const) {
    const t = COVER_TUNING[kind];
    const md = models[kind];
    const parts: { name: string; b: Box3 }[] = md.chunks.map((c, i) => ({ name: `chunk ${i}`, b: box(c.geo, c.at) }));
    for (const d of md.decor) parts.push({ name: `dressing of chunk ${d.chunk}`, b: box(d.geo) });
    dressed += md.decor.length;
    for (const p of parts) {
      const reach = planReach(p.b, t.half);
      // (a round box's corner overstates a round part by √2 — the bound is the circle's, so the corner test is strict;
      // the 1.9.7 chunks get a hair more height: the snow cannon's nozzle sits exactly on 1.5 + 0.05 m)
      const tol = p.name.startsWith('dressing') ? 0.05 : 0.06;
      if (reach > (t.radius + 0.05) * Math.SQRT2 || p.b.max.y > t.height + tol) over.push(`${kind} ${p.name} (${reach.toFixed(2)} / ${p.b.max.y.toFixed(3)} m)`);
    }
    // the exact test for round dressing: every vertex within the radius
    for (const d of md.decor) {
      const pos = d.geo.getAttribute('position');
      for (let i = 0; i < pos.count; i++) {
        const dx = Math.max(0, Math.abs(pos.getX(i)) - t.half);
        if (Math.hypot(dx, pos.getZ(i)) > t.radius + 0.05 || pos.getY(i) > t.height + 0.05) {
          over.push(`${kind} dressing vertex (${Math.hypot(dx, pos.getZ(i)).toFixed(2)} m)`);
          break;
        }
      }
    }
  }
  check(`HOLIDAY cover: the festive dressing (${dressed} parts: ribbons, candy stripes, gear rings, bells, tinsel, a tiny tree) and every chunk stay inside the collision body (plan and height ≤ +5 cm)${over.length ? ' — ' + over.slice(0, 4).join(', ') : ''}`, over.length === 0 && dressed > 20);
  check('HOLIDAY cover: every dressing part rides on a real chunk (it cracks, flies and lands with it)', Object.values(models).every((m) => m.decor.every((d) => d.chunk >= 0 && d.chunk < m.chunks.length)));
  const want = { gift: [600, 0.46, 1.12], snowgen: [900, 0.4, 1.5], clocktower: [1300, 0.44, 1.95], console: [850, 0.27, 1.2] } as const;
  check('HOLIDAY cover: hit points, radii and heights are 1.9.8\'s (gift 600, snow cannon 900, clock column 1300, console 850)', (Object.keys(want) as (keyof typeof want)[]).every((k) => COVER_TUNING[k].hp === want[k][0] && COVER_TUNING[k].radius === want[k][1] && COVER_TUNING[k].height === want[k][2]));
  const hol = arenaById('holiday');
  check('HOLIDAY cover: the same eight pieces at the same places (point-symmetric, the centre lane open)', JSON.stringify(hol.covers) === JSON.stringify([
    { kind: 'gift', x: 1.7, z: 0.35 },
    { kind: 'gift', x: -1.7, z: -0.35 },
    { kind: 'clocktower', x: -3.3, z: -2.55 },
    { kind: 'clocktower', x: 3.3, z: 2.55 },
    { kind: 'console', x: 2.05, z: -3.55, yaw: 0.22 },
    { kind: 'console', x: -2.05, z: 3.55, yaw: 0.22 },
    { kind: 'snowgen', x: -3.55, z: 1.15 },
    { kind: 'snowgen', x: 3.55, z: -1.15 },
  ]));
}

// ===================================================== HOLIDAY BROADCAST — presents and the far side
{
  const hol = arenaById('holiday');
  check('HOLIDAY presents on the barrier: the same four gift stacks (1 hp, never respawning) — only their look is new', hol.props.filter((p) => p.kind === 'giftStack').length === 4 && hol.props.filter((p) => p.kind === 'giftStack').every((p) => p.hp === 1 && p.respawn === 0));
  const g = presentParts(0.5, 0.36, 0.5, 0xc4122f, 0xffd36a);
  const b = box(g);
  check(`HOLIDAY presents: a box, two ribbons across it and a bow on top (${b.max.y.toFixed(2)} m with the bow), the lower box of a stack without a bow`, b.max.y > 0.36 && b.max.y < 0.55 && box(presentParts(0.5, 0.36, 0.5, 0, 0, false)).max.y < 0.38);
  const src = read('src/render/stages/HolidayStage.ts');
  check('HOLIDAY presents: shot apart, the upper present flies and scraps of paper and ribbon scatter (light debris, hidden again for the next fight)', src.includes('g.scraps.forEach((sc, k) =>') && src.includes('for (const sc of g.scraps) sc.visible = false;'));
  const f = holidayFarSideParts();
  const parts = [f.navy, f.gold, f.frost, f.painted, f.stars].map((x) => box(x));
  const bulbsOk = f.bulbs.every((x) => x.at.z < -OUTER_Z - 0.3 && Math.abs(x.at.x) <= FAR.x + 0.2 && x.at.y < GROUND_Y + 3.0);
  const outside = parts.every((p) => p.max.z < -OUTER_Z - 0.3 && p.min.x >= -FAR.x - 0.3 && p.max.x <= FAR.x + 0.3);
  const low = Math.max(...parts.map((p) => p.max.y)) - GROUND_Y;
  check(`HOLIDAY far side: the TV riser and its dressing stand beyond the far barrier (z < ${(-OUTER_Z - 0.3).toFixed(2)}) and as wide as the arena, ${low.toFixed(2)} m at most (behind the fight)`, outside && bulbsOk && low <= 3.0);
  check(`HOLIDAY far side: candy-cane posts, swags with ${f.bulbs.length} twinkling bulbs, two little trees, two glass baubles, the clockwork arch with its gear and clock, presents`, f.bulbs.length >= 40 && src.includes('private buildFarSide(): void') && f.gearAt.z < -9 && f.clockAt.z < -9);
}

// ===================================================== NEON NEWSROOM — the studio kit
{
  const K = NEWSROOM_KIT;
  const jibHead = K.jib.x - Math.cos(K.jib.lift) * K.jib.arm;
  const jibTop = K.jib.post + Math.sin(K.jib.lift) * K.jib.arm;
  check(
    `NEWSROOM kit: guide lines (${K.guide.x.join(' / ')} m), softboxes (${K.softboxes.x} m), monitor carts (${K.cart.x} m) and the camera jibs (their heads at ${jibHead.toFixed(2)} m) all stand outside the barrier (> ${OUTER_X} m)`,
    K.guide.x.every((x) => x > OUTER_X + 0.5) && K.softboxes.x > OUTER_X + 1 && K.cart.x > OUTER_X + 1 && jibHead > OUTER_X + 1,
  );
  check(`NEWSROOM kit: low beside the fight — the jib at ${jibTop.toFixed(2)} m, softboxes at ${(K.softboxes.h + 0.45).toFixed(2)} m (the view rule: nothing high over the barrier; the battle camera sees over them)`, jibTop <= 2.6 && K.softboxes.h + 0.45 <= 2.6);
  check(`NEWSROOM kit: the PAR cans behind the far barrier (z ${K.pars.z}) and the light arch behind the desk (z ${K.arch.z}, radius ${K.arch.r} m: it frames the video wall, never over the fight)`, K.pars.z < -OUTER_Z - 0.5 && K.arch.z < -12 && K.arch.r <= 6.5);
  const src = read('src/render/stages/NewsroomStage.ts');
  check('NEWSROOM kit: built once (static, merged by material); the tally lights blink with the decor cameras, the PAR lenses breathe', src.includes('this.buildStudioKit();') && src.includes('this.stat(new BoxGeometry(0.09, 0.05, 0.04), this.decorTally, hx, hy - 0.04, J.z);') && src.includes('this.parGlow.color.setHex(CYAN)'));
  const models = newsroomCoverModels();
  check('NEWSROOM cover: the 1.9.8 pieces as approved (desk, tech panel, rack, pedestal — same bodies and places)', Object.keys(models).length === 4 && COVER_TUNING.newsdesk.hp === 1000 && COVER_TUNING.rack.hp === 1200 && JSON.stringify(arenaById('newsroom').covers?.[0]) === JSON.stringify({ kind: 'newsdesk', x: 2.2, z: 0.55, yaw: 0.35 }));
}

// ===================================================== untouched: music, calendar, availability
{
  const pub = '/Users/user/Desktop/PRIME TIME SHOWDOWN/public/audio/music';
  const same = (f: string) => !fs.existsSync(`${pub}/${f}`) || sha(`public/audio/music/${f}`) === sha(`${pub}/${f}`);
  check('music: winter_arena.mp3 and neon_newsroom.mp3 are the 1.9.8 files byte for byte, still the sets\' fight tracks', same('winter_arena.mp3') && same('neon_newsroom.mp3') && MUSIC_TRACKS.neon_newsroom.file === 'audio/music/neon_newsroom.mp3' && !!MUSIC_TRACKS.winter_arena);
  const w = EVENTS.find((e) => e.id === 'winter-2026');
  check('the winter calendar: announced 26.11, from 03.12 to 04.01 00:00 MSK (unchanged)', !!w && w.start === '2026-12-02T21:00:00Z' && w.end === '2027-01-03T21:00:00Z' && w.announceDays === 7);
  check('HOLIDAY BROADCAST still opens only in WINTER SHOWDOWN; NEON NEWSROOM stays permanent', !arenaAvailable(ARENAS.holiday, 'default') && arenaAvailable(ARENAS.holiday, 'winter') && ARENAS.newsroom.availability.kind === 'permanent');
}

// ===================================================== WINTER SHOWDOWN in PRIME SHOP before the event (brief item 7)
{
  const w = EVENTS.find((e) => e.id === 'winter-2026')!;
  const winterSkus = ['season_clockwork_gold', 'season_candy_comet', 'season_frostlight_live', 'season_midnight_confetti', 'fighter_crax'] as const;
  const notes = winterSkus.map((k) => upcomingNote(w, k, 'general'));
  check(
    `a winter item shown before the event says, in one line, how it will be had: «${notes[0]}»`,
    notes.every((n) => n === 'Во время WINTER SHOWDOWN — за карамельные трости. С 4 января 2027 — за рубли.'),
  );
  check('…roubles are named only when true (an approved price and an offer selling it when the event ends); otherwise «Сейчас не продаётся»', upcomingNote(w, 'skin_ray_neon_runner', 'g').includes('за рубли') === (approvedPriceRub('skin_ray_neon_runner') !== null) && upcomingNote({ ...w, currency: undefined }, 'fighter_crax', 'general') === 'general');
  check('the winter prices and the server rule are unchanged (CRAX 249 ₽, effects 49 / 59 / 69 / 69 ₽; tokens only during the event)', approvedPriceRub('fighter_crax') === 249 && approvedPriceRub('season_clockwork_gold') === 49 && approvedPriceRub('season_candy_comet') === 59 && approvedPriceRub('season_frostlight_live') === 69 && approvedPriceRub('season_midnight_confetti') === 69 && read('backend/pb_hooks/lib/checkout.js').includes('seasonal_only'));
  const ui = read('src/ui/screens/ShopScreen.ts');
  check('the card shows the line only before the event (status «upcoming»), under the «СЕЗОННЫЙ · Откроется в …» it had — no price, no buy button', ui.includes("st.status === 'upcoming' && st.note.startsWith('Во время ')") && read('src/meta/Shop.ts').includes("status: 'upcoming',"));
}

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\narenapolish: FAILED (${failed} of ${checks.length})` : `\narenapolish: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
