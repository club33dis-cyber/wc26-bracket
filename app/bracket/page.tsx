import { redirect } from 'next/navigation';
import Link from 'next/link';
import BracketEditor from '@/components/BracketEditor';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { defaultPicks, BracketPicks } from '@/lib/bracket-data';
import { isLocked, getLockAt } from '@/lib/lock';

export const dynamic = 'force-dynamic';

export default async function MyBracketPage() {
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect('/login?next=/bracket');

  // Load this user's existing bracket
  const { data: rows } = await supa.from('brackets').select('*').eq('user_id', user.id).maybeSingle();

  const initialPicks: BracketPicks = rows
    ? {
        group_order: rows.group_order ?? defaultPicks().group_order,
        best_third: rows.best_third ?? [],
        knockout: rows.knockout ?? {},
        tiebreak_goals: rows.tiebreak_goals ?? null,
      }
    : defaultPicks();

  // Actual results for grading
  const { data: actualRow } = await supa.from('actual_results').select('*').eq('id', 1).maybeSingle();
  const actual: BracketPicks | null = actualRow
    ? {
        group_order: actualRow.group_order ?? {},
        best_third: actualRow.best_third ?? [],
        knockout: actualRow.knockout ?? {},
        tiebreak_goals: null,
      }
    : null;

  const locked = isLocked();
  const lockAt = getLockAt();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-extrabold">My bracket</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Link href="/leaderboard" className="btn">View leaderboard</Link>
          {locked
            ? <span className="chip !bg-[#3d1618] !border-[#6a1c22] !text-[#ffbdc1]">Locked at kickoff</span>
            : <span className="chip">Unlocks at {lockAt.toUTCString().replace(':00 GMT', ' UTC')}</span>}
        </div>
      </div>
      <BracketEditor
        initialPicks={initialPicks}
        actual={actual}
        userId={user.id}
        locked={locked}
      />
    </div>
  );
}
