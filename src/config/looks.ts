import type { WeaponType } from './types';

export type HairStyle = 'spiky' | 'buzz' | 'buns' | 'cap' | 'beanie' | 'mohawk' | 'ponytail' | 'quiff' | 'slick';
export type TopStyle = 'bomber' | 'vest' | 'tech' | 'windbreaker' | 'puffer' | 'racer' | 'pads' | 'coat';
export type PantsStyle = 'track' | 'cargo' | 'jogger';
export type BodyType = 'lean' | 'heavy' | 'slim' | 'athletic';
export type Accessory = 'headphones' | 'chain' | 'headset' | 'goggles' | 'wristbands' | 'stubble' | 'beard' | 'earring' | 'blush' | 'visor' | 'belt';

/** Visual recipe for a procedurally built fighter. */
export interface LookDef {
  id: string;
  body: BodyType;
  skin: number;
  hair: { style: HairStyle; color: number; color2: number };
  top: { style: TopStyle; main: number; accent: number; trim: number; inner: number };
  pants: { style: PantsStyle; main: number; accent: number };
  shoes: { main: number; accent: number; sole: number; boots?: boolean };
  gloves: number;
  fingerless: boolean;
  eyes: number;
  brow: 'cocky' | 'stern' | 'sly';
  mouth: 'smirk' | 'flat' | 'smile';
  accessories: Accessory[];
  weapon: WeaponType;
  weaponColor: number;
  weaponDark: number;
  glow: number;
  rim: number;
}

