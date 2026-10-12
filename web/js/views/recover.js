/* Lost password (ILP_MODE=multi): a Kratos recovery flow by email code. The learner enters
   their email, then the six-digit code Kratos mails them; Kratos then signs them in and hands
   over a settings flow, which this view uses to set a freshly generated password. */

import { el } from '../lib/dom.js';
import { createFlow, submitFlow, getFlow, settingsFlowFrom } from '../lib/kratos.js';
import { generatePassword } from '../lib/password.js';
import { authCard, messageBox, passwordReveal } from '../lib/account-ui.js';
import { accountsOff } from './login.js';

export default async function view({ setTitle, navigate }) {
  setTitle('Get a new password');
  if (window.app.auth.mode !== 'multi') return accountsOff();

  let flow = await createFlow('recovery');
  const root = el('div');
  const show = (node, focus) => {
    root.replaceChildren(node);
    window.UI.init(root);
    if (focus) setTimeout(() => focus.focus(), 0);
  };

  /* ------------------------------------------------------------ 1. email */
  function emailStep(prefill = '') {
    const email = el('input', { class: 'input', id: 'recover-email', type: 'email', autocomplete: 'email', required: true });
    email.value = prefill;
    const errors = messageBox('danger');
    const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Send me a code');
    const form = el('form', { class: 'auth-form', novalidate: true },
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'recover-email' }, 'Email'), email),
      errors, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = email.value.trim().toLowerCase();
      if (!address.includes('@')) { errors.show('Enter the email address of your account.'); email.focus(); return; }
      submit.disabled = true;
      try {
        const result = await submitFlow('recovery', flow, { method: 'code', email: address });
        if (result.flow) flow = result.flow;
        if (flow.state === 'sent_email') { codeStep(address); return; }
        errors.show(result.messages ? result.messages.errors : 'Could not send a code. Try again.');
      } catch (err) {
        flow = await createFlow('recovery').catch(() => flow);
        errors.show(err.message);
      }
      submit.disabled = false;
      email.focus();
    });
    show(authCard('Get a new password', "Enter your account's email. We will send you a code to prove it is yours.",
      form,
      el('p', { class: 'auth-footer' }, 'Remembered it? ', el('a', { class: 'link', href: '/login' }, 'Sign in'))), email);
  }

  /* ------------------------------------------------------------- 2. code */
  function codeStep(address) {
    const slots = Array.from({ length: 6 }, () => el('input', { class: 'otp-slot', type: 'text' }));
    const value = el('input', { type: 'hidden', 'data-otp-value': true });
    const otp = el('div', { class: 'otp', 'data-otp': true, role: 'group', 'aria-label': 'Recovery code' }, ...slots, value);
    const errors = messageBox('danger');
    const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Continue');
    const resend = el('button', { class: 'button button-text', type: 'button' }, 'Send another code');
    const form = el('form', { class: 'auth-form', novalidate: true }, otp, errors, submit);
    otp.addEventListener('ui:otp', () => form.requestSubmit());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = value.value || slots.map((s) => s.value).join('');
      if (code.length !== 6) { errors.show('Enter the six-digit code from the email.'); slots[code.length] && slots[code.length].focus(); return; }
      submit.disabled = true;
      try {
        const result = await submitFlow('recovery', flow, { method: 'code', code });
        const settingsId = settingsFlowFrom(result);
        if (settingsId) { await newPassword(settingsId); return; }
        if (result.flow) flow = result.flow;
        errors.show(result.messages && result.messages.errors.length ? result.messages.errors : 'That code did not work. Check it and try again.');
      } catch (err) {
        errors.show(err.message);
      }
      submit.disabled = false;
      slots.forEach((s) => { s.value = ''; s.classList.remove('is-filled'); });
      value.value = '';
      slots[0].focus();
    });
    resend.addEventListener('click', async () => {
      try {
        const result = await submitFlow('recovery', flow, { method: 'code', email: address });
        if (result.flow) flow = result.flow;
        window.UI.toast('A new code is on its way.');
      } catch (err) {
        errors.show(err.message);
      }
    });

    show(authCard('Check your email', `If ${address} belongs to an account, a six-digit code is on its way. It expires in an hour.`,
      form,
      el('p', { class: 'auth-footer' }, 'Did not get it? ', resend)), slots[0]);
  }

  /* ---------------------------------------------------- 3. new password */
  async function newPassword(settingsId) {
    const settings = await getFlow('settings', settingsId);
    const password = generatePassword();
    const result = await submitFlow('settings', settings, { method: 'password', password });
    if (!result.ok) throw new Error((result.messages && result.messages.errors[0]) || 'Could not set the new password.');
    const traits = (settings.identity && settings.identity.traits) || {};
    const reveal = passwordReveal({
      username: traits.username || '',
      password,
      title: 'Your new password',
      lede: 'You are signed in. Your old password no longer works.',
      onDone: async () => {
        await window.app.afterSignIn();
        navigate('/', { replace: true });
      },
    });
    show(reveal, reveal.focusTarget);
  }

  emailStep();
  return root;
}
