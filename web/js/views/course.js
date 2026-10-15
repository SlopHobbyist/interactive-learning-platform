/* Course page: the Wavefront map with coverage, Review and Continue. */

import { get } from '../api.js';
import { courseProgress, takeWave } from '../progress.js';
import { store } from '../store.js';
import { renderMap, COLS_MAX, COLS_NARROW } from '../map/map.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, page } from '../lib/view.js';

/** Average strength across all tiles (incomplete tiles count as 0). */
export function coverage(course, progress) {
  const keys = course.units.flatMap((u) => u.lessons.map((l) => `${u.id}/${l.id}`));
  if (!keys.length) return 0;
  const sum = keys.reduce((n, k) => n + (progress.lessons[k] === 'complete' ? (progress.strength[k] ?? 100) : 0), 0);
  return Math.round(sum / keys.length);
}

export default async function view({ params, setTitle }) {
  const { subject, course: courseId } = params;
  const course = await get(`/api/courses/${subject}/${courseId}`, { cache: true });
  setTitle(course.title);
  const progress = await courseProgress(subject, courseId);
  progress.lessons = progress.lessons || {};
  progress.strength = progress.strength || {};
  const wave = takeWave(subject, courseId);

  // Phones get one column fewer so the field fits without scrolling sideways.
  const narrow = window.matchMedia('(max-width: 520px)');
  const drawMap = (skipAhead) => renderMap({
    course,
    progress,
    wave,
    cols: narrow.matches ? COLS_NARROW : COLS_MAX,
    hrefFor: (t, state) => {
      if (state === 'available' || (state === 'locked' && skipAhead)) return `/l/${subject}/${courseId}/${t.unit.id}/${t.lesson.id}`;
      if (state === 'complete') return `/review/${subject}/${courseId}?lesson=${encodeURIComponent(t.key)}`;
      return null;
    },
  });
  let map = drawMap(store.get('settings').skipAhead);

  const total = course.units.reduce((n, u) => n + u.lessons.length, 0);
  const done = Object.values(progress.lessons).filter((s) => s === 'complete').length;
  const nextKey = map.layout.tiles.map((t) => t.key).find((k) => progress.lessons[k] === 'available');
  const cov = coverage(course, progress);
  const due = progress.due || 0;

  const actions = [];
  if (nextKey) {
    const [u, l] = nextKey.split('/');
    // Straight back from a lesson, focus lands here (the router honours data-autofocus), so
    // Enter starts the next lesson without a trip through the Tab order.
    actions.push(el('a', { class: 'button button-filled', href: `/l/${subject}/${courseId}/${u}/${l}`, 'data-action': 'continue', 'data-autofocus': wave ? '' : null }, icon('play_arrow'), done ? 'Continue' : 'Start'));
  }
  actions.push(el('a', { class: `button ${nextKey ? 'button-tonal' : 'button-filled'}`, href: `/review/${subject}/${courseId}`, 'data-action': 'review', 'aria-disabled': done ? null : 'true' },
    icon('history'), due ? `Review (${due} due)` : 'Review'));

  const meter = el('div', { class: 'coverage' },
    el('span', { class: 'text-caption text-muted' }, 'Coverage'),
    el('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': cov, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': 'Coverage: average strength across the map' },
      el('span', { class: 'meter-fill', style: `--value: ${cov}%` })),
    el('span', { class: 'coverage-value', 'data-coverage': cov }, `${cov}% · ${done}/${total} lessons`));

  // Skip ahead: open lessons that aren't unlocked yet. Remembered across courses (settings).
  const skip = el('input', { type: 'checkbox', role: 'switch', 'data-action': 'skip-ahead', checked: store.get('settings').skipAhead ? true : null });
  const redraw = () => {
    const next = drawMap(skip.checked);
    map.replaceWith(next);
    map = next;
  };
  skip.addEventListener('change', () => {
    store.update('settings', { skipAhead: skip.checked });
    redraw();
  });
  narrow.addEventListener('change', redraw);
  const skipToggle = el('label', { class: 'switch', title: "Skip ahead: open lessons you haven't unlocked yet" },
    skip, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })), el('span', {}, 'Skipping?'));

  const root = page(
    hero({
      aside: skipToggle,
      back: { href: `/s/${subject}`, label: course.subject.title },
      eyebrow: course.level ? `${course.subject.title} · ${course.level}` : course.subject.title,
      title: course.title,
      lede: course.description || `${plural(course.units.length, 'unit')}, ${plural(total, 'lesson')}.`,
      actions,
      extra: meter,
    }),
    body(
      el('p', { class: 'text-caption text-muted mb-2' }, 'Tiles light up as you reach them and fade as you forget. Tap a faded tile to re-tune it.'),
      map),
  );
  root.destroy = () => narrow.removeEventListener('change', redraw);
  return root;
}
