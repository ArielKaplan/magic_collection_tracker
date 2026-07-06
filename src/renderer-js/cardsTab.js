import { cardCurrentValue, entryRealized } from './analytics.js';
import { CONDITION_FULL, CONDITION_SHORT, FOIL_LABEL, RARITY_ORDER } from './constants.js';
import { showExportModal } from './exportModal.js';
import { hideModal, showModal } from './modals.js';
import { getCurrentMarketPrice, getCurrentPrice, getPriceChange, getPriceHistory, sparkline } from './prices.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, fmtPct, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// CARDS TAB
// ─────────────────────────────────────────────────────────────────────────────
export function renderCards() {
  if (!collection.cards.length) return `
    <div class="empty-state">
      <div class="empty-state-icon">🃏</div>
      <h3>No cards yet</h3>
      <p>Import a ManaBox CSV export to populate your collection.</p>
      <button class="btn btn-primary" id="emptyCsvBtn">↑ Import CSV</button>
    </div>`;

  const allBinders = [...new Set(collection.cards.map(c => c.binderName))].filter(Boolean).sort();
  const langs      = [...new Set(collection.cards.map(c => c.language))].sort();
  const filtered   = filteredCards();
  const isSold     = ui.cards.status === 'sold';
  const isGallery  = ui.cards.view === 'gallery' && !isSold;  // Sold view is always a ledger table
  // Gallery can only show printings that have a Scryfall image; the table shows all.
  const working    = isGallery ? filtered.filter(c => c.scryfallId) : filtered;
  const totalPages = Math.max(1, Math.ceil(working.length / ui.cards.perPage));
  const page       = Math.min(ui.cards.page, totalPages);
  const pageSlice  = working.slice((page - 1) * ui.cards.perPage, page * ui.cards.perPage);

  const filteredValue = filtered.reduce((s, c) => s + (cardCurrentValue(c) ?? 0), 0);
  const filteredQty   = filtered.reduce((s, c) => s + c.quantity, 0);

  const s = ui.cards;
  const cols = s.columns;
  const th = (field, label) => `<th data-sort="${field}" class="${s.sortField === field ? 'sort-' + s.sortDir : ''}">${label}</th>`;
  const cth = (key, field, label) => cols[key] === false ? '' : th(field, label);
  const cthn = (key, label) => cols[key] === false ? '' : `<th>${label}</th>`;

  // Column picker definitions
  const COL_DEFS = [
    { key: 'setCode',       label: 'Set' },
    { key: 'setName',       label: 'Set Name' },
    { key: 'foil',          label: 'Foil' },
    { key: 'rarity',        label: 'Rarity' },
    { key: 'condition',     label: 'Cond' },
    { key: 'language',      label: 'Lang' },
    { key: 'quantity',      label: 'Qty' },
    { key: 'purchasePrice', label: 'Cost' },
    { key: 'currentPrice',  label: 'Low (SCR)' },
    { key: 'marketPrice',   label: 'Mkt (TCG)' },
    { key: 'priceDelta',    label: 'Δ Price' },
    { key: 'trend',         label: 'Trend' },
    { key: 'flags',         label: 'Flags' },
    { key: 'binderName',    label: 'Binder' },
  ];
  const activeColCount = COL_DEFS.filter(d => cols[d.key] !== false).length;

  // View toggle (Table | Gallery) — same data, two presentations, mirroring the
  // SL Explorer's view switcher. Resets to page 1 so the two paginations agree.
  const viewBtn = (id, label) => `<button class="btn ${s.view === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;padding:7px 12px;white-space:nowrap" data-act="ui-set" data-path="cards.view" data-val="${id}" data-also="cards.page=1">${label}</button>`;
  const viewToggle = `<div style="display:flex;gap:4px;margin-right:2px">${viewBtn('table', '▤ Table')}${viewBtn('gallery', '▦ Gallery')}</div>`;

  // Gallery sort bar — the grid has no column headers, so sorting gets its own
  // controls. Writes to the shared ui.cards.sortField/sortDir (filteredCards
  // handles name/collectorNumber/currentPrice/rarity/cmc) so the order carries
  // across both views. Clicking the active field flips the direction.
  const gSort = (field, label) => {
    const active = s.sortField === field;
    const nextDir = active && s.sortDir === 'asc' ? 'desc' : 'asc';
    const arrow = active ? (s.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button class="btn ${active ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;padding:5px 10px" data-act="ui-set" data-path="cards.sortField" data-val="${field}" data-also="cards.sortDir=${nextDir};cards.page=1">${label}${arrow}</button>`;
  };
  const gallerySortBar = `<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
    <span style="font-size:12px;color:var(--text-muted)">Sort:</span>
    ${gSort('name', 'Name')}${gSort('collectorNumber', 'Card #')}${gSort('currentPrice', 'Value')}${gSort('rarity', 'Rarity')}${gSort('cmc', 'CMC')}
  </div>`;

  // Gallery presentation of the same filtered+sorted set (reuses showGalleryModal
  // + the gallery-card styling; cards without a Scryfall id were filtered out above).
  const galleryBody = pageSlice.length
    ? `<div class="gallery-grid">
        ${pageSlice.map(c => {
          const id  = c.scryfallId.toLowerCase();
          const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
          const val = cardCurrentValue(c);
          return `<div class="gallery-card" data-card-id="${esc(c.id)}" data-act="showGalleryModal" data-arg="${esc(c.id)}" title="${esc(c.name)}">
            <img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy" data-imgerr="hide-card">
            ${c.foil !== 'normal' ? `<span class="gallery-foil">${FOIL_LABEL[c.foil]}</span>` : ''}
            ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
          </div>`;
        }).join('')}
      </div>`
    : '<div style="padding:40px;text-align:center;color:var(--text-dim)">No cards match your filters</div>';

  const tableBody = `<div class="table-wrap">
          <table>
            <thead><tr>
              <th></th>
              ${th('name', 'Name')}
              ${cth('setCode', 'setCode', 'Set')}
              ${cthn('setName', 'Set Name')}
              ${cthn('foil', 'Foil')}
              ${cth('rarity', 'rarity', 'Rarity')}
              ${cth('condition', 'condition', 'Cond')}
              ${cthn('language', 'Lang')}
              ${cth('quantity', 'quantity', 'Qty')}
              ${cth('purchasePrice', 'purchasePrice', 'Cost')}
              ${cth('currentPrice', 'currentPrice', 'Low (SCR)')}
              ${cthn('marketPrice', 'Mkt (TCG)')}
              ${cthn('priceDelta', 'Δ Price')}
              ${cthn('trend', 'Trend')}
              ${cthn('flags', 'Flags')}
              ${cthn('binderName', 'Binder')}
            </tr></thead>
            <tbody>
              ${pageSlice.length
                ? pageSlice.map(renderCardRow).join('')
                : '<tr><td colspan="12" style="text-align:center;color:var(--text-dim);padding:40px">No cards match your filters</td></tr>'}
            </tbody>
          </table>
        </div>`;

  // Sold ledger — realized P&L per disposed entry (proceeds − fees − cost).
  const soldTableBody = `<div class="table-wrap">
          <table>
            <thead><tr>
              ${th('name', 'Name')}<th>Set</th><th>Foil</th>
              <th style="text-align:center">Qty</th><th style="text-align:right">Cost</th>
              <th style="text-align:right">Proceeds</th><th style="text-align:right">Fees</th>
              <th style="text-align:right">Net Gain</th><th style="text-align:right">%</th>
              <th style="text-align:right">Sold</th><th>Note</th>
            </tr></thead>
            <tbody>
              ${pageSlice.length
                ? pageSlice.map(renderSoldRow).join('')
                : '<tr><td colspan="11" style="text-align:center;color:var(--text-dim);padding:40px">No sold cards yet. Right-click a card → 💵 Sell / dispose to record a sale.</td></tr>'}
            </tbody>
          </table>
        </div>`;

  // Realized totals across the filtered sold set (whole entries, not just the page).
  const realizedTot = filtered.reduce((a, c) => {
    const r = entryRealized(c);
    a.proceeds += r.proceeds; a.cost += r.cost; a.gain += r.gain; return a;
  }, { proceeds: 0, cost: 0, gain: 0 });
  const gainColor = realizedTot.gain >= 0 ? 'var(--green)' : '#f87171';

  return `
    <button class="binder-toggle-fab" id="binder-toggle-fab" title="Toggle Binders (B)">Binders</button>
    <div class="cards-layout">
      <div class="binder-sidebar">
        <div class="binder-sidebar-title">Binders</div>
        ${[['all', 'All Binders'], ...allBinders.map(b => [b, b])].map(([val, label], i) => {
          const qty = val === 'all'
            ? collection.cards.reduce((s, c) => s + (c.status !== 'sold' ? c.quantity : 0), 0)
            : collection.cards.filter(c => c.status !== 'sold' && c.binderName === val).reduce((s, c) => s + c.quantity, 0);
          const dotColors = ['#c89b3c','#5b9cf6','#3dba6f','#9b7bfa','#f08030','#e05555','#f5c842','#60c8c8','#e87ca0','#7bc85b'];
          const dot = val === 'all' ? '#7a7692' : dotColors[(i - 1) % dotColors.length];
          const binderState = val === 'all'
            ? (s.binder.include.length === 0 && s.binder.exclude.length === 0 ? 'all-active' : '')
            : s.binder.include.includes(val) ? 'include' : s.binder.exclude.includes(val) ? 'exclude' : '';
          const stateIcon = binderState === 'include' ? '<span class="b-state-icon b-inc">✓</span>'
            : binderState === 'exclude' ? '<span class="b-state-icon b-exc">✗</span>' : '';
          const itemClass = `binder-item${binderState === 'all-active' ? ' active' : binderState === 'include' ? ' b-include' : binderState === 'exclude' ? ' b-exclude' : ''}`;
          return `<div class="${itemClass}" data-binder="${esc(val)}">
            <div class="b-dot" style="background:${dot}"></div>
            <span class="b-name" title="${esc(label)}">${esc(label)}</span>
            ${stateIcon}
            <span class="b-count">${qty}</span>
          </div>`;
        }).join('')}
      </div>

      <div>
        <div class="filter-bar">
          <div style="display:flex;gap:6px;align-items:center">
            ${isSold ? '' : viewToggle}
            <input type="text" id="cardSearch" placeholder="Search name, set, type, or oracle text… (Enter to search)" value="${esc(s.search)}" style="flex:1;min-width:200px">
            <button class="btn" id="cardSearchBtn" style="padding:7px 14px;font-size:13px">Search</button>
            ${s.search ? `<button class="btn btn-ghost" id="cardSearchClear" style="padding:7px 10px;font-size:13px" title="Clear search">✕</button>` : ''}
            ${isGallery ? '' : `<div class="col-picker-wrap" style="position:relative">
              <button class="btn${s.colPickerOpen ? ' btn-primary' : ''}" id="colPickerBtn" style="padding:7px 12px;font-size:12px;white-space:nowrap">⊞ Columns${activeColCount < COL_DEFS.length ? ` (${activeColCount})` : ''}</button>
              ${s.colPickerOpen ? `<div class="col-picker-dropdown" id="colPickerDropdown">
                <div class="col-picker-title">Visible Columns</div>
                <div class="col-picker-chips">
                  ${COL_DEFS.map(d => `<button class="col-chip${cols[d.key] !== false ? ' col-chip-on' : ''}" data-col="${esc(d.key)}">${cols[d.key] !== false ? '✓ ' : ''}${esc(d.label)}</button>`).join('')}
                </div>
              </div>` : ''}
            </div>`}
            <button class="btn" data-act="showImportHub" data-arg="cards" style="padding:7px 12px;font-size:12px;white-space:nowrap" title="Import cards from a CSV export">↑ Import</button>
            <button class="btn" data-act="showExportModal" data-arg="cards" style="padding:7px 12px;font-size:12px;white-space:nowrap" title="Export cards to CSV, JSON, Markdown, or text">⤓ Export</button>
          </div>
          <select id="statusFilter" title="Owned cards, cards you've sold, or both">
            <option value="owned" ${s.status === 'owned' ? 'selected' : ''}>Owned</option>
            <option value="sold" ${s.status === 'sold' ? 'selected' : ''}>Sold</option>
            <option value="all" ${s.status === 'all' ? 'selected' : ''}>Owned + Sold</option>
          </select>
          <select id="foilFilter">
            <option value="all" ${s.foil === 'all' ? 'selected' : ''}>All Foil Types</option>
            <option value="normal" ${s.foil === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="foil" ${s.foil === 'foil' ? 'selected' : ''}>Foil</option>
            <option value="etched" ${s.foil === 'etched' ? 'selected' : ''}>Etched</option>
          </select>
          <select id="rarityFilter">
            <option value="all" ${s.rarity === 'all' ? 'selected' : ''}>All Rarities</option>
            <option value="mythic" ${s.rarity === 'mythic' ? 'selected' : ''}>Mythic</option>
            <option value="rare" ${s.rarity === 'rare' ? 'selected' : ''}>Rare</option>
            <option value="uncommon" ${s.rarity === 'uncommon' ? 'selected' : ''}>Uncommon</option>
            <option value="common" ${s.rarity === 'common' ? 'selected' : ''}>Common</option>
          </select>
          <select id="conditionFilter">
            <option value="all" ${s.condition === 'all' ? 'selected' : ''}>All Conditions</option>
            ${Object.entries(CONDITION_SHORT).map(([k, v]) =>
              `<option value="${k}" ${s.condition === k ? 'selected' : ''}>${v} — ${CONDITION_FULL[k]}</option>`
            ).join('')}
          </select>
          <select id="langFilter">
            <option value="all" ${s.language === 'all' ? 'selected' : ''}>All Languages</option>
            ${langs.map(l => `<option value="${l}" ${s.language === l ? 'selected' : ''}>${l.toUpperCase()}</option>`).join('')}
          </select>
        </div>

        <div class="results-info">
          ${isSold
            ? `${filtered.length.toLocaleString()} sold ${filtered.length === 1 ? 'entry' : 'entries'} · ${filteredQty.toLocaleString()} copies · Proceeds: <strong>${fmt(realizedTot.proceeds)}</strong> · Net realized: <strong style="color:${gainColor}">${realizedTot.gain >= 0 ? '+' : ''}${fmt(realizedTot.gain)}</strong>`
            : `${filtered.length.toLocaleString()} entries · ${filteredQty.toLocaleString()} copies · Value: <strong>${fmt(filteredValue)}</strong>${isGallery && working.length !== filtered.length ? ` · <span style="color:var(--text-dim)">${working.length.toLocaleString()} shown</span>` : ''}`}
        </div>

        ${isGallery ? gallerySortBar + galleryBody : (isSold ? soldTableBody : tableBody)}
        ${renderPagination(page, totalPages, working.length)}
      </div>
    </div>`;
}

export function renderCardRow(card) {
  const hist      = getPriceHistory(card.scryfallId, card.foil);
  const curPrice  = getCurrentPrice(card.scryfallId, card.foil);
  const mktPrice  = getCurrentMarketPrice(card.scryfallId, card.foil);
  const change   = getPriceChange(hist);
  const cond     = CONDITION_SHORT[card.condition] || card.condition;
  const foilBadge = card.foil !== 'normal'
    ? `<span class="badge badge-${card.foil}">${FOIL_LABEL[card.foil]}</span>` : '';
  const flags = [
    card.misprint ? '<span class="badge" style="background:rgba(248,113,113,0.15);color:#f87171">Misprint</span>' : '',
    card.altered  ? '<span class="badge" style="background:rgba(96,165,250,0.15);color:#60a5fa">Altered</span>'   : '',
    card.language !== 'en' ? `<span class="badge" style="background:rgba(100,100,100,0.2);color:var(--text-dim)">${card.language.toUpperCase()}</span>` : ''
  ].filter(Boolean).join(' ');
  const changeHtml = change
    ? `<span class="${change.pct >= 0 ? 'price-up' : 'price-down'}">${fmtPct(change.pct)}</span>`
    : '<span style="color:var(--text-dim)">—</span>';
  const cols = ui.cards.columns;
  const col = (key, html) => cols[key] === false ? '' : html;
  return `<tr data-card-id="${esc(card.id)}" class="card-row-hover">
    <td style="padding:0 4px 0 8px"><button class="btn-row-edit" data-card-id="${esc(card.id)}" title="Edit Scryfall ID">✎</button></td>
    <td style="font-weight:500;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(card.name)}">${esc(card.name)}</td>
    ${col('setCode', `<td style="color:var(--text-dim);white-space:nowrap">${esc(card.setCode)} <span style="font-size:11px">#${esc(card.collectorNumber)}</span></td>`)}
    ${col('setName', `<td style="color:var(--text-dim);white-space:nowrap;font-size:11.5px">${esc(card.setName || '—')}</td>`)}
    ${col('foil', `<td>${foilBadge || '<span style="color:var(--text-dim)">—</span>'}</td>`)}
    ${col('rarity', `<td><span class="badge badge-${card.rarity}">${card.rarity}</span></td>`)}
    ${col('condition', `<td style="font-weight:500">${cond}</td>`)}
    ${col('language', `<td style="color:var(--text-dim);font-size:12px">${card.language.toUpperCase()}</td>`)}
    ${col('quantity', `<td style="text-align:center">${card.quantity}</td>`)}
    ${col('purchasePrice', `<td>${fmt(card.purchasePrice)}</td>`)}
    ${col('currentPrice', `<td style="font-weight:600">${curPrice != null ? fmt(curPrice) : '<span style="color:var(--text-dim)">—</span>'}</td>`)}
    ${col('marketPrice', `<td style="font-weight:600;color:var(--text)">${mktPrice != null ? fmt(mktPrice) : '<span style="color:var(--text-dim)">—</span>'}</td>`)}
    ${col('priceDelta', `<td>${changeHtml}</td>`)}
    ${col('trend', `<td>${sparkline(hist)}</td>`)}
    ${col('flags', `<td>${flags}</td>`)}
    ${col('binderName', `<td style="color:var(--text-dim);font-size:11.5px">${esc(card.binderName || '—')}</td>`)}
  </tr>`;
}

// A row in the Sold ledger. The entry carries data-card-id so the global
// right-click dispatch still reaches it (→ "Undo sale" / delete).
export function renderSoldRow(card) {
  const r = entryRealized(card);
  const pct = r.cost > 0 ? (r.gain / r.cost) * 100 : null;
  const gc  = r.gain >= 0 ? 'var(--green)' : '#f87171';
  const foilBadge = card.foil !== 'normal'
    ? `<span class="badge badge-${card.foil}">${FOIL_LABEL[card.foil]}</span>` : '<span style="color:var(--text-dim)">—</span>';
  return `<tr data-card-id="${esc(card.id)}" class="card-row-hover">
    <td style="font-weight:500;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(card.name)}">${esc(card.name)}</td>
    <td style="color:var(--text-dim);white-space:nowrap">${esc(card.setCode)} <span style="font-size:11px">#${esc(card.collectorNumber)}</span></td>
    <td>${foilBadge}</td>
    <td style="text-align:center">${card.quantity}</td>
    <td style="text-align:right;color:var(--text-dim)">${fmt(r.cost)}</td>
    <td style="text-align:right;font-weight:600">${fmt(r.proceeds)}</td>
    <td style="text-align:right;color:var(--text-dim)">${r.fees ? fmt(r.fees) : '—'}</td>
    <td style="text-align:right;font-weight:700;color:${gc}">${r.gain >= 0 ? '+' : ''}${fmt(r.gain)}</td>
    <td style="text-align:right;font-weight:600;color:${gc}">${pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%` : '—'}</td>
    <td style="text-align:right;color:var(--text-dim);white-space:nowrap;font-size:12px">${esc(card.disposedAt || '—')}</td>
    <td style="color:var(--text-dim);font-size:11.5px;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(card.saleNote || '')}">${esc(card.saleNote || '')}</td>
  </tr>`;
}

export function showEditScryfallModal(cardId) {
  const card = collection.cards.find(c => c.id === cardId);
  if (!card) return;
  const scryUrl = card.scryfallId
    ? `https://scryfall.com/card/${(card.setCode || '').toLowerCase()}/${card.collectorNumber || ''}/`
    : null;
  showModal(`
    <h2>Edit Scryfall ID</h2>
    <div style="margin-bottom:18px">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(card.name)}</div>
      <div style="font-size:12px;color:var(--text-dim)">${esc(card.setName)} · ${esc(card.setCode)} #${esc(card.collectorNumber)} · ${FOIL_LABEL[card.foil] || card.foil} · ${esc(card.binderName)}</div>
    </div>
    <div class="form-group">
      <label>Scryfall ID (UUID)</label>
      <input type="text" id="edit-scryfall-id" value="${esc(card.scryfallId || '')}" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" style="font-family:monospace;font-size:13px">
      <div style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5">
        Find the correct ID on Scryfall: search for the card, open it, and copy the UUID from the URL
        (e.g. scryfall.com/card/<em>set</em>/<em>number</em>/<em>name</em> — the ID is in the page source or via the API).
        ${scryUrl ? `<a href="${scryUrl}" target="_blank" style="color:var(--accent)">↗ Open likely Scryfall page</a>` : ''}
      </div>
    </div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn btn-primary" id="save-scryfall-id">Save ID</button>
      <button class="btn btn-ghost" id="cancel-scryfall-edit">Cancel</button>
    </div>
  `);

  document.getElementById('save-scryfall-id').addEventListener('click', () => {
    const newId = document.getElementById('edit-scryfall-id').value.trim();
    if (!newId) { toast('Scryfall ID cannot be empty', 'error'); return; }
    const uuidRx = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRx.test(newId)) { toast('That doesn\'t look like a valid UUID — check the format', 'error'); return; }

    const oldId = card.scryfallId;
    // Update all cards sharing the same scryfallId (same printing, different entries)
    const affected = collection.cards.filter(c => c.scryfallId === oldId && c.foil === card.foil);
    affected.forEach(c => { c.scryfallId = newId; });

    // Also update the one card specifically if it had a blank ID
    if (!oldId) card.scryfallId = newId;

    // Remove stale failed lookup entries for this card
    if (collection.failedLookups) {
      collection.failedLookups = collection.failedLookups.filter(f => f.scryfallId !== oldId || f.foil !== card.foil);
    }

    toast(`Scryfall ID updated${affected.length > 1 ? ` (${affected.length} entries)` : ''}. Run Refresh Prices to fetch new data.`, 'success');
    hideModal();
    render();
    autoSave();
  });

  document.getElementById('cancel-scryfall-edit').addEventListener('click', hideModal);
  document.getElementById('edit-scryfall-id').focus();
  document.getElementById('edit-scryfall-id').select();
}


export function filteredCards() {
  const s = ui.cards;
  let cards = collection.cards;
  // Owned vs. sold. Sold entries stay in the collection for realized P&L but are
  // hidden from the default (Owned) view; the Sold view shows only them.
  const status = s.status || 'owned';
  if (status === 'owned')      cards = cards.filter(c => c.status !== 'sold');
  else if (status === 'sold')  cards = cards.filter(c => c.status === 'sold');
  const binderInc = new Set(s.binder.include || []);
  const binderExc = new Set(s.binder.exclude || []);
  if (binderInc.size > 0) cards = cards.filter(c => binderInc.has(c.binderName || ''));
  if (binderExc.size > 0) cards = cards.filter(c => !binderExc.has(c.binderName || ''));
  if (s.search) {
    const q = s.search.toLowerCase();
    cards = cards.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.setName || '').toLowerCase().includes(q)) return true;
      if ((c.setCode || '').toLowerCase().includes(q)) return true;
      const meta = collection.cardMetadata?.[c.scryfallId];
      if (meta?.type_line?.toLowerCase().includes(q)) return true;
      if (meta?.oracle_text?.toLowerCase().includes(q)) return true;
      return false;
    });
  }
  if (s.foil !== 'all')      cards = cards.filter(c => c.foil === s.foil);
  if (s.rarity !== 'all')    cards = cards.filter(c => c.rarity === s.rarity);
  if (s.condition !== 'all') cards = cards.filter(c => c.condition === s.condition);
  if (s.language !== 'all')  cards = cards.filter(c => c.language === s.language);

  const { sortField, sortDir } = s;
  return [...cards].sort((a, b) => {
    let av, bv;
    if (sortField === 'currentPrice') {
      av = getCurrentPrice(a.scryfallId, a.foil) ?? -Infinity;
      bv = getCurrentPrice(b.scryfallId, b.foil) ?? -Infinity;
    } else if (sortField === 'rarity') {
      av = RARITY_ORDER[a.rarity] ?? 0;
      bv = RARITY_ORDER[b.rarity] ?? 0;
    } else if (sortField === 'collectorNumber') {
      // Numeric collector-number sort (string compare would put "10" before "2").
      av = parseInt(a.collectorNumber, 10) || 0;
      bv = parseInt(b.collectorNumber, 10) || 0;
    } else if (sortField === 'cmc') {
      av = collection.cardMetadata?.[a.scryfallId]?.cmc ?? 999;
      bv = collection.cardMetadata?.[b.scryfallId]?.cmc ?? 999;
    } else if (sortField === 'name') {
      av = a.name.toLowerCase(); bv = b.name.toLowerCase();
    } else {
      av = a[sortField] ?? '';
      bv = b[sortField] ?? '';
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

export function renderPagination(page, totalPages, total) {
  if (totalPages <= 1) return '';
  const start = (page - 1) * ui.cards.perPage + 1;
  const end   = Math.min(page * ui.cards.perPage, total);

  const show = new Set([1, totalPages, page, page - 1, page - 2, page + 1, page + 2]
    .filter(p => p >= 1 && p <= totalPages));
  const sorted = Array.from(show).sort((a, b) => a - b);

  let btns = '', prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) btns += '<span style="color:var(--text-dim);padding:0 3px">…</span>';
    btns += `<button class="page-btn ${p === page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    prev = p;
  }

  return `
    <div class="pagination-row">
      <span class="page-info">Showing ${start}–${end} of ${total.toLocaleString()}</span>
      <div class="pagination">
        <button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>‹</button>
        ${btns}
        <button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>›</button>
      </div>
      <select id="perPageSelect" class="per-page-select">
        ${[25, 50, 100, 200].map(n =>
          `<option value="${n}" ${ui.cards.perPage === n ? 'selected' : ''}>${n} per page</option>`
        ).join('')}
      </select>
    </div>`;
}

