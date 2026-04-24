'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-client';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supa = createSupabaseBrowserClient();
    const { error } = await supa.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setErr(error.message); return; }
    const next = searchParams.get('next') || '/bracket';
    router.push(next);
    router.refresh();
  }

  return (
    <div className="max-w-md mx-auto mt-10">
      <h1 className="text-3xl font-extrabold mb-2">Welcome back</h1>
      <p className="hint mb-6">Log in to edit your picks.</p>
      <form onSubmit={onSubmit} className="card space-y-4">
        <div>
          <label className="text-xs uppercase tracking-wider text-inkdim">Email</label>
          <input type="email" className="input mt-1" value={email} onChange={e => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wider text-inkdim">Password</label>
          <input type="password" className="input mt-1" value={password} onChange={e => setPassword(e.target.value)} required />
        </div>
        {err && <div className="bg-[#3d1618] border border-[#6a1c22] text-[#ffbdc1] text-sm rounded p-2">{err}</div>}
        <button className="btn btn-primary w-full justify-center" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
        </button>
        <p className="text-center text-sm text-inkdim">
          New here? <Link href="/signup" className="text-accent font-semibold">Create an account</Link>
        </p>
      </form>
    </div>
  );
}
