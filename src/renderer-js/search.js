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
import { collection, ui } from './state.js';
import { esc, escJs, fmt } from './utils.js';

const CAP = 5;   // results shown per group in the dropdown before "See all"

const norm = s => (s == null ? '' : String(s)).toLowerCase().trim();

// Every term must appear somewhere in the concatenated fields (AND match).
function makeMatcher(query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  return (...fields) => {
    if (!terms.length) return false;
    const hay = norm(fields.filter(Boolean).join('  '));
    return terms.every(t => hay.includes(t));
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

// Phase B will build the tabbed, live-catalog Search Results view. For now this
// routes to the (scaffolded) 'search' tab carrying the query.
export function openFullSearch(query) {
  closeDropdown();
  const q = (query || '').trim();
  if (!q) return;
  ui.search = ui.search || { query: '' };
  ui.search.query = q;
  goToTab('search');
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

  // Full-results page rows (delegated — content is re-rendered by render())
  const content = document.getElementById('content');
  if (content) content.addEventListener('click', e => {
    const row = e.target.closest('.sr-page .sr-row');
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

// ── Search Results tab (Phase A scaffold; Phase B = tabbed + live catalogs) ───
export function renderSearchTab() {
  const q = ui.search?.query || '';
  if (!q) {
    return `<div class="empty-state" style="padding:48px 24px;text-align:center">
      <div style="font-size:15px;font-weight:700;margin-bottom:6px">Search Results</div>
      <div style="color:var(--text-muted);font-size:13px">Search from the bar up top and press Enter to open full results here.</div>
    </div>`;
  }
  const res = quickSearch(q, Infinity);   // uncapped for the full page
  pageItems = [];
  let html = `<div class="sr-page">
    <div class="sr-page-head"><span class="sr-page-q">Results for “${esc(q)}”</span>
    <span class="sr-page-note">Full catalog search is coming in the next update — showing your collection + Secret Lair matches for now.</span></div>`;
  if (!res || !res.totalCount) {
    html += `<div class="empty-state" style="padding:32px">No matches in your collection or the Secret Lair catalog.</div></div>`;
    return html;
  }
  for (const g of res.groups) {
    html += `<div class="sr-page-group"><h3 class="sr-page-group-head">${esc(g.label)} <span class="sr-page-count">${g.total}</span></h3><div class="sr-page-rows">`;
    for (const item of g.items) { html += rowHtml(item, pageItems.length); pageItems.push(item); }
    html += `</div></div>`;
  }
  html += '</div>';
  return html;
}

let pageItems = [];   // flattened items on the full-results page, for click routing
