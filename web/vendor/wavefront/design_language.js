/* ============================================================================
   DESIGN LANGUAGE — shared behavior
   ----------------------------------------------------------------------------
   Vanilla, no dependencies. Everything is wired declaratively through data-*
   attributes so the markup stays free of inline handlers and a different
   design language can reuse this file untouched.

   Behaviors are registered in BEHAVIORS and applied by init(root), which is
   safe to re-run against newly inserted markup.

   Public surface: window.UI
     UI.toast(message, options)       show a transient message
     UI.openDialog(id) / closeDialog  control a <dialog>
     UI.openSheet(el) / closeSheet    control a bottom or side sheet
     UI.openPopover(el) / closePopover  control an anchored popover
     UI.trapFocus(el) / releaseFocus  confine Tab to a surface, then let go
     UI.lift(options)                 pick an element up and stick it to the
                                      pointer, for a drag of your own; see the
                                      lifted dragging section for the options,
                                      UI.lift.edge / .speed / .settle to tune,
                                      and data-drag-proxy="off" to turn the
                                      kit's own lifts off
     UI.keepInView(el)                scroll the nearest scroller, and only
                                      that one, just enough to show el
     UI.refreshScrollbars()           re-find scrollers and re-measure every
                                      custom scrollbar; needed only when a
                                      scroller is built outside UI.init and
                                      its content does not change afterwards
     UI.setTheme('light'|'dark'|null) override or clear the theme
     UI.isRTL(el)                     whether text runs right to left there
     UI.init(root)                    wire up a subtree
     UI.pages                         the site manifest, used to build nav
   ========================================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------- site manifest */
  /* One entry per showcase page. The drawer, the index grid and the previous /
     next pager are all generated from this list, so adding a page here is the
     only edit needed to surface it everywhere. */
  var PAGES = [
    { href: 'index.html',       title: 'Overview',        icon: 'home',            blurb: 'Every page in the kit, with what each one covers.' },
    { href: 'foundations.html', title: 'Foundations',     icon: 'palette',         blurb: 'Color roles, type scale, elevation, shape, spacing, motion and icons.' },
    { href: 'buttons.html',     title: 'Buttons',         icon: 'smart_button',    blurb: 'Every button variant, size, state, group, toolbar and floating action.' },
    { href: 'forms.html',       title: 'Forms',           icon: 'edit_note',       blurb: 'Text fields, rich text, selects, sliders, masks, password strength and validation.' },
    { href: 'selection.html',   title: 'Selection',       icon: 'check_box',       blurb: 'Checkboxes, radios, switches, toggle chips and choice cards.' },
    { href: 'navigation.html',  title: 'Navigation',      icon: 'explore',         blurb: 'App bars, drawers, rails, tabs, menus, breadcrumbs and steppers.' },
    { href: 'surfaces.html',    title: 'Surfaces',        icon: 'layers',          blurb: 'Cards, panels, lists, dividers, sheets and elevation.' },
    { href: 'feedback.html',    title: 'Feedback',        icon: 'notifications',   blurb: 'Dialogs, toasts, tooltips, progress, banners and skeletons.' },
    { href: 'data.html',        title: 'Data display',    icon: 'table_chart',     blurb: 'Tables, chips, badges, avatars, stats, donuts, gauges, timelines and trees.' },
    { href: 'media.html',       title: 'Media',           icon: 'photo_library',   blurb: 'Images, aspect ratios, galleries, the lightbox, carousels, video and audio.' },
    { href: 'content.html',     title: 'Content',         icon: 'article',         blurb: 'Long-form typography, quotes, code, footnotes and article layout.' },
    { href: 'layout.html',      title: 'Layout',          icon: 'grid_view',       blurb: 'Containers, the twelve-column grid, masonry, container queries and breakpoints.' },
    { href: 'interactions.html', title: 'Interactions',   icon: 'touch_app',       blurb: 'The command palette, popovers, comboboxes, pickers, tag fields and reordering.' },
    { href: 'patterns.html',    title: 'Patterns',        icon: 'dashboard',       blurb: 'Settings, dashboards, filters, boards, chat, comments, auth and error screens.' },
    { href: 'marketing.html',   title: 'Marketing',       icon: 'campaign',        blurb: 'Hero bands, feature grids, pricing, testimonials, FAQ and calls to action.' },
    { href: 'accessibility.html', title: 'Accessibility', icon: 'accessibility_new', blurb: 'Focus management, forced colors, right-to-left, reduced motion and live regions.' }
  ];

  var THEME_KEY = 'design-language-theme';

  /* ------------------------------------------------------------- utilities */
  function $(selector, root) { return (root || document).querySelector(selector); }
  function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function on(el, type, handler, options) { el.addEventListener(type, handler, options); }

  /* Marks a node so a behavior never binds to it twice when init re-runs. */
  function claim(el, key) {
    var flag = 'bound' + key;
    if (el.dataset[flag]) return false;
    el.dataset[flag] = '1';
    return true;
  }

  /* html[data-motion] (set by the app from the OS and its Motion setting) wins. */
  function prefersReducedMotion() {
    var attr = document.documentElement.getAttribute('data-motion');
    if (attr) return attr === 'reduce';
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* ========================================================== direction */
  /* CSS mirrors a right-to-left layout on its own, but a key event does not:
     ArrowRight is a physical key and always will be. In a mirrored layout the
     next item is to the left, so every horizontal arrow handler has to ask
     which way the text runs before deciding what "next" means.

     The direction is read from the element rather than from <html>, because a
     single component can be marked dir="ltr" inside a right-to-left page —
     a code block or a phone number, for instance. */
  function isRTL(el) {
    var node = el && el.nodeType === 1 ? el : document.documentElement;
    return window.getComputedStyle(node).direction === 'rtl';
  }

  /* Turns a horizontal arrow key into -1, 1 or 0 in reading order. */
  function inlineStep(event, el) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return 0;
    var forward = isRTL(el) ? 'ArrowLeft' : 'ArrowRight';
    return event.key === forward ? 1 : -1;
  }

  /* ===================================================== dates and times */
  /* Everything here works in local time on purpose: a date picked from a
     calendar is a calendar date, not an instant, so going through UTC would
     shift it by a day for anyone east or west of Greenwich. */
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

  /* Monday first. The short form is what fits a 36px column. */
  var WEEKDAYS = [
    { short: 'M', long: 'Monday' },    { short: 'T', long: 'Tuesday' },
    { short: 'W', long: 'Wednesday' }, { short: 'T', long: 'Thursday' },
    { short: 'F', long: 'Friday' },    { short: 'S', long: 'Saturday' },
    { short: 'S', long: 'Sunday' }
  ];

  function pad(value) { return String(value).padStart(2, '0'); }

  /* ================================================================ color */
  /* Needed because the kit draws its own color picker rather than handing the
     job to <input type="color">, whose panel is the operating system's and
     reaches none of the tokens. Everything stored is #rrggbb; HSL is only
     ever the working representation behind the three sliders, because a hue
     ring and two linear ramps are the one arrangement of a color space that
     survives being built out of range inputs and stays keyboard-operable. */
  function normalizeHex(value) {
    var text = String(value == null ? '' : value).trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(text)) {
      text = text.charAt(0) + text.charAt(0) + text.charAt(1) + text.charAt(1) +
             text.charAt(2) + text.charAt(2);
    }
    return /^[0-9a-f]{6}$/i.test(text) ? '#' + text.toLowerCase() : null;
  }

  function hexToRgb(hex) {
    var clean = normalizeHex(hex) || '#000000';
    return [
      parseInt(clean.slice(1, 3), 16),
      parseInt(clean.slice(3, 5), 16),
      parseInt(clean.slice(5, 7), 16)
    ];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (channel) {
      var value = Math.max(0, Math.min(255, Math.round(channel)));
      return pad(value.toString(16));
    }).join('');
  }

  function rgbToHsl(rgb) {
    var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var l = (max + min) / 2;
    var h = 0, sat = 0;
    if (max !== min) {
      var span = max - min;
      sat = l > 0.5 ? span / (2 - max - min) : span / (max + min);
      if (max === r) h = (g - b) / span + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / span + 2;
      else h = (r - g) / span + 4;
      h /= 6;
    }
    return [Math.round(h * 360), Math.round(sat * 100), Math.round(l * 100)];
  }

  function hslToRgb(hsl) {
    var h = ((hsl[0] % 360) + 360) % 360 / 360;
    var sat = Math.max(0, Math.min(100, hsl[1])) / 100;
    var l = Math.max(0, Math.min(100, hsl[2])) / 100;
    if (sat === 0) { var flat = Math.round(l * 255); return [flat, flat, flat]; }
    var q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
    var p = 2 * l - q;
    function channel(t) {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    }
    return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)]
      .map(function (v) { return Math.round(v * 255); });
  }

  /* Which of black or white reads on a given fill, so a swatch can carry a
     checkmark whatever color it is holding. 0.6 rather than 0.5: perceived
     lightness runs ahead of relative luminance in the mid tones. */
  function contrastInk(hex) {
    var rgb = hexToRgb(hex);
    var linear = rgb.map(function (channel) {
      var v = channel / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    var luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance > 0.36 ? '#000000' : '#ffffff';
  }

  /* ============================================== months, as a value type */
  /* <input type="month"> stores YYYY-MM, which is neither a date nor a
     duration, so it gets its own two functions rather than borrowing the
     date ones and pretending the first of the month is the value. */
  function parseMonth(value) {
    var match = /^(\d{4})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    var month = Number(match[2]);
    if (month < 1 || month > 12) return null;
    return { y: Number(match[1]), m: month - 1 };
  }

  function formatMonth(value) {
    return value ? MONTHS[value.m] + ' ' + value.y : '';
  }

  /* Unique ids for the markup the pickers generate. A popover has to be
     addressed by id from its trigger, so anything built at runtime needs one
     that cannot collide with a hand-written id on the same page. */
  var uidCount = 0;
  function uid(prefix) { uidCount += 1; return (prefix || 'ui') + '-' + uidCount; }

  function today() {
    var now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }

  function addMonths(date, delta) {
    /* Clamped to the length of the target month, so 31 January plus one month
       is 28 February rather than rolling into March. */
    var target = new Date(date.getFullYear(), date.getMonth() + delta, 1);
    var days = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), days));
  }

  function same(a, b) {
    return !!a && !!b && a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function toISO(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  /* Strict yyyy-mm-dd only, and the parts are checked after construction so
     2026-02-31 is rejected rather than silently becoming 3 March. */
  function parseISO(text) {
    if (!text) return null;
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text).trim());
    if (!match) return null;
    var date = new Date(+match[1], +match[2] - 1, +match[3]);
    if (date.getMonth() !== +match[2] - 1 || date.getDate() !== +match[3]) return null;
    return date;
  }

  /* Whatever the browser can make of a typed date, normalized to midnight. */
  function parseLoose(text) {
    if (!text) return null;
    var stamp = Date.parse(text);
    if (isNaN(stamp)) return null;
    var date = new Date(stamp);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatLong(date) {
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear();
  }

  function parseTime(text) {
    if (!text) return null;
    var match = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i.exec(String(text).trim());
    if (!match) return null;
    var hour = +match[1];
    var minute = +match[2];
    if (minute > 59) return null;
    var meridiem = match[3] && match[3].toLowerCase();
    if (meridiem) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
    } else if (hour > 23) {
      return null;
    }
    return { h: hour, m: minute };
  }

  function to12(hour) { return hour % 12 === 0 ? 12 : hour % 12; }
  function from12(hour, pm) { return (hour % 12) + (pm ? 12 : 0); }

  function formatTime12(time) {
    return to12(time.h) + ':' + pad(time.m) + ' ' + (time.h >= 12 ? 'PM' : 'AM');
  }

  /* ============================================================ comboboxes */
  function closeAllCombos(except) {
    $$('.combobox[data-open="true"]').forEach(function (box) {
      if (box === except) return;
      if (box._uiCombobox) box._uiCombobox.close();
    });
  }

  /* ======================================================== focus trapping */
  /* A native <dialog> opened with showModal() confines Tab and restores focus
     on its own. A .drawer or a .sheet is a plain element, so both have to be
     applied by hand: Tab wraps inside the surface, everything behind it is
     marked inert so assistive technology cannot reach it either, and focus
     returns to whatever opened it. */
  var FOCUSABLE = 'a[href], area[href], button, input, select, textarea, summary,' +
                  ' iframe, audio[controls], video[controls],' +
                  ' [contenteditable]:not([contenteditable="false"]), [tabindex]';

  function focusableIn(container) {
    return $$(FOCUSABLE, container).filter(function (el) {
      if (el.disabled || el.tabIndex < 0) return false;
      if (el.getAttribute('aria-hidden') === 'true') return false;
      if (el.closest('[inert]')) return false;
      /* Rules out display:none and visibility:hidden without reading styles. */
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    });
  }

  /* A stack, so a sheet opened over a drawer still unwinds in order. */
  var traps = [];

  function trapFocus(container) {
    if (!container) return null;
    var trap = { container: container, restore: document.activeElement, inert: [] };

    /* Everything beside the modal surface becomes inert. The scrim stays
       interactive so a click on it still dismisses, and the toast region
       stays reachable so messages are still announced. */
    $$('body > *').forEach(function (node) {
      if (node === container || node.contains(container)) return;
      if (node.classList.contains('scrim') || node.classList.contains('toast-region')) return;
      if (node.hasAttribute('inert')) return;
      node.setAttribute('inert', '');
      trap.inert.push(node);
    });

    /* Capturing, so the wrap happens before any component's own Tab handling. */
    trap.onKeydown = function (event) {
      if (event.key !== 'Tab') return;
      if (traps[traps.length - 1] !== trap) return;
      var items = focusableIn(container);
      if (!items.length) { event.preventDefault(); container.focus(); return; }
      var first = items[0];
      var last = items[items.length - 1];
      var inside = container.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    on(document, 'keydown', trap.onKeydown, true);
    traps.push(trap);

    /* data-autofocus wins, then the first focusable thing, then the surface
       itself, which is given a programmatic-only tabindex to receive it. */
    var target = $('[data-autofocus]', container) || focusableIn(container)[0];
    if (!target) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      target = container;
    }
    target.focus();
    return trap;
  }

  function releaseFocus(container) {
    var index = -1;
    for (var i = traps.length - 1; i >= 0; i--) {
      if (traps[i].container === container) { index = i; break; }
    }
    if (index < 0) return;
    var trap = traps.splice(index, 1)[0];
    document.removeEventListener('keydown', trap.onKeydown, true);
    trap.inert.forEach(function (node) { node.removeAttribute('inert'); });

    /* Focus only goes back if it is still inside what is closing, so a
       deliberate move elsewhere in the meantime is not undone. */
    var active = document.activeElement;
    var stranded = !active || active === document.body || container.contains(active);
    if (stranded && trap.restore && typeof trap.restore.focus === 'function') {
      trap.restore.focus();
    }
  }

  /* ============================================================== popovers */
  var PLACEMENTS = ['popover-top', 'popover-bottom', 'popover-top-end',
                    'popover-bottom-end', 'popover-start', 'popover-end'];

  /* The markup states a preferred side; it is only swapped when the overlay
     would otherwise fall outside the viewport. Measurement happens while the
     popover is still hidden, which is fine because visibility:hidden keeps a
     box — display:none would not. */
  function placePopover(pop) {
    var preferred = pop.getAttribute('data-placement') || 'bottom';
    PLACEMENTS.forEach(function (name) { pop.classList.remove(name); });
    pop.classList.add('popover-' + preferred);
    /* Clear last time's correction before measuring this time's. */
    pop.style.marginInlineStart = '';
    pop.style.marginInlineEnd = '';

    var gutter = 8;
    /* clientWidth, not innerWidth: the latter counts the scrollbar, which is
       not space anything can be placed in. */
    var viewWidth = document.documentElement.clientWidth;
    var viewHeight = document.documentElement.clientHeight;
    var rect = pop.getBoundingClientRect();

    /* Flip to the opposite side, but only if there is actually more room
       there — flipping into an even smaller gap helps nobody. */
    if (preferred.indexOf('bottom') === 0 && rect.bottom > viewHeight - gutter && rect.top > rect.height) {
      pop.classList.remove('popover-' + preferred);
      pop.classList.add('popover-' + preferred.replace('bottom', 'top'));
    } else if (preferred.indexOf('top') === 0 && rect.top < gutter) {
      pop.classList.remove('popover-' + preferred);
      pop.classList.add('popover-' + preferred.replace('top', 'bottom'));
    } else if (preferred === 'end' && rect.right > viewWidth - gutter) {
      pop.classList.remove('popover-end');
      pop.classList.add('popover-start');
    } else if (preferred === 'start' && rect.left < gutter) {
      pop.classList.remove('popover-start');
      pop.classList.add('popover-end');
    }

    /* Then slide it along the other axis so it sits inside the viewport. An
       anchor near the edge of a narrow screen would otherwise push a popover
       off it — and since the popover is absolutely positioned, that widens
       the page rather than being clipped. */
    rect = pop.getBoundingClientRect();
    var shift = 0;
    if (rect.right > viewWidth - gutter) shift = (viewWidth - gutter) - rect.right;
    else if (rect.left < gutter) shift = gutter - rect.left;
    if (shift) {
      /* Which margin moves it depends on the edge it is pinned to: an element
         pinned by its end edge ignores a start margin entirely. */
      var pinnedToEnd = pop.classList.contains('popover-bottom-end') ||
                        pop.classList.contains('popover-top-end') ||
                        pop.classList.contains('popover-start');
      if (pinnedToEnd) pop.style.marginInlineEnd = (-shift) + 'px';
      else pop.style.marginInlineStart = shift + 'px';
    }
  }

  function popoverTrigger(pop) {
    return $('[data-popover="' + pop.id + '"]');
  }

  /* Popovers are not modal: focus moves into them but is not trapped, and the
     page behind stays live. Escape and an outside click both dismiss. */
  function openPopover(pop) {
    if (!pop || pop.dataset.open === 'true') return;
    closeAllPopovers(pop);
    placePopover(pop);
    pop.dataset.open = 'true';
    var trigger = popoverTrigger(pop);
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    /* Fired before focus moves, so a picker inside can rebuild itself and
       then have its own landing spot honoured. */
    pop.dispatchEvent(new CustomEvent('ui:open', { bubbles: false }));
    var target = $('[data-autofocus]', pop) || focusableIn(pop)[0];
    if (target) target.focus();
  }

  function closePopover(pop, options) {
    if (!pop || pop.dataset.open !== 'true') return;
    pop.dataset.open = 'false';
    var trigger = popoverTrigger(pop);
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
    /* Returning focus to the trigger matters when the keyboard dismissed it;
       after an outside click the pointer has already moved focus elsewhere. */
    if (trigger && (!options || options.restoreFocus !== false) &&
        (!document.activeElement || pop.contains(document.activeElement))) {
      trigger.focus();
    }
  }

  function closeAllPopovers(except) {
    $$('.popover[data-open="true"]').forEach(function (pop) {
      if (pop !== except) closePopover(pop, { restoreFocus: false });
    });
  }


  /* ================================================================= theme */
  var Theme = {
    /* Reads the stored override. Null means "follow the operating system". */
    stored: function () {
      try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
    },
    set: function (value) {
      if (value) {
        document.documentElement.setAttribute('data-theme', value);
        try { localStorage.setItem(THEME_KEY, value); } catch (e) {}
      } else {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.removeItem(THEME_KEY); } catch (e) {}
      }
      Theme.sync();
    },
    /* The effective theme, resolving "follow the OS" to a concrete value.
       Asked as "is the OS light?" rather than "is the OS dark?" because dark
       is this language's reference theme and the stylesheet is written the
       same way round: :root is dark, and a prefers-color-scheme: light query
       overrides it. A browser reporting no-preference matches neither query,
       so phrasing both the same way is what keeps the two in step — the other
       phrasing resolved to light here while the CSS stayed dark. */
    resolved: function () {
      var explicit = document.documentElement.getAttribute('data-theme');
      if (explicit) return explicit;
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    },
    toggle: function () {
      Theme.set(Theme.resolved() === 'dark' ? 'light' : 'dark');
    },
    /* Keeps every theme control on the page showing the current state. */
    sync: function () {
      var dark = Theme.resolved() === 'dark';
      $$('[data-theme-toggle]').forEach(function (el) {
        el.setAttribute('aria-pressed', String(dark));
        var icon = $('.icon', el);
        if (icon) icon.textContent = dark ? 'light_mode' : 'dark_mode';
        var label = el.getAttribute('data-theme-label');
        if (label !== null) {
          el.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
        }
      });
    },
    init: function () {
      var stored = Theme.stored();
      if (stored) document.documentElement.setAttribute('data-theme', stored);
      Theme.sync();
      /* The same query resolved() asks, so the two cannot disagree. Watching
         the dark query instead would miss a light → no-preference change,
         which flips the resolved theme without ever changing that query. */
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', Theme.sync);
    }
  };

  /* ================================================================ toasts */
  function toastRegion() {
    var region = $('.toast-region');
    if (!region) {
      region = document.createElement('div');
      region.className = 'toast-region';
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', 'polite');
      document.body.appendChild(region);
    }
    return region;
  }

  /* options: { action, onAction, duration, variant } */
  function toast(message, options) {
    options = options || {};
    var el = document.createElement('div');
    el.className = 'toast' + (options.variant ? ' toast-' + options.variant : '');

    var text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    el.appendChild(text);

    if (options.action) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = options.action;
      on(button, 'click', function () {
        if (options.onAction) options.onAction();
        dismiss();
      });
      el.appendChild(button);
    }

    /* Plays the exit animation, then removes the node. */
    function dismiss() {
      if (el.classList.contains('is-leaving')) return;
      el.classList.add('is-leaving');
      window.setTimeout(function () { el.remove(); }, 200);
    }

    toastRegion().appendChild(el);
    var duration = options.duration === undefined ? 4000 : options.duration;
    if (duration > 0) window.setTimeout(dismiss, duration);
    return { dismiss: dismiss, element: el };
  }

  /* ====================================================== lifted dragging */
  /* One drag mechanism, shared by every reorderable thing in the kit.

     The problem it solves: a drag that only paints a drop line somewhere else
     leaves you dragging an element you cannot see. You grab a row, the row
     stays put, and a thin accent rule moves around a list that may be taller
     than the screen. On anything longer than a handful of items you are
     steering from memory.

     What a lift does instead:
       - takes the element out of flow and sticks it to the pointer, so the
         thing you grabbed is the thing you see moving;
       - leaves a gap exactly where it came from, so "back where it was" is
         still on screen;
       - scrolls any scroller the pointer reaches the edge of, including the
         page, so a list longer than the screen is reachable;
       - lands the element with a short settle, so a drop reads as the row
         arriving rather than teleporting.

     The element itself is lifted — not a clone of it. A clone has to be kept
     in sync with styling it cannot see: this kit resolves surface fills from
     how deeply a thing is nested, and most applications style rows by
     ancestor (.my-list .my-row), so a clone parked at the end of <body>
     paints differently from the row it stands in for, and silently. Lifting
     the real element in place keeps every selector that already matched it
     matching, and keeps its focus, its listeners and its pointer capture.

     Opting out: data-drag-proxy="off" on the component — or on any ancestor,
     up to <body>, since the nearest [data-drag-proxy] wins. A nested
     component can turn it back on with "on". Off falls back to exactly the
     older behavior: drop lines, no lift. Thresholds are on lift itself
     (lift.edge, lift.speed, lift.settle) for tuning without a fork. */

  /* Whether a fixed descendant of el would still be positioned against the
     viewport. transform, filter and friends make an element the containing
     block for fixed children, which both re-anchors them and brings back the
     overflow clipping that position: fixed otherwise escapes. Finding that
     ancestor is cheaper than being wrong about it: the lift anchors to it
     instead, which keeps the geometry exact. */
  function fixedBase(el) {
    var node = el.parentNode;
    while (node && node.nodeType === 1) {
      var style = window.getComputedStyle(node);
      if (style.transform !== 'none' ||
          style.perspective !== 'none' ||
          (style.filter && style.filter !== 'none') ||
          (style.backdropFilter && style.backdropFilter !== 'none') ||
          /\b(paint|layout|strict|content)\b/.test(style.contain || '') ||
          /\b(transform|perspective|filter)\b/.test(style.willChange || '')) {
        return node;
      }
      node = node.parentNode;
    }
    return null;
  }

  /* Every scrollable ancestor, innermost first, with the axes each one can
     move on. The page comes last, as a scroller with no node: a drag that
     reaches the bottom of a column and keeps going should end up moving the
     page, but only once the column has nothing left to give. */
  function scrollChain(el, includeSelf) {
    var chain = [];
    var node = includeSelf ? el : el.parentNode;
    while (node && node.nodeType === 1) {
      var style = window.getComputedStyle(node);
      var scrollsY = /(auto|scroll|overlay)/.test(style.overflowY);
      var scrollsX = /(auto|scroll|overlay)/.test(style.overflowX);
      if (scrollsY || scrollsX) chain.push({ node: node, y: scrollsY, x: scrollsX });
      node = node.parentNode;
    }
    chain.push({ node: null, y: true, x: true });
    return chain;
  }

  function viewportRect() {
    var width = window.innerWidth;
    var height = window.innerHeight;
    return { left: 0, top: 0, right: width, bottom: height, width: width, height: height };
  }

  function scrollerRect(target) {
    if (!target.node) return viewportRect();
    /* The client box, not the border box: a scrollbar is not somewhere the
       pointer can hover, so counting it as edge makes the zone lopsided. */
    var rect = target.node.getBoundingClientRect();
    return {
      left: rect.left, top: rect.top,
      right: rect.left + target.node.clientWidth,
      bottom: rect.top + target.node.clientHeight,
      width: target.node.clientWidth, height: target.node.clientHeight
    };
  }

  /* How hard to push, from -1 (hard against the near edge) to 1 (the far
     one), and 0 anywhere in the middle. The zone is capped at a quarter of
     the scroller so a short one — a 72px empty board column — is not edge
     the whole way through. */
  function edgePressure(point, min, max, size) {
    var zone = Math.min(lift.edge, size / 4);
    if (zone <= 0) return 0;
    if (point - min < zone) return Math.max(-1, -(1 - (point - min) / zone));
    if (max - point < zone) return Math.min(1, 1 - (max - point) / zone);
    return 0;
  }

  function applyScroll(target, dx, dy) {
    var moved = { x: false, y: false };
    if (!target.node) {
      var wasX = window.scrollX, wasY = window.scrollY;
      window.scrollBy(dx, dy);
      moved.x = window.scrollX !== wasX;
      moved.y = window.scrollY !== wasY;
      return moved;
    }
    var left = target.node.scrollLeft, top = target.node.scrollTop;
    if (dx) target.node.scrollLeft = left + dx;
    if (dy) target.node.scrollTop = top + dy;
    moved.x = target.node.scrollLeft !== left;
    moved.y = target.node.scrollTop !== top;
    return moved;
  }

  /* Scroll the nearest scroller just enough to show el, and nothing else.
     This is the keyboard half of a lift: an arrow key moves the real element,
     so it needs no proxy, but it does need the scroller to follow it.

     Deliberately not scrollIntoView, which scrolls every scrollable ancestor
     up to the document rather than the one that needed it — see TODO.txt (6)
     for the three-column panel that fought the page over this. */
  function keepInView(el) {
    if (!el) return;
    var chain = scrollChain(el);
    for (var i = 0; i < chain.length; i++) {
      var target = chain[i];
      if (target.node && target.node.scrollHeight <= target.node.clientHeight &&
          target.node.scrollWidth <= target.node.clientWidth) continue;
      var box = scrollerRect(target);
      var rect = el.getBoundingClientRect();
      var dy = rect.top < box.top ? rect.top - box.top
             : rect.bottom > box.bottom ? rect.bottom - box.bottom : 0;
      var dx = rect.left < box.left ? rect.left - box.left
             : rect.right > box.right ? rect.right - box.right : 0;
      if (!dx && !dy) return;
      var moved = applyScroll(target, dx, dy);
      if (moved.x || moved.y) return;
    }
  }

  /* data-drag-proxy, read from the nearest ancestor that sets it. */
  function liftEnabled(el) {
    var scope = el && el.closest ? el.closest('[data-drag-proxy]') : null;
    if (!scope) return true;
    var value = (scope.getAttribute('data-drag-proxy') || '').trim().toLowerCase();
    return !(value === 'off' || value === 'none' || value === 'false' || value === '0');
  }

  /* lift({ element, clientX, clientY, axis, update }) -> session or null
       element  what to pick up
       clientX  where the pointer was when it was picked up, so the element
       clientY    stays held where it was grabbed instead of jumping centered
       axis     'y', 'x' or 'both' (the default): which way it may travel
       update   called with (clientX, clientY) whenever the pointer moves or
                an auto-scroll shifts the ground, which is where a caller
                recomputes its drop hints. Auto-scroll is exactly why this is
                a callback: the pointer stops moving while the list keeps
                going, so pointermove alone leaves the hints stale.

     Returns null when lifting is turned off, which callers read as "do it the
     old way" rather than as a failure.

     The session:
       move(event)  follow the pointer
       drop()       put it back in flow and settle it. Move the element in the
                    DOM first if the drop changed its position; drop() reads
                    where it ended up and animates the difference, so the
                    element is never anywhere but where it belongs.
       element      what was lifted */
  function lift(options) {
    var el = options && options.element;
    if (!el || !el.parentNode || !liftEnabled(el)) return null;

    var axis = options.axis || 'both';
    var update = typeof options.update === 'function' ? options.update : null;
    var startX = options.clientX, startY = options.clientY;
    var pointX = startX, pointY = startY;

    var rect = el.getBoundingClientRect();
    var style = window.getComputedStyle(el);
    var container = fixedBase(el);
    /* position: fixed inside a transformed ancestor resolves against its
       PADDING box, while getBoundingClientRect reports the border box. */
    var inset = { left: 0, top: 0 };
    if (container) {
      var containerStyle = window.getComputedStyle(container);
      inset.left = parseFloat(containerStyle.borderLeftWidth) || 0;
      inset.top = parseFloat(containerStyle.borderTopWidth) || 0;
    }

    /* Restored verbatim on release, so a lift cannot eat an inline style the
       element arrived with. */
    var inlineStyle = el.getAttribute('style');

    /* The gap. Deliberately not a copy of the element's classes: the board
       counts its cards with .board-card and the list numbers its rows with
       .sortable-item, so a placeholder wearing those classes would be counted
       as one of them by every query in this file, including the ones not
       written yet. It carries the geometry instead. */
    var gap = document.createElement(el.tagName);
    gap.className = 'drag-gap';
    gap.setAttribute('aria-hidden', 'true');
    gap.style.width = rect.width + 'px';
    gap.style.height = rect.height + 'px';
    gap.style.borderRadius = style.borderRadius;
    gap.style.marginTop = style.marginTop;
    gap.style.marginRight = style.marginRight;
    gap.style.marginBottom = style.marginBottom;
    gap.style.marginLeft = style.marginLeft;

    /* Before the element rather than after it, and the element stays in the
       DOM: out of flow it occupies no space, so the rows around it never
       reflow and :last-child still means what it meant a moment ago. The gap
       stays where the element was picked up, which is the one position worth
       holding — where it will LAND is the drop line's job. */
    el.parentNode.insertBefore(gap, el);

    el.classList.add('is-lifted');
    el.style.position = 'fixed';
    el.style.left = '0';
    el.style.top = '0';
    el.style.margin = '0';
    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';

    /* What auto-scroll acts on is whatever is under the POINTER, not what
       the element was lifted out of. On a board those are different things
       the moment a card leaves its column: dragging into a second column has
       to scroll that column, and a chain built once from the origin scrolls
       a column the pointer is nowhere near. Recomputed only when the element
       under the pointer changes, since the walk reads computed styles. */
    var chain = scrollChain(gap);
    var chainFrom = null;
    var raf = 0;
    var last = 0;
    var done = false;

    function retarget() {
      if (!document.elementsFromPoint) return;
      var stack = document.elementsFromPoint(pointX, pointY);
      var under = null;
      for (var i = 0; i < stack.length; i++) {
        /* The lifted element is on top of everything by construction, and it
           is never what the pointer is pointing AT. */
        if (stack[i] !== el && !el.contains(stack[i])) { under = stack[i]; break; }
      }
      /* Off the viewport entirely: keep the last chain rather than losing
         the scroller the pointer just left. */
      if (!under || under === chainFrom) return;
      chainFrom = under;
      chain = scrollChain(under, true);
    }

    function place() {
      var base = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
      var dx = axis === 'y' ? 0 : pointX - startX;
      var dy = axis === 'x' ? 0 : pointY - startY;
      el.style.transform = 'translate(' +
        (rect.left - base.left - inset.left + dx) + 'px, ' +
        (rect.top - base.top - inset.top + dy) + 'px)';
    }

    /* Innermost scroller first, and each axis is claimed by the first
       scroller that actually moves on it. A column that has hit its bottom
       hands the push outward to the board, and then to the page, instead of
       swallowing it — and a pointer in the corner of a board can scroll a
       column down and the board sideways at once, because the two axes are
       settled separately. */
    function autoScroll(elapsed) {
      var scale = Math.min(elapsed, 50) / 16.7;
      var usedX = false, usedY = false;
      for (var i = 0; i < chain.length && !(usedX && usedY); i++) {
        var target = chain[i];
        var box = scrollerRect(target);
        /* Only a scroller the pointer is inside, or just outside the edge
           of — otherwise a row held off to one side scrolls things it is
           nowhere near. */
        if (pointX < box.left - lift.edge || pointX > box.right + lift.edge ||
            pointY < box.top - lift.edge || pointY > box.bottom + lift.edge) continue;
        var dy = !usedY && target.y
          ? edgePressure(pointY, box.top, box.bottom, box.height) * lift.speed * scale : 0;
        var dx = !usedX && target.x
          ? edgePressure(pointX, box.left, box.right, box.width) * lift.speed * scale : 0;
        if (!dx && !dy) continue;
        var moved = applyScroll(target, dx, dy);
        usedX = usedX || moved.x;
        usedY = usedY || moved.y;
      }
      return usedX || usedY;
    }

    /* The frame loop exists for auto-scroll, and for nothing else. Following
       the pointer is done in move() instead, synchronously: a row that is one
       frame behind the pointer it is supposed to be stuck to reads as lag,
       and hints computed a frame late lose a drag that began and ended inside
       one frame. place() runs every frame regardless, cheaply, because the
       ground can move without the pointer — a wheel mid-drag, the browser's
       own scroll anchoring. */
    function frame(now) {
      if (done) return;
      raf = window.requestAnimationFrame(frame);
      var elapsed = last ? now - last : 16.7;
      last = now;
      var scrolled = autoScroll(elapsed);
      place();
      /* Only on a scroll: the pointer has not moved, but what is under it
         has, so the hints the caller painted are now pointing at the wrong
         row. This is the whole reason update is a callback. */
      if (scrolled && update) update(pointX, pointY);
    }

    raf = window.requestAnimationFrame(frame);

    function move(event) {
      if (done) return;
      pointX = event.clientX;
      pointY = event.clientY;
      retarget();
      place();
      if (update) update(pointX, pointY);
    }

    function restore() {
      if (inlineStyle === null) el.removeAttribute('style');
      else el.setAttribute('style', inlineStyle);
    }

    function release() {
      if (gap.parentNode) gap.parentNode.removeChild(gap);
      el.classList.remove('is-lifted');
      restore();
    }

    /* The drop is a FLIP: let the element land in flow, measure how far that
       was from where the pointer left it, and decay that offset to zero. The
       element is in its final position the whole way through, so a settle
       that gets interrupted — by a re-render, a removal, a second drag —
       leaves nothing behind to clean up but an inline transform. */
    function drop() {
      if (done) return;
      done = true;
      window.cancelAnimationFrame(raf);

      var from = el.getBoundingClientRect();
      release();
      var to = el.getBoundingClientRect();
      var dx = from.left - to.left;
      var dy = from.top - to.top;

      /* Taken out of the document while it was in the air — a drop that
         re-renders the list, a card deleted mid-drag. Both rects are zeros
         by then, so there is nothing to settle and no element to settle it
         on. Releasing it was the part that mattered. */
      var attached = el.isConnected !== undefined ? el.isConnected : document.contains(el);
      if (!attached) return;

      if (!lift.settle || prefersReducedMotion() ||
          (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;

      el.classList.add('is-settling');
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';

      window.requestAnimationFrame(function () {
        el.style.transition = 'transform ' + lift.settle + 'ms var(--ease-decelerate), ' +
                              'box-shadow ' + lift.settle + 'ms var(--ease-standard)';
        el.style.transform = 'translate(0, 0)';
      });

      var cleared = false;
      function clear() {
        if (cleared) return;
        cleared = true;
        el.removeEventListener('transitionend', onEnd);
        el.classList.remove('is-settling');
        restore();
      }
      function onEnd(event) {
        if (event.propertyName === 'transform') clear();
      }
      on(el, 'transitionend', onEnd);
      /* transitionend never fires for a transition that never started — a
         display:none ancestor, a tab switched away mid-drop. */
      window.setTimeout(clear, lift.settle + 120);
    }

    return { move: move, drop: drop, element: el };
  }

  /* Tunable, because the right numbers depend on how tall the rows are and
     how far the thing being dragged is expected to travel. */
  lift.edge = 48;    /* px from a scroller's edge where auto-scroll starts */
  lift.speed = 18;   /* px per frame at the very edge, tapering to nothing */
  lift.settle = 140; /* ms for a dropped element to land; 0 disables it */

  /* ============================================================ behaviors */
  /* ============================================================ scrollbars */
  /* The kit draws its own scrollbars, for the same reason it draws its own
     color picker: the native one cannot be made to match. ::-webkit-scrollbar
     reaches the shape of it in Chrome and Safari, Firefox offers a
     two-keyword width and a pair of colors and nothing else, and a touch
     platform discards both for its own fading overlay. The stylesheet hides
     all three and this builds the replacement.

     What it does NOT do is reimplement scrolling. Every scroller stays a real
     native scroller, so the wheel, the keyboard, text selection, touch
     momentum, snap points, overscroll containment and anchoring are all still
     the browser's job. This reads scrollTop and draws a thumb; the only input
     it adds is a drag of that thumb and a click on the track.

     Three decisions worth keeping:

     (a) The bars are never children of the scroller they belong to. They are
         fixed elements hosted at the end of <body> — or of the floating
         surface the scroller sits on, so they share its stacking context —
         and placed from the scroller's rect every frame. A child would be
         cheaper to position and much worse: it would change what :last-child,
         :nth-child and :empty select inside every scroller in the kit, and
         .editor-surface is contenteditable, where an injected node is
         something the writer can put a caret in and delete.

     (b) The gutter is real padding, not an overlay. The native bar took its
         width out of the scroller's content box; reserve() puts the same
         width back as padding-inline-end, so content keeps the width it had
         and the switch from native to drawn reflows nothing.

     (c) Measuring and drawing are separate passes. draw() runs on every
         scroll frame and only reads rects and offsets. measure() reads
         computed styles and rewrites padding, and runs only when something
         structural changed — a resize, a mutation, or an axis starting or
         stopping overflowing. */
  var Scrollbars = (function () {
    /* .tabs hides its bar as a design decision rather than an oversight, so
       it keeps that decision here too. Anything else opts out by attribute,
       on the scroller or on any ancestor of it. */
    var OPT_OUT = '[data-scrollbar="off"], .tabs';

    /* A bar has to paint above the surface its scroller floats on, and must
       not be clipped by it. Hosting it in the nearest of these that does not
       clip puts it in that surface's stacking context, which is what gets it
       over a drawer, a sheet and a dialog's own backdrop. */
    var SURFACES = 'dialog, [popover], .dialog, .drawer, .sheet, .lightbox, ' +
                   '.popover, .menu, .combobox-popup, .palette-scrim';

    var SCROLLS = /^(auto|scroll)$/;

    var controllers = [];
    var selectors = null;
    /* How many selectors came out of the stylesheets themselves, as opposed
       to the handful appended unconditionally below. Zero means the sheets
       could not be read at all. */
    var harvested = 0;
    var started = false;
    var drawFrame = 0;
    var measureFrame = 0;
    var scanTimer = 0;

    /* ------------------------------------------------------ finding them */
    /* Read out of the kit's own stylesheet rather than listed here, so a new
       overflow rule in the CSS needs no matching edit in this file. That is
       the whole point of applying to every scroller rather than to an opt-in
       list: there is nothing to remember when adding one. */
    function scrollerSelectors() {
      if (selectors) return selectors;
      var found = [];
      function walk(rules) {
        for (var i = 0; i < rules.length; i++) {
          var rule = rules[i];
          /* @media, @supports, @layer — and a nested rule's own parent. */
          if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
          if (!rule.style || !rule.selectorText) continue;
          var declared = (rule.style.overflow || '') + ' ' +
                         (rule.style.overflowY || '') + ' ' +
                         (rule.style.overflowX || '');
          if (declared.indexOf('auto') < 0 && declared.indexOf('scroll') < 0) continue;
          if (found.indexOf(rule.selectorText) < 0) found.push(rule.selectorText);
        }
      }
      Array.prototype.forEach.call(document.styleSheets, function (sheet) {
        /* A cross-origin sheet throws on .cssRules, and has nothing to say
           about this kit in any case. */
        try { walk(sheet.cssRules); } catch (error) {}
      });
      harvested = found.length;
      /* Plus anything scrolled by an inline style or by a component's own JS. */
      found.push('[style*="overflow"]');
      /* And the controls the browser scrolls on its own authority. These are
         the one set no amount of reading document.styleSheets will turn up,
         because the rule that scrolls them lives in the UA stylesheet, which
         is not in that list. Without them a textarea with more text than it
         can show has no bar at all — the native one is hidden and nothing is
         drawn in its place. */
      found.push('textarea', 'select[multiple]', 'select[size]');
      selectors = found;
      return selectors;
    }

    /* A file:// page cannot read its own stylesheet: cssRules throws
       SecurityError, and this kit is meant to be opened by double-clicking an
       HTML file as much as by being served. With no rules to read, the
       scrollers are found by asking the document instead of the CSS.

       Asking every element costs one to two milliseconds on the heaviest page
       here, which was worth measuring rather than assuming: an earlier
       version of this skipped anything whose content already fit, and the
       saving was within the noise — a tenth of a millisecond — while the cost
       was real, because a box that is declared scrollable but not yet
       overflowing is exactly the one that has to be claimed BEFORE its
       content arrives. */
    function sheetsUnreadable() {
      /* Counted before the unconditional selectors are appended, so that
         adding one of those can never be mistaken for a sheet having been
         read — which is exactly the way this got it wrong once. */
      scrollerSelectors();
      return harvested === 0;
    }

    function sweep(root) {
      var nodes = root.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i++) consider(nodes[i]);
    }

    function consider(el) {
      if (!el || el.nodeType !== 1) return;
      if (el.dataset.boundScrollbar) return;
      if (el.classList.contains('scrollbar') || el.closest('.scrollbar')) return;
      if (el.closest(OPT_OUT)) return;
      var style = window.getComputedStyle(el);
      if (!SCROLLS.test(style.overflowY) && !SCROLLS.test(style.overflowX)) return;
      attach(el, style);
    }

    function scan(root) {
      root = root || document;
      if (sheetsUnreadable()) sweep(root);
      scrollerSelectors().forEach(function (selector) {
        var matched;
        /* A selector can be perfectly valid in a stylesheet and still throw
           here — a vendor pseudo-element, for one. */
        try { matched = $$(selector, root); } catch (error) { return; }
        matched.forEach(consider);
      });
      /* init may be handed the scroller itself rather than an ancestor. */
      if (root.nodeType === 1) consider(root);
      /* The document, which no selector in the sheet reaches by name. */
      consider(document.scrollingElement || document.documentElement);
    }

    /* ------------------------------------------------------------ measure */
    function declaredAxes(style) {
      return { y: SCROLLS.test(style.overflowY), x: SCROLLS.test(style.overflowX) };
    }

    /* Cheap enough for every frame: layout reads only, no computed style. */
    function liveAxes(controller) {
      var el = controller.el;
      return {
        y: controller.declared.y && el.scrollHeight - el.clientHeight > 1,
        x: controller.declared.x && el.scrollWidth - el.clientWidth > 1
      };
    }

    /* Put the element back exactly as it was found, but only when what is on
       it now is what this put there. */
    function restore(controller, axis) {
      var property = axis === 'y' ? 'paddingInlineEnd' : 'paddingBottom';
      var el = controller.el;
      if (!(axis in controller.authored)) controller.authored[axis] = el.style[property];
      if (el.style[property] === controller.written[axis]) {
        el.style[property] = controller.authored[axis];
      } else {
        /* Something other than this wrote to it; that is the baseline now. */
        controller.authored[axis] = el.style[property];
      }
      controller.written[axis] = null;
    }

    /* The gutter. See (b) above.

       The authored padding is measured ONCE, at a moment when the element is
       known to carry nothing of ours, and then cached. It is deliberately
       never re-derived from the computed value while our own gutter could
       still be sitting in it.

       That is not fussiness. The first version of this cleared the inline
       padding and read the computed value back in the same tick, trusting
       getComputedStyle to flush the clear first. On one real machine — Firefox,
       120Hz, where measure() was running every frame — it did not: the read
       returned the padding that had just been cleared, so the gutter was
       counted as authored padding and another gutter was added on top of it.
       Ten pixels per frame, about 840 a second, until the page was fifteen
       thousand pixels wide. It never reproduced under automation, because
       that depends entirely on flush timing. Reading back a value you just
       wrote is the bug; not doing it is the fix.

       The cache is dropped when the viewport changes, since that is what
       moves a breakpoint and so the authored padding with it. Re-measuring
       then takes two frames on purpose: one to take ours off, and the next
       — by which time the restore has certainly landed — to read what is left. */
    function reserve(controller, axis, wanted, recapturing) {
      if (controller.page) return;   /* the stylesheet pads the root */
      var property = axis === 'y' ? 'paddingInlineEnd' : 'paddingBottom';
      var el = controller.el;

      /* Mid-recapture: the element has just been stripped back to its own
         padding and must be left that way until the next frame. */
      if (recapturing) return;

      if (!(axis in controller.base)) {
        /* Safe: nothing of ours is on the element at this point, either
           because it has never been written to or because the frame before
           this one took it off. */
        controller.base[axis] = parseFloat(window.getComputedStyle(el)[property]) || 0;
      }

      if (!wanted) { restore(controller, axis); return; }

      el.style[property] = (controller.base[axis] + controller.size) + 'px';
      /* Read back rather than kept, because the CSSOM normalises what it
         stores and restore() has to match it exactly. */
      controller.written[axis] = el.style[property];
    }

    /* Every ancestor that clips, so that a scroller scrolled out of view
       inside another scroller takes its bar with it instead of leaving it
       floating over whatever occupies that spot now. */
    function clipAncestors(el) {
      var list = [];
      var node = el.parentElement;
      while (node && node !== document.documentElement) {
        var style = window.getComputedStyle(node);
        if (style.overflowX !== 'visible' || style.overflowY !== 'visible') list.push(node);
        node = node.parentElement;
      }
      return list;
    }

    function measure(controller, style) {
      var el = controller.el;
      style = style || window.getComputedStyle(el);

      controller.rtl = style.direction === 'rtl';
      controller.border = {
        top:    parseFloat(style.borderTopWidth) || 0,
        right:  parseFloat(style.borderRightWidth) || 0,
        bottom: parseFloat(style.borderBottomWidth) || 0,
        left:   parseFloat(style.borderLeftWidth) || 0
      };
      /* Read from the tokens rather than hard-coded, so retuning the bar is a
         custom property edit and nothing else. */
      controller.size = parseFloat(style.getPropertyValue('--scrollbar-size')) || 10;
      controller.minThumb = parseFloat(style.getPropertyValue('--scrollbar-min-thumb')) || 28;
      controller.declared = declaredAxes(style);

      /* A viewport change is what moves a breakpoint, and so the authored
         padding. Drop the cache, hand the element its own padding back, and
         come again next frame to read it cleanly. */
      var recapturing = controller.baseWidth !== window.innerWidth;
      if (recapturing) {
        restore(controller, 'y');
        restore(controller, 'x');
        controller.base = {};
        controller.baseWidth = window.innerWidth;
      }

      var live = liveAxes(controller);
      reserve(controller, 'y', live.y, recapturing);
      reserve(controller, 'x', live.x, recapturing);
      if (recapturing) scheduleMeasure();
      /* Reserving just changed the content box, so what overflows has to be
         asked again before anything is sized to it. */
      controller.live = liveAxes(controller);
      controller.clips = clipAncestors(el);
    }

    /* ----------------------------------------------------------- geometry */
    /* The scroller's padding box, in viewport coordinates. */
    function paddingBox(controller) {
      var root = document.documentElement;
      if (controller.page) {
        /* The root's padding box is the whole page, not the window, so the
           page's bar is placed from the viewport instead. clientWidth and
           clientHeight on the root element report exactly that. */
        return { top: 0, left: 0, right: root.clientWidth, bottom: root.clientHeight };
      }
      var rect = controller.el.getBoundingClientRect();
      var border = controller.border;
      return {
        top:    rect.top + border.top,
        left:   rect.left + border.left,
        right:  rect.right - border.right,
        bottom: rect.bottom - border.bottom
      };
    }

    function intersect(a, b) {
      var rect = {
        top:    Math.max(a.top, b.top),
        left:   Math.max(a.left, b.left),
        right:  Math.min(a.right, b.right),
        bottom: Math.min(a.bottom, b.bottom)
      };
      if (rect.right <= rect.left || rect.bottom <= rect.top) return null;
      return rect;
    }

    /* What of the bar is actually on screen. The bar keeps its full geometry
       either way — the thumb's travel is measured against the whole track —
       and the part outside is taken off with a clip, so a half-visible nested
       scroller shows half a bar rather than a bar hanging out of its parent. */
    function visibleRect(controller, box) {
      var root = document.documentElement;
      var rect = intersect(box, { top: 0, left: 0, right: root.clientWidth, bottom: root.clientHeight });
      for (var i = 0; rect && i < controller.clips.length; i++) {
        rect = intersect(rect, controller.clips[i].getBoundingClientRect());
      }
      return rect;
    }

    function clipTo(node, box, visible) {
      if (visible.top - box.top < .5 && box.right - visible.right < .5 &&
          box.bottom - visible.bottom < .5 && visible.left - box.left < .5) {
        if (node.style.clipPath) node.style.clipPath = '';
        return;
      }
      node.style.clipPath = 'inset(' +
        Math.max(0, visible.top - box.top) + 'px ' +
        Math.max(0, box.right - visible.right) + 'px ' +
        Math.max(0, box.bottom - visible.bottom) + 'px ' +
        Math.max(0, visible.left - box.left) + 'px)';
    }

    /* --------------------------------------------------------------- draw */
    /* A scroller taken out of the document takes its bars with it. Without
       this the controller would keep being drawn against a detached element
       forever, and its bars would be left behind in <body> as orphans. */
    function release(controller) {
      Object.keys(controller.bars).forEach(function (axis) {
        var node = controller.bars[axis].node;
        if (node.parentNode) node.parentNode.removeChild(node);
      });
      controller.bars = {};
      /* Hand the element back its own padding. It may be detached now, but a
         detached node is very often one that is about to go back in. */
      ['y', 'x'].forEach(function (axis) {
        if (axis in controller.authored) restore(controller, axis);
      });
      /* And let it be claimed again if it comes back. */
      delete controller.el.dataset.boundScrollbar;
      if (resize) resize.unobserve(controller.el);
      var index = controllers.indexOf(controller);
      if (index > -1) controllers.splice(index, 1);
    }

    /* A scroller can be laid out and still not painted. A closed popover in
       this kit is visibility:hidden and opacity:0 with its box left in place,
       so the time columns inside it keep a real rect at a real place on the
       page — and the bar, which lives in <body> rather than inside the
       popover, is not hidden along with it. Nothing in the geometry pass can
       tell the difference, so it has to ask. */
    function painted(el) {
      if (el.checkVisibility) {
        return el.checkVisibility({
          visibilityProperty: true,
          opacityProperty: true,
          contentVisibilityAuto: true
        });
      }
      /* visibility inherits, so the element's own computed value already
         answers for its ancestors; opacity does not, and is the part this
         fallback cannot see. */
      return window.getComputedStyle(el).visibility !== 'hidden';
    }

    function hideBars(controller) {
      Object.keys(controller.bars).forEach(function (axis) {
        controller.bars[axis].node.hidden = true;
      });
    }

    function draw(controller) {
      var el = controller.el;
      if (!el.isConnected) { release(controller); return; }
      if (!painted(el)) { hideBars(controller); return; }
      var live = liveAxes(controller);
      /* An axis that started or stopped overflowing needs its gutter put in
         or taken out, which is measure()'s job, not this pass's. */
      if (live.y !== controller.live.y || live.x !== controller.live.x) {
        measure(controller);
        live = controller.live;
      }

      var box = paddingBox(controller);
      var visible = visibleRect(controller, box);

      ['y', 'x'].forEach(function (axis) {
        var record = controller.bars[axis];
        if (!live[axis] || !visible) {
          if (record) record.node.hidden = true;
          return;
        }
        record = record || createBar(controller, axis);
        if (!geometry(controller, record, live, box)) {
          record.node.hidden = true;
          return;
        }
        record.node.hidden = false;
        clipTo(record.node, box, visible);
      });
    }

    function geometry(controller, record, live, box) {
      var el = controller.el;
      var vertical = record.axis === 'y';
      var size = controller.size;
      var node = record.node;

      var client = vertical ? el.clientHeight : el.clientWidth;
      var scroll = vertical ? el.scrollHeight : el.scrollWidth;
      var max = scroll - client;
      if (max <= 0) return false;

      /* The track stops short of the other bar when both are out, so the two
         never meet in the corner. */
      var track = (vertical ? box.bottom - box.top : box.right - box.left) -
                  (live[vertical ? 'x' : 'y'] ? size : 0);
      var thumb = Math.max(controller.minThumb, Math.round(track * (client / scroll)));
      if (thumb >= track) return false;
      var travel = track - thumb;

      var offset = vertical ? el.scrollTop : el.scrollLeft;
      /* Right to left, scrollLeft runs from -max at the far left to 0 at the
         start of the text, so it has to be shifted into 0..max before it can
         drive a thumb that is positioned from the physical left. */
      var progress = (!vertical && controller.rtl ? offset + max : offset) / max;
      progress = Math.min(1, Math.max(0, progress));

      /* Kept for the drag, which needs to turn pointer travel into scroll
         offset without measuring anything again. */
      record.metrics = { max: max, travel: travel };

      if (vertical) {
        node.style.top = box.top + 'px';
        node.style.height = track + 'px';
        node.style.width = size + 'px';
        /* The inline end of the box, which is the left-hand side when the
           text runs right to left — exactly where the native bar would be. */
        node.style.left = (controller.rtl ? box.left : box.right - size) + 'px';
        record.thumb.style.top = Math.round(travel * progress) + 'px';
        record.thumb.style.height = thumb + 'px';
      } else {
        /* The horizontal bar is at the block end whichever way the text runs;
           it is only its start that the vertical bar pushes along. */
        node.style.top = (box.bottom - size) + 'px';
        node.style.height = size + 'px';
        node.style.width = track + 'px';
        node.style.left = (controller.rtl && live.y ? box.left + size : box.left) + 'px';
        record.thumb.style.left = Math.round(travel * progress) + 'px';
        record.thumb.style.width = thumb + 'px';
      }
      return true;
    }

    /* ---------------------------------------------------------- the bars */
    function hostFor(controller) {
      var node = controller.page ? null : controller.el.parentElement;
      while (node && node !== document.body) {
        if (node.matches && node.matches(SURFACES)) {
          var style = window.getComputedStyle(node);
          if (style.overflowX === 'visible' && style.overflowY === 'visible') return node;
        }
        node = node.parentElement;
      }
      return document.body;
    }

    /* Hosting the bar inside a surface is usually enough to get it over that
       surface's content. When the scroller IS the surface — a menu long
       enough to scroll — the bar is hosted a level further out and has to be
       told to match the z-index it is now sitting beside. Appended last, it
       wins the tie. */
    function liftZIndex(controller, node, host) {
      var highest = 0;
      var walker = controller.el;
      while (walker && walker !== host && walker !== document.documentElement) {
        var style = window.getComputedStyle(walker);
        if (style.position !== 'static') {
          var value = parseInt(style.zIndex, 10);
          if (value > highest) highest = value;
        }
        walker = walker.parentElement;
      }
      if (highest > 0) node.style.zIndex = String(highest);
    }

    function createBar(controller, axis) {
      var node = document.createElement('div');
      node.className = 'scrollbar scrollbar-' + axis + (controller.page ? ' scrollbar-page' : '');
      /* A picture of a scroll position. Assistive technology reports the
         position of a real scroller properly on its own, and announcing this
         as well would be reporting it twice. */
      node.setAttribute('aria-hidden', 'true');

      var thumb = document.createElement('div');
      thumb.className = 'scrollbar-thumb';
      node.appendChild(thumb);

      var record = { node: node, thumb: thumb, axis: axis, drag: null, metrics: null };
      controller.bars[axis] = record;
      bindBar(controller, record);

      var host = hostFor(controller);
      if (!controller.page) liftZIndex(controller, node, host);
      host.appendChild(node);
      return record;
    }

    function setOffset(controller, axis, value) {
      var options = { behavior: 'instant' };
      if (axis === 'y') options.top = value; else options.left = value;
      /* instant, never the root's smooth: a drag that eases toward where the
         thumb used to be lags a whole curve behind the pointer. */
      controller.el.scrollTo(options);
    }

    function bindBar(controller, record) {
      var node = record.node;
      var thumb = record.thumb;
      var vertical = record.axis === 'y';

      on(thumb, 'pointerdown', function (event) {
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        if (!record.metrics) return;
        /* Stops the press starting a selection in the text beside the bar,
           and stops a touch being handed to the page as a pan. */
        event.preventDefault();
        record.drag = {
          pointer: vertical ? event.clientY : event.clientX,
          offset: vertical ? controller.el.scrollTop : controller.el.scrollLeft,
          scale: record.metrics.travel > 0 ? record.metrics.max / record.metrics.travel : 0
        };
        node.classList.add('is-dragging');
        document.body.classList.add('is-scrollbar-dragging');
        thumb.setPointerCapture(event.pointerId);
      });

      on(thumb, 'pointermove', function (event) {
        if (!record.drag) return;
        var moved = (vertical ? event.clientY : event.clientX) - record.drag.pointer;
        /* No sign flip for right to left: scrollLeft is negative there, so it
           still rises as the thumb travels to the physical right. */
        setOffset(controller, record.axis, record.drag.offset + moved * record.drag.scale);
      });

      function end(event) {
        if (!record.drag) return;
        record.drag = null;
        node.classList.remove('is-dragging');
        document.body.classList.remove('is-scrollbar-dragging');
        if (thumb.hasPointerCapture(event.pointerId)) thumb.releasePointerCapture(event.pointerId);
      }
      on(thumb, 'pointerup', end);
      on(thumb, 'pointercancel', end);

      /* The track pages, the way a native track does — one screenful toward
         the pointer, rather than jumping to wherever it landed. A misplaced
         click then costs a screen and not your place in the document. */
      on(node, 'pointerdown', function (event) {
        if (event.target === thumb || record.drag) return;
        if (event.button !== 0 && event.pointerType === 'mouse') return;
        event.preventDefault();
        var rect = thumb.getBoundingClientRect();
        var forward = vertical ? event.clientY > rect.bottom : event.clientX > rect.right;
        var screen = vertical ? controller.el.clientHeight : controller.el.clientWidth;
        var step = forward ? screen : -screen;
        controller.el.scrollBy({
          top: vertical ? step : 0,
          left: vertical ? 0 : step,
          behavior: prefersReducedMotion() ? 'instant' : 'smooth'
        });
      });
    }

    /* -------------------------------------------------------- scheduling */
    function scheduleDraw() {
      if (drawFrame) return;
      drawFrame = window.requestAnimationFrame(function () {
        drawFrame = 0;
        /* A copy, because draw() may release a controller and splice it out
           of the list it is iterating. */
        controllers.slice().forEach(function (controller) {
          if (controller.broken) return;
          try {
            draw(controller);
          } catch (error) {
            /* Once, not sixty times a second, and the rest of the bars on the
               page keep working. */
            controller.broken = true;
            console.error('[design-language] scrollbar failed', controller.el, error);
          }
        });
      });
    }

    function scheduleMeasure() {
      if (measureFrame) return;
      measureFrame = window.requestAnimationFrame(function () {
        measureFrame = 0;
        controllers.slice().forEach(function (controller) {
          if (controller.broken) return;
          if (!controller.el.isConnected) { release(controller); return; }
          try { measure(controller); } catch (error) { controller.broken = true; }
        });
        scheduleDraw();
      });
    }

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = window.setTimeout(function () {
        scanTimer = 0;
        refresh();
      }, 150);
    }

    var resize = null;
    var mutations = null;

    function attach(el, style) {
      if (!claim(el, 'Scrollbar')) return;
      var controller = {
        el: el,
        page: el === (document.scrollingElement || document.documentElement),
        bars: {},
        live: { y: false, x: false },
        declared: { y: false, x: false },
        clips: [],
        /* What the style attribute held before this touched it, what this
           last wrote there, and the authored padding in px with nothing of
           ours in it. See reserve(). */
        authored: {},
        written: {},
        base: {},
        baseWidth: -1,
        size: 10,
        minThumb: 28,
        broken: false
      };
      controllers.push(controller);
      measure(controller, style);
      if (resize) resize.observe(el);
      scheduleDraw();
    }

    function start() {
      if (started) return;
      started = true;

      /* One listener for every scroller on the page. scroll does not bubble,
         but it is still dispatched through the capture phase, so the document
         hears all of them — including its own. */
      on(document, 'scroll', scheduleDraw, { capture: true, passive: true });
      on(window, 'resize', function () { scheduleMeasure(); }, { passive: true });

      if (window.ResizeObserver) {
        resize = new window.ResizeObserver(scheduleMeasure);
      }
      if (window.MutationObserver) {
        /* Content arriving or leaving changes what overflows, and may be a
           scroller that did not exist at init. Debounced, because this fires
           for every insertion anywhere on the page. */
        mutations = new window.MutationObserver(function (records) {
          /* An attribute change moves no content, so it needs the next frame
             rather than the debounce: data-open is how every surface in the
             kit is shown and hidden, and a scroller inside one that has just
             opened would otherwise wait 150ms for its bar. */
          for (var i = 0; i < records.length; i++) {
            if (records[i].type === 'attributes') { scheduleDraw(); break; }
          }
          scheduleScan();
        });
        /* dir is watched as well as content, because which edge the bar
           belongs on is a question of direction, and the kit lets a page or a
           single component be flipped at runtime. data-open is watched
           because a surface that opens paints scrollers that were laid out
           but invisible, which no scroll or resize reports. Those two and
           nothing else: style would fire on the bars' own placement writes,
           sixty times a second, and class flips on every hover in the kit. */
        mutations.observe(document.documentElement, {
          childList: true, subtree: true,
          attributes: true, attributeFilter: ['dir', 'data-open']
        });
      }

      /* A web font landing re-wraps text and so changes nearly every
         scrollHeight on the page. */
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(refresh);
      }
      on(window, 'load', refresh);
    }

    function refresh() {
      scan(document);
      scheduleMeasure();
    }

    return {
      init: function (root) { start(); scan(root); },
      refresh: refresh
    };
  })();

  var BEHAVIORS = {

    /* Press feedback — nothing to wire up.

       This used to inject an expanding ink disc positioned from the pointer.
       The current design language answers a press with an instant step up the
       same fill ladder hover uses (:active in the stylesheet), which needs no
       element, no timer and no pointer coordinates, and which cannot be
       caught mid-animation by a click that navigates away.

       The behavior is kept as a named no-op rather than deleted: it is part
       of the init pass's published list, pages and tests refer to it, and a
       missing key would be a silent failure rather than an obvious one. */
    press: function () {},

    /* data-theme-toggle on any button flips light / dark. */
    theme: function (root) {
      $$('[data-theme-toggle]', root).forEach(function (el) {
        if (!claim(el, 'Theme')) return;
        on(el, 'click', Theme.toggle);
      });
    },

    /* data-drawer-open="id" / data-drawer-close pair with a .drawer and the
       shared .scrim. Escape and a scrim click both close. */
    drawer: function (root) {
      $$('[data-drawer-open]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Drawer')) return;
        on(trigger, 'click', function () {
          openDrawer(document.getElementById(trigger.getAttribute('data-drawer-open')));
        });
      });
      $$('[data-drawer-close]', root).forEach(function (trigger) {
        if (!claim(trigger, 'DrawerClose')) return;
        on(trigger, 'click', function () { closeDrawer(trigger.closest('.drawer')); });
      });
    },

    /* A tab list whose panels are matched by aria-controls. The underline
       indicator is positioned from the active tab's box. */
    tabs: function (root) {
      $$('[data-tabs]', root).forEach(function (group) {
        if (!claim(group, 'Tabs')) return;
        var list = $('.tabs', group) || group;
        var tabs = $$('.tab', list);
        if (!tabs.length) return;

        var indicator = $('.tabs-indicator', list);
        if (!indicator) {
          indicator = document.createElement('span');
          indicator.className = 'tabs-indicator';
          list.appendChild(indicator);
        }

        function moveIndicator(tab) {
          indicator.style.width = tab.offsetWidth + 'px';
          indicator.style.transform = 'translateX(' + tab.offsetLeft + 'px)';
        }

        function select(tab) {
          tabs.forEach(function (other) {
            var active = other === tab;
            other.setAttribute('aria-selected', String(active));
            other.tabIndex = active ? 0 : -1;
            var panelId = other.getAttribute('aria-controls');
            var panel = panelId && document.getElementById(panelId);
            if (panel) panel.hidden = !active;
          });
          moveIndicator(tab);
        }

        tabs.forEach(function (tab, index) {
          tab.setAttribute('role', 'tab');
          on(tab, 'click', function () { select(tab); });
          /* Arrow keys move between tabs, matching the tablist pattern. In a
             right-to-left list the keys swap, since the next tab is left. */
          on(tab, 'keydown', function (event) {
            var step = inlineStep(event, list);
            if (!step) return;
            event.preventDefault();
            var next = tabs[(index + step + tabs.length) % tabs.length];
            next.focus();
            select(next);
          });
        });

        list.setAttribute('role', 'tablist');
        var initial = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0] || tabs[0];
        select(initial);
        /* Fonts and layout settle after first paint; re-measure then. */
        window.requestAnimationFrame(function () { moveIndicator(initial); });
        on(window, 'resize', function () {
          var current = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0];
          if (current) moveIndicator(current);
        });
      });
    },

    /* data-menu="id" anchors a .menu to its trigger; outside click or Escape
       dismisses, and only one menu is open at a time. */
    menu: function (root) {
      $$('[data-menu]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Menu')) return;
        var menu = document.getElementById(trigger.getAttribute('data-menu'));
        if (!menu) return;

        trigger.setAttribute('aria-haspopup', 'true');
        trigger.setAttribute('aria-expanded', 'false');

        on(trigger, 'click', function (event) {
          event.stopPropagation();
          var open = menu.dataset.open === 'true';
          closeAllMenus();
          if (!open) {
            menu.dataset.open = 'true';
            trigger.setAttribute('aria-expanded', 'true');
            var first = $('.menu-item', menu);
            if (first) first.focus();
          }
        });

        /* Clicking an item is always a dismissal, whatever else it does. */
        $$('.menu-item', menu).forEach(function (item) {
          on(item, 'click', function () { closeAllMenus(); });
        });
      });
    },

    /* Opens and closes native <dialog> elements by id. */
    dialog: function (root) {
      $$('[data-dialog-open]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Dialog')) return;
        on(trigger, 'click', function () {
          openDialog(trigger.getAttribute('data-dialog-open'));
        });
      });
      $$('[data-dialog-close]', root).forEach(function (trigger) {
        if (!claim(trigger, 'DialogClose')) return;
        on(trigger, 'click', function () {
          var dialog = trigger.closest('dialog');
          if (dialog) dialog.close(trigger.getAttribute('data-dialog-close') || 'dismiss');
        });
      });
      /* A click on the backdrop lands on the dialog element itself. */
      $$('dialog.dialog', root).forEach(function (dialog) {
        if (!claim(dialog, 'DialogLight')) return;
        on(dialog, 'click', function (event) {
          if (event.target === dialog) dialog.close('dismiss');
        });
      });
    },

    /* data-sheet-open="id" shows a bottom or side sheet over the scrim. */
    sheet: function (root) {
      $$('[data-sheet-open]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Sheet')) return;
        on(trigger, 'click', function () {
          openSheet(document.getElementById(trigger.getAttribute('data-sheet-open')));
        });
      });
      $$('[data-sheet-close]', root).forEach(function (trigger) {
        if (!claim(trigger, 'SheetClose')) return;
        on(trigger, 'click', function () { closeSheet(trigger.closest('.sheet')); });
      });
    },

    /* data-toast on a button fires a demo message. */
    toast: function (root) {
      $$('[data-toast]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Toast')) return;
        on(trigger, 'click', function () {
          toast(trigger.getAttribute('data-toast'), {
            action: trigger.getAttribute('data-toast-action') || undefined,
            variant: trigger.getAttribute('data-toast-variant') || undefined
          });
        });
      });
    },

    /* Mirrors a range input's value into [data-slider-output="id"]. */
    slider: function (root) {
      $$('input[type="range"].slider', root).forEach(function (input) {
        if (!claim(input, 'Slider')) return;
        var output = input.id && $('[data-slider-output="' + input.id + '"]', document);
        if (!output) return;
        var suffix = output.getAttribute('data-suffix') || '';
        function sync() { output.textContent = input.value + suffix; }
        on(input, 'input', sync);
        sync();
      });
    },

    /* Keeps a textarea exactly as tall as its content. */
    autosize: function (root) {
      $$('.textarea-auto', root).forEach(function (area) {
        if (!claim(area, 'Autosize')) return;
        function resize() {
          area.style.height = 'auto';
          area.style.height = area.scrollHeight + 'px';
        }
        on(area, 'input', resize);
        resize();
      });
    },

    /* Live "n / max" counter for any field with a maxlength. */
    counter: function (root) {
      $$('[data-counter]', root).forEach(function (input) {
        if (!claim(input, 'Counter')) return;
        var output = document.getElementById(input.getAttribute('data-counter'));
        if (!output) return;
        var max = input.getAttribute('maxlength');
        function sync() { output.textContent = input.value.length + (max ? ' / ' + max : ''); }
        on(input, 'input', sync);
        sync();
      });
    },

    /* A styled drop target wrapping a hidden file input. */
    fileDrop: function (root) {
      $$('.file-drop', root).forEach(function (zone) {
        if (!claim(zone, 'FileDrop')) return;
        var input = $('input[type="file"]', zone) || document.getElementById(zone.getAttribute('data-file-input'));
        var list = zone.getAttribute('data-file-list') && document.getElementById(zone.getAttribute('data-file-list'));

        function render(files) {
          if (!list) return;
          list.innerHTML = '';
          Array.prototype.forEach.call(files, function (file) {
            var row = document.createElement('div');
            row.className = 'file-item';
            row.innerHTML =
              '<span class="icon icon-sm">description</span>' +
              '<span class="grow text-truncate"></span>' +
              '<span class="text-caption text-muted"></span>';
            row.children[1].textContent = file.name;
            row.children[2].textContent = Math.max(1, Math.round(file.size / 1024)) + ' KB';
            list.appendChild(row);
          });
        }

        on(zone, 'click', function () { if (input) input.click(); });
        if (input) on(input, 'change', function () { render(input.files); });

        ['dragenter', 'dragover'].forEach(function (type) {
          on(zone, type, function (event) {
            event.preventDefault();
            zone.classList.add('is-dragover');
          });
        });
        ['dragleave', 'drop'].forEach(function (type) {
          on(zone, type, function (event) {
            event.preventDefault();
            zone.classList.remove('is-dragover');
          });
        });
        on(zone, 'drop', function (event) {
          if (event.dataTransfer) render(event.dataTransfer.files);
        });
      });
    },

    /* Copies the text of the nearest code block to the clipboard. */
    copy: function (root) {
      $$('[data-copy]', root).forEach(function (button) {
        if (!claim(button, 'Copy')) return;
        on(button, 'click', function () {
          var target = document.getElementById(button.getAttribute('data-copy'))
            || button.closest('.code-block');
          if (!target) return;
          var text = (target.querySelector('code') || target).textContent.trim();
          /* The async clipboard API is unavailable on file:// in some
             browsers, so fall back to a throwaway textarea. */
          var done = function () { toast('Copied to clipboard'); };
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done, legacyCopy);
          } else {
            legacyCopy();
          }
          function legacyCopy() {
            var scratch = document.createElement('textarea');
            scratch.value = text;
            scratch.setAttribute('readonly', '');
            scratch.style.position = 'fixed';
            scratch.style.opacity = '0';
            document.body.appendChild(scratch);
            scratch.select();
            try { document.execCommand('copy'); done(); } catch (e) {}
            scratch.remove();
          }
        });
      });
    },

    /* Click-to-sort columns. Cells may carry data-sort-value to sort by
       something other than their visible text. */
    tableSort: function (root) {
      $$('[data-sortable]', root).forEach(function (table) {
        if (!claim(table, 'Sort')) return;
        var body = $('tbody', table);
        if (!body) return;

        $$('thead th', table).forEach(function (header, index) {
          var button = $('.table-sort', header);
          if (!button) return;
          on(button, 'click', function () {
            var ascending = header.getAttribute('aria-sort') !== 'ascending';
            $$('thead th', table).forEach(function (other) { other.removeAttribute('aria-sort'); });
            header.setAttribute('aria-sort', ascending ? 'ascending' : 'descending');

            var rows = $$('tr', body);
            rows.sort(function (a, b) {
              var left = cellValue(a, index);
              var right = cellValue(b, index);
              var numeric = parseFloat(String(left).replace(/[^0-9.-]/g, ''));
              var otherNumeric = parseFloat(String(right).replace(/[^0-9.-]/g, ''));
              var result = (!isNaN(numeric) && !isNaN(otherNumeric))
                ? numeric - otherNumeric
                : String(left).localeCompare(String(right));
              return ascending ? result : -result;
            });
            rows.forEach(function (row) { body.appendChild(row); });
          });
        });

        function cellValue(row, index) {
          var cell = row.children[index];
          if (!cell) return '';
          return cell.getAttribute('data-sort-value') || cell.textContent.trim();
        }
      });
    },

    /* A header checkbox that drives, and reflects, every row checkbox. */
    tableSelect: function (root) {
      $$('[data-select-all]', root).forEach(function (master) {
        if (!claim(master, 'SelectAll')) return;
        var table = master.closest('table');
        if (!table) return;
        var boxes = $$('tbody input[type="checkbox"]', table);

        on(master, 'change', function () {
          boxes.forEach(function (box) {
            box.checked = master.checked;
            box.closest('tr').classList.toggle('is-selected', master.checked);
          });
          master.indeterminate = false;
        });

        boxes.forEach(function (box) {
          on(box, 'change', function () {
            box.closest('tr').classList.toggle('is-selected', box.checked);
            var checked = boxes.filter(function (b) { return b.checked; }).length;
            master.checked = checked === boxes.length;
            master.indeterminate = checked > 0 && checked < boxes.length;
          });
        });
      });
    },

    /* Slide carousel with dots, arrows and arrow-key support. */
    carousel: function (root) {
      $$('[data-carousel]', root).forEach(function (carousel) {
        if (!claim(carousel, 'Carousel')) return;
        var track = $('.carousel-track', carousel);
        var slides = $$('.carousel-slide', carousel);
        var dots = $$('.carousel-dot', carousel);
        if (!track || !slides.length) return;
        var index = 0;

        function go(next) {
          index = (next + slides.length) % slides.length;
          track.style.transform = 'translateX(' + (-index * 100) + '%)';
          dots.forEach(function (dot, i) {
            dot.classList.toggle('is-active', i === index);
            dot.setAttribute('aria-current', String(i === index));
          });
          slides.forEach(function (slide, i) {
            slide.setAttribute('aria-hidden', String(i !== index));
          });
        }

        var prev = $('.carousel-prev', carousel);
        var next = $('.carousel-next', carousel);
        if (prev) on(prev, 'click', function () { go(index - 1); });
        if (next) on(next, 'click', function () { go(index + 1); });
        dots.forEach(function (dot, i) { on(dot, 'click', function () { go(i); }); });

        carousel.tabIndex = 0;
        on(carousel, 'keydown', function (event) {
          var step = inlineStep(event, carousel);
          if (!step) return;
          event.preventDefault();
          go(index + step);
        });

        go(0);
      });
    },

    /* Steps through a .stepper, revealing one panel at a time. */
    stepper: function (root) {
      $$('[data-stepper]', root).forEach(function (wrapper) {
        if (!claim(wrapper, 'Stepper')) return;
        var steps = $$('.step', wrapper);
        var panels = $$('[data-step-panel]', wrapper);
        var current = 0;

        function render() {
          steps.forEach(function (step, i) {
            step.classList.toggle('is-active', i === current);
            step.classList.toggle('is-complete', i < current);
            var marker = $('.step-marker', step);
            if (marker) marker.textContent = i < current ? 'check' : String(i + 1);
            if (marker) marker.classList.toggle('icon', i < current);
          });
          panels.forEach(function (panel, i) { panel.hidden = i !== current; });
          $$('[data-step-prev]', wrapper).forEach(function (b) { b.disabled = current === 0; });
          $$('[data-step-next]', wrapper).forEach(function (b) { b.disabled = current === panels.length - 1; });
        }

        $$('[data-step-next]', wrapper).forEach(function (b) {
          on(b, 'click', function () { if (current < panels.length - 1) { current++; render(); } });
        });
        $$('[data-step-prev]', wrapper).forEach(function (b) {
          on(b, 'click', function () { if (current > 0) { current--; render(); } });
        });
        steps.forEach(function (step, i) {
          on(step, 'click', function () { current = i; render(); });
        });

        render();
      });
    },

    /* Draws a determinate ring from data-value (0-100). */
    progressRing: function (root) {
      $$('[data-progress-ring]', root).forEach(function (svg) {
        if (!claim(svg, 'Ring')) return;
        var bar = $('.progress-circle-bar', svg);
        if (!bar) return;
        var radius = Number(bar.getAttribute('r'));
        var circumference = 2 * Math.PI * radius;
        var value = Number(svg.getAttribute('data-progress-ring')) || 0;
        bar.style.strokeDasharray = circumference + ' ' + circumference;
        bar.style.strokeDashoffset = String(circumference * (1 - value / 100));
      });
    },

    /* Dismisses the closest element matching data-dismiss. */
    dismiss: function (root) {
      $$('[data-dismiss]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Dismiss')) return;
        on(trigger, 'click', function () {
          var target = trigger.closest(trigger.getAttribute('data-dismiss'));
          if (target) target.remove();
        });
      });
    },

    /* Toggles aria-pressed, for icon buttons that act as switches. */
    pressable: function (root) {
      $$('[data-toggle-pressed]', root).forEach(function (button) {
        if (!claim(button, 'Pressed')) return;
        on(button, 'click', function () {
          var pressed = button.getAttribute('aria-pressed') === 'true';
          button.setAttribute('aria-pressed', String(!pressed));
          button.classList.toggle('is-active', !pressed);
          var swap = button.getAttribute('data-icon-toggle');
          var icon = $('.icon', button);
          if (swap && icon) {
            var pair = swap.split('|');
            icon.textContent = pressed ? pair[0] : pair[1];
          }
        });
      });
    },

    /* Single-select behavior for a segmented control. */
    segmented: function (root) {
      $$('.segmented', root).forEach(function (group) {
        if (!claim(group, 'Segmented')) return;
        var buttons = $$('.button', group);
        buttons.forEach(function (button) {
          on(button, 'click', function () {
            buttons.forEach(function (other) {
              other.setAttribute('aria-pressed', String(other === button));
            });
          });
        });
      });
    },

    /* Adds a shadow to a sticky bar once the page scrolls past the top. */
    stickyBar: function (root) {
      $$('.topbar-dynamic', root).forEach(function (bar) {
        if (!claim(bar, 'Sticky')) return;
        function update() { bar.classList.toggle('is-stuck', window.scrollY > 4); }
        on(window, 'scroll', update, { passive: true });
        update();
      });
    },

    /* Highlights the table-of-contents entry for the section in view. */
    scrollSpy: function (root) {
      $$('[data-scrollspy]', root).forEach(function (nav) {
        if (!claim(nav, 'Spy')) return;
        var links = $$('a[href^="#"]', nav);
        var targets = links
          .map(function (link) { return document.getElementById(link.hash.slice(1)); })
          .filter(Boolean);
        if (!targets.length) return;

        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            links.forEach(function (link) {
              link.classList.toggle('is-active', link.hash === '#' + entry.target.id);
            });
          });
        }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

        targets.forEach(function (target) { observer.observe(target); });
      });
    },

    /* Fills [data-site-nav] with a link per manifest entry, marking the
       current page. */
    siteNav: function (root) {
      $$('[data-site-nav]', root).forEach(function (container) {
        if (!claim(container, 'SiteNav')) return;
        var here = currentPage();
        container.innerHTML = '';
        PAGES.forEach(function (page) {
          var link = document.createElement('a');
          link.className = 'nav-item';
          link.href = page.href;
          if (page.href === here) link.setAttribute('aria-current', 'page');
          link.innerHTML = '<span class="icon"></span><span></span>';
          link.children[0].textContent = page.icon;
          link.children[1].textContent = page.title;
          container.appendChild(link);
        });
      });
    },

    /* Fills [data-site-index] with a card per manifest entry. */
    siteIndex: function (root) {
      $$('[data-site-index]', root).forEach(function (container) {
        if (!claim(container, 'SiteIndex')) return;
        container.innerHTML = '';
        PAGES.filter(function (page) { return page.href !== 'index.html'; })
          .forEach(function (page) {
            var card = document.createElement('a');
            card.className = 'index-card';
            card.href = page.href;
            card.innerHTML =
              '<span class="icon icon-lg"></span>' +
              '<span class="text-heading-3"></span>' +
              '<span class="text-body-2 text-muted"></span>' +
              '<span class="index-card-count link-arrow">Open<span class="icon icon-sm">arrow_forward</span></span>';
            card.children[0].textContent = page.icon;
            card.children[1].textContent = page.title;
            card.children[2].textContent = page.blurb;
            container.appendChild(card);
          });
      });
    },

    /* Builds the previous / next links at the foot of each page. */
    pager: function (root) {
      $$('[data-pager]', root).forEach(function (container) {
        if (!claim(container, 'Pager')) return;
        var here = currentPage();
        var index = PAGES.findIndex(function (page) { return page.href === here; });
        if (index < 0) return;
        container.innerHTML = '';
        add(PAGES[index - 1], 'Previous', 'pager-prev');
        add(PAGES[index + 1], 'Next', 'pager-next');

        function add(page, label, modifier) {
          if (!page) {
            /* Keep the surviving link on its own side of the row. */
            var filler = document.createElement('span');
            filler.className = 'grow';
            container.appendChild(filler);
            return;
          }
          var link = document.createElement('a');
          link.className = 'pager-link ' + modifier;
          link.href = page.href;
          link.innerHTML = '<span class="text-caption text-muted"></span><span class="text-subtitle"></span>';
          link.children[0].textContent = label;
          link.children[1].textContent = page.title;
          container.appendChild(link);
        }
      });
    }
