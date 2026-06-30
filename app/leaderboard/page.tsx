import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { scoreBracket, picksCount } from '@/lib/scoring';
import { BracketPicks, MAX_SCORE, defaultPicks } from '@/lib/bracket-data';

export const dynamic = 'force-dynamic';
export const revalidate = 20;

const PAGE_SIZE = 50;

export default async function LeaderboardPage({
  searchParams,
}: { searchParams: { page?: string; q?: string } }) {
  const supa = createSupabaseServerClient();
  const page = Math.max(1, parseInt(searchParams.page ?? '1', 10) || 1);
  const search = (searchParams.q ?? '').trim();

  // Actual results singleton
  const { data: actualRow } = await supa.from('actual_results').select('*').eq('id', 1).maybeSingle();
  const actual: BracketPicks = actualRow ? {
    group_order: actualRow.group_order ?? {},
    best_third: actualRow.best_third ?? [],
    knockout: actualRow.knockout ?? {},
    tiebreak_goals: null,
    final_score: actualRow.final_score ?? null,
    top_scorer: actualRow.top_scorer ?? null,
    top_scoring_team: actualRow.top_scoring_team ?? null,
  } : defaultPicks();
  // "Grading started" = either group stage or knockout results have been entered.
  // Previously only checked knockout, so group-stage-only progress showed
  // "Tournament hasn't started" — fixed.
  const gradingStarted = !!actualRow && (
    Object.keys(actualRow.knockout ?? {}).length > 0 ||
    Object.keys(actualRow.group_order ?? {}).length > 0
  );

  // Strategy: two separate queries, joined in code by user_id.
  //
  // Why not a PostgREST embedded select? `brackets.user_id` and
  // `profiles.user_id` both reference `auth.users.id` with no direct FK
  // between them, so PostgREST can't traverse `brackets.profiles!inner(...)`
  // and silently returns 0 rows. Doing two queries dodges the issue
  // entirely.
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // 1) Brackets, sorted server-side by the denormalized score column.
  let bracketsQuery = supa
    .from('brackets')
    .select('user_id, group_order, best_third, knockout, tiebreak_goals, final_score, top_scorer, top_scoring_team, score, updated_at', { count: 'exact' })
    .order('score', { ascending: false })
    .order('updated_at', { ascending: true });

  const { data: bracketRows, count } = await bracketsQuery.range(from, to);

  // 2) Profiles for the user_ids in this page (or filtered by search).
  const userIds = (bracketRows ?? []).map(r => r.user_id);
  let profileMap: Record<string, { display_name: string; email?: string }> = {};
  if (userIds.length > 0) {
    let pq = supa.from('profiles').select('user_id, display_name, email').in('user_id', userIds);
    if (search) pq = pq.ilike('display_name', `%${search}%`);
    const { data: profileRows } = await pq;
    for (const p of profileRows ?? []) {
      profileMap[p.user_id] = { display_name: p.display_name, email: p.email };
    }
  }

  // If a search term was given, drop any bracket whose profile doesn't match.
  const rows = search
    ? (bracketRows ?? []).filter(r => profileMap[r.user_id])
    : (bracketRows ?? []);

  // Currently logged-in user, if any
  const { data: auth } = await supa.auth.getUser();
  const meId = auth.user?.id ?? null;

  const scored = (rows ?? []).map(r => {
    const picks: BracketPicks = {
      group_order: r.group_order ?? {},
      best_third: r.best_third ?? [],
      knockout: r.knockout ?? {},
      tiebreak_goals: r.tiebreak_goals ?? null,
      final_score: r.final_score ?? null,
      top_scorer: r.top_scorer ?? null,
      top_scoring_team: r.top_scoring_team ?? null,
    };
    const result = scoreBracket(picks, actual);
    const prof = profileMap[r.user_id as string];
    return {
      userId: r.user_id as string,
      name: prof?.display_name ?? 'Anonymous',
      champion: picks.knockout['F'] ?? null,
      score: result.score,
      correctChamp: result.correctChamp,
      finalScore: picks.final_score,
      finalScoreDistance: result.finalScoreDistance,
      exactFinalScore: result.exactFinalScore,
      correctTopScorer: result.correctTopScorer,
      correctTopScoringTeam: result.correctTopScoringTeam,
      picks: picksCount(picks),
    };
  });

  // Tiebreaker chain: score → correct champion → exact final score →
  // closest final score → top scorer → top scoring team
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aC = a.correctChamp ? 1 : 0, bC = b.correctChamp ? 1 : 0;
    if (aC !== bC) return bC - aC;
    const aE = a.exactFinalScore ? 1 : 0, bE = b.exactFinalScore ? 1 : 0;
    if (aE !== bE) return bE - aE;
    // Closer final-score distance ranks higher; nulls sort last
    const aD = a.finalScoreDistance ?? 999, bD = b.finalScoreDistance ?? 999;
    if (aD !== bD) return aD - bD;
    const aS = a.correctTopScorer ? 1 : 0, bS = b.correctTopScorer ? 1 : 0;
    if (aS !== bS) return bS - aS;
    const aT = a.correctTopScoringTeam ? 1 : 0, bT = b.correctTopScoringTeam ? 1 : 0;
    if (aT !== bT) return bT - aT;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil((count ?? scored.length) / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">Leaderboard</h1>
          <p className="hint">
            {gradingStarted
              ? `Scores reflect actual results so far. Max possible: ${MAX_SCORE}`
              : `Tournament hasn’t started — all scores are 0. Max possible: ${MAX_SCORE}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <form className="flex gap-2">
            <input
              className="input !w-60"
              placeholder="Search players…"
              name="q"
              defaultValue={search}
            />
            <button className="btn">Search</button>
          </form>
        </div>
      </div>

      <div className="card !p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[#0f1627] text-inkdim">
            <tr>
              <th className="px-3 py-2 text-left w-14">#</th>
              <th className="px-3 py-2 text-left">Player</th>
              <th className="px-3 py-2 text-left hidden sm:table-cell">Champion pick</th>
              <th className="px-3 py-2 text-right w-24">Score</th>
              <th className="px-3 py-2 text-right w-24 hidden md:table-cell">Picks</th>
              <th className="px-3 py-2 text-right w-20 hidden md:table-cell">Final</th>
              <th className="px-3 py-2 text-right w-24">View</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((r, i) => {
              const rank = from + i + 1;
              const isMe = r.userId === meId;
              const fs = r.finalScore;
              const fsLabel = fs
                ? (fs.home === fs.away ? `${fs.home}-${fs.away} (PK)` : `${fs.home}-${fs.away}`)
                : '—';
              return (
                <tr key={r.userId} className={`border-t border-line ${isMe ? 'bg-[#14243d]' : ''}`}>
                  <td className="px-3 py-2 font-extrabold text-accent">{rank}</td>
                  <td className="px-3 py-2">
                    <strong>{r.name}</strong>
                    {isMe && <span className="chip ml-2">You</span>}
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    {r.champion ? <span className={r.correctChamp ? 'text-accent2 font-semibold' : ''}>{r.champion}</span> : <span className="text-inkdim italic">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">{r.score}</td>
                  <td className="px-3 py-2 text-right hidden md:table-cell text-inkdim">{r.picks.total}/{r.picks.max}</td>
                  <td className={`px-3 py-2 text-right hidden md:table-cell font-mono ${r.exactFinalScore ? 'text-accent2 font-bold' : 'text-inkdim'}`}>{fsLabel}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/b/${r.userId}`} className="text-accent font-semibold hover:underline">View</Link>
                  </td>
                </tr>
              );
            })}
            {scored.length === 0 && (
              <tr><td colSpan={7} className="text-center text-inkdim py-8">No brackets found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }).slice(0, 20).map((_, idx) => {
            const p = idx + 1;
            return (
              <Link
                key={p}
                href={`/leaderboard?page=${p}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
                className={`btn !py-1 !px-3 ${p === page ? 'btn-primary' : ''}`}
              >
                {p}
              </Link>
            );
          })}
          {totalPages > 20 && (
            <form className="flex gap-2 items-center">
              <input className="input !w-16 !py-1" name="page" placeholder={`…${totalPages}`} type="number" min={1} max={totalPages} defaultValue={page}/>
              <button className="btn !py-1 !px-3">Go</button>
            </form>
          )}
        </div>
      )}

      <p className="text-xs text-inkdim text-center">
        {count ?? scored.length} brackets · Max possible score: {MAX_SCORE}
      </p>
    </div>
  );
}
