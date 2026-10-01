'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';

export default function ExploreView() {
  const [posts, setPosts] = useState([]);
  const [users, setUsers] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const notify = useToast();
  useEffect(() => { Promise.all([api('/posts/explore?limit=24'), api('/users/suggestions')]).then(([feed, suggestions]) => { setPosts(feed.posts || []); setUsers(suggestions.users || []); }).catch((problem) => setError(problem.message)).finally(() => setBusy(false)); }, []);
  const follow = async (username) => { try { await api(`/follows/${username}/toggle`, { method: 'POST' }); notify(`You’re now connected to @${username}.`); } catch (problem) { notify(problem.message, 'error'); } };
  return <div className="mx-auto max-w-5xl"><header className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">A world of new ideas</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Explore</h1><p className="mt-2 text-sm text-ink/55">Find creators, conversations, and moments beyond your circle.</p></header>
    {users.length > 0 && <section className="mb-8 rounded-3xl border border-line bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">People to meet</h2><Link href="/search" className="text-sm font-medium text-moss">Search all</Link></div><div className="flex gap-3 overflow-auto">{users.slice(0, 7).map((user) => <div key={user.id} className="w-[150px] shrink-0 rounded-2xl bg-paper p-4 text-center"><Link href={`/profile/${user.username}`} className="mx-auto block h-12 w-12 overflow-hidden rounded-full bg-mint"><img src={mediaUrl(user.image)} alt="" className="h-full w-full object-cover" /></Link><Link href={`/profile/${user.username}`} className="mt-2 block truncate text-sm font-semibold">@{user.username}</Link><button onClick={() => follow(user.username)} className="mt-3 rounded-lg bg-moss px-4 py-2 text-xs font-semibold text-white">Follow</button></div>)}</div></section>}
    {error && <div className="rounded-2xl bg-white p-8 text-center"><p>{error}</p><button onClick={() => window.location.reload()} className="mt-3 text-sm font-semibold text-moss">Try again</button></div>}
    {busy && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 12 }, (_, index) => <div key={index} className="skeleton aspect-square rounded-2xl" />)}</div>}
    {!busy && !error && (posts.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-[#e9ece7]"><img src={mediaUrl(post.media?.[0]?.url)} alt={post.caption || `Post by ${post.author.username}`} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /><span className="absolute inset-x-0 bottom-0 translate-y-2 bg-gradient-to-t from-black/65 to-transparent p-3 pt-8 text-xs text-white opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">@{post.author.username} · {post._count.likes} appreciations</span></Link>)}</div> : !users.length && <div className="rounded-3xl border border-line bg-white px-6 py-16 text-center"><h2 className="text-lg font-semibold">Nothing to discover just yet</h2><p className="mt-2 text-sm text-ink/55">As the community shares moments, they’ll find a home here.</p></div>)}
  </div>;
}
