'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Video, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Providers';

export default function ReelComposer({ onClose }) {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const notify = useToast();

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const submit = async (event) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true); setError('');
    const form = new FormData(); form.set('media', file); form.set('caption', caption);
    try { await api('/reels', { method: 'POST', body: form }); notify('Your reel is live.'); onClose(); window.dispatchEvent(new Event('social:refresh-feed')); }
    catch (submitError) { setError(submitError.message || 'Could not publish your reel.'); }
    finally { setBusy(false); }
  };

  return <div role="dialog" aria-modal="true" aria-labelledby="reel-composer-title" className="fixed inset-0 z-[70] grid place-items-center bg-black/60 p-3 sm:p-6">
    <form onSubmit={submit} className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-3xl bg-surface p-5 shadow-soft sm:p-7">
      <header className="flex items-center justify-between"><div><h2 id="reel-composer-title" className="text-lg font-bold">Create a reel</h2><p className="mt-1 text-xs text-ink/50">Choose a video and preview it before publishing.</p></div><button type="button" aria-label="Close reel composer" onClick={onClose} disabled={busy} className="rounded-full p-2 hover:bg-paper disabled:opacity-40"><X size={18} /></button></header>
      <input ref={input} type="file" hidden accept="video/mp4,video/webm,video/quicktime" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) { setFile(selected); setError(''); } event.target.value = ''; }} />
      {file ? <video src={preview} controls playsInline className="mt-4 max-h-[48vh] w-full rounded-2xl bg-ink object-contain" /> : <button type="button" onClick={() => input.current?.click()} className="mt-4 grid min-h-48 w-full place-items-center rounded-2xl border-2 border-dashed border-line bg-paper text-sm font-semibold text-moss hover:border-moss"><span><Video size={30} className="mx-auto mb-2" />Choose a video</span></button>}
      {file && <div className="mt-3 flex items-center justify-between gap-3"><span className="min-w-0 truncate text-xs text-ink/50">{file.name}</span><button type="button" onClick={() => input.current?.click()} disabled={busy} className="shrink-0 text-xs font-semibold text-moss underline">Change video</button></div>}
      <label htmlFor="reel-caption" className="mt-4 block text-sm font-semibold">Caption</label><textarea id="reel-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} rows={3} placeholder="Write a caption… add #hashtags or @mentions" className="mt-1 w-full resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-moss" />
      {error && <p role="alert" className="mt-3 text-sm text-coral">{error}</p>}{busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink/60"><LoaderCircle size={16} className="animate-spin" />Uploading and publishing your reel…</p>}
      <footer className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold disabled:opacity-40">Cancel</button><button disabled={!file || busy} className="inline-flex items-center gap-2 rounded-xl bg-moss px-5 py-2 text-sm font-semibold text-white disabled:opacity-45">{busy && <LoaderCircle size={15} className="animate-spin" />}{busy ? 'Publishing…' : 'Publish reel'}</button></footer>
    </form>
  </div>;
}
