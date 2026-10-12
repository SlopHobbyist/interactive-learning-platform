/* true-false — a statement and two big buttons. Keys 1 / 2 pick. */

export default {
  type: 'true-false',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el } = lib;
    const labels = item.labels && item.labels.length === 2 ? item.labels : ['True', 'False'];
    let value = null;
    let locked = false;

    const buttons = [true, false].map((v, i) =>
      el('button', { type: 'button', class: 'el-option', 'aria-pressed': 'false', 'data-value': String(v) },
        el('span', { class: 'el-key', 'aria-hidden': 'true' }, String(i + 1)),
        el('span', { class: 'el-option-text' }, labels[i])));

    function pick(v) {
      if (locked) return;
      value = v;
      buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === String(v))));
      ctx.onChange(true);
    }
    buttons[0].addEventListener('click', () => pick(true));
    buttons[1].addEventListener('click', () => pick(false));

    root.append(html`
      <div class="el-tf">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '')}</div>
        <div class="el-options-row" role="group" aria-label="Answer">${buttons}</div>
      </div>`);

    function onKey(event) {
      if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === '1') { event.preventDefault(); pick(true); buttons[0].focus(); }
      if (event.key === '2') { event.preventDefault(); pick(false); buttons[1].focus(); }
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer: () => value,
      check(answer) {
        const ok = answer === item.answer;
        return {
          correct: ok,
          partial: ok ? 1 : 0,
          feedback_html: item.explain_html || '',
          correct_answer_html: lib.escapeHtml(item.answer ? labels[0] : labels[1]),
        };
      },
      showResult() {
        locked = true;
        buttons.forEach((b) => {
          const v = b.dataset.value === 'true';
          b.disabled = true;
          b.classList.add('is-locked');
          if (v === value && v === item.answer) b.classList.add('is-correct');
          else if (v === value) b.classList.add('is-wrong');
          else if (v === item.answer) b.classList.add('is-missed');
        });
      },
      focus() { (value === null ? buttons[0] : buttons[value ? 0 : 1]).focus(); },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
