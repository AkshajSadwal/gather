'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import { API_URL, api } from './api';

const RealtimeContext = createContext({ socket: null, unreadByConversation: {}, unreadTotal: 0, unreadNotifications: 0, refreshUnread: async () => {}, refreshNotifications: async () => {}, markConversationRead: () => {}, markNotificationRead: () => {}, markAllNotificationsRead: () => {} });

export function RealtimeProvider({ children }) {
  const { status, data: session } = useSession();
  const [socket, setSocket] = useState(null);
  const [unreadByConversation, setUnreadByConversation] = useState({});
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const refreshNotifications = useCallback(async () => {
    if (status !== 'authenticated') { setUnreadNotifications(0); return; }
    try { const data = await api('/notifications/unread'); setUnreadNotifications(Number(data.total || 0)); } catch {}
  }, [status]);

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
    const onConnect = () => { void refreshUnread(); void refreshNotifications(); };
    const onNotification = (notification = {}) => {
      if (!notification.id || notification.readAt) return;
      setUnreadNotifications((count) => count + 1);
    };
    const onMessage = (message = {}) => {
      if (!message.conversationId || message.senderId === session?.user?.id) return;
      setUnreadByConversation((current) => ({
        ...current,
        [message.conversationId]: Number(message.unreadCount ?? ((current[message.conversationId] || 0) + 1))
      }));
    };
    const onFocus = () => { void refreshUnread(); void refreshNotifications(); };
    connection.on('connect', onConnect);
    connection.on('message:received', onMessage);
    connection.on('notification:new', onNotification);
    setSocket(connection);
    void refreshUnread();
    void refreshNotifications();
    window.addEventListener('focus', onFocus);
    const onVisibilityChange = () => { if (document.visibilityState === 'visible') { void refreshUnread(); void refreshNotifications(); } };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      connection.off('connect', onConnect);
      connection.off('message:received', onMessage);
      connection.off('notification:new', onNotification);
      connection.removeAllListeners();
      connection.disconnect();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      setSocket(null);
    };
  }, [status, session?.user?.id, refreshUnread, refreshNotifications]);

  const unreadTotal = useMemo(() => Object.values(unreadByConversation).reduce((sum, count) => sum + Number(count || 0), 0), [unreadByConversation]);
  const markNotificationRead = useCallback(() => setUnreadNotifications((count) => Math.max(0, count - 1)), []);
  const markAllNotificationsRead = useCallback(() => setUnreadNotifications(0), []);
  const value = useMemo(() => ({ socket, unreadByConversation, unreadTotal, unreadNotifications, refreshUnread, refreshNotifications, markConversationRead, markNotificationRead, markAllNotificationsRead }), [socket, unreadByConversation, unreadTotal, unreadNotifications, refreshUnread, refreshNotifications, markConversationRead, markNotificationRead, markAllNotificationsRead]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext).socket;
}

export function useUnreadMessages() {
  const { unreadByConversation, unreadTotal, refreshUnread, markConversationRead } = useContext(RealtimeContext);
  return { unreadByConversation, unreadTotal, refreshUnread, markConversationRead };
}

export function useUnreadNotifications() {
  const { unreadNotifications, refreshNotifications, markNotificationRead, markAllNotificationsRead } = useContext(RealtimeContext);
  return { unreadNotifications, refreshNotifications, markNotificationRead, markAllNotificationsRead }; 
}
