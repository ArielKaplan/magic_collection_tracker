


// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
export function uid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

export function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function today() { return new Date().toISOString().split('T')[0]; }

export function toast(msg, type = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Color-identity pip filter: with pips selected, a card matches when its
// identity is a non-empty subset of the selection (U+G → mono-U, mono-G, or
// exactly UG). The C pip admits colorless (empty-identity) cards. Cards with
// no cached Scryfall metadata can't be classified and are hidden while pips
// are active.
export function colorIdentityMatches(identity, selected) {
  if (!selected || !selected.length) return true;
  if (!Array.isArray(identity)) return false;
  if (!identity.length) return selected.includes('C');
  return identity.every(c => selected.includes(c));
}

// Escape a string for safe use inside a JS literal in an inline onclick.
// HTML-escape (so the attribute value is valid) AND backslash-escape JS quotes.
export function escJs(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// All external HTTP goes through the main process (no CORS, no third-party
// proxies, API keys never leave first-party connections). Returns a
// Response-like object so existing call sites read naturally.
export async function netFetch(url, opts) {
  const r = await window.api.net.fetch(url, opts);
  if (!r.status && r.error) throw new Error(r.error);
  return {
    ok: r.ok,
    status: r.status,
    json: async () => JSON.parse(r.text),
    text: async () => r.text,
  };
}

