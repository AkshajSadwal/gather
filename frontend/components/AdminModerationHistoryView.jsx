'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';

export default function AdminModerationHistoryView() {
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async (cursor = null, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const data = await api(`/admin/moderation-history?limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      setItems((current) => append ? [...current, ...(data.items || [])] : data.items || []);
      setNextCursor(data.nextCursor || null);
    } catch (problem) { setError(problem.message || 'Could not load moderation history.'); }
    finally { setLoading(false); setLoadingMore(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="admin-page mx-auto max-w-4xl">
    <header className="mb-5"><Link href="/admin/reports" className="text-sm font-medium text-moss hover:underline">Back to reports</Link><p className="mt-4 text-xs font-semibold uppercase tracking-[.18em] text-moss">Administration</p><h1 className="mt-1 text-2xl font-bold">Moderation history</h1><p className="mt-1 text-sm text-ink/55">A chronological record of report decisions and content removals.</p></header>
    {loading ? <div className="grid gap-3" aria-label="Loading moderation history">{[1, 2, 3].map((row) => <div key={row} className="skeleton h-28 rounded-2xl" />)}</div> : error && !items.length ? <div role="alert" className="glass rounded-2xl border border-coral/30 p-5 text-sm text-coral">{error}<button onClick={() => void load()} className="ml-3 font-semibold underline">Retry</button></div> : !items.length ? <div className="glass rounded-2xl border border-line p-8 text-center text-sm text-ink/55">No moderation actions recorded.</div> : <div className="grid gap-3">{items.map((item) => <article key={item.id} className="glass rounded-2xl border border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{item.action === 'CONTENT_REMOVED' ? 'Content removed' : 'Report reviewed'}</p><p className="mt-1 text-sm text-ink/65">Report <span className="font-mono text-xs">{item.reportRef}</span> · {item.targetType.toLowerCase()} · {item.reason.toLowerCase().replaceAll('_', ' ')}</p><p className="mt-1 break-all text-xs text-ink/45">Target ID: {item.targetId}</p></div><time className="text-xs text-ink/45">{new Date(item.createdAt).toLocaleString()}</time></div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55"><span>Moderator: <b className="text-ink/75">@{item.moderatorUsername}</b></span>{item.previousStatus && item.newStatus && <span>Status: <b className="text-ink/75">{item.previousStatus} → {item.newStatus}</b></span>}</div>
    </article>)}</div>}
    {error && items.length > 0 && <p role="alert" className="mt-3 text-sm text-coral">{error}</p>}
    {!loading && nextCursor && <div className="mt-5 text-center"><button disabled={loadingMore} onClick={() => void load(nextCursor, true)} className="rounded-xl border border-line bg-surface px-5 py-2.5 text-sm font-semibold disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load more'}</button></div>}
  </section>;
}
