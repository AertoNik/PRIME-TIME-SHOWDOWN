// Beta 2.6.1 — `npm run primeshare`: PRIME SHARE, the victory poster of a PRIME LEAGUE win.
//   1. the rule (pure): offered only for a win the server confirmed, fought to its end (no forfeit, no fight the server
//      finished at its deadline), show rating ≥ 80 — 79 no, 80 yes; loss, draw, void, an unconfirmed match: no;
//   2. the facts: those of THAT fight only (the server's numbers; the best combo only when the game's fight is the
//      server's bit for bit), frozen — a later change of the match object, the wardrobe or the screen never alters them;
//      VICTORY or TOURNAMENT WINNER by what was really won (a squad won, a qualifier passed);
//   3. the code: the button only on the league's result screen, the window only on a tap, PNG 1080 × 1350 in its own
//      pixels, the main WebGL context only (no second one), everything let go on close (any path), «Share» only where
//      the browser can share a file, nothing paid, counted or sent;
//   4. the server (a throwaway PocketBase): a real league fight's answer carries what the rule reads (status, outcome,
//      method, how, rating, the game's hash) and the rule decides on it; a forfeit is never offered.
import PocketBase from 'pocketbase';
import { Match } from '../src/combat/Match';
import { LEAGUE } from '../src/config/league.config';
import { POSTER, POSTER_POSE, POSTER_SITE, SHARE_MIN_RATING } from '../src/config/primeShare';
import { VICTORY_SETS } from '../src/config/animation';
import { FIGHTERS } from '../src/config/fighters';
import type { CardId, FighterId } from '../src/config/types';
import { setLang } from '../src/i18n/lang';
import { defaultSave } from '../src/meta/SaveSystem';
import { canonicalJSON } from '../src/net/cloudSave';
import type { LeagueFinish, LeagueMatch } from '../src/net/LeagueApi';
import { leagueConfig, replayLeague, type LeagueInput, type LeagueSnapshot } from '../src/league/replay';
import { SIM_VERSION } from '../src/league/simVersion';
import { posterBlock, posterFacts } from '../src/ui/primeShare';
import { comboBot, type BotState } from './bots';
import { LEGACY_CHECK_ENV, ROOT, binariesReady, ensurePortsFree, ownServerStarted, registrationExtras, spawnPocketBase, stopChild, upsertSuperuser, waitHealthy } from './lib/backendKit';
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
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
setLang('ru');

// ------------------------------------------------------------------ a match as the server answers it
function view(o: Partial<LeagueMatch> = {}): LeagueMatch {
  return {
    id: 'm1', mode: 'duel', series: null, round: 0, status: 'active', ranked: true, season: 1, sim: SIM_VERSION, seed: 7, arena: 'newsroom', started: 1, expires: 2,
    attacker: { fighter: 'ace', deck: ['dash', 'shield', 'overdrive', 'main_event'] }, defender: { fighter: 'bruno', deck: ['dash', 'shield', 'overdrive', 'knockout'], tactic: 'balance' } as any,
    hpMult: [1, 1], dmgMult: [1, 1], opponent: { kind: 'player', name: 'DefenseKing', look: null }, ...o,
  } as LeagueMatch;
}
function done(o: { rating?: number; outcome?: 'win' | 'loss' | 'draw'; method?: 'ko' | 'time' | 'forfeit'; how?: string; status?: 'done' | 'void' | 'active'; clientHash?: number | null; ceremony?: any[]; mode?: LeagueMatch['mode']; noResult?: boolean } = {}): LeagueMatch {
  const v = view(o.mode ? { mode: o.mode } : {});
  return {
    ...v, status: o.status ?? 'done', outcome: o.outcome ?? 'win', method: o.method ?? 'ko', how: o.how ?? 'finish',
    result: o.noResult ? null : { hp: [0.5, 0], rating: o.rating ?? 90, duration: 83.4, steps: 5004, cardsUsed: 7, combos: 5, hash: 99, clientHash: o.clientHash === undefined ? 99 : o.clientHash, ceremony: o.ceremony ?? [] },
  } as LeagueMatch;
}
const local = { outcome: 'win', method: 'ko', rating: 90, peakRating: 95, avgRating: 80, bestCombo: 'superstar', combos: 5, comboList: ['superstar'], perfects: 0, damageDealt: 1, damageTaken: 1, cardsUsed: 7, duration: 83.4, playerHpFrac: 0.5, enemyHpFrac: 0, finisher: true } as any;

