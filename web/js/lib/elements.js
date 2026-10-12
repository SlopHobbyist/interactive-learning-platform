/* Element loading and mounting.

   The server lists installed elements at /api/elements (manifest + module URL).
   Each element is an ES module exporting { type, mount(root, ctx) -> handle }.
   See docs/ELEMENTS.md for the contract. Nothing here knows any element type. */

import { get } from '../api.js';
import * as dom from './dom.js';
import * as answers from './answers.js';
import { renderMath } from './math.js';

/** Helpers handed to elements as ctx.lib. Elements never import app modules. */
export const lib = Object.freeze({
  html: dom.html,
  raw: dom.raw,
  el: dom.el,
  icon: dom.icon,
  clear: dom.clear,
  first: dom.first,
  escapeHtml: dom.escapeHtml,
  plural: dom.plural,
  prefersReducedMotion: dom.prefersReducedMotion,
  renderMath,
  normalize: answers.normalize,
  matchesAny: answers.matchesAny,
  matchesPattern: answers.matchesPattern,
  parseNumber: answers.parseNumber,
  numberWithin: answers.numberWithin,
  shuffle: answers.shuffle,
  derange: answers.derange,
  seeded: answers.seeded,
  hashString: answers.hashString,
});

let registryPromise = null;
const modules = new Map();
const cssLoaded = new Set();

export async function registry() {
  if (!registryPromise) {
    registryPromise = get('/api/elements', { cache: true }).then((list) => {
      const map = new Map();
      list.forEach((m) => map.set(m.type, m));
      return map;
    });
  }
  return registryPromise;
}

export async function manifest(type) {
  return (await registry()).get(type) || null;
}

function ensureCss(m) {
  if (!m.css || cssLoaded.has(m.css)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = m.css;
  link.dataset.element = m.type;
  document.head.append(link);
  cssLoaded.add(m.css);
}

/** Import an element module (cached). Throws when the element is missing or broken. */
export async function load(type) {
  const m = await manifest(type);
  if (!m) throw new Error(`Element "${type}" is not installed.`);
  ensureCss(m);
  if (!modules.has(type)) {
    modules.set(type, import(m.module).then((mod) => {
      const def = mod.default || mod;
      if (!def || typeof def.mount !== 'function') throw new Error(`Element "${type}" has no mount().`);
      return def;
    }).catch((err) => { modules.delete(type); throw err; }));
  }
  return modules.get(type);
}

/**
 * Mount an item into `root`. Returns { handle, manifest } or a fallback handle when
 * the element is missing or throws (the "skip item" error boundary).
 * ctx: { lang, onChange(ready), onSubmit() }
 */
export async function mountItem(root, item, ctx = {}) {
  const context = {
    item,
    lang: ctx.lang || document.documentElement.lang || 'en',
    onChange: ctx.onChange || (() => {}),
    onSubmit: ctx.onSubmit || (() => {}),
    ui: window.UI,
    lib,
  };
  let m = null;
  try {
    m = await manifest(item.type);
    const def = await load(item.type);
    const handle = def.mount(root, context) || {};
    const wrapped = {
      getAnswer: () => (handle.getAnswer ? handle.getAnswer() : null),
      check: (answer) => (handle.check ? handle.check(answer) : { correct: true }),
      showResult: (r) => { if (handle.showResult) handle.showResult(r); },
      focus: () => { if (handle.focus) handle.focus(); else root.querySelector('button, input, [tabindex]')?.focus(); },
      destroy: () => { if (handle.destroy) handle.destroy(); },
    };
    renderMath(root);
    return { handle: wrapped, manifest: m, error: null };
  } catch (err) {
    console.error(`[elements] "${item.type}" failed to mount`, err);
    dom.mount(root, dom.el('div', { class: 'alert alert-warning', role: 'alert' },
      dom.icon('extension_off'),
      dom.el('div', { class: 'alert-body' },
        dom.el('strong', { class: 'alert-title' }, m ? `The "${item.type}" element crashed` : `Element "${item.type}" is not installed`),
        m ? String(err && err.message || err) : 'This item is skipped. Run `ilp validate` to find content that uses missing elements.')));
    context.onChange(true);
    return {
      handle: {
        getAnswer: () => null,
        check: () => ({ correct: true, skipped: true }),
        showResult: () => {},
        focus: () => {},
        destroy: () => {},
      },
      manifest: m || { type: item.type, graded: false, self_graded: false },
      error: err,
    };
  }
}
