'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Plus, X, Trash2, Eye } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';
import { useSession } from 'next-auth/react';
import Avatar from './Avatar';

export default function StoryTray() {
  const { data: session } = useSession();
  const [groups, setGroups] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [storyViewers, setStoryViewers] = useState(null);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewersBusy, setViewersBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const notify = useToast();
  useEffect(() => { if (session) api('/stories').then((data) => setGroups(data.users || [])).catch(() => {}); }, [session]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true); const form = new FormData(); form.set('media', file);
    try { await api('/stories', { method: 'POST', body: form }); notify('Your story is up for the next 24 hours.'); const data = await api('/stories'); setGroups(data.users || []); }
    catch (error) { notify(error.message, 'error'); } finally { setBusy(false); }
  };

  const allStories = groups.flatMap((group, groupIndex) => group.stories.map((story, storyIndex) => ({ groupIndex, storyIndex, group, story })));
  const current = viewer ? allStories.find((item) => item.groupIndex === viewer.groupIndex && item.storyIndex === viewer.storyIndex) : null;
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
    if (current.story.authorId !== session?.user?.id) api(`/stories/${current.story.id}/view`, { method: 'POST' }).catch(() => {});
    if (current.story.media[0]?.type !== 'VIDEO') { const timer = setTimeout(advance, 7000); return () => clearTimeout(timer); }
  }, [viewer?.groupIndex, viewer?.storyIndex, current?.story.id, session?.user?.id]);

  const deleteStory = async () => {
    try { await api(`/stories/${current.story.id}`, { method: 'DELETE' }); const data = await api('/stories'); setGroups(data.users || []); setViewer(null); notify('Story removed.'); }
    catch (error) { notify(error.message, 'error'); }
  };

  const showViewers = async () => {
    if (!current) return;
    setViewersBusy(true);
    try { const data = await api(`/stories/${current.story.id}/viewers`); setStoryViewers(data.viewers); setViewersOpen(true); }
    catch (error) { notify(error.message, 'error'); }
    finally { setViewersBusy(false); }
  };

  return <>
    <div className="hide-scrollbar flex gap-4 overflow-x-auto rounded-[24px] border border-line bg-white px-4 py-4 shadow-sm">
      <button onClick={() => fileRef.current?.click()} className="flex w-[66px] shrink-0 flex-col items-center gap-2 text-center" disabled={busy}><span className="relative"><Avatar src={session?.user?.image} name={session?.user?.name || session?.user?.email} size="md" /><span className="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-moss text-white"><Plus size={12} /></span></span><span className="max-w-[70px] truncate text-[11px] text-ink/70">Your story</span></button>
      <input ref={fileRef} type="file" hidden accept="image/*,video/mp4,video/webm,video/quicktime" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} />
      {groups.filter((group) => group.user.id !== session?.user?.id).map((group) => <button key={group.user.id} onClick={() => setViewer({ groupIndex: groups.indexOf(group), storyIndex: 0 })} className="flex w-[66px] shrink-0 flex-col items-center gap-2 text-center"><Avatar ring src={group.user.image || group.user.profile?.avatarUrl} name={group.user.username} size="md" /><span className="max-w-[70px] truncate text-[11px] text-ink/70">{group.user.username}</span></button>)}
      {groups.find((group) => group.user.id === session?.user?.id)?.stories.map((story, index) => <button key={story.id} onClick={() => setViewer({ groupIndex: groups.findIndex((group) => group.user.id === session?.user?.id), storyIndex: index })} className="flex w-[66px] shrink-0 flex-col items-center gap-2 text-center"><Avatar ring src={session?.user?.image} name={session?.user?.name || session?.user?.email} size="md" /><span className="max-w-[70px] truncate text-[11px] text-ink/70">{index === 0 ? 'Your story' : `Story ${index + 1}`}</span></button>)}
    </div>
    {current && <div role="dialog" aria-modal="true" aria-label={`Story by ${current.group.user.username}`} className="fixed inset-0 z-[60] grid place-items-center bg-black p-0 sm:p-5" onKeyDown={(event) => { if (event.key === 'Escape') setViewer(null); if (event.key === 'ArrowRight') advance(); if (event.key === 'ArrowLeft') retreat(); }} tabIndex={-1}>
      <div className="relative h-full w-full max-w-[480px] overflow-hidden bg-ink sm:h-[min(90vh,850px)] sm:rounded-3xl">
        <div className="absolute left-3 right-3 top-3 z-10 flex gap-1">{current.group.stories.map((story, i) => <span key={story.id} className="h-1 flex-1 overflow-hidden rounded bg-white/35"><span key={`${current.story.id}-${i}`} className={`block h-full origin-left bg-white ${i < current.storyIndex ? 'w-full' : i === current.storyIndex && story.media[0]?.type !== 'VIDEO' ? 'animate-[story-progress_7s_linear_forwards]' : i === current.storyIndex ? 'w-full' : 'w-0'}`} /></span>)}</div>
        <div className="absolute left-3 right-3 top-7 z-10 flex items-center gap-3 text-white"><Avatar src={current.group.user.image} name={current.group.user.username} size="xs" /><Link href={`/profile/${current.group.user.username}`} className="flex-1 text-sm font-medium">{current.group.user.username}</Link><button aria-label="Close story" onClick={() => setViewer(null)}><X /></button></div>
        {current.story.media[0]?.type === 'VIDEO' ? <video src={mediaUrl(current.story.media[0].url)} autoPlay muted playsInline onEnded={advance} className="h-full w-full object-contain" /> : <img src={mediaUrl(current.story.media[0]?.url)} alt={current.story.caption || 'Story'} className="h-full w-full object-contain" />}
        {current.story.caption && <p className="absolute bottom-10 z-10 w-full px-8 text-center text-base text-white drop-shadow">{current.story.caption}</p>}
        {current.story.authorId === session?.user?.id && <button onClick={showViewers} disabled={viewersBusy} className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-full bg-black/35 px-3 py-2 text-sm text-white"><Eye size={16} />{viewersBusy ? 'Loading…' : `${current.story._count?.views || 0} viewers`}</button>}
        {current.story.authorId === session?.user?.id && <button onClick={deleteStory} aria-label="Delete story" className="absolute bottom-4 right-4 z-20 rounded-full bg-black/30 p-2 text-white"><Trash2 size={18} /></button>}
        <button aria-label="Previous story" className="absolute inset-y-16 left-0 w-1/3" onClick={retreat} /><button aria-label="Next story" className="absolute inset-y-16 right-0 w-2/3" onClick={advance} />
        {viewersOpen && <div className="absolute inset-0 z-30 flex items-end bg-black/55 p-4" onClick={() => setViewersOpen(false)}><section role="dialog" aria-modal="true" aria-label="Story viewers" className="max-h-[65%] w-full overflow-hidden rounded-2xl bg-white text-ink shadow-soft" onClick={(event) => event.stopPropagation()}><header className="flex items-center justify-between border-b border-line px-4 py-3"><div><h2 className="font-semibold">Seen by</h2><p className="text-xs text-ink/50">{storyViewers?.length || 0} viewers</p></div><button aria-label="Close viewers" onClick={() => setViewersOpen(false)} className="rounded-full p-2 hover:bg-paper"><X size={18} /></button></header><div className="max-h-[45vh] overflow-auto p-3">{storyViewers?.length ? storyViewers.map((item) => <Link key={item.id} href={`/profile/${item.viewer.username}`} onClick={() => setViewersOpen(false)} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-paper"><Avatar src={item.viewer.image} name={item.viewer.username} size="sm" /><span className="min-w-0"><span className="block text-sm font-medium">{item.viewer.username}</span>{item.viewer.profile?.displayName && <span className="block truncate text-xs text-ink/50">{item.viewer.profile.displayName}</span>}</span><time className="ml-auto text-xs text-ink/40">{new Date(item.viewedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time></Link>) : <p className="px-2 py-5 text-center text-sm text-ink/50">No one has viewed this story yet.</p>}</div></section></div>}
      </div>
    </div>}
  </>;
}
