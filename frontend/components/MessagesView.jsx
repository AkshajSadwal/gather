'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowUp, MessageCircle, MoreHorizontal, Search } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { api } from '../lib/api';
import Avatar from './Avatar';
import { useRealtime, useUnreadMessages } from '../lib/realtime';
import { useToast } from './Providers';
import CallOverlay from './MediasoupCallOverlay';

export default function MessagesView({ initialTo = '' }) {
  const { data: session } = useSession();
  const socket = useRealtime();
  const { unreadByConversation, markConversationRead } = useUnreadMessages();
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState('');
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [search, setSearch] = useState(initialTo);
  const [typing, setTyping] = useState(false);
  const [unsending, setUnsending] = useState('');
  const [online, setOnline] = useState({});
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const notify = useToast();
  const active = conversations.find((item) => item.id === activeId) || null;
  const other = useMemo(() => active?.participants?.find((item) => item.userId !== session?.user?.id)?.user, [active, session?.user?.id]);

  const loadConversations = async () => {
    try { const data = await api('/messages/conversations'); setConversations(data.conversations || []); }
    catch (error) { notify(error.message, 'error'); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (session) loadConversations(); }, [session]);
  useEffect(() => {
    if (!initialTo || !session) return;
    api(`/messages/conversations/${encodeURIComponent(initialTo)}`, { method: 'POST' }).then(async (data) => { await loadConversations(); setActiveId(data.conversation.id); }).catch((error) => notify(error.message, 'error'));
  }, [initialTo, session]);
  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let cancelled = false;
    api(`/messages/conversations/${activeId}`).then((data) => { if (!cancelled) setMessages(data.messages || []); }).catch((error) => notify(error.message, 'error'));
    api(`/messages/conversations/${activeId}/read`, { method: 'POST' }).then(() => {
      if (!cancelled) {
        markConversationRead(activeId);
        setConversations((all) => all.map((conversation) => conversation.id === activeId ? { ...conversation, unreadCount: 0 } : conversation));
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeId, markConversationRead]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, typing]);

  useEffect(() => {
    if (!socket) return;
    const onOnline = ({ userId }) => setOnline((value) => ({ ...value, [userId]: true }));
    const onOffline = ({ userId }) => setOnline((value) => ({ ...value, [userId]: false }));
    const onMessage = (message) => {
      if (message.conversationId !== activeId) { loadConversations(); return; }
      setMessages((all) => all.some((item) => item.id === message.id) ? all : [...all, message]);
      if (message.senderId !== session?.user?.id) {
        markConversationRead(activeId);
        api(`/messages/conversations/${activeId}/read`, { method: 'POST' }).catch(() => {});
        setConversations((all) => all.map((conversation) => conversation.id === activeId ? { ...conversation, unreadCount: 0 } : conversation));
      }
      loadConversations();
    };
    const onRead = ({ conversationId, userId, readAt }) => { if (conversationId === activeId) setMessages((all) => all.map((message) => message.senderId === session?.user?.id ? { ...message, reads: [...(message.reads || []), { userId, readAt }] } : message)); };
    const onDeleted = ({ conversationId, messageId }) => { if (conversationId === activeId) setMessages((all) => all.map((message) => message.id === messageId ? { ...message, body: '', deletedAt: new Date().toISOString() } : message)); loadConversations(); };
    const onTyping = ({ conversationId, userId }) => { if (conversationId === activeId && userId !== session?.user?.id) setTyping(true); };
    const onStop = ({ conversationId }) => { if (conversationId === activeId) setTyping(false); };
    socket.on('user:online', onOnline); socket.on('user:offline', onOffline); socket.on('message:received', onMessage); socket.on('message:deleted', onDeleted); socket.on('message:delivered', () => loadConversations()); socket.on('message:read', onRead); socket.on('typing:start', onTyping); socket.on('typing:stop', onStop);
    return () => { socket.off('user:online', onOnline); socket.off('user:offline', onOffline); socket.off('message:received', onMessage); socket.off('message:deleted', onDeleted); socket.off('message:delivered'); socket.off('message:read', onRead); socket.off('typing:start', onTyping); socket.off('typing:stop', onStop); };
  }, [socket, activeId, session?.user?.id]);

  const startConversation = async (event) => {
    event.preventDefault(); if (!search.trim()) return;
    try { const result = await api(`/messages/conversations/${encodeURIComponent(search.trim().replace(/^@/, ''))}`, { method: 'POST' }); await loadConversations(); setActiveId(result.conversation.id); setSearch(''); }
    catch (error) { notify(error.message, 'error'); }
  };
  const send = (event) => {
    event.preventDefault(); const body = text.trim();
    if (!body || !activeId || !socket?.connected) { if (body && !socket?.connected) notify('Reconnecting to messages…', 'error'); return; }
    socket.emit('message:send', { conversationId: activeId, body }, (result) => { if (result?.error) notify(result.error.message, 'error'); });
    setText(''); socket.emit('typing:stop', { conversationId: activeId });
  };
  const onText = (value) => { setText(value); if (!activeId || !socket) return; socket.emit(value ? 'typing:start' : 'typing:stop', { conversationId: activeId }); clearTimeout(typingTimer.current); typingTimer.current = setTimeout(() => socket.emit('typing:stop', { conversationId: activeId }), 1400); };

  const unsend = async (message) => {
    if (unsending || message.deletedAt || message.senderId !== session?.user?.id) return;
    setUnsending(message.id);
    try {
      await api(`/messages/${encodeURIComponent(message.id)}`, { method: 'DELETE' });
      setMessages((all) => all.map((item) => item.id === message.id ? { ...item, body: '', deletedAt: new Date().toISOString() } : item));
      await loadConversations();
    } catch (error) { notify(error.message, 'error'); }
    finally { setUnsending(''); }
  };

  return <div className="mx-auto max-w-6xl"><header className="mb-5"><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">Private conversations</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Messages</h1></header><section className="grid h-[min(76vh,760px)] min-h-[520px] overflow-hidden rounded-[26px] border border-line bg-white shadow-sm md:grid-cols-[300px_minmax(0,1fr)]">
    <aside className={`${activeId ? 'hidden md:flex' : 'flex'} min-h-0 flex-col border-r border-line`}><div className="border-b border-line p-4"><h2 className="text-lg font-semibold">Your messages</h2><form onSubmit={startConversation} className="mt-3 flex items-center gap-2 rounded-xl bg-paper px-3 py-2.5"><Search size={16} className="text-ink/40" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Start with a username" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></form></div><div className="min-h-0 flex-1 overflow-auto p-2">{loading ? <div className="space-y-2 p-2">{[0, 1, 2].map((n) => <div key={n} className="skeleton h-16 rounded-xl" />)}</div> : conversations.map((conversation) => {
      const person = conversation.participants?.find((item) => item.userId !== session?.user?.id)?.user;
      const last = conversation.messages?.[0];
      const unreadCount = unreadByConversation[conversation.id] ?? conversation.unreadCount ?? 0;
      return <button key={conversation.id} onClick={() => setActiveId(conversation.id)} className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition ${activeId === conversation.id ? 'bg-mint/60' : 'hover:bg-paper'}`}><span className="relative"><Avatar src={person?.image} name={person?.username} size="sm" />{online[person?.id] && <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-[#49b879]" />}</span><span className="min-w-0 flex-1"><b className="block truncate text-sm">{person?.username || 'Conversation'}</b><span className={`block truncate text-xs ${unreadCount ? 'font-semibold text-ink' : 'text-ink/50'}`}>{last ? (last.deletedAt ? 'Message unsent' : `${last.senderId === session?.user?.id ? 'You: ' : ''}${last.body}`) : 'Say hello'}</span></span>{unreadCount > 0 && <span aria-label={`${unreadCount} unread messages from ${person?.username || 'this user'}`} className="grid min-w-5 h-5 place-items-center rounded-full bg-red-500 px-1.5 text-[10px] font-bold leading-none text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>;
    })}{!loading && !conversations.length && <div className="p-6 text-center"><MessageCircle className="mx-auto text-moss/50" /><p className="mt-3 text-sm font-medium">No conversations yet</p><p className="mt-1 text-xs leading-5 text-ink/50">Search for a username above to send a private message.</p></div>}</div><p className="border-t border-line px-4 py-3 text-[11px] text-ink/35">Messages stay between conversation participants.</p></aside>
    <div className={`${activeId ? 'flex' : 'hidden md:flex'} min-h-0 flex-col`}>
      {active ? <><header className="flex items-center gap-3 border-b border-line px-4 py-3"><button onClick={() => setActiveId('')} aria-label="Back to messages" className="rounded-full p-2 hover:bg-paper md:hidden"><ArrowLeft size={19} /></button><Link href={`/profile/${other?.username}`}><Avatar src={other?.image} name={other?.username} size="sm" /></Link><div className="min-w-0 flex-1"><Link href={`/profile/${other?.username}`} className="text-sm font-semibold">@{other?.username}</Link><p className="text-xs text-ink/45">{online[other?.id] ? 'Active now' : socket?.connected ? 'Away' : 'Reconnecting…'}</p></div><div id="call-controls" className="ml-auto flex items-center gap-1" /><button aria-label="Conversation options" className="rounded-full p-2 text-ink/45"><MoreHorizontal size={19} /></button></header>
        <div className="hide-scrollbar flex-1 space-y-3 overflow-auto bg-[#fcfdfa] p-4 sm:p-6">{messages.map((message) => { const mine = message.senderId === session?.user?.id; return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${mine ? 'rounded-br-md bg-moss text-white' : 'rounded-bl-md bg-white text-ink shadow-sm'}`}><p className="whitespace-pre-wrap break-words text-sm leading-6">{message.deletedAt ? 'Message unsent' : message.body}</p><p className={`mt-1 text-right text-[10px] ${mine ? 'text-white/55' : 'text-ink/40'}`}>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{mine && <span className="ml-1">{message.reads?.some((read) => read.userId !== session?.user?.id) ? '· Seen' : message.deliveredAt || message.delivered ? '· Delivered' : '· Sent'}</span>}</p>{mine && !message.deletedAt && <button type="button" disabled={Boolean(unsending)} onClick={() => void unsend(message)} className={`mt-1 block text-right text-[10px] underline ${mine ? 'text-white/60' : 'text-ink/40'} disabled:opacity-40`}>{unsending === message.id ? 'Unsending…' : 'Unsend'}</button>}</div></div>; })}{typing && <p className="text-xs text-ink/45">@{other?.username} is typing…</p>}<div ref={bottomRef} /></div>
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line p-3"><textarea value={text} onChange={(event) => onText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} rows={1} maxLength={4000} placeholder="Write a message…" className="max-h-28 min-h-11 flex-1 resize-y rounded-2xl bg-paper px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-moss" /><button disabled={!text.trim()} aria-label="Send message" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-moss text-white disabled:opacity-40"><ArrowUp size={19} /></button></form>
      </> : <div className="grid flex-1 place-items-center p-8 text-center"><div><span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-mint text-moss"><MessageCircle size={26} /></span><h2 className="mt-4 font-semibold">Your conversations belong here</h2><p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-ink/50">Choose a conversation or search for a person to start a private chat.</p></div></div>}
    </div>
  </section><CallOverlay socket={socket} conversation={active} currentUserId={session?.user?.id} /><p className="mt-3 text-center text-xs text-ink/35">Voice and video calls use your browser’s microphone and camera permissions.</p></div>;
}
