import { FOIL_LABEL } from './constants.js';
import { hideModal, showModal } from './modals.js';
import { getCurrentMarketPrice, getCurrentPrice } from './prices.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, netFetch, toast, uid } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// WANT LIST — cards the user wants to acquire (price-watch shopping list).
// Populated mostly from the Secret Lair Explorer (missing cards / incomplete
// drops). Each item may carry a max_price threshold checked after each refresh.
// ─────────────────────────────────────────────────────────────────────────────

// ── Lookups ────────────────────────────────────────────────────────────────
export function wantItemByScryfall(scryfallId) {
  if (!scryfallId) return null;
  const id = scryfallId.toLowerCase();
  return (collection.wantList || []).find(w => (w.scryfallId || '').toLowerCase() === id) || null;
}
export function isCardWanted(scryfallId) { return !!wantItemByScryfall(scryfallId); }

// Best current price for a wanted card: Scryfall low, else TCG market.
export function wantListCurrentPrice(item) {
  if (!item?.scryfallId) return null;
  const id = item.scryfallId.toLowerCase();
  const low = getCurrentPrice(id, item.foil);
  if (low != null) return low;
  return getCurrentMarketPrice(id, item.foil);
}

// Is this wanted card already owned? (so the list can flag "acquired".)
function isOwned(scryfallId) {
  const id = (scryfallId || '').toLowerCase();
  return !!id && collection.cards.some(c => c.status !== 'sold' && (c.scryfallId || '').toLowerCase() === id);
}

// ── Mutations ────────────────────────────────────────────────────────────────
export function addToWantList(item, opts = {}) {
  if (item.scryfallId && wantItemByScryfall(item.scryfallId)) {
    if (!opts.silent) toast(`${item.name} is already on your want list`, 'info');
    return false;
  }
  collection.wantList.push({
    id: uid(),
    scryfallId: (item.scryfallId || '').toLowerCase(),
    name: item.name || 'Unknown card',
    setCode: item.setCode || '',
    setName: item.setName || '',
    collectorNumber: item.collectorNumber || '',
    foil: item.foil || 'normal',
    dropName: item.dropName || '',
    maxPrice: item.maxPrice ?? null,
    note: item.note || '',
  });
  if (!opts.silent) { render(); autoSave(); toast(`★ Added “${item.name}” to your want list`, 'success'); }
  return true;
}

export function removeFromWantList(id) {
  const it = (collection.wantList || []).find(w => w.id === id);
  collection.wantList = (collection.wantList || []).filter(w => w.id !== id);
  render(); autoSave();
  if (it) toast(`Removed “${it.name}” from want list`, 'info');
}

export function setWantTarget(id, value) {
  const it = (collection.wantList || []).find(w => w.id === id);
  if (!it) return;
  const n = parseFloat(value);
  it.maxPrice = (value === '' || isNaN(n) || n < 0) ? null : n;
  autoSave();
  updateWantBadge();
  // Re-render so the Δ / at-target styling updates immediately.
  render();
}

// SL printing → want item, using the baked SL name/number maps.
export function addSlCardToWantList(scryfallId, opts = {}) {
  const id = (scryfallId || '').toLowerCase();
  const name = (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[id]) || 'Secret Lair card';
  const number = (typeof SL_SCRYFALL_TO_NUMBER !== 'undefined' && SL_SCRYFALL_TO_NUMBER[id]) || '';
  const drops = (typeof SL_SCRYFALL_TO_DROPS !== 'undefined' && SL_SCRYFALL_TO_DROPS[id]) || [];
  return addToWantList({
    scryfallId: id, name, setCode: 'SLD', setName: 'Secret Lair Drop',
    collectorNumber: String(number), foil: 'normal', dropName: opts.dropName || drops[0] || '',
  }, opts);
}

// Context-menu toggle for a missing SL card.
export function toggleSlCardWant(scryfallId) {
  const existing = wantItemByScryfall(scryfallId);
  if (existing) removeFromWantList(existing.id);
  else addSlCardToWantList(scryfallId);
}

// "Add all missing to want list" for a drop — the incomplete-drop shopping list.
export function addDropMissingToWantList(drop) {
  const ids = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined' && SL_DROP_TO_SCRYFALL_IDS[drop]) || [];
  const ownedIds = new Set(collection.cards.filter(c => c.status !== 'sold').map(c => (c.scryfallId || '').toLowerCase()).filter(Boolean));
  let added = 0;
  for (const id of ids) {
    const lid = (id || '').toLowerCase();
    if (ownedIds.has(lid) || wantItemByScryfall(lid)) continue;
    if (addSlCardToWantList(lid, { dropName: drop, silent: true })) added++;
  }
  render(); autoSave();
  toast(added ? `★ Added ${added} missing card${added !== 1 ? 's' : ''} from “${drop}” to your want list`
              : `No new missing cards to add from “${drop}”`, added ? 'success' : 'info');
}

