/* Element gallery (dev only): every installed element, every example item,
   mounted live with a Check button and the result JSON. This is the element
   developer's harness; the Playwright element tests drive it too. */

import { get } from '../api.js';
import { mountItem } from '../lib/elements.js';
import { el, icon, plural, clear } from '../lib/dom.js';
import { hero, body, section, page } from '../lib/view.js';

async function exampleCard(manifest, item) {
  const stage = el('div', { class: 'gallery-stage', 'data-item': item.id, 'data-type': item.type });
  const result = el('pre', { class: 'code-block gallery-result hidden', 'aria-live': 'polite' });
  const check = el('button', { type: 'button', class: 'button button-filled', disabled: true, 'data-action': 'check' }, icon('check'), 'Check');
  const reset = el('button', { type: 'button', class: 'button button-text', 'data-action': 'reset' }, icon('restart_alt'), 'Reset');
  const status = el('span', { class: 'chip', 'data-role': 'ready' }, 'not ready');

  let mounted = null;
  async function mount() {
    if (mounted) mounted.handle.destroy();
    clear(stage);
    result.classList.add('hidden');
    result.textContent = '';
    check.disabled = true;
    status.textContent = manifest.graded ? 'not ready' : 'ungraded';
    mounted = await mountItem(stage, item, {
      onChange(ready) {
        check.disabled = !ready || !manifest.graded || manifest.self_graded;
        if (manifest.graded) status.textContent = ready ? 'ready' : 'not ready';
      },
      onSubmit() { doCheck(); },
    });
    if (manifest.self_graded) check.classList.add('hidden');
    window.UI.init(stage);
    if (mounted.error) status.textContent = 'error';
  }
  function doCheck() {
    if (!mounted) return;
    const answer = mounted.handle.getAnswer();
    const res = mounted.handle.check(answer);
    mounted.handle.showResult(res);
    result.textContent = JSON.stringify({ answer, result: res }, null, 2);
    result.classList.remove('hidden');
    result.dataset.correct = String(Boolean(res.correct));
    check.disabled = true;
    status.textContent = res.correct ? 'correct' : 'incorrect';
    status.className = `chip ${res.correct ? 'chip-success' : 'chip-danger'}`;
  }
  check.addEventListener('click', doCheck);
  reset.addEventListener('click', () => { status.className = 'chip'; mount(); });
  await mount();

  return el('article', { class: 'card gallery-card', 'data-example': `${item.type}/${item.id}` },
    el('div', { class: 'card-header' },
      el('div', { class: 'card-header-text' },
        el('h3', { class: 'card-title' }, el('code', { class: 'code-inline' }, item.id))),
      status),
    el('div', { class: 'card-body' }, stage),
    el('div', { class: 'card-actions card-actions-split' }, el('div', { class: 'row' }, check, reset)),
    el('div', { class: 'card-body' }, result));
}

export default async function view({ setTitle, query }) {
  setTitle('Element gallery');
  const elements = await get('/api/elements', { cache: true });
  const only = query.type ? elements.filter((e) => e.type === query.type) : elements;
  const sections = [];
  for (const m of only) {
    const examples = await get(`/api/elements/${m.type}/examples`, { cache: true });
    const cards = [];
    for (const item of examples) cards.push(await exampleCard(m, item));
    const title = el('h2', { class: 'view-section-title', id: `el-${m.type}` },
      icon(m.icon || 'extension', 'icon-sm'), ' ', m.title, ' ',
      el('code', { class: 'code-inline' }, m.type), ' ',
      el('span', { class: 'text-muted' }, m.graded ? (m.self_graded ? 'self-graded' : 'graded') : 'ungraded'));
    sections.push(section(title,
      m.description ? el('p', { class: 'text-muted mb-3' }, m.description) : null,
      cards.length ? el('div', { class: 'stack' }, ...cards) : el('p', { class: 'text-muted' }, 'No examples.yaml.')));
  }
  const nav = el('div', { class: 'chip-set mt-3' }, ...elements.map((m) =>
    el('a', { class: `chip chip-clickable app-chip ${query.type === m.type ? 'chip-primary' : ''}`, href: `/dev/elements${query.type === m.type ? '' : `?type=${m.type}`}` }, m.type)));
  return page(
    hero({ eyebrow: 'Developer', title: 'Element gallery', lede: `${plural(elements.length, 'element')} installed from elements/. Each example below is live: answer it and press Check to see what check() returns.`, extra: nav }),
    body(...sections),
  );
}
