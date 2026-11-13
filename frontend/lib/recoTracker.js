import { api } from './api';

const MAX_QUEUE = 200;
const BATCH_SIZE = 20;
let queue = [];
let timer;
let flushing = false;

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
  if (flushing || !queue.length) return;
  flushing = true;
  const batch = queue.splice(0, BATCH_SIZE);
  try {
    const events = batch.map(({ _retried, ...event }) => event);
    await api('/reco/events', { method: 'POST', body: JSON.stringify({ events }), keepalive });
  } catch {
    const retry = batch.filter((event) => !event._retried).map((event) => ({ ...event, _retried: true }));
    queue = [...retry, ...queue].slice(-MAX_QUEUE);
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
