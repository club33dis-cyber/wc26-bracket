import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isAdminUser } from '@/lib/supabase-server';
import { BracketPicks } from '@/lib/bracket-data';
import { scoreBracket } from '@/lib/scoring';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin-save-results
 * Body: { group_order, best_third, knockout, champ_tournament_goals }
 *
 * 1. Verifies caller is in ADMIN_EMAILS.
 * 2. Upserts the actual_results singleton.
 * 3. Pulls every bracket, rescores it, writes the new score back in batches.
 * 4. Returns { ok: true, rescored: N }.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY for the write + batch update (bypasses RLS).
 */
export async function POST(req: Request) {
  if (!(await isAdminUser())) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const group_order = body.group_order ?? {};
  const best_third = body.best_third ?? [];
  const knockout = body.knockout ?? {};
  const champ_tournament_goals = body.champ_tournament_goals ?? null;
  const final_score = body.final_score ?? null;
  const top_scorer = body.top_scorer ?? null;
  const top_scoring_team = body.top_scoring_team ?? null;

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!serviceKey) {
    return NextResponse.json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured on the server' }, { status: 500 });
  }
  const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  // 1. Save actual results
  const { error: upsertErr } = await admin.from('actual_results').upsert({
    id: 1, group_order, best_third, knockout, champ_tournament_goals,
    final_score, top_scorer, top_scoring_team,
    updated_at: new Date().toISOString(),
  });
  if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

  const actual: BracketPicks = {
    group_order, best_third, knockout, tiebreak_goals: null,
    final_score, top_scorer, top_scoring_team,
  };

  // 2. Rescore all brackets in pages of 500
  let rescored = 0;
  const pageSize = 500;
  let from = 0;
  while (true) {
    const { data: rows, error } = await admin
      .from('brackets')
      .select('user_id, group_order, best_third, knockout, final_score, top_scorer, top_scoring_team')
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!rows || rows.length === 0) break;

    const updates = rows.map(r => {
      const picks: BracketPicks = {
        group_order: r.group_order ?? {},
        best_third: r.best_third ?? [],
        knockout: r.knockout ?? {},
        tiebreak_goals: null,
        final_score: r.final_score ?? null,
        top_scorer: r.top_scorer ?? null,
        top_scoring_team: r.top_scoring_team ?? null,
      };
      const { score, correctChamp } = scoreBracket(picks, actual);
      return { user_id: r.user_id, score, correct_champ: correctChamp };
    });

    // Apply as individual updates (Supabase upsert is simpler here)
    for (const u of updates) {
      await admin.from('brackets')
        .update({ score: u.score, correct_champ: u.correct_champ })
        .eq('user_id', u.user_id);
    }
    rescored += updates.length;
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({ ok: true, rescored });
}
