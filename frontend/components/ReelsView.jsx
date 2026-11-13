'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Bookmark, EyeOff, Heart, MessageCircle, Pause, Play, Plus, Share2, Volume2, VolumeX, X } from 'lucide-react';
import Avatar from './Avatar';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';
import CommentsPanel from './CommentsPanel';
import { flushRecoEvents, initRecoTrackerLifecycle, recoSessionId, trackReelEvent } from '../lib/recoTracker';

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
  const [commentReel, setCommentReel] = useState(null);
  const [shareReel, setShareReel] = useState(null);
  const [shareCandidates, setShareCandidates] = useState([]);
  const [shareSearch, setShareSearch] = useState('');
  const [shareSelected, setShareSelected] = useState([]);
  const [shareNote, setShareNote] = useState('');
  const [shareLoading, setShareLoading] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [hiddenReels, setHiddenReels] = useState([]);
  const [undoReelId, setUndoReelId] = useState(null);
  const videos = useRef(new Map());
  const refs = useRef(new Map());
  const tracking = useRef(new Map());
  const reelData = useRef(new Map());
  const hideTimer = useRef(null);
  const containerRef = useRef(null);
  const loadingMore = useRef(false);
  const notify = useToast();
  reelData.current = new Map(reels.map((item) => [item.id, item]));

  useEffect(() => {
    let cancelled = false;
    initRecoTrackerLifecycle();
    const path = status === 'authenticated' ? `/reels/feed?size=10&sessionId=${encodeURIComponent(recoSessionId())}` : '/reels?limit=24';
    api(path)
      .then((data) => { if (!cancelled) setReels(data.items || data.reels || []); })
      .catch((error) => { if (!cancelled) notify(error.message, 'error'); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [notify, status]);

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
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          const reel = reels.find((item) => item.id === reelId);
          const state = tracking.current.get(reelId) || { visibleMs: 0, watchMs: 0, progressReportedMs: 0, maxProgressMs: 0, replayCount: 0, lastCurrent: 0, visible: false, viewableSent: false, playStarted: false };
          state.visible = true;
          tracking.current.set(reelId, state);
          attemptPlay(video, reelId);
        } else {
          const state = tracking.current.get(reelId);
          if (state?.visible) {
            state.visible = false;
            const reel = reels.find((item) => item.id === reelId);
            if (reel?.impressionId) {
              const delta = Math.max(0, state.watchMs - state.progressReportedMs);
              if (delta) trackReelEvent({ type: 'WATCH_PROGRESS', reelId, impressionId: reel.impressionId, payload: { watchMs: delta, videoDurationMs: Math.round(video.duration * 1000) || undefined } });
              trackReelEvent({ type: 'WATCH_END', reelId, impressionId: reel.impressionId, payload: { visibleMs: state.visibleMs, watchMs: 0, maxProgressMs: state.maxProgressMs, replayCount: state.replayCount, videoDurationMs: Math.round(video.duration * 1000) || undefined } });
              state.progressReportedMs = state.watchMs;
            }
            state.visibleMs = 0; state.watchMs = 0; state.progressReportedMs = 0; state.maxProgressMs = 0; state.replayCount = 0;
          }
          video.pause();
          setPlaying((all) => ({ ...all, [reelId]: false }));
        }
      });
    }, { root, threshold: [0, 0.65, 1] });

    refs.current.forEach((element) => element && observer.observe(element));
    return () => observer.disconnect();
  }, [reels]);

  useEffect(() => {
    const finishVisible = () => tracking.current.forEach((state, reelId) => {
      if (!state.visible) return;
      state.visible = false;
      state.lastMeasuredTimeMs = null;
      const reel = reelData.current.get(reelId);
      if (reel?.impressionId) {
        const video = videos.current.get(reelId);
        const delta = Math.max(0, state.watchMs - state.progressReportedMs);
        if (delta) trackReelEvent({ type: 'WATCH_PROGRESS', reelId, impressionId: reel.impressionId, payload: { watchMs: delta, videoDurationMs: Math.round((video?.duration || 0) * 1000) || undefined } });
        trackReelEvent({ type: 'WATCH_END', reelId, impressionId: reel.impressionId, payload: { visibleMs: state.visibleMs, watchMs: 0, maxProgressMs: state.maxProgressMs, replayCount: state.replayCount, videoDurationMs: Math.round((video?.duration || 0) * 1000) || undefined } });
        state.progressReportedMs = state.watchMs;
      }
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') { finishVisible(); void flushRecoEvents(true); return; }
      tracking.current.forEach((state, reelId) => {
        if (!state.visible) return;
        state.visibleMs += 1000;
        const reel = reelData.current.get(reelId);
        if (!state.viewableSent && state.visibleMs >= 1000 && reel?.impressionId) {
          state.viewableSent = true;
          trackReelEvent({ type: 'IMPRESSION_VIEWABLE', reelId, impressionId: reel.impressionId, payload: { visibleMs: state.visibleMs, position: reel.position } });
        }
        const video = videos.current.get(reelId);
        if (video && !video.paused && !video.ended) {
          const currentMs = Math.round(video.currentTime * 1000);
          if (state.lastMeasuredTimeMs != null) state.watchMs += Math.min(1500, Math.max(0, currentMs - state.lastMeasuredTimeMs));
          state.lastMeasuredTimeMs = currentMs;
          state.maxProgressMs = Math.max(state.maxProgressMs, Math.round(video.currentTime * 1000));
          if (state.watchMs - state.progressReportedMs >= 5000 && reel?.impressionId) {
            const delta = state.watchMs - state.progressReportedMs;
            state.progressReportedMs = state.watchMs;
            trackReelEvent({ type: 'WATCH_PROGRESS', reelId, impressionId: reel.impressionId, payload: { watchMs: delta, maxProgressMs: state.maxProgressMs, videoDurationMs: Math.round(video.duration * 1000) || undefined } });
          }
        }
      });
    }, 1000);
    const onVisibility = () => { if (document.visibilityState === 'hidden') { finishVisible(); void flushRecoEvents(true); } };
    document.addEventListener('visibilitychange', onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility); finishVisible(); };
  }, []);

  const hideReel = (reel) => {
    setHiddenReels((items) => [...new Set([...items, reel.id])]);
    setUndoReelId(reel.id);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { trackReelEvent({ type: 'NOT_INTERESTED', reelId: reel.id, impressionId: reel.impressionId }); setUndoReelId((id) => id === reel.id ? null : id); }, 5000);
  };

  const loadMore = async () => {
    if (status !== 'authenticated' || loadingMore.current) return;
    loadingMore.current = true;
    try {
      const exclude = reels.map((reel) => reel.id).join(',');
      const data = await api(`/reels/feed?size=10&sessionId=${encodeURIComponent(recoSessionId())}&exclude=${encodeURIComponent(exclude)}`);
      if (data.items?.length) setReels((items) => [...items, ...data.items]);
    } catch (error) { notify(error.message, 'error'); }
    finally { loadingMore.current = false; }
  };

  const toggleLike = async (reel) => {
    const post = reel.post;
    if (!post) return;
    const next = !(liked[reel.id] ?? post.isLiked);
    setLiked((all) => ({ ...all, [reel.id]: next }));
    try {
      await api(`/posts/${post.id}/like`, { method: 'POST', headers: reel.impressionId ? { 'x-reco-impression-id': reel.impressionId } : undefined });
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
      const result = await api(`/follows/${encodeURIComponent(reel.author.username)}/toggle`, { method: 'POST', headers: reel.impressionId ? { 'x-reco-impression-id': reel.impressionId } : undefined });
      setRelationships((all) => ({ ...all, [reel.id]: { following: result.following, pending: result.pending || false } }));
      notify(result.pending ? 'Follow request sent.' : result.following ? 'You’re now following this account.' : result.cancelledRequest ? 'Follow request canceled.' : 'You unfollowed this account.');
    } catch (error) { notify(error.message, 'error'); }
  };

  const toggleSave = async (reel) => {
    if (!reel.post) return;
    const next = !(saved[reel.id] ?? reel.post.isBookmarked);
    setSaved((all) => ({ ...all, [reel.id]: next }));
    try {
      await api(`/posts/${reel.post.id}/bookmark`, { method: 'POST', headers: reel.impressionId ? { 'x-reco-impression-id': reel.impressionId } : undefined });
    } catch (error) {
      setSaved((all) => ({ ...all, [reel.id]: !next }));
      notify(error.message, 'error');
    }
  };

  const share = async (reel) => {
    if (!reel.post?.id || status !== 'authenticated') { notify('Sign in to share this reel in Messages.', 'error'); return; }
    setShareReel(reel); setShareLoading(true); setShareError(''); setShareSelected([]); setShareNote(''); setShareSearch('');
    try { const data = await api('/messages/share-recipients'); setShareCandidates(data.users || []); }
    catch (error) { setShareError(error.message); }
    finally { setShareLoading(false); }
  };

  const searchShareCandidates = async () => {
    setShareLoading(true); setShareError('');
    try { const data = await api(`/messages/share-recipients?q=${encodeURIComponent(shareSearch.trim())}`); setShareCandidates(data.users || []); }
    catch (error) { setShareError(error.message); }
    finally { setShareLoading(false); }
  };

  const sendReelShare = async () => {
    if (!shareReel?.post?.id || !shareSelected.length || shareBusy) return;
    setShareBusy(true); setShareError('');
    try { await api('/messages/share', { method: 'POST', headers: shareReel.impressionId ? { 'x-reco-impression-id': shareReel.impressionId } : undefined, body: JSON.stringify({ postId: shareReel.post.id, recipientUsernames: shareSelected, ...(shareNote.trim() ? { note: shareNote.trim() } : {}) }) }); notify('Reel shared in Messages.'); setShareReel(null); }
    catch (error) { setShareError(error.message); }
    finally { setShareBusy(false); }
  };

  const toggleShareRecipient = (username) => setShareSelected((current) => current.includes(username) ? current.filter((item) => item !== username) : current.length < 5 ? [...current, username] : current);

  const openComments = (reel) => {
    if (!reel.post?.id) return;
    const video = videos.current.get(reel.id);
    if (video && !video.paused) video.pause();
    setCommentReel(reel);
  };

  const closeComments = () => setCommentReel(null);

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
      const result = status === 'authenticated' ? await api(`/reels/feed?size=10&sessionId=${encodeURIComponent(recoSessionId())}`) : await api('/reels?limit=24');
      setReels(result.items || result.reels || []);
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return <div className="watch-page mx-auto max-w-[1160px]">
    <header className="mb-5 flex items-end justify-between">
      <div><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">A new point of view</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Reels</h1><p className="mt-2 text-sm text-ink/55">Short videos, made to be watched one at a time.</p></div>
      {status === 'authenticated' && <button onClick={() => setComposer(true)} className="flex items-center gap-2 rounded-xl bg-moss px-4 py-2.5 text-sm font-semibold text-white"><Plus size={17} />Create</button>}
    </header>

    <div ref={containerRef} onScroll={(event) => { const node = event.currentTarget; if (node.scrollHeight - node.scrollTop - node.clientHeight < 900) void loadMore(); }} className="watch-feed hide-scrollbar h-[calc(100vh-190px)] min-h-[520px] snap-y snap-mandatory space-y-5 overflow-y-auto rounded-3xl px-2">
      {busy && <div className="skeleton mx-auto h-[75vh] max-h-[760px] w-full max-w-[860px] rounded-3xl" />}
      {!busy && reels.filter((reel) => !hiddenReels.includes(reel.id)).map((reel) => {
        const videoUrl = reel.media?.[0]?.url;
        const isLiked = liked[reel.id] ?? reel.post?.isLiked;
        const isSaved = saved[reel.id] ?? reel.post?.isBookmarked;
        const relationship = relationships[reel.id] || { following: reel.isFollowing, pending: reel.isFollowPending };
        return <article key={reel.id} data-reel-id={reel.id} ref={(element) => { if (element) refs.current.set(reel.id, element); else refs.current.delete(reel.id); }} className="watch-reel mx-auto grid h-[calc(100vh-210px)] min-h-[500px] max-h-[780px] w-full max-w-[860px] snap-center grid-cols-1 overflow-hidden rounded-[28px] bg-surface text-ink shadow-soft lg:grid-cols-[minmax(0,500px)_minmax(280px,1fr)]">
          <div className="watch-media relative min-w-0 overflow-hidden bg-ink text-white">
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
            onTimeUpdate={(event) => {
              const state = tracking.current.get(reel.id);
              if (!state) return;
              const current = event.currentTarget.currentTime;
              if (state.lastCurrent > event.currentTarget.duration * 0.8 && current < 0.5) {
                state.replayCount += 1;
                if (reel.impressionId) trackReelEvent({ type: 'REPLAY', reelId: reel.id, impressionId: reel.impressionId });
              }
              state.lastCurrent = current;
            }}
            onClick={(event) => {
              if (event.currentTarget.paused) event.currentTarget.play().then(() => setPlaying((all) => ({ ...all, [reel.id]: true }))).catch(() => {});
              else { event.currentTarget.pause(); setPlaying((all) => ({ ...all, [reel.id]: false })); }
            }}
            onPlay={(event) => {
              const state = tracking.current.get(reel.id);
              if (state) state.lastMeasuredTimeMs = Math.round(event.currentTarget.currentTime * 1000);
              if (state && !state.playStarted && reel.impressionId) { state.playStarted = true; trackReelEvent({ type: 'WATCH_START', reelId: reel.id, impressionId: reel.impressionId }); }
              setPlaying((all) => ({ ...all, [reel.id]: true }));
            }}
            onPause={() => { const state = tracking.current.get(reel.id); if (state) state.lastMeasuredTimeMs = null; setPlaying((all) => ({ ...all, [reel.id]: false })); }}
            className="h-full w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-black/20" />
          {!playing[reel.id] && <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-xs text-white/70">Tap to play</div>}
          <button onClick={() => { const video = videos.current.get(reel.id); if (!video) return; if (video.paused) video.play().then(() => setPlaying((all) => ({ ...all, [reel.id]: true }))).catch(() => {}); else video.pause(); }} aria-label={playing[reel.id] ? 'Pause reel' : 'Play reel'} className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-white backdrop-blur">{playing[reel.id] ? <Pause size={18} /> : <Play size={18} />}</button>
          <button onClick={() => { const next = muted[reel.id] === false; setMuted((all) => ({ ...all, [reel.id]: next })); const video = videos.current.get(reel.id); if (video) { video.muted = next; if (!next && video.paused) video.play().catch(() => {}); } }} aria-label={muted[reel.id] === false ? 'Mute sound' : 'Unmute sound'} className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/25 text-white backdrop-blur">{muted[reel.id] === false ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
          <div className="absolute bottom-5 left-4 right-16"><div className="flex items-center gap-3"><Link href={`/profile/${reel.author.username}`} onClick={() => reel.impressionId && trackReelEvent({ type: 'PROFILE_OPEN', reelId: reel.id, impressionId: reel.impressionId })} className="flex min-w-0 items-center gap-2.5"><Avatar src={reel.author.image} name={reel.author.username} size="xs" /><span className="truncate text-sm font-semibold">@{reel.author.username}</span></Link>{reel.author.id !== session?.user?.id && <button onClick={() => toggleFollow(reel)} className="shrink-0 rounded-full border border-white/45 px-2.5 py-1 text-[10px] font-semibold hover:bg-surface/10">{relationship.following ? 'Following' : relationship.pending ? 'Requested' : 'Follow'}</button>}</div>{reel.caption && <p className="mt-3 line-clamp-3 text-sm leading-6">{reel.caption}</p>}</div>
          <div className="absolute bottom-5 right-3 grid gap-4 text-center"><button aria-label={isLiked ? 'Unlike reel' : 'Like reel'} onClick={() => toggleLike(reel)} className={`grid place-items-center gap-1 ${isLiked ? 'text-coral' : 'text-white'}`}><Heart size={24} fill={isLiked ? 'currentColor' : 'none'} /><span className="text-[10px]">{reel.post?._count?.likes || 0}</span></button><button type="button" onClick={() => openComments(reel)} aria-label="Open comments" className="grid place-items-center gap-1"><MessageCircle size={23} /><span className="text-[10px]">{reel.post?._count?.comments || 0}</span></button><button aria-label={isSaved ? 'Unsave reel' : 'Save reel'} onClick={() => toggleSave(reel)}><Bookmark size={22} fill={isSaved ? 'currentColor' : 'none'} /></button><button aria-label="Share reel" onClick={() => share(reel)}><Share2 size={21} /></button><button aria-label="Not interested in this reel" onClick={() => hideReel(reel)}><EyeOff size={19} /></button></div>
        </div><aside className="watch-info hidden min-w-0 flex-col justify-between border-l border-line bg-surface p-6 lg:flex"><div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-moss">From your community</p><div className="mt-5 flex items-center gap-3"><Avatar src={reel.author.image} name={reel.author.username} size="md" /><div className="min-w-0"><Link href={`/profile/${reel.author.username}`} className="block truncate text-sm font-semibold">@{reel.author.username}</Link><p className="mt-1 text-xs text-ink/50">{relationship.following ? "Following" : relationship.pending ? "Request pending" : "Shared a reel"}</p></div></div>{reel.post?.caption ? <p className="mt-6 whitespace-pre-wrap text-sm leading-7">{reel.post.caption}</p> : <p className="mt-6 text-sm text-ink/45">No caption added.</p>}</div><div className="rounded-2xl bg-paper p-4"><p className="text-xs font-semibold text-ink/55">This moment</p><p className="mt-2 text-sm">{reel.post?._count?.likes || 0} appreciations <span className="mx-1 text-ink/30">·</span> {reel.post?._count?.comments || 0} comments</p></div></aside></article>;
      })}
      {!busy && !reels.length && <div className="mx-auto grid h-[60vh] max-w-md place-items-center rounded-3xl border border-line bg-surface p-10 text-center"><div><span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-mint text-moss"><Play /></span><h2 className="mt-4 font-semibold">No reels yet</h2></div></div>}
    </div>

    {undoReelId && <div role="status" className="fixed bottom-5 left-1/2 z-40 flex -translate-x-1/2 items-center gap-4 rounded-full bg-ink px-4 py-3 text-sm text-white shadow-soft">Reel hidden<button type="button" className="font-semibold text-mint" onClick={() => { if (hideTimer.current) window.clearTimeout(hideTimer.current); setHiddenReels((items) => items.filter((id) => id !== undoReelId)); setUndoReelId(null); }}>Undo</button></div>}

    {commentReel && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-label="Comments" className="fixed inset-0 z-50 bg-[rgba(10,12,20,.4)] p-0 backdrop-blur-md sm:grid sm:place-items-center sm:p-5" onMouseDown={(event) => { if (event.target === event.currentTarget) closeComments(); }}>
      <section className="glass-dialog absolute bottom-0 left-0 right-0 max-h-[82vh] rounded-t-[28px] p-0 text-ink sm:static sm:w-full sm:max-w-lg sm:rounded-[28px]">
        <header className="flex items-center justify-between border-b border-line px-5 py-4"><div><h2 className="font-semibold">Comments</h2><p className="text-xs text-ink/50">{commentReel.author?.username ? `@${commentReel.author.username}'s reel` : 'Reel'}</p></div><button type="button" onClick={closeComments} aria-label="Close comments" className="rounded-full p-2 hover:bg-paper"><X size={19} /></button></header>
        <div className="max-h-[65vh] overflow-y-auto px-5 py-4"><CommentsPanel postId={commentReel.post.id} postAuthorId={commentReel.author.id} recoImpressionId={commentReel.impressionId} onCommentAdded={(delta = 1) => { setReels((items) => items.map((item) => item.id === commentReel.id ? { ...item, post: { ...item.post, _count: { ...item.post._count, comments: Math.max(0, (item.post?._count?.comments || 0) + delta) } } } : item)); setCommentReel((value) => value ? { ...value, post: { ...value.post, _count: { ...value.post._count, comments: Math.max(0, (value.post?._count?.comments || 0) + delta) } } } : value); }} /></div>
      </section>
    </div>, document.body)}

    {shareReel && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-label="Share reel to Messages" className="fixed inset-0 z-[60] grid place-items-center bg-ink/45 backdrop-blur-md p-4" onClick={() => setShareReel(null)}><section className="max-h-[85vh] w-full max-w-md overflow-auto rounded-3xl bg-surface p-5 text-ink shadow-soft" onClick={(event) => event.stopPropagation()}><header className="mb-4 flex items-center justify-between"><div><h2 className="font-semibold">Share reel</h2><p className="text-xs text-ink/50">Choose up to five recipients</p></div><button type="button" onClick={() => setShareReel(null)} aria-label="Close share dialog" className="rounded-full p-2 hover:bg-paper"><X size={18} /></button></header>{shareLoading ? <p className="py-8 text-center text-sm text-ink/50">Loading recipients…</p> : shareError && !shareCandidates.length ? <div role="alert" className="py-6 text-center text-sm text-coral">{shareError}<button type="button" onClick={() => void searchShareCandidates()} className="ml-2 underline">Retry</button></div> : <><div className="mb-3 flex gap-2"><input value={shareSearch} onChange={(event) => setShareSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchShareCandidates(); } }} maxLength={30} aria-label="Search message recipients" placeholder="Search followers and conversations" className="min-w-0 flex-1 rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-moss" /><button type="button" onClick={() => void searchShareCandidates()} className="rounded-xl border border-line px-3 py-2 text-xs font-semibold">Search</button></div><div className="max-h-48 divide-y divide-line overflow-auto">{shareCandidates.map((person) => <button key={person.id} type="button" aria-pressed={shareSelected.includes(person.username)} disabled={!shareSelected.includes(person.username) && shareSelected.length >= 5} onClick={() => toggleShareRecipient(person.username)} className="flex w-full items-center gap-3 py-3 text-left hover:bg-paper disabled:opacity-40"><Avatar src={person.image} name={person.username} size="sm" /><span className="min-w-0 flex-1 truncate text-sm font-medium">@{person.username}</span><span className="text-xs font-semibold text-moss">{shareSelected.includes(person.username) ? 'Selected' : 'Select'}</span></button>)}</div>{!shareCandidates.length && <p className="py-5 text-center text-sm text-ink/50">No matching people.</p>}<label className="mt-3 grid gap-1 text-xs font-medium">Add a note (optional)<textarea rows={2} maxLength={500} value={shareNote} onChange={(event) => setShareNote(event.target.value)} className="resize-y rounded-xl border border-line p-3 text-sm font-normal outline-none focus:border-moss" /></label><button type="button" disabled={!shareSelected.length || shareBusy} onClick={() => void sendReelShare()} className="mt-3 w-full rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{shareBusy ? 'Sharing…' : `Share with ${shareSelected.length || 'selected'}`}</button>{shareError && <p role="alert" className="mt-3 text-sm text-coral">{shareError}</p>}</>}</section></div>, document.body)}
    {composer && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4 backdrop-blur-md"><form onSubmit={create} className="w-full max-w-md rounded-3xl bg-surface p-5 text-ink"><div className="mb-4 flex justify-between"><h2 className="font-semibold">Create a reel</h2><button type="button" onClick={() => setComposer(false)}>Close</button></div><input required type="file" accept="video/mp4,video/webm,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] || null)} className="block w-full text-sm" /><textarea value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={2200} rows={3} placeholder="Add a caption or hashtags" className="mt-4 w-full rounded-xl border border-line p-3 text-sm outline-none focus:border-moss" /><button disabled={!file || uploading} className="mt-4 w-full rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{uploading ? 'Uploading…' : 'Share reel'}</button></form></div>, document.body)}
  </div>;
}


