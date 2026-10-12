/* Profile and stats (plan §6): daily goal ring, streak, XP over time, a streak
   calendar heatmap, coverage per course, accuracy per element type, the
   weakest items, the inventory and the drop odds. All drawn with Wavefront's
   data components (stat, donut, meter, month-grid-style cells) and fills only. */

import { get } from '../api.js';
import { withNow } from '../progress.js';
import { store } from '../store.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, section, page, emptyState } from '../lib/view.js';

function stat(label, value, extra = null) {
  return el('div', { class: 'stat' }, el('span', { class: 'stat-label' }, label), el('span', { class: 'stat-value' }, String(value)), extra);
}

function goalRing(me) {
  const pct = Math.min(100, Math.round((me.xp_today / Math.max(1, me.daily_goal)) * 100));
  return el('div', { class: 'donut-figure', role: 'img', 'aria-label': `${me.xp_today} of ${me.daily_goal} XP today` },
    el('div', { class: `donut ${pct >= 100 ? 'donut-success' : ''}`, 'data-value': String(pct), style: `--donut-value: ${pct}` }),
    el('div', { class: 'donut-center' },
      el('span', { class: 'donut-value' }, `${me.xp_today}`),
      el('span', { class: 'donut-label' }, `of ${me.daily_goal} XP`)));
}

/* XP over the last 30 days as a column chart made of fills (no SVG needed).
   Extends .meter: each column is a vertical meter on the sunken surface. */
function xpChart(days) {
  const max = Math.max(1, ...days.map((d) => d.xp));
  const cols = days.map((d) => {
    const h = Math.round((d.xp / max) * 100);
    const col = el('div', { class: `xp-col ${d.met ? 'is-met' : ''}`, role: 'listitem', title: `${d.date}: ${d.xp} XP${d.met ? ', goal met' : ''}`, 'aria-label': `${d.date}: ${d.xp} XP` },
      el('span', { class: 'xp-col-fill', style: `--h: ${h}%` }));
    return col;
  });
  const first = days[0]?.date || '';
  const last = days[days.length - 1]?.date || '';
  return el('div', { class: 'xp-chart' },
    el('div', { class: 'xp-chart-cols', role: 'list', 'aria-label': 'XP per day, last 30 days' }, ...cols),
    el('div', { class: 'row justify-between text-caption text-muted mt-1' }, el('span', {}, first), el('span', {}, `max ${max} XP`), el('span', {}, last)));
}

/* Streak calendar: 12 weeks of cells, Monday-first columns, fill by XP against the goal.
   Steps use the surface ladder; a met day uses the accent soft fill; a freeze the info fill. */
function calendar(cells) {
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const grid = el('div', { class: 'streak-cal', role: 'grid', 'aria-label': 'Daily goal, last 12 weeks' });
  weeks.forEach((w) => {
    const col = el('div', { class: 'streak-week', role: 'row' });
    w.forEach((d) => {
      let level = 'none';
      if (d.freeze) level = 'freeze';
      else if (d.met) level = 'met';
      else if (d.xp > 0) level = d.goal && d.xp >= d.goal / 2 ? 'half' : 'some';
      col.append(el('span', { class: 'streak-day', role: 'gridcell', 'data-level': level, title: `${d.date}: ${d.freeze ? 'streak freeze' : `${d.xp} XP`}`, 'aria-label': `${d.date}: ${d.freeze ? 'streak freeze' : `${d.xp} XP`}` }));
    });
    grid.append(col);
  });
  const legend = el('div', { class: 'chart-legend mt-3' },
    legendItem('none', 'No XP'), legendItem('some', 'Some'), legendItem('half', 'Half way'), legendItem('met', 'Goal met'), legendItem('freeze', 'Freeze'));
  return el('div', {}, grid, legend);
}
function legendItem(level, label) {
  return el('span', { class: 'chart-legend-item' }, el('span', { class: 'streak-day streak-legend', 'data-level': level, 'aria-hidden': 'true' }), label);
}

