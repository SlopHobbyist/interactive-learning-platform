/* code — an editor with Run and test cases.

   Learner code runs inside a sandboxed iframe (opaque origin) which starts a Web Worker per run
   and terminates it on timeout. JavaScript runs directly; Python runs on vendored Pyodide loaded
   inside the worker the first time it is needed. See README.md. */

const PYODIDE_URL = '/vendor/pyodide/';

/* The sandbox page. It lives in a srcdoc iframe so it has an opaque origin: it cannot read the
   app's cookies, storage or DOM. It only talks to the element through postMessage. */
const SANDBOX_HTML = String.raw`<!doctype html><meta charset="utf-8"><script>
(function () {
  'use strict';
  var worker = null, timer = null, current = null;

  var WORKER_SRC = ${JSON.stringify(workerSource())};

  function kill() {
    if (worker) { worker.terminate(); worker = null; }
    if (timer) { clearTimeout(timer); timer = null; }
  }
  function spawn() {
    kill();
    var blob = new Blob([WORKER_SRC], { type: 'text/javascript' });
    worker = new Worker(URL.createObjectURL(blob));
    worker.onmessage = function (e) {
      if (!current) return;
      var msg = e.data;
      if (msg.kind === 'result') {
        if (timer) { clearTimeout(timer); timer = null; }
        var job = current; current = null;
        parent.postMessage({ id: job.id, kind: 'result', results: msg.results }, '*');
      } else if (msg.kind === 'status') {
        parent.postMessage({ id: current.id, kind: 'status', text: msg.text }, '*');
      }
    };
    worker.onerror = function (err) {
      if (!current) return;
      var job = current; current = null;
      parent.postMessage({ id: job.id, kind: 'result', results: [{ ok: false, stdout: '', stderr: String(err.message || err), timeout: false }] }, '*');
      kill();
    };
  }
  window.addEventListener('message', function (e) {
    var job = e.data;
    if (!job || job.kind !== 'run') return;
    if (!worker || current) spawn();
    current = job;
    timer = setTimeout(function () {
      var j = current; current = null;
      kill();
      parent.postMessage({ id: j.id, kind: 'result', results: [{ ok: false, stdout: '', stderr: 'Timed out after ' + j.timeout + ' ms.', timeout: true }] }, '*');
    }, job.timeout + (job.language === 'python' && !job.warm ? 60000 : 0));
    worker.postMessage(job);
  });
  parent.postMessage({ kind: 'ready' }, '*');
})();
</script>`;

