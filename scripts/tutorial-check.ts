// Headless checks for Alpha 1.6.5 — FIRST BROADCAST (npm run tutorial): who gets the first-run
// tutorial (new players only — older careers never), the training match it runs on (a real
// Match: harmless bot, no cards for it, the real COUNTER STRIKE of ComboSystem), and that it
// counts for nothing. The DOM flow (captions, skip button) is checked in the browser.
import { MATCH } from '../src/config/balance';
import { BOSSES } from '../src/config/boss.config';
import { RIVALS, RIVAL_ORDER } from '../src/config/fighters';
import { LOOKS } from '../src/config/looks';
import { CHALLENGES, SURVIVAL } from '../src/config/modes.config';
import { Match } from '../src/combat/Match';
import type { MatchEvent } from '../src/combat/types';
import { TUTORIAL } from '../src/game/FirstBroadcast';
import { defaultSave, hasProgress, sanitize } from '../src/meta/SaveSystem';

interface Fs {
  readFileSync(path: string, encoding: 'utf8'): string;
}
const { readFileSync } = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } }).process.getBuiltinModule('node:fs') as Fs;

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const DT = 1 / 60;

// ---------------------------------------------------------- who gets it
{
  check('save: a brand-new career is waiting for FIRST BROADCAST', defaultSave().tutorial === 'pending');
  // a 1.6.4 save (no tutorial flag) with progress → veteran, never forced
  const played = sanitize({ version: 11, money: 2400, matches: 12, wins: 7, hintsSeen: true });
  check('save: an older career with progress is a veteran — the tutorial never starts by itself', played.tutorial === 'veteran');
  const signals: Record<string, object> = {
    money: { version: 11, money: 151 },
    reputation: { version: 11, reputation: 5 },
    'a signed fighter': { version: 11, fighters: { bruno: { unlocked: true } } },
    'a bought card': { version: 11, reputation: 60, cards: { owned: ['spotlight_tag'] } },
    'a hint seen': { version: 11, hintsSeen: true },
    'a fighter match': { version: 11, fighters: { ray: { unlocked: true, matches: 1 } } },
  };
  const missed = Object.entries(signals).filter(([, raw]) => sanitize(raw).tutorial !== 'veteran').map(([k]) => k);
  check(`save: any sign of play counts (${Object.keys(signals).join(', ')})${missed.length ? ' — missed: ' + missed.join(', ') : ''}`, missed.length === 0);
  const untouched = sanitize({ version: 11, money: 150, reputation: 0 });
  check('save: an older but untouched career (opened once, never played) still gets the tutorial', untouched.tutorial === 'pending' && !hasProgress(untouched));
  for (const st of ['done', 'skipped', 'veteran', 'pending'] as const) {
    if (sanitize(JSON.parse(JSON.stringify({ ...defaultSave(), tutorial: st }))).tutorial !== st) check(`save: tutorial state "${st}" survives a reload`, false);
  }
  check('save: done / skipped / veteran / pending all survive a reload', true);
  check('save: a junk flag on an empty career falls back to pending', sanitize({ version: 11, tutorial: 'maybe' }).tutorial === 'pending');
  const game = readFileSync('src/game/Game.ts', 'utf8');
  // 1.8.8: the first tap OFFERS FIRST BROADCAST to a pending career («ПРОЙТИ ОБУЧЕНИЕ» / «ПРОПУСТИТЬ»)
  check('flow: after the first tap only a pending career is offered FIRST BROADCAST, everyone else goes to the menu', /if \(this\.save\.data\.tutorial === 'pending'\) \{\s*this\.offerTutorial\(\);\s*return;\s*\}\s*this\.goto\('menu'\);/.test(game));
  const offer = game.slice(game.indexOf('private offerTutorial'), game.indexOf('endTutorial(how'));
  check('flow: «ПРОЙТИ ОБУЧЕНИЕ» starts the existing FIRST BROADCAST; «ПРОПУСТИТЬ» writes «skipped» at once (never over a finished run) and saves', /showTutorialChoice\(\s*this,\s*\(\) => this\.startTutorial\(\),/.test(offer) && /if \(s\.tutorial === 'pending'\) s\.tutorial = 'skipped';\s*this\.save\.save\(\);\s*this\.goto\('menu'\);/.test(offer));
  const choice = readFileSync('src/ui/firstRun.ts', 'utf8');
  check('the choice window: «Первый эфир», both buttons, no browser alert/confirm, not closable by a stray tap', /Первый эфир/.test(choice) && /data-a="play">[\s\S]{0,40}Пройти обучение</.test(choice) && /data-a="skip">Пропустить</.test(choice) && !/\b(alert|confirm)\(/.test(choice) && /\},\s*false,\s*\);\s*\}\s*$/.test(choice));
  check('flow: finishing or skipping saves it (a skip never undoes a finished run)', /if \(how === 'done' \|\| s\.tutorial === 'pending'\) s\.tutorial = how;\s*this\.save\.save\(\);\s*this\.goto\('menu'\);/.test(game));
  check('flow: Settings → «Пройти обучение» replays it', /data-a="tutorial">Пройти обучение</.test(game) && /a === 'tutorial'\) \{[\s\S]{0,200}this\.startTutorial\(\);/.test(game));
  check('flow: the pause menu offers «Пропустить обучение» instead of a forfeit', /data-a="skip">Пропустить обучение</.test(game));
  const hud = readFileSync('src/ui/screens/BattleHUD.ts', 'utf8');
  check('flow: «ПРОПУСТИТЬ» is on screen from the start and skips', /class="tut-skip" data-act="tut-skip">ПРОПУСТИТЬ</.test(hud) && /closest\('\[data-act="tut-skip"\]'\)\) \{\s*this\.g\.skipTutorial\(\);/.test(hud));
  check('flow: a progress reset does not force the tutorial on someone who has seen it', /const seen = this\.save\.data\.tutorial !== 'pending';\s*this\.save\.reset\(\);\s*if \(seen\)/.test(game));
  // nothing counts
  check('no progress: the tutorial match returns before results, career, money, fans, Classic wins, events and modes', /if \(mode\.kind === 'tutorial'\) return;\s*\n\s*let challenge/.test(game) || /mode\.kind === 'tutorial'\) return;[\s\S]{0,400}const wave = this\.modes\.recordWave/.test(game));
  check('no progress: no seasonal event is credited for it', /mode\.kind !== 'survival' && mode\.kind !== 'tutorial' && this\.events\.playable/.test(game));
  check('no progress: it brings its own deck (the player\'s decks are never written)', /deck: TUTORIAL\.deck\.slice\(\)/.test(game) && !/fighters\[[^\]]*\]\.deck = TUTORIAL/.test(game));
}

