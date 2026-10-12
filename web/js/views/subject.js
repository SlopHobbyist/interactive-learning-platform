/* Courses in one subject. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page } from '../lib/view.js';
import { inLibrary, toggleSubject } from '../library.js';

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

/* Add to or remove from the learner's library (home page and sidebar). */
function libraryButton(subject) {
  const btn = el('button', { type: 'button', class: 'button' });
  const paint = () => {
    const added = inLibrary(subject.id);
    btn.className = `button ${added ? 'button-text' : 'button-filled'}`;
    btn.setAttribute('aria-pressed', String(added));
    btn.replaceChildren(icon(added ? 'check' : 'add'), added ? 'In my subjects' : 'Add to my subjects');
    btn.title = added ? 'Remove from my subjects (progress is kept)' : '';
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const added = await toggleSubject(subject.id);
      window.UI.toast(added ? `${subject.title} added to your subjects.` : `${subject.title} removed from your subjects. Your progress is kept.`);
    } catch { /* api.js toasted */ }
    btn.disabled = false;
    paint();
    btn.focus();
  });
  paint();
  return btn;
}

export default async function view({ params, setTitle }) {
  const subject = await get(`/api/subjects/${params.subject}`, { cache: true });
  setTitle(subject.title);
  const courses = subject.courses || [];
  return page(
    hero({
      back: { href: '/', label: 'My subjects' },
      eyebrow: 'Subject',
      title: subject.title,
      lede: subject.description,
      actions: [libraryButton(subject)],
    }),
    body(courses.length
      ? el('div', { class: 'grid-auto', style: '--min: 280px' }, ...courses.map((c) => courseCard(subject.id, c)))
      : emptyState('map', 'No courses yet', `Add a folder with a course.yaml under content/${subject.id}/.`)),
  );
}