/* Source of the worker that actually runs code. Plain script (importScripts for Pyodide). */
function workerSource() {
  return String.raw`
'use strict';
var pyodide = null, pyodideLoading = null;

function runJs(code, stdinText) {
  var out = [], err = [];
  var lines = stdinText ? stdinText.split('\n') : [];
  var readline = function () { return lines.length ? lines.shift() : null; };
  var fmt = function (args) { return Array.prototype.map.call(args, function (a) {
    return typeof a === 'string' ? a : (typeof a === 'object' && a !== null ? JSON.stringify(a) : String(a)); }).join(' '); };
  var fakeConsole = { log: function () { out.push(fmt(arguments)); }, error: function () { err.push(fmt(arguments)); },
    warn: function () { err.push(fmt(arguments)); }, info: function () { out.push(fmt(arguments)); } };
  try {
    var fn = new Function('console', 'readline', 'input', 'print', code);
    fn(fakeConsole, readline, readline, function (s) { out.push(String(s)); });
    return { ok: true, stdout: out.join('\n'), stderr: err.join('\n') };
  } catch (e) {
    return { ok: false, stdout: out.join('\n'), stderr: err.concat([String(e && e.stack ? e.name + ': ' + e.message : e)]).join('\n') };
  }
}

function loadPy(baseUrl) {
  if (pyodide) return Promise.resolve(pyodide);
  if (!pyodideLoading) {
    postMessage({ kind: 'status', text: 'Loading Python (about 12 MB, first time only)…' });
    importScripts(baseUrl + 'pyodide.js');
    pyodideLoading = self.loadPyodide({ indexURL: baseUrl }).then(function (p) { pyodide = p; return p; });
  }
  return pyodideLoading;
}

function runPy(code, stdinText) {
  var out = [], err = [];
  var lines = stdinText ? stdinText.split('\n') : [];
  pyodide.setStdin({ stdin: function () { return lines.length ? lines.shift() : null; }, isatty: false });
  pyodide.setStdout({ batched: function (s) { out.push(s); } });
  pyodide.setStderr({ batched: function (s) { err.push(s); } });
  try {
    pyodide.runPython(code, { globals: pyodide.globals.get('dict')() });
    return { ok: true, stdout: out.join('\n'), stderr: err.join('\n') };
  } catch (e) {
    var msg = String(e && e.message || e);
    // Keep only the Python traceback's last lines: the useful part for a learner.
    var tail = msg.trim().split('\n').slice(-3).join('\n');
    return { ok: false, stdout: out.join('\n'), stderr: err.concat([tail]).join('\n') };
  }
}

function compare(expected, actual) {
  var norm = function (s) { return String(s || '').replace(/\r/g, '').split('\n').map(function (l) { return l.replace(/\s+$/, ''); }).join('\n').replace(/\n+$/, ''); };
  return norm(expected) === norm(actual);
}

self.onmessage = function (e) {
  var job = e.data;
  var tests = job.tests && job.tests.length ? job.tests : [{ expect: null }];
  var go = function () {
    var results = tests.map(function (t) {
      var r = job.language === 'python' ? runPy(job.code, t.stdin || '') : runJs(job.code, t.stdin || '');
      r.pass = r.ok && (t.expect == null || compare(t.expect, r.stdout));
      r.expect = t.expect;
      return r;
    });
    postMessage({ kind: 'result', results: results });
  };
  if (job.language === 'python') {
    loadPy(job.pyodideUrl).then(go, function (err) {
      postMessage({ kind: 'result', results: [{ ok: false, stdout: '', stderr: 'Python runtime failed to load: ' + err, pass: false }] });
    });
  } else {
    go();
  }
};
`;
}

/* ------------------------------------------------------------------ runner */
class Runner {
  constructor(origin) {
    this.origin = origin;
    this.jobs = new Map();
    this.seq = 0;
    this.ready = new Promise((resolve) => { this.resolveReady = resolve; });
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.setAttribute('aria-hidden', 'true');
    this.frame.setAttribute('title', 'Code sandbox');
    this.frame.style.display = 'none';
    this.frame.srcdoc = SANDBOX_HTML;
    this.onMessage = (e) => {
      if (e.source !== this.frame.contentWindow) return;
      const msg = e.data || {};
      if (msg.kind === 'ready') { this.resolveReady(); return; }
      const job = this.jobs.get(msg.id);
      if (!job) return;
      if (msg.kind === 'status') job.onStatus && job.onStatus(msg.text);
      if (msg.kind === 'result') { this.jobs.delete(msg.id); job.resolve(msg.results); }
    };
    window.addEventListener('message', this.onMessage);
    document.body.append(this.frame);
    this.warm = false;
  }
  async run({ language, code, tests, timeout, onStatus }) {
    await this.ready;
    const id = ++this.seq;
    const pyodideUrl = new URL(PYODIDE_URL, this.origin).href;
    return new Promise((resolve) => {
      this.jobs.set(id, { resolve, onStatus });
      this.frame.contentWindow.postMessage({ kind: 'run', id, language, code, tests, timeout, pyodideUrl, warm: this.warm }, '*');
      if (language === 'python') this.warm = true;
    });
  }
  destroy() {
    window.removeEventListener('message', this.onMessage);
    this.frame.remove();
  }
}

