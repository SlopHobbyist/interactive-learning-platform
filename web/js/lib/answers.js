/* Answer normalisation and comparison helpers, shared with elements via ctx.lib. */

export const DEFAULT_NORMALIZE = { case: true, accents: true, punctuation: true, whitespace: true };

/**
 * normalize("  Él  dijo: ¡Hola! ", { case, accents, punctuation, whitespace })
 * Each option set to true means "ignore differences in that aspect".
 */
export function normalize(text, options = {}) {
  const opts = { ...DEFAULT_NORMALIZE, ...(options || {}) };
  let s = String(text ?? '');
  if (opts.whitespace) s = s.replace(/\s+/g, ' ').trim();
  if (opts.case) s = s.toLowerCase();
  if (opts.accents) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  if (opts.punctuation) {
    s = s.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~¡¿«»“”‘’…]/g, '');
    if (opts.whitespace) s = s.replace(/\s+/g, ' ').trim();
  }
  return s;
}

/** True when `given` matches any of `accepted` (string or array) after normalisation. */
export function matchesAny(given, accepted, options) {
  const list = Array.isArray(accepted) ? accepted : [accepted];
  const g = normalize(given, options);
  return list.some((a) => normalize(a, options) === g);
}

/** Full-match a regular expression against the normalised answer. */
export function matchesPattern(given, pattern, options) {
  if (!pattern) return false;
  let re;
  try {
    re = new RegExp(`^(?:${pattern})$`, 'u' + (options && options.case === false ? '' : 'i'));
  } catch {
    return false;
  }
  return re.test(normalize(given, options));
}

/**
 * Parse a typed number leniently: "1,234.5", "1 234,5", "3.14", "-2e3".
 * Returns NaN when nothing numeric is there.
 */
export function parseNumber(text) {
  let s = String(text ?? '').trim().replace(/\s+/g, '');
  if (!s) return NaN;
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // Whichever comes last is the decimal separator.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    // A single comma with 1-2 digits after it reads as a decimal comma, otherwise thousands.
    const parts = s.split(',');
    if (parts.length === 2 && parts[1].length !== 3) s = parts.join('.');
    else s = parts.join('');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export function numberWithin(given, answer, tolerance = 0, type = 'absolute') {
  if (!Number.isFinite(given)) return false;
  const tol = type === 'percent' ? Math.abs(answer) * (tolerance / 100) : tolerance;
  return Math.abs(given - answer) <= tol + 1e-9;
}

/* ----------------------------------------------------------------- shuffling */

/** FNV-1a string hash → 32-bit unsigned int. */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 PRNG from a seed (number or string). */
export function seeded(seed) {
  let a = typeof seed === 'string' ? hashString(seed) : (seed >>> 0);
  return function rand() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates on a copy. `seed` makes it deterministic (a string works). */
export function shuffle(array, seed = undefined) {
  const rand = seed === undefined ? Math.random : seeded(seed);
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Shuffle so the result differs from the input order (when possible). */
export function derange(array, seed = undefined) {
  if (array.length < 2) return array.slice();
  let out = shuffle(array, seed);
  let tries = 0;
  while (tries < 10 && out.every((v, i) => v === array[i])) {
    out = shuffle(out, seed === undefined ? undefined : `${seed}#${++tries}`);
  }
  if (out.every((v, i) => v === array[i])) out = [...out.slice(1), out[0]];
  return out;
}
