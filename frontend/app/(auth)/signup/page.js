'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { ArrowRight, Check, CircleAlert, LoaderCircle, Sparkles } from 'lucide-react';
import { api } from '../../../lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: '', username: '', email: '', password: '' });
  const [checks, setChecks] = useState({ username: 'idle', email: 'idle' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  useEffect(() => checkAvailability('username', form.username, setChecks), [form.username]);
  useEffect(() => checkAvailability('email', form.email, setChecks), [form.email]);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setError('');
    if (checks.username !== 'available' || checks.email !== 'available') { setError('Choose an available username and email address.'); return; }
    if (form.password.length < 8) { setError('Use a password with at least 8 characters.'); return; }
    setBusy(true);
    try {
      await api('/auth/signup', { method: 'POST', body: JSON.stringify(form) });
      const result = await signIn('credentials', { identifier: form.username, password: form.password, redirect: false, callbackUrl: '/' });
      if (result?.error) { router.push('/login?created=1'); return; }
      router.push(result?.url || '/'); router.refresh();
    } catch (problem) { setError(problem.message || 'We couldn’t create your account.'); setBusy(false); }
  };

  return <div className="grid min-h-screen bg-paper lg:grid-cols-[.9fr_1.1fr]"><section className="flex items-center justify-center px-5 py-10 lg:order-2"><div className="w-full max-w-[440px]"><Link href="/" className="mb-8 flex items-center justify-center gap-2 text-2xl font-bold tracking-tight lg:hidden"><span className="grid h-9 w-9 place-items-center rounded-xl bg-moss text-white"><Sparkles size={18} /></span>gather<span className="text-coral">.</span></Link><p className="text-sm font-semibold uppercase tracking-[.18em] text-moss">Make room for moments</p><h1 className="mt-2 text-3xl font-bold tracking-tight">Create your account</h1><p className="mt-2 text-sm leading-6 text-ink/55">Your name, your corner, your people.</p>
      <form onSubmit={submit} className="mt-6 grid gap-3.5"><label className="grid gap-1.5 text-sm font-medium">Display name<input value={form.displayName} onChange={update('displayName')} maxLength={60} placeholder="How should we call you?" className="rounded-xl border border-line bg-white px-4 py-3 font-normal outline-none focus:border-moss" /></label><AvailabilityInput label="Username" value={form.username} status={checks.username} onChange={update('username')} placeholder="your.name" autoComplete="username" /><AvailabilityInput label="Email" value={form.email} status={checks.email} onChange={update('email')} placeholder="you@example.com" autoComplete="email" type="email" /><label className="grid gap-1.5 text-sm font-medium">Password<input required minLength={8} maxLength={72} type={passwordVisible ? 'text' : 'password'} value={form.password} onChange={update('password')} autoComplete="new-password" placeholder="At least 8 characters" className="rounded-xl border border-line bg-white px-4 py-3 font-normal outline-none focus:border-moss" /></label><button type="button" onClick={() => setPasswordVisible(!passwordVisible)} className="-mt-2 justify-self-end text-xs font-medium text-moss">{passwordVisible ? 'Hide password' : 'Show password'}</button>{error && <p role="alert" className="rounded-xl bg-[#fff0ed] px-4 py-3 text-sm text-[#a54735]">{error}</p>}<button disabled={busy || checks.username === 'checking' || checks.email === 'checking'} className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-moss px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-55">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <>Create account <ArrowRight size={17} /></>}</button></form>
      <p className="mt-6 text-center text-sm text-ink/55">Already part of Gather? <Link href="/login" className="font-semibold text-moss hover:underline">Sign in</Link></p><p className="mt-5 text-center text-xs text-ink/35">Passwords are hashed before storage. Account names are checked here and enforced again by the database.</p>
    </div></section><aside className="relative hidden overflow-hidden bg-[#e5efe9] p-12 lg:order-1 lg:flex lg:flex-col lg:justify-between"><Link href="/" className="flex items-center gap-2 text-2xl font-bold"><span className="grid h-10 w-10 place-items-center rounded-xl bg-moss text-white"><Sparkles size={20} /></span>gather<span className="text-coral">.</span></Link><div className="relative z-10 max-w-lg pb-10"><p className="text-sm font-semibold uppercase tracking-[.2em] text-moss">A space to be yourself</p><h2 className="mt-5 text-5xl font-bold leading-[1.08] tracking-tight">Your next favorite thing could be a person.</h2><p className="mt-5 max-w-md text-lg leading-8 text-ink/60">Share a little of your day. Find a new point of view. Keep the people you love close.</p><div className="mt-8 flex -space-x-3"><span className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#e5efe9] bg-coral text-white">J</span><span className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#e5efe9] bg-[#d9b676] text-white">M</span><span className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#e5efe9] bg-[#879fb9] text-white">A</span><span className="grid h-11 w-11 place-items-center rounded-full border-2 border-[#e5efe9] bg-white text-xs font-semibold text-moss">+you</span></div></div><p className="text-xs text-ink/40">Thoughtful by design, open to everyone.</p></aside></div>;
}

function AvailabilityInput({ label, value, status, onChange, ...props }) {
  const copy = { idle: '', checking: 'Checking…', available: 'Available', taken: 'Already taken', invalid: 'Invalid' };
  const color = { checking: 'text-ink/45', available: 'text-moss', taken: 'text-coral', invalid: 'text-coral' };
  return <label className="grid gap-1.5 text-sm font-medium">{label}<span className="relative"><input required value={value} onChange={onChange} {...props} className="w-full rounded-xl border border-line bg-white px-4 py-3 pr-28 font-normal outline-none focus:border-moss" />{status !== 'idle' && <span aria-live="polite" className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-[11px] font-medium ${color[status]}`}>{status === 'available' ? <Check size={13} /> : status === 'invalid' || status === 'taken' ? <CircleAlert size={13} /> : null}{copy[status]}</span>}</span></label>;
}

function checkAvailability(key, value, setChecks) {
  if (!value) { setChecks((current) => ({ ...current, [key]: 'idle' })); return undefined; }
  const localValid = key === 'username' ? /^[a-zA-Z0-9._]{3,30}$/.test(value) && !value.includes('..') : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (!localValid) { setChecks((current) => ({ ...current, [key]: 'invalid' })); return undefined; }
  setChecks((current) => ({ ...current, [key]: 'checking' }));
  const controller = new AbortController();
  const timer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ [key]: value });
      const data = await api(`/users/check-${key}?${params}`, { signal: controller.signal });
      setChecks((current) => ({ ...current, [key]: data.valid ? data.available ? 'available' : 'taken' : 'invalid' }));
    } catch (problem) { if (problem.name !== 'AbortError') setChecks((current) => ({ ...current, [key]: 'idle' })); }
  }, 450);
  return () => { clearTimeout(timer); controller.abort(); };
}
