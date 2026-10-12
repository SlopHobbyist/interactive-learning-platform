/* Lesson player route. Phase 4 replaces this with the session engine; for now
   it fetches the rendered lesson and shows what it contains. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, page, comingSoon } from '../lib/view.js';

export default async function view({ params, setTitle }) {
  const { subject, course, unit, lesson } = params;
  const data = await get(`/api/lessons/${subject}/${course}/${unit}/${lesson}`);
  setTitle(data.title);
  const graded = data.items.filter((it) => it.graded).length;
  const list = el('div', { class: 'list list-divided' }, ...data.items.map((it, i) =>
    el('div', { class: 'list-item' },
      el('span', { class: 'list-item-leading text-mono' }, String(i + 1)),
      el('div', { class: 'list-item-text' },
        el('div', { class: 'list-item-title' }, it.type),
        el('div', { class: 'list-item-subtitle' }, it.id)),
      el('span', { class: 'list-item-trailing' }, it.graded ? el('span', { class: 'chip' }, 'graded') : null))));
  return page(
    hero({
      back: { href: `/c/${subject}/${course}`, label: 'Course' },
      eyebrow: `${data.xp} XP · ${plural(data.items.length, 'item')} · ${graded} graded`,
      title: data.title,
      lede: data.description,
      actions: [el('a', { class: 'button button-filled', href: `/c/${subject}/${course}` }, icon('arrow_back'), 'Back to course')],
    }),
    body(comingSoon(4, 'The lesson player'), el('div', { class: 'mt-5' }, list)),
  );
}
