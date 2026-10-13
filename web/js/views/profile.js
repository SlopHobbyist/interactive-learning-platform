/* Profile and stats (plan §6): daily goal ring, streak, XP over time, a streak
   calendar heatmap, coverage per course, accuracy per element type, the
   weakest items, coins, freezes and a running XP boost. All drawn with
   Wavefront's data components (stat, donut, meter, month-grid-style cells) and
   fills only. Chests and the shop live at /shop. */

import { get } from '../api.js';
import { withNow } from '../progress.js';
import { store } from '../store.js';
import { el, icon, plural } from '../lib/dom.js';
import { hero, body, section, page, emptyState } from '../lib/view.js';
import { boostLeft, fmtHours } from '../lib/economy.js';

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

export default async function view({ setTitle }) {
  setTitle('Profile');
  const settings = store.get('settings');
  const stats = await get(withNow(`/api/stats?tz=${encodeURIComponent(settings.timezone)}`)).catch(() => null);
  if (!stats) {
    return page(hero({ eyebrow: 'You', title: 'Profile' }), body(emptyState('cloud_off', 'Stats unavailable', 'The server could not be reached.')));
  }
  const me = stats.me;
  store.set('me', me);

  const head = el('div', { class: 'profile-head' },
    goalRing(me),
    el('div', { class: 'grid-auto grow', style: '--min: 140px' },
      stat('Streak', `${me.streak} ${me.streak === 1 ? 'day' : 'days'}`, el('span', { class: 'chip-set mt-1' },
        me.freezes ? el('span', { class: 'chip' }, icon('ac_unit', 'icon-sm'), `${me.freezes}/${me.freeze_cap} freezes`) : null,
        me.wager ? el('a', { class: 'chip chip-clickable', href: '/shop' }, icon('casino', 'icon-sm'), `Wager: ${me.wager.kept}/${me.wager.days} days`) : null)),
      stat('Best streak', `${stats.best_streak} ${stats.best_streak === 1 ? 'day' : 'days'}`),
      stat('Total XP', me.xp_total, boostLeft() ? el('span', { class: 'chip chip-primary mt-1' }, icon('speed', 'icon-sm'), `2× XP · ${fmtHours(boostLeft())}`) : null),
      stat('Lessons', stats.lessons_total),
      stat('Coins', me.coins ?? 0, el('a', { class: 'chip chip-clickable mt-1', href: '/shop' }, icon('storefront', 'icon-sm'), 'Shop'))));

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

  let league = null;
  if (window.app.auth.mode === 'multi') {
    const data = await get(withNow('/api/league'), { silent: true }).catch(() => null);
    if (data) {
      const rows = data.entries.length
        ? el('div', { class: 'table-wrap' }, el('table', { class: 'table table-dense' },
          el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Learner'), el('th', { class: 'table-numeric' }, 'XP this week'))),
          el('tbody', {}, ...data.entries.map((r) => el('tr', { class: r.me ? 'is-selected' : '' },
            el('td', {}, String(r.rank)), el('td', {}, r.username, r.me ? ' (you)' : ''), el('td', { class: 'table-numeric' }, String(r.xp)))))))
        : el('p', { class: 'text-muted' }, 'Nobody has opted in yet.');
      league = section('Weekly league', el('p', { class: 'text-muted mb-3' }, `${data.week_start} to ${data.week_end}. ${data.opted_in ? 'You are listed.' : 'You are not listed; opt in under Settings → Community.'}`), rows);
    }
  }

  return page(
    hero({ eyebrow: 'You', title: 'Profile', lede: `Daily goal ${me.daily_goal} XP · ${me.goal_met ? 'met today' : `${Math.max(0, me.daily_goal - me.xp_today)} XP to go`}`, extra: head }),
    body(
      league,
      section('XP, last 30 days', xpChart(stats.xp_by_day)),
      section('Streak calendar', calendar(stats.calendar)),
      section('Coverage per course', courses),
      el('div', { class: 'grid mt-6' },
        el('div', { class: 'col-6' }, section('Accuracy per element', accuracy)),
        el('div', { class: 'col-6' }, section('Weakest items', weakest))),
    ),
  );
}
