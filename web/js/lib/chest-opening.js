/* The full-screen chest opening: the chest drops in and rattles
   while the server rolls it, the lid bursts off, and the reward rises out on a
   card with rays turning behind it and confetti flying. Collect closes it.

   A modal <dialog>, so focus stays inside and the page behind is inert. A
   click, Enter, Space or Escape during the build-up skips to the burst (the
   server still has to answer first); Escape once the card shows collects.
   Solid token fills only: no gradients, no glow. Under prefers-reduced-motion
   there is no movement: the chest waits, then the card shows. */

import { el, icon, prefersReducedMotion } from './dom.js';

/* The reward's colour and the colour that sits on it, by reward kind. */
const KIND_COLORS = {
  coins: ['--color-warning', '--color-on-warning'],
  freeze: ['--color-info', '--color-on-info'],
  xp_boost: ['--color-primary', '--color-on-primary'],
};
const CONFETTI = ['--color-primary', '--color-success', '--color-warning', '--color-info', '--color-secondary'];

const DROP_MS = 520;     // the chest falling in
const BUILD_MS = 1500;   // the least time from opening to the burst, unless skipped
const REVEAL_MS = 1000;  // the burst until the Collect button shows

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function chestShape() {
  const band = () => el('span', { class: 'loot-band' });
  return el('div', { class: 'loot-chest', 'aria-hidden': 'true' },
    el('span', { class: 'loot-mouth' }),
    el('div', { class: 'loot-box' }, band(), band()),
    el('div', { class: 'loot-lid' }, band(), band()),
    el('span', { class: 'loot-lock' }));
}

function rewardCard(reward) {
  const title = el('strong', { class: 'loot-card-title', id: 'loot-reward-title' }, reward.title);
  return el('div', { class: 'loot-card' },
    el('span', { class: 'loot-card-icon' }, icon(reward.icon)),
    title,
    reward.description ? el('span', { class: 'loot-card-text' }, reward.description) : null);
}

