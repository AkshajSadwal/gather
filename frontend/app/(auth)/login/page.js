'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { ArrowRight, LoaderCircle, Sparkles } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const hasGoogle = Boolean(process.env.NEXT_PUBLIC_GOOGLE_LOGIN === 'true');

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    const result = await signIn('credentials', { identifier, password, redirect: false, callbackUrl: '/' });
    if (result?.error) { setError('That username/email and password combination did not match.'); setBusy(false); return; }
    router.push(result?.url || '/'); router.refresh();
  };
  return <div className="grid min-h-screen bg-paper lg:grid-cols-[1.05fr_.95fr]">
    <section className="auth-editorial-hero relative hidden overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-between"><Link href="/" className="flex items-center gap-2 text-2xl font-bold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-surface/15"><Sparkles size={20} /></span>gather<span className="text-[#f4a188]">.</span></Link><div className="relative z-10 max-w-lg pb-10"><p className="text-sm font-semibold uppercase tracking-[.24em] text-mint">Your people, in the moment</p><h1 className="mt-5 text-5xl font-bold leading-[1.08] tracking-tight">Small moments make the best stories.</h1><p className="mt-5 max-w-md text-lg leading-8 text-white/70">A welcoming place to share what matters, find new inspiration, and stay close to your circle.</p></div><div className="absolute -bottom-36 -right-24 h-[520px] w-[520px] rounded-full border border-white/10" /><div className="absolute -bottom-20 -right-4 h-[380px] w-[380px] rounded-full border border-white/10" /><p className="text-xs text-white/45">A kinder corner of the internet.</p></section>
    <section className="flex items-center justify-center px-5 py-12"><div className="w-full max-w-[410px]"><Link href="/" className="mb-10 flex items-center justify-center gap-2 text-2xl font-bold tracking-tight lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-xl bg-moss text-white"><Sparkles size={18} /></span>gather<span className="text-coral">.</span></Link><p className="text-sm font-semibold uppercase tracking-[.18em] text-moss">Welcome back</p><h2 className="mt-2 text-3xl font-bold tracking-tight">Sign in to your circle</h2><p className="mt-2 text-sm leading-6 text-ink/55">Good conversations and fresh moments are waiting.</p>
      {searchParams.get('passwordChanged') === '1' && <p role="status" className="mt-4 rounded-xl bg-mint/40 px-4 py-3 text-sm text-moss">Your password changed. Sign in with your new password.</p>}
      {hasGoogle && <><button onClick={() => signIn('google', { callbackUrl: '/' })} className="mt-7 flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-surface px-4 py-3.5 text-sm font-semibold hover:bg-paper"><GoogleMark />Continue with Google</button><div className="my-5 flex items-center gap-3 text-xs text-ink/35"><span className="h-px flex-1 bg-line" />or use email<span className="h-px flex-1 bg-line" /></div></>}
      <form onSubmit={submit} className="grid gap-4"><label className="grid gap-2 text-sm font-medium">Username or email<input required autoComplete="username" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="you@example.com" className="rounded-xl border border-line bg-surface px-4 py-3.5 font-normal outline-none focus:border-moss" /></label><label className="grid gap-2 text-sm font-medium">Password<input required type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" className="rounded-xl border border-line bg-surface px-4 py-3.5 font-normal outline-none focus:border-moss" /></label>{error && <p role="alert" className="rounded-xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a54735]">{error}</p>}<button disabled={busy} className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-moss px-4 py-3.5 text-sm font-semibold text-white transition hover:brightness-90 disabled:opacity-55">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <>Sign in <ArrowRight size={17} /></>}</button></form>
      <p className="mt-7 text-center text-sm text-ink/55">New to Gather? <Link href="/signup" className="font-semibold text-moss hover:underline">Create an account</Link></p><p className="mt-9 text-center text-xs leading-5 text-ink/35">By continuing, you agree to keep this community thoughtful and respectful.</p>
    </div></section>
  </div>;
}

function GoogleMark() { return <span className="grid h-5 w-5 place-items-center rounded-full border border-line text-xs font-bold text-[#4285f4]">G</span>; }
