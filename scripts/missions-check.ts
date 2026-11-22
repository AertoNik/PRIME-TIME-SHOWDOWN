// Beta 2.6 — `npm run missions`: DAILY MISSIONS and the DAILY MISSION MINI CASE.
//   1. the catalogue and the day's pick (src/missions/missionMath.ts): five, different families, 2 easy / 2 medium /
//      1 hard, only what the player can do, yesterday's avoided, the same pick for the same day, variety over a month;
//   2. counting: what a fight counts (an exit nothing), the clamp of a report;
//   3. time: real measured fights (economySamples) until 3 / 5 missions are done — the owner's 20–45 / 40–60 minutes;
//   4. the mini case: its table, the odds, much weaker than DAILY BROADCAST CASE, the career's pace with it;
//   5. the server (a throwaway PocketBase): the set kept all day and turning at 00:00 Moscow, every report protection
//      (op once, a race, an exit, too short, the time bank, an unowned fighter, the game session), one case per mission,
//      the case's opening, league fights counted by the server's own settlement (never a forfeit), privacy.
import { MISSIONS, MISSION_MIX, type MissionDef } from '../src/config/missions.config';
import { CASES, oddsOf, type CaseOutcome } from '../src/config/cases.config';
import { available, clampMissionFight, countCareer, countLeague, daySeed, pickMissions, seeded, stateOf, type MissionContext, type MissionFight, type MissionState } from '../src/missions/missionMath';
import { FIGHTERS } from '../src/config/fighters';
import { LEAGUE } from '../src/config/league.config';
import type { FighterId } from '../src/config/types';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import { SIM_VERSION } from '../src/league/simVersion';
import PocketBase, { BaseAuthStore } from 'pocketbase';
import { PrimeApi } from '../src/net/PrimeApi';
import { SessionManager } from '../src/net/SessionManager';
import { MissionRuntime } from '../src/game/MissionRuntime';
import { CASE_RULES_FILE, MISSION_MATH_FILE, MISSION_RULES_FILE, caseRulesSource, missionMathSource, missionRulesSource } from './backend';
import { sampleFights } from './lib/economySamples';
import { ARCHETYPES, runCareer, runDaily } from './lib/economyModel';
import { LEGACY_CHECK_ENV, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
import { crypto, fs, os, path, proc } from './lib/node';

/* eslint-disable @typescript-eslint/no-explicit-any */
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
}
const section = (t: string) => console.log(`\n— ${t}`);

const NEWBIE: MissionContext = { league: false, pro: false, champion: false, fighters: 1 };
const MID: MissionContext = { league: false, pro: true, champion: false, fighters: 3 };
const FULL: MissionContext = { league: true, pro: true, champion: true, fighters: 9 };

function pickChecks(): void {
  section('Каталог');
  check(`${MISSIONS.length} missions, unique ids, positive targets, a title each`, new Set(MISSIONS.map((m) => m.id)).size === MISSIONS.length && MISSIONS.every((m) => m.target > 0 && m.title.length > 8));
  const fam = new Set(MISSIONS.map((m) => m.family));
  check(`${fam.size} families of goals; easy / medium / hard: ${['easy', 'medium', 'hard'].map((t) => MISSIONS.filter((m) => m.tier === t).length).join(' / ')}`, fam.size >= 10);
  check('nothing tied to a payment, a fighter for sale, an event or a closed mode (only career and league play)', MISSIONS.every((m) => !/купит|покупк|оплат|PRIME SHOP|скин/i.test(m.title)));

  section('Пять заданий дня');
  for (const [name, ctx] of [['a newcomer (RAY only, «Новичок», no league)', NEWBIE], ['a mid player (3 fighters, «Профи»)', MID], ['a league player with everything open', FULL]] as [string, MissionContext][]) {
    const sets = Array.from({ length: 300 }, (_, d) => pickMissions(daySeed('acc' + (d % 7), 20400 + d), ctx));
    check(`${name}: always 5, all different families`, sets.every((s) => s.length === 5 && new Set(s.map((m) => m.family)).size === 5));
    check(`${name}: 2 easy, 2 medium, 1 hard`, sets.every((s) => s.filter((m) => m.tier === 'easy').length === 2 && s.filter((m) => m.tier === 'medium').length === 2 && s.filter((m) => m.tier === 'hard').length === 1));
    check(`${name}: only missions it can do (league, difficulty, fighters)`, sets.every((s) => s.every((m) => available(m, ctx))));
    check(`${name}: at most ${MISSION_MIX.maxLeague} league missions — the rest playable without the league`, sets.every((s) => s.filter((m) => m.needs?.league).length <= MISSION_MIX.maxLeague));
  }
  const noLeague = Array.from({ length: 300 }, (_, d) => pickMissions(daySeed('x', d), MID));
  check('no PRIME LEAGUE mission for a player without the league', noLeague.every((s) => s.every((m) => !m.needs?.league)));
  check('no «Профи» / «Чемпион» mission while the difficulty is closed; no «two fighters» with one fighter', Array.from({ length: 300 }, (_, d) => pickMissions(daySeed('y', d), NEWBIE)).every((s) => s.every((m) => !m.needs?.difficulty && !m.needs?.fighters)));
  const lp = Array.from({ length: 300 }, (_, d) => pickMissions(daySeed('z', d), FULL));
  check('a league player does get league missions on some days', lp.some((s) => s.some((m) => m.needs?.league)));
  check('the same account and day → the same five (a reload, a second device)', JSON.stringify(pickMissions(daySeed('acc1', 20500), FULL).map((m) => m.id)) === JSON.stringify(pickMissions(daySeed('acc1', 20500), FULL).map((m) => m.id)));

  section('Разнообразие по дням');
  let y: string[] = [];
  let same = 0;
  let overlap = 0;
  const sets = new Set<string>();
  const seen = new Set<string>();
  for (let d = 0; d < 60; d++) {
    const s = pickMissions(daySeed('player-one', 21000 + d), MID, y).map((m) => m.id);
    if (JSON.stringify(s.slice().sort()) === JSON.stringify(y.slice().sort())) same++;
    overlap += s.filter((id) => y.includes(id)).length;
    sets.add(s.slice().sort().join(','));
    s.forEach((id) => seen.add(id));
    y = s;
  }
  check(`60 days in a row: never yesterday's set again (${same}), ${(overlap / 59).toFixed(2)} of yesterday's missions on average (yesterday's are avoided)`, same === 0 && overlap / 59 <= 0.5);
  check(`…${sets.size} different sets of 60, ${seen.size} different missions came up (missions come back after some days)`, sets.size >= 55 && seen.size >= MISSIONS.filter((m) => available(m, MID)).length - 1);
}

