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
 * R32 — 16 matches matching FIFA Reg. Art. 12.6 (M73-M88).
 * Our internal IDs M1-M16 map 1:1 to FIFA's M73-M88.
 *
 *   Our ID   FIFA ID   Matchup
 *   ------   -------   -----------------------
 *   M1       M73       Runner-up A vs Runner-up B
 *   M2       M74       Winner E   vs 3rd[T_for_E]
 *   M3       M75       Winner F   vs Runner-up C
 *   M4       M76       Winner C   vs Runner-up F
 *   M5       M77       Winner I   vs 3rd[T_for_I]
 *   M6       M78       Runner-up E vs Runner-up I
 *   M7       M79       Winner A   vs 3rd[T_for_A]
 *   M8       M80       Winner L   vs 3rd[T_for_L]
 *   M9       M81       Winner D   vs 3rd[T_for_D]
 *   M10      M82       Winner G   vs 3rd[T_for_G]
 *   M11      M83       Runner-up K vs Runner-up L
 *   M12      M84       Winner H   vs Runner-up J
 *   M13      M85       Winner B   vs 3rd[T_for_B]
 *   M14      M86       Winner J   vs Runner-up H
 *   M15      M87       Winner K   vs 3rd[T_for_K]
 *   M16      M88       Runner-up D vs Runner-up G
 */
export const R32_MATCHES: SlotMatch[] = [
  { id: 'M1',  a: 'RA', b: 'RB' },         // FIFA M73
  { id: 'M2',  a: 'WE', b: 'T_for_E' },    // FIFA M74
  { id: 'M3',  a: 'WF', b: 'RC' },         // FIFA M75
  { id: 'M4',  a: 'WC', b: 'RF' },         // FIFA M76
  { id: 'M5',  a: 'WI', b: 'T_for_I' },    // FIFA M77
  { id: 'M6',  a: 'RE', b: 'RI' },         // FIFA M78
  { id: 'M7',  a: 'WA', b: 'T_for_A' },    // FIFA M79
  { id: 'M8',  a: 'WL', b: 'T_for_L' },    // FIFA M80
  { id: 'M9',  a: 'WD', b: 'T_for_D' },    // FIFA M81
  { id: 'M10', a: 'WG', b: 'T_for_G' },    // FIFA M82
  { id: 'M11', a: 'RK', b: 'RL' },         // FIFA M83
  { id: 'M12', a: 'WH', b: 'RJ' },         // FIFA M84
  { id: 'M13', a: 'WB', b: 'T_for_B' },    // FIFA M85
  { id: 'M14', a: 'WJ', b: 'RH' },         // FIFA M86
  { id: 'M15', a: 'WK', b: 'T_for_K' },    // FIFA M87
  { id: 'M16', a: 'RD', b: 'RG' },         // FIFA M88
];

/**
 * R16 — FIFA Reg. Art. 12.7 (M89-M96).
 *   Our R1 = FIFA M89: W74 vs W77 → our M2 vs M5
 *   Our R2 = FIFA M90: W73 vs W75 → our M1 vs M3
 *   Our R3 = FIFA M91: W76 vs W78 → our M4 vs M6
 *   Our R4 = FIFA M92: W79 vs W80 → our M7 vs M8
 *   Our R5 = FIFA M93: W83 vs W84 → our M11 vs M12
 *   Our R6 = FIFA M94: W81 vs W82 → our M9 vs M10
 *   Our R7 = FIFA M95: W86 vs W88 → our M14 vs M16
 *   Our R8 = FIFA M96: W85 vs W87 → our M13 vs M15
 */
export const R16_MATCHES: AdvanceMatch[] = [
  { id: 'R1', aFrom: 'M2',  bFrom: 'M5'  },
  { id: 'R2', aFrom: 'M1',  bFrom: 'M3'  },
  { id: 'R3', aFrom: 'M4',  bFrom: 'M6'  },
  { id: 'R4', aFrom: 'M7',  bFrom: 'M8'  },
  { id: 'R5', aFrom: 'M11', bFrom: 'M12' },
  { id: 'R6', aFrom: 'M9',  bFrom: 'M10' },
  { id: 'R7', aFrom: 'M14', bFrom: 'M16' },
  { id: 'R8', aFrom: 'M13', bFrom: 'M15' },
];

/**
 * QF — FIFA Reg. Art. 12.8 (M97-M100).
 *   Q1 = FIFA M97  : W89 vs W90 → our R1 vs R2
 *   Q2 = FIFA M98  : W93 vs W94 → our R5 vs R6
 *   Q3 = FIFA M99  : W91 vs W92 → our R3 vs R4
 *   Q4 = FIFA M100 : W95 vs W96 → our R7 vs R8
 */
export const QF_MATCHES: AdvanceMatch[] = [
  { id: 'Q1', aFrom: 'R1', bFrom: 'R2' },
  { id: 'Q2', aFrom: 'R5', bFrom: 'R6' },
  { id: 'Q3', aFrom: 'R3', bFrom: 'R4' },
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
