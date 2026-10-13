/* Correct-answer effects and lesson-complete celebrations (shop items,
   shop_plan.md §6, §10.2). The equipped effect (me.equipped.effect.asset) runs
   on every right answer; the equipped celebration (me.equipped.celebration)
   on the summary of a finished lesson. The shop runs both on a sample card as
   a preview.

   Visual language: solid token fills only (no gradients, no glow, no
   outlines), drawn on a layer that takes no pointer events and is hidden from
   assistive tech. Under prefers-reduced-motion every effect is a brief static
   flash of the success soft fill over the answer instead.

   An effect or celebration is `name(layer, x, y, rect, size)`: draw on
   `layer` around (x, y), `rect` being the origin's box and `size` the layer's
   { w, h }, all in the layer's coordinates. Add one here and a matching item
   in server/app/shop.yaml. */

import { prefersReducedMotion } from '../lib/dom.js';

const CONFETTI = ['--color-primary', '--color-success', '--color-warning', '--color-info', '--color-secondary'];

function piece(layer, cls, x, y, style = '') {
  const node = document.createElement('span');
  node.className = `fx-piece ${cls}`;
  node.style.cssText = `left:${x}px;top:${y}px;${style}`;
  layer.append(node);
  return node;
}

function done(animation, node) {
  animation.finished.then(() => node.remove(), () => node.remove());
}

