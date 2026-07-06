// dispatch.js — app-wide delegated event dispatch, so rendered HTML carries
// NO inline event handlers (onclick/onchange/…). That lets the CSP drop
// script-src 'unsafe-inline' — the real fix for injected-handler XSS, since an
// attacker-controlled string that lands in a data-* attribute is inert data,
// never executed.
//
// Markup uses:
//   <button data-act="name" data-arg="x">      → ACTIONS.name(el, event)
//   <img data-imgerr="hide|remove|hide-card">   → image-load fallback
// Generic built-ins cover the common shapes so most call sites need no bespoke
// action; a fallback also lets data-act="globalFnName" call window[name](arg).
//
// The SL Explorer's older data-slact dispatch (slTab.js) keeps running
// alongside this — both are bound once at startup.

import { ui } from './state.js';
import { render } from './render.js';

const ACTIONS = {};

export function registerActions(obj) {
  for (const k in obj) ACTIONS[k] = obj[k];
}

// ── nested ui path helpers ───────────────────────────────────────────────────
function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}
function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
  o[ks[ks.length - 1]] = val;
}
// '' stays '', all-digits → number, 'true'/'false' → boolean, else string.
function coerce(v) {
  if (v === '' || v == null) return '';
  if (/^-?\d+$/.test(v)) return +v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

// Re-focus a text input by id after a render rebuilt it, restoring the caret to
// the end (the as-you-type search boxes need this).
function queueRefocus(id) {
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch {} }
  }, 0);
}

// ── built-in generic actions ─────────────────────────────────────────────────
registerActions({
  // Set a ui path, optionally a few sibling paths (data-also="a.b=1;c.d="),
  // then render. Value comes from data-val, else the element (checkbox→checked,
  // else value). data-refocus="inputId" restores caret after the re-render.
  'ui-set': (el) => {
    const d = el.dataset;
    let val = 'val' in d ? coerce(d.val) : (el.type === 'checkbox' ? el.checked : el.value);
    setPath(ui, d.path, val);
    if (d.also) for (const pair of d.also.split(';')) {
      if (!pair) continue;
      const i = pair.indexOf('=');
      setPath(ui, pair.slice(0, i), coerce(pair.slice(i + 1)));
    }
    render();
    if (d.refocus) queueRefocus(d.refocus);
  },
  'ui-inc':    (el) => { setPath(ui, el.dataset.path, (getPath(ui, el.dataset.path) || 0) + 1); render(); },
  'ui-toggle': (el) => { setPath(ui, el.dataset.path, !getPath(ui, el.dataset.path)); render(); },
  'open-url':  (el) => { window.api?.app?.openExternal?.(el.dataset.arg); },
});

// ── the delegated dispatch ───────────────────────────────────────────────────
const FORM_CONTROL = /^(INPUT|SELECT|TEXTAREA|OPTION)$/;

function run(el, e) {
  const act = el.dataset.act;
  const fn = ACTIONS[act];
  if (el.tagName === 'A') e.preventDefault();
  if (fn) { fn(el, e); return; }
  // Fallback: a bare global function name with a single string arg.
  const g = typeof window !== 'undefined' ? window[act] : null;
  if (typeof g === 'function') g(el.dataset.arg);
}
function fromClick(e) {
  const el = e.target.closest ? e.target.closest('[data-act]') : null;
  // Form controls act on change/input, not click (so clicking into a search
  // box doesn't re-render and jump the caret).
  if (el && !FORM_CONTROL.test(el.tagName)) run(el, e);
}
function fromValue(e) {
  const el = e.target.closest ? e.target.closest('[data-act]') : null;
  if (el) run(el, e);
}

// Bound once at startup (renderer main.js). Delegation on document reaches
// re-rendered tab content and modal HTML alike. click for buttons/links,
// change for selects/checkboxes, input for as-you-type text fields.
export function initDispatch() {
  if (typeof document === 'undefined' || window.__dispatchBound) return;
  window.__dispatchBound = true;
  document.addEventListener('click', fromClick);
  document.addEventListener('change', fromValue);
  document.addEventListener('input',  fromValue);
  // Image load failures: hide/remove the broken <img> (error doesn't bubble, so
  // capture). Replaces the old inline onerror="this.style.display='none'".
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (!el || el.tagName !== 'IMG' || !el.dataset || !el.dataset.imgerr) return;
    const mode = el.dataset.imgerr;
    if (mode === 'remove') el.remove();
    else if (mode === 'hide-card') { const c = el.closest('.gallery-card'); if (c) c.style.display = 'none'; }
    else el.style.display = 'none';
  }, true);
}

// Exposed for unit tests.
export const _internals = { getPath, setPath, coerce, ACTIONS };
