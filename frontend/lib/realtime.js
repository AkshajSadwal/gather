'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { io } from 'socket.io-client';
import { API_URL } from './api';

export function useRealtime() {
  const { status } = useSession();
  const [socket, setSocket] = useState(null);
  useEffect(() => {
    if (status !== 'authenticated') { setSocket(null); return; }
    const connection = io(API_URL, { withCredentials: true, autoConnect: true, reconnection: true, reconnectionAttempts: Infinity, reconnectionDelayMax: 5000 });
    setSocket(connection);
    return () => { connection.removeAllListeners(); connection.disconnect(); setSocket(null); };
  }, [status]);
  return socket;
}
