import { api } from './api';

const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
const RETRY_DELAYS_MS = [5000, 10000, 30000, 60000];
let queue = [];
let timer;
let flushing = false;
let retryAttempt = 0;
let retryAfter = 0;

function uuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function recoSessionId() {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.sessionStorage.getItem('gather-reco-session');
    if (!id) { id = uuid(); window.sessionStorage.setItem('gather-reco-session', id); }
    return id;
  } catch { return uuid(); }
}

export function trackReelEvent(event) {
  if (typeof window === 'undefined' || !event?.reelId || !event?.impressionId) return;
  queue.push({ eventId: uuid(), sessionId: recoSessionId(), occurredAt: new Date().toISOString(), ...event });
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE);
  if (!timer) timer = window.setTimeout(() => { timer = undefined; void flushRecoEvents(); }, 5000);
  if (queue.length >= BATCH_SIZE) void flushRecoEvents();
}

export async function flushRecoEvents(keepalive = false) {
  if (flushing || !queue.length || Date.now() < retryAfter) return false;
  flushing = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    await api('/reco/events', { method: 'POST', body: JSON.stringify({ events: batch }), keepalive });
    retryAttempt = 0;
    retryAfter = 0;
    return true;
  } catch {
    // Preserve the original event IDs so a retry is safe if the server committed
    // the batch but its response was lost. Keep failed events ahead of newer ones.
    queue = [...batch, ...queue].slice(0, MAX_QUEUE);
    retryAfter = Date.now() + RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)];
    retryAttempt = Math.min(retryAttempt + 1, RETRY_DELAYS_MS.length - 1);
    return false;
  } finally {
    flushing = false;
  }
}

export function initRecoTrackerLifecycle() {
  if (typeof window === 'undefined' || window.__gatherRecoLifecycle) return;
  window.__gatherRecoLifecycle = true;
  window.setInterval(() => { void flushRecoEvents(); }, 5000);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushRecoEvents(true); });
  window.addEventListener('pagehide', () => { void flushRecoEvents(true); });
}
