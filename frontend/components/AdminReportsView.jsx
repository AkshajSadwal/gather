'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';

const tabs = ['OPEN', 'REVIEWED', 'DISMISSED'];

export default function AdminReportsView() {
  const [status, setStatus] = useState('OPEN');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const notify = useToast();
  const load = useCallback(async (nextStatus, nextCursorValue = null) => {
    setLoading(true); setError('');
    try {
      const data = await api(`/admin/reports?status=${nextStatus}${nextCursorValue ? `&cursor=${encodeURIComponent(nextCursorValue)}` : ''}`);
      setItems(data.items || []); setNextCursor(data.nextCursor || null); setCursor(nextCursorValue);
    } catch (loadError) { setError(loadError.message || 'Could not load reports.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(status); }, [load, status]);
  const review = async (report, nextStatus, removeContent = false) => {
    setBusy(report.id);
    try { await api(`/admin/reports/${report.id}`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus, removeContent }) }); notify(removeContent ? 'Content removed and report reviewed.' : 'Report reviewed.'); void load(status, cursor); }
    catch (reviewError) { notify(reviewError.message, 'error'); }
    finally { setBusy(''); }
  };
  return <section className="mx-auto max-w-4xl">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">Administration</p><h1 className="mt-1 text-2xl font-bold">Reports</h1><p className="mt-1 text-sm text-ink/55">Review user and content reports.</p></div><Link href="/admin/reports/history" className="rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold hover:bg-paper">Audit history</Link></header>
    <div className="mb-4 flex gap-2 overflow-x-auto">{tabs.map((tab) => <button key={tab} onClick={() => setStatus(tab)} aria-pressed={status === tab} className={`rounded-xl px-4 py-2 text-sm font-medium ${status === tab ? 'bg-moss text-white' : 'border border-line bg-white text-ink/65'}`}>{tab.toLowerCase()}</button>)}</div>
    {loading ? <div className="grid gap-3" aria-label="Loading reports">{[1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-2xl" />)}</div> : error ? <div role="alert" className="rounded-2xl border border-coral/30 bg-white p-5 text-sm text-coral">{error}<button onClick={() => void load(status, cursor)} className="ml-3 font-semibold underline">Retry</button></div> : !items.length ? <div className="rounded-2xl border border-line bg-white p-8 text-center text-sm text-ink/55">No {status.toLowerCase()} reports.</div> : <div className="grid gap-4">{items.map((report) => <article key={report.id} className="rounded-2xl border border-line bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-moss">{report.targetType} · {report.reason.replaceAll('_', ' ').toLowerCase()}</p><p className="mt-1 text-sm">Reported by <b>@{report.reporter.username}</b>{report.details && <span className="text-ink/55"> · {report.details}</span>}</p><time className="mt-1 block text-xs text-ink/40">{new Date(report.createdAt).toLocaleString()}</time></div><span className="rounded-full bg-paper px-3 py-1 text-xs font-semibold">{report.status.toLowerCase()}</span></div>
      {report.preview ? <div className="mt-4 rounded-xl bg-paper p-3 text-sm">{report.preview.mediaUrl && <img src={mediaUrl(report.preview.mediaUrl)} alt="Reported post" className="mb-3 max-h-64 w-full rounded-lg object-contain" />}<p className="whitespace-pre-wrap break-words">{report.preview.text || report.preview.displayName || `@${report.preview.username}`}</p><p className="mt-2 text-xs text-ink/45">Target: {report.preview.author ? `@${report.preview.author.username}` : report.preview.username ? `@${report.preview.username}` : 'comment'}</p></div> : <p className="mt-4 rounded-xl bg-paper p-3 text-sm text-ink/55">The reported target is no longer available.</p>}
      {report.status === 'OPEN' && <div className="mt-4 flex flex-wrap justify-end gap-2"><button disabled={Boolean(busy)} onClick={() => void review(report, 'DISMISSED')} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold disabled:opacity-50">Dismiss</button>{report.targetType !== 'USER' && <button disabled={Boolean(busy)} onClick={() => void review(report, 'REVIEWED', true)} className="rounded-xl bg-coral px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{busy === report.id ? 'Saving…' : 'Remove content'}</button>}<button disabled={Boolean(busy)} onClick={() => void review(report, 'REVIEWED')} className="rounded-xl bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Mark reviewed</button></div>}
    </article>)}</div>}
    {!loading && !error && items.length > 0 && <div className="mt-5 flex justify-end"><button disabled={!nextCursor || loading} onClick={() => void load(status, nextCursor)} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold disabled:opacity-40">Load more</button></div>}
  </section>;
}
