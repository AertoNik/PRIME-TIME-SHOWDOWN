// Beta 2.1 — `npm run careerpace`: the producer levels 1–20 on the economy model (real measured career fights, the
// server's DAILY STREAK, the four kinds of players of scripts/lib/economyModel.ts). For each player: the day each level is
// reached, the play days between levels, the longest wait for a level, and the reputation of a typical play day — the
// numbers behind the Beta 2.1 career report (docs/BETA_2_1_DEVELOPMENT_REPORT.md). A MODEL, not the game: the league's
// defence reputation (+5 ★, at most 25 a day) and Survival / Challenge firsts beyond the model's own are not counted.
import { ARCHETYPES, runCareer, runDaily } from './lib/economyModel';
import { sampleFights } from './lib/economySamples';
import { LEVEL_THRESHOLDS } from '../src/config/career';
import { proc } from './lib/node';

const DAYS = 365;
const samples = sampleFights(24);
const json = proc.argv.includes('--json');
const out: Record<string, { levelDay: (number | null)[]; playGap: number[]; repPerPlayDay: number }> = {};

console.log(`# Темп уровней продюсера 1–20 (модель экономики, ${DAYS} дней)\n`);
console.log('Пороги ★: ' + LEVEL_THRESHOLDS.join(' · ') + '\n');
for (const a of ARCHETYPES) {
  const dd = runDaily(a, DAYS).byDay;
  const r = runCareer(a, samples, { id: 'now', ru: 'сейчас' }, DAYS, (d) => dd[d] ?? 0);
  const levelDay: (number | null)[] = LEVEL_THRESHOLDS.map((th) => {
    for (let d = 0; d <= DAYS; d++) if ((r.repBy[d] ?? -1) >= th) return d;
    return null;
  });
  // play days of this player between consecutive levels (its weekly mask)
  const plays = (from: number, to: number) => {
    let n = 0;
    for (let d = from + 1; d <= to; d++) if (a.week[(d - 1) % 7]) n++;
    return n;
  };
  const playGap: number[] = [];
  for (let i = 1; i < levelDay.length; i++) {
    const p = levelDay[i - 1];
    const c = levelDay[i];
    playGap.push(p !== null && c !== null ? plays(p, c) : -1);
  }
  const d30 = r.repBy[30] ?? 0;
  const repPerPlayDay = Math.round(d30 / Math.max(1, plays(0, 30)));
  out[a.id] = { levelDay, playGap, repPerPlayDay };
  console.log(`## ${a.ru} (${a.careerPerDay} боёв карьеры в игровой день, ${a.week.reduce((s, x) => s + x, 0)} дн./нед.) — ≈${repPerPlayDay} ★ за игровой день`);
  console.log('| уровень | ' + levelDay.map((_, i) => String(i + 1)).join(' | ') + ' |');
  console.log('|---|' + levelDay.map(() => '---').join('|') + '|');
  console.log('| день | ' + levelDay.map((d) => (d === null ? '—' : String(d))).join(' | ') + ' |');
  console.log('| игровых дней от прошлого | — | ' + playGap.map((g) => (g < 0 ? '—' : String(g))).join(' | ') + ' |');
  const known = playGap.filter((g) => g >= 0);
  console.log(`Дольше всего ждать уровня: ${known.length ? Math.max(...known) : '—'} игровых дн.; 20-й уровень: ${levelDay[19] === null ? `не за ${DAYS} дней` : `день ${levelDay[19]}`}\n`);
}
if (json) console.log(JSON.stringify(out));
