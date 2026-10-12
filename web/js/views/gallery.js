/* Element gallery (dev only). Phase 3 renders every example item with a Check
   button; for now it lists the installed elements and their examples. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, page, comingSoon } from '../lib/view.js';

export default async function view({ setTitle }) {
  setTitle('Element gallery');
  const elements = await get('/api/elements', { cache: true });
  const list = el('div', { class: 'list list-divided' }, ...elements.map((e) =>
    el('div', { class: 'list-item list-item-two-line' },
      el('span', { class: 'list-item-leading' }, icon(e.icon || 'extension')),
      el('div', { class: 'list-item-text' },
        el('div', { class: 'list-item-title' }, `${e.title} `, el('code', { class: 'code-inline' }, e.type)),
        el('div', { class: 'list-item-subtitle' }, e.description || '')),
      el('span', { class: 'list-item-trailing' },
        el('span', { class: e.graded ? 'chip chip-primary' : 'chip' }, e.graded ? 'graded' : 'ungraded'),
        e.self_graded ? el('span', { class: 'chip' }, 'self-graded') : null))));
  return page(
    hero({ eyebrow: 'Developer', title: 'Element gallery', lede: `${plural(elements.length, 'element')} installed from elements/.` }),
    body(comingSoon(3, 'Live example rendering with Check'), el('div', { class: 'mt-5' }, list)),
  );
}
