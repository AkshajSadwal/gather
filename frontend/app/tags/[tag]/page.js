'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import AppShell from '../../../components/AppShell';
import { api, mediaUrl } from '../../../lib/api';

function TagPosts() {
  const { tag } = useParams();
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async (next = null, append = false) => {
    setLoading(true); setError('');
    try { const data = await api(`/tags/${encodeURIComponent(tag)}?limit=20${next ? `&cursor=${encodeURIComponent(next)}` : ''}`); setPosts((current) => append ? [...current, ...(data.posts || [])] : data.posts || []); setCursor(data.nextCursor || null); }
    catch (problem) { setError(problem.message || 'Could not load this hashtag.'); }
    finally { setLoading(false); }
  }, [tag]);
  useEffect(() => { void load(); }, [load]);
  return <section className="mx-auto max-w-5xl"><header className="mb-6"><Link href="/explore" className="text-sm text-moss hover:underline">Explore</Link><h1 className="mt-2 text-3xl font-bold">#{tag}</h1><p className="mt-1 text-sm text-ink/55">Recent public posts with this hashtag.</p></header>
    {loading && !posts.length && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <div key={i} className="skeleton aspect-square rounded-2xl" />)}</div>}
    {error && <div role="alert" className="rounded-2xl border border-coral/30 bg-surface p-5 text-sm text-coral">{error}<button onClick={() => void load()} className="ml-2 font-semibold underline">Retry</button></div>}
    {!loading && !error && !posts.length && <div className="rounded-3xl border border-line bg-surface px-6 py-16 text-center"><h2 className="font-semibold">No public posts yet</h2><p className="mt-2 text-sm text-ink/55">Try another hashtag or check back later.</p></div>}
    {posts.length > 0 && <><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-paper"><Image src={mediaUrl(post.media?.[0]?.url)} alt={post.caption || `Post by ${post.author.username}`} width={500} height={500} unoptimized className="h-full w-full object-cover transition group-hover:scale-105" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 text-xs text-white">@{post.author.username}</span></Link>)}</div>{cursor && <div className="mt-5 text-center"><button disabled={loading} onClick={() => void load(cursor, true)} className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loading ? 'Loading…' : 'Load more'}</button></div>}</>}
  </section>;
}

export default function TagPage() { return <AppShell><TagPosts /></AppShell>; }
