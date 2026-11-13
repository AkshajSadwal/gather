'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, Compass, House, LogOut, Menu, MessageCircle, Plus, Search, Settings, ShieldCheck, Sparkles, UserPlus, Video, X } from 'lucide-react';
import Avatar from './Avatar';
import ReelComposer from './ReelComposer';
import Composer from './Composer';
import { api } from '../lib/api';
import { getAppearance } from '../lib/appearance';
import { useUnreadMessages, useUnreadNotifications } from '../lib/realtime';

const links = [
  { href: '/', label: 'Home', icon: House },
  { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/reels', label: 'Reels', icon: Video },
  { href: '/messages', label: 'Messages', icon: MessageCircle }
];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = useSession();
  const [compose, setCompose] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [reelComposeOpen, setReelComposeOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationActions, setNotificationActions] = useState({});
  const [notificationBusy, setNotificationBusy] = useState({});
  const [mobileMenu, setMobileMenu] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const me = session?.user;
  const { unreadTotal } = useUnreadMessages();
  const { unreadNotifications, markNotificationRead, markAllNotificationsRead } = useUnreadNotifications();

  useEffect(() => {
    const sync = (mode = getAppearance()) => { const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches); document.documentElement.dataset.theme = dark ? 'dark' : 'light'; };
    sync();
    const onAppearance = (event) => sync(event.detail || getAppearance());
    const onSystemChange = () => { if (getAppearance() === 'system') sync('system'); };
    window.addEventListener('gather:appearance', onAppearance);
    const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
    systemTheme?.addEventListener?.('change', onSystemChange);
    return () => {
      window.removeEventListener('gather:appearance', onAppearance);
      systemTheme?.removeEventListener?.('change', onSystemChange);
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (me) api('/auth/me').then((data) => { if (active) setIsAdmin(Boolean(data.user?.isAdmin)); }).catch(() => { if (active) setIsAdmin(false); });
    else setIsAdmin(false);
    return () => { active = false; };
  }, [me?.id]);

  useEffect(() => {
    const listener = () => setCompose(true);
    window.addEventListener('social:compose', listener);
    return () => window.removeEventListener('social:compose', listener);
  }, []);

  useEffect(() => {
    if (!notificationsOpen || !me) return undefined;
    let cancelled = false;
    api('/notifications').then((data) => { if (!cancelled) setNotifications(data.notifications || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [notificationsOpen, me]);

  const openStoryComposer = () => {
    setCreateMenuOpen(false);
    setMobileMenu(false);
    if (pathname === '/') window.dispatchEvent(new Event('social:create-story'));
    else {
      try { window.sessionStorage.setItem('gather:create-story', '1'); } catch { /* The home story tray remains available. */ }
      router.push('/');
    }
  };

  const markNotificationAsRead = async (item) => {
    if (item.readAt) return true;
    try {
      await api(`/notifications/${item.id}/read`, { method: 'POST' });
      setNotifications((all) => all.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      markNotificationRead();
      return true;
    } catch { return false; }
  };

  const resolveFollowRequest = async (item, accepted) => {
    if (!item.followRequestId || notificationBusy[item.id]) return;
    setNotificationBusy((all) => ({ ...all, [item.id]: true }));
    try {
      const result = await api(`/follows/requests/${encodeURIComponent(item.followRequestId)}`, { method: 'PATCH', body: JSON.stringify({ accepted }) });
      await markNotificationAsRead(item);
      setNotificationActions((all) => ({ ...all, [item.id]: accepted ? { state: 'accepted', following: Boolean(result.followingBack), pending: Boolean(result.followBackPending) } : { state: 'declined' } }));
    } catch { /* Keep the request available for retry. */ }
    finally { setNotificationBusy((all) => ({ ...all, [item.id]: false })); }
  };

  const followBack = async (item) => {
    if (!item.actor?.username || notificationBusy[item.id]) return;
    setNotificationBusy((all) => ({ ...all, [item.id]: true }));
    try {
      const result = await api(`/follows/${encodeURIComponent(item.actor.username)}/toggle`, { method: 'POST' });
      setNotificationActions((all) => ({ ...all, [item.id]: { state: 'accepted', following: Boolean(result.following), pending: Boolean(result.pending) } }));
    } catch { /* Keep the action available after a transient error. */ }
    finally { setNotificationBusy((all) => ({ ...all, [item.id]: false })); }
  };

  const markAllRead = async () => {
    try {
      await api('/notifications/all/read', { method: 'POST' });
      const now = new Date().toISOString();
      setNotifications((all) => all.map((item) => ({ ...item, readAt: item.readAt || now })));
      markAllNotificationsRead();
    } catch { /* The unread state remains visible if saving fails. */ }
  };

  const actionLink = ({ href, label, icon: Icon }) => {
    const selected = pathname === href || (href !== '/' && pathname.startsWith(href));
    const hasUnread = href === '/messages' && unreadTotal > 0;
    return <Link key={href} href={href} onClick={() => setMobileMenu(false)} aria-current={selected ? 'page' : undefined} title={label} className={`group flex items-center gap-4 rounded-2xl px-4 py-3.5 text-[15px] transition-colors focus-visible:outline-offset-2 ${selected ? 'bg-mint font-semibold text-ink shadow-sm' : 'text-ink/70 hover:bg-mint/60 hover:text-ink'}`}>
      <span className="relative shrink-0"><Icon size={21} strokeWidth={selected ? 2.4 : 1.8} />{hasUnread && <span aria-label={`${unreadTotal} unread messages`} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-paper bg-coral" />}</span>
      <span className="lg:max-xl:sr-only xl:inline">{label}</span>
    </Link>;
  };

  const renderNotification = (item) => {
    const action = notificationActions[item.id];
    const busy = Boolean(notificationBusy[item.id]);
    const isRequest = item.type === 'FOLLOW_REQUEST';
    const isPostActivity = ['LIKE', 'COMMENT', 'COMMENT_LIKE', 'MENTION', 'REPLY'].includes(item.type);
    const targetHref = item.type === 'STORY_REPLY' ? '/messages' : isPostActivity && item.entityId ? `/post/${item.entityId}` : item.actor?.username ? `/profile/${item.actor.username}` : '/';
    const description = item.type === 'FOLLOW' ? 'started following you' : isRequest ? 'requested to follow you' : item.type === 'LIKE' ? 'liked your post' : item.type === 'COMMENT_LIKE' ? 'liked your comment' : item.type === 'COMMENT' ? 'commented on your post' : item.type === 'REPLY' ? 'replied to your comment' : item.type === 'MENTION' ? 'mentioned you' : item.type === 'STORY_REPLY' ? 'replied to your story' : 'viewed your story';
    return <article key={item.id} className="border-b border-line py-3">
      <div className="flex items-start gap-3"><Avatar src={item.actor?.image} name={item.actor?.username} size="xs" /><Link href={targetHref} onClick={() => { void markNotificationAsRead(item); setNotificationsOpen(false); }} className="min-w-0 flex-1 text-left text-sm"><p><b>@{item.actor?.username || 'someone'}</b> {description}</p>{!item.readAt && !action && <span className="mt-1 inline-block h-2 w-2 rounded-full bg-coral" />}</Link></div>
      {isRequest && !action && item.followRequestId && <div className="ml-11 mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => void resolveFollowRequest(item, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check size={14} />Accept</button><button type="button" disabled={busy} onClick={() => void resolveFollowRequest(item, false)} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-50">Decline</button></div>}
      {isRequest && action?.state === 'accepted' && <div className="ml-11 mt-2">{action.following ? <span className="inline-flex items-center gap-1.5 rounded-lg bg-mint px-3 py-2 text-xs font-semibold text-moss"><Check size={14} />Following</span> : action.pending ? <span className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink/60">Requested</span> : <button type="button" disabled={busy} onClick={() => void followBack(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><UserPlus size={14} />Follow back</button>}</div>}
      {isRequest && !action && !item.followRequestId && <div className="ml-11 mt-2"><Link href="/settings" onClick={() => setNotificationsOpen(false)} className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-xs font-semibold">Review in settings</Link></div>}
      {isRequest && action?.state === 'declined' && <p className="ml-11 mt-2 text-xs text-ink/45">Request declined.</p>}
    </article>;
  };

  return <div className="mx-auto min-h-screen max-w-[1680px]">
    <aside className="glass-nav glass-floating fixed inset-y-4 left-[max(12px,calc((100vw-1680px)/2+12px))] z-30 hidden w-[72px] flex-col rounded-[28px] border px-2 py-6 lg:flex xl:w-[228px] xl:px-3 xl:py-7">
      <Link href="/" aria-label="Gather home" className="mb-10 flex items-center justify-center gap-2 px-1 xl:justify-start xl:px-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-moss text-white shadow-sm"><Sparkles size={19} /></span><span className="hidden text-[22px] font-bold tracking-tight xl:inline">gather<span className="text-coral">.</span></span></Link>
      <nav aria-label="Primary navigation" className="grid gap-1">
        {links.slice(0, 2).map(actionLink)}
        <div className="my-2 h-px bg-line/80" />
        {links.slice(2).map(actionLink)}
        <button type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-pressed={notificationsOpen} title="Activity" className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left text-[15px] transition-colors hover:bg-mint/60 ${notificationsOpen ? 'bg-mint font-semibold text-ink' : 'text-ink/70'}`}><span className="relative shrink-0"><Bell size={21} />{unreadNotifications > 0 && <span aria-label={`${unreadNotifications} unread updates`} className="absolute -right-3 -top-2 min-w-4 rounded-full bg-coral px-1 text-center text-[9px] font-bold leading-4 text-white">{unreadNotifications > 99 ? '99+' : unreadNotifications}</span>}</span><span className="lg:max-xl:sr-only xl:inline">Activity</span></button>
        <button type="button" onClick={() => { setMobileMenu(false); setCreateMenuOpen(true); }} title="Create" className="flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left text-[15px] text-ink/70 transition-colors hover:bg-mint/60"><Plus size={21} /><span className="lg:max-xl:sr-only xl:inline">Create</span></button>
        {isAdmin && <Link href="/admin/reports" className="flex items-center gap-4 rounded-2xl px-4 py-3.5 text-[15px] text-ink/70 transition-colors hover:bg-mint/60"><ShieldCheck size={21} /><span className="lg:max-xl:sr-only xl:inline">Reports</span></Link>}
        <Link href={me?.username ? `/profile/${me.username}` : '/login'} aria-current={pathname.startsWith('/profile') ? 'page' : undefined} title="Profile" className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] transition-colors hover:bg-mint/60 ${pathname.startsWith('/profile') ? 'bg-mint font-semibold' : 'text-ink/70'}`}><Avatar src={me?.image} name={me?.name || me?.email} size="xs" /><span className="lg:max-xl:sr-only xl:inline">Profile</span></Link>
      </nav>
      <div className="mt-auto grid gap-2"><Link href="/settings" title="Settings" className="flex items-center gap-4 rounded-2xl px-4 py-3 text-sm text-ink/70 transition-colors hover:bg-mint/60"><Settings size={20} /><span className="lg:max-xl:sr-only xl:inline">Settings</span></Link>{me ? <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} title="Sign out" className="flex items-center gap-4 rounded-2xl px-4 py-3 text-left text-sm text-ink/70 transition-colors hover:bg-mint/60"><LogOut size={20} /><span className="lg:max-xl:sr-only xl:inline">Sign out</span></button> : <Link href="/login" className="rounded-2xl bg-moss px-4 py-3 text-center text-sm font-semibold text-white">Sign in</Link>}</div>
    </aside>

    <header className="glass-nav glass-primary sticky top-0 z-20 flex h-16 items-center justify-between border-b px-4 lg:hidden"><button type="button" aria-label={mobileMenu ? 'Close menu' : 'Open menu'} onClick={() => setMobileMenu((open) => !open)} className="grid h-11 w-11 place-items-center rounded-xl hover:bg-mint/60">{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button><Link href="/" className="text-xl font-bold tracking-tight">gather<span className="text-coral">.</span></Link><Link href="/search" aria-label="Search" className="grid h-11 w-11 place-items-center rounded-xl hover:bg-mint/60"><Search size={19} /></Link><Link href={me?.username ? `/profile/${me.username}` : '/login'} aria-label="Profile"><Avatar src={me?.image} name={me?.name || me?.email} size="xs" /></Link></header>
    {mobileMenu && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-40 bg-ink/35 backdrop-blur-md lg:hidden" onClick={() => setMobileMenu(false)}><nav aria-label="Mobile navigation" onClick={(event) => event.stopPropagation()} className="glass-nav glass-surface-strong h-full w-[min(320px,86vw)] border-r p-5 shadow-float"><Link href="/" onClick={() => setMobileMenu(false)} className="mb-7 block text-xl font-bold">gather<span className="text-coral">.</span></Link><div className="grid gap-1">{links.map(actionLink)}<button type="button" onClick={() => { setMobileMenu(false); setCreateMenuOpen(true); }} className="flex items-center gap-4 rounded-xl px-4 py-3 text-ink/70"><Plus size={20} />Create</button><Link href="/settings" className="flex items-center gap-4 rounded-xl px-4 py-3 text-ink/70"><Settings size={20} />Settings</Link>{me && <button type="button" onClick={() => signOut({ callbackUrl: '/login' })} className="flex items-center gap-4 rounded-xl px-4 py-3 text-ink/70"><LogOut size={20} />Sign out</button>}</div></nav></div>, document.body)}

    <main className="min-h-[calc(100vh-64px)] px-4 pb-24 pt-6 lg:ml-[100px] lg:min-h-screen lg:px-8 lg:py-8 xl:ml-[252px] xl:px-10 xl:py-9"><div className="mb-4 hidden justify-end lg:flex"><Link href="/search" className="command-search flex min-h-11 items-center gap-2 rounded-full border border-line bg-surface/75 px-4 text-sm text-ink/50 shadow-sm transition hover:bg-surface hover:text-ink"><Search size={16} />Search Gather<span className="ml-4 rounded-md border border-line px-1.5 py-0.5 text-[10px]">/</span></Link></div>{children}</main>
    <nav aria-label="Mobile primary navigation" className="glass-nav glass-floating fixed inset-x-0 bottom-0 z-30 flex justify-around border-t px-2 py-2 lg:hidden">{links.filter(({ href }) => href !== '/search').map(({ href, label, icon: Icon }) => { const selected = pathname === href; return <Link key={href} href={href} aria-label={label} aria-current={selected ? 'page' : undefined} className={`grid min-w-12 place-items-center rounded-xl p-2 transition-colors ${selected ? 'bg-mint text-moss' : 'text-ink/65'}`}><span className="relative"><Icon size={22} strokeWidth={selected ? 2.5 : 1.8} />{href === '/messages' && unreadTotal > 0 && <span aria-label={`${unreadTotal} unread messages`} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-paper bg-coral" />}</span></Link>; })}<button type="button" aria-label="Activity" onClick={() => setNotificationsOpen((open) => !open)} className="grid min-w-12 place-items-center rounded-xl p-2 text-ink/65"><span className="relative"><Bell size={22} />{unreadNotifications > 0 && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-paper bg-coral" />}</span></button><Link href={me?.username ? `/profile/${me.username}` : "/login"} aria-label="Profile" className="grid min-w-12 place-items-center rounded-xl p-1 text-ink/65"><Avatar src={me?.image} name={me?.username || me?.name} size="xs" /></Link><button type="button" aria-label="Create" onClick={() => setCreateMenuOpen(true)} className="grid min-w-12 place-items-center rounded-xl p-2 text-ink/65"><Plus size={22} /></button></nav>

    {notificationsOpen && typeof document !== 'undefined' && createPortal(<div className="fixed inset-0 z-40 bg-ink/10 backdrop-blur-md" onClick={() => setNotificationsOpen(false)}><section aria-label="Updates" onClick={(event) => event.stopPropagation()} className="glass-nav glass-surface-strong absolute bottom-16 left-3 max-h-[70vh] w-[min(420px,94vw)] overflow-auto rounded-3xl border p-5 shadow-float lg:bottom-auto lg:left-2 lg:top-24 lg:w-[240px] xl:left-[max(0px,calc((100vw-1680px)/2))] xl:w-[248px]"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Updates</h2><div className="flex items-center gap-3"><button type="button" onClick={() => void markAllRead()} className="text-xs font-medium text-moss">Mark all read</button><button type="button" onClick={() => setNotificationsOpen(false)} aria-label="Close updates" className="grid h-10 w-10 place-items-center rounded-xl hover:bg-mint/60"><X size={19} /></button></div></div>{notifications.length ? notifications.map(renderNotification) : <p className="py-8 text-center text-sm text-ink/55">You’re all caught up.</p>}</section></div>, document.body)}
    {createMenuOpen && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="create-menu-title" className="fixed inset-0 z-[70] grid place-items-center bg-ink/45 backdrop-blur-md p-4" onMouseDown={(event) => event.target === event.currentTarget && setCreateMenuOpen(false)}><section className="glass-nav glass-surface-strong w-full max-w-sm rounded-3xl border p-5 shadow-float"><header className="mb-3 flex items-center justify-between"><h2 id="create-menu-title" className="text-lg font-bold">Create</h2><button type="button" aria-label="Close create menu" onClick={() => setCreateMenuOpen(false)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-mint/60"><X size={18} /></button></header><div className="grid gap-2"><button type="button" onClick={() => { setCreateMenuOpen(false); setCompose(true); }} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left font-semibold transition-colors hover:bg-mint/60"><Plus size={20} className="text-moss" />Create Post</button><button type="button" onClick={openStoryComposer} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left font-semibold transition-colors hover:bg-mint/60"><House size={20} className="text-moss" />Create Story</button><button type="button" onClick={() => { setCreateMenuOpen(false); setReelComposeOpen(true); }} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3 text-left font-semibold transition-colors hover:bg-mint/60"><Video size={20} className="text-moss" />Create Reel</button></div></section></div>, document.body)}
    {compose && <Composer onClose={() => setCompose(false)} />}
    {reelComposeOpen && <ReelComposer onClose={() => setReelComposeOpen(false)} />}
  </div>;
}


