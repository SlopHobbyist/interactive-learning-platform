/* Shared pieces of the account screens (sign in, sign up, recover, verify, account): the auth
   card, the error box, the emailed-code input, the help footer, the human check and the "save
   your new password" step. Wavefront's auth
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
 * Six slots for a code from an email (Wavefront's OTP input). Typing or pasting the last digit
 * fires `ui:otp` on `node`.
 *   const otp = codeInput('Recovery code'); otp.node; otp.value(); otp.clear(); otp.focus(i)
 */
export function codeInput(label) {
  const slots = Array.from({ length: 6 }, () => el('input', { class: 'otp-slot', type: 'text' }));
  const hidden = el('input', { type: 'hidden', 'data-otp-value': true });
  return {
    node: el('div', { class: 'otp', 'data-otp': true, role: 'group', 'aria-label': label }, ...slots, hidden),
    value: () => hidden.value || slots.map((s) => s.value).join(''),
    clear: () => {
      slots.forEach((s) => { s.value = ''; s.classList.remove('is-filled'); });
      hidden.value = '';
    },
    focus: (i = 0) => slots[Math.min(i, slots.length - 1)].focus(),
    first: slots[0],
  };
}

/** "<lead> help@…": an auth-card footer pointing at the host's help address (ILP_HELP_EMAIL),
    or null when the host has not set one. */
export function helpFooter(lead = 'Need a hand? Email ') {
  const address = window.app.auth.help_email;
  if (!address) return null;
  return el('p', { class: 'auth-footer' }, lead, el('a', { class: 'link', href: `mailto:${address}` }, address));
}

/** True when the server has Cloudflare Turnstile switched on (both keys set). */
export function turnstileOn(config) {
  return !!config && config.mode === 'cloudflare' && !!config.site_key;
}

// Cloudflare serves the widget script and does not allow self-hosting it. This is the one
// external script in the app, and it is only ever requested when Turnstile is switched on.
const TURNSTILE_API = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let turnstileApi = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  turnstileApi ||= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_API;
    script.async = true;
    script.addEventListener('load', () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not start.'))));
    script.addEventListener('error', () => {
      turnstileApi = null; // a blocked script may work on the next try
      script.remove();
      reject(new Error('Turnstile did not load.'));
    });
    document.head.append(script);
  });
  return turnstileApi;
}

/** Resolves once `node` is in the page (views are built before the router inserts them). */
function whenAttached(node, giveUpMs = 10000) {
  const until = Date.now() + giveUpMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (node.isConnected) resolve(true);
      else if (Date.now() > until) resolve(false);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

/** The real widget: Cloudflare renders the challenge, the callback hands over its token. */
function turnstileCheck(config) {
  let token = '';
  let widgetId = null;
  const target = el('div', { class: 'human-check-widget', tabindex: '-1' });
  const note = el('p', { class: 'human-check-note', role: 'status', hidden: true });
  const node = el('div', { class: 'human-check human-check-cloudflare', 'data-mode': 'cloudflare' }, target, note);
  const say = (text) => { note.textContent = text || ''; note.hidden = !text; };

  Promise.all([loadTurnstile(), whenAttached(node)]).then(([api, attached]) => {
    if (!attached) return;
    widgetId = api.render(target, {
      sitekey: config.site_key,
      theme: document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
      'response-field': false,
      callback: (value) => { token = value; say(''); },
      'expired-callback': () => { token = ''; },
      'timeout-callback': () => { token = ''; },
      'error-callback': () => { token = ''; say('The human check hit an error. Reload the page and try again.'); return true; },
    });
    // The router drops this view without telling it; stop the widget refreshing its token then.
    const watch = new MutationObserver(() => {
      if (node.isConnected) return;
      watch.disconnect();
      try { api.remove(widgetId); } catch { /* already gone */ }
      widgetId = null;
    });
    watch.observe(document.body, { childList: true, subtree: true });
  }).catch(() => {
    say('The human check could not load. Allow challenges.cloudflare.com (an ad blocker may be in the way), then reload the page.');
  });

  return {
    node,
    input: target,
    token: () => token,
    reset: () => {
      token = '';
      if (widgetId != null && window.turnstile) window.turnstile.reset(widgetId);
    },
  };
}

/**
 * The human check on sign-up and sign-in. With Cloudflare Turnstile switched on (both keys set
 * on the server) it is the real widget. Otherwise it is a local placeholder, a checkbox that
 * yields the server's placeholder token; sign-in shows nothing then (login.js). See
 * docs/ARCHITECTURE.md (Accounts).
 *   const check = humanCheck(mode.turnstile); check.node; check.input; check.token(); check.reset()
 */
export function humanCheck(config = {}) {
  if (turnstileOn(config)) return turnstileCheck(config);
  const input = el('input', { type: 'checkbox', id: 'human-check' });
  const choice = el('label', { class: 'choice', for: 'human-check' },
    input, el('span', { class: 'choice-box' }), el('span', { class: 'choice-label' }, "I'm a human"));
  const node = el('div', { class: 'human-check', 'data-mode': 'placeholder' },
    choice,
    el('span', { class: 'human-check-brand' }, icon('verified_user', 'icon-sm'), 'Turnstile'),
    el('p', { class: 'human-check-note' }, 'Placeholder for Cloudflare Turnstile.'));
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
