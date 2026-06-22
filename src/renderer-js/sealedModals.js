import { PRODUCT_TYPES } from './constants.js';
import { hideModal, showModal } from './modals.js';
import { showProductPicker } from './productPicker.js';
import { render } from './render.js';
import { fetchPriceChartingById, searchSealedPrice } from './sealedPricing.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, toast, today, uid } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// ADD / EDIT SEALED MODAL
// ─────────────────────────────────────────────────────────────────────────────
// ── Secret Lair drop search ──────────────────────────────────────────────────
// Powers the typeahead used to link a sealed product to its drop for P&L. Baked
// drop names (secretlair.js) use curly quotes and en-dashes, so both the query
// and the candidates are normalized before matching — otherwise typing
// "Li'l Walkers" would never find "Li’l Walkers".
function _slNorm(s) {
  return (s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip diacritics
    .replace(/['’‘‛`´]/g, '')         // drop apostrophes so "li'l" → "lil"
    .replace(/[^a-z0-9]+/g, ' ')                          // other punctuation → space
    .trim();
}

function _slDropEntries() {
  // Union of every known drop name: the curated grouping (SL_DROP_TO_SUPERDROP)
  // plus drop→cards (SL_DROP_CARDS), which can contain drops that have cards but
  // no superdrop yet — searching only the former silently hid those.
  const supers = (typeof SL_DROP_TO_SUPERDROP !== 'undefined' && SL_DROP_TO_SUPERDROP) || {};
  const cards  = (typeof SL_DROP_CARDS !== 'undefined' && SL_DROP_CARDS) || {};
  const names  = new Set([...Object.keys(supers), ...Object.keys(cards)]);
  // Collapse near-duplicates that differ only in punctuation/casing — e.g. a
  // curated "Horizon: Into the Forbidden West Foil" vs a punctuation-stripped
  // "Horizon Into the Forbidden West Foil" left over from an earlier data shape —
  // keeping the most canonical spelling. Foil vs non-foil stay distinct because
  // the finish is part of the key.
  const byKey = new Map();
  for (const drop of names) {
    const e = {
      drop,
      superdrop: supers[drop]?.superdrop || 'Standalone',
      date: supers[drop]?.date || '',
      norm: _slNorm(drop),
    };
    const key = drop.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const cur = byKey.get(key);
    if (!cur || _slDropScore(e) > _slDropScore(cur)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

// Higher = more canonical: a real superdrop and a date beat "Recent Additions"/
// "Standalone", and richer punctuation (the curated spelling) breaks ties.
function _slDropScore(e) {
  let s = 0;
  if (e.superdrop && e.superdrop !== 'Recent Additions' && e.superdrop !== 'Standalone') s += 100;
  if (e.date) s += 10;
  s += (e.drop.match(/[^A-Za-z0-9\s]/g) || []).length;
  return s;
}

// Rank: exact > prefix > word-start > substring > all-tokens-present. An empty
// query returns the most recent drops so focusing the field is still useful.
export function searchSlDrops(query, limit = 8) {
  const entries = _slDropEntries();
  const q = _slNorm(query);
  if (!q) {
    return entries.sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, limit);
  }
  const tokens = q.split(' ').filter(Boolean);
  const scored = [];
  for (const e of entries) {
    if (!e.norm) continue;
    let score;
    if (e.norm === q) score = 100;
    else if (e.norm.startsWith(q)) score = 80;
    else if ((' ' + e.norm).includes(' ' + q)) score = 70;
    else if (e.norm.includes(q)) score = 55;
    else if (tokens.every(t => e.norm.includes(t))) score = 40;
    else continue;
    score += Math.max(0, 10 - e.norm.length / 8);        // gently favor tighter matches
    scored.push({ e, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.e.date || '').localeCompare(a.e.date || ''));
  return scored.slice(0, limit).map(s => s.e);
}

// Best-guess query from a product name, e.g.
// "Secret Lair Drop: Oishii! Tokens - Rainbow Foil Edition" → "Oishii! Tokens".
export function dropQueryFromProductName(name) {
  let s = (name || '').replace(/^\s*secret lair(?:\s+drop)?\s*:?\s*/i, '');
  s = s.split(/\s[-–—:]\s/)[0];
  return s.trim();
}

export function showAddSealedModal(editId = null, prefill = {}) {
  const ex = editId ? collection.sealed.find(i => i.id === editId) : null;
  const e  = ex || {};
  const lastPrice = prefill.price ?? (e.priceHistory?.length ? e.priceHistory[e.priceHistory.length - 1].price : '');
  const typePre = prefill.productType
    ?? e.productType
    ?? (/secret lair/i.test(`${prefill.setName || ''} ${prefill.name || ''}`) ? 'Secret Lair' : null);
  const statusPre = prefill.status ?? e.status;

  showModal(`
    <h2>${ex ? 'Edit' : 'Add'} Sealed Product</h2>
    <div class="form-group">
      <label>Product Name *</label>
      <input type="text" id="sl-name" placeholder="e.g. Secret Lair: Artist Series – Sidharth Chaturvedi" value="${esc(prefill.name || e.name || '')}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Type *</label>
        <select id="sl-type">
          ${PRODUCT_TYPES.map(t => `<option value="${t}" ${typePre === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="sl-status">
          <option value="sealed" ${statusPre !== 'opened' ? 'selected' : ''}>Sealed</option>
          <option value="opened" ${statusPre === 'opened' ? 'selected' : ''}>Opened</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="sl-qty" min="1" value="${prefill.qty ?? e.quantity ?? 1}">
      </div>
      <div class="form-group">
        <label>Purchase Price (USD)</label>
        <input type="number" id="sl-cost" step="0.01" min="0" placeholder="0.00" value="${prefill.cost ?? e.purchasePrice ?? ''}">
      </div>
    </div>
    <div class="form-group">
      <label>Current Market Price (USD)</label>
      <input type="number" id="sl-price" step="0.01" min="0" placeholder="Auto-filled from the catalog, or enter manually" value="${lastPrice}">
    </div>
    <div class="form-group">
      <label>Market Price Lookup</label>
      <div class="pp-linkrow">
        <span class="pp-linkinfo" title="${esc(prefill.linkedName || '')}">${prefill.linkedName
          ? `🔗 ${esc(prefill.linkedName)}`
          : 'Find this product in the TCGplayer catalog to auto-fill the price.'}</span>
        <button class="btn btn-sm" id="sl-find-btn" type="button">🔍 Search catalog</button>
      </div>
    </div>
    <div class="form-group">
      <label>Secret Lair Drop <span style="color:var(--text-muted);font-weight:400">(optional — links this product to a drop for P&amp;L)</span></label>
      <input type="text" id="sl-drop" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false"
        placeholder="Search Secret Lair drops…" value="${esc(prefill.dropName ?? e.dropName ?? '')}">
      <div id="sl-drop-results" class="tcg-results" style="display:none;margin-top:6px"></div>
      <div id="sl-drop-hint" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="sl-notes" rows="2" placeholder="Optional notes…">${esc(prefill.notes ?? e.notes ?? '')}</textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="sl-cancel">Cancel</button>
      <button class="btn btn-primary" id="sl-save">Save Product</button>
    </div>`);

  document.getElementById('sl-cancel').addEventListener('click', hideModal);

  let _addSelectedPcId = prefill.pcId ?? ex?.pricechartingId ?? null;

  // Catalog lookup — captures the current form state, opens the full-size
  // product picker, and reopens this form with the selection applied.
  document.getElementById('sl-find-btn').addEventListener('click', () => {
    const captured = {
      name:        document.getElementById('sl-name').value.trim(),
      productType: document.getElementById('sl-type').value,
      status:      document.getElementById('sl-status').value,
      qty:         parseInt(document.getElementById('sl-qty').value) || 1,
      cost:        document.getElementById('sl-cost').value,
      price:       parseFloat(document.getElementById('sl-price').value) || null,
      notes:       document.getElementById('sl-notes').value,
      dropName:    document.getElementById('sl-drop').value.trim(),
      pcId:        _addSelectedPcId,
      linkedName:  prefill.linkedName || null,
    };
    showProductPicker({
      title: 'Search Product Catalog',
      initialQuery: captured.name,
      onPick: sel => showAddSealedModal(editId, {
        ...captured,
        name:       captured.name || sel.name,
        price:      sel.price ?? captured.price,
        pcId:       sel.pcId || null,
        linkedName: sel.name,
        setName:    sel.setName,
      }),
      onManual: () => showAddSealedModal(editId, captured),
    });
  });

  // ── Secret Lair drop typeahead ────────────────────────────────────────────
  const dropInput   = document.getElementById('sl-drop');
  const dropResults = document.getElementById('sl-drop-results');
  const dropHint    = document.getElementById('sl-drop-hint');
  const dropReady   = typeof SL_DROP_TO_SUPERDROP !== 'undefined'
                      && Object.keys(SL_DROP_TO_SUPERDROP || {}).length > 0;
  let dropMatches = [];
  let dropSel = -1;

  dropHint.innerHTML = dropReady
    ? 'Type to search, or focus the field to see drops matching this product. Newer drops appear after a Secret Lair data refresh.'
    : 'Secret Lair data isn’t loaded yet — open the <strong>Secret Lair Explorer</strong> tab once to enable drop search. You can still type a drop name manually.';

  const closeDrop = () => { dropResults.style.display = 'none'; dropInput.setAttribute('aria-expanded', 'false'); dropSel = -1; };

  const highlightDrop = () => {
    dropResults.querySelectorAll('.tcg-result-item').forEach((el, i) =>
      el.classList.toggle('selected', i === dropSel));
    dropResults.querySelector('.tcg-result-item.selected')?.scrollIntoView({ block: 'nearest' });
  };

  const refreshLatestDrops = async btn => {
    if (typeof refreshSlData !== 'function') return;
    btn.disabled = true; btn.textContent = '↻ Loading latest drops…';
    try { await refreshSlData(); } catch { /* refreshSlData toasts its own errors */ }
    // The fetch is slow; bail if the form was closed meanwhile.
    if (dropResults.isConnected) refreshDrop();   // re-search against fresh data
  };

  const renderDrop = matches => {
    dropMatches = matches;
    if (!matches.length) {
      const typed = dropInput.value.trim();
      dropResults.innerHTML = `
        <div class="tcg-no-results">
          <div>No matching drops${typed ? ` for “${esc(typed)}”` : ''}. Recent drops may not be loaded yet.</div>
          <div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button class="btn btn-sm" id="sl-drop-refresh" type="button">↻ Load latest Secret Lair drops</button>
            <span style="color:var(--text-muted)">or press Enter to keep what you typed.</span>
          </div>
        </div>`;
      dropResults.querySelector('#sl-drop-refresh')?.addEventListener('mousedown', ev => {
        ev.preventDefault();                 // keep input focus
        refreshLatestDrops(ev.currentTarget);
      });
    } else {
      dropResults.innerHTML = matches.map((m, i) => `
        <div class="tcg-result-item${i === dropSel ? ' selected' : ''}" data-drop="${esc(m.drop)}">
          <div class="tcg-result-name">${esc(m.drop)}</div>
          <div class="tcg-result-meta">
            <span class="tcg-result-console">${esc(m.superdrop || 'Secret Lair')}</span>
            <span>${esc(m.date || '')}</span>
          </div>
        </div>`).join('');
      dropResults.querySelectorAll('.tcg-result-item').forEach(el => {
        el.addEventListener('mousedown', ev => {
          ev.preventDefault();                 // keep focus, beat the blur-close
          dropInput.value = el.dataset.drop;
          closeDrop();
        });
      });
    }
    dropResults.style.display = 'block';
    dropInput.setAttribute('aria-expanded', 'true');
  };

  const refreshDrop = () => {
    if (!dropReady) return;
    const typed = dropInput.value.trim();
    dropSel = -1;
    if (typed) { renderDrop(searchSlDrops(typed, 8)); return; }
    // Empty field: surface drops that match this product's name first, else recent.
    const guess  = dropQueryFromProductName(document.getElementById('sl-name')?.value || '');
    const byName = guess ? searchSlDrops(guess, 8) : [];
    renderDrop(byName.length ? byName : searchSlDrops('', 8));
  };

  dropInput.addEventListener('input', refreshDrop);
  dropInput.addEventListener('focus', refreshDrop);
  dropInput.addEventListener('blur', () => setTimeout(closeDrop, 150));
  dropInput.addEventListener('keydown', ev => {
    if (dropResults.style.display === 'none' || !dropMatches.length) {
      if (ev.key === 'Escape') closeDrop();
      return;
    }
    if (ev.key === 'ArrowDown')    { ev.preventDefault(); dropSel = Math.min(dropSel + 1, dropMatches.length - 1); highlightDrop(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); dropSel = Math.max(dropSel - 1, 0); highlightDrop(); }
    else if (ev.key === 'Enter' && dropSel >= 0) { ev.preventDefault(); dropInput.value = dropMatches[dropSel].drop; closeDrop(); }
    else if (ev.key === 'Escape')  { closeDrop(); }
  });

  document.getElementById('sl-save').addEventListener('click', () => {
    const name = document.getElementById('sl-name').value.trim();
    if (!name) { toast('Product name is required', 'error'); return; }
    const curPrice = parseFloat(document.getElementById('sl-price').value);
    const t = today();

    const product = {
      id: editId || uid(),
      name,
      productType: document.getElementById('sl-type').value,
      status: document.getElementById('sl-status').value,
      quantity: Math.max(1, parseInt(document.getElementById('sl-qty').value) || 1),
      purchasePrice: parseFloat(document.getElementById('sl-cost').value) || 0,
      purchasePriceCurrency: 'USD',
      dateAdded: ex?.dateAdded || t,
      notes: document.getElementById('sl-notes').value.trim(),
      dropName: document.getElementById('sl-drop').value.trim(),
      pricechartingId: _addSelectedPcId,
      linkedScryfallIds: ex?.linkedScryfallIds || [],
      priceHistory: ex?.priceHistory || []
    };

    if (!isNaN(curPrice) && curPrice > 0) {
      const last = product.priceHistory[product.priceHistory.length - 1];
      if (!last || last.price !== curPrice) {
        product.priceHistory.push({ date: t, price: curPrice, source: 'manual' });
      }
    }

    if (editId) {
      const idx = collection.sealed.findIndex(i => i.id === editId);
      if (idx >= 0) collection.sealed[idx] = product;
    } else {
      collection.sealed.push(product);
    }

    hideModal();
    render();
    autoSave();
    toast(editId ? 'Product updated!' : 'Product added!', 'success');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE SEALED PRICE MODAL
// ─────────────────────────────────────────────────────────────────────────────
export function showUpdatePriceModal(id) {
  const item = collection.sealed.find(i => i.id === id);
  if (!item) return;
  const hist = item.priceHistory || [];

  showModal(`
    <h2>Update Price</h2>
    <div style="font-size:15px;font-weight:600;margin-bottom:16px">${esc(item.name)}</div>
    <div class="form-group">
      <label>New Market Price (USD)</label>
      <input type="number" id="up-price" step="0.01" min="0" placeholder="0.00">
    </div>
    ${item.pricechartingId ? `
    <div class="form-group">
      <button class="btn" id="up-fetch" style="width:100%">↻ Fetch Current Market Price</button>
    </div>` : ''}
    <div class="form-group">
      <label style="color:var(--text-dim)">Search to find / re-link a product</label>
      <div style="display:flex;gap:6px">
        <input type="text" id="up-tcg-query" placeholder="${esc(item.name)}" style="flex:1" value="">
        <button class="btn" id="up-tcg-btn" style="white-space:nowrap">Search</button>
      </div>
      <div id="up-tcg-results" class="tcg-results" style="display:none"></div>
    </div>
    <div style="margin-top:14px">
      <div style="font-size:11px;color:var(--text-dim);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Price History</div>
      ${hist.length === 0
        ? '<p style="color:var(--text-dim);font-size:13px">No history yet.</p>'
        : hist.slice().reverse().slice(0, 15).map(h => `
            <div class="price-history-row">
              <span style="color:var(--text-dim)">${h.date}</span>
              <span style="font-weight:600">${fmt(h.price)}</span>
              <span style="color:var(--text-dim);font-size:11px">${h.source || 'manual'}</span>
            </div>`).join('')}
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="up-cancel">Cancel</button>
      <button class="btn btn-primary" id="up-save">Save Price</button>
    </div>`);

  document.getElementById('up-cancel').addEventListener('click', hideModal);

  let _upSelectedPcId = item.pricechartingId || null;

  if (item.pricechartingId) {
    document.getElementById('up-fetch').addEventListener('click', async () => {
      const btn = document.getElementById('up-fetch');
      btn.textContent = 'Fetching…'; btn.disabled = true;
      try {
        const price = await fetchPriceChartingById(item.pricechartingId);
        if (price != null) { document.getElementById('up-price').value = price.toFixed(2); toast(`Market price: ${fmt(price)}`, 'success'); }
        else toast('No price returned for this product', 'error');
      } catch (err) { toast('Fetch error: ' + err.message, 'error'); }
      finally { btn.textContent = '↻ Fetch Current Market Price'; btn.disabled = false; }
    });
  }

  document.getElementById('up-tcg-btn').addEventListener('click', async () => {
    const query = (document.getElementById('up-tcg-query').value || item.name).trim();
    const btn = document.getElementById('up-tcg-btn');
    const resultsEl = document.getElementById('up-tcg-results');
    btn.textContent = 'Searching…'; btn.disabled = true;
    try {
      const results = await searchSealedPrice(query);
      if (!results.length) {
        resultsEl.innerHTML = '<div class="tcg-no-results">No results found — try a different search term.</div>';
      } else {
        resultsEl.innerHTML = results.map(r => `
          <div class="tcg-result-item" data-id="${esc(r.id)}" data-price="${r.marketPrice}" data-source="${esc(r.source)}">
            <div class="tcg-result-name">${esc(r.name)}</div>
            <div class="tcg-result-meta">
              <span class="tcg-result-console">${esc(r.consoleName)}</span>
              <span class="tcg-result-price">${fmt(r.marketPrice)} <span class="tcg-price-label">${r.priceLabel || r.source}</span></span>
            </div>
          </div>`).join('');
        resultsEl.querySelectorAll('.tcg-result-item').forEach(el => {
          el.addEventListener('click', () => {
            const price = parseFloat(el.dataset.price);
            _upSelectedPcId = el.dataset.source === 'pricecharting' ? el.dataset.id : null;
            document.getElementById('up-price').value = price.toFixed(2);
            resultsEl.querySelectorAll('.tcg-result-item').forEach(x => x.classList.remove('selected'));
            el.classList.add('selected');
          });
        });
      }
      resultsEl.style.display = 'block';
    } catch (err) { toast('Search error: ' + err.message, 'error'); }
    finally { btn.textContent = 'Search'; btn.disabled = false; }
  });

  document.getElementById('up-save').addEventListener('click', () => {
    const price = parseFloat(document.getElementById('up-price').value);
    if (isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); return; }
    if (!item.priceHistory) item.priceHistory = [];
    const t = today();
    const ti = item.priceHistory.findIndex(h => h.date === t);
    const source = _upSelectedPcId ? 'tcgplayer' : 'manual';
    const entry = { date: t, price, source };
    if (ti >= 0) item.priceHistory[ti] = entry;
    else item.priceHistory.push(entry);
    if (_upSelectedPcId) item.pricechartingId = _upSelectedPcId;
    hideModal();
    render();
    autoSave();
    toast('Price updated!', 'success');
  });
}

