// ==================================================================
// 2026 FIFA World Cup Bracket Data — FIFA-accurate structure
// ==================================================================

export const GROUPS: Record<string, string[]> = {
  A: ['Mexico', 'South Korea', 'South Africa', 'Czechia'],
  B: ['Canada', 'Switzerland', 'Qatar', 'Bosnia-Herzegovina'],
  C: ['Brazil', 'Morocco', 'Haiti', 'Scotland'],
  D: ['United States', 'Paraguay', 'Australia', 'Türkiye'],
  E: ['Germany', 'Ivory Coast', 'Ecuador', 'Curaçao'],
  F: ['Netherlands', 'Sweden', 'Tunisia', 'Japan'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Spain', 'Cape Verde', 'Saudi Arabia', 'Uruguay'],
  I: ['France', 'Senegal', 'Iraq', 'Norway'],
  J: ['Argentina', 'Algeria', 'Austria', 'Jordan'],
  K: ['Portugal', 'DR Congo', 'Uzbekistan', 'Colombia'],
  L: ['England', 'Croatia', 'Ghana', 'Panama'],
};
export const GROUP_KEYS = Object.keys(GROUPS);

// ------------------------------------------------------------------
// FIFA R32 structure, per the Final Draw (Dec 5, 2025).
//
// 8 "Winner vs 3rd-place" slots — each group winner faces a 3rd-place team
// from ONE of the groups in its eligibility set (never its own group).
// The specific assignment comes from FIFA's 495-combo matrix, which is
// resolved by our algorithm in scoring.ts#assignThirdPlacers once the
// group stage ends.
//
// 4 "Winner vs Runner-up" cross-matches.
// 4 "Runner-up vs Runner-up" matches.
// ------------------------------------------------------------------

/** Per-slot eligibility list: which 3rd-place group letters can fill this slot. */
export const THIRD_PLACE_SLOT_ELIGIBILITY: Record<string, string[]> = {
  T_for_E: ['A','B','C','D','F'],
  T_for_I: ['C','D','F','G','H'],
  T_for_A: ['C','E','F','H','I'],
  T_for_L: ['E','H','I','J','K'],
  T_for_D: ['B','E','F','I','J'],
  T_for_G: ['A','E','H','I','J'],
  T_for_B: ['E','F','G','I','J'],
  T_for_K: ['D','E','I','J','L'],
};

export type SlotMatch = { id: string; a: string; b: string };
export type AdvanceMatch = { id: string; aFrom: string; bFrom: string };

/**
 * R32: 16 matches organized as a tree.
 *
 *   Top half (→ SF1)                Bottom half (→ SF2)
 *   -------------------------        -------------------------
 *   M1  W-A  vs 3rd[T_for_A]         M9   W-I  vs 3rd[T_for_I]
 *   M2  W-E  vs 3rd[T_for_E]         M10  W-L  vs 3rd[T_for_L]
 *   M3  W-C  vs RU-F                 M11  W-H  vs RU-J
 *   M4  W-F  vs RU-C                 M12  W-J  vs RU-H
 *   M5  W-D  vs 3rd[T_for_D]         M13  W-K  vs 3rd[T_for_K]
 *   M6  W-G  vs 3rd[T_for_G]         M14  W-B  vs 3rd[T_for_B]
 *   M7  RU-D vs RU-G                 M15  RU-E vs RU-I
 *   M8  RU-A vs RU-B                 M16  RU-K vs RU-L
 */
export const R32_MATCHES: SlotMatch[] = [
  // Top half
  { id: 'M1',  a: 'WA', b: 'T_for_A' },
  { id: 'M2',  a: 'WE', b: 'T_for_E' },
  { id: 'M3',  a: 'WC', b: 'RF' },
  { id: 'M4',  a: 'WF', b: 'RC' },
  { id: 'M5',  a: 'WD', b: 'T_for_D' },
  { id: 'M6',  a: 'WG', b: 'T_for_G' },
  { id: 'M7',  a: 'RD', b: 'RG' },
  { id: 'M8',  a: 'RA', b: 'RB' },
  // Bottom half
  { id: 'M9',  a: 'WI', b: 'T_for_I' },
  { id: 'M10', a: 'WL', b: 'T_for_L' },
  { id: 'M11', a: 'WH', b: 'RJ' },
  { id: 'M12', a: 'WJ', b: 'RH' },
  { id: 'M13', a: 'WK', b: 'T_for_K' },
  { id: 'M14', a: 'WB', b: 'T_for_B' },
  { id: 'M15', a: 'RE', b: 'RI' },
  { id: 'M16', a: 'RK', b: 'RL' },
];

/** R16 pairings — sequential pairs of R32 matches. */
export const R16_MATCHES: AdvanceMatch[] = [
  { id: 'R1', aFrom: 'M1',  bFrom: 'M2'  },
  { id: 'R2', aFrom: 'M3',  bFrom: 'M4'  },
  { id: 'R3', aFrom: 'M5',  bFrom: 'M6'  },
  { id: 'R4', aFrom: 'M7',  bFrom: 'M8'  },
  { id: 'R5', aFrom: 'M9',  bFrom: 'M10' },
  { id: 'R6', aFrom: 'M11', bFrom: 'M12' },
  { id: 'R7', aFrom: 'M13', bFrom: 'M14' },
  { id: 'R8', aFrom: 'M15', bFrom: 'M16' },
];
export const QF_MATCHES: AdvanceMatch[] = [
  { id: 'Q1', aFrom: 'R1', bFrom: 'R2' },
  { id: 'Q2', aFrom: 'R3', bFrom: 'R4' },
  { id: 'Q3', aFrom: 'R5', bFrom: 'R6' },
  { id: 'Q4', aFrom: 'R7', bFrom: 'R8' },
];
export const SF_MATCHES: AdvanceMatch[] = [
  { id: 'S1', aFrom: 'Q1', bFrom: 'Q2' },
  { id: 'S2', aFrom: 'Q3', bFrom: 'Q4' },
];
export const FINAL_MATCH: AdvanceMatch = { id: 'F', aFrom: 'S1', bFrom: 'S2' };
export const THIRD_PLACE_MATCH = { id: 'TP' } as const;

export const ALL_KO_MATCHES: (SlotMatch | AdvanceMatch)[] = [
  ...R32_MATCHES, ...R16_MATCHES, ...QF_MATCHES, ...SF_MATCHES, FINAL_MATCH,
];

export const POINTS = {
  GROUP_ADV: 5,
  THIRD: 3,
  R32: 10,
  R16: 20,
  QF: 40,
  SF: 80,
  TP: 40,
  FINAL: 160,
} as const;

export const MAX_SCORE =
  24 * POINTS.GROUP_ADV +   // 120
   8 * POINTS.THIRD +       //  24
  16 * POINTS.R32 +         // 160
   8 * POINTS.R16 +         // 160
   4 * POINTS.QF +          // 160
   2 * POINTS.SF +          // 160
  POINTS.TP +               //  40
  POINTS.FINAL;             // 160 -> 984

// -- Types ----------------------------------------------------------
export type GroupOrder = Record<string, string[]>;
export type KnockoutPicks = Record<string, string>;

export type BracketPicks = {
  group_order: GroupOrder;
  best_third: string[];
  knockout: KnockoutPicks;
  tiebreak_goals: number | null;
};

export function defaultPicks(): BracketPicks {
  const group_order: GroupOrder = {};
  for (const k of GROUP_KEYS) group_order[k] = GROUPS[k].slice();
  return { group_order, best_third: [], knockout: {}, tiebreak_goals: null };
}
