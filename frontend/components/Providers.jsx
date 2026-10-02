'use client';

import { SessionProvider } from 'next-auth/react';
import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, X, XCircle } from 'lucide-react';
import { RealtimeProvider } from '../lib/realtime';

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export default function Providers({ children, session }) {
  const [items, setItems] = useState([]);
  const notify = useCallback((message, tone = 'success') => {
    const id = `${Date.now()}-${Math.random()}`;
    setItems((all) => [...all, { id, message, tone }]);
    setTimeout(() => setItems((all) => all.filter((item) => item.id !== id)), 3600);
  }, []);
  return <SessionProvider session={session}><RealtimeProvider><ToastContext.Provider value={notify}>{children}<div className="fixed right-4 top-4 z-[100] grid w-[min(92vw,380px)] gap-2" aria-live="polite">{items.map((item) => <div key={item.id} className="flex items-center gap-3 rounded-2xl bg-ink p-4 text-sm text-white shadow-soft"><span>{item.tone === 'error' ? <XCircle size={18} className="text-coral" /> : <CheckCircle2 size={18} className="text-mint" />}</span><span className="flex-1">{item.message}</span><button aria-label="Dismiss" onClick={() => setItems((all) => all.filter((entry) => entry.id !== item.id))}><X size={16} /></button></div>)}</div></ToastContext.Provider></RealtimeProvider></SessionProvider>;
}
