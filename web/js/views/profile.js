/* Profile and stats (Phase 7 fills this with real data). */

import { store } from '../store.js';
import { el } from '../lib/dom.js';
import { hero, body, page, comingSoon } from '../lib/view.js';

function stat(label, value) {
  return el('div', { class: 'stat' },
    el('span', { class: 'stat-label' }, label),
    el('span', { class: 'stat-value' }, String(value)));
}

export default async function view({ setTitle }) {
  setTitle('Profile');
  const me = store.get('me');
  const settings = store.get('settings');
  return page(
    hero({ eyebrow: 'You', title: 'Profile' }),
    body(
      el('div', { class: 'grid-auto', style: '--min: 160px' },
        stat('XP today', me ? me.xp_today : 0),
        stat('Daily goal', `${me ? me.daily_goal : settings.dailyGoal} XP`),
        stat('Streak', `${me ? me.streak : 0} days`),
        stat('Total XP', me ? me.xp_total : 0)),
      el('div', { class: 'mt-5' }, comingSoon(7, 'Stats, the streak calendar and drop odds'))),
  );
}
