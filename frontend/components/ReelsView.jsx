'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Bookmark, Heart, MessageCircle, Pause, Play, Plus, Share2, Volume2, VolumeX } from 'lucide-react';
import Avatar from './Avatar';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';

export default function ReelsView() {
  const { data: session, status } = useSession();
  const [reels, setReels] = useState([]);
  const [busy, setBusy] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playing, setPlaying] = useState({});
  const [muted, setMuted] = useState({});
  const [liked, setLiked] = useState({});
  const [saved, setSaved] = useState({});
  const [relationships, setRelationships] = useState({});
  const [caption, setCaption] = useState('');
  const [file, setFile] = useState(null);
  const [composer, setComposer] = useState(false);
  const videos = useRef(new Map());
  const refs = useRef(new Map());
  const containerRef = useRef(null);
  const notify = useToast();

  useEffect(() => {
    let cancelled = false;
    api('/reels?limit=24')
      .then((data) => { if (!cancelled) setReels(data.reels || []); })
      .catch((error) => { if (!cancelled) notify(error.message, 'error'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [notify]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !('IntersectionObserver' in window)) return undefined;

    const attemptPlay = (video, reelId) => {
      if (!video) return;
      // Start muted so browsers allow autoplay. The user can unmute afterwards.
      video.muted = true;
      const promise = video.play();
      if (promise?.then) {
        promise.then(() => setPlaying((all) => ({ ...all, [reelId]: true }))).catch(() => {
          setPlaying((all) => ({ ...all, [reelId]: false }));
        });
      }
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const reelId = entry.target.dataset.reelId;
        const video = videos.current.get(reelId);
        if (!video) return;
        if (entry.isIntersecting && entry.intersectionRatio > 0.65) {
          attemptPlay(video, reelId);
        } else {
          video.pause();
          setPlaying((all) => ({ ...all, [reelId]: false }));
        }
      });
    }, { root, threshold: [0, 0.65, 1] });

    refs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, [reels]);

  const toggleLike = async (reel) => {
    const post = reel.post;
    if (!post) return;
    const next = !(liked[reel.id] ?? post.isLiked);
    setLiked((all) => ({ ...all, [reel.id]: next }));
    try {
      await api(`/posts/${post.id}/like`, { method: 'POST' });
    } catch (error) {
      setLiked((all) => ({ ...all, [reel.id]: !next }));
      notify(error.message, 'error');
    }
  };

  const toggleFollow = async (reel) => {
    if (reel.author.id === session?.user?.id) return;
    if (status !== 'authenticated') { window.location.assign('/login'); return; }
    const current = relationships[reel.id] || { following: reel.isFollowing, pending: reel.isFollowPending };
    try {
      const result = await api(`/follows/${encodeURIComponent(reel.author.username)}/toggle`, { method: 'POST' });
      setRelationships((all) => ({ ...all, [reel.id]: { following: result.following, pending: result.pending || false } }));
      notify(result.pending ? 'Follow request sent.' : result.following ? 'You’re now following this account.' : result.cancelledRequest ? 'Follow request canceled.' : 'You unfollowed this account.');
    } catch (error) { notify(error.message, 'error'); }
  };

  const toggleSave = async (reel) => {
    if (!reel.post) return;
    const next = !(saved[reel.id] ?? reel.post.isBookmarked);
    setSaved((all) => ({ ...all, [reel.id]: next }));
    try {
      await api(`/posts/${reel.post.id}/bookmark`, { method: 'POST' });
    } catch (error) {
      setSaved((all) => ({ ...all, [reel.id]: !next }));
      notify(error.message, 'error');
    }
  };

  const share = async (reel) => {
    const url = `${window.location.origin}/post/${reel.post?.id || reel.id}`;
    try {
      if (navigator.share) await navigator.share({ title: 'A moment on Gather', url });
      else { await navigator.clipboard.writeText(url); notify('Link copied.'); }
    } catch (error) { if (error.name !== 'AbortError') notify('Could not share this reel.', 'error'); }
  };

  const create = async (event) => {
    event.preventDefault();
    if (!file) return;
    setUploading(true);
    const body = new FormData();
    body.set('media', file);
    body.set('caption', caption);
    try {
      await api('/reels', { method: 'POST', body });
      notify('Your reel is live.');
      setComposer(false);
      setFile(null);
      setCaption('');
      const result = await api('/reels?limit=24');
      setReels(result.reels || []);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return <div className="mx-auto max-w-4xl">
    <header className="mb-5 flex items-end justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">A new point of view</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Reels</h1><p className="mt-2 text-sm text-ink/55">Short videos, made to be watched one at a time.</p></div>
      {status === 'authenticated' && <button onClick={() => setComposer(true)} className="flex items-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17} />Create</button>}
    </header>

    <div ref={containerRef} className="hide-scrollbar h-[calc(100vh-190px)] min-h-[520px] snap-y snap-mandatory space-y-5 overflow-y-auto rounded-3xl">
      {busy && <div className="skeleton mx-auto h-[75vh] max-h-[760px] w-full max-w-[440px] rounded-3xl" />}
      {!busy && reels.map((reel) => {
        const videoUrl = reel.media?.[0]?.url;
        const isLiked = liked[reel.id] ?? reel.post?.isLiked;
        const isSaved = saved[reel.id] ?? reel.post?.isBookmarked;
        const relationship = relationships[reel.id] || { following: reel.isFollowing, pending: reel.isFollowPending };
        return <article key={reel.id} data-reel-id={reel.id} ref={(element) => { if (element) refs.current.set(reel.id, element); else refs.current.delete(reel.id); }} className="relative mx-auto h-[calc(100vh-210px)] min-h-[500px] max-h-[780px] w-full max-w-[440px] snap-center overflow-hidden rounded-[28px] bg-ink text-white shadow-soft">
          <video
            ref={(element) => { if (element) videos.current.set(reel.id, element); else videos.current.delete(reel.id); }}
            src={mediaUrl(videoUrl)}
            playsInline
            autoPlay
            muted={muted[reel.id] !== false}
            loop
            preload="metadata"
            onCanPlay={(event) => {
              const article = event.currentTarget.closest('[data-reel-id]');
              if (!article || !containerRef.current) return;
              const rect = article.getBoundingClientRect();
              const rootRect = containerRef.current.getBoundingClientRect();
              const visible = Math.min(rect.bottom, rootRect.bottom) - Math.max(rect.top, rootRect.top);
              if (visible > rect.height * 0.65) event.currentTarget.play().then(() => setPlaying((all) => ({ ...all, [reel.id]: true }))).catch(() => {});
            }}
            onError={() => setPlaying((all) => ({ ...all, [reel.id]: false }))}
            onClick={(event) => {
              if (event.currentTarget.paused) event.currentTarget.play().then(() => setPlaying((all) => ({ ...all, [reel.id]: true }))).catch(() => {});
              else { event.currentTarget.pause(); setPlaying((all) => ({ ...all, [reel.id]: false })); }
            }}
            onPlay={() => setPlaying((all) => ({ ...all, [reel.id]: true }))}
            onPause={() => setPlaying((all) => ({ ...all, [reel.id]: false }))}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
          {!playing[reel.id] && <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-white/70">Tap to play</div>}
          <button onClick={() => { const video = videos.current.get(reel.id); if (!video) return; if (video.paused) video.play().then(() => setPlaying((all) => ({ ...all, [reel.id]: true }))).catch(() => {}); else video.pause(); }} aria-label={playing[reel.id] ? 'Pause reel' : 'Play reel'} className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-white backdrop-blur">{playing[reel.id] ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={() => { const next = muted[reel.id] === false; setMuted((all) => ({ ...all, [reel.id]: next })); const video = videos.current.get(reel.id); if (video) { video.muted = next; if (!next && video.paused) video.play().catch(() => {}); } }} aria-label={muted[reel.id] === false ? 'Mute sound' : 'Unmute sound'} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-white backdrop-blur">{muted[reel.id] === false ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <div className="absolute bottom-5 left-4 right-16"><div className="flex items-center gap-3"><Link href={`/profile/${reel.author.username}`} className="flex min-w-0 items-center gap-2.5"><Avatar src={reel.author.image} name={reel.author.username} size="xs" /><span className="truncate text-sm font-semibold">@{reel.author.username}</span></Link>{reel.author.id !== session?.user?.id && <button onClick={() => toggleFollow(reel)} className="shrink-0 rounded-full border border-white/45 px-2.5 py-1 text-[10px] font-semibold hover:bg-white/10">{relationship.following ? 'Following' : relationship.pending ? 'Requested' : 'Follow'}</button>}</div>{reel.caption && <p className="mt-3 line-clamp-3 text-sm leading-6">{reel.caption}</p>}</div>
          <div className="absolute bottom-5 right-3 grid gap-4 text-center"><button aria-label={isLiked ? 'Unlike reel' : 'Like reel'} onClick={() => toggleLike(reel)} className={`grid place-items-center gap-1 ${isLiked ? 'text-coral' : 'text-white'}`}><Heart size={24} fill={isLiked ? 'currentColor' : 'none'} /><span className="text-[10px]">{reel.post?._count?.likes || 0}</span></button><Link href={reel.post ? `/post/${reel.post.id}` : '/reels'} aria-label="Open comments" className="grid place-items-center gap-1"><MessageCircle size={23} /><span className="text-[10px]">{reel.post?._count?.comments || 0}</span></Link><button aria-label={isSaved ? 'Unsave reel' : 'Save reel'} onClick={() => toggleSave(reel)}><Bookmark size={22} fill={isSaved ? 'currentColor' : 'none'} /></button><button aria-label="Share reel" onClick={() => share(reel)}><Share2 size={21} /></button></div>
        </article>;
      })}
      {!busy && !reels.length && <div className="mx-auto grid h-[60vh] max-w-md place-items-center rounded-3xl border border-line bg-white p-10 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-mint text-moss"><Play /></span><h2 className="mt-4 font-semibold">No reels yet</h2><p className="mt-2 text-sm text-ink/55">When creators share short videos, you’ll find them here.</p></div></div>}
    </div>

    {composer && <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"><form onSubmit={create} className="w-full max-w-md rounded-3xl bg-white p-5 text-ink"><div className="mb-4 flex justify-between"><h2 className="font-semibold">Create a reel</h2><button type="button" onClick={() => setComposer(false)}>Close</button></div><input required type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-sm" /><textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} rows={3} placeholder="Add a caption or hashtags" className="mt-4 w-full rounded-xl border border-line p-3 text-sm outline-none focus:border-moss" /><button disabled={!file || uploading} className="mt-4 w-full rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{uploading ? 'Uploading…' : 'Share reel'}</button></form></div>}
  </div>;
}
