/* order — reorder shuffled rows into the right sequence.
   Reuses Wavefront's reorder behavior (.sortable[data-reorder]): drag the
   handle, or focus it and press Space then the arrow keys. The kit grabs on
   Enter as well, which would leave the keyboard no way to Check; here Enter on
   a handle that is not held submits instead (Enter still drops a held row).
   With no row held, Up/Down move between handles (the kit only moves held rows). */

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
        <p class="text-caption text-muted mt-2">Drag a row, or use the keyboard: Up and Down choose a row, Space picks it up, Up and Down move it, Space drops it. Enter checks.</p>
      </div>`);
    const list = root.querySelector('.sortable');
    ctx.ui.init(root);

    // The kit does not fire an event on reorder; watch the DOM instead.
    const observer = new MutationObserver(() => ctx.onChange(true));
    observer.observe(list, { childList: true });
    ctx.onChange(true); // any order is a submittable answer

    // Capture phase, so it runs before the kit's handle listener.
    function onKey(event) {
      if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
      const handle = event.target.closest('.sortable-handle');
      if (!handle || handle.closest('.sortable-item').classList.contains('is-grabbed')) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        event.stopPropagation();
        ctx.onSubmit();
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        const handles = [...list.querySelectorAll('.sortable-handle')];
        const next = handles[handles.indexOf(handle) + (event.key === 'ArrowUp' ? -1 : 1)];
        event.preventDefault();
        if (next) next.focus();
      }
    }
    root.addEventListener('keydown', onKey, true);

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
      destroy() { observer.disconnect(); root.removeEventListener('keydown', onKey, true); },
    };
  },
};
