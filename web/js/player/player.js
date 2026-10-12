/* The lesson player UI. Drives a Session (engine.js), mounts elements, shows
   the Check bar and the feedback sheet, and ends on a summary screen.

   Layout (full-bleed on phones; the app topbar hides under body.is-player):
     .player
       .player-head   close · progress · combo · hearts
       .player-stage  the current item (or intro / retry / summary cards)
       .player-bar    Check / Continue
       .player-sheet  feedback (floats: a Wavefront bottom sheet, non-modal)
*/

import { Session } from './engine.js';
import { play } from './sounds.js';
import { mountItem } from '../lib/elements.js';
import { el, icon, clear, raw, html, prefersReducedMotion } from '../lib/dom.js';
import { store } from '../store.js';
import { sendAttempts, completeLesson } from '../progress.js';

function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * createPlayer({ lesson, mode, backHref, onDone }) → root element
 * mode: 'lesson' | 'review'
 */
export function createPlayer({ lesson, mode = 'lesson', backHref = '/', title = lesson.title, onDone = null }) {
  const settings = store.get('settings');
  const session = new Session(lesson, { combo: settings.combo, hardMode: settings.hardMode, mode });
  const sounds = settings.sounds;

  // ------------------------------------------------------------------ chrome
  const close = el('a', { class: 'button button-icon', href: backHref, 'aria-label': 'Quit lesson' }, icon('close'));
  const bar = el('div', { class: 'progress-linear progress-linear-lg player-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': 0, 'aria-label': 'Lesson progress' },
    el('div', { class: 'progress-bar', style: '--value: 0%' }));
  const combo = el('span', { class: 'chip player-combo', 'aria-live': 'polite', hidden: true },
    icon('bolt', 'icon-sm'), el('span', { 'data-value': '' }, '×1'));
  const hearts = el('span', { class: 'chip player-hearts', 'aria-live': 'polite', hidden: true },
    icon('favorite', 'icon-sm'), el('span', { 'data-value': '' }, ''));
  const head = el('header', { class: 'player-head' }, close, bar, combo, hearts);

  const stage = el('div', { class: 'player-stage' });
  const itemRoot = el('div', { class: 'player-item container container-narrow', tabindex: '-1' });
  stage.append(itemRoot);

  const checkBtn = el('button', { type: 'button', class: 'button button-filled button-lg player-check', disabled: true }, 'Check');
  const skipBtn = el('button', { type: 'button', class: 'button button-text player-skip', hidden: true }, 'Skip');
  const barEl = el('footer', { class: 'player-bar' }, el('div', { class: 'container container-narrow row justify-between' }, skipBtn, checkBtn));

  const sheetTitle = el('strong', { class: 'player-sheet-title' });
  const sheetBody = el('div', { class: 'player-sheet-body prose' });
  const sheetAnswer = el('div', { class: 'player-sheet-answer', hidden: true });
  const sheetXp = el('span', { class: 'chip chip-primary', hidden: true });
  const continueBtn = el('button', { type: 'button', class: 'button button-filled button-lg' }, 'Continue');
  const sheet = el('div', { class: 'sheet sheet-bottom player-sheet', 'data-open': 'false', role: 'status', 'aria-live': 'polite' },
    el('div', { class: 'container container-narrow' },
      el('div', { class: 'row items-start row-nowrap' },
        el('span', { class: 'icon icon-lg player-sheet-icon', 'aria-hidden': 'true' }, 'check_circle'),
        el('div', { class: 'grow' }, el('div', { class: 'row justify-between' }, sheetTitle, sheetXp), sheetBody, sheetAnswer)),
      el('div', { class: 'row justify-end mt-4' }, continueBtn)));

  const root = el('div', { class: 'player', 'data-state': 'intro', 'data-mode': mode }, head, stage, barEl, sheet);

  // ------------------------------------------------------------------ state
  let mounted = null;     // { handle, manifest }
  let ready = false;
  let busy = false;

  function setProgress() {
    const pct = Math.round(session.progress * 100);
    bar.querySelector('.progress-bar').style.setProperty('--value', `${pct}%`);
    bar.setAttribute('aria-valuenow', String(pct));
    const m = session.multiplier;
    if (settings.combo && session.gradedCount) {
      combo.hidden = false;
      combo.querySelector('[data-value]').textContent = `×${m}`;
      combo.classList.toggle('chip-primary', m > 1);
      combo.classList.toggle('is-hot', m >= 2);
    }
    if (session.hearts !== null) {
      hearts.hidden = false;
      hearts.querySelector('[data-value]').textContent = String(session.hearts);
      hearts.classList.toggle('chip-danger', session.hearts <= 1);
    }
  }

  function setState(state) {
    root.dataset.state = state;
  }

  function card(iconName, titleText, bodyNode, actions) {
    return el('div', { class: 'player-card' },
      el('span', { class: 'icon icon-xl text-primary', 'aria-hidden': 'true' }, iconName),
      el('h2', { class: 'text-heading-1 mt-3' }, titleText),
      bodyNode,
      el('div', { class: 'row justify-center mt-5' }, ...actions));
  }

  // ------------------------------------------------------------------ intro
  function showIntro() {
    setState('intro');
    const start = el('button', { type: 'button', class: 'button button-filled button-lg' }, icon('play_arrow'), mode === 'review' ? 'Start review' : 'Start');
    start.addEventListener('click', begin);
    const meta = [`${lesson.items.length} items`, `${session.gradedCount} graded`, lesson.xp ? `${lesson.xp} XP` : null].filter(Boolean).join(' · ');
    clear(itemRoot).append(card(mode === 'review' ? 'history' : 'school', title,
      el('p', { class: 'text-muted mt-2' }, lesson.description || meta), [start]));
    barEl.hidden = true;
    setTimeout(() => start.focus(), 0);
  }

  function begin() {
    barEl.hidden = false;
    handle(session.start());
  }

  // ------------------------------------------------------------------ items
  async function handle(step) {
    setProgress();
    if (step.state === 'summary') return showSummary(step.summary);
    if (step.state === 'retry') {
      setState('retry');
      barEl.hidden = true;
      const go = el('button', { type: 'button', class: 'button button-filled button-lg' }, 'Let’s go');
      go.addEventListener('click', () => { barEl.hidden = false; showItem(step.entry); });
      clear(itemRoot).append(card('replay', 'Let’s try those again',
        el('p', { class: 'text-muted mt-2' }, `${session.queue.length} ${session.queue.length === 1 ? 'item' : 'items'} to retry.`), [go]));
      setTimeout(() => go.focus(), 0);
      return;
    }
    return showItem(step.entry);
  }

  async function showItem(entry) {
    setState('item');
    ready = false;
    busy = false;
    if (mounted) { try { mounted.handle.destroy(); } catch { /* ignore */ } }
    clear(itemRoot);
    const counter = el('p', { class: 'text-caption text-muted player-counter' }, `${session.completedCount + 1} / ${session.total}${session.round > 1 ? ' · retry' : ''}`);
    const host = el('div', { class: 'player-element' });
    itemRoot.append(counter, host);
    checkBtn.disabled = true;
    checkBtn.textContent = 'Check';
    mounted = await mountItem(host, entry.item, {
      onChange(r) { ready = Boolean(r); if (!entry.graded) ready = true; checkBtn.disabled = !ready; },
      onSubmit() { check(); },
    });
    const graded = entry.graded && mounted.manifest.graded;
    if (!graded) { checkBtn.textContent = 'Continue'; checkBtn.disabled = false; ready = true; }
    const selfGraded = mounted.manifest.self_graded;
    checkBtn.hidden = Boolean(selfGraded);
    window.UI.init(host);
    mounted.handle.focus();
  }

  function check() {
    if (busy || session.state !== 'item') return;
    if (!ready) return;
    busy = true;
    const answer = mounted.handle.getAnswer();
    const graded = session.current.graded && mounted.manifest.graded;
    const result = graded ? mounted.handle.check(answer) : { correct: true };
    const outcome = session.submit(answer, result);
    sendAttempts([session.log[session.log.length - 1]]);
    if (!graded) { // explanations: no sheet, straight on
      return continueNext();
    }
    mounted.handle.showResult(result);
    setProgress();
    showFeedback(outcome, result);
  }

  function showFeedback(outcome, result) {
    setState('feedback');
    const ok = outcome.correct;
    sheet.classList.toggle('is-correct', ok);
    sheet.classList.toggle('is-wrong', !ok);
    sheet.querySelector('.player-sheet-icon').textContent = ok ? 'check_circle' : 'cancel';
    sheetTitle.textContent = ok
      ? (outcome.streak >= 3 ? `Correct! ${outcome.streak} in a row` : 'Correct!')
      : (result.partial > 0 && result.partial < 1 ? 'Almost' : 'Not quite');
    clear(sheetBody);
    if (result.feedback_html) sheetBody.append(html`${raw(result.feedback_html)}`);
    clear(sheetAnswer);
    if (!ok && result.correct_answer_html) {
      sheetAnswer.hidden = false;
      sheetAnswer.append(el('p', { class: 'text-caption text-muted mb-1' }, 'Correct answer'), html`<div>${raw(result.correct_answer_html)}</div>`);
    } else {
      sheetAnswer.hidden = true;
    }
    if (outcome.xpGained > 0) {
      sheetXp.hidden = false;
      sheetXp.textContent = `+${Math.round(outcome.xpGained)} XP${outcome.multiplier > 1 ? ` (×${outcome.multiplier})` : ''}`;
    } else {
      sheetXp.hidden = true;
    }
    play(ok ? 'correct' : 'wrong', sounds);
    sheet.dataset.open = 'true';
    barEl.hidden = true;
    import('../lib/math.js').then((m) => m.renderMath(sheet));
    continueBtn.textContent = outcome.failed ? 'See results' : 'Continue';
    setTimeout(() => continueBtn.focus(), prefersReducedMotion() ? 0 : 200);
  }

  function continueNext() {
    sheet.dataset.open = 'false';
    barEl.hidden = false;
    busy = false;
    if (session.failed) return showSummary(session.summary());
    handle(session.next());
  }

  // ---------------------------------------------------------------- summary
  async function showSummary(summary) {
    setState('summary');
    barEl.hidden = true;
    sheet.dataset.open = 'false';
    if (mounted) { try { mounted.handle.destroy(); } catch { /* ignore */ } mounted = null; }
    setProgress();
    let server = null;
    if (summary.completed && mode === 'lesson') server = await completeLesson(lesson.path, summary);
    const xp = server && typeof server.xp === 'number' ? server.xp : summary.xp;
    const stat = (label, value) => el('div', { class: 'stat' }, el('span', { class: 'stat-label' }, label), el('span', { class: 'stat-value' }, value));
    const stats = el('div', { class: 'player-stats' },
      stat('XP', summary.failed ? '0' : `+${xp}`),
      stat('Accuracy', `${Math.round(summary.accuracy * 100)}%`),
      stat('Time', fmtTime(summary.elapsedMs)),
      stat('Best combo', String(summary.bestStreak)));
    const cta = el('a', { class: 'button button-filled button-lg', href: backHref }, icon('map'), 'Continue');
    const again = el('button', { type: 'button', class: 'button button-tonal button-lg' }, icon('replay'), 'Try again');
    again.addEventListener('click', () => { root.replaceWith(createPlayer({ lesson, mode, backHref, title, onDone })); });
    const titleText = summary.failed ? 'Out of hearts' : summary.perfect ? 'Perfect!' : mode === 'review' ? 'Review done' : 'Lesson complete';
    const body = el('div', {},
      el('p', { class: 'text-muted mt-2' }, summary.failed ? 'Five misses in hard mode ends the lesson. Nothing was saved.' : summary.perfect ? `Every answer right first time. +${summary.bonus} XP bonus.` : `${summary.mistakes} ${summary.mistakes === 1 ? 'miss' : 'misses'} along the way.`),
      stats);
    clear(itemRoot).append(card(summary.failed ? 'heart_broken' : 'emoji_events', titleText, body, summary.failed ? [again, cta] : [cta, again]));
    play(summary.failed ? 'wrong' : 'complete', sounds);
    setTimeout(() => (summary.failed ? again : cta).focus(), 0);
    if (onDone) onDone({ summary, server });
  }

  // --------------------------------------------------------------- keyboard
  checkBtn.addEventListener('click', check);
  continueBtn.addEventListener('click', continueNext);
  function onKey(event) {
    if (event.key !== 'Enter' || event.defaultPrevented || event.altKey) return;
    if (event.target.matches('textarea') && !(event.ctrlKey || event.metaKey)) return;
    if (event.target.matches('a, button') && event.target !== checkBtn && event.target !== continueBtn && root.dataset.state !== 'feedback') return;
    const state = root.dataset.state;
    if (state === 'item' && ready && !checkBtn.hidden) { event.preventDefault(); check(); }
    else if (state === 'feedback') { event.preventDefault(); continueNext(); }
  }
  root.addEventListener('keydown', onKey);

  root.destroy = () => {
    if (mounted) { try { mounted.handle.destroy(); } catch { /* ignore */ } }
    root.removeEventListener('keydown', onKey);
  };
  root.session = session;

  showIntro();
  return root;
}