/* ------------------------------------------------------------------ editor */
/* Tab indents, so the editor would trap keyboard focus (WCAG 2.1.2). The usual way out, as in
   most code editors on the web: Esc, then Tab (or Shift+Tab) moves focus on. */
function makeEditor(lib, initial, language, onInput, hintId) {
  const { el } = lib;
  const gutter = el('pre', { class: 'code-gutter', 'aria-hidden': 'true' });
  const textarea = el('textarea', {
    class: 'code-editor-input', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off',
    'aria-label': `${language} code editor`, 'aria-describedby': hintId, rows: 8, wrap: 'off',
  });
  let escaped = false; // Esc was the last key: the next Tab leaves the editor
  textarea.value = initial || '';
  const root = el('div', { class: 'code-editor', 'data-language': language }, gutter, textarea);
  function renumber() {
    const n = Math.max(1, textarea.value.split('\n').length);
    gutter.textContent = Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
    textarea.rows = Math.min(30, Math.max(8, n + 1));
  }
  textarea.addEventListener('input', () => { renumber(); onInput(); });
  textarea.addEventListener('scroll', () => { gutter.scrollTop = textarea.scrollTop; });
  textarea.addEventListener('keydown', (e) => {
    const leaving = escaped;
    escaped = e.key === 'Escape';
    if (e.key === 'Tab' && leaving) return; // the browser moves focus on
    // Enter is the player's shortcut elsewhere; inside the editor it must insert a newline.
    if (e.key === 'Enter' && !(e.ctrlKey || e.metaKey)) {
      e.stopPropagation();
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en, value } = textarea;
      const lineStart = value.lastIndexOf('\n', s - 1) + 1;
      const indent = (value.slice(lineStart, s).match(/^[ \t]*/) || [''])[0];
      const extra = /[:{(\[]\s*$/.test(value.slice(lineStart, s)) ? (language === 'python' ? '    ' : '  ') : '';
      textarea.setRangeText('\n' + indent + extra, s, en, 'end');
      renumber(); onInput();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: en } = textarea;
      textarea.setRangeText(language === 'python' ? '    ' : '  ', s, en, 'end');
      renumber(); onInput();
    }
  });
  renumber();
  return { root, textarea, get value() { return textarea.value; }, set value(v) { textarea.value = v; renumber(); } };
}

/* ----------------------------------------------------------------- element */
export default {
  type: 'code',

  mount(root, ctx) {
    const { item, lib } = ctx;
    const { html, raw, el, icon, escapeHtml } = lib;
    const language = item.language || 'javascript';
    const tests = item.tests || [];
    const timeout = item.timeout_ms || 5000;
    let results = null;      // last run's per-test results
    let locked = false;
    let running = false;
    const runner = new Runner(location.origin);
    const hintId = `code-hint-${item.id}-${Math.random().toString(36).slice(2, 7)}`;

    const editor = makeEditor(lib, item.starter || '', language, () => { results = null; paintTests(); ctx.onChange(false); }, hintId);
    const runBtn = el('button', { type: 'button', class: 'button button-tonal' }, icon('play_arrow'), 'Run');
    const resetBtn = el('button', { type: 'button', class: 'button button-text' }, icon('restart_alt'), 'Reset');
    const status = el('span', { class: 'text-caption text-muted code-status', 'aria-live': 'polite' });
    const output = el('pre', { class: 'code-block code-output', 'aria-live': 'polite', hidden: true });
    const testList = el('ul', { class: 'code-tests', 'aria-label': 'Tests' });
    const mac = /Mac|iPhone|iPad/.test(navigator.platform);
    const hint = el('p', { class: 'text-caption text-muted mt-2', id: hintId },
      `Tab indents; Esc then Tab leaves the editor. ${mac ? '⌘' : 'Ctrl'}+Enter runs, and once it has run, ${mac ? '⌘' : 'Ctrl'}+Enter again submits.`);

    root.append(html`
      <div class="el-code">
        <div class="prose el-prompt mb-3">${raw(item.prompt_html || '')}</div>
        ${editor.root}
        ${hint}
        <div class="row mt-2 code-toolbar">${runBtn}${resetBtn}<span class="chip">${escapeHtml(language)}</span>${status}</div>
        ${output}
        ${testList}
      </div>`);

    function paintTests() {
      lib.clear(testList);
      tests.forEach((t, i) => {
        const r = results && results[i];
        const state = !r ? 'pending' : r.pass ? 'pass' : 'fail';
        const li = el('li', { class: 'code-test', 'data-state': state },
          el('span', { class: 'icon icon-sm' }, state === 'pass' ? 'check_circle' : state === 'fail' ? 'cancel' : 'radio_button_unchecked'),
          el('span', { class: 'code-test-name' }, t.name || `Test ${i + 1}`),
          t.hidden ? el('span', { class: 'text-muted text-caption' }, 'hidden') : el('code', { class: 'code-inline' }, t.stdin ? `stdin: ${JSON.stringify(t.stdin)} → ${JSON.stringify(t.expect)}` : `expects ${JSON.stringify(t.expect)}`));
        if (r && !r.pass && !t.hidden && r.ok) li.append(el('span', { class: 'text-caption text-danger' }, `got ${JSON.stringify(r.stdout)}`));
        testList.append(li);
      });
    }
    paintTests();

    async function run() {
      if (running || locked) return;
      running = true;
      // aria-disabled, not disabled: a disabled button would drop keyboard focus to <body>.
      runBtn.setAttribute('aria-disabled', 'true');
      status.textContent = 'Running…';
      output.hidden = true;
      try {
        results = await runner.run({ language, code: editor.value, tests, timeout, onStatus: (t) => { status.textContent = t; } });
      } catch (err) {
        results = [{ ok: false, pass: false, stdout: '', stderr: String(err) }];
      }
      running = false;
      runBtn.removeAttribute('aria-disabled');
      const first = results[0] || {};
      const text = [first.stdout, first.stderr].filter(Boolean).join('\n');
      output.textContent = text || '(no output)';
      output.hidden = false;
      output.classList.toggle('is-error', !first.ok);
      const passed = results.filter((r) => r.pass).length;
      status.textContent = tests.length ? `${passed} / ${tests.length} tests pass` : 'Done';
      paintTests();
      ctx.onChange(true);
    }
    runBtn.addEventListener('click', run);
    resetBtn.addEventListener('click', () => { if (locked) return; editor.value = item.starter || ''; results = null; paintTests(); output.hidden = true; status.textContent = ''; ctx.onChange(false); });
    // Ctrl/Cmd+Enter runs. Once this code has run, it falls through to the player, which checks.
    function onKey(e) {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'Enter')) return;
      if (results && !running) return;
      e.preventDefault();
      e.stopPropagation();
      run();
    }
    root.addEventListener('keydown', onKey);

    return {
      getAnswer: () => (results ? { code: editor.value, passed: results.filter((r) => r.pass).length, total: tests.length } : null),
      check(answer) {
        const passed = answer ? answer.passed : 0;
        const total = tests.length || 1;
        const ok = passed === total;
        return {
          correct: ok,
          partial: passed / total,
          feedback_html: item.explain_html || (ok ? '' : `<p>${passed} of ${total} tests pass.</p>`),
          correct_answer_html: !ok && item.solution_html ? item.solution_html : '',
        };
      },
      showResult(result) {
        locked = true;
        editor.textarea.readOnly = true;
        editor.root.classList.add('is-locked', result && result.correct ? 'is-valid' : 'is-invalid');
        runBtn.disabled = true;
        runBtn.removeAttribute('aria-disabled');
        resetBtn.disabled = true;
      },
      focus() { editor.textarea.focus(); },
      destroy() { root.removeEventListener('keydown', onKey); runner.destroy(); },
    };
  },
};
