const STORAGE_KEY = 'gather:appearance';

export function getAppearance() {
  try { return localStorage.getItem(STORAGE_KEY) || 'light'; }
  catch { return 'light'; }
}

export function applyAppearance(mode = 'light') {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Theme still applies for this session. */ }
  const dark = mode === 'dark' || (mode === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent('gather:appearance', { detail: mode }));
}

