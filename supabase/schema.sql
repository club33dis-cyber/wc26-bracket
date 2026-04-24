-- ================================================================
-- 2026 FIFA World Cup Bracket Pool — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → "New query"
-- Designed for ~1000+ concurrent users on a free-tier project.
-- ================================================================

-- 1) PROFILES ----------------------------------------------------
-- One row per user; auto-created by trigger when a user signs up.
create table if not exists public.profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email       text not null,
  created_at  timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Anyone logged in can read all profiles (needed for public leaderboard).
drop policy if exists "profiles readable by authed" on public.profiles;
create policy "profiles readable by authed"
  on public.profiles for select
  to authenticated using (true);

-- Anyone (even unauthed) can read names for public leaderboard.
drop policy if exists "profiles readable by anon" on public.profiles;
create policy "profiles readable by anon"
  on public.profiles for select
  to anon using (true);

-- Users can only update their own profile.
drop policy if exists "own profile write" on public.profiles;
create policy "own profile write"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2) BRACKETS ----------------------------------------------------
-- One bracket per user. Picks are stored as JSON for flexibility.
create table if not exists public.brackets (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  -- group_order[grp] = array of 4 team names in user's predicted finishing order
  group_order   jsonb not null default '{}'::jsonb,
  -- best_third   = array of up to 8 group letters whose 3rd-placer advances
  best_third    jsonb not null default '[]'::jsonb,
  -- knockout     = map of matchId -> winning team name (e.g. {"M1":"Brazil","F":"Argentina"})
  knockout      jsonb not null default '{}'::jsonb,
  tiebreak_goals smallint check (tiebreak_goals is null or (tiebreak_goals between 0 and 99)),
  score         int  not null default 0,     -- denormalized, recomputed on /admin save
  correct_champ boolean not null default false,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
alter table public.brackets enable row level security;
create index if not exists brackets_score_idx on public.brackets(score desc);

-- Lock timestamp helper -------------------------------------------
-- Brackets can only be written BEFORE the lock time.
-- Lock time is stored in public.settings.singleton row.
create table if not exists public.settings (
  id int primary key default 1,
  lock_at timestamptz not null default '2026-06-11T22:00:00Z',
  first_match_kickoff timestamptz not null default '2026-06-11T22:00:00Z',
  updated_at timestamptz not null default now(),
  constraint one_row check (id = 1)
);
insert into public.settings(id) values (1) on conflict do nothing;
alter table public.settings enable row level security;

drop policy if exists "settings readable by all" on public.settings;
create policy "settings readable by all"
  on public.settings for select to anon, authenticated using (true);

-- Only service role can update settings (done from /admin via service key).
-- Default policies disallow writes from anon/authenticated, which is what we want.

-- Bracket RLS -----------------------------------------------------

-- Anyone (even anon) can read all brackets — public leaderboard + public view pages.
drop policy if exists "brackets readable by all" on public.brackets;
create policy "brackets readable by all"
  on public.brackets for select
  to anon, authenticated using (true);

-- Users can insert/update their own bracket while it's NOT locked.
drop policy if exists "own bracket write pre-lock" on public.brackets;
create policy "own bracket write pre-lock"
  on public.brackets for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and (select now() < lock_at from public.settings where id = 1)
  );

drop policy if exists "own bracket update pre-lock" on public.brackets;
create policy "own bracket update pre-lock"
  on public.brackets for update
  to authenticated
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and (select now() < lock_at from public.settings where id = 1)
  );

-- No deletes from users.

-- 3) ACTUAL RESULTS (singleton) ----------------------------------
-- Same shape as a bracket. Only admins write here (via service key).
create table if not exists public.actual_results (
  id int primary key default 1,
  group_order jsonb not null default '{}'::jsonb,
  best_third  jsonb not null default '[]'::jsonb,
  knockout    jsonb not null default '{}'::jsonb,
  champ_tournament_goals smallint,  -- used as tiebreaker
  updated_at timestamptz not null default now(),
  constraint one_row_actual check (id = 1)
);
insert into public.actual_results(id) values (1) on conflict do nothing;
alter table public.actual_results enable row level security;

drop policy if exists "actuals readable by all" on public.actual_results;
create policy "actuals readable by all"
  on public.actual_results for select to anon, authenticated using (true);
-- Writes to actual_results happen via service role only (no RLS policy needed).

-- 4) AUTO-CREATE PROFILE ON SIGNUP -------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 5) UTIL: bracket count view (for landing page hero) ------------
create or replace view public.pool_stats as
  select
    (select count(*) from public.brackets) as brackets_submitted,
    (select count(*) from public.profiles) as signups,
    (select lock_at from public.settings where id = 1) as lock_at,
    (select (now() < lock_at) from public.settings where id = 1) as locked_already_not;

grant select on public.pool_stats to anon, authenticated;