function meterRow(label, value, sub = '') {
  return el('div', { class: 'meter-row' },
    el('div', { class: 'row justify-between' }, el('span', {}, label), el('span', { class: 'text-muted text-caption' }, sub || `${value}%`)),
    el('div', { class: 'meter', role: 'progressbar', 'aria-valuenow': value, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': label },
      el('span', { class: 'meter-fill', style: `--value: ${value}%` })));
}

function rarityChip(r) {
  return el('span', { class: `chip ${r === 'epic' ? 'chip-warning' : r === 'rare' ? 'chip-primary' : ''}` }, r);
}

export default async function view({ setTitle }) {
  setTitle('Profile');
  const settings = store.get('settings');
  const [stats, odds, inventory] = await Promise.all([
    get(withNow(`/api/stats?tz=${encodeURIComponent(settings.timezone)}`)).catch(() => null),
    get('/api/rewards', { cache: true }).catch(() => null),
    get('/api/inventory').catch(() => ({ items: [], equipped: {} })),
  ]);
  if (!stats) {
    return page(hero({ eyebrow: 'You', title: 'Profile' }), body(emptyState('cloud_off', 'Stats unavailable', 'The server could not be reached.')));
  }
  const me = stats.me;
  store.set('me', me);

  const head = el('div', { class: 'profile-head' },
    goalRing(me),
    el('div', { class: 'grid-auto grow', style: '--min: 140px' },
      stat('Streak', `${me.streak} ${me.streak === 1 ? 'day' : 'days'}`, me.freezes ? el('span', { class: 'chip mt-1' }, icon('ac_unit', 'icon-sm'), `${me.freezes} freeze${me.freezes === 1 ? '' : 's'}`) : null),
      stat('Best streak', `${stats.best_streak} ${stats.best_streak === 1 ? 'day' : 'days'}`),
      stat('Total XP', me.xp_total, me.xp_boosts ? el('span', { class: 'chip chip-primary mt-1' }, icon('bolt', 'icon-sm'), `${me.xp_boosts} boost${me.xp_boosts === 1 ? '' : 's'} ready`) : null),
      stat('Lessons', stats.lessons_total)));

  const courses = stats.courses.length
    ? el('div', { class: 'stack stack-sm' }, ...stats.courses.map((c) =>
      el('a', { class: 'card card-interactive course-card', href: `/c/${c.subject}/${c.course}` },
        el('div', { class: 'card-body' },
          meterRow(`${c.subject_title} · ${c.title}`, c.coverage, `${c.coverage}% coverage · ${c.completed}/${c.total} lessons`)))))
    : el('p', { class: 'text-muted' }, 'Finish a lesson to see coverage here.');

  const accuracy = stats.accuracy_by_type.length
    ? el('div', { class: 'stack stack-sm' }, ...stats.accuracy_by_type.map((a) =>
      meterRow(a.type, Math.round((a.accuracy ?? 0) * 100), `${Math.round((a.accuracy ?? 0) * 100)}% of ${plural(a.attempts, 'attempt')}`)))
    : el('p', { class: 'text-muted' }, 'No attempts yet.');

  const weakest = stats.weakest.length
    ? el('div', { class: 'list list-divided' }, ...stats.weakest.map((w) =>
      el('div', { class: 'list-item list-item-two-line' },
        el('span', { class: 'list-item-leading' }, icon('history')),
        el('div', { class: 'list-item-text' },
          el('div', { class: 'list-item-title' }, w.prompt || w.item_path),
          el('div', { class: 'list-item-subtitle' }, `${w.lesson} · ${w.type}`)),
        el('span', { class: 'list-item-trailing' }, el('span', { class: 'chip' }, `${Math.round(w.retrievability * 100)}%`)))))
    : el('p', { class: 'text-muted' }, 'Nothing learned yet.');

  const inv = inventory.items.length
    ? el('div', { class: 'chip-set' }, ...inventory.items.map((i) => {
      const chip = el(i.kind === 'cosmetic' || i.kind === 'title' ? 'button' : 'span', {
        class: `chip chip-clickable ${i.equipped ? 'chip-primary' : ''}`, type: i.kind === 'cosmetic' || i.kind === 'title' ? 'button' : null,
        'aria-pressed': i.kind === 'cosmetic' || i.kind === 'title' ? String(i.equipped) : null, title: i.description,
      }, icon(i.icon, 'icon-sm'), `${i.title}${i.quantity > 1 ? ` ×${i.quantity}` : ''}${i.equipped ? ' · equipped' : ''}`);
      if (chip.tagName === 'BUTTON') {
        chip.addEventListener('click', async () => {
          const { put } = await import('../api.js');
          await put(`/api/inventory/${i.id}/equip`, { equipped: !i.equipped });
          window.app.reloadMe();
          window.app.router.resolve();
        });
      }
      return chip;
    }))
    : el('p', { class: 'text-muted' }, 'No drops yet. Finish lessons for a chance at one.');

  const oddsTable = odds
    ? el('div', { class: 'table-wrap' }, el('table', { class: 'table table-dense' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Reward'), el('th', {}, 'Rarity'), el('th', { class: 'table-numeric' }, 'After a lesson'), el('th', { class: 'table-numeric' }, 'After a perfect lesson'))),
      el('tbody', {}, ...odds.rewards.map((r) => el('tr', {},
        el('td', {}, el('span', { class: 'row row-tight' }, icon(r.icon, 'icon-sm'), r.title), el('div', { class: 'text-caption text-muted' }, r.description)),
        el('td', {}, rarityChip(r.rarity)),
        el('td', { class: 'table-numeric' }, `${(r.chance * 100).toFixed(1)}%`),
        el('td', { class: 'table-numeric' }, `${(r.chance_perfect * 100).toFixed(1)}%`))))))
    : null;

  return page(
    hero({ eyebrow: me.title ? `You · ${me.title}` : 'You', title: me.title ? `${me.username} the ${me.title}` : 'Profile', lede: `Daily goal ${me.daily_goal} XP · ${me.goal_met ? 'met today' : `${Math.max(0, me.daily_goal - me.xp_today)} XP to go`}`, extra: head }),
    body(
      section('XP, last 30 days', xpChart(stats.xp_by_day)),
      section('Streak calendar', calendar(stats.calendar)),
      section('Coverage per course', courses),
      el('div', { class: 'grid mt-6' },
        el('div', { class: 'col-6' }, section('Accuracy per element', accuracy)),
        el('div', { class: 'col-6' }, section('Weakest items', weakest))),
      settings.drops !== false
        ? section('Resonance drops', el('p', { class: 'text-muted mb-3' }, odds ? `After each new lesson there is a ${Math.round(odds.drop_chance * 100)}% chance of a drop (${Math.round((odds.drop_chance + odds.perfect_bonus) * 100)}% after a perfect one). No money, nothing to buy; the odds are these.` : ''), inv, oddsTable ? el('div', { class: 'mt-4' }, oddsTable) : null)
        : null,
    ),
  );
}
