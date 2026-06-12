import { PRODUCT_TYPES } from './constants.js';
import { showExportModal } from './exportModal.js';
import { getCurrentPrice, getPriceChange, sparkline } from './prices.js';
import { collection, tcgcsvCache, ui } from './state.js';
import { esc, fmt, fmtPct } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// SEALED TAB
// ─────────────────────────────────────────────────────────────────────────────
export function renderSealed() {
  const s = ui.sealed;
  const filtered = collection.sealed.filter(item => {
    if (s.search && !item.name.toLowerCase().includes(s.search.toLowerCase())) return false;
    if (s.type !== 'all' && item.productType !== s.type) return false;
    if (s.status !== 'all' && item.status !== s.status) return false;
    return true;
  });

  const totalVal = collection.sealed.reduce((sum, i) => {
    const h = i.priceHistory;
    return sum + (h?.length ? h[h.length - 1].price : i.purchasePrice) * i.quantity;
  }, 0);
  const totalQty = collection.sealed.reduce((s, i) => s + i.quantity, 0);

  return `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:18px">
      <div>
        <h2 style="font-size:20px;font-weight:700">Sealed Product</h2>
        <div style="color:var(--text-dim);font-size:13px;margin-top:4px">
          ${collection.sealed.length} products · ${totalQty} items · Total value: <strong style="color:var(--text)">${fmt(totalVal)}</strong>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <div style="text-align:right">
          <button class="btn btn-sm" id="tcgcsv-sync-btn">↻ Sync Price Data</button>
          <div id="tcgcsv-sync-lbl" style="font-size:11px;color:var(--text-dim);margin-top:3px">
            ${tcgcsvCache.groups ? `${tcgcsvCache.groups.length} groups · synced ${new Date(tcgcsvCache.lastRefresh).toLocaleTimeString()}` : 'Not synced — click to load price data'}
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn" onclick="showExportModal('sealed')" title="Export sealed products to CSV, JSON, Markdown, or text">⤓ Export</button>
          <button class="btn btn-primary" id="addSealedBtn" title="Search the TCGplayer catalog or browse by set">+ Add Product</button>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      <input type="text" id="sealedSearch" placeholder="Search products…" value="${esc(s.search)}">
      <select id="sealedTypeFilter">
        <option value="all" ${s.type === 'all' ? 'selected' : ''}>All Types</option>
        ${PRODUCT_TYPES.map(t => `<option value="${t}" ${s.type === t ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <select id="sealedStatusFilter">
        <option value="all" ${s.status === 'all' ? 'selected' : ''}>All Status</option>
        <option value="sealed" ${s.status === 'sealed' ? 'selected' : ''}>Sealed</option>
        <option value="opened" ${s.status === 'opened' ? 'selected' : ''}>Opened</option>
      </select>
    </div>

    ${filtered.length === 0 ? `
      <div class="empty-state">
        <div class="empty-state-icon">📦</div>
        <h3>${collection.sealed.length === 0 ? 'No sealed products yet' : 'No results'}</h3>
        <p>${collection.sealed.length === 0
          ? 'Track booster boxes, bundles, Secret Lairs, and other sealed products here. Add items to see their value over time.'
          : 'Try adjusting your filters.'}</p>
        ${collection.sealed.length === 0 ? `
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <button class="btn btn-primary" id="addSealedBtn2">🔍 Find a Product</button>
          </div>` : ''}
      </div>
    ` : `<div class="sealed-list">${filtered.map(renderSealedItem).join('')}</div>`}`;
}

export function renderSealedItem(item) {
  const hist       = item.priceHistory || [];
  const curPrice   = hist.length ? hist[hist.length - 1].price : item.purchasePrice;
  const change     = getPriceChange(hist);
  const totalVal   = curPrice * item.quantity;
  const totalCost  = item.purchasePrice * item.quantity;
  const gainLoss   = totalVal - totalCost;
  const gainClass  = gainLoss >= 0 ? 'price-up' : 'price-down';

  return `
    <div class="sealed-item" data-id="${item.id}">
      <div class="sealed-header">
        <div class="sealed-name">${esc(item.name)}</div>
        <div class="sealed-badges">
          <span class="badge badge-type">${esc(item.productType)}</span>
          <span class="badge ${item.status === 'sealed' ? 'badge-sealed' : 'badge-opened'}">
            ${item.status === 'sealed' ? '● Sealed' : '○ Opened'}
          </span>
          ${item.quantity > 1 ? `<span style="color:var(--text-dim);font-size:13px">×${item.quantity}</span>` : ''}
        </div>
      </div>

      <div class="sealed-prices">
        <div class="sealed-price-item">
          <div class="sp-label">Cost Basis</div>
          <div class="sp-value">${fmt(item.purchasePrice)}${item.quantity > 1 ? ` <span style="color:var(--text-dim);font-size:12px">× ${item.quantity} = ${fmt(totalCost)}</span>` : ''}</div>
        </div>
        <div class="sealed-price-item">
          <div class="sp-label">Market Value</div>
          <div class="sp-value">${fmt(curPrice)}${item.quantity > 1 ? ` <span style="color:var(--text-dim);font-size:12px">× ${item.quantity} = ${fmt(totalVal)}</span>` : ''}</div>
        </div>
        <div class="sealed-price-item">
          <div class="sp-label">Gain / Loss</div>
          <div class="sp-value ${gainClass}">${gainLoss >= 0 ? '+' : ''}${fmt(gainLoss)}</div>
        </div>
        ${change ? `
          <div class="sealed-price-item">
            <div class="sp-label">Last Δ</div>
            <div class="sp-value ${change.pct >= 0 ? 'price-up' : 'price-down'}">${fmtPct(change.pct)}</div>
          </div>` : ''}
        <div class="sealed-price-item">
          <div class="sp-label">Trend</div>
          <div>${sparkline(hist)}</div>
        </div>
      </div>

      ${item.notes ? `<div style="margin-top:10px;font-size:12px;color:var(--text-dim);font-style:italic">${esc(item.notes)}</div>` : ''}

      <div class="sealed-actions">
        <button class="btn btn-sm" data-action="edit-sealed" data-id="${item.id}">Edit</button>
        <button class="btn btn-sm" data-action="update-sealed-price" data-id="${item.id}">Update Price</button>
        <button class="btn btn-sm" data-action="toggle-status" data-id="${item.id}">
          ${item.status === 'sealed' ? 'Mark Opened' : 'Mark Sealed'}
        </button>
        ${item.linkedScryfallIds?.length
          ? `<button class="btn btn-sm" data-action="toggle-cards" data-id="${item.id}">Cards (${item.linkedScryfallIds.length})</button>`
          : ''}
        <button class="btn btn-sm btn-danger" data-action="delete-sealed" data-id="${item.id}">Delete</button>
      </div>

      ${item.linkedScryfallIds?.length ? `
        <div class="sealed-cards-section" id="sc-${item.id}">
          <div style="font-size:12px;color:var(--text-dim);font-weight:600;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">
            Cards in this product
          </div>
          <div class="sealed-cards-grid">
            ${item.linkedScryfallIds.map(sid => {
              const card = collection.cards.find(c => c.scryfallId === sid);
              const price = card ? getCurrentPrice(card.scryfallId, card.foil) : null;
              return `<div class="sealed-card-chip">
                <div class="chip-name">${card ? esc(card.name) : `<span style="color:var(--text-dim);font-size:11px">${sid.slice(0,8)}…</span>`}</div>
                ${price != null ? `<div class="chip-price">${fmt(price)}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>` : ''}
    </div>`;
}

