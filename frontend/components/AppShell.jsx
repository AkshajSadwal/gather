'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Bell, Check, Compass, House, LogOut, Menu, MessageCircle, Plus, Search, Settings, Sparkles, UserPlus, Video, X } from 'lucide-react';
import Avatar from './Avatar';
import Composer from './Composer';
import { api } from '../lib/api';
import { useUnreadMessages, useUnreadNotifications } from '../lib/realtime';

const links = [
  { href: '/', label: 'Home', icon: House }, { href: '/explore', label: 'Explore', icon: Compass },
  { href: '/search', label: 'Search', icon: Search }, { href: '/reels', label: 'Reels', icon: Video },
  { href: '/messages', label: 'Messages', icon: MessageCircle }
];

export default function AppShell({ children, right = false }) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [compose, setCompose] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationActions, setNotificationActions] = useState({});
  const [mobileMenu, setMobileMenu] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState({});
  const me = session?.user;
  const { unreadTotal } = useUnreadMessages();
  const { unreadNotifications, markNotificationRead, markAllNotificationsRead } = useUnreadNotifications();

  useEffect(() => {
    const listener = () => setCompose(true);
    window.addEventListener('social:compose', listener);
    return () => window.removeEventListener('social:compose', listener);
  }, []);

  useEffect(() => {
    if (!notificationsOpen || !me) return;
    let cancelled = false;
    api('/notifications')
      .then((data) => {
        if (!cancelled) setNotifications(data.notifications || []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [notificationsOpen, me]);

  const actionLink = (href, label, icon, selected = false) => {
    const Icon = icon;
    const showUnread = href === '/messages' && unreadTotal > 0;
    return <Link key={href} href={href} onClick={() => setMobileMenu(false)} className={`flex items-center gap-4 rounded-2xl px-4 py-3.5 text-[15px] transition ${selected ? 'bg-white font-semibold text-ink shadow-sm' : 'text-ink/75 hover:bg-white hover:text-ink'}`}>
      <span className="relative"><Icon size={21} strokeWidth={selected ? 2.5 : 1.8} />{showUnread && <span aria-label={`${unreadTotal} unread messages`} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-paper bg-red-500" />}</span>
      <span>{label}</span>
    </Link>;
  };

  const markNotificationAsRead = async (item) => {
    if (item.readAt) return true;
    try {
      await api(`/notifications/${item.id}/read`, { method: 'POST' });
      setNotifications((all) => all.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row));
      markNotificationRead();
      return true;
    } catch {
      return false;
    }
  };

  const resolveFollowRequest = async (item, accepted) => {
    const requestId = item.followRequestId;
    if (!requestId || notificationBusy[item.id]) return;
    setNotificationBusy((all) => ({ ...all, [item.id]: true }));
    try {
      const result = await api(`/follows/requests/${encodeURIComponent(requestId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ accepted })
      });
      await markNotificationAsRead(item);
      setNotificationActions((all) => ({
        ...all,
        [item.id]: accepted
          ? { state: 'accepted', following: Boolean(result.followingBack), pending: Boolean(result.followBackPending) }
          : { state: 'declined', following: false, pending: false }
      }));
      setNotifications((all) => all.map((row) => row.id === item.id ? { ...row, readAt: row.readAt || new Date().toISOString() } : row));
    } catch {
      // Leave the request actionable so a transient API error can be retried.
    } finally {
      setNotificationBusy((all) => ({ ...all, [item.id]: false }));
    }
  };

  const followBack = async (item) => {
    if (!item.actor?.username || notificationBusy[item.id]) return;
    setNotificationBusy((all) => ({ ...all, [item.id]: true }));
    try {
      const result = await api(`/follows/${encodeURIComponent(item.actor.username)}/toggle`, { method: 'POST' });
      setNotificationActions((all) => ({
        ...all,
        [item.id]: { state: 'accepted', following: Boolean(result.following), pending: Boolean(result.pending) }
      }));
    } catch {
      // Keep the button available when the follow-back request fails.
    } finally {
      setNotificationBusy((all) => ({ ...all, [item.id]: false }));
    }
  };

  const markAllRead = async () => {
    try {
      await api('/notifications/all/read', { method: 'POST' });
      const now = new Date().toISOString();
      setNotifications((all) => all.map((item) => ({ ...item, readAt: item.readAt || now })));
      markAllNotificationsRead();
    } catch {}
  };

  const renderNotification = (item) => {
    const action = notificationActions[item.id];
    const busy = Boolean(notificationBusy[item.id]);
    const isRequest = item.type === 'FOLLOW_REQUEST';

    return <div key={item.id} className="border-b border-line py-3">
      <div className="flex items-start gap-3">
        <Avatar src={item.actor?.image} name={item.actor?.username} size="xs" />
        <button
          type="button"
          onClick={() => markNotificationAsRead(item)}
          className="min-w-0 flex-1 text-left text-sm"
        >
          <p><b>{item.actor?.username || 'Someone'}</b> {item.type === 'FOLLOW' ? 'started following you' : isRequest ? 'requested to follow you' : item.type === 'LIKE' ? 'liked your post' : item.type === 'COMMENT' ? 'commented on your post' : item.type === 'MENTION' ? 'mentioned you' : 'viewed your story'}</p>
          {!item.readAt && !action && <span className="mt-1 inline-block h-2 w-2 rounded-full bg-coral" />}
        </button>
      </div>

      {isRequest && !action && item.followRequestId && (
        <div className="ml-11 mt-2 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => resolveFollowRequest(item, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
            <Check size={14} />Accept
          </button>
          <button type="button" disabled={busy} onClick={() => resolveFollowRequest(item, false)} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold disabled:opacity-50">Decline</button>
        </div>
      )}

      {isRequest && !action && !item.followRequestId && (
        <div className="ml-11 mt-2">
          <Link href="/settings" onClick={() => setNotificationsOpen(false)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-semibold">
            Review in settings
          </Link>
        </div>
      )}

      {isRequest && action?.state === 'accepted' && (
        <div className="ml-11 mt-2 flex items-center gap-2">
          {action.following ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-mint px-3 py-2 text-xs font-semibold text-moss"><Check size={14} />Following</span>
          ) : action.pending ? (
            <span className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink/60">Requested</span>
          ) : (
            <button type="button" disabled={busy} onClick={() => followBack(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
              <UserPlus size={14} />Follow back
            </button>
          )}
        </div>
      )}

      {isRequest && action?.state === 'declined' && (
        <div className="ml-11 mt-2 text-xs text-ink/45">Request declined.</div>
      )}
    </div>;
  };

  return <div className="mx-auto min-h-screen max-w-[1440px]">
    <aside className="fixed inset-y-0 left-[max(0px,calc((100vw-1440px)/2))] z-30 hidden w-[248px] flex-col border-r border-line bg-paper px-4 py-8 lg:flex">
      <Link href="/" className="mb-10 flex items-center gap-2 px-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-moss text-white"><Sparkles size={19} /></span><span className="text-[22px] font-bold tracking-tight">gather<span className="text-coral">.</span></span></Link>
      <nav className="grid gap-1">
        {links.map(({ href, label, icon }) => actionLink(href, label, icon, pathname === href || (href !== '/' && pathname.startsWith(href))))}
        <button onClick={() => setNotificationsOpen(!notificationsOpen)} className="flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left text-[15px] text-ink/75 transition hover:bg-white">
          <span className="relative"><Bell size={21} strokeWidth={1.8} />{unreadNotifications > 0 && <span aria-label={`${unreadNotifications} unread updates`} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-paper bg-red-500" />}</span>Updates
        </button>
        <button onClick={() => setCompose(true)} className="flex items-center gap-4 rounded-2xl px-4 py-3.5 text-left text-[15px] text-ink/75 transition hover:bg-white"><Plus size={21} />Create</button>
        <Link href={me?.username ? `/profile/${me.username}` : '/login'} className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-[15px] transition hover:bg-white ${pathname.startsWith('/profile') ? 'bg-white font-semibold' : 'text-ink/75'}`}><Avatar src={me?.image} name={me?.name || me?.email} size="xs" /><span>Profile</span></Link>
      </nav>
      <div className="mt-auto grid gap-2">
        <Link href="/settings" className="flex items-center gap-4 rounded-2xl px-4 py-3 text-sm text-ink/70 hover:bg-white"><Settings size={20} />Settings</Link>
        {me ? <button onClick={() => signOut({ callbackUrl: '/login' })} className="flex items-center gap-4 rounded-2xl px-4 py-3 text-left text-sm text-ink/70 hover:bg-white"><LogOut size={20} />Sign out</button> : <Link href="/login" className="rounded-2xl bg-moss px-4 py-3 text-center text-sm font-semibold text-white">Sign in</Link>}
      </div>
    </aside>

    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-paper/95 px-4 backdrop-blur lg:hidden">
      <button aria-label="Open menu" onClick={() => setMobileMenu(!mobileMenu)} className="rounded-full p-2">{mobileMenu ? <X size={21} /> : <Menu size={21} />}</button><Link href="/" className="text-xl font-bold tracking-tight">gather<span className="text-coral">.</span></Link><Link href={me?.username ? `/profile/${me.username}` : '/login'} aria-label="Profile"><Avatar src={me?.image} name={me?.name || me?.email} size="xs" /></Link>
    </header>
    {mobileMenu && <div className="fixed inset-0 z-40 bg-black/25 lg:hidden" onClick={() => setMobileMenu(false)}><nav onClick={(event) => event.stopPropagation()} className="h-full w-72 bg-paper p-5 shadow-xl"><Link href="/" className="mb-7 block text-xl font-bold">gather<span className="text-coral">.</span></Link><div className="grid gap-1">{links.map(({ href, label, icon }) => actionLink(href, label, icon, pathname === href))}<button onClick={() => setCompose(true)} className="flex items-center gap-4 rounded-xl px-4 py-3"><Plus size={20} />Create</button>{me && <button onClick={() => signOut({ callbackUrl: '/login' })} className="flex items-center gap-4 rounded-xl px-4 py-3"><LogOut size={20} />Sign out</button>}</div></nav></div>}

    <main className={`min-h-[calc(100vh-64px)] px-4 pb-24 pt-6 lg:ml-[248px] lg:min-h-screen lg:px-10 lg:py-9 ${right ? 'xl:mr-[300px]' : ''}`}>{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-line bg-white/95 px-2 py-2 backdrop-blur lg:hidden">{links.filter(({ href }) => href !== '/search').map(({ href, label, icon }) => { const Icon = icon; return <Link aria-label={label} key={href} href={href} className={`grid min-w-12 place-items-center rounded-xl p-2 ${pathname === href ? 'text-moss' : 'text-ink/65'}`}><span className="relative"><Icon size={22} strokeWidth={pathname === href ? 2.5 : 1.8} />{href === '/messages' && unreadTotal > 0 && <span aria-label={`${unreadTotal} unread messages`} className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />}</span></Link>; })}<button aria-label="Create" onClick={() => setCompose(true)} className="grid min-w-12 place-items-center rounded-xl p-2 text-ink/65"><Plus size={22} /></button></nav>

    {notificationsOpen && <div className="fixed inset-0 z-40 bg-black/10" onClick={() => setNotificationsOpen(false)}><section onClick={(e) => e.stopPropagation()} className="absolute bottom-16 left-3 max-h-[70vh] w-[min(420px,94vw)] overflow-auto rounded-3xl border border-line bg-white p-5 shadow-soft lg:bottom-6 lg:left-[260px]">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-semibold">Updates</h2><div className="flex gap-3"><button onClick={markAllRead} className="text-xs font-medium text-moss">Mark all read</button><button onClick={() => setNotificationsOpen(false)} aria-label="Close"><X size={19} /></button></div></div>
      {notifications.length ? notifications.map(renderNotification) : <p className="py-8 text-center text-sm text-ink/55">You’re all caught up.</p>}
    </section></div>}
    {compose && <Composer onClose={() => setCompose(false)} />}
  </div>;
}
