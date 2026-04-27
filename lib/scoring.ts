import {
  GROUP_KEYS, R32_MATCHES, R16_MATCHES, QF_MATCHES, SF_MATCHES,
  FINAL_MATCH, POINTS, BracketPicks, SlotMatch, AdvanceMatch,
} from './bracket-data';
import { FIFA_THIRD_PLACE_MATRIX } from './fifa-third-place-matrix';

// =================================================================
// FIFA 3rd-PLACE ASSIGNMENT — official 495-row matrix
//
// Source: FIFA World Cup 2026 Regulations (Annex C, pages 80-99).
// Verified: all 495 rows present, indexed by lex-order over 8-element
// advancing-group subsets, zero same-group rematches.
//
// The lookup is keyed on the sorted concatenation of 8 advancing
// groups (e.g., "CDEFGHJK"). Returns a map of T_for_X → group letter
// whose 3rd-placer fills that slot.
// =================================================================

/**
 * Given 8 group letters whose 3rd-placers advance, return FIFA's pre-determined
 * assignment of which 3rd-placer plays which group winner. Output format:
 *   { T_for_A: 'C', T_for_B: 'F', ... }
 * Returns null on invalid input.
 */
export function assignThirdPlacers(advancingGroups: string[]): Record<string, string> | null {
  if (advancingGroups.length !== 8) return null;
  const key = [...advancingGroups].sort().join('');
  const row = FIFA_THIRD_PLACE_MATRIX[key];
  if (!row) return null;
  return {
    T_for_A: row.A, T_for_B: row.B, T_for_D: row.D, T_for_E: row.E,
    T_for_G: row.G, T_for_I: row.I, T_for_K: row.K, T_for_L: row.L,
  };
}

/** Resolve a slot code (WA, RB, T_for_X, M4, R2, Q1, S2, F, TP) to its current team. */
export function teamFor(code: string, b: BracketPicks): string | null {
  if (!code) return null;
  if (/^(M|R|Q|S)\d+$/.test(code) || code === 'F' || code === 'TP') return b.knockout[code] ?? null;
  if (code[0] === 'W') return b.group_order[code[1]]?.[0] ?? null;
  if (code[0] === 'R' && code.length === 2) return b.group_order[code[1]]?.[1] ?? null;
  if (code.startsWith('T_for_')) {
    if ((b.best_third ?? []).length !== 8) return null;
    const assignment = assignThirdPlacers(b.best_third);
    if (!assignment) return null;
    const g = assignment[code];
    if (!g) return null;
    return b.group_order[g]?.[2] ?? null;
  }
  return null;
}

export function matchTeams(m: SlotMatch | AdvanceMatch, b: BracketPicks): (string | null)[] {
  if ('a' in m) return [teamFor(m.a, b), teamFor(m.b, b)];
  return [b.knockout[m.aFrom] ?? null, b.knockout[m.bFrom] ?? null];
}

export function thirdPlaceMatchTeams(b: BracketPicks): (string | null)[] {
  const s1Teams = matchTeams(SF_MATCHES[0], b);
  const s2Teams = matchTeams(SF_MATCHES[1], b);
  const s1Win = b.knockout['S1'];
  const s2Win = b.knockout['S2'];
  const loser1 = s1Teams.find(t => t && t !== s1Win) ?? null;
  const loser2 = s2Teams.find(t => t && t !== s2Win) ?? null;
  return [loser1, loser2];
}

export function cleanupInvalidPicks(b: BracketPicks): BracketPicks {
  const copy: BracketPicks = { ...b, knockout: { ...b.knockout } };
  const allMatches = [...R32_MATCHES, ...R16_MATCHES, ...QF_MATCHES, ...SF_MATCHES, FINAL_MATCH];
  let changed = true, safety = 10;
  while (changed && safety-- > 0) {
    changed = false;
    for (const m of allMatches) {
      const pick = copy.knockout[m.id];
      if (!pick) continue;
      const teams = matchTeams(m, copy).filter(Boolean);
      if (!teams.includes(pick)) { delete copy.knockout[m.id]; changed = true; }
    }
    if (copy.knockout['TP']) {
      const tpTeams = thirdPlaceMatchTeams(copy).filter(Boolean) as string[];
      if (!tpTeams.includes(copy.knockout['TP'])) { delete copy.knockout['TP']; changed = true; }
    }
  }
  return copy;
}

