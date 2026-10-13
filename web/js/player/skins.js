/* Combo meters and progress bars (shop items, shop_plan.md §10.2): how the
   player head shows the combo multiplier and the lesson's progress. The
   equipped ones are me.equipped.combo / me.equipped.progress; the shop paints
   the same functions onto samples as previews.

   Visual language: fills only (a track on the surface ladder, the accent for
   what is done), no gradients or glow. Nothing here animates beyond the kit's
   own fill transition, which reduced motion already turns off.

   Add a style here (a `build` and a `paint`) and a matching item in
   server/app/shop.yaml. */

import { el, icon } from '../lib/dom.js';
import { COMBO_STEPS } from './engine.js';

const TOP_RUN = COMBO_STEPS[COMBO_STEPS.length - 1].from; // the run that reaches the top multiplier

function stepOf(streak) {
  let i = 0;
  COMBO_STEPS.forEach((s, k) => { if (streak >= s.from) i = k; });
  return i;
}

const value = () => el('span', { 'data-value': '' }, '×1');

const COMBO = {
  classic: {
    build: () => [icon('bolt', 'icon-sm'), value()],
    paint() {},
  },
  flame: {
    build: () => [icon('local_fire_department', 'icon-sm combo-flame'), value()],
    paint(chip, { streak }) { chip.dataset.level = String(stepOf(streak)); },
  },
  blocks: {
    build: () => [el('span', { class: 'combo-blocks', 'aria-hidden': 'true' },
      ...Array.from({ length: TOP_RUN }, () => el('span', { class: 'combo-block' }))), value()],
    paint(chip, { streak }) {
      chip.querySelectorAll('.combo-block').forEach((b, i) => b.classList.toggle('is-on', i < Math.min(streak, TOP_RUN)));
    },
  },
  meter: {
    build: () => [el('span', { class: 'combo-meter', 'aria-hidden': 'true' }, el('span', { class: 'combo-meter-fill' })), value()],
    paint(chip, { streak }) {
      const i = stepOf(streak);
      const next = COMBO_STEPS[i + 1];
      const pct = next ? (streak - COMBO_STEPS[i].from) / (next.from - COMBO_STEPS[i].from) : 1;
      chip.querySelector('.combo-meter-fill').style.setProperty('--value', `${Math.round(pct * 100)}%`);
    },
  },
};

/** paintCombo(chip, style, { streak, multiplier }) draws the combo chip in a style. */
export function paintCombo(chip, style, { streak, multiplier }) {
  const name = COMBO[style] ? style : 'classic';
  if (chip.dataset.style !== name) {
    chip.dataset.style = name;
    chip.replaceChildren(...COMBO[name].build());
  }
  COMBO[name].paint(chip, { streak, multiplier });
  chip.querySelector('[data-value]').textContent = `×${multiplier}`;
  chip.classList.toggle('chip-primary', multiplier > 1);
  chip.classList.toggle('is-hot', multiplier >= 2);
}

const PROGRESS = {
  classic: {
    build: () => [el('div', { class: 'progress-bar', style: '--value: 0%' })],
    paint(bar, { pct }) { bar.querySelector('.progress-bar').style.setProperty('--value', `${pct}%`); },
  },
  segments: {
    perItem: true,
    build: (total) => Array.from({ length: total }, () => el('span', { class: 'pskin-seg' })),
    paint(bar, { done }) { bar.querySelectorAll('.pskin-seg').forEach((s, i) => s.classList.toggle('is-done', i < done)); },
  },
  dots: {
    perItem: true,
    build: (total) => Array.from({ length: total }, () => el('span', { class: 'pskin-dot' })),
    paint(bar, { done }) { bar.querySelectorAll('.pskin-dot').forEach((s, i) => s.classList.toggle('is-done', i < done)); },
  },
  runner: {
    build: () => [el('div', { class: 'progress-bar', style: '--value: 0%' }), icon('directions_run', 'pskin-runner')],
    paint(bar, { pct }) { bar.style.setProperty('--value', `${pct}%`); bar.querySelector('.progress-bar').style.setProperty('--value', `${pct}%`); },
  },
};

/** paintProgress(bar, style, { done, total }) draws the progress bar in a style. */
export function paintProgress(bar, style, { done, total }) {
  const name = PROGRESS[style] ? style : 'classic';
  const skin = PROGRESS[name];
  const count = Math.max(1, total);
  if (bar.dataset.skin !== name || (skin.perItem && Number(bar.dataset.total) !== count)) {
    bar.dataset.skin = name;
    bar.dataset.total = String(count);
    bar.replaceChildren(...skin.build(count));
  }
  const pct = Math.round((done / count) * 100);
  skin.paint(bar, { done, total: count, pct });
  bar.setAttribute('aria-valuenow', String(pct));
}

export const COMBO_NAMES = Object.keys(COMBO);
export const PROGRESS_NAMES = Object.keys(PROGRESS);
