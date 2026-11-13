'use client';

import { useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Providers';
import Portal from './Portal';

export default function Composer({ onClose }) {
  const input = useRef(null);
  const [files, setFiles] = useState([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const notify = useToast();
  const submit = async (event) => {
    event.preventDefault(); if (!files.length || busy) return;
    setBusy(true);
    const form = new FormData(); form.set('caption', caption); files.forEach((file) => form.append('media', file));
    try { await api('/posts', { method: 'POST', body: form }); notify('Your post is live.'); onClose(); window.dispatchEvent(new Event('social:refresh-feed')); }
    catch (error) { notify(error.message, 'error'); setBusy(false); }
  };
  return <Portal><div role="dialog" aria-modal="true" aria-labelledby="compose-title" className="fixed inset-0 z-50 grid place-items-center bg-[rgba(10,12,20,.48)] p-4 backdrop-blur-2xl" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form onSubmit={submit} className="glass-dialog w-full max-w-xl overflow-hidden shadow-2xl">
    <div className="flex items-center justify-between border-b border-line px-5 py-4"><h2 id="compose-title" className="font-semibold">Create a moment</h2><button type="button" aria-label="Close" onClick={onClose}><X size={20} /></button></div>
    <div className="p-5"><input ref={input} hidden type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple onChange={(event) => setFiles(Array.from(event.target.files || []).slice(0, 10))} />
      <button type="button" onClick={() => input.current?.click()} className="grid min-h-48 w-full place-items-center rounded-2xl border-2 border-dashed border-line bg-paper text-center"><span><ImagePlus size={32} className="mx-auto mb-2 text-moss" /><b className="block">Choose photos or videos</b><span className="text-xs text-ink/50">Up to 10 items · Images 12 MB · Videos 120 MB</span></span></button>
      {files.length > 0 && <div className="mt-3 text-sm text-ink/65">{files.map((file) => file.name).join(' · ')}</div>}
      <textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} rows={4} placeholder="Write a caption… add #hashtags or @mentions" className="mt-4 w-full resize-none rounded-2xl border border-line px-4 py-3 text-sm outline-none focus:border-moss" />
      <div className="mt-4 flex justify-end"><button disabled={!files.length || busy} className="inline-flex items-center gap-2 rounded-xl bg-moss px-6 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy && <LoaderCircle size={16} className="animate-spin" />}{busy ? 'Sharing…' : 'Share'}</button></div>
    </div>
  </form></div></Portal>;
}
