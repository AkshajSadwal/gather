'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, X, Trash2, Eye, LoaderCircle, RefreshCw } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';
import { useSession } from 'next-auth/react';
import Avatar from './Avatar';

export default function StoryTray() {
  const { data: session } = useSession();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [viewer, setViewer] = useState(null);
  const [storyViewers, setStoryViewers] = useState(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewersBusy, setViewersBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState('EVERYONE');
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftFile, setDraftFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [replyDraft, setReplyDraft] = useState('');
  const [replyBusy, setReplyBusy] = useState(false);
  const fileRef = useRef(null);
  const notify = useToast();
  const loadStories = useCallback(async () => {
    setLoadError('');
    try { const data = await api('/stories'); setGroups(data.users || []); }
    catch (error) { setLoadError(error.message || 'Could not load stories.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    if (!session) { setLoading(false); return; }
    setLoading(true);
    void loadStories();
  }, [session?.user?.id, loadStories]);
  useEffect(() => {
    const openFromCreateMenu = () => { setUploadError(''); setDraftFile(null); setCaption(''); setComposerOpen(true); };
    window.addEventListener('social:create-story', openFromCreateMenu);
    if (window.sessionStorage.getItem('gather:create-story') === '1') {
      window.sessionStorage.removeItem('gather:create-story');
      openFromCreateMenu();
    }
    return () => window.removeEventListener('social:create-story', openFromCreateMenu);
  }, []);
  useEffect(() => {
    if (!draftFile) { setPreviewUrl(''); return undefined; }
    const url = URL.createObjectURL(draftFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [draftFile]);

  const publishStory = async () => {
    if (!draftFile || busy) return;
    setBusy(true); setUploadError('');
    const form = new FormData(); form.set('media', draftFile); form.set('audience', audience); form.set('caption', caption);
    try {
      await api('/stories', { method: 'POST', body: form });
      notify('Your story is up for the next 24 hours.');
      setComposerOpen(false); setDraftFile(null); setCaption('');
      await loadStories();
    } catch (error) { setUploadError(error.message || 'Could not publish your story.'); }
    finally { setBusy(false); }
  };

  const allStories = groups.flatMap((group, groupIndex) => group.stories.map((story, storyIndex) => ({ groupIndex, storyIndex, group, story })));
  const current = viewer ? allStories.find((item) => item.groupIndex === viewer.groupIndex && item.storyIndex === viewer.storyIndex) : null;
  const ownGroup = groups.find((group) => group.user.id === session?.user?.id);
  const openComposer = () => { setUploadError(''); setComposerOpen(true); };
  const closeComposer = () => {
    if (busy) return;
    setComposerOpen(false); setDraftFile(null); setCaption(''); setUploadError('');
  };
  const advance = () => {
    if (!viewer) return;
    const group = groups[viewer.groupIndex];
    if (viewer.storyIndex + 1 < group.stories.length) setViewer({ ...viewer, storyIndex: viewer.storyIndex + 1 });
    else if (viewer.groupIndex + 1 < groups.length) setViewer({ groupIndex: viewer.groupIndex + 1, storyIndex: 0 });
    else setViewer(null);
  };
  const retreat = () => {
    if (!viewer) return;
    if (viewer.storyIndex > 0) setViewer({ ...viewer, storyIndex: viewer.storyIndex - 1 });
    else if (viewer.groupIndex > 0) setViewer({ groupIndex: viewer.groupIndex - 1, storyIndex: groups[viewer.groupIndex - 1].stories.length - 1 });
  };

  useEffect(() => {
    if (!current) return;
    setViewersOpen(false);
    setStoryViewers(null);
    setReplyDraft('');
    if (current.story.authorId !== session?.user?.id) api(`/stories/${current.story.id}/view`, { method: 'POST' }).catch(() => {});
    if (current.story.media[0]?.type !== 'VIDEO') { const timer = setTimeout(advance, 7000); return () => clearTimeout(timer); }
  }, [viewer?.groupIndex, viewer?.storyIndex, current?.story.id, session?.user?.id]);

  const deleteStory = async () => {
    try { await api(`/stories/${current.story.id}`, { method: 'DELETE' }); await loadStories(); setViewer(null); notify('Story removed.'); }
    catch (error) { notify(error.message, 'error'); }
  };

  const showViewers = async () => {
    if (!current) return;
    setViewersBusy(true);
    try { const data = await api(`/stories/${current.story.id}/viewers`); setStoryViewers(data.viewers); setViewersOpen(true); }
    catch (error) { notify(error.message, 'error'); }
    finally { setViewersBusy(false); }
  };

  const replyToStory = async (event) => {
    event.preventDefault();
    if (!current || !replyDraft.trim() || replyBusy) return;
    setReplyBusy(true);
    try { await api(`/stories/${encodeURIComponent(current.story.id)}/reply`, { method: 'POST', body: JSON.stringify({ text: replyDraft }) }); setReplyDraft(''); notify('Story reply sent.'); }
    catch (error) { notify(error.message, 'error'); }
    finally { setReplyBusy(false); }
  };

  return <>
    <div className="hide-scrollbar flex min-h-[98px] items-center gap-3 overflow-x-auto px-1 py-2" aria-label="Stories">
      <div className="relative flex w-[72px] shrink-0 justify-center">
        <button type="button" onClick={() => ownGroup && ownGroup.stories.length ? setViewer({ groupIndex: groups.indexOf(ownGroup), storyIndex: 0 }) : openComposer()} className="flex flex-col items-center gap-2 text-center" aria-label={ownGroup ? 'View your story' : 'Create your story'}>
          <Avatar ring={ownGroup?.stories.some((story) => story.audience === 'CLOSE_FRIENDS') ? 'close' : Boolean(ownGroup)} src={session?.user?.image || ownGroup?.user?.profile?.avatarUrl} name={ownGroup?.user?.username || session?.user?.name || session?.user?.email} size="md" />
          <span className="max-w-[70px] truncate text-[11px] text-ink/70">Your story</span>
        </button>
        <button type="button" onClick={openComposer} disabled={busy} aria-label="Add to your story" className="absolute left-[43px] top-[36px] grid h-6 w-6 place-items-center rounded-full border-2 border-white bg-moss text-white disabled:opacity-50"><Plus size={13} /></button>
      </div>
      <input ref={fileRef} type="file" hidden accept="image/*,video/mp4,video/webm,video/quicktime" onChange={(event) => { const file = event.target.files?.[0]; if (file) { setDraftFile(file); setCaption(''); setUploadError(''); setComposerOpen(true); } event.target.value = ''; }} />
      {loading && <p role="status" className="self-center text-xs text-ink/50">Loading stories…</p>}
      {!loading && loadError && <div role="alert" className="self-center text-xs text-coral">{loadError} <button type="button" onClick={() => { setLoading(true); void loadStories(); }} className="ml-1 inline-flex items-center gap-1 font-semibold underline"><RefreshCw size={12} />Retry</button></div>}
      {!loading && !loadError && groups.filter((group) => group.user.id !== session?.user?.id).map((group) => <button type="button" key={group.user.id} onClick={() => setViewer({ groupIndex: groups.indexOf(group), storyIndex: 0 })} aria-label={`View ${group.user.username}'s story`} className="flex w-[66px] shrink-0 flex-col items-center gap-2 text-center"><Avatar ring={group.stories.some((story) => story.audience === 'CLOSE_FRIENDS') ? 'close' : true} src={group.user.image || group.user.profile?.avatarUrl} name={group.user.username} size="md" /><span className="max-w-[70px] truncate text-[11px] text-ink/70">{group.user.username}</span></button>)}
      {!loading && !loadError && !groups.some((group) => group.user.id !== session?.user?.id) && <p className="self-center text-xs text-ink/45">No new stories</p>}
    </div>
    {composerOpen && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-labelledby="story-composer-title" className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(10,12,20,.4)] p-3 backdrop-blur-md sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') closeComposer(); }}>
      <section className="glass-dialog max-h-[92vh] w-full max-w-xl overflow-y-auto p-5 sm:p-7" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center justify-between"><div><h2 id="story-composer-title" className="text-lg font-bold">Create a story</h2><p className="mt-1 text-xs text-ink/50">Preview your photo or video before sharing.</p></div><button type="button" aria-label="Close story composer" onClick={closeComposer} disabled={busy} className="rounded-full p-2 hover:bg-paper disabled:opacity-40"><X size={18} /></button></header>
        {draftFile ? <div className="mt-4 overflow-hidden rounded-2xl bg-ink"><div className="grid max-h-[48vh] min-h-48 place-items-center">{draftFile.type.startsWith('video/') ? <video src={previewUrl} controls playsInline className="max-h-[48vh] w-full object-contain" /> : <img src={previewUrl} alt="Story preview" className="max-h-[48vh] w-full object-contain" />}</div></div> : <button type="button" onClick={() => fileRef.current?.click()} className="mt-4 grid min-h-48 w-full place-items-center rounded-2xl border-2 border-dashed border-line bg-paper text-sm font-semibold text-moss hover:border-moss">Choose a photo or video</button>}
        {draftFile && <div className="mt-3 flex items-center justify-between gap-3"><span className="min-w-0 truncate text-xs text-ink/50">{draftFile.name}</span><button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="shrink-0 text-xs font-semibold text-moss underline">Change media</button></div>}
        <label className="mt-4 block text-sm font-semibold" htmlFor="story-caption">Caption</label>
        <textarea id="story-caption" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={500} rows={2} placeholder="Add a caption…" className="mt-1 w-full resize-y rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-moss" />
        <label className="mt-4 block text-sm font-semibold" htmlFor="story-audience">Audience</label>
        <select id="story-audience" value={audience} onChange={(event) => setAudience(event.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-moss"><option value="EVERYONE">Your Story — everyone (followers for private accounts)</option><option value="CLOSE_FRIENDS">Close Friends</option></select>
        <p className="mt-2 text-xs text-ink/50">{audience === 'CLOSE_FRIENDS' ? 'Only people on your Close Friends list can view this story.' : 'Your account privacy settings still control who can view your story.'}</p>
        {uploadError && <p role="alert" className="mt-3 text-sm text-coral">{uploadError}</p>}
        {busy && <p role="status" className="mt-3 flex items-center gap-2 text-sm text-ink/60"><LoaderCircle size={16} className="animate-spin" />Uploading your story…</p>}
        <footer className="mt-5 flex justify-end gap-2"><button type="button" onClick={closeComposer} disabled={busy} className="rounded-xl border border-line px-4 py-2 text-sm font-semibold disabled:opacity-40">Cancel</button><button type="button" onClick={() => void publishStory()} disabled={!draftFile || busy} className="rounded-xl bg-moss px-4 py-2 text-sm font-semibold text-white disabled:opacity-45">{busy ? 'Publishing…' : 'Publish story'}</button></footer>
      </section>
    </div>, document.body)}
    {current && typeof document !== 'undefined' && createPortal(<div role="dialog" aria-modal="true" aria-label={`Story by ${current.group.user.username}`} className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(10,12,20,.4)] p-2 backdrop-blur-md sm:p-5" onKeyDown={(event) => { if (event.key === 'Escape') setViewer(null); if (event.key === 'ArrowRight') advance(); if (event.key === 'ArrowLeft') retreat(); }} tabIndex={-1}>
      <div className="story-viewer-card relative aspect-[9/16] h-[min(92dvh,820px)] w-auto max-w-[92vw] overflow-hidden rounded-[28px] bg-ink shadow-float">
        <div className="absolute left-3 right-3 top-3 z-10 flex gap-1">{current.group.stories.map((story, i) => <span key={story.id} className="h-1 flex-1 overflow-hidden rounded bg-surface/35"><span key={`${current.story.id}-${i}`} className={`block h-full origin-left bg-surface ${i < current.storyIndex ? 'w-full' : i === current.storyIndex && story.media[0]?.type !== 'VIDEO' ? 'animate-[story-progress_7s_linear_forwards]' : i === current.storyIndex ? 'w-full' : 'w-0'}`} /></span>)}</div>
        <div className="absolute left-3 right-3 top-7 z-10 flex items-center gap-3 text-white"><Avatar ring={current.story.audience === 'CLOSE_FRIENDS' ? 'close' : false} src={current.group.user.image} name={current.group.user.username} size="xs" /><Link href={`/profile/${current.group.user.username}`} className="flex-1 text-sm font-medium">{current.group.user.username}</Link><button aria-label="Close story" onClick={() => setViewer(null)} className="glass-pill grid h-9 w-9 place-items-center text-white"><X /></button></div>
        {current.story.media[0]?.type === 'VIDEO' ? <video src={mediaUrl(current.story.media[0].url)} autoPlay muted playsInline onEnded={advance} className="h-full w-full object-contain" /> : <img src={mediaUrl(current.story.media[0]?.url)} alt={current.story.caption || 'Story'} className="h-full w-full object-contain" />}
        {current.story.caption && <p className="absolute bottom-10 z-10 w-full px-8 text-center text-base text-white drop-shadow">{current.story.caption}</p>}
        {current.story.authorId !== session?.user?.id && <form onSubmit={replyToStory} className="absolute inset-x-3 bottom-4 z-20 flex gap-2"><input value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} onKeyDown={(event) => event.stopPropagation()} maxLength={1000} aria-label="Reply to story" placeholder="Reply to story…" className="min-w-0 flex-1 rounded-full border border-white/40 bg-black/45 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/70" /><button disabled={replyBusy || !replyDraft.trim()} className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink disabled:opacity-50">{replyBusy ? 'Sending…' : 'Send'}</button></form>}
        {current.story.authorId === session?.user?.id && <button onClick={showViewers} disabled={viewersBusy} className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-full bg-black/35 px-3 py-2 text-sm text-white"><Eye size={16} />{viewersBusy ? 'Loading…' : `${current.story._count?.views || 0} viewers`}</button>}
        {current.story.authorId === session?.user?.id && <button onClick={deleteStory} aria-label="Delete story" className="absolute bottom-4 right-4 z-20 rounded-full bg-black/30 p-2 text-white"><Trash2 size={18} /></button>}
        <button aria-label="Previous story" className="absolute inset-y-16 left-0 w-1/3" onClick={retreat} /><button aria-label="Next story" className="absolute inset-y-16 right-0 w-2/3" onClick={advance} />
        {viewersOpen && <div className="absolute inset-0 z-30 flex items-end bg-black/55 p-4" onClick={() => setViewersOpen(false)}><section role="dialog" aria-modal="true" aria-label="Story viewers" className="max-h-[65%] w-full overflow-hidden rounded-2xl bg-surface text-ink shadow-soft" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 className="font-semibold">Seen by</h2><p className="text-xs text-ink/50">{storyViewers?.length || 0} viewers</p></div><button aria-label="Close viewers" onClick={() => setViewersOpen(false)} className="rounded-full p-2 hover:bg-paper"><X size={18} /></button></header><div className="max-h-[45vh] overflow-auto p-3">{storyViewers?.length ? storyViewers.map((item) => <Link key={item.id} href={`/profile/${item.viewer.username}`} onClick={() => setViewersOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-paper"><Avatar src={item.viewer.image} name={item.viewer.username} size="sm" /><span className="min-w-0"><span className="block text-sm font-medium">{item.viewer.username}</span>{item.viewer.profile?.displayName && <span className="block truncate text-xs text-ink/50">{item.viewer.profile.displayName}</span>}</span><time className="ml-auto text-xs text-ink/40">{new Date(item.viewedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></Link>) : <p className="px-2 py-5 text-center text-sm text-ink/50">No one has viewed this story yet.</p>}</div></section></div>}
      </div>
    </div>, document.body)}
  </>;
}