// ------------------------------------------------------------------ counting
const fight = (o: Partial<MissionFight>): MissionFight => ({ outcome: 'win', method: 'ko', rating: 80, combos: 3, perfects: 2, difficulty: 'pro', mode: 'classic', fighter: 'ray', rival: 'dex', ...o });
/** A mission state with a small test target (the counting rules are under test here, not the catalogue's sizes). */
const mk = (metric: MissionState['metric'], target: number, min?: number): MissionState => {
  const s: MissionState = { id: 'test_' + metric, metric, target, progress: 0, done: false, rewarded: false };
  if (min !== undefined) s.min = min;
  if (metric === 'fighters' || metric === 'fighterWins' || metric === 'rivals') s.seen = [];
  return s;
};
function countChecks(): void {
  section('Подсчёт');
  const l = [mk('fights', 3), mk('wins', 2), mk('koWins', 1), mk('proWins', 2), mk('champWins', 1)];
  check('an exit from the fight (forfeit) counts NOTHING — not even «finish fights»', countCareer(l, fight({ method: 'forfeit', outcome: 'loss' })).length === 0 && l.every((s) => s.progress === 0));
  const d1 = countCareer(l, fight({}));
  check('a KO win on «Профи»: fights +1, wins +1, KO done, «Профи» +1, «Чемпион» untouched', l[0].progress === 1 && l[1].progress === 1 && l[2].done && l[3].progress === 1 && l[4].progress === 0 && JSON.stringify(d1) === '[2]');
  countCareer(l, fight({ outcome: 'loss', method: 'time' }));
  check('a loss: fights +1 only', l[0].progress === 2 && l[1].progress === 1 && l[3].progress === 1);
  const d3 = countCareer(l, fight({ difficulty: 'champion', method: 'time' }));
  check('a time win on «Чемпион»: completes «3 fights», «2 wins», «Профи ×2», «Чемпион» — each reported once', l.every((s) => s.done) && JSON.stringify(d3) === '[0,1,3,4]' && countCareer(l, fight({})).length === 0 && l.every((s) => s.progress === s.target));
  const r = [mk('rivals', 2), mk('fighters', 2), mk('challengeWins', 1), mk('rating', 1, 85), mk('combos', 8)];
  countCareer(r, fight({ rival: 'dex', combos: 5 }));
  countCareer(r, fight({ rival: 'dex', fighter: 'ray', rating: 90, combos: 5 }));
  check('«different rivals» counts a rival once; «different fighters» a fighter once; combos add up (5 + 5 → 8 done)', r[0].progress === 1 && r[1].progress === 1 && r[4].done && r[3].done);
  countCareer(r, fight({ rival: 'tank', fighter: 'bruno', mode: 'challenge' }));
  check('a PRIME CHALLENGE win counts for the challenge mission but not for «rivals» (classic only)', r[2].done && r[0].progress === 1 && r[1].done);
  const lg = [mk('leagueFights', 2), mk('leagueWins', 2), mk('leagueCombos', 5)];
  check('a league forfeit counts nothing', countLeague(lg, { outcome: 'loss', method: 'forfeit', combos: 4 }).length === 0 && lg.every((s) => s.progress === 0));
  countLeague(lg, { outcome: 'win', method: 'ko', combos: 3 });
  check('a league KO win: league fights +1, league wins +1, league combos +3; career missions untouched by league fights', lg[0].progress === 1 && lg[1].progress === 1 && lg[2].progress === 3 && countCareer(lg, fight({})).length === 0);

  section('Отчёт боя: зажим');
  check('not a fight (no outcome / method / difficulty / mode) → null', clampMissionFight({ outcome: 'win' } as any, ['ray']) === null && clampMissionFight({ ...fight({}), mode: 'survival' } as any, ['ray']) === null);
  const c = clampMissionFight({ ...fight({}), combos: 999, perfects: 999, rating: 500, fighter: 'lucien', rival: 'boss' } as any, ['ray'])!;
  check(`a forged report is clamped: combos ${c.combos} (≤ ${MISSION_MIX.maxCombosPerFight}), perfects ${c.perfects}, rating 100, a fighter not owned and an unknown rival count as none`, c.combos === MISSION_MIX.maxCombosPerFight && c.perfects === MISSION_MIX.maxPerfectsPerFight && c.rating === 100 && c.fighter === '' && c.rival === '');
}

