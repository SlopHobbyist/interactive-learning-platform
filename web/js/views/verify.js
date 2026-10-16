/* Confirm an email address (ILP_MODE=multi): a Kratos verification flow by email code.
   Sign-up starts one and Kratos mails the code; register.js sends the learner here with
   `?flow=<id>` once the password is saved. The email's own link goes through Kratos, which
   puts the code on the flow and redirects here; that code is checked at once. Without a flow (the account page's
   "Confirm email"), the learner asks for a code first. `?next=` is where to go afterwards. */

import { el } from '../lib/dom.js';
import { createFlow, getFlow, submitFlow, nodeValue } from '../lib/kratos.js';
import { authCard, messageBox, codeInput, helpFooter } from '../lib/account-ui.js';
import { safeNext, accountsOff } from './login.js';

export default async function view({ setTitle, navigate, query }) {
  setTitle('Confirm your email');
  const auth = window.app.auth;
  if (auth.mode !== 'multi') return accountsOff();
  const next = safeNext(query.next, auth.authenticated ? '/' : '/login');
  const known = (auth.user && auth.user.email) || '';

  let flow = query.flow ? await getFlow('verification', query.flow).catch(() => null) : null;
  flow ||= await createFlow('verification');
  const root = el('div');
  const show = (node, focus) => {
    root.replaceChildren(node);
    window.UI.init(root);
    if (focus) setTimeout(() => focus.focus(), 0);
  };
  const passed = () => flow.state === 'passed_challenge';
  const later = () => (auth.authenticated
    ? el('p', { class: 'auth-footer' }, el('a', { class: 'link', href: next }, 'Do this later'))
    : null);

  async function done() {
    if (auth.authenticated) await window.app.afterSignIn();
    window.UI.toast('Email confirmed.');
    navigate(next, { replace: true });
  }

  /* ------------------------------------------------- 1. ask for a code */
  function emailStep(errorText) {
    const email = el('input', { class: 'input', id: 'verify-email', type: 'email', autocomplete: 'email', required: true });
    email.value = known;
    // A signed-in learner confirms the address on their account, not another one.
    if (known) email.readOnly = true;
    const errors = messageBox('danger');
    const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Send me a code');
    const form = el('form', { class: 'auth-form', novalidate: true },
      el('div', { class: 'field' }, el('label', { class: 'field-label', for: 'verify-email' }, 'Email'), email),
      errors, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const address = email.value.trim().toLowerCase();
      if (!address.includes('@')) { errors.show('Enter the email address of your account.'); email.focus(); return; }
      submit.disabled = true;
      try {
        await send(address);
        if (flow.state === 'sent_email') { codeStep(address); return; }
        errors.show('Could not send a code. Try again.');
      } catch (err) {
        errors.show(err.message);
      }
      submit.disabled = false;
      email.focus();
    });
    errors.show(errorText || []);
    show(authCard('Confirm your email', 'We will send a six-digit code to prove the address is yours.',
      form, later(), helpFooter()), known ? submit : email);
  }

  async function send(address) {
    const result = await submitFlow('verification', flow, { method: 'code', email: address });
    if (result.flow) flow = result.flow;
    if (!result.ok && result.messages && result.messages.errors.length) throw new Error(result.messages.errors[0]);
  }

  /* ---------------------------------------------------- 2. enter it */
  function codeStep(address, errorText) {
    const otp = codeInput('Confirmation code');
    const errors = messageBox('danger');
    const submit = el('button', { class: 'button button-filled button-block', type: 'submit' }, 'Confirm');
    const resend = el('button', { class: 'button button-text', type: 'button' }, 'Send another code');
    const form = el('form', { class: 'auth-form', novalidate: true }, otp.node, errors, submit);
    otp.node.addEventListener('ui:otp', () => form.requestSubmit());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = otp.value();
      if (code.length !== 6) { errors.show('Enter the six-digit code from the email.'); otp.focus(code.length); return; }
      submit.disabled = true;
      try {
        if (await check(code)) { await done(); return; }
        errors.show('That code did not work. Check it and try again.');
      } catch (err) {
        errors.show(err.message);
      }
      submit.disabled = false;
      otp.clear();
      otp.focus();
    });
    resend.addEventListener('click', async () => {
      try {
        await send(address);
        window.UI.toast('A new code is on its way.');
      } catch (err) {
        errors.show(err.message);
      }
    });

    errors.show(errorText || []);
    show(authCard('Check your email', `We sent a six-digit code to ${address || 'your email'}. It expires in an hour.`,
      form,
      el('p', { class: 'auth-footer' }, 'Did not get it? ', resend),
      later(),
      helpFooter('Still nothing? Email ')), otp.first);
  }

  /** True when Kratos accepted the code. Other answers come back as the flow with a message. */
  async function check(code) {
    const result = await submitFlow('verification', flow, { method: 'code', code });
    if (result.flow) flow = result.flow;
    if (passed()) return true;
    if (result.messages && result.messages.errors.length) throw new Error(result.messages.errors[0]);
    return false;
  }

  if (passed()) {
    await done();
    return root;
  }
  const address = nodeValue(flow, 'email') || known;
  // The email's link goes through Kratos, which puts the code on the flow and redirects here.
  const linked = query.code || nodeValue(flow, 'code');
  if (linked && flow.state === 'sent_email') {
    try {
      if (await check(linked)) { await done(); return root; }
      codeStep(address, 'That link did not work. Enter the code from the email instead.');
    } catch (err) {
      codeStep(address, err.message);
    }
  } else if (flow.state === 'sent_email') {
    codeStep(address);
  } else {
    emailStep();
  }
  return root;
}
