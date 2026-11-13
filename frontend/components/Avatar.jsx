import { initials, mediaUrl } from '../lib/api';

export default function Avatar({ src, name, size = 'md', ring = false, className = '' }) {
  const sizes = { xs: 'h-8 w-8 text-xs', sm: 'h-10 w-10 text-sm', md: 'h-12 w-12 text-sm', lg: 'h-[72px] w-[72px] text-xl', xl: 'h-28 w-28 text-3xl' };
  const content = src ? <img src={mediaUrl(src)} alt="" className="h-full w-full rounded-full object-cover" /> : <span className="grid h-full w-full place-items-center rounded-full bg-mint font-semibold text-moss">{initials(name)}</span>;
  const ringClass = ring === 'close' ? 'story-ring-close' : ring ? 'story-ring' : '';
  return <span className={`${ringClass} ${ringClass ? 'rounded-full' : ''} ${className}`}><span className={`${sizes[size] || sizes.md} inline-flex shrink-0 overflow-hidden rounded-full bg-surface align-middle`}>{content}</span></span>;
}
