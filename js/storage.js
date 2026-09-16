// Persisted progress: unlocked level count, stars per level, mute flag.
const KEY = 'llama-crossing-v1';

const DEFAULTS = { unlocked: 1, stars: {}, muted: false };

export function loadProgress() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveProgress(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private mode etc. */ }
}
