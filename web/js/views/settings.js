/* Settings. Uses Wavefront's settings pattern (.settings-group > .settings-list >
   .settings-row) and the kit's switch and segmented controls. Phase 7 wires the
   loops to the server; for now settings live in localStorage via the store. */

import { store, DEFAULT_SETTINGS } from '../store.js';
import { el, icon } from '../lib/dom.js';
import { hero, body, page } from '../lib/view.js';

function row(title, description, control) {
  return el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row-text' },
      el('p', { class: 'settings-row-title' }, title),
      description ? el('p', { class: 'settings-row-description' }, description) : null),
    el('div', { class: 'settings-row-control' }, control));
}

function group(title, ...rows) {
  return el('section', { class: 'settings-group' },
    el('h2', { class: 'settings-group-title' }, title),
    el('div', { class: 'settings-list' }, ...rows));
}

function toggle(key, label) {
  const settings = store.get('settings');
  const input = el('input', { type: 'checkbox', role: 'switch', checked: settings[key] ? true : null, 'aria-label': label });
  input.addEventListener('change', () => store.update('settings', { [key]: input.checked }));
  return el('label', { class: 'switch' }, input, el('span', { class: 'switch-track' }, el('span', { class: 'switch-thumb' })));
}

/* The kit's own `segmented` behavior keeps aria-pressed in step on click;
   the handler here only records the choice. */
function segmented(label, options, current, onPick) {
  const node = el('div', { class: 'segmented', role: 'group', 'aria-label': label });
  options.forEach(([value, text]) => {
    const btn = el('button', { type: 'button', class: 'button', 'aria-pressed': String(current === value), 'data-value': value }, text);
    btn.addEventListener('click', () => onPick(value));
    node.append(btn);
  });
  return node;
}

export default async function view({ setTitle }) {
  setTitle('Settings');
  const settings = store.get('settings');
  const theme = document.documentElement.getAttribute('data-theme') || 'dark';

  const reset = el('button', { class: 'button button-text', type: 'button' }, icon('restart_alt'), 'Reset to defaults');
  reset.addEventListener('click', () => {
    store.set('settings', { ...DEFAULT_SETTINGS });
    window.app.router.resolve();
    window.UI.toast('Settings reset.');
  });

  return page(
    hero({ eyebrow: 'You', title: 'Settings' }),
    body(
      group('Appearance',
        row('Theme', 'Dark is the default.',
          segmented('Theme', [['dark', 'Dark'], ['light', 'Light']], theme,
            (v) => window.UI.setTheme(v)))),
      group('Goals',
        row('Daily goal', 'XP to earn each day to keep your streak.',
          segmented('Daily goal', [[10, '10 XP'], [20, '20 XP'], [30, '30 XP'], [50, '50 XP']], settings.dailyGoal,
            (v) => store.update('settings', { dailyGoal: v })))),
      group('In lessons',
        row('Combo meter', 'Consecutive correct answers multiply XP.', toggle('combo', 'Combo meter')),
        row('Sound effects', 'Short sounds on check and continue.', toggle('sounds', 'Sound effects')),
        row('Hard mode', 'Adds hearts: five mistakes end the lesson.', toggle('hardMode', 'Hard mode'))),
      group('Rewards',
        row('Resonance drops', 'A chance of a small reward after each lesson. The odds are shown on your profile.', toggle('drops', 'Resonance drops'))),
      window.app.auth.mode === 'multi'
        ? group('Community',
          row('Weekly league', 'Rank your weekly XP against the other accounts on this instance. Off means invisible.', toggle('league', 'Weekly league')))
        : null,
      store.get('dev') ? devGroup(settings) : null,
      el('div', { class: 'row justify-end mt-5' }, reset)),
  );
}

/* Dev only (ILP_DEV=1): time travel, so decay can be seen without waiting. */
function devGroup(settings) {
  const input = el('input', { class: 'input', type: 'text', value: settings.devNow || '', placeholder: '+30d, -2h, 2027-01-01', 'aria-label': 'Time offset', style: 'max-width: 200px' });
  input.addEventListener('change', () => store.update('settings', { devNow: input.value.trim() }));
  const resetBtn = el('button', { type: 'button', class: 'button button-text button-danger' }, icon('delete_sweep'), 'Reset all progress');
  resetBtn.addEventListener('click', async () => {
    const { post } = await import('../api.js');
    await post('/api/dev/reset-progress', {});
    window.UI.toast('Progress reset.');
    window.app.reloadMe();
  });
  return group('Developer',
    row('Time travel', 'Offset "now" for progress, review and strength (sent as ?now=). Leave empty for real time.', input),
    row('Progress', 'Wipe every attempt, completion and XP for the local user.', resetBtn));
}
