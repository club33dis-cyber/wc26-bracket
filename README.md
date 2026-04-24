# World Cup 2026 Bracket Challenge

An ESPN March Madness–style bracket pool for the 2026 FIFA World Cup. Scales to 1000+ users on the free tiers of Supabase and Vercel. **Auto-updates results from a public live-data feed** — zero admin clicks during the tournament.

## What it does

- Public landing page with signup / login (email + password)
- Each user fills a single bracket: 12 groups, 8 best-3rd-place picks, full 32-team knockout
- Auto-save as picks are made — everything syncs to Supabase in the background
- Global leaderboard with pagination + search (fast even at 1000+ users)
- Each bracket has a public URL at `/b/[user-id]` for sharing
- Admin-only "actual results" override page (only needed if auto-sync is disabled)
- **Auto-fetches live results every 5 minutes from `openfootball/worldcup.json`** and rescores all brackets
- Brackets lock automatically at first kickoff (RLS enforces — not just a UI trick)

## Scoring — ESPN-style, team-based

| Pick | Points |
| --- | --- |
| Group advancer (top 2) | 5 each |
| Best 3rd-place pick | 3 each |
| Team advances past R32 | 10 each |
| Team advances past R16 | 20 each |
| Team advances past QF | 40 each |
| Team advances past SF | 80 each |
| 3rd-place match winner | 40 |
| Champion | 160 |

**Max possible score: 984 points.**

### Why team-based instead of slot-based?

Standard bracket scoring says "did you pick Germany to win the match in slot M2?". That breaks with FIFA's 495-combination 3rd-place matrix, because the *same team* can end up in *different R32 slots* depending on which groups provide the 3rd-placers. To dodge that pitfall, this pool scores like March Madness: **each round, you get points for every team you picked to advance that actually did**. Slot assignments don't matter — only whether your teams survived.

Tiebreakers in order: total score → picked real champion → closest guess of champion's total tournament goals (set on your bracket) → earliest submission.

## FIFA-accurate bracket structure

The R32 bracket matches FIFA's published Final Draw structure:

- **8 matches**: Group winner vs 3rd-placer — each winner has an eligibility list of groups whose 3rd-placers can play them. Example: Winner of Group E can only face 3rd-placers from groups A, B, C, D, or F (never its own group).
- **4 matches**: Winner vs runner-up crosses — `W-C vs RU-F`, `W-F vs RU-C`, `W-H vs RU-J`, `W-J vs RU-H`.
- **4 matches**: Runner-up vs runner-up — `RU-A vs RU-B`, `RU-D vs RU-G`, `RU-E vs RU-I`, `RU-K vs RU-L`.

The 3rd-place assignment algorithm solves the bipartite matching problem with backtracking for each of the 495 possible group subsets. All 495 combinations produce valid assignments that respect FIFA's per-slot eligibility constraints — verified.

## Tech stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Postgres + auth + RLS)
- Tailwind CSS
- Vercel + Vercel Cron
- openfootball/worldcup.json (public domain, no API key)

## Getting it running

Full instructions in [DEPLOY.md](./DEPLOY.md). Short version:

```bash
# 1. Create a Supabase project at https://supabase.com
# 2. Paste supabase/schema.sql into the SQL editor → Run
# 3. Copy .env.example to .env.local and fill in your keys
cp .env.example .env.local
# 4. Install and run
npm install
npm run dev
```

Then deploy to Vercel (push to GitHub, click "Import Project"). The cron job is configured in `vercel.json` and starts running automatically.

## Architecture

### Schema (see `supabase/schema.sql`)

- `profiles` — one row per signed-up user (auto-created by trigger)
- `brackets` — one row per user, with denormalized `score` column indexed for fast leaderboard sort
- `actual_results` — singleton (id=1) holding truth; written by cron/admin via service role
- `settings` — singleton holding the lock time

RLS guarantees:
- Anyone (anon) can read brackets + actual results → cheap public leaderboard
- Users can only write their own bracket, and only before `settings.lock_at`
- Actual results only writable via service role (cron + admin API)

### Auto-results flow

1. Vercel Cron hits `/api/cron/sync-results` every 5 minutes (`*/5 * * * *`)
2. Endpoint fetches `openfootball/worldcup.json` (GitHub raw URL)
3. Parses all finished matches → constructs group standings + knockout winners
4. Upserts the `actual_results` singleton
5. Rescores every bracket in pages of 500
6. Leaderboard reflects new scores within seconds

### Scale notes

- Leaderboard pages of 50 rows with `order by score desc` hitting the index
- Score denormalization updated on every cron save, not per-request
- Free tiers comfortably handle 1000+ users; add Supabase Pro ($25/mo) if you hit 10k+

## Sharing

Once deployed at `https://your-pool.vercel.app`:
1. Share the URL in email/Slack/text
2. Anyone can sign up
3. Cron keeps results current — you don't have to touch the admin panel

## Limitations

- **Single pool per deploy.** Add a `pools` table + `pool_id` FK for multi-pool.
- **Email verification** — on by default in Supabase. Turn off in Auth settings for frictionless signup at casual-pool scale.
- **No password-reset UI.** Supabase supports it; wire up a `/reset` page if needed.
- **openfootball update lag.** Data is refreshed by community contributors, typically within a couple of hours of a match ending. For near-real-time, swap to a paid API in `lib/openfootball/sync.ts`.
- **R32 bracket tree** is a reasonable tree organization; the R32 *matchups* are FIFA-accurate, but if FIFA changes the tree pairings (which R32 match feeds into which R16), update `R16_MATCHES` in `lib/bracket-data.ts`. Team-based scoring means this rarely affects the points total.
