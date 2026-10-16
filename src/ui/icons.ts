import type { CardId, PassiveId } from '../config/types';

const S = (body: string, vb = '0 0 64 64') =>
  `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const STROKE = 'stroke="rgba(0,0,0,0.35)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"';

export const CARD_ICONS: Record<CardId, string> = {
  dash: S(
    `<path d="M10 14 L30 32 L10 50 L18 50 L38 32 L18 14 Z" fill="#fff" ${STROKE}/>
     <path d="M28 14 L48 32 L28 50 L38 50 L58 32 L38 14 Z" fill="#fff" ${STROKE}/>
     <rect x="2" y="22" width="10" height="4" rx="2" fill="#fff" opacity=".7"/>
     <rect x="0" y="38" width="8" height="4" rx="2" fill="#fff" opacity=".5"/>`,
  ),
  power_shot: S(
    `<circle cx="38" cy="32" r="15" fill="#fff" ${STROKE}/>
     <circle cx="38" cy="32" r="7" fill="#ffd23a"/>
     <path d="M4 26 L22 28 M2 36 L22 35 M8 46 L24 40 M8 18 L24 24" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity=".85"/>
     <path d="M54 12 L57 20 L64 22 L57 25 L54 32 L51 25 L44 22 L51 20 Z" fill="#fff"/>`,
  ),
  shield: S(
    `<path d="M32 4 L54 12 L54 30 C54 44 44 54 32 60 C20 54 10 44 10 30 L10 12 Z" fill="#fff" ${STROKE}/>
     <path d="M32 12 L46 17 L46 30 C46 39 40 46 32 51 Z" fill="#9ad8ff"/>
     <path d="M18 18 L28 15" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".9"/>`,
  ),
  smoke: S(
    `<path d="M14 46 C6 46 4 36 11 33 C9 24 19 19 25 24 C27 14 42 12 45 22 C53 20 60 28 56 35 C63 39 59 48 51 48 Z" fill="#fff" ${STROKE}/>
     <circle cx="22" cy="54" r="4" fill="#fff" opacity=".7"/>
     <circle cx="34" cy="57" r="3" fill="#fff" opacity=".5"/>
     <circle cx="46" cy="54" r="3.5" fill="#fff" opacity=".6"/>`,
  ),
  shock: S(
    `<path d="M36 2 L12 36 L28 36 L22 62 L52 24 L35 24 L44 2 Z" fill="#fff" ${STROKE}/>
     <path d="M34 10 L22 30" stroke="#ffd23a" stroke-width="3" stroke-linecap="round"/>`,
  ),
  overdrive: S(
    `<path d="M32 2 C36 14 50 20 50 38 C50 51 42 60 32 60 C22 60 14 51 14 38 C14 28 20 22 22 14 C26 20 26 26 30 28 C30 18 28 10 32 2 Z" fill="#fff" ${STROKE}/>
     <path d="M32 30 C34 38 42 40 42 48 C42 54 37 58 32 58 C27 58 22 54 22 48 C22 42 28 40 32 30 Z" fill="#ffd23a"/>`,
  ),
  adrenaline: S(
    `<path d="M32 56 C14 44 6 34 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 34 50 44 32 56 Z" fill="#fff" ${STROKE}/>
     <path d="M10 30 L22 30 L27 20 L33 40 L38 26 L41 30 L54 30" fill="none" stroke="#ff3a6a" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`,
  ),
  knockout: S(
    `<path d="M14 26 C14 18 20 14 26 15 L44 15 C52 15 56 21 56 28 L56 40 C56 50 48 56 38 56 L28 56 C20 56 14 50 14 42 Z" fill="#fff" ${STROKE}/>
     <path d="M26 15 L26 30 M36 15 L36 30 M46 16 L46 30" stroke="rgba(0,0,0,0.3)" stroke-width="3" stroke-linecap="round"/>
     <path d="M14 34 C20 34 26 36 28 42" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="3" stroke-linecap="round"/>
     <path d="M2 18 L8 22 M0 32 L8 32 M2 46 L8 42" stroke="#fff" stroke-width="4" stroke-linecap="round"/>`,
  ),
  system_overload: S(
    `<rect x="14" y="14" width="36" height="36" rx="6" fill="#fff" ${STROKE}/>
     <rect x="23" y="23" width="18" height="18" rx="3" fill="#ff4fd8"/>
     <path d="M20 6 V14 M32 6 V14 M44 6 V14 M20 50 V58 M32 50 V58 M44 50 V58 M6 20 H14 M6 32 H14 M6 44 H14 M50 20 H58 M50 32 H58 M50 44 H58" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
     <rect x="8" y="28" width="22" height="5" fill="#22f0e0" opacity=".9"/>
     <rect x="36" y="36" width="20" height="4" fill="#22f0e0" opacity=".8"/>`,
  ),
  // crosshair with a rail beam punching through
  charged_shot: S(
    `<circle cx="30" cy="32" r="17" fill="none" stroke="#fff" stroke-width="5"/>
     <path d="M30 9 V19 M30 45 V55 M7 32 H17 M43 32 H53" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
     <circle cx="30" cy="32" r="5" fill="#bff4ff"/>
     <path d="M30 32 L62 32" stroke="#ffffff" stroke-width="3.5" stroke-linecap="round"/>
     <path d="M48 24 L62 32 L48 40" fill="none" stroke="#bff4ff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`,
  ),
  // Alpha 1.5: BANK SHOT — a round bouncing once off a wall into a target ring
  bank_shot: S(
    `<rect x="52" y="4" width="8" height="56" rx="3" fill="#fff" opacity=".9"/>
     <path d="M6 54 L48 22 L12 8" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="8 5"/>
     <path d="M46 14 L50 22 L41 24" fill="none" stroke="#ffd2a0" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="48" cy="22" r="5" fill="#ff9a4a" stroke="#fff" stroke-width="2.5"/>
     <circle cx="12" cy="10" r="7" fill="none" stroke="#fff" stroke-width="3.5"/>
     <circle cx="12" cy="10" r="2.5" fill="#ffd2a0"/>`,
  ),
  // Alpha 1.5: FALSE START — two fading afterimages and the real silhouette stepping aside
  false_start: S(
    `<circle cx="16" cy="16" r="7" fill="#fff" opacity=".25"/><path d="M8 52 V34 C8 27 24 27 24 34 V52 Z" fill="#fff" opacity=".25"/>
     <circle cx="28" cy="16" r="7" fill="#fff" opacity=".5"/><path d="M20 52 V34 C20 27 36 27 36 34 V52 Z" fill="#fff" opacity=".5"/>
     <circle cx="46" cy="16" r="7.5" fill="#fff" ${STROKE}/><path d="M37 52 V34 C37 26 55 26 55 34 V52 Z" fill="#fff" ${STROKE}/>
     <path d="M30 40 L44 40 M40 35 L45 40 L40 45" fill="none" stroke="#ff6f61" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  // three warning lines from the champion's rifle, the last one the widest (DIRECTOR'S CUT)
  directors_cut: S(
    `<path d="M10 34 L56 12" stroke="#ff4a3a" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 5"/>
     <path d="M10 34 L58 34" stroke="#ff4a3a" stroke-width="4" stroke-linecap="round" stroke-dasharray="7 5"/>
     <path d="M10 34 L56 56" stroke="#ffd76a" stroke-width="7" stroke-linecap="round"/>
     <circle cx="10" cy="34" r="7" fill="#ffc23a" stroke="#fff" stroke-width="3"/>
     <path d="M8 6 H34 L30 14 H4 Z" fill="#fff"/>
     <path d="M12 6 L8 14 M20 6 L16 14 M28 6 L24 14" stroke="#7a1020" stroke-width="3"/>`,
  ),
};

export const PASSIVE_ICONS: Record<PassiveId, string> = {
  momentum: S(
    `<path d="M8 40 L24 40 L30 24 L40 52 L46 34 L56 34" fill="none" stroke="#22f0e0" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`,
  ),
  iron_skin: S(
    `<path d="M32 4 L54 12 L54 30 C54 44 44 54 32 60 C20 54 10 44 10 30 L10 12 Z" fill="#c8d4ea" stroke="#5a6680" stroke-width="3"/>
     <path d="M22 26 L42 26 M22 36 L42 36" stroke="#5a6680" stroke-width="4" stroke-linecap="round"/>`,
  ),
  overclock: S(
    `<circle cx="32" cy="32" r="22" fill="none" stroke="#ff4fd8" stroke-width="5"/>
     <path d="M32 18 V32 L42 38" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
     <path d="M48 6 L44 16 L52 16 L46 28" fill="none" stroke="#ffd23a" stroke-width="3.5" stroke-linejoin="round"/>`,
  ),
  deadeye: S(
    `<path d="M4 32 C14 16 50 16 60 32 C50 48 14 48 4 32 Z" fill="none" stroke="#9ff0ff" stroke-width="4"/>
     <circle cx="32" cy="32" r="9" fill="none" stroke="#fff" stroke-width="4"/>
     <circle cx="32" cy="32" r="3.5" fill="#5fd8ff"/>
     <path d="M32 6 V16 M32 48 V58" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>`,
  ),
  // Alpha 1.5: CROSSFIRE — a sideways step with a shot across it
  crossfire: S(
    `<path d="M10 44 H40 M32 36 L40 44 L32 52" fill="none" stroke="#13b5a6" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M20 12 L48 34" stroke="#ff9a4a" stroke-width="5" stroke-linecap="round"/>
     <circle cx="52" cy="37" r="6" fill="#fff"/>`,
  ),
  // Alpha 1.5: RIPOSTE — an arrow turning back on itself
  riposte: S(
    `<path d="M50 14 C30 8 12 20 14 36 C16 50 34 56 48 46" fill="none" stroke="#ff6f61" stroke-width="5" stroke-linecap="round"/>
     <path d="M40 38 L49 46 L38 52" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
     <path d="M44 8 L52 14 L44 20" fill="none" stroke="#ffe3c2" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
};

