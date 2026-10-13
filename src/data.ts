export type CardId = 'dash' | 'power' | 'shield' | 'smoke' | 'shock' | 'adrenaline';
export type WeaponId = 'pulse' | 'scatter';
export interface Card { id: CardId; name: string; short: string; cost: number; color: string; description: string; }
export const CARDS: Card[] = [
  { id: 'dash', name: 'Рывок', short: 'УКЛОНЕНИЕ', cost: 2, color: '#5ce4ff', description: '1 сек. неуязвимости и быстрый уход с линии огня.' },
  { id: 'power', name: 'Мощный выстрел', short: 'БОЛЬШОЙ УРОН', cost: 3, color: '#ffad61', description: 'Точный выстрел: 125 урона. Щит соперника снижает урон.' },
  { id: 'shield', name: 'Щит', short: 'ЗАЩИТА · 4 СЕК', cost: 2, color: '#8aafff', description: 'Снижает входящий урон на 72% в течение 4 сек.' },
  { id: 'smoke', name: 'Дымовая завеса', short: 'ПОМЕХИ · 5 СЕК', cost: 2, color: '#c4a0ff', description: 'На 5 сек. снижает точность соперника до 35%.' },
  { id: 'shock', name: 'Электрошок', short: 'КОНТРОЛЬ', cost: 3, color: '#e0ff75', description: '35 урона и оглушение на 1,8 сек. Прерывает сильную атаку.' },
  { id: 'adrenaline', name: 'Адреналин', short: 'СКОРОСТЬ · 5 СЕК', cost: 3, color: '#ff85bc', description: 'Ускоряет базовые атаки в 1,85 раза на 5 сек.' },
];
export const cardById = (id: CardId) => CARDS.find(c => c.id === id)!;
export const WEAPONS = [
  { id: 'pulse' as WeaponId, name: 'Импульсник', tag: 'БЫСТРО И ТОЧНО', description: '24 урона · 0,8 сек · 88% точность' },
  { id: 'scatter' as WeaponId, name: 'Дробовик', tag: 'МОЩНО ВБЛИЗИ', description: '40 урона · 1,15 сек · 94% вблизи' },
];
export const paths: Record<string, string> = {
  dash: '<path d="m9 13 12-7-4 12 15-4-8 13 15-4-15 18 3-12-15 4 6-13-13 3z"/>',
  power: '<circle cx="24" cy="24" r="13"/><circle cx="24" cy="24" r="5"/><path d="M24 4v8m0 24v8M4 24h8m24 0h8"/>',
  shield: '<path d="m24 5 15 6v11c0 10-15 20-15 20S9 32 9 22V11z"/><path d="m17 23 5 5 10-12"/>',
  smoke: '<path d="M12 35a8 8 0 0 1-2-16 10 10 0 0 1 19-5 8 8 0 0 1 10 13 6 6 0 0 1-3 11H12z"/><path d="m15 42 5-5m8 5 5-5"/>',
  shock: '<path d="M28 4 10 27h13l-3 17 18-25H25z"/>',
  adrenaline: '<path d="M5 25h8l5-13 8 25 5-14h12"/><path d="M7 14V7h7m20 0h7v7M7 34v7h7m20 0h7v-7"/>',
  pulse: '<path d="M7 15h30v11H20l-4 13H8l5-16H7z"/><path d="M37 18h6v5h-6M22 16v10m-8-15h13"/>',
  scatter: '<path d="M5 16h36v9H20l-5 14H6l7-18H5z"/><path d="M26 17v8m5-8v8m5-8v8M9 12h29"/>',
  sound: '<path d="m8 19 8 0 10-8v26l-10-8H8zM32 17c5 3 5 11 0 14m5-20c10 7 10 19 0 26"/>',
  muted: '<path d="m8 19 8 0 10-8v26l-10-8H8zM33 19l10 10m0-10L33 29"/>',
  pause: '<path d="M17 10v28m14-28v28"/>',
  trophy: '<path d="M14 7h20v12c0 14-20 14-20 0zM14 11H7v7c0 6 7 7 9 7m18-14h7v7c0 6-7 7-9 7M24 29v10m-9 2h18"/>',
  fans: '<circle cx="18" cy="17" r="6"/><path d="M7 37v-4c0-11 22-11 22 0v4M31 11c10-2 12 13 3 13m1 4c6 0 8 5 8 9"/>',
  coin: '<path d="m24 5 16 9v20l-16 9-16-9V14z"/><path d="M29 16H19v7h10v9H19m5-20v25"/>',
  arrow: '<path d="M8 24h30M27 12l12 12-12 12"/>',
};
export function icon(id: string, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[id] || paths.shock}</svg>`;
}