/* Coins count up in the title ("0 coins" → "25 coins"). */
function countUp(card, reward) {
  const title = card.querySelector('.loot-card-title');
  const amount = Number(reward.amount);
  if (reward.kind !== 'coins' || !amount || !reward.title.includes(String(amount))) return;
  const start = performance.now();
  const frame = (now) => {
    const t = Math.min(1, (now - start) / 800);
    const n = Math.round(amount * (1 - (1 - t) ** 3));
    title.textContent = reward.title.replace(String(amount), String(n));
    if (t < 1 && title.isConnected) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/* Confetti (and coins, for a coin reward) thrown up out of the chest. */
function burst(layer, x, y, reward) {
  const pieces = [];
  for (let i = 0; i < 44; i += 1) {
    const round = i % 3 === 0;
    pieces.push(el('span', {
      class: `loot-piece ${round ? 'is-round' : ''}`,
      style: `left:${x}px;top:${y}px;background:var(${CONFETTI[i % CONFETTI.length]})`,
    }));
  }
  if (reward.kind === 'coins') {
    for (let i = 0; i < 10; i += 1) {
      const coin = el('span', { class: 'loot-piece loot-coin icon', style: `left:${x}px;top:${y}px` }, 'monetization_on');
      pieces.push(coin);
    }
  }
  layer.append(...pieces);
  pieces.forEach((node) => {
    const angle = (-90 + (Math.random() * 150 - 75)) * (Math.PI / 180);
    const speed = 160 + Math.random() * 220;
    const dx = Math.cos(angle) * speed;
    const up = Math.sin(angle) * speed;
    const fall = up + 320;
    const spin = (Math.random() * 2 - 1) * 720;
    node.animate(
      [{ transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)' },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${up}px)) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.35, easing: 'cubic-bezier(0.5, 0, 0.8, 0.6)' },
        { transform: `translate(calc(-50% + ${dx * 1.4}px), calc(-50% + ${fall}px)) rotate(${spin}deg)`, opacity: 0 }],
      { duration: 1300 + Math.random() * 600, fill: 'both' },
    ).finished.then(() => node.remove(), () => node.remove());
  });
}

/**
 * playChestOpening(chest, roll, { onRolled }) → the full-screen opening.
 * `roll()` opens the chest on the server and resolves with { chest: { reward } };
 * it starts at once, so the build-up hides the wait. `onRolled(res)` runs as
 * soon as the reward is known (the page behind can update). Resolves with the
 * result once the learner collects; if `roll` fails, the overlay goes and the
 * promise rejects with that error.
 */
export async function playChestOpening(chest, roll, { onRolled = null } = {}) {
  const still = prefersReducedMotion();
  const shape = chestShape();
  const rays = el('div', { class: 'loot-rays', 'aria-hidden': 'true' },
    el('div', { class: 'loot-rays-spin' }, ...Array.from({ length: 12 }, (_, i) => el('span', { style: `--i: ${i}` }))));
  const flash = el('span', { class: 'loot-flash', 'aria-hidden': 'true' });
  const fx = el('div', { class: 'loot-fx', 'aria-hidden': 'true' });
  const scene = el('div', { class: 'loot-scene' }, rays, flash, shape, fx);
  const collect = el('button', { type: 'button', class: 'button button-filled loot-collect' }, 'Collect');
  const hint = el('p', { class: 'loot-hint' }, 'Tap to open');
  const status = el('p', { class: 'visually-hidden', role: 'status' });
  const dialog = el('dialog', { class: 'loot', 'aria-label': chest.title, tabindex: '-1', dataset: { phase: 'enter' } },
    el('div', { class: 'loot-head' },
      el('h2', { class: 'loot-title' }, chest.title),
      chest.subtitle ? el('p', { class: 'loot-subtitle' }, chest.subtitle) : null),
    scene,
    el('div', { class: 'loot-foot' }, hint, collect),
    status);
  if (still) dialog.dataset.still = '';

  // A click or key skips the stage that is playing: the build-up, then the reveal.
  let hurry;
  const skip = () => new Promise((resolve) => { hurry = resolve; });
  const hurried = skip();
  let collected;
  const done = new Promise((resolve) => { collected = resolve; });
  const isDone = () => dialog.dataset.phase === 'done';

  dialog.addEventListener('cancel', (event) => { // Escape
    event.preventDefault();
    if (isDone()) collected();
    else hurry();
  });
  dialog.addEventListener('click', () => { if (!isDone()) hurry(); });
  dialog.addEventListener('keydown', (event) => {
    if (!isDone() && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); hurry(); }
  });
  collect.addEventListener('click', () => collected());

  document.body.append(dialog);
  dialog.showModal();
  dialog.focus();

  const rolled = roll();
  if (!still) wait(DROP_MS).then(() => { if (dialog.dataset.phase === 'enter') dialog.dataset.phase = 'rattle'; });
  let res;
  try {
    [res] = await Promise.all([rolled, still ? null : Promise.race([wait(BUILD_MS), hurried])]);
  } catch (err) {
    dialog.close();
    dialog.remove();
    throw err;
  }

  const reward = res.chest.reward;
  if (onRolled) onRolled(res);
  const [color, onColor] = KIND_COLORS[reward.kind] || KIND_COLORS.xp_boost;
  dialog.style.setProperty('--loot-color', `var(${color})`);
  dialog.style.setProperty('--loot-on-color', `var(${onColor})`);
  const card = rewardCard(reward);
  scene.append(card);
  dialog.setAttribute('aria-labelledby', 'loot-reward-title');
  dialog.dataset.phase = 'open';
  status.textContent = `You got ${reward.title}.`;
  if (!still) {
    const box = scene.getBoundingClientRect();
    const lid = shape.querySelector('.loot-lid').getBoundingClientRect();
    burst(fx, lid.left + lid.width / 2 - box.left, lid.bottom - box.top, reward);
    countUp(card, reward);
    await Promise.race([wait(REVEAL_MS), skip()]);
  }
  dialog.dataset.phase = 'done';
  collect.focus();

  await done;
  if (!still) {
    dialog.dataset.phase = 'closing';
    await wait(180);
  }
  dialog.close();
  dialog.remove();
  return res;
}
