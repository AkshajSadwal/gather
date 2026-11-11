'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Flag, LoaderCircle, MessageCircle, Reply, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import Avatar from './Avatar';
import ReportDialog from './ReportDialog';
import { useToast } from './Providers';

export default function CommentsPanel({ postId, postAuthorId, onCommentAdded }) {
  const { data: session, status } = useSession();
  const [comments, setComments] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [replies, setReplies] = useState({});
  const [busy, setBusy] = useState(false);
  const [reportingId, setReportingId] = useState('');
  const notify = useToast();

  const loadComments = useCallback(async (cursor = null) => {
    if (cursor) setLoadingMore(true);
    else { setLoading(true); setError(''); }
    try {
      const query = new URLSearchParams({ limit: '20' });
      if (cursor) query.set('cursor', cursor);
      const data = await api(`/posts/${encodeURIComponent(postId)}/comments?${query}`);
      setComments((current) => cursor ? [...current, ...(data.comments || [])] : (data.comments || []));
      setNextCursor(data.nextCursor || null);
    } catch (problem) { setError(problem.message); }
    finally { setLoading(false); setLoadingMore(false); }
  }, [postId]);

  useEffect(() => { void loadComments(); }, [loadComments]);

  const loadReplies = async (parentId, cursor = null) => {
    setReplies((all) => ({ ...all, [parentId]: { ...(all[parentId] || {}), loading: true, error: '' } }));
    try {
      const query = new URLSearchParams({ limit: '20' });
      if (cursor) query.set('cursor', cursor);
      const data = await api(`/comments/${encodeURIComponent(parentId)}/replies?${query}`);
      setReplies((all) => ({ ...all, [parentId]: { expanded: true, loading: false, items: cursor ? [...(all[parentId]?.items || []), ...(data.replies || [])] : (data.replies || []), nextCursor: data.nextCursor || null } }));
    } catch (problem) {
      setReplies((all) => ({ ...all, [parentId]: { ...(all[parentId] || {}), loading: false, error: problem.message } }));
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!draft.trim() || busy || status !== 'authenticated') return;
    setBusy(true);
    try {
      const data = await api(`/posts/${encodeURIComponent(postId)}/comments`, {
        method: 'POST', body: JSON.stringify({ body: draft, ...(replyTarget ? { parentId: replyTarget.id } : {}) })
      });
      if (replyTarget) {
        setReplies((all) => ({ ...all, [replyTarget.id]: { ...all[replyTarget.id], expanded: true, items: [data.comment, ...(all[replyTarget.id]?.items || [])] } }));
        setComments((all) => all.map((item) => item.id === replyTarget.id ? { ...item, _count: { ...item._count, replies: (item._count?.replies || 0) + 1 } } : item));
      } else setComments((all) => [data.comment, ...all]);
      setDraft('');
      setReplyTarget(null);
      onCommentAdded?.();
    } catch (problem) { notify(problem.message, 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (item, parentId = null) => {
    try {
      await api(`/comments/${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      if (parentId) {
        setReplies((all) => ({ ...all, [parentId]: { ...all[parentId], items: (all[parentId]?.items || []).filter((row) => row.id !== item.id) } }));
        setComments((all) => all.map((row) => row.id === parentId ? { ...row, _count: { ...row._count, replies: Math.max(0, (row._count?.replies || 0) - 1) } } : row));
      } else {
        setComments((all) => all.filter((row) => row.id !== item.id));
        setReplies((all) => { const next = { ...all }; delete next[item.id]; return next; });
      }
      const removedCount = 1 + (parentId ? 0 : item._count?.replies || 0);
      onCommentAdded?.(-removedCount);
    } catch (problem) { notify(problem.message, 'error'); }
  };

  const renderComment = (item, parentId = null) => {
    const own = session?.user?.id === item.user.id;
    const canDelete = own || session?.user?.id === postAuthorId;
    const replyState = replies[item.id] || {};
    return <div key={item.id} className="flex gap-3">
      <Avatar src={item.user.image} name={item.user.username} size="xs" />
      <div className="min-w-0 flex-1">
        <div className="break-words text-sm"><Link href={`/profile/${item.user.username}`} className="mr-2 font-semibold hover:underline">@{item.user.username}</Link>{item.body}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink/45">
          <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          {!parentId && status === 'authenticated' && <button type="button" onClick={() => setReplyTarget(item)} className="inline-flex items-center gap-1 hover:text-moss"><Reply size={12} />Reply</button>}
          {!parentId && Number(item._count?.replies || 0) > 0 && <button type="button" onClick={() => replyState.expanded ? setReplies((all) => ({ ...all, [item.id]: { ...all[item.id], expanded: false } })) : void loadReplies(item.id)} className="inline-flex items-center gap-1 hover:text-moss"><MessageCircle size={12} />{replyState.expanded ? 'Hide' : `View ${item._count.replies}`} replies</button>}
          {canDelete && <button type="button" onClick={() => void remove(item, parentId)} aria-label="Delete comment" className="hover:text-coral"><Trash2 size={13} /></button>}
          {session?.user?.id && !own && <button type="button" onClick={() => setReportingId(item.id)} aria-label="Report comment" className="hover:text-coral"><Flag size={13} /></button>}
        </div>
        {replyState.error && <p className="mt-2 text-xs text-coral">{replyState.error} <button onClick={() => void loadReplies(item.id)} className="underline">Retry</button></p>}
        {replyState.loading && <p className="mt-2 text-xs text-ink/45">Loading replies…</p>}
        {replyState.expanded && replyState.items?.length > 0 && <div className="mt-3 grid gap-3 border-l-2 border-line pl-3">{replyState.items.map((reply) => renderComment(reply, item.id))}</div>}
        {replyState.expanded && replyState.nextCursor && <button type="button" onClick={() => void loadReplies(item.id, replyState.nextCursor)} className="mt-2 text-xs font-semibold text-moss">Load more replies</button>}
      </div>
    </div>;
  };

  return <section aria-label="Comments" className="grid gap-4">
    <div className="max-h-[55vh] min-h-20 space-y-4 overflow-y-auto pr-1">
      {loading ? <p className="py-8 text-center text-sm text-ink/50">Loading comments…</p> : error ? <div role="alert" className="py-6 text-center text-sm text-coral">{error} <button type="button" onClick={() => void loadComments()} className="underline">Retry</button></div> : comments.length ? comments.map((item) => renderComment(item)) : <p className="py-8 text-center text-sm text-ink/50">No comments yet. Be the first to comment.</p>}
    </div>
    {!loading && nextCursor && <button type="button" disabled={loadingMore} onClick={() => void loadComments(nextCursor)} className="mx-auto text-xs font-semibold text-moss disabled:opacity-50">{loadingMore ? 'Loading…' : 'Load more comments'}</button>}
    {status === 'authenticated' ? <form onSubmit={submit} className="grid gap-2 border-t border-line pt-3">
      {replyTarget && <p className="flex items-center justify-between text-xs text-ink/55">Replying to @{replyTarget.user.username}<button type="button" onClick={() => setReplyTarget(null)} className="font-semibold text-moss">Cancel</button></p>}
      <div className="flex gap-2"><input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} placeholder={replyTarget ? 'Write a reply…' : 'Add a comment…'} className="min-w-0 flex-1 border-b border-line py-2 text-sm outline-none focus:border-moss" /><button type="submit" disabled={!draft.trim() || busy} className="inline-flex items-center gap-1 text-sm font-semibold text-moss disabled:opacity-40">{busy && <LoaderCircle size={14} className="animate-spin" />}Post</button></div>
    </form> : <Link href="/login" className="border-t border-line pt-3 text-center text-sm font-semibold text-moss">Log in to comment</Link>}
    {reportingId && <ReportDialog targetType="COMMENT" targetId={reportingId} onClose={() => setReportingId('')} />}
  </section>;
}
