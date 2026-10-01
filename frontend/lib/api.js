export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${API_URL}/api${path}`, { ...options, headers, credentials: 'include', cache: 'no-store' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    throw error;
  }
  return payload.data;
}

export function mediaUrl(url) {
  return url?.startsWith('http') ? url : `${API_URL}${url || ''}`;
}

export function initials(value = '?') {
  return String(value).replace(/^@/, '').slice(0, 1).toUpperCase();
}
