/* fill-blank — ___ blanks inside a prompt, typed or filled from a word bank.
   The server turns every ___ into <span class="blank" data-blank="n">; this
   element swaps each for an input (typed mode) or a slot button (bank mode). */

export default {
  type: 'fill-blank',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, shuffle, matchesAny, escapeHtml } = lib;
    const accepted = item.answers.map((a) => (Array.isArray(a) ? a : [a]));
    const bankMode = Array.isArray(item.bank);
    let locked = false;

    root.append(html`
      <div class="el-fill">
        <div class="prose el-prompt el-fill-prompt">${raw(item.prompt_html || '')}</div>
      </div>`);
    const wrap = root.querySelector('.el-fill');
    const slots = [...root.querySelectorAll('span.blank')];
    const n = Math.min(slots.length, accepted.length);
    const values = new Array(n).fill('');

    function ready() { return values.every((v) => v.trim() !== ''); }

    // --- typed mode --------------------------------------------------------
    const inputs = [];
    let bankButtons = [];
    let active = 0;

    if (!bankMode) {
      slots.slice(0, n).forEach((span, i) => {
        const longest = Math.max(...accepted[i].map((a) => a.length), 4);
        const input = el('input', {
          type: 'text', class: 'el-blank', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
          'aria-label': `Blank ${i + 1} of ${n}`, style: `--blank-width: ${Math.min(longest + 2, 28)}ch`,
        });
        input.addEventListener('input', () => { values[i] = input.value; ctx.onChange(ready()); });
        span.replaceWith(input);
        inputs.push(input);
      });
    } else {
      // --- bank mode -------------------------------------------------------
      slots.slice(0, n).forEach((span, i) => {
        const btn = el('button', { type: 'button', class: 'el-blank el-slot', 'aria-pressed': 'false', 'aria-label': `Blank ${i + 1} of ${n}, empty` });
        btn.addEventListener('click', () => {
          if (locked) return;
          if (values[i]) { // return the word to the bank
            const word = values[i];
            values[i] = '';
            btn.textContent = '';
            btn.setAttribute('aria-label', `Blank ${i + 1} of ${n}, empty`);
            bankButtons.find((b) => b.dataset.word === word && b.classList.contains('is-used'))?.classList.remove('is-used');
          }
          setActive(i);
          ctx.onChange(ready());
        });
        span.replaceWith(btn);
        inputs.push(btn);
      });
      const words = shuffle([...new Set([...item.bank, ...accepted.map((a) => a[0])])], `${item.id}:bank`);
      bankButtons = words.map((w) => {
        const b = el('button', { type: 'button', class: 'chip chip-clickable', 'data-word': w }, w);
        b.addEventListener('click', () => {
          if (locked || b.classList.contains('is-used')) return;
          let target = values[active] ? values.findIndex((v) => !v) : active;
          if (target < 0) return;
          values[target] = w;
          inputs[target].textContent = w;
          inputs[target].setAttribute('aria-label', `Blank ${target + 1} of ${n}, ${w}`);
          b.classList.add('is-used');
          const next = values.findIndex((v) => !v);
          setActive(next < 0 ? target : next);
          ctx.onChange(ready());
        });
        return b;
      });
      wrap.append(el('div', { class: 'el-bank', role: 'group', 'aria-label': 'Word bank' }, ...bankButtons));
      setActive(0);
    }

    function setActive(i) {
      active = i;
      inputs.forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
    }

    function onKey(event) {
      if (!bankMode || locked || event.altKey || event.ctrlKey || event.metaKey) return;
      const k = Number(event.key);
      if (Number.isInteger(k) && k >= 1 && k <= bankButtons.length) {
        event.preventDefault();
        bankButtons[k - 1].click();
      }
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer: () => (ready() ? values.slice() : null),
      check(answer) {
        const results = (answer || []).map((v, i) => matchesAny(v, accepted[i], item.normalize));
        const right = results.filter(Boolean).length;
        return {
          correct: right === n && n > 0,
          partial: n ? right / n : 0,
          feedback_html: item.explain_html || '',
          correct_answer_html: accepted.map((a) => `<strong>${escapeHtml(a[0])}</strong>`).join(', '),
          blanks: results,
        };
      },
      showResult(result) {
        locked = true;
        inputs.forEach((input, i) => {
          input.disabled = true;
          const ok = result.blanks ? result.blanks[i] : result.correct;
          input.classList.add(ok ? 'is-valid' : 'is-invalid');
          if (!ok && !bankMode) input.title = `Expected: ${accepted[i][0]}`;
        });
        bankButtons.forEach((b) => { b.disabled = true; });
      },
      focus() { (inputs.find((i) => !i.disabled && (bankMode || !i.value)) || inputs[0])?.focus(); },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