function ruleChecks(): void {
  section('Правило: когда предлагается постер');
  check(`the threshold is ${SHARE_MIN_RATING} inclusive`, SHARE_MIN_RATING === 80);
  check('a win with rating 79 → no poster (low_rating)', posterBlock(done({ rating: 79 })) === 'low_rating');
  check('a win with rating 80 → the poster', posterBlock(done({ rating: 80 })) === null);
  check('a win with rating 100 → the poster', posterBlock(done({ rating: 100 })) === null);
  check('a win by time (not a KO) with 85 → the poster', posterBlock(done({ rating: 85, method: 'time' })) === null);
  check('a loss (even rated 95) → no poster', posterBlock(done({ rating: 95, outcome: 'loss' })) === 'not_win');
  check('a draw → no poster', posterBlock(done({ rating: 95, outcome: 'draw' })) === 'not_win');
  check('a forfeit (the player left) → no poster', posterBlock(done({ rating: 95, outcome: 'loss', method: 'forfeit' })) !== null && posterBlock(done({ rating: 95, method: 'forfeit' })) === 'not_played_out');
  check('a fight the server finished at its deadline (how: expired) → no poster', posterBlock(done({ rating: 95, how: 'expired' })) === 'not_played_out');
  check('a match the server has not confirmed (active / void / no result / nothing) → no poster', posterBlock(done({ status: 'active' })) === 'not_confirmed' && posterBlock(done({ status: 'void' })) === 'not_confirmed' && posterBlock(done({ noResult: true })) === 'not_confirmed' && posterBlock(null) === 'not_confirmed');

  section('Факты постера: только этот бой');
  const v = view();
  const res: LeagueFinish = { match: done({ rating: 94 }), series: null };
  const f = posterFacts(v, res, local, 'ace', 'NightProducer', Date.parse('2026-11-23T12:00:00Z'))!;
  check('fighter, look, the opponent and the opponent\'s fighter come from the match', f.fighter === 'ace' && f.look === 'ace' && f.opponent === 'DefenseKing' && f.opponentFighter === 'bruno' && f.arena === 'newsroom' && f.match === 'm1');
  check('the server\'s numbers: rating 94 (grade S), KO, 83 s, 5 combos', f.rating === 94 && f.grade === 'S' && f.method === 'ko' && f.duration === 83 && f.combos === 5);
  check('the best combo (the game\'s own record) only because the game\'s fight = the server\'s (hash)', f.bestCombo === 'SUPERSTAR MOVE');
  const other = posterFacts(v, { match: done({ rating: 94, clientHash: 12345 }), series: null }, local, 'ace', null, 1)!;
  const noHash = posterFacts(v, { match: done({ rating: 94, clientHash: null }), series: null }, local, 'ace', null, 1)!;
  check('a different or missing game hash → no best combo (never a guess), the rest stays', other.bestCombo === null && noHash.bestCombo === null && other.combos === 5);
  check('no local record → no best combo', posterFacts(v, res, null, 'ace', null, 1)!.bestCombo === null);
  check('the producer is the player\'s own nickname or nothing', f.producer === 'NightProducer' && other.producer === null);
  check('a plain duel win → VICTORY · PRIME DUEL', f.headline === 'VICTORY' && f.context === 'PRIME DUEL');
  check('no facts for a fight with no poster (79) or for another match id', posterFacts(v, { match: done({ rating: 79 }), series: null }, local, 'ace', null, 1) === null && posterFacts(view({ id: 'other' }), res, local, 'ace', null, 1) === null);
  // a look: the fighter's own, a PRIME SHOP skin of THIS fighter; anything else → the fighter's own
  const skin = posterFacts(view({ attacker: { fighter: 'bruno', deck: ['dash', 'shield', 'overdrive', 'knockout'] } as any }), { match: { ...done({ rating: 90 }), attacker: { fighter: 'bruno', deck: [] } as any }, series: null }, local, 'bruno_casino_boss', null, 1)!;
  check('a worn PRIME SHOP skin is drawn and named (BRUNO · CASINO BOSS)', skin.look === 'bruno_casino_boss' && skin.skin === 'CASINO BOSS' && skin.fighter === 'bruno');
  const foreign = posterFacts(v, res, local, 'ghost_look_xyz', null, 1)!;
  check('an unknown look → the fighter\'s own look (never another picture)', foreign.look === 'ace' && foreign.skin === null);
  // frozen: the object is a copy of numbers and strings
  const m = done({ rating: 91 });
  const frozen = posterFacts(v, { match: m, series: null }, local, 'ace', null, 5)!;
  m.result!.rating = 10;
  m.outcome = 'loss';
  (m.attacker as any).fighter = 'ray';
  check('the facts are frozen: changing the match object afterwards changes nothing', frozen.rating === 91 && frozen.fighter === 'ace' && frozen.headline === 'VICTORY');

  section('Факты постера: VICTORY или TOURNAMENT WINNER');
  const squad = { kind: 'squad', status: 'done', wins: 2, losses: 1, draws: 0, results: [], done: { won: true, rp: 30, air: 10, tokens: 5 } } as any;
  const sq = posterFacts(view({ mode: 'squad', round: 2 }), { match: done({ rating: 88, mode: 'squad' }), series: squad }, local, 'ace', null, 1)!;
  check('the duel that won a PRIME SQUAD → TOURNAMENT WINNER · PRIME SQUAD · 2–1', sq.headline === 'TOURNAMENT WINNER' && sq.context === 'PRIME SQUAD · 2–1');
  const sqOpen = posterFacts(view({ mode: 'squad', round: 0 }), { match: { ...done({ rating: 88, mode: 'squad' }), round: 0 }, series: { ...squad, status: 'active', done: null } }, local, 'ace', null, 1)!;
  check('a squad duel won while the squad goes on → VICTORY · PRIME SQUAD · ДУЭЛЬ 1/3', sqOpen.headline === 'VICTORY' && sqOpen.context === 'PRIME SQUAD · ДУЭЛЬ 1/3');
  const sqLost = posterFacts(view({ mode: 'squad', round: 2 }), { match: done({ rating: 88, mode: 'squad' }), series: { ...squad, done: { won: false, rp: -10 } } }, local, 'ace', null, 1)!;
  check('a duel won in a squad that was lost overall → only VICTORY (never «winner» of a lost squad)', sqLost.headline === 'VICTORY');
  const q = posterFacts(view({ mode: 'challenge' }), { match: done({ rating: 86, mode: 'challenge', ceremony: [{ kind: 'rank', rank: 3, challenge: true }] }), series: null }, local, 'ace', null, 1)!;
  check('the duel that passed a PRIME CHALLENGE qualifier → TOURNAMENT WINNER · КВАЛИФИКАЦИЯ ПРОЙДЕНА', q.headline === 'TOURNAMENT WINNER' && q.context === 'PRIME CHALLENGE · КВАЛИФИКАЦИЯ ПРОЙДЕНА');
  const q2 = posterFacts(view({ mode: 'challenge' }), { match: done({ rating: 86, mode: 'challenge' }), series: null }, local, 'ace', null, 1)!;
  check('a qualifier duel won before it is passed → VICTORY · PRIME CHALLENGE · КВАЛИФИКАЦИЯ', q2.headline === 'VICTORY' && q2.context === 'PRIME CHALLENGE · КВАЛИФИКАЦИЯ');
  const rush = posterFacts(view({ mode: 'rush', round: 4 }), { match: { ...done({ rating: 86, mode: 'rush' }), round: 4 }, series: null }, local, 'ace', null, 1)!;
  check('PRIME RUSH has no winner — its duel win is VICTORY · PRIME RUSH · ДУЭЛЬ 5', rush.headline === 'VICTORY' && rush.context === 'PRIME RUSH · ДУЭЛЬ 5');

  section('Позы постера');
  const styles = [...new Set(Object.values(FIGHTERS).map((x) => x.victoryStyle))];
  check(`every player fighter's victory style has a chosen pose that exists in its set (${styles.length})`, styles.every((s) => !!POSTER_POSE[s] && (VICTORY_SETS[s] as readonly string[]).includes(POSTER_POSE[s]!.move) && POSTER_POSE[s]!.at > 0 && POSTER_POSE[s]!.at < 4));
}

