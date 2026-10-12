/* 404 for unknown client routes. Uses the kit's error page pattern. */

import { el, icon } from '../lib/dom.js';

export default async function view({ path, setTitle }) {
  setTitle('Not found');
  return el('div', { class: 'container section' },
    el('div', { class: 'error-page' },
      el('p', { class: 'error-code' }, '404'),
      el('h1', { class: 'error-title' }, 'There is nothing here'),
      el('p', { class: 'error-body' }, `No page matches ${path}.`),
      el('div', { class: 'error-actions' },
        el('a', { class: 'button button-filled', href: '/' }, icon('home'), 'Subjects'))));
}
