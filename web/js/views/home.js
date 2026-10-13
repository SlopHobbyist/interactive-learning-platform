/* Home: the learner's subjects (their library) and today's quests. The full
   catalog is at /subjects. */

import { el, icon, plural } from '../lib/dom.js';
import { hero, body, emptyState, page, section } from '../lib/view.js';
import { chestList, fmtHours, loadQuests, questList, unopenedChests } from '../lib/economy.js';
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

/* Daily quests (shop_plan.md §2): three meters, the chest state, when they
   reset, and any chests still waiting to be opened. Nothing when chests are off. */
async function questsPanel() {
  if (store.get('settings').chests === false) return null;
  const [data, chests] = await Promise.all([loadQuests(), unopenedChests()]);
  if (!data || !data.enabled || !data.quests.length) return null;
  const done = data.quests.filter((q) => q.done).length;
  const title = el('div', { class: 'row justify-between items-baseline' },
    el('h2', { class: 'view-section-title' }, 'Daily quests'),
    el('span', { class: 'text-caption text-muted' }, `${done}/${data.quests.length} done · new quests in ${fmtHours(data.resets_in)}`));
  return section(title,
    el('div', { class: 'quests-panel' }, questList(data.quests)),
    chests.length ? el('div', { class: 'mt-4' },
      el('p', { class: 'text-caption text-muted mb-2' }, chests.length === 1 ? 'A chest is waiting for you.' : `${chests.length} chests are waiting for you.`),
      chestList(chests)) : null);
}

export default async function view({ setTitle }) {
  setTitle('My subjects');
  const subjects = store.get('library') || await loadLibrary();
  const browse = el('a', { class: `button ${subjects.length ? 'button-tonal' : 'button-filled'}`, href: '/subjects' }, icon('add'), 'Add subjects');
  const quests = subjects.length ? await questsPanel() : null;
  return page(
    hero({
      eyebrow: 'Learn',
      title: 'My subjects',
      lede: subjects.length ? 'Pick a subject, then a course. Every lesson is a few minutes.' : null,
      actions: subjects.length ? [browse] : [],
    }),
    body(
      quests,
      subjects.length
        ? section(quests ? 'Subjects' : null, el('div', { class: 'grid-auto', style: '--min: 240px' }, ...subjects.map(subjectCard)))
        : emptyState('school', 'No subjects yet', 'Choose what you want to learn from the catalog. You can add or remove subjects any time.', browse)),
  );
}
