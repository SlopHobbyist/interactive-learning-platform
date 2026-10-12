/* History API router. No hashes. Routes are `/path/:param` patterns matched in
   order; each resolves to a lazily imported view module. */

function compile(pattern) {
  const keys = [];
  const re = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { re: new RegExp(`^${re}/?$`), keys };
}

export class Router {
  constructor() {
    this.routes = [];
    this.notFound = null;
    this.listeners = new Set();
    this.current = null;
    window.addEventListener('popstate', () => this.resolve());
    document.addEventListener('click', (event) => this.onClick(event));
  }

  add(pattern, load, meta = {}) {
    this.routes.push({ pattern, ...compile(pattern), load, meta });
    return this;
  }

  fallback(load) {
    this.notFound = load;
    return this;
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  match(pathname) {
    for (const route of this.routes) {
      const m = route.re.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    return null;
  }

  /** Intercept in-app links: same-origin, no modifier keys, no target/download. */
  onClick(event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const a = event.target.closest('a[href]');
    if (!a || a.target || a.hasAttribute('download') || a.getAttribute('rel') === 'external') return;
    const href = a.getAttribute('href');
    if (!href || !href.startsWith('/') || href.startsWith('//')) return;
    // Static files and API links are not routes.
    if (/^\/(api|elements|content|vendor|css|js)\//.test(href)) return;
    event.preventDefault();
    this.navigate(href);
  }

  navigate(path, { replace = false } = {}) {
    const url = new URL(path, location.origin);
    const same = url.pathname + url.search === location.pathname + location.search;
    if (!same) {
      history[replace ? 'replaceState' : 'pushState']({}, '', url.pathname + url.search + url.hash);
    }
    return this.resolve();
  }

  async resolve() {
    const pathname = location.pathname;
    const query = Object.fromEntries(new URLSearchParams(location.search));
    const hit = this.match(pathname);
    const ctx = {
      path: pathname,
      query,
      params: hit ? hit.params : {},
      meta: hit ? hit.route.meta : {},
      pattern: hit ? hit.route.pattern : null,
      navigate: (p, o) => this.navigate(p, o),
    };
    const load = hit ? hit.route.load : this.notFound;
    this.current = ctx;
    for (const fn of this.listeners) {
      try {
        await fn(ctx, load);
      } catch (err) {
        console.error('[router] listener failed', err);
      }
    }
    return ctx;
  }
}
