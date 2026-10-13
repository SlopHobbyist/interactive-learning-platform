/* Review session: the player in review mode, fed by /api/review. A ?lesson=unit/lesson
   query makes it a single-tile re-tune, which also offers to relearn the whole lesson
   (explanations and all, as the first time) for a learner who has forgotten it. */

import { reviewQueue } from '../progress.js';
import { createPlayer } from '../player/player.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, page, emptyState } from '../lib/view.js';

export default async function view({ params, query, setTitle }) {
  const { subject, course } = params;
  const lessonKey = query.lesson || null;
  const data = await reviewQueue(subject, course, { lessonKey });
  setTitle(data.title);
  const backHref = `/c/${subject}/${course}`;
  const relearn = (cls) => el('a', { class: `button ${cls}`, href: `/l/${subject}/${course}/${lessonKey}`, 'data-action': 'relearn' }, icon('school'), 'Relearn');
  if (!data.items.length) {
    const back = el('a', { class: 'button button-filled', href: backHref }, icon('map'), 'Back to the map');
    return page(
      hero({ back: { href: backHref, label: 'Course' }, eyebrow: 'Review', title: data.title }),
      body(emptyState('history', 'Nothing to review yet', data.description,
        lessonKey ? el('div', { class: 'row justify-center' }, back, relearn('button-tonal')) : back)),
    );
  }
  return createPlayer({ lesson: data, mode: 'review', backHref, title: data.title, introActions: lessonKey ? [relearn('button-tonal button-lg')] : [] });
}
