import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { formatCountdown, getLockAt } from '@/lib/lock';
import { MAX_SCORE } from '@/lib/bracket-data';

export const revalidate = 30;

export default async function Landing() {
  const supa = createSupabaseServerClient();
  const { data: stats } = await supa.from('pool_stats').select('*').single();
  const { data: auth } = await supa.auth.getUser();
  const signedIn = !!auth.user;

  const lockAt = getLockAt();
  const msLeft = lockAt.getTime() - Date.now();
  const countdown = formatCountdown(msLeft);

  return (
    <div className="space-y-10">
      <section className="grid md:grid-cols-2 gap-8 items-center">
        <div>
          <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
            Pick every match. <br />
            <span className="text-accent">Beat your friends.</span>
          </h1>
          <p className="hint text-base mt-4 max-w-lg">
            A March Madness-style bracket for the 2026 FIFA World Cup — 48 teams, 12 groups, and a brand-new Round of 32.
            Pick winners, earn points, climb the leaderboard. Free, no ads, bragging rights only.
          </p>
          <div className="flex gap-3 mt-6">
            {signedIn ? (
              <Link href="/bracket" className="btn btn-primary text-base">Edit my bracket →</Link>
            ) : (
              <>
                <Link href="/signup" className="btn btn-primary text-base">Sign up to play</Link>
                <Link href="/login" className="btn text-base">I already have an account</Link>
              </>
            )}
            <Link href="/leaderboard" className="btn btn-ghost text-base">See who&apos;s in</Link>
          </div>
          <p className="text-xs text-inkdim mt-3">
            Brackets lock at first kickoff · {lockAt.toUTCString().replace(':00 GMT',' UTC')}
          </p>
        </div>
        <div className="card">
          <div className="text-xs text-inkdim uppercase tracking-wider font-bold">Pool status</div>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div>
              <div className="text-3xl font-extrabold text-accent">{stats?.signups ?? 0}</div>
              <div className="text-xs text-inkdim uppercase tracking-wider">Signed up</div>
            </div>
            <div>
              <div className="text-3xl font-extrabold text-accent2">{stats?.brackets_submitted ?? 0}</div>
              <div className="text-xs text-inkdim uppercase tracking-wider">Brackets in</div>
            </div>
            <div>
              <div className="text-3xl font-extrabold text-ink">{MAX_SCORE}</div>
              <div className="text-xs text-inkdim uppercase tracking-wider">Max possible score</div>
            </div>
            <div>
              <div className="text-2xl font-extrabold text-ink">{countdown}</div>
              <div className="text-xs text-inkdim uppercase tracking-wider">Until lock</div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 className="section-h">How it works <span className="chip">4 steps</span></h2>
        <div className="grid md:grid-cols-4 gap-4">
          {[
            { n: '1', t: 'Sign up', b: 'Email + password. Takes 20 seconds.' },
            { n: '2', t: 'Rank every group', b: 'Predict who finishes 1st–4th in each of the 12 groups, and pick 8 of 12 third-place teams to advance.' },
            { n: '3', t: 'Fill in the knockout', b: 'Click winners through Round of 32, R16, Quarters, Semis, 3rd-place match, and Final.' },
            { n: '4', t: 'Earn points', b: 'Points double each round. A wrong R32 pick costs 10. Picking the champion? 160.' },
          ].map(s => (
            <div key={s.n} className="card">
              <div className="text-accent text-2xl font-extrabold">{s.n}</div>
              <div className="font-bold mt-1">{s.t}</div>
              <p className="hint mt-1">{s.b}</p>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="section-h">Scoring <span className="chip">ESPN-style doubling</span></h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { p: '+5',  l: 'Per correct group advancer (top 2)' },
            { p: '+3',  l: 'Per correct best-3rd pick' },
            { p: '+10', l: 'Round of 32 winner' },
            { p: '+20', l: 'Round of 16 winner' },
            { p: '+40', l: 'Quarterfinal winner' },
            { p: '+80', l: 'Semifinal winner' },
            { p: '+40', l: '3rd-place match winner' },
            { p: '+160', l: 'Final winner (Champion)' },
          ].map(x => (
            <div key={x.l} className="card !p-3">
              <div className="text-xl font-extrabold text-accent">{x.p}</div>
              <div className="text-xs text-inkdim">{x.l}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
