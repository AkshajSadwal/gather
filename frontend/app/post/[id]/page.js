'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppShell from '../../../components/AppShell';
import PostCard from '../../../components/PostCard';
import { api } from '../../../lib/api';

export default function PostPage() {
  const { id } = useParams();
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { if (id) api(`/posts/${encodeURIComponent(id)}`).then((data) => setPost(data.post)).catch((problem) => setError(problem.message)); }, [id]);
  return <AppShell><div className="mx-auto max-w-[620px]">{post ? <PostCard initialPost={post} /> : error ? <div className="rounded-3xl border border-line bg-surface p-10 text-center"><h1 className="font-semibold">We couldn’t open that post</h1><p className="mt-2 text-sm text-ink/55">{error}</p><Link href="/explore" className="mt-4 inline-block text-sm font-semibold text-moss">Back to Explore</Link></div> : <div className="skeleton aspect-[4/5] rounded-3xl" />}</div></AppShell>;
}
