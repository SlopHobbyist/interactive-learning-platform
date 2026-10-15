/* A very small observable store. Keys: me, settings, subjects, library, dev, elements. */

const SETTINGS_KEY = 'ilp-settings';

export const DEFAULT_SETTINGS = {
  dailyGoal: 20,       // XP per day: 10 | 20 | 30 | 50
  combo: true,         // combo meter in lessons
  chests: true,        // daily quests and lesson chests
  sounds: true,        // sound effects (vendored audio)
  hardMode: false,     // hearts
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  devNow: '',          // dev only: time offset for progress requests ("+30d")
  goalChosen: false,   // the first-run goal dialog has been answered (server-side truth)
  league: true,        // multi-user mode: listed in the weekly XP league (opt out)
  skipAhead: false,    // course maps: locked tiles open their lesson anyway
  motion: 'system',    // 'system' follows the OS; 'reduce' | 'full' override it on this site
};

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

const state = {
  me: null,            // { xp_today, xp_total, streak, goal, ... } from /api/me (Phase 5)
  settings: loadSettings(),
  subjects: [],        // the whole catalog (/api/subjects)
  library: null,       // the learner's added subjects (/api/me/subjects); null = not loaded
  dev: false,
  elements: null,      // element registry from /api/elements
};

const listeners = new Map();

export const store = {
  get(key) { return state[key]; },
  set(key, value) {
    state[key] = value;
    if (key === 'settings') {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); } catch { /* private mode */ }
    }
    (listeners.get(key) || new Set()).forEach((fn) => {
      try { fn(value); } catch (err) { console.error('[store] listener failed', err); }
    });
    return value;
  },
  update(key, patch) {
    const current = state[key];
    const next = typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    return store.set(key, next);
  },
  subscribe(key, fn, { immediate = false } = {}) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    if (immediate) fn(state[key]);
    return () => listeners.get(key).delete(fn);
  },
};
