// =================================================================
// ESPN (site.api.espn.com) → BracketPicks conversion
//
// Uses the public unofficial scoreboard endpoint for the FIFA World
// Cup (league slug "fifa.world"). No API key. ESPN can change this at
// any time; if it breaks, fallback is openfootball.
//
// We hit the scoreboard once per tournament-date (June 11–July 19),
// aggregate every event, then derive the same BracketPicks shape we
// already use in openfootball/sync.ts.
// =================================================================
import {
  GROUPS, GROUP_KEYS, BracketPicks, defaultPicks,
  R32_MATCHES, R16_MATCHES, QF_MATCHES, SF_MATCHES, FINAL_MATCH,
} from '@/lib/bracket-data';

const ESPN_LEAGUE_SLUG = process.env.ESPN_LEAGUE_SLUG || 'fifa.world';
const ESPN_BASE = `https://site.api.espn.com/apis/site/v2/sports/soccer/${ESPN_LEAGUE_SLUG}`;
// Tournament window. Adjust here if FIFA reschedules.
const TOURNAMENT_START = '2026-06-11';
const TOURNAMENT_END   = '2026-07-19';

// ESPN's display names mapped to OUR canonical (FIFA Final Draw) names.
// Most names line up. Edge cases collected from inspection of the scoreboard.
const TEAM_ALIAS: Record<string, string> = {
  'Korea Republic': 'South Korea',
  'Republic of Korea': 'South Korea',
  'USA': 'United States',
  'U.S.A.': 'United States',
  'US': 'United States',
  'Turkey': 'Türkiye',
  'Turkiye': 'Türkiye',
  'Czech Republic': 'Czechia',
  'Bosnia and Herzegovina': 'Bosnia-Herzegovina',
  "Côte d'Ivoire": 'Ivory Coast',
  'Cote d\'Ivoire': 'Ivory Coast',
  'Democratic Republic of the Congo': 'DR Congo',
  'Congo DR': 'DR Congo',
  'Cabo Verde': 'Cape Verde',
  'IR Iran': 'Iran',
  'Curacao': 'Curaçao',
};
function normalizeName(raw: string | undefined | null): string {
  const t = (raw ?? '').trim();
  return TEAM_ALIAS[t] ?? t;
}

// ESPN response shapes (loose — only what we care about)
type EspnTeam = {
  displayName?: string;
  shortDisplayName?: string;
  name?: string;
  abbreviation?: string;
};
type EspnCompetitor = {
  homeAway?: 'home' | 'away';
  score?: string;
  winner?: boolean;
  team?: EspnTeam;
};
type EspnDetail = {
  type?: { id?: string; text?: string };  // e.g. "Goal"
  scoringPlay?: boolean;
  athletesInvolved?: Array<{ displayName?: string; fullName?: string; team?: { id?: string } }>;
  clock?: { displayValue?: string };
  team?: { id?: string };
};
type EspnCompetition = {
  status?: { type?: { state?: 'pre' | 'in' | 'post'; completed?: boolean; name?: string } };
  competitors?: EspnCompetitor[];
  details?: EspnDetail[];
  notes?: Array<{ headline?: string; type?: string }>;
};
type EspnEvent = {
  id?: string;
  date?: string;          // ISO
  name?: string;
  shortName?: string;
  season?: { year?: number; type?: number; slug?: string };  // group-stage | round-of-32 | etc.
  competitions?: EspnCompetition[];
  status?: { type?: { state?: string; completed?: boolean } };
};
type EspnScoreboard = { events?: EspnEvent[] };

/** Iterate yyyymmdd strings from start to end (inclusive). */
function* dateRange(startIso: string, endIso: string): Generator<string> {
  const cur = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso   + 'T00:00:00Z');
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = String(cur.getUTCMonth() + 1).padStart(2, '0');
    const d = String(cur.getUTCDate()).padStart(2, '0');
    yield `${y}${m}${d}`;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/** Fetch one day's scoreboard from ESPN. Returns events[] or empty array. */
