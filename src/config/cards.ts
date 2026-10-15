import { CARD_TUNING as T, COMBO_TUNING as CT, PASSIVE_TUNING as PT } from './balance';
import type { CardDef, CardId, ComboDef, PassiveDef, PassiveId } from './types';

const pct = (m: number) => `${Math.round((m - 1) * 100)}%`;

export const CARDS: Record<CardId, CardDef> = {
  dash: {
    id: 'dash',
    name: 'DASH',
    cost: 2,
    role: 'Уклонение',
    short: 'Рывок + неуязвимость',
    desc: `Рывок в сторону от угрозы: ${T.dash.invuln} с неуязвимости, следующий залп сильнее на ${pct(T.dash.counterMult)}. Идеальное уклонение возвращает ${T.dash.perfectRefund} энергии.`,
    color: '#13c7d8',
    color2: '#0a5d8f',
  },
  power_shot: {
    id: 'power_shot',
    name: 'POWER SHOT',
    cost: 4,
    role: 'Урон',
    short: 'Заряженный выстрел',
    desc: `Короткий заряд и мощный снаряд: ${T.power_shot.damage} урона и отбрасывание. Добивающая карта для комбо.`,
    color: '#ff8a1f',
    color2: '#b8321a',
    heavy: true,
  },
  shield: {
    id: 'shield',
    name: 'SHIELD',
    cost: 3,
    role: 'Защита',
    short: `Барьер на ${T.shield.duration} с`,
    desc: `Энергетический купол на ${T.shield.duration} с поглощает до ${T.shield.absorb} урона. Блок заряженной атаки — PERFECT BLOCK.`,
    color: '#3d8bff',
    color2: '#1b3c9e',
  },
  smoke: {
    id: 'smoke',
    name: 'SMOKE',
    cost: 3,
    role: 'Контроль',
    short: 'Дымовая завеса',
    desc: `Дым на ${T.smoke.duration} с: соперник теряет прицел, ${Math.round(T.smoke.missChance * 100)}% выстрелов уходит мимо, а урон по вам в дыму −${Math.round(T.smoke.damageCut * 100)}%.`,
    color: '#8b7fb0',
    color2: '#3b3358',
  },
  shock: {
    id: 'shock',
    name: 'SHOCK',
    cost: 4,
    role: 'Контроль',
    short: 'Разряд и оглушение',
    desc: `Молния бьёт мгновенно: ${T.shock.damage} урона, оглушение ${T.shock.stun} с. Прерывает заряд и ломает щиты.`,
    color: '#ffd326',
    color2: '#c27a00',
  },
  overdrive: {
    id: 'overdrive',
    name: 'OVERDRIVE',
    cost: 4,
    role: 'Усиление',
    short: 'Боевой разгон',
    desc: `${T.overdrive.duration} с ярости: +${pct(T.overdrive.fireRate)} скорострельности, +${pct(T.overdrive.damage)} урона, +${pct(T.overdrive.speed)} скорости. Боец идёт в атаку.`,
    color: '#ff4d3d',
    color2: '#8c1238',
  },
  adrenaline: {
    id: 'adrenaline',
    name: 'ADRENALINE',
    cost: 4,
    role: 'Фирменная',
    short: 'Шквал выстрелов',
    desc: `Рэй срывается в серию из ${T.adrenaline.shots} молниеносных прицельных выстрелов на бегу (по ${T.adrenaline.damage} урона).`,
    color: '#22f0e0',
    color2: '#1f6fff',
    exclusive: 'ray',
  },
  knockout: {
    id: 'knockout',
    name: 'KNOCKOUT',
    cost: 5,
    role: 'Фирменная',
    short: 'Таран-нокаут',
    desc: `Бруно бросается вперёд: ${T.knockout.damage} урона и мощное отбрасывание. Удар о стену — WALL SLAM. Промах оставляет его открытым.`,
    color: '#ff3b3b',
    color2: '#3a0d12',
    exclusive: 'bruno',
    heavy: true,
  },
  system_overload: {
    id: 'system_overload',
    name: 'SYSTEM OVERLOAD',
    cost: 6,
    role: 'Фирменная',
    short: 'Взлом соперника',
    desc: `Ника взламывает соперника на ${T.system_overload.duration} с: без карт, вдвое медленнее стреляет, +${pct(T.system_overload.damageTakenMult)} урона по нему, −${T.system_overload.energyDrain} энергии.`,
    color: '#ff4fd8',
    color2: '#5b1fd1',
    exclusive: 'nika',
  },
  charged_shot: {
    id: 'charged_shot',
    name: 'CHARGED SHOT',
    cost: 5,
    role: 'Фирменная',
    short: 'Рельсовый выстрел',
    desc: `Вега заряжает винтовку и бьёт сквозь арену: ${T.charged_shot.damage} урона, издалека до +${pct(T.charged_shot.farMult)}. Пробивает щит: он ломается и гасит только половину урона.`,
    color: '#5fd8ff',
    color2: '#1d3f9e',
    exclusive: 'vega',
    heavy: true,
  },
  // Alpha 1.3.2: boss-only card (Victor Vale). Not in any collection or player deck.
  prime_pulse: {
    id: 'prime_pulse',
    name: 'PRIME PULSE',
    cost: 5,
    role: 'Чемпион',
    short: 'Резонансная волна',
    desc: `Резонатор заряжается, и в секторе перед чемпионом проходит волна: ${T.prime_pulse.damage} урона и отброс. SHIELD поглощает её, DASH после того, как зона застыла, уводит из волны.`,
    color: '#46e8ff',
    color2: '#7a5a10',
    heavy: true,
  },
};

