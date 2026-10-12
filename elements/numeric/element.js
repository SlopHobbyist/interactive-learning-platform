/* numeric — a number with optional tolerance and unit. */

export default {
  type: 'numeric',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, parseNumber, numberWithin, escapeHtml } = lib;
    const input = el('input', {
      type: 'text', inputmode: 'decimal', class: 'input input-numeric el-input', autocomplete: 'off',
      placeholder: '0', 'aria-label': item.unit ? `Your answer in ${item.unit}` : 'Your answer',
    });
    input.addEventListener('input', () => ctx.onChange(Number.isFinite(parseNumber(input.value))));

    const field = item.unit
      ? el('div', { class: 'input-group' }, input, el('span', { class: 'input-affix' }, item.unit))
      : input;

    root.append(html`
      <div class="el-num">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '')}</div>
        <div class="field el-input-wrap">${field}</div>
      </div>`);

    const tolerance = item.tolerance || 0;
    const type = item.tolerance_type || 'absolute';

    return {
      getAnswer() {
        const n = parseNumber(input.value);
        return Number.isFinite(n) ? n : null;
      },
      check(answer) {
        const ok = numberWithin(answer, item.answer, tolerance, type);
        let shown = `<strong>${escapeHtml(String(item.answer))}${item.unit ? ' ' + escapeHtml(item.unit) : ''}</strong>`;
        if (tolerance) shown += ` <span class="text-muted">(±${escapeHtml(String(tolerance))}${type === 'percent' ? ' %' : ''})</span>`;
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
