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
  } : defaultPicks();
  const gradingStarted = !!actualRow && Object.keys(actualRow.knockout ?? {}).length > 0;

  // Strategy: fetch brackets + profiles joined, ordered by score desc (pre-computed server-side at
  // save time), then re-score here in JS for accuracy.
  //   We pre-sort by denormalized `score` col, then re-score the page for display. If the actual
  //   results have changed since last save, the ordering may be a little stale but will correct
  //   on next admin save via the /admin page.
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supa
    .from('brackets')
    .select('user_id, group_order, best_third, knockout, tiebreak_goals, score, updated_at, profiles!inner(display_name, email)', { count: 'exact' })
    .order('score', { ascending: false })
    .order('updated_at', { ascending: true });

  if (search) {
    query = query.ilike('profiles.display_name', `%${search}%`);
  }

  const { data: rows, count } = await query.range(from, to);

  // Currently logged-in user, if any
  const { data: auth } = await supa.auth.getUser();
  const meId = auth.user?.id ?? null;

  const scored = (rows ?? []).map(r => {
    const picks: BracketPicks = {
      group_order: r.group_order ?? {},
      best_third: r.best_third ?? [],
      knockout: r.knockout ?? {},
      tiebreak_goals: r.tiebreak_goals ?? null,
    };
    const { score, correctChamp } = scoreBracket(picks, actual);
    const prof = (r as any).profiles;
    return {
      userId: r.user_id as string,
      name: (prof?.display_name as string) ?? 'Anonymous',
      champion: picks.knockout['F'] ?? null,
      score,
      correctChamp,
      tb: picks.tiebreak_goals,
      picks: picksCount(picks),
    };
  });

  // Ensure sort reflects *real* score (not stale denormalized), plus tie-breakers.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.correctChamp ? 1 : 0) !== (a.correctChamp ? 1 : 0)) return (b.correctChamp ? 1 : 0) - (a.correctChamp ? 1 : 0);
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil((count ?? scored.length) / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">Leaderboard</h1>
          <p className="hint">
            {gradingStarted ? 'Scores reflect actual results so far.' : 'Tournament hasn’t started — all scores are 0. Max possible: ' + MAX_SCORE}
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
              <th className="px-3 py-2 text-right w-16 hidden md:table-cell">TB</th>
              <th className="px-3 py-2 text-right w-24">View</th>
            </tr>
          </thead>
          <tbody>
            {scored.map((r, i) => {
              const rank = from + i + 1;
              const isMe = r.userId === meId;
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
                  <td className="px-3 py-2 text-right hidden md:table-cell text-inkdim">{r.tb ?? '—'}</td>
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
