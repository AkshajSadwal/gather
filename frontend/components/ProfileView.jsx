'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Archive, Ban, Bookmark, Camera, Flag, Grid2X2, LockKeyhole, MessageCircle, MoreHorizontal, Pin, UserRoundMinus, UserRoundPlus, VolumeX } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';
import Avatar from './Avatar';
import ReportDialog from './ReportDialog';

export default function ProfileView({ username }) {
  const { data: session } = useSession();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState('');
  const [relations, setRelations] = useState([]);
  const [working, setWorking] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('posts');
  const [savedPosts, setSavedPosts] = useState([]);
  const [savedCursor, setSavedCursor] = useState(null);
  const [savedBusy, setSavedBusy] = useState(false);
  const [savedError, setSavedError] = useState('');
  const [archivedPosts, setArchivedPosts] = useState([]);
  const [archivedCursor, setArchivedCursor] = useState(null);
  const [archivedBusy, setArchivedBusy] = useState(false);
  const [archivedError, setArchivedError] = useState('');
  const [unarchiving, setUnarchiving] = useState('');
  const notify = useToast();
  const load = async () => { setBusy(true); try { setData(await api(`/users/${encodeURIComponent(username)}`)); setError(''); } catch (problem) { setError(problem.message); } finally { setBusy(false); } };
  useEffect(() => { load(); }, [username]);
  useEffect(() => { setActiveTab('posts'); }, [username]);
  useEffect(() => {
    if (activeTab !== 'saved' || !data?.user?.isSelf) return undefined;
    let cancelled = false;
    setSavedBusy(true);
    setSavedError('');
    api('/posts/saved?limit=24').then((result) => {
      if (!cancelled) { setSavedPosts(result.items || []); setSavedCursor(result.nextCursor || null); }
    }).catch((problem) => { if (!cancelled) setSavedError(problem.message); }).finally(() => { if (!cancelled) setSavedBusy(false); });
    return () => { cancelled = true; };
  }, [activeTab, data?.user?.isSelf]);
  useEffect(() => {
    if (activeTab !== 'archive' || !data?.user?.isSelf) return undefined;
    let cancelled = false;
    setArchivedBusy(true);
    setArchivedError('');
    api('/posts/archived?limit=24').then((result) => {
      if (!cancelled) { setArchivedPosts(result.items || []); setArchivedCursor(result.nextCursor || null); }
    }).catch((problem) => { if (!cancelled) setArchivedError(problem.message); }).finally(() => { if (!cancelled) setArchivedBusy(false); });
    return () => { cancelled = true; };
  }, [activeTab, data?.user?.isSelf]);

  const toggleBlock = async () => {
    if (!session || isSelf || working) return;
    if (!user.isBlocked && !window.confirm(`Block @${username}? They will no longer be able to interact with you.`)) return;
    setProfileMenuOpen(false);
    setWorking(true);
    try {
      const result = await api(`/blocks/${encodeURIComponent(username)}/toggle`, { method: 'POST' });
      notify(result.blocked ? `@${username} has been blocked.` : `@${username} has been unblocked.`);
      await load();
    } catch (problem) { notify(problem.message, 'error'); } finally { setWorking(false); }
  };

  const toggleMute = async () => {
    if (!session || isSelf || working) return;
    setProfileMenuOpen(false);
    setWorking(true);
    try {
      const result = await api(`/mutes/${encodeURIComponent(username)}/toggle`, { method: 'POST' });
      notify(result.muted ? `@${username} is muted.` : `@${username} is unmuted.`);
      await load();
    } catch (problem) { notify(problem.message, 'error'); } finally { setWorking(false); }
  };

  const toggleFollow = async () => {
    if (!session) { window.location.href = '/login'; return; }
    setWorking(true);
    try { const result = await api(`/follows/${encodeURIComponent(username)}/toggle`, { method: 'POST' }); notify(result.pending ? 'Follow request sent.' : result.following ? 'You’re now following this account.' : result.cancelledRequest ? 'Follow request canceled.' : 'You unfollowed this account.'); await load(); }
    catch (problem) { notify(problem.message, 'error'); } finally { setWorking(false); }
  };
  const openRelation = async (kind) => {
    setModal(kind); setRelations([]);
    try { const result = await api(`/users/${encodeURIComponent(username)}/${kind}`); setRelations(result.users || []); }
    catch (problem) { notify(problem.message, 'error'); }
  };
  const removeFollower = async (person) => {
    if (!isSelf || modal !== 'followers' || working) return;
    setWorking(true);
    try {
      await api(`/follows/followers/${encodeURIComponent(person.username)}`, { method: 'DELETE' });
      setRelations((all) => all.filter((entry) => entry.id !== person.id));
      setData((current) => current ? { ...current, user: { ...current.user, _count: { ...current.user._count, followers: Math.max(0, (current.user._count?.followers || 0) - 1) } } } : current);
      notify(`@${person.username} was removed from your followers.`);
    } catch (problem) { notify(problem.message, 'error'); }
    finally { setWorking(false); }
  };
  const unfollowPerson = async (person) => {
    if (!isSelf || modal !== 'following' || working) return;
    setWorking(true);
    try {
      const result = await api(`/follows/${encodeURIComponent(person.username)}/toggle`, { method: 'POST' });
      if (result.following || result.pending) throw new Error('This account is no longer in your following list.');
      setRelations((all) => all.filter((entry) => entry.id !== person.id));
      setData((current) => current ? { ...current, user: { ...current.user, _count: { ...current.user._count, following: Math.max(0, (current.user._count?.following || 0) - 1) } } } : current);
      notify(`You unfollowed @${person.username}.`);
    } catch (problem) { notify(problem.message, 'error'); }
    finally { setWorking(false); }
  };

  const loadMoreSaved = async () => {
    if (!savedCursor || savedBusy) return;
    setSavedBusy(true);
    try {
      const result = await api(`/posts/saved?limit=24&cursor=${encodeURIComponent(savedCursor)}`);
      setSavedPosts((all) => [...all, ...(result.items || [])]);
      setSavedCursor(result.nextCursor || null);
    } catch (problem) { setSavedError(problem.message); }
    finally { setSavedBusy(false); }
  };

  const loadMoreArchived = async () => {
    if (!archivedCursor || archivedBusy) return;
    setArchivedBusy(true);
    try { const result = await api(`/posts/archived?limit=24&cursor=${encodeURIComponent(archivedCursor)}`); setArchivedPosts((all) => [...all, ...(result.items || [])]); setArchivedCursor(result.nextCursor || null); setArchivedError(''); }
    catch (problem) { setArchivedError(problem.message); }
    finally { setArchivedBusy(false); }
  };

  const unarchivePost = async (post) => {
    if (unarchiving) return;
    setUnarchiving(post.id);
    try { await api(`/posts/${post.id}/archive`, { method: 'POST' }); setArchivedPosts((all) => all.filter((item) => item.id !== post.id)); notify('Post restored to your profile.'); void load(); }
    catch (problem) { notify(problem.message, 'error'); }
    finally { setUnarchiving(''); }
  };


  if (busy) return <div className="mx-auto max-w-[1200px]"><div className="skeleton h-48 rounded-3xl" /><div className="mt-5 grid grid-cols-3 gap-2">{[1, 2, 3].map((n) => <div className="skeleton aspect-square rounded-2xl" key={n} />)}</div></div>;
  if (error || !data) return <div className="mx-auto max-w-xl rounded-3xl border border-line bg-surface p-12 text-center"><h1 className="text-xl font-semibold">{error || 'Profile not found'}</h1><p className="mt-2 text-sm text-ink/55">Try checking the username or browse Explore.</p><Link href="/explore" className="mt-5 inline-block rounded-xl bg-moss px-5 py-3 text-sm font-semibold text-white">Explore</Link></div>;
  const { user, posts } = data;
  const isSelf = user.isSelf || session?.user?.id === user.id;

  return <div className="profile-journal mx-auto max-w-[1320px]"><section className="profile-identity rounded-[26px] border border-line bg-surface p-4 shadow-sm sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-10"><Avatar src={user.image || user.profile?.avatarUrl} name={user.username} size="xl" className="self-center sm:self-auto" /><div className="min-w-0 flex-1"><div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center"><div className="min-w-0 flex-1 text-center sm:text-left"><p className="truncate text-2xl font-semibold">@{user.username}</p><p className="mt-1 text-sm text-ink/55">{user.profile?.displayName}</p></div><div className="flex gap-2">{isSelf ? <Link href="/settings" className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper">Edit profile</Link> : <>{user.isBlockedBy ? <button disabled className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-ink/45">Blocked</button> : <button disabled={working || user.isBlocked} onClick={toggleFollow} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${user.isFollowing ? 'border border-line text-ink' : 'bg-moss text-white'} disabled:opacity-50`}>{user.isFollowing ? 'Following' : user.isFollowPending ? 'Requested' : 'Follow'}</button>}{!user.isBlockedBy && !user.isBlocked && <Link href={`/messages?to=${encodeURIComponent(user.username)}`} className="grid place-items-center rounded-xl border border-line p-2.5" aria-label="Message"><MessageCircle size={18} /></Link>}<div className="relative"><button onClick={() => setProfileMenuOpen(!profileMenuOpen)} className="grid place-items-center rounded-xl border border-line p-2.5 text-ink/65" aria-label="Profile options"><MoreHorizontal size={18} /></button>{profileMenuOpen && <div className="absolute right-0 top-12 z-20 w-48 rounded-xl border border-line bg-surface p-1 shadow-soft"><button disabled={working} onClick={toggleBlock} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Ban size={15} />{user.isBlocked ? 'Unblock account' : 'Block account'}</button><button disabled={working} onClick={toggleMute} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><VolumeX size={15} />{user.isMuted ? 'Unmute account' : 'Mute account'}</button>{session && <button onClick={() => { setProfileMenuOpen(false); setReporting(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Flag size={15} />Report account</button>}</div>}</div></>}</div></div>
      <div className="mt-5 flex justify-center gap-6 text-sm sm:justify-start sm:gap-8"><span><b>{user._count.posts}</b> posts</span><button onClick={() => openRelation('followers')}><b>{user._count.followers}</b> followers</button><button onClick={() => openRelation('following')}><b>{user._count.following}</b> following</button></div>
      <p className="mt-5 whitespace-pre-wrap text-center text-sm leading-6 sm:text-left">{user.profile?.bio}</p>{user.profile?.website && <a href={user.profile.website} target="_blank" rel="noreferrer" className="mt-2 block text-center text-sm font-medium text-moss hover:underline sm:text-left">{user.profile.website}</a>}
    </div></div>
      <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-xs text-ink/45"><span className="inline-flex items-center gap-2"><Grid2X2 size={15} /> MOMENTS</span>{user.profile?.visibility === 'PRIVATE' && <span className="inline-flex items-center gap-1"><LockKeyhole size={13} /> PRIVATE ACCOUNT</span>}</div>
    </section>
    {isSelf && <div className="mt-5 flex justify-center gap-8 border-b border-line"><button onClick={() => setActiveTab('posts')} className={`border-b-2 px-3 py-3 text-xs font-semibold tracking-widest ${activeTab === 'posts' ? 'border-moss text-moss' : 'border-transparent text-ink/45'}`}>POSTS</button><button onClick={() => setActiveTab('saved')} className={`border-b-2 px-3 py-3 text-xs font-semibold tracking-widest ${activeTab === 'saved' ? 'border-moss text-moss' : 'border-transparent text-ink/45'}`}>SAVED</button><button onClick={() => setActiveTab('archive')} className={`border-b-2 px-3 py-3 text-xs font-semibold tracking-widest ${activeTab === 'archive' ? 'border-moss text-moss' : 'border-transparent text-ink/45'}`}>ARCHIVE</button></div>}
    {activeTab === 'posts' ? (!user.canView ? <div className="mt-8 rounded-3xl border border-line bg-surface px-6 py-16 text-center"><span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-paper"><LockKeyhole className="text-moss" /></span><h2 className="mt-4 text-lg font-semibold">{user.isBlocked ? 'You blocked this account' : user.isBlockedBy ? 'This account is unavailable' : 'This account is private'}</h2><p className="mt-2 text-sm text-ink/55">{user.isBlocked ? 'Unblock this account to view its profile content.' : user.isBlockedBy ? 'You cannot view or interact with this account.' : `Follow @${user.username} to see their photos and videos.`}</p></div> : posts.length ? <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">{posts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-surface"><img src={mediaUrl(post.media[0]?.url)} alt={post.caption || 'Post'} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />{post.pinnedAt && <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-surface/90 text-moss shadow"><Pin size={15} aria-label="Pinned post" /></span>}</Link>)}</div> : <div className="mt-5 rounded-3xl border border-line bg-surface py-14 text-center"><Camera className="mx-auto text-moss" /><h2 className="mt-3 font-semibold">No moments shared yet</h2><p className="mt-1 text-sm text-ink/50">When a photo or video is posted, it will show up here.</p></div>) : activeTab === 'archive' ? <div className="mt-5">{archivedBusy && !archivedPosts.length ? <div className="skeleton aspect-square rounded-2xl" /> : archivedError && !archivedPosts.length ? <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-coral">{archivedError} <button onClick={() => { setArchivedBusy(true); setArchivedError(''); api('/posts/archived?limit=24').then((result) => { setArchivedPosts(result.items || []); setArchivedCursor(result.nextCursor || null); }).catch((problem) => setArchivedError(problem.message)).finally(() => setArchivedBusy(false)); }} className="ml-2 underline">Retry</button></div> : archivedPosts.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{archivedPosts.map((post) => <div key={post.id} className="relative aspect-square overflow-hidden rounded-2xl bg-surface"><Link href={`/post/${post.id}`} className="block h-full w-full"><img src={mediaUrl(post.media[0]?.url)} alt={post.caption || 'Archived post'} loading="lazy" className="h-full w-full object-cover" /></Link><button type="button" disabled={Boolean(unarchiving)} onClick={() => void unarchivePost(post)} className="absolute inset-x-2 bottom-2 rounded-lg bg-surface/95 px-2 py-2 text-xs font-semibold text-moss shadow disabled:opacity-50">{unarchiving === post.id ? 'Restoring…' : 'Unarchive'}</button></div>)}</div> : <div className="rounded-3xl border border-line bg-surface py-14 text-center"><Archive className="mx-auto text-moss" /><h2 className="mt-3 font-semibold">Your archive is empty</h2><p className="mt-1 text-sm text-ink/50">Posts you archive are only visible to you here.</p></div>}{archivedError && archivedPosts.length > 0 && <p role="alert" className="mt-3 text-sm text-coral">{archivedError}</p>}{archivedCursor && <button type="button" disabled={archivedBusy} onClick={() => void loadMoreArchived()} className="mx-auto mt-5 block rounded-xl border border-line px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{archivedBusy ? 'Loading…' : 'Load more'}</button>}</div> : <div className="mt-5">{savedBusy && !savedPosts.length ? <div className="skeleton aspect-square rounded-2xl" /> : savedError ? <div role="alert" className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-coral">{savedError} <button onClick={() => setActiveTab('posts')} className="ml-2 underline">Back to posts</button></div> : savedPosts.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{savedPosts.map((post) => <Link href={`/post/${post.id}`} key={post.id} className="group relative aspect-square overflow-hidden rounded-2xl bg-surface"><img src={mediaUrl(post.media[0]?.url)} alt={post.caption || 'Saved post'} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" /></Link>)}</div> : <div className="rounded-3xl border border-line bg-surface py-14 text-center"><Bookmark className="mx-auto text-moss" /><h2 className="mt-3 font-semibold">No saved posts yet</h2><p className="mt-1 text-sm text-ink/50">Posts you save will appear here.</p></div>}{savedCursor && <button type="button" disabled={savedBusy} onClick={() => void loadMoreSaved()} className="mx-auto mt-5 block rounded-xl border border-line px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{savedBusy ? 'Loading…' : 'Load more'}</button>}</div>}
    {modal && <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onMouseDown={(e) => e.target === e.currentTarget && setModal('')}><div role="dialog" aria-modal="true" className="max-h-[75vh] w-full max-w-sm overflow-auto rounded-3xl bg-surface p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold capitalize">{modal}</h2><button onClick={() => setModal('')} className="text-sm text-moss">Close</button></div>{relations.length ? relations.map((person) => <div key={person.id} className="flex items-center gap-3 border-b border-line py-3"><Link onClick={() => setModal('')} href={`/profile/${person.username}`} className="flex min-w-0 flex-1 items-center gap-3"><Avatar src={person.image || person.profile?.avatarUrl} name={person.username} size="sm" /><span className="min-w-0"><b className="block truncate text-sm">@{person.username}</b><small className="text-ink/50">{person.profile?.displayName}</small></span></Link>{modal === 'followers' && isSelf ? <button type="button" disabled={working} onClick={() => removeFollower(person)} aria-label={`Remove @${person.username} from your followers`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink/65 hover:bg-paper disabled:opacity-50"><UserRoundMinus size={16} />Remove</button> : modal === 'following' && isSelf ? <button type="button" disabled={working} onClick={() => unfollowPerson(person)} aria-label={`Unfollow @${person.username}`} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-2 text-xs font-semibold text-ink/65 hover:bg-paper disabled:opacity-50"><UserRoundMinus size={16} />Unfollow</button> : <UserRoundPlus className="shrink-0 text-ink/35" size={18} />}</div>) : <p className="py-8 text-center text-sm text-ink/50">No {modal} to show yet.</p>}</div></div>}
    {reporting && <ReportDialog targetType="USER" targetId={user.id} username={user.username} onClose={() => setReporting(false)} />}
  </div>;
}

