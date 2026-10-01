'use client';

import { useEffect, useRef, useState } from 'react';
import { ImagePlus, LoaderCircle, Save, ShieldCheck, UserRoundCheck } from 'lucide-react';
import { api, mediaUrl } from '../lib/api';
import { useToast } from './Providers';
import Avatar from './Avatar';

export default function SettingsView() {
  const [form, setForm] = useState({ displayName: '', bio: '', website: '', visibility: 'PUBLIC' });
  const [me, setMe] = useState(null);
  const [requests, setRequests] = useState([]);
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const input = useRef(null);
  const notify = useToast();
  useEffect(() => {
    Promise.all([api('/auth/me'), api('/follows/requests')]).then(([account, pending]) => {
      setMe(account.user); setForm({ displayName: account.user.profile?.displayName || '', bio: account.user.profile?.bio || '', website: account.user.profile?.website || '', visibility: account.user.profile?.visibility || 'PUBLIC' }); setRequests(pending.requests || []);
    }).catch((error) => notify(error.message, 'error')).finally(() => setBusy(false));
  }, []);
  const save = async (event) => { event.preventDefault(); setSaving(true); try { await api('/users/me/profile', { method: 'PATCH', body: JSON.stringify(form) }); notify('Your profile has been updated.'); } catch (error) { notify(error.message, 'error'); } finally { setSaving(false); } };
  const upload = async (file) => { if (!file) return; const body = new FormData(); body.set('media', file); try { const result = await api('/users/me/avatar', { method: 'POST', body }); setMe((current) => ({ ...current, image: result.image })); notify('Profile photo updated.'); } catch (error) { notify(error.message, 'error'); } };
  const resolveRequest = async (id, accepted) => { try { await api(`/follows/requests/${id}`, { method: 'PATCH', body: JSON.stringify({ accepted }) }); setRequests((all) => all.filter((request) => request.id !== id)); notify(accepted ? 'Follow request accepted.' : 'Request declined.'); } catch (error) { notify(error.message, 'error'); } };

  if (busy) return <div className="mx-auto max-w-3xl"><div className="skeleton h-[480px] rounded-3xl" /></div>;
  return <div className="mx-auto max-w-3xl"><header className="mb-7"><p className="text-xs font-semibold uppercase tracking-[.18em] text-moss">Your corner, your rules</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Settings</h1><p className="mt-2 text-sm text-ink/55">Manage what people see and who can follow you.</p></header>
    <section className="rounded-3xl border border-line bg-white p-5 sm:p-7"><h2 className="text-lg font-semibold">Profile</h2><p className="mt-1 text-sm text-ink/50">These details appear on your public page.</p><div className="my-5 flex items-center gap-4"><Avatar src={me?.image} name={me?.username} size="lg" /><input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { upload(event.target.files?.[0]); event.target.value = ''; }} /><button onClick={() => input.current?.click()} className="flex items-center gap-2 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-paper"><ImagePlus size={17} />Change photo</button></div>
      <form onSubmit={save} className="grid gap-4"><label className="grid gap-1.5 text-sm font-medium">Display name<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} maxLength={60} className="rounded-xl border border-line px-4 py-3 font-normal outline-none focus:border-moss" /></label><label className="grid gap-1.5 text-sm font-medium">Bio<textarea rows={4} maxLength={500} value={form.bio} onChange={(event) => setForm({ ...form, bio: event.target.value })} placeholder="A few words about you…" className="resize-none rounded-xl border border-line px-4 py-3 font-normal outline-none focus:border-moss" /><span className="text-right text-xs font-normal text-ink/40">{form.bio.length}/500</span></label><label className="grid gap-1.5 text-sm font-medium">Website<input type="url" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} placeholder="https://" className="rounded-xl border border-line px-4 py-3 font-normal outline-none focus:border-moss" /></label><label className="grid gap-2 text-sm font-medium">Account visibility<select value={form.visibility} onChange={(event) => setForm({ ...form, visibility: event.target.value })} className="rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-moss"><option value="PUBLIC">Public — anyone can view your posts</option><option value="PRIVATE">Private — approve followers first</option></select></label><button disabled={saving} className="mt-1 flex items-center justify-center gap-2 rounded-xl bg-moss px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{saving ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />}Save changes</button></form>
    </section>
    <section className="mt-5 rounded-3xl border border-line bg-white p-5 sm:p-7"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-mint text-moss"><UserRoundCheck size={20} /></span><div><h2 className="font-semibold">Follow requests</h2><p className="text-sm text-ink/50">{form.visibility === 'PRIVATE' ? 'Choose who can see your private moments.' : 'Requests are accepted automatically while your profile is public.'}</p></div></div>{requests.length ? <div className="mt-4 divide-y divide-line">{requests.map((request) => <div key={request.id} className="flex items-center gap-3 py-3"><Avatar src={request.follower.image} name={request.follower.username} size="sm" /><div className="min-w-0 flex-1"><b className="block text-sm">@{request.follower.username}</b><small className="text-ink/45">{request.follower.profile?.displayName}</small></div><button onClick={() => resolveRequest(request.id, true)} className="rounded-lg bg-moss px-3 py-2 text-xs font-semibold text-white">Accept</button><button onClick={() => resolveRequest(request.id, false)} className="rounded-lg border border-line px-3 py-2 text-xs font-semibold">Decline</button></div>)}</div> : <div className="mt-4 rounded-xl bg-paper p-4 text-sm text-ink/55">No follow requests right now.</div>}</section>
    <div className="mt-4 flex items-center gap-2 px-2 text-xs leading-5 text-ink/40"><ShieldCheck size={16} className="shrink-0" />Your login uses secure, HttpOnly sessions. We never expose your password or server signing keys to the browser.</div>
  </div>;
}
