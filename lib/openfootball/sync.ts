// =================================================================
// openfootball/worldcup.json → our BracketPicks conversion
//
// openfootball publishes public-domain match data at:
//   https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
// No API key. Updated as matches complete.
// =================================================================
import { GROUPS, GROUP_KEYS, BracketPicks, defaultPicks, R32_MATCHES, R16_MATCHES, QF_MATCHES, SF_MATCHES, FINAL_MATCH } from '@/lib/bracket-data';

const OPENFOOTBALL_URL =
  'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';

// openfootball may use slightly different team names than the FIFA Final Draw.
// This alias map normalizes to OUR canonical names (from GROUPS in bracket-data.ts).
const TEAM_ALIAS: Record<string, string> = {
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'USA': 'United States',
  'U.S.A.': 'United States',
  'US': 'United States',
  'Türkiye': 'Türkiye',
  'Turkiye': 'Türkiye',
  'Turkey': 'Türkiye',
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  'Côte d\'Ivoire': 'Ivory Coast',
  'Ivory Coast': 'Ivory Coast',
  'DR Congo': 'DR Congo',
  'Democratic Republic of the Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Curacao': 'Curaçao',
  'Curaçao': 'Curaçao',
  'Cabo Verde': 'Cape Verde',
  'Cape Verde': 'Cape Verde',
  'IR Iran': 'Iran',
};
function normalizeName(raw: string): string {
  const t = raw.trim();
  return TEAM_ALIAS[t] ?? t;
}

// A valid openfootball match shape, loosely typed.
type RawGoal = { name?: string; minute?: number; score1?: number; score2?: number; owngoal?: boolean; penalty?: boolean };
type RawMatch = {
  num?: number;
  date?: string;
  time?: string;
  team1?: { name?: string; code?: string } | string;
  team2?: { name?: string; code?: string } | string;
  score1?: number | null;
  score2?: number | null;
  score1i?: number | null;           // extra-time / second-leg (rare)
  score2i?: number | null;
  pen?: { score1?: number; score2?: number };
  goals1?: Array<RawGoal | string>;  // scorers for team1
  goals2?: Array<RawGoal | string>;  // scorers for team2
  round?: string;                    // e.g., 'Round of 32', 'Matchday 1', 'Final'
  stage?: string;                    // older schema key
  group?: string;                    // e.g., 'Group A'
};
type RawData = { matches?: RawMatch[]; rounds?: Array<{ name?: string; matches?: RawMatch[] }> };

// =================================================================
// FIFA group-stage tie-breaker
//
// We can't do a single-pass comparator because Step 1 (head-to-head)
// only applies to teams that are CURRENTLY tied on points. The standard
// approach is:
//
//   1. Sort by Pts desc.
//   2. Walk the sorted list and find clusters of equal points.
//   3. Within each cluster of size >= 2, compute "head-to-head" sub-stats
//      using only the matches between the cluster teams, and re-sort that
//      cluster by (h2h_pts, h2h_gd, h2h_gf).
//   4. If teams are still tied after step 3, fall back to Step 2 (global
//      gd, gf) and then group-letter for determinism.
//
// To make this fit a sort comparator we precompute a tier-key for every
// team during a setup pass. This function `sortGroupTeams` is called
// repeatedly by Array.prototype.sort, so we cache the keys via the
// `_tieKeys` map below — keyed on the cluster's team-set signature.
// =================================================================
type Row2 = { team: string; Pts: number; GD: number; GF: number };
type GMatch = { t1: string; t2: string; s1: number; s2: number };

function headToHeadStats(teams: string[], ms: GMatch[]) {
  const t = new Set(teams);
  const stat: Record<string, { Pts:number; GD:number; GF:number }> = {};
  teams.forEach(x => stat[x] = { Pts:0, GD:0, GF:0 });
  for (const m of ms) {
    if (!t.has(m.t1) || !t.has(m.t2)) continue;
    stat[m.t1].GF += m.s1; stat[m.t1].GD += m.s1 - m.s2;
    stat[m.t2].GF += m.s2; stat[m.t2].GD += m.s2 - m.s1;
    if (m.s1 > m.s2) stat[m.t1].Pts += 3;
    else if (m.s2 > m.s1) stat[m.t2].Pts += 3;
    else { stat[m.t1].Pts++; stat[m.t2].Pts++; }
  }
  return stat;
}

