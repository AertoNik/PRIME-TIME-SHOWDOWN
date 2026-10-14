export type WeaponId = 'pistol' | 'shotgun' | 'carbine';
export type CardId = 'dash' | 'power' | 'shield' | 'smoke' | 'shock' | 'overdrive';
export interface Weapon { name: string; tag: string; description: string; damage: number; interval: number; range: number; color: number }
export const WEAPONS: Record<WeaponId, Weapon> = {
  pistol: { name: 'SIDEKICK .45', tag: 'ПИСТОЛЕТ', description: 'Точный, надёжный, всегда в эфире. Баланс урона и дистанции.', damage: 14, interval: 1.3, range: 4.8, color: 0xffcc61 },
  shotgun: { name: 'CLOSE CALL', tag: 'ДРОБОВИК', description: 'Сокращай дистанцию. Три дробины, сокрушительный урон вблизи.', damage: 31, interval: 2.25, range: 3, color: 0xff754c },
  carbine: { name: 'NEON REPEATER', tag: 'КАРАБИН', description: 'Быстрые энергетические очереди. Держи соперника на расстоянии.', damage: 7, interval: 0.67, range: 5.5, color: 0x62f4de },
};
export const CARDS: Record<CardId, { name: string; label: string; cost: number; description: string; color: string; icon: string; effect: string }> = {
  dash: { name: 'DASH', label: 'Рывок', cost: 2, description: 'Уклонение на 0,65 с. Усиливает POWER SHOT в течение 2 с.', color: '#6af1d0', icon: 'dash', effect: 'Уклонение · 0,65 с' },
  power: { name: 'POWER SHOT', label: 'Мощный выстрел', cost: 4, description: '45 урона после подготовки 0,85 с. Комбинируется с DASH и SHOCK.', color: '#ffb83e', icon: 'crosshair', effect: '45 урона · 0,85 с' },
  shield: { name: 'SHIELD', label: 'Щит', cost: 3, description: '−80% урона на 3 с. OVERDRIVE в течение 2 с открывает комбо.', color: '#67c5ff', icon: 'shield', effect: '−80% урона · 3 с' },
  smoke: { name: 'SMOKE', label: 'Дым', cost: 3, description: 'Точность соперника снижена на 65% в течение 4 с.', color: '#b2a7df', icon: 'smoke', effect: 'Точность врага ↓ · 4 с' },
  shock: { name: 'SHOCK', label: 'Электрошок', cost: 3, description: 'Оглушение на 1,6 с, 8 урона и срыв подготовки атаки.', color: '#cf9aff', icon: 'bolt', effect: 'Оглушение · 1,6 с' },
  overdrive: { name: 'OVERDRIVE', label: 'Форсаж', cost: 4, description: 'Темп ×1,9 на 5 с. После SHIELD: +25% урона и щит +1 с.', color: '#ff7893', icon: 'fast', effect: 'Темп ×1,9 · 5 с' },
};
export const CARD_IDS = Object.keys(CARDS) as CardId[];
export const DEFAULT_DECK: CardId[] = ['dash', 'power', 'shield', 'shock'];
export const BALANCE = { hp: 320, duration: 75, energy: 10, regen: 0.8, showtime: 18, fixedStep: 1 / 60, powerWindup: 0.85 };
export const RIVALS = [{ name: 'STATIC JACK', style: 'aggressive' }, { name: 'VELVET VIPER', style: 'tactical' }, { name: 'GLITCH KID', style: 'evasive' }] as const;
export function fame(fans: number) { return fans >= 1200 ? { name: 'PRIME CONTENDER', ru: 'Претендент на прайм-тайм', level: 3, start: 1200, next: 2400 } : fans >= 400 ? { name: 'RISING STAR', ru: 'На подъёме', level: 2, start: 400, next: 1200 } : { name: 'ROOKIE', ru: 'Новое лицо', level: 1, start: 0, next: 400 }; }
