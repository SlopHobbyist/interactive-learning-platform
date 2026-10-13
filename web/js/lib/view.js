/* Shared view chrome: hero header, sections, empty states, loading. */

import { el, icon } from './dom.js';

/**
 * hero({ eyebrow, title, lede, back: { href, label }, actions: [nodes], aside: node })
 * Extends .page-hero (see app.css .view-hero). `aside` sits top right, level with the back link.
 */
export function hero({ eyebrow, title, lede, back, actions = [], extra = null, aside = null } = {}) {
  const inner = el('div', { class: 'container' });
  const backLink = back ? el('a', { class: 'view-back', href: back.href }, icon('arrow_back', 'icon-sm'), back.label) : null;
  if (aside) inner.append(el('div', { class: 'view-hero-top' }, backLink || el('span'), aside));
  else if (backLink) inner.append(backLink);
  if (eyebrow) inner.append(el('p', { class: 'page-eyebrow mt-2' }, eyebrow));
  inner.append(el('h1', { class: 'view-title' }, title));
  if (lede) inner.append(el('p', { class: 'page-lede' }, lede));
  if (actions.length) inner.append(el('div', { class: 'row mt-4' }, ...actions));
  if (extra) inner.append(extra);
  return el('section', { class: 'view-hero' }, inner);
}

export function body(...children) {
  return el('section', { class: 'view-body' }, el('div', { class: 'container' }, ...children));
}

export function section(title, ...children) {
  const node = el('section', { class: 'view-section' });
  if (title) node.append(typeof title === 'string' ? el('h2', { class: 'view-section-title' }, title) : title);
  node.append(...children.filter((c) => c != null && c !== false));
  return node;
}

export function emptyState(iconName, title, text, action = null) {
  const node = el('div', { class: 'empty-state' }, icon(iconName), el('p', { class: 'text-heading-3' }, title));
  if (text) node.append(el('p', {}, text));
  if (action) node.append(action);
  return node;
}

export function page(...parts) {
  return el('div', { class: 'view' }, ...parts);
}

/** A card-style notice for parts of the app that a later phase delivers. */
export function comingSoon(phase, what) {
  return el('div', { class: 'card card-flat' },
    el('div', { class: 'card-body' },
      el('p', {}, `${what} arrives in Phase ${phase}.`)));
}
