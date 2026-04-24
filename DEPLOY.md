# Deployment Guide — World Cup 2026 Bracket Challenge

This gets you from zero to a live public URL in about 30 minutes. Total cost: $0 on free tiers.

## What you'll need

- A GitHub account (free)
- A Supabase account (free) — https://supabase.com
- A Vercel account (free) — https://vercel.com
- Node.js 18+ installed locally (only for testing before deploy; not strictly required)

---

## Step 1 — Create a Supabase project (5 min)

1. Go to https://supabase.com and click **New project**
2. Project name: `wc26-bracket` (or anything)
3. Database password: pick a strong one, save it somewhere
4. Region: choose one close to where most of your users are (e.g. `us-east-1` if US, `eu-west-1` if Europe)
5. Pricing plan: **Free**
6. Wait ~2 minutes for the project to spin up

### Disable email confirmation (recommended for casual pools)

1. In the project sidebar → **Authentication** → **Providers** → **Email**
2. Turn OFF **"Confirm email"** so users can log in immediately after signup
3. Click **Save**

If you leave email confirmation on, each user must click a link in a verification email before they can edit their bracket. Fine either way, but requires SMTP config to be reliable at scale.

### Run the schema

1. In the project sidebar → **SQL Editor** → **New query**
2. Open `supabase/schema.sql` from this repo
3. Paste the entire contents into the editor
4. Click **Run**
5. You should see success messages — the `profiles`, `brackets`, `actual_results`, `settings` tables exist now, along with RLS policies and the auto-create-profile trigger

### Grab your keys

1. In the project sidebar → **Project Settings** (gear icon) → **API**
2. Copy these three values somewhere safe — you'll paste them into Vercel later:

| Value | What it is | Sensitive? |
| --- | --- | --- |
| **Project URL** | `https://xxxxx.supabase.co` | Public, safe |
| **anon public key** | long `eyJhb…` string | Public, safe |
| **service_role key** | long `eyJhb…` string (scroll down in API settings) | **SECRET — never commit or expose** |

---

## Step 2 — Push the code to GitHub (5 min)

1. Create a new **private** GitHub repo, e.g. `wc26-bracket`
2. In this project folder:
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/wc26-bracket.git
   git push -u origin main
   ```

---

## Step 3 — Deploy to Vercel (5 min)

1. Go to https://vercel.com/new and click **Import Git Repository**
2. Pick the repo you just created
3. Framework: Vercel should auto-detect **Next.js** — leave defaults
4. **Environment variables** — click "Add more" and add all of these:

   | Name | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | The service_role key ← **mark as "Secret"** |
   | `ADMIN_EMAILS` | Your email (e.g., `club33dis@gmail.com`). Comma-separate to add more admins. |
   | `NEXT_PUBLIC_LOCK_AT_ISO` | `2026-06-11T22:00:00Z` (default: first kickoff) |
   | `CRON_SECRET` | Random string (e.g., `openssl rand -hex 32`). Used only if you hit the cron endpoint manually. Vercel Cron itself doesn't need it. |

5. Click **Deploy**
6. Wait ~90 seconds for the first build
7. Vercel gives you a URL like `https://wc26-bracket-xyz.vercel.app` — **this is the link you share with your 1000 people**

---

## Step 4 — Create your admin account & test (5 min)

1. Open the Vercel URL
2. Click **Sign up**, create an account with the email you set in `ADMIN_EMAILS`
3. You should land on `/bracket` and see the empty bracket
4. Fill in a few picks — they auto-save
5. Click the **Admin** link in the top nav (only visible to admin emails)
6. This is where you'll enter actual results during the tournament

Do a dry run: set some fake results, hit **Save results & rescore all brackets**, then go to `/leaderboard` and verify scores look right.

---

## Step 5 — Share the link

Once you're happy, send this to your players:

> "Join our World Cup 2026 bracket challenge: https://your-vercel-url. Free, no money, just bragging rights. Sign up, fill in your bracket before June 11 kickoff, and the leaderboard updates live as matches happen."

### Optional: custom domain

In Vercel → your project → **Settings** → **Domains**, add a domain like `wc26.yourdomain.com` and follow the DNS instructions. Free with Vercel.

---

## During the tournament — auto-updates (no admin clicks)

Results update themselves. Every 5 minutes, Vercel Cron hits `/api/cron/sync-results`, which:

1. Fetches the public [openfootball/worldcup.json](https://github.com/openfootball/worldcup.json) feed
2. Computes group standings from finished group-stage matches
3. Identifies the 8 best 3rd-placers by FIFA tie-breakers
4. Records knockout winners (handles extra-time + penalties when present)
5. Rescores every bracket in the pool

You'll see the cron job in Vercel → your project → **Settings** → **Cron Jobs**.

### Manual override

If the openfootball feed is lagging and you want to enter a result yourself, you can still use `/admin` — it does the same thing but with your manual input. Any value you enter there will be overwritten on the next cron run unless you disable the cron first.

To disable the cron temporarily, remove `vercel.json` or delete the cron in the Vercel UI.

### Checking cron health

- Vercel → Deployments → your latest → **Functions** → `/api/cron/sync-results` → check recent invocations
- A successful run returns `{ "ok": true, "rescored": 123, "actualSummary": {...} }`
- If `openfootball fetch failed`, the GitHub CDN may be briefly unavailable — it'll retry 5 min later automatically

---

## Scaling notes

Supabase's free tier gives you:
- 500 MB database (plenty for 10,000+ users)
- 50,000 monthly active auth users
- 5 GB egress/month

For a 1000-person pool with a month of light traffic, you will not come close to any of these limits.

Vercel's free tier gives you:
- 100 GB/month bandwidth
- Unlimited invocations on free

Also fine for 1000 users.

If you hit limits (e.g. 10,000+ players), bump to Supabase Pro ($25/mo) and you're good.

## Troubleshooting

**"New user couldn't sign up"** — Check Auth → Email providers is enabled.

**"I signed up but don't see the Admin link"** — Your email isn't in `ADMIN_EMAILS`. Update the env var in Vercel → redeploy (Vercel → Deployments → ⋮ → Redeploy).

**"Picks aren't saving"** — Open browser devtools → Network tab. Look for 401 or 403 from Supabase. Most likely cause: the user's email isn't confirmed (see Step 1), or the bracket is already locked (check `NEXT_PUBLIC_LOCK_AT_ISO`).

**"Admin rescore endpoint returns 500"** — You forgot to set `SUPABASE_SERVICE_ROLE_KEY` in Vercel, or pasted the wrong value. Double-check.

**"Leaderboard is slow with lots of users"** — The schema includes `brackets_score_idx`. If you somehow dropped it, re-run the schema SQL. For 10k+ users, consider materializing the leaderboard as a view and refreshing it on admin save.

**"I want to test before the real tournament"** — Temporarily set `NEXT_PUBLIC_LOCK_AT_ISO` to some past date (e.g. `2025-01-01T00:00:00Z`) to lock brackets and try the grading view, then revert.

Have fun. May the best bracket win.
