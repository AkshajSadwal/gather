'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle2, FileVideo, Image, LoaderCircle, RefreshCw, ShieldAlert, UploadCloud, XCircle } from 'lucide-react';
import { API_URL, api } from '../lib/api';

const activeStatuses = new Set(['queued', 'processing']);
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function statusLabel(status) {
  return ({ queued: 'Queued', processing: 'Importing', completed: 'Completed', completed_with_errors: 'Completed with errors', failed: 'Failed' })[status] || 'Unknown';
}

function statusClass(status) {
  if (status === 'completed') return 'bg-mint/75 text-moss';
  if (status === 'failed' || status === 'completed_with_errors') return 'bg-coral/10 text-coral';
  return 'bg-paper/75 text-ink/65';
}

export default function AdminBulkImportView() {
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [archive, setArchive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authorized, setAuthorized] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const inputRef = useRef(null);

  const hasActiveJob = useMemo(() => jobs.some((job) => activeStatuses.has(job.status)), [jobs]);

  const refresh = useCallback(async () => {
    const [userData, jobData] = await Promise.all([api('/admin/bulk-imports/users'), api('/admin/bulk-imports')]);
    setUsers(userData.users || []);
    setJobs(jobData.jobs || []);
    setTargetUserId((current) => current && userData.users?.some((user) => user.id === current) ? current : userData.users?.[0]?.id || '');
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.resolve().then(async () => {
      const result = await api('/auth/me');
      if (!alive) return;
      if (!result.user?.isAdmin) {
        setAuthorized(false);
        return;
      }
      setAuthorized(true);
      await refresh();
    }).catch((loadError) => {
      if (alive) {
        setAuthorized(false);
        setError(loadError.message || 'Could not load the admin importer.');
      }
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refresh]);

  useEffect(() => {
    if (!hasActiveJob || !authorized) return undefined;
    let cancelled = false;
    let timer;
    const poll = async () => {
      try { await refresh(); } catch { /* Preserve the last visible progress during a short outage. */ }
      if (!cancelled) timer = setTimeout(poll, 1800);
    };
    timer = setTimeout(poll, 1200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [hasActiveJob, authorized, refresh]);

  const uploadArchive = (file, retryJobId = null) => {
    setError('');
    setNotice('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setError('Choose a .zip archive.');
      return;
    }
    if (file.size <= 4 || file.size > MAX_ARCHIVE_BYTES) {
      setError('The ZIP must be larger than 4 bytes and no larger than 1 GB.');
      return;
    }
    if (!retryJobId && !targetUserId) {
      setError('Choose a Gather account before uploading.');
      return;
    }
    if (uploading || hasActiveJob) {
      setError('Wait for the current import to finish before uploading another ZIP.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    const form = new FormData();
    if (!retryJobId) form.append('targetUserId', targetUserId);
    form.append('archive', file, file.name);
    const endpoint = retryJobId ? `/api/admin/bulk-imports/${encodeURIComponent(retryJobId)}/retry` : '/api/admin/bulk-imports';
    const request = new XMLHttpRequest();
    request.open('POST', `${API_URL}${endpoint}`);
    request.withCredentials = true;
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => {
      setError('The ZIP upload connection failed. Check your connection and retry.');
      setUploading(false);
    };
    request.onabort = () => {
      setError('The ZIP upload was cancelled. Select the archive again to retry.');
      setUploading(false);
    };
    request.onload = async () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText || '{}'); } catch { /* Use the safe status fallback below. */ }
      if (request.status < 200 || request.status >= 300 || !payload.data?.job) {
        setError(payload.error?.message || `Upload failed (${request.status}).`);
        setUploading(false);
        return;
      }
      setNotice(retryJobId ? `Retry queued for @${payload.data.job.targetUsername}. Completed items will be skipped.` : `ZIP accepted for @${payload.data.job.targetUsername}. Importing will continue in the background.`);
      setArchive(null);
      if (inputRef.current) inputRef.current.value = '';
      setUploading(false);
      try { await refresh(); } catch { /* The queued job remains available in history. */ }
    };
    request.send(form);
  };

  const submit = (event) => {
    event.preventDefault();
    uploadArchive(archive);
  };

  if (loading) return <section aria-label="Loading bulk import tools" className="admin-page mx-auto max-w-4xl"><div className="glass h-56 animate-pulse rounded-3xl" /></section>;

  if (!authorized) return <section className="admin-page mx-auto max-w-2xl"><div role="alert" className="glass rounded-3xl border p-6 sm:p-8"><ShieldAlert className="mb-3 text-coral" size={24} /><h1 className="text-xl font-bold">Admin access required</h1><p className="mt-2 text-sm text-ink/65">{error || 'Sign in with an authorized Gather administrator account to use bulk imports.'}</p></div></section>;

  return <section className="admin-page mx-auto max-w-4xl">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-semibold uppercase tracking-[.16em] text-moss">Administration</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Bulk media import</h1><p className="mt-2 max-w-2xl text-sm text-ink/60">Publish JPG/JPEG files as photo posts and MP4 files as Reels. Captions start empty.</p></div>
      <span className="glass-pill rounded-full px-3 py-2 text-xs font-semibold text-ink/60">One active job · private media</span>
    </header>

    <form onSubmit={submit} className="glass glass-strong rounded-3xl border p-4 shadow-float sm:p-6">
      <label htmlFor="bulk-target" className="mb-2 block text-sm font-semibold">Publish under account</label>
      <select id="bulk-target" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)} disabled={uploading || hasActiveJob || !users.length} className="glass-input w-full rounded-2xl border px-3 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-moss">
        {!users.length && <option value="">No Gather accounts found</option>}
        {users.map((user) => <option key={user.id} value={user.id}>@{user.username}{user.profile?.displayName ? ` · ${user.profile.displayName}` : ''}</option>)}
      </select>

      <div className="mt-5">
        <label htmlFor="bulk-archive" className="mb-2 block text-sm font-semibold">ZIP archive</label>
        <input ref={inputRef} id="bulk-archive" type="file" accept=".zip,application/zip" onChange={(event) => { setArchive(event.target.files?.[0] || null); setError(''); }} disabled={uploading || hasActiveJob} className="block w-full text-sm file:mr-3 file:rounded-full file:border-0 file:bg-moss file:px-4 file:py-2.5 file:font-semibold file:text-white hover:file:bg-moss/90 disabled:opacity-50" />
        <p className="mt-2 text-xs leading-5 text-ink/55">Maximum 1 GB per ZIP · Up to 500 supported files · 5 GB expanded · Photos up to 100 MB · Videos up to 500 MB</p>
        {archive && <p className="mt-2 flex min-w-0 items-center gap-2 text-sm text-ink/70"><Archive size={16} className="shrink-0" /><span className="truncate">{archive.name}</span><span className="shrink-0 text-ink/45">{formatBytes(archive.size)}</span></p>}
      </div>

      {uploading && <div className="mt-5" role="status" aria-live="polite"><div className="mb-2 flex items-center justify-between text-xs text-ink/60"><span>Uploading ZIP to Gather</span><b>{uploadProgress}%</b></div><div className="h-2 overflow-hidden rounded-full bg-paper/75"><div className="h-full rounded-full bg-moss transition-[width] duration-200" style={{ width: `${uploadProgress}%` }} /></div></div>}
      {hasActiveJob && <p className="mt-4 rounded-2xl bg-paper/70 px-3 py-3 text-sm text-ink/65">An import is running. You can follow its progress below.</p>}
      {error && <p role="alert" className="mt-4 rounded-2xl bg-coral/10 px-3 py-3 text-sm text-coral">{error}</p>}
      {notice && <p role="status" className="mt-4 rounded-2xl bg-mint/75 px-3 py-3 text-sm text-ink">{notice}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => void refresh().catch((refreshError) => setError(refreshError.message || 'Could not refresh import history.'))} disabled={uploading} className="glass-pill rounded-full px-4 py-2.5 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} className="mr-2 inline" />Refresh</button><button type="submit" disabled={!archive || !targetUserId || uploading || hasActiveJob || !users.length} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-moss to-[#7770db] px-5 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-45">{uploading ? <LoaderCircle size={16} className="animate-spin" /> : <UploadCloud size={16} />} {uploading ? 'Uploading…' : 'Upload and import'}</button></div>
    </form>

    <div className="mt-8">
      <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-lg font-bold">Import history</h2><span className="text-xs text-ink/45">Latest 25 jobs</span></div>
      {!jobs.length ? <div className="glass rounded-3xl border p-6 text-center text-sm text-ink/55">No ZIP imports yet.</div> : <div className="grid gap-3">{jobs.map((job) => {
        const percent = job.totalFiles ? Math.min(100, Math.round((job.processedFiles / job.totalFiles) * 100)) : 0;
        const active = activeStatuses.has(job.status);
        return <article key={job.id} className="glass rounded-3xl border p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">@{job.targetUsername} <span className="font-normal text-ink/45">· {job.archiveName || 'ZIP archive'}</span></p><p className="mt-1 text-xs text-ink/45">{job.createdAt ? new Date(job.createdAt).toLocaleString() : 'Date unavailable'} · {formatBytes(job.archiveBytes)}{job.requestedByUsername ? ` · Started by @${job.requestedByUsername}` : ''}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusClass(job.status)}`}>{statusLabel(job.status)}</span></div>
          {(active || job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'failed') && <div className="mt-4"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-ink/55"><span>{job.message}</span>{job.totalFiles > 0 && <b>{job.processedFiles}/{job.totalFiles} · {percent}%</b>}</div><div className="h-2 overflow-hidden rounded-full bg-paper/75"><div className="h-full rounded-full bg-moss transition-[width] duration-200" style={{ width: `${percent}%` }} /></div></div>}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/55"><span className="inline-flex items-center gap-1"><Image size={13} />{job.createdPosts || 0} posts</span><span className="inline-flex items-center gap-1"><FileVideo size={13} />{job.createdReels || 0} Reels</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={13} />{job.skippedFiles || 0} duplicates skipped</span>{job.failedFiles > 0 && <span className="inline-flex items-center gap-1 text-coral"><XCircle size={13} />{job.failedFiles} failed</span>}</div>
          {job.errors?.length > 0 && <details className="mt-3 rounded-2xl bg-paper/70 p-3"><summary className="cursor-pointer text-xs font-semibold text-coral">Show failed files ({job.failedFiles})</summary><ul className="mt-2 grid gap-2 break-words text-xs text-ink/65">{job.errors.map((item, index) => <li key={`${item.file}-${index}`}><b>{item.file}</b> — {item.message}</li>)}</ul></details>}
          {job.status === 'completed_with_errors' && job.failedFiles > 0 && <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-line bg-white/40 px-4 py-2 text-sm font-semibold transition hover:bg-white/65 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50"><input type="file" accept=".zip,application/zip" className="sr-only" disabled={uploading || hasActiveJob} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) uploadArchive(file, job.id); }} />{uploading ? <LoaderCircle size={15} className="animate-spin" /> : <RefreshCw size={15} />}Retry failed files with the original ZIP</label>}
        </article>;
      })}</div>}
    </div>
  </section>;
}
