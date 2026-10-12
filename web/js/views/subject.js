/* Courses in one subject. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page } from '../lib/view.js';

function courseCard(subjectId, c) {
  const meta = [c.level, plural(c.unit_count, 'unit'), plural(c.lesson_count, 'lesson')].filter(Boolean).join(' · ');
  const card = el('a', { class: 'card card-interactive course-card', href: `/c/${subjectId}/${c.id}` },
    el('div', { class: 'card-header' },
      el('span', { class: 'avatar' }, icon('map')),
      el('div', { class: 'card-header-text' },
        el('h3', { class: 'card-title' }, c.title),
        el('p', { class: 'card-subtitle' }, meta))),
    c.description ? el('div', { class: 'card-body' }, c.description) : null);
  if (c.tags && c.tags.length) {
    card.append(el('div', { class: 'card-actions' },
      el('div', { class: 'chip-set' }, ...c.tags.map((t) => el('span', { class: 'chip' }, t)))));
  }
  return card;
}

export default async function view({ params, setTitle }) {
  const subject = await get(`/api/subjects/${params.subject}`, { cache: true });
  setTitle(subject.title);
  const courses = subject.courses || [];
  return page(
    hero({
      back: { href: '/', label: 'Subjects' },
      eyebrow: 'Subject',
      title: subject.title,
      lede: subject.description,
    }),
    body(courses.length
      ? el('div', { class: 'grid-auto', style: '--min: 280px' }, ...courses.map((c) => courseCard(subject.id, c)))
      : emptyState('map', 'No courses yet', `Add a folder with a course.yaml under content/${subject.id}/.`)),
  );
}
