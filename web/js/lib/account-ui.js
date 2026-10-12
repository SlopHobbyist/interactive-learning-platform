/* Shared pieces of the account screens (sign in, sign up, recover, account): the auth card,
   the error box, the human check and the "save your new password" step. Wavefront's auth
   pattern (patterns.html#auth) with the kit's alert, choice and input-group components. */

import { el, icon } from './dom.js';

/** The centred auth card: brand, title, lede, then `children`. */
export function authCard(title, lede, ...children) {
  return el('div', { class: 'auth container' },
    el('div', { class: 'auth-card card' },
      el('div', { class: 'card-body' },
        el('p', { class: 'auth-brand' }, icon('waves', 'text-primary'), ' Learn'),
        el('h1', { class: 'auth-title' }, title),
        lede ? el('p', { class: 'auth-lede' }, lede) : null,
        ...children)));
}

/** An alert that lists messages; hidden while empty. `show([])` hides it again. */
export function messageBox(variant = 'danger') {
  const body = el('div', { class: 'alert-body' });
  const box = el('div', { class: `alert alert-${variant}`, role: variant === 'danger' ? 'alert' : 'status', hidden: true },
    icon(variant === 'danger' ? 'error' : 'info'), body);
  box.show = (messages) => {
    const list = (Array.isArray(messages) ? messages : [messages]).filter(Boolean);
    body.replaceChildren(...list.map((m, i) => (i ? [el('br'), m] : m)).flat());
    box.hidden = list.length === 0;
  };
  return box;
}

/**
 * The human check on sign-up. Cloudflare Turnstile would load its widget from
 * challenges.cloudflare.com, which the no-external-assets rule forbids, so for now this is a
 * local placeholder: a checkbox that yields the server's placeholder token. See
 * docs/ARCHITECTURE.md (Accounts) for what wiring the real widget takes.
 *   const check = humanCheck(mode.turnstile); check.node; check.token(); check.reset()
 */
export function humanCheck(config = {}) {
  const input = el('input', { type: 'checkbox', id: 'human-check' });
  const choice = el('label', { class: 'choice', for: 'human-check' },
    input, el('span', { class: 'choice-box' }), el('span', { class: 'choice-label' }, "I'm a human"));
  const note = config.mode === 'cloudflare'
    ? 'Turnstile keys are set on the server, but the widget is not wired in yet. Sign-up will fail until it is.'
    : 'Placeholder for Cloudflare Turnstile.';
  const node = el('div', { class: 'human-check', 'data-mode': config.mode || 'placeholder' },
    choice,
    el('span', { class: 'human-check-brand' }, icon('verified_user', 'icon-sm'), 'Turnstile'),
    el('p', { class: 'human-check-note' }, note));
  return {
    node,
    input,
    token: () => (input.checked ? (config.placeholder_token || '') : ''),
    reset: () => { input.checked = false; },
  };
}

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const scratch = el('textarea', { readonly: true, style: 'position: fixed; opacity: 0;' });
  scratch.value = text;
  document.body.append(scratch);
  scratch.select();
  try { document.execCommand('copy'); } finally { scratch.remove(); }
  return Promise.resolve();
}

/**
 * "Save your password": shows a generated password once, with a copy button, and only lets the
 * learner continue after they tick that they saved it. It is a real form with the username and
 * a new-password field, so browsers' password managers offer to store it on Continue.
 */
export function passwordReveal({ username, password, title = 'Save your password', lede, onDone }) {
  // Shown as wrapping text (32 monospace characters do not fit an input on a phone); the
  // hidden new-password input is what password managers pick up.
  const value = el('code', { class: 'password-reveal-value', id: 'new-password', tabindex: '0', 'aria-describedby': 'new-password-hint' }, password);
  value.addEventListener('focus', () => window.getSelection().selectAllChildren(value));
  const field = el('input', { class: 'visually-hidden', type: 'password', name: 'password', autocomplete: 'new-password', readonly: true, tabindex: '-1', 'aria-hidden': 'true' });
  field.value = password;
  const copy = el('button', { class: 'button button-tonal button-sm', type: 'button' }, icon('content_copy', 'icon-sm'), 'Copy');
  copy.addEventListener('click', async () => {
    try {
      await copyText(password);
      window.UI.toast('Password copied. Paste it into your password manager.');
    } catch {
      value.focus();
      window.UI.toast('Could not copy. The password is selected; copy it with Ctrl+C.', { variant: 'danger' });
    }
  });
  const saved = el('input', { type: 'checkbox', id: 'password-saved' });
  const submit = el('button', { class: 'button button-filled button-block', type: 'submit', disabled: true }, 'Continue');
  saved.addEventListener('change', () => { submit.disabled = !saved.checked; });

  const form = el('form', { class: 'auth-form', method: 'post', action: '#', novalidate: true },
    // Password managers pair the new password with this username.
    el('input', { type: 'text', name: 'username', autocomplete: 'username', value: username, hidden: true, readonly: true }),
    el('div', { class: 'field' },
      el('p', { class: 'field-label', id: 'new-password-label' }, 'Your password'),
      el('div', { class: 'password-reveal', role: 'group', 'aria-labelledby': 'new-password-label' }, value, copy, field),
      el('p', { class: 'field-hint', id: 'new-password-hint' }, `${password.length} random characters. You will need it to sign in as ${username}.`)),
    el('div', { class: 'alert alert-warning' }, icon('warning'),
      el('div', { class: 'alert-body' },
        el('strong', { class: 'alert-title' }, 'Copy it now and keep it somewhere safe'),
        'A password manager is best. This is the only time it is shown. If you lose it, you can get a new one by email.')),
    el('label', { class: 'choice', for: 'password-saved' }, saved, el('span', { class: 'choice-box' }),
      el('span', { class: 'choice-label' }, 'I saved my password')),
    submit);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!saved.checked) return;
    onDone();
  });
  const node = authCard(title, lede, form);
  node.focusTarget = copy;
  return node;
}
