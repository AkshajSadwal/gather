export function normalizeMediaSource(value) {
  if (typeof value !== 'string') return null;
  const source = value.trim();
  return source || null;
}

export function resolveMediaUrl(value, apiUrl) {
  const source = normalizeMediaSource(value);
  if (!source) return null;
  if (/^https?:\/\//i.test(source)) return source;
  if (source.startsWith('s3://')) return `${apiUrl}/api/media?key=${encodeURIComponent(source)}`;
  return `${apiUrl}${source}`;
}
