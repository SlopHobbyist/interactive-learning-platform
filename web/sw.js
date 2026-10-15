/* Service worker: offline lessons (plan §Phase 12).
   - App shell, stylesheets, scripts, vendored libraries, element modules and sounds are
     cached on first use (cache-first, refreshed in the background).
   - Content and element API reads (/api/subjects, /api/courses, /api/lessons, /api/elements,
     /api/review) are network-first with the cached copy as the offline fallback.
   - Everything else (progress, attempts, the subject library, auth and the /kratos/ proxy)
     goes to the network only.
   The cache name carries a version; bump it when the shell changes shape. */

const VERSION = 'ilp-v3';
const SHELL = ['/', '/index.html', '/css/app.css', '/js/app.js', '/vendor/wavefront/design_language.css', '/vendor/wavefront/design_language.js'];
const STATIC_PREFIXES = ['/css/', '/js/', '/vendor/', '/elements/', '/assets/', '/content/'];
const CONTENT_API = /^\/api\/(subjects|courses|lessons|elements|review)(\/|$)/;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

async function networkFirst(request) {
  const cache = await caches.open(VERSION);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached || new Response(JSON.stringify({ detail: 'offline and not cached' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return; // never touch other origins (there should be none)
  if (CONTENT_API.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // progress, auth: network only
  if (STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) || url.pathname === '/sw.js') {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }
  // Client-side routes: serve the shell (network first so deploys show up, cache offline).
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('/index.html')).then((r) => (r.ok ? r : networkFirst(request))));
  }
});