// ------------------------------------------------------ the training bot
{
  const bot = RIVALS.bot;
  // (Survival draws its rivals from RIVAL_ORDER)
  check('bot: PRIME TRAINING BOT is never a regular, Survival, Challenge or Boss opponent', !RIVAL_ORDER.includes('bot') && SURVIVAL.waves.length > 0 && !CHALLENGES.some((c) => c.rival === 'bot') && !Object.values(BOSSES).some((b) => b.rival === 'bot'));
  check('bot: it has a robot look (visor face, antenna — same skeleton and animations)', LOOKS[bot.look]?.robot === true);
  check('bot: its shots are slow and weak', (bot.mods?.attack?.damage ?? 99) <= 10 && (bot.mods?.attack?.interval ?? 0) >= 1.2);
}

// ---------------------------------------------------- the training match
function tutorialMatch(mods = TUTORIAL.mods, seed = 11): Match {
  const m = new Match({ fighter: 'ray', deck: TUTORIAL.deck.slice(), rival: 'bot', difficulty: 'rookie', seed, fans: 0, mods });
  while (m.phase !== 'fight') {
    m.step(DT);
    m.drainEvents();
  }
  return m;
}
function run(m: Match, secs: number, every?: () => void): MatchEvent[] {
  const out: MatchEvent[] = [];
  for (let i = 0; i < Math.round(secs / DT); i++) {
    every?.();
    m.step(DT);
    out.push(...m.drainEvents());
  }
  return out;
}
{
  const m = tutorialMatch();
  check('match: DASH and POWER SHOT are in the hand from the start (a beginner never waits for a card)', m.hands[0].hand.includes('dash') && m.hands[0].hand.includes('power_shot'));
  check(`match: it starts almost at once (${m.introTime} s intro) and time never runs out (${m.duration} s)`, m.introTime <= 1.5 && m.duration >= 600);
  // 30 s of the fighter fighting on its own
  const p = m.fighters[0];
  const ev = run(m, 30);
  const botCards = ev.filter((e) => e.type === 'card' && e.side === 1).length;
  const botShots = ev.filter((e) => e.type === 'shot' && e.side === 1).length;
  const myShots = ev.filter((e) => e.type === 'shot' && e.side === 0).length;
  check(`match: the fighter fights by itself (${myShots} shots in 30 s, no card played for it)`, myShots > 20 && !ev.some((e) => e.type === 'card' && e.side === 0));
  check(`match: the bot shoots now and then (${botShots} shots) but never plays a card (${botCards})`, botShots > 3 && botCards === 0 && m.hands[1].energy < 1);
  check(`match: the bot is harmless — the fighter keeps ${Math.round(p.hpFrac * 100)}% HP after 30 s`, p.hpFrac > 0.9 && !p.ko && m.phase === 'fight');
}
{
  // the real COUNTER STRIKE: a slow beginner presses POWER SHOT 8 s after DASH
  const slow = (mods: typeof TUTORIAL.mods | undefined) => {
    const m = tutorialMatch(mods as typeof TUTORIAL.mods);
    const h = m.hands[0];
    h.energy = 10;
    h.lockout = 0;
    m.playCard(0, h.hand.indexOf('dash'));
    run(m, 8);
    h.energy = 10;
    h.lockout = 0;
    m.ais[1].hold = true;
    m.playCard(0, h.hand.indexOf('power_shot'));
    const ev = m.drainEvents().concat(run(m, 2.5));
    return { m, ev, combo: ev.find((e) => e.type === 'combo' && e.side === 0) };
  };
  const t = slow(TUTORIAL.mods);
  check('combo: DASH → POWER SHOT is COUNTER STRIKE from ComboSystem, even 8 s apart (the tutorial window)', !!t.combo && t.combo.type === 'combo' && t.combo.combo === 'counter_strike');
  const hit = t.ev.find((e) => e.type === 'hit' && e.source === 0 && e.combo === 'counter_strike');
  check('combo: the COUNTER STRIKE shot lands on the bot standing still', !!hit && hit.type === 'hit' && hit.heavy);
  const { duration: _d, introTime: _i, rivalEnergyMult: _r, comboWindow: _c, ...rest } = TUTORIAL.mods;
  const normal = slow({ ...rest, duration: 900 } as typeof TUTORIAL.mods);
  check(`combo: the same 8 s gap is no combo with the normal ${MATCH.comboWindow} s window — the tutorial does not fake it`, !normal.combo && _c === 30 && _d > 0 && _i > 0 && _r === 0);
  // the bot holds still and holds fire while the beginner lines up the shot
  const m = tutorialMatch();
  const b = m.fighters[1];
  m.ais[1].hold = true;
  run(m, 0.3);
  const x0 = b.x;
  const z0 = b.z;
  const ev = run(m, 3);
  check('bot: on hold it stands where it is and does not fire', Math.hypot(b.x - x0, b.z - z0) < 0.05 && !ev.some((e) => e.type === 'shot' && e.side === 1));
  // the end: the bot powers down, the fight is over
  m.knockOut(b, true);
  const end = run(m, MATCH.outroTime + 0.2);
  check('end: the knockout ends the training fight (outro → over), the fighter wins', end.some((e) => e.type === 'ko' && e.side === 1) && m.phase === 'over' && m.result?.outcome === 'win');
}

let ok = true;
for (const [name, pass] of checks) {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
  ok &&= pass;
}
console.log(ok ? `tutorial: OK (${checks.length} checks)` : 'tutorial: FAILED');
const proc = (globalThis as { process?: { exitCode?: number } }).process;
if (!ok && proc) proc.exitCode = 1;
