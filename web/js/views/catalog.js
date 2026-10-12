/* The master subject list. Learners add the subjects they want; those go to their home page
   and the sidebar, so an instance can hold hundreds of subjects while each learner sees a few. */

import { get } from '../api.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page } from '../lib/view.js';
import { inLibrary, toggleSubject } from '../library.js';

function addButton(s) {
  const btn = el('button', { class: 'button button-sm', type: 'button', 'data-subject': s.id });
  const paint = () => {
    const added = inLibrary(s.id);
    btn.className = `button button-sm ${added ? 'button-text' : 'button-tonal'}`;
    btn.setAttribute('aria-pressed', String(added));
    btn.setAttribute('aria-label', `${added ? 'Remove' : 'Add'} ${s.title} ${added ? 'from' : 'to'} my subjects`);
    btn.replaceChildren(icon(added ? 'check' : 'add', 'icon-sm'), added ? 'Added' : 'Add');
  };
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const added = await toggleSubject(s.id);
      window.UI.toast(added ? `${s.title} added to your subjects.` : `${s.title} removed. Your progress is kept.`);
    } catch { /* api.js toasted */ }
    btn.disabled = false;
    paint();
    btn.focus();
  });
  paint();
  return btn;
}

function catalogCard(s) {
  const haystack = `${s.title} ${s.description || ''} ${s.id}`.toLowerCase();
  return el('article', { class: 'card catalog-card', 'data-search': haystack },
    el('div', { class: 'card-header' },
      el('span', { class: 'avatar' }, icon(s.icon || 'school')),
      el('div', { class: 'card-header-text' },
        el('h3', { class: 'card-title' }, el('a', { class: 'catalog-link', href: `/s/${s.id}` }, s.title)),
        el('p', { class: 'card-subtitle' }, plural(s.course_count, 'course')))),
    s.description ? el('div', { class: 'card-body' }, s.description) : null,
    el('div', { class: 'card-actions' }, addButton(s)));
}

export default async function view({ setTitle, query }) {
  setTitle('All subjects');
  const subjects = await get('/api/subjects', { cache: true });
  const cards = subjects.map(catalogCard);
  const grid = el('div', { class: 'grid-auto', style: '--min: 260px' }, ...cards);
  const status = el('p', { class: 'text-caption text-muted catalog-count', role: 'status' });
  const none = el('div', { hidden: true }, emptyState('search_off', 'No subjects match', 'Try a shorter or different word.'));
  const input = el('input', { type: 'search', placeholder: 'Search subjects', 'aria-label': 'Search subjects', autocomplete: 'off' });
  input.value = query.q || '';

  function filter() {
    const words = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const match = words.every((w) => card.dataset.search.includes(w));
      card.hidden = !match;
      if (match) shown += 1;
    }
    status.textContent = words.length ? `${shown} of ${plural(cards.length, 'subject')}` : plural(cards.length, 'subject');
    none.hidden = shown > 0 || !cards.length;
  }
  input.addEventListener('input', filter);
  filter();

  return page(
    hero({
      back: { href: '/', label: 'My subjects' },
      eyebrow: 'Catalog',
      title: 'All subjects',
      lede: 'Add the subjects you want to learn. They show up on your home page and in the sidebar.',
      extra: el('div', { class: 'catalog-search mt-4' }, el('div', { class: 'search' }, icon('search'), input), status),
    }),
    body(subjects.length ? [grid, none] : emptyState('school', 'No subjects yet', 'Add a folder with a subject.yaml under content/ to get started.')),
  );
}
