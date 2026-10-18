import type { WeaponType } from './types';

export type HairStyle = 'spiky' | 'buzz' | 'buns' | 'cap' | 'beanie' | 'mohawk' | 'ponytail' | 'quiff' | 'slick' | 'curtain' | 'bob' | 'swept';
export type TopStyle = 'bomber' | 'vest' | 'tech' | 'windbreaker' | 'puffer' | 'racer' | 'pads' | 'coat' | 'track' | 'moto' | 'tailcoat';
export type PantsStyle = 'track' | 'cargo' | 'jogger' | 'tailored';
export type BodyType = 'lean' | 'heavy' | 'slim' | 'athletic' | 'svelte';
export type Accessory = 'headphones' | 'chain' | 'headset' | 'goggles' | 'wristbands' | 'stubble' | 'beard' | 'earring' | 'blush' | 'visor' | 'belt' | 'shades' | 'choker';

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
  /** Alpha 1.5.5: optional face traits that set a character apart (stylised, never realistic). */
  face?: FaceTraits;
  /**
   * Alpha 1.6.5: a robot (the PRIME TRAINING BOT) — the same skeleton and animations, but a
   * metal head with a glowing visor face and an antenna instead of skin, hair, ears and nose.
   * `skin` is the metal colour, `eyes` the visor glow.
   */
  robot?: boolean;
}

export interface FaceTraits {
  /** Soft cheekbones: a highlight over each cheek and a gentle crease below (0..1). */
  cheekbones: number;
  /** A slightly fuller, defined jaw with a rounded chin (0..1) — never a sharp point. */
  jaw: number;
  /** Eye height multiplier (a touch lower reads older and more knowing). */
  eyeHeight: number;
  /** Thicker, arched brows, one cocked higher than the other. */
  archedBrows: boolean;
  /** A lopsided showman's grin with a dimple on the raised side. */
  grin: boolean;
  /** Mimicry: now and then one brow flashes up. */
  browFlash: boolean;
  /** Alpha 1.7 (Lucien): angular, sharper cheekbones with a deeper hollow under them. */
  sharp?: boolean;
  /** Alpha 1.7: narrow brows rising toward the temples. */
  narrowBrows?: boolean;
  /** Alpha 1.7: two small neat fangs under the upper lip, a fine line on the upper eyelids. */
  fangs?: boolean;
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
  // Alpha 1.5 — Kai «Trickshot»: early-2000s showman. Cropped navy track jacket with a
  // turquoise yoke and copper piping, a popped collar, late-90s curtain hair with copper
  // frosted tips, retro shades pushed up into the hair and a long copper trick pistol.
  kai: {
    id: 'kai',
    body: 'lean',
    skin: 0xd9a27a,
    hair: { style: 'curtain', color: 0x2a1a14, color2: 0xe0904a },
    top: { style: 'track', main: 0x10264a, accent: 0x13b5a6, trim: 0xe0904a, inner: 0xeef2f6 },
    pants: { style: 'track', main: 0x152033, accent: 0xe0904a },
    shoes: { main: 0xf4f6fa, accent: 0x13b5a6, sole: 0xe0904a },
    gloves: 0x16202e,
    fingerless: true,
    eyes: 0x4a2a18,
    brow: 'cocky',
    mouth: 'smile',
    accessories: ['shades', 'earring', 'wristbands'],
    // Alpha 1.5.5: his own face — a bit older and more charismatic than the rest of the roster
    face: { cheekbones: 1, jaw: 1, eyeHeight: 0.9, archedBrows: true, grin: true, browFlash: true },
    weapon: 'ricochet',
    weaponColor: 0xd8843a,
    weaponDark: 0x1c2433,
    glow: 0x3df0dc,
    rim: 0x8ff7ec,
  },
  // Alpha 1.5 — Rina «Mirage»: cropped cream moto jacket with coral panels and an
  // asymmetric zip, graphite joggers, a sharp asymmetric bob with a coral streak,
  // a choker, and a compact twin-barrel blaster held close.
  rina: {
    id: 'rina',
    body: 'slim',
    skin: 0xf5d2bc,
    hair: { style: 'bob', color: 0x1e1d26, color2: 0xff6f61 },
    top: { style: 'moto', main: 0xf1e3cc, accent: 0xff6f61, trim: 0x2a2b33, inner: 0x2a2b33 },
    pants: { style: 'jogger', main: 0x2a2b33, accent: 0xff6f61 },
    shoes: { main: 0x26272e, accent: 0xff6f61, sole: 0xf1e3cc },
    gloves: 0x2a2b33,
    fingerless: false,
    eyes: 0x7a3e2a,
    brow: 'sly',
    mouth: 'smirk',
    accessories: ['choker', 'earring', 'blush'],
    weapon: 'stinger',
    weaponColor: 0x30313a,
    weaponDark: 0x17181d,
    glow: 0xff7a6a,
    rim: 0xffb8a8,
  },
  // Alpha 1.7 — LUCIEN «The Night Star»: a young vampire guest star. Tall and lean, pale noble skin,
  // dark hair swept back from a widow's peak, crimson eyes, narrow brows, sharp cheekbones and two
  // small fangs. A fitted black tailcoat with a high vampire collar lined in bordeaux, metal clasps,
  // coat tails, slim trousers, tall boots, black gloves — and the VAMPIRE CANE BLASTER.
  lucien: {
    id: 'lucien',
    body: 'svelte',
    skin: 0xe6c8bc,
    hair: { style: 'swept', color: 0x15111b, color2: 0x5a1426 },
    top: { style: 'tailcoat', main: 0x17121c, accent: 0x7c1029, trim: 0x5d6170, inner: 0xbdb2bf },
    pants: { style: 'tailored', main: 0x19141e, accent: 0x5c0e20 },
    shoes: { main: 0x120e16, accent: 0x6a6e7e, sole: 0x2b0913, boots: true },
    gloves: 0x1c1519,
    fingerless: false,
    eyes: 0xc4122f,
    brow: 'sly',
    mouth: 'smirk',
    accessories: [],
    face: { cheekbones: 1, jaw: 0.8, eyeHeight: 0.9, archedBrows: false, grin: false, browFlash: true, sharp: true, narrowBrows: true, fangs: true },
    weapon: 'cane',
    weaponColor: 0x141119,
    weaponDark: 0x3c3f4c,
    glow: 0xff2a4a,
    rim: 0xff7a92,
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
  // Alpha 1.6.5: PRIME TRAINING BOT — a chunky retro-future studio mannequin: pale steel,
  // safety-orange panels, a dark visor with amber eyes, an antenna with a lamp
  bot: {
    id: 'bot',
    body: 'heavy',
    skin: 0xc9d1de,
    hair: { style: 'buzz', color: 0x3a4152, color2: 0xff9a1f },
    top: { style: 'pads', main: 0xff8a1a, accent: 0xfff0c2, trim: 0x39404f, inner: 0x9aa4b6 },
    pants: { style: 'cargo', main: 0x4a5264, accent: 0xff8a1a },
    shoes: { main: 0x39404f, accent: 0xff8a1a, sole: 0x1c2029, boots: true },
    gloves: 0x5a6375,
    fingerless: false,
    eyes: 0xffb52e,
    brow: 'stern',
    mouth: 'flat',
    accessories: [],
    weapon: 'twin_blasters',
    weaponColor: 0xb8c2d3,
    weaponDark: 0x2c323f,
    glow: 0xffb52e,
    rim: 0xfff0c2,
    robot: true,
  },
};
