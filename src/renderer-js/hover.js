import { cardCurrentValue } from './analytics.js';
import { showEditScryfallModal } from './cardsTab.js';
import { CONDITION_FULL, FOIL_LABEL } from './constants.js';
import { showDeckExportModal } from './deckIO.js';
import { deckById, deckFormat, deckOwnedMaps, deleteDeck, renderDeckTile, showDeckAddCardModal, showNewDeckModal } from './decks.js';
import { showGalleryModal } from './gallery.js';
import { showImportHub } from './importWizard.js';
import { promptText, showSellSealedModal, undoSealedSale } from './modals.js';
import { openAddProductFlow } from './productPicker.js';
import { render } from './render.js';
import { showAddSealedModal, showUpdatePriceModal } from './sealedModals.js';
import { refreshTcgcsvCache } from './sealedPricing.js';
import { showSlViewerModal } from './slTab.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, netFetch, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS (re-attached after each render)
// ─────────────────────────────────────────────────────────────────────────────
// ── Card hover preview ─────────────────────────────────────────────────────
export let _hoverShowTimer = null;

// Monotonic token: bumped every time the preview's contents change (any path).
// An in-flight async upgrade (SL unowned-card Scryfall fetch) only applies if its
// captured token still matches — otherwise the user has since moved to another
// card (or the grid re-rendered) and the stale result is dropped.
let _hoverToken = 0;

export function findCollectionCardById(id) {
  return collection.cards.find(c => c.id === id);
}

