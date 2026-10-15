/* DOM helpers shared by views, the player and (through ctx.lib) the elements.
   No framework: a tagged template that escapes by default, and a tiny `el`. */

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Mark a string as already-safe HTML (e.g. the server's sanitised `*_html` fields). */
export function raw(htmlString) {
  return { __raw: htmlString == null ? '' : String(htmlString) };
}

function stringify(value, nodes) {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map((v) => stringify(v, nodes)).join('');
  if (value instanceof Node) {
    nodes.push(value);
    return `<template data-node="${nodes.length - 1}"></template>`;
  }
  if (typeof value === 'object' && '__raw' in value) return value.__raw;
  return escapeHtml(value);
}

/**
 * html`<p>${text}</p>` → DocumentFragment. Interpolations are escaped unless
 * wrapped in raw(); Nodes and arrays are supported.
 */
export function html(strings, ...values) {
  const nodes = [];
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += stringify(values[i], nodes);
  });
  const tpl = document.createElement('template');
  tpl.innerHTML = out.trim();
  const frag = tpl.content;
  if (nodes.length) {
    frag.querySelectorAll('template[data-node]').forEach((slot) => {
      slot.replaceWith(nodes[Number(slot.dataset.node)]);
    });
  }
  return frag;
}

/** First element of a fragment (convenient when a template has one root). */
export function first(frag) {
  return frag.firstElementChild;
}

/** el('button', { class: 'button', onclick: fn, 'aria-label': 'x' }, child, ...) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'html') node.innerHTML = value;
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function icon(name, extraClass = '') {
  const span = document.createElement('span');
  span.className = extraClass ? `icon ${extraClass}` : 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.textContent = name;
  return span;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace `node`'s children with `content` (Node, fragment or string) and wire Wavefront. */
export function mount(node, content) {
  clear(node);
  if (typeof content === 'string') node.innerHTML = content;
  else if (content) node.append(content);
  if (window.UI && typeof window.UI.init === 'function') window.UI.init(node);
  return node;
}

/* Motion: settings.motion is 'system' | 'reduce' | 'full'. The resolved answer lives on
   <html data-motion="reduce|full">, which every reduced-motion rule in CSS (ours and the
   kit's) keys off, so the site can allow motion while the OS asks for less, or the reverse. */
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
let motionPref = 'system';

function resolveMotion() {
  const reduce = motionPref === 'reduce' || (motionPref !== 'full' && motionQuery.matches);
  document.documentElement.setAttribute('data-motion', reduce ? 'reduce' : 'full');
}
motionQuery.addEventListener('change', resolveMotion);

export function applyMotion(pref) {
  motionPref = pref === 'reduce' || pref === 'full' ? pref : 'system';
  resolveMotion();
}

export function prefersReducedMotion() {
  const attr = document.documentElement.getAttribute('data-motion');
  return attr ? attr === 'reduce' : motionQuery.matches;
}

/** Format a count with a unit ("3 lessons"). */
export function plural(n, singular, pluralForm = `${singular}s`) {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
