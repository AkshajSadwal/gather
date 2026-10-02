'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import { API_URL, api } from './api';

const RealtimeContext = createContext({ socket: null, unreadByConversation: {}, unreadTotal: 0, refreshUnread: async () => {}, markConversationRead: () => {} });

export function RealtimeProvider({ children }) {
  const { status, data: session } = useSession();
  const [socket, setSocket] = useState(null);
  const [unreadByConversation, setUnreadByConversation] = useState({});

  const refreshUnread = useCallback(async () => {
    if (status !== 'authenticated') {
      setUnreadByConversation({});
      return;
    }
    try {
      const data = await api('/messages/unread');
      setUnreadByConversation(data.unreadByConversation || {});
    } catch {
      // Keep the current badge state if a background refresh temporarily fails.
    }
  }, [status]);

  const markConversationRead = useCallback((conversationId) => {
    if (!conversationId) return;
    setUnreadByConversation((current) => {
      if (!current[conversationId]) return current;
      const next = { ...current };
      delete next[conversationId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setSocket(null);
      setUnreadByConversation({});
      return undefined;
    }
    const connection = io(API_URL, {
      withCredentials: true,
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000
    });
    const onConnect = () => { void refreshUnread(); };
    const onMessage = (message = {}) => {
      if (!message.conversationId || message.senderId === session?.user?.id) return;
      setUnreadByConversation((current) => ({
        ...current,
        [message.conversationId]: Number(message.unreadCount ?? ((current[message.conversationId] || 0) + 1))
      }));
    };
    const onFocus = () => { void refreshUnread(); };
    connection.on('connect', onConnect);
    connection.on('message:received', onMessage);
    setSocket(connection);
    void refreshUnread();
    window.addEventListener('focus', onFocus);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') void refreshUnread(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      connection.off('connect', onConnect);
      connection.off('message:received', onMessage);
      connection.removeAllListeners();
      connection.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      setSocket(null);
    };
  }, [status, session?.user?.id, refreshUnread]);

  const unreadTotal = useMemo(() => Object.values(unreadByConversation).reduce((sum, count) => sum + Number(count || 0), 0), [unreadByConversation]);
  const value = useMemo(() => ({ socket, unreadByConversation, unreadTotal, refreshUnread, markConversationRead }), [socket, unreadByConversation, unreadTotal, refreshUnread, markConversationRead]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext).socket;
}

export function useUnreadMessages() {
  const { unreadByConversation, unreadTotal, refreshUnread, markConversationRead } = useContext(RealtimeContext);
  return { unreadByConversation, unreadTotal, refreshUnread, markConversationRead };
}