export function buildCardHoverHtml(card) {
  if (!card) return '';
  const id = (card.scryfallId || '').toLowerCase();
  const img = id ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg` : '';
  const meta = collection.cardMetadata?.[card.scryfallId];
  const oracle = meta?.oracle_text || '';
  const typeLine = meta?.type_line || '';
  const price = cardCurrentValue(card);
  const foilBadge = card.foil && card.foil !== 'normal'
    ? `<span class="badge badge-${card.foil}" style="font-size:9.5px;padding:1px 5px;border-radius:99px;margin-left:4px">${FOIL_LABEL[card.foil] || card.foil}</span>`
    : '';

  return `
    ${img ? `<img class="chp-img" src="${esc(img)}" alt="${esc(card.name)}" onerror="this.style.display='none'">` : ''}
    <div class="chp-name">${esc(card.name)}${foilBadge}</div>
    <div class="chp-sub">${esc(card.setName || '')} · ${esc((card.setCode||'').toUpperCase())} · #${esc(card.collectorNumber || '?')}</div>
    ${price != null ? `<div class="chp-price">${fmt(price)}</div>` : ''}
    <div class="chp-grid">
      ${typeLine ? `<span class="lbl">Type</span><span>${esc(typeLine)}</span>` : ''}
      <span class="lbl">Rarity</span><span style="text-transform:capitalize">${esc(card.rarity || '—')}</span>
      <span class="lbl">Binder</span><span>${esc(card.binderName || '—')}</span>
      <span class="lbl">Condition</span><span>${esc((CONDITION_FULL[card.condition] || card.condition || '—'))}</span>
      <span class="lbl">Qty</span><span>${card.quantity || 1}</span>
    </div>
    ${oracle ? `<div class="chp-oracle">${esc(oracle)}</div>` : ''}
  `;
}

export function showCardHoverPreview(el, card) {
  const preview = document.getElementById('card-hover-preview');
  if (!preview) return;
  clearTimeout(_hoverShowTimer);
  _hoverShowTimer = setTimeout(() => {
    _hoverToken++;
    preview.innerHTML = buildCardHoverHtml(card);
    preview.classList.add('visible');
    // Defer until after browser reflow so offsetHeight is accurate
    requestAnimationFrame(() => positionHoverPreview(el));
  }, 200);
}

export function positionHoverPreview(anchorEl) {
  const preview = document.getElementById('card-hover-preview');
  if (!preview || !anchorEl) return;
  const r   = anchorEl.getBoundingClientRect();
  const pw  = preview.offsetWidth || 300;
  const pad = 10;
  const vw  = window.innerWidth;
  const vh  = window.innerHeight;

  // scrollHeight is accurate even when image hasn't fully loaded yet because
  // the img element reserves space via its intrinsic aspect ratio once src is set.
  // Fall back to 520px (image ~384px + text ~100px + padding 24px) if still 0.
  const ph = Math.max(preview.scrollHeight, preview.offsetHeight) || 520;

  // Prefer right of anchor; flip to left if it overflows
  let x = r.right + pad;
  if (x + pw > vw - pad) x = r.left - pw - pad;
  if (x < pad) x = pad;

  // Align top of popup to top of anchor row; clamp so it never goes below viewport
  let y = r.top;
  if (y + ph > vh - pad) y = Math.max(pad, vh - ph - pad);

  preview.style.left = `${x}px`;
  preview.style.top  = `${y}px`;

  // Reposition once the card image finishes loading — its height changes the layout
  const img = preview.querySelector('img.chp-img');
  if (img && !img.complete) {
    img.addEventListener('load',  () => positionHoverPreview(anchorEl), { once: true });
    img.addEventListener('error', () => positionHoverPreview(anchorEl), { once: true });
  }
}

export function hideCardHoverPreview() {
  clearTimeout(_hoverShowTimer);
  _hoverToken++; // invalidate any in-flight SL detail upgrade
  const preview = document.getElementById('card-hover-preview');
  if (preview) preview.classList.remove('visible');
}

// Scryfall card details fetched for unowned SL hover tiles, cached so a tile is
// only ever fetched once (repeat hovers are instant). Concurrent hovers of the
// same id share one in-flight request. Failures aren't cached so they retry.
const _slHoverData = new Map();      // scryfallId → Scryfall card object
const _slHoverInflight = new Map();  // scryfallId → Promise<card|null>

function fetchSlCardData(scryfallId) {
  if (_slHoverData.has(scryfallId)) return Promise.resolve(_slHoverData.get(scryfallId));
  if (_slHoverInflight.has(scryfallId)) return _slHoverInflight.get(scryfallId);
  const p = (async () => {
    try {
      const resp = await netFetch(`https://api.scryfall.com/cards/${scryfallId}`);
      const data = await resp.json();
      _slHoverData.set(scryfallId, data);
      return data;
    } catch {
      return null; // don't cache failures — let the next hover retry
    } finally {
      _slHoverInflight.delete(scryfallId);
    }
  })();
  _slHoverInflight.set(scryfallId, p);
  return p;
}

