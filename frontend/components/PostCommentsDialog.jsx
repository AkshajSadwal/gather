'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { mediaUrl } from '../lib/api';
import Avatar from './Avatar';
import CommentsPanel from './CommentsPanel';

export default function PostCommentsDialog({ post, media, mediaIndex, onMediaIndexChange, onCommentAdded, onClose }) {
  const closeButtonRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const source = media ? mediaUrl(media.url) : null;

  useEffect(() => {
    const priorFocus = document.activeElement;
    const priorOverflow = document.body.style.overflow;
    const close = () => onCloseRef.current?.();
    const onKeyDown = (event) => { if (event.key === 'Escape') close(); };
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = priorOverflow;
      window.removeEventListener('keydown', onKeyDown);
      if (priorFocus instanceof HTMLElement) priorFocus.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(<div role="dialog" aria-modal="true" aria-labelledby="post-comments-title" className="post-comments-backdrop fixed inset-0 z-[70] grid place-items-center bg-ink/55 p-0 backdrop-blur-md sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="post-comments-dialog glass-dialog">
      <div className="post-comments-media relative grid min-h-0 place-items-center bg-ink-deep">
        {source ? media?.type === 'VIDEO' ? <video src={source} controls playsInline preload="metadata" aria-label={`Video by ${post.author.username}`} className="h-full w-full object-contain" /> : <img src={source} alt={post.caption || `Post by ${post.author.username}`} className="h-full w-full object-contain" /> : <p role="status" className="p-6 text-center text-sm text-white/70">Post media is unavailable.</p>}
        {post.media?.length > 1 && <div className="absolute inset-x-3 bottom-3 flex items-center justify-between"><button type="button" aria-label="Previous media" disabled={mediaIndex === 0} onClick={() => onMediaIndexChange((index) => Math.max(0, index - 1))} className="glass-pill grid h-10 w-10 place-items-center text-white disabled:opacity-35"><ChevronLeft size={20} /></button><span className="rounded-full bg-ink/70 px-2.5 py-1 text-xs text-white">{mediaIndex + 1}/{post.media.length}</span><button type="button" aria-label="Next media" disabled={mediaIndex === post.media.length - 1} onClick={() => onMediaIndexChange((index) => Math.min(post.media.length - 1, index + 1))} className="glass-pill grid h-10 w-10 place-items-center text-white disabled:opacity-35"><ChevronRight size={20} /></button></div>}
        <button ref={closeButtonRef} type="button" aria-label="Close comments" onClick={onClose} className="glass-pill absolute right-3 top-3 grid h-10 w-10 place-items-center text-white"><X size={19} /></button>
      </div>
      <aside className="post-comments-aside min-h-0">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
          <Link href={`/profile/${post.author.username}`} onClick={onClose}><Avatar src={post.author.image || post.author.profile?.avatarUrl} name={post.author.username} size="sm" /></Link>
          <div className="min-w-0 flex-1"><h2 id="post-comments-title" className="text-sm font-semibold">Comments</h2><Link href={`/profile/${post.author.username}`} onClick={onClose} className="block truncate text-xs text-ink/55">@{post.author.username}</Link></div>
        </header>
        {post.caption && <p className="post-comments-caption border-b border-line px-4 py-3 text-sm leading-5 sm:px-5">{post.caption}</p>}
        <CommentsPanel key={post.id} postId={post.id} postAuthorId={post.author.id} onCommentAdded={onCommentAdded} className="comments-panel--fill min-h-0 px-4 pb-4 sm:px-5" />
      </aside>
    </section>
  </div>, document.body);
}
