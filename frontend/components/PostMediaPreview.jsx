'use client';

import { useState } from 'react';
import { Play } from 'lucide-react';
import { mediaUrl } from '../lib/api';

export default function PostMediaPreview({ media, alt = 'Post media' }) {
  const [failed, setFailed] = useState(false);
  const source = mediaUrl(media?.url);
  const unavailable = !source || failed;

  return <div className="relative h-full w-full overflow-hidden bg-paper">
    {unavailable ? <div role="img" aria-label="Post media unavailable" className="grid h-full w-full place-items-center text-xs text-ink/45">Media unavailable</div> : media?.type === 'VIDEO' ? <video src={source} aria-label={alt} muted playsInline preload="metadata" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" /> : <img src={source} alt={alt} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />}
    {!unavailable && media?.type === 'VIDEO' && <span aria-label="Video post" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-black/55 text-white shadow-sm"><Play size={15} fill="currentColor" /></span>}
  </div>;
}