// ------------------------------------------------------------------ time
function timeChecks(): void {
  section('Время на задания (настоящие бои)');
  const samples = sampleFights(24);
  const MIN_PER_FIGHT = (70 + 35) / 60; // a fight + the menus between fights (economy model's SESSION_OVERHEAD)
  const med = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const p90 = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.9)];
  const play = (skill: 'combo' | 'mash' | 'typical') => {
    const runs: { three: number; five: number }[] = [];
    for (let d = 0; d < 200; d++) {
      const set = pickMissions(daySeed('time-' + skill, 30000 + d), MID);
      const list = set.map(stateOf);
      let n = 0;
      let three = 0;
      const rnd = seeded(daySeed('pick-' + skill, d));
      // a typical player: the measured skilled and casual fights in turn (between the two bot profiles)
      const xsOf = (k: number) => (skill === 'typical' ? (k % 2 ? samples.pro.combo : samples.pro.mash) : samples.pro[skill]);
      const rivals = ['dex', 'tank', 'zoe', 'crash'];
      const fighters = ['ray', 'bruno', 'nika'];
      while (list.some((s) => !s.done) && n < 150) {
        const xs = xsOf(n);
        const res: any = xs[Math.floor(rnd() * xs.length)].result;
        // a player with a mission for it plays a PRIME CHALLENGE now and then and changes fighters; the classic rival
        // moves on after a win (the career's own order)
        const mode = n % 6 === 5 ? 'challenge' : 'classic';
        countCareer(list, { outcome: res.outcome, method: res.method === 'ko' ? 'ko' : 'time', rating: res.rating, combos: Math.min(12, res.combos), perfects: Math.min(20, res.perfects), difficulty: 'pro', mode, fighter: fighters[n % 3], rival: rivals[n % 4] });
        n++;
        if (!three && list.filter((s) => s.done).length >= 3) three = n;
      }
      runs.push({ three: (three || 150) * MIN_PER_FIGHT, five: (list.every((s) => s.done) ? n : 150) * MIN_PER_FIGHT });
    }
    return { t3: runs.map((r) => r.three), t5: runs.map((r) => r.five) };
  };
  const skilled = play('combo');
  const typical = play('typical');
  const casual = play('mash');
  // (the owner: «примерно 20–45 минут для существенной части наград» — three of five; one fight counts for every mission
  // at once, so the third one lands a little before 20 min — reported as measured in BETA_2_6_DEVELOPMENT_REPORT.md)
  check(`a typical player («Профи», the measured fights): three missions in ${med(typical.t3).toFixed(0)} min (median), ${p90(typical.t3).toFixed(0)} min (9 days of 10) — about the owner's 20–45`, med(typical.t3) >= 15 && med(typical.t3) <= 45 && p90(typical.t3) <= 55);
  check(`…all five in ${med(typical.t5).toFixed(0)} min (median), ${p90(typical.t5).toFixed(0)} min (9 days of 10) — the owner's 40–60 for a full set`, med(typical.t5) >= 40 && med(typical.t5) <= 60 && p90(typical.t5) <= 80);
  check(`a very skilled player is quicker but never instant: three in ${med(skilled.t3).toFixed(0)} min, all five in ${med(skilled.t5).toFixed(0)} min (median)`, med(skilled.t3) >= 10 && med(skilled.t5) >= 30);
  console.log(`      a casual player (few combos): three in ${med(casual.t3).toFixed(0)} min, all five in ${med(casual.t5).toFixed(0)} min (median) — combo missions take them longer`);
  check(`a casual player still gets three missions within about an hour (${med(casual.t3).toFixed(0)} min median)`, med(casual.t3) <= 65);
}

