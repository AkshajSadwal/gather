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
  const [sort, setSort] = useState('latest');
  const [popularPage, setPopularPage] = useState(1);
  const [popularPages, setPopularPages] = useState(1);
  const notify = useToast();
  useEffect(() => { let active = true; setBusy(true); setError(''); const feedRequest = sort === 'popular' ? api(`/posts/explore?sort=popular&page=${popularPage}`) : api('/posts/explore?limit=24'); Promise.all([feedRequest, api('/users/suggestions')]).then(([feed, suggestions]) => { if (!active) return; setPosts(feed.posts || []); setPopularPages(feed.totalPages || 1); setUsers(suggestions.users || []); }).catch((problem) => { if (active) setError(problem.message); }).finally(() => { if (active) setBusy(false); }); return () => { active = false; }; }, [sort, popularPage]);
  const follow = async (username) => { try { await api(`/follows/${username}/toggle`, { method: 'POST' }); notify(`You’re now connected to @${username}.`); } catch (problem) { notify(problem.message, 'error'); } };
  return <div className="mx-auto max-w-[1280px]"><header className="mb-7"><h1 className="mt-1 text-3xl font-bold tracking-tight">Explore</h1></header>
    <div className="glass-surface-light mb-5 flex w-fit gap-2 rounded-full p-1.5"><button onClick={() => { setSort('latest'); setPopularPage(1); }} aria-pressed={sort === 'latest'} className={`rounded-xl px-4 py-2 text-sm font-semibold ${sort === 'latest' ? 'bg-moss text-white' : 'border border-line bg-surface'}`}>Latest</button><button onClick={() => { setSort('popular'); setPopularPage(1); }} aria-pressed={sort === 'popular'} className={`rounded-xl px-4 py-2 text-sm font-semibold ${sort === 'popular' ? 'bg-moss text-white' : 'border border-line bg-surface'}`}>Popular this week</button></div>
    {users.length > 0 && <section className="glass-surface-strong mb-8 rounded-3xl p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold">People to meet</h2><Link href="/search" className="text-sm font-medium text-moss">Search all</Link></div><div className="flex gap-3 overflow-auto">{users.slice(0, 7).map((user) => <div key={user.id} className="w-[150px] shrink-0 rounded-2xl bg-paper p-4 text-center"><Link href={`/profile/${user.username}`} className="mx-auto block h-12 w-12 overflow-hidden rounded-full bg-mint"><img src={mediaUrl(user.image)} alt="" className="h-full w-full object-cover" /></Link><Link href={`/profile/${user.username}`} className="mt-2 block truncate text-sm font-semibold">@{user.username}</Link>{user.mutualFollowers > 0 && <p className="mt-1 text-[11px] text-ink/45">{user.mutualFollowers} mutual {user.mutualFollowers === 1 ? 'follower' : 'followers'}</p>}<button onClick={() => follow(user.username)} className="mt-3 rounded-lg bg-moss px-4 py-2 text-xs font-semibold text-white">Follow</button></div>)}</div></section>}
    {error && <div className="rounded-2xl bg-surface p-8 text-center"><p>{error}</p><button onClick={() => window.location.reload()} className="mt-3 text-sm font-semibold text-moss">Try again</button></div>}
    {busy && <div className="explore-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{Array.from({ length: 12 }, (_, index) => <div key={index} className="skeleton aspect-square rounded-2xl" />)}</div>}
    {!busy && !error && (posts.length ? <><div className="explore-grid grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-paper"><img src={mediaUrl(post.media?.[0]?.url)} alt={post.caption || `Post by ${post.author.username}`} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /><span className="absolute inset-x-0 bottom-0 translate-y-0 bg-gradient-to-t from-black/70 to-transparent p-3 pt-8 text-xs text-white opacity-100 transition sm:translate-y-2 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100">@{post.author.username} · {post._count.likes} appreciations</span></Link>)}</div>{sort === 'popular' && <div className="mt-5 flex items-center justify-center gap-4"><button disabled={popularPage <= 1} onClick={() => setPopularPage((page) => page - 1)} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">Previous</button><span className="text-xs text-ink/50">Page {popularPage} of {popularPages}</span><button disabled={popularPage >= popularPages} onClick={() => setPopularPage((page) => page + 1)} className="rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-40">Next</button></div>}</> : !users.length && <div className="rounded-3xl border border-line bg-surface px-6 py-16 text-center"><h2 className="text-lg font-semibold">Nothing to discover just yet</h2><p className="mt-2 text-sm text-ink/55">As the community shares moments, they’ll find a home here.</p></div>)}
  </div>;
}