async function fetchEspnDay(yyyymmdd: string): Promise<EspnEvent[]> {
  const url = `${ESPN_BASE}/scoreboard?dates=${yyyymmdd}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) return [];
  const data = (await res.json()) as EspnScoreboard;
  return data.events ?? [];
}

/** Fetch every match across the tournament window (parallel batches of 8). */
export async function fetchAllEspnEvents(): Promise<EspnEvent[]> {
  const dates = Array.from(dateRange(TOURNAMENT_START, TOURNAMENT_END));
  const out: EspnEvent[] = [];
  const batchSize = 8;
  for (let i = 0; i < dates.length; i += batchSize) {
    const slice = dates.slice(i, i + batchSize);
    const results = await Promise.all(slice.map(d => fetchEspnDay(d).catch(() => [])));
    for (const r of results) out.push(...r);
  }
  // Dedupe by event id (just in case the API returns same event on adjacent dates)
  const seen = new Set<string>();
  return out.filter(e => {
    if (!e.id || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
}

// ----- ESPN event → our schema helpers ---------------------------------

function competitorTeamName(c: EspnCompetitor): string {
  return normalizeName(c.team?.displayName ?? c.team?.name ?? c.team?.shortDisplayName ?? '');
}

function eventTeams(e: EspnEvent): { home: EspnCompetitor; away: EspnCompetitor } | null {
  const comp = e.competitions?.[0];
  if (!comp?.competitors || comp.competitors.length < 2) return null;
  const home = comp.competitors.find(c => c.homeAway === 'home') ?? comp.competitors[0];
  const away = comp.competitors.find(c => c.homeAway === 'away') ?? comp.competitors[1];
  return { home, away };
}

function isCompleted(e: EspnEvent): boolean {
  const c = e.competitions?.[0]?.status?.type;
  return c?.completed === true || c?.state === 'post';
}

function parseScore(s?: string): number | null {
  if (s == null) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

/** Decide which knockout round this event belongs to from ESPN's stage label. */
function classifyRound(e: EspnEvent): 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'tp' | 'f' | null {
  const slug = (e.season?.slug ?? '').toLowerCase();
  // ESPN's slugs: "group-stage", "round-of-32", "round-of-16",
  // "quarterfinals", "semifinals", "3rd-place-match", "final"
  if (slug.includes('group')) return 'group';
  if (slug.includes('round-of-32') || slug.includes('32')) return 'r32';
  if (slug.includes('round-of-16') || slug.includes('16')) return 'r16';
  if (slug.includes('quarter')) return 'qf';
  if (slug.includes('semi'))    return 'sf';
  if (slug.includes('3rd') || slug.includes('third')) return 'tp';
  if (slug.includes('final'))   return 'f';
  return null;
}

/** Find a team's group letter (A-L) from our canonical GROUPS map. */
function groupOf(team: string): string | null {
  for (const g of GROUP_KEYS) {
    if (GROUPS[g].includes(team)) return g;
  }
  return null;
}

// ----- Public API ------------------------------------------------------

export async function buildActualFromEspn(): Promise<BracketPicks> {
  const events = await fetchAllEspnEvents();
  const actual = defaultPicks();
  actual.group_order = {};
  actual.best_third = [];
  actual.knockout = {};

  // ---- Group standings -------------------------------------------------
  type Row = { team: string; P: number; W: number; D: number; L: number; GF: number; GA: number; GD: number; Pts: number };
  type GMatch = { t1: string; t2: string; s1: number; s2: number };
  const standings: Record<string, Record<string, Row>> = {};
  const groupMatches: Record<string, GMatch[]> = {};
  for (const g of GROUP_KEYS) {
    standings[g] = {};
    groupMatches[g] = [];
    for (const team of GROUPS[g]) {
      standings[g][team] = { team, P:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, Pts:0 };
    }
  }

  for (const e of events) {
    if (classifyRound(e) !== 'group') continue;
    if (!isCompleted(e)) continue;
    const t = eventTeams(e);
    if (!t) continue;
    const t1 = competitorTeamName(t.home), t2 = competitorTeamName(t.away);
    const s1 = parseScore(t.home.score), s2 = parseScore(t.away.score);
    if (s1 == null || s2 == null) continue;
    const g = groupOf(t1) ?? groupOf(t2);
    if (!g) continue;
    const tbl = standings[g];
    if (!tbl[t1] || !tbl[t2]) continue;
    tbl[t1].P++; tbl[t2].P++;
    tbl[t1].GF += s1; tbl[t1].GA += s2;
    tbl[t2].GF += s2; tbl[t2].GA += s1;
    if (s1 > s2) { tbl[t1].W++; tbl[t1].Pts += 3; tbl[t2].L++; }
    else if (s2 > s1) { tbl[t2].W++; tbl[t2].Pts += 3; tbl[t1].L++; }
    else { tbl[t1].D++; tbl[t1].Pts++; tbl[t2].D++; tbl[t2].Pts++; }
    groupMatches[g].push({ t1, t2, s1, s2 });
  }

  // FIFA tie-breaker — same logic as openfootball/sync.ts: cluster by Pts,
  // resolve head-to-head, fall back to overall GD/GF/team letter.
  function h2hStats(teams: string[], ms: GMatch[]) {
    const set = new Set(teams);
    const stat: Record<string, { Pts:number; GD:number; GF:number }> = {};
    teams.forEach(x => stat[x] = { Pts:0, GD:0, GF:0 });
    for (const m of ms) {
      if (!set.has(m.t1) || !set.has(m.t2)) continue;
      stat[m.t1].GF += m.s1; stat[m.t1].GD += m.s1 - m.s2;
      stat[m.t2].GF += m.s2; stat[m.t2].GD += m.s2 - m.s1;
      if (m.s1 > m.s2) stat[m.t1].Pts += 3;
      else if (m.s2 > m.s1) stat[m.t2].Pts += 3;
      else { stat[m.t1].Pts++; stat[m.t2].Pts++; }
    }
    return stat;
  }
  function resolveCluster(cluster: Row[], ms: GMatch[]): string[] {
    if (cluster.length === 1) return [cluster[0].team];
    const teams = cluster.map(c => c.team);
    const h2h = h2hStats(teams, ms);
    const sorted = [...cluster].sort((a, b) =>
      h2h[b.team].Pts - h2h[a.team].Pts ||
      h2h[b.team].GD  - h2h[a.team].GD  ||
      h2h[b.team].GF  - h2h[a.team].GF  ||
      0
    );
    const out: string[] = [];
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      const eq = (x: Row, y: Row) =>
        h2h[x.team].Pts === h2h[y.team].Pts &&
        h2h[x.team].GD  === h2h[y.team].GD  &&
        h2h[x.team].GF  === h2h[y.team].GF;
      while (j < sorted.length && eq(sorted[i], sorted[j])) j++;
      const sub = sorted.slice(i, j);
      if (sub.length === 1) out.push(sub[0].team);
      else if (sub.length === cluster.length) {
        out.push(...sub.sort((a, b) => b.GD - a.GD || b.GF - a.GF || a.team.localeCompare(b.team)).map(r => r.team));
      } else out.push(...resolveCluster(sub, ms));
      i = j;
    }
    return out;
  }

  const thirdPlacers: Array<{ group: string; row: Row }> = [];
  for (const g of GROUP_KEYS) {
    const rows = Object.values(standings[g]);
    for (const r of rows) r.GD = r.GF - r.GA;
    rows.sort((a, b) => b.Pts - a.Pts);
    // walk clusters
    const order: string[] = [];
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j < rows.length && rows[j].Pts === rows[i].Pts) j++;
      order.push(...resolveCluster(rows.slice(i, j), groupMatches[g]));
      i = j;
    }
    actual.group_order[g] = order;
    const thirdTeam = order[2];
    const thirdRow = standings[g][thirdTeam];
    if (thirdRow) thirdPlacers.push({ group: g, row: thirdRow });
  }

  thirdPlacers.sort((a, b) =>
    b.row.Pts - a.row.Pts ||
    b.row.GD  - a.row.GD  ||
    b.row.GF  - a.row.GF  ||
    a.group.localeCompare(b.group)
  );
  actual.best_third = thirdPlacers.slice(0, 8).map(t => t.group).sort();

  // ---- Knockout: route each completed event to its slot --------------
  //
  // ESPN gives stage slugs but no FIFA match number, so within each round
  // we sort by date+time and map to our internal IDs in order.
  const buckets: Record<'r32' | 'r16' | 'qf' | 'sf' | 'tp' | 'f', { events: EspnEvent[]; ids: string[] }> = {
    r32: { events: [], ids: R32_MATCHES.map(m => m.id) },
    r16: { events: [], ids: R16_MATCHES.map(m => m.id) },
    qf:  { events: [], ids: QF_MATCHES.map(m => m.id) },
    sf:  { events: [], ids: SF_MATCHES.map(m => m.id) },
    tp:  { events: [], ids: ['TP'] },
    f:   { events: [], ids: [FINAL_MATCH.id] },
  };
  for (const e of events) {
    const r = classifyRound(e);
    if (!r || r === 'group') continue;
    if (!isCompleted(e)) continue;
    buckets[r].events.push(e);
  }
  const byDate = (a: EspnEvent, b: EspnEvent) => (a.date ?? '').localeCompare(b.date ?? '');
  for (const key of Object.keys(buckets) as Array<keyof typeof buckets>) {
    const b = buckets[key];
    b.events.sort(byDate);
    b.events.forEach((e, idx) => {
      const id = b.ids[idx];
      if (!id) return;
      const t = eventTeams(e);
      if (!t) return;
      const winnerComp = t.home.winner === true ? t.home : t.away.winner === true ? t.away : null;
      const winner = winnerComp ? competitorTeamName(winnerComp) : null;
      if (winner) actual.knockout[id] = winner;
    });
  }

  // ---- Final score (regulation + AET; PKs encoded as equal home==away) --
  const finalEvent = events.find(e => classifyRound(e) === 'f' && isCompleted(e));
  if (finalEvent) {
    const t = eventTeams(finalEvent);
    if (t) {
      const s1 = parseScore(t.home.score), s2 = parseScore(t.away.score);
      if (s1 != null && s2 != null) actual.final_score = { home: s1, away: s2 };
    }
  }

  // ---- Top scoring team (sum goals scored across every match) ----------
  const teamGoals: Record<string, number> = {};
  for (const e of events) {
    if (!isCompleted(e)) continue;
    const t = eventTeams(e);
    if (!t) continue;
    const t1 = competitorTeamName(t.home), t2 = competitorTeamName(t.away);
    const s1 = parseScore(t.home.score), s2 = parseScore(t.away.score);
    if (s1 == null || s2 == null) continue;
    teamGoals[t1] = (teamGoals[t1] ?? 0) + s1;
    teamGoals[t2] = (teamGoals[t2] ?? 0) + s2;
  }
  const teamRanking = Object.entries(teamGoals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (teamRanking.length && teamRanking[0][1] > 0) {
    actual.top_scoring_team = teamRanking[0][0];
  }

  // ---- Top scorer (Golden Boot) ---------------------------------------
  // ESPN tags each goal event in `competition.details` with the scoring player.
  // We count goals per player across every completed event. Own goals
  // (type.text === "Own Goal") are excluded from the player's tally.
  const playerGoals: Record<string, number> = {};
  for (const e of events) {
    if (!isCompleted(e)) continue;
    const details = e.competitions?.[0]?.details ?? [];
    for (const d of details) {
      const typeText = (d.type?.text ?? '').toLowerCase();
      if (!d.scoringPlay && !typeText.includes('goal')) continue;
      if (typeText.includes('own goal')) continue;
      const a = d.athletesInvolved?.[0];
      const name = (a?.displayName ?? a?.fullName ?? '').trim();
      if (!name) continue;
      playerGoals[name] = (playerGoals[name] ?? 0) + 1;
    }
  }
  const playerRanking = Object.entries(playerGoals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (playerRanking.length && playerRanking[0][1] > 0) {
    actual.top_scorer = playerRanking[0][0];
  }

  return actual;
}
