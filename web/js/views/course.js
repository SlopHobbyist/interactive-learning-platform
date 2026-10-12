/* Course page. Until Phase 6 draws the Wavefront map, this is a unit-by-unit
   lesson list. Lesson state comes from progress.js (server in Phase 5, a
   local stub before that); the frontier is computed from `requires`. */

import { get } from '../api.js';
import { courseProgress } from '../progress.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, section, page } from '../lib/view.js';

const STATE_ICON = { locked: 'lock', available: 'play_circle', complete: 'check_circle' };
const STATE_LABEL = { locked: 'Locked', available: 'Available', complete: 'Complete' };

export function lessonRow(course, unit, lesson, state) {
  const href = `/l/${course.subject.id}/${course.id}/${unit.id}/${lesson.id}`;
  const subtitle = [lesson.description, plural(lesson.item_count, 'item'), `${lesson.xp} XP`].filter(Boolean).join(' · ');
  return el(state === 'locked' ? 'div' : 'a', {
    class: 'list-item list-item-interactive lesson-row',
    href: state === 'locked' ? null : href,
    'data-state': state,
    'aria-disabled': state === 'locked' ? 'true' : null,
    'aria-label': `${lesson.title}, ${STATE_LABEL[state]}`,
  },
    el('span', { class: 'list-item-leading' }, icon(STATE_ICON[state])),
    el('div', { class: 'list-item-text' },
      el('div', { class: 'list-item-title' }, lesson.title),
      el('div', { class: 'list-item-subtitle' }, subtitle)),
    el('span', { class: 'list-item-trailing' },
      state === 'complete' ? el('span', { class: 'chip chip-success' }, 'Done') : null,
      state === 'available' ? icon('chevron_right') : null));
}

/** Frontier: a lesson is available when its unit's and its own requirements are complete. */
export function computeStates(course, progress) {
  const states = {};
  const unitDone = {};
  for (const unit of course.units) {
    unitDone[unit.id] = unit.lessons.length > 0 && unit.lessons.every((l) => progress.lessons[`${unit.id}/${l.id}`] === 'complete');
  }
  for (const unit of course.units) {
    const unitOpen = unit.requires.every((u) => unitDone[u]);
    for (const lesson of unit.lessons) {
      const key = `${unit.id}/${lesson.id}`;
      const done = progress.lessons[key] === 'complete';
      const reqs = lesson.requires.every((r) => progress.lessons[r] === 'complete');
      states[key] = done ? 'complete' : unitOpen && reqs ? 'available' : 'locked';
    }
  }
  return states;
}

export default async function view({ params, setTitle }) {
  const course = await get(`/api/courses/${params.subject}/${params.course}`, { cache: true });
  setTitle(course.title);
  const progress = await courseProgress(params.subject, params.course);
  const states = computeStates(course, progress);

  const units = course.units.map((unit) => {
    const rows = unit.lessons.map((lsn) => lessonRow(course, unit, lsn, states[`${unit.id}/${lsn.id}`]));
    const done = unit.lessons.filter((lsn) => states[`${unit.id}/${lsn.id}`] === 'complete').length;
    const pct = unit.lessons.length ? Math.round((done / unit.lessons.length) * 100) : 0;
    const head = el('div', { class: 'unit-head' },
      el('h2', { class: 'view-section-title m-0' }, unit.title, ' ', el('span', { class: 'text-muted' }, `${done}/${unit.lessons.length}`)),
      el('span', { class: 'spacer' }),
      el('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${unit.title} progress` },
        el('span', { class: 'meter-fill', style: `--value: ${pct}%` })));
    return section(head,
      unit.description ? el('p', { class: 'text-muted mb-3' }, unit.description) : null,
      el('div', { class: 'list list-divided', role: 'list' }, ...rows));
  });

  const total = course.units.reduce((n, u) => n + u.lessons.length, 0);
  const doneTotal = Object.values(states).filter((s) => s === 'complete').length;
  const next = Object.entries(states).find(([, s]) => s === 'available');
  const actions = [];
  if (next) {
    const [unitId, lessonId] = next[0].split('/');
    actions.push(el('a', { class: 'button button-filled', href: `/l/${course.subject.id}/${course.id}/${unitId}/${lessonId}` }, icon('play_arrow'), doneTotal ? 'Continue' : 'Start'));
  }
  actions.push(el('a', { class: 'button button-tonal', href: `/review/${course.subject.id}/${course.id}` }, icon('history'), 'Review'));

  return page(
    hero({
      back: { href: `/s/${course.subject.id}`, label: course.subject.title },
      eyebrow: course.level ? `${course.subject.title} · ${course.level}` : course.subject.title,
      title: course.title,
      lede: course.description || `${plural(course.units.length, 'unit')}, ${plural(total, 'lesson')}.`,
      actions,
      extra: el('p', { class: 'text-caption text-muted mt-3' }, `${doneTotal} of ${total} lessons complete`),
    }),
    body(...units),
  );
}
