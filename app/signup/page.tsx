'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (!name.trim()) { setErr('Please enter a display name.'); return; }
    setLoading(true);
    const supa = createSupabaseBrowserClient();
    const { error } = await supa.auth.signUp({
      email, password,
      options: { data: { display_name: name.trim() } },
    });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    router.push('/bracket');
    router.refresh();
  }

  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-3xl font-extrabold mb-2">Create your bracket</h1>
      <p className="hint mb-6">Free. No money, just bragging rights. Make sure your display name is something your friends will recognize on the leaderboard.</p>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-inkdim">Display name</label>
          <input className="input mt-1" value={name} onChange={e => setName(e.target.value)} maxLength={40} required />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-inkdim">Email</label>
          <input type="email" className="input mt-1" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-inkdim">Password</label>
          <input type="password" className="input mt-1" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required />
          <p className="text-xs text-inkdim mt-1">Minimum 8 characters.</p>
        </div>
        {err && <div className="bg-[#3d1618] border border-[#6a1c22] text-[#ffbdc1] text-sm rounded p-2">{err}</div>}
        <button className="btn btn-primary w-full justify-center" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account & start picking'}
        </button>
        <p className="text-center text-sm text-inkdim">
          Already signed up? <Link href="/login" className="text-accent font-semibold">Log in</Link>
        </p>
      </form>
    </div>
  );
}
