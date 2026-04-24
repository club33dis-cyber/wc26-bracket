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
  round?: string;                    // e.g., 'Round of 32', 'Matchday 1', 'Final'
  stage?: string;                    // older schema key
  group?: string;                    // e.g., 'Group A'
};
type RawData = { matches?: RawMatch[]; rounds?: Array<{ name?: string; matches?: RawMatch[] }> };

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

  // Seed rows for every team in every group from our canonical GROUPS map
  for (const g of GROUP_KEYS) {
    standings[g] = {};
    for (const team of GROUPS[g]) {
      standings[g][team] = { team, P:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0 };
    }
  }

  for (const m of matches) {
    if (typeof m.score1 !== 'number' || typeof m.score2 !== 'number') continue;

    const groupLetter = extractGroupLetter(m.group) || extractGroupLetter(m.round) || extractGroupLetter(m.stage);
    const t1 = nameOf(m.team1), t2 = nameOf(m.team2);

    if (groupLetter) {
      // Group-stage accumulation
      const g = standings[groupLetter];
      if (!g || !g[t1] || !g[t2]) continue;
      g[t1].P++; g[t2].P++;
      g[t1].GF += m.score1; g[t1].GA += m.score2;
      g[t2].GF += m.score2; g[t2].GA += m.score1;
      if (m.score1 > m.score2) { g[t1].W++; g[t1].Pts+=3; g[t2].L++; }
      else if (m.score2 > m.score1) { g[t2].W++; g[t2].Pts+=3; g[t1].L++; }
      else { g[t1].D++; g[t1].Pts++; g[t2].D++; g[t2].Pts++; }
    }
  }

  // Finalize GD and order each group
  const thirdPlacers: Array<{ group: string; row: Row }> = [];
  for (const g of GROUP_KEYS) {
    const rows = Object.values(standings[g]);
    for (const r of rows) r.GD = r.GF - r.GA;
    rows.sort((a, b) => b.Pts - a.Pts || b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team));
    actual.group_order[g] = rows.map(r => r.team);
    if (rows[2]) thirdPlacers.push({ group: g, row: rows[2] });
  }

  // Rank 12 third-placers; take top 8
  thirdPlacers.sort((a, b) =>
    b.row.Pts - a.row.Pts || b.row.GD - a.row.GD || b.row.GF - a.row.GF || a.group.localeCompare(b.group)
  );
  actual.best_third = thirdPlacers.slice(0, 8).map(t => t.group).sort();

  // ---- Knockout stage --------------------------------------------
  //
  // openfootball usually tags knockout matches with `round`, e.g.
  //   'Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals',
  //   'Third-place play-off', 'Final'.
  // We map each finished knockout match to the corresponding match ID
  // in our schema based on round + chronological order within the round.

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

  for (const m of matches) {
    const bkey = classifyRound(m.round) ?? classifyRound(m.stage);
    if (!bkey) continue;
    buckets[bkey].matches.push(m);
  }

  // Sort each bucket by date/time/num so earliest-scheduled matches map to M1/R1/…
  const byTime = (x: RawMatch, y: RawMatch) =>
    (x.date || '').localeCompare(y.date || '') ||
    (x.time || '').localeCompare(y.time || '') ||
    (x.num ?? 0) - (y.num ?? 0);

  for (const bkey of Object.keys(buckets) as Array<keyof typeof buckets>) {
    const b = buckets[bkey];
    b.matches.sort(byTime);
    b.matches.forEach((m, idx) => {
      const id = b.ids[idx];
      if (!id) return;
      const w = knockoutWinner(m);
      if (w) actual.knockout[id] = w;
    });
  }

  return actual;
}
