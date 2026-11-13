'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api, mediaUrl } from '../lib/api';
import Avatar from './Avatar';

export default function SearchView({ initialQuery = '' }) {
  const [query, setQuery] = useState(initialQuery);
  const [results, setResults] = useState({ users: [], hashtags: [], posts: [] });
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const value = query.trim();
    if (!value) { setResults({ users: [], hashtags: [], posts: [] }); return; }
    const controller = new AbortController(); setBusy(true);
    const timer = setTimeout(() => api(`/search?q=${encodeURIComponent(value)}`, { signal: controller.signal }).then(setResults).catch((error) => { if (error.name !== 'AbortError') setResults({ users: [], hashtags: [], posts: [] }); }).finally(() => setBusy(false)), 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);
  return <div className="mx-auto max-w-5xl"><header className="mb-6"><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">Find your next follow</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Search</h1></header><form onSubmit={(event) => { event.preventDefault(); router.replace(`/search?q=${encodeURIComponent(query)}`); }} className="mb-7 flex items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3.5 shadow-sm"><Search size={19} className="text-ink/40" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="People, hashtags, or a moment…" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><span className="text-xs text-ink/35">{busy ? 'Searching…' : ''}</span></form>
    {!query.trim() && <div className="rounded-3xl border border-line bg-surface p-8 text-center"><p className="text-sm text-ink/55">Search by name, username, hashtag, or words in a caption.</p></div>}
    {query.trim() && <div className="space-y-6">{results.users.length > 0 && <section className="rounded-3xl border border-line bg-surface p-5"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">People</h2><div className="space-y-1">{results.users.map((user) => <Link key={user.id} href={`/profile/${user.username}`} className="flex items-center gap-3 rounded-xl p-2 hover:bg-paper"><Avatar src={user.image || user.profile?.avatarUrl} name={user.username} size="sm" /><span className="min-w-0 flex-1"><b className="block text-sm">@{user.username}</b><small className="text-ink/50">{user.profile?.displayName}</small></span><span className="text-sm text-moss">View</span></Link>)}</div></section>}
      {results.hashtags.length > 0 && <section className="rounded-3xl border border-line bg-surface p-5"><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Hashtags</h2><div className="flex flex-wrap gap-2">{results.hashtags.map((tag) => <button key={tag.id} onClick={() => setQuery(`#${tag.tag}`)} className="rounded-full bg-mint/70 px-4 py-2 text-sm text-moss">#{tag.tag}<span className="ml-2 text-xs text-ink/45">{tag._count.posts}</span></button>)}</div></section>}
      {results.posts.length > 0 && <section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-ink/50">Moments</h2><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{results.posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-surface"><img src={mediaUrl(post.media?.[0]?.url)} alt={post.caption || 'Post'} loading="lazy" className="h-full w-full object-cover" /><span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-3 pt-8 text-xs text-white">@{post.author.username}</span></Link>)}</div></section>}
      {!busy && !results.users.length && !results.posts.length && !results.hashtags.length && <div className="rounded-3xl border border-line bg-surface p-8 text-center"><h2 className="font-semibold">No matches yet</h2><p className="mt-2 text-sm text-ink/55">Try another name or phrase.</p></div>}</div>}
  </div>;
}
