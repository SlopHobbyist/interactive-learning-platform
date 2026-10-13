/* Correct-answer effects (shop items, shop_plan.md §6). The equipped one
   (me.equipped.effect.asset) runs on every right answer; the shop runs it on a
   sample card as a preview.

   Visual language: solid token fills only (no gradients, no glow, no
   outlines), drawn on a layer that takes no pointer events and is hidden from
   assistive tech. Under prefers-reduced-motion every effect is a brief static
   flash of the success soft fill over the answer instead.

   An effect is `name(layer, x, y, rect)`: draw on `layer` around (x, y),
   `rect` being the answer's box in the layer's coordinates. Add one here and
   a matching item in server/app/shop.yaml. */

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

function flash(layer, rect) {
  const node = piece(layer, 'fx-flash', rect.left, rect.top, `width:${rect.width}px;height:${rect.height}px`);
  setTimeout(() => node.remove(), 360);
}

/** Effect names the shop may sell (the default "none" draws nothing). */
export const EFFECT_NAMES = Object.keys(EFFECTS);

/**
 * celebrate(asset, origin, { host }) runs an effect around `origin` (an element).
 * Without a host the layer is fixed over the viewport; with one it is clipped to the host
 * (which must be position: relative), as in the shop preview.
 */
export function celebrate(asset, origin, { host = null } = {}) {
  if (!asset || asset === 'none' || !EFFECTS[asset] || !origin) return;
  const layer = document.createElement('div');
  layer.className = host ? 'fx-layer is-contained' : 'fx-layer';
  layer.setAttribute('aria-hidden', 'true');
  (host || document.body).append(layer);
  const box = origin.getBoundingClientRect();
  const base = host ? host.getBoundingClientRect() : { left: 0, top: 0 };
  const rect = { left: box.left - base.left, top: box.top - base.top, width: box.width, height: box.height };
  const x = rect.left + rect.width / 2;
  const y = rect.top + Math.min(rect.height / 2, 160);
  try {
    if (prefersReducedMotion() || typeof layer.animate !== 'function') flash(layer, rect);
    else EFFECTS[asset](layer, x, y, rect);
  } catch (err) {
    console.warn('[effects] failed', err);
  }
  setTimeout(() => layer.remove(), 2000);
}
