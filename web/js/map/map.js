/* The Wavefront map (plan §6): a course as a field of tiles.

   - Each unit is a band (region) top to bottom; its lessons pack into an offset
     grid (odd rows shift half a tile). `map: {x, y}` in the YAML overrides a
     tile's position, in tile units.
   - Edges come from `requires` and are drawn as hairlines in an SVG under the tiles.
   - The frontier (available tiles) carries the accent; locked tiles are dim;
     completed tiles show their strength as discrete fill steps:
       fresh ≥ 85  → --color-primary-soft + accent check icon
       solid 60–85 → --step-4
       fading 30–60→ --step-3
       faint < 30  → --step-2 + history icon
   - Locked tiles are inert buttons unless hrefFor gives them a link (the course
     page's "Skip ahead" checkbox); then they stay dim but open the lesson.
   - Tiles are real <a> elements with roving tabindex (one tab stop; arrows move).
     The tab stop starts on the frontier (the first available tile), where the
     learner is headed, not on the first tile of the course.
   - The wave: when the map renders after a completed lesson, the completed tile
     pulses and each newly unlocked tile changes fill with a stagger. Under
     prefers-reduced-motion the final state is applied at once.
*/

import { el, icon, prefersReducedMotion } from '../lib/dom.js';

export const TILE = 96;          // px, desktop; CSS scales via --map-tile on phones
export const COLS_MAX = 4;
export const BAND_GAP = 1.1;     // rows between unit bands (in tile units)
export const HEADER_ROWS = 0.6;  // room for the unit title above its tiles

export function strengthStep(strength) {
  if (strength == null) return null;
  if (strength >= 85) return 'fresh';
  if (strength >= 60) return 'solid';
  if (strength >= 30) return 'fading';
  return 'faint';
}

/** Deterministic layout: returns { tiles: [{key, x, y, unit, lesson, row, col}], units: [{id, title, y0, y1}], width, height } in tile units. */
export function layout(course) {
  const tiles = [];
  const units = [];
  let y = 0;
  let maxX = 0;
  for (const unit of course.units) {
    const n = unit.lessons.length;
    const cols = Math.max(1, Math.min(COLS_MAX, n));
    const top = y + HEADER_ROWS;
    let rows = 0;
    unit.lessons.forEach((lesson, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      let tx = col + (row % 2 ? 0.5 : 0);
      let ty = top + row;
      if (lesson.map && Number.isFinite(lesson.map.x) && Number.isFinite(lesson.map.y)) {
        tx = lesson.map.x;
        ty = top + lesson.map.y;
      }
      rows = Math.max(rows, Math.floor(ty - top) + 1);
      maxX = Math.max(maxX, tx + 1);
      tiles.push({ key: `${unit.id}/${lesson.id}`, x: tx, y: ty, unit, lesson, row, col });
    });
    const bottom = top + rows;
    units.push({ id: unit.id, title: unit.title, requires: unit.requires, y0: y, y1: bottom, lessons: unit.lessons });
    y = bottom + BAND_GAP;
  }
  return { tiles, units, width: Math.max(1, maxX), height: Math.max(1, y - BAND_GAP) };
}

/** Edges as [fromKey, toKey]: lesson requires, plus unit requires (last tile → first tile). */
export function edges(course, lay) {
  const byKey = new Map(lay.tiles.map((t) => [t.key, t]));
  const out = [];
  for (const t of lay.tiles) {
    for (const r of t.lesson.requires || []) if (byKey.has(r)) out.push([r, t.key]);
  }
  for (const unit of course.units) {
    const first = unit.lessons[0];
    if (!first) continue;
    for (const r of unit.requires || []) {
      const req = course.units.find((u) => u.id === r);
      const last = req && req.lessons[req.lessons.length - 1];
      if (last) out.push([`${req.id}/${last.id}`, `${unit.id}/${first.id}`]);
    }
  }
  return out;
}

function tileState(key, progress) {
  return (progress.lessons && progress.lessons[key]) || 'locked';
}

/**
 * renderMap({ course, progress, wave, hrefFor(tile, state), labelFor }) → element
 * progress: { lessons: {key: state}, strength: {key: n} }
 * wave: { from, unlocked: [keys] } | null
 */
