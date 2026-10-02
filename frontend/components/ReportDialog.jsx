'use client';

import { useEffect, useState } from 'react';
import { Flag, LoaderCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { useToast } from './Providers';

const REASONS = [
  ['SPAM', 'Spam or scam'],
  ['HARASSMENT', 'Harassment or bullying'],
  ['HATE_OR_ABUSE', 'Hate or abusive content'],
  ['NUDITY_OR_SEXUAL', 'Nudity or sexual content'],
  ['VIOLENCE', 'Violence or threats'],
  ['SELF_HARM', 'Self-harm'],
  ['IMPERSONATION', 'Pretending to be someone else'],
  ['OTHER', 'Something else']
];

/** Report an account (pass `username`) or a post (pass `postId`). */
export default function ReportDialog({ username, postId, onClose }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);
  const notify = useToast();
  const subject = postId ? 'post' : `@${username}`;

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async (event) => {
    event.preventDefault();
    if (!reason || sending) return;
    setSending(true);
    try {
      const target = postId ? { postId } : { username };
      const result = await api('/reports', { method: 'POST', body: JSON.stringify({ ...target, reason, details }) });
      notify(result.duplicate ? 'You already reported this. Our team will take a look.' : 'Thanks for letting us know. Your report was sent for review.');
      onClose();
    } catch (error) { notify(error.message, 'error'); setSending(false); }
  };

  return <div className="fixed inset-0 z-50 grid place-items-center bg-ink/40 p-4" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form role="dialog" aria-modal="true" aria-labelledby="report-title" onSubmit={submit} className="max-h-[90vh] w-full max-w-md overflow-auto rounded-3xl bg-white p-5 sm:p-6">
      <div className="mb-1 flex items-start justify-between gap-3"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-moss"><Flag size={19} /></span><div><h2 id="report-title" className="font-semibold">Report {subject}</h2><p className="text-xs text-ink/50">Reports are private. {postId ? 'The author' : 'This person'} won’t be told it was you.</p></div></div><button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 hover:bg-paper"><X size={18} /></button></div>
      <fieldset className="mt-4 grid gap-1.5"><legend className="mb-1 text-sm font-medium">What’s the problem?</legend>
        {REASONS.map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm ${reason === value ? 'border-moss bg-mint/40' : 'border-line hover:bg-paper'}`}><input type="radio" name="reason" value={value} checked={reason === value} onChange={() => setReason(value)} className="accent-moss" />{label}</label>)}
      </fieldset>
      <label className="mt-4 grid gap-1.5 text-sm font-medium">Anything else we should know? <span className="font-normal text-ink/40">(optional)</span><textarea rows={3} maxLength={1000} value={details} onChange={(event) => setDetails(event.target.value)} className="resize-none rounded-xl border border-line px-4 py-3 font-normal outline-none focus:border-moss" /><span className="text-right text-xs font-normal text-ink/40">{details.length}/1000</span></label>
      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper">Cancel</button><button disabled={!reason || sending} className="flex items-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending && <LoaderCircle size={16} className="animate-spin" />}Submit report</button></div>
    </form>
  </div>;
}
