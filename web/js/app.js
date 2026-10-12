/* App bootstrap: router, shell chrome (drawer, topbar chips), view mounting. */

import { Router } from './router.js';
import { get, put } from './api.js';
import { store } from './store.js';
import { el, icon, mount, clear } from './lib/dom.js';

const outlet = document.getElementById('main');
const shell = document.getElementById('app-shell');
const drawer = document.getElementById('app-drawer');

/* ------------------------------------------------------------------ routes */
const router = new Router()
  .add('/', () => import('./views/home.js'), { title: 'Subjects' })
  .add('/s/:subject', () => import('./views/subject.js'))
  .add('/c/:subject/:course', () => import('./views/course.js'))
  .add('/l/:subject/:course/:unit/:lesson', () => import('./views/lesson.js'), { player: true })
  .add('/review/:subject/:course', () => import('./views/review.js'), { player: true })
  .add('/me', () => import('./views/profile.js'), { title: 'Profile' })
  .add('/settings', () => import('./views/settings.js'), { title: 'Settings' })
  .add('/dev/elements', () => import('./views/gallery.js'), { title: 'Element gallery', dev: true })
  .fallback(() => import('./views/notfound.js'));

let renderSeq = 0;

router.onChange(async (ctx, load) => {
  const seq = ++renderSeq;
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
        el('a', { class: 'button button-tonal', href: '/' }, 'Back to subjects')));
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
  // Move focus to the new view for keyboard and screen-reader users.
  outlet.focus({ preventScroll: true });
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
    navItem('/', 'home', 'Subjects'),
    navItem('/me', 'person', 'Profile'),
    navItem('/settings', 'settings', 'Settings'),
  );
}

async function loadSubjects() {
  const nav = document.getElementById('nav-subjects');
  try {
    const subjects = await get('/api/subjects', { cache: true });
    store.set('subjects', subjects);
    clear(nav);
    if (!subjects.length) {
      nav.append(el('p', { class: 'text-caption text-muted p-3' }, 'No subjects yet. Add content/<subject>/subject.yaml.'));
    }
    subjects.forEach((s) => nav.append(navItem(`/s/${s.id}`, s.icon || 'school', s.title, String(s.course_count))));
  } catch {
    clear(nav);
    nav.append(el('p', { class: 'text-caption text-danger p-3' }, 'Could not load subjects.'));
  } finally {
    nav.removeAttribute('aria-busy');
    window.UI.init(nav);
    markCurrentNav(location.pathname);
  }
}

function markCurrentNav(path) {
  document.querySelectorAll('#app-drawer .nav-item').forEach((a) => {
    const href = a.getAttribute('href');
    const active = href === '/' ? path === '/' : path === href || path.startsWith(href + '/') ||
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
async function syncSettings() {
  try {
    const server = await get('/api/settings', { silent: true });
    pushingSettings = true;
    store.update('settings', (s) => ({ ...s, ...server, timezone: s.timezone }));
  } catch { /* offline or no server settings yet */ } finally { pushingSettings = false; }
  store.subscribe('settings', (s) => {
    if (pushingSettings) return;
    put('/api/settings', s, { silent: true }).then(() => loadMe()).catch(() => {});
  });
}

/* ------------------------------------------------------------------- start */
async function start() {
  // design_language.js is a deferred classic script and module scripts run after it,
  // but guard anyway so a missing kit fails loudly instead of silently.
  if (!window.UI) {
    outlet.textContent = 'The design system script did not load.';
    return;
  }
  buildMainNav();
  applyDock();
  store.subscribe('me', renderChips, { immediate: true });
  store.subscribe('settings', () => renderChips(store.get('me')));
  get('/api/health', { silent: true }).then((h) => {
    store.set('dev', Boolean(h && h.dev));
    document.getElementById('nav-dev').classList.toggle('hidden', !h || !h.dev);
  }).catch(() => {});
  loadSubjects();
  await syncSettings();
  loadMe();
  await router.resolve();
}

window.app = { router, store, setTitle, reloadMe: loadMe };
start();
