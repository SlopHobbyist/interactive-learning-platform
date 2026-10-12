/* Keyboard focus never gets stranded.

   When the focused control is disabled, hidden or removed (a matched pair locks, an answer is
   checked, a view is replaced), the browser drops focus to <body>. From there no shortcut
   reaches anything and Tab restarts at the top of the page, so a keyboard user has to click or
   Tab back in. The same goes for focus parked on a container that only takes focus from script
   (tabindex="-1", no role), which is where a click on lesson text puts it. Two guards:

   1. When focus falls to <body> on its own (not because the pointer clicked empty space), it is
      put back on the current focus home.
   2. A key pressed while nothing is focused is delivered to the focus home as if it had been
      focused all along: a typed letter lands in the input, Enter checks, 1–4 pick.

   The focus home is the open modal surface if there is one, else whatever the current view
   offers as `view.restoreFocus()` (the player offers the current item, or Continue). A view
   without one is left to the browser, whose Tab order resumes where the lost control was.

   A view can also claim the keyboard for the whole window with `view.keyScope()`: while it
   returns an element, a key pressed with focus anywhere outside it (the theme toggle just
   clicked, the Check button, the top bar) is delivered to the focus home too. The exceptions
   are text fields, and Enter or Space on a control the user moved to with Tab or the arrows.

   Modality. Moving focus by script is how the keyboard flow works (a matched pair hands focus
   to the next open option), but it is not a place to show a learner who answers with shortcut
   keys. So focus rings follow how the user is moving: Tab or an arrow key sets
   `data-keyboard-nav` on <html> and rings show; a click or a typed character clears it and
   they hide (app.css). Enter and Space leave it as it is. `keyboardNavigating()` tells the
   player whether the focused control was reached on purpose. */

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/* Keys that mean something on <body> already (scrolling, Tab order) or are not input at all. */
const PASS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Escape',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End',
  'ContextMenu', 'Unidentified', 'Dead']);

const CONTROL = 'a[href], button, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role]';
const EDITABLE = 'input:not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]),' +
  ' textarea, select, [contenteditable]:not([contenteditable="false"])';
const NAV_KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

let navigating = false;

/** True while the user moves focus with Tab or the arrow keys (rings show). */
export function keyboardNavigating() {
  return navigating;
}

function setNavigating(on) {
  if (on === navigating) return;
  navigating = on;
  document.documentElement.toggleAttribute('data-keyboard-nav', on);
}

/** Track the modality from a trusted key press. */
function noteKey(event) {
  if (NAV_KEYS.has(event.key)) {
    // Arrows and Home/End inside a text field move the caret, not focus.
    if (event.key === 'Tab' || !event.target.matches(EDITABLE)) setNavigating(true);
  } else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    setNavigating(false); // a typed character: a shortcut or an answer
  }
}

export function focusLost() {
  const a = document.activeElement;
  return !a || a === document.body || a === document.documentElement;
}

/** Focus is on a container that only takes it from script: nothing there handles keys. */
function focusParked() {
  const a = document.activeElement;
  return Boolean(a) && a.getAttribute('tabindex') === '-1' && !a.matches(CONTROL);
}

function modal() {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  return dialogs[dialogs.length - 1] || document.querySelector('[aria-modal="true"][data-open="true"]');
}

/** Focus is outside the part of the view that owns the keyboard (see keyScope above). */
function outsideScope(outlet, event) {
  const view = outlet.firstElementChild;
  const scope = view && typeof view.keyScope === 'function' ? view.keyScope() : null;
  const t = event.target;
  if (!scope || !(t instanceof Element) || scope.contains(t) || modal()) return false;
  if (t.matches(EDITABLE)) return false; // typing into a field stays in that field
  if (navigating && (event.key === 'Enter' || event.key === ' ') && t.matches(CONTROL)) return false;
  return true;
}

/** Move focus to the focus home. Returns true when something now has focus. */
export function restoreFocus(outlet) {
  const surface = modal();
  if (surface) {
    const target = surface.querySelector('[data-autofocus]') ||
      [...surface.querySelectorAll(FOCUSABLE)].find((n) => n.getClientRects().length) || surface;
    if (target === surface && !surface.hasAttribute('tabindex')) surface.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    return !focusLost();
  }
  const view = outlet.firstElementChild;
  if (!view || typeof view.restoreFocus !== 'function') return false;
  try { view.restoreFocus(); } catch (err) { console.error('[focus] restoreFocus failed', err); }
  return !focusLost();
}

export function installFocusKeeper(outlet) {
  // 1. Focus fell to <body> on its own: put it back. A pointer press just before means the
  //    user clicked empty space on purpose, so that is left alone.
  let pointerAt = -Infinity;
  window.addEventListener('pointerdown', () => { pointerAt = performance.now(); setNavigating(false); }, true);
  document.addEventListener('focusout', (event) => {
    if (event.relatedTarget) return;
    setTimeout(() => {
      if (!focusLost() || !document.hasFocus()) return; // another window took focus
      if (performance.now() - pointerAt < 500) return;
      restoreFocus(outlet);
    }, 0);
  }, true);

  // 2. A key pressed while nothing is focused (or outside the view's key scope) goes to the
  //    focus home. Window capture runs
  //    before every other listener; the original is stopped and a copy is sent to the new
  //    target, so each listener sees the key once. The browser's own default action (a typed
  //    character, Enter on a button) follows focus to the new target as well.
  window.addEventListener('keydown', (event) => {
    if (!event.isTrusted) return; // our own copies (and other scripts' synthetic keys)
    noteKey(event);
    if (event.isComposing || PASS.has(event.key) || /^F\d{1,2}$/.test(event.key)) return;
    if (!(focusLost() || focusParked() || outsideScope(outlet, event))) return;
    const mod = event.ctrlKey || event.metaKey || event.altKey;
    if (mod && !(event.key === 'Enter' && !event.altKey)) return; // browser shortcuts stay the browser's
    const before = document.activeElement;
    if (!restoreFocus(outlet)) return;
    if (document.activeElement === before && before !== document.body) return; // the home is right here
    event.stopImmediatePropagation();
    const copy = new KeyboardEvent('keydown', {
      key: event.key, code: event.code, location: event.location, repeat: event.repeat,
      ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      bubbles: true, cancelable: true, composed: true,
    });
    if (!document.activeElement.dispatchEvent(copy)) event.preventDefault();
  }, true);
}
