/* short-answer — a typed answer matched against accepted answers and/or a regex. */

export default {
  type: 'short-answer',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, matchesAny, matchesPattern, escapeHtml } = lib;
    const id = `sa-${item.id}`;
    const input = el(item.multiline ? 'textarea' : 'input', {
      class: `${item.multiline ? 'textarea' : 'input'} el-input`,
      id,
      type: item.multiline ? null : 'text',
      rows: item.multiline ? 4 : null,
      placeholder: item.placeholder || 'Type your answer',
      autocomplete: 'off',
      autocapitalize: 'off',
      spellcheck: 'false',
      'aria-label': 'Your answer',
    });
    input.addEventListener('input', () => ctx.onChange(input.value.trim() !== ''));
    if (item.multiline) {
      // Enter inserts a newline here; the player checks on Ctrl/Cmd+Enter.
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) e.stopPropagation(); });
    }

    root.append(html`
      <div class="el-sa">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '')}</div>
        <div class="field el-input-wrap">${input}</div>
      </div>`);

    return {
      getAnswer: () => (input.value.trim() ? input.value : null),
      check(answer) {
        const byList = item.answers ? matchesAny(answer, item.answers, item.normalize) : false;
        const byPattern = item.pattern ? matchesPattern(answer, item.pattern, item.normalize) : false;
        const ok = byList || byPattern;
        const shown = item.answers && item.answers.length ? `<strong>${escapeHtml(item.answers[0])}</strong>` : '';
        return { correct: ok, partial: ok ? 1 : 0, feedback_html: item.explain_html || '', correct_answer_html: shown };
      },
      showResult(result) {
        input.readOnly = true;
        input.setAttribute('aria-invalid', String(!result.correct));
        input.classList.add(result.correct ? 'is-valid' : 'is-invalid');
      },
      focus() { input.focus(); },
      destroy() {},
    };
  },
};