// ── Summary / price-watch ────────────────────────────────────────────────────
export function wantListSummary() {
  const list = collection.wantList || [];
  let acquireCost = 0, priced = 0, atTarget = 0, withTarget = 0;
  for (const w of list) {
    const p = wantListCurrentPrice(w);
    if (p != null) { acquireCost += p; priced++; }
    if (w.maxPrice != null) { withTarget++; if (p != null && p <= w.maxPrice) atTarget++; }
  }
  return { count: list.length, acquireCost, priced, atTarget, withTarget };
}

// Called at the end of a refresh: surface any want-list card now at/under target.
export function checkWantListThresholds() {
  const hits = [];
  for (const w of collection.wantList || []) {
    if (w.maxPrice == null) continue;
    const price = wantListCurrentPrice(w);
    if (price != null && price <= w.maxPrice) hits.push({ ...w, price });
  }
  updateWantBadge();
  if (hits.length) {
    const names = hits.slice(0, 3).map(h => h.name).join(', ');
    toast(`🎯 ${hits.length} want-list card${hits.length !== 1 ? 's' : ''} at/under target: ${names}${hits.length > 3 ? '…' : ''}`, 'success', 9000);
    window.logger?.success('Want list', hits.map(h => `${h.name} ${fmt(h.price)} ≤ ${fmt(h.maxPrice)}`).join(' · '));
  }
  return hits;
}

// Green "deals" badge on the Want List tab — count of items at/under target.
export function updateWantBadge() {
  const tab = document.getElementById('wantlistTab');
  if (!tab) return;
  const { atTarget } = wantListSummary();
  let badge = tab.querySelector('.want-badge');
  if (atTarget > 0) {
    if (!badge) { badge = document.createElement('span'); badge.className = 'want-badge'; tab.appendChild(badge); }
    badge.textContent = atTarget;
    badge.title = `${atTarget} want-list card${atTarget !== 1 ? 's' : ''} at or under your target price`;
  } else if (badge) {
    badge.remove();
  }
}

// ── Manual add via Scryfall name search ──────────────────────────────────────
let _wantSearchTimer = null;
export function showWantSearchModal() {
  showModal(`
    <h2 style="margin:0 0 4px">Add a card to your want list</h2>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:12px">Search Scryfall by card name. Tip: right-click any missing card in the Secret Lair Explorer to add it directly.</div>
    <input type="text" id="want-search-input" placeholder="Card name…" autocomplete="off"
      style="width:100%;padding:8px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:14px;font-family:inherit">
    <div id="want-search-results" style="margin-top:12px;max-height:46vh;overflow-y:auto"></div>`);
  const input = document.getElementById('want-search-input');
  input?.focus();
  input?.addEventListener('input', () => {
    clearTimeout(_wantSearchTimer);
    _wantSearchTimer = setTimeout(() => runWantSearch(input.value.trim()), 320);
  });
}

