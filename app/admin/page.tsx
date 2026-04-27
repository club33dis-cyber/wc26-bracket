import { redirect } from 'next/navigation';
import Link from 'next/link';
import AdminResultsEditor from '@/components/AdminResultsEditor';
import { createSupabaseServerClient, isAdminUser } from '@/lib/supabase-server';
import { defaultPicks, BracketPicks } from '@/lib/bracket-data';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect('/login?next=/admin');
  if (!(await isAdminUser())) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <h1 className="text-2xl font-extrabold">Admin only</h1>
        <p className="hint mt-2">
          Only the pool admin can enter actual results. If this should be you, add your email to the
          <code className="mx-1 px-1 bg-panel2 rounded text-ink">ADMIN_EMAILS</code> env var and redeploy.
        </p>
        <div className="mt-6"><Link href="/" className="btn btn-primary">Home</Link></div>
      </div>
    );
  }

  const { data: actualRow } = await supa.from('actual_results').select('*').eq('id', 1).maybeSingle();
  const initial: BracketPicks = actualRow
    ? {
        group_order: actualRow.group_order ?? defaultPicks().group_order,
        best_third: actualRow.best_third ?? [],
        knockout: actualRow.knockout ?? {},
        tiebreak_goals: null,
        final_score: actualRow.final_score ?? null,
        top_scorer: actualRow.top_scorer ?? null,
        top_scoring_team: actualRow.top_scoring_team ?? null,
      }
    : defaultPicks();

  // Counts
  const { count: bracketCount } = await supa.from('brackets').select('*', { count: 'exact', head: true });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Admin · Actual results</h1>
          <p className="hint">{bracketCount ?? 0} brackets in the pool. Enter real-world results as the tournament progresses; every bracket is rescored on save.</p>
        </div>
        <Link href="/leaderboard" className="btn">View leaderboard</Link>
      </div>
      <AdminResultsEditor initialResults={initial} champGoalsInit={actualRow?.champ_tournament_goals ?? null} />
    </div>
  );
}