export const UI_ICONS = {
  money: S(`<path d="M32 8 V56 M42 18 C38 14 26 13 23 20 C19 29 44 28 41 40 C38 50 24 49 20 44" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>`),
  rep: S(`<path d="M32 4 L40 23 L60 24 L44 37 L50 57 L32 46 L14 57 L20 37 L4 24 L24 23 Z" fill="currentColor"/>`),
  fans: S(`<path d="M32 56 C14 44 6 34 6 22 C6 13 13 7 21 7 C26 7 30 10 32 14 C34 10 38 7 43 7 C51 7 58 13 58 22 C58 34 50 44 32 56 Z" fill="currentColor"/>`),
  soundOn: S(`<path d="M8 24 H20 L34 12 V52 L20 40 H8 Z" fill="#fff"/><path d="M42 22 C47 27 47 37 42 42 M48 15 C57 24 57 40 48 49" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`),
  soundOff: S(`<path d="M8 24 H20 L34 12 V52 L20 40 H8 Z" fill="#fff"/><path d="M42 24 L56 40 M56 24 L42 40" stroke="#ff6a7a" stroke-width="5" stroke-linecap="round"/>`),
  gear: S(`<path d="M32 20 A12 12 0 1 0 32.1 20 Z" fill="none" stroke="#fff" stroke-width="6"/><path d="M32 4 V12 M32 52 V60 M4 32 H12 M52 32 H60 M12 12 L18 18 M46 46 L52 52 M12 52 L18 46 M46 18 L52 12" stroke="#fff" stroke-width="6" stroke-linecap="round"/>`),
  back: S(`<path d="M40 10 L18 32 L40 54" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  next: S(`<path d="M24 10 L46 32 L24 54" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`),
  lock: S(`<rect x="12" y="28" width="40" height="30" rx="7" fill="#ffd23a"/><path d="M20 28 V20 C20 6 44 6 44 20 V28" fill="none" stroke="#ffd23a" stroke-width="6"/>`),
  pause: S(`<rect x="14" y="10" width="12" height="44" rx="3" fill="#fff"/><rect x="38" y="10" width="12" height="44" rx="3" fill="#fff"/>`),
  eye: S(`<path d="M4 32 C14 14 50 14 60 32 C50 50 14 50 4 32 Z" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="32" cy="32" r="9" fill="currentColor"/>`),
  trophy: S(`<path d="M18 6 H46 V22 C46 32 40 38 32 38 C24 38 18 32 18 22 Z" fill="#3a2200"/><path d="M18 10 H8 C8 22 14 26 20 26 M46 10 H56 C56 22 50 26 44 26" fill="none" stroke="#3a2200" stroke-width="5"/><path d="M28 38 H36 V48 H44 V56 H20 V48 H28 Z" fill="#3a2200"/>`),
  check: S(`<path d="M12 34 L26 48 L52 18" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`),
  star: S(`<path d="M32 4 L40 23 L60 24 L44 37 L50 57 L32 46 L14 57 L20 37 L4 24 L24 23 Z" fill="#ffd23a"/>`),
  pencil: S(`<path d="M10 54 L14 40 L42 12 L52 22 L24 50 Z" fill="#fff"/><path d="M38 16 L48 26" stroke="#0b1028" stroke-width="4"/>`),
  users: S(`<circle cx="24" cy="22" r="10" fill="#fff"/><path d="M6 54 C6 40 42 40 42 54 Z" fill="#fff"/><circle cx="44" cy="24" r="8" fill="#fff" opacity=".7"/><path d="M40 42 C52 40 60 46 60 54 H46" fill="#fff" opacity=".7"/>`),
  // Alpha 1.5: MY COLLECTION — a showcase case with a star
  archive: S(`<rect x="8" y="10" width="48" height="44" rx="6" fill="none" stroke="#fff" stroke-width="5"/><path d="M8 38 H56" stroke="#fff" stroke-width="4"/><path d="M32 15 L35.5 23 L44 23.6 L37.5 29 L39.6 37 L32 32.6 L24.4 37 L26.5 29 L20 23.6 L28.5 23 Z" fill="#ffd23a"/><rect x="18" y="43" width="10" height="6" rx="2" fill="#22f0e0"/><rect x="36" y="43" width="10" height="6" rx="2" fill="#ff4fd8"/>`),
  career: S(`<rect x="8" y="36" width="10" height="20" rx="2" fill="#fff"/><rect x="27" y="24" width="10" height="32" rx="2" fill="#fff"/><rect x="46" y="10" width="10" height="46" rx="2" fill="#22f0e0"/>`),
  bolt: S(`<path d="M36 2 L12 36 L28 36 L22 62 L52 24 L35 24 L44 2 Z" fill="currentColor"/>`),
  film: S(`<rect x="6" y="14" width="40" height="36" rx="6" fill="#fff"/><path d="M46 26 L60 18 V46 L46 38 Z" fill="#fff"/>`),
};