// =================================================================
// TEAM-BASED SCORING
//
// Problem with slot-based scoring: FIFA's 3rd-placer assignment means
// the same team can end up in different R32 slots depending on which
// 8 groups provide 3rd-placers. If our algorithm puts Team X in slot
// M1 but FIFA puts Team X in slot M3, a slot-by-slot comparison gives
// wrong results.
//
// Solution: score by "did the team you picked actually advance past
// this round?" — identical to ESPN March Madness pools. Each round's
// points = (per-team value) × (teams in BOTH your round-winners set
// AND reality's round-winners set).
// =================================================================

export type ScoreBreakdown = {
  group: number; third: number;
  r32: number; r16: number; qf: number; sf: number;
  tp: number; final: number;
};
export type ScoreResult = { score: number; correctChamp: boolean; breakdown: ScoreBreakdown };

/** Collect all team names the picks set as winners for a given set of matches. */
function roundWinners(picks: BracketPicks, matches: { id: string }[]): Set<string> {
  const s = new Set<string>();
  for (const m of matches) {
    const t = picks.knockout[m.id];
    if (t) s.add(t);
  }
  return s;
}

function intersectionCount(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

export function scoreBracket(picks: BracketPicks, actual: BracketPicks): ScoreResult {
  let score = 0;
  const breakdown: ScoreBreakdown = { group: 0, third: 0, r32: 0, r16: 0, qf: 0, sf: 0, tp: 0, final: 0 };

  // Group stage top-2 advancers
  for (const gk of GROUP_KEYS) {
    const my = new Set((picks.group_order[gk] ?? []).slice(0, 2));
    const real = new Set((actual.group_order[gk] ?? []).slice(0, 2));
    for (const t of my) if (real.has(t)) { score += POINTS.GROUP_ADV; breakdown.group += POINTS.GROUP_ADV; }
  }

  // Best-third picks
  const realThird = new Set(actual.best_third ?? []);
  for (const g of picks.best_third ?? []) {
    if (realThird.has(g)) { score += POINTS.THIRD; breakdown.third += POINTS.THIRD; }
  }

  // Knockout rounds: team-based scoring per round
  const roundSpecs: Array<[any[], number, keyof ScoreBreakdown]> = [
    [R32_MATCHES, POINTS.R32, 'r32'],
    [R16_MATCHES, POINTS.R16, 'r16'],
    [QF_MATCHES,  POINTS.QF,  'qf'],
    [SF_MATCHES,  POINTS.SF,  'sf'],
  ];
  for (const [matches, pts, key] of roundSpecs) {
    const mine = roundWinners(picks, matches);
    const real = roundWinners(actual, matches);
    const hits = intersectionCount(mine, real);
    score += pts * hits;
    breakdown[key] += pts * hits;
  }

  // 3rd-place match: single-team comparison
  if (picks.knockout['TP'] && actual.knockout['TP'] && picks.knockout['TP'] === actual.knockout['TP']) {
    score += POINTS.TP; breakdown.tp += POINTS.TP;
  }

  // Final / champion: single-team
  const correctChamp =
    !!picks.knockout['F'] && !!actual.knockout['F'] && picks.knockout['F'] === actual.knockout['F'];
  if (correctChamp) { score += POINTS.FINAL; breakdown.final += POINTS.FINAL; }

  return { score, correctChamp, breakdown };
}

export function picksCount(b: BracketPicks): { total: number; max: number } {
  let groupsTouched = 0;
  for (const gk of GROUP_KEYS) {
    const cur = b.group_order[gk] ?? [];
    if (cur.length === 4) groupsTouched++;
  }
  const third = (b.best_third ?? []).length;
  const koMatches = [...R32_MATCHES, ...R16_MATCHES, ...QF_MATCHES, ...SF_MATCHES, FINAL_MATCH];
  const ko = koMatches.filter(m => b.knockout[m.id]).length + (b.knockout['TP'] ? 1 : 0);
  return {
    total: Math.min(12, groupsTouched) + third + ko,
    max: 12 + 8 + 16 + 8 + 4 + 2 + 1 + 1, // 52
  };
}
