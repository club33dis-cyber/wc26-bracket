import './globals.css';
import Link from 'next/link';
import { createSupabaseServerClient, isAdminUser } from '@/lib/supabase-server';

export const metadata = {
  title: 'World Cup 2026 Bracket Challenge',
  description: 'ESPN-style bracket pool for the 2026 FIFA World Cup.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supa = createSupabaseServerClient();
  const { data } = await supa.auth.getUser();
  const user = data.user;
  const admin = await isAdminUser();

  let displayName: string | null = null;
  if (user) {
    const { data: p } = await supa.from('profiles').select('display_name').eq('user_id', user.id).single();
    displayName = p?.display_name ?? user.email ?? null;
  }

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-50 bg-gradient-to-r from-[#050a14] via-[#0e1a30] to-[#050a14] border-b-[3px] border-accent">
          <div className="max-w-7xl mx-auto flex items-center gap-5 px-5 py-3">
            <Link href="/" className="font-extrabold text-lg tracking-wide">
              FIFA <span className="text-accent">World Cup 2026</span>
              <span className="ml-2 text-inkdim font-normal text-xs hidden sm:inline">Bracket Challenge</span>
            </Link>
            <nav className="flex gap-4 text-sm ml-4">
              <Link href="/bracket" className="text-inkdim hover:text-ink">My Bracket</Link>
              <Link href="/leaderboard" className="text-inkdim hover:text-ink">Leaderboard</Link>
              {admin && <Link href="/admin" className="text-accent2 hover:brightness-125 font-semibold">Admin</Link>}
            </nav>
            <div className="flex-1" />
            {user ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline text-xs text-inkdim">
                  Signed in as <strong className="text-ink">{displayName}</strong>
                </span>
                <form action="/auth/signout" method="post">
                  <button className="btn" type="submit">Sign out</button>
                </form>
              </div>
            ) : (
              <div className="flex gap-2">
                <Link href="/login" className="btn">Log in</Link>
                <Link href="/signup" className="btn btn-primary">Sign up</Link>
              </div>
            )}
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-5 py-6">{children}</main>
        <footer className="max-w-7xl mx-auto px-5 py-10 text-inkdim text-xs">
          Data from FIFA Final Draw (Dec 5, 2025). Not affiliated with FIFA, ESPN, or Anthropic.
          Bracket locks at first kickoff (June 11, 2026 · Estadio Azteca).
        </footer>
      </body>
    </html>
  );
}
