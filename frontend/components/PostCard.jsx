'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Archive, Bookmark, Check, Flag, Heart, MessageCircle, MoreHorizontal, Pencil, Pin, Send, Trash2, X } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import Avatar from './Avatar';
import ReportDialog from './ReportDialog';
import CommentsPanel from './CommentsPanel';
import { useSession } from 'next-auth/react';
import { useToast } from './Providers';

export default function PostCard({ initialPost, onDelete }) {
  const [post, setPost] = useState(initialPost);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [mediaIndex, setMediaIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState(initialPost.caption || '');
  const [savingCaption, setSavingCaption] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareConversations, setShareConversations] = useState([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareError, setShareError] = useState('');
  const [shareSearch, setShareSearch] = useState('');
  const [shareSelected, setShareSelected] = useState([]);
  const [shareNote, setShareNote] = useState('');
  const [shareBusy, setShareBusy] = useState(false);
  const { data: session } = useSession();
  const notify = useToast();

  const toggleLike = async () => {
    const wasLiked = post.isLiked;
    setPost((value) => ({ ...value, isLiked: !wasLiked, _count: { ...value._count, likes: Math.max(0, value._count.likes + (wasLiked ? -1 : 1)) } }));
    try { await api(`/posts/${post.id}/like`, { method: 'POST' }); } catch (error) { setPost((value) => ({ ...value, isLiked: wasLiked })); notify(error.message, 'error'); }
  };
  const toggleBookmark = async () => {
    try { const data = await api(`/posts/${post.id}/bookmark`, { method: 'POST' }); setPost((value) => ({ ...value, isBookmarked: data.bookmarked })); notify(data.bookmarked ? 'Saved to your collection.' : 'Removed from saved posts.'); }
    catch (error) { notify(error.message, 'error'); }
  };
  const openComments = () => setCommentsOpen((value) => !value);
  const openShare = async () => {
    setMenuOpen(false); setShareOpen(true); setShareLoading(true); setShareError(''); setShareSearch(''); setShareSelected([]); setShareNote('');
    try { const data = await api('/messages/share-recipients'); setShareConversations(data.users || []); }
    catch (error) { setShareError(error.message); }
    finally { setShareLoading(false); }
  };
  const searchShareRecipients = async () => {
    setShareLoading(true); setShareError('');
    try { const data = await api(`/messages/share-recipients?q=${encodeURIComponent(shareSearch.trim())}`); setShareConversations(data.users || []); }
    catch (error) { setShareError(error.message); }
    finally { setShareLoading(false); }
  };
  const shareToSelected = async () => {
    if (!shareSelected.length || shareBusy) return;
    setShareBusy(true); setShareError('');
    try { await api('/messages/share', { method: 'POST', body: JSON.stringify({ postId: post.id, recipientUsernames: shareSelected, ...(shareNote.trim() ? { note: shareNote.trim() } : {}) }) }); notify('Post shared in Messages.'); setShareOpen(false); }
    catch (error) { setShareError(error.message); }
    finally { setShareBusy(false); }
  };
  const toggleShareRecipient = (username) => {
    setShareSelected((current) => current.includes(username) ? current.filter((item) => item !== username) : current.length < 5 ? [...current, username] : current);
  };
  const removePost = async () => {
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); notify('Post deleted.'); onDelete?.(post.id); }
    catch (error) { notify(error.message, 'error'); }
  };
  const togglePin = async () => {
    setMenuOpen(false);
    try { const result = await api(`/posts/${post.id}/pin`, { method: 'POST' }); setPost(result.post); notify(result.pinned ? 'Post pinned to your profile.' : 'Post unpinned.'); }
    catch (error) { notify(error.message, 'error'); }
  };
  const archivePost = async () => {
    setMenuOpen(false);
    try { await api(`/posts/${post.id}/archive`, { method: 'POST' }); notify('Post moved to your archive.'); onDelete?.(post.id); }
    catch (error) { notify(error.message, 'error'); }
  };
  const saveCaption = async (event) => {
    event.preventDefault();
    setSavingCaption(true);
    try {
      const data = await api(`/posts/${post.id}`, { method: 'PATCH', body: JSON.stringify({ caption: captionDraft }) });
      setPost(data.post);
      setEditingCaption(false);
      notify('Caption updated.');
    } catch (error) { notify(error.message, 'error'); }
    finally { setSavingCaption(false); }
  };
  const media = post.media?.[mediaIndex];
  const date = new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const edited = new Date(post.updatedAt).getTime() - new Date(post.createdAt).getTime() > 60000;

  return <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-sm">
    <header className="flex items-center gap-3 px-4 py-4">{post.pinnedAt && <Pin aria-label="Pinned post" size={16} className="shrink-0 text-moss" />}<Link href={`/profile/${post.author.username}`}><Avatar src={post.author.image || post.author.profile?.avatarUrl} name={post.author.username} size="sm" /></Link><div className="min-w-0 flex-1"><Link href={`/profile/${post.author.username}`} className="text-sm font-semibold hover:underline">{post.author.username}</Link><p className="truncate text-xs text-ink/50">{post.author.profile?.displayName || 'Shared a moment'}</p></div><div className="relative"><button aria-label="Post options" onClick={() => setMenuOpen(!menuOpen)} className="rounded-full p-2 hover:bg-paper"><MoreHorizontal size={20} /></button>{menuOpen && <div className="absolute right-0 top-10 z-10 w-48 rounded-xl border border-line bg-white p-1 shadow-soft">{session?.user && <button onClick={() => void openShare()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Send size={15} />Share to Messages</button>}{session?.user?.id === post.author.id && <><button onClick={() => { setCaptionDraft(post.caption || ''); setEditingCaption(true); setMenuOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Pencil size={15} />Edit caption</button><button onClick={togglePin} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Pin size={15} />{post.pinnedAt ? 'Unpin from profile' : 'Pin to profile'}</button><button onClick={archivePost} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Archive size={15} />Archive</button><button onClick={removePost} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-coral hover:bg-paper"><Trash2 size={15} />Delete post</button></>}{session?.user && session.user.id !== post.author.id && <button onClick={() => { setMenuOpen(false); setReporting(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Flag size={15} />Report post</button>}<button onClick={() => setMenuOpen(false)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-paper">Close menu</button></div>}</div></header>
    <div className="relative bg-[#eef0eb]">
      {media?.type === 'VIDEO' ? <video key={media.id} className="max-h-[680px] w-full object-contain" src={mediaUrl(media.url)} controls playsInline preload="metadata" /> : <img src={mediaUrl(media?.url)} alt={post.caption || 'Post media'} className="max-h-[680px] min-h-48 w-full object-contain" />}
      {post.media?.length > 1 && <><button aria-label="Previous media" disabled={mediaIndex === 0} onClick={() => setMediaIndex((value) => Math.max(0, value - 1))} className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg shadow disabled:opacity-30">‹</button><button aria-label="Next media" disabled={mediaIndex === post.media.length - 1} onClick={() => setMediaIndex((value) => Math.min(post.media.length - 1, value + 1))} className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg shadow disabled:opacity-30">›</button><span className="absolute right-3 top-3 rounded-full bg-ink/65 px-2 py-1 text-xs text-white">{mediaIndex + 1}/{post.media.length}</span></>}
    </div>
    <div className="px-4 pb-4 pt-3"><div className="flex items-center gap-4"><button aria-label={post.isLiked ? 'Unlike' : 'Like'} onClick={toggleLike} className={`${post.isLiked ? 'text-coral' : 'text-ink'} transition hover:scale-110`}><Heart size={23} fill={post.isLiked ? 'currentColor' : 'none'} /></button><button aria-label="Comments" onClick={openComments} className="text-ink hover:text-moss"><MessageCircle size={23} /></button><Link aria-label="Open post" href={`/post/${post.id}`} className="text-ink hover:text-moss"><Send size={21} /></Link><button aria-label={post.isBookmarked ? 'Unsave post' : 'Save post'} onClick={toggleBookmark} className="ml-auto text-ink"><Bookmark size={22} fill={post.isBookmarked ? 'currentColor' : 'none'} /></button></div>
      <p className="mt-2 text-sm font-semibold">{post._count?.likes || 0} appreciations</p>
      {post.caption && <p className="mt-1 text-sm leading-6"><Link href={`/profile/${post.author.username}`} className="mr-2 font-semibold">{post.author.username}</Link><Caption text={post.caption} /></p>}
      {editingCaption && <form onSubmit={saveCaption} className="mt-3 grid gap-2"><textarea autoFocus value={captionDraft} onChange={(event) => setCaptionDraft(event.target.value)} maxLength={2200} rows={3} aria-label="Edit caption" className="w-full resize-y rounded-xl border border-line p-3 text-sm outline-none focus:border-moss" /><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditingCaption(false)} className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-xs font-semibold"><X size={14} />Cancel</button><button disabled={savingCaption} className="inline-flex items-center gap-1 rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"><Check size={14} />Save</button></div></form>}
      <button onClick={openComments} className="mt-1 text-sm text-ink/50">View all {post._count?.comments || 0} comments</button>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-ink/40">{date}{edited && <span className="ml-2 normal-case tracking-normal">· Edited</span>}</p>
      {commentsOpen && <div className="mt-3 border-t border-line pt-3"><CommentsPanel postId={post.id} postAuthorId={post.author.id} onCommentAdded={(delta = 1) => setPost((value) => ({ ...value, _count: { ...value._count, comments: Math.max(0, value._count.comments + delta) } }))} /></div>}
    </div>
    {reporting && <ReportDialog targetType="POST" targetId={post.id} onClose={() => setReporting(false)} />}
    {shareOpen && <div role="dialog" aria-modal="true" aria-label="Share post to Messages" className="fixed inset-0 z-50 grid place-items-center bg-ink/45 p-4" onClick={() => setShareOpen(false)}><section className="max-h-[85vh] w-full max-w-md overflow-auto rounded-3xl bg-white p-5 shadow-soft" onClick={(event) => event.stopPropagation()}><header className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Share post</h2><p className="text-xs text-ink/50">Choose up to five recipients</p></div><button type="button" onClick={() => setShareOpen(false)} aria-label="Close share dialog" className="rounded-full p-2 hover:bg-paper"><X size={18} /></button></header>{shareLoading ? <p className="py-8 text-center text-sm text-ink/50">Loading recipients…</p> : shareError && !shareConversations.length ? <div role="alert" className="py-6 text-center text-sm text-coral">{shareError}<button type="button" onClick={() => void openShare()} className="ml-2 underline">Retry</button></div> : <><div className="mb-3 flex gap-2"><input value={shareSearch} onChange={(event) => setShareSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchShareRecipients(); } }} maxLength={30} aria-label="Search message recipients" placeholder="Search people" className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-moss" /><button type="button" onClick={() => void searchShareRecipients()} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold">Search</button></div><div className="max-h-48 divide-y divide-line overflow-auto">{shareConversations.map((person) => <button key={person.id} type="button" aria-pressed={shareSelected.includes(person.username)} disabled={!shareSelected.includes(person.username) && shareSelected.length >= 5} onClick={() => toggleShareRecipient(person.username)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-paper disabled:opacity-40"><Avatar src={person.image} name={person.username} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-medium">@{person.username}</span><span className="text-xs font-semibold text-moss">{shareSelected.includes(person.username) ? 'Selected' : 'Select'}</span></button>)}</div>{!shareConversations.length && <p className="py-5 text-center text-sm text-ink/50">No matching people. Search followers or conversation contacts.</p>}<label className="mt-3 grid gap-1 text-xs font-medium">Add a note (optional)<textarea rows={2} maxLength={500} value={shareNote} onChange={(event) => setShareNote(event.target.value)} className="resize-y rounded-xl border border-line p-3 text-sm font-normal outline-none focus:border-moss" /></label><button type="button" disabled={!shareSelected.length || shareBusy} onClick={() => void shareToSelected()} className="mt-3 w-full rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{shareBusy ? 'Sharing…' : `Share with ${shareSelected.length || 'selected'}`}</button></> }{shareError && shareConversations.length > 0 && <p role="alert" className="mt-3 text-sm text-coral">{shareError}</p>}</section></div>}
  </article>;
}

function Caption({ text }) {
  return text.split(/(#[\p{L}\p{N}_]+|@[a-zA-Z0-9._]+)/gu).map((part, index) => part.startsWith('#') || part.startsWith('@') ? <Link key={`${part}-${index}`} href={part.startsWith('#') ? `/tags/${encodeURIComponent(part.slice(1))}` : `/profile/${part.slice(1)}`} className="text-moss hover:underline">{part}</Link> : part);
}
