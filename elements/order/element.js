/* order — reorder shuffled rows into the right sequence.
   Reuses Wavefront's reorder behavior (.sortable[data-reorder]): drag the
   handle, or focus it and press Space then the arrow keys. */

export default {
  type: 'order',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, derange } = lib;
    const steps = item.steps_html || item.steps;
    const start = derange(steps.map((_, i) => i), `${item.id}:order`);
    let locked = false;

    const rows = start.map((idx) =>
      el('li', { class: 'sortable-item el-order-row', 'data-index': String(idx) },
        el('button', { class: 'sortable-handle', type: 'button' }, el('span', { class: 'icon' }, 'drag_indicator')),
        el('span', { class: 'sortable-item-text', html: steps[idx] }),
        el('span', { class: 'sortable-position' })));

    root.append(html`
      <div class="el-order">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '')}</div>
        <ul class="sortable" data-reorder aria-label="Steps">${rows}</ul>
        <p class="text-caption text-muted mt-2">Drag a row, or focus its handle and press Space, then the arrow keys.</p>
      </div>`);
    const list = root.querySelector('.sortable');
    ctx.ui.init(root);

    // The kit does not fire an event on reorder; watch the DOM instead.
    const observer = new MutationObserver(() => ctx.onChange(true));
    observer.observe(list, { childList: true });
    ctx.onChange(true); // any order is a submittable answer

    function current() {
      return [...list.querySelectorAll('.sortable-item')].map((li) => Number(li.dataset.index));
    }

    return {
      getAnswer: () => current(),
      check(answer) {
        const order = answer || current();
        const right = order.filter((v, i) => v === i).length;
        return {
          correct: right === steps.length,
          partial: right / steps.length,
          feedback_html: item.explain_html || '',
          correct_answer_html: `<ol>${steps.map((s) => `<li>${s}</li>`).join('')}</ol>`,
        };
      },
      showResult() {
        locked = true;
        [...list.querySelectorAll('.sortable-item')].forEach((li, pos) => {
          const ok = Number(li.dataset.index) === pos;
          li.classList.add(ok ? 'is-correct' : 'is-wrong');
          const h = li.querySelector('.sortable-handle');
          h.disabled = true;
          h.setAttribute('tabindex', '-1');
        });
        list.removeAttribute('data-reorder');
      },
      focus() { list.querySelector('.sortable-handle')?.focus(); },
      destroy() { observer.disconnect(); },
    };
  },
};
