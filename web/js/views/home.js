/* Home: the learner's subjects (their library). The full catalog is at /subjects. */

import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page } from '../lib/view.js';
import { loadLibrary } from '../library.js';
import { store } from '../store.js';

function subjectCard(s) {
  return el('a', { class: 'card card-interactive subject-card', href: `/s/${s.id}`, 'aria-label': `${s.title}, ${plural(s.course_count, 'course')}` },
    el('div', { class: 'card-header' },
      el('span', { class: 'avatar' }, icon(s.icon || 'school')),
      el('div', { class: 'card-header-text' },
        el('h3', { class: 'card-title' }, s.title),
        el('p', { class: 'card-subtitle' }, plural(s.course_count, 'course')))),
    s.description ? el('div', { class: 'card-body' }, s.description) : null);
}

export default async function view({ setTitle }) {
  setTitle('My subjects');
  const subjects = store.get('library') || await loadLibrary();
  const browse = el('a', { class: `button ${subjects.length ? 'button-tonal' : 'button-filled'}`, href: '/subjects' }, icon('add'), 'Add subjects');
  return page(
    hero({
      eyebrow: 'Learn',
      title: 'My subjects',
      lede: subjects.length ? 'Pick a subject, then a course. Every lesson is a few minutes.' : null,
      actions: subjects.length ? [browse] : [],
    }),
    body(subjects.length
      ? el('div', { class: 'grid-auto', style: '--min: 240px' }, ...subjects.map(subjectCard))
      : emptyState('school', 'No subjects yet', 'Choose what you want to learn from the catalog. You can add or remove subjects any time.', browse)),
  );
}