/**
 * FIFA-compliant group sort.
 * `rows` is the full group; `ms` is every group-stage match in this group.
 * We pre-compute resolved positions once, then return the cached comparison.
 */
const _resolvedCache = new WeakMap<object, Map<string, number>>();
function sortGroupTeams(a: Row2, b: Row2, ms: GMatch[], rows: Row2[]): number {
  // Cache resolved positions per call to .sort() by keying on the rows array.
  let order = _resolvedCache.get(rows);
  if (!order) {
    order = resolveGroupOrder(rows, ms);
    _resolvedCache.set(rows, order);
  }
  const ai = order.get(a.team) ?? 99;
  const bi = order.get(b.team) ?? 99;
  return ai - bi;
}

function resolveGroupOrder(rows: Row2[], ms: GMatch[]): Map<string, number> {
  // Step 0: sort by Pts desc as the starting cluster split
  const byPts = [...rows].sort((a, b) => b.Pts - a.Pts);

  // Walk clusters of equal points
  const result: string[] = [];
  let i = 0;
  while (i < byPts.length) {
    let j = i;
    while (j < byPts.length && byPts[j].Pts === byPts[i].Pts) j++;
    const cluster = byPts.slice(i, j);
    if (cluster.length === 1) {
      result.push(cluster[0].team);
    } else {
      result.push(...resolveCluster(cluster, ms));
    }
    i = j;
  }
  const out = new Map<string, number>();
  result.forEach((team, idx) => out.set(team, idx));
  return out;
}

function resolveCluster(cluster: Row2[], ms: GMatch[]): string[] {
  // STEP 1: head-to-head among cluster teams
  const teams = cluster.map(c => c.team);
  const h2h = headToHeadStats(teams, ms);
  const step1 = [...cluster].sort((a, b) =>
    h2h[b.team].Pts - h2h[a.team].Pts ||
    h2h[b.team].GD  - h2h[a.team].GD  ||
    h2h[b.team].GF  - h2h[a.team].GF  ||
    0
  );

  // Walk sub-clusters where head-to-head still ties:
  const out: string[] = [];
  let i = 0;
  while (i < step1.length) {
    let j = i;
    const eq = (x: Row2, y: Row2) =>
      h2h[x.team].Pts === h2h[y.team].Pts &&
      h2h[x.team].GD  === h2h[y.team].GD  &&
      h2h[x.team].GF  === h2h[y.team].GF;
    while (j < step1.length && eq(step1[i], step1[j])) j++;
    const sub = step1.slice(i, j);
    if (sub.length === 1) {
      out.push(sub[0].team);
    } else if (sub.length === cluster.length) {
      // h2h was a complete wash — fall straight to STEP 2 (global GD/GF)
      out.push(...sub.sort((a, b) => b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team)).map(r => r.team));
    } else {
      // Partial split: recurse — use STEP 1 again but only on the sub-cluster
      // (FIFA's wording: "the criteria below shall apply as follows to the
      // two or more teams still equal on points")
      out.push(...resolveCluster(sub, ms));
    }
    i = j;
  }
  return out;
}

function nameOf(t: RawMatch['team1'] | RawMatch['team2']): string {
  if (!t) return '';
  if (typeof t === 'string') return normalizeName(t);
  return normalizeName((t as any).name ?? (t as any).code ?? '');
}

function extractGroupLetter(roundOrGroup?: string): string | null {
  if (!roundOrGroup) return null;
  const m = roundOrGroup.match(/Group\s*([A-L])/i);
  return m ? m[1].toUpperCase() : null;
}