// Build the hover body for an UNOWNED SL printing. `data` is the Scryfall card
// object once fetched, or null for the instant partial (MTGJSON name + drop info)
// shown while the fetch is in flight.
function buildSlUnownedHoverHtml(scryfallId, data) {
  const id = (scryfallId || '').toLowerCase();
  const img = id ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg` : '';
  const num = (typeof SL_SCRYFALL_TO_NUMBER !== 'undefined' && SL_SCRYFALL_TO_NUMBER[scryfallId]) || '';
  const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(scryfallId) : [];

  const name = (data && data.name)
    || (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[scryfallId])
    || 'Unknown card';
  const typeLine = data ? (data.type_line || data.card_faces?.[0]?.type_line || '') : '';
  const oracle = data
    ? (data.oracle_text || (data.card_faces || []).map(f => f.oracle_text).filter(Boolean).join('\n\n//\n\n'))
    : '';
  const artist = data ? (data.artist || data.card_faces?.[0]?.artist || '') : '';
  const rarity = data?.rarity || '';
  const cmc = data && data.cmc != null ? data.cmc : null;
  const sub = data
    ? `${esc(data.set_name || 'Secret Lair')} · ${esc((data.set || 'SLD').toUpperCase())} · #${esc(data.collector_number || num || '?')}`
    : `Secret Lair · SLD${num ? ` · #${esc(num)}` : ''}`;
  // Single, etched, or foil — match the live refresh's price fallback order.
  const priceNum = data ? parseFloat(data.prices?.usd ?? data.prices?.usd_foil ?? data.prices?.usd_etched) : NaN;

  const rows = [];
  if (typeLine) rows.push(`<span class="lbl">Type</span><span>${esc(typeLine)}</span>`);
  if (rarity)   rows.push(`<span class="lbl">Rarity</span><span style="text-transform:capitalize">${esc(rarity)}</span>`);
  if (cmc != null) rows.push(`<span class="lbl">CMC</span><span>${cmc}</span>`);
  if (artist)   rows.push(`<span class="lbl">Artist</span><span>${esc(artist)}</span>`);
  for (const s of slInfo) {
    rows.push(`<span class="lbl">SL Drop</span><span class="sl-type-badge">${esc(s.drop)}</span>`);
    rows.push(`<span class="lbl">Superdrop</span><span>${esc(s.superdrop)}</span>`);
  }
  rows.push(`<span class="lbl">Owned</span><span style="color:#f87171;font-weight:600">No</span>`);

  return `
    ${img ? `<img class="chp-img" src="${esc(img)}" alt="${esc(name)}" onerror="this.style.display='none'">` : ''}
    <div class="chp-name">${esc(name)}</div>
    <div class="chp-sub">${sub}</div>
    ${Number.isFinite(priceNum) ? `<div class="chp-price">${fmt(priceNum)}</div>` : ''}
    <div class="chp-grid">${rows.join('')}</div>
    ${oracle
      ? `<div class="chp-oracle">${esc(oracle)}</div>`
      : (data ? '' : `<div class="chp-oracle" style="font-style:normal;color:var(--text-muted)">Loading card details…</div>`)}
  `;
}

// SL tile hover: user may or may not own the printing. If owned, show full
// owned-card details. If not, show the same rich metadata (type, oracle, rarity,
// artist, price, drop) pulled from Scryfall — an instant partial preview renders
// first, then upgrades in place once the fetch (cached after first time) returns.
export function showSlTileHoverPreview(el, scryfallId) {
  const owned = collection.cards.find(c => c.scryfallId === scryfallId);
  if (owned) { showCardHoverPreview(el, owned); return; }

  const preview = document.getElementById('card-hover-preview');
  if (!preview) return;
  clearTimeout(_hoverShowTimer);
  _hoverShowTimer = setTimeout(() => {
    const myToken = ++_hoverToken;
    const cached = _slHoverData.get(scryfallId) || null;
    preview.innerHTML = buildSlUnownedHoverHtml(scryfallId, cached);
    preview.classList.add('visible');
    requestAnimationFrame(() => positionHoverPreview(el));

    if (!cached) {
      fetchSlCardData(scryfallId).then(data => {
        // Drop the result if the user has since moved on or the grid re-rendered.
        if (!data || _hoverToken !== myToken) return;
        const p = document.getElementById('card-hover-preview');
        if (!p || !p.classList.contains('visible')) return;
        p.innerHTML = buildSlUnownedHoverHtml(scryfallId, data);
        requestAnimationFrame(() => positionHoverPreview(el));
      });
    }
  }, 200);
}

