/* Account (ILP_MODE=multi): who is signed in, a new generated password, sign out.
   Also Kratos's settings UI URL: Kratos may send the browser here with `?flow=<id>`. */

import { el, icon } from '../lib/dom.js';
import { hero, body, page } from '../lib/view.js';
import { createFlow, getFlow, submitFlow, FlowError } from '../lib/kratos.js';
import { generatePassword } from '../lib/password.js';
import { passwordReveal } from '../lib/account-ui.js';
import { accountsOff } from './login.js';

function row(title, description, control) {
  return el('div', { class: 'settings-row' },
    el('div', { class: 'settings-row-text' },
      el('p', { class: 'settings-row-title' }, title),
      description ? el('p', { class: 'settings-row-description' }, description) : null),
    el('div', { class: 'settings-row-control' }, control));
}

function needsRefresh(err, result) {
  return (err instanceof FlowError && err.id === 'session_refresh_required') ||
    Boolean(result && result.redirect && result.redirect.includes('refresh=true'));
}

export default async function view({ setTitle, navigate, query }) {
  setTitle('Account');
  const auth = window.app.auth;
  if (auth.mode !== 'multi') return accountsOff();
  const user = auth.user || {};
  const root = el('div');

  const regen = el('button', { class: 'button button-tonal', type: 'button' }, icon('key'), 'New password');
  regen.addEventListener('click', async () => {
    regen.disabled = true;
    let result = null;
    try {
      const flow = query.flow ? await getFlow('settings', query.flow).catch(() => createFlow('settings')) : await createFlow('settings');
      const password = generatePassword();
      result = await submitFlow('settings', flow, { method: 'password', password });
      if (result.ok) {
        const reveal = passwordReveal({
          username: user.username,
          password,
          title: 'Your new password',
          lede: 'Your old password no longer works.',
          onDone: () => navigate('/account', { replace: true }),
        });
        root.replaceChildren(reveal);
        window.UI.init(root);
        reveal.focusTarget.focus();
        return;
      }
      if (needsRefresh(null, result)) throw new FlowError('refresh', { id: 'session_refresh_required' });
      window.UI.toast((result.messages && result.messages.errors[0]) || 'Could not change the password.', { variant: 'danger' });
    } catch (err) {
      if (needsRefresh(err, result)) {
        window.UI.toast('For your safety, sign in again before changing your password.');
        navigate('/login?refresh=1&next=/account');
        return;
      }
      window.UI.toast(err.message || 'Could not change the password.', { variant: 'danger' });
    }
    regen.disabled = false;
    regen.focus();
  });

  const signOut = el('button', { class: 'button button-text button-danger', type: 'button' }, icon('logout'), 'Sign out');
  signOut.addEventListener('click', () => window.app.signOut());

  root.append(page(
    hero({ eyebrow: 'You', title: user.username || 'Account' }),
    body(
      el('section', { class: 'settings-group' },
        el('h2', { class: 'settings-group-title' }, 'Account'),
        el('div', { class: 'settings-list' },
          row('Username', 'Shown in the weekly league if you opt in.', el('span', { class: 'text-mono' }, user.username || '')),
          row('Email', 'Where a new password is sent if you lose yours.', el('span', {}, user.email || '')))),
      el('section', { class: 'settings-group' },
        el('h2', { class: 'settings-group-title' }, 'Password'),
        el('div', { class: 'settings-list' },
          row('New password', 'Replace your password with a new random one. The old one stops working at once.', regen))),
      el('div', { class: 'row justify-end mt-5' }, signOut))));
  return root;
}
