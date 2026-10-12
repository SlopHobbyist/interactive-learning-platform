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
  const theme = document.documentElement.getAttribute('data-theme') || 'system';

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
        row('Theme', 'Dark is the reference theme. System follows your OS.',
          segmented('Theme', [['system', 'System'], ['dark', 'Dark'], ['light', 'Light']], theme,
            (v) => window.UI.setTheme(v === 'system' ? null : v)))),
      group('Goals',
        row('Daily goal', 'XP to earn each day to keep your streak.',
          segmented('Daily goal', [[10, '10 XP'], [20, '20 XP'], [30, '30 XP'], [50, '50 XP']], settings.dailyGoal,
            (v) => store.update('settings', { dailyGoal: v })))),
      group('In lessons',
        row('Combo meter', 'Consecutive correct answers multiply XP.', toggle('combo', 'Combo meter')),
        row('Sound effects', 'Short sounds on check and continue. Off by default.', toggle('sounds', 'Sound effects')),
        row('Hard mode', 'Adds hearts: five mistakes end the lesson.', toggle('hardMode', 'Hard mode'))),
      group('Rewards',
        row('Resonance drops', 'A chance of a small reward after each lesson. The odds are shown on your profile.', toggle('drops', 'Resonance drops'))),
      el('div', { class: 'row justify-end mt-5' }, reset)),
  );
}
