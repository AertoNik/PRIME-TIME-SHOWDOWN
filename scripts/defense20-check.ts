// Headless checks for Beta 2.0 — producer reputation for won PRIME LEAGUE defences (npm run defense20):
//   * the rule is moderate and server-side: +win ★ a server-confirmed won ranked defence, once per attacker and game day,
//     at most perDay ★ a day; a lost defence gives and takes nothing; RP, tokens, air points and the fight are unchanged;
//   * the game adds the server's lifetime sum ONCE: only the part above save.leagueRep.credited, the mark moving with the
//     reputation in the same document — a reload or a second refresh adds nothing, a smaller sum (a restored server)
//     takes nothing back, a read-only save (another tab) is never written;
//   * the share in the career: with the model's defence wins per play day it stays a small extra (≤ 25 % of a beginner's
//     day, ~5 % of a regular player's), never the way to level.
import { LEAGUE } from '../src/config/league.config';
import { LeagueRuntime } from '../src/game/LeagueRuntime';
import { defaultSave, sanitize } from '../src/meta/SaveSystem';
import { ARCHETYPES } from './lib/economyModel';
import { fs, proc } from './lib/node';
import { SIM_VERSION } from '../src/league/simVersion';

const checks: [string, boolean][] = [];
const check = (name: string, pass: boolean) => checks.push([name, pass]);
const read = (p: string) => fs.readFileSync(p, 'utf8') as string;

// ------------------------------------------------------------------ the rule (server)
const R = LEAGUE.defenseRep;
check('moderate: +5 ★ a won defence, at most 25 ★ a day', R.win === 5 && R.perDay === 25);
const lg = read('backend/pb_hooks/lib/league.js');
check('paid only in the settlement of a ranked fight the attacker LOST against a real player\'s defender (o === "loss", ranked, defKind player)', /if \(o === 'loss' && m\.getBool\('ranked'\)\) \{[\s\S]{0,700}payDefenseRep\(ds, uid, t\)/.test(lg) && /if \(snap\.defKind === 'player' && m\.getString\('defOwner'\)\)/.test(lg));
check('once per attacker and game day, within the daily cap; the lifetime sum in stats.repTotal', /r\.a\.indexOf\(attacker\) >= 0\) return 0/.test(lg) && /Math\.min\(cfg\.win, cfg\.perDay - \(r\.n \|\| 0\)\)/.test(lg) && /ds\.repTotal = \(ds\.repTotal \|\| 0\) \+ pay/.test(lg));
check('a server switch: PRIME_LEAGUE_DEFENSE_REP=off', /env\('PRIME_LEAGUE_DEFENSE_REP'\) !== 'off'/.test(lg));
check('the fight is untouched: SIM_VERSION a141348f2a0dea20', SIM_VERSION === 'a141348f2a0dea20');
check('the league rules carry it (npm run backend:rules)', /"defenseRep": \{\s*"win": 5,\s*"perDay": 25/.test(read('backend/pb_hooks/lib/league_rules.js')));

// ------------------------------------------------------------------ the game adds it once
function rt(credited: number, rep: number, writable = true) {
  const data = defaultSave();
  data.reputation = rep;
  data.leagueRep = { credited };
  let saves = 0;
  const toasts: string[] = [];
  const g = { save: { data, writable, save: () => void saves++ }, ui: { toast: (t: string) => toasts.push(t) }, grantEarned: () => [], account: null } as any;
  const r = new LeagueRuntime(g);
  return { r, data, saves: () => saves, toasts };
}
const me = (repTotal: number) => ({ joined: true, stats: { repTotal, rep: { d: 1, n: 5, a: [] } } }) as any;
{
  const t = rt(0, 100);
  t.r.setMe(me(15));
  check('the first visit adds what the server holds (+15 ★) and moves the mark', t.data.reputation === 115 && t.data.leagueRep.credited === 15 && t.saves() === 1 && /\+15 ★/.test(t.toasts[0] ?? ''));
  t.r.setMe(me(15));
  check('the same sum again adds nothing (a reload, a second refresh)', t.data.reputation === 115 && t.saves() === 1);
  t.r.setMe(me(25));
  check('a new won defence adds only the difference (+10)', t.data.reputation === 125 && t.data.leagueRep.credited === 25);
  t.r.setMe(me(5));
  check('a smaller server sum (a restored database) takes nothing back and never lowers the mark', t.data.reputation === 125 && t.data.leagueRep.credited === 25);
}
{
  const t = rt(0, 100, false);
  t.r.setMe(me(30));
  check('a read-only save (another tab holds the profile) is never written', t.data.reputation === 100 && t.data.leagueRep.credited === 0 && t.saves() === 0);
}
{
  const old = defaultSave() as unknown as Record<string, unknown>;
  delete old.leagueRep;
  check('an older save loads with credited 0; a junk value is cleaned', sanitize(old).leagueRep.credited === 0 && sanitize({ ...defaultSave(), leagueRep: { credited: -5 } }).leagueRep.credited === 0 && sanitize({ ...defaultSave(), leagueRep: { credited: 40.7 } }).leagueRep.credited === 40);
}

// ------------------------------------------------------------------ the share in the career
// (★ a day from career fights after the first 180 days, measured with the real fights — docs/BETA_2_0_WORKLOG.md §4)
const careerPerDay: Record<string, number> = { newbie: 36, regular: 136, active: 403, grinder: 1039 };
const share = ARCHETYPES.map((a) => {
  const def = Math.min(R.perDay, Math.round(a.defenseWins) * R.win);
  return { id: a.id, def, pct: def / careerPerDay[a.id] };
});
check(`a small extra, never the way to level: ${share.map((x) => `${x.id} +${x.def} ★/day (${Math.round(x.pct * 100)} %)`).join(', ')}`, share.every((x) => x.pct <= 0.25) && share.find((x) => x.id === 'regular')!.pct <= 0.08);

let failed = 0;
for (const [name, pass] of checks) {
  if (!pass) failed++;
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}`);
}
console.log(failed ? `\ndefense20: FAILED (${failed} of ${checks.length})` : `\ndefense20: OK (${checks.length} checks)`);
proc.exit(failed ? 1 : 0);
