/* Review session route (Phase 6). */

import { get } from '../api.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, page, comingSoon } from '../lib/view.js';

export default async function view({ params, setTitle }) {
  const course = await get(`/api/courses/${params.subject}/${params.course}`, { cache: true });
  setTitle(`Review · ${course.title}`);
  return page(
    hero({
      back: { href: `/c/${params.subject}/${params.course}`, label: course.title },
      eyebrow: 'Review',
      title: 'Nothing due yet',
      lede: 'Review sessions pull the items you are closest to forgetting from every lesson you have finished.',
      actions: [el('a', { class: 'button button-tonal', href: `/c/${params.subject}/${params.course}` }, icon('arrow_back'), 'Back to course')],
    }),
    body(comingSoon(6, 'Spaced-repetition review')),
  );
}
