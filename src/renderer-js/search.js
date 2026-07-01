// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// Phase A: an offline, as-you-type dropdown that searches the collection + the
// baked Secret Lair catalog, grouped by type. Hitting Enter (or "See all") opens
// the Search Results tab (Phase B adds live-catalog + tabbed/frozen results).
//
// Data notes:
//  - Cards/binders/sealed/decks/want list live on `collection` (state.js).
//  - Binders + sets are not entities; they're distinct values across cards.
//  - The SL catalog is exposed as globals by secretlair.js: SL_SUPERDROPS,
//    SL_DROP_TO_SUPERDROP, SL_DROP_CARDS (accessed bare, with typeof guards,
//    exactly as slTab.js does).
// ─────────────────────────────────────────────────────────────────────────────
import { showGalleryModal } from './gallery.js';
import { hideModal } from './modals.js';
import { render } from './render.js';
import { showSlViewerModal } from './slTab.js';
import { collection, tcgcsvCache, ui } from './state.js';
import { esc, escJs, fmt, netFetch } from './utils.js';

const CAP = 5;   // results shown per group in the dropdown before "See all"

const norm = s => (s == null ? '' : String(s)).toLowerCase().trim();

// Every term must appear somewhere in the concatenated fields (AND match).
function makeMatcher(query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return (...fields) => {
    if (!terms.length) return false;
    const hay = norm(fields.filter(Boolean).join('  '));
    // Word-boundary (prefix-of-word) match: "ring" hits "One Ring"/"Ringleader"
    // but not "Whispering". Term is already lowercased.
    return terms.every(t => new RegExp('(?:^|[^\\p{L}\\p{N}])' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u').test(hay));
  };
}

// ── Navigation helpers ──────────────────────────────────────────────────────
function goToTab(tab) {
  ui.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  render();
}

// ── The offline search index ────────────────────────────────────────────────
// Returns { groups: [{ key, label, items, total }], totalCount } or null when empty.
export function quickSearch(query, cap = CAP) {
  const q = norm(query);
  if (!q) return null;
  const match = makeMatcher(query);

  // Owned cards, grouped by name (match name + set name/code + collector #)
  const cardByName = new Map();
  for (const c of collection.cards) {
    if (c.status === 'sold') continue;
    if (!match(c.name, c.setName, c.setCode, c.collectorNumber)) continue;
    const key = c.name;
    let g = cardByName.get(key);
    if (!g) { g = { type: 'card', name: c.name, owned: true, qty: 0, prints: new Set(), cardId: c.id, scryfallId: c.scryfallId }; cardByName.set(key, g); }
    g.qty += (c.quantity || 1);
    g.prints.add(`${c.setCode}|${c.collectorNumber}|${c.foil}`);
  }
  const ownedNames = new Set([...cardByName.keys()].map(norm));

  // SL-catalog card names you don't own (name-only match; no local id/price)
  const slCardResults = [];
  if (typeof SL_DROP_CARDS !== 'undefined') {
    const seen = new Set();
    for (const drop in SL_DROP_CARDS) {
      for (const name of (SL_DROP_CARDS[drop] || [])) {
        const n = norm(name);
        if (ownedNames.has(n) || seen.has(n)) continue;
        if (!match(name)) continue;
        seen.add(n);
        slCardResults.push({ type: 'card', name, owned: false, drop });
      }
    }
  }
  const cards = [...cardByName.values()]
    .map(g => ({ ...g, prints: g.prints.size }))
    .sort((a, b) => b.qty - a.qty)
    .concat(slCardResults.sort((a, b) => a.name.localeCompare(b.name)));

  // Sets (distinct setName/setCode across owned cards)
  const setMap = new Map();
  for (const c of collection.cards) {
    if (c.status === 'sold' || !c.setName) continue;
    const key = c.setCode || c.setName;
    if (!setMap.has(key)) setMap.set(key, { type: 'set', name: c.setName, code: c.setCode, count: 0 });
    if (match(c.setName, c.setCode)) setMap.get(key).count++;
  }
  const sets = [...setMap.values()].filter(s => s.count > 0 && match(s.name, s.code)).sort((a, b) => b.count - a.count);

  // Binders (distinct binderName across owned cards)
  const binderMap = new Map();
  for (const c of collection.cards) {
    if (c.status === 'sold' || !c.binderName) continue;
    if (!binderMap.has(c.binderName)) binderMap.set(c.binderName, { type: 'binder', name: c.binderName, count: 0 });
    binderMap.get(c.binderName).count += (c.quantity || 1);
  }
  const binders = [...binderMap.values()].filter(b => match(b.name)).sort((a, b) => b.count - a.count);

  // Sealed products (owned)
  const sealed = (collection.sealed || [])
    .filter(s => match(s.name, s.dropName, s.type))
    .map(s => ({ type: 'sealed', name: s.name || s.dropName, sub: s.type, owned: (s.status !== 'sold'), id: s.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Decks
  const decks = (collection.decks || [])
    .filter(d => match(d.name))
    .map(d => ({ type: 'deck', name: d.name, id: d.id, count: (d.cards || []).length }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Want list
  const wantlist = (collection.wantList || [])
    .filter(w => match(w.name, w.setName, w.setCode))
    .map(w => ({ type: 'want', name: w.name, sub: w.setName, scryfallId: w.scryfallId }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Secret Lair drops + superdrops (baked catalog)
  const slDrops = [];
  if (typeof SL_DROP_TO_SUPERDROP !== 'undefined') {
    const ownedIds = new Set(collection.cards.filter(c => c.status !== 'sold' && c.scryfallId).map(c => c.scryfallId));
    const idsByDrop = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined') ? SL_DROP_TO_SCRYFALL_IDS : {};
    for (const drop in SL_DROP_TO_SUPERDROP) {
      const sd = SL_DROP_TO_SUPERDROP[drop] || {};
      if (!match(drop, sd.superdrop)) continue;
      const owned = (idsByDrop[drop] || []).some(id => ownedIds.has(id));
      slDrops.push({ type: 'sldrop', name: drop, sub: sd.superdrop, owned });
    }
    slDrops.sort((a, b) => Number(b.owned) - Number(a.owned) || a.name.localeCompare(b.name));
  }

  // Failed lookups
  const failed = (collection.failedLookups || [])
    .filter(f => match(f.name, f.setCode, f.collectorNumber))
    .map(f => ({ type: 'failed', name: f.name || '(unknown card)', sub: f.setCode }));

  const defs = [
    ['cards', 'Cards', cards],
    ['sets', 'Sets', sets],
    ['binders', 'Binders', binders],
    ['sealed', 'Sealed', sealed],
    ['decks', 'Decks', decks],
    ['want', 'Want List', wantlist],
    ['sldrops', 'Secret Lair Drops', slDrops],
    ['failed', 'Failed Lookups', failed],
  ];
  const groups = defs
    .filter(([, , items]) => items.length)
    .map(([key, label, items]) => ({ key, label, items: items.slice(0, cap), total: items.length }));

  const totalCount = groups.reduce((s, g) => s + g.total, 0);
  return { groups, totalCount };
}

// ── Ownership dot ────────────────────────────────────────────────────────────
function ownDot(owned) {
  if (owned === undefined) return '';
  return owned
    ? '<span class="sr-own sr-own-yes" title="In your collection">●</span>'
    : '<span class="sr-own sr-own-no" title="Not in your collection">○</span>';
}

// ── Dropdown rendering ───────────────────────────────────────────────────────
function rowHtml(item, idx) {
  const meta = [];
  if (item.type === 'card') {
    if (item.owned) { meta.push(`×${item.qty}`); if (item.prints > 1) meta.push(`${item.prints} printings`); }
    else meta.push(esc(item.drop || 'Secret Lair'));
  } else if (item.type === 'set')    meta.push(`${item.count} card${item.count !== 1 ? 's' : ''}`);
  else if (item.type === 'binder')   meta.push(`${item.count} card${item.count !== 1 ? 's' : ''}`);
  else if (item.type === 'deck')     meta.push(`${item.count} card${item.count !== 1 ? 's' : ''}`);
  else if (item.sub)                 meta.push(esc(item.sub));

  const own = (item.owned !== undefined) ? ownDot(item.owned) : '';
  return `<div class="sr-row" role="option" data-idx="${idx}">
    ${own}
    <span class="sr-row-name">${esc(item.name)}</span>
    ${meta.length ? `<span class="sr-row-meta">${meta.join(' · ')}</span>` : ''}
  </div>`;
}

let flatItems = [];   // flattened, in render order, for keyboard nav
let activeIdx = -1;

function renderDropdown(query) {
  const box = document.getElementById('cmd-search-results');
  if (!box) return;
  const res = quickSearch(query);
  flatItems = [];
  activeIdx = -1;

  if (!res || !res.totalCount) {
    box.innerHTML = query.trim()
      ? `<div class="sr-empty">No matches for “${esc(query.trim())}”. Press Enter for a full catalog search.</div>`
      : '';
    box.style.display = query.trim() ? 'block' : 'none';
    return;
  }

  let html = '';
  for (const g of res.groups) {
    html += `<div class="sr-group"><div class="sr-group-head">${esc(g.label)}${g.total > g.items.length ? `<span class="sr-group-more">${g.total}</span>` : ''}</div>`;
    for (const item of g.items) {
      html += rowHtml(item, flatItems.length);
      flatItems.push(item);
    }
    html += '</div>';
  }
  html += `<div class="sr-foot" data-action="full">↵ See all results for “${esc(query.trim())}” — full catalog search</div>`;
  box.innerHTML = html;
  box.style.display = 'block';

  box.querySelectorAll('.sr-row').forEach(el => {
    el.addEventListener('mouseenter', () => setActive(Number(el.dataset.idx)));
    el.addEventListener('mousedown', e => { e.preventDefault(); pick(Number(el.dataset.idx)); });
  });
  const foot = box.querySelector('.sr-foot');
  if (foot) foot.addEventListener('mousedown', e => { e.preventDefault(); openFullSearch(query); });
}

function setActive(idx) {
  activeIdx = idx;
  const box = document.getElementById('cmd-search-results');
  box.querySelectorAll('.sr-row').forEach(el => el.classList.toggle('active', Number(el.dataset.idx) === idx));
}

// ── Result actions ───────────────────────────────────────────────────────────
function pick(idx) { pickItem(flatItems[idx]); }

function pickItem(item) {
  if (!item) return;
  closeDropdown();
  switch (item.type) {
    case 'card':
      if (item.owned && item.cardId != null) showGalleryModal(item.cardId);
      else if (item.scryfallId) showSlViewerModal(item.scryfallId);
      else openFullSearch(item.name);           // not-owned, no local id → resolve online
      break;
    case 'set':
      ui.cards.search = item.name; ui.cards.binder = { include: [], exclude: [] }; goToTab('cards'); break;
    case 'binder':
      ui.cards.search = ''; ui.cards.binder = { include: [item.name], exclude: [] }; goToTab('cards'); break;
    case 'sealed':
      ui.sealed.search = item.name; goToTab('sealed'); break;
    case 'deck':
      ui.decks.deckId = item.id; goToTab('decks'); break;
    case 'want':
      ui.wantList.search = item.name; goToTab('wantlist'); break;
    case 'sldrop':
      ui.slViewer.drop = item.name; ui.slViewer.superdrop = item.sub || ''; ui.slViewer.view = 'drops'; goToTab('slviewer'); break;
    case 'failed':
      goToTab('failures'); break;
    case 'scrycard':   // live Scryfall card → detail popup
    case 'print':      // a specific printing → detail popup
      if (item.scryfallId) showSlViewerModal(item.scryfallId);
      break;
    case 'sealedcat':  // live TCGCSV sealed product → Sealed tab
      ui.sealed.search = item.name; goToTab('sealed'); break;
  }
}

// Jump to Card Collection filtered to a card name (used by the "view in
// collection" link in the card detail popup). Global via main.js's exposer.
export function viewInCollection(name) {
  ui.cards.search = name;
  ui.cards.binder = { include: [], exclude: [] };
  ui.cards.status = 'owned';
  hideModal();
  goToTab('cards');
}

// ─────────────────────────────────────────────────────────────────────────────
// SEARCH RESULTS TABS (Phase B)
// Frozen, closeable, persisted result tabs in the Search Results view. Two kinds:
//   'query'     — a full search (collection + SL + live Scryfall + live TCGCSV)
//   'printings' — every printing of one card (live Scryfall, unique=prints)
// Tab descriptors persist to localStorage; results live in memory and re-run on
// load (prices change, so stale snapshots aren't worth persisting).
// ─────────────────────────────────────────────────────────────────────────────
const MAX_TABS = 30;
const TABS_KEY = 'sl-search-tabs';

function ensureSearchState() {
  if (!ui.search || !Array.isArray(ui.search.tabs)) ui.search = { tabs: [], activeId: null };
  return ui.search;
}
function newId() { return 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function persistTabs() {
  try {
    const s = ensureSearchState();
    const slim = s.tabs.map(t => ({ id: t.id, kind: t.kind, query: t.query, cardName: t.cardName, label: t.label, createdAt: t.createdAt }));
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs: slim, activeId: s.activeId }));
  } catch { /* localStorage unavailable — tabs stay session-only */ }
}

export function loadPersistedTabs() {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    const s = ensureSearchState();
    s.tabs = (data.tabs || []).slice(0, MAX_TABS).map(t => ({ ...t, status: 'idle', results: null, error: null }));
    s.activeId = (data.activeId && s.tabs.some(t => t.id === data.activeId)) ? data.activeId : (s.tabs[0]?.id || null);
  } catch { /* ignore corrupt store */ }
}

function addTab(tab) {
  const s = ensureSearchState();
  // De-dupe: same kind + same target → activate the existing tab instead
  const existing = s.tabs.find(t => t.kind === tab.kind &&
    (tab.kind === 'query' ? norm(t.query) === norm(tab.query) : norm(t.cardName) === norm(tab.cardName)));
  if (existing) { s.activeId = existing.id; persistTabs(); return existing; }
  s.tabs.push(tab);
  while (s.tabs.length > MAX_TABS) s.tabs.shift();   // drop oldest past the cap
  s.activeId = tab.id;
  persistTabs();
  return tab;
}

export function openQueryTab(query) {
  closeDropdown();
  const q = (query || '').trim();
  if (!q) return;
  const tab = addTab({ id: newId(), kind: 'query', query: q, label: q, createdAt: Date.now(), status: 'idle', results: null });
  goToTab('search');
  if (tab.status !== 'done') runTab(tab.id);
}

export function openPrintingsTab(cardName) {
  hideModal();
  const name = (cardName || '').trim();
  if (!name) return;
  const tab = addTab({ id: newId(), kind: 'printings', cardName: name, label: `${name} · printings`, createdAt: Date.now(), status: 'idle', results: null });
  goToTab('search');
  if (tab.status !== 'done') runTab(tab.id);
}

export function activateSearchTab(id) {
  const s = ensureSearchState();
  const tab = s.tabs.find(t => t.id === id);
  if (!tab) return;
  s.activeId = id;
  persistTabs();
  render();
  if (tab.status === 'idle') runTab(id);
}

export function closeSearchTab(id) {
  const s = ensureSearchState();
  const idx = s.tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  s.tabs.splice(idx, 1);
  if (s.activeId === id) s.activeId = (s.tabs[idx] || s.tabs[idx - 1] || null)?.id || null;
  persistTabs();
  render();
}

// Backwards-compatible alias (dropdown "See all" / Enter).
export function openFullSearch(query) { openQueryTab(query); }

// ── Async runners ─────────────────────────────────────────────────────────────
function ownedIdSet() {
  return new Set(collection.cards.filter(c => c.status !== 'sold' && c.scryfallId).map(c => c.scryfallId.toLowerCase()));
}

async function runTab(id) {
  const s = ensureSearchState();
  const tab = s.tabs.find(t => t.id === id);
  if (!tab) return;
  tab.status = 'loading'; tab.error = null;
  if (ui.activeTab === 'search' && s.activeId === id) render();
  try {
    tab.results = tab.kind === 'printings' ? await fetchPrintings(tab.cardName) : await fetchQuery(tab.query);
    tab.status = 'done';
  } catch (e) {
    tab.status = 'error';
    tab.error = e.message || 'Search failed';
  }
  if (ui.activeTab === 'search' && s.activeId === id) render();
}

async function fetchQuery(query) {
  const offline = quickSearch(query, Infinity);   // collection + SL (offline)
  let scry = [];
  try {
    const resp = await netFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=cards&order=name`);
    if (resp.ok) { const d = await resp.json(); scry = (d.data || []).slice(0, 60); }
  } catch { /* no results / offline → leave empty */ }
  const toks = norm(query).split(/\s+/).filter(Boolean);
  const sealedCat = (tcgcsvCache.sealedProducts || [])
    .filter(p => p.name && toks.every(t => p.name.toLowerCase().includes(t)))
    .slice(0, 40);
  return { offline, scry, sealedCat, sealedLoaded: (tcgcsvCache.sealedProducts || []).length > 0 };
}

async function fetchPrintings(cardName) {
  const q = '!"' + cardName + '"';
  const resp = await netFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(q)}&unique=prints&order=released`);
  if (!resp.ok) return { prints: [] };
  const d = await resp.json();
  return { prints: d.data || [] };
}

// ── Dropdown open/close + wiring ─────────────────────────────────────────────
function closeDropdown() {
  const box = document.getElementById('cmd-search-results');
  if (box) box.style.display = 'none';
  activeIdx = -1;
}

let debounceTimer = null;

export function initSearch() {
  const input = document.getElementById('cmd-search-input');
  if (!input) return;
  input.disabled = false;
  loadPersistedTabs();   // restore any Search Results tabs from a prior session

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const v = input.value;
    debounceTimer = setTimeout(() => renderDropdown(v), 90);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (flatItems.length) setActive((activeIdx + 1) % flatItems.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (flatItems.length) setActive((activeIdx - 1 + flatItems.length) % flatItems.length); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0) pick(activeIdx);
      else openFullSearch(input.value);
    } else if (e.key === 'Escape') { closeDropdown(); input.blur(); }
  });

  input.addEventListener('focus', () => { if (input.value.trim()) renderDropdown(input.value); });

  // Click-away closes the dropdown
  document.addEventListener('mousedown', e => {
    const wrap = document.querySelector('.cmd-search');
    const box = document.getElementById('cmd-search-results');
    if (wrap && !wrap.contains(e.target) && box && !box.contains(e.target)) closeDropdown();
  });

  // Search Results view — tab strip + result rows (delegated; content re-renders)
  const content = document.getElementById('content');
  if (content) content.addEventListener('click', e => {
    const close = e.target.closest('.srt-tab-close');
    if (close) { e.stopPropagation(); closeSearchTab(close.dataset.close); return; }
    const tabEl = e.target.closest('.srt-tab');
    if (tabEl) { activateSearchTab(tabEl.dataset.tabid); return; }
    const printBtn = e.target.closest('[data-printings]');
    if (printBtn) { openPrintingsTab(printBtn.dataset.printings); return; }
    const row = e.target.closest('.srt .sr-row');
    if (row) pickItem(pageItems[Number(row.dataset.idx)]);
  });

  // ⌘K / Ctrl+K focuses search
  document.addEventListener('keydown', e => {
    if (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      input.focus();
      input.select();
    }
  });
}

// ── Search Results view (tabbed) ─────────────────────────────────────────────
let pageItems = [];   // flattened clickable rows in the active tab, for routing

function pushRow(item) { const i = pageItems.length; pageItems.push(item); return i; }

export function renderSearchTab() {
  const s = ensureSearchState();
  if (!s.tabs.length) {
    return `<div class="empty-state" style="padding:48px 24px;text-align:center">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Search Results</div>
      <div style="color:var(--text-muted);font-size:13px">Search from the bar up top and press Enter to open full results here.<br>Open searches stay pinned as tabs so you can compare cards side-by-side.</div>
    </div>`;
  }
  const active = s.tabs.find(t => t.id === s.activeId) || s.tabs[0];
  s.activeId = active.id;
  pageItems = [];
  // Restored-from-disk tabs start idle; kick off their fetch on first view.
  if (active.status === 'idle') setTimeout(() => runTab(active.id), 0);

  const strip = `<div class="srt-strip">${s.tabs.map(t => `
    <div class="srt-tab${t.id === active.id ? ' active' : ''}" data-tabid="${t.id}" title="${esc(t.label)}">
      <span class="srt-tab-kind">${t.kind === 'printings' ? '◇' : '⌕'}</span>
      <span class="srt-tab-label">${esc(t.label)}</span>
      <span class="srt-tab-close" data-close="${t.id}" title="Close tab">✕</span>
    </div>`).join('')}</div>`;

  const body = active.kind === 'printings' ? renderPrintingsBody(active) : renderQueryBody(active);
  return `<div class="srt">${strip}<div class="srt-body">${body}</div></div>`;
}

function loadingHtml(label) {
  return `<div class="sr-loading">Searching ${esc(label)}…</div>`;
}
function errorHtml(msg) {
  return `<div class="sr-page-group"><div class="empty-state" style="padding:24px;color:var(--red)">Search failed: ${esc(msg)}</div></div>`;
}

function sectionHtml(title, count, rowsHtml, note) {
  if (!rowsHtml && !note) return '';
  const head = `<h3 class="sr-page-group-head">${esc(title)}${count != null ? ` <span class="sr-page-count">${count}</span>` : ''}${note ? `<span class="sr-sec-note">${esc(note)}</span>` : ''}</h3>`;
  const body = rowsHtml ? `<div class="sr-page-rows">${rowsHtml}</div>` : '';
  return `<div class="sr-page-group">${head}${body}</div>`;
}

// A collection/SL card row that also offers "View all printings".
function collectionCardRow(item) {
  const idx = pushRow(item);
  const meta = item.owned ? `×${item.qty}${item.prints > 1 ? ` · ${item.prints} printings` : ''}` : esc(item.drop || 'Secret Lair');
  return `<div class="sr-row" data-idx="${idx}">
    ${ownDot(item.owned)}
    <span class="sr-row-name">${esc(item.name)}</span>
    <span class="sr-row-meta">${meta}</span>
    <button class="sr-print-link" data-printings="${esc(item.name)}" title="View all printings">◇ printings</button>
  </div>`;
}

function scryRow(c, ownedIds) {
  const id = (c.id || '').toLowerCase();
  const price = c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched;
  const idx = pushRow({ type: 'scrycard', name: c.name, scryfallId: id });
  return `<div class="sr-row" data-idx="${idx}">
    ${ownDot(ownedIds.has(id))}
    <span class="sr-row-name">${esc(c.name)}</span>
    <span class="sr-row-sub">${esc(c.set_name || '')} · ${esc((c.set || '').toUpperCase())} #${esc(c.collector_number || '?')}</span>
    <span class="sr-row-meta">${price != null ? '$' + price : '—'}</span>
    <button class="sr-print-link" data-printings="${esc(c.name)}" title="View all printings">◇ printings</button>
  </div>`;
}

function sealedCatRow(p) {
  const idx = pushRow({ type: 'sealedcat', name: p.name });
  return `<div class="sr-row" data-idx="${idx}">
    <span class="sr-row-name">${esc(p.name)}</span>
    <span class="sr-row-meta">${p.marketPrice != null ? fmt(p.marketPrice) : '—'}</span>
  </div>`;
}

function printRow(c, ownedIds) {
  const id = (c.id || '').toLowerCase();
  const price = c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched;
  const finishes = (c.finishes || []).join(' / ') || '—';
  const idx = pushRow({ type: 'print', scryfallId: id, name: c.name });
  return `<div class="sr-row" data-idx="${idx}">
    ${ownDot(ownedIds.has(id))}
    <span class="sr-row-name">${esc(c.set_name || '')}</span>
    <span class="sr-row-sub">#${esc(c.collector_number || '?')} · ${esc(finishes)}</span>
    <span class="sr-row-meta">${price != null ? '$' + price : '—'}</span>
  </div>`;
}

function renderQueryBody(tab) {
  let html = `<div class="sr-page"><div class="sr-page-head"><span class="sr-page-q">Results for “${esc(tab.query)}”</span></div>`;
  if (tab.status === 'loading' || tab.status === 'idle') return html + loadingHtml(`“${tab.query}”`) + '</div>';
  if (tab.status === 'error') return html + errorHtml(tab.error) + '</div>';

  const r = tab.results || {};
  const ownedIds = ownedIdSet();

  // Your collection + Secret Lair catalog (offline groups)
  if (r.offline?.totalCount) {
    for (const g of r.offline.groups) {
      const rows = g.items.map(item => (g.key === 'cards') ? collectionCardRow(item) : (pushRow(item), rowHtml(item, pageItems.length - 1))).join('');
      html += sectionHtml(g.label, g.total, rows);
    }
  }

  // Live card catalog (Scryfall)
  const scryRows = (r.scry || []).map(c => scryRow(c, ownedIds)).join('');
  html += sectionHtml('Card Catalog · Scryfall', (r.scry || []).length, scryRows);

  // Live sealed catalog (TCGCSV)
  if (r.sealedLoaded) {
    const sealedRows = (r.sealedCat || []).map(p => sealedCatRow(p)).join('');
    html += sectionHtml('Sealed Catalog · TCGCSV', (r.sealedCat || []).length, sealedRows);
  } else {
    html += sectionHtml('Sealed Catalog · TCGCSV', null, '', 'not loaded — sync from the Sealed tab to search it');
  }

  if (!pageItems.length && !(r.scry || []).length) {
    html += `<div class="empty-state" style="padding:24px">No matches anywhere for “${esc(tab.query)}”.</div>`;
  }
  return html + '</div>';
}

function renderPrintingsBody(tab) {
  let html = `<div class="sr-page"><div class="sr-page-head"><span class="sr-page-q">All printings · ${esc(tab.cardName)}</span></div>`;
  if (tab.status === 'loading' || tab.status === 'idle') return html + loadingHtml(`printings of “${tab.cardName}”`) + '</div>';
  if (tab.status === 'error') return html + errorHtml(tab.error) + '</div>';

  const prints = tab.results?.prints || [];
  if (!prints.length) return html + `<div class="empty-state" style="padding:24px">No printings found.</div></div>`;
  const ownedIds = ownedIdSet();
  const rows = prints.map(c => printRow(c, ownedIds)).join('');
  html += sectionHtml(`${prints.length} printing${prints.length !== 1 ? 's' : ''}`, null, rows);
  return html + '</div>';
}
