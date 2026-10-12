/* App bootstrap: router, shell chrome (drawer, topbar chips), view mounting. */

import { Router } from './router.js';
import { get, put, post } from './api.js';
import { store, DEFAULT_SETTINGS } from './store.js';
import { loadLibrary } from './library.js';
import { logout } from './lib/kratos.js';
import { el, icon, mount, clear } from './lib/dom.js';
import { installFocusKeeper } from './lib/focus.js';

const outlet = document.getElementById('main');
const shell = document.getElementById('app-shell');
const drawer = document.getElementById('app-drawer');

/* ------------------------------------------------------------------ routes */
const router = new Router()
  .add('/', () => import('./views/home.js'), { title: 'My subjects' })
  .add('/subjects', () => import('./views/catalog.js'), { title: 'All subjects' })
  .add('/s/:subject', () => import('./views/subject.js'))
  .add('/c/:subject/:course', () => import('./views/course.js'))
  .add('/l/:subject/:course/:unit/:lesson', () => import('./views/lesson.js'), { player: true })
  .add('/review/:subject/:course', () => import('./views/review.js'), { player: true })
  .add('/me', () => import('./views/profile.js'), { title: 'Profile' })
  .add('/settings', () => import('./views/settings.js'), { title: 'Settings' })
  .add('/dev/elements', () => import('./views/gallery.js'), { title: 'Element gallery', dev: true })
  .add('/account', () => import('./views/account.js'), { title: 'Account' })
  .add('/login', () => import('./views/login.js'), { title: 'Sign in', public: true })
  .add('/register', () => import('./views/register.js'), { title: 'Create an account', public: true })
  .add('/recover', () => import('./views/recover.js'), { title: 'Get a new password', public: true })
  .fallback(() => import('./views/notfound.js'));

let renderSeq = 0;

router.onChange(async (ctx, load) => {
  const seq = ++renderSeq;
  // Multi-user mode: everything except the sign-in page needs a session.
  if (authState.mode === 'multi' && !authState.authenticated && !ctx.meta.public) {
    return router.navigate(`/login?next=${encodeURIComponent(ctx.path)}`, { replace: true });
  }
  document.body.classList.toggle('is-player', Boolean(ctx.meta.player));
  outlet.setAttribute('aria-busy', 'true');
  let content;
  try {
    const mod = await load();
    if (seq !== renderSeq) return; // a newer navigation won
    content = await mod.default({ ...ctx, setTitle });
  } catch (err) {
    console.error('[app] view failed', err);
    content = el('div', { class: 'container section' },
      el('div', { class: 'empty-state' },
        icon('error_outline'),
        el('p', { class: 'text-heading-3' }, 'Something went wrong'),
        el('p', { class: 'text-muted' }, String(err && err.message || err)),
        el('a', { class: 'button button-tonal', href: '/' }, 'Back to my subjects')));
  }
  if (seq !== renderSeq) return;
  // Let the outgoing view release listeners (the player sets root.destroy).
  for (const child of [...outlet.children]) if (typeof child.destroy === 'function') { try { child.destroy(); } catch { /* ignore */ } }
  mount(outlet, content);
  outlet.removeAttribute('aria-busy');
  if (ctx.meta.title) setTitle(ctx.meta.title);
  markCurrentNav(ctx.path);
  if (!drawer.classList.contains('drawer-docked')) window.UI.closeDrawer(drawer);
  window.scrollTo({ top: 0, behavior: 'instant' });
  // Move focus to the new view for keyboard and screen-reader users: to the control the view
  // marked with data-autofocus (the next step after a lesson), else to the view itself.
  (outlet.querySelector('[data-autofocus]') || outlet).focus({ preventScroll: true });
});

export function setTitle(title) {
  document.title = title ? `${title} · Learn` : 'Learn';
}

/* --------------------------------------------------------------- drawer nav */
function navItem(href, iconName, label, extra = null) {
  const a = el('a', { class: 'nav-item', href }, icon(iconName), el('span', {}, label));
  if (extra) a.append(el('span', { class: 'nav-item-trailing' }, extra));
  return a;
}

function buildMainNav() {
  const main = document.getElementById('nav-main');
  clear(main);
  main.append(
    navItem('/', 'home', 'My subjects'),
    navItem('/me', 'person', 'Profile'),
    navItem('/settings', 'settings', 'Settings'),
  );
}

