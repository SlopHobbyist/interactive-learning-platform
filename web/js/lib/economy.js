/* Shared UI for the economy (shop_plan.md): chest cards, the daily quest list
   and the XP boost countdown. Used by the lesson summary, home and the shop. */

import { get, post } from '../api.js';
import { withNow } from '../progress.js';
import { store } from '../store.js';
import { el, icon, prefersReducedMotion } from './dom.js';

/* ------------------------------------------------------------------ boost */
/* The boost ends `boost_seconds` after the /api/me response that reported it;
   every store.set('me') is right after a response, so the clock starts there. */
let boostEndsAt = 0;
store.subscribe('me', (me) => {
  boostEndsAt = me && me.boost_seconds > 0 ? Date.now() + me.boost_seconds * 1000 : 0;
}, { immediate: true });

export function boostLeft() {
  return Math.max(0, Math.round((boostEndsAt - Date.now()) / 1000));
}

export function fmtClock(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtHours(seconds) {
  const m = Math.max(1, Math.round(seconds / 60));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/**
 * Keep a "2× XP 14:59" chip in step with the boost: shown while it runs,
 * hidden after. `chip` holds a [data-value] span for the time left. Returns a
 * stop function.
 */
export function tickBoost(chip) {
  let timer = null;
  const paint = () => {
    const left = boostLeft();
    chip.hidden = left <= 0;
    chip.querySelector('[data-value]').textContent = fmtClock(left);
    chip.setAttribute('aria-label', `Double XP for ${fmtHours(left)}`);
    if (left <= 0 && timer) { clearInterval(timer); timer = null; }
    if (left > 0 && !timer) timer = setInterval(paint, 1000);
  };
  paint();
  const unsubscribe = store.subscribe('me', paint);
  return () => { unsubscribe(); if (timer) clearInterval(timer); };
}

/* ------------------------------------------------------------------ chests */
export async function openChest(id) {
  const tz = encodeURIComponent(store.get('settings').timezone);
  const res = await post(withNow(`/api/chests/${id}/open?tz=${tz}`), {});
  if (res && res.me) store.set('me', res.me);
  return res;
}

function revealed(node, reward) {
  node.dataset.reward = reward.kind;
  node.replaceChildren(
    el('span', { class: 'chest-icon' }, icon(reward.icon)),
    el('div', { class: 'chest-text' },
      el('strong', { class: 'chest-title' }, reward.title),
      el('span', { class: 'chest-subtitle' }, reward.description)));
}

/**
 * chestCard(chest, { onOpened }) → a closed chest with an Open button, or the
 * reward once opened. Opening wobbles the chest (skipped under reduced motion),
 * then shows what was inside; a live region announces it.
 */
export function chestCard(chest, { onOpened = null } = {}) {
  const node = el('div', { class: 'chest', 'data-chest': chest.id, role: 'group', 'aria-label': chest.title });
  if (chest.opened && chest.reward) {
    revealed(node, chest.reward);
    return node;
  }
  const open = el('button', { type: 'button', class: 'button button-filled button-sm chest-open' }, 'Open');
  const live = el('span', { class: 'visually-hidden', role: 'status' });
  node.append(
    el('span', { class: 'chest-icon' }, icon('redeem')),
    el('div', { class: 'chest-text' },
      el('strong', { class: 'chest-title' }, chest.title),
      chest.subtitle ? el('span', { class: 'chest-subtitle' }, chest.subtitle) : null),
    open, live);
  open.addEventListener('click', async () => {
    open.disabled = true;
    const wait = prefersReducedMotion() ? 0 : 520;
    node.classList.add('is-opening');
    let res;
    try {
      [res] = await Promise.all([openChest(chest.id), new Promise((r) => setTimeout(r, wait))]);
    } catch {
      node.classList.remove('is-opening');
      open.disabled = false;
      return;
    }
    node.classList.remove('is-opening');
    const reward = res.chest.reward;
    revealed(node, reward);
    node.append(el('span', { class: 'visually-hidden', role: 'status' }, `You got ${reward.title}.`));
    if (onOpened) onOpened(res, node);
  });
  return node;
}

/** A column of chest cards. `onAllOpened` runs once every chest in it is open. */
export function chestList(chests, { onOpened = null, onAllOpened = null } = {}) {
  let left = chests.filter((c) => !c.opened).length;
  return el('div', { class: 'chest-list' }, ...chests.map((c) => chestCard(c, {
    onOpened(res, node) {
      if (onOpened) onOpened(res, node);
      left -= 1;
      if (left === 0 && onAllOpened) onAllOpened();
    },
  })));
}

export async function unopenedChests() {
  try { return (await get('/api/chests', { silent: true })).unopened; } catch { return []; }
}

/* ------------------------------------------------------------------ quests */
const TIER_LABELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };

/** questList(quests, { compact }) → three rows: icon, title, a meter, the chest state. */
export function questList(quests, { compact = false } = {}) {
  return el('div', { class: `quest-list ${compact ? 'is-compact' : ''}` }, ...quests.map((q) => {
    const pct = Math.round((q.progress / Math.max(1, q.target)) * 100);
    const state = q.done
      ? el('span', { class: `chip ${q.chest && !q.chest.opened ? 'chip-primary' : 'chip-success'}` },
        icon(q.chest && !q.chest.opened ? 'redeem' : 'check', 'icon-sm'), q.chest && !q.chest.opened ? 'Chest' : 'Done')
      : el('span', { class: 'chip' }, TIER_LABELS[q.tier] || q.tier);
    return el('div', { class: `quest ${q.done ? 'is-done' : ''}`, 'data-quest': q.key },
      el('span', { class: 'quest-icon' }, icon(q.icon)),
      el('div', { class: 'quest-body' },
        el('div', { class: 'quest-title' }, q.title),
        el('div', { class: 'quest-progress' },
          el('div', { class: `meter ${q.done ? 'meter-success' : ''}`, role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${q.title}: ${q.progress} of ${q.target}` },
            el('span', { class: 'meter-fill', style: `--value: ${pct}%` })),
          el('span', { class: 'quest-count' }, `${q.progress}/${q.target}`))),
      state);
  }));
}

export async function loadQuests() {
  const tz = encodeURIComponent(store.get('settings').timezone);
  try { return await get(withNow(`/api/quests?tz=${tz}`), { silent: true }); } catch { return null; }
}