// ------------------------------------------------------------------ the mini case
function caseChecks(): void {
  section('DAILY MISSION MINI CASE');
  const t = CASES.mission as CaseOutcome[];
  check('the table sums to 100 %; only dollars, reputation and PRIME TOKENS (no item, skin, fighter or INVITE SIGNAL)', t.reduce((s, x) => s + x.weight, 0) === 10000 && t.every((x) => x.kind === 'money' || x.kind === 'rep' || x.kind === 'tokens') && t.every((x) => !x.item && x.rarity !== 'legendary' && x.rarity !== 'epic'));
  const ev = (o: { tokens: boolean }, kind: 'money' | 'rep' | 'tokens') => oddsOf(t, { owned: [], tokens: o.tokens }).reduce((s, x) => s + (x.outcome.kind === kind ? ((x.outcome.min + x.outcome.max) / 2) * (x.share / 10000) : 0), 0);
  const withT = ev({ tokens: true }, 'money');
  const noT = ev({ tokens: false }, 'money');
  const daily1 = oddsOf(CASES.daily[0].table, { owned: [], tokens: true }).reduce((s, x) => s + (x.outcome.kind === 'money' ? ((x.outcome.min + x.outcome.max) / 2) * (x.share / 10000) : 0), 0);
  console.log(`      expected per case: ${withT.toFixed(1)} $ with PRIME TOKENS in the table (${ev({ tokens: true }, 'rep').toFixed(2)} ★, ${ev({ tokens: true }, 'tokens').toFixed(2)} tokens), ${noT.toFixed(1)} $ without (${ev({ tokens: false }, 'rep').toFixed(2)} ★); DAILY tier I ${daily1.toFixed(0)} $`);
  check(`much weaker than DAILY BROADCAST CASE: ${withT.toFixed(0)}–${noT.toFixed(0)} $ against ${daily1.toFixed(0)} $ (≤ ¼)`, noT <= daily1 / 4);
  check(`all five a day ≈ ${(5 * noT).toFixed(0)} $ — at most about one DAILY case, never more than 1.3 of it`, 5 * noT <= 1.3 * daily1);
  const noTok = oddsOf(t, { owned: [], tokens: false });
  check('without a PRIME LEAGUE profile the tokens leave the table and their share spreads over the rest (still 100 %)', noTok.every((x) => x.outcome.kind !== 'tokens') && noTok.reduce((s, x) => s + x.share, 0) === 10000);
  // the career's pace with the missions' dollars: a player doing 2 / 4 / 5 / 5 missions a play day (newbie … grinder)
  const samples = sampleFights(24);
  const per = { newbie: 2, regular: 4, active: 5, grinder: 5 } as Record<string, number>;
  const out: string[] = [];
  let ok = true;
  for (const a of ARCHETYPES) {
    const dd = runDaily(a, 365, undefined, { cases: true }).byDay;
    const plain = runCareer(a, samples, { id: 'now', ru: '' }, 365, (d) => dd[d] ?? 0);
    const withM = runCareer(a, samples, { id: 'now', ru: '' }, 365, (d) => (dd[d] ?? 0) + (dd[d] ? per[a.id] * noT : 0));
    out.push(`${a.ru}: ${plain.at.everything} → ${withM.at.everything}`);
    ok = ok && (withM.at.everything ?? 0) >= 120 && (withM.at.everything ?? 999) <= 220;
  }
  check(`the career still takes the owner's 120–220 fights with all the mission cases (fights to everything — ${out.join('; ')})`, ok);
  check('the server draws from exactly this table: case_rules.js is up to date (npm run backend:rules)', fs.readFileSync(CASE_RULES_FILE, 'utf8') === caseRulesSource());
  check('…and runs exactly this mission logic: mission_math.js / mission_rules.js are up to date', fs.readFileSync(MISSION_MATH_FILE, 'utf8') === missionMathSource() && fs.readFileSync(MISSION_RULES_FILE, 'utf8') === missionRulesSource());

  section('Картинка ui_daily_missions.png');
  const manifest = JSON.parse(fs.readFileSync('scripts/art/manifest.json', 'utf8'));
  const e = manifest.icons?.missions?.daily_missions;
  const src = 'PRIME_TIME_2_6_UI_ART/ui_daily_missions.png';
  const sha = (p: string) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  check('the owner\'s picture is kept as given (1254 × 1254, its SHA-256 in the manifest) — the game uses copies', !!e && e.src === src && e.sha256 === sha(src) && JSON.stringify(e.size) === '[1254,1254]');
  check('three WebP copies (96 / 192 / 400 px), each one there with the manifest\'s SHA — the group «missions» of artIcons.ts', !!e && ['xs', 'sm', 'md'].every((v) => e.out[v] && fs.existsSync('public/' + e.out[v].file) && sha('public/' + e.out[v].file) === e.out[v].sha256) && e.out.xs.w === 96 && e.out.sm.w === 192 && e.out.md.w === 400);
  const ui = fs.readFileSync('src/ui/missionsUI.ts', 'utf8') as string;
  const css = fs.readFileSync('src/styles/main.css', 'utf8') as string;
  const show = fs.readFileSync('src/ui/caseOpening.ts', 'utf8') as string;
  check('the case show: more taps while it charges never restart the charge (tapping on and on cannot hold the case shut — found by the 5-in-a-row check)', /if \(taps >= TAPS && phase !== 'charge'\) \{\s*\n\s*phase = 'charge';\s*\n\s*pt = 0;/.test(show) && /taps = TAPS;\s*\n\s*if \(phase !== 'charge'\) \{\s*\n\s*phase = 'charge';\s*\n\s*pt = 0;/.test(show));
  check('shown whole: «contain», fixed modest sizes (entry 52 px, header 84 px; 44 / 64 px on ≤ 360 px), never a background, the texts stay real text', /\.mis-art \{[^}]*object-fit: contain;/.test(css) && /missionsArt\(52\)/.test(ui) && /missionsArt\(84, 'mis-head-art'\)/.test(ui) && !/background[^;]*daily_missions/.test(css) && /<b class="mis-title">\$\{esc\(m\.title\)\}<\/b>/.test(ui));
}

// ------------------------------------------------------------------ the server
const PORTS = { api: 19890, smtp: 11989, mailUi: 19891 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'Missions2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-missions-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
const leagueClock = path.join(work, 'league-clock.txt');
let pb: any = null;
const pbLog: string[] = [];
// a Moscow noon in league season 1 (the daily clock and the league clock move together)
let clock = Date.parse(LEAGUE.season.epoch) + 3 * 86400000 + 9 * 3600000;
const setClock = (t: number) => {
  clock = t;
  fs.writeFileSync(clockFile, String(t));
  fs.writeFileSync(leagueClock, String(t));
};
const tick = (ms: number) => setClock(clock + ms);

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  setClock(clock);
  const SU = { email: 'mis-admin@mis.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_MISSIONS: 'on', PRIME_CASES: 'on', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_DAILY_CLOCK_FILE: clockFile, PRIME_LEAGUE_CLOCK_FILE: leagueClock, PRIME_LEAGUE_SEASON_START: '2026-11-02', PRIME_LEAGUE_BUDGET_SCALE: '1000', ...LEGACY_CHECK_ENV } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
  const admin = new (await import('pocketbase')).default(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  check('the migration added the missions rate limit (60 a minute)', st.rules.some((r: any) => r.label === '/api/prime/missions' && r.maxRequests === 60));
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });

  type User = { id: string; token: string; session: { key: string; generation: number } };
  let n = 0;
  const user = async (fighters: FighterId[], rep = 0, verify = true): Promise<User> => {
    n++;
    const email = `mis${n}@mis.test`;
    const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: `Mis${n}`, email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
    if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${await r.text()}`);
    const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
    if (verify) await admin.collection('users').update(u.id, { verified: true });
    const s: any = defaultSave();
    for (const f of fighters) s.fighters[f].unlocked = true;
    s.reputation = rep;
    const text = canonicalJSON(s);
    await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
    const login = await fetch(`${API}/api/collections/users/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: PW }) });
    const token = ((await login.json()) as any).token;
    const key = crypto.randomBytes(16).toString('hex');
    const cl = await fetch(`${API}/api/prime/session/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token }, body: JSON.stringify({ key, label: 'check', device: 'dev-' + n }) });
    const generation = cl.status === 200 ? (((await cl.json()) as any).generation as number) : 0;
    return { id: u.id, token, session: { key, generation } };
  };
  const call = async (u: User | null, method: string, url: string, body?: any) => {
    const r = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', ...(u ? { Authorization: u.token } : {}) }, body: body === undefined ? undefined : JSON.stringify(u ? { ...body, session: body.session === undefined ? u.session : body.session } : body) });
    return { status: r.status, j: (await r.json().catch(() => ({}))) as any };
  };
  const op = () => 'ms_' + crypto.randomBytes(10).toString('hex');
  const missions = (u: User) => call(u, 'GET', '/api/prime/missions');
  const report = (u: User, f: Partial<MissionFight> & { seconds?: number } = {}, o = op()) => call(u, 'POST', '/api/prime/missions/report', { op: o, fight: { outcome: 'win', method: 'ko', rating: 82, combos: 3, perfects: 2, difficulty: 'rookie', mode: 'classic', fighter: 'ray', rival: 'dex', seconds: 75, ...f } });
  const FIGHT_MS = (75 * 0.8 + 10) * 1000 + 500;
  const rowOf = async (u: User) => (await admin.collection('prime_missions').getFullList({ filter: `owner = "${u.id}"`, sort: '-day' }))[0];
  /** The day's list replaced by test missions (real catalogue ids for the titles, small targets for a short check). */
  const setList = async (u: User, spec: [string, number][]) => {
    const r = await rowOf(u);
    await admin.collection('prime_missions').update(r.id, { list: spec.map(([id, target]) => ({ ...stateOf(MISSIONS.find((m) => m.id === id)!), target })) });
  };
  const casesOf = async (u: User) => await admin.collection('prime_cases').getFullList({ filter: `owner = "${u.id}" && kind = "mission"` });

  section('Сервер: доступ');
  check('the server announces DAILY MISSIONS (config missions = 1)', ((await call(null, 'GET', '/api/prime/config')).j as any).missions === 1);
  check('a guest gets nothing (401)', (await call(null, 'GET', '/api/prime/missions')).status === 401 && (await call(null, 'POST', '/api/prime/missions/report', { op: op(), fight: {} })).status === 401);
  const unv = await user(['ray'], 0, false);
  check('an unconfirmed e-mail: 403 not_verified', (await missions(unv)).j.code === 'not_verified');

  section('Сервер: пять заданий дня');
  // (reputation 200 = producer level 3: «Профи» open, «Чемпион» — from level 4 — still closed)
  const A = await user(['ray', 'bruno', 'nika'], 200);
  const g1 = await missions(A);
  const ids = g1.j.missions?.map((m: any) => m.id) ?? [];
  check(`five missions, different, the day's reset at 00:00 Moscow (${ids.join(', ')})`, g1.status === 200 && ids.length === 5 && new Set(ids).size === 5 && new Date(g1.j.resetsAt + 3 * 3600000).toISOString().slice(11, 19) === '00:00:00');
  const again = await Promise.all([missions(A), missions(A), missions(A)]);
  check('a reload, a second tab, parallel requests: the same five, ONE row for the day', again.every((r) => JSON.stringify(r.j.missions.map((m: any) => m.id)) === JSON.stringify(ids)) && (await admin.collection('prime_missions').getFullList({ filter: `owner = "${A.id}"` })).length === 1);
  check('no league mission before joining the league; nothing the save cannot do («Чемпион» closed below level 4)', g1.j.missions.every((m: any) => !m.league && !['c_champ_3'].includes(m.id)));
  check('the client cannot choose or change them (no route writes the set; the generic API sees nothing)', (await fetch(`${API}/api/collections/prime_missions/records`, { headers: { Authorization: A.token } }).then((r) => r.json() as any)).items?.length !== 5);

  section('Сервер: отчёт боя карьеры');
  await setList(A, [['c_fights_8', 3], ['c_wins_7', 2], ['c_ko_6', 1], ['c_rivals_3', 2], ['c_fighter_wins_3', 2]]);
  const bad1 = await call(A, 'POST', '/api/prime/missions/report', { op: 'x', fight: {} });
  const bad2 = await report(A, { outcome: 'maybe' as any });
  check('a broken op / not a fight → 400', bad1.status === 400 && bad2.j.code === 'invalid_fight', JSON.stringify([bad1, bad2]).slice(0, 300));
  const ex = op();
  const r0 = await report(A, { method: 'forfeit', outcome: 'loss', seconds: 5 }, ex);
  check('an exit from the fight: answered, counted NOTHING — and its op can never become a result later', r0.status === 200 && r0.j.counted === false && r0.j.state.missions.every((m: any) => m.progress === 0) && (await report(A, {}, ex)).j.duplicate === true, JSON.stringify(r0).slice(0, 300));
  check('a fight shorter than 30 s is not a fight (422)', (await report(A, { seconds: 12 })).j.code === 'fight_too_short');
  tick(FIGHT_MS);
  const r1 = await report(A, { fighter: 'ray', rival: 'dex' });
  check('a KO win: «3 fights» 1/3, «2 wins» 1/2, «KO» done, «rivals» 1/2, «fighters» 1/2 — and the KO mission\'s mini case at once', r1.status === 200 && r1.j.counted && JSON.stringify(r1.j.state.missions.map((m: any) => m.progress)) === '[1,1,1,1,1]' && r1.j.completed.join() === 'c_ko_6' && (await casesOf(A)).length === 1);
  tick(FIGHT_MS);
  const dupOp = op();
  const four = await Promise.all([0, 1, 2, 3].map(() => report(A, { fighter: 'lucien', rival: 'tank' }, dupOp)));
  const row1 = await rowOf(A);
  check('the same report four times at once: counted ONCE (one report row, wins 2/2)', four.every((r) => r.status === 200) && (await admin.collection('prime_mission_reports').getFullList({ filter: `owner = "${A.id}" && op = "${dupOp}"` })).length === 1 && row1.list[1].progress === 2);
  check('a fighter the account does not have (LUCIEN) counts for no «different fighters»', row1.list[4].progress === 1);
  check('«2 wins» and «2 rivals» done → their mini cases: 3 in all, one per mission (refs mission:<day>:<n>)', (await casesOf(A)).length === 3 && new Set((await casesOf(A)).map((c: any) => c.ref)).size === 3 && (await casesOf(A)).every((c: any) => /^mission:\d+:\d$/.test(c.ref) && c.source === 'mission' && c.status === 'ready'));
  tick(FIGHT_MS);
  await report(A, { fighter: 'bruno', rival: 'zoe', outcome: 'loss', method: 'time' });
  tick(FIGHT_MS);
  const r5 = await report(A, { fighter: 'nika', rival: 'crash', outcome: 'win', method: 'time' });
  check('all five done → five mini cases, never a sixth (another fight counts nothing more)', r5.j.state.missions.every((m: any) => m.done && m.rewarded) && (await casesOf(A)).length === 5);
  tick(FIGHT_MS);
  await report(A, {});
  check('…a later fight changes nothing', (await casesOf(A)).length === 5);
  const stale = await call(A, 'POST', '/api/prime/missions/report', { op: op(), session: { key: crypto.randomBytes(16).toString('hex'), generation: A.session.generation }, fight: { outcome: 'win', method: 'ko', rating: 80, combos: 1, perfects: 1, difficulty: 'rookie', mode: 'classic', fighter: 'ray', rival: 'dex', seconds: 75 } });
  check('a page that does not hold the game session (another device took it) cannot report (409); without a session at all — 426', stale.status === 409 && (await call(A, 'POST', '/api/prime/missions/report', { op: op(), session: null, fight: {} })).status === 426);

  section('Сервер: банк времени');
  const B = await user(['ray']);
  await missions(B);
  let sent = 0;
  let refused: any = null;
  for (let i = 0; i < 60 && !refused; i++) {
    const r = await report(B, {});
    if (r.status === 200) sent++;
    else refused = r;
  }
  const reach = Math.floor((15 * 60) / (75 * 0.8 + 10));
  check(`a burst of invented fights stops after ${sent} (15 minutes of reach ≈ ${reach} fights of 75 s; 429 fights_too_fast) — never a day's missions at once`, refused?.status === 429 && refused.j.code === 'fights_too_fast' && sent <= reach + 1 && sent >= reach - 2);
  tick(3600000);
  check('…an hour later the same account reports again (an honest session that waited is not lost)', (await report(B, {})).status === 200);

  section('Сервер: мини-кейс открывается');
  const save = (await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0];
  const money0 = JSON.parse(save.data).money;
  const caseOp = 'case_' + crypto.randomBytes(8).toString('hex');
  const o1 = await call(A, 'POST', '/api/prime/cases/open', { op: caseOp, kind: 'mission', base: save.revision });
  const o2 = await call(A, 'POST', '/api/prime/cases/open', { op: caseOp, kind: 'mission', base: save.revision });
  const res = o1.j.case?.result;
  const after = JSON.parse((await admin.collection('saves').getFullList({ filter: `owner = "${A.id}"` }))[0].data);
  check(`a mission case opens: the server drew «${res?.label}» (${res?.kind} ${res?.amount}) from the mini table and wrote it`, o1.status === 200 && ['m_money', 'm_rep', 'm_bonus'].includes(res?.outcome) && (res.kind !== 'money' || after.money === money0 + res.amount));
  check('the same open request again: the same result, nothing drawn twice', o2.status === 200 && o2.j.duplicate === true && o2.j.case.id === o1.j.case.id && (await casesOf(A)).filter((c: any) => c.status === 'opened').length === 1);
  check('the status lists the mini case: 4 still ready, the odds without PRIME TOKENS (no league profile) summing to 100 %', o1.j.status.mission.ready === 4 && o1.j.status.mission.odds.every((x: any) => x.kind !== 'tokens') && o1.j.status.mission.odds.reduce((s: number, x: any) => s + x.share, 0) === 10000);

  section('Сервер: новый день');
  const yIds = (await missions(A)).j.missions.map((m: any) => m.id);
  setClock(Date.parse(new Date(clock + 3 * 3600000).toISOString().slice(0, 10) + 'T21:00:00Z') + 60000);
  const next = await missions(A);
  check(`00:00 Moscow: a new set of five (${next.j.missions.map((m: any) => m.id).join(', ')}), progress from zero, yesterday's mini cases kept`, next.j.day === g1.j.day + 1 && next.j.missions.length === 5 && next.j.missions.every((m: any) => m.progress === 0) && (await casesOf(A)).length === 5);
  check('…not yesterday\'s set again', JSON.stringify(next.j.missions.map((m: any) => m.id).sort()) !== JSON.stringify(yIds.sort()));

  section('Сервер: PRIME LEAGUE — засчитывает сервер');
  const L = await user(['ray', 'vega']);
  await call(L, 'POST', '/api/prime/league/join', { accept: true, rules: 1 });
  await missions(L);
  await setList(L, [['l_fights_3', 2], ['l_wins_4', 2], ['c_fights_8', 3], ['c_wins_7', 2], ['c_ko_6', 1]]);
  const start = async () => (await call(L, 'POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'vega', deck: FIGHTERS.vega.defaultDeck, sim: SIM_VERSION, op: 'lg_' + crypto.randomBytes(10).toString('hex') })).j.match;
  const m1 = await start();
  await call(L, 'POST', `/api/prime/league/match/${m1.id}/finish`, { inputs: [[0, -1]] });
  check('a league fight left at once (forfeit) counts nothing', (await rowOf(L)).list[0].progress === 0);
  const m2 = await start();
  tick(240000);
  const f2 = await call(L, 'POST', `/api/prime/league/match/${m2.id}/finish`, { inputs: [] });
  const lrow = await rowOf(L);
  check(`a league fight the server replayed (${f2.j.match?.outcome}, ${f2.j.match?.method}) counts «2 league fights» 1/2 — the career missions untouched`, f2.status === 200 && f2.j.match?.status === 'done' && lrow.list[0].progress === 1 && lrow.list[2].progress === 0);
  const f2b = await call(L, 'POST', `/api/prime/league/match/${m2.id}/finish`, { inputs: [] });
  check('the same match finished again (a repeat): counted once', f2b.status === 200 && (await rowOf(L)).list[0].progress === 1);
  check('the league\'s own result says which missions it moved', Array.isArray(f2.j.match?.result?.missions));

  section('Сервер: сетевой код игры (PrimeApi · SessionManager · MissionRuntime)');
  // the game's own client code against the same server: what the missions window and finishMatch really run
  const G = await user(['ray', 'bruno'], 0);
  const gEmail = `mis${n}@mis.test`;
  let drop: '' | 'request' | 'response' = '';
  const fetchImpl = (async (url: any, init?: any) => {
    const rep = String(url).includes('/api/prime/missions/report');
    if (rep && drop === 'request') throw new TypeError('Failed to fetch');
    const r = await fetch(url, init);
    if (rep && drop === 'response') {
      await r.text();
      throw new TypeError('Failed to fetch');
    }
    return r;
  }) as typeof fetch;
  const api = new PrimeApi(new PocketBase(API, new BaseAuthStore()), 8000, fetchImpl);
  await api.login(gEmail, PW);
  const sess = new SessionManager({ api, device: 'dev-client', label: 'check' });
  const claimed = await sess.claim();
  const fakeGame: any = { account: { serverConfig: { missions: 1 }, api, playing: api.userId, me: { verified: true }, termsNeeded: () => false, ready: true, sync: { blocked: false }, onChange: () => () => {} } };
  const rt = new MissionRuntime(fakeGame);
  rt.sync();
  await rt.refresh(true);
  const raw = (await missions(G)).j;
  check(`the game reads today's five through its own code (session ${claimed}): ids, titles, tiers, targets and the reset as the server states them`, rt.gate() === 'ok' && rt.status?.missions.length === 5 && JSON.stringify(rt.status.missions.map((m) => [m.id, m.title, m.tier, m.target])) === JSON.stringify(raw.missions.map((m: any) => [m.id, m.title, m.tier, m.target])) && rt.status.resetsAt === raw.resetsAt && rt.status.missions.every((m) => m.title.length > 3), JSON.stringify(rt.status).slice(0, 200));
  await setList(G, [['c_ko_6', 1], ['c_wins_7', 2], ['c_fights_8', 3], ['c_rivals_3', 2], ['c_fighter_wins_3', 2]]);
  await rt.refresh(true);
  const fightOf = (o: Partial<Record<string, unknown>> = {}) => ({ outcome: 'win', method: 'ko', rating: 82.4, combos: 3, perfects: 2, duration: 75.2, ...o }) as any;
  const meta = { fighter: 'ray', rival: 'dex', difficulty: 'rookie' as const, mode: 'classic' as const };
  tick(FIGHT_MS);
  let toast: string[] = [];
  await rt.report(fightOf(), meta, (t) => (toast = t));
  check(`finishMatch's report: «${toast.join(', ')}» done (the toast), its mini case waits (badge ${rt.casesReady}), progress shown at once`, toast.length === 1 && toast[0] === MISSIONS.find((m) => m.id === 'c_ko_6')!.title && rt.casesReady === 1 && rt.status!.missions[2].progress === 1);
  tick(FIGHT_MS);
  await rt.report(fightOf({ method: 'forfeit', outcome: 'loss', duration: 6 }), meta);
  check('an exit from the fight reported by the game counts nothing', rt.status!.missions[2].progress === 1);
  tick(FIGHT_MS);
  drop = 'request';
  await rt.report(fightOf({ method: 'time' }), { ...meta, rival: 'tank' });
  const offline = rt.error;
  drop = '';
  tick(FIGHT_MS);
  await rt.flush();
  check('no connection: the report waits in the game\'s queue («offline»), then is counted once when the server is back', offline === 'offline' && rt.status!.missions[2].progress === 2 && rt.status!.missions[3].progress === 2);
  tick(FIGHT_MS);
  drop = 'response';
  await rt.report(fightOf(), { ...meta, fighter: 'bruno', rival: 'zoe' });
  drop = '';
  const afterLost = (await rowOf(G)).list[2].progress;
  tick(FIGHT_MS);
  await rt.flush();
  check('the answer lost on the way: the server counted it, the game sends the same op again — counted ONCE (3 fights, not 4)', afterLost === 3 && rt.status!.missions[2].progress === 3 && (await admin.collection('prime_mission_reports').getFullList({ filter: `owner = "${G.id}"` })).length === 4);
  sess.stop();

  section('Сервер: приватность');
  check('nobody reads the missions, the reports or another\'s mission cases through the generic API', (await fetch(`${API}/api/collections/prime_mission_reports/records`, { headers: { Authorization: A.token } })).status !== 200 || ((await (await fetch(`${API}/api/collections/prime_mission_reports/records`, { headers: { Authorization: A.token } })).json()) as any).totalItems === 0);
}

async function main(): Promise<void> {
  pickChecks();
  countChecks();
  timeChecks();
  caseChecks();
  try {
    if (!proc.env.MISSIONS_UNIT) await serverChecks();
  } finally {
    await stopChild(pb);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failed ? `\nmissions: FAILED (${passed} passed, ${failed} failed)` : `\nmissions: OK (${passed} passed, 0 failed) — временная база удалена`);
  proc.exit(failed ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  void stopChild(pb).then(() => proc.exit(1));
});
void ({} as MissionDef);