function codeChecks(): void {
  section('Код: где и когда');
  const ps = read('src/ui/primeShare.ts');
  const st = read('src/render/PosterStudio.ts');
  const ls = read('src/ui/screens/LeagueScreen.ts');
  const ui = read('src/ui/UI.ts');
  const srcFiles = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d: any) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));
  const users = (name: RegExp) => srcFiles('src').filter((f) => f !== 'src/ui/primeShare.ts' && !f.startsWith('src/dev/') && name.test(read(f)));
  check('only the league\'s result screen offers the poster (posterButton / openPosterPreview nowhere else)', JSON.stringify(users(/posterButton|openPosterPreview|posterFacts/)) === JSON.stringify(['src/ui/screens/LeagueScreen.ts']));
  check('the button is drawn only when the facts exist for THIS match; the window opens only on its tap', /\$\{this\.poster && this\.poster\.match === m\.id \? posterButton\(\) : ''\}/.test(ls) && /act === 'poster' && this\.poster\) \{\s*g\.audio\.ui\('click'\);\s*openPosterPreview\(g, this\.poster\);/.test(ls) && (ls.match(/openPosterPreview\(/g) ?? []).length === 1);
  check('the facts are taken once, from the server\'s answer (confirm), reset for every new result', /this\.poster = posterFacts\(this\.view, this\.res, this\.local, this\.look/.test(ls) && /this\.poster = null;/.test(ls));
  check('the look is the one the fight was drawn in (Game passes fighterLook with the result)', /show\('leagueResult', \{ view: mode\.view, local: m\.result, look: this\.fighterLook\(mode\.view\.attacker\.fighter\) \}\)/.test(read('src/game/Game.ts')));
  check('the hero shot is drawn only by drawPoster, drawPoster only by the preview window', users(/renderHeroShot/).filter((x) => x !== 'src/render/PosterStudio.ts').join() === '' && (ps.match(/renderHeroShot\(/g) ?? []).length === 1 && /canvas = await drawPoster\(g, f\)/.test(ps));
  check('the fight never draws it (no poster code in BattleView / BattleHUD / Match)', !/primeShare|PosterStudio/.test(read('src/render/BattleView.ts') + read('src/ui/screens/BattleHUD.ts') + read('src/combat/Match.ts')));

  section('Код: качество и ресурсы');
  check(`the poster is ${POSTER.width} × ${POSTER.height} (4:5) PNG, in its own pixels`, POSTER.width === 1080 && POSTER.height === 1350 && /toBlob\(\(b\) => \(b \? ok\(b\) : fail\(new Error\('toBlob'\)\)\), 'image\/png'\)/.test(ps) && /width: W, height: H/.test(ps));
  check('the 3D is drawn with the game\'s own context in tiles (no second WebGLRenderer, no render target)', !/new WebGLRenderer|WebGLRenderTarget|getContext\('webgl/.test(st + ps) && /const gl = r\.renderer;/.test(st) && /setViewOffset\(W, H, tx \+ offX, ty \+ offY, w, h\)/.test(st));
  check('the renderer is put back (state, viewport, clear colour, shadows) and the screen\'s frame redrawn', /finally \{[\s\S]*gl\.setScissorTest\(false\);[\s\S]*gl\.setRenderTarget\(prevTarget\);[\s\S]*gl\.setClearColor\(prevClear, prevAlpha\);[\s\S]*gl\.shadowMap\.enabled = shadowsWere;[\s\S]*r\.render\(0\);/.test(st));
  check('the fighter on stage is never touched: the studio copy is posed when the usual one stands in a scene', /usual\.rig\.root\.parent \? models\.get\(look, 'studio'\) : usual/.test(st));
  check('its lights are disposed, the measuring canvas freed', /key\.dispose\(\);[\s\S]*kick\.dispose\(\);[\s\S]*probe\.width = probe\.height = 0;/.test(st));
  check('the hero canvas and glow canvases are freed after composing; the poster canvas after the PNG', /hero\.canvas\.width = hero\.canvas\.height = 0;/.test(ps) && /halo\.width = halo\.height = 0;/.test(ps) && /if \(canvas\) canvas\.width = canvas\.height = 0;/.test(ps));
  check('closing the window by ANY path revokes the PNG\'s URL and drops the file (UI.modal onClose)', /const free = \(\) => \{[\s\S]*URL\.revokeObjectURL\(url\);[\s\S]*file = null;/.test(ps) && /true,\s*free,\s*\);/.test(ps) && /closeModal\(\): void \{[\s\S]*const done = this\.modalClose;[\s\S]*done\?\.\(\);/.test(ui) && /this\.modalClose = onClose \?\? null;/.test(ui));
  check('a window closed while drawing never fills itself afterwards (alive flag)', (ps.match(/if \(!alive\) return;/g) ?? []).length >= 3);
  check('«Share» is offered only when the browser can share an image file; a closed sheet is not an error', /const share = canShareFile\(file\);/.test(ps) && /n\.canShare\(\{ files: \[file\] \}\)/.test(ps) && /name !== 'AbortError'/.test(ps));
  check('«Save» is a download of the PNG (an <a download>), never a promise of the Photos app', /a\.download = file\.name;/.test(ps) && !/Фото|Photos|фотоплёнк|camera roll/i.test(ps));
  check('the window says honestly what each button does (PNG to downloads; the device\'s share menu)', /PNG 1080×1350 в загрузки/.test(ps) && /системное меню устройства/.test(ps));
  check(`the site ${POSTER_SITE} and the show's name are on every poster`, /ctx\.fillText\(POSTER_SITE, M, H - 28\)/.test(ps) && /fillText\('PRIME TIME', lx, 90\)/.test(ps) && /'SHOWDOWN'/.test(ps));
  check('a KO is printed only when the fight ended by one', /if \(f\.method === 'ko'\) \{/.test(ps));
  check('the button: «Постер победы» with an icon, a 44 px target, no automatic window', /Постер победы/.test(ps) && /min-height: 44px;/.test(read('src/styles/main.css')) && !/openPosterPreview\(g, this\.poster\);\s*\}\s*\n\s*\}\);\s*\n\s*\}\s*\n\s*onShow/.test(ls));

  section('Код: экономика и данные не затронуты');
  check('PRIME SHARE pays, counts and sends nothing (no save, no API, no network beyond the game\'s own pictures)', !/\bg\.save\b|save\.data|\.save\.save|\.league\.|account\.api|\bfetch\(|XMLHttpRequest|sendBeacon|\.career\.|\.shop\./.test(ps + st));
  check('rewards, RP and the result text are unchanged — the result screen\'s numbers come from the server as before', /statTiles\(m: LeagueMatch\)/.test(ls) && /<b data-rp="\$\{rp\}">/.test(ls));
}

// ------------------------------------------------------------------ the server
const PORTS = { api: 19490, smtp: 11949, mailUi: 19491 };
const API = `http://127.0.0.1:${PORTS.api}`;
const PW = 'PrimeShare2026pass';
const work: string = fs.mkdtempSync(path.join(os.tmpdir(), 'prime-primeshare-check-'));
const dataDir = path.join(work, 'pb_data');
const clockFile = path.join(work, 'clock.txt');
let clock = Date.parse(LEAGUE.season.epoch) + 2 * 86400000;
const setClock = (t: number) => {
  clock = t;
  fs.writeFileSync(clockFile, String(t));
};
let pb: any = null;
const pbLog: string[] = [];

function botTaps(s: LeagueSnapshot, react: number): LeagueInput[] {
  const m = new Match(leagueConfig(s));
  const taps: LeagueInput[] = [];
  const orig = m.playCard.bind(m);
  m.playCard = (side, i) => {
    if (side === 0) taps.push([m.steps, i]);
    return orig(side, i);
  };
  const st: BotState = { think: 0, react: -1, reactKey: '' };
  while (m.phase !== 'over' && m.steps < 60 * 90) {
    comboBot(m, st, 1 / 60, react);
    m.step(1 / 60);
    m.drainEvents();
  }
  return taps;
}

async function serverChecks(): Promise<void> {
  if (!binariesReady()) {
    check('PocketBase installed for the server checks (npm run backend:install)', false);
    return;
  }
  await ensurePortsFree([PORTS.api]);
  console.log(`\nВременная база: ${work}`);
  const SU = { email: 'ps-admin@ps.test', pw: crypto.randomBytes(18).toString('base64url') };
  upsertSuperuser(dataDir, SU.email, SU.pw, PORTS);
  setClock(clock);
  pb = spawnPocketBase({ dir: dataDir, ports: PORTS, origins: ['http://localhost:5173'], env: { PRIME_REGISTRATION: 'public', PRIME_SERVER_ROLE: 'dev', PRIME_LEAGUE: 'on', PRIME_LEAGUE_TOKENS: 'on', PRIME_LEAGUE_CLOCK_FILE: clockFile, PRIME_LEAGUE_SEASON_START: '2026-11-02', PRIME_LEAGUE_BUDGET_SCALE: '1000', ...LEGACY_CHECK_ENV } });
  const keep = (b: unknown) => {
    for (const l of String(b).split('\n')) if (l.trim()) pbLog.push(l);
    if (pbLog.length > 300) pbLog.splice(0, pbLog.length - 300);
  };
  pb.stdout.on('data', keep);
  pb.stderr.on('data', keep);
  if (!(await waitHealthy(API + '/api/health')) || !(await ownServerStarted(pb, pbLog))) throw new Error('PocketBase did not start:\n' + pbLog.slice(-15).join('\n'));
  const admin = new PocketBase(API);
  admin.autoCancellation(false);
  await admin.collection('_superusers').authWithPassword(SU.email, SU.pw);
  const st = (await admin.settings.getAll()).rateLimits;
  await admin.settings.update({ rateLimits: { enabled: true, rules: st.rules.map((r: any) => ({ ...r, maxRequests: r.maxRequests * 1000 })) } });
  const email = 'ps1@ps.test';
  const r = await fetch(`${API}/api/prime/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nickname: 'ShareStar', email, password: PW, passwordConfirm: PW, ...(await registrationExtras(API)) }) });
  if (r.status !== 200) throw new Error(`register: ${r.status}`);
  const u = (await admin.collection('users').getFullList({ filter: `email = "${email}"` }))[0];
  await admin.collection('users').update(u.id, { verified: true });
  const s: any = defaultSave();
  for (const f of ['ray', 'ace', 'vega'] as FighterId[]) s.fighters[f].unlocked = true;
  const text = canonicalJSON(s);
  await admin.collection('saves').create({ owner: u.id, data: text, hash: crypto.createHash('sha256').update(text).digest('hex'), schema: 12, revision: 1, client: 'test' });
  const c = new PocketBase(API);
  await c.collection('users').authWithPassword(email, PW);
  const token = c.authStore.token;
  const call = async (method: string, url: string, body?: unknown) => {
    const x = await fetch(API + url, { method, headers: { 'Content-Type': 'application/json', Authorization: token }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: x.status, j: (await x.json().catch(() => ({}))) as any };
  };
  await call('POST', '/api/prime/league/join', { accept: true, rules: 1 });
  const snapFrom = (m: any): LeagueSnapshot => ({ seed: m.seed, arena: m.arena, attacker: m.attacker, defender: m.defender, hpMult: m.hpMult, dmgMult: m.dmgMult });
  const op = () => 'op_' + crypto.randomBytes(9).toString('hex');

  section('Сервер: настоящий ответ лиги и правило постера');
  const seen: { outcome: string; method: string; rating: number; offered: boolean; block: string | null }[] = [];
  for (let k = 0; k < 6; k++) {
    const fighter = (['ace', 'vega', 'ray'] as const)[k % 3];
    const st0 = await call('POST', '/api/prime/league/match/start', { mode: 'duel', fighter, deck: FIGHTERS[fighter].defaultDeck as CardId[], sim: SIM_VERSION, op: op(), arena: 'random' });
    if (st0.status !== 200) {
      check(`match ${k + 1} starts`, false, `${st0.status} ${st0.j?.code}`);
      continue;
    }
    const m = st0.j.match;
    const taps = botTaps(snapFrom(m), 0.18 + k * 0.05);
    const out = replayLeague(snapFrom(m), taps);
    setClock(clock + Math.ceil((out.steps / 60) * 1000) + 1000);
    const f = await call('POST', `/api/prime/league/match/${m.id}/finish`, { inputs: taps, hash: out.hash });
    const res = f.j as LeagueFinish;
    const block = posterBlock(res.match);
    const expect = res.match.outcome === 'win' && res.match.method !== 'forfeit' && res.match.how === 'finish' && res.match.result!.rating >= 80;
    const facts = posterFacts(view({ ...m }), res, null, fighter, 'ShareStar', 1);
    seen.push({ outcome: res.match.outcome!, method: res.match.method!, rating: res.match.result!.rating, offered: !block, block });
    check(`fight ${k + 1} (${fighter.toUpperCase()}): ${res.match.outcome} by ${res.match.method}, rating ${res.match.result?.rating} → ${block ? 'no poster (' + block + ')' : 'poster'}; the server's answer has every field the rule reads`, f.status === 200 && res.match.status === 'done' && typeof res.match.result?.rating === 'number' && res.match.how === 'finish' && res.match.result?.clientHash === res.match.result?.hash && (block === null) === expect && (facts !== null) === expect && (!facts || (facts.rating === res.match.result!.rating && facts.fighter === fighter && facts.combos === res.match.result!.combos)));
    setClock(clock + 5000);
  }
  console.log('   итоги боёв:', seen.map((x) => `${x.outcome}/${x.method}/${x.rating}${x.offered ? '★' : ''}`).join(' · '));
  const ff = await call('POST', '/api/prime/league/match/start', { mode: 'duel', fighter: 'ace', deck: FIGHTERS.ace.defaultDeck as CardId[], sim: SIM_VERSION, op: op(), arena: 'random' });
  const fin = await call('POST', `/api/prime/league/match/${ff.j.match.id}/finish`, { inputs: [[0, -1]] });
  check('a forfeit on the server (the player gave up) → a loss by forfeit → never a poster', fin.j.match?.method === 'forfeit' && fin.j.match?.outcome === 'loss' && posterBlock(fin.j.match) !== null && posterFacts(view({ ...ff.j.match }), fin.j, null, 'ace', null, 1) === null);
  check('the server marks a fight it finished itself as how=expired (the rule reads that)', /m\.set\('how', how\);/.test(read('backend/pb_hooks/lib/league.js')) && /resolve\(app, m, jget\(m, 'inputs', \[\]\), 'expired', t\)/.test(read('backend/pb_hooks/lib/league.js')));
}

async function main(): Promise<void> {
  ruleChecks();
  codeChecks();
  try {
    await serverChecks();
  } finally {
    await stopChild(pb);
    fs.rmSync(work, { recursive: true, force: true });
  }
  console.log(failed ? `\nprimeshare: FAILED (${passed} passed, ${failed} failed)` : `\nprimeshare: OK (${passed} passed, 0 failed) — временная база удалена`);
  proc.exit(failed ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  void stopChild(pb).then(() => proc.exit(1));
});