/** Determine a knockout match winner (handles extra time + penalties when present). */
function knockoutWinner(m: RawMatch): string | null {
  const t1 = nameOf(m.team1), t2 = nameOf(m.team2);
  if (!t1 || !t2) return null;
  if (m.pen && typeof m.pen.score1 === 'number' && typeof m.pen.score2 === 'number') {
    return m.pen.score1 > m.pen.score2 ? t1 : t2;
  }
  if (typeof m.score1 !== 'number' || typeof m.score2 !== 'number') return null;
  if (m.score1 > m.score2) return t1;
  if (m.score2 > m.score1) return t2;
  return null; // draw and no penalties info → unresolved
}

/** Fetch the openfootball JSON (with a short timeout). */
export async function fetchOpenFootball(): Promise<RawData> {
  const res = await fetch(OPENFOOTBALL_URL, { cache: 'no-store' });
  if (!res.ok) throw new Error(`openfootball fetch failed: ${res.status}`);
  return (await res.json()) as RawData;
}

/** Flatten matches from both possible schema shapes. */
function flattenMatches(data: RawData): RawMatch[] {
  if (data.matches?.length) return data.matches;
  if (data.rounds?.length) return data.rounds.flatMap(r => r.matches ?? []);
  return [];
}

// ---------------------------------------------------------------
// Build a BracketPicks structure representing the actual tournament state.
// ---------------------------------------------------------------
export function buildActualFromOpenFootball(data: RawData): BracketPicks {
  const actual: BracketPicks = defaultPicks();
  actual.group_order = {}; // start empty, only fill groups we can determine
  actual.best_third = [];
  actual.knockout = {};

  const matches = flattenMatches(data);

  // ---- Group-stage standings ---------------------------------------
  type Row = { team: string; P: number; W: number; D: number; L: number; GF: number; GA: number; GD: number; Pts: number; };
  const standings: Record<string, Record<string, Row>> = {};

  // Per-group raw match list, used for head-to-head tie-breaking
  const groupMatches: Record<string, Array<{ t1: string; t2: string; s1: number; s2: number }>> = {};

  for (const g of GROUP_KEYS) {
    standings[g] = {};
    groupMatches[g] = [];
    for (const team of GROUPS[g]) {
      standings[g][team] = { team, P:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0 };
    }
  }

  for (const m of matches) {
    if (typeof m.score1 !== 'number' || typeof m.score2 !== 'number') continue;
    const groupLetter = extractGroupLetter(m.group) || extractGroupLetter(m.round) || extractGroupLetter(m.stage);
    const t1 = nameOf(m.team1), t2 = nameOf(m.team2);
    if (!groupLetter) continue;
    const g = standings[groupLetter];
    if (!g || !g[t1] || !g[t2]) continue;
    g[t1].P++; g[t2].P++;
    g[t1].GF += m.score1; g[t1].GA += m.score2;
    g[t2].GF += m.score2; g[t2].GA += m.score1;
    if (m.score1 > m.score2) { g[t1].W++; g[t1].Pts+=3; g[t2].L++; }
    else if (m.score2 > m.score1) { g[t2].W++; g[t2].Pts+=3; g[t1].L++; }
    else { g[t1].D++; g[t1].Pts++; g[t2].D++; g[t2].Pts++; }
    groupMatches[groupLetter].push({ t1, t2, s1: m.score1, s2: m.score2 });
  }

  // ---- FIFA tie-breaker: rank each group ---------------------------
  //
  // FIFA's published rules (Reg. Art. 18 / Annex):
  //   STEP 1 — among teams equal on points, look at MATCHES BETWEEN THEM:
  //     1a. greatest number of points
  //     1b. superior goal difference
  //     1c. greatest number of goals scored
  //   STEP 2 — if still tied, all group matches:
  //     2a. superior overall goal difference
  //     2b. greatest overall goals scored
  //     2c. team conduct score (cards) — we don't have card data, skipped
  //   STEP 3 — most recent FIFA/Coca-Cola Men's World Ranking
  //     (we don't have rankings client-side, so we fall back to alphabetical
  //      group order to keep the result deterministic. In practice ties this
  //      deep are extremely rare — but the admin can override on /admin.)
  //
  // We sort by repeatedly partitioning teams equal on Pts, then resolving
  // each cluster with Step 1 (head-to-head) before Step 2 (global stats).

  const thirdPlacers: Array<{ group: string; row: Row }> = [];

  for (const g of GROUP_KEYS) {
    const rows = Object.values(standings[g]);
    for (const r of rows) r.GD = r.GF - r.GA;
    rows.sort((a, b) => sortGroupTeams(a, b, groupMatches[g], rows));
    actual.group_order[g] = rows.map(r => r.team);
    if (rows[2]) thirdPlacers.push({ group: g, row: rows[2] });
  }

  // ---- Rank 12 third-placers, take top 8 ---------------------------
  // Per FIFA: Pts → GD → GF → conduct → world ranking. No head-to-head
  // (these teams are in different groups). We do Pts → GD → GF, then fall
  // back to group letter for determinism. Admin can override.
  thirdPlacers.sort((a, b) =>
    b.row.Pts - a.row.Pts ||
    b.row.GD  - a.row.GD  ||
    b.row.GF  - a.row.GF  ||
    a.group.localeCompare(b.group)
  );
  actual.best_third = thirdPlacers.slice(0, 8).map(t => t.group).sort();

  // ---- Knockout stage --------------------------------------------
  //
  // openfootball usually tags knockout matches with `round`, e.g.
  //   'Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals',
  //   'Third-place play-off', 'Final'.
  // We map each finished knockout match to the corresponding match ID
  // in our schema based on round + chronological order within the round.

  // ----- FIFA match number → our internal slot ID --------------------
  //
  // FIFA's match numbers M73-M104 are PUBLISHED and stable. openfootball
  // typically labels matches with `num: 73, 74, …`. When that's available
  // we map deterministically. When `num` isn't present, we fall back to
  // bucketing by round + chronological order (less reliable; see warning).
  const FIFA_NUM_TO_OUR_ID: Record<number, string> = {
    // R32: FIFA M73-M88 = our M1-M16
    73: 'M1', 74: 'M2', 75: 'M3', 76: 'M4', 77: 'M5', 78: 'M6', 79: 'M7', 80: 'M8',
    81: 'M9', 82: 'M10', 83: 'M11', 84: 'M12', 85: 'M13', 86: 'M14', 87: 'M15', 88: 'M16',
    // R16: FIFA M89-M96 = our R1-R8
    89: 'R1', 90: 'R2', 91: 'R3', 92: 'R4', 93: 'R5', 94: 'R6', 95: 'R7', 96: 'R8',
    // QF:  FIFA M97-M100 = our Q1-Q4
    97: 'Q1', 98: 'Q2', 99: 'Q3', 100: 'Q4',
    // SF, 3rd-place, Final
    101: 'S1', 102: 'S2', 103: 'TP', 104: 'F',
  };

  type Bucket = { matches: RawMatch[]; ids: string[] };
  const buckets: Record<string, Bucket> = {
    r32: { matches: [], ids: R32_MATCHES.map(m => m.id) },
    r16: { matches: [], ids: R16_MATCHES.map(m => m.id) },
    qf:  { matches: [], ids: QF_MATCHES.map(m => m.id) },
    sf:  { matches: [], ids: SF_MATCHES.map(m => m.id) },
    tp:  { matches: [], ids: ['TP'] },
    f:   { matches: [], ids: [FINAL_MATCH.id] },
  };

  function classifyRound(label?: string): keyof typeof buckets | null {
    if (!label) return null;
    const s = label.toLowerCase();
    if (s.includes('round of 32') || s.includes('32')) return 'r32';
    if (s.includes('round of 16') || s.includes('16')) return 'r16';
    if (s.includes('quarter')) return 'qf';
    if (s.includes('semi')) return 'sf';
    if (s.includes('third') || s.includes('3rd place') || s.includes('play-off') || s.includes('playoff')) return 'tp';
    if (s.includes('final') && !s.includes('semi') && !s.includes('quarter')) return 'f';
    return null;
  }

  // First pass: try the FIFA-num direct mapping (most reliable)
  const handled = new Set<string>();
  for (const m of matches) {
    if (typeof m.num !== 'number') continue;
    const ourId = FIFA_NUM_TO_OUR_ID[m.num];
    if (!ourId) continue;
    const bkey = classifyRound(m.round) ?? classifyRound(m.stage);
    if (!bkey || bkey === undefined) continue;
    const w = knockoutWinner(m);
    if (w) actual.knockout[ourId] = w;
    handled.add(`${m.num}`);
  }

  // Second pass: any matches not picked up above (no `num` field) are
  // bucketed by round + chronological order. This is best-effort: if
  // openfootball labels matches inconsistently the cron may misroute.
  // Run /admin to manually correct if you spot a wrong R32 winner.
  for (const m of matches) {
    if (typeof m.num === 'number' && handled.has(`${m.num}`)) continue;
    const bkey = classifyRound(m.round) ?? classifyRound(m.stage);
    if (!bkey) continue;
    buckets[bkey].matches.push(m);
  }

  const byTime = (x: RawMatch, y: RawMatch) =>
    (x.date || '').localeCompare(y.date || '') ||
    (x.time || '').localeCompare(y.time || '') ||
    (x.num ?? 0) - (y.num ?? 0);

  for (const bkey of Object.keys(buckets) as Array<keyof typeof buckets>) {
    const b = buckets[bkey];
    b.matches.sort(byTime);
    let idx = 0;
    for (const m of b.matches) {
      // Skip slots already filled by the FIFA-num mapping above
      while (idx < b.ids.length && actual.knockout[b.ids[idx]]) idx++;
      const id = b.ids[idx++];
      if (!id) break;
      const w = knockoutWinner(m);
      if (w) actual.knockout[id] = w;
    }
  }

  // ----- Final score (regulation + AET, exclude penalty shootout goals) -----
  // The PDF defines the final as M104. We try the FIFA num first, then fall
  // back to the 'final' bucket's only match.
  const finalRaw =
    matches.find(m => m.num === 104) ??
    buckets.f.matches[0];
  if (finalRaw && typeof finalRaw.score1 === 'number' && typeof finalRaw.score2 === 'number') {
    actual.final_score = { home: finalRaw.score1, away: finalRaw.score2 };
  }

  // ----- Top scoring team (count goals across every match scored by team) ---
  const teamGoals: Record<string, number> = {};
  for (const m of matches) {
    if (typeof m.score1 !== 'number' || typeof m.score2 !== 'number') continue;
    const t1 = nameOf(m.team1), t2 = nameOf(m.team2);
    if (!t1 || !t2) continue;
    teamGoals[t1] = (teamGoals[t1] ?? 0) + m.score1;
    teamGoals[t2] = (teamGoals[t2] ?? 0) + m.score2;
  }
  const teamRanking = Object.entries(teamGoals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (teamRanking.length && teamRanking[0][1] > 0) {
    actual.top_scoring_team = teamRanking[0][0];
  }

  // ----- Top scorer (count goals per player across every match) ------------
  // openfootball stores scorers in goals1 / goals2 arrays. Each entry is a
  // string ("Mbappé") or an object with a `name` field. Own goals do NOT
  // count toward the scorer (per FIFA Golden Boot rules — they go to the
  // opponent's tally, but don't credit a specific player).
  const playerGoals: Record<string, number> = {};
  function recordGoals(arr: Array<RawGoal | string> | undefined) {
    if (!arr) return;
    for (const g of arr) {
      const obj = typeof g === 'string' ? { name: g } : g;
      if (!obj?.name) continue;
      if ((obj as RawGoal).owngoal) continue;
      const name = obj.name.trim();
      if (!name) continue;
      playerGoals[name] = (playerGoals[name] ?? 0) + 1;
    }
  }
  for (const m of matches) {
    recordGoals(m.goals1);
    recordGoals(m.goals2);
  }
  const playerRanking = Object.entries(playerGoals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (playerRanking.length && playerRanking[0][1] > 0) {
    actual.top_scorer = playerRanking[0][0];
  }

  return actual;
}
