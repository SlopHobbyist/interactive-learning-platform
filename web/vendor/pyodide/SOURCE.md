# Pyodide (vendored)

Version 0.27.7, MPL-2.0, from the `pyodide-core` release tarball on GitHub (pyodide.js,
pyodide.mjs, pyodide.asm.js, pyodide.asm.wasm, python_stdlib.zip, pyodide-lock.json).
About 14 MB on disk; the browser downloads ~12 MB the first time a Python code item runs, then
caches it. Loaded only by elements/code (lazily, inside its sandboxed runner). No files are
fetched from any remote host.