const EFFECTS = {
  ripple(layer, x, y) {
    [0, 140, 280].forEach((delay) => {
      const node = piece(layer, 'fx-ripple', x, y);
      done(node.animate(
        [{ transform: 'translate(-50%, -50%) scale(0.2)', opacity: 0.9 },
          { transform: 'translate(-50%, -50%) scale(6)', opacity: 0 }],
        { duration: 760, delay, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)', fill: 'both' }), node);
    });
  },

  confetti(layer, x, y) {
    // Full height over the page; a small preview box gets a smaller burst that stays inside.
    const scale = Math.min(1, layer.clientHeight / 420);
    for (let i = 0; i < 32; i += 1) {
      const color = CONFETTI[i % CONFETTI.length];
      const round = i % 3 === 0;
      const node = piece(layer, round ? 'fx-confetti is-round' : 'fx-confetti', x, y, `background: var(${color})`);
      const angle = (-90 + (Math.random() * 120 - 60)) * (Math.PI / 180);
      const speed = (140 + Math.random() * 160) * scale;
      const dx = Math.cos(angle) * speed;
      const up = Math.sin(angle) * speed;
      const spin = (Math.random() * 2 - 1) * 540;
      // Up fast and slowing (ease-out), then falling faster (ease-in); fully opaque until the end.
      const fall = up + 260 * scale;
      done(node.animate(
        [{ transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35, easing: 'cubic-bezier(0.5, 0, 0.8, 0.6)' },
          { transform: `translate(calc(-50% + ${dx * 1.3}px), calc(-50% + ${up + (fall - up) * 0.75}px)) rotate(${spin * 0.85}deg)`, opacity: 1, offset: 0.8 },
          { transform: `translate(calc(-50% + ${dx * 1.4}px), calc(-50% + ${fall}px)) rotate(${spin}deg)`, opacity: 0 }],
        { duration: 1100 + Math.random() * 400, fill: 'both' }), node);
    }
  },

  pixels(layer, x, y) {
    const colors = ['--color-success', '--color-primary'];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const px = x + (col - 2) * 9;
        const py = y + (row - 1.5) * 9;
        const node = piece(layer, 'fx-pixel', px, py, `background: var(${colors[(row + col) % 2]})`);
        const angle = Math.atan2(py - y, px - x) + (Math.random() - 0.5) * 0.6;
        const dist = 50 + Math.random() * 70;
        const dx = Math.cos(angle) * dist;
        const dy = Math.sin(angle) * dist;
        done(node.animate(
          [{ transform: 'translate(-50%, -50%)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`, opacity: 1, offset: 0.7 },
            { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy * 1.1}px))`, opacity: 0 }],
          { duration: 650 + Math.random() * 250, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'both' }), node);
      }
    }
  },

  stars(layer, x, y) {
    for (let i = 0; i < 7; i += 1) {
      const node = piece(layer, 'fx-star icon', x + (i - 3) * 16, y);
      node.textContent = 'star';
      const drift = (Math.random() - 0.5) * 60;
      const rise = 70 + Math.random() * 70;
      done(node.animate(
        [{ transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
          { transform: `translate(calc(-50% + ${drift / 2}px), calc(-50% - ${rise / 2}px)) scale(1.1)`, opacity: 1, offset: 0.35 },
          { transform: `translate(calc(-50% + ${drift}px), calc(-50% - ${rise}px)) scale(0.8)`, opacity: 0 }],
        { duration: 900 + Math.random() * 300, delay: i * 40, easing: 'cubic-bezier(0.2, 0.6, 0.4, 1)', fill: 'both' }), node);
    }
  },

  stamp(layer, x, y) {
    const node = piece(layer, 'fx-stamp icon', x, y);
    node.textContent = 'check_circle';
    done(node.animate(
      [{ transform: 'translate(-50%, -50%) scale(1.9) rotate(-14deg)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(0.92) rotate(-8deg)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%, -50%) scale(1) rotate(-8deg)', opacity: 1, offset: 0.4 },
        { transform: 'translate(-50%, -50%) scale(1) rotate(-8deg)', opacity: 1, offset: 0.75 },
        { transform: 'translate(-50%, -50%) scale(1) rotate(-8deg)', opacity: 0 }],
      { duration: 1000, easing: 'cubic-bezier(0.3, 0, 0.2, 1)', fill: 'both' }), node);
  },
};

/* Lesson-complete celebrations: bigger, once per lesson, over the summary. */
const CELEBRATIONS = {
  fireworks(layer, x, y, rect, size) {
    const colors = ['--color-primary', '--color-warning', '--color-success', '--color-info'];
    const bursts = size.w < 500 ? 3 : 4;
    for (let b = 0; b < bursts; b += 1) {
      const cx = size.w * (0.2 + 0.6 * Math.random());
      const cy = size.h * (0.15 + 0.3 * Math.random());
      const color = colors[b % colors.length];
      const radius = Math.min(110, size.w / 5) * (0.8 + Math.random() * 0.4);
      for (let i = 0; i < 18; i += 1) {
        const angle = (i / 18) * Math.PI * 2;
        const dx = Math.cos(angle) * radius;
        const dy = Math.sin(angle) * radius;
        const node = piece(layer, 'fx-spark', cx, cy, `background: var(${color})`);
        done(node.animate(
          [{ transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.9)`, opacity: 1, offset: 0.6 },
            { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy * 1.1 + 24}px)) scale(0.4)`, opacity: 0 }],
          { duration: 1100, delay: b * 320, easing: 'cubic-bezier(0.1, 0.6, 0.3, 1)', fill: 'both' }), node);
      }
    }
  },

  rain(layer, x, y, rect, size) {
    const n = Math.round(Math.min(90, Math.max(30, size.w / 12)));
    for (let i = 0; i < n; i += 1) {
      const round = i % 3 === 0;
      const node = piece(layer, round ? 'fx-confetti is-round' : 'fx-confetti', Math.random() * size.w, -20,
        `background: var(${CONFETTI[i % CONFETTI.length]})`);
      const sway = (Math.random() - 0.5) * 80;
      const spin = (Math.random() * 2 - 1) * 720;
      done(node.animate(
        [{ transform: 'translate(-50%, 0) rotate(0deg)', opacity: 1 },
          { transform: `translate(calc(-50% + ${sway}px), ${size.h * 0.8}px) rotate(${spin * 0.8}deg)`, opacity: 1, offset: 0.8 },
          { transform: `translate(calc(-50% + ${sway * 1.2}px), ${size.h + 40}px) rotate(${spin}deg)`, opacity: 0 }],
        { duration: 1700 + Math.random() * 1000, delay: Math.random() * 700, easing: 'cubic-bezier(0.4, 0, 0.8, 0.6)', fill: 'both' }), node);
    }
  },

  trophy(layer, x, y, rect) {
    const node = piece(layer, 'fx-trophy icon', x, rect.top + Math.min(rect.height / 2, 90));
    node.textContent = 'emoji_events';
    done(node.animate(
      [{ transform: 'translate(-50%, calc(-50% - 260px)) scale(0.8)', opacity: 0, easing: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.35, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
        { transform: 'translate(-50%, calc(-50% - 36px)) scale(1)', opacity: 1, offset: 0.48, easing: 'cubic-bezier(0.6, 0, 0.9, 0.5)' },
        { transform: 'translate(-50%, -50%) scale(1.06, 0.94)', opacity: 1, offset: 0.6 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.68 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.85 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }],
      { duration: 1800, fill: 'both' }), node);
  },
};

function flash(layer, rect) {
  const node = piece(layer, 'fx-flash', rect.left, rect.top, `width:${rect.width}px;height:${rect.height}px`);
  setTimeout(() => node.remove(), 360);
}

/** Effect and celebration names the shop may sell (the default "none" draws nothing). */
export const EFFECT_NAMES = Object.keys(EFFECTS);
export const CELEBRATION_NAMES = Object.keys(CELEBRATIONS);

function run(registry, asset, origin, host, lifetime) {
  if (!asset || asset === 'none' || !registry[asset] || !origin) return;
  const layer = document.createElement('div');
  layer.className = host ? 'fx-layer is-contained' : 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  (host || document.body).append(layer);
  const box = origin.getBoundingClientRect();
  const base = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
  const rect = { left: box.left - base.left, top: box.top - base.top, width: box.width, height: box.height };
  const size = { w: layer.clientWidth, h: layer.clientHeight };
  const x = rect.left + rect.width / 2;
  const y = rect.top + Math.min(rect.height / 2, 160);
  try {
    if (prefersReducedMotion() || typeof layer.animate !== 'function') flash(layer, rect);
    else registry[asset](layer, x, y, rect, size);
  } catch (err) {
    console.warn('[effects] failed', err);
  }
  setTimeout(() => layer.remove(), lifetime);
}

/**
 * celebrate(asset, origin, { host }) runs a correct-answer effect around `origin` (an element).
 * Without a host the layer is fixed over the viewport; with one it is clipped to the host
 * (which must be position: relative), as in the shop preview.
 */
export function celebrate(asset, origin, { host = null } = {}) {
  run(EFFECTS, asset, origin, host, 2000);
}

/** celebrateFinish(asset, origin, { host }): a lesson-complete celebration, the same way. */
export function celebrateFinish(asset, origin, { host = null } = {}) {
  run(CELEBRATIONS, asset, origin, host, 3800);
}
