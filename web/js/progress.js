/* Progress access for views and the player.

   Phase 4: the server has no progress endpoints yet, so completions are kept
   in localStorage and attempts are only logged. Phase 5 swaps the bodies of
   these functions for /api/progress, /api/attempts and /api/lessons/.../complete
   without changing their callers. */

import { get, post } from './api.js';
import { store } from './store.js';

const LOCAL_KEY = 'ilp-local-progress';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function writeLocal(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** { units: {unitId: 'complete'}, lessons: {'unit/lesson': 'complete'}, strength: {...} } */
export async function courseProgress(subject, course) {
  try {
    return await get(`/api/progress/${subject}/${course}`, { silent: true });
  } catch {
    const local = readLocal();
    const prefix = `${subject}/${course}/`;
    const lessons = {};
    for (const path of Object.keys(local.completed || {})) {
      if (path.startsWith(prefix)) {
        const [unit, lesson] = path.slice(prefix.length).split('/');
        lessons[`${unit}/${lesson}`] = 'complete';
      }
    }
    return { units: {}, lessons, strength: {}, local: true };
  }
}

/** Flush a batch of attempts. Returns the server response or null when stubbed. */
export async function sendAttempts(attempts) {
  if (!attempts.length) return null;
  try {
    return await post('/api/attempts', { attempts, timezone: store.get('settings').timezone }, { silent: true });
  } catch {
    return null; // Phase 5
  }
}

/** Record a lesson completion. Returns { xp, unlocked: [...], streak, drop } (server) or a stub. */
export async function completeLesson(path, summary) {
  const settings = store.get('settings');
  try {
    const res = await post(`/api/lessons/${path}/complete`, {
      xp: summary.xp,
      accuracy: summary.accuracy,
      perfect: summary.perfect,
      elapsed_ms: summary.elapsedMs,
      timezone: settings.timezone,
    }, { silent: true });
    if (res && res.me) store.set('me', res.me);
    return res;
  } catch {
    const local = readLocal();
    local.completed = local.completed || {};
    local.completed[path] = { at: new Date().toISOString(), xp: summary.xp };
    local.xp = (local.xp || 0) + summary.xp;
    writeLocal(local);
    const me = store.get('me') || { xp_today: 0, xp_total: 0, streak: 0, daily_goal: settings.dailyGoal };
    store.set('me', { ...me, xp_today: (me.xp_today || 0) + summary.xp, xp_total: (me.xp_total || 0) + summary.xp });
    return { xp: summary.xp, unlocked: [], local: true };
  }
}

export function resetLocalProgress() {
  writeLocal({});
}
