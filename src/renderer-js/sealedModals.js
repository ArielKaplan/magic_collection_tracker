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
// <datalist> of all known SL drop names, for linking a sealed product to its drop.
function slDropOptions() {
  const drops = typeof SL_DROP_TO_SUPERDROP !== 'undefined' ? Object.keys(SL_DROP_TO_SUPERDROP) : [];
  return drops.sort().map(d => `<option value="${esc(d)}"></option>`).join('');
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
      <input type="text" id="sl-drop" list="sl-drop-list" autocomplete="off"
        placeholder="e.g. Phyrexian Praetors" value="${esc(prefill.dropName ?? e.dropName ?? '')}">
      <datalist id="sl-drop-list">${slDropOptions()}</datalist>
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