,

    /* data-popover="id" toggles an anchored .popover. Interactive, unlike a
       tooltip, and not limited to actions, unlike a menu. */
    popover: function (root) {
      $$('[data-popover]', root).forEach(function (trigger) {
        if (!claim(trigger, 'Popover')) return;
        var pop = document.getElementById(trigger.getAttribute('data-popover'));
        if (!pop) return;

        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', String(pop.dataset.open === 'true'));
        if (!pop.hasAttribute('role')) pop.setAttribute('role', 'dialog');

        on(trigger, 'click', function (event) {
          event.stopPropagation();
          if (pop.dataset.open === 'true') closePopover(pop);
          else openPopover(pop);
        });

        /* Placed once at wire-up as well as on open. A closed popover is
           hidden but still occupies layout, so one hanging off the edge of a
           narrow screen widens the page before anybody opens it. */
        placePopover(pop);
      });

      /* A click inside must not reach the document handler that closes it. */
      $$('.popover', root).forEach(function (pop) {
        if (!claim(pop, 'PopoverInside')) return;
        on(pop, 'click', function (event) { event.stopPropagation(); });
      });

      $$('[data-popover-close]', root).forEach(function (trigger) {
        if (!claim(trigger, 'PopoverClose')) return;
        on(trigger, 'click', function () { closePopover(trigger.closest('.popover')); });
      });
    },

    /* A text input that filters an attached listbox. The input keeps real
       focus the whole time; the highlighted option is published through
       aria-activedescendant, which is what lets a screen reader follow the
       arrow keys without focus ever leaving the field. */
    /* ============================================= native picker upgrade */
    /* data-picker on a native date / time / datetime-local / month / number /
       color input replaces the browser's own picker with the kit's.

       WHY THIS IS THE DEFAULT. Those seven input types are the only controls
       on a page whose panel no token can reach: the spinner on a number
       field, the calendar behind a date field, the clock behind a time one
       and the operating system's color dialog are all drawn by the browser
       in the browser's colors, at the browser's sizes, with the browser's
       radii. In a language built on one set of fills that is not a small
       inconsistency, it is a hole — a Windows color dialog opening out of a
       dark page is not a quieter version of this kit, it is a different
       program. So the kit draws its own, and the native control is the
       deliberate exception rather than the accident.

       AND HOW TO TURN IT OFF. data-picker="native" leaves the input exactly
       as the browser made it. It is a real choice, not a concession: a native
       date field is the one that gets the platform's own keyboard on a phone,
       the one that is already localized, and the one a user has muscle memory
       for. Per input, so a form can use the kit's calendar for the field it
       shows off and the system's for the one buried in an admin screen.

       Degrading is the same decision made for you: with the script off, the
       markup is still a plain semantic input and the browser's picker is
       still there. Nothing here is required for the field to work.

       type="week" is passed through on purpose. ISO week numbering is a
       genuine value type with its own year boundaries, and a picker for it
       that is merely plausible is worse than the browser's, which is at
       least correct. It gets a component when it gets the week math.

       This behavior rewrites markup that the behaviors below then wire up,
       so it has to be declared before them: BEHAVIORS is applied in key
       order, and a picker generated after its own behavior had already run
       would sit there inert until the next init pass. */
    picker: function (root) {
      var BUILDERS = {
        number: upgradeNumber,
        date: upgradeDate,
        time: upgradeTime,
        'datetime-local': upgradeDateTime,
        month: upgradeMonth,
        color: upgradeColor
      };

      /* The ATTRIBUTE, not the .type property, and the difference is the
         whole reason this reads the way it does. A browser that does not
         implement an input type reports .type as "text" — Firefox does
         exactly that for month and week — so dispatching on the property
         upgrades a field in one browser and silently skips it in another,
         which is the worst possible way for this to fail. The attribute is
         what the author wrote, and what the author wrote is what the kit is
         being asked to replace. */
      function declaredType(input) {
        return (input.getAttribute('type') || input.type || '').toLowerCase();
      }

      $$('input[data-picker]', root).forEach(function (input) {
        if (input.getAttribute('data-picker') === 'native') return;
        var build = BUILDERS[declaredType(input)];
        if (!build) return;
        if (!claim(input, 'Picker')) return;
        build(input);
      });

      /* Puts a wrapper where the input is and moves the input inside it, so
         the input keeps its id and whatever <label for> already points at
         it. Everything generated is addressed off that id. */
      function hoist(input, wrapper) {
        if (input.parentNode) input.parentNode.replaceChild(wrapper, input);
        return wrapper;
      }

      function el(tag, className, attrs) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        Object.keys(attrs || {}).forEach(function (name) {
          node.setAttribute(name, attrs[name]);
        });
        return node;
      }

      function iconButton(icon, label, popoverId) {
        var button = el('button', 'button button-icon button-icon-sm', {
          type: 'button', 'aria-label': label, 'data-popover': popoverId
        });
        var glyph = el('span', 'icon');
        glyph.textContent = icon;
        button.appendChild(glyph);
        return button;
      }

      /* The shared shape of the four popover-backed pickers: a text field the
         value can also be typed into, a hidden field carrying the machine
         value, a trigger, and a popover for the panel. */
      function popoverField(input, config) {
        var id = input.id || uid('picker');
        var popId = id + '-pop';

        var wrapper = el('div', 'popover-anchor popover-anchor-block', config.wrapAttrs);
        var group = el('div', 'input-group');

        var hidden = el('input', null, { type: 'hidden', value: input.value || '' });
        hidden.setAttribute(config.valueAttr, '');

        hoist(input, wrapper);
        input.type = 'text';
        input.id = id;
        input.className = input.className || 'input';
        if (!input.classList.contains('input')) input.classList.add('input');
        input.setAttribute('autocomplete', 'off');
        input.removeAttribute('data-picker');
        /* The hidden field is the value now, so the visible one must not be
           submitted under the same name as well. */
        if (input.name) {
          hidden.name = input.name;
          input.removeAttribute('name');
        }
        if (config.placeholder && !input.placeholder) input.placeholder = config.placeholder;
        input.value = '';

        group.appendChild(input);
        group.appendChild(hidden);
        group.appendChild(iconButton(config.icon, config.label, popId));
        wrapper.appendChild(group);

        var pop = el('div', 'popover popover-flush', {
          id: popId, 'data-placement': 'bottom', 'aria-label': config.label
        });
        wrapper.appendChild(pop);
        return { wrapper: wrapper, pop: pop, id: id };
      }

      /* --- number ------------------------------------------------------- */
      function upgradeNumber(input) {
        var wrapper = el('div', 'number-input', { 'data-number': '' });
        hoist(input, wrapper);
        input.classList.remove('input');
        input.classList.add('number-input-field');
        input.removeAttribute('data-picker');

        var down = el('button', 'number-step number-step-down', {
          type: 'button', 'aria-label': 'Decrease'
        });
        var up = el('button', 'number-step number-step-up', {
          type: 'button', 'aria-label': 'Increase'
        });
        [[down, 'remove'], [up, 'add']].forEach(function (pair) {
          var glyph = el('span', 'icon icon-sm');
          glyph.textContent = pair[1];
          pair[0].appendChild(glyph);
        });

        wrapper.appendChild(down);
        wrapper.appendChild(input);
        wrapper.appendChild(up);
      }

      /* --- date --------------------------------------------------------- */
      function upgradeDate(input) {
        var bounds = {};
        if (input.getAttribute('min')) bounds['data-min'] = input.getAttribute('min');
        if (input.getAttribute('max')) bounds['data-max'] = input.getAttribute('max');
        bounds['data-datepicker'] = '';

        var built = popoverField(input, {
          wrapAttrs: bounds,
          valueAttr: 'data-date-value',
          icon: 'calendar_today',
          label: 'Choose a date',
          placeholder: 'YYYY-MM-DD'
        });
        built.pop.appendChild(el('div', null, { 'data-calendar': '' }));
      }

      /* --- time --------------------------------------------------------- */
      function upgradeTime(input) {
        /* A native step is in seconds; the kit's picker counts minutes. */
        var seconds = parseFloat(input.getAttribute('step'));
        var attrs = { 'data-timepicker': '' };
        if (seconds && seconds >= 60) attrs['data-step'] = String(Math.round(seconds / 60));
        if (input.getAttribute('data-hour-cycle')) {
          attrs['data-hour-cycle'] = input.getAttribute('data-hour-cycle');
        }

        var built = popoverField(input, {
          wrapAttrs: attrs,
          valueAttr: 'data-time-value',
          icon: 'schedule',
          label: 'Choose a time',
          placeholder: 'HH:MM'
        });
        built.pop.appendChild(el('div', null, { 'data-time-columns': '' }));
      }

      /* --- date and time ------------------------------------------------ */
      /* Composed rather than written again: the panel holds a real
         [data-datepicker] and a real [data-timepicker], each with its own
         hidden value, and the datetimepicker behavior below joins the two.
         A second calendar renderer would be a second calendar to fix. */
      function upgradeDateTime(input) {
        var built = popoverField(input, {
          wrapAttrs: { 'data-datetimepicker': '' },
          valueAttr: 'data-datetime-value',
          icon: 'event',
          label: 'Choose a date and time',
          placeholder: 'YYYY-MM-DD HH:MM'
        });
        input.setAttribute('data-datetime-field', '');
        /* Two panels side by side do not fit a popover sized for one. */
        built.pop.classList.add('popover-datetime');

        var panel = el('div', 'datetime-panel');

        var datePart = el('div', 'datetime-panel-date', { 'data-datepicker': '' });
        datePart.appendChild(el('input', null, { type: 'hidden', 'data-date-value': '' }));
        datePart.appendChild(el('input', 'visually-hidden', {
          type: 'text', tabindex: '-1', 'aria-label': 'Chosen date'
        }));
        datePart.appendChild(el('div', null, { 'data-calendar': '' }));

        var timePart = el('div', 'datetime-panel-time', { 'data-timepicker': '', 'data-step': '15' });
        timePart.appendChild(el('input', null, { type: 'hidden', 'data-time-value': '' }));
        timePart.appendChild(el('input', 'visually-hidden', {
          type: 'text', tabindex: '-1', 'aria-label': 'Chosen time'
        }));
        timePart.appendChild(el('div', null, { 'data-time-columns': '' }));

        panel.appendChild(datePart);
        panel.appendChild(timePart);
        built.pop.appendChild(panel);
      }

      /* --- month -------------------------------------------------------- */
      function upgradeMonth(input) {
        var attrs = { 'data-monthpicker': '' };
        if (input.getAttribute('min')) attrs['data-min'] = input.getAttribute('min');
        if (input.getAttribute('max')) attrs['data-max'] = input.getAttribute('max');

        var built = popoverField(input, {
          wrapAttrs: attrs,
          valueAttr: 'data-month-value',
          icon: 'calendar_month',
          label: 'Choose a month',
          placeholder: 'YYYY-MM'
        });
        built.pop.appendChild(el('div', null, { 'data-month-grid': '' }));
      }

      /* --- color -------------------------------------------------------- */
      /* The only one of the six whose trigger is not a glyph: a color field's
         value IS an appearance, so the button shows the color rather than
         naming an action. The hex sits in the text field beside it, because
         a hex is the one part of a color anyone copies or pastes. */
      function upgradeColor(input) {
        var id = input.id || uid('color');
        var popId = id + '-pop';
        var start = normalizeHex(input.value) || '#000000';

        var wrapper = el('div', 'popover-anchor popover-anchor-block', { 'data-colorpicker': '' });
        hoist(input, wrapper);

        var group = el('div', 'input-group');
        input.type = 'text';
        input.id = id;
        input.className = 'input color-field';
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.removeAttribute('data-picker');
        input.value = start;

        var hidden = el('input', null, { type: 'hidden', value: start, 'data-color-value': '' });
        if (input.name) { hidden.name = input.name; input.removeAttribute('name'); }

        var trigger = el('button', 'button color-trigger', {
          type: 'button', 'data-popover': popId, 'aria-label': 'Choose a color'
        });
        trigger.appendChild(el('span', 'color-trigger-swatch', { 'data-color-swatch': '' }));

        group.appendChild(input);
        group.appendChild(hidden);
        group.appendChild(trigger);
        wrapper.appendChild(group);

        var pop = el('div', 'popover', {
          id: popId, 'data-placement': 'bottom', 'aria-label': 'Choose a color'
        });
        pop.appendChild(el('div', null, { 'data-color-panel': '' }));
        wrapper.appendChild(pop);
      }
    },

    combobox: function (root) {
      $$('[data-combobox]', root).forEach(function (box) {
        if (!claim(box, 'Combobox')) return;
        var input = $('input:not([type="hidden"])', box);
        var list = $('.listbox', box);
        if (!input || !list) return;

        var toggle = $('.combobox-toggle', box);
        var popup = $('.combobox-popup', box);
        var hidden = $('input[data-combobox-value]', box);
        var tagHost = box.getAttribute('data-combobox-tags')
          ? document.getElementById(box.getAttribute('data-combobox-tags'))
          : null;
        var multiple = box.hasAttribute('data-multiple');
        var filters = box.getAttribute('data-filter') !== 'none';
        var options = $$('.listbox-option', list);
        var active = -1;

        if (!list.id) list.id = (box.id || 'combobox') + '-list';
        list.setAttribute('role', 'listbox');
        if (multiple) list.setAttribute('aria-multiselectable', 'true');
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', filters ? 'list' : 'none');
        input.setAttribute('aria-controls', list.id);
        input.setAttribute('aria-expanded', 'false');
        /* The browser's own suggestion panel would cover the listbox. */
        input.setAttribute('autocomplete', 'off');

        options.forEach(function (option, index) {
          if (!option.id) option.id = list.id + '-option-' + index;
          option.setAttribute('role', 'option');
          if (!option.hasAttribute('aria-selected')) option.setAttribute('aria-selected', 'false');
          /* The label is kept aside so the match can be re-marked on every
             keystroke without losing the original text. */
          var labelHost = $('.listbox-option-title', option) || option;
          option.dataset.label = option.dataset.label || labelHost.textContent.trim();
          if (!option.dataset.value) option.dataset.value = option.dataset.label;
        });

        /* --- marking the matched run ---------------------------------- */
        function paint(option, query) {
          var host = $('.listbox-option-title', option) || option;
          var label = option.dataset.label;
          var at = query ? label.toLowerCase().indexOf(query.toLowerCase()) : -1;
          if (at < 0) { host.textContent = label; return; }
          host.textContent = '';
          host.appendChild(document.createTextNode(label.slice(0, at)));
          var mark = document.createElement('mark');
          mark.textContent = label.slice(at, at + query.length);
          host.appendChild(mark);
          host.appendChild(document.createTextNode(label.slice(at + query.length)));
        }

        function visible() {
          return options.filter(function (option) { return !option.hidden; });
        }

        function filter(query) {
          var shown = 0;
          options.forEach(function (option) {
            var match = !filters || !query ||
              option.dataset.label.toLowerCase().indexOf(query.toLowerCase()) > -1;
            option.hidden = !match;
            if (match) { paint(option, filters ? query : ''); shown++; }
          });
          var empty = $('.listbox-empty', box);
          if (empty) empty.hidden = shown > 0;
          return shown;
        }

        /* --- the highlighted option ----------------------------------- */
        function setActive(index) {
          var shown = visible();
          options.forEach(function (option) { option.classList.remove('is-active'); });
          if (!shown.length || index < 0) {
            active = -1;
            input.removeAttribute('aria-activedescendant');
            return;
          }
          active = Math.max(0, Math.min(index, shown.length - 1));
          var option = shown[active];
          option.classList.add('is-active');
          input.setAttribute('aria-activedescendant', option.id);
          /* Keeps the highlight in view without scrolling the page itself. */
          if (option.scrollIntoView) option.scrollIntoView({ block: 'nearest' });
        }

        function moveActive(delta) {
          var shown = visible();
          if (!shown.length) return;
          if (active < 0) setActive(delta > 0 ? 0 : shown.length - 1);
          else setActive((active + delta + shown.length) % shown.length);
        }

        /* --- open and close ------------------------------------------- */
        function open() {
          if (box.dataset.open === 'true') return;
          closeAllCombos(box);
          box.dataset.open = 'true';
          input.setAttribute('aria-expanded', 'true');
          if (popup) {
            /* Flip above the field when the popup would run off the bottom.
               clientHeight rather than innerHeight, so a horizontal scrollbar
               is not mistaken for usable space. */
            popup.classList.remove('combobox-popup-above');
            var rect = popup.getBoundingClientRect();
            if (rect.bottom > document.documentElement.clientHeight - 8 && rect.top > rect.height) {
              popup.classList.add('combobox-popup-above');
            }
          }
          var current = options.findIndex(function (option) {
            return option.getAttribute('aria-selected') === 'true' && !option.hidden;
          });
          setActive(current > -1 ? visible().indexOf(options[current]) : 0);
        }

        function close() {
          if (box.dataset.open !== 'true') return;
          box.dataset.open = 'false';
          input.setAttribute('aria-expanded', 'false');
          input.removeAttribute('aria-activedescendant');
          options.forEach(function (option) { option.classList.remove('is-active'); });
          active = -1;
        }

        /* --- committing a choice -------------------------------------- */
        function selectedOptions() {
          return options.filter(function (option) { return option.getAttribute('aria-selected') === 'true'; });
        }

        function syncValue() {
          var chosen = selectedOptions();
          if (hidden) {
            hidden.value = chosen.map(function (option) { return option.dataset.value; }).join(',');
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (!multiple) return;
          /* In multiple mode the field stays empty for typing and the choices
             are shown as removable chips beside it. */
          input.value = '';
          if (!tagHost) return;
          tagHost.innerHTML = '';
          chosen.forEach(function (option) {
            var chip = document.createElement('span');
            chip.className = 'chip chip-primary';
            chip.innerHTML = '<span></span>' +
              '<button class="chip-remove" type="button"><span class="icon icon-sm">close</span></button>';
            chip.children[0].textContent = option.dataset.label;
            var remove = chip.children[1];
            remove.setAttribute('aria-label', 'Remove ' + option.dataset.label);
            on(remove, 'click', function () {
              option.setAttribute('aria-selected', 'false');
              syncValue();
              input.focus();
            });
            tagHost.appendChild(chip);
          });
        }

        function choose(option) {
          if (!option || option.getAttribute('aria-disabled') === 'true') return;
          if (multiple) {
            option.setAttribute('aria-selected',
              option.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
            syncValue();
            /* A multi-select stays open so several can be picked in a row. */
            filter('');
            return;
          }
          options.forEach(function (other) { other.setAttribute('aria-selected', 'false'); });
          option.setAttribute('aria-selected', 'true');
          input.value = option.dataset.label;
          syncValue();
          filter('');
          close();
        }

        /* --- wiring --------------------------------------------------- */
        on(input, 'input', function () {
          var shown = filter(input.value);
          open();
          setActive(shown ? 0 : -1);
        });

        on(input, 'keydown', function (event) {
          switch (event.key) {
            case 'ArrowDown': event.preventDefault(); if (box.dataset.open !== 'true') open(); else moveActive(1); break;
            case 'ArrowUp':   event.preventDefault(); if (box.dataset.open !== 'true') open(); else moveActive(-1); break;
            case 'Home':      if (box.dataset.open === 'true') { event.preventDefault(); setActive(0); } break;
            case 'End':       if (box.dataset.open === 'true') { event.preventDefault(); setActive(visible().length - 1); } break;
            case 'Enter':
              if (box.dataset.open === 'true' && active > -1) { event.preventDefault(); choose(visible()[active]); }
              break;
            case 'Escape':
              if (box.dataset.open === 'true') { event.stopPropagation(); close(); }
              else if (input.value && !multiple) { input.value = ''; filter(''); }
              break;
            case 'Tab':
              /* Leaving the field commits the highlight, matching a <select>. */
              if (box.dataset.open === 'true' && active > -1 && !multiple) choose(visible()[active]);
              else close();
              break;
          }
        });

        /* Anything typed that matches nothing is discarded on blur, so the
           field can never be left showing a value that was not chosen. */
        on(input, 'blur', function () {
          window.setTimeout(function () {
            if (box.contains(document.activeElement)) return;
            close();
            if (multiple || box.hasAttribute('data-allow-custom')) return;
            var chosen = selectedOptions()[0];
            input.value = chosen ? chosen.dataset.label : '';
            filter('');
          }, 120);
        });

        if (toggle) {
          toggle.setAttribute('tabindex', '-1');
          toggle.setAttribute('aria-hidden', 'true');
          on(toggle, 'click', function (event) {
            event.stopPropagation();
            if (box.dataset.open === 'true') close();
            else { filter(''); open(); }
            input.focus();
          });
        }

        options.forEach(function (option) {
          /* Pointer-down rather than click: mousedown would otherwise blur the
             input first and the blur handler would undo the choice. */
          on(option, 'mousedown', function (event) { event.preventDefault(); });
          on(option, 'click', function () { choose(option); input.focus(); });
          on(option, 'mouseenter', function () { setActive(visible().indexOf(option)); });
        });

        on(box, 'click', function (event) { event.stopPropagation(); });

        box.dataset.open = 'false';
        box._uiCombobox = { close: close };
        /* Reflect any option marked selected in the markup. */
        var preset = selectedOptions()[0];
        if (preset && !multiple) input.value = preset.dataset.label;
        if (multiple) syncValue();
      });
    },

    /* data-datepicker wraps a field and a .popover holding [data-calendar].
       The grid is rendered here rather than written out, because a month is
       a different shape every time. */
    /* Declared before datepicker and timepicker, and that is not cosmetic.
       Both of those read their starting value out of a hidden field once, at
       wire-up, and cache it. This behavior is what splits the combined value
       across those two fields — so registered after them it would be writing
       into fields whose owners had already read them, and the nested clock
       would come up at its 09:00 fallback while the text field above it
       showed the right time. Picking a minute would then commit the fallback
       hour along with it: the one bug this ordering exists to prevent. */
    /* data-datetimepicker joins a nested date picker and a nested time
       picker into one YYYY-MM-DDTHH:MM field.

       It owns no calendar and no clock of its own, which is the whole point:
       both halves are the components that already exist, so a fix to the
       calendar is a fix here too. All this does is listen for either half
       committing and write the pair out. */
    datetimepicker: function (root) {
      $$('[data-datetimepicker]', root).forEach(function (wrap) {
        if (!claim(wrap, 'DateTimePicker')) return;
        var field = $('[data-datetime-field]', wrap) || $('.input-group input.input', wrap);
        var valueField = $('input[data-datetime-value]', wrap);
        var datePart = $('[data-datepicker]', wrap);
        var timePart = $('[data-timepicker]', wrap);
        if (!field || !valueField || !datePart || !timePart) return;

        var dateValue = $('input[data-date-value]', datePart);
        var timeValue = $('input[data-time-value]', timePart);
        if (!dateValue || !timeValue) return;

        var pop = wrap.querySelector('.popover');
        var committing = false;

        /* Seeded from whatever the native input held, split across the two
           halves before their own behaviors read it. The nested pickers run
           after this behavior is registered but during the same init pass, so
           writing their hidden fields here is what sets their initial view. */
        var seed = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(valueField.value || '');
        if (seed) {
          dateValue.value = seed[1];
          timeValue.value = seed[2];
        }

        function compose() {
          if (!dateValue.value) return '';
          return dateValue.value + 'T' + (timeValue.value || '00:00');
        }

        function commit() {
          var iso = compose();
          valueField.value = iso;
          var parsedDate = parseISO(dateValue.value);
          var parsedTime = parseTime(timeValue.value);
          field.value = parsedDate
            ? formatLong(parsedDate) + (parsedTime ? ', ' + formatTime12(parsedTime) : '')
            : '';
          committing = true;
          field.dispatchEvent(new Event('change', { bubbles: true }));
          committing = false;
        }

        /* Both halves commit by firing change on their own visible input, and
           those bubble to here. Nothing else in the popover fires change, so
           this needs no filtering beyond ignoring our own. */
        on(wrap, 'change', function (event) {
          if (committing) return;
          if (event.target === field) {
            var typed = /^(\d{4}-\d{2}-\d{2})(?:[T, ]+(\d{1,2}:\d{2}))?/.exec(field.value.trim());
            if (!typed) return;
            dateValue.value = typed[1];
            if (typed[2]) timeValue.value = pad(parseInt(typed[2], 10)) + typed[2].slice(-3);
            commit();
            return;
          }
          if (datePart.contains(event.target) || timePart.contains(event.target)) commit();
        });

        if (pop) on(pop, 'ui:open', commit);
        commit();
      });
    },

    datepicker: function (root) {
      $$('[data-datepicker]', root).forEach(function (wrap) {
        if (!claim(wrap, 'DatePicker')) return;
        var host = $('[data-calendar]', wrap);
        var input = $('input:not([type="hidden"])', wrap);
        if (!host || !input) return;

        var valueField = $('input[data-date-value]', wrap);
        var pop = wrap.querySelector('.popover');
        var range = wrap.hasAttribute('data-range');
        var min = parseISO(wrap.getAttribute('data-min'));
        var max = parseISO(wrap.getAttribute('data-max'));
        var selected = parseISO(valueField ? valueField.value : input.value);
        var rangeEnd = parseISO(wrap.getAttribute('data-range-end'));
        var view = startOfMonth(selected || new Date());
        /* The day the arrow keys would move from, which is not always the
           selected day — an empty field starts the cursor on today. */
        var cursor = selected || today();
        /* The change event this fires is also what the field listens to, so
           without the guard a commit would re-enter itself for ever. */
        var committing = false;

        function commit() {
          var iso = selected ? toISO(selected) : '';
          if (valueField) {
            valueField.value = iso;
            input.value = selected ? formatLong(selected) : '';
          } else {
            input.value = iso;
          }
          committing = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          committing = false;
        }

        function render() {
          host.innerHTML = '';
          host.className = 'calendar';

          var header = document.createElement('div');
          header.className = 'calendar-header';
          var title = document.createElement('div');
          title.className = 'calendar-title';
          title.textContent = MONTHS[view.getMonth()] + ' ' + view.getFullYear();
          title.id = (wrap.id || 'calendar') + '-title';
          var nav = document.createElement('div');
          nav.className = 'calendar-nav';
          nav.appendChild(navButton('chevron_left', 'Previous month', -1));
          nav.appendChild(navButton('chevron_right', 'Next month', 1));
          header.appendChild(title);
          header.appendChild(nav);
          host.appendChild(header);

          var grid = document.createElement('div');
          grid.className = 'calendar-grid';
          grid.setAttribute('role', 'grid');
          grid.setAttribute('aria-labelledby', title.id);

          WEEKDAYS.forEach(function (day) {
            var cell = document.createElement('div');
            cell.className = 'calendar-weekday';
            cell.setAttribute('role', 'columnheader');
            cell.setAttribute('aria-label', day.long);
            cell.textContent = day.short;
            grid.appendChild(cell);
          });

          /* Monday-first, so the leading blanks come from the previous month. */
          var first = new Date(view.getFullYear(), view.getMonth(), 1);
          var lead = (first.getDay() + 6) % 7;
          var start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);

          for (var i = 0; i < 42; i++) {
            var date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
            /* Six rows always fit a month, but trailing empty weeks are not
               drawn, so the panel does not change height needlessly. */
            if (i >= 35 && date.getMonth() !== view.getMonth()) break;
            grid.appendChild(dayButton(date));
          }
          host.appendChild(grid);

          var footer = document.createElement('div');
          footer.className = 'calendar-footer';
          footer.appendChild(textButton('Today', function () {
            view = startOfMonth(today());
            cursor = today();
            pick(today());
          }));
          footer.appendChild(textButton('Clear', function () {
            selected = null;
            commit();
            render();
          }));
          host.appendChild(footer);
        }

        function navButton(icon, label, delta) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'button button-icon button-icon-sm';
          button.setAttribute('aria-label', label);
          button.innerHTML = '<span class="icon icon-sm"></span>';
          button.firstChild.textContent = icon;
          on(button, 'click', function () { shiftMonth(delta); });
          return button;
        }

        function textButton(label, action) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'button button-text button-sm';
          button.textContent = label;
          on(button, 'click', action);
          return button;
        }

        function dayButton(date) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'calendar-day';
          button.textContent = String(date.getDate());
          button.setAttribute('role', 'gridcell');
          button.setAttribute('aria-label', formatLong(date));
          button.dataset.date = toISO(date);

          var outside = date.getMonth() !== view.getMonth();
          if (outside) button.classList.add('is-outside');
          if (same(date, today())) button.classList.add('is-today');
          if (selected && same(date, selected)) {
            button.classList.add('is-selected');
            button.setAttribute('aria-selected', 'true');
          }
          if (range && selected && rangeEnd && date > selected && date < rangeEnd) {
            button.classList.add('is-in-range');
          }
          if ((min && date < min) || (max && date > max)) {
            button.disabled = true;
            button.setAttribute('aria-disabled', 'true');
          }
          /* One tab stop for the whole grid; the arrows move within it. */
          button.tabIndex = same(date, cursor) ? 0 : -1;

          on(button, 'click', function () { cursor = date; pick(date); });
          on(button, 'keydown', function (event) { onGridKey(event, date); });
          return button;
        }

        function onGridKey(event, date) {
          /* A calendar week runs in reading order, so the horizontal keys
             follow the direction while the vertical ones never change. */
          var step = inlineStep(event, event.currentTarget) ||
                     { ArrowUp: -7, ArrowDown: 7 }[event.key] || 0;
          if (step) {
            event.preventDefault();
            moveCursor(new Date(date.getFullYear(), date.getMonth(), date.getDate() + step));
            return;
          }
          if (event.key === 'PageUp')   { event.preventDefault(); moveCursor(addMonths(date, -1)); return; }
          if (event.key === 'PageDown') { event.preventDefault(); moveCursor(addMonths(date, 1)); return; }
          if (event.key === 'Home') {
            event.preventDefault();
            moveCursor(new Date(date.getFullYear(), date.getMonth(), date.getDate() - ((date.getDay() + 6) % 7)));
            return;
          }
          if (event.key === 'End') {
            event.preventDefault();
            moveCursor(new Date(date.getFullYear(), date.getMonth(), date.getDate() + (6 - ((date.getDay() + 6) % 7))));
          }
        }

        function moveCursor(date) {
          cursor = date;
          if (date.getMonth() !== view.getMonth() || date.getFullYear() !== view.getFullYear()) {
            view = startOfMonth(date);
          }
          render();
          var next = $('[data-date="' + toISO(date) + '"]', host);
          if (next) next.focus();
        }

        function shiftMonth(delta) {
          view = addMonths(view, delta);
          render();
          /* Keep the keyboard cursor on screen after a month change. */
          var still = $('[data-date="' + toISO(cursor) + '"]', host);
          if (!still) {
            cursor = startOfMonth(view);
            render();
          }
        }

        function pick(date) {
          selected = date;
          commit();
          render();
          if (pop) closePopover(pop);
        }

        /* A typed value is accepted on blur, so the field is never locked. */
        on(input, 'change', function () {
          if (committing) return;
          var typed = parseISO(input.value) || parseLoose(input.value);
          if (typed) {
            selected = typed;
            cursor = typed;
            view = startOfMonth(typed);
            commit();
          } else if (!input.value) {
            selected = null;
            commit();
          }
          render();
        });

        if (pop) {
          /* Opening on the current month, not wherever it was left. */
          on(pop, 'ui:open', function () {
            view = startOfMonth(selected || today());
            cursor = selected || today();
            render();
            var focusable = $('[tabindex="0"]', host);
            if (focusable) focusable.focus();
          });
        }

        render();
        commit();
      });
    },

    /* data-timepicker pairs a field with scrolling hour, minute and meridiem
       columns. The stored value is always 24-hour HH:MM. */
    timepicker: function (root) {
      $$('[data-timepicker]', root).forEach(function (wrap) {
        if (!claim(wrap, 'TimePicker')) return;
        var host = $('[data-time-columns]', wrap);
        var input = $('input:not([type="hidden"])', wrap);
        if (!host || !input) return;

        var valueField = $('input[data-time-value]', wrap);
        var pop = wrap.querySelector('.popover');
        var step = parseInt(wrap.getAttribute('data-step'), 10) || 5;
        var twelve = wrap.getAttribute('data-hour-cycle') !== '24';
        var current = parseTime((valueField ? valueField.value : input.value)) || { h: 9, m: 0 };
        /* Same re-entry guard as the date picker: the field listens to the
           very event a commit fires. */
        var committing = false;

        function commit() {
          var iso = pad(current.h) + ':' + pad(current.m);
          if (valueField) {
            valueField.value = iso;
            input.value = twelve ? formatTime12(current) : iso;
          } else {
            input.value = iso;
          }
          committing = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          committing = false;
        }

        /* Centers an option inside its own column, and moves nothing else.

           This was scrollIntoView({ block: 'center' }), which does what it
           says and then some: it scrolls EVERY scrollable ancestor on the way
           up, the document included. There are three columns, so a render ran
           it three times, and a render runs on every pick — which is why
           choosing AM or PM hauled the whole page up, then down, then up
           again underneath the pointer. Setting scrollTop on the one element
           that is supposed to move cannot reach past it.

           Measured from bounding rects rather than offsetTop, because
           .time-column is not positioned and neither is its sticky header, so
           offsetTop here is relative to whichever ancestor happens to
           qualify — which is not the column. */
        function revealInColumn(option) {
          var list = option.closest('.time-column');
          if (!list) return;
          var listBox = list.getBoundingClientRect();
          var optionBox = option.getBoundingClientRect();
          list.scrollTop += (optionBox.top - listBox.top)
                          - (list.clientHeight - optionBox.height) / 2;
        }

        /* The columns are built ONCE and then only re-marked.

           A pick used to rebuild all three of them, and that was the cause of
           the rest of this. The option sets never actually change — the hours
           are the same twelve or twenty-four whatever is chosen, the minutes
           are fixed by the step, and the meridiem is two values — so the only
           thing a pick alters is which option carries the mark. Tearing down
           three scrollers inside an absolutely positioned panel and building
           them again made the browser's scroll anchoring compensate for the
           churn by nudging the document a few pixels on every click, and it
           threw away the very button that had just been pressed, which is how
           keyboard focus ended up on <body> after one choice.

           Keeping the DOM and moving the mark fixes both at once, and keeps
           each column's scroll position across a pick for free. */
        var columns = [];
        var builtColumns = false;

        function column(label, values, isSelected, onPick, format) {
          var list = document.createElement('ul');
          list.className = 'time-column';
          list.setAttribute('role', 'listbox');
          list.setAttribute('aria-label', label);
          var head = document.createElement('li');
          head.className = 'time-column-head';
          head.setAttribute('role', 'presentation');
          head.textContent = label;
          list.appendChild(head);

          var options = [];
          values.forEach(function (value) {
            var item = document.createElement('li');
            item.setAttribute('role', 'presentation');
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'time-option';
            button.setAttribute('role', 'option');
            button.textContent = format ? format(value) : pad(value);
            on(button, 'click', function () { onPick(value); });
            item.appendChild(button);
            list.appendChild(item);
            options.push({ value: value, button: button });
          });

          columns.push({ options: options, isSelected: isSelected });
          return list;
        }

        function build() {
          host.innerHTML = '';
          host.className = 'time-columns';
          columns = [];

          var hours = [];
          if (twelve) { for (var h = 1; h <= 12; h++) hours.push(h); }
          else { for (var i = 0; i < 24; i++) hours.push(i); }

          host.appendChild(column('Hour', hours, function (value) {
            return twelve ? to12(current.h) === value : current.h === value;
          }, function (value) {
            current.h = twelve ? from12(value, current.h >= 12) : value;
            commit();
            render();
          }, twelve ? String : pad));

          var minutes = [];
          for (var m = 0; m < 60; m += step) minutes.push(m);
          host.appendChild(column('Min', minutes, function (value) {
            return current.m === value;
          }, function (value) {
            current.m = value;
            commit();
            render();
          }));

          if (twelve) {
            host.appendChild(column('', ['AM', 'PM'], function (value) {
              return (current.h >= 12) === (value === 'PM');
            }, function (value) {
              current.h = from12(to12(current.h), value === 'PM');
              commit();
              render();
            }, String));
          }

          builtColumns = true;
        }

        function render() {
          if (!builtColumns) build();
          columns.forEach(function (entry) {
            entry.options.forEach(function (option) {
              var selected = entry.isSelected(option.value);
              option.button.setAttribute('aria-selected', String(selected));
              /* Only the chosen row is brought into view, and only inside its
                 own column — see revealInColumn. */
              if (selected) revealInColumn(option.button);
            });
          });
        }

        on(input, 'change', function () {
          if (committing) return;
          var typed = parseTime(input.value);
          if (typed) { current = typed; commit(); render(); }
        });

        if (pop) on(pop, 'ui:open', render);

        render();
        commit();
      });
    },

    /* data-tag-input turns a .tag-input box into a multi-value field. The
       chips are the value; a hidden input carries it for form submission. */
    /* data-file-field on an <input type="file"> replaces the browser's own
       "Browse..." button and the gray filename strip beside it.

       The native file DIALOG is kept, and deliberately. A page cannot read
       the filesystem, must not be able to, and should not try — the dialog is
       the browser's for the same reason the password manager is, and
       replacing it is not something a design language gets to want. What it
       does get to want is the button that opens it, which is drawn by the
       platform in the platform's style, sits at whatever width the word
       "Browse" happens to be in the current locale, and is the one control on
       a form that cannot be made to match the one beside it.

       So the input is moved out of the layout and left fully functional, and
       a real .button is put in front of it. Clicking the button clicks the
       input, which opens the same dialog it always did. The filename is
       rendered by the kit afterwards. */
    fileField: function (root) {
      $$('input[type="file"][data-file-field]', root).forEach(function (input) {
        if (!claim(input, 'FileField')) return;

        var wrapper = document.createElement('div');
        wrapper.className = 'file-field';
        if (input.parentNode) input.parentNode.replaceChild(wrapper, input);

        var label = input.getAttribute('data-file-label') || 'Choose a file';
        var empty = input.getAttribute('data-file-empty') ||
          (input.multiple ? 'No files chosen' : 'No file chosen');

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'button button-outlined';
        var glyph = document.createElement('span');
        glyph.className = 'icon icon-sm';
        glyph.textContent = 'attach_file';
        trigger.appendChild(glyph);
        trigger.appendChild(document.createTextNode(label));

        var name = document.createElement('span');
        name.className = 'file-field-name text-truncate';

        var clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'button button-icon button-icon-sm';
        clear.setAttribute('aria-label', 'Clear selection');
        var clearGlyph = document.createElement('span');
        clearGlyph.className = 'icon icon-sm';
        clearGlyph.textContent = 'close';
        clear.appendChild(clearGlyph);

        /* The input keeps its id so an existing <label for> still reaches it,
           and stays focusable so Tab and Space still open the dialog without
           the button in the way. It is only moved out of sight. */
        input.classList.add('file-field-input');

        wrapper.appendChild(input);
        wrapper.appendChild(trigger);
        wrapper.appendChild(name);
        wrapper.appendChild(clear);

        /* The native button is what gets the keyboard, so the kit's button is
           taken out of the tab order rather than put beside it: two stops for
           one control is worse than an unstyled one. Its press state still
           shows, because the real input is focused underneath. */
        trigger.tabIndex = -1;
        trigger.setAttribute('aria-hidden', 'true');

        function render() {
          var files = input.files;
          var count = files ? files.length : 0;
          if (!count) {
            name.textContent = empty;
            name.classList.add('is-empty');
            clear.hidden = true;
            return;
          }
          name.textContent = count === 1
            ? files[0].name
            : count + ' files selected';
          name.classList.remove('is-empty');
          clear.hidden = false;
        }

        on(trigger, 'click', function () { input.click(); });
        on(input, 'change', render);
        on(clear, 'click', function () {
          input.value = '';
          render();
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.focus();
        });

        render();
      });
    },

    /* data-monthpicker — a year with twelve cells in it. A month is not a
       date and is not a range, so it gets its own control rather than a
       calendar with the day grid disabled. */
    monthpicker: function (root) {
      $$('[data-monthpicker]', root).forEach(function (wrap) {
        if (!claim(wrap, 'MonthPicker')) return;
        var host = $('[data-month-grid]', wrap);
        var input = $('input:not([type="hidden"])', wrap);
        if (!host || !input) return;

        var valueField = $('input[data-month-value]', wrap);
        var pop = wrap.querySelector('.popover');
        var min = parseMonth(wrap.getAttribute('data-min'));
        var max = parseMonth(wrap.getAttribute('data-max'));
        var selected = parseMonth(valueField ? valueField.value : input.value);
        var view = selected ? selected.y : new Date().getFullYear();
        var committing = false;

        function iso(value) { return value ? value.y + '-' + pad(value.m + 1) : ''; }

        function blocked(candidate) {
          var ordinal = candidate.y * 12 + candidate.m;
          if (min && ordinal < min.y * 12 + min.m) return true;
          if (max && ordinal > max.y * 12 + max.m) return true;
          return false;
        }

        function commit() {
          if (valueField) {
            valueField.value = iso(selected);
            input.value = formatMonth(selected);
          } else {
            input.value = iso(selected);
          }
          committing = true;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          committing = false;
        }

        function render() {
          host.innerHTML = '';
          host.className = 'month-picker';

          var header = document.createElement('div');
          header.className = 'calendar-header';
          var title = document.createElement('div');
          title.className = 'calendar-title';
          title.textContent = String(view);
          var nav = document.createElement('div');
          nav.className = 'calendar-nav';
          nav.appendChild(yearButton('chevron_left', 'Previous year', -1));
          nav.appendChild(yearButton('chevron_right', 'Next year', 1));
          header.appendChild(title);
          header.appendChild(nav);
          host.appendChild(header);

          var grid = document.createElement('div');
          grid.className = 'month-picker-grid';
          MONTHS.forEach(function (name, index) {
            var candidate = { y: view, m: index };
            var cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'month-picker-cell';
            /* Three letters, because twelve cells in three columns is the
               widest the panel gets and "September" does not fit one. */
            cell.textContent = name.slice(0, 3);
            cell.setAttribute('aria-label', name + ' ' + view);
            if (selected && selected.y === view && selected.m === index) {
              cell.classList.add('is-selected');
              cell.setAttribute('aria-current', 'true');
            }
            if (blocked(candidate)) cell.disabled = true;
            on(cell, 'click', function () {
              selected = candidate;
              commit();
              render();
              if (pop) closePopover(pop);
            });
            grid.appendChild(cell);
          });
          host.appendChild(grid);

          var footer = document.createElement('div');
          footer.className = 'calendar-footer';
          footer.appendChild(textButton('This month', function () {
            var now = new Date();
            view = now.getFullYear();
            selected = { y: now.getFullYear(), m: now.getMonth() };
            commit();
            render();
          }));
          footer.appendChild(textButton('Clear', function () {
            selected = null;
            commit();
            render();
          }));
          host.appendChild(footer);
        }

        function yearButton(icon, label, delta) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'button button-icon button-icon-sm';
          button.setAttribute('aria-label', label);
          var glyph = document.createElement('span');
          glyph.className = 'icon icon-sm';
          glyph.textContent = icon;
          button.appendChild(glyph);
          on(button, 'click', function () { view += delta; render(); });
          return button;
        }

        function textButton(label, action) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'button button-text button-sm';
          button.textContent = label;
          on(button, 'click', action);
          return button;
        }

        on(input, 'change', function () {
          if (committing) return;
          var typed = parseMonth(input.value);
          if (typed) { selected = typed; view = typed.y; commit(); render(); }
        });

        if (pop) on(pop, 'ui:open', render);

        render();
        commit();
      });
    },

    /* data-colorpicker — the kit's replacement for <input type="color">,
       whose panel is the operating system's dialog and the one surface in a
       page that no stylesheet has ever been able to touch.

       Three sliders and a hex box, not a two-dimensional gradient field with
       a draggable dot. The dot is the better mouse control and the worse
       everything else: it has no keyboard story that is not invented, it
       needs a pointer-move loop to be any good, and it cannot say what it
       currently is without a readout beside it anyway. Hue, saturation and
       lightness as three range inputs are arrow-key operable for free,
       announce their own values, and are the kit's existing slider.

       The swatch row is the part most people will use. It is the kit's own
       token colors, so the common case — picking a color that belongs to this
       design language — is one click and cannot go wrong. */
    colorpicker: function (root) {
      $$('[data-colorpicker]', root).forEach(function (wrap) {
        if (!claim(wrap, 'ColorPicker')) return;
        var host = $('[data-color-panel]', wrap);
        var valueField = $('input[data-color-value]', wrap);
        var field = $('input.color-field', wrap) || $('input[type="text"]', wrap);
        var swatches = $$('[data-color-swatch]', wrap);
        if (!host || !valueField) return;

        var pop = wrap.querySelector('.popover');
        var current = normalizeHex(valueField.value) || '#000000';
        var hsl = rgbToHsl(hexToRgb(current));
        var committing = false;

        var presetAttr = (wrap.getAttribute('data-presets') || '').trim();

        /* Resolved per render rather than once at setup. The token colors
           differ between the two themes — the accent alone drops two rungs in
           light — so a row captured when the behavior was wired would still be
           showing the other theme's palette after a toggle, and the tick
           marking the current color would stop matching anything. */
        function presets() {
          return presetAttr
            ? presetAttr.split(/[\s,]+/).map(normalizeHex).filter(Boolean)
            : readTokenPresets();
        }

        /* The kit's own hues, read off the live custom properties rather than
           hard-coded, so the row follows the theme and follows a retheme. */
        function readTokenPresets() {
          var names = ['--color-primary', '--color-primary-strong', '--color-info',
                       '--color-success', '--color-warning', '--color-danger',
                       '--color-secondary', '--color-on-surface',
                       '--color-on-surface-muted', '--color-surface-sunken'];
          var styles = window.getComputedStyle(document.documentElement);
          var seen = {};
          var out = [];
          names.forEach(function (name) {
            var hex = normalizeHex(styles.getPropertyValue(name));
            if (hex && !seen[hex]) { seen[hex] = true; out.push(hex); }
          });
          return out;
        }

        function commit(hex) {
          current = hex;
          hsl = rgbToHsl(hexToRgb(current));
          valueField.value = current;
          swatches.forEach(function (node) { node.style.background = current; });
          if (field && document.activeElement !== field) field.value = current;
          committing = true;
          (field || valueField).dispatchEvent(new Event('change', { bubbles: true }));
          committing = false;
        }

        /* Only the parts that have to move are repainted. Re-rendering the
           whole panel on every slider step would tear the thumb out from
           under the pointer mid-drag. */
        var sliders = {};
        var preview;

        function refresh() {
          Object.keys(sliders).forEach(function (key) {
            var row = sliders[key];
            row.input.value = String(hsl[row.index]);
            row.readout.textContent = row.format(hsl[row.index]);
            row.input.setAttribute('aria-valuetext', row.format(hsl[row.index]));
          });
          if (preview) {
            preview.style.background = current;
            preview.style.color = contrastInk(current);
            preview.textContent = current;
          }
          $$('.color-swatch', host).forEach(function (button) {
            var on = button.getAttribute('data-value') === current;
            button.setAttribute('aria-pressed', String(on));
            button.classList.toggle('is-selected', on);
          });
        }

        function sliderRow(label, index, max, format) {
          var row = document.createElement('div');
          row.className = 'color-slider-row';

          var id = uid('color-slider');
          var text = document.createElement('label');
          text.className = 'color-slider-label';
          text.setAttribute('for', id);
          text.textContent = label;

          var input = document.createElement('input');
          input.type = 'range';
          input.className = 'slider color-slider color-slider-' + label.toLowerCase();
          input.id = id;
          input.min = '0';
          input.max = String(max);
          input.step = '1';

          var readout = document.createElement('span');
          readout.className = 'color-slider-readout';

          /* The hue ramp is a fixed spectrum in the stylesheet; the other two
             are drawn at the current hue so each track shows what moving it
             would actually do. */
          if (index > 0) paintTrack(input, index);

          on(input, 'input', function () {
            hsl[index] = Number(input.value);
            commit(rgbToHex(hslToRgb(hsl)));
            /* The two dependent tracks are keyed to the hue, so a hue move
               has to repaint them. */
            if (index === 0) paintTracks();
            refresh();
          });

          row.appendChild(text);
          row.appendChild(input);
          row.appendChild(readout);
          sliders[label] = { input: input, readout: readout, index: index, format: format };
          return row;
        }

        /* The track for one axis, drawn by sweeping that axis and holding the
           other two where they are. The lightness ramp needs its middle stop
           named: a straight black-to-white gradient passes through gray, so
           without it the one track whose whole job is to show the hue is the
           one track that does not. */
        function paintTrack(input, index) {
          function at(value) {
            var parts = hsl.slice();
            parts[index] = value;
            return 'hsl(' + parts[0] + ' ' + parts[1] + '% ' + parts[2] + '%)';
          }
          /* Only ever called for saturation and lightness, both 0-100. Hue
             runs 0-360 and its track is the fixed spectrum in the stylesheet. */
          input.style.setProperty('--color-slider-from', at(0));
          input.style.setProperty('--color-slider-mid', at(50));
          input.style.setProperty('--color-slider-to', at(100));
        }

        function paintTracks() {
          ['Saturation', 'Lightness'].forEach(function (key) {
            var row = sliders[key];
            if (row) paintTrack(row.input, row.index);
          });
        }

        function render() {
          host.innerHTML = '';
          host.className = 'color-panel';
          sliders = {};

          preview = document.createElement('output');
          preview.className = 'color-preview';
          preview.setAttribute('aria-live', 'off');
          host.appendChild(preview);

          host.appendChild(sliderRow('Hue', 0, 360, function (v) { return v + '°'; }));
          host.appendChild(sliderRow('Saturation', 1, 100, function (v) { return v + '%'; }));
          host.appendChild(sliderRow('Lightness', 2, 100, function (v) { return v + '%'; }));

          var palette = presets();
          if (palette.length) {
            var heading = document.createElement('p');
            heading.className = 'color-panel-heading';
            heading.textContent = 'From the palette';
            host.appendChild(heading);

            var grid = document.createElement('div');
            grid.className = 'color-swatches';
            grid.setAttribute('role', 'group');
            grid.setAttribute('aria-label', 'Palette colors');
            palette.forEach(function (hex) {
              var button = document.createElement('button');
              button.type = 'button';
              button.className = 'color-swatch';
              button.setAttribute('data-value', hex);
              button.setAttribute('aria-label', hex);
              button.setAttribute('aria-pressed', String(hex === current));
              button.style.background = hex;
              button.style.color = contrastInk(hex);
              on(button, 'click', function () {
                commit(hex);
                paintTracks();
                refresh();
              });
              grid.appendChild(button);
            });
            host.appendChild(grid);
          }

          refresh();
        }

        if (field) {
          /* Typing is committed on change rather than on input, so a half
             typed hex does not repaint the panel three times on the way. */
          on(field, 'change', function () {
            if (committing) return;
            var typed = normalizeHex(field.value);
            if (!typed) { field.value = current; return; }
            commit(typed);
            paintTracks();
            refresh();
          });
        }

        if (pop) on(pop, 'ui:open', render);

        swatches.forEach(function (node) { node.style.background = current; });
        render();
        commit(current);
      });
    },

    tagInput: function (root) {
      $$('[data-tag-input]', root).forEach(function (box) {
        if (!claim(box, 'TagInput')) return;
        var field = $('.tag-input-field', box);
        if (!field) return;

        var hidden = $('input[data-tag-value]', box) ||
                     (box.getAttribute('data-tag-value')
                       ? document.getElementById(box.getAttribute('data-tag-value'))
                       : null);
        var max = parseInt(box.getAttribute('data-max'), 10) || Infinity;
        var separator = box.getAttribute('data-separator') || ',';
        var armed = false;

        function tags() { return $$('.chip', box); }

        function sync() {
          var values = tags().map(function (chip) { return chip.dataset.value; });
          if (hidden) {
            hidden.value = values.join(separator);
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          }
          box.classList.toggle('is-full', values.length >= max);
          var counter = $('[data-tag-count]', box.parentNode || box);
          if (counter) counter.textContent = values.length + ' of ' + (max === Infinity ? '∞' : max);
        }

        function disarm() {
          armed = false;
          tags().forEach(function (chip) { chip.classList.remove('is-armed'); });
        }

        function add(value) {
          value = value.trim();
          if (!value) return;
          if (tags().length >= max) return;
          /* Silently ignore a repeat rather than erroring: the value the user
             asked for is already there. */
          var exists = tags().some(function (chip) {
            return chip.dataset.value.toLowerCase() === value.toLowerCase();
          });
          if (exists) { field.value = ''; return; }

          var chip = document.createElement('span');
          chip.className = 'chip';
          chip.dataset.value = value;
          chip.innerHTML = '<span></span>' +
            '<button class="chip-remove" type="button" tabindex="-1"><span class="icon icon-sm">close</span></button>';
          chip.children[0].textContent = value;
          var remove = chip.children[1];
          remove.setAttribute('aria-label', 'Remove ' + value);
          on(remove, 'click', function () { chip.remove(); sync(); field.focus(); });
          box.insertBefore(chip, field);
          field.value = '';
          sync();
        }

        on(field, 'keydown', function (event) {
          if (event.key === 'Enter' || event.key === separator) {
            event.preventDefault();
            add(field.value);
            disarm();
            return;
          }
          if (event.key === 'Backspace' && !field.value) {
            var list = tags();
            if (!list.length) return;
            /* First Backspace arms the last chip, the second removes it, so a
               value is never lost to a stray keystroke. */
            if (!armed) {
              armed = true;
              list[list.length - 1].classList.add('is-armed');
            } else {
              list[list.length - 1].remove();
              disarm();
              sync();
            }
            return;
          }
          disarm();
        });

        /* Pasting a list adds every entry in it. */
        on(field, 'paste', function (event) {
          var text = (event.clipboardData || window.clipboardData).getData('text');
          if (text.indexOf(separator) < 0 && text.indexOf('\n') < 0) return;
          event.preventDefault();
          text.split(/[\n]|,/).forEach(add);
        });

        on(field, 'blur', function () { add(field.value); disarm(); });
        /* The box is bigger than the field, so a click anywhere in it types. */
        on(box, 'click', function (event) {
          if (event.target === box) field.focus();
        });

        tags().forEach(function (chip) {
          chip.dataset.value = chip.dataset.value || chip.textContent.trim();
          var remove = $('.chip-remove', chip);
          if (remove) on(remove, 'click', function () { chip.remove(); sync(); field.focus(); });
        });
        sync();
      });
    },

    /* data-number on a .number-input drives the custom spinners, which exist
       because the native ones cannot be themed. */
    numberStepper: function (root) {
      $$('[data-number]', root).forEach(function (wrap) {
        if (!claim(wrap, 'Number')) return;
        var field = $('.number-input-field', wrap) || $('input', wrap);
        var up = $('.number-step-up', wrap);
        var down = $('.number-step-down', wrap);
        if (!field) return;

        var step = parseFloat(field.getAttribute('step')) || 1;
        var min = field.hasAttribute('min') ? parseFloat(field.getAttribute('min')) : -Infinity;
        var max = field.hasAttribute('max') ? parseFloat(field.getAttribute('max')) : Infinity;
        /* Decimal places are taken from the step so .1 + .2 never shows up. */
        var places = (String(step).split('.')[1] || '').length;
        /* The change this fires is the same one the field listens to in order
           to normalize a typed value, so it has to be able to tell the two
           apart or it would re-enter itself for ever. */
        var setting = false;

        /* The field ships as type="number" so that it still steps and still
           gets a numeric keypad with the script turned off. Once the script
           is here the native spinners are redundant -- they are hidden in the
           stylesheet, and the arrow keys below replace them -- so the type is
           downgraded to text.

           That downgrade is not cosmetic. A number field refuses
           setSelectionRange, and Firefox selects the whole value whenever
           focus arrives from script rather than from a click: pressing a step
           button left the field flooded with selection highlight that only a
           click elsewhere would clear. A text field lets the caret be put
           back where it belongs. role="spinbutton" and the value attributes
           below carry to assistive tech what the type no longer does. */
        if (field.type === 'number') {
          field.type = 'text';
          field.setAttribute('inputmode', step % 1 === 0 ? 'numeric' : 'decimal');
        }
        field.setAttribute('role', 'spinbutton');
        field.setAttribute('autocomplete', 'off');
        if (min > -Infinity) field.setAttribute('aria-valuemin', String(min));
        if (max < Infinity) field.setAttribute('aria-valuemax', String(max));

        function value() {
          var parsed = parseFloat(field.value);
          return isNaN(parsed) ? (min > -Infinity ? min : 0) : parsed;
        }

        function set(next) {
          next = Math.min(max, Math.max(min, next));
          field.value = next.toFixed(places);
          setting = true;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          setting = false;
          reflect();
        }

        function reflect() {
          var now = value();
          if (up) up.disabled = now + step > max + 1e-9;
          if (down) down.disabled = now - step < min - 1e-9;
          field.setAttribute('aria-valuenow', String(now));
        }

        /* Focus belongs on the field after a step -- the field is the control,
           and the next press of an arrow key should land there. Putting the
           caret at the end keeps that from reading as a selection. */
        function focusField() {
          field.focus();
          try {
            var end = field.value.length;
            field.setSelectionRange(end, end);
          } catch (e) { /* a type that refuses a caret; nothing to collapse */ }
        }

        if (up) {
          up.setAttribute('aria-label', up.getAttribute('aria-label') || 'Increase');
          up.setAttribute('tabindex', '-1');
          on(up, 'click', function () { set(value() + step); focusField(); });
        }
        if (down) {
          down.setAttribute('aria-label', down.getAttribute('aria-label') || 'Decrease');
          down.setAttribute('tabindex', '-1');
          on(down, 'click', function () { set(value() - step); focusField(); });
        }

        /* The arrow keys the native spinners came with, reimplemented: the
           field is no longer type="number" and would otherwise do nothing.
           Page steps by ten, Home and End go to the bounds. */
        on(field, 'keydown', function (event) {
          var delta = 0;
          if (event.key === 'ArrowUp') delta = step;
          else if (event.key === 'ArrowDown') delta = -step;
          else if (event.key === 'PageUp') delta = step * 10;
          else if (event.key === 'PageDown') delta = -step * 10;
          else if (event.key === 'Home' && min > -Infinity) { event.preventDefault(); set(min); return; }
          else if (event.key === 'End' && max < Infinity) { event.preventDefault(); set(max); return; }
          if (!delta) return;
          event.preventDefault();
          set(value() + delta);
        });

        /* Keeps the box numeric without a change handler having to undo a
           paste: anything that is not part of a number never lands. */
        on(field, 'beforeinput', function (event) {
          if (!event.data) return;
          if (/^[-+0-9.,eE]*$/.test(event.data)) return;
          event.preventDefault();
        });

        on(field, 'input', reflect);
        /* Clamps and rounds whatever was typed, once the field is committed. */
        on(field, 'change', function () {
          if (setting || field.value === '') return;
          set(value());
        });
        reflect();
      });
    },

    /* data-rating paints a radio group as stars and reports the choice. */
    rating: function (root) {
      $$('[data-rating]', root).forEach(function (group) {
        if (!claim(group, 'Rating')) return;
        var stars = $$('.rating-star', group);
        var output = group.getAttribute('data-rating-output')
          ? document.getElementById(group.getAttribute('data-rating-output'))
          : $('.rating-value', group.parentNode || group);
        var labels = (group.getAttribute('data-rating-labels') || '').split('|');

        function chosen() {
          var index = stars.findIndex(function (star) {
            var radio = $('input', star);
            return radio && radio.checked;
          });
          return index + 1;
        }

        function paint(upTo) {
          stars.forEach(function (star, index) {
            var on_ = index < upTo;
            star.classList.toggle('is-on', on_);
            var icon = $('.icon', star);
            if (icon) icon.textContent = on_ ? 'star' : 'star_border';
          });
        }

        function report() {
          var value = chosen();
          paint(value);
          if (output) {
            output.textContent = value
              ? (labels[value - 1] || (value + ' of ' + stars.length))
              : 'Not rated';
          }
        }

        stars.forEach(function (star, index) {
          var radio = $('input', star);
          if (radio) {
            on(radio, 'change', report);
            /* A keyboard user lands on the group, so the arrows must preview
               as they move, not only on commit. */
            on(radio, 'focus', function () { paint(index + 1); });
            on(radio, 'blur', report);
          }
          on(star, 'mouseenter', function () { paint(index + 1); });
        });
        on(group, 'mouseleave', report);
        report();
      });
    },

    /* data-otp on an .otp spreads one code across several single-character
       boxes while behaving, to the person typing, like one field. */
    otp: function (root) {
      $$('[data-otp]', root).forEach(function (group) {
        if (!claim(group, 'Otp')) return;
        var slots = $$('.otp-slot', group);
        if (!slots.length) return;

        var hidden = $('input[data-otp-value]', group) ||
                     (group.getAttribute('data-otp-value')
                       ? document.getElementById(group.getAttribute('data-otp-value'))
                       : null);
        var numeric = group.getAttribute('data-otp-type') !== 'text';

        function sync() {
          var code = slots.map(function (slot) { return slot.value; }).join('');
          slots.forEach(function (slot) { slot.classList.toggle('is-filled', !!slot.value); });
          if (hidden) {
            hidden.value = code;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (code.length === slots.length) {
            group.dataset.complete = 'true';
            group.dispatchEvent(new CustomEvent('ui:otp', { bubbles: true, detail: { code: code } }));
          } else {
            group.dataset.complete = 'false';
          }
        }

        slots.forEach(function (slot, index) {
          slot.setAttribute('maxlength', '1');
          slot.setAttribute('autocomplete', index === 0 ? 'one-time-code' : 'off');
          slot.setAttribute('aria-label', 'Digit ' + (index + 1) + ' of ' + slots.length);
          if (numeric) {
            slot.setAttribute('inputmode', 'numeric');
            slot.setAttribute('pattern', '[0-9]*');
          }

          on(slot, 'input', function () {
            if (numeric) slot.value = slot.value.replace(/[^0-9]/g, '');
            /* A character typed over a full box should land in the next one. */
            if (slot.value.length > 1) slot.value = slot.value.slice(-1);
            if (slot.value && index < slots.length - 1) slots[index + 1].focus();
            sync();
          });

          on(slot, 'keydown', function (event) {
            if (event.key === 'Backspace' && !slot.value && index > 0) {
              event.preventDefault();
              slots[index - 1].value = '';
              slots[index - 1].focus();
              sync();
            } else {
              /* The digits of a code are entered in reading order, so the
                 arrow keys swap with the direction like any other row. */
              var step = inlineStep(event, slot);
              var next = index + step;
              if (step && next >= 0 && next < slots.length) {
                event.preventDefault();
                slots[next].focus();
              }
            }
          });

          /* One paste of the whole code fills every box. */
          on(slot, 'paste', function (event) {
            event.preventDefault();
            var text = (event.clipboardData || window.clipboardData).getData('text');
            if (numeric) text = text.replace(/[^0-9]/g, '');
            text.split('').slice(0, slots.length - index).forEach(function (char, offset) {
              slots[index + offset].value = char;
            });
            var last = Math.min(index + text.length, slots.length - 1);
            slots[last].focus();
            sync();
          });

          on(slot, 'focus', function () { slot.select(); });
        });

        sync();
      });
    },

    /* data-speed-dial fans a floating action button out into its actions. */
    speedDial: function (root) {
      $$('[data-speed-dial]', root).forEach(function (dial) {
        if (!claim(dial, 'SpeedDial')) return;
        var trigger = $('.speed-dial-trigger', dial);
        if (!trigger) return;

        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-haspopup', 'true');
        dial.dataset.open = 'false';

        function setOpen(open) {
          dial.dataset.open = String(open);
          trigger.setAttribute('aria-expanded', String(open));
          /* Collapsed actions are out of the tab order as well as invisible. */
          $$('.speed-dial-action .button', dial).forEach(function (button) {
            button.tabIndex = open ? 0 : -1;
          });
        }

        on(trigger, 'click', function (event) {
          event.stopPropagation();
          setOpen(dial.dataset.open !== 'true');
        });
        on(dial, 'click', function (event) { event.stopPropagation(); });
        $$('.speed-dial-action .button', dial).forEach(function (button) {
          on(button, 'click', function () { setOpen(false); });
        });
        setOpen(false);
      });
    },

    /* data-inline-edit swaps a label for a field in place, so a correction
       costs one click rather than a trip to a form. */
    inlineEdit: function (root) {
      $$('[data-inline-edit]', root).forEach(function (wrap) {
        if (!claim(wrap, 'InlineEdit')) return;
        var display = $('.inline-edit-value', wrap);
        var form = $('.inline-edit-form', wrap);
        var field = form && $('input, textarea, select', form);
        var text = display && ($('[data-inline-edit-text]', display) || display);
        if (!display || !form || !field) return;

        var committed = field.value;

        function edit() {
          wrap.dataset.editing = 'true';
          field.value = committed;
          field.focus();
          if (field.select) field.select();
        }

        function save() {
          committed = field.value;
          if (text) text.textContent = committed || display.getAttribute('data-empty') || '—';
          wrap.dataset.editing = 'false';
          display.focus();
          wrap.dispatchEvent(new CustomEvent('ui:edited', { bubbles: true, detail: { value: committed } }));
        }

        function cancel() {
          field.value = committed;
          wrap.dataset.editing = 'false';
          display.focus();
        }

        on(display, 'click', edit);
        on(field, 'keydown', function (event) {
          if (event.key === 'Enter' && field.tagName !== 'TEXTAREA') { event.preventDefault(); save(); }
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
        });
        /* Clicking away saves, which is what people expect of an in-place
           edit; Escape is the way to back out. */
        on(field, 'blur', function () {
          window.setTimeout(function () {
            if (wrap.contains(document.activeElement)) return;
            if (wrap.dataset.editing === 'true') save();
          }, 100);
        });

        var saveButton = $('[data-inline-save]', form);
        var cancelButton = $('[data-inline-cancel]', form);
        if (saveButton) on(saveButton, 'click', save);
        if (cancelButton) on(cancelButton, 'click', cancel);

        wrap.dataset.editing = 'false';
        if (text && !text.textContent.trim()) text.textContent = committed;
      });
    },

    /* data-reorder makes a .sortable list draggable by pointer and movable by
       keyboard from the handle, which is the only path that works without a
       mouse. Pointer events rather than HTML5 drag-and-drop, because the
       latter does nothing on touch. */
    reorder: function (root) {
      $$('[data-reorder]', root).forEach(function (list) {
        if (!claim(list, 'Reorder')) return;
        var live = $('[data-reorder-status]', list.parentNode || list);
        var dragging = null;
        var session = null;

        function items() { return $$('.sortable-item', list); }

        function renumber() {
          items().forEach(function (item, index) {
            var slot = $('.sortable-position', item);
            if (slot) slot.textContent = (index + 1) + ' of ' + items().length;
            var handle = $('.sortable-handle', item);
            if (handle) {
              handle.setAttribute('aria-label',
                'Reorder ' + label(item) + ', position ' + (index + 1) + ' of ' + items().length);
            }
          });
        }

        function label(item) {
          var text = $('.sortable-item-text', item);
          return (text ? text.textContent : item.textContent).trim().split('\n')[0];
        }

        function announce(message) {
          if (live) live.textContent = message;
        }

        /* --- pointer dragging ----------------------------------------- */
        items().forEach(wire);

        function wire(item) {
          var handle = $('.sortable-handle', item) || item;
          if (!claim(handle, 'ReorderHandle')) return;

          handle.setAttribute('role', 'button');
          handle.setAttribute('tabindex', '0');
          handle.setAttribute('aria-roledescription', 'reorder handle');

          /* Where the row would land, from a pointer position rather than
             from an event: auto-scroll moves the list under a pointer that is
             standing still, so this has to be callable with no event to hand
             — which is what the lift passes it as `update`. */
          function hintAt(x, y) {
            var over = items().find(function (other) {
              if (other === item) return false;
              var rect = other.getBoundingClientRect();
              return y >= rect.top && y <= rect.bottom;
            });
            items().forEach(function (other) {
              other.classList.remove('is-over', 'is-over-below');
            });
            if (!over) return;
            var rect = over.getBoundingClientRect();
            var below = y > rect.top + rect.height / 2;
            over.classList.add(below ? 'is-over-below' : 'is-over');
          }

          on(handle, 'pointerdown', function (event) {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            /* One row at a time. A second finger landing on another handle
               would otherwise take over `dragging` and strand the first row
               in the air with nothing left holding a reference to it. */
            if (dragging) return;
            event.preventDefault();
            dragging = item;
            item.classList.add('is-dragging');
            handle.setPointerCapture(event.pointerId);
            /* Locked to the vertical: the list only reorders one way, so
               sideways travel is drift the row did not ask for. */
            session = lift({
              element: item,
              clientX: event.clientX,
              clientY: event.clientY,
              axis: 'y',
              update: hintAt
            });
          });

          on(handle, 'pointermove', function (event) {
            if (dragging !== item) return;
            /* Lifted, the session drives the hints on its own frames so that
               scrolling updates them too. Unlifted, this is the only pass. */
            if (session) session.move(event);
            else hintAt(event.clientX, event.clientY);
          });

          on(handle, 'pointerup', function (event) {
            if (dragging !== item) return;
            var target = items().find(function (other) {
              return other.classList.contains('is-over') || other.classList.contains('is-over-below');
            });
            if (target) {
              var below = target.classList.contains('is-over-below');
              list.insertBefore(item, below ? target.nextSibling : target);
              announce(label(item) + ' moved to position ' + (items().indexOf(item) + 1));
            }
            /* After the move, never before: drop() measures where the row
               ended up so it can settle into it. */
            if (session) { session.drop(); session = null; }
            items().forEach(function (other) {
              other.classList.remove('is-over', 'is-over-below', 'is-dragging');
            });
            dragging = null;
            renumber();
            if (handle.hasPointerCapture && handle.hasPointerCapture(event.pointerId)) {
              handle.releasePointerCapture(event.pointerId);
            }
          });

          /* A capture that ends without a pointerup — the pointer leaving the
             window, a touch taken over by a system gesture. Without this the
             row stays stuck to a pointer that is no longer there. */
          on(handle, 'pointercancel', function () {
            if (dragging !== item) return;
            if (session) { session.drop(); session = null; }
            items().forEach(function (other) {
              other.classList.remove('is-over', 'is-over-below', 'is-dragging');
            });
            dragging = null;
            announce('Move canceled');
          });

          /* --- keyboard moving ---------------------------------------- */
          on(handle, 'keydown', function (event) {
            var grabbed = item.classList.contains('is-grabbed');

            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              item.classList.toggle('is-grabbed');
              handle.setAttribute('aria-pressed', String(!grabbed));
              announce(grabbed
                ? label(item) + ' dropped at position ' + (items().indexOf(item) + 1)
                : label(item) + ' picked up. Use the arrow keys to move it, then Enter to drop it.');
              return;
            }
            if (event.key === 'Escape' && grabbed) {
              item.classList.remove('is-grabbed');
              handle.setAttribute('aria-pressed', 'false');
              announce('Move canceled');
              return;
            }
            if (!grabbed) return;
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

            event.preventDefault();
            var up = event.key === 'ArrowUp';
            var sibling = up ? item.previousElementSibling : item.nextElementSibling;
            if (!sibling) return;
            list.insertBefore(up ? item : sibling, up ? sibling : item);
            renumber();
            handle.focus();
            /* The keyboard half of a lift: the row itself moves, so it needs
               no proxy, but a list taller than its scroller still has to
               follow it or the row walks off the end out of sight. */
            keepInView(item);
            announce(label(item) + ' moved to position ' + (items().indexOf(item) + 1));
          });
        }

        renumber();
      });
    },

    /* data-load-more reveals the next batch of an already-rendered list. The
       items are in the markup and hidden, which keeps the demo honest about
       the pattern without needing a server. */
    loadMore: function (root) {
      $$('[data-load-more]', root).forEach(function (button) {
        if (!claim(button, 'LoadMore')) return;
        var list = document.getElementById(button.getAttribute('data-load-more'));
        if (!list) return;
        var batch = parseInt(button.getAttribute('data-batch'), 10) || 5;
        var counter = button.parentNode && $('[data-load-more-count]', button.parentNode);
        var end = button.parentNode && $('.list-end', button.parentNode);

        function rows() { return Array.prototype.slice.call(list.children); }

        function reveal() {
          var hiddenRows = rows().filter(function (row) { return row.hidden; });
          hiddenRows.slice(0, batch).forEach(function (row) { row.hidden = false; });
          var remaining = rows().filter(function (row) { return row.hidden; }).length;
          var shown = rows().length - remaining;
          if (counter) counter.textContent = 'Showing ' + shown + ' of ' + rows().length;
          if (!remaining) {
            button.hidden = true;
            if (end) end.hidden = false;
          }
          /* Focus the first newly revealed row so the keyboard does not jump
             back to the top of the list. */
          if (hiddenRows.length) {
            var first = hiddenRows[0];
            if (!first.hasAttribute('tabindex')) first.setAttribute('tabindex', '-1');
            first.focus({ preventScroll: true });
          }
          return remaining;
        }

        on(button, 'click', reveal);
        var remaining = rows().filter(function (row) { return row.hidden; }).length;
        if (counter) counter.textContent = 'Showing ' + (rows().length - remaining) + ' of ' + rows().length;
        if (!remaining) { button.hidden = true; if (end) end.hidden = false; }
      });
    },

    /* data-infinite watches a sentinel and appends the next batch when it
       scrolls into view. The observer is disconnected at the end of the data,
       so an exhausted list stops costing anything. */
    infiniteList: function (root) {
      $$('[data-infinite]', root).forEach(function (sentinel) {
        if (!claim(sentinel, 'Infinite')) return;
        var list = document.getElementById(sentinel.getAttribute('data-infinite'));
        if (!list || !window.IntersectionObserver) return;
        var batch = parseInt(sentinel.getAttribute('data-batch'), 10) || 8;
        var end = sentinel.parentNode && $('.list-end', sentinel.parentNode);
        var busy = false;

        function remaining() {
          return Array.prototype.slice.call(list.children).filter(function (row) { return row.hidden; });
        }

        var observer = new IntersectionObserver(function (entries) {
          if (!entries[0].isIntersecting || busy) return;
          var queue = remaining();
          if (!queue.length) {
            observer.disconnect();
            sentinel.hidden = true;
            if (end) end.hidden = false;
            return;
          }
          /* A deliberate pause, so the loading row is visible rather than
             flashing. A real implementation is waiting on the network here. */
          busy = true;
          window.setTimeout(function () {
            queue.slice(0, batch).forEach(function (row) { row.hidden = false; });
            busy = false;
            if (!remaining().length) {
              observer.disconnect();
              sentinel.hidden = true;
              if (end) end.hidden = false;
            }
          }, 400);
        }, { root: sentinel.closest('[data-infinite-root]') || null, rootMargin: '120px' });

        observer.observe(sentinel);
      });
    },

    /* data-virtual-list renders only the rows in view. The sizer carries the
       full height so the scrollbar stays honest, and the window is offset to
       sit under the viewport. Row markup comes from a <template> whose
       {{index}} and {{n}} tokens are substituted per row. */
    virtualList: function (root) {
      $$('[data-virtual-list]', root).forEach(function (frame) {
        if (!claim(frame, 'VirtualList')) return;
        var sizer = $('.virtual-list-sizer', frame);
        var window_ = $('.virtual-list-window', frame);
        var template = $('template', frame);
        if (!sizer || !window_) return;

        var count = parseInt(frame.getAttribute('data-count'), 10) || 1000;
        var rowHeight = parseInt(frame.getAttribute('data-row-height'), 10) || 48;
        /* A few rows above and below, so a fast scroll does not show gaps. */
        var overscan = 4;
        var last = { start: -1, end: -1 };

        sizer.style.height = (count * rowHeight) + 'px';
        frame.setAttribute('role', 'list');
        frame.setAttribute('aria-rowcount', String(count));

        function row(index) {
          var node;
          if (template) {
            node = template.content.firstElementChild.cloneNode(true);
            node.innerHTML = node.innerHTML
              .replace(/\{\{index\}\}/g, String(index))
              .replace(/\{\{n\}\}/g, String(index + 1));
          } else {
            node = document.createElement('div');
            node.className = 'virtual-row';
            node.textContent = 'Row ' + (index + 1);
          }
          node.style.height = rowHeight + 'px';
          node.setAttribute('role', 'listitem');
          node.setAttribute('aria-rowindex', String(index + 1));
          return node;
        }

        function render() {
          var start = Math.max(0, Math.floor(frame.scrollTop / rowHeight) - overscan);
          var visible = Math.ceil(frame.clientHeight / rowHeight) + overscan * 2;
          var end = Math.min(count, start + visible);
          /* Re-rendering only when the window actually moved keeps a smooth
             scroll from rebuilding the same rows on every frame. */
          if (start === last.start && end === last.end) return;
          last = { start: start, end: end };

          var fragment = document.createDocumentFragment();
          for (var i = start; i < end; i++) fragment.appendChild(row(i));
          window_.innerHTML = '';
          window_.appendChild(fragment);
          window_.style.transform = 'translateY(' + (start * rowHeight) + 'px)';
        }

        var queued = false;
        on(frame, 'scroll', function () {
          if (queued) return;
          queued = true;
          window.requestAnimationFrame(function () { queued = false; render(); });
        });
        on(window, 'resize', render);
        render();
      });
    },

    /* data-consent shows the cookie notice until a choice is stored. */
    consent: function (root) {
      $$('[data-consent]', root).forEach(function (banner) {
        if (!claim(banner, 'Consent')) return;
        var key = banner.getAttribute('data-consent') || 'design-language-consent';
        var inline = banner.classList.contains('consent-inline');

        function stored() {
          try { return localStorage.getItem(key); } catch (e) { return null; }
        }
        function store(value) {
          try { localStorage.setItem(key, value); } catch (e) {}
        }

        function decide(value) {
          store(value);
          if (!inline) banner.dataset.open = 'false';
          banner.dispatchEvent(new CustomEvent('ui:consent', { bubbles: true, detail: { choice: value } }));
        }

        $$('[data-consent-accept]', banner).forEach(function (button) {
          on(button, 'click', function () { decide('accepted'); });
        });
        $$('[data-consent-reject]', banner).forEach(function (button) {
          on(button, 'click', function () { decide('rejected'); });
        });

        /* The demo needs a way back; a real banner would not offer this. */
        $$('[data-consent-reset="' + key + '"]').forEach(function (button) {
          if (!claim(button, 'ConsentReset')) return;
          on(button, 'click', function () {
            try { localStorage.removeItem(key); } catch (e) {}
            if (!inline) banner.dataset.open = 'true';
            toast('Consent cleared — the banner is showing again.');
          });
        });

        if (inline) return;
        if (stored()) { banner.dataset.open = 'false'; return; }
        /* A beat after load, so it does not fight the page appearing. */
        window.setTimeout(function () { banner.dataset.open = 'true'; }, 600);
      });
    },

    /* data-toolbar gives a strip of controls one tab stop with arrow-key
       movement inside it — the WAI-ARIA toolbar pattern — and moves whatever
       stops fitting into an overflow menu.

       Roving tabindex is the point. A twelve-button strip that is twelve tab
       stops puts twelve presses between the strip and the content under it,
       which is why a toolbar is not just a .button-group with a border. */
    toolbar: function (root) {
      $$('[data-toolbar]', root).forEach(function (bar) {
        if (!claim(bar, 'Toolbar')) return;
        if (!bar.getAttribute('role')) bar.setAttribute('role', 'toolbar');
        if (!bar.getAttribute('aria-label') && !bar.getAttribute('aria-labelledby')) {
          bar.setAttribute('aria-label', 'Toolbar');
        }

        var overflow = $('.toolbar-overflow', bar);
        var trigger = overflow && $('[data-menu]', overflow);
        var list = overflow && $('.menu', overflow);
        var vertical = bar.classList.contains('toolbar-vertical');

        /* Everything reachable right now: disabled controls are skipped
           rather than focused, and collapsed ones are not in the strip. */
        function items() {
          return $$('.toolbar-button, .button', bar).filter(function (el) {
            if (el.disabled || el.hasAttribute('disabled')) return false;
            if (el.classList.contains('toolbar-collapsed')) return false;
            if (el === trigger) return bar.classList.contains('has-overflow');
            if (overflow && overflow.contains(el)) return false;
            return true;
          });
        }

        /* Exactly one item carries tabindex 0, so Tab enters the strip once
           and leaves it once. */
        function rove(active) {
          var all = items();
          /* A button with no tabindex attribute is a tab stop by default, so
             everything the strip is not currently offering has to be taken
             out explicitly — the hidden overflow trigger above all, which is
             otherwise a second tab stop leading nowhere. */
          $$('.toolbar-button, .button', bar).forEach(function (el) {
            if (all.indexOf(el) < 0) el.tabIndex = -1;
          });
          if (!all.length) return;
          var target = all.indexOf(active) >= 0 ? active : null;
          if (!target) {
            target = all.filter(function (el) { return el.tabIndex === 0; })[0] || all[0];
          }
          all.forEach(function (el) { el.tabIndex = el === target ? 0 : -1; });
          return target;
        }

        function focusItem(el) {
          if (!el) return;
          rove(el);
          el.focus();
        }

        on(bar, 'keydown', function (event) {
          var item = event.target.closest('.toolbar-button, .button');
          if (!item || !bar.contains(item)) return;

          var all = items();
          var at = all.indexOf(item);
          if (at < 0) return;

          /* A vertical strip reads top to bottom, so it takes the vertical
             keys and direction never enters into it. */
          var step = vertical
            ? ({ ArrowUp: -1, ArrowDown: 1 }[event.key] || 0)
            : inlineStep(event, bar);

          if (step) {
            event.preventDefault();
            /* Wrapping, which is what the pattern specifies for a toolbar. */
            focusItem(all[(at + step + all.length) % all.length]);
            return;
          }
          if (event.key === 'Home') { event.preventDefault(); focusItem(all[0]); return; }
          if (event.key === 'End')  { event.preventDefault(); focusItem(all[all.length - 1]); }
        });

        on(bar, 'click', function (event) {
          var item = event.target.closest('.toolbar-button, .button');
          if (!item || !bar.contains(item) || item.disabled) return;
          /* The last thing used becomes the tab stop, so coming back by Tab
             returns to where the work was left off. */
          rove(item);
          var toggle = item.closest('[data-toolbar-toggle]');
          if (toggle && bar.contains(toggle)) {
            toggle.setAttribute('aria-pressed',
              String(toggle.getAttribute('aria-pressed') !== 'true'));
          }
        });

        /* A menu row that stands in for a collapsed control. It is a proxy,
           not a move: the real button keeps its state and its listeners, and
           the row simply clicks it. */
        function mirror(el) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'menu-item';
          var icon = $('.icon', el);
          if (icon) {
            var copy = document.createElement('span');
            copy.className = 'icon icon-sm';
            copy.textContent = icon.textContent;
            row.appendChild(copy);
          }
          var text = document.createElement('span');
          text.textContent = (el.getAttribute('aria-label') ||
                              el.getAttribute('title') || el.textContent || '').trim();
          row.appendChild(text);
          if (el.hasAttribute('aria-pressed')) {
            row.setAttribute('aria-pressed', el.getAttribute('aria-pressed'));
          }
          on(row, 'click', function () {
            el.click();
            /* The shared menu behavior bound its dismissal to the rows that
               existed at init, and this row did not, so it closes itself. */
            if (list) list.dataset.open = 'false';
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
          });
          return row;
        }

        /* Collapse from the end until the strip fits. Everything is shown
           first: measuring a strip that is already collapsed only ever says
           it fits, so nothing would come back when the window grew. */
        function reflow() {
          if (!overflow || !list || !trigger) return;
          var candidates = $$('[data-toolbar-overflowable]', bar);
          if (!candidates.length) return;

          /* A wrapping strip never overflows — it grows a second row instead —
             so the measurement below would always report that everything fits
             and nothing would ever collapse. The two are alternatives: wrap
             when every command should stay visible, overflow when the strip
             must stay one row high. */
          if (window.getComputedStyle(bar).flexWrap === 'wrap') return;

          candidates.forEach(function (el) { el.classList.remove('toolbar-collapsed'); });
          bar.classList.remove('has-overflow');
          list.textContent = '';

          if (bar.scrollWidth <= bar.clientWidth + 1) { rove(); return; }

          /* The overflow button needs room of its own, so it is shown before
             the measuring loop rather than after it. */
          bar.classList.add('has-overflow');
          for (var i = candidates.length - 1; i >= 0; i--) {
            if (bar.scrollWidth <= bar.clientWidth + 1) break;
            candidates[i].classList.add('toolbar-collapsed');
          }

          var hidden = candidates.filter(function (el) {
            return el.classList.contains('toolbar-collapsed');
          });
          if (!hidden.length) { bar.classList.remove('has-overflow'); rove(); return; }
          hidden.forEach(function (el) { list.appendChild(mirror(el)); });
          rove();
        }

        rove();
        if (overflow && window.ResizeObserver) {
          /* Observing the strip rather than the window catches a toolbar that
             narrows because a panel beside it grew, which no resize event
             would report. */
          var pending = false;
          new ResizeObserver(function () {
            /* The reflow changes the box being observed, so it is deferred to
               the next frame to keep the observer from re-entering. */
            if (pending) return;
            pending = true;
            window.requestAnimationFrame(function () { pending = false; reflow(); });
          }).observe(bar);
        }
        bar._uiToolbarReflow = reflow;
      });
    },

    /* data-editor turns a .toolbar plus a contenteditable surface into a rich
       text field.

       The formatting goes through document.execCommand, which is deprecated
       and still the only way to apply a command to a selection without
       shipping a text engine: nothing replaced it. Every browser supports the
       handful of commands used here, and the consequence of the deprecation
       is that the markup produced varies slightly between engines, so the
       value is read back as HTML and not relied on to be identical. */
    editor: function (root) {
      $$('[data-editor]', root).forEach(function (editor) {
        if (!claim(editor, 'Editor')) return;
        var surface = $('.editor-surface', editor);
        if (!surface) return;
        var bar = $('.toolbar', editor);
        var output = $('[data-editor-output]', editor);
        var counter = $('[data-editor-count]', editor);

        surface.setAttribute('contenteditable', 'true');
        surface.setAttribute('role', 'textbox');
        surface.setAttribute('aria-multiline', 'true');
        if (!surface.getAttribute('aria-label') && !surface.getAttribute('aria-labelledby')) {
          surface.setAttribute('aria-label', editor.getAttribute('data-editor') || 'Rich text');
        }

        /* Without this, Enter produces a <div> in Chromium and a <br> run in
           Safari; with it, all three engines produce paragraphs. */
        try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

        var BLOCKS = { h2: 'H2', h3: 'H3', p: 'P', blockquote: 'BLOCKQUOTE', pre: 'PRE' };

        function run(command, value) {
          surface.focus();
          try { document.execCommand(command, false, value == null ? null : value); }
          catch (e) { /* An unsupported command leaves the text untouched. */ }
          sync();
        }

        /* Which toggles are on for the current selection. queryCommandState
           throws in some engines when the selection is outside the surface,
           so every read is guarded and a failure just leaves the button as it
           was rather than reporting a wrong state. */
        function refresh() {
          if (!bar) return;
          $$('[data-command]', bar).forEach(function (button) {
            var command = button.getAttribute('data-command');
            var value = button.getAttribute('data-command-value');
            var active = false;
            try {
              if (command === 'formatBlock') {
                var block = String(document.queryCommandValue('formatBlock') || '').toUpperCase();
                active = block === BLOCKS[String(value).toLowerCase()];
              } else {
                active = document.queryCommandState(command);
              }
            } catch (e) { return; }
            button.setAttribute('aria-pressed', String(!!active));
          });
        }

        function sync() {
          var text = surface.textContent.replace(/\s+/g, ' ').trim();
          /* contenteditable leaves a stray <br> behind when it is emptied, so
             emptiness is judged by the text and flagged for the placeholder
             rather than left to :empty. */
          surface.dataset.empty = String(!text);
          if (counter) {
            var words = text ? text.split(' ').length : 0;
            counter.textContent = words + (words === 1 ? ' word' : ' words');
          }
          if (output) output.value = surface.innerHTML;
          refresh();
        }

        if (bar) {
          $$('[data-command]', bar).forEach(function (button) {
            var command = button.getAttribute('data-command');
            var value = button.getAttribute('data-command-value');

            on(button, 'mousedown', function (event) {
              /* Taking focus would collapse the selection the command is
                 about to act on, so the button never takes it. */
              event.preventDefault();
            });

            on(button, 'click', function () {
              if (command === 'createLink') {
                var href = window.prompt('Link address', 'https://');
                if (!href) return;
                /* javascript: and data: URLs in a link are the one way a
                   pasted address can run code, so only ordinary web
                   addresses are accepted. */
                if (!/^(https?:|mailto:|tel:|\/|#)/i.test(href.trim())) {
                  toast('Only http, https, mailto, tel and relative links are allowed.', { variant: 'danger' });
                  return;
                }
                run('createLink', href.trim());
                return;
              }
              if (command === 'formatBlock') {
                /* Pressing the active block button again returns to a
                   paragraph, which is what a toggle should do. */
                var block = '';
                try { block = String(document.queryCommandValue('formatBlock') || '').toUpperCase(); } catch (e) {}
                var wanted = BLOCKS[String(value).toLowerCase()] || 'P';
                run('formatBlock', '<' + (block === wanted ? 'p' : wanted.toLowerCase()) + '>');
                return;
              }
              run(command, value);
            });
          });
        }

        /* Pasted HTML arrives as whatever the source page had: inline styles,
           classes, scripts, event attributes. Sanitising it properly needs a
           parser and an allow-list, which this kit does not ship, so the
           text is taken and the markup is not. */
        on(surface, 'paste', function (event) {
          event.preventDefault();
          var text = (event.clipboardData || window.clipboardData).getData('text/plain');
          run('insertText', text);
        });

        /* Keyboard shortcuts for the three that everyone expects. The rest
           are deliberately left to the toolbar. */
        on(surface, 'keydown', function (event) {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          var command = { b: 'bold', i: 'italic', u: 'underline' }[event.key.toLowerCase()];
          if (!command) return;
          event.preventDefault();
          run(command);
        });

        on(surface, 'input', sync);
        on(surface, 'blur', sync);
        on(surface, 'keyup', refresh);
        on(surface, 'mouseup', refresh);
        on(document, 'selectionchange', function () {
          if (surface.contains(document.activeElement) ||
              document.activeElement === surface) refresh();
        });

        sync();
      });
    },

    /* A command palette: one modal search over everything the page can do.
       Structurally it is a combobox that happens to be in a dialog — the
       input never loses focus, and the arrow keys move a selection it points
       at with aria-activedescendant.

       It is an accelerator and never the only route to a command. Anything
       reachable only from here is unreachable for anyone who has not been
       told it exists. */
    palette: function (root) {
      $$('[data-palette]', root).forEach(function (scrim) {
        if (!claim(scrim, 'Palette')) return;
        var panel = $('.palette', scrim);
        var input = $('.palette-input', scrim);
        var listbox = $('.palette-list', scrim);
        if (!panel || !input || !listbox) return;

        var empty = $('.palette-empty', scrim);
        var id = scrim.id || ('palette-' + Math.random().toString(36).slice(2, 8));
        scrim.id = id;

        var items = $$('.palette-item', listbox);
        var labels = $$('.palette-group-label', listbox);
        var active = null;

        listbox.setAttribute('role', 'listbox');
        listbox.id = listbox.id || (id + '-list');
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-controls', listbox.id);
        input.setAttribute('aria-autocomplete', 'list');
        labels.forEach(function (label) { label.setAttribute('role', 'presentation'); });

        items.forEach(function (item, index) {
          item.id = item.id || (id + '-item-' + index);
          item.setAttribute('role', 'option');
          item.setAttribute('aria-selected', 'false');
          /* The title is kept aside because the filter rewrites it with <mark>
             and the original text is needed again on the next keystroke. */
          var title = $('.palette-item-title', item);
          item._uiLabel = (title ? title.textContent : item.textContent).trim();
          item._uiHaystack = (item._uiLabel + ' ' +
            (item.getAttribute('data-keywords') || '') + ' ' +
            (item.getAttribute('data-group') || '')).toLowerCase();
        });

        function visible() {
          return items.filter(function (item) { return !item.hidden; });
        }

        function select(item) {
          active = item || null;
          items.forEach(function (other) {
            var on_ = other === active;
            other.classList.toggle('is-active', on_);
            other.setAttribute('aria-selected', String(on_));
          });
          /* The input keeps focus throughout, so the selection has to be
             reported rather than moved to. */
          if (active) {
            input.setAttribute('aria-activedescendant', active.id);
            active.scrollIntoView({ block: 'nearest' });
          } else {
            input.removeAttribute('aria-activedescendant');
          }
        }

        /* Marks the matched run inside the title. Built as nodes rather than
           as an HTML string, so a command whose name contains a < or an & is
           shown as written and cannot inject anything. */
        function paint(item, query) {
          var host = $('.palette-item-title', item);
          if (!host) return;
          var label = item._uiLabel;
          host.textContent = '';
          var at = query ? label.toLowerCase().indexOf(query) : -1;
          if (at < 0) { host.textContent = label; return; }
          host.appendChild(document.createTextNode(label.slice(0, at)));
          var mark = document.createElement('mark');
          mark.textContent = label.slice(at, at + query.length);
          host.appendChild(mark);
          host.appendChild(document.createTextNode(label.slice(at + query.length)));
        }

        function filter() {
          var query = input.value.trim().toLowerCase();
          items.forEach(function (item) {
            item.hidden = !!query && item._uiHaystack.indexOf(query) < 0;
            if (!item.hidden) paint(item, query);
          });
          /* A group heading with nothing left under it is noise, so it is
             hidden with its last item. */
          labels.forEach(function (label) {
            var group = label.getAttribute('data-group');
            label.hidden = !items.some(function (item) {
              return !item.hidden && item.getAttribute('data-group') === group;
            });
          });
          var shown = visible();
          if (empty) empty.hidden = shown.length > 0;
          select(shown[0] || null);
        }

        function open() {
          if (scrim.dataset.open === 'true') return;
          scrim.dataset.open = 'true';
          input.value = '';
          filter();
          /* The palette brings its own backdrop, so the shared scrim is not
             used; the page behind it is made inert by the focus trap. */
          document.body.style.overflow = 'hidden';
          trapFocus(panel);
          input.focus();
        }

        function close() {
          if (scrim.dataset.open !== 'true') return;
          scrim.dataset.open = 'false';
          document.body.style.overflow = '';
          releaseFocus(panel);
        }

        function run(item) {
          if (!item) return;
          close();
          var href = item.getAttribute('data-href');
          /* The command is dispatched rather than performed, so a page wires
             up what each one does without this file knowing any of them. */
          item.dispatchEvent(new CustomEvent('ui:command', {
            bubbles: true,
            detail: { command: item.getAttribute('data-command') || item._uiLabel, label: item._uiLabel }
          }));
          if (href) window.location.href = href;
        }

        on(input, 'input', filter);

        on(input, 'keydown', function (event) {
          var shown = visible();
          var at = shown.indexOf(active);

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!shown.length) return;
            var step = event.key === 'ArrowDown' ? 1 : -1;
            select(shown[(at + step + shown.length) % shown.length]);
            return;
          }
          if (event.key === 'Home') { event.preventDefault(); select(shown[0]); return; }
          if (event.key === 'End')  { event.preventDefault(); select(shown[shown.length - 1]); return; }
          if (event.key === 'Enter') { event.preventDefault(); run(active); return; }
          if (event.key === 'Escape') { event.preventDefault(); close(); }
        });

        /* The pointer moves the same selection the arrow keys do, so there is
           never a hovered row and a selected row disagreeing about what Enter
           is going to run. */
        on(listbox, 'mousemove', function (event) {
          var item = event.target.closest('.palette-item');
          if (item && item !== active && !item.hidden) select(item);
        });
        on(listbox, 'click', function (event) {
          var item = event.target.closest('.palette-item');
          if (item && !item.hidden) run(item);
        });

        on(scrim, 'mousedown', function (event) {
          if (event.target === scrim) close();
        });

        $$('[data-palette-open="' + id + '"]').forEach(function (button) {
          if (!claim(button, 'PaletteOpen')) return;
          on(button, 'click', open);
        });

        /* The shortcut is bound on the document because the palette's whole
           purpose is to be reachable without first finding anything. */
        var combo = (scrim.getAttribute('data-palette-key') || 'k').toLowerCase();
        on(document, 'keydown', function (event) {
          if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
          if (event.key.toLowerCase() !== combo) return;
          event.preventDefault();
          if (scrim.dataset.open === 'true') close(); else open();
        });

        scrim._uiPalette = { open: open, close: close };
      });
    },

    /* data-lightbox on a collection, data-lightbox-item on each member. The
       viewer itself is created once and shared, so a page with a gallery only
       needs the gallery markup.

       It is modal, so it takes the dialog contract: a focus trap, Escape to
       dismiss, the page behind it inert, and focus returned to the thumbnail
       that opened it rather than to the top of the document. */
    lightbox: function (root) {
      var box = $('.lightbox');

      function build() {
        /* Built here rather than required in every page's markup, the same
           way the shared .scrim is. The structure is documented on the media
           page for anyone who would rather write it out. */
        var el = document.createElement('div');
        el.className = 'lightbox';
        el.dataset.open = 'false';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.setAttribute('aria-label', 'Image viewer');
        el.innerHTML =
          '<div class="lightbox-header">' +
            '<span class="lightbox-count" data-lightbox-count></span>' +
            '<span class="lightbox-title" data-lightbox-title></span>' +
            '<span class="grow"></span>' +
            '<button class="button button-icon" type="button" data-lightbox-close aria-label="Close viewer">' +
              '<span class="icon">close</span></button>' +
          '</div>' +
          '<div class="lightbox-stage">' +
            '<button class="lightbox-step lightbox-prev" type="button" data-lightbox-prev aria-label="Previous image">' +
              '<span class="icon">chevron_left</span></button>' +
            '<img class="lightbox-image" alt="" data-lightbox-image>' +
            '<button class="lightbox-step lightbox-next" type="button" data-lightbox-next aria-label="Next image">' +
              '<span class="icon">chevron_right</span></button>' +
          '</div>' +
          '<div class="lightbox-footer">' +
            '<p class="lightbox-caption" data-lightbox-caption></p>' +
            '<div class="lightbox-thumbs" data-lightbox-thumbs></div>' +
          '</div>';
        document.body.appendChild(el);
        return el;
      }

      $$('[data-lightbox]', root).forEach(function (group) {
        if (!claim(group, 'Lightbox')) return;
        var members = $$('[data-lightbox-item]', group);
        if (!members.length) return;

        box = box || build();
        var image = $('[data-lightbox-image]', box);
        var caption = $('[data-lightbox-caption]', box);
        var count = $('[data-lightbox-count]', box);
        var title = $('[data-lightbox-title]', box);
        var thumbs = $('[data-lightbox-thumbs]', box);
        var prev = $('[data-lightbox-prev]', box);
        var next = $('[data-lightbox-next]', box);
        var at = 0;
        var opener = null;

        function source(member) {
          var img = member.matches('img') ? member : $('img', member);
          return member.getAttribute('data-src') || (img && (img.currentSrc || img.src)) || '';
        }
        function text(member) {
          var img = member.matches('img') ? member : $('img', member);
          return member.getAttribute('data-caption') ||
                 (img && img.getAttribute('alt')) ||
                 ($('.gallery-caption', member) || {}).textContent || '';
        }

        function show(index) {
          at = (index + members.length) % members.length;
          var member = members[at];
          image.src = source(member);
          /* The caption is the description, so repeating it in the alt text
             would have a screen reader read the same sentence twice. */
          image.alt = '';
          if (caption) caption.textContent = text(member);
          if (count) count.textContent = (at + 1) + ' / ' + members.length;
          if (title) title.textContent = member.getAttribute('data-title') || '';
          $$('.lightbox-thumb', thumbs).forEach(function (thumb, i) {
            thumb.setAttribute('aria-current', String(i === at));
          });
          /* A single-image collection has nothing to step to. */
          var single = members.length < 2;
          if (prev) prev.disabled = single;
          if (next) next.disabled = single;
        }

        function fillThumbs() {
          if (!thumbs) return;
          thumbs.textContent = '';
          if (members.length < 2) return;
          members.forEach(function (member, i) {
            var thumb = document.createElement('button');
            thumb.type = 'button';
            thumb.className = 'lightbox-thumb';
            thumb.setAttribute('aria-label', 'Show image ' + (i + 1));
            var img = document.createElement('img');
            img.src = source(member);
            img.alt = '';
            thumb.appendChild(img);
            on(thumb, 'click', function () { show(i); });
            thumbs.appendChild(thumb);
          });
        }

        function open(index) {
          opener = document.activeElement;
          fillThumbs();
          show(index);
          box.dataset.open = 'true';
          document.body.style.overflow = 'hidden';
          trapFocus(box);
        }

        function close() {
          box.dataset.open = 'false';
          document.body.style.overflow = '';
          releaseFocus(box);
          /* Back to the thumbnail, not the top of the page: a gallery of
             forty is forty presses from the top. */
          if (opener && typeof opener.focus === 'function') opener.focus();
          opener = null;
        }

        members.forEach(function (member, index) {
          /* A tile that opens a viewer is a control, so it is given the
             semantics of one rather than left as a div with a handler. */
          if (!member.matches('button, a')) {
            member.setAttribute('role', 'button');
            if (!member.hasAttribute('tabindex')) member.tabIndex = 0;
            if (!member.getAttribute('aria-label')) {
              member.setAttribute('aria-label', 'Open image ' + (index + 1) + ' of ' + members.length);
            }
          }
          on(member, 'click', function (event) {
            event.preventDefault();
            open(index);
          });
          on(member, 'keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            open(index);
          });
        });

        if (!claim(box, 'LightboxChrome')) return;
        if (prev) on(prev, 'click', function () { show(at - 1); });
        if (next) on(next, 'click', function () { show(at + 1); });
        $$('[data-lightbox-close]', box).forEach(function (button) {
          on(button, 'click', close);
        });
        on(box, 'keydown', function (event) {
          var step = inlineStep(event, box);
          if (step) { event.preventDefault(); show(at + step); return; }
          if (event.key === 'Home') { event.preventDefault(); show(0); return; }
          if (event.key === 'End')  { event.preventDefault(); show(members.length - 1); }
        });
        box._uiLightboxClose = close;
      });
    },

    /* data-board wires a column board. Moving a card between columns is the
       edit, and there are two routes to it because dragging is the obvious
       gesture and the one nobody can rely on: it needs a pointer, a steady
       hand, and a screen tall enough to show source and target at once.

       Space grabs a card, the arrow keys move it within and between columns,
       Enter drops it and Escape puts it back where it started. Every move is
       announced, because a card quietly changing column is a change nobody
       listening to the page would know about. */
    board: function (root) {
      $$('[data-board]', root).forEach(function (board) {
        if (!claim(board, 'Board')) return;
        var live = $('[data-board-status]', board.parentNode || board);
        var dragging = null;
        var origin = null;
        var session = null;

        function lists() { return $$('.board-list', board); }
        function cards(list) { return $$('.board-card', list); }

        function columnName(list) {
          var column = list.closest('.board-column');
          var title = column && $('.board-column-title', column);
          return title ? title.textContent.trim() : 'column';
        }

        function cardName(card) {
          var title = $('.board-card-title', card);
          return (title ? title.textContent : card.textContent).trim().split('\n')[0];
        }

        function announce(message) { if (live) live.textContent = message; }

        /* The counts, the empty-column placeholder and the over-limit flag
           are all derived from the same pass, so they can never disagree. */
        function refresh() {
          lists().forEach(function (list) {
            var column = list.closest('.board-column');
            var all = cards(list);
            list.dataset.empty = String(all.length === 0);
            if (!list.getAttribute('data-empty-text')) {
              list.setAttribute('data-empty-text', 'Drop here');
            }
            if (column) {
              var slot = $('.board-column-count', column);
              if (slot) slot.textContent = String(all.length);
              var limit = parseInt(column.getAttribute('data-limit'), 10);
              if (limit > 0) {
                column.dataset.overLimit = String(all.length >= limit);
                if (slot) {
                  slot.title = all.length + ' of ' + limit;
                  slot.setAttribute('aria-label', all.length + ' of ' + limit + ' cards');
                }
              } else if (slot) {
                slot.setAttribute('aria-label', all.length + ' cards');
              }
            }
            all.forEach(function (card, index) {
              card.setAttribute('aria-roledescription', 'draggable card');
              card.setAttribute('aria-label', cardName(card) + ', ' +
                columnName(list) + ', position ' + (index + 1) + ' of ' + all.length);
            });
          });
        }

        function clearHints() {
          $$('.board-card', board).forEach(function (card) {
            card.classList.remove('is-over', 'is-over-below');
          });
          lists().forEach(function (list) { list.classList.remove('is-target'); });
        }

        function report(card) {
          var list = card.closest('.board-list');
          announce(cardName(card) + ' moved to ' + columnName(list) +
                   ', position ' + (cards(list).indexOf(card) + 1) + ' of ' + cards(list).length);
        }

        /* --- pointer dragging ----------------------------------------- */
        function wire(card) {
          if (!claim(card, 'BoardCard')) return;
          if (!card.hasAttribute('tabindex')) card.tabIndex = 0;

          /* Which column, and where in it. Driven from a bare pointer
             position because the lift calls it on its own frames as well:
             auto-scrolling a column moves cards past a pointer that has not
             moved, and hints read off the last pointermove would be stale. */
          function hintAt(x, y) {
            clearHints();

            /* The target is found from the pointer position rather than from
               the event target, because pointer capture sends every move to
               the card being dragged whatever is underneath it. */
            var list = lists().find(function (candidate) {
              var rect = candidate.getBoundingClientRect();
              return x >= rect.left && x <= rect.right &&
                     y >= rect.top && y <= rect.bottom;
            });
            if (!list) return;
            list.classList.add('is-target');

            var over = cards(list).find(function (other) {
              if (other === card) return false;
              var rect = other.getBoundingClientRect();
              return y >= rect.top && y <= rect.bottom;
            });
            if (!over) return;
            var rect = over.getBoundingClientRect();
            over.classList.add(y > rect.top + rect.height / 2
              ? 'is-over-below' : 'is-over');
          }

          function stop() {
            if (session) { session.drop(); session = null; }
            clearHints();
            card.classList.remove('is-dragging');
            dragging = null;
          }

          on(card, 'pointerdown', function (event) {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            /* A card can hold its own controls, and pressing one of those is
               not the start of a drag. */
            if (event.target.closest('button, a, input, select, textarea')) return;
            /* One card at a time, for the same reason as the list: a second
               finger would strand the first card in the air. */
            if (dragging) return;
            event.preventDefault();
            dragging = card;
            card.classList.add('is-dragging');
            card.setPointerCapture(event.pointerId);
            /* Both axes, unlike the list: cards cross columns, so sideways
               travel is the point rather than drift. */
            session = lift({
              element: card,
              clientX: event.clientX,
              clientY: event.clientY,
              update: hintAt
            });
          });

          on(card, 'pointermove', function (event) {
            if (dragging !== card) return;
            if (session) session.move(event);
            else hintAt(event.clientX, event.clientY);
          });

          on(card, 'pointerup', function (event) {
            if (dragging !== card) return;
            var list = $('.board-list.is-target', board);
            if (list) {
              var over = $('.board-card.is-over, .board-card.is-over-below', list);
              if (over) {
                list.insertBefore(card, over.classList.contains('is-over-below')
                  ? over.nextSibling : over);
              } else {
                list.appendChild(card);
              }
              /* refresh() before the drop lands, because re-running the
                 counts can change a column's height — an emptied one grows
                 its placeholder — and drop() has to measure the layout the
                 card is actually settling into. */
              refresh();
              report(card);
            }
            stop();
            if (card.hasPointerCapture && card.hasPointerCapture(event.pointerId)) {
              card.releasePointerCapture(event.pointerId);
            }
          });

          /* A capture that ends without a pointerup — the pointer leaving the
             window, a touch canceled by a system gesture — would otherwise
             leave the card lifted for good. */
          on(card, 'pointercancel', stop);

          /* --- keyboard moving ------------------------------------------ */
          on(card, 'keydown', function (event) {
            var grabbed = card.classList.contains('is-grabbed');
            var list = card.closest('.board-list');

            if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault();
              if (grabbed) {
                card.classList.remove('is-grabbed');
                card.setAttribute('aria-grabbed', 'false');
                $$('.board-column', board).forEach(function (column) {
                  column.classList.remove('is-keyboard-target');
                });
                origin = null;
                announce(cardName(card) + ' dropped in ' + columnName(list) +
                         ', position ' + (cards(list).indexOf(card) + 1));
              } else {
                card.classList.add('is-grabbed');
                card.setAttribute('aria-grabbed', 'true');
                /* Where it was, so Escape has somewhere to put it back. */
                origin = { list: list, before: card.nextElementSibling };
                announce(cardName(card) + ' picked up from ' + columnName(list) +
                         '. Arrow keys move it, Enter drops it, Escape cancels.');
              }
              return;
            }

            if (event.key === 'Escape' && grabbed) {
              event.preventDefault();
              card.classList.remove('is-grabbed');
              card.setAttribute('aria-grabbed', 'false');
              if (origin) origin.list.insertBefore(card, origin.before);
              origin = null;
              $$('.board-column', board).forEach(function (column) {
                column.classList.remove('is-keyboard-target');
              });
              refresh();
              card.focus();
              announce('Move canceled. ' + cardName(card) + ' is back in ' +
                       columnName(card.closest('.board-list')) + '.');
              return;
            }

            if (!grabbed) return;

            /* Up and down move within the column. */
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              var up = event.key === 'ArrowUp';
              var sibling = up ? card.previousElementSibling : card.nextElementSibling;
              if (!sibling) return;
              list.insertBefore(up ? card : sibling, up ? sibling : card);
              refresh();
              card.focus();
              keepInView(card);
              report(card);
              return;
            }

            /* Left and right move between columns, in reading order, so the
               keys swap in a mirrored layout like everywhere else. */
            var step = inlineStep(event, board);
            if (!step) return;
            event.preventDefault();
            var all = lists();
            var next = all[all.indexOf(list) + step];
            if (!next) return;
            /* Dropped at the same height in the next column rather than at
               its end, which is where the eye expects it. */
            var index = Math.min(cards(list).indexOf(card), cards(next).length);
            var anchor = cards(next)[index] || null;
            next.insertBefore(card, anchor);
            $$('.board-column', board).forEach(function (column) {
              column.classList.toggle('is-keyboard-target',
                column === next.closest('.board-column'));
            });
            refresh();
            card.focus();
            /* Was scrollIntoView, which also hauls the page about — the board
               scrolls sideways inside a page that does not need to. */
            keepInView(card);
            report(card);
          });
        }

        $$('.board-card', board).forEach(wire);
        /* Cards added later — by a form, a filter, a fetch — are wired on the
           next init pass, and refresh is what keeps the counts honest. */
        board._uiBoardRefresh = function () {
          $$('.board-card', board).forEach(wire);
          refresh();
        };
        refresh();
      });
    },

    /* data-strength on a wrapper containing a password field. The score is a
       heuristic and is presented as one: four coarse segments and a word, not
       a percentage, because nothing computed from the characters alone can
       tell a strong password from one that appears in a breach list.

       The outstanding requirements are what actually helps, so they are
       listed; a bar on its own only grades. */
    strength: function (root) {
      $$('[data-strength]', root).forEach(function (meter) {
        if (!claim(meter, 'Strength')) return;
        var id = meter.getAttribute('data-strength');
        var input = id ? document.getElementById(id) : null;
        if (!input) {
          var field = meter.closest('.field') || meter.parentNode;
          input = field && $('input[type="password"], input[type="text"]', field);
        }
        if (!input) return;

        var segments = $$('.strength-segment', meter);
        var label = $('.strength-label', meter);
        var hint = $('.strength-hint', meter);
        var rules = $$('.strength-rule', meter);
        var WORDS = ['', 'Very weak', 'Weak', 'Good', 'Strong'];

        /* The handful that turn up at the top of every breach list, plus the
           keyboard runs. A real check is a lookup against a breach corpus,
           which is a server's job; this only catches the worst of it. */
        var COMMON = /^(password|passw0rd|letmein|welcome|admin|iloveyou|monkey|dragon|football|qwerty\w*|asdf\w*|zxcv\w*|1234\d*|abc123)$/i;

        function classes(value) {
          return [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter(function (test) {
            return test.test(value);
          }).length;
        }

        var TESTS = {
          length:   function (value) { return value.length >= 12; },
          longer:   function (value) { return value.length >= 16; },
          classes:  function (value) { return classes(value) >= 3; },
          varied:   function (value) {
            /* One character repeated to length, or a short pattern tiled out,
               passes a length test while adding almost nothing. */
            return value.length >= 8 && new Set(value).size >= Math.min(6, value.length);
          },
          uncommon: function (value) { return !COMMON.test(value); }
        };

        /* Length carries most of the result, and the character classes move
           it by one at most. That ordering is the whole point: four classes
           in eight characters is a worse password than six plain words, and a
           composition rule that demands a symbol mostly produces one symbol
           on the end. */
        function score(value) {
          if (!value) return 0;
          if (!TESTS.uncommon(value)) return 1;
          if (value.length < 8 || !TESTS.varied(value)) return 1;

          var result = value.length >= 20 ? 4
                     : value.length >= 16 ? 3
                     : value.length >= 12 ? 2
                     : 1;
          var variety = classes(value);
          if (variety >= 3) result += 1;
          if (variety <= 1) result -= 1;
          return Math.max(1, Math.min(4, result));
        }

        function update() {
          var value = input.value || '';
          var result = score(value);
          meter.dataset.score = String(result);
          segments.forEach(function (segment, index) {
            segment.classList.toggle('is-on', index < result);
          });
          if (label) label.textContent = WORDS[result] || '';
          if (hint) {
            hint.textContent = value && result < 3
              ? 'Length helps more than symbols do.'
              : '';
          }
          rules.forEach(function (rule) {
            var test = TESTS[rule.getAttribute('data-rule')];
            var met = !!(test && value && test(value));
            rule.dataset.met = String(met);
            var icon = $('.icon', rule);
            if (icon) icon.textContent = met ? 'check_circle' : 'radio_button_unchecked';
          });
          /* The score is a summary of the rules below it, which are already
             readable, so the bar itself is decorative and the word carries
             the result. A live region would otherwise interrupt on every
             keystroke. */
          meter.dispatchEvent(new CustomEvent('ui:strength', {
            bubbles: true,
            detail: { score: result, label: WORDS[result] || '' }
          }));
        }

        on(input, 'input', update);
        update();
      });
    },

    /* data-mask reformats a field as it is typed: a phone number, a card
       number, an expiry or an amount.

       The caret is the whole difficulty. Reformatting replaces the value, and
       a naive implementation sends the caret to the end, which makes it
       impossible to correct a digit in the middle. So the digits before the
       caret are counted, the value is rebuilt, and the caret is put back
       after that same number of digits.

       The mask is presentation only. It shapes what is typed and never
       validates it: whether a card number is real is a question for a
       checksum and a payment processor, not for a regular expression. */
    mask: function (root) {
      var FORMATS = {
        /* Grouped on the North American pattern, as an example. A field that
           has to take numbers from anywhere should not be masked at all:
           there is no format that fits every country, and forcing one makes
           valid numbers impossible to enter. */
        phone: function (digits) {
          digits = digits.slice(0, 10);
          if (digits.length <= 3) return digits;
          if (digits.length <= 6) return '(' + digits.slice(0, 3) + ') ' + digits.slice(3);
          return '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6);
        },
        /* Four-four-four-four, which covers most cards; American Express is
           four-six-five and Diners fourteen digits, so the grouping follows
           the brand once enough digits are in to tell. */
        card: function (digits) {
          digits = digits.slice(0, 19);
          var groups = /^3[47]/.test(digits) ? [4, 6, 5] : null;
          var out = [];
          var at = 0;
          if (groups) {
            groups.forEach(function (size) {
              if (at >= digits.length) return;
              out.push(digits.slice(at, at + size));
              at += size;
            });
            if (at < digits.length) out.push(digits.slice(at));
          } else {
            while (at < digits.length) { out.push(digits.slice(at, at + 4)); at += 4; }
          }
          return out.join(' ');
        },
        expiry: function (digits) {
          digits = digits.slice(0, 4);
          if (digits.length <= 2) return digits;
          return digits.slice(0, 2) + '/' + digits.slice(2);
        },
        digits: function (digits) { return digits; },
        /* Thousands separators, with the decimals left alone. */
        currency: function (digits, raw) {
          var parts = String(raw).replace(/[^\d.]/g, '').split('.');
          var whole = (parts[0] || '').replace(/^0+(?=\d)/, '');
          var grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
          if (parts.length < 2) return grouped;
          return grouped + '.' + parts[1].slice(0, 2);
        }
      };

      var BRANDS = [
        { name: 'Visa',       test: /^4/ },
        { name: 'Mastercard', test: /^(5[1-5]|2[2-7])/ },
        { name: 'Amex',       test: /^3[47]/ },
        { name: 'Discover',   test: /^6(011|5)/ }
      ];

      $$('[data-mask]', root).forEach(function (input) {
        if (!claim(input, 'Mask')) return;
        var kind = input.getAttribute('data-mask');
        var format = FORMATS[kind];
        if (!format) return;
        var brandSlot = document.getElementById(input.getAttribute('data-mask-brand') || '');

        input.classList.add('input-masked');
        /* A numeric keypad on a phone, and the browser's own autofill, which
           is far more use here than any mask. */
        if (!input.getAttribute('inputmode')) {
          input.setAttribute('inputmode', kind === 'currency' ? 'decimal' : 'numeric');
        }

        function apply() {
          var before = input.value;
          var caret = input.selectionStart;
          /* How many of the characters the mask does not insert sit before
             the caret. Everything else about the position can be rebuilt. */
          var kept = before.slice(0, caret).replace(/\D/g, '').length;

          var digits = before.replace(/\D/g, '');
          var after = format(digits, before);
          if (after === before) return;

          input.value = after;

          /* Walk forward through the new value until the same number of
             digits has been passed, and stop there. */
          var at = 0;
          var seen = 0;
          while (at < after.length && seen < kept) {
            if (/\d/.test(after[at])) seen++;
            at++;
          }
          /* Past a separator the mask just inserted, so typing continues
             after it rather than before it. */
          while (at < after.length && !/[\d]/.test(after[at]) && seen >= kept) at++;
          try { input.setSelectionRange(at, at); } catch (e) {}
        }

        function brand() {
          if (!brandSlot) return;
          var digits = input.value.replace(/\D/g, '');
          var found = digits && BRANDS.find(function (candidate) {
            return candidate.test.test(digits);
          });
          brandSlot.textContent = found ? found.name : (digits ? 'Card' : '');
          brandSlot.dataset.brand = found ? found.name : '';
        }

        on(input, 'input', function () { apply(); brand(); });
        /* A pasted value arrives whole and still has to be shaped. */
        on(input, 'paste', function () {
          window.setTimeout(function () { apply(); brand(); }, 0);
        });
        if (input.value) { apply(); brand(); }
      });
    },

    /* data-value on a .donut or a .gauge, so the figure is declared once in
       the markup instead of being written into a style attribute.

       Both are images of a number, so each gets the number as its accessible
       name: a conic gradient says nothing to a screen reader, and the text in
       the middle of a donut is a separate element that may or may not be
       read in the right order. */
    radial: function (root) {
      $$('.donut[data-value], .gauge[data-value]', root).forEach(function (figure) {
        if (!claim(figure, 'Radial')) return;
        var gauge = figure.classList.contains('gauge');
        var property = gauge ? '--gauge-value' : '--donut-value';
        var value = parseFloat(figure.getAttribute('data-value')) || 0;
        var min = parseFloat(figure.getAttribute('data-min'));
        var max = parseFloat(figure.getAttribute('data-max'));
        if (isNaN(min)) min = 0;
        if (isNaN(max)) max = 100;

        /* The fill is a percentage of the sweep, which is not the value when
           the range does not happen to be 0–100. */
        var span = max - min;
        var percent = span > 0 ? ((value - min) / span) * 100 : 0;
        percent = Math.max(0, Math.min(100, percent));

        figure.setAttribute('role', 'img');
        if (!figure.getAttribute('aria-label')) {
          var unit = figure.getAttribute('data-unit') || '';
          var name = figure.getAttribute('data-label') || '';
          figure.setAttribute('aria-label',
            (name ? name + ': ' : '') + value + unit +
            (span === 100 && min === 0 ? '' : ' of ' + max + unit));
        }

        if (prefersReducedMotion()) {
          figure.style.setProperty(property, String(percent));
          return;
        }
        /* From zero on the first paint, so the sweep reads as a measurement
           being taken rather than as a decoration. */
        figure.style.setProperty(property, '0');
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            figure.style.setProperty(property, String(percent));
          });
        });
      });
    },

    /* Custom scrollbars. Declared last in the table so that every scroller
       built by an earlier behavior — a picker panel, a combobox popup — is
       already in the document by the time this looks for them. */
    scrollbar: function (root) { Scrollbars.init(root); }
  };

  /* ----------------------------------------------------- shared open/close */
  function currentPage() {
    var file = window.location.pathname.split('/').pop();
    return file || 'index.html';
  }

  var scrimCallback = null;

  function scrimElement() {
    var scrim = $('.scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.className = 'scrim';
      document.body.appendChild(scrim);
      on(scrim, 'click', hideScrim);
    }
    return scrim;
  }

  function showScrim(onHide) {
    scrimCallback = onHide || null;
    scrimElement().dataset.open = 'true';
    document.body.style.overflow = 'hidden';
  }

  function hideScrim() {
    scrimElement().dataset.open = 'false';
    document.body.style.overflow = '';
    if (scrimCallback) { var fn = scrimCallback; scrimCallback = null; fn(); }
  }

  /* A modal drawer is a plain element, so the Tab containment, the inerting
     of the page behind it and the focus restore all have to be applied here;
     only a native <dialog> gets those from the platform. */
  function openDrawer(drawer) {
    if (!drawer) return;
    drawer.dataset.open = 'true';
    drawer.setAttribute('aria-hidden', 'false');
    /* A docked drawer is part of the layout rather than an overlay, so it
       neither dims the page nor takes focus captive. */
    if (drawer.classList.contains('drawer-docked')) return;
    drawer.setAttribute('aria-modal', 'true');
    drawer.setAttribute('role', drawer.getAttribute('role') || 'dialog');
    showScrim(function () { closeDrawer(drawer); });
    trapFocus(drawer);
  }

  function closeDrawer(drawer) {
    if (!drawer) return;
    drawer.dataset.open = 'false';
    drawer.setAttribute('aria-hidden', 'true');
    if (drawer.classList.contains('drawer-docked')) return;
    drawer.removeAttribute('aria-modal');
    /* Released before the scrim, so focus lands back on the trigger rather
       than on whatever the scrim's own teardown touches last. */
    releaseFocus(drawer);
    hideScrim();
  }

  function openSheet(sheet) {
    if (!sheet) return;
    sheet.dataset.open = 'true';
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('role', sheet.getAttribute('role') || 'dialog');
    showScrim(function () { closeSheet(sheet); });
    trapFocus(sheet);
  }

  function closeSheet(sheet) {
    if (!sheet) return;
    sheet.dataset.open = 'false';
    sheet.removeAttribute('aria-modal');
    releaseFocus(sheet);
    hideScrim();
  }

  function closeAllMenus() {
    $$('.menu[data-open="true"]').forEach(function (menu) { menu.dataset.open = 'false'; });
    $$('[data-menu]').forEach(function (trigger) { trigger.setAttribute('aria-expanded', 'false'); });
  }

  function openDialog(id) {
    var dialog = typeof id === 'string' ? document.getElementById(id) : id;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      /* showModal() puts the dialog in the top layer, which confines Tab and
         restores focus on close by itself — so no trap is applied here. All
         it needs is the right landing spot, since the platform would
         otherwise focus the first control, often the close button. */
      dialog.showModal();
      var target = $('[data-autofocus]', dialog);
      if (target) target.focus();
    } else {
      /* Without showModal there is no top layer, so the containment that the
         platform would have provided is applied by hand. */
      dialog.setAttribute('open', '');
      dialog.setAttribute('aria-modal', 'true');
      trapFocus(dialog);
    }
  }

  function closeDialog(id) {
    var dialog = typeof id === 'string' ? document.getElementById(id) : id;
    if (!dialog) return;
    if (typeof dialog.showModal !== 'function') releaseFocus(dialog);
    dialog.close();
  }

  /* --------------------------------------------------------- global events */
  on(document, 'click', function () {
    closeAllMenus();
    closeAllPopovers();
    closeAllCombos();
    $$('.speed-dial[data-open="true"]').forEach(function (dial) {
      dial.dataset.open = 'false';
      var trigger = $('.speed-dial-trigger', dial);
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      $$('.speed-dial-action .button', dial).forEach(function (button) { button.tabIndex = -1; });
    });
  });

  /* Placement is computed from measurements, so it goes stale whenever the
     layout moves underneath it. Re-run on the next frame rather than per
     event, and again once webfonts have landed, because text swapping from
     the fallback face resizes everything that was measured before it. */
  var placementQueued = false;
  function replaceAllPopovers() {
    if (placementQueued) return;
    placementQueued = true;
    window.requestAnimationFrame(function () {
      placementQueued = false;
      $$('.popover').forEach(placePopover);
    });
  }
  on(window, 'resize', replaceAllPopovers);
  on(window, 'load', replaceAllPopovers);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(replaceAllPopovers);
  }

  /* Escape unwinds one layer at a time, innermost first, so a popover opened
     from inside a drawer does not take the drawer down with it. */
  on(document, 'keydown', function (event) {
    if (event.key !== 'Escape') return;

    var menu = $('.menu[data-open="true"]');
    if (menu) { closeAllMenus(); return; }

    /* The lightbox and the palette are modal, so they unwind before the
       non-modal layers below. The palette's own input handles Escape while it
       has focus; this is the path for a click that moved focus off it. */
    var lightbox = $('.lightbox[data-open="true"]');
    if (lightbox && lightbox._uiLightboxClose) { lightbox._uiLightboxClose(); return; }

    var palette = $('.palette-scrim[data-open="true"]');
    if (palette && palette._uiPalette) { palette._uiPalette.close(); return; }

    var popover = $('.popover[data-open="true"]');
    if (popover) { closePopover(popover); return; }

    var combo = $('.combobox[data-open="true"]');
    if (combo) { closeAllCombos(); return; }

    var dial = $('.speed-dial[data-open="true"]');
    if (dial) {
      dial.dataset.open = 'false';
      var trigger = $('.speed-dial-trigger', dial);
      if (trigger) { trigger.setAttribute('aria-expanded', 'false'); trigger.focus(); }
      return;
    }

    var sheet = $('.sheet[data-open="true"]');
    if (sheet) { closeSheet(sheet); return; }

    var drawer = $('.drawer[data-open="true"]:not(.drawer-docked)');
    if (drawer) closeDrawer(drawer);
  });

  /* ------------------------------------------------------------------ init */
  /* Behaviors that WRITE MARKUP other behaviors then wire up. These run
     first, in this order, and the rest follow in declaration order.

     This is a real dependency, not a tidiness preference, and getting it
     wrong fails silently in the worst way. BEHAVIORS.picker expands a native
     <input data-picker> into a field, a trigger and a popover; the trigger is
     a [data-popover] button, and BEHAVIORS.popover is what gives a
     [data-popover] button its click handler. Declared after popover — which
     is where picker first sat — every generated trigger was created a few
     microseconds after the only pass that would ever have bound it. The
     fields looked completely correct, the panels were in the DOM, and
     clicking a trigger did nothing at all, with no error anywhere to say why.

     Running them from an explicit list rather than relying on where they
     happen to sit in the object means a later edit that reorders BEHAVIORS,
     or inserts a behavior above picker, cannot bring that back. */
  var GENERATORS = ['picker', 'fileField'];

  function runBehavior(name, root) {
    try {
      BEHAVIORS[name](root);
    } catch (error) {
      /* One broken demo should never take the rest of the page down. */
      console.error('[design-language] behavior "' + name + '" failed', error);
    }
  }

  function init(root) {
    root = root || document;
    GENERATORS.forEach(function (name) {
      if (BEHAVIORS[name]) runBehavior(name, root);
    });
    Object.keys(BEHAVIORS).forEach(function (name) {
      if (GENERATORS.indexOf(name) > -1) return;
      runBehavior(name, root);
    });
  }

  Theme.init();

  if (document.readyState === 'loading') {
    on(document, 'DOMContentLoaded', function () { init(document); });
  } else {
    init(document);
  }

  window.UI = {
    pages: PAGES,
    init: init,
    toast: toast,
    openDialog: openDialog,
    closeDialog: closeDialog,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    openSheet: openSheet,
    closeSheet: closeSheet,
    openPopover: openPopover,
    closePopover: closePopover,
    trapFocus: trapFocus,
    releaseFocus: releaseFocus,
    lift: lift,
    keepInView: keepInView,
    refreshScrollbars: Scrollbars.refresh,
    setTheme: Theme.set,
    getTheme: Theme.resolved,
    isRTL: isRTL
  };
})();
