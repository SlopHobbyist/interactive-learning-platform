/* Subjects overview. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page } from '../lib/view.js';

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
  setTitle('Subjects');
  const subjects = await get('/api/subjects', { cache: true });
  const grid = el('div', { class: 'grid-auto', style: '--min: 240px' }, ...subjects.map(subjectCard));
  return page(
    hero({ eyebrow: 'Learn', title: 'Subjects', lede: 'Pick a subject, then a course. Every lesson is a few minutes.' }),
    body(subjects.length ? grid : emptyState('school', 'No subjects yet', 'Add a folder with a subject.yaml under content/ to get started.')),
  );
}