/* The sidebar lists the learner's library (the subjects they added), not the whole catalog,
   which can hold hundreds; "Add subjects" leads to the catalog. Repainted on every change. */
function renderNavSubjects(library) {
  const nav = document.getElementById('nav-subjects');
  clear(nav);
  if (authState.mode === 'multi' && !authState.authenticated) {
    nav.append(el('p', { class: 'text-caption text-muted p-3' }, 'Sign in to see your subjects.'));
  } else if (library === null) {
    nav.append(el('p', { class: 'text-caption text-danger p-3' }, 'Could not load your subjects.'));
  } else {
    library.forEach((s) => nav.append(navItem(`/s/${s.id}`, s.icon || 'school', s.title, String(s.course_count))));
    nav.append(navItem('/subjects', 'add', library.length ? 'Add subjects' : 'Choose subjects'));
  }
  nav.removeAttribute('aria-busy');
  window.UI.init(nav);
  markCurrentNav(location.pathname);
}

async function loadSubjects() {
  if (authState.mode === 'multi' && !authState.authenticated) {
    store.set('library', []);
    return;
  }
  try { await loadLibrary(); } catch { /* renderNavSubjects shows the error */ }
}

function markCurrentNav(path) {
  document.querySelectorAll('#app-drawer .nav-item').forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === '/' ? path === '/' : path === href || (href !== '/subjects' && path.startsWith(href + '/')) ||
      // a course or lesson under a subject keeps that subject lit
      (href.startsWith('/s/') && (path.startsWith('/c/' + href.slice(3) + '/') || path.startsWith('/l/' + href.slice(3) + '/') || path.startsWith('/review/' + href.slice(3) + '/')));
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

/* ------------------------------------------------------ docked drawer >= lg */
const wide = window.matchMedia('(min-width: 1024px)');
function applyDock() {
  const docked = wide.matches;
  shell.classList.toggle('is-docked', docked);
  drawer.classList.toggle('drawer-docked', docked);
  if (docked) {
    drawer.dataset.open = 'true';
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('aria-modal');
    drawer.removeAttribute('role');
  } else {
    window.UI.closeDrawer(drawer);
  }
}
wide.addEventListener('change', applyDock);

/* ------------------------------------------------------------ topbar chips */
function renderChips(me) {
  const xp = document.getElementById('chip-xp');
  const streak = document.getElementById('chip-streak');
  const xpToday = me ? me.xp_today : 0;
  const goal = me ? me.daily_goal : store.get('settings').dailyGoal;
  xp.querySelector('[data-value]').textContent = `${xpToday}/${goal}`;
  xp.setAttribute('aria-label', `${xpToday} of ${goal} XP today`);
  xp.classList.toggle('is-done', Boolean(me && me.xp_today >= me.daily_goal));
  const days = me ? me.streak : 0;
  streak.querySelector('[data-value]').textContent = String(days);
  streak.setAttribute('aria-label', `${days}-day streak`);
  streak.classList.toggle('is-done', days > 0);
}

async function loadMe() {
  try {
    const me = await get(`/api/me?tz=${encodeURIComponent(store.get('settings').timezone)}`, { silent: true });
    store.set('me', me);
    if (me && me.goal_chosen === false) firstRunGoal();
  } catch {
    store.set('me', null);
  }
}

/* First run: the daily goal picker (plan §Phase 7). Shown once; Settings can change it later. */
let goalDialogShown = false;
function firstRunGoal() {
  const dialog = document.getElementById('goal-dialog');
  if (!dialog || goalDialogShown || dialog.open) return;
  goalDialogShown = true;
  const picker = document.getElementById('goal-dialog-picker');
  let goal = store.get('settings').dailyGoal || 20;
  picker.querySelectorAll('[data-goal]').forEach((b) => {
    b.setAttribute('aria-pressed', String(Number(b.dataset.goal) === goal));
    b.addEventListener('click', () => { goal = Number(b.dataset.goal); });
  });
  document.getElementById('goal-dialog-save').addEventListener('click', async () => {
    store.update('settings', { dailyGoal: goal, goalChosen: true });
    try { await put('/api/settings', { dailyGoal: goal, goalChosen: true }, { silent: true }); } catch { /* offline */ }
    window.UI.closeDialog(dialog);
    loadMe();
    window.UI.toast(`Daily goal set to ${goal} XP.`);
  }, { once: true });
  window.UI.openDialog(dialog);
}

/* Settings live on the server (settings table); localStorage is only a cache so the
   UI can paint before the first response. Local changes are pushed with PUT. */
let pushingSettings = false;
let settingsSubscribed = false;
async function syncSettings() {
  try {
    const server = await get('/api/settings', { silent: true });
    pushingSettings = true;
    store.update('settings', (s) => ({ ...s, ...server, timezone: s.timezone }));
  } catch { /* offline or no server settings yet */ } finally { pushingSettings = false; }
  if (settingsSubscribed) return;
  settingsSubscribed = true;
  store.subscribe('settings', (s) => {
    if (pushingSettings || (authState.mode === 'multi' && !authState.authenticated)) return;
    put('/api/settings', s, { silent: true }).then(() => loadMe()).catch(() => {});
  });
}

/* ---------------------------------------------------------------- accounts */
const authState = { mode: 'single', authenticated: true, user: null, turnstile: null };

async function loadAuth() {
  try {
    const m = await get('/api/auth/mode', { silent: true });
    Object.assign(authState, { mode: m.mode, authenticated: m.authenticated, user: m.user, turnstile: m.turnstile });
  } catch {
    Object.assign(authState, { mode: 'single', authenticated: true, user: null });
  }
  paintAccountNav();
}

function paintAccountNav() {
  const main = document.getElementById('nav-main');
  main.querySelectorAll('[data-account]').forEach((n) => n.remove());
  if (authState.mode !== 'multi') return;
  const item = authState.authenticated
    ? navItem('/account', 'account_circle', authState.user ? authState.user.username : 'Account')
    : navItem('/login', 'login', 'Sign in');
  item.dataset.account = '1';
  main.append(item);
  markCurrentNav(location.pathname);
}

/** Called by the account views after a sign-in, a sign-up or a recovery. */
async function afterSignIn() {
  await loadAuth();
  await syncSettings();
  await loadMe();
  await loadSubjects();
}

/** Sign out through Kratos, forget this learner's data in the page, go to the sign-in page. */
async function signOut() {
  try { await logout(); } catch (err) { window.UI.toast(err.message || 'Could not sign out.', { variant: 'danger' }); return; }
  Object.assign(authState, { authenticated: false, user: null });
  store.set('me', null);
  pushingSettings = true;
  store.set('settings', { ...DEFAULT_SETTINGS }); // the next learner on this device starts clean
  pushingSettings = false;
  paintAccountNav();
  await loadSubjects();
  window.UI.toast('Signed out.');
  router.navigate('/login', { replace: true });
}

/* ------------------------------------------------------------------- start */
async function start() {
  // design_language.js is a deferred classic script and module scripts run after it,
  // but guard anyway so a missing kit fails loudly instead of silently.
  if (!window.UI) {
    outlet.textContent = 'The design system script did not load.';
    return;
  }
  installFocusKeeper(outlet);
  buildMainNav();
  await loadAuth();
  applyDock();
  store.subscribe('me', renderChips, { immediate: true });
  store.subscribe('settings', () => renderChips(store.get('me')));
  store.subscribe('library', renderNavSubjects);
  get('/api/health', { silent: true }).then((h) => {
    store.set('dev', Boolean(h && h.dev));
    document.getElementById('nav-dev').classList.toggle('hidden', !h || !h.dev);
  }).catch(() => {});
  loadSubjects();
  if (authState.authenticated) {
    await syncSettings();
    loadMe();
  }
  await router.resolve();
}

window.app = { router, store, setTitle, reloadMe: loadMe, afterSignIn, signOut, auth: authState };

/* Error boundary of last resort: an uncaught error anywhere becomes a toast and a console
   entry, never a blank page. Elements have their own boundary in lib/elements.js. */
window.addEventListener('error', (event) => {
  console.error('[app] uncaught', event.error || event.message);
  if (window.UI) window.UI.toast('Something went wrong. The details are in the console.', { variant: 'danger' });
});
window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] unhandled rejection', event.reason);
});

/* Offline support: the service worker caches the shell, vendored libraries, elements and
   content reads. Skipped in dev so edits show up immediately. */
if ('serviceWorker' in navigator && !new URLSearchParams(location.search).has('nosw')) {
  get('/api/health', { silent: true }).then((h) => {
    if (h && h.dev) return;
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('[app] service worker not registered', err));
  }).catch(() => {});
}

start();
