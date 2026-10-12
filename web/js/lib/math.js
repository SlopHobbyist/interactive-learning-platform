/* Lazy KaTeX. The server emits <span class="math" data-display="0|1">TeX</span>;
   this renders them in place the first time a page needs it. Vendored at
   /vendor/katex (see its SOURCE.md); nothing is fetched remotely. */

let loading = null;

function loadCss() {
  if (document.querySelector('link[data-katex]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/vendor/katex/katex.min.css';
  link.dataset.katex = '1';
  document.head.append(link);
}

async function katex() {
  if (!loading) {
    loadCss();
    loading = import('/vendor/katex/katex.mjs').then((m) => m.default || m);
  }
  return loading;
}

/** Render every unrendered .math span under `root`. Resolves when done. */
export async function renderMath(root = document) {
  const spans = [...root.querySelectorAll('span.math:not([data-rendered])')];
  if (!spans.length) return;
  let k;
  try {
    k = await katex();
  } catch (err) {
    console.error('[math] KaTeX failed to load', err);
    return;
  }
  for (const span of spans) {
    const tex = span.textContent;
    const display = span.dataset.display === '1';
    try {
      k.render(tex, span, { displayMode: display, throwOnError: false, output: 'html' });
    } catch (err) {
      span.title = String(err && err.message || err);
    }
    span.dataset.rendered = '1';
  }
}
