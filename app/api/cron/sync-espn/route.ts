import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { scoreBracket } from '@/lib/scoring';
import { BracketPicks } from '@/lib/bracket-data';
import { buildActualFromEspn } from '@/lib/espn/sync';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // seconds; ESPN scoreboard loops ~40 days, parallelized

/**
 * Nightly ESPN cron — fetches every tournament-date scoreboard from
 * site.api.espn.com/.../soccer/fifa.world, derives the actual_results
 * state, merges with anything the openfootball cron or admin already
 * set, then rescores every bracket.
 *
 * Schedule: `0 9 * * *` (4am Eastern). See vercel.json.
 *
 * Manual trigger (admin):
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *        https://your-site.vercel.app/api/cron/sync-espn
 */
export async function GET(req: Request) {
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

  // 1. Fetch + parse ESPN
  let espnActual: BracketPicks;
  try {
    espnActual = await buildActualFromEspn();
  } catch (e: any) {
    return NextResponse.json({ error: 'ESPN fetch failed: ' + (e?.message ?? e) }, { status: 502 });
  }

  // 2. Merge with existing actual_results. ESPN wins on group_order/knockout/etc.
  // when it has data; otherwise we keep whatever openfootball or the admin set.
  const { data: existing } = await admin
    .from('actual_results')
    .select('group_order, best_third, knockout, final_score, top_scorer, top_scoring_team')
    .eq('id', 1)
    .maybeSingle();

  function nonEmpty<T>(v: T, fallback: T): T {
    if (v == null) return fallback;
    if (Array.isArray(v) && v.length === 0) return fallback;
    if (typeof v === 'object' && v !== null && Object.keys(v as any).length === 0) return fallback;
    return v;
  }

  const merged: BracketPicks = {
    group_order:      nonEmpty(espnActual.group_order, existing?.group_order ?? {}),
    best_third:       nonEmpty(espnActual.best_third,  existing?.best_third ?? []),
    knockout:         { ...(existing?.knockout ?? {}), ...espnActual.knockout },
    tiebreak_goals:   null,
    final_score:      espnActual.final_score      ?? existing?.final_score      ?? null,
    top_scorer:       espnActual.top_scorer       ?? existing?.top_scorer       ?? null,
    top_scoring_team: espnActual.top_scoring_team ?? existing?.top_scoring_team ?? null,
  };

  const { error: upErr } = await admin.from('actual_results').upsert({
    id: 1,
    group_order:      merged.group_order,
    best_third:       merged.best_third,
    knockout:         merged.knockout,
    final_score:      merged.final_score,
    top_scorer:       merged.top_scorer,
    top_scoring_team: merged.top_scoring_team,
    updated_at: new Date().toISOString(),
  });
  if (upErr) return NextResponse.json({ error: 'actual_results upsert: ' + upErr.message }, { status: 500 });

  // 3. Rescore every bracket
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
      const { score, correctChamp } = scoreBracket(picks, merged);
      await admin.from('brackets')
        .update({ score, correct_champ: correctChamp })
        .eq('user_id', r.user_id);
    }
    rescored += rows.length;
    if (rows.length < pageSize) break;
    from += pageSize;
  }

  return NextResponse.json({
    ok: true,
    source: 'espn',
    rescored,
    summary: {
      groupsDetermined: Object.keys(merged.group_order ?? {}).length,
      knockoutPicks: Object.keys(merged.knockout ?? {}).length,
      finalScore: merged.final_score,
      topScorer: merged.top_scorer,
      topScoringTeam: merged.top_scoring_team,
    },
  });
}