export function renderMap({ course, progress, wave = null, hrefFor, onActivate = null }) {
  const lay = layout(course);
  const root = el('div', { class: 'map', role: 'group', 'aria-label': `${course.title} map`, style: `--map-cols: ${lay.width}; --map-rows: ${lay.height}` });
  const inner = el('div', { class: 'map-inner' });
  root.append(inner);

  // Edges (hairlines) under the tiles.
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'map-edges');
  svg.setAttribute('viewBox', `0 0 ${lay.width * TILE} ${lay.height * TILE}`);
  svg.setAttribute('aria-hidden', 'true');
  const byKey = new Map(lay.tiles.map((t) => [t.key, t]));
  for (const [a, b] of edges(course, lay)) {
    const ta = byKey.get(a); const tb = byKey.get(b);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String((ta.x + 0.5) * TILE)); line.setAttribute('y1', String((ta.y + 0.5) * TILE));
    line.setAttribute('x2', String((tb.x + 0.5) * TILE)); line.setAttribute('y2', String((tb.y + 0.5) * TILE));
    line.dataset.from = a; line.dataset.to = b;
    if (tileState(b, progress) !== 'locked') line.classList.add('is-open');
    svg.append(line);
  }
  inner.append(svg);

  // Unit bands with headers.
  for (const u of lay.units) {
    const done = u.lessons.filter((l) => tileState(`${u.id}/${l.id}`, progress) === 'complete').length;
    inner.append(el('div', { class: 'map-band', style: `--y0: ${u.y0}; --y1: ${u.y1}` },
      el('h2', { class: 'map-band-title', id: `map-unit-${u.id}` }, u.title, ' ', el('span', { class: 'text-muted' }, `${done}/${u.lessons.length}`))));
  }

  // Tiles.
  const tiles = [];
  const unlocked = new Set((wave && wave.unlocked) || []);
  const reduced = prefersReducedMotion();
  const stop = Math.max(0, lay.tiles.findIndex((t) => tileState(t.key, progress) === 'available'));
  lay.tiles.forEach((t, i) => {
    const state = tileState(t.key, progress);
    const strength = state === 'complete' ? (progress.strength && progress.strength[t.key]) ?? 100 : null;
    const step = strengthStep(strength);
    const href = hrefFor ? hrefFor(t, state) : null;
    const inert = state === 'locked' && !href;
    const label = `${t.lesson.title}, ${state === 'complete' ? `complete, strength ${Math.round(strength)}%` : state}${state === 'locked' && href ? ' (skip ahead)' : ''}`;
    const iconName = state === 'locked' ? (href ? 'lock_open' : 'lock') : state === 'available' ? 'play_arrow' : step === 'faint' ? 'history' : step === 'fresh' ? 'check' : 'done';
    const tile = el(inert || !href ? 'button' : 'a', {
      class: 'map-tile',
      href: inert ? null : href,
      type: inert || !href ? 'button' : null,
      'data-key': t.key,
      'data-state': state,
      'data-step': step,
      'aria-label': label,
      'aria-disabled': inert ? 'true' : null,
      'aria-describedby': `map-unit-${t.unit.id}`,
      tabindex: i === stop ? '0' : '-1',
      style: `--x: ${t.x}; --y: ${t.y}`,
    },
      el('span', { class: 'map-tile-icon' }, icon(iconName)),
      el('span', { class: 'map-tile-title' }, t.lesson.title),
      strength != null ? el('span', { class: 'map-tile-strength', 'aria-hidden': 'true' }, `${Math.round(strength)}%`) : null);
    if (inert) tile.addEventListener('click', (e) => e.preventDefault());
    if (onActivate) tile.addEventListener('click', (e) => onActivate(e, t, state));
    // The wave: animate from the completed tile to the unlocked ones.
    if (wave && !reduced) {
      if (t.key === wave.from) tile.classList.add('is-source');
      if (unlocked.has(t.key)) {
        tile.classList.add('is-waking');
        tile.style.setProperty('--wave-delay', `${200 + 160 * [...unlocked].indexOf(t.key)}ms`);
      }
    }
    tiles.push(tile);
    inner.append(tile);
  });
  if (wave && !reduced) {
    for (const line of svg.querySelectorAll('line')) {
      if (line.dataset.from === wave.from && unlocked.has(line.dataset.to)) line.classList.add('is-wave');
    }
  }

  // Roving tabindex: one tab stop, arrows move between tiles.
  root.addEventListener('keydown', (event) => {
    const current = event.target.closest('.map-tile');
    if (!current) return;
    const i = tiles.indexOf(current);
    if (i < 0) return;
    const t = lay.tiles[i];
    let next = -1;
    const nearestInRow = (dy) => {
      const candidates = lay.tiles.map((o, j) => ({ o, j })).filter(({ o }) => (dy < 0 ? o.y < t.y : o.y > t.y));
      if (!candidates.length) return -1;
      const targetY = dy < 0 ? Math.max(...candidates.map(({ o }) => o.y)) : Math.min(...candidates.map(({ o }) => o.y));
      const row = candidates.filter(({ o }) => o.y === targetY);
      row.sort((a, b) => Math.abs(a.o.x - t.x) - Math.abs(b.o.x - t.x));
      return row[0].j;
    };
    switch (event.key) {
      case 'ArrowRight': next = Math.min(tiles.length - 1, i + 1); break;
      case 'ArrowLeft': next = Math.max(0, i - 1); break;
      case 'ArrowDown': next = nearestInRow(1); break;
      case 'ArrowUp': next = nearestInRow(-1); break;
      case 'Home': next = 0; break;
      case 'End': next = tiles.length - 1; break;
      default: return;
    }
    if (next < 0 || next === i) return;
    event.preventDefault();
    tiles[i].tabIndex = -1;
    tiles[next].tabIndex = 0;
    tiles[next].focus();
  });

  root.layout = lay;
  root.tiles = tiles;
  return root;
}
