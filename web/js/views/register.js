/* Create an account (ILP_MODE=multi): username, email and the human check. The password is not
   chosen: the browser generates 32 random characters, registers with them, then shows them once
   and asks the learner to save them (account-ui.passwordReveal). */

import { el } from '../lib/dom.js';
import { createFlow, submitFlow } from '../lib/kratos.js';
import { generatePassword } from '../lib/password.js';
import { authCard, messageBox, humanCheck, passwordReveal } from '../lib/account-ui.js';
import { safeNext, accountsOff } from './login.js';

const USERNAME = /^[a-z0-9][a-z0-9_.-]{1,31}$/;

export default async function view({ setTitle, navigate, query }) {
  setTitle('Create an account');
  const auth = window.app.auth;
  if (auth.mode !== 'multi') return accountsOff();
  // New learners start in the catalog so they can add their first subjects.
  const next = safeNext(query.next, '/subjects');
  if (auth.authenticated) { navigate(next, { replace: true }); return el('div'); }

  let flow = await createFlow('registration');
  const root = el('div');

  const username = el('input', { class: 'input', id: 'register-username', type: 'text', name: 'username', autocomplete: 'username', autocapitalize: 'off', spellcheck: 'false', maxlength: 32, required: true, 'aria-describedby': 'register-username-hint' });
  username.addEventListener('input', () => {
    const lower = username.value.toLowerCase();
    if (lower !== username.value) username.value = lower;
  });
  const email = el('input', { class: 'input', id: 'register-email', type: 'email', name: 'email', autocomplete: 'email', required: true, 'aria-describedby': 'register-email-hint' });
  const human = humanCheck(auth.turnstile);
  const errors = messageBox('danger');
  const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Create account');

  const form = el('form', { class: 'auth-form', novalidate: true },
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'register-username' }, 'Username'), username,
      el('p', { class: 'field-hint', id: 'register-username-hint' }, '2 to 32 characters: lowercase letters, digits, dots, dashes or underscores. Others see it in the weekly league.')),
    el('div', { class: 'field' },
      el('label', { class: 'field-label', for: 'register-email' }, 'Email'), email,
      el('p', { class: 'field-hint', id: 'register-email-hint' }, 'Only used to send you a new password if you lose yours.')),
    human.node,
    errors,
    submit);

  function problems() {
    const out = [];
    if (!USERNAME.test(username.value.trim())) out.push(['Pick a username of 2 to 32 lowercase letters, digits, dots, dashes or underscores.', username]);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) out.push(['Enter a valid email address.', email]);
    if (!human.token()) out.push(['Complete the human check.', human.input]);
    return out;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const found = problems();
    if (found.length) {
      errors.show(found.map(([m]) => m));
      found[0][1].focus();
      return;
    }
    errors.show([]);
    submit.disabled = true;
    const name = username.value.trim();
    const password = generatePassword();
    try {
      const result = await submitFlow('registration', flow, {
        method: 'password',
        password,
        traits: { username: name, email: email.value.trim().toLowerCase() },
        transient_payload: { turnstile: human.token() },
      });
      if (result.ok) {
        showPassword(name, password);
        return;
      }
      if (result.flow) flow = result.flow;
      errors.show(result.messages ? result.messages.errors : 'Sign-up did not finish. Try again.');
    } catch (err) {
      flow = await createFlow('registration').catch(() => flow);
      errors.show(err.message || 'Something went wrong. Try again.');
    }
    // A Turnstile token is good for one try; ask again after a failure.
    human.reset();
    submit.disabled = false;
    username.focus();
  });

  function showPassword(name, password) {
    const reveal = passwordReveal({
      username: name,
      password,
      title: 'Save your password',
      lede: `Your account ${name} is ready. This is your password.`,
      onDone: async () => {
        await window.app.afterSignIn();
        navigate(next, { replace: true });
      },
    });
    root.replaceChildren(reveal);
    window.UI.init(root);
    reveal.focusTarget.focus();
  }

  root.append(authCard('Create an account', 'Learn any subject a few minutes at a time.',
    form,
    el('p', { class: 'auth-footer' }, 'Already have an account? ',
      el('a', { class: 'link', href: query.next ? `/login?next=${encodeURIComponent(next)}` : '/login' }, 'Sign in'))));
  setTimeout(() => username.focus(), 0);
  return root;
}
