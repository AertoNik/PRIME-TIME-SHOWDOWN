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
  // ------------------------------------------------ Alpha 1.6 — CARD REVOLUTION
  // studio spotlight lighting a target marker
  spotlight_tag: S(
    `<path d="M23 7 L30 17 L58 45 L41 58 Z" fill="#fff" opacity=".32"/>
     <path d="M6 10 L21 3 L28 17 L13 24 Z" fill="#fff" ${STROKE}/>
     <path d="M21 3 L28 17" stroke="#ffd23a" stroke-width="3.5" stroke-linecap="round"/>
     <circle cx="47" cy="49" r="9" fill="none" stroke="#fff" stroke-width="4.5"/>
     <circle cx="47" cy="49" r="3.5" fill="#ffd23a"/>
     <path d="M54 8 L56 14 L62 16 L56 18 L54 24 L52 18 L46 16 L52 14 Z" fill="#fff"/>`,
  ),
  // three tracers fanning out of one muzzle
  split_shot: S(
    `<path d="M17 32 L58 32" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
     <path d="M17 30 L53 11" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
     <path d="M17 34 L53 53" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
     <circle cx="58" cy="32" r="4.5" fill="#d6ffb0"/><circle cx="53" cy="11" r="4" fill="#d6ffb0"/><circle cx="53" cy="53" r="4" fill="#d6ffb0"/>
     <circle cx="11" cy="32" r="8" fill="#fff" ${STROKE}/>`,
  ),
  // a spinning disc on an out-and-back path
  rebound_disc: S(
    `<path d="M8 46 C14 10 50 6 57 28" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="6 5"/>
     <path d="M57 32 C53 48 32 54 15 51" fill="none" stroke="#bff4ff" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="6 5"/>
     <path d="M20 45 L13 51 L21 56" fill="none" stroke="#bff4ff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
     <ellipse cx="36" cy="30" rx="15" ry="9" fill="#fff" ${STROKE}/>
     <ellipse cx="36" cy="30" rx="6" ry="3.5" fill="#38e1ff"/>`,
  ),
  // a foam star falling onto a warning circle
  prop_drop: S(
    `<ellipse cx="32" cy="54" rx="23" ry="7" fill="none" stroke="#fff" stroke-width="3.5" stroke-dasharray="6 4"/>
     <circle cx="32" cy="54" r="3" fill="#ffd23a"/>
     <path d="M32 6 L36.1 16.3 L47.2 17.1 L38.7 24.2 L41.4 34.9 L32 29 L22.6 34.9 L25.3 24.2 L16.8 17.1 L27.9 16.3 Z" fill="#fff" ${STROKE}/>
     <path d="M24 40 V46 M32 38 V47 M40 40 V46" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".7"/>`,
  ),
  // a wave rolling forward from the fighter
  pulse_push: S(
    `<circle cx="11" cy="32" r="7" fill="#fff" ${STROKE}/>
     <path d="M21 17 C28 24 28 40 21 47" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
     <path d="M31 11 C40 22 40 42 31 53" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>
     <path d="M41 6 C52 20 52 44 41 58" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".5"/>
     <path d="M50 32 L62 32 M56 26 L62 32 L56 38" fill="none" stroke="#e2d4ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  // a glowing floor grid around a dropped generator
  gravity_net: S(
    `<ellipse cx="32" cy="42" rx="27" ry="15" fill="none" stroke="#fff" stroke-width="4"/>
     <path d="M7 42 H57 M14 33 L50 51 M14 51 L50 33 M32 27 V57" stroke="#fff" stroke-width="2.5" opacity=".7"/>
     <circle cx="32" cy="42" r="6" fill="#4dffd2" stroke="#fff" stroke-width="3"/>
     <path d="M32 4 V18 M25 12 L32 19 L39 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  // a blinking pulse mine on the floor
  pressure_mine: S(
    `<ellipse cx="32" cy="46" rx="21" ry="8" fill="#fff" ${STROKE}/>
     <path d="M15 44 C17 33 47 33 49 44 Z" fill="#fff" ${STROKE}/>
     <circle cx="32" cy="37" r="4.5" fill="#ff3a5c"/>
     <path d="M21 22 C27 16 37 16 43 22 M14 15 C24 5 40 5 50 15" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".85"/>`,
  ),
  // a translucent stage screen on a lit base stopping a shot
  stage_barrier: S(
    `<rect x="24" y="5" width="20" height="45" rx="3" fill="#cfeaff" ${STROKE}/>
     <path d="M28 13 H40 M28 21 H40 M28 29 H40 M28 37 H40" stroke="#3d8bff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/>
     <rect x="16" y="50" width="36" height="8" rx="3" fill="#fff" ${STROKE}/>
     <path d="M3 28 H15" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
     <circle cx="19" cy="28" r="4.5" fill="#9ad8ff" stroke="#fff" stroke-width="2"/>
     <path d="M14 20 L18 23 M14 36 L18 33" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  ),
  // a cable shot looping round its catch point
  cable_snare: S(
    `<path d="M7 55 C15 41 21 53 29 39 C35 29 40 37 44 27" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>
     <circle cx="49" cy="19" r="11" fill="none" stroke="#fff" stroke-width="5"/>
     <circle cx="49" cy="19" r="4" fill="#e9ff70"/>
     <circle cx="7" cy="55" r="5.5" fill="#fff" ${STROKE}/>
     <path d="M36 50 A16 6 0 0 0 62 50" fill="none" stroke="#e9ff70" stroke-width="3" stroke-dasharray="4 4"/>`,
  ),
  // the fighter and a scan-lined hologram copy
  holo_decoy: S(
    `<circle cx="42" cy="16" r="8" fill="#bff8ff" opacity=".6"/><path d="M30 57 V37 C30 27 54 27 54 37 V57 Z" fill="#bff8ff" opacity=".6"/>
     <path d="M30 36 H54 M30 43 H54 M30 50 H54" stroke="#fff" stroke-width="2" opacity=".9"/>
     <circle cx="21" cy="18" r="8" fill="#fff" ${STROKE}/><path d="M9 58 V38 C9 28 33 28 33 38 V58 Z" fill="#fff" ${STROKE}/>`,
  ),
  // an energy frame with a caught round
  frame_catch: S(
    `<path d="M8 21 V8 H21 M43 8 H56 V21 M56 43 V56 H43 M21 56 H8 V43" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
     <circle cx="32" cy="32" r="8" fill="#fff" ${STROKE}/>
     <path d="M32 21 V15 M32 43 V49 M21 32 H15 M43 32 H49" stroke="#c6ff4d" stroke-width="3.5" stroke-linecap="round"/>`,
  ),
  // the rewind symbol over a dashed track
  backtrack: S(
    `<path d="M58 14 L35 32 L58 50 Z" fill="#fff" opacity=".55" ${STROKE}/>
     <path d="M35 14 L11 32 L35 50 Z" fill="#fff" ${STROKE}/>
     <path d="M6 58 H58" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 5"/>
     <circle cx="8" cy="58" r="3.5" fill="#ff7ad9"/>`,
  ),
  // a show chip: health on one side, energy on the other
  high_stakes: S(
    `<circle cx="32" cy="32" r="27" fill="#fff" ${STROKE}/>
     <circle cx="32" cy="32" r="21" fill="none" stroke="#9c1030" stroke-width="4" stroke-dasharray="6 5"/>
     <path d="M21 41 C14 36 11 32 11 28 C11 24 14 22 17 22 C19 22 20.5 23 21 25 C21.5 23 23 22 25 22 C28 22 31 24 31 28 C31 32 28 36 21 41 Z" fill="#ff3a5c"/>
     <path d="M45 18 L35 33 H42 L39 46 L51 30 H44 L48 18 Z" fill="#ffd23a" stroke="#9c1030" stroke-width="1.5" stroke-linejoin="round"/>`,
  ),
  // a studio camera on the barrier taking one shot
  side_cam: S(
    `<rect x="3" y="5" width="6" height="54" rx="2" fill="#fff" opacity=".85"/>
     <path d="M9 27 H15" stroke="#fff" stroke-width="4"/>
     <rect x="14" y="17" width="25" height="17" rx="3" fill="#fff" ${STROKE}/>
     <path d="M39 20 L50 14 V37 L39 31 Z" fill="#fff" ${STROKE}/>
     <circle cx="20" cy="23" r="3" fill="#ff3a3a"/>
     <path d="M48 30 L61 56" stroke="#ff4f6d" stroke-width="4" stroke-linecap="round" stroke-dasharray="6 4"/>`,
  ),
  // a stopwatch frozen on pause
  freeze_frame: S(
    `<circle cx="32" cy="35" r="24" fill="#fff" ${STROKE}/>
     <rect x="27" y="4" width="10" height="7" rx="2" fill="#fff"/>
     <path d="M49 13 L54 8" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
     <rect x="23.5" y="24" width="6" height="22" rx="2" fill="#1e4f8f"/>
     <rect x="34.5" y="24" width="6" height="22" rx="2" fill="#1e4f8f"/>
     <path d="M12 35 H16 M48 35 H52 M32 15 V19 M32 51 V55" stroke="#1e4f8f" stroke-width="2.5" stroke-linecap="round"/>`,
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
