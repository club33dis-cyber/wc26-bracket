import { notFound } from 'next/navigation';
import Link from 'next/link';
import BracketEditor from '@/components/BracketEditor';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { defaultPicks, BracketPicks } from '@/lib/bracket-data';

export const dynamic = 'force-dynamic';

export default async function PublicBracketPage({ params }: { params: { id: string } }) {
  const supa = createSupabaseServerClient();
  const { data: rows } = await supa
    .from('brackets')
    .select('*, profiles!inner(display_name)')
    .eq('user_id', params.id)
    .maybeSingle();
  if (!rows) notFound();

  const initialPicks: BracketPicks = {
    group_order: rows.group_order ?? defaultPicks().group_order,
    best_third: rows.best_third ?? [],
    knockout: rows.knockout ?? {},
    tiebreak_goals: rows.tiebreak_goals ?? null,
  };

  const { data: actualRow } = await supa.from('actual_results').select('*').eq('id', 1).maybeSingle();
  const actual: BracketPicks | null = actualRow ? {
    group_order: actualRow.group_order ?? {},
    best_third: actualRow.best_third ?? [],
    knockout: actualRow.knockout ?? {},
    tiebreak_goals: null,
  } : null;

  const displayName = (rows as any).profiles?.display_name ?? 'Bracket';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-extrabold">{displayName}&apos;s bracket</h1>
        <Link href="/leaderboard" className="btn">← Back to leaderboard</Link>
      </div>
      <BracketEditor
        initialPicks={initialPicks}
        actual={actual}
        userId={params.id}
        locked={true}
        readOnlyName={displayName}
      />
    </div>
  );
}
