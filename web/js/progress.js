/* Progress access for views and the player: the thin layer over /api/progress,
   /api/attempts, /api/lessons/.../complete and /api/review. Falls back to a
   localStorage stub when the server is unreachable so the app degrades, not dies. */

import { get, post } from './api.js';
import { store } from './store.js';

const LOCAL_KEY = 'ilp-local-progress';
const WAVE_KEY = 'ilp-wave';

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); } catch { return {}; }
}
function writeLocal(data) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(data)); } catch { /* ignore */ }
}

/** Dev-only time travel: settings.devNow ("+30d", "-2h", ISO) is sent as ?now= . */
export function withNow(path) {
  const offset = store.get('dev') ? (store.get('settings').devNow || '').trim() : '';
  if (!offset) return path;
  return `${path}${path.includes('?') ? '&' : '?'}now=${encodeURIComponent(offset)}`;
}

/** { units, lessons: {'unit/lesson': state}, strength: {'unit/lesson': 0..100}, due, completed, total } */
export async function courseProgress(subject, course) {
  try {
    return await get(withNow(`/api/progress/${subject}/${course}`), { silent: true });
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
    return { units: {}, lessons, strength: {}, due: 0, local: true };
  }
}

/** The review payload (lesson-shaped). `lessonKey` limits it to one tile (re-tune). */
export async function reviewQueue(subject, course, { limit = 12, lessonKey = null } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (lessonKey) q.set('lesson', lessonKey);
  return get(withNow(`/api/review/${subject}/${course}?${q}`));
}

/** Flush a batch of attempts. Returns the server response or null when stubbed. */
export async function sendAttempts(attempts, mode = 'lesson') {
  if (!attempts.length) return null;
  try {
    return await post(withNow('/api/attempts'), { attempts, mode, timezone: store.get('settings').timezone }, { silent: true });
  } catch {
    return null;
  }
}

/** Record a lesson completion. Returns the server result ({ xp, unlocked, streak, daily, me }) or a stub. */
export async function completeLesson(path, summary) {
  const settings = store.get('settings');
  try {
    const res = await post(withNow(`/api/lessons/${path}/complete`), {
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
    writeLocal(local);
    const me = store.get('me') || { xp_today: 0, xp_total: 0, streak: 0, daily_goal: settings.dailyGoal };
    store.set('me', { ...me, xp_today: (me.xp_today || 0) + summary.xp, xp_total: (me.xp_total || 0) + summary.xp });
    return { xp: summary.xp, unlocked: [], local: true };
  }
}

/** Record a finished review session (XP + daily goal; no completion row). */
export async function completeReview(lesson, summary) {
  try {
    const res = await post(withNow(`/api/review/${lesson.subject}/${lesson.course}/complete`), {
      xp: summary.xp,
      items: summary.items,
      accuracy: summary.accuracy,
      timezone: store.get('settings').timezone,
    }, { silent: true });
    if (res && res.me) store.set('me', res.me);
    return res;
  } catch {
    return null;
  }
}

/* The wavefront: the player leaves a note about what just unlocked; the map
   reads it once on the next render and animates the wave. */
export function rememberWave(lesson, result) {
  try {
    sessionStorage.setItem(WAVE_KEY, JSON.stringify({
      course: `${lesson.subject}/${lesson.course}`,
      from: `${lesson.unit}/${lesson.id}`,
      unlocked: (result && result.unlocked) || [],
      at: Date.now(),
    }));
  } catch { /* ignore */ }
}

export function takeWave(subject, course) {
  try {
    const raw = sessionStorage.getItem(WAVE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(WAVE_KEY);
    const wave = JSON.parse(raw);
    if (wave.course !== `${subject}/${course}` || Date.now() - wave.at > 5 * 60 * 1000) return null;
    return wave;
  } catch {
    return null;
  }
}

export function resetLocalProgress() {
  writeLocal({});
}
