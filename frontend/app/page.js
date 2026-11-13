import Link from 'next/link';
import { auth } from '../auth';
import AppShell from '../components/AppShell';
import Feed from '../components/Feed';
import StoryTray from '../components/StoryTray';
import Avatar from '../components/Avatar';

export default async function HomePage() {
  const session = await auth();
  return <AppShell><div className="today-layout mx-auto grid max-w-[1540px] grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,390px)]">
    <section className="today-main min-w-0 w-full"><div className="today-welcome mb-5"><h1 className="text-lg font-semibold tracking-tight">Home</h1></div><section className="today-moments" aria-label="Stories"><div className="mb-1 flex items-center"><h2 className="text-sm font-semibold">Stories</h2></div><StoryTray /></section><div className="mb-3 mt-7 flex items-center justify-between"><h2 className="text-base font-semibold">From your circle</h2><Link href="/explore" className="text-sm font-medium text-moss hover:underline">Find people</Link></div><Feed /></section>
    <aside className="today-shelf hidden pt-6 2xl:block"><div className="glass sticky top-10 p-6"><div className="flex items-center gap-3"><Avatar src={session?.user?.image} name={session?.user?.name || session?.user?.email} size="md" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{session?.user?.name || 'Your account'}</p><p className="truncate text-xs text-ink/50">@{session?.user?.username || session?.user?.email?.split('@')[0]}</p></div></div><div className="my-5 h-px bg-line" /><div className="mt-4 grid gap-2"><Link href="/explore" className="glass-button px-4 py-3 text-center text-sm font-semibold">Explore</Link><Link href="/messages" className="glass-pill px-4 py-3 text-center text-sm font-medium text-ink">Messages</Link></div></div></aside>
  </div></AppShell>;
}

