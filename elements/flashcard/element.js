/* flashcard — flip card with self-rating. Self-graded: there is no Check
   button; rating the card submits it. Space flips, 1–4 rate. */

const RATINGS = [
  { key: 'again', label: 'Again', hint: 'Forgot it' },
  { key: 'hard', label: 'Hard', hint: 'Barely' },
  { key: 'good', label: 'Good', hint: 'Got it' },
  { key: 'easy', label: 'Easy', hint: 'Instantly' },
];

export default {
  type: 'flashcard',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el } = lib;
    let flipped = false;
    let rating = null;
    let locked = false;

    const flipButton = el('button', { type: 'button', class: 'button button-tonal' }, el('span', { class: 'icon' }, 'flip'), 'Show answer');
    const hintButton = item.hint_html ? el('button', { type: 'button', class: 'button button-text' }, el('span', { class: 'icon' }, 'lightbulb'), 'Hint') : null;
    const rateButtons = RATINGS.map((r, i) =>
      el('button', { type: 'button', class: 'el-option el-rate', 'data-rating': r.key, 'aria-pressed': 'false' },
        el('span', { class: 'el-key', 'aria-hidden': 'true' }, String(i + 1)),
        el('span', { class: 'el-option-text' }, el('strong', {}, r.label), el('span', { class: 'block text-caption text-muted' }, r.hint))));

    root.append(html`
      <div class="el-card" data-flipped="false">
        <div class="el-card-face el-card-front">
          <p class="text-overline text-muted">Front</p>
          <div class="prose el-prompt">${raw(item.front_html || '')}</div>
          ${item.hint_html ? html`<p class="el-card-hint text-muted hidden">${raw(item.hint_html)}</p>` : ''}
        </div>
        <div class="el-card-face el-card-back hidden">
          <p class="text-overline text-muted">Back</p>
          <div class="prose el-prompt">${raw(item.back_html || '')}</div>
        </div>
        <div class="el-card-actions row mt-4">${flipButton}${hintButton || ''}</div>
        <div class="el-card-rate hidden mt-4">
          <p class="text-caption text-muted mb-2">How well did you know it?</p>
          <div class="el-options-row el-rate-grid" role="group" aria-label="Rate your recall">${rateButtons}</div>
        </div>
      </div>`);
    const card = root.querySelector('.el-card');

    function flip() {
      if (flipped || locked) return;
      flipped = true;
      card.dataset.flipped = 'true';
      root.querySelector('.el-card-back').classList.remove('hidden');
      root.querySelector('.el-card-actions').classList.add('hidden');
      root.querySelector('.el-card-rate').classList.remove('hidden');
      lib.renderMath(root);
      rateButtons[2].focus();
    }
    flipButton.addEventListener('click', flip);
    if (hintButton) {
      hintButton.addEventListener('click', () => {
        root.querySelector('.el-card-hint').classList.remove('hidden');
        if (document.activeElement === hintButton) flipButton.focus(); // before it is disabled
        hintButton.disabled = true;
      });
    }

    function rate(key) {
      if (!flipped || locked) return;
      rating = key;
      rateButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rating === key)));
      ctx.onChange(true);
      ctx.onSubmit();
    }
    rateButtons.forEach((b) => b.addEventListener('click', () => rate(b.dataset.rating)));

    function onKey(event) {
      if (locked || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!flipped && (event.key === ' ' || event.key === 'Spacebar') && !event.target.matches('button')) { event.preventDefault(); flip(); return; }
      if (!flipped && event.key === ' ' && event.target === flipButton) return; // native click handles it
      const n = Number(event.key);
      if (flipped && Number.isInteger(n) && n >= 1 && n <= 4) { event.preventDefault(); rate(RATINGS[n - 1].key); }
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer: () => (rating ? { rating } : null),
      check(answer) {
        const r = answer && answer.rating;
        const ok = r && r !== 'again';
        return { correct: Boolean(ok), partial: r === 'again' ? 0 : r === 'hard' ? 0.5 : 1, rating: r, feedback_html: '', correct_answer_html: '' };
      },
      showResult() {
        locked = true;
        rateButtons.forEach((b) => { b.disabled = true; b.classList.add('is-locked'); });
      },
      focus() { (flipped ? rateButtons[2] : flipButton).focus(); },
      destroy() { root.removeEventListener('keydown', onKey); },
    };
  },
};