export const LOOKS: Record<string, LookDef> = {
  ray: {
    id: 'ray',
    body: 'lean',
    skin: 0xf1c29c,
    hair: { style: 'spiky', color: 0x1b1f33, color2: 0x22f0e0 },
    top: { style: 'bomber', main: 0x1f6fff, accent: 0x22f0e0, trim: 0x0d2a70, inner: 0xf2f4ff },
    pants: { style: 'track', main: 0x232838, accent: 0x22f0e0 },
    shoes: { main: 0xf6f7fb, accent: 0x1f6fff, sole: 0x22f0e0 },
    gloves: 0x1a1d29,
    fingerless: true,
    eyes: 0x4a2e1c,
    brow: 'cocky',
    mouth: 'smirk',
    accessories: ['headphones', 'wristbands'],
    weapon: 'twin_blasters',
    weaponColor: 0xe3e9f5,
    weaponDark: 0x262c3c,
    glow: 0x22f0e0,
    rim: 0x7ff8ff,
  },
  bruno: {
    id: 'bruno',
    body: 'heavy',
    skin: 0xc68a60,
    hair: { style: 'buzz', color: 0x17120e, color2: 0x17120e },
    top: { style: 'vest', main: 0xd8232a, accent: 0x18181e, trim: 0xf4f4f4, inner: 0x18181e },
    pants: { style: 'cargo', main: 0x1d1d23, accent: 0xd8232a },
    shoes: { main: 0x2a221d, accent: 0xd8232a, sole: 0x0e0e10, boots: true },
    gloves: 0x131316,
    fingerless: true,
    eyes: 0x2a1a10,
    brow: 'stern',
    mouth: 'flat',
    accessories: ['chain', 'stubble', 'wristbands'],
    weapon: 'boom_cannon',
    weaponColor: 0x2c2c33,
    weaponDark: 0x141418,
    glow: 0xff6a1a,
    rim: 0xff9a6a,
  },
  nika: {
    id: 'nika',
    body: 'slim',
    skin: 0xf6d0b6,
    hair: { style: 'buns', color: 0x8a3cff, color2: 0xff4fd8 },
    top: { style: 'tech', main: 0x6a2bd9, accent: 0xff4fd8, trim: 0x2a1360, inner: 0x1c1633 },
    pants: { style: 'jogger', main: 0x241c3c, accent: 0xff4fd8 },
    shoes: { main: 0xfafafa, accent: 0x8a3cff, sole: 0xff4fd8 },
    gloves: 0x2a2140,
    fingerless: false,
    eyes: 0x6b3cff,
    brow: 'sly',
    mouth: 'smile',
    accessories: ['headset', 'blush'],
    weapon: 'tech_carbine',
    weaponColor: 0xf0eaff,
    weaponDark: 0x2a2140,
    glow: 0xff4fd8,
    rim: 0xff9af2,
  },
  dex: {
    id: 'dex',
    body: 'lean',
    skin: 0x8a5636,
    hair: { style: 'cap', color: 0xffd21f, color2: 0x15151a },
    top: { style: 'windbreaker', main: 0xff7a1a, accent: 0xffe14d, trim: 0x22222a, inner: 0x1a1a1f },
    pants: { style: 'track', main: 0x1a1a24, accent: 0xff7a1a },
    shoes: { main: 0xffd21f, accent: 0x15151a, sole: 0xffffff },
    gloves: 0x15151a,
    fingerless: true,
    eyes: 0x2a1a10,
    brow: 'cocky',
    mouth: 'smile',
    accessories: ['headphones', 'wristbands'],
    weapon: 'twin_blasters',
    weaponColor: 0x2b2b33,
    weaponDark: 0x15151a,
    glow: 0xffa21a,
    rim: 0xffc07a,
  },
  tank: {
    id: 'tank',
    body: 'heavy',
    skin: 0xe2b48e,
    hair: { style: 'beanie', color: 0x46592a, color2: 0x9a5f2c },
    top: { style: 'puffer', main: 0x7a8f2a, accent: 0xffc93a, trim: 0x2a3010, inner: 0x2c2a24 },
    pants: { style: 'cargo', main: 0x4a4030, accent: 0xffc93a },
    shoes: { main: 0x7a5530, accent: 0xffc93a, sole: 0x1a1612, boots: true },
    gloves: 0x2a2a20,
    fingerless: true,
    eyes: 0x3a5a2a,
    brow: 'stern',
    mouth: 'flat',
    accessories: ['beard', 'wristbands'],
    weapon: 'boom_cannon',
    weaponColor: 0x6b7f2a,
    weaponDark: 0x1e2410,
    glow: 0xffc93a,
    rim: 0xffe39a,
  },
  zoe: {
    id: 'zoe',
    body: 'slim',
    skin: 0xf0c8a8,
    hair: { style: 'mohawk', color: 0x2bff88, color2: 0x2c302e },
    top: { style: 'tech', main: 0x15181d, accent: 0x2bff88, trim: 0x0a0c0f, inner: 0x2a2d33 },
    pants: { style: 'jogger', main: 0x1d2a26, accent: 0x2bff88 },
    shoes: { main: 0x16181c, accent: 0x2bff88, sole: 0xe8fff2 },
    gloves: 0x0f1114,
    fingerless: false,
    eyes: 0x1f8a5a,
    brow: 'sly',
    mouth: 'smirk',
    accessories: ['goggles', 'earring'],
    weapon: 'tech_carbine',
    weaponColor: 0x2a2d33,
    weaponDark: 0x101215,
    glow: 0x2bff88,
    rim: 0x9affc8,
  },
  // Alpha 1.2.5 — Vega: white racing jacket, platinum high ponytail with icy tips,
  // flip-up visor; the same slim build as Nika so she sits naturally in the roster.
  vega: {
    id: 'vega',
    body: 'slim',
    skin: 0xf3cdb0,
    hair: { style: 'ponytail', color: 0xe2c98e, color2: 0x5fd0ff },
    top: { style: 'racer', main: 0xd7dfeb, accent: 0x2fb2f0, trim: 0x15365a, inner: 0x152338 },
    pants: { style: 'jogger', main: 0x1a2a42, accent: 0x2fb2f0 },
    shoes: { main: 0xf6f8fc, accent: 0x2fb2f0, sole: 0x9fe8ff },
    gloves: 0x1a2a42,
    fingerless: false,
    eyes: 0x2e86c8,
    brow: 'sly',
    mouth: 'smirk',
    accessories: ['visor', 'earring'],
    weapon: 'pulse_rifle',
    weaponColor: 0xeef2f8,
    weaponDark: 0x1a2a42,
    glow: 0x5fd8ff,
    rim: 0xa8ecff,
  },
  // Crash: heavy brawler in a sleeveless black jersey with big pink shoulder pads
  // and a tall hot-pink quiff — a different silhouette from Bruno and Tank.
  crash: {
    id: 'crash',
    body: 'heavy',
    skin: 0xd99a6c,
    hair: { style: 'quiff', color: 0xff3a82, color2: 0x241a1e },
    top: { style: 'pads', main: 0x17171d, accent: 0xff2f6e, trim: 0xffd23a, inner: 0x17171d },
    pants: { style: 'cargo', main: 0x22222a, accent: 0xff2f6e },
    shoes: { main: 0x17171d, accent: 0xff2f6e, sole: 0xffd23a, boots: true },
    gloves: 0x17171d,
    fingerless: true,
    eyes: 0x3a2214,
    brow: 'cocky',
    mouth: 'smirk',
    accessories: ['chain', 'stubble', 'wristbands'],
    weapon: 'boom_cannon',
    weaponColor: 0x24242c,
    weaponDark: 0x121216,
    glow: 0xff3a82,
    rim: 0xff9ac0,
  },
  // Alpha 1.3.1 boss: the show's legendary champion. Broad athletic build, long
  // black showman coat with gold lapels and epaulettes, championship belt,
  // slicked-back hair with a gold streak, the PRIME BREAKER heavy rifle (Alpha 1.3.3).
  vale: {
    id: 'vale',
    body: 'athletic',
    skin: 0xe2b08c,
    hair: { style: 'slick', color: 0x17141d, color2: 0xffc94a },
    top: { style: 'coat', main: 0x141119, accent: 0xd8a23a, trim: 0xffd76a, inner: 0xa3122c },
    pants: { style: 'track', main: 0x15121a, accent: 0xd8a23a },
    shoes: { main: 0x15121a, accent: 0xd8a23a, sole: 0xffd76a, boots: true },
    gloves: 0x15121a,
    fingerless: false,
    eyes: 0x6a3e14,
    brow: 'cocky',
    mouth: 'smirk',
    accessories: ['belt', 'stubble', 'earring'],
    // Alpha 1.3.3: PRIME BREAKER — graphite heavy rifle with gold accents and warm gold glow
    weapon: 'breaker',
    weaponColor: 0xe8b23c,
    weaponDark: 0x22232a,
    glow: 0xffc84a,
    rim: 0xffe39a,
  },
};