export const UNIVERSAL_CARDS: CardId[] = ['dash', 'power_shot', 'shield', 'smoke', 'shock', 'overdrive'];

export const COMBOS: ComboDef[] = [
  {
    id: 'counter_strike',
    name: 'COUNTER STRIKE',
    first: ['dash'],
    second: ['power_shot', 'knockout', 'charged_shot'],
    rating: 12,
    desc: `DASH → POWER SHOT / KNOCKOUT / CHARGED SHOT: контратака ×${CT.counterStrikeMult} урона.`,
    bonus: `урон ×${CT.counterStrikeMult}`,
  },
  {
    id: 'electro_blast',
    name: 'ELECTRO BLAST',
    first: ['shock', 'system_overload'],
    second: ['power_shot', 'knockout', 'charged_shot'],
    rating: 15,
    desc: `SHOCK → POWER SHOT / KNOCKOUT / CHARGED SHOT: ×${CT.electroBlastMult} урона, электровзрыв продлевает оглушение.`,
    bonus: `урон ×${CT.electroBlastMult} + оглушение`,
  },
  {
    id: 'iron_rush',
    name: 'IRON RUSH',
    first: ['shield'],
    second: ['overdrive'],
    rating: 12,
    desc: `SHIELD → OVERDRIVE: щит взрывается ударной волной (${CT.ironRushDamage} урона), разгон длится в ${CT.ironRushDurationMult} раза дольше.`,
    bonus: `волна ${CT.ironRushDamage} урона + долгий разгон`,
  },
  {
    id: 'phantom_step',
    name: 'PHANTOM STEP',
    first: ['smoke'],
    second: ['dash'],
    rating: 11,
    desc: 'SMOKE → DASH: на месте рывка остаётся голограмма-приманка, которая забирает огонь соперника.',
    bonus: 'голограмма-приманка',
  },
  {
    id: 'superstar',
    name: 'SUPERSTAR MOVE',
    first: ['overdrive'],
    second: ['adrenaline', 'knockout', 'system_overload', 'charged_shot'],
    rating: 18,
    desc: `OVERDRIVE → фирменная карта: фирменный приём усиливается на ${pct(CT.superstarMult)}.`,
    bonus: `фирменный приём +${pct(CT.superstarMult)}`,
  },
];

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  momentum: {
    id: 'momentum',
    name: 'MOMENTUM',
    desc: `После успешного уклонения Рэй на ${PT.momentum.duration} с получает +${pct(PT.momentum.speed)} скорости и +${pct(PT.momentum.fireRate)} скорострельности.`,
  },
  iron_skin: {
    id: 'iron_skin',
    name: 'IRON SKIN',
    desc: `Пропустив мощный удар (${PT.iron_skin.threshold}+ урона), Бруно на ${PT.iron_skin.duration} с получает на ${Math.round(PT.iron_skin.reduction * 100)}% меньше урона.`,
  },
  overclock: {
    id: 'overclock',
    name: 'OVERCLOCK',
    desc: `Каждое комбо даёт Нике +${PT.overclock.energy} энергии и ускоряет восстановление энергии на ${pct(PT.overclock.regenMult)} на ${PT.overclock.duration} с.`,
  },
  deadeye: {
    id: 'deadeye',
    name: 'DEADEYE',
    desc: `Каждый ${PT.deadeye.every}-й выстрел Веги — снайперский: +${pct(PT.deadeye.mult)} урона.`,
  },
};

export function comboFor(prev: CardId | null, next: CardId): ComboDef | null {
  if (!prev) return null;
  for (const c of COMBOS) {
    if (c.first.includes(prev) && c.second.includes(next)) return c;
  }
  return null;
}
