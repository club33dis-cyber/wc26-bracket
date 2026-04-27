import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scoreBracket } from '@/lib/scoring';
import { BracketPicks } from '@/lib/bracket-data';
import { buildActualFromOpenFootball, fetchOpenFootball } from '@/lib/openfootball/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // seconds (Vercel default caps at 60 on Hobby)

/**
 * Cron endpoint — pulls the latest openfootball/worldcup.json, derives the
 * actual_results state, upserts it, and rescores every bracket.
 *
 * Called automatically by Vercel Cron on the schedule in vercel.json.
 *
 * Can also be called manually with:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://your-site.vercel.app/api/cron/sync-results
 */
export async function GET(req: Request) {
  // Vercel Cron adds an "x-vercel-cron" header OR we can require a shared secret
  // if the endpoint is ever hit from outside Vercel's cron service.
  const authHeader = req.headers.get('authorization') ?? '';
  const isVercelCron = req.headers.get('x-vercel-cron') === '1';
  const configured = process.env.CRON_SECRET;
  if (!isVercelCron) {
    if (!configured || authHeader !== `Bearer ${configured}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const serviceUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return NextResponse.json({ error: 'service role key missing' }, { status: 500 });
  const admin = createClient(serviceUrl, serviceKey, { auth: { persistSession: false } });

  // 1. Fetch + parse openfootball
  let raw;
  try {
    raw = await fetchOpenFootball();
  } catch (e: any) {
    return NextResponse.json({ error: 'openfootball fetch failed: ' + (e?.message ?? e) }, { status: 502 });
  }
  const actual = buildActualFromOpenFootball(raw);

  // 2. Upsert actual_results singleton (preserve admin-entered side bets if cron didn't compute them)
  const { data: existing } = await admin.from('actual_results').select('top_scorer, top_scoring_team, final_score').eq('id', 1).maybeSingle();
  const upsertPayload: any = {
    id: 1,
    group_order: actual.group_order,
    best_third: actual.best_third,
    knockout: actual.knockout,
    updated_at: new Date().toISOString(),
  };
  if (actual.final_score) upsertPayload.final_score = actual.final_score;
  else if (existing?.final_score) upsertPayload.final_score = existing.final_score;
  if (actual.top_scorer) upsertPayload.top_scorer = actual.top_scorer;
  else if (existing?.top_scorer) upsertPayload.top_scorer = existing.top_scorer;
  if (actual.top_scoring_team) upsertPayload.top_scoring_team = actual.top_scoring_team;
  else if (existing?.top_scoring_team) upsertPayload.top_scoring_team = existing.top_scoring_team;

  const { error: upErr } = await admin.from('actual_results').upsert(upsertPayload);
  if (upErr) return NextResponse.json({ error: 'actual_results upsert: ' + upErr.message }, { status: 500 });

  // Use the merged actual for rescoring
  const mergedActual: BracketPicks = {
    ...actual,
    final_score: upsertPayload.final_score ?? null,
    top_scorer: upsertPayload.top_scorer ?? null,
    top_scoring_team: upsertPayload.top_scoring_team ?? null,
  };

  // 3. Rescore all brackets (batched)
  let rescored = 0;
  const pageSize = 500;
  let from = 0;
  while (true) {
    const { data: rows, error } = await admin
      .from('brackets')
      .select('user_id, group_order, best_third, knockout, final_score, top_scorer, top_scoring_team')
      .range(from, from + pageSize - 1);
    if (error) return NextResponse.json({ error: 'bracket read: ' + error.message }, { status: 500 });
    if (!rows || rows.length === 0) break;

    for (const r of rows) {
      const picks: BracketPicks = {
        group_order: r.group_order ?? {},
        best_third: r.best_third ?? [],
        knockout: r.knockout ?? {},
        tiebreak_goals: null,
        final_score: r.final_score ?? null,
        top_scorer: r.top_scorer ?? null,
        top_scoring_team: r.top_scoring_team ?? null,
      };
      const { score, correctChamp } = scoreBracket(picks, mergedActual);
      await admin.from('brackets').update({ score, correct_champ: correctChamp }).eq('user_id', r.user_id);
    }
    rescored += rows.length;
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({
    ok: true,
    rescored,
    actualSummary: {
      groupsDetermined: Object.keys(actual.group_order).length,
      bestThird: actual.best_third,
      knockoutPicks: Object.keys(actual.knockout).length,
      champion: actual.knockout['F'] ?? null,
    },
  });
}
