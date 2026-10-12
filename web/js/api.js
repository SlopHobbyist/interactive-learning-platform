/* Thin fetch wrapper: JSON in and out, errors surfaced as Wavefront toasts. */

export class ApiError extends Error {
  constructor(status, detail, url) {
    super(detail || `Request failed (${status})`);
    this.status = status;
    this.detail = detail;
    this.url = url;
  }
}

const cache = new Map();

function toast(message, variant = 'danger') {
  if (window.UI && typeof window.UI.toast === 'function') {
    window.UI.toast(message, { variant, duration: 5000 });
  } else {
    console.error(message);
  }
}

/**
 * api('/api/subjects')                       GET
 * api('/api/attempts', { method: 'POST', body })  POST JSON
 * Options: { method, body, silent (no toast), cache (GET only, per session) }
 */
export async function api(path, { method = 'GET', body, silent = false, cache: useCache = false, headers = {} } = {}) {
  if (method === 'GET' && useCache && cache.has(path)) return cache.get(path);
  let response;
  try {
    response = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch (err) {
    if (!silent) toast('Network error: the server could not be reached.');
    throw new ApiError(0, 'network error', path);
  }
  let data = null;
  const text = await response.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!response.ok) {
    const detail = (data && data.detail) || response.statusText || `HTTP ${response.status}`;
    if (!silent) toast(typeof detail === 'string' ? detail : JSON.stringify(detail));
    throw new ApiError(response.status, typeof detail === 'string' ? detail : JSON.stringify(detail), path);
  }
  if (method === 'GET' && useCache) cache.set(path, data);
  return data;
}

export const get = (path, opts) => api(path, { ...opts, method: 'GET' });
export const post = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const put = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });
export const del = (path, opts) => api(path, { ...opts, method: 'DELETE' });

export function invalidate(prefix = '') {
  for (const key of [...cache.keys()]) if (key.startsWith(prefix)) cache.delete(key);
}
