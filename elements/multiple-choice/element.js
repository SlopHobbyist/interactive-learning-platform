/* multiple-choice — pick one (or several) of 2–6 choices.
   Keyboard: 1–6 toggle a choice; the arrow keys move between choices (radios
   do this natively, the checkboxes of a multi-answer item get it here).
   Enter belongs to the player. */

export default {
  type: 'multiple-choice',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, derange } = lib;
    const multi = Array.isArray(item.answer);
    const correct = new Set(multi ? item.answer : [item.answer]);
    const order = item.shuffle === false
      ? item.choices.map((_, i) => i)
      : derange(item.choices.map((_, i) => i), `${item.id}:choices`);
    const name = `mc-${item.id}-${Math.random().toString(36).slice(2, 7)}`;
    let locked = false;

    const options = order.map((orig, pos) => {
      const input = el('input', { type: multi ? 'checkbox' : 'radio', name, value: String(orig), 'aria-describedby': `${name}-hint` });
      const label = el('label', { class: 'el-option', 'data-index': String(orig) },
        input,
        el('span', { class: 'el-key', 'aria-hidden': 'true' }, String(pos + 1)),
        el('span', { class: 'el-option-text', html: (item.choices_html || item.choices)[orig] }));
      input.addEventListener('change', () => ctx.onChange(selected().length > 0));
      return label;
    });

    root.append(html`
      <div class="el-mc">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '')}</div>
        <p class="text-caption text-muted mb-2" id="${name}-hint">${multi ? 'Select all that apply.' : 'Select one.'}</p>
        <div class="el-options" role="${multi ? 'group' : 'radiogroup'}" aria-label="Choices">${options}</div>
      </div>`);

    function selected() {
      return [...root.querySelectorAll('input:checked')].map((i) => Number(i.value)).sort((a, b) => a - b);
    }

    function onKey(event) {
      if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
      if (multi && /^Arrow(Up|Down|Left|Right)$/.test(event.key) && event.target.matches(`input[name="${name}"]`)) {
        const inputs = options.map((l) => l.querySelector('input'));
        const step = event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 1;
        event.preventDefault();
        inputs[(inputs.indexOf(event.target) + step + inputs.length) % inputs.length].focus();
        return;
      }
      const n = Number(event.key);
      if (!Number.isInteger(n) || n < 1 || n > options.length) return;
      if (event.target.matches('input, textarea') && !event.target.matches(`input[name="${name}"]`)) return;
      event.preventDefault();
      const input = options[n - 1].querySelector('input');
      if (multi) input.checked = !input.checked; else input.checked = true;
      input.focus();
      ctx.onChange(selected().length > 0);
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer() {
        const sel = selected();
        return sel.length ? sel : null;
      },
      check(answer) {
        const sel = new Set(answer || []);
        const ok = sel.size === correct.size && [...sel].every((i) => correct.has(i));
        const right = [...correct].map((i) => (item.choices_html || item.choices)[i]);
        return {
          correct: ok,
          partial: multi ? Math.max(0, ([...sel].filter((i) => correct.has(i)).length - [...sel].filter((i) => !correct.has(i)).length) / correct.size) : (ok ? 1 : 0),
          feedback_html: item.explain_html || '',
          correct_answer_html: right.join(multi ? ', ' : ''),
        };
      },
      showResult(result) {
        locked = true;
        options.forEach((label) => {
          const idx = Number(label.dataset.index);
          const input = label.querySelector('input');
          input.disabled = true;
          label.classList.add('is-locked');
          if (input.checked && correct.has(idx)) label.classList.add('is-correct');
          else if (input.checked) label.classList.add('is-wrong');
          else if (correct.has(idx) && !result.correct) label.classList.add('is-missed');
        });
      },
      focus() {
        (root.querySelector('input:checked') || options[0].querySelector('input')).focus();
      },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
