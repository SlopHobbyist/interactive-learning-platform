/* match-pairs — two shuffled columns; tap one on each side to pair them.
   A right pair locks; a wrong pair is counted and released. The item submits
   itself once every pair is matched. Keys: 1–8 pick on the left, a–h on the
   right; the arrow keys move between options. Focus follows the flow: picking
   on one side moves it to the other, and a matched pair hands it to the next
   open option, so it never sits on a locked button. */

export default {
  type: 'match-pairs',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, derange } = lib;
    const pairs = item.pairs;
    const n = pairs.length;
    const leftOrder = derange(pairs.map((_, i) => i), `${item.id}:left`);
    const rightOrder = derange(pairs.map((_, i) => i), `${item.id}:right`);
    let picked = { left: null, right: null };
    let matched = 0;
    let mistakes = 0;
    let locked = false;

    function option(side, idx, pos) {
      const text = side === 'left' ? (pairs[idx].left_html || pairs[idx].left) : (pairs[idx].right_html || pairs[idx].right);
      const key = side === 'left' ? String(pos + 1) : String.fromCharCode(97 + pos);
      const btn = el('button', { type: 'button', class: 'el-option el-pair', 'aria-pressed': 'false', 'data-side': side, 'data-index': String(idx) },
        el('span', { class: 'el-key', 'aria-hidden': 'true' }, key),
        el('span', { class: 'el-option-text', html: text }));
      btn.addEventListener('click', () => pick(side, btn));
      return btn;
    }
    const leftButtons = leftOrder.map((idx, pos) => option('left', idx, pos));
    const rightButtons = rightOrder.map((idx, pos) => option('right', idx, pos));

    root.append(html`
      <div class="el-match">
        <div class="prose el-prompt mb-4">${raw(item.prompt_html || '<p>Match the pairs.</p>')}</div>
        <div class="el-match-grid">
          <div class="el-options" role="group" aria-label="Left column">${leftButtons}</div>
          <div class="el-options" role="group" aria-label="Right column">${rightButtons}</div>
        </div>
        <p class="text-caption text-muted mt-3 el-match-status" aria-live="polite"></p>
      </div>`);
    const status = root.querySelector('.el-match-status');

    function setStatus() {
      status.textContent = `${matched} of ${n} matched${mistakes ? `, ${mistakes} ${mistakes === 1 ? 'miss' : 'misses'}` : ''}.`;
    }
    setStatus();

    const open = (buttons) => buttons.filter((b) => !b.disabled);
    // Move focus only while it is in this element (or lost): never pull it from elsewhere.
    function moveFocus(btn) {
      const a = document.activeElement;
      if (btn && (root.contains(a) || a === document.body)) btn.focus();
    }

    function pick(side, btn) {
      if (locked || btn.classList.contains('is-matched')) return;
      if (picked[side] === btn) { // tap again to unpick
        btn.setAttribute('aria-pressed', 'false');
        picked[side] = null;
        return;
      }
      if (picked[side]) picked[side].setAttribute('aria-pressed', 'false');
      picked[side] = btn;
      btn.setAttribute('aria-pressed', 'true');
      if (picked.left && picked.right) resolve();
      else moveFocus(open(side === 'left' ? rightButtons : leftButtons)[0]);
    }

    function resolve() {
      const l = picked.left; const r = picked.right;
      picked = { left: null, right: null };
      const ok = l.dataset.index === r.dataset.index;
      // Before the pair locks: a disabled button drops focus to <body>.
      moveFocus(ok ? open(leftButtons).find((b) => b !== l) || open(rightButtons).find((b) => b !== r) : l);
      [l, r].forEach((b) => {
        b.setAttribute('aria-pressed', 'false');
        b.classList.add(ok ? 'is-matched' : 'is-wrong');
        if (ok) { b.classList.add('is-correct', 'is-locked'); b.disabled = true; }
      });
      if (ok) {
        matched += 1;
        setStatus();
        if (matched === n) { ctx.onChange(true); ctx.onSubmit(); }
      } else {
        mistakes += 1;
        setStatus();
        setTimeout(() => [l, r].forEach((b) => b.classList.remove('is-wrong')), 500);
      }
    }

    /* Arrows: up/down within a column, left/right to the nearest open option across. */
    function arrow(btn, key) {
      const cols = [leftButtons, rightButtons];
      const c = btn.dataset.side === 'left' ? 0 : 1;
      const pos = cols[c].indexOf(btn);
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const step = key === 'ArrowUp' ? -1 : 1;
        for (let p = pos + step; p >= 0 && p < n; p += step) if (!cols[c][p].disabled) return cols[c][p];
        return null;
      }
      const other = cols[1 - c];
      return open(other).sort((a, b) => Math.abs(other.indexOf(a) - pos) - Math.abs(other.indexOf(b) - pos))[0] || null;
    }

    function onKey(event) {
      if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
      const k = event.key;
      const num = Number(k);
      if (Number.isInteger(num) && num >= 1 && num <= n) { event.preventDefault(); leftButtons[num - 1].focus(); pick('left', leftButtons[num - 1]); }
      else if (/^[a-h]$/.test(k) && k.charCodeAt(0) - 97 < n) { event.preventDefault(); const b = rightButtons[k.charCodeAt(0) - 97]; b.focus(); pick('right', b); }
      else if (k.startsWith('Arrow') && event.target.matches('.el-pair')) {
        const next = arrow(event.target, k);
        event.preventDefault();
        if (next) next.focus();
      }
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer: () => (matched === n ? { matched, mistakes } : null),
      check(answer) {
        const m = answer ? answer.mistakes : n;
        const score = Math.max(0, n - m) / n;
        return {
          correct: m === 0,
          partial: score,
          feedback_html: item.explain_html || (m ? `<p>${m} ${m === 1 ? 'miss' : 'misses'} along the way.</p>` : ''),
          correct_answer_html: m ? pairs.map((p) => `${p.left_html || p.left} → ${p.right_html || p.right}`).join('<br>') : '',
        };
      },
      showResult() {
        locked = true;
        [...leftButtons, ...rightButtons].forEach((b) => { b.disabled = true; b.classList.add('is-locked'); });
      },
      focus() { (leftButtons.find((b) => !b.disabled) || leftButtons[0]).focus(); },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
