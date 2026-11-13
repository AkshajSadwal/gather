import Link from 'next/link';
import { auth } from '../auth';
import AppShell from '../components/AppShell';
import Feed from '../components/Feed';
import StoryTray from '../components/StoryTray';
import Avatar from '../components/Avatar';

export default async function HomePage() {
  const session = await auth();
  return <AppShell><div className="today-layout mx-auto grid max-w-[1540px] grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
    <section className="today-main min-w-0 w-full"><div className="today-welcome mb-6"><p className="text-[11px] font-semibold uppercase tracking-[.2em] text-moss">A social journal</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Good to see you<span className="text-coral">.</span></h1><p className="mt-1 text-sm text-ink/55">A little inspiration from your circle.</p></div><section className="today-moments" aria-label="Moments"><div className="mb-1 flex items-center justify-between"><h2 className="text-sm font-semibold">Moments</h2><span className="text-[11px] text-ink/45">From your people</span></div><StoryTray /></section><div className="mb-3 mt-7 flex items-center justify-between"><h2 className="text-base font-semibold">From your circle</h2><Link href="/explore" className="text-sm font-medium text-moss hover:underline">Find people</Link></div><Feed /></section>
    <aside className="today-shelf hidden pt-6 2xl:block"><div className="sticky top-10 rounded-[24px] border border-line bg-surface p-6 shadow-soft"><div className="flex items-center gap-3"><Avatar src={session?.user?.image} name={session?.user?.name || session?.user?.email} size="md" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{session?.user?.name || 'Your account'}</p><p className="truncate text-xs text-ink/50">@{session?.user?.username || session?.user?.email?.split('@')[0]}</p></div></div><div className="my-5 h-px bg-line" /><p className="text-sm font-semibold">A little more connection</p><p className="mt-2 text-sm leading-6 text-ink/55">Find interesting people, share a moment, or start a conversation with someone you follow.</p><div className="mt-4 grid gap-2"><Link href="/explore" className="rounded-xl bg-moss px-4 py-3 text-center text-sm font-semibold text-white">Explore the community</Link><Link href="/messages" className="rounded-xl border border-line px-4 py-3 text-center text-sm font-medium text-ink">Open messages</Link></div><p className="mt-6 text-[11px] text-ink/35">Gather · A place for moments and people</p></div></aside>
  </div></AppShell>;
}

