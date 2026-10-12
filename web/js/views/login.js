/* Sign in (ILP_MODE=multi): a Kratos login flow with username-or-email and password.
   `?refresh=1` re-asks the password of the signed-in learner (Kratos wants a recent sign-in
   before it changes a password); `?next=` is where to go afterwards. */

import { el, icon } from '../lib/dom.js';
import { createFlow, submitFlow, nodeValue, FlowError } from '../lib/kratos.js';
import { authCard, messageBox } from '../lib/account-ui.js';

export function safeNext(next, fallback = '/') {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

export function accountsOff() {
  return el('div', { class: 'container section' },
    el('div', { class: 'empty-state' }, icon('person'), el('p', { class: 'text-heading-3' }, 'Accounts are off'),
      el('p', {}, 'This instance runs in single-user mode. Set ILP_MODE=multi to enable accounts.'),
      el('a', { class: 'button button-filled', href: '/' }, 'Home')));
}

export default async function view({ setTitle, navigate, query }) {
  setTitle('Sign in');
  const auth = window.app.auth;
  if (auth.mode !== 'multi') return accountsOff();
  const refresh = query.refresh === '1';
  const next = safeNext(query.next);
  if (auth.authenticated && !refresh) { navigate(next, { replace: true }); return el('div'); }

  const params = refresh ? { refresh: 'true' } : {};
  let flow;
  try {
    flow = await createFlow('login', params);
  } catch (err) {
    if (err.id !== 'session_already_available') throw err;
    await window.app.afterSignIn();
    navigate(next, { replace: true });
    return el('div');
  }

  const identifier = el('input', { class: 'input', id: 'login-identifier', type: 'text', name: 'identifier', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  const knownIdentifier = refresh ? nodeValue(flow, 'identifier') : '';
  if (knownIdentifier) { identifier.value = knownIdentifier; identifier.readOnly = true; }
  const password = el('input', { class: 'input text-mono', id: 'login-password', type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const errors = messageBox('danger');
  const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Sign in');

  const form = el('form', { class: 'auth-form', novalidate: true },
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'login-identifier' }, 'Username or email'), identifier),
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'login-password' }, 'Password'), password),
    el('div', { class: 'auth-row' }, el('span'), el('a', { class: 'link text-body-2', href: '/recover' }, 'Forgot your password?')),
    errors,
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = identifier.value.trim().toLowerCase();
    if (!id || !password.value) {
      errors.show('Enter your username or email and your password.');
      (id ? password : identifier).focus();
      return;
    }
    errors.show([]);
    submit.disabled = true;
    try {
      const result = await submitFlow('login', flow, { method: 'password', identifier: id, password: password.value });
      if (result.ok) {
        await window.app.afterSignIn();
        window.UI.toast('Signed in.');
        navigate(next, { replace: true });
        return;
      }
      if (result.flow) flow = result.flow;
      errors.show(result.messages ? result.messages.errors : 'Sign-in did not finish. Try again.');
    } catch (err) {
      // Expired flow or CSRF mismatch: start a fresh flow so the next attempt can succeed.
      flow = await createFlow('login', params).catch(() => flow);
      errors.show(err instanceof FlowError && err.id === 'self_service_flow_expired'
        ? 'The sign-in form expired. Try again.'
        : (err.message || 'Something went wrong. Try again.'));
    }
    submit.disabled = false;
    password.focus();
  });
  setTimeout(() => (knownIdentifier ? password : identifier).focus(), 0);

  return authCard(refresh ? 'Confirm it is you' : 'Sign in',
    refresh ? 'Enter your password again to change it.' : 'Welcome back.',
    form,
    el('p', { class: 'auth-footer' }, 'New here? ',
      // New accounts land in the catalog unless the sign-in was for a specific page.
      el('a', { class: 'link', href: next !== '/' ? `/register?next=${encodeURIComponent(next)}` : '/register' }, 'Create an account')));
}
