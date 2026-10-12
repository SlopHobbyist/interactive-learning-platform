/* Review session: the player in review mode, fed by /api/review. A ?lesson=unit/lesson
   query makes it a single-tile re-tune. */

import { reviewQueue } from '../progress.js';
import { createPlayer } from '../player/player.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, page, emptyState } from '../lib/view.js';

export default async function view({ params, query, setTitle }) {
  const { subject, course } = params;
  const data = await reviewQueue(subject, course, { lessonKey: query.lesson || null });
  setTitle(data.title);
  const backHref = `/c/${subject}/${course}`;
  if (!data.items.length) {
    return page(
      hero({ back: { href: backHref, label: 'Course' }, eyebrow: 'Review', title: data.title }),
      body(emptyState('history', 'Nothing to review yet', data.description,
        el('a', { class: 'button button-filled', href: backHref }, icon('map'), 'Back to the map'))),
    );
  }
  return createPlayer({ lesson: data, mode: 'review', backHref, title: data.title });
}
