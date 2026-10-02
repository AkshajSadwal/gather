'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bookmark, Flag, Heart, MessageCircle, MoreHorizontal, Send, Trash2 } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import Avatar from './Avatar';
import ReportDialog from './ReportDialog';
import { useSession } from 'next-auth/react';
import { useToast } from './Providers';

export default function PostCard({ initialPost, onDelete }) {
  const [post, setPost] = useState(initialPost);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState(null);
  const [comment, setComment] = useState('');
  const [mediaIndex, setMediaIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [busy, setBusy] = useState(false);
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
  const openComments = async () => {
    setCommentsOpen(!commentsOpen);
    if (!comments) { try { const data = await api(`/posts/${post.id}/comments`); setComments(data.comments); } catch (error) { notify(error.message, 'error'); } }
  };
  const sendComment = async (event) => {
    event.preventDefault(); if (!comment.trim() || busy) return;
    setBusy(true);
    try { const data = await api(`/posts/${post.id}/comments`, { method: 'POST', body: JSON.stringify({ body: comment }) }); setComments((items) => [data.comment, ...(items || [])]); setComment(''); setPost((value) => ({ ...value, _count: { ...value._count, comments: value._count.comments + 1 } })); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };
  const removePost = async () => {
    try { await api(`/posts/${post.id}`, { method: 'DELETE' }); notify('Post deleted.'); onDelete?.(post.id); }
    catch (error) { notify(error.message, 'error'); }
  };
  const media = post.media?.[mediaIndex];
  const date = new Date(post.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  return <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-sm">
    <header className="flex items-center gap-3 px-4 py-4"><Link href={`/profile/${post.author.username}`}><Avatar src={post.author.image || post.author.profile?.avatarUrl} name={post.author.username} size="sm" /></Link><div className="min-w-0 flex-1"><Link href={`/profile/${post.author.username}`} className="text-sm font-semibold hover:underline">{post.author.username}</Link><p className="truncate text-xs text-ink/50">{post.author.profile?.displayName || 'Shared a moment'}</p></div><div className="relative"><button aria-label="Post options" onClick={() => setMenuOpen(!menuOpen)} className="rounded-full p-2 hover:bg-paper"><MoreHorizontal size={20} /></button>{menuOpen && <div className="absolute right-0 top-10 z-10 w-40 rounded-xl border border-line bg-white p-1 shadow-soft">{session?.user?.id === post.author.id && <button onClick={removePost} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-coral hover:bg-paper"><Trash2 size={15} />Delete post</button>}{session?.user && session.user.id !== post.author.id && <button onClick={() => { setMenuOpen(false); setReporting(true); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-paper"><Flag size={15} />Report post</button>}<button onClick={() => setMenuOpen(false)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-paper">Close menu</button></div>}</div></header>
    <div className="relative bg-[#eef0eb]">
      {media?.type === 'VIDEO' ? <video key={media.id} className="max-h-[680px] w-full object-contain" src={mediaUrl(media.url)} controls playsInline preload="metadata" /> : <img src={mediaUrl(media?.url)} alt={post.caption || 'Post media'} className="max-h-[680px] min-h-48 w-full object-contain" />}
      {post.media?.length > 1 && <><button aria-label="Previous media" disabled={mediaIndex === 0} onClick={() => setMediaIndex((value) => Math.max(0, value - 1))} className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg shadow disabled:opacity-30">‹</button><button aria-label="Next media" disabled={mediaIndex === post.media.length - 1} onClick={() => setMediaIndex((value) => Math.min(post.media.length - 1, value + 1))} className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/85 text-lg shadow disabled:opacity-30">›</button><span className="absolute right-3 top-3 rounded-full bg-ink/65 px-2 py-1 text-xs text-white">{mediaIndex + 1}/{post.media.length}</span></>}
    </div>
    <div className="px-4 pb-4 pt-3"><div className="flex items-center gap-4"><button aria-label={post.isLiked ? 'Unlike' : 'Like'} onClick={toggleLike} className={`${post.isLiked ? 'text-coral' : 'text-ink'} transition hover:scale-110`}><Heart size={23} fill={post.isLiked ? 'currentColor' : 'none'} /></button><button aria-label="Comments" onClick={openComments} className="text-ink hover:text-moss"><MessageCircle size={23} /></button><Link aria-label="Open post" href={`/post/${post.id}`} className="text-ink hover:text-moss"><Send size={21} /></Link><button aria-label={post.isBookmarked ? 'Unsave post' : 'Save post'} onClick={toggleBookmark} className="ml-auto text-ink"><Bookmark size={22} fill={post.isBookmarked ? 'currentColor' : 'none'} /></button></div>
      <p className="mt-2 text-sm font-semibold">{post._count?.likes || 0} appreciations</p>
      {post.caption && <p className="mt-1 text-sm leading-6"><Link href={`/profile/${post.author.username}`} className="mr-2 font-semibold">{post.author.username}</Link><Caption text={post.caption} /></p>}
      <button onClick={openComments} className="mt-1 text-sm text-ink/50">View all {post._count?.comments || 0} comments</button>
      <p className="mt-2 text-[11px] uppercase tracking-wide text-ink/40">{date}</p>
      {commentsOpen && <div className="mt-3 border-t border-line pt-3"><div className="max-h-52 space-y-3 overflow-auto">{comments === null ? <p className="text-xs text-ink/50">Loading comments…</p> : comments.map((item) => <div key={item.id} className="text-sm"><Link href={`/profile/${item.user.username}`} className="mr-2 font-semibold">{item.user.username}</Link>{item.body}<span className="ml-2 text-xs text-ink/40">{new Date(item.createdAt).toLocaleDateString()}</span></div>)}</div><form onSubmit={sendComment} className="mt-3 flex gap-2"><input value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} placeholder="Add a comment…" className="min-w-0 flex-1 border-b border-line py-2 text-sm outline-none focus:border-moss" /><button disabled={!comment.trim() || busy} className="text-sm font-semibold text-moss disabled:opacity-40">Post</button></form></div>}
    </div>
    {reporting && <ReportDialog postId={post.id} onClose={() => setReporting(false)} />}
  </article>;
}

function Caption({ text }) {
  return text.split(/(#[\p{L}\p{N}_]+|@[a-zA-Z0-9._]+)/gu).map((part, index) => part.startsWith('#') || part.startsWith('@') ? <Link key={`${part}-${index}`} href={part.startsWith('#') ? `/search?q=${encodeURIComponent(part.slice(1))}` : `/profile/${part.slice(1)}`} className="text-moss hover:underline">{part}</Link> : part);
}