async function runWantSearch(query) {
  const box = document.getElementById('want-search-results');
  if (!box) return;
  if (query.length < 2) { box.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:6px 0">Type at least two letters…</div>`; return; }
  box.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:6px 0">Searching…</div>`;
  try {
    const resp = await netFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&unique=prints&order=released`);
    if (!resp.ok) { box.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:6px 0">No matches.</div>`; return; }
    const data = await resp.json();
    const cards = (data.data || []).slice(0, 24);
    if (!cards.length) { box.innerHTML = `<div style="color:var(--text-muted);font-size:12px;padding:6px 0">No matches.</div>`; return; }
    box.innerHTML = cards.map(c => {
      const id = (c.id || '').toLowerCase();
      const finish = (c.finishes || []).includes('nonfoil') ? 'normal' : ((c.finishes || []).includes('foil') ? 'foil' : 'normal');
      const price = c.prices?.usd ?? c.prices?.usd_foil ?? c.prices?.usd_etched;
      const wanted = isCardWanted(id);
      const owned  = isOwned(id);
      const payload = esc(JSON.stringify({ scryfallId: id, name: c.name, setCode: (c.set || '').toUpperCase(), setName: c.set_name, collectorNumber: c.collector_number, foil: finish }));
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:7px 4px;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
            <div style="font-size:11px;color:var(--text-muted)">${esc(c.set_name || '')} · ${esc((c.set || '').toUpperCase())} #${esc(c.collector_number || '?')}${price ? ` · $${esc(String(price))}` : ''}</div>
          </div>
          ${owned ? `<span style="font-size:11px;color:var(--green)">✓ Owned</span>`
            : wanted ? `<span style="font-size:11px;color:var(--accent2)">★ On list</span>`
            : `<button class="btn btn-ghost" style="font-size:12px;white-space:nowrap" onclick='addWantFromSearch(${payload}, this)'>★ Want</button>`}
        </div>`;
    }).join('');
  } catch (e) {
    box.innerHTML = `<div style="color:#f87171;font-size:12px;padding:6px 0">Search failed: ${esc(e.message)}</div>`;
  }
}

// Called from the search result buttons (inline onclick).
export function addWantFromSearch(item, btn) {
  if (addToWantList(item)) {
    if (btn) { btn.outerHTML = `<span style="font-size:11px;color:var(--accent2)">★ Added</span>`; }
  }
}

// ── Tab render ───────────────────────────────────────────────────────────────
export function renderWantList() {
  const list = collection.wantList || [];
  const s = ui.wantList;
  const isGallery = s.view === 'gallery';

  if (!list.length) {
    return `
      <div class="empty-state">
        <div class="empty-state-icon">★</div>
        <h3>Your want list is empty</h3>
        <p>Track cards you're hunting and get alerted when they drop to your target price.<br>
        Right-click a missing card (or an incomplete drop) in the <strong>Secret Lair Explorer</strong> to add it here — or search by name.</p>
        <button class="btn btn-primary" onclick="showWantSearchModal()">＋ Add a card</button>
      </div>`;
  }

  const q = (s.search || '').toLowerCase().trim();
  let rows = list.filter(w => !q
    || w.name.toLowerCase().includes(q)
    || (w.dropName || '').toLowerCase().includes(q)
    || (w.setName || '').toLowerCase().includes(q));

  const summary = wantListSummary();

  const rowHtml = (w) => {
    const id = (w.scryfallId || '').toLowerCase();
    const price = wantListCurrentPrice(w);
    const owned = isOwned(id);
    const hasTarget = w.maxPrice != null;
    const atTarget = hasTarget && price != null && price <= w.maxPrice;
    const delta = (hasTarget && price != null) ? price - w.maxPrice : null;
    const thumb = id ? `https://cards.scryfall.io/small/front/${id[0]}/${id[1]}/${id}.jpg` : '';
    return `
      <tr data-want-id="${esc(w.id)}" class="${atTarget ? 'want-hit' : ''}">
        <td style="width:34px">${thumb ? `<img src="${esc(thumb)}" loading="lazy" alt="" style="width:30px;border-radius:3px;display:block" onerror="this.style.display='none'">` : ''}</td>
        <td>
          <a class="bc-link" onclick="showSlViewerModal('${esc(id)}')" style="font-weight:600">${esc(w.name)}</a>
          ${owned ? `<span class="badge" style="background:var(--green-dim);color:var(--green);margin-left:6px">✓ owned</span>` : ''}
          ${w.foil && w.foil !== 'normal' ? `<span class="badge badge-${esc(w.foil)}" style="margin-left:6px">${esc(FOIL_LABEL[w.foil] || w.foil)}</span>` : ''}
        </td>
        <td style="color:var(--text-muted);font-size:12px">${esc(w.dropName || w.setName || (w.setCode || '').toUpperCase() || '—')}</td>
        <td style="text-align:right;font-weight:600;color:var(--text)">${price != null ? fmt(price) : '<span style="color:var(--text-muted)">—</span>'}</td>
        <td style="text-align:right">
          <span style="color:var(--text-muted);font-size:12px">$</span><input type="number" min="0" step="0.01" value="${w.maxPrice ?? ''}" placeholder="—"
            onchange="setWantTarget('${esc(w.id)}', this.value)"
            style="width:64px;padding:3px 6px;background:var(--surface2);border:1px solid var(--border);border-radius:5px;color:var(--text);font-size:12px;text-align:right;font-family:inherit">
        </td>
        <td style="text-align:right;font-weight:700;color:${atTarget ? 'var(--green)' : (delta != null ? 'var(--text-muted)' : 'var(--text-muted)')}">
          ${atTarget ? '🎯 hit' : (delta != null ? `+${fmt(delta)}` : '—')}
        </td>
        <td style="text-align:center"><button class="btn btn-ghost" style="font-size:12px;padding:2px 8px" onclick="removeFromWantList('${esc(w.id)}')" title="Remove from want list">✕</button></td>
      </tr>`;
  };

  // Optional grouping by drop (nice for SL shopping lists).
  let body;
  if (s.groupByDrop) {
    const groups = new Map();
    for (const w of rows) {
      const key = w.dropName || 'Other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    body = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([drop, items]) => `
      <tr class="want-group"><td colspan="7" style="padding:10px 8px 4px;font-weight:700;color:var(--text);background:var(--surface)">${esc(drop)} <span style="color:var(--text-muted);font-weight:400;font-size:12px">· ${items.length} card${items.length !== 1 ? 's' : ''}</span></td></tr>
      ${items.map(rowHtml).join('')}`).join('');
  } else {
    body = rows.map(rowHtml).join('');
  }

  const groupBtn = `<button class="btn ${s.groupByDrop ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px" onclick="ui.wantList.groupByDrop=!ui.wantList.groupByDrop;render()">Group by drop</button>`;
  const viewBtn = (id, label) => `<button class="btn ${s.view === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;padding:6px 11px;white-space:nowrap" onclick="ui.wantList.view='${id}';render()">${label}</button>`;
  const viewToggle = `<div style="display:flex;gap:4px">${viewBtn('table', '▤ Table')}${viewBtn('gallery', '▦ Gallery')}</div>`;

  // Gallery presentation — image grid; click opens the card modal (which has the
  // ★ want toggle). At-target cards get a gold ring + 🎯 badge.
  const galleryTiles = rows.map(w => {
    const id = (w.scryfallId || '').toLowerCase();
    const img = id ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg` : '';
    const price = wantListCurrentPrice(w);
    const atTarget = w.maxPrice != null && price != null && price <= w.maxPrice;
    return `<div class="gallery-card${atTarget ? ' sl-card-wanted' : ''}" onclick="showSlViewerModal('${esc(id)}')" title="${esc(w.name)}${w.maxPrice != null ? ` · target ${fmt(w.maxPrice)}` : ''}">
      ${img ? `<img src="${esc(img)}" alt="${esc(w.name)}" loading="lazy" onerror="this.closest('.gallery-card').style.display='none'">` : ''}
      ${atTarget ? `<span class="sl-want-badge" style="background:rgba(123,216,159,.95);color:#0c2a18">🎯</span>` : ''}
      ${price != null ? `<span class="gallery-price">${fmt(price)}</span>` : ''}
    </div>`;
  }).join('');

  const galleryBody = `<div style="flex:1;overflow-y:auto">
    ${rows.length ? `<div class="gallery-grid">${galleryTiles}</div>` : `<div style="padding:24px;text-align:center;color:var(--text-muted)">No cards match “${esc(s.search)}”.</div>`}
  </div>`;

  const tableBody = `<div class="table-wrap" style="flex:1;overflow-y:auto">
    <table>
      <thead><tr>
        <th></th><th>Card</th><th>Drop / Set</th>
        <th style="text-align:right">Current</th><th style="text-align:right">Target</th>
        <th style="text-align:right">vs. Target</th><th></th>
      </tr></thead>
      <tbody>${body || `<tr><td colspan="7" style="padding:24px;text-align:center;color:var(--text-muted)">No cards match “${esc(s.search)}”.</td></tr>`}</tbody>
    </table>
  </div>`;

  return `
    <div style="padding:16px 18px;height:100%;display:flex;flex-direction:column">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px">
        <h2 style="margin:0;font-size:18px">★ Want List</h2>
        <span style="color:var(--text-muted);font-size:13px">
          ${summary.count} card${summary.count !== 1 ? 's' : ''} · ${fmt(summary.acquireCost)} to acquire${summary.withTarget ? ` · <span style="color:var(--green);font-weight:600">${summary.atTarget}/${summary.withTarget} at target</span>` : ''}
        </span>
        <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
          ${viewToggle}
          <input type="text" id="wantSearchInput" placeholder="Search…" value="${esc(s.search || '')}"
            oninput="ui.wantList.search=this.value;render();setTimeout(()=>{const el=document.getElementById('wantSearchInput');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length)}},0)"
            style="padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
          ${isGallery ? '' : groupBtn}
          <button class="btn btn-primary" style="font-size:12px" onclick="showWantSearchModal()">＋ Add card</button>
        </div>
      </div>
      ${isGallery ? galleryBody : tableBody}
    </div>`;
}
