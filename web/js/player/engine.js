/* Session engine: the state machine behind the lesson player.

   States: intro → item → checking → feedback → (next item | retry round | summary)

   Pure logic, no DOM. The player drives it and renders what it says. Rules:
   - items are played in order; wrong graded items are re-queued at the end;
   - the session completes when every graded item has been answered correctly once;
   - the combo multiplier rises with consecutive correct answers and resets on a miss;
   - XP = base XP spread over the graded items, each first-try correct answer earning its
     share × the multiplier at the time, plus a perfect bonus when nothing was missed;
   - hard mode has hearts: a miss costs one; at zero the session fails.
*/

export const COMBO_STEPS = [
  { from: 0, multiplier: 1 },
  { from: 3, multiplier: 1.5 },
  { from: 6, multiplier: 2 },
];

export function multiplierFor(streak) {
  let m = 1;
  for (const step of COMBO_STEPS) if (streak >= step.from) m = step.multiplier;
  return m;
}

export const PERFECT_BONUS = 0.5; // × base XP
export const HEARTS = 5;

export class Session {
  /**
   * @param {object} lesson   rendered lesson from /api/lessons/...
   * @param {object} options  { combo: bool, hardMode: bool, now: () => ms, mode: 'lesson'|'review' }
   */
  constructor(lesson, options = {}) {
    this.lesson = lesson;
    this.options = { combo: true, hardMode: false, mode: 'lesson', now: () => Date.now(), ...options };
    this.items = lesson.items.map((item, index) => ({ item, index, graded: Boolean(item.graded), done: false, attempts: 0, firstTry: null }));
    this.queue = this.items.map((e) => e.index);
    this.position = -1;          // index into this.queue
    this.state = 'intro';
    this.current = null;         // entry being played
    this.round = 1;              // 1 = first pass, 2+ = retry rounds
    this.retryPending = [];      // indexes missed in the current pass
    this.streak = 0;
    this.bestStreak = 0;
    this.hearts = this.options.hardMode ? HEARTS : null;
    this.xp = 0;
    this.log = [];               // attempts: { item_id, answer, correct, partial, ms, ts, rating }
    this.startedAt = null;
    this.itemShownAt = null;
    this.failed = false;
    this.lastResult = null;
  }

  get gradedCount() { return this.items.filter((e) => e.graded).length; }
  get total() { return this.items.length; }
  get completedCount() { return this.items.filter((e) => e.done).length; }
  get multiplier() { return this.options.combo ? multiplierFor(this.streak) : 1; }
  get progress() { return this.total ? this.completedCount / this.total : 1; }
  get elapsedMs() { return this.startedAt ? this.options.now() - this.startedAt : 0; }

  start() {
    this.startedAt = this.options.now();
    return this.next();
  }

  /** Advance to the next queued item, a retry round, or the summary. */
  next() {
    this.lastResult = null;
    this.position += 1;
    if (this.position >= this.queue.length) {
      if (this.retryPending.length) {
        this.queue = this.retryPending.slice();
        this.retryPending = [];
        this.position = 0;
        this.round += 1;
        this.current = this.items[this.queue[0]];
        this.itemShownAt = this.options.now();
        this.state = 'item';
        return { state: 'retry', entry: this.current };
      }
      this.state = 'summary';
      this.current = null;
      return { state: 'summary', summary: this.summary() };
    }
    this.current = this.items[this.queue[this.position]];
    this.itemShownAt = this.options.now();
    this.state = 'item';
    return { state: 'item', entry: this.current };
  }

  /**
   * Record the result of the current item. `result` comes from the element's check().
   * Returns { result, xpGained, streak, multiplier, hearts, failed }.
   */
  submit(answer, result) {
    if (this.state !== 'item' || !this.current) throw new Error(`cannot submit in state ${this.state}`);
    this.state = 'checking';
    const entry = this.current;
    const now = this.options.now();
    const ms = Math.max(0, now - this.itemShownAt);
    entry.attempts += 1;
    const correct = Boolean(result.correct);
    const partial = typeof result.partial === 'number' ? Math.max(0, Math.min(1, result.partial)) : (correct ? 1 : 0);
    if (entry.firstTry === null) entry.firstTry = correct;

    let xpGained = 0;
    if (!entry.graded) {
      entry.done = true;
    } else if (correct) {
      const mult = this.multiplier;
      if (entry.attempts === 1) {
        xpGained = (this.lesson.xp || 0) / this.gradedCount * mult;
      }
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      entry.done = true;
    } else {
      this.streak = 0;
      if (this.hearts !== null) this.hearts = Math.max(0, this.hearts - 1);
      this.retryPending.push(entry.index);
      if (this.hearts === 0) this.failed = true;
    }
    this.xp += xpGained;
    this.log.push({
      item_id: entry.item.id,
      item_path: `${this.lesson.path}#${entry.item.id}`,
      answer,
      correct,
      partial,
      ms,
      ts: new Date(now).toISOString(),
      rating: result.rating || (correct ? (ms < 8000 && partial === 1 ? 'good' : 'hard') : 'again'),
      graded: entry.graded,
      attempt: entry.attempts,
    });
    this.lastResult = { result, xpGained, streak: this.streak, multiplier: this.multiplier, hearts: this.hearts, failed: this.failed, correct };
    this.state = entry.graded ? 'feedback' : 'feedback';
    return this.lastResult;
  }

  /** Mark the session as abandoned (close button). */
  abandon() {
    this.state = 'abandoned';
  }

  get perfect() {
    return this.items.filter((e) => e.graded).every((e) => e.firstTry === true);
  }

  get accuracy() {
    const graded = this.items.filter((e) => e.graded);
    if (!graded.length) return 1;
    return graded.filter((e) => e.firstTry === true).length / graded.length;
  }

  summary() {
    const base = this.lesson.xp || 0;
    let bonus = 0;
    if (!this.failed && this.gradedCount === 0) this.xp = base; // explanations only: full XP for reading
    if (!this.failed && this.gradedCount > 0 && this.perfect) bonus = base * PERFECT_BONUS;
    const xp = this.failed ? 0 : Math.round(this.xp + bonus);
    return {
      completed: !this.failed,
      failed: this.failed,
      xp,
      bonus: Math.round(bonus),
      accuracy: this.accuracy,
      perfect: this.perfect && this.gradedCount > 0,
      bestStreak: this.bestStreak,
      elapsedMs: this.elapsedMs,
      items: this.total,
      graded: this.gradedCount,
      mistakes: this.log.filter((l) => l.graded && !l.correct).length,
      log: this.log,
    };
  }
}
