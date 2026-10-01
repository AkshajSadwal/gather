'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { api } from '../lib/api';
import PostCard from './PostCard';

export default function Feed() {
  const { status } = useSession();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (reset = false) => {
    setBusy(true); setError('');
    try {
      const data = await api(`/posts/feed?limit=10${!reset && cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setPosts((all) => reset ? data.posts : [...all, ...data.posts]); setCursor(data.nextCursor || null);
    } catch (problem) { setError(problem.message); }
    finally { setBusy(false); }
  }, [cursor]);
  useEffect(() => { if (status === 'authenticated') load(true); else if (status === 'unauthenticated') setBusy(false); }, [status]);
  useEffect(() => { const refresh = () => load(true); window.addEventListener('social:refresh-feed', refresh); return () => window.removeEventListener('social:refresh-feed', refresh); }, [load]);

  if (status === 'loading' || busy && !posts.length) return <div className="space-y-4">{[0, 1].map((item) => <div key={item} className="rounded-3xl border border-line bg-white p-4"><div className="skeleton mb-4 h-10 w-40 rounded-full" /><div className="skeleton aspect-[4/3] rounded-2xl" /><div className="skeleton mt-4 h-14 rounded-xl" /></div>)}</div>;
  if (error && !posts.length) return <div className="rounded-3xl border border-line bg-white p-10 text-center"><h2 className="font-semibold">We couldn’t load your feed</h2><p className="mt-2 text-sm text-ink/55">{error}</p><button onClick={() => load(true)} className="mt-5 rounded-xl bg-moss px-5 py-2 text-sm font-semibold text-white">Try again</button></div>;
  if (!posts.length) return <div className="rounded-3xl border border-line bg-white p-10 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-mint text-moss">✦</span><h2 className="mt-4 text-lg font-semibold">Your feed starts with people</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-ink/55">Follow a few creators or share your first moment. Recent posts from your circle will show up here.</p><a href="/explore" className="mt-5 inline-block rounded-xl bg-moss px-5 py-2.5 text-sm font-semibold text-white">Explore people</a></div>;
  return <div className="space-y-5">{posts.map((post) => <PostCard key={post.id} initialPost={post} onDelete={(id) => setPosts((all) => all.filter((item) => item.id !== id))} />)}{cursor && <button disabled={busy} onClick={() => load(false)} className="w-full rounded-xl border border-line bg-white py-3 text-sm font-semibold text-moss disabled:opacity-50">{busy ? 'Loading…' : 'Load more moments'}</button>}</div>;
}
