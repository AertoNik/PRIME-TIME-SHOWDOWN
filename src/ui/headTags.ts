// 1.8.8+ — what stands over a fighter's head in a fight: the small HP bar is a setting (Настройки → «Полоски здоровья
// над бойцами», off by default: the top bars already show both fighters' HP), the opponent's wind-up «!» is a combat
// warning and shows whatever the setting. A KO'd fighter and the moments outside the fight show nothing.

export interface HeadTagInput {
  /** The player's setting (save.data.settings.headHp). */
  headHp: boolean;
  ko: boolean;
  /** The match is in its fighting phase. */
  fight: boolean;
  /** The opponent is winding up an attack (the «!» warning). */
  warn: boolean;
}

/** Is the tag over this fighter's head shown at all (nothing invisible is left standing when it is not)? */
export function headTagShown(i: HeadTagInput): boolean {
  return !i.ko && i.fight && (i.headHp || i.warn);
}
