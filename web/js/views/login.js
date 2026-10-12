/* Sign in / create account (ILP_MODE=multi). Uses Wavefront's auth pattern. */

import { get, post } from '../api.js';
import { el, icon } from '../lib/dom.js';

export default async function view({ setTitle, navigate, query }) {
  setTitle('Sign in');
  const mode = await get('/api/auth/mode', { silent: true }).catch(() => ({ mode: 'single' }));
  if (mode.mode !== 'multi') {
    return el('div', { class: 'container section' },
      el('div', { class: 'empty-state' }, icon('person'), el('p', { class: 'text-heading-3' }, 'Accounts are off'),
        el('p', {}, 'This instance runs in single-user mode. Set ILP_MODE=multi to enable accounts.'),
        el('a', { class: 'button button-filled', href: '/' }, 'Subjects')));
  }
  if (mode.authenticated) { navigate('/', { replace: true }); return el('div'); }

  let registering = mode.accounts === 0;
  const username = el('input', { class: 'input', id: 'login-username', type: 'text', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', required: true });
  const password = el('input', { class: 'input', id: 'login-password', type: 'password', autocomplete: registering ? 'new-password' : 'current-password', required: true });
  const error = el('p', { class: 'field-error', role: 'alert', hidden: true });
  const submit = el('button', { class: 'button button-filled button-block', type: 'submit' });
  const toggle = el('button', { class: 'button button-text', type: 'button' });
  const title = el('h1', { class: 'auth-title' });
  const lede = el('p', { class: 'auth-lede text-muted' });

  function paint() {
    title.textContent = registering ? 'Create your account' : 'Sign in';
    lede.textContent = registering
      ? (mode.accounts === 0 ? 'The first account inherits the progress made so far on this instance.' : 'Pick a username and a password of at least 8 characters.')
      : 'Welcome back.';
    submit.textContent = registering ? 'Create account' : 'Sign in';
    toggle.textContent = registering ? 'I already have an account' : 'Create an account instead';
    password.autocomplete = registering ? 'new-password' : 'current-password';
  }
  toggle.addEventListener('click', () => { registering = !registering; error.hidden = true; paint(); username.focus(); });

  const form = el('form', { class: 'auth-form stack', novalidate: true },
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'login-username' }, 'Username'), username),
    el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'login-password' }, 'Password'), password),
    error,
    submit,
    el('div', { class: 'row justify-center' }, toggle));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      await post(registering ? '/api/auth/register' : '/api/auth/login', { username: username.value.trim(), password: password.value }, { silent: true });
      window.UI.toast(registering ? 'Account created.' : 'Signed in.');
      await window.app.afterSignIn();
      navigate(query.next && query.next.startsWith('/') ? query.next : '/', { replace: true });
    } catch (err) {
      error.textContent = err.detail || err.message || 'Something went wrong.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
    }
    // Disabling the button (if it had focus) dropped focus to <body>: put it back where the fix is.
    if (!error.hidden) (registering || !username.value.trim() ? username : password).focus();
  });
  paint();
  setTimeout(() => username.focus(), 0);

  return el('div', { class: 'auth container' },
    el('div', { class: 'auth-card card' },
      el('div', { class: 'card-body' },
        el('div', { class: 'auth-brand row' }, icon('waves', 'text-primary'), el('span', { class: 'text-heading-3' }, 'Learn')),
        title, lede, form)));
}
