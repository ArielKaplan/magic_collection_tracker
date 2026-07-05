// Minimal DOM stubs so renderer ES modules (which touch window/document only
// at call time, not import time — but their import graph may) load cleanly in
// Node. Mirrors the stubs the scripts/smoke-*.js tests use.
const noop = () => {};
if (typeof globalThis.window === 'undefined') globalThis.window = { addEventListener: noop, app: {} };
if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
    body: { dataset: {} },
  };
}
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  };
}