export function attachContentListeners() {
  // Empty state CSV import
  const emptyCsv = document.getElementById('emptyCsvBtn');
  if (emptyCsv) emptyCsv.addEventListener('click', () => showImportHub('cards'));

  // ── Card hover previews across tabs ─────────────────────────────────────
  // Card Collection › Gallery view: each .gallery-card has onclick="showGalleryModal('cardId')"
  if (ui.activeTab === 'cards') {
    document.querySelectorAll('.gallery-card[onclick*="showGalleryModal"]').forEach(el => {
      const m = el.getAttribute('onclick').match(/showGalleryModal\('([^']+)'\)/);
      const cardId = m ? m[1] : null;
      if (!cardId) return;
      el.addEventListener('mouseenter', () => {
        const card = findCollectionCardById(cardId);
        if (card) showCardHoverPreview(el, card);
      });
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
  }
  // My Collection (Cards) tab: every row gets data-card-id; hover the row
  if (ui.activeTab === 'cards') {
    document.querySelectorAll('tr[data-card-id]').forEach(el => {
      const cardId = el.dataset.cardId;
      el.addEventListener('mouseenter', () => {
        const card = findCollectionCardById(cardId);
        if (card) showCardHoverPreview(el, card);
      });
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
  }
  // SL Explorer + Want List gallery: tiles have onclick="showSlViewerModal('scryfallId')"
  if (ui.activeTab === 'slviewer' || ui.activeTab === 'wantlist') {
    document.querySelectorAll('.gallery-card[onclick*="showSlViewerModal"]').forEach(el => {
      const m = el.getAttribute('onclick').match(/showSlViewerModal\('([^']+)'\)/);
      const scryfallId = m ? m[1] : null;
      if (!scryfallId) return;
      el.addEventListener('mouseenter', () => showSlTileHoverPreview(el, scryfallId));
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
  }
  // Search Results tab: hover on card rows (owned → local card; catalog/printings
  // rows → Scryfall-backed preview via scryfall id).
  if (ui.activeTab === 'search') {
    document.querySelectorAll('.srt .sr-row[data-card-id]').forEach(el => {
      const card = findCollectionCardById(el.dataset.cardId);
      if (!card) return;
      el.addEventListener('mouseenter', () => showCardHoverPreview(el, card));
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
    document.querySelectorAll('.srt .sr-row[data-scryfall-id]').forEach(el => {
      el.addEventListener('mouseenter', () => showSlTileHoverPreview(el, el.dataset.scryfallId));
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
  }

  // Decks tab: hover preview on deck card rows (works for unowned cards too —
  // we synthesize a card object from the deck entry)
  if (ui.activeTab === 'decks' && ui.decks.deckId) {
    const deck = deckById(ui.decks.deckId);
    if (deck) {
      // Matches both list rows and gallery tiles (both carry data-deck-entry).
      document.querySelectorAll('[data-deck-entry]').forEach(el => {
        const dc = deck.cards.find(c => c.id === el.dataset.deckEntry);
        if (!dc || !dc.scryfallId) return;
        el.addEventListener('mouseenter', () => showCardHoverPreview(el, {
          name: dc.name, scryfallId: dc.scryfallId, foil: dc.foil,
          setCode: dc.setCode, setName: dc.setName, collectorNumber: dc.collectorNumber,
          rarity: '', binderName: deck.name, condition: '', quantity: dc.quantity || 1,
        }));
        el.addEventListener('mouseleave', hideCardHoverPreview);
      });
    }
  }

  // Always hide on any re-render so it doesn't get stranded mid-screen
  hideCardHoverPreview();

  // Binder slide-out toggle (Cards tab)
  const fab = document.getElementById('binder-toggle-fab');
  if (fab) {
    fab.addEventListener('click', e => {
      e.stopPropagation();
      const open = document.body.dataset.binderOpen === 'true';
      document.body.dataset.binderOpen = open ? 'false' : 'true';
    });
  }
  // Backdrop click + Escape close the sidebar (bind once globally)
  if (!window.__binderBackdropBound) {
    window.__binderBackdropBound = true;
    document.addEventListener('click', e => {
      if (document.body.dataset.binderOpen !== 'true') return;
      const sidebar = document.querySelector('.binder-sidebar');
      const f = document.getElementById('binder-toggle-fab');
      if (!sidebar) return;
      if (sidebar.contains(e.target) || (f && f.contains(e.target))) return;
      document.body.dataset.binderOpen = 'false';
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.body.dataset.binderOpen === 'true') {
        document.body.dataset.binderOpen = 'false';
      }
    });
  }

  // Binder sidebar — three-state cycle: neutral → include → exclude → neutral
  document.querySelectorAll('.binder-item').forEach(el => {
    el.addEventListener('click', () => {
      const val = el.dataset.binder;
      if (val === 'all') {
        ui.cards.binder = { include: [], exclude: [] };
      } else {
        let { include, exclude } = ui.cards.binder;
        if (include.includes(val)) {
          include = include.filter(b => b !== val);
          exclude = [...exclude, val];
        } else if (exclude.includes(val)) {
          exclude = exclude.filter(b => b !== val);
        } else {
          include = [...include, val];
        }
        ui.cards.binder = { include, exclude };
      }
      ui.cards.page = 1;
      render();
    });
  });

  // Column picker toggle
  const colPickerBtn = document.getElementById('colPickerBtn');
  if (colPickerBtn) {
    colPickerBtn.addEventListener('click', e => {
      e.stopPropagation();
      ui.cards.colPickerOpen = !ui.cards.colPickerOpen;
      render();
    });
  }
  document.querySelectorAll('.col-chip').forEach(chip => {
    chip.addEventListener('click', e => {
      e.stopPropagation();
      const key = chip.dataset.col;
      ui.cards.columns[key] = ui.cards.columns[key] === false;
      render();
    });
  });
  // Close col picker on outside click
  if (ui.cards.colPickerOpen) {
    const closeColPicker = e => {
      if (!e.target.closest('.col-picker-wrap')) {
        ui.cards.colPickerOpen = false;
        render();
      }
      document.removeEventListener('click', closeColPicker);
    };
    document.addEventListener('click', closeColPicker);
  }

  // Card row edit buttons
  document.querySelectorAll('.btn-row-edit').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showEditScryfallModal(btn.dataset.cardId);
    });
  });

  // Card search — commit on Enter or button click, not on every keystroke
  const cs = document.getElementById('cardSearch');
  const doSearch = () => {
    if (!cs) return;
    ui.cards.search = cs.value;
    ui.cards.page = 1;
    render();
  };
  if (cs) {
    cs.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  }
  const csBtn = document.getElementById('cardSearchBtn');
  if (csBtn) csBtn.addEventListener('click', doSearch);
  const csClear = document.getElementById('cardSearchClear');
  if (csClear) csClear.addEventListener('click', () => { ui.cards.search = ''; ui.cards.page = 1; render(); });

  [['statusFilter', 'status'], ['foilFilter', 'foil'], ['rarityFilter', 'rarity'], ['conditionFilter', 'condition'], ['langFilter', 'language']].forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', e => { ui.cards[key] = e.target.value; ui.cards.page = 1; render(); });
  });

  // Column sort
  document.querySelectorAll('thead th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (ui.cards.sortField === f) ui.cards.sortDir = ui.cards.sortDir === 'asc' ? 'desc' : 'asc';
      else { ui.cards.sortField = f; ui.cards.sortDir = 'desc'; }
      render();
    });
  });

  // Pagination
  document.querySelectorAll('.page-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => { ui.cards.page = parseInt(btn.dataset.page); render(); });
  });
  const pps = document.getElementById('perPageSelect');
  if (pps) pps.addEventListener('change', e => { ui.cards.perPage = parseInt(e.target.value); ui.cards.page = 1; render(); });

  // ── Decks tab ────────────────────────────────────────────────────────────
  const deckNewBtn = document.getElementById('deckNewBtn');
  if (deckNewBtn) deckNewBtn.addEventListener('click', showNewDeckModal);
  const deckImportBtn = document.getElementById('deckImportBtn');
  if (deckImportBtn) deckImportBtn.addEventListener('click', () => showImportHub('decks'));
  const deckSearchEl = document.getElementById('deckSearch');
  if (deckSearchEl) deckSearchEl.addEventListener('input', e => {
    ui.decks.search = e.target.value;
    // Re-render just the grid so the input keeps focus
    const grid = document.querySelector('.deck-grid');
    if (grid) {
      const q = ui.decks.search.toLowerCase();
      const maps = deckOwnedMaps();
      const shown = (collection.decks || [])
        .filter(d => !q || d.name.toLowerCase().includes(q) || deckFormat(d).label.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name));
      grid.innerHTML = shown.map(d => renderDeckTile(d, maps)).join('')
        || '<div style="color:var(--text-dim);padding:30px">No decks match your search</div>';
      grid.querySelectorAll('.deck-tile[data-deck-id]').forEach(tile => {
        tile.addEventListener('click', () => { ui.decks.deckId = tile.dataset.deckId; render(); });
      });
    }
  });
  document.querySelectorAll('.deck-tile[data-deck-id]').forEach(tile => {
    tile.addEventListener('click', () => { ui.decks.deckId = tile.dataset.deckId; render(); });
  });
  const deckBackBtn = document.getElementById('deckBackBtn');
  if (deckBackBtn) deckBackBtn.addEventListener('click', () => { ui.decks.deckId = null; render(); });
  const activeDeck = ui.decks.deckId ? deckById(ui.decks.deckId) : null;
  if (activeDeck) {
    const titleEl = document.getElementById('deckTitle');
    if (titleEl) titleEl.addEventListener('click', () =>
      promptText('Rename deck', activeDeck.name, name => { activeDeck.name = name; render(); autoSave(); }));
    const fmtSel = document.getElementById('deckFormatSelect');
    if (fmtSel) fmtSel.addEventListener('change', () => {
      activeDeck.format = fmtSel.value;
      render(); autoSave();
      toast(`${activeDeck.name} is now a ${deckFormat(activeDeck).label} deck`, 'info');
    });
    const addBtn = document.getElementById('deckAddCardsBtn');
    if (addBtn) addBtn.addEventListener('click', () => showDeckAddCardModal(activeDeck.id));
    const exportBtn = document.getElementById('deckExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', () => showDeckExportModal(activeDeck.id));
    const delBtn = document.getElementById('deckDeleteBtn');
    if (delBtn) delBtn.addEventListener('click', () => deleteDeck(activeDeck));
  }

  // Sealed filters
  const ss = document.getElementById('sealedSearch');
  if (ss) ss.addEventListener('input', e => { ui.sealed.search = e.target.value; render(); });
  const st = document.getElementById('sealedTypeFilter');
  if (st) st.addEventListener('change', e => { ui.sealed.type = e.target.value; render(); });
  const sv = document.getElementById('sealedStatusFilter');
  if (sv) sv.addEventListener('change', e => { ui.sealed.status = e.target.value; render(); });

  // TCGCSV sync button
  const syncBtn = document.getElementById('tcgcsv-sync-btn');
  if (syncBtn) syncBtn.addEventListener('click', () => refreshTcgcsvCache());

  // Add sealed buttons — open the catalog picker (search + browse unified)
  ['addSealedBtn', 'addSealedBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => openAddProductFlow());
  });

  // Sealed item actions
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const { action, id } = btn.dataset;
      if (action === 'edit-sealed')           { showAddSealedModal(id); }
      else if (action === 'update-sealed-price') { showUpdatePriceModal(id); }
      else if (action === 'toggle-status') {
        const item = collection.sealed.find(i => i.id === id);
        if (item) { item.status = item.status === 'sealed' ? 'opened' : 'sealed'; render(); autoSave(); }
      }
      else if (action === 'toggle-cards') {
        const el = document.getElementById(`sc-${id}`);
        if (el) el.classList.toggle('open');
      }
      else if (action === 'sell-sealed') {
        const item = collection.sealed.find(i => i.id === id);
        if (item) showSellSealedModal(item);
      }
      else if (action === 'undo-sale') {
        const item = collection.sealed.find(i => i.id === id);
        if (item) undoSealedSale(item);
      }
      else if (action === 'delete-sealed') {
        if (confirm('Delete this product from your collection?')) {
          collection.sealed = collection.sealed.filter(i => i.id !== id);
          window.api.sealed.remove(id).catch(() => {});
          render();
          autoSave();
          toast('Product removed', 'info');
        }
      }
    });
  });
}

