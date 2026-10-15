/* fill-blank — ___ blanks inside a prompt, typed or filled from a word bank.
   The server turns every ___ into <span class="blank" data-blank="n">; this
   element swaps each for an input (typed mode) or a slot button (bank mode).
   Keyboard: in typed mode Enter moves to the next empty blank until all are
   filled (then the player checks). In bank mode 1–9 place a word; a placed
   chip is pressed, so Enter on it checks and Space or a click returns it. */

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
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || ready() || e.isComposing) return;
          e.preventDefault(); // not ready: Enter goes to the next empty blank instead of nowhere
          const after = inputs.slice(i + 1).concat(inputs.slice(0, i + 1));
          (after.find((x) => !x.value.trim()) || input).focus();
        });
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
            unplace(i);
          }
          setActive(i);
          ctx.onChange(ready());
        });
        span.replaceWith(btn);
        inputs.push(btn);
      });
      const words = shuffle([...new Set([...item.bank, ...accepted.map((a) => a[0])])], `${item.id}:bank`);
      bankButtons = words.map((w) => {
        const b = el('button', { type: 'button', class: 'chip chip-clickable', 'data-word': w, 'aria-pressed': 'false' }, w);
        b.addEventListener('click', () => {
          if (locked) return;
          if (b.classList.contains('is-used')) { // a placed word goes back to the bank
            const slot = values.indexOf(w);
            if (slot >= 0) { unplace(slot); setActive(slot); ctx.onChange(ready()); }
            return;
          }
          let target = values[active] ? values.findIndex((v) => !v) : active;
          if (target < 0) return;
          values[target] = w;
          inputs[target].textContent = w;
          inputs[target].setAttribute('aria-label', `Blank ${target + 1} of ${n}, ${w}`);
          b.classList.add('is-used');
          b.setAttribute('aria-pressed', 'true');
          const next = values.findIndex((v) => !v);
          setActive(next < 0 ? target : next);
          ctx.onChange(ready());
        });
        return b;
      });
      wrap.append(el('div', { class: 'el-bank', role: 'group', 'aria-label': 'Word bank' }, ...bankButtons));
      setActive(0);
    }

    function unplace(i) {
      const word = values[i];
      values[i] = '';
      inputs[i].textContent = '';
      inputs[i].setAttribute('aria-label', `Blank ${i + 1} of ${n}, empty`);
      const chip = bankButtons.find((b) => b.dataset.word === word && b.classList.contains('is-used'));
      if (chip) { chip.classList.remove('is-used'); chip.setAttribute('aria-pressed', 'false'); }
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
        bankButtons[k - 1].focus(); // focus what was picked, as the option elements do
        bankButtons[k - 1].click();
      }
    }
    root.addEventListener('keydown', onKey);

    function gradeInOrder(given) {
      return {
        results: given.map((v, i) => matchesAny(v, accepted[i], item.normalize)),
        expected: accepted.map((a) => a[0]),
      };
    }

    // ordered: false — any blank may hold any answer, each answer used once. A maximum
    // bipartite matching (augmenting paths), so overlapping alternatives can't block each other.
    function gradeAnyOrder(given) {
      const owner = new Array(n).fill(-1); // answer index -> blank index
      const fits = given.map((v) => accepted.map((alts) => matchesAny(v, alts, item.normalize)));
      const assign = (blank, seen) => {
        for (let a = 0; a < n; a++) {
          if (!fits[blank][a] || seen[a]) continue;
          seen[a] = true;
          if (owner[a] < 0 || assign(owner[a], seen)) { owner[a] = blank; return true; }
        }
        return false;
      };
      const results = given.map((_, blank) => assign(blank, new Array(n).fill(false)));
      // A wrong blank's hint is one of the answers nobody matched.
      const unused = accepted.filter((_, a) => owner[a] < 0).map((alts) => alts[0]);
      const expected = results.map((ok) => (ok ? '' : unused.shift() || ''));
      return { results, expected };
    }

    return {
      getAnswer: () => (ready() ? values.slice() : null),
      check(answer) {
        const given = (answer || []).slice(0, n);
        const { results, expected } = item.ordered === false ? gradeAnyOrder(given) : gradeInOrder(given);
        const right = results.filter(Boolean).length;
        return {
          correct: right === n && n > 0,
          partial: n ? right / n : 0,
          feedback_html: item.explain_html || '',
          correct_answer_html: accepted.map((a) => `<strong>${escapeHtml(a[0])}</strong>`).join(', '),
          blanks: results,
          expected,
        };
      },
      showResult(result) {
        locked = true;
        inputs.forEach((input, i) => {
          input.disabled = true;
          const ok = result.blanks ? result.blanks[i] : result.correct;
          input.classList.add(ok ? 'is-valid' : 'is-invalid');
          const want = result.expected ? result.expected[i] : accepted[i][0];
          if (!ok && !bankMode && want) input.title = `Expected: ${want}`;
        });
        bankButtons.forEach((b) => { b.disabled = true; });
      },
      focus() { (inputs.find((i) => !i.disabled && (bankMode || !i.value)) || inputs[0])?.focus(); },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
