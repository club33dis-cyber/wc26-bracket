-- ================================================================
-- Migration 002 — Final-score prediction + side bets
--
-- Adds three new fields to brackets and actual_results, all nullable
-- so existing rows aren't disturbed. Run this in Supabase Dashboard →
-- SQL Editor → New Query.
-- ================================================================

-- BRACKETS additions ----------------------------------------------
alter table public.brackets
  add column if not exists final_score      jsonb,                                                 -- { home: int, away: int }
  add column if not exists top_scorer       text,                                                  -- player name
  add column if not exists top_scoring_team text;                                                  -- team name

-- Optional sanity check on final_score shape
alter table public.brackets
  drop constraint if exists final_score_shape;
alter table public.brackets
  add constraint final_score_shape check (
    final_score is null or (
      jsonb_typeof(final_score) = 'object'
      and jsonb_typeof(final_score -> 'home') = 'number'
      and jsonb_typeof(final_score -> 'away') = 'number'
      and (final_score ->> 'home')::int between 0 and 20
      and (final_score ->> 'away')::int between 0 and 20
    )
  );

-- ACTUAL_RESULTS additions ----------------------------------------
alter table public.actual_results
  add column if not exists final_score      jsonb,
  add column if not exists top_scorer       text,
  add column if not exists top_scoring_team text;

alter table public.actual_results
  drop constraint if exists actual_final_score_shape;
alter table public.actual_results
  add constraint actual_final_score_shape check (
    final_score is null or (
      jsonb_typeof(final_score) = 'object'
      and jsonb_typeof(final_score -> 'home') = 'number'
      and jsonb_typeof(final_score -> 'away') = 'number'
    )
  );

-- Note: tiebreak_goals is preserved on brackets for backward compat,
-- but the app no longer reads it. Safe to drop after the tournament.
