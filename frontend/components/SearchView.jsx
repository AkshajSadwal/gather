'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search, X, LoaderCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import Avatar from './Avatar';
import PostMediaPreview from './PostMediaPreview';

export default function SearchView({ initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState({ users: [], hashtags: [], posts: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const router = useRouter();
  useEffect(() => {
    const value = query.trim();
    if (!value) { setResults({ users: [], hashtags: [], posts: [] }); setBusy(false); setError(''); return; }
    const controller = new AbortController(); let current = true; setBusy(true); setError('');
    const timer = setTimeout(() => api(`/search?q=${encodeURIComponent(value)}`, { signal: controller.signal }).then((data) => { if (current) setResults(data); }).catch((problem) => { if (current && problem.name !== 'AbortError') { setResults({ users: [], hashtags: [], posts: [] }); setError(problem.message); } }).finally(() => { if (current) setBusy(false); }), 350);
    return () => { current = false; clearTimeout(timer); controller.abort(); };
  }, [query, retry]);
  return <div className="search-page mx-auto max-w-5xl"><header className="mb-5"><h1 className="text-2xl font-bold tracking-tight">Search</h1></header><form onSubmit={(event) => { event.preventDefault(); router.replace(`/search?q=${encodeURIComponent(query)}`); }} className="glass-pill mb-6 flex items-center gap-3 px-4 py-2"><Search size={19} className="text-ink/50" /><input aria-label="Search people, hashtags and posts" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people, hashtags or posts" className="min-h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />{busy && <LoaderCircle aria-label="Searching" size={18} className="animate-spin text-moss" />}{query && <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="grid h-10 w-10 place-items-center rounded-full hover:bg-paper"><X size={18} /></button>}</form>
    {error && <div role="alert" className="glass mb-4 rounded-2xl p-4 text-sm">{error} <button type="button" onClick={() => setRetry((value) => value + 1)} className="ml-2 font-semibold text-moss underline">Retry</button></div>}
    {!query.trim() && <div className="rounded-3xl border border-line bg-surface p-8 text-center"><p className="text-sm text-ink/55">Search by name, username, hashtag, or words in a caption.</p></div>}
    {query.trim() && busy && <div role="status" aria-label="Searching" className="space-y-3">{[0, 1, 2].map((item) => <div key={item} className="skeleton h-16 rounded-2xl" />)}</div>}
    {query.trim() && !busy && <div className="space-y-5">{results.users.length > 0 && <section className="rounded-3xl border border-line bg-surface p-5"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">People</h2><div className="space-y-1">{results.users.map((user) => <Link key={user.id} href={`/profile/${user.username}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-paper"><Avatar src={user.image || user.profile?.avatarUrl} name={user.username} size="sm" /><span className="min-w-0 flex-1"><b className="block text-sm">@{user.username}</b><small className="text-ink/50">{user.profile?.displayName}</small></span><span className="text-sm text-moss">View</span></Link>)}</div></section>}
      {results.hashtags.length > 0 && <section className="rounded-3xl border border-line bg-surface p-5"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Hashtags</h2><div className="flex flex-wrap gap-2">{results.hashtags.map((tag) => <button key={tag.id} onClick={() => setQuery(`#${tag.tag}`)} className="rounded-full bg-mint/70 px-4 py-2 text-sm text-moss">#{tag.tag}<span className="ml-2 text-xs text-ink/45">{tag._count.posts}</span></button>)}</div></section>}
      {results.posts.length > 0 && <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Moments</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{results.posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-surface"><PostMediaPreview media={post.media?.[0]} alt={post.caption || 'Post'} /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 text-xs text-white">@{post.author.username}</span></Link>)}</div></section>}
      {!busy && !error && !results.users.length && !results.posts.length && !results.hashtags.length && <div className="rounded-3xl border border-line bg-surface p-8 text-center"><h2 className="font-semibold">No matches yet</h2><p className="mt-2 text-sm text-ink/55">Try another name or phrase.</p></div>}</div>}
  </div>;
}
