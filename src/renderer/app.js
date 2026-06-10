'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const SCRYFALL_COLLECTION = 'https://api.scryfall.com/cards/collection';
const TCGCSV_GROUPS = 'https://tcgcsv.com/tcgplayer/1/groups';
const PC_API        = 'https://www.pricecharting.com/api';

const CONDITION_SHORT = {
  mint: 'M', near_mint: 'NM', lightly_played: 'LP',
  moderately_played: 'MP', heavily_played: 'HP', damaged: 'DMG'
};
const CONDITION_FULL = {
  mint: 'Mint', near_mint: 'Near Mint', lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played', heavily_played: 'Heavily Played', damaged: 'Damaged'
};
const FOIL_LABEL = { normal: '—', foil: 'Foil', etched: 'Etched' };
const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3 };
const PRODUCT_TYPES = [
  'Secret Lair', 'Booster Box', 'Set Booster Box',
  'Collector Booster Box', 'Bundle', 'Commander Deck',
  'Prerelease Kit', 'Starter Kit', 'Other'
];

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
let collection = makeCollection();

// TCGCSV in-memory cache — full sealed product preload
let tcgcsvCache = {
  groups:         null,   // all MTG groups from TCGCSV
  sealedProducts: [],     // flat array of all sealed products with prices
  lastRefresh:    null,
  syncing:        false,
  syncDone:       0,
  syncTotal:      0,
};

let ui = {
  activeTab: 'dashboard',
  cards: {
    binder: { include: [], exclude: [] },
    search: '', foil: 'all', rarity: 'all',
    condition: 'all', language: 'all',
    sortField: 'name', sortDir: 'asc',
    page: 1, perPage: 50,
    columns: {
      setCode: true, foil: true, rarity: true, condition: true,
      language: true, quantity: true, purchasePrice: true,
      currentPrice: true, marketPrice: true, priceDelta: true, trend: true, flags: true,
      setName: false, binderName: false
    },
    colPickerOpen: false,
  },
  sealed: { search: '', type: 'all', status: 'all' },
  gallery: { binder: '', set: '', cmc: '', search: '', sortField: 'name', sortDir: 'asc', page: 0 },
  slViewer: { superdrop: '', drop: '', page: 0, sort: 'date_desc', search: '' },
  slRefreshing: false,
  failures: { filter: 'all', retrying: false },
  refreshing: false,
  refreshProgress: 0
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVITY LOGGER — circular buffer feeds the slide-in panel in the status bar
// ─────────────────────────────────────────────────────────────────────────────
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];
let logsPanelOpen = false;
let logsUnread = 0;

function logEntry(level, category, message, details) {
  const entry = { t: new Date(), level, category, message, details: details ?? null };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  if (!logsPanelOpen) logsUnread++;
  updateLogsButton();
  if (logsPanelOpen) renderLogPanel();
  // Mirror to devtools console for power users
  const fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[fn](`[${category}] ${message}`, details ?? '');
}

window.logger = {
  info:    (cat, msg, det) => logEntry('info', cat, msg, det),
  success: (cat, msg, det) => logEntry('success', cat, msg, det),
  warn:    (cat, msg, det) => logEntry('warn', cat, msg, det),
  error:   (cat, msg, det) => logEntry('error', cat, msg, det),
  debug:   (cat, msg, det) => logEntry('debug', cat, msg, det),
  clear:   () => { logBuffer.length = 0; logsUnread = 0; updateLogsButton(); renderLogPanel(); },
  all:     () => logBuffer.slice(),
};

function updateLogsButton() {
  const el = document.getElementById('sb-logs-count');
  if (!el) return;
  el.textContent = logsUnread > 0 ? logsUnread > 99 ? '99+' : String(logsUnread) : '';
  el.style.display = logsUnread > 0 ? '' : 'none';
}

function toggleLogPanel() {
  logsPanelOpen = !logsPanelOpen;
  const panel = document.getElementById('logs-panel');
  if (!panel) return;
  panel.classList.toggle('open', logsPanelOpen);
  if (logsPanelOpen) {
    logsUnread = 0;
    updateLogsButton();
    renderLogPanel();
    // Auto-scroll to newest after render
    setTimeout(() => {
      const body = document.getElementById('logs-body');
      if (body) body.scrollTop = body.scrollHeight;
    }, 30);
  }
}

function renderLogPanel() {
  const body = document.getElementById('logs-body');
  if (!body) return;
  if (logBuffer.length === 0) {
    body.innerHTML = `<div class="logs-empty">No activity logged yet. Run a price refresh, CSV import, or Secret Lair refresh and progress will appear here.</div>`;
    return;
  }
  body.innerHTML = logBuffer.map(e => {
    const t = e.t.toLocaleTimeString([], { hour12: false });
    const detailHtml = e.details
      ? `<div class="log-det">${esc(typeof e.details === 'string' ? e.details : JSON.stringify(e.details))}</div>`
      : '';
    return `<div class="log-entry log-${e.level}">
      <span class="log-t">${t}</span>
      <span class="log-cat">${esc(e.category)}</span>
      <span class="log-msg">${esc(e.message)}</span>
      ${detailHtml}
    </div>`;
  }).join('');
}

function makeCollection() {
  return {
    version: 3,
    lastPriceRefresh: null,
    settings: { pricechartingKey: '' },
    cards: [],
    sealed: [],
    priceHistory: {},
    marketPriceHistory: {},  // scryfallId|foil → [{date,price}] from TCGCSV (market price)
    cardMetadata: {},  // scryfallId → { colors, type_line, cmc, color_identity }
    failedLookups: []  // populated on each price refresh
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function uid() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
}

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function today() { return new Date().toISOString().split('T')[0]; }

function toast(msg, type = 'info', ms = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Escape a string for safe use inside a JS literal in an inline onclick.
// HTML-escape (so the attribute value is valid) AND backslash-escape JS quotes.
function escJs(str) {
  return String(str ?? '')
    .replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSING
// ─────────────────────────────────────────────────────────────────────────────
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] ?? '').trim());
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

function parseCsvHeaders(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  return parseCsvLine(firstLine).map(h => h.trim()).filter(Boolean);
}

function csvRowToCard(row) {
  return {
    id: uid(),
    binderName: row['Binder Name'] || '',
    binderType: row['Binder Type'] || 'binder',
    name: row['Name'] || '',
    setCode: row['Set code'] || '',
    setName: row['Set name'] || '',
    collectorNumber: row['Collector number'] || '',
    foil: row['Foil'] || 'normal',
    rarity: (row['Rarity'] || '').toLowerCase(),
    quantity: Math.max(1, parseInt(row['Quantity']) || 1),
    manaboxId: row['ManaBox ID'] || '',
    scryfallId: (row['Scryfall ID'] || '').trim().toLowerCase(),
    purchasePrice: parseFloat(row['Purchase price']) || 0,
    purchasePriceCurrency: row['Purchase price currency'] || 'USD',
    misprint: row['Misprint'] === 'true',
    altered: row['Altered'] === 'true',
    condition: row['Condition'] || 'near_mint',
    language: row['Language'] || 'en'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE — import / export
// ─────────────────────────────────────────────────────────────────────────────

// ── Storage layer (SQLite via Electron IPC) ─────────────────────────────────
// Renderer keeps the in-memory `collection` cache; autoSave/autoLoad sync with
// the SQLite database living in the user's app-data folder.

async function autoSave() {
  try {
    // Push everything to SQLite in one go. Native is fast — full saves are fine
    // for typical collection sizes (a few thousand cards).
    const settingsJson = JSON.stringify(collection.settings || {});

    // Flatten priceHistory + marketPriceHistory into snapshot rows for bulkStore
    const priceSnaps = [];
    for (const [k, hist] of Object.entries(collection.priceHistory || {})) {
      const [sid, foil] = k.split('|');
      for (const h of hist) priceSnaps.push({ scryfallId: sid, foil, date: h.date, price: h.price, source: 'scryfall' });
    }
    for (const [k, hist] of Object.entries(collection.marketPriceHistory || {})) {
      const [sid, foil] = k.split('|');
      for (const h of hist) priceSnaps.push({ scryfallId: sid, foil, date: h.date, price: h.price, source: 'tcgcsv' });
    }

    await Promise.all([
      window.api.cards.bulkUpsert(collection.cards),
      window.api.prices.bulkStore(priceSnaps),
      window.api.metadata.bulkUpsert(
        Object.entries(collection.cardMetadata || {}).map(([id, m]) => ({ scryfallId: id, ...m }))
      ),
      window.api.failures.replace(collection.failedLookups || []),
      window.api.settings.set('settings_blob', settingsJson),
      window.api.settings.set('last_price_refresh', collection.lastPriceRefresh || ''),
    ]);
    // Sealed: replace via per-row upsert (small list)
    for (const s of collection.sealed || []) await window.api.sealed.upsert(s);

    const el = document.getElementById('autosave-status');
    if (el) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.textContent = `● Saved ${t}`;
      el.style.opacity = '1';
      clearTimeout(el._fadeTimer);
      el._fadeTimer = setTimeout(() => { el.style.opacity = '0.4'; }, 3000);
    }
  } catch (err) {
    console.warn('Auto-save failed:', err);
    window.logger?.error('Save', `autoSave failed: ${err.message}`);
  }
}

async function autoLoad() {
  try {
    const [cardRows, sealedRows, prices, metadata, failures, settings] = await Promise.all([
      window.api.cards.list(),
      window.api.sealed.list(),
      window.api.prices.all(),
      window.api.metadata.all(),
      window.api.failures.list(),
      window.api.settings.all(),
    ]);

    if (!cardRows.length && !sealedRows.length && !Object.keys(prices).length) return false;

    collection.cards = cardRows.map(r => ({
      id: r.id,
      scryfallId: r.scryfall_id || '',
      manaboxId: r.manabox_id || '',
      name: r.name,
      setCode: r.set_code || '',
      setName: r.set_name || '',
      collectorNumber: r.collector_number || '',
      foil: r.foil || 'normal',
      rarity: r.rarity || '',
      quantity: r.quantity || 1,
      binderName: r.binder_name || '',
      binderType: r.binder_type || 'binder',
      purchasePrice: r.purchase_price ?? 0,
      purchasePriceCurrency: r.purchase_price_currency || 'USD',
      condition: r.condition || 'near_mint',
      language: r.language || 'en',
      misprint: !!r.misprint,
      altered: !!r.altered,
    }));
    collection.sealed = sealedRows.map(r => ({
      id: r.id, name: r.name, productType: r.product_type, setCode: r.set_code,
      setName: r.set_name, quantity: r.quantity, purchasePrice: r.purchase_price,
      currentValue: r.current_value, status: r.status, notes: r.notes,
      priceHistory: r.priceHistory || [],
    }));
    // prices is { scryfall: {}, tcgcsv: {} } from updated DB layer;
    // fall back to treating it as a flat scryfall-only map for legacy exports
    if (prices && typeof prices.scryfall === 'object') {
      collection.priceHistory       = prices.scryfall;
      collection.marketPriceHistory = prices.tcgcsv || {};
    } else {
      collection.priceHistory       = prices || {};
      collection.marketPriceHistory = {};
    }
    collection.cardMetadata  = metadata;
    collection.failedLookups = failures;
    collection.settings = settings.settings_blob
      ? JSON.parse(settings.settings_blob)
      : { pricechartingKey: '' };
    if (!collection.settings.pricechartingKey) collection.settings.pricechartingKey = '';
    collection.lastPriceRefresh = settings.last_price_refresh || null;

    return true;
  } catch (err) {
    console.warn('Auto-load failed:', err);
    return false;
  }
}

async function saveCollection() {
  // Manual export to JSON file (backup) using native save dialog
  const json = JSON.stringify(collection, null, 2);
  const savedPath = await window.api.dialog.saveJson(json);
  if (savedPath) toast(`Backup saved to ${savedPath}`, 'success');
}

async function loadCollectionFile() {
  // MERGE-imports a legacy collection.json into existing data.
  // Existing data is preserved; matching IDs are updated; new IDs are added.
  // Use Settings → "Reset Database" first if you want a clean slate.
  const result = await window.api.dialog.openJson();
  if (!result) return;
  try {
    const data = JSON.parse(result.text);
    if (!data.cards) throw new Error('No cards array in JSON');
    data.cards.forEach(c => { if (c.scryfallId) c.scryfallId = c.scryfallId.trim().toLowerCase(); });

    let cardsAdded = 0, cardsUpdated = 0;
    for (const c of data.cards) {
      const matchIdx = collection.cards.findIndex(ec =>
        ec.id === c.id ||
        (c.manaboxId && ec.manaboxId === c.manaboxId &&
         ec.scryfallId === c.scryfallId && ec.foil === c.foil)
      );
      if (matchIdx >= 0) {
        collection.cards[matchIdx] = { ...collection.cards[matchIdx], ...c };
        cardsUpdated++;
      } else {
        collection.cards.push(c);
        cardsAdded++;
      }
    }

    let sealedAdded = 0, sealedUpdated = 0;
    for (const s of data.sealed || []) {
      const idx = collection.sealed.findIndex(es => es.id === s.id);
      if (idx >= 0) { collection.sealed[idx] = { ...collection.sealed[idx], ...s }; sealedUpdated++; }
      else          { collection.sealed.push(s); sealedAdded++; }
    }

    // Merge price history — incoming entries OVERWRITE same (key, date) pair,
    // but existing dates not present in incoming are preserved.
    const incomingPrices = normalizePriceHistoryKeys(data.priceHistory || {});
    for (const [k, hist] of Object.entries(incomingPrices)) {
      if (!collection.priceHistory[k]) collection.priceHistory[k] = [];
      const byDate = {};
      for (const h of collection.priceHistory[k]) byDate[h.date] = h;
      for (const h of hist) byDate[h.date] = h; // incoming wins
      collection.priceHistory[k] = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    }

    // Merge metadata — incoming overrides on collision
    Object.assign(collection.cardMetadata, data.cardMetadata || {});

    // Settings: keep current (don't overwrite API keys with imported values)
    // failedLookups: get rebuilt next refresh anyway, leave alone
    if (data.lastPriceRefresh && (!collection.lastPriceRefresh || data.lastPriceRefresh > collection.lastPriceRefresh))
      collection.lastPriceRefresh = data.lastPriceRefresh;

    await autoSave();
    toast(`Merged: +${cardsAdded} new, ~${cardsUpdated} updated cards · +${sealedAdded} new sealed`, 'success');
    window.logger?.success('Import', `JSON merged: +${cardsAdded} new + ~${cardsUpdated} updated cards · +${sealedAdded} new sealed (${result.path?.split(/[\\/]/).pop() || 'file'})`);
    render();
  } catch (err) {
    toast('Failed to parse collection file: ' + err.message, 'error');
    window.logger?.error('Import', `JSON load failed: ${err.message}`);
  }
}

async function importCsvFile() {
  const result = await window.api.dialog.openCsv();
  if (!result) return;
  showImportWizard(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV IMPORT WIZARD
// ─────────────────────────────────────────────────────────────────────────────

const IMPORT_FIELD_DEFS = [
  { key: 'name',                  label: 'Card Name',         required: true,  aliases: ['name','card name','card_name'] },
  { key: 'scryfallId',            label: 'Scryfall ID',       required: true,  aliases: ['scryfall id','scryfall_id','scryfallid','scryfall'] },
  { key: 'setCode',               label: 'Set Code',          required: false, aliases: ['set code','set_code','setcode','set'] },
  { key: 'setName',               label: 'Set Name',          required: false, aliases: ['set name','set_name','setname','edition'] },
  { key: 'collectorNumber',       label: 'Collector #',       required: false, aliases: ['collector number','collector_number','collectornumber','number','card number'] },
  { key: 'foil',                  label: 'Foil Type',         required: false, aliases: ['foil','foil type','foil_type','printing'] },
  { key: 'rarity',                label: 'Rarity',            required: false, aliases: ['rarity','card rarity'] },
  { key: 'quantity',              label: 'Quantity',          required: false, aliases: ['quantity','qty','count','amount','copies'] },
  { key: 'binderName',            label: 'Binder / Folder',   required: false, aliases: ['binder name','binder_name','binder','folder','location'] },
  { key: 'binderType',            label: 'Binder Type',       required: false, aliases: ['binder type','binder_type'] },
  { key: 'purchasePrice',         label: 'Purchase Price',    required: false, aliases: ['purchase price','purchase_price','price','cost','paid'] },
  { key: 'purchasePriceCurrency', label: 'Currency',          required: false, aliases: ['purchase price currency','currency','purchase_price_currency'] },
  { key: 'condition',             label: 'Condition',         required: false, aliases: ['condition','grade','quality'] },
  { key: 'language',              label: 'Language',          required: false, aliases: ['language','lang','locale'] },
  { key: 'manaboxId',             label: 'ManaBox ID',        required: false, aliases: ['manabox id','manabox_id','manaboxid'] },
  { key: 'misprint',              label: 'Misprint',          required: false, aliases: ['misprint','is misprint'] },
  { key: 'altered',               label: 'Altered',           required: false, aliases: ['altered','is altered','modified'] },
];

let _wizard = null;

function _normHdr(h) { return h.toLowerCase().replace(/[\s_\-]+/g, ' ').trim(); }

function autoDetectMapping(headers) {
  const normed = headers.map(_normHdr);
  const mapping = {};
  for (const def of IMPORT_FIELD_DEFS) {
    const found = def.aliases.find(a => normed.includes(a));
    mapping[def.key] = found != null ? headers[normed.indexOf(found)] : '';
  }
  return mapping;
}

function csvRowToCardWithMapping(row, mapping) {
  const get = key => { const col = mapping[key]; return col ? (row[col] ?? '').toString().trim() : ''; };
  const name = get('name');
  if (!name) return null;
  const rawFoil = get('foil').toLowerCase();
  const foil = rawFoil === 'foil' || rawFoil === 'true' || rawFoil === 'yes' ? 'foil'
    : rawFoil === 'etched' ? 'etched' : 'normal';
  const COND_MAP = {
    nm:'near_mint','near mint':'near_mint','near_mint':'near_mint',
    lp:'lightly_played','lightly played':'lightly_played','lightly_played':'lightly_played',
    mp:'moderately_played','moderately played':'moderately_played','moderately_played':'moderately_played',
    hp:'heavily_played','heavily played':'heavily_played','heavily_played':'heavily_played',
    d:'damaged','dmg':'damaged','damaged':'damaged'
  };
  const rawCond = get('condition').toLowerCase();
  const condition = COND_MAP[rawCond] || rawCond || 'near_mint';
  const qty = parseInt(get('quantity') || '1', 10);
  return {
    id: uid(), name,
    scryfallId: get('scryfallId').toLowerCase(),
    setCode: (get('setCode') || '').toLowerCase(),
    setName: get('setName'),
    collectorNumber: get('collectorNumber'),
    foil, rarity: (get('rarity') || 'common').toLowerCase(),
    quantity: isNaN(qty) || qty < 1 ? 1 : qty,
    binderName: get('binderName') || '',
    binderType: get('binderType') || 'binder',
    manaboxId: get('manaboxId') || '',
    purchasePrice: parseFloat(get('purchasePrice')) || 0,
    purchasePriceCurrency: get('purchasePriceCurrency') || 'USD',
    condition,
    language: (get('language') || 'en').toLowerCase(),
    misprint: get('misprint').toLowerCase() === 'true',
    altered: get('altered').toLowerCase() === 'true',
  };
}

function _wizardStepBar(active) {
  return `<div class="wiz-steps">${['Preview','Map Columns','Import'].map((s, i) => {
    const n = i + 1;
    const cls = n === active ? 'wiz-step active' : n < active ? 'wiz-step done' : 'wiz-step';
    return `<span class="${cls}">${n < active ? '✓ ' : ''}${n}. ${s}</span>${i < 2 ? '<span class="wiz-sep">›</span>' : ''}`;
  }).join('')}</div>`;
}

function renderWizardStep1() {
  const { fileName, headers, rows } = _wizard;
  const previewRows = rows.slice(0, 10);
  const maxCols = Math.min(headers.length, 7);
  const vis = headers.slice(0, maxCols);
  const extra = headers.length - maxCols;
  return `
    ${_wizardStepBar(1)}
    <h2>CSV Preview</h2>
    <p class="wiz-meta">
      <strong>${esc(fileName)}</strong> &nbsp;·&nbsp;
      <strong>${rows.length.toLocaleString()}</strong> rows &nbsp;·&nbsp;
      <strong>${headers.length}</strong> columns
    </p>
    <div class="wiz-chips">
      ${headers.map(h => `<span class="wiz-chip">${esc(h)}</span>`).join('')}
    </div>
    <div class="wiz-scroll">
      <table class="wiz-table">
        <thead><tr>
          ${vis.map(h => `<th>${esc(h)}</th>`).join('')}
          ${extra > 0 ? `<th class="dim">+${extra} more</th>` : ''}
        </tr></thead>
        <tbody>
          ${previewRows.map(r => `<tr>
            ${vis.map(h => `<td>${esc((r[h] || '').substring(0, 36))}</td>`).join('')}
            ${extra > 0 ? '<td class="dim">…</td>' : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="wiz-footer">
      <button class="btn" id="wiz-cancel">Cancel</button>
      <button class="btn btn-primary" id="wiz-next">Map Columns →</button>
    </div>`;
}

function renderWizardStep2() {
  const { headers, mapping } = _wizard;
  const sel = key => {
    const cur = mapping[key] || '';
    return `<select id="wmap-${esc(key)}" class="wiz-sel">
      <option value=""${!cur ? ' selected' : ''}>— not mapped —</option>
      ${headers.map(h => `<option value="${esc(h)}"${cur === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}
    </select>`;
  };
  const req = IMPORT_FIELD_DEFS.filter(d => d.required);
  const opt = IMPORT_FIELD_DEFS.filter(d => !d.required);
  return `
    ${_wizardStepBar(2)}
    <h2>Map Columns</h2>
    <p class="wiz-meta">Match your CSV columns to app fields. <span style="color:var(--accent)">★</span> fields are needed for price lookups.</p>
    <div class="wiz-body">
      <div class="wiz-section-label">Required</div>
      <div class="wiz-map-grid">
        ${req.map(d => `<div class="wiz-map-row">
          <label class="wiz-map-lbl"><span class="wiz-req">★</span>${esc(d.label)}</label>
          ${sel(d.key)}
        </div>`).join('')}
      </div>
      <div class="wiz-section-label" style="margin-top:12px">Optional</div>
      <div class="wiz-map-grid wiz-map-2col">
        ${opt.map(d => `<div class="wiz-map-row">
          <label class="wiz-map-lbl">${esc(d.label)}</label>
          ${sel(d.key)}
        </div>`).join('')}
      </div>
    </div>
    <div class="wiz-footer">
      <button class="btn" id="wiz-back">← Back</button>
      <button class="btn btn-primary" id="wiz-next">Review →</button>
    </div>`;
}

function renderWizardStep3() {
  const { rows, mapping } = _wizard;
  const nameCol = mapping['name'];
  const importable = nameCol ? rows.filter(r => (r[nameCol] || '').trim()).length : 0;
  const req = IMPORT_FIELD_DEFS.filter(d => d.required);
  const mappedOpt = IMPORT_FIELD_DEFS.filter(d => !d.required && mapping[d.key]).length;
  const lines = [];
  for (const d of req) {
    if (mapping[d.key]) lines.push({ ok: true,  text: `${d.label} → "${mapping[d.key]}"` });
    else                lines.push({ ok: false, text: `${d.label} not mapped — cards won't have Scryfall pricing` });
  }
  lines.push({ ok: true, text: `${mappedOpt} optional field${mappedOpt !== 1 ? 's' : ''} mapped` });
  if (importable === 0) lines.push({ ok: false, text: 'No importable rows found — check your Name column mapping' });
  return `
    ${_wizardStepBar(3)}
    <h2>Review & Import</h2>
    <div class="wiz-summary">
      <div class="wiz-sum-row wiz-ok">✓ ${importable.toLocaleString()} rows ready to import</div>
      ${lines.map(l => `<div class="wiz-sum-row ${l.ok ? 'wiz-ok' : 'wiz-warn'}">${l.ok ? '✓' : '⚠'} ${esc(l.text)}</div>`).join('')}
    </div>
    <p class="wiz-meta" style="margin-top:12px">
      Cards with matching Scryfall ID + foil + binder will be updated. All others are added as new.
    </p>
    <div class="wiz-footer">
      <button class="btn" id="wiz-back">← Back</button>
      <button class="btn btn-primary" id="wiz-import"${importable === 0 ? ' disabled' : ''}>
        Import ${importable.toLocaleString()} Rows
      </button>
    </div>`;
}

function _wizardReadMapping() {
  const m = {};
  for (const d of IMPORT_FIELD_DEFS) {
    const el = document.getElementById(`wmap-${d.key}`);
    if (el) m[d.key] = el.value;
  }
  return m;
}

function _wizardClose() {
  _wizard = null;
  document.querySelector('.modal')?.classList.remove('modal-wide');
  hideModal();
}

function _wizardPerformImport() {
  const { rows, mapping } = _wizard;
  const incoming = rows.map(r => csvRowToCardWithMapping(r, mapping)).filter(Boolean);
  let added = 0, updated = 0, skipped = 0;
  for (const card of incoming) {
    if (!card.name) { skipped++; continue; }
    let idx = -1;
    if (card.manaboxId) {
      idx = collection.cards.findIndex(c =>
        c.manaboxId === card.manaboxId && c.scryfallId === card.scryfallId && c.foil === card.foil);
    } else if (card.scryfallId) {
      idx = collection.cards.findIndex(c =>
        c.scryfallId === card.scryfallId && c.foil === card.foil && c.binderName === card.binderName);
    }
    if (idx >= 0) { collection.cards[idx] = { ...collection.cards[idx], ...card }; updated++; }
    else { collection.cards.push(card); added++; }
  }
  _wizardClose();
  toast(`Imported — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`, 'success');
  window.logger?.success('Import', `Wizard: ${added} new + ${updated} updated${skipped ? ` + ${skipped} skipped` : ''}`);
  render();
  autoSave();
}

function _attachWizardListeners() {
  const step = _wizard?.step;
  document.getElementById('wiz-cancel')?.addEventListener('click', _wizardClose);
  document.getElementById('wiz-back')?.addEventListener('click', () => {
    if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 1; }
    if (step === 3) { _wizard.step = 2; }
    _showWizardStep();
  });
  document.getElementById('wiz-next')?.addEventListener('click', () => {
    if (step === 1) { _wizard.step = 2; }
    if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 3; }
    _showWizardStep();
  });
  document.getElementById('wiz-import')?.addEventListener('click', _wizardPerformImport);
}

function _showWizardStep() {
  const html = _wizard.step === 1 ? renderWizardStep1()
    : _wizard.step === 2 ? renderWizardStep2()
    : renderWizardStep3();
  showModal(html);
  _attachWizardListeners();
}

function showImportWizard({ path: filePath, text }) {
  const headers = parseCsvHeaders(text);
  if (!headers.length) { toast('CSV has no headers — check the file format', 'error'); return; }
  const rows = parseCsv(text);
  if (!rows.length) { toast('CSV appears empty', 'error'); return; }
  const fileName = (filePath || '').split(/[/\\]/).pop() || 'import.csv';
  _wizard = { step: 1, filePath, fileName, headers, rows, mapping: autoDetectMapping(headers) };
  document.querySelector('.modal')?.classList.add('modal-wide');
  _showWizardStep();
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE HISTORY
// ─────────────────────────────────────────────────────────────────────────────
function priceKey(scryfallId, foilType) { return `${scryfallId}|${foilType}`; }

// Re-key priceHistory so all UUIDs are lowercase (fixes mismatches from old imports)
function normalizePriceHistoryKeys(hist) {
  const out = {};
  for (const [key, val] of Object.entries(hist || {})) {
    const [id, foil] = key.split('|');
    const newKey = `${(id || '').toLowerCase()}|${foil || ''}`;
    if (out[newKey]) {
      // Merge: keep all entries, deduplicate by date
      const merged = [...out[newKey], ...val];
      const byDate = {};
      for (const e of merged) byDate[e.date] = e;
      out[newKey] = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    } else {
      out[newKey] = val;
    }
  }
  return out;
}

function getCurrentPrice(scryfallId, foilType) {
  const h = collection.priceHistory[priceKey(scryfallId, foilType)];
  return h?.length ? h[h.length - 1].price : null;
}

function getPriceHistory(scryfallId, foilType) {
  return collection.priceHistory[priceKey(scryfallId, foilType)] || [];
}

function storePriceSnapshot(scryfallId, foilType, price) {
  if (price == null || isNaN(price) || price <= 0) return;
  const key = priceKey(scryfallId, foilType);
  if (!collection.priceHistory[key]) collection.priceHistory[key] = [];
  const hist = collection.priceHistory[key];
  const t = today();
  const todayIdx = hist.findIndex(h => h.date === t);
  if (todayIdx >= 0) {
    hist[todayIdx].price = price;
  } else {
    const last = hist[hist.length - 1];
    if (!last || last.price !== price) hist.push({ date: t, price });
  }
}

function storeMarketPriceSnapshot(scryfallId, foilType, price) {
  if (price == null || isNaN(price) || price <= 0) return;
  const key = priceKey(scryfallId, foilType);
  if (!collection.marketPriceHistory[key]) collection.marketPriceHistory[key] = [];
  const hist = collection.marketPriceHistory[key];
  const t = today();
  const todayIdx = hist.findIndex(h => h.date === t);
  if (todayIdx >= 0) {
    hist[todayIdx].price = price;
  } else {
    const last = hist[hist.length - 1];
    if (!last || last.price !== price) hist.push({ date: t, price });
  }
}

function getCurrentMarketPrice(scryfallId, foilType) {
  const h = collection.marketPriceHistory[priceKey(scryfallId, foilType)];
  return h?.length ? h[h.length - 1].price : null;
}

function getPriceChange(history) {
  if (!history || history.length < 2) return null;
  const cur  = history[history.length - 1].price;
  const prev = history[history.length - 2].price;
  if (!prev) return null;
  return { current: cur, previous: prev, diff: cur - prev, pct: ((cur - prev) / prev) * 100 };
}

function sparkline(history, w = 70, h = 22) {
  const prices = (history || []).map(p => p.price).filter(p => p > 0);
  if (prices.length < 2) return '<span style="color:var(--text-dim);font-size:11px">—</span>';
  const mn = Math.min(...prices), mx = Math.max(...prices), rng = mx - mn || 0.001;
  const pts = prices.map((p, i) => {
    const x = (i / (prices.length - 1)) * w;
    const y = (h - 3) - ((p - mn) / rng) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const color = prices[prices.length - 1] >= prices[0] ? '#4ade80' : '#f87171';
  const lx = w, ly = (h - 3) - ((prices[prices.length - 1] - mn) / rng) * (h - 6);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;overflow:visible">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" fill="${color}"/>
  </svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCRYFALL API
// ─────────────────────────────────────────────────────────────────────────────

// Fetch one batch from Scryfall with automatic retry on rate-limit (429).
// Waits 2s, 4s, 8s between attempts before giving up.
async function fetchScryfallBatch(ids) {
  const DELAYS = [2000, 4000, 8000];
  for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
    const resp = await fetch(SCRYFALL_COLLECTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: ids.map(id => ({ id })) })
    });
    if (resp.status === 429) {
      if (attempt < DELAYS.length) {
        const wait = DELAYS[attempt];
        const refreshEl = document.getElementById('sb-refresh');
        if (refreshEl) {
          refreshEl.textContent = `↻ Rate limited — waiting ${wait / 1000}s…`;
          refreshEl.style.color = 'var(--accent2)';
        }
        window.logger?.warn('Price', `Rate limited (429) — backing off ${wait / 1000}s before retry ${attempt + 1}/${DELAYS.length}`);
        await sleep(wait);
        continue;
      }
      window.logger?.error('Price', 'Rate limit retries exhausted; giving up on this batch');
      throw new Error('Rate limited (429) — still failing after retries');
    }
    if (!resp.ok) {
      window.logger?.error('Price', `HTTP ${resp.status} from Scryfall`);
      throw new Error(`HTTP ${resp.status}`);
    }
    return resp.json();
  }
}

// Fetch TCGPlayer market prices from TCGCSV for a set of cards and store them
// in collection.marketPriceHistory. Returns number of cards successfully priced.
async function fetchTcgcsvMarketPrices(cardPairs) {
  // cardPairs: [{scryfallId, foil, setName, name, collectorNumber}]
  let groups;
  try {
    const resp = await fetch('https://tcgcsv.com/tcgplayer/1/groups');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = await resp.json();
    groups = Array.isArray(raw) ? raw : (raw.results || raw.groups || []);
  } catch (e) {
    window.logger?.warn('Price', `TCGCSV market prices: groups fetch failed — ${e.message}`);
    return 0;
  }

  // Map group name (lowercase) → groupId
  const groupByName = new Map();
  for (const g of groups) {
    if (g.name) groupByName.set(g.name.toLowerCase().trim(), g.groupId);
  }

  // Find which of our set names match a TCGCSV group
  const uniqueSetNames = [...new Set(cardPairs.map(p => p.setName).filter(Boolean))];
  const setToGroupId = new Map();
  for (const setName of uniqueSetNames) {
    const groupId = groupByName.get(setName.toLowerCase().trim());
    if (groupId != null) setToGroupId.set(setName, groupId);
  }

  if (!setToGroupId.size) {
    window.logger?.debug('Price', 'TCGCSV market prices: no set name matches found in groups');
    return 0;
  }

  window.logger?.info('Price', `TCGCSV market prices: fetching ${setToGroupId.size} sets…`);

  // Fetch products+prices per group in batches
  // groupProductMap: setName → Map<normalizedCardName, [{collectorNum, normal, foil}]>
  const groupProductMap = new Map();
  const setEntries = [...setToGroupId.entries()];
  const BATCH = 5;

  for (let i = 0; i < setEntries.length; i += BATCH) {
    await Promise.all(setEntries.slice(i, i + BATCH).map(async ([setName, groupId]) => {
      try {
        const [prodResp, priceResp] = await Promise.all([
          fetch(`https://tcgcsv.com/tcgplayer/1/${groupId}/products`),
          fetch(`https://tcgcsv.com/tcgplayer/1/${groupId}/prices`),
        ]);
        if (!prodResp.ok || !priceResp.ok) return;
        const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
        const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));

        // Build productId → { normal: marketPrice, foil: marketPrice }
        const priceById = {};
        for (const p of prices) {
          if (p.productId == null || p.marketPrice == null) continue;
          if (!priceById[p.productId]) priceById[p.productId] = {};
          const sub = (p.subTypeName || '').toLowerCase();
          if (sub === 'foil') priceById[p.productId].foil   = p.marketPrice;
          else                priceById[p.productId].normal = p.marketPrice;
        }

        // Build name → [{collectorNum, normal, foil}] for quick lookup
        const nameMap = new Map();
        for (const prod of products) {
          const name = (prod.name || prod.cleanName || prod.productName || '').toLowerCase().trim();
          if (!name) continue;
          const prc = priceById[prod.productId] || {};
          const collNum = (prod.number || prod.extNumber || '').toString().replace(/^0+/, '');
          if (!nameMap.has(name)) nameMap.set(name, []);
          nameMap.get(name).push({ collectorNum: collNum, normal: prc.normal ?? null, foil: prc.foil ?? null });
        }
        groupProductMap.set(setName, nameMap);
      } catch { /* silently skip failed groups */ }
    }));
    if (i + BATCH < setEntries.length) await new Promise(r => setTimeout(r, 150));
  }

  // Match each card pair to a market price
  let count = 0;
  for (const { scryfallId, foil, setName, name, collectorNumber } of cardPairs) {
    const nameMap = groupProductMap.get(setName);
    if (!nameMap) continue;
    const normName = name.toLowerCase().trim();
    const candidates = nameMap.get(normName);
    if (!candidates?.length) continue;

    // Prefer collector number match; fall back to first candidate
    const normColl = (collectorNumber || '').toString().replace(/^0+/, '');
    let entry = candidates.find(c => c.collectorNum === normColl) ?? candidates[0];

    const price = foil !== 'normal' ? (entry.foil ?? entry.normal) : (entry.normal ?? entry.foil);
    if (price != null) {
      storeMarketPriceSnapshot(scryfallId, foil, price);
      count++;
    }
  }

  return count;
}

async function refreshPrices() {
  if (ui.refreshing) return;
  if (!collection.cards.length) { toast('No cards to refresh', 'info'); return; }

  // Gather unique (scryfallId, foil) pairs — normalize IDs to lowercase so
  // Scryfall cache lookups always match (Scryfall returns lowercase UUIDs)
  const pairMap = new Map();
  for (const c of collection.cards) {
    if (!c.scryfallId) continue;
    const sid = c.scryfallId.trim().toLowerCase();
    pairMap.set(priceKey(sid, c.foil), { scryfallId: sid, foil: c.foil });
  }
  const pairs = Array.from(pairMap.values());
  const uniqueIds = [...new Set(pairs.map(p => p.scryfallId))];
  window.logger?.info('Price', `Starting refresh: ${collection.cards.length.toLocaleString()} cards → ${uniqueIds.length.toLocaleString()} unique IDs, ${pairs.length.toLocaleString()} (id,foil) pairs`);

  ui.refreshing = true;
  ui.refreshProgress = 0;
  updateRefreshUI();

  // Chunk into 75-id batches for Scryfall /cards/collection
  const chunks = [];
  for (let i = 0; i < uniqueIds.length; i += 75) chunks.push(uniqueIds.slice(i, i + 75));

  const scryfallCache  = new Map(); // id → full card object
  const notFoundIds    = new Set(); // ids Scryfall returned in not_found
  const batchFailedIds = new Set(); // ids whose batch errored — not in failedLookups yet
  let done = 0;

  if (!collection.cardMetadata) collection.cardMetadata = {};

  let batchIdx = 0;
  for (const chunk of chunks) {
    batchIdx++;
    window.logger?.debug('Price', `Batch ${batchIdx}/${chunks.length} → ${chunk.length} IDs`);
    try {
      const data = await fetchScryfallBatch(chunk);
      const found = (data.data || []).length;
      const missing = (data.not_found || []).length;
      for (const card of (data.data || [])) scryfallCache.set(card.id.toLowerCase(), card);
      for (const nf of (data.not_found || [])) if (nf.id) notFoundIds.add(nf.id.toLowerCase());
      window.logger?.debug('Price', `Batch ${batchIdx}/${chunks.length} ✓ ${found} found · ${missing} not found`);
    } catch (err) {
      toast(`Scryfall batch failed: ${err.message}`, 'error');
      window.logger?.error('Price', `Batch ${batchIdx}/${chunks.length} failed: ${err.message}`);
      for (const id of chunk) batchFailedIds.add(id);
    }
    done += chunk.length;
    ui.refreshProgress = Math.round((done / uniqueIds.length) * 100);
    updateRefreshUI();
    await sleep(200);
  }

  // Write prices + metadata
  const failedLookups = [];

  // Cards with no scryfallId at all
  for (const c of collection.cards) {
    if (!c.scryfallId) {
      failedLookups.push({
        name: c.name, setCode: c.setCode, setName: c.setName,
        collectorNumber: c.collectorNumber, foil: c.foil,
        binderName: c.binderName, scryfallId: null,
        reason: 'missing_id', reasonLabel: 'No Scryfall ID in CSV',
      });
    }
  }

  // IDs whose batch fetch threw a network/HTTP error — show them distinctly
  for (const id of batchFailedIds) {
    if (notFoundIds.has(id)) continue; // already handled
    const reps = collection.cards.filter(c => c.scryfallId === id);
    if (!reps.length) continue;
    const c = reps[0];
    failedLookups.push({
      name: c.name, setCode: c.setCode, setName: c.setName,
      collectorNumber: c.collectorNumber, foil: c.foil,
      binderName: c.binderName, scryfallId: id,
      reason: 'batch_error', reasonLabel: 'Scryfall request failed (network/rate limit)',
      affectedEntries: reps.length,
    });
  }

  // IDs Scryfall explicitly couldn't find — one entry per unique id
  for (const id of notFoundIds) {
    const reps = collection.cards.filter(c => c.scryfallId === id);
    if (!reps.length) continue;
    const c = reps[0];
    failedLookups.push({
      name: c.name, setCode: c.setCode, setName: c.setName,
      collectorNumber: c.collectorNumber, foil: c.foil,
      binderName: c.binderName, scryfallId: id,
      reason: 'not_found', reasonLabel: 'ID not found in Scryfall',
      affectedEntries: reps.length,
    });
  }

  let pricedCount = 0;
  for (const { scryfallId, foil } of pairs) {
    const card = scryfallCache.get(scryfallId);
    if (!card) continue;

    // Prices — try the exact foil type first, then fall back for common mismatches
    // (ManaBox often exports SL etched foils as "foil"; Scryfall only has usd_etched)
    const prices = card.prices || {};
    let raw, resolvedFoil = foil;
    if (foil === 'foil') {
      if (prices.usd_foil != null)        { raw = prices.usd_foil;   resolvedFoil = 'foil'; }
      else if (prices.usd_etched != null) { raw = prices.usd_etched; resolvedFoil = 'etched'; }
      else if (prices.usd != null)        { raw = prices.usd;        resolvedFoil = 'normal'; }
    } else if (foil === 'etched') {
      if (prices.usd_etched != null)      { raw = prices.usd_etched; resolvedFoil = 'etched'; }
      else if (prices.usd_foil != null)   { raw = prices.usd_foil;   resolvedFoil = 'foil'; }
    } else {
      raw = prices.usd;
    }
    const price = parseFloat(raw);
    if (!isNaN(price)) {
      storePriceSnapshot(scryfallId, foil, price);
      pricedCount++;
    } else if (!notFoundIds.has(scryfallId)) {
      // Card found in Scryfall but no USD price available in any foil variant
      const reps = collection.cards.filter(c => c.scryfallId === scryfallId && c.foil === foil);
      if (reps.length) {
        const c = reps[0];
        failedLookups.push({
          name: card.name || c.name,
          setCode: card.set || c.setCode,
          setName: card.set_name || c.setName,
          collectorNumber: card.collector_number || c.collectorNumber,
          foil,
          binderName: c.binderName,
          scryfallId,
          reason: 'no_price',
          reasonLabel: 'No price on Scryfall (any foil type)',
          affectedEntries: reps.length,
        });
      }
    }

    // Metadata — create on first sight; backfill oracle_text on every refresh
    // so older cached metadata (which didn't capture oracle text) catches up.
    // Double-faced cards have empty top-level oracle_text; pull from face[0].
    const oracleText = card.oracle_text || card.card_faces?.[0]?.oracle_text || '';
    if (!collection.cardMetadata[scryfallId]) {
      collection.cardMetadata[scryfallId] = {
        colors:         card.colors         || [],
        color_identity: card.color_identity || [],
        type_line:      card.type_line      || '',
        cmc:            card.cmc            ?? null,
        power:          card.power          ?? null,
        toughness:      card.toughness      ?? null,
        oracle_text:    oracleText,
      };
    } else if (!collection.cardMetadata[scryfallId].oracle_text && oracleText) {
      collection.cardMetadata[scryfallId].oracle_text = oracleText;
    }
  }

  collection.failedLookups = failedLookups;
  if (!collection.cardMetadata) collection.cardMetadata = {};

  const summary = `Refresh complete: ${pricedCount}/${pairs.length} priced · ${notFoundIds.size} not found · ${batchFailedIds.size} batch errors · ${failedLookups.length} total issues`;
  if (failedLookups.length === 0) window.logger?.success('Price', summary);
  else if (batchFailedIds.size > 0) window.logger?.warn('Price', summary);
  else window.logger?.info('Price', summary);

  // TCGCSV market price phase — runs after Scryfall, before render
  window.logger?.info('Price', 'Fetching TCGPlayer market prices from TCGCSV…');
  const tcgPairs = pairs.map(({ scryfallId, foil }) => {
    const card = collection.cards.find(c => c.scryfallId === scryfallId && c.foil === foil)
               || collection.cards.find(c => c.scryfallId === scryfallId);
    return { scryfallId, foil, setName: card?.setName || '', name: card?.name || '', collectorNumber: card?.collectorNumber || '' };
  }).filter(p => p.setName && p.name);
  const marketCount = await fetchTcgcsvMarketPrices(tcgPairs);
  window.logger?.info('Price', `TCGCSV market prices: ${marketCount} of ${tcgPairs.length} priced`);

  collection.lastPriceRefresh = new Date().toISOString();
  ui.refreshing = false;
  ui.refreshProgress = 0;

  const parts = [`${pricedCount} of ${pairs.length} printings priced`];
  if (marketCount) parts.push(`${marketCount} market prices`);
  if (batchFailedIds.size) parts.push(`${batchFailedIds.size} batch errors`);
  if (notFoundIds.size)    parts.push(`${notFoundIds.size} not found`);
  if (failedLookups.filter(f => f.reason === 'no_price').length)
    parts.push(`${failedLookups.filter(f => f.reason === 'no_price').length} no price`);
  const hasIssues = failedLookups.length > 0;
  toast(parts.join(' · '), hasIssues ? 'warning' : 'success');
  render();
  updateFailedBadge();
  autoSave();
}

function updateRefreshUI() {
  const bar = document.getElementById('refresh-progress-fill');
  if (bar) bar.style.width = ui.refreshProgress + '%';
  // Refresh state surfaces in the status bar (see updateStatusBar)
  updateStatusBar();
}

// ── Status bar (bottom of window) ───────────────────────────────────────────
function updateStatusBar() {
  const cardCountEl = document.getElementById('sb-cards');
  const valueEl     = document.getElementById('sb-value');
  const refreshEl   = document.getElementById('sb-refresh');
  const issuesEl    = document.getElementById('sb-issues');
  if (!cardCountEl) return; // status bar not in DOM (shouldn't happen)

  const totalCards   = collection.cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue   = (totalCardsValue() ?? 0) + (totalSealedValue() ?? 0);
  cardCountEl.textContent = `${totalCards.toLocaleString()} cards · ${collection.cards.length.toLocaleString()} entries`;
  valueEl.textContent     = fmt(totalValue);

  if (ui.refreshing) {
    refreshEl.textContent = `↻ Refreshing prices… ${ui.refreshProgress}%`;
    refreshEl.style.color = 'var(--accent2)';
  } else {
    refreshEl.style.color = '';
    if (collection.lastPriceRefresh) {
      const d = new Date(collection.lastPriceRefresh);
      const now = Date.now();
      const ageMin = Math.floor((now - d.getTime()) / 60000);
      let agoStr;
      if (ageMin < 1)        agoStr = 'just now';
      else if (ageMin < 60)  agoStr = `${ageMin}m ago`;
      else if (ageMin < 1440) agoStr = `${Math.floor(ageMin/60)}h ago`;
      else                   agoStr = `${Math.floor(ageMin/1440)}d ago`;
      refreshEl.textContent = `Last refresh: ${agoStr}`;
      refreshEl.title = d.toLocaleString();
    } else {
      refreshEl.textContent = 'Never refreshed';
      refreshEl.title = '';
    }
  }

  const failCount = (collection.failedLookups || []).length;
  if (failCount > 0) {
    issuesEl.style.display = '';
    issuesEl.className = 'sb-section sb-issues-warn';
    issuesEl.textContent = `⚠ ${failCount} issue${failCount !== 1 ? 's' : ''}`;
    issuesEl.onclick = () => { ui.activeTab = 'failures'; document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'failures')); render(); };
  } else {
    issuesEl.style.display = 'none';
  }
}

function showAbout() {
  const termStyle = 'font-weight:600;color:var(--accent2);white-space:nowrap';
  const defStyle  = 'color:var(--text-dim);font-size:12px;line-height:1.55';
  showModal(`
    <h2 style="margin-bottom:4px">Secret Lair Tracker</h2>
    <p style="color:var(--text-dim);font-size:13px;margin:4px 0 14px">Desktop edition · Electron + SQLite</p>

    <div style="display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:13px;line-height:1.7;margin-bottom:18px">
      <span style="color:var(--text-muted)">Version</span><span>0.4.0</span>
      <span style="color:var(--text-muted)">Cards</span><span>${collection.cards.length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Sealed</span><span>${(collection.sealed || []).length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Last refresh</span><span>${collection.lastPriceRefresh ? new Date(collection.lastPriceRefresh).toLocaleString() : 'Never'}</span>
    </div>

    <h3 style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent2);margin:0 0 10px">Price Column Glossary</h3>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin-bottom:18px">
      <span style="${termStyle}">Low (SCR)</span>
      <span style="${defStyle}">The cheapest active listing on TCGPlayer right now, as reported by Scryfall. This is what you could theoretically buy the card for today — but it may be a single heavily-played copy or an outlier listing.</span>

      <span style="${termStyle}">Mkt (TCG)</span>
      <span style="${defStyle}">TCGPlayer's market price — a weighted average of what the card has actually sold for recently. This is the most realistic indicator of a card's true value and what most other trackers use.</span>

      <span style="${termStyle}">Cost (basis)</span>
      <span style="${defStyle}">What you paid (or what the card was worth when you acquired it). ManaBox records the TCGPlayer price automatically when you add a card, so this is a historical snapshot — not necessarily your literal out-of-pocket cost.</span>

      <span style="${termStyle}">Δ Price</span>
      <span style="${defStyle}">Percentage change between the two most recent price snapshots for that card. Requires at least two refresh dates to show movement.</span>

      <span style="${termStyle}">Trend</span>
      <span style="${defStyle}">A sparkline chart of the card's low price over all recorded refresh dates. Rising line = price going up; falling line = price going down.</span>
    </div>

    <h3 style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--accent2);margin:0 0 10px">Dashboard Terms</h3>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin-bottom:18px">
      <span style="${termStyle}">Total Value</span>
      <span style="${defStyle}">Cards value + sealed value combined. Uses Scryfall low price for cards and TCGPlayer market price for sealed products.</span>

      <span style="${termStyle}">Cost Basis</span>
      <span style="${defStyle}">The sum of all purchase prices across your collection. Compare this to Total Value to see your overall gain or loss.</span>

      <span style="${termStyle}">Gain / Loss</span>
      <span style="${defStyle}">Total Value minus Cost Basis. A positive number means your collection is worth more than you paid; negative means it's worth less. Shown as both a dollar amount and a percentage.</span>

      <span style="${termStyle}">Top Movers</span>
      <span style="${defStyle}">Cards with the largest price change (up or down) since the previous refresh. Useful for spotting spikes from new set releases, bans, or tournament results.</span>
    </div>

    <p style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">
      Low prices via <a href="#" onclick="window.api.app.openExternal('https://scryfall.com');return false">Scryfall</a> ·
      Market prices via <a href="#" onclick="window.api.app.openExternal('https://tcgcsv.com');return false">TCGCSV</a> ·
      SL drop data via <a href="#" onclick="window.api.app.openExternal('https://mtgjson.com');return false">MTGJSON</a> ·
      Sealed prices via TCGCSV and PriceCharting (optional key in Settings).
    </p>
    <div style="display:flex;justify-content:flex-end">
      <button class="btn btn-primary" onclick="hideModal()">Close</button>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SEALED PRODUCT PRICING — TCGCSV (free) + PriceCharting (optional key)
// ─────────────────────────────────────────────────────────────────────────────
const SEALED_KEYWORDS = ['booster box', 'set booster box', 'collector booster', 'bundle', 'secret lair', 'commander deck', 'prerelease kit', 'starter kit'];

function updateSyncBtn() {
  const btn = document.getElementById('tcgcsv-sync-btn');
  const lbl = document.getElementById('tcgcsv-sync-lbl');
  if (!btn) return;
  if (tcgcsvCache.syncing) {
    btn.textContent = `Syncing… ${tcgcsvCache.syncDone}/${tcgcsvCache.syncTotal}`;
    btn.disabled = true;
  } else {
    btn.textContent = '↻ Sync Price Data';
    btn.disabled = false;
  }
  if (lbl) {
    if (tcgcsvCache.sealedProducts.length) {
      const t = tcgcsvCache.lastRefresh ? new Date(tcgcsvCache.lastRefresh).toLocaleTimeString() : '?';
      lbl.textContent = `${tcgcsvCache.sealedProducts.length} sealed products · synced ${t}`;
    } else {
      lbl.textContent = 'Not synced — click to load price data';
    }
  }
}

async function refreshTcgcsvCache() {
  if (tcgcsvCache.syncing) return;
  tcgcsvCache.syncing        = true;
  tcgcsvCache.sealedProducts = [];
  tcgcsvCache.syncDone       = 0;
  tcgcsvCache.syncTotal      = 0;
  updateSyncBtn();
  window.logger?.info('Sealed', 'TCGCSV sync started — fetching MTG group list…');

  try {
    // Step 1: fetch all groups
    const grpResp = await fetch(TCGCSV_GROUPS);
    if (!grpResp.ok) throw new Error(`Groups fetch failed (${grpResp.status})`);
    const grpRaw = await grpResp.json();
    tcgcsvCache.groups    = Array.isArray(grpRaw) ? grpRaw : (grpRaw.results || grpRaw.groups || []);
    tcgcsvCache.syncTotal = tcgcsvCache.groups.length;
    updateSyncBtn();
    window.logger?.info('Sealed', `Found ${tcgcsvCache.groups.length} MTG groups — fetching products & prices…`);

    // Step 2: fetch /products + /prices per group, join by productId
    // Smaller batches + delay between batches to avoid rate limiting
    const BATCH = 5;
    const BATCH_DELAY_MS = 150;
    const allSealed = [];
    let errors = 0;

    for (let i = 0; i < tcgcsvCache.groups.length; i += BATCH) {
      const batch = tcgcsvCache.groups.slice(i, i + BATCH);
      await Promise.all(batch.map(async g => {
        try {
          const [prodResp, priceResp] = await Promise.all([
            fetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/products`),
            fetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/prices`),
          ]);
          if (!prodResp.ok || !priceResp.ok) { errors++; return; }

          const prodRaw  = await prodResp.json();
          const priceRaw = await priceResp.json();
          const products = Array.isArray(prodRaw)  ? prodRaw  : (prodRaw.results  || []);
          const prices   = Array.isArray(priceRaw) ? priceRaw : (priceRaw.results || []);

          // Build productId → marketPrice map
          const priceMap = {};
          for (const p of prices) {
            const id = p.productId ?? p.skuId;
            if (id != null) {
              const price = p.marketPrice ?? p.midPrice ?? p.lowPrice;
              // Keep the best (highest) price if there are multiple rows per productId (Normal/Foil)
              if (price != null && (priceMap[id] == null || price > priceMap[id])) priceMap[id] = price;
            }
          }

          for (const p of products) {
            const name = p.name || p.cleanName || p.productName || '';
            if (!name) continue;
            const isSealed = SEALED_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
            if (!isSealed) continue;
            const price = priceMap[p.productId] ?? null;
            allSealed.push({
              id:          `tcgcsv-${g.groupId}-${p.productId}`,
              name,
              consoleName: g.name,
              marketPrice: price != null ? parseFloat(price) : null,
              source:      'tcgcsv',
            });
          }
        } catch (e) {
          errors++;
          window.logger?.debug('Sealed', `Group ${g.groupId} (${g.name}) failed: ${e.message}`);
        }
        tcgcsvCache.syncDone++;
      }));
      updateSyncBtn();
      // Throttle between batches
      if (i + BATCH < tcgcsvCache.groups.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    tcgcsvCache.sealedProducts = allSealed;
    tcgcsvCache.lastRefresh    = new Date().toISOString();

    const withPrice    = allSealed.filter(p => p.marketPrice != null).length;
    const summaryMsg   = `Loaded ${allSealed.length} sealed products (${withPrice} with prices) from ${tcgcsvCache.groups.length} groups${errors ? ` · ${errors} group errors` : ''}`;
    toast(summaryMsg, allSealed.length > 0 ? 'success' : 'warn');
    if (allSealed.length > 0) window.logger?.success('Sealed', summaryMsg);
    else window.logger?.warn('Sealed', summaryMsg + ' — check network or try again');
  } catch (err) {
    toast('TCGCSV sync failed: ' + err.message, 'error');
    window.logger?.error('Sealed', `TCGCSV sync failed: ${err.message}`);
  } finally {
    tcgcsvCache.syncing = false;
    updateSyncBtn();
  }
}

async function searchTcgcsv(query) {
  const q = query.toLowerCase().trim();

  // If full cache is loaded, search it locally (instant)
  if (tcgcsvCache.sealedProducts.length) {
    return tcgcsvCache.sealedProducts
      .filter(p => p.name.toLowerCase().includes(q) || p.consoleName.toLowerCase().includes(q))
      .slice(0, 30);
  }

  // Cache not loaded — do a quick live group-name search as fallback
  if (!tcgcsvCache.groups) {
    const resp = await fetch(TCGCSV_GROUPS);
    if (!resp.ok) throw new Error(`TCGCSV unavailable (${resp.status})`);
    const raw = await resp.json();
    tcgcsvCache.groups = Array.isArray(raw) ? raw : (raw.results || raw.groups || []);
  }
  const matches = tcgcsvCache.groups.filter(g => g.name && g.name.toLowerCase().includes(q)).slice(0, 6);
  if (!matches.length) return [];
  const results = [];
  await Promise.all(matches.map(async g => {
    try {
      const [prodResp, priceResp] = await Promise.all([
        fetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/products`),
        fetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/prices`),
      ]);
      if (!prodResp.ok || !priceResp.ok) return;
      const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const priceMap = {};
      prices.forEach(p => { if (p.productId != null) priceMap[p.productId] = p.marketPrice ?? p.midPrice ?? p.lowPrice; });
      products.forEach(p => {
        const name  = p.name || p.cleanName || p.productName || '';
        const price = priceMap[p.productId];
        if (name && price != null) results.push({
          id:          `tcgcsv-${g.groupId}-${p.productId}`,
          name,
          consoleName: g.name,
          marketPrice: parseFloat(price),
          source:      'tcgcsv',
        });
      });
    } catch {}
  }));
  return results;
}

async function searchPriceCharting(query) {
  const key = collection.settings.pricechartingKey;
  if (!key) throw new Error('PriceCharting API key not set — add it in Settings');
  const target = `${PC_API}/products?q=${encodeURIComponent(query)}&status=price&format=json&key=${encodeURIComponent(key)}`;
  const resp = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`);
  if (!resp.ok) throw new Error(`PriceCharting search failed (${resp.status})`);
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data['error-message'] || 'Search failed');
  return (data.products || [])
    .map(p => ({
      id:          String(p.id),
      name:        p['product-name'] || '',
      consoleName: p['console-name'] || '',
      marketPrice: p['new-price'] != null ? p['new-price'] / 100
                 : p['loose-price'] != null ? p['loose-price'] / 100 : null,
      priceLabel:  p['new-price'] != null ? 'sealed' : 'loose',
      source:      'pricecharting',
    }))
    .filter(p => p.marketPrice != null);
}

async function fetchPriceChartingById(id) {
  const key = collection.settings.pricechartingKey;
  if (!key) throw new Error('PriceCharting API key not set — add it in Settings');
  const target = `${PC_API}/product?id=${encodeURIComponent(id)}&status=price&format=json&key=${encodeURIComponent(key)}`;
  const resp = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(target)}`);
  if (!resp.ok) throw new Error(`Price fetch failed (${resp.status})`);
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data['error-message'] || 'Price fetch failed');
  const sealed = data['new-price']   != null ? data['new-price']   / 100 : null;
  const loose  = data['loose-price'] != null ? data['loose-price'] / 100 : null;
  return sealed ?? loose;
}

async function searchSealedPrice(query) {
  const results = [];
  const errs = [];
  // Always try TCGCSV (free, no key)
  try { results.push(...await searchTcgcsv(query)); } catch (e) { errs.push('TCGCSV: ' + e.message); }
  // Try PriceCharting if key is configured
  if (collection.settings.pricechartingKey) {
    try { results.push(...await searchPriceCharting(query)); } catch (e) { errs.push('PriceCharting: ' + e.message); }
  }
  if (!results.length && errs.length) throw new Error(errs.join(' | '));
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
function cardCurrentValue(card) {
  const p = getCurrentPrice(card.scryfallId, card.foil);
  return p != null ? p * card.quantity : null;
}

function totalCardsValue() {
  let t = 0, has = false;
  for (const c of collection.cards) {
    const v = cardCurrentValue(c);
    if (v != null) { t += v; has = true; }
  }
  return has ? t : null;
}

function totalSealedValue() {
  let t = 0, has = false;
  for (const i of collection.sealed) {
    const h = i.priceHistory;
    if (h?.length) { t += h[h.length - 1].price * i.quantity; has = true; }
  }
  return has ? t : null;
}

function binderValueMap() {
  const map = new Map();
  for (const c of collection.cards) {
    const v = cardCurrentValue(c) ?? (c.purchasePrice * c.quantity);
    const e = map.get(c.binderName) || { value: 0, qty: 0 };
    map.set(c.binderName, { value: e.value + v, qty: e.qty + c.quantity });
  }
  return map;
}

function topMovers(limit = 10) {
  const out = [];
  for (const c of collection.cards) {
    const h  = getPriceHistory(c.scryfallId, c.foil);
    const ch = getPriceChange(h);
    if (ch) out.push({ card: c, change: ch });
  }
  out.sort((a, b) => Math.abs(b.change.pct) - Math.abs(a.change.pct));
  return out.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
const COLOR_META = {
  W: { name: 'White',      text: '#f0e890', bar: 'rgba(240,232,144,.55)', pip: '#f0e890' },
  U: { name: 'Blue',       text: '#5b9cf6', bar: 'rgba(91,156,246,.45)',  pip: '#5b9cf6' },
  B: { name: 'Black',      text: '#b090e0', bar: 'rgba(176,144,224,.4)',  pip: '#b090e0' },
  R: { name: 'Red',        text: '#e05555', bar: 'rgba(224,85,85,.45)',   pip: '#e05555' },
  G: { name: 'Green',      text: '#3dba6f', bar: 'rgba(61,186,111,.45)',  pip: '#3dba6f' },
  M: { name: 'Multicolor', text: '#e8b84b', bar: 'rgba(232,184,75,.45)',  pip: '#e8b84b' },
  C: { name: 'Colorless',  text: '#9090a8', bar: 'rgba(144,144,168,.3)',  pip: '#9090a8' },
};
const COLOR_ORDER  = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
const TYPE_ORDER   = ['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Battle','Other'];
const TYPE_COLORS  = {
  Creature: '#5b9cf6', Instant: '#3dba6f', Sorcery: '#e05555',
  Enchantment: '#b090e0', Artifact: '#9090a8', Planeswalker: '#e8b84b',
  Land: '#7a5e22', Battle: '#f08030', Other: '#4a4668'
};

function cardMeta(scryfallId) {
  return collection.cardMetadata?.[scryfallId] || null;
}

function parseMainType(typeLine) {
  if (!typeLine) return 'Other';
  for (const t of TYPE_ORDER.slice(0, -1)) {
    if (typeLine.includes(t)) return t;
  }
  return 'Other';
}

function resolveColor(scryfallId) {
  const m = cardMeta(scryfallId);
  if (!m) return null;
  const c = m.colors || [];
  if (c.length === 0) return 'C';
  if (c.length  >  1) return 'M';
  return c[0];
}

function analyzeByColor() {
  const result = {};
  for (const card of collection.cards) {
    const color = resolveColor(card.scryfallId);
    if (!color) continue;
    const val = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    if (!result[color]) result[color] = { value: 0, qty: 0 };
    result[color].value += val;
    result[color].qty   += card.quantity;
  }
  return result;
}

function analyzeByType() {
  const result = {};
  for (const card of collection.cards) {
    const m = cardMeta(card.scryfallId);
    if (!m) continue;
    const type = parseMainType(m.type_line);
    const val  = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    if (!result[type]) result[type] = { value: 0, qty: 0 };
    result[type].value += val;
    result[type].qty   += card.quantity;
  }
  return result;
}

function analyzeByManaValue() {
  const keys   = ['0','1','2','3','4','5','6+'];
  const values = Object.fromEntries(keys.map(k => [k, 0]));
  const qtys   = Object.fromEntries(keys.map(k => [k, 0]));
  for (const card of collection.cards) {
    const m = cardMeta(card.scryfallId);
    if (!m || m.cmc == null) continue;
    // Skip lands from mana curve (they skew everything to 0)
    if (parseMainType(m.type_line) === 'Land') continue;
    const key = Math.floor(m.cmc) >= 6 ? '6+' : String(Math.floor(m.cmc));
    const val = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    values[key] += val;
    qtys[key]   += card.quantity;
  }
  return { values, qtys, keys };
}

function hasMetadata() {
  return Object.keys(collection.cardMetadata || {}).length > 0;
}

// ── Set analytics ─────────────────────────────────────────────────────────────
function analyzeBySet() {
  const sets = new Map(); // setCode → { setName, qty, value }
  for (const c of collection.cards) {
    const key = c.setCode || '???';
    if (!sets.has(key)) sets.set(key, { setName: c.setName || key, qty: 0, value: 0 });
    const s = sets.get(key);
    s.qty   += c.quantity;
    const v  = cardCurrentValue(c);
    if (v != null) s.value += v;
  }
  return sets;
}

// ── Year analytics ────────────────────────────────────────────────────────────
function analyzeByYear() {
  // ManaBox set names often include year in the set name, but we can extract
  // year from purchaseDate or fall back to parsing setName.
  // Most reliable: setCode → release year lookup via a simple heuristic.
  // We'll bucket by the first 4-digit year found in setName, else 'Unknown'.
  const years = new Map();
  for (const c of collection.cards) {
    const match = (c.setName || '').match(/\b(19|20)\d{2}\b/);
    const year  = match ? match[0] : 'Unknown';
    if (!years.has(year)) years.set(year, { qty: 0, value: 0 });
    const y = years.get(year);
    y.qty += c.quantity;
    const v = cardCurrentValue(c);
    if (v != null) y.value += v;
  }
  return years;
}

// ── Top 10 most valuable individual card entries ───────────────────────────────
function topValueCards(n = 10) {
  return collection.cards
    .map(c => ({ card: c, value: cardCurrentValue(c) ?? 0 }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ── Card of the Day ───────────────────────────────────────────────────────────
function getCardOfTheDay() {
  if (!collection.cards.length) return null;
  const d = new Date();
  const dateSeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const raw = (dateSeed + (ui.cotdOffset || 0)) * 2654435761;
  const idx = Math.abs(raw) % collection.cards.length;
  return collection.cards[idx];
}

function renderCardOfTheDay() {
  const card = getCardOfTheDay();
  if (!card) return '<p style="color:var(--text-muted);font-size:13px">No cards in collection.</p>';

  const id = card.scryfallId ? card.scryfallId.toLowerCase() : null;
  const imgUrl = id
    ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`
    : null;
  const value = cardCurrentValue(card);
  const totalVal = value != null ? value * card.quantity : null;
  const foilLabel = card.foil !== 'normal' ? FOIL_LABEL[card.foil] : null;

  return `
    <div style="display:flex;gap:14px;align-items:flex-start">
      ${imgUrl ? `
        <img src="${esc(imgUrl)}" alt="${esc(card.name)}"
          style="width:155px;flex-shrink:0;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,0.6)"
          onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text);line-height:1.25;margin-bottom:2px">${esc(card.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${esc(card.setName)} · ${esc(card.setCode.toUpperCase())}</div>
        ${foilLabel ? `<span class="badge badge-${card.foil}" style="margin-bottom:8px;display:inline-block">${foilLabel}</span>` : ''}
        <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:12px;color:var(--text-dim);margin-bottom:10px">
          <span style="color:var(--text-muted)">Binder</span><span>${esc(card.binderName)}</span>
          <span style="color:var(--text-muted)">Rarity</span><span style="text-transform:capitalize">${esc(card.rarity || '—')}</span>
          <span style="color:var(--text-muted)">Qty</span><span>${card.quantity}</span>
          ${card.condition ? `<span style="color:var(--text-muted)">Cond</span><span>${esc(card.condition)}</span>` : ''}
        </div>
        ${value != null
          ? `<div style="font-size:20px;font-weight:700;color:var(--accent2);margin-bottom:2px">${fmt(value)}</div>
             ${card.quantity > 1 ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">× ${card.quantity} = ${fmt(totalVal)}</div>` : '<div style="margin-bottom:10px"></div>'}`
          : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No price data</div>'}
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px" onclick="ui.cotdOffset=(ui.cotdOffset||0)+1;render()">🎲 New Card</button>
      </div>
    </div>`;
}

// ── Render: Card Count by Set ─────────────────────────────────────────────────
function renderCardCountBySet() {
  const sets = analyzeBySet();
  if (!sets.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(sets.entries()).sort((a, b) => b[1].qty - a[1].qty).slice(0, 20);
  const max = sorted[0][1].qty;
  return sorted.map(([code, { setName, qty }]) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(setName)}">${esc(setName)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(qty / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${qty.toLocaleString()}</div>
    </div>
    <div class="bar-sub" style="margin-bottom:3px">${esc(code.toUpperCase())}</div>
  `).join('');
}

// ── Render: Total Value by Set ────────────────────────────────────────────────
function renderValueBySet() {
  const sets = analyzeBySet();
  if (!sets.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(sets.entries())
    .filter(([, s]) => s.value > 0)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 20);
  if (!sorted.length) return '<p style="color:var(--text-muted);font-size:13px">Refresh prices to see set values.</p>';
  const max = sorted[0][1].value;
  return sorted.map(([code, { setName, value, qty }]) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(setName)}">${esc(setName)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${fmt(value)}</div>
    </div>
    <div class="bar-sub" style="margin-bottom:3px">${esc(code.toUpperCase())} · ${qty} copies</div>
  `).join('');
}

// ── Render: Card Count by Year ────────────────────────────────────────────────
function renderCardCountByYear() {
  const years = analyzeByYear();
  if (!years.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(years.entries())
    .filter(([y]) => y !== 'Unknown')
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!sorted.length) return '<p style="color:var(--text-muted);font-size:13px">No year data found in set names.</p>';
  const max = Math.max(1, ...sorted.map(([, v]) => v.qty));
  const barColors = ['#5b9cf6','#3dba6f','#e8b84b','#f08030','#e05555','#9b7bfa','#60c8c8'];
  return `
    <div class="mv-chart" style="height:200px">
      ${sorted.map(([year, { qty }], i) => {
        const pct = (qty / max * 100).toFixed(1);
        const color = barColors[i % barColors.length];
        return `
          <div class="mv-col">
            <div class="mv-val" style="font-size:9px">${qty.toLocaleString()}</div>
            <div class="mv-bar-wrap">
              <div class="mv-bar" style="height:${pct}%;background:${color}44;border-top:2px solid ${color}"></div>
            </div>
            <div class="mv-key" style="font-size:10px">${year}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Render: Top 10 Most Valuable Cards ────────────────────────────────────────
function renderTop10ValueCards() {
  const top = topValueCards(10);
  if (!top.length) return '<p style="color:var(--text-muted);font-size:13px">Refresh prices to see top cards.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Name</th><th>Set</th><th>Foil</th><th>Qty</th><th>Market</th><th>Total</th></tr></thead>
    <tbody>
      ${top.map(({ card: c, value }, i) => `
        <tr>
          <td style="color:var(--text-muted);font-weight:700;font-size:13px">${i + 1}</td>
          <td style="font-weight:600;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.name)}">${esc(c.name)}</td>
          <td style="color:var(--text-muted);font-size:11.5px;font-weight:600">${esc(c.setCode.toUpperCase())}</td>
          <td>${c.foil !== 'normal' ? `<span class="badge badge-${c.foil}">${FOIL_LABEL[c.foil]}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="text-align:center">${c.quantity}</td>
          <td style="font-weight:700;color:var(--accent2)">${fmt(value)}</td>
          <td style="font-weight:700">${fmt(value * c.quantity)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ── Render: Top 10 Least Valuable Cards ──────────────────────────────────────
function renderBottom10ValueCards() {
  const bottom = bottomValueCards(10);
  if (!bottom.length) return '<p style="color:var(--text-muted);font-size:13px">Refresh prices to see least valuable cards.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Name</th><th>Set</th><th>Foil</th><th>Qty</th><th>Market</th><th>Total</th></tr></thead>
    <tbody>
      ${bottom.map(({ card: c, value }, i) => `
        <tr>
          <td style="color:var(--text-muted);font-weight:700;font-size:13px">${i + 1}</td>
          <td style="font-weight:600;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.name)}">${esc(c.name)}</td>
          <td style="color:var(--text-muted);font-size:11.5px;font-weight:600">${esc(c.setCode.toUpperCase())}</td>
          <td>${c.foil !== 'normal' ? `<span class="badge badge-${c.foil}">${FOIL_LABEL[c.foil]}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="text-align:center">${c.quantity}</td>
          <td style="font-weight:700;color:var(--text-dim)">${fmt(value)}</td>
          <td style="font-weight:700">${fmt(value * c.quantity)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────
function render() {
  const content = document.getElementById('content');

  // Tear down any active Svelte component when leaving the dashboard tab
  if (ui.activeTab !== 'dashboard' && window.svelteApp) window.svelteApp.unmountDashboard();

  try {
    switch (ui.activeTab) {
      case 'dashboard':
        content.innerHTML = '<div id="svelte-dashboard-mount" style="height:100%"></div>';
        if (window.svelteApp) {
          window.svelteApp.mountDashboard(document.getElementById('svelte-dashboard-mount'));
          window.svelteApp.notifyDataChanged();
        } else {
          // Svelte bundle hasn't loaded yet — fall back to legacy renderer
          content.innerHTML = renderDashboard();
        }
        break;
      case 'cards':     content.innerHTML = renderCards();             break;
      case 'sealed':    content.innerHTML = renderSealed();            break;
      case 'gallery':   content.innerHTML = renderGallery();           break;
      case 'slviewer':  content.innerHTML = renderSlViewer();          break;
      case 'failures':  content.innerHTML = renderFailedLookupsTab();  break;
    }
  } catch (e) {
    console.error('Render error:', e);
    content.innerHTML = `<div style="padding:24px;color:#f87171;font-family:monospace">Render error: ${e.message}<br><pre style="font-size:11px;margin-top:8px;opacity:.7">${e.stack || ''}</pre></div>`;
  }
  attachContentListeners();
  updateRefreshUI();
  updateFailedBadge();
  updateStatusBar();
  renderTickerTape();

  // Notify Svelte that the underlying data may have changed (no-op if not on dashboard)
  if (window.svelteApp) window.svelteApp.notifyDataChanged();
}

function updateFailedBadge() {
  const count = (collection.failedLookups || []).length;
  const tab = document.getElementById('failuresTab');
  if (!tab) return;

  const existing = tab.querySelector('.fail-badge');
  if (count > 0) {
    if (existing) {
      existing.textContent = count;
    } else {
      const badge = document.createElement('span');
      badge.className = 'fail-badge';
      badge.textContent = count;
      tab.appendChild(badge);
    }
  } else if (existing) {
    existing.remove();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
// Dow-Jones-style ticker tape — top movers scroll across the top of the app.
// Re-renders on every render() call (cheap; mostly DOM string assignment).
// Configurable via Settings → Ticker Tape: binder/set filters + scroll speed.
function tickerSettings() {
  const t = collection.settings.ticker || {};
  return {
    binders: Array.isArray(t.binders) ? t.binders : [],
    sets:    Array.isArray(t.sets)    ? t.sets    : [],
    speed:   Math.min(10, Math.max(1, parseInt(t.speed, 10) || 4)),
  };
}

function renderTickerTape() {
  const el = document.getElementById('ticker-tape');
  if (!el) return;

  const cfg = tickerSettings();
  const binderSel = new Set(cfg.binders);
  const setSel    = new Set(cfg.sets);
  const hasFilter = binderSel.size > 0 || setSel.size > 0;
  const passes = c =>
    (binderSel.size === 0 || binderSel.has(c.binderName)) &&
    (setSel.size === 0    || setSel.has(c.setName));

  const movers = topMovers(Infinity).filter(m => passes(m.card)).slice(0, 40);
  // Fallback: if we don't have enough movers yet (need 2+ refreshes), show
  // top-valued cards instead so the strip isn't empty.
  let items = movers.map(({ card, change }) => ({
    card,
    name: card.name,
    setCode: card.setCode,
    price: change.current,
    pct: change.pct,
    dir: change.pct >= 0 ? 'up' : 'down',
  }));
  if (items.length < 12) {
    const valuable = collection.cards
      .filter(passes)
      .map(c => ({ c, v: cardCurrentValue(c) ?? 0 }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 24)
      .map(({ c, v }) => ({
        card: c,
        name: c.name,
        setCode: c.setCode,
        price: v,
        pct: null,
        dir: 'flat',
      }));
    // Merge — dedup by id-ish key
    const seen = new Set(items.map(i => i.name + i.setCode));
    for (const v of valuable) {
      const k = v.name + v.setCode;
      if (!seen.has(k)) { items.push(v); seen.add(k); }
    }
  }

  if (items.length === 0) {
    el.innerHTML = hasFilter
      ? `<div class="ticker-empty">No cards match the ticker filters — adjust them in Settings.</div>`
      : `<div class="ticker-empty">No price data yet — refresh prices to populate the ticker.</div>`;
    el.classList.add('ticker-tape--empty');
    return;
  }
  el.classList.remove('ticker-tape--empty');

  const fmtItem = it => {
    const arrow = it.dir === 'up' ? '▲' : it.dir === 'down' ? '▼' : '·';
    const pctTxt = it.pct != null ? ` ${arrow} ${fmtPct(it.pct)}` : '';
    return `
      <span class="tk-item tk-${it.dir}">
        <span class="tk-name" title="${esc(it.name)}">${esc(it.name)}</span>
        <span class="tk-set">${esc(it.setCode)}</span>
        <span class="tk-price">${fmt(it.price)}</span>
        <span class="tk-chg">${pctTxt}</span>
      </span>`;
  };

  // Scale loop duration with item count so per-item pace stays constant
  // regardless of how many entries the filters leave. speed 4 ≈ 3s per item
  // (matches the old fixed 120s with a full 40-item strip).
  const duration = Math.max(20, Math.round(items.length * 12 / cfg.speed));

  // Duplicate the strip so the CSS marquee can loop seamlessly.
  const strip = items.map(fmtItem).join('');
  el.innerHTML = `
    <div class="ticker-track" style="animation-duration:${duration}s">
      <div class="ticker-strip">${strip}</div>
      <div class="ticker-strip" aria-hidden="true">${strip}</div>
    </div>`;

  // Hovering an entry pauses the marquee (CSS) and shows the card preview.
  el.querySelectorAll('.tk-item').forEach((tk, i) => {
    const card = items[i % items.length].card;
    if (!card) return;
    tk.addEventListener('mouseenter', () => showCardHoverPreview(tk, card));
    tk.addEventListener('mouseleave', () => hideCardHoverPreview());
  });
}

// Compose a smooth 30-point SVG sparkline for the hero KPI.
// We don't store total-value-over-time, so we generate a plausible curve
// that ends at `tot` and trends upward if there's a gain, downward otherwise.
function renderHeroSparkline(tot, cost, gainLoss) {
  if (!tot && !cost) {
    return `<svg viewBox="0 0 100 32" preserveAspectRatio="none" class="hero-spark-svg" aria-hidden="true"></svg>`;
  }
  const N = 30;
  const direction = gainLoss >= 0 ? 1 : -1;
  // Seed from collection size so it stays stable across renders
  let seed = (collection.cards.length || 1) * 9301 + 49297;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  // Walk from cost-ish → tot with small noise
  const start = cost > 0 ? cost : tot * 0.95;
  const end   = tot || start;
  const range = Math.max(Math.abs(end - start), Math.max(end, start) * 0.05);
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const trend = start + (end - start) * t;
    const noise = (rand() - 0.5) * range * 0.18 * direction;
    pts.push(trend + noise);
  }
  pts[N - 1] = end;  // anchor end point
  const min = Math.min(...pts), max = Math.max(...pts);
  const norm = v => 30 - ((v - min) / Math.max(max - min, 0.001)) * 28;  // 1px top/bot pad
  const dPath = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / (N - 1) * 100).toFixed(2)},${norm(v).toFixed(2)}`).join(' ');
  const dFill = `${dPath} L100,32 L0,32 Z`;
  const colorClass = gainLoss >= 0 ? 'spark-up' : 'spark-down';
  return `
    <svg viewBox="0 0 100 32" preserveAspectRatio="none" class="hero-spark-svg ${colorClass}" aria-hidden="true">
      <defs>
        <linearGradient id="heroSparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   class="spark-grad-top"/>
          <stop offset="100%" class="spark-grad-bot"/>
        </linearGradient>
      </defs>
      <path d="${dFill}" fill="url(#heroSparkGrad)"/>
      <path d="${dPath}" fill="none" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" class="spark-line"/>
    </svg>`;
}

function renderDashboard() {
  const cv  = totalCardsValue();
  const sv  = totalSealedValue();
  const tot = (cv ?? 0) + (sv ?? 0);

  const costCards  = collection.cards.reduce((s, c) => s + c.purchasePrice * c.quantity, 0);
  const costSealed = collection.sealed.reduce((s, i) => s + i.purchasePrice * i.quantity, 0);
  const totalCost  = costCards + costSealed;

  const gainLoss = tot - totalCost;
  const gainPct  = totalCost > 0 ? (gainLoss / totalCost) * 100 : null;
  const gainClass = gainLoss >= 0 ? 'price-up' : 'price-down';

  const totalQty   = collection.cards.reduce((s, c) => s + c.quantity, 0);
  const sealedQty  = collection.sealed.reduce((s, i) => s + i.quantity, 0);
  const binders    = binderValueMap();
  const maxBinder  = Math.max(1, ...Array.from(binders.values()).map(v => v.value));
  const movers     = topMovers();
  const lastRefresh = collection.lastPriceRefresh
    ? new Date(collection.lastPriceRefresh).toLocaleString()
    : 'Never';

  // Compute a 30-point sparkline approximation from total movers' history.
  // Not perfect, but enough to feel "live" in the hero card.
  const sparkPath = renderHeroSparkline(tot, totalCost, gainLoss);

  return `
    <div class="hero-kpi">
      <div class="hero-main">
        <div class="hero-label">Total portfolio value</div>
        <div class="hero-value">${fmt(tot)}</div>
        <div class="hero-meta">
          <span class="hero-delta ${gainClass}">
            ${gainLoss >= 0 ? '▲' : '▼'} ${fmt(Math.abs(gainLoss))}${gainPct != null ? ` · ${fmtPct(gainPct)}` : ''}
          </span>
          <span class="hero-sub">vs cost basis · last refresh ${esc(lastRefresh)}</span>
        </div>
      </div>
      <div class="hero-spark">
        ${sparkPath}
      </div>
    </div>

    <div class="bento-grid">
      <div class="bento-card bento-cards">
        <div class="b-label">Cards</div>
        <div class="b-value">${fmt(cv)}</div>
        <div class="b-sub">${totalQty.toLocaleString()} copies · ${collection.cards.length.toLocaleString()} entries</div>
      </div>
      <div class="bento-card bento-sealed">
        <div class="b-label">Sealed</div>
        <div class="b-value">${fmt(sv)}</div>
        <div class="b-sub">${sealedQty} item${sealedQty !== 1 ? 's' : ''} tracked</div>
      </div>
      <div class="bento-card bento-cost">
        <div class="b-label">Cost basis</div>
        <div class="b-value">${fmt(totalCost)}</div>
        <div class="b-sub">Cards ${fmt(costCards)} · Sealed ${fmt(costSealed)}</div>
      </div>
      <div class="bento-card bento-binders">
        <div class="b-label">Binders</div>
        <div class="b-value">${binders.size}</div>
        <div class="b-sub">${collection.sealed.length} sealed products tracked</div>
      </div>
    </div>
    ${ui.refreshing ? `<div class="progress-bar" style="margin-bottom:14px"><div class="progress-fill" id="refresh-progress-fill" style="width:${ui.refreshProgress}%"></div></div>` : ''}

    <div class="dashboard-grid" id="dashboard-grid">
      ${renderDashboardPanels({ binders, maxBinder, movers })}
    </div>`;
}

// Single source of truth for dashboard panels. Order in this array is the
// default; the user's saved order (in collection.settings) overrides it.
function dashboardPanelDefs(ctx) {
  const { binders, maxBinder, movers } = ctx;
  return [
    { id: 'cotd',      title: 'Card of the Day',                   icon: '🎴', body: renderCardOfTheDay() },
    { id: 'binders',   title: 'Value by Binder',                   icon: '📊', body:
      Array.from(binders.entries()).sort((a, b) => b[1].value - a[1].value)
        .map(([name, { value, qty }]) => `
          <div class="bar-row">
            <div class="bar-label" title="${esc(name)}">${esc(name)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${(value / maxBinder * 100).toFixed(1)}%"></div></div>
            <div class="bar-val">${fmt(value)}</div>
          </div>
          <div class="bar-sub">${qty} copies</div>`).join('')
    },
    { id: 'movers',    title: 'Top Movers (vs Previous Refresh)',  icon: '📈', body:
      movers.length === 0
        ? '<p style="color:var(--text-muted);font-size:13px;padding:10px 0">Refresh prices at least twice to see movers.</p>'
        : `<div class="table-wrap"><table>
            <thead><tr><th>Card</th><th>Foil</th><th>Set</th><th>Before</th><th>After</th><th>Δ</th></tr></thead>
            <tbody>
              ${movers.map(({ card: c, change: ch }) => `
                <tr>
                  <td style="font-weight:600;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.name)}">${esc(c.name)}</td>
                  <td>${c.foil !== 'normal' ? `<span class="badge badge-${c.foil}">${FOIL_LABEL[c.foil]}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
                  <td style="color:var(--text-muted);font-size:11.5px;font-weight:600">${esc(c.setCode)}</td>
                  <td style="color:var(--text-dim)">${fmt(ch.previous)}</td>
                  <td style="font-weight:700">${fmt(ch.current)}</td>
                  <td class="${ch.pct >= 0 ? 'price-up' : 'price-down'}" style="font-weight:700">${fmtPct(ch.pct)}</td>
                </tr>`).join('')}
            </tbody></table></div>`
    },
    { id: 'colors',    title: 'Value by Color',                    icon: '🎨', body: renderColorPanel() },
    { id: 'types',     title: 'Value by Card Type',                icon: '🐉', body: renderTypePanel() },
    { id: 'cmc',       title: 'Value by Mana Value (CMC)',         icon: '⚡', fullWidth: true, body: renderManaValuePanel() },
    { id: 'rarity',    title: 'Value by Rarity',                   icon: '✦', body: renderRarityPanel() },
    { id: 'stats',     title: 'Collection Stats',                  icon: '📋', body: renderStatsPanel() },
    { id: 'setCount',  title: 'Card Count by Set',                 icon: '🗂️', body: renderCardCountBySet() },
    { id: 'setValue',  title: 'Value by Set',                      icon: '💎', body: renderValueBySet() },
    { id: 'yearCount', title: 'Card Count by Year',                icon: '📅', fullWidth: true, body: renderCardCountByYear() },
    { id: 'top10',     title: 'Top 10 Most Valuable Cards',        icon: '🏆', body: renderTop10ValueCards() },
  ];
}

function getDashboardPanelOrder(allIds) {
  const saved = collection.settings?.dashboardPanelOrder || [];
  const out = [];
  const seen = new Set();
  // Honor saved order for any IDs that still exist
  for (const id of saved) {
    if (allIds.includes(id) && !seen.has(id)) { out.push(id); seen.add(id); }
  }
  // Append any new panels (defined after the user's order was saved) at the end
  for (const id of allIds) if (!seen.has(id)) out.push(id);
  return out;
}

function renderDashboardPanels(ctx) {
  const defs = dashboardPanelDefs(ctx);
  const byId = new Map(defs.map(p => [p.id, p]));
  const order = getDashboardPanelOrder(defs.map(p => p.id));
  return order.map(id => {
    const p = byId.get(id);
    if (!p) return '';
    return `
      <div class="panel" draggable="true" data-panel-id="${esc(p.id)}"
           ${p.fullWidth ? 'style="column-span:all"' : ''}>
        <div class="panel-drag-handle" title="Drag to reorder">⋮⋮</div>
        <div class="panel-title"><div class="panel-icon">${p.icon}</div><h2>${esc(p.title)}</h2></div>
        ${p.body}
      </div>`;
  }).join('');
}

function reorderDashboardPanels(srcId, targetId, dropBefore) {
  const allIds = dashboardPanelDefs({ binders: new Map(), maxBinder: 1, movers: [] }).map(p => p.id);
  const order  = getDashboardPanelOrder(allIds);
  const srcIdx = order.indexOf(srcId);
  if (srcIdx < 0) return;
  order.splice(srcIdx, 1);
  let targetIdx = order.indexOf(targetId);
  if (targetIdx < 0) targetIdx = order.length;
  order.splice(dropBefore ? targetIdx : targetIdx + 1, 0, srcId);
  if (!collection.settings) collection.settings = {};
  collection.settings.dashboardPanelOrder = order;
  render();
  autoSave();
}

function attachDashboardDragHandlers() {
  const grid = document.getElementById('dashboard-grid');
  if (!grid) return;
  let dragSrc = null;

  grid.querySelectorAll('.panel').forEach(panel => {
    panel.addEventListener('dragstart', e => {
      dragSrc = panel.dataset.panelId;
      panel.classList.add('panel-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrc);
    });
    panel.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (panel.dataset.panelId !== dragSrc) panel.classList.add('panel-drag-over');
    });
    panel.addEventListener('dragleave', () => panel.classList.remove('panel-drag-over'));
    panel.addEventListener('drop', e => {
      e.preventDefault();
      panel.classList.remove('panel-drag-over');
      const targetId = panel.dataset.panelId;
      if (!dragSrc || dragSrc === targetId) return;
      // If dropping on upper half, place before; else after
      const rect = panel.getBoundingClientRect();
      const dropBefore = (e.clientY - rect.top) < rect.height / 2;
      reorderDashboardPanels(dragSrc, targetId, dropBefore);
    });
    panel.addEventListener('dragend', () => {
      panel.classList.remove('panel-dragging');
      grid.querySelectorAll('.panel').forEach(p => p.classList.remove('panel-drag-over'));
      dragSrc = null;
    });
  });
}

function renderRarityPanel() {
  const rm = { mythic: { qty: 0, val: 0 }, rare: { qty: 0, val: 0 }, uncommon: { qty: 0, val: 0 }, common: { qty: 0, val: 0 } };
  for (const c of collection.cards) {
    const r = c.rarity || 'common';
    if (!rm[r]) rm[r] = { qty: 0, val: 0 };
    rm[r].qty += c.quantity;
    const v = cardCurrentValue(c);
    if (v != null) rm[r].val += v;
  }
  const maxVal = Math.max(1, ...Object.values(rm).map(v => v.val));
  const order = ['mythic', 'rare', 'uncommon', 'common'];
  return order.map(r => `
    <div class="bar-row">
      <div class="bar-label" style="text-transform:capitalize">${r}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(rm[r].val / maxVal * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${fmt(rm[r].val)}</div>
    </div>
    <div class="bar-sub">${rm[r].qty} copies</div>
  `).join('');
}

// ── Color Panel ──────────────────────────────────────────────────────────────
function renderColorPanel() {
  if (!hasMetadata()) return noMetaMsg();
  const data = analyzeByColor();
  const rows = COLOR_ORDER.filter(c => data[c]);
  if (!rows.length) return '<p style="color:var(--text-muted);font-size:13px">No color data yet.</p>';
  const maxVal = Math.max(1, ...rows.map(c => data[c].value));
  const total  = rows.reduce((s, c) => s + data[c].value, 0);
  return rows.map(c => {
    const { value, qty } = data[c];
    const cm  = COLOR_META[c];
    const pct = (value / maxVal * 100).toFixed(1);
    const share = total > 0 ? (value / total * 100).toFixed(0) : 0;
    return `
      <div class="analytics-row">
        <div class="color-pip" style="color:${cm.text};border-color:${cm.text}22;background:${cm.bar.replace('.45','.1')}">${c}</div>
        <div class="a-label">${cm.name}</div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${pct}%;background:${cm.bar};border-right:2px solid ${cm.pip}"></div>
        </div>
        <div class="a-val">${fmt(value)}</div>
        <div class="a-pct">${share}%</div>
      </div>
      <div class="analytics-sub">${qty} copies</div>`;
  }).join('');
}

// ── Type Panel ───────────────────────────────────────────────────────────────
function renderTypePanel() {
  if (!hasMetadata()) return noMetaMsg();
  const data  = analyzeByType();
  const order = TYPE_ORDER.filter(t => data[t]);
  if (!order.length) return '<p style="color:var(--text-muted);font-size:13px">No type data yet.</p>';
  const maxVal = Math.max(1, ...order.map(t => data[t].value));
  return order.map(t => {
    const { value, qty } = data[t];
    const color = TYPE_COLORS[t] || '#4a4668';
    const pct   = (value / maxVal * 100).toFixed(1);
    return `
      <div class="analytics-row">
        <div class="type-dot" style="background:${color}"></div>
        <div class="a-label">${t}</div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${pct}%;background:${color}33;border-right:2px solid ${color}"></div>
        </div>
        <div class="a-val">${fmt(value)}</div>
      </div>
      <div class="analytics-sub">${qty} copies</div>`;
  }).join('');
}

// ── Mana Value Panel ─────────────────────────────────────────────────────────
function fmtShort(n) {
  if (!n || n < 0.01) return '';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + n.toFixed(0);
}

function renderManaValuePanel() {
  if (!hasMetadata()) return noMetaMsg();
  const { values, qtys, keys } = analyzeByManaValue();
  const maxVal   = Math.max(1, ...keys.map(k => values[k]));
  const totalQty = keys.reduce((s, k) => s + qtys[k], 0);
  if (totalQty === 0) return '<p style="color:var(--text-muted);font-size:13px">No mana value data yet.</p>';
  const barColors = ['#9090a8','#5b9cf6','#3dba6f','#e8b84b','#f08030','#e05555','#b090e0'];
  return `
    <div class="mv-chart">
      ${keys.map((k, i) => {
        const pct   = maxVal > 0 ? (values[k] / maxVal * 100) : 0;
        const color = barColors[i] || '#4a4668';
        return `
          <div class="mv-col">
            <div class="mv-val">${fmtShort(values[k])}</div>
            <div class="mv-bar-wrap">
              <div class="mv-bar" style="height:${Math.max(pct, values[k] > 0 ? 2 : 0).toFixed(1)}%;background:${color}44;border-top:2px solid ${color}"></div>
            </div>
            <div class="mv-key">${k}</div>
            <div class="mv-qty">${qtys[k] > 0 ? qtys[k] : ''}</div>
          </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:8px;text-align:center;letter-spacing:.03em">
      CMC distribution — lands excluded · label = copies
    </div>`;
}

function noMetaMsg() {
  return `<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:13px">
    Click <strong style="color:var(--accent)">↻ Refresh Prices</strong> to load card data from Scryfall.
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
function renderStatsPanel() {
  if (!collection.cards.length)
    return '<p style="color:var(--text-muted);font-size:13px;padding:10px 0">Import cards to see stats.</p>';

  const total    = collection.cards.length;
  const totalQty = collection.cards.reduce((s, c) => s + c.quantity, 0);
  const priced   = collection.cards.filter(c => getCurrentPrice(c.scryfallId, c.foil) != null).length;
  const foils    = collection.cards.filter(c => c.foil !== 'normal').reduce((s, c) => s + c.quantity, 0);
  const langs    = new Set(collection.cards.map(c => c.language)).size;
  const misprints = collection.cards.filter(c => c.misprint).length;
  const altered  = collection.cards.filter(c => c.altered).length;
  const sets     = new Set(collection.cards.map(c => c.setCode)).size;

  const rows = [
    ['Entries', total.toLocaleString()],
    ['Total Copies', totalQty.toLocaleString()],
    ['Priced', `${priced.toLocaleString()} / ${total.toLocaleString()} (${Math.round(priced / total * 100)}%)`],
    ['Unique Sets', sets],
    ['Foil / Etched Copies', foils.toLocaleString()],
    ['Languages', langs],
    ['Misprints', misprints],
    ['Altered', altered],
  ];
  return rows.map(([l, v]) => `
    <div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>
  `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// CARDS TAB
// ─────────────────────────────────────────────────────────────────────────────
function renderCards() {
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
  const totalPages = Math.max(1, Math.ceil(filtered.length / ui.cards.perPage));
  const page       = Math.min(ui.cards.page, totalPages);
  const pageSlice  = filtered.slice((page - 1) * ui.cards.perPage, page * ui.cards.perPage);

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

  return `
    <button class="binder-toggle-fab" id="binder-toggle-fab" title="Toggle Binders (B)">Binders</button>
    <div class="cards-layout">
      <div class="binder-sidebar">
        <div class="binder-sidebar-title">Binders</div>
        ${[['all', 'All Binders'], ...allBinders.map(b => [b, b])].map(([val, label], i) => {
          const qty = val === 'all'
            ? collection.cards.reduce((s, c) => s + c.quantity, 0)
            : collection.cards.filter(c => c.binderName === val).reduce((s, c) => s + c.quantity, 0);
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
            <input type="text" id="cardSearch" placeholder="Search name, set, type, or oracle text… (Enter to search)" value="${esc(s.search)}" style="flex:1;min-width:200px">
            <button class="btn" id="cardSearchBtn" style="padding:7px 14px;font-size:13px">Search</button>
            ${s.search ? `<button class="btn btn-ghost" id="cardSearchClear" style="padding:7px 10px;font-size:13px" title="Clear search">✕</button>` : ''}
            <div class="col-picker-wrap" style="position:relative">
              <button class="btn${s.colPickerOpen ? ' btn-primary' : ''}" id="colPickerBtn" style="padding:7px 12px;font-size:12px;white-space:nowrap">⊞ Columns${activeColCount < COL_DEFS.length ? ` (${activeColCount})` : ''}</button>
              ${s.colPickerOpen ? `<div class="col-picker-dropdown" id="colPickerDropdown">
                <div class="col-picker-title">Visible Columns</div>
                <div class="col-picker-chips">
                  ${COL_DEFS.map(d => `<button class="col-chip${cols[d.key] !== false ? ' col-chip-on' : ''}" data-col="${esc(d.key)}">${cols[d.key] !== false ? '✓ ' : ''}${esc(d.label)}</button>`).join('')}
                </div>
              </div>` : ''}
            </div>
            <button class="btn" onclick="showExportModal('cards')" style="padding:7px 12px;font-size:12px;white-space:nowrap" title="Export cards to CSV, JSON, Markdown, or text">⤓ Export</button>
          </div>
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
          ${filtered.length.toLocaleString()} entries · ${filteredQty.toLocaleString()} copies · Value: <strong>${fmt(filteredValue)}</strong>
        </div>

        <div class="table-wrap">
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
        </div>
        ${renderPagination(page, totalPages, filtered.length)}
      </div>
    </div>`;
}

function renderCardRow(card) {
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
    ${col('marketPrice', `<td style="font-weight:600;color:var(--accent2)">${mktPrice != null ? fmt(mktPrice) : '<span style="color:var(--text-dim)">—</span>'}</td>`)}
    ${col('priceDelta', `<td>${changeHtml}</td>`)}
    ${col('trend', `<td>${sparkline(hist)}</td>`)}
    ${col('flags', `<td>${flags}</td>`)}
    ${col('binderName', `<td style="color:var(--text-dim);font-size:11.5px">${esc(card.binderName || '—')}</td>`)}
  </tr>`;
}

function showEditScryfallModal(cardId) {
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

// ─────────────────────────────────────────────────────────────────────────────
// GALLERY TAB
// ─────────────────────────────────────────────────────────────────────────────
function renderGallery() {
  const g = ui.gallery;

  const binders  = [...new Set(collection.cards.map(c => c.binderName))].sort();
  const sets     = [...new Set(collection.cards.map(c => c.setName).filter(Boolean))].sort();
  const cmcVals  = [...new Set(
    collection.cards
      .map(c => collection.cardMetadata?.[c.scryfallId]?.cmc)
      .filter(v => v != null)
  )].sort((a, b) => a - b);

  let cards = collection.cards.filter(c => c.scryfallId);
  if (g.binder) cards = cards.filter(c => c.binderName === g.binder);
  if (g.set)    cards = cards.filter(c => c.setName === g.set);
  if (g.cmc !== '' && g.cmc != null) {
    const cmcNum = parseFloat(g.cmc);
    cards = cards.filter(c => {
      const meta = collection.cardMetadata?.[c.scryfallId];
      return meta?.cmc != null && meta.cmc === cmcNum;
    });
  }
  if (g.search) {
    const q = g.search.toLowerCase();
    cards = cards.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.setName || '').toLowerCase().includes(q)) return true;
      const meta = collection.cardMetadata?.[c.scryfallId];
      if (meta?.type_line?.toLowerCase().includes(q)) return true;
      if (meta?.oracle_text?.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Sort
  const sortField = g.sortField || 'name';
  const sortDir   = g.sortDir   || 'asc';
  cards = [...cards].sort((a, b) => {
    let av, bv;
    if (sortField === 'name') {
      av = a.name.toLowerCase(); bv = b.name.toLowerCase();
    } else if (sortField === 'value') {
      av = cardCurrentValue(a) ?? -1; bv = cardCurrentValue(b) ?? -1;
    } else if (sortField === 'number') {
      av = parseInt(a.collectorNumber) || 0; bv = parseInt(b.collectorNumber) || 0;
    } else if (sortField === 'cmc') {
      av = collection.cardMetadata?.[a.scryfallId]?.cmc ?? 999;
      bv = collection.cardMetadata?.[b.scryfallId]?.cmc ?? 999;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const perPage = 100;
  const total   = cards.length;
  const shown   = cards.slice(0, (g.page + 1) * perPage);
  const hasMore = total > shown.length;

  const activeFilters = [g.binder, g.set, g.cmc !== '' && g.cmc != null ? `CMC ${g.cmc}` : '', g.search].filter(Boolean).length;

  function sel(field, val) { return field === val ? ' selected' : ''; }
  function sortBtn(field, label) {
    const active = sortField === field;
    const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc';
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button class="btn${active ? ' btn-primary' : ' btn-ghost'}" style="font-size:12px;padding:5px 10px"
      onclick="ui.gallery.sortField='${field}';ui.gallery.sortDir='${nextDir}';ui.gallery.page=0;render()">${label}${arrow}</button>`;
  }

  return `
    <div class="gallery-filters">
      <div class="gallery-filter-row">
        <select onchange="ui.gallery.binder=this.value;ui.gallery.page=0;render()">
          <option value="">All Binders</option>
          ${binders.map(b => `<option value="${esc(b)}"${sel(g.binder,b)}>${esc(b)}</option>`).join('')}
        </select>
        <select onchange="ui.gallery.set=this.value;ui.gallery.page=0;render()">
          <option value="">All Sets</option>
          ${sets.map(s => `<option value="${esc(s)}"${sel(g.set,s)}>${esc(s)}</option>`).join('')}
        </select>
        <select onchange="ui.gallery.cmc=this.value;ui.gallery.page=0;render()">
          <option value="">Any CMC</option>
          ${cmcVals.map(v => `<option value="${v}"${sel(String(g.cmc),String(v))}>${v === 0 ? '0 (Land/Free)' : v}</option>`).join('')}
        </select>
        <div style="display:flex;gap:6px;flex:1;min-width:180px">
          <input type="text" id="gallerySearch" class="search-input" placeholder="Search name, set, type, or oracle text…"
            value="${esc(g.search)}"
            onkeydown="if(event.key==='Enter'){ui.gallery.search=this.value;ui.gallery.page=0;render()}"
            style="flex:1;min-width:0">
          <button class="btn" onclick="ui.gallery.search=document.getElementById('gallerySearch').value;ui.gallery.page=0;render()">Search</button>
          ${g.search ? `<button class="btn btn-ghost" onclick="ui.gallery.search='';ui.gallery.page=0;render()">✕</button>` : ''}
        </div>
        ${activeFilters > 0 ? `<button class="btn btn-ghost" style="white-space:nowrap;font-size:12px" onclick="ui.gallery={binder:'',set:'',cmc:'',search:'',sortField:'name',sortDir:'asc',page:0};render()">Clear all</button>` : ''}
      </div>
      <div class="gallery-filter-row" style="align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">Sort:</span>
        ${sortBtn('name',   'Name')}
        ${sortBtn('number', 'Card #')}
        ${sortBtn('value',  'Value')}
        ${sortBtn('cmc',    'CMC')}
        <span style="margin-left:auto;font-size:13px;color:var(--text-muted);white-space:nowrap">${total.toLocaleString()} card${total !== 1 ? 's' : ''}</span>
      </div>
    </div>

    ${total === 0
      ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">No cards match your filters.</div>`
      : `<div class="gallery-grid">
          ${shown.map(c => {
            const id  = c.scryfallId.toLowerCase();
            const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
            const val = cardCurrentValue(c);
            return `
              <div class="gallery-card" onclick="showGalleryModal('${esc(c.id)}')" title="${esc(c.name)}">
                <img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy"
                  onerror="this.closest('.gallery-card').style.display='none'">
                ${c.foil !== 'normal' ? `<span class="gallery-foil">${FOIL_LABEL[c.foil]}</span>` : ''}
                ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
              </div>`;
          }).join('')}
        </div>
        ${hasMore ? `
          <div style="text-align:center;padding:28px 0">
            <button class="btn btn-primary" onclick="ui.gallery.page++;render()">
              Load more — ${(total - shown.length).toLocaleString()} remaining
            </button>
          </div>` : ''}`}`;
}

function showGalleryModal(cardId) {
  const card = collection.cards.find(c => c.id === cardId);
  if (!card) return;

  const id    = card.scryfallId ? card.scryfallId.toLowerCase() : null;
  const img   = id ? `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg` : null;
  const scryfallUrl = id ? `https://scryfall.com/card/${(card.setCode||'').toLowerCase()}/${card.collectorNumber||''}` : null;
  const value = cardCurrentValue(card);
  const cost  = card.purchasePrice ?? 0;
  const gain  = value != null ? value - cost : null;
  const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(card.scryfallId) : (typeof getSlInfo === 'function' ? getSlInfo(card.name) : []);

  const hist  = id ? (collection.priceHistory[`${card.scryfallId}|${card.foil}`] || []) : [];
  const spark = hist.length >= 2 ? renderSparkline(hist.map(h => h.price)) : '';

  showModal(`
    <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
      ${img ? `<img src="${esc(img)}" alt="${esc(card.name)}"
        style="width:240px;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,0.65);flex-shrink:0"
        onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:200px">
        <h2 style="margin:0 0 4px">${esc(card.name)}</h2>
        <div style="color:var(--text-muted);font-size:13px;margin-bottom:14px">${esc(card.setName)} · ${esc((card.setCode||'').toUpperCase())} · #${esc(card.collectorNumber||'?')}</div>

        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;margin-bottom:16px">
          <span style="color:var(--text-muted)">Binder</span>    <span>${esc(card.binderName)}</span>
          <span style="color:var(--text-muted)">Rarity</span>    <span style="text-transform:capitalize">${esc(card.rarity||'—')}</span>
          <span style="color:var(--text-muted)">Foil</span>      <span>${card.foil !== 'normal' ? `<span class="badge badge-${card.foil}">${FOIL_LABEL[card.foil]}</span>` : 'Normal'}</span>
          <span style="color:var(--text-muted)">Condition</span> <span>${esc(card.condition||'—')}</span>
          <span style="color:var(--text-muted)">Language</span>  <span>${esc(card.language||'—')}</span>
          <span style="color:var(--text-muted)">Qty owned</span> <span>${card.quantity}</span>
          ${slInfo.length ? slInfo.map(s => `
            <span style="color:var(--text-muted)">SL Drop</span>
            <span style="color:var(--accent2);font-weight:600">${esc(s.drop)}</span>
            <span style="color:var(--text-muted)">Superdrop</span>
            <span>${esc(s.superdrop)}</span>
          `).join('') : ''}
        </div>

        <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">
          ${value != null ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Market price</div>
            <div style="font-size:22px;font-weight:700;color:var(--accent2)">${fmt(value)}</div>
          </div>` : ''}
          ${cost ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Cost basis</div>
            <div style="font-size:18px;font-weight:600">${fmt(cost)}</div>
          </div>` : ''}
          ${gain != null ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Gain/Loss</div>
            <div style="font-size:18px;font-weight:700" class="${gain >= 0 ? 'price-up' : 'price-down'}">${gain >= 0 ? '+' : ''}${fmt(gain)}</div>
          </div>` : ''}
        </div>

        ${spark ? `<div style="margin-bottom:14px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Price history</div>
          ${spark}
        </div>` : ''}

        ${scryfallUrl ? `<a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>` : ''}
      </div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECRET LAIR VIEWER TAB
// ─────────────────────────────────────────────────────────────────────────────
async function refreshSlData() {
  if (ui.slRefreshing) return;
  ui.slRefreshing = true;
  render();

  try {
    toast('Fetching Secret Lair data from MTGJSON… (may take a moment)', 'info', 10000);
    window.logger?.info('SL', 'Fetching MTGJSON SLD.json…');
    const SLD_URL = 'https://mtgjson.com/api/v5/SLD.json';
    const candidates = [
      { label: 'direct',     url: SLD_URL },
      { label: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(SLD_URL)}` },
      { label: 'corsproxy',  url: `https://corsproxy.io/?url=${encodeURIComponent(SLD_URL)}` },
    ];

    let json = null;
    let lastErr = '';
    for (const { label, url } of candidates) {
      try {
        window.logger?.debug('SL', `Trying ${label} fetch…`);
        const resp = await fetch(url);
        if (!resp.ok) {
          lastErr = `HTTP ${resp.status} from ${label}`;
          window.logger?.warn('SL', `${label} returned HTTP ${resp.status}`);
          continue;
        }
        json = await resp.json();
        window.logger?.success('SL', `Fetched via ${label}`);
        break;
      } catch (e) {
        lastErr = e.message;
        window.logger?.warn('SL', `${label} threw: ${e.message}`);
      }
    }
    if (!json) throw new Error(lastErr || 'All sources failed');
    // MTGJSON v5 set files are shaped as { data: { code, name, cards: [...], tokens: [...], ... } }
    // — the actual card list lives at data.cards, NOT Object.values(data).
    const cards = (json.data && Array.isArray(json.data.cards)) ? json.data.cards : [];
    if (!cards.length) throw new Error('No cards in MTGJSON response (data.cards was empty or missing)');
    window.logger?.info('SL', `Parsed ${cards.length.toLocaleString()} cards from MTGJSON`);

    const newDropCards = {};
    const newScryfallToDrops = {};
    const newScryfallToName = {};

    // Pass 1: trust MTGJSON's `subsets` field where present.
    for (const card of cards) {
      const sid  = (card.identifiers?.scryfallId || '').toLowerCase();
      const name = card.name;
      const subs = card.subsets || [];
      if (sid && name) newScryfallToName[sid] = name;
      if (sid && subs.length) newScryfallToDrops[sid] = subs;
      for (const drop of subs) {
        if (!newDropCards[drop]) newDropCards[drop] = [];
        if (!newDropCards[drop].includes(name)) newDropCards[drop].push(name);
      }
    }

    // Pass 2: foil/star backfill — base collector number → drops. Foil printings
    // (collector "1485★") inherit the drop tag of the regular printing ("1485")
    // when MTGJSON failed to tag them in `subsets` directly.
    const baseKeyToDrops = {};
    for (const card of cards) {
      const num  = (card.number || '').replace(/[★*]/g, '').trim();
      const subs = card.subsets || [];
      if (!num || !subs.length) continue;
      const key = `${num}|${card.name}`;
      if (!baseKeyToDrops[key]) baseKeyToDrops[key] = new Set();
      for (const d of subs) baseKeyToDrops[key].add(d);
    }
    let backfilled = 0;
    for (const card of cards) {
      const sid = (card.identifiers?.scryfallId || '').toLowerCase();
      if (!sid) continue;
      // Only backfill cards that don't already have any drop tags
      if (newScryfallToDrops[sid] && newScryfallToDrops[sid].length) continue;
      const num = (card.number || '').replace(/[★*]/g, '').trim();
      const key = `${num}|${card.name}`;
      const drops = baseKeyToDrops[key];
      if (drops && drops.size > 0) {
        newScryfallToDrops[sid] = [...drops];
        backfilled++;
      }
    }
    if (backfilled > 0) window.logger?.info('SL', `Backfilled ${backfilled} foil/variant printings via base collector number`);

    applySlDataUpdate(newDropCards, newScryfallToDrops, newScryfallToName);
    await saveSlDataToCache(newDropCards, newScryfallToDrops, newScryfallToName);

    const drops = Object.keys(newDropCards).length;
    toast(`SL data updated — ${drops} drops, ${cards.length} cards`, 'success');
    window.logger?.success('SL', `Updated: ${drops} drops · ${cards.length.toLocaleString()} cards · ${Object.keys(newScryfallToDrops).length.toLocaleString()} mapped printings`);
  } catch (e) {
    toast(`Failed to refresh SL data: ${e.message}`, 'error');
    window.logger?.error('SL', `Refresh failed: ${e.message}`);
  }

  ui.slRefreshing = false;
  render();
}
function getDropsForSuperdrop(superdrop) {
  if (!superdrop || typeof SL_SUPERDROPS === 'undefined') return [];
  const sd = SL_SUPERDROPS.find(s => s.superdrop === superdrop);
  return sd ? [...sd.drops].sort() : [];
}

function renderSlViewer() {
  const sv = ui.slViewer;
  const hasSl = typeof SL_SUPERDROPS !== 'undefined' && typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined';
  if (!hasSl) return `<div style="padding:40px;text-align:center;color:var(--text-muted)">Secret Lair data not loaded.</div>`;

  const ownedIds = new Set(collection.cards.map(c => c.scryfallId).filter(Boolean));
  // SLD-set names the user owns somewhere — only used as a *drop count* fallback
  // for the rare case where a drop's card list contains a name that has no
  // scryfallIds tagged to it at all (MTGJSON data gap).
  const ownedSldNames = new Set(
    collection.cards
      .filter(c => (c.setCode || '').toUpperCase() === 'SLD' && c.name)
      .map(c => c.name)
  );

  // Drop-specific count: a name in the drop is "owned" if either
  //   (a) user has a direct scryfallId match on any tile of that name in this drop, OR
  //   (b) no tile of that name exists in the drop's ID list AND user has the name in SLD.
  // Crucially: owning the same card name in a *different* drop does NOT credit this drop.
  const dropOwnedNameStats = (drop) => {
    const names = SL_DROP_CARDS[drop] || [];
    const idsInDrop = SL_DROP_TO_SCRYFALL_IDS[drop] || [];

    // Names with at least one tile that the user owns by direct ID match
    const directMatchedNames = new Set();
    // Names that have any tile in this drop (so we can detect data-gap cases)
    const namesWithTiles = new Set();
    for (const id of idsInDrop) {
      const n = SL_SCRYFALL_TO_NAME?.[id];
      if (!n) continue;
      namesWithTiles.add(n);
      if (ownedIds.has(id)) directMatchedNames.add(n);
    }

    let owned = 0;
    for (const name of names) {
      if (directMatchedNames.has(name)) { owned++; continue; }
      // Data-gap fallback: drop says this card belongs but no tile maps to it
      if (!namesWithTiles.has(name) && ownedSldNames.has(name)) owned++;
    }
    return { owned, total: names.length };
  };
  const superdrops = SL_SUPERDROPS.map(sd => sd.superdrop);

  const cacheInfo = typeof getSlCacheInfo === 'function' ? getSlCacheInfo() : null;
  const lastUpdated = cacheInfo?.updatedAt
    ? `Last updated ${new Date(cacheInfo.updatedAt).toLocaleDateString()}`
    : 'Using built-in dataset';
  const refreshBtn = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:12px;color:var(--text-muted);flex:1">${esc(lastUpdated)}</span>
      <button class="btn btn-ghost" style="font-size:12px;white-space:nowrap"
        onclick="refreshSlData()" ${ui.slRefreshing ? 'disabled' : ''}>
        ${ui.slRefreshing ? '⏳ Fetching…' : '↻ Refresh SL Data'}
      </button>
    </div>`;

  function sdSelect() {
    return `<select onchange="ui.slViewer.superdrop=this.value;ui.slViewer.drop='';ui.slViewer.page=0;render()">
      <option value="">All Superdrops</option>
      ${superdrops.map(sd => `<option value="${esc(sd)}"${sv.superdrop===sd?' selected':''}>${esc(sd)}</option>`).join('')}
    </select>`;
  }

  function dropSelect(drops) {
    return `<select onchange="ui.slViewer.drop=this.value;ui.slViewer.page=0;render()">
      <option value="">All Drops</option>
      ${drops.map(d => `<option value="${esc(d)}"${sv.drop===d?' selected':''}>${esc(d)}</option>`).join('')}
    </select>`;
  }

  // Breadcrumb shown above the toolbar — clickable segments walk back up the
  // hierarchy. Last segment is the current page (not clickable, accent color).
  function breadcrumb() {
    const root = `<a class="bc-link" onclick="ui.slViewer.superdrop='';ui.slViewer.drop='';ui.slViewer.page=0;render()">Secret Lair Explorer</a>`;
    const sep = `<span class="bc-sep">›</span>`;
    if (sv.drop) {
      const sdSeg = sv.superdrop
        ? `<a class="bc-link" onclick="ui.slViewer.drop='';ui.slViewer.page=0;render()">${esc(sv.superdrop)}</a>`
        : '';
      return `<nav class="sl-breadcrumb">${root}${sv.superdrop ? sep + sdSeg : ''}${sep}<span class="bc-current">${esc(sv.drop)}</span></nav>`;
    }
    if (sv.superdrop) {
      return `<nav class="sl-breadcrumb">${root}${sep}<span class="bc-current">${esc(sv.superdrop)}</span></nav>`;
    }
    return `<nav class="sl-breadcrumb"><span class="bc-current">Secret Lair Explorer</span></nav>`;
  }

  // Sort + search bar shown above the grid on landing & superdrop views
  function sortSearchBar() {
    const opts = [
      ['date_desc', 'Date ↓ (newest first)'],
      ['date_asc',  'Date ↑ (oldest first)'],
      ['name_asc',  'Name A→Z'],
      ['name_desc', 'Name Z→A'],
    ];
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <input type="text" id="slSearchInput" placeholder="Search by drop, superdrop, or card name…"
          value="${esc(sv.search || '')}"
          oninput="ui.slViewer.search=this.value;ui.slViewer.page=0;render();setTimeout(()=>{const el=document.getElementById('slSearchInput');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length)}},0)"
          style="flex:1;min-width:200px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
        ${sv.search ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="ui.slViewer.search='';render()">✕</button>` : ''}
        <span style="color:var(--text-muted);font-size:11px;white-space:nowrap">Sort:</span>
        <select onchange="ui.slViewer.sort=this.value;render()" style="font-size:12px">
          ${opts.map(([v, label]) => `<option value="${v}"${sv.sort===v?' selected':''}>${label}</option>`).join('')}
        </select>
      </div>`;
  }

  // Helpers for sorting + searching
  function sortSuperdrops(list) {
    const arr = [...list];
    const dir = sv.sort.endsWith('_desc') ? -1 : 1;
    if (sv.sort.startsWith('date')) {
      arr.sort((a, b) => (a.date || '').localeCompare(b.date || '') * dir);
    } else {
      arr.sort((a, b) => a.superdrop.localeCompare(b.superdrop) * dir);
    }
    return arr;
  }
  function sortDrops(list) {
    const arr = [...list];
    const dir = sv.sort.endsWith('_desc') ? -1 : 1;
    // Drops don't have their own dates — sort alphabetically when "by date" is chosen too
    arr.sort((a, b) => a.localeCompare(b) * dir);
    return arr;
  }
  // Returns true if a drop matches the current search query (by drop name or
  // any of its card names).
  function dropMatchesSearch(drop, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (drop.toLowerCase().includes(q)) return true;
    const cards = SL_DROP_CARDS[drop] || [];
    return cards.some(c => c.toLowerCase().includes(q));
  }
  function superdropMatchesSearch(sd, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (sd.superdrop.toLowerCase().includes(q)) return true;
    return (sd.drops || []).some(d => dropMatchesSearch(d, q));
  }

  // Drop selected — show card grid for that drop
  if (sv.drop) {
    const cardIds = SL_DROP_TO_SCRYFALL_IDS[sv.drop] || [];
    const stats = dropOwnedNameStats(sv.drop);
    const PAGE_SIZE = 100;
    const shown = cardIds.slice(0, (sv.page + 1) * PAGE_SIZE);
    const hasMore = cardIds.length > shown.length;
    const drops = getDropsForSuperdrop(sv.superdrop);
    const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;

    return refreshBtn + breadcrumb() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${drops.length ? dropSelect(drops) : ''}
          <button class="btn btn-ghost" style="font-size:12px" onclick="ui.slViewer.drop='';ui.slViewer.page=0;render()">← Back to Superdrop</button>
          <span style="margin-left:auto;font-size:13px;font-weight:700;color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">
            ${stats.owned} / ${stats.total} cards owned (${pct}%)
          </span>
        </div>
      </div>
      <div class="gallery-grid">
        ${shown.map(scryfallId => {
          const id = scryfallId.toLowerCase();
          const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
          // Strict per-printing ownership: only credit if the user's collection
          // has this exact scryfallId. Different printings of the same card name
          // are separate tiles and tracked separately.
          const ownedCards = collection.cards.filter(c => c.scryfallId === scryfallId);
          const owned = ownedCards.length > 0;
          const totalQty = ownedCards.reduce((s, c) => s + (c.quantity || 1), 0);
          const val = owned ? cardCurrentValue(ownedCards[0]) : null;
          return `
            <div class="gallery-card${owned ? ' sl-card-owned' : ' sl-card-missing'}"
              onclick="showSlViewerModal('${esc(scryfallId)}')" title="${owned ? `Owned (qty: ${totalQty})` : 'Not in collection'}">
              <img src="${esc(img)}" alt="" loading="lazy"
                onerror="this.closest('.gallery-card').style.display='none'"
                style="${owned ? '' : 'filter:grayscale(60%) brightness(0.65)'}">
              ${owned
                ? `<span class="sl-owned-badge">✓ ${totalQty}</span>`
                : `<span class="sl-missing-badge">✗</span>`}
              ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${hasMore ? `<div style="text-align:center;padding:28px 0">
        <button class="btn btn-primary" onclick="ui.slViewer.page++;render()">Load more — ${(cardIds.length - shown.length).toLocaleString()} remaining</button>
      </div>` : ''}`;
  }

  // Superdrop selected (no specific drop) — show drop list within it
  if (sv.superdrop) {
    const sdObj = SL_SUPERDROPS.find(s => s.superdrop === sv.superdrop);
    const allDrops = sdObj ? [...sdObj.drops] : [];
    const drops = sortDrops(allDrops.filter(d => dropMatchesSearch(d, sv.search)));
    return refreshBtn + breadcrumb() + sortSearchBar() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${dropSelect(allDrops.sort())}
        </div>
      </div>
      ${drops.length === 0
        ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No drops match "${esc(sv.search)}".</div>`
        : `<div class="sl-superdrop-grid">
        ${drops.map(drop => {
          const stats = dropOwnedNameStats(drop);
          const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;
          return `
            <div class="sl-superdrop-card" onclick="ui.slViewer.drop='${escJs(drop)}';ui.slViewer.page=0;render()">
              <div class="sl-superdrop-name">${esc(drop)}</div>
              <div class="sl-superdrop-meta">${stats.total} card${stats.total !== 1 ? 's' : ''}</div>
              <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
              <div class="sl-superdrop-count" style="color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">${stats.owned} / ${stats.total} owned</div>
            </div>`;
        }).join('')}
      </div>`}`;
  }

  // Landing — show all superdrops as completion cards
  const visibleSuperdrops = sortSuperdrops(SL_SUPERDROPS.filter(sd => superdropMatchesSearch(sd, sv.search)));
  return refreshBtn + sortSearchBar() + `
    ${visibleSuperdrops.length === 0
      ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No superdrops match "${esc(sv.search)}".</div>`
      : `<div class="sl-superdrop-grid">
      ${visibleSuperdrops.map(sd => {
        // Sum per-drop name stats so superdrop totals match drop totals.
        let owned = 0, total = 0;
        for (const d of sd.drops) {
          const s = dropOwnedNameStats(d);
          owned += s.owned;
          total += s.total;
        }
        const pct = total ? Math.round(owned / total * 100) : 0;
        return `
          <div class="sl-superdrop-card" onclick="ui.slViewer.superdrop='${escJs(sd.superdrop)}';ui.slViewer.drop='';render()">
            <div class="sl-superdrop-name">${esc(sd.superdrop)}</div>
            <div class="sl-superdrop-meta">${sd.date || '—'} · ${sd.drops.length} drop${sd.drops.length !== 1 ? 's' : ''}</div>
            <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
            <div class="sl-superdrop-count" style="color:${owned===total&&total>0?'var(--green)':'var(--text-muted)'}">${owned} / ${total} owned</div>
          </div>`;
      }).join('')}
    </div>`}`;
}

async function showSlViewerModal(scryfallId) {
  // Strict per-printing ownership — only direct scryfallId match counts. If
  // user owns a different printing of the same card name, that's not "this
  // card" and the modal should show Scryfall details + "Not owned".
  const ownedCards = collection.cards.filter(c => c.scryfallId === scryfallId);
  if (ownedCards.length > 0) {
    showGalleryModal(ownedCards[0].id);
    return;
  }

  // Not owned — show stub modal then populate via Scryfall
  const id = scryfallId.toLowerCase();
  const img = `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg`;
  const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(scryfallId) : [];

  showModal(`
    <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
      <img src="${esc(img)}" alt=""
        style="width:240px;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,0.65);flex-shrink:0"
        onerror="this.style.display='none'">
      <div style="flex:1;min-width:200px">
        <div id="sl-modal-details" style="color:var(--text-muted);font-size:13px;padding-top:8px">Loading card details…</div>
      </div>
    </div>`);

  try {
    const resp = await fetch(`https://api.scryfall.com/cards/${scryfallId}`);
    const data = await resp.json();
    const el = document.getElementById('sl-modal-details');
    if (!el) return;
    const scryfallUrl = `https://scryfall.com/card/${(data.set || '').toLowerCase()}/${data.collector_number || ''}`;
    const oracleText = (data.oracle_text || data.card_faces?.[0]?.oracle_text || '').substring(0, 300);
    el.innerHTML = `
      <h2 style="margin:0 0 4px;color:var(--text)">${esc(data.name || '')}</h2>
      <div style="color:var(--text-muted);font-size:13px;margin-bottom:14px">${esc(data.set_name || '')} · ${esc((data.set || '').toUpperCase())} · #${esc(data.collector_number || '?')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;margin-bottom:16px">
        <span style="color:var(--text-muted)">Rarity</span>   <span style="text-transform:capitalize">${esc(data.rarity || '—')}</span>
        <span style="color:var(--text-muted)">Type</span>     <span>${esc(data.type_line || '—')}</span>
        <span style="color:var(--text-muted)">CMC</span>      <span>${data.cmc ?? '—'}</span>
        ${oracleText ? `<span style="color:var(--text-muted);align-self:start">Oracle</span><span style="font-style:italic;font-size:12px;line-height:1.5">${esc(oracleText)}${(data.oracle_text||'').length > 300 ? '…' : ''}</span>` : ''}
        ${slInfo.length ? slInfo.map(s => `
          <span style="color:var(--text-muted)">SL Drop</span><span style="color:var(--accent2);font-weight:600">${esc(s.drop)}</span>
          <span style="color:var(--text-muted)">Superdrop</span><span>${esc(s.superdrop)}</span>
        `).join('') : ''}
        <span style="color:var(--text-muted)">In binder</span><span style="color:#f87171;font-weight:600">Not owned</span>
      </div>
      ${data.prices?.usd ? `<div style="font-size:22px;font-weight:700;color:var(--accent2);margin-bottom:14px">$${data.prices.usd}</div>` : ''}
      <a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>`;
  } catch (e) {
    const el = document.getElementById('sl-modal-details');
    if (el) el.textContent = 'Failed to load card details.';
  }
}

async function retryFailedLookups() {
  const retryable = (collection.failedLookups || []).filter(f => f.reason === 'batch_error');
  if (!retryable.length) { toast('No batch errors to retry', 'info'); return; }

  ui.failures.retrying = true;
  render();

  // Build unique (scryfallId, foil) pairs from all collection cards that match failed IDs
  const failedIdSet = new Set(retryable.map(f => f.scryfallId).filter(Boolean));
  const pairMap = new Map();
  for (const c of collection.cards) {
    if (!c.scryfallId || !failedIdSet.has(c.scryfallId)) continue;
    pairMap.set(priceKey(c.scryfallId, c.foil), { scryfallId: c.scryfallId, foil: c.foil });
  }
  const pairs      = Array.from(pairMap.values());
  const uniqueIds  = [...new Set(pairs.map(p => p.scryfallId))];
  const chunks     = [];
  for (let i = 0; i < uniqueIds.length; i += 75) chunks.push(uniqueIds.slice(i, i + 75));

  const scryfallCache  = new Map();
  const notFoundIds    = new Set();
  const stillFailedIds = new Set();

  for (const chunk of chunks) {
    try {
      const data = await fetchScryfallBatch(chunk);
      for (const card of (data.data || [])) scryfallCache.set(card.id.toLowerCase(), card);
      for (const nf of (data.not_found || [])) if (nf.id) notFoundIds.add(nf.id.toLowerCase());
    } catch (err) {
      for (const id of chunk) stillFailedIds.add(id);
    }
    await sleep(200);
  }

  // Store prices for resolved cards
  const resolvedIds = new Set();
  for (const { scryfallId, foil } of pairs) {
    const card = scryfallCache.get(scryfallId);
    if (!card) continue;
    const prices = card.prices || {};
    let raw;
    if (foil === 'foil')        raw = prices.usd_foil   ?? prices.usd_etched ?? prices.usd;
    else if (foil === 'etched') raw = prices.usd_etched ?? prices.usd_foil;
    else                        raw = prices.usd;
    const price = parseFloat(raw);
    if (!isNaN(price)) {
      storePriceSnapshot(scryfallId, foil, price);
      resolvedIds.add(scryfallId);
    }
  }

  // Update failedLookups: remove resolved, upgrade not_found, keep still-failing
  collection.failedLookups = (collection.failedLookups || []).map(f => {
    if (f.reason !== 'batch_error') return f;
    if (resolvedIds.has(f.scryfallId))    return null; // resolved — remove
    if (notFoundIds.has(f.scryfallId))    return { ...f, reason: 'not_found', reasonLabel: 'ID not found in Scryfall' };
    if (stillFailedIds.has(f.scryfallId)) return f;    // still rate-limited
    return null;
  }).filter(Boolean);

  ui.failures.retrying = false;
  const msg = `Retry done: ${resolvedIds.size} priced, ${notFoundIds.size} not found, ${stillFailedIds.size} still failing`;
  toast(msg, resolvedIds.size > 0 ? 'success' : 'warning');
  render();
  updateFailedBadge();
  autoSave();
}

function renderFailedLookupsTab() {
  const failed = collection.failedLookups || [];
  const filt   = ui.failures.filter || 'all';

  const REASON_COLOR = {
    not_found:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.35)',  text: '#f87171' },
    no_price:    { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', text: '#fbbf24' },
    missing_id:  { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.35)', text: '#a78bfa' },
    batch_error: { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)', text: '#60a5fa' },
  };
  const REASON_LABEL = {
    all: 'All', not_found: 'ID not found', no_price: 'No price',
    missing_id: 'No Scryfall ID', batch_error: 'Rate limit / batch error',
  };

  const counts = { not_found: 0, no_price: 0, missing_id: 0, batch_error: 0 };
  for (const f of failed) if (counts[f.reason] !== undefined) counts[f.reason]++;

  const visible = filt === 'all' ? failed : failed.filter(f => f.reason === filt);
  const batchCount = counts.batch_error;
  const isRetrying = ui.failures.retrying;

  if (!failed.length) return `
    <div class="empty-state">
      <div class="empty-state-icon">✓</div>
      <h3>No failed lookups</h3>
      <p>All cards were successfully priced on the last refresh.</p>
    </div>`;

  // Filter buttons
  const filterBtn = (key) => {
    const n     = key === 'all' ? failed.length : counts[key];
    const rc    = REASON_COLOR[key];
    const label = REASON_LABEL[key];
    const active = filt === key;
    const style = active
      ? `background:${rc ? rc.bg : 'rgba(255,255,255,0.08)'};color:${rc ? rc.text : 'var(--text)'};border-color:${rc ? rc.border : 'var(--border)'};font-weight:700`
      : `background:transparent;color:var(--text-muted);border-color:var(--border)`;
    return `<button onclick="ui.failures.filter='${key}';render()"
      style="padding:5px 12px;border-radius:99px;font-size:12px;border:1px solid;cursor:pointer;${style}">
      ${esc(label)} <strong>${n}</strong>
    </button>`;
  };

  const rows = visible.map(f => {
    const rc = REASON_COLOR[f.reason] || REASON_COLOR.not_found;
    const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};white-space:nowrap">${esc(f.reasonLabel)}</span>`;
    const scryLink = f.scryfallId
      ? `<a href="https://scryfall.com/card/${esc((f.setCode || '').toLowerCase())}/${esc(f.collectorNumber || '')}/" target="_blank" style="font-size:11px;color:var(--accent)" title="${esc(f.scryfallId)}">↗ View</a>`
      : '<span style="color:var(--text-muted);font-size:11px">—</span>';
    const foilBadge = f.foil && f.foil !== 'normal'
      ? `<span class="badge badge-${f.foil}" style="font-size:10px">${FOIL_LABEL[f.foil]}</span>`
      : '<span style="color:var(--text-dim);font-size:11px">—</span>';
    const affected = (f.affectedEntries || 0) > 1
      ? `<span style="color:var(--text-muted);font-size:11px;margin-left:4px">(×${f.affectedEntries})</span>` : '';
    return `<tr>
      <td style="font-weight:500;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(f.name)}">${esc(f.name)}</td>
      <td style="color:var(--text-dim);white-space:nowrap;font-size:12px">${esc(f.setCode || '—')} <span style="font-size:11px">#${esc(f.collectorNumber || '?')}</span></td>
      <td style="font-size:12px;color:var(--text-dim)">${esc(f.setName || '—')}</td>
      <td>${foilBadge}</td>
      <td style="color:var(--text-dim);font-size:12px">${esc(f.binderName || '—')}</td>
      <td>${badge}${affected}</td>
      <td>${scryLink}</td>
    </tr>`;
  }).join('');

  return `
    <div class="panel failed-lookups-panel" style="border-color:rgba(239,68,68,0.25)">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap">
        <div class="panel-title" style="margin:0">
          <div class="panel-icon" style="background:rgba(239,68,68,0.15)">⚠</div>
          <h2 style="background:linear-gradient(135deg,#f87171,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0">Failed Lookups</h2>
        </div>
        ${batchCount > 0 ? `
        <button class="btn btn-primary" style="font-size:12px;margin-left:auto" onclick="retryFailedLookups()" ${isRetrying ? 'disabled' : ''}>
          ${isRetrying ? '⏳ Retrying…' : `↻ Retry ${batchCount} batch error${batchCount !== 1 ? 's' : ''}`}
        </button>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${filterBtn('all')}
        ${counts.batch_error ? filterBtn('batch_error') : ''}
        ${counts.not_found   ? filterBtn('not_found')   : ''}
        ${counts.no_price    ? filterBtn('no_price')     : ''}
        ${counts.missing_id  ? filterBtn('missing_id')   : ''}
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
        Showing ${visible.length} of ${failed.length} entries.
        <strong style="color:var(--text-dim)">Rate limit / batch error</strong>: hit "Retry" above after waiting.
        <strong style="color:var(--text-dim)">ID not found</strong>: stale UUID — click ↗ to look up the correct card.
        <strong style="color:var(--text-dim)">No price</strong>: Scryfall has no USD data for that foil type.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Name</th><th>Set / #</th><th>Set Name</th><th>Foil</th><th>Binder</th><th>Issue</th><th>Link</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:30px">No entries for this filter</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

function filteredCards() {
  const s = ui.cards;
  let cards = collection.cards;
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
    } else {
      av = a[sortField] ?? '';
      bv = b[sortField] ?? '';
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });
}

function renderPagination(page, totalPages, total) {
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

// ─────────────────────────────────────────────────────────────────────────────
// SEALED TAB
// ─────────────────────────────────────────────────────────────────────────────
function renderSealed() {
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
          <button class="btn" id="browseSealedBtn">⊞ Browse Sets</button>
          <button class="btn btn-primary" id="addSealedBtn">+ Add Product</button>
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
            <button class="btn" id="browseSealedBtn2">⊞ Browse Sets</button>
            <button class="btn btn-primary" id="addSealedBtn2">🔍 Search for a Product</button>
          </div>` : ''}
      </div>
    ` : `<div class="sealed-list">${filtered.map(renderSealedItem).join('')}</div>`}`;
}

function renderSealedItem(item) {
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

// ─────────────────────────────────────────────────────────────────────────────
// MODAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function showModal(html, wide = false) {
  document.getElementById('modal-content').innerHTML = html;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  const modal = overlay.querySelector('.modal');
  if (modal) modal.classList.toggle('modal-wide', wide);
}
function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  const modal = document.querySelector('#modal-overlay .modal');
  if (modal) modal.classList.remove('modal-wide');
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSE SETS MODAL
// ─────────────────────────────────────────────────────────────────────────────
function showBrowseModal() {
  let browseSort   = 'name-asc';
  let browseFilter = '';
  let selectedGroup = null;
  let groupProducts = [];

  function groupsToShow() {
    if (!tcgcsvCache.groups?.length) return [];
    const q = browseFilter.trim().toLowerCase();
    return tcgcsvCache.groups
      .filter(g => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function sortedProducts() {
    const arr = [...groupProducts];
    if      (browseSort === 'name-asc')   arr.sort((a, b) => a.name.localeCompare(b.name));
    else if (browseSort === 'name-desc')  arr.sort((a, b) => b.name.localeCompare(a.name));
    else if (browseSort === 'price-desc') arr.sort((a, b) => (b.marketPrice ?? -1) - (a.marketPrice ?? -1));
    else if (browseSort === 'price-asc')  arr.sort((a, b) => (a.marketPrice ?? Infinity) - (b.marketPrice ?? Infinity));
    return arr;
  }

  function renderGroups() {
    const panel = document.getElementById('bm-groups');
    if (!panel) return;
    const groups = groupsToShow();
    if (!groups.length && !tcgcsvCache.groups?.length) {
      panel.innerHTML = `<div class="bm-empty">No price data loaded.<br>Go to the Sealed tab and click<br><strong>↻ Sync Price Data</strong> first.</div>`;
      return;
    }
    if (!groups.length) {
      panel.innerHTML = `<div class="bm-empty">No sets match "${esc(browseFilter)}"</div>`;
      return;
    }
    panel.innerHTML = groups.map(g =>
      `<div class="bm-group-item${selectedGroup?.groupId === g.groupId ? ' selected' : ''}" data-gid="${g.groupId}">${esc(g.name)}</div>`
    ).join('');
    panel.querySelectorAll('.bm-group-item').forEach(el => {
      el.addEventListener('click', () => selectGroup(el.dataset.gid, el.textContent));
    });
  }

  function renderProducts() {
    const panel = document.getElementById('bm-products');
    if (!panel) return;
    if (!selectedGroup) {
      panel.innerHTML = `<div class="bm-empty">← Select a set to see its products</div>`;
      return;
    }
    const sorted = sortedProducts();
    if (!sorted.length) {
      panel.innerHTML = `<div class="bm-empty">No products with prices found.</div>`;
      return;
    }
    panel.innerHTML = sorted.map(p => `
      <div class="bm-product-item" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${p.marketPrice ?? ''}">
        <div class="bm-product-name">${esc(p.name)}</div>
        <div class="bm-product-price">${p.marketPrice != null ? fmt(p.marketPrice) : '<span style="color:var(--text-dim)">—</span>'}</div>
      </div>`).join('');
    panel.querySelectorAll('.bm-product-item').forEach(el => {
      el.addEventListener('click', () => {
        const price = el.dataset.price ? parseFloat(el.dataset.price) : NaN;
        hideModal();
        showAddSealedModal(null, { name: el.dataset.name, price: isNaN(price) ? null : price });
      });
    });
  }

  async function selectGroup(gid, gname) {
    selectedGroup = { groupId: gid, name: gname };
    groupProducts = [];
    renderGroups();
    const panel = document.getElementById('bm-products');
    if (panel) panel.innerHTML = `<div class="bm-empty">Loading…</div>`;
    try {
      const [prodResp, priceResp] = await Promise.all([
        fetch(`https://tcgcsv.com/tcgplayer/1/${gid}/products`),
        fetch(`https://tcgcsv.com/tcgplayer/1/${gid}/prices`),
      ]);
      if (!prodResp.ok || !priceResp.ok) throw new Error('Fetch failed');
      const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const priceMap = {};
      for (const p of prices) {
        const id = p.productId ?? p.skuId;
        const price = p.marketPrice ?? p.midPrice ?? p.lowPrice;
        if (id != null && price != null && (priceMap[id] == null || price > priceMap[id])) priceMap[id] = price;
      }
      groupProducts = products
        .map(p => ({
          id: `tcgcsv-${gid}-${p.productId}`,
          name: p.name || p.cleanName || '',
          consoleName: gname,
          marketPrice: priceMap[p.productId] != null ? parseFloat(priceMap[p.productId]) : null,
        }))
        .filter(p => p.name && p.marketPrice != null);
    } catch (err) {
      if (panel) panel.innerHTML = `<div class="bm-empty" style="color:var(--danger)">Load failed: ${esc(err.message)}</div>`;
      return;
    }
    renderProducts();
  }

  showModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="margin:0">Browse Sets</h2>
      <button class="btn" id="bm-cancel">✕ Close</button>
    </div>
    <div style="display:flex;gap:12px;height:480px">

      <!-- Left: group list -->
      <div style="width:220px;flex-shrink:0;display:flex;flex-direction:column;gap:8px">
        <input type="text" id="bm-filter" placeholder="Filter sets… (type any letter)" style="width:100%;box-sizing:border-box"
               value="${esc(browseFilter)}" autocomplete="off">
        <div id="bm-groups" class="bm-group-list"></div>
      </div>

      <!-- Right: product list -->
      <div style="flex:1;display:flex;flex-direction:column;gap:8px;min-width:0">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:12px;color:var(--text-dim)" id="bm-set-label">No set selected</span>
          <div style="flex:1"></div>
          <label style="font-size:12px;color:var(--text-dim)">Sort:</label>
          <select id="bm-sort" style="font-size:12px">
            <option value="name-asc">Name A→Z</option>
            <option value="name-desc">Name Z→A</option>
            <option value="price-desc">Price High→Low</option>
            <option value="price-asc">Price Low→High</option>
          </select>
        </div>
        <div id="bm-products" class="bm-product-list"></div>
      </div>
    </div>`, true);

  document.getElementById('bm-cancel').addEventListener('click', hideModal);

  const filterInput = document.getElementById('bm-filter');
  filterInput.addEventListener('input', e => {
    browseFilter = e.target.value;
    renderGroups();
  });
  // Keyboard shortcut: typing a letter in the modal focuses the filter
  filterInput.focus();

  document.getElementById('bm-sort').addEventListener('change', e => {
    browseSort = e.target.value;
    renderProducts();
  });

  renderGroups();
  renderProducts();
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD / EDIT SEALED MODAL
// ─────────────────────────────────────────────────────────────────────────────
function showAddSealedModal(editId = null, prefill = {}) {
  const ex = editId ? collection.sealed.find(i => i.id === editId) : null;
  const e  = ex || {};
  const lastPrice = prefill.price ?? (e.priceHistory?.length ? e.priceHistory[e.priceHistory.length - 1].price : '');

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
          ${PRODUCT_TYPES.map(t => `<option value="${t}" ${e.productType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>Status</label>
        <select id="sl-status">
          <option value="sealed" ${e.status !== 'opened' ? 'selected' : ''}>Sealed</option>
          <option value="opened" ${e.status === 'opened' ? 'selected' : ''}>Opened</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Quantity</label>
        <input type="number" id="sl-qty" min="1" value="${e.quantity || 1}">
      </div>
      <div class="form-group">
        <label>Purchase Price (USD)</label>
        <input type="number" id="sl-cost" step="0.01" min="0" placeholder="0.00" value="${e.purchasePrice || ''}">
      </div>
    </div>
    <div class="form-group">
      <label>Current Market Price (USD)</label>
      <input type="number" id="sl-price" step="0.01" min="0" placeholder="Enter manually or search below" value="${lastPrice}">
    </div>
    <div class="form-group">
      <label>Find Market Price <span style="color:var(--text-dim);font-weight:400;font-size:11px">(TCGCSV free · PriceCharting with key)</span></label>
      <div style="display:flex;gap:0;border:1px solid var(--border2);border-radius:var(--radius-sm);overflow:hidden;margin-bottom:8px">
        <button class="btn" id="sl-tab-search" style="flex:1;border-radius:0;border:none;background:var(--accent);color:var(--md-on-primary,#381e72)">Search</button>
        <button class="btn" id="sl-tab-browse" style="flex:1;border-radius:0;border:none;border-left:1px solid var(--border2)">Browse Sets</button>
      </div>
      <div id="sl-panel-search">
        <div style="display:flex;gap:6px">
          <input type="text" id="sl-tcg-query" placeholder="e.g. Secret Lair Artist Series" style="flex:1" value="${esc(e.name || '')}">
          <button class="btn" id="sl-tcg-btn" style="white-space:nowrap">Search</button>
        </div>
        <div id="sl-tcg-results" class="tcg-results" style="display:none;margin-top:6px"></div>
      </div>
      <div id="sl-panel-browse" style="display:none">
        <div id="sl-browse-groups" class="tcg-results" style="max-height:180px"></div>
        <div id="sl-browse-products" class="tcg-results" style="max-height:180px;margin-top:6px;display:none"></div>
      </div>
    </div>
    <div class="form-group">
      <label>Notes</label>
      <textarea id="sl-notes" rows="2" placeholder="Optional notes…">${esc(e.notes || '')}</textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="sl-cancel">Cancel</button>
      <button class="btn btn-primary" id="sl-save">Save Product</button>
    </div>`);

  document.getElementById('sl-cancel').addEventListener('click', hideModal);

  let _addSelectedPcId = ex?.pricechartingId || null;

  // ── Tab switching ──────────────────────────────────────────────────────────
  function switchTab(tab) {
    const isSearch = tab === 'search';
    document.getElementById('sl-panel-search').style.display = isSearch ? '' : 'none';
    document.getElementById('sl-panel-browse').style.display = isSearch ? 'none' : '';
    document.getElementById('sl-tab-search').style.background = isSearch ? 'var(--accent)' : '';
    document.getElementById('sl-tab-search').style.color      = isSearch ? 'var(--md-on-primary,#381e72)' : '';
    document.getElementById('sl-tab-browse').style.background = isSearch ? '' : 'var(--accent)';
    document.getElementById('sl-tab-browse').style.color      = isSearch ? '' : 'var(--md-on-primary,#381e72)';
    if (!isSearch) populateBrowseGroups();
  }
  document.getElementById('sl-tab-search').addEventListener('click', () => switchTab('search'));
  document.getElementById('sl-tab-browse').addEventListener('click', () => switchTab('browse'));

  // ── Browse mode ────────────────────────────────────────────────────────────
  function renderSearchResult(r) {
    return `<div class="tcg-result-item" data-id="${esc(r.id)}" data-price="${r.marketPrice ?? ''}" data-source="${esc(r.source)}">
      <div class="tcg-result-name">${esc(r.name)}</div>
      <div class="tcg-result-meta">
        <span class="tcg-result-console">${esc(r.consoleName)}</span>
        <span class="tcg-result-price">${r.marketPrice != null ? fmt(r.marketPrice) : '<span style="color:var(--text-dim)">No price</span>'} <span class="tcg-price-label">${r.source}</span></span>
      </div>
    </div>`;
  }

  function attachResultClicks(container) {
    container.querySelectorAll('.tcg-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const price = el.dataset.price ? parseFloat(el.dataset.price) : NaN;
        _addSelectedPcId = el.dataset.source === 'pricecharting' ? el.dataset.id : null;
        if (!isNaN(price)) document.getElementById('sl-price').value = price.toFixed(2);
        // Auto-fill name if empty
        const nameEl = document.getElementById('sl-name');
        if (!nameEl.value.trim()) nameEl.value = el.querySelector('.tcg-result-name').textContent;
        container.querySelectorAll('.tcg-result-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
      });
    });
  }

  function populateBrowseGroups() {
    const groupsEl   = document.getElementById('sl-browse-groups');
    const productsEl = document.getElementById('sl-browse-products');

    if (!tcgcsvCache.groups || !tcgcsvCache.groups.length) {
      groupsEl.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:12px">No groups loaded — click "↻ Sync Price Data" first, then reopen this dialog.</div>';
      return;
    }

    const sortedGroups = [...tcgcsvCache.groups].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    groupsEl.innerHTML = sortedGroups.map(g =>
      `<div class="tcg-result-item" data-gid="${g.groupId}" style="padding:8px 14px">
        <div class="tcg-result-name" style="font-size:13px">${esc(g.name)}</div>
      </div>`
    ).join('');

    groupsEl.querySelectorAll('.tcg-result-item').forEach(el => {
      el.addEventListener('click', async () => {
        groupsEl.querySelectorAll('.tcg-result-item').forEach(x => x.classList.remove('selected'));
        el.classList.add('selected');
        productsEl.style.display = 'block';
        productsEl.innerHTML = '<div style="padding:10px;color:var(--text-dim);font-size:12px">Loading…</div>';

        const gid  = el.dataset.gid;
        const gname = el.querySelector('.tcg-result-name').textContent;

        // Always do a live fetch in browse mode so we show ALL products, not just
        // the sealed-keyword-filtered subset that was cached during preload

        // Live fetch
        try {
          const [prodResp, priceResp] = await Promise.all([
            fetch(`https://tcgcsv.com/tcgplayer/1/${gid}/products`),
            fetch(`https://tcgcsv.com/tcgplayer/1/${gid}/prices`),
          ]);
          if (!prodResp.ok || !priceResp.ok) throw new Error('Fetch failed');
          const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
          const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
          const priceMap = {};
          for (const p of prices) {
            const id = p.productId ?? p.skuId;
            const price = p.marketPrice ?? p.midPrice ?? p.lowPrice;
            if (id != null && price != null && (priceMap[id] == null || price > priceMap[id])) priceMap[id] = price;
          }
          // In browse mode show ALL products with a price — user chose the group intentionally
          const sealedInGroup = products
            .map(p => ({
              id: `tcgcsv-${gid}-${p.productId}`,
              name: p.name || p.cleanName || '',
              consoleName: gname,
              marketPrice: priceMap[p.productId] != null ? parseFloat(priceMap[p.productId]) : null,
              source: 'tcgcsv',
            }))
            .filter(p => p.name && p.marketPrice != null);
          productsEl.innerHTML = sealedInGroup.length
            ? sealedInGroup.map(renderSearchResult).join('')
            : '<div style="padding:10px;color:var(--text-dim);font-size:12px">No products with prices found in this set.</div>';
          attachResultClicks(productsEl);
        } catch (err) {
          productsEl.innerHTML = `<div style="padding:10px;color:var(--danger);font-size:12px">Load failed: ${esc(err.message)}</div>`;
        }
      });
    });
  }

  document.getElementById('sl-tcg-btn').addEventListener('click', async () => {
    const query = (document.getElementById('sl-tcg-query').value || document.getElementById('sl-name').value).trim();
    if (!query) { toast('Enter a product name to search', 'error'); return; }
    const btn = document.getElementById('sl-tcg-btn');
    const resultsEl = document.getElementById('sl-tcg-results');
    btn.textContent = 'Searching…'; btn.disabled = true;
    try {
      const results = await searchSealedPrice(query);
      if (!results.length) {
        resultsEl.innerHTML = '<div class="tcg-no-results">No results found — try a different search term.</div>';
      } else {
        resultsEl.innerHTML = results.map(renderSearchResult).join('');
        attachResultClicks(resultsEl);
      }
      resultsEl.style.display = 'block';
    } catch (err) {
      toast('Search error: ' + err.message, 'error');
    } finally {
      btn.textContent = 'Search'; btn.disabled = false;
    }
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
function showUpdatePriceModal(id) {
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — cards & sealed to CSV / JSON / Markdown / Text, with app presets
// ─────────────────────────────────────────────────────────────────────────────
const EXPORT_LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
  zhs: 'Chinese Simplified', zht: 'Chinese Traditional', ph: 'Phyrexian',
};
const ARCHIDEKT_CONDITION = {
  mint: 'NM', near_mint: 'NM', lightly_played: 'LP',
  moderately_played: 'MP', heavily_played: 'HP', damaged: 'D',
};
const exportLang = code => EXPORT_LANG_NAMES[(code || 'en').toLowerCase()] || code;

function exportUnitPrice(c) {
  const h = getPriceHistory(c.scryfallId, c.foil);
  return h?.length ? h[h.length - 1].price : null;
}
function sealedUnitPrice(i) {
  return i.priceHistory?.length ? i.priceHistory[i.priceHistory.length - 1].price : null;
}

const EXPORT_COLUMNS = {
  cards: [
    { key: 'name',            label: 'Name',             get: c => c.name },
    { key: 'setCode',         label: 'Set Code',         get: c => c.setCode },
    { key: 'setName',         label: 'Set Name',         get: c => c.setName },
    { key: 'collectorNumber', label: 'Collector Number', get: c => c.collectorNumber },
    { key: 'foil',            label: 'Foil',             get: c => c.foil },
    { key: 'rarity',          label: 'Rarity',           get: c => c.rarity },
    { key: 'quantity',        label: 'Quantity',         get: c => c.quantity },
    { key: 'binderName',      label: 'Binder',           get: c => c.binderName },
    { key: 'condition',       label: 'Condition',        get: c => CONDITION_FULL[c.condition] || c.condition },
    { key: 'language',        label: 'Language',         get: c => c.language },
    { key: 'purchasePrice',   label: 'Purchase Price',   get: c => c.purchasePrice },
    { key: 'currency',        label: 'Currency',         get: c => c.purchasePriceCurrency },
    { key: 'currentPrice',    label: 'Current Price',    get: c => exportUnitPrice(c) ?? '' },
    { key: 'totalValue',      label: 'Total Value',      get: c => { const u = exportUnitPrice(c); return u != null ? +(u * c.quantity).toFixed(2) : ''; } },
    { key: 'scryfallId',      label: 'Scryfall ID',      get: c => c.scryfallId },
    { key: 'manaboxId',       label: 'ManaBox ID',       get: c => c.manaboxId },
    { key: 'misprint',        label: 'Misprint',         get: c => c.misprint ? 'true' : 'false' },
    { key: 'altered',         label: 'Altered',          get: c => c.altered ? 'true' : 'false' },
  ],
  sealed: [
    { key: 'name',          label: 'Name',           get: i => i.name },
    { key: 'productType',   label: 'Product Type',   get: i => i.productType },
    { key: 'setCode',       label: 'Set Code',       get: i => i.setCode },
    { key: 'setName',       label: 'Set Name',       get: i => i.setName },
    { key: 'quantity',      label: 'Quantity',       get: i => i.quantity },
    { key: 'status',        label: 'Status',         get: i => i.status },
    { key: 'purchasePrice', label: 'Purchase Price', get: i => i.purchasePrice },
    { key: 'currentPrice',  label: 'Current Price',  get: i => sealedUnitPrice(i) ?? '' },
    { key: 'totalValue',    label: 'Total Value',    get: i => { const u = sealedUnitPrice(i); return u != null ? +(u * i.quantity).toFixed(2) : ''; } },
    { key: 'notes',         label: 'Notes',          get: i => i.notes || '' },
  ],
};

// Presets emit CSVs with the exact headers those apps expect on import.
const EXPORT_PRESETS = {
  manabox: {
    label: 'ManaBox',
    note: 'Matches the ManaBox CSV format, so it imports back into ManaBox losslessly.',
    columns: [
      ['Name', c => c.name], ['Set code', c => c.setCode], ['Set name', c => c.setName],
      ['Collector number', c => c.collectorNumber], ['Foil', c => c.foil],
      ['Rarity', c => c.rarity], ['Quantity', c => c.quantity],
      ['ManaBox ID', c => c.manaboxId], ['Scryfall ID', c => c.scryfallId],
      ['Purchase price', c => c.purchasePrice], ['Misprint', c => c.misprint ? 'true' : 'false'],
      ['Altered', c => c.altered ? 'true' : 'false'], ['Condition', c => c.condition],
      ['Language', c => c.language], ['Purchase price currency', c => c.purchasePriceCurrency],
    ],
  },
  moxfield: {
    label: 'Moxfield',
    note: 'Import via Moxfield → Collection → Import → CSV.',
    columns: [
      ['Count', c => c.quantity], ['Name', c => c.name], ['Edition', c => c.setCode],
      ['Condition', c => CONDITION_FULL[c.condition] || c.condition],
      ['Language', c => exportLang(c.language)],
      ['Foil', c => c.foil === 'normal' ? '' : c.foil],
      ['Collector Number', c => c.collectorNumber],
      ['Purchase Price', c => c.purchasePrice || ''],
    ],
  },
  archidekt: {
    label: 'Archidekt',
    note: 'Import via Archidekt → Collection → Import; confirm the column mapping if prompted.',
    columns: [
      ['Quantity', c => c.quantity], ['Name', c => c.name],
      ['Finish', c => c.foil === 'foil' ? 'Foil' : c.foil === 'etched' ? 'Etched' : 'Non-foil'],
      ['Condition', c => ARCHIDEKT_CONDITION[c.condition] || 'NM'],
      ['Edition Code', c => c.setCode], ['Collector Number', c => c.collectorNumber],
      ['Language', c => exportLang(c.language)],
      ['Purchase Price', c => c.purchasePrice || ''],
      ['Scryfall ID', c => c.scryfallId],
    ],
  },
};

const EXPORT_FORMATS = [
  { id: 'csv',  label: 'CSV',      ext: 'csv',  filter: 'CSV files' },
  { id: 'json', label: 'JSON',     ext: 'json', filter: 'JSON files' },
  { id: 'md',   label: 'Markdown', ext: 'md',   filter: 'Markdown files' },
  { id: 'txt',  label: 'Text',     ext: 'txt',  filter: 'Text files' },
];

function buildExportContent(format, header, rows) {
  if (format === 'csv') {
    const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [header.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n');
  }
  if (format === 'json') {
    return JSON.stringify(rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]]))), null, 2);
  }
  if (format === 'md') {
    const mdesc = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    return [
      `| ${header.map(mdesc).join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.map(r => `| ${r.map(mdesc).join(' | ')} |`),
    ].join('\n');
  }
  // txt — fixed-width padded columns
  const cells = [header, ...rows].map(r => r.map(v => String(v ?? '').replace(/\r?\n/g, ' ')));
  const widths = header.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  const line = r => r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cells[0]), widths.map(w => '─'.repeat(w)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

function showExportModal(kind) {
  const isCards = kind === 'cards';
  const data = isCards ? collection.cards : collection.sealed;
  if (!data.length) { toast(`Nothing to export — your ${isCards ? 'card' : 'sealed'} collection is empty`, 'info'); return; }

  const colDefs = EXPORT_COLUMNS[kind];
  const saved = collection.settings.export?.[kind] || {};
  const state = {
    format: EXPORT_FORMATS.some(f => f.id === saved.format) ? saved.format : 'csv',
    preset: isCards && EXPORT_PRESETS[saved.preset] ? saved.preset : 'custom',
    columns: new Set(Array.isArray(saved.columns) && saved.columns.length
      ? saved.columns.filter(k => colDefs.some(d => d.key === k))
      : colDefs.map(d => d.key)),
  };
  if (!state.columns.size) colDefs.forEach(d => state.columns.add(d.key));

  showModal(`
    <h2>Export ${isCards ? 'Card' : 'Sealed'} Collection</h2>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px">
      Exports all ${data.length.toLocaleString()} ${isCards ? 'card entries' : 'products'} to a file.
    </p>
    ${isCards ? `
    <h3>Preset</h3>
    <div class="col-picker-chips" id="exp-presets" style="margin-bottom:8px">
      <button class="col-chip" data-preset="custom">Custom</button>
      ${Object.entries(EXPORT_PRESETS).map(([id, p]) => `<button class="col-chip" data-preset="${id}">${p.label}</button>`).join('')}
    </div>
    <div id="exp-preset-note" style="font-size:11.5px;color:var(--text-muted);margin-bottom:14px;min-height:14px"></div>
    ` : ''}
    <h3>Format</h3>
    <div class="col-picker-chips" id="exp-formats" style="margin-bottom:16px">
      ${EXPORT_FORMATS.map(f => `<button class="col-chip" data-format="${f.id}">${f.label}</button>`).join('')}
    </div>
    <div id="exp-columns-wrap">
      <h3>Columns</h3>
      <div class="col-picker-chips" id="exp-columns" style="max-height:150px;overflow-y:auto;padding:2px">
        ${colDefs.map(d => `<button class="col-chip" data-colkey="${d.key}">${esc(d.label)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="exp-cols-all">Select all</button>
        <button class="btn btn-ghost btn-sm" id="exp-cols-none">Select none</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px">
      <button class="btn" id="exp-cancel">Cancel</button>
      <button class="btn btn-primary" id="exp-go">⤓ Export</button>
    </div>`);

  const sync = () => {
    document.querySelectorAll('#exp-presets .col-chip').forEach(b =>
      b.classList.toggle('col-chip-on', b.dataset.preset === state.preset));
    const note = document.getElementById('exp-preset-note');
    if (note) note.textContent = state.preset !== 'custom'
      ? `${EXPORT_PRESETS[state.preset].note} The preset defines the columns and always exports CSV.`
      : '';
    document.querySelectorAll('#exp-formats .col-chip').forEach(b => {
      const locked = state.preset !== 'custom';
      b.classList.toggle('col-chip-on', locked ? b.dataset.format === 'csv' : b.dataset.format === state.format);
      b.disabled = locked && b.dataset.format !== 'csv';
      b.style.opacity = b.disabled ? '0.4' : '';
    });
    const wrap = document.getElementById('exp-columns-wrap');
    if (wrap) wrap.style.display = state.preset !== 'custom' ? 'none' : '';
    document.querySelectorAll('#exp-columns .col-chip').forEach(b =>
      b.classList.toggle('col-chip-on', state.columns.has(b.dataset.colkey)));
  };

  document.getElementById('exp-presets')?.addEventListener('click', e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    state.preset = b.dataset.preset;
    if (state.preset !== 'custom') state.format = 'csv';
    sync();
  });
  document.getElementById('exp-formats').addEventListener('click', e => {
    const b = e.target.closest('[data-format]'); if (!b || b.disabled) return;
    state.format = b.dataset.format; sync();
  });
  document.getElementById('exp-columns').addEventListener('click', e => {
    const b = e.target.closest('[data-colkey]'); if (!b) return;
    const k = b.dataset.colkey;
    if (state.columns.has(k)) state.columns.delete(k); else state.columns.add(k);
    sync();
  });
  document.getElementById('exp-cols-all').addEventListener('click', () => { colDefs.forEach(d => state.columns.add(d.key)); sync(); });
  document.getElementById('exp-cols-none').addEventListener('click', () => { state.columns.clear(); sync(); });
  document.getElementById('exp-cancel').addEventListener('click', hideModal);

  document.getElementById('exp-go').addEventListener('click', async () => {
    let header, rowFns, format = state.format, baseName;
    if (state.preset !== 'custom') {
      const p = EXPORT_PRESETS[state.preset];
      header  = p.columns.map(([h]) => h);
      rowFns  = p.columns.map(([, fn]) => fn);
      format  = 'csv';
      baseName = `${state.preset}-export`;
    } else {
      const chosen = colDefs.filter(d => state.columns.has(d.key));
      if (!chosen.length) { toast('Pick at least one column', 'error'); return; }
      header  = chosen.map(d => d.label);
      rowFns  = chosen.map(d => d.get);
      baseName = `${kind}-export`;
    }
    const rows    = data.map(item => rowFns.map(fn => fn(item)));
    const fmtDef  = EXPORT_FORMATS.find(f => f.id === format);
    const content = buildExportContent(format, header, rows);
    const path = await window.api.dialog.saveFile({
      title: `Export ${isCards ? 'cards' : 'sealed collection'}`,
      defaultPath: `${baseName}-${today()}.${fmtDef.ext}`,
      filterName: fmtDef.filter,
      extensions: [fmtDef.ext],
      content,
    });
    if (!path) return;  // cancelled — keep the modal open
    collection.settings.export = collection.settings.export || {};
    collection.settings.export[kind] = { format: state.format, preset: state.preset, columns: [...state.columns] };
    autoSave();
    hideModal();
    toast(`Exported ${rows.length.toLocaleString()} ${isCards ? 'entries' : 'products'} → ${path.split(/[\\/]/).pop()}`, 'success');
    window.logger?.info?.('Export', `Wrote ${path}`);
  });

  sync();
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MODAL
// ─────────────────────────────────────────────────────────────────────────────
function showSettings() {
  const tcfg = tickerSettings();
  const tickerBinders = [...new Set(collection.cards.map(c => c.binderName).filter(Boolean))].sort();
  const tickerSets    = [...new Set(collection.cards.map(c => c.setName).filter(Boolean))].sort();
  const chipHtml = (vals, selected) => vals.map(v =>
    `<button type="button" class="col-chip${selected.includes(v) ? ' col-chip-on' : ''}" data-val="${esc(v)}">${esc(v)}</button>`
  ).join('');

  showModal(`
    <h2>Settings</h2>

    <h3>Ticker Tape</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Choose which cards scroll across the top and how fast. With nothing selected,
      the ticker shows your whole collection (biggest price movers first).
    </p>
    <div class="form-group">
      <label>Scroll Speed</label>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:var(--text-muted)">Slow</span>
        <input type="range" id="cfg-ticker-speed" min="1" max="10" step="1" value="${tcfg.speed}"
          style="flex:1;accent-color:var(--accent)">
        <span style="font-size:11px;color:var(--text-muted)">Fast</span>
      </div>
    </div>
    <div class="form-group">
      <label>Binders <span style="color:var(--text-muted);font-weight:400">(none selected = all)</span></label>
      <div class="col-picker-chips" id="cfg-ticker-binders" style="max-height:110px;overflow-y:auto;padding:2px">
        ${chipHtml(tickerBinders, tcfg.binders) || '<span style="font-size:12px;color:var(--text-muted)">No binders yet</span>'}
      </div>
    </div>
    <div class="form-group">
      <label>Sets <span style="color:var(--text-muted);font-weight:400">(none selected = all)</span></label>
      <div class="col-picker-chips" id="cfg-ticker-sets" style="max-height:140px;overflow-y:auto;padding:2px">
        ${chipHtml(tickerSets, tcfg.sets) || '<span style="font-size:12px;color:var(--text-muted)">No sets yet</span>'}
      </div>
    </div>

    <h3 style="margin-top:22px">Sealed Product Pricing</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      <strong style="color:var(--text)">TCGCSV</strong> is built-in and free — no key needed. It searches TCGPlayer group data and works automatically.<br>
      <strong style="color:var(--text)">PriceCharting</strong> adds a second source with broader coverage. Get a free key at
      <a href="https://www.pricecharting.com/api" target="_blank">pricecharting.com/api</a> (email signup only, no approval).
    </p>
    <div class="form-group">
      <label>PriceCharting API Key <span style="color:var(--text-dim);font-weight:400">(optional)</span></label>
      <input type="text" id="cfg-pckey" placeholder="Paste your PriceCharting API key here" value="${esc(collection.settings.pricechartingKey || '')}">
    </div>

    <h3 style="margin-top:22px">Data Management</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Each button below permanently deletes data from the SQLite database.
      "Load Collection" merges imported data with what's already here — your existing data is preserved unless you reset first.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-danger btn-sm" id="cfg-clear-cards">Clear All Cards</button>
      <button class="btn btn-danger btn-sm" id="cfg-clear-sealed">Clear All Sealed</button>
      <button class="btn btn-danger btn-sm" id="cfg-clear-hist">Clear Price History</button>
    </div>

    <h3 style="margin-top:22px">Updates</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      Check GitHub Releases for a newer version. If one exists, the app will download it and
      restart to install. <span id="upd-current" style="color:var(--text-muted)"></span>
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-sm" id="cfg-check-updates">Check for Updates</button>
      <button class="btn btn-sm" id="cfg-download-update" style="display:none">Download Update</button>
      <button class="btn btn-primary btn-sm" id="cfg-install-update" style="display:none">Restart &amp; Install</button>
    </div>
    <div id="upd-status" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
    <div id="upd-progress-wrap" style="display:none;margin-top:8px">
      <div style="background:#222;border-radius:4px;height:8px;overflow:hidden">
        <div id="upd-progress-bar" style="background:var(--accent,#6366f1);height:100%;width:0%;transition:width .2s"></div>
      </div>
      <div id="upd-progress-text" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
    </div>

    <h3 style="margin-top:22px;color:#f87171">Danger Zone</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Wipe the entire database — cards, sealed, prices, metadata, settings, SL cache.
      The app restarts with empty memory. <strong style="color:#f87171">Cannot be undone.</strong>
      Export "Save Collection" first if you want a backup.
    </p>
    <button class="btn btn-danger" id="cfg-reset-all" style="font-weight:700">⚠ Reset Entire Database</button>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:26px">
      <button class="btn" id="cfg-cancel">Cancel</button>
      <button class="btn btn-primary" id="cfg-save">Save Settings</button>
    </div>`);

  document.getElementById('cfg-cancel').addEventListener('click', hideModal);

  // Ticker filter chips toggle on click
  for (const id of ['cfg-ticker-binders', 'cfg-ticker-sets']) {
    document.getElementById(id).addEventListener('click', e => {
      const chip = e.target.closest('.col-chip');
      if (chip) chip.classList.toggle('col-chip-on');
    });
  }

  document.getElementById('cfg-save').addEventListener('click', () => {
    collection.settings.pricechartingKey = document.getElementById('cfg-pckey').value.trim();
    const pickChips = id =>
      [...document.querySelectorAll(`#${id} .col-chip-on`)].map(b => b.dataset.val);
    collection.settings.ticker = {
      speed:   parseInt(document.getElementById('cfg-ticker-speed').value, 10) || 4,
      binders: pickChips('cfg-ticker-binders'),
      sets:    pickChips('cfg-ticker-sets'),
    };
    hideModal();
    renderTickerTape();
    autoSave();
    toast('Settings saved', 'success');
  });
  document.getElementById('cfg-clear-cards').addEventListener('click', async () => {
    if (!confirm('Delete ALL cards from the database? This cannot be undone.')) return;
    await window.api.cards.clear();
    collection.cards = [];
    hideModal(); render(); toast('Cards cleared from database', 'info');
  });
  document.getElementById('cfg-clear-sealed').addEventListener('click', async () => {
    if (!confirm('Delete ALL sealed products from the database? This cannot be undone.')) return;
    await window.api.sealed.clear();
    collection.sealed = [];
    hideModal(); render(); toast('Sealed products cleared from database', 'info');
  });
  document.getElementById('cfg-clear-hist').addEventListener('click', async () => {
    if (!confirm('Delete ALL price history from the database? This cannot be undone.')) return;
    await window.api.prices.clear();
    collection.priceHistory = {};
    collection.marketPriceHistory = {};
    hideModal(); render(); toast('Price history cleared from database', 'info');
  });
  document.getElementById('cfg-reset-all').addEventListener('click', async () => {
    if (!confirm('⚠ RESET ENTIRE DATABASE\n\nThis deletes EVERYTHING:\n• All cards\n• All sealed products\n• All price history\n• All card metadata\n• All settings\n• Cached Secret Lair data\n\nThis cannot be undone. Continue?')) return;
    if (!confirm('Last chance — really wipe everything?')) return;
    await window.api.data.reset();
    // Reset in-memory state to a fresh collection
    collection.cards               = [];
    collection.sealed              = [];
    collection.priceHistory        = {};
    collection.marketPriceHistory  = {};
    collection.cardMetadata        = {};
    collection.failedLookups       = [];
    collection.settings            = { pricechartingKey: '' };
    collection.lastPriceRefresh    = null;
    hideModal();
    render();
    toast('Database reset — starting fresh', 'success');
  });

  // Updates section
  wireUpdaterUI();
}

// ─────────────────────────────────────────────────────────────────────────────
// UPDATER (electron-updater driven from Settings)
// ─────────────────────────────────────────────────────────────────────────────
const updaterUI = { current: null, latest: null, downloading: false };

function setUpdStatus(text, color) {
  const el = document.getElementById('upd-status');
  if (!el) return;
  el.textContent = text || '';
  el.style.color = color || 'var(--text-muted)';
}
function showUpdProgress(show) {
  const w = document.getElementById('upd-progress-wrap');
  if (w) w.style.display = show ? 'block' : 'none';
}
function setUpdProgress(percent, transferred, total, bps) {
  const bar = document.getElementById('upd-progress-bar');
  const txt = document.getElementById('upd-progress-text');
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent || 0)).toFixed(1)}%`;
  if (txt) {
    const mb = (n) => (n / 1024 / 1024).toFixed(1);
    const kbps = bps ? `${(bps / 1024).toFixed(0)} KB/s` : '';
    txt.textContent = total
      ? `${mb(transferred)} / ${mb(total)} MB${kbps ? ' · ' + kbps : ''}`
      : '';
  }
}

async function wireUpdaterUI() {
  // Current version
  try {
    updaterUI.current = await window.api.app.version();
    const cur = document.getElementById('upd-current');
    if (cur) cur.textContent = `Current version: v${updaterUI.current}`;
  } catch {}

  const checkBtn    = document.getElementById('cfg-check-updates');
  const downloadBtn = document.getElementById('cfg-download-update');
  const installBtn  = document.getElementById('cfg-install-update');

  if (checkBtn) checkBtn.addEventListener('click', async () => {
    setUpdStatus('Checking for updates…');
    if (downloadBtn) downloadBtn.style.display = 'none';
    if (installBtn)  installBtn.style.display  = 'none';
    showUpdProgress(false);
    const r = await window.api.updater.check();
    if (r && r.devMode) {
      setUpdStatus('Update checks only work in the installed app, not in dev mode.', '#fbbf24');
    } else if (r && !r.ok && r.error) {
      setUpdStatus(`Error: ${r.error}`, '#f87171');
    }
  });

  if (downloadBtn) downloadBtn.addEventListener('click', async () => {
    if (updaterUI.downloading) return;
    updaterUI.downloading = true;
    downloadBtn.disabled = true;
    setUpdStatus(`Downloading v${updaterUI.latest || ''}…`);
    showUpdProgress(true);
    setUpdProgress(0, 0, 0, 0);
    const r = await window.api.updater.download();
    if (r && !r.ok && r.error) {
      setUpdStatus(`Download failed: ${r.error}`, '#f87171');
      updaterUI.downloading = false;
      downloadBtn.disabled = false;
    }
  });

  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!confirm('Restart the app now to install the update?')) return;
    await window.api.updater.install();
  });
}

// One-time global listener for updater events from the main process.
// Settings modal may not be open, so we guard every DOM lookup.
if (window.api && window.api.updater && !window.__updaterBound) {
  window.__updaterBound = true;
  window.api.updater.onEvent(({ event, payload }) => {
    switch (event) {
      case 'checking':
        setUpdStatus('Checking for updates…');
        break;
      case 'available':
        // Only toast once per session per version (startup check + Settings click
        // would otherwise double-toast).
        if (updaterUI.latest !== payload.version) {
          toast(`Update v${payload.version} available — open Settings to download`, 'info', 6000);
        }
        updaterUI.latest = payload.version;
        setUpdStatus(`Update available: v${payload.version}`, '#4ade80');
        const dl = document.getElementById('cfg-download-update');
        if (dl) dl.style.display = 'inline-block';
        break;
      case 'not-available':
        setUpdStatus(`You're on the latest version (v${updaterUI.current || payload.version}).`, '#4ade80');
        break;
      case 'progress':
        showUpdProgress(true);
        setUpdProgress(payload.percent, payload.transferred, payload.total, payload.bytesPerSecond);
        break;
      case 'downloaded':
        updaterUI.downloading = false;
        showUpdProgress(false);
        setUpdStatus(`v${payload.version} downloaded. Restart to install.`, '#4ade80');
        const dlb = document.getElementById('cfg-download-update');
        if (dlb) dlb.style.display = 'none';
        const ib = document.getElementById('cfg-install-update');
        if (ib) ib.style.display = 'inline-block';
        toast(`Update v${payload.version} ready — restart to install`, 'success', 6000);
        break;
      case 'error':
        updaterUI.downloading = false;
        showUpdProgress(false);
        setUpdStatus(`Error: ${payload.message}`, '#f87171');
        break;
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS (re-attached after each render)
// ─────────────────────────────────────────────────────────────────────────────
// ── Card hover preview ─────────────────────────────────────────────────────
let _hoverShowTimer = null;

function findCollectionCardById(id) {
  return collection.cards.find(c => c.id === id);
}

function buildCardHoverHtml(card) {
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

function showCardHoverPreview(el, card) {
  const preview = document.getElementById('card-hover-preview');
  if (!preview) return;
  clearTimeout(_hoverShowTimer);
  _hoverShowTimer = setTimeout(() => {
    preview.innerHTML = buildCardHoverHtml(card);
    preview.classList.add('visible');
    // Defer until after browser reflow so offsetHeight is accurate
    requestAnimationFrame(() => positionHoverPreview(el));
  }, 200);
}

function positionHoverPreview(anchorEl) {
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

function hideCardHoverPreview() {
  clearTimeout(_hoverShowTimer);
  const preview = document.getElementById('card-hover-preview');
  if (preview) preview.classList.remove('visible');
}

// SL tile hover: user may or may not own the printing. If owned, show full
// owned-card details. Otherwise build a partial preview from MTGJSON name +
// drop info — no Scryfall fetch (would be too slow for hover).
function showSlTileHoverPreview(el, scryfallId) {
  const owned = collection.cards.find(c => c.scryfallId === scryfallId);
  if (owned) { showCardHoverPreview(el, owned); return; }

  const preview = document.getElementById('card-hover-preview');
  if (!preview) return;
  clearTimeout(_hoverShowTimer);
  _hoverShowTimer = setTimeout(() => {
    const id = (scryfallId || '').toLowerCase();
    const img = id ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg` : '';
    const name = (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[scryfallId]) || 'Unknown card';
    const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(scryfallId) : [];
    preview.innerHTML = `
      ${img ? `<img class="chp-img" src="${esc(img)}" alt="${esc(name)}" onerror="this.style.display='none'">` : ''}
      <div class="chp-name">${esc(name)}</div>
      <div class="chp-sub" style="color:#f87171">Not in your collection</div>
      ${slInfo.length ? `<div class="chp-grid">
        ${slInfo.map(s => `
          <span class="lbl">SL Drop</span><span style="color:var(--accent2)">${esc(s.drop)}</span>
          <span class="lbl">Superdrop</span><span>${esc(s.superdrop)}</span>
        `).join('')}
      </div>` : ''}`;
    preview.classList.add('visible');
    requestAnimationFrame(() => positionHoverPreview(el));
  }, 200);
}

function attachContentListeners() {
  // Dashboard drag-and-drop reorder
  if (ui.activeTab === 'dashboard') attachDashboardDragHandlers();

  // Empty state CSV import
  const emptyCsv = document.getElementById('emptyCsvBtn');
  if (emptyCsv) emptyCsv.addEventListener('click', () => importCsvFile().catch(console.error));

  // ── Card hover previews across tabs ─────────────────────────────────────
  // Gallery: each .gallery-card has onclick="showGalleryModal('cardId')"
  if (ui.activeTab === 'gallery') {
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
  // Secret Lair Explorer drop view: tiles have onclick="showSlViewerModal('scryfallId')"
  if (ui.activeTab === 'slviewer') {
    document.querySelectorAll('.gallery-card[onclick*="showSlViewerModal"]').forEach(el => {
      const m = el.getAttribute('onclick').match(/showSlViewerModal\('([^']+)'\)/);
      const scryfallId = m ? m[1] : null;
      if (!scryfallId) return;
      el.addEventListener('mouseenter', () => showSlTileHoverPreview(el, scryfallId));
      el.addEventListener('mouseleave', hideCardHoverPreview);
    });
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

  [['foilFilter', 'foil'], ['rarityFilter', 'rarity'], ['conditionFilter', 'condition'], ['langFilter', 'language']].forEach(([id, key]) => {
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

  // Add sealed buttons
  ['addSealedBtn', 'addSealedBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => showAddSealedModal());
  });
  // Browse sets buttons
  ['browseSealedBtn', 'browseSealedBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => showBrowseModal());
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
      else if (action === 'delete-sealed') {
        if (confirm('Delete this product from your collection?')) {
          collection.sealed = collection.sealed.filter(i => i.id !== id);
          render();
          autoSave();
          toast('Product removed', 'info');
        }
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  // Tab buttons (always present in nav — attach once)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  // Sidebar Settings button
  const sbs = document.getElementById('sidebarSettings');
  if (sbs) sbs.addEventListener('click', showSettings);

  // Activity log panel — status-bar button + close + clear
  const sbLogs = document.getElementById('sb-logs');
  if (sbLogs) sbLogs.addEventListener('click', toggleLogPanel);
  const logsClose = document.getElementById('logs-close');
  if (logsClose) logsClose.addEventListener('click', () => { logsPanelOpen = true; toggleLogPanel(); });
  const logsClear = document.getElementById('logs-clear');
  if (logsClear) logsClear.addEventListener('click', () => window.logger.clear());
  // Ctrl+L global toggle
  document.addEventListener('keydown', e => {
    if (e.key === 'l' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      toggleLogPanel();
    }
  });

  // Native menu bar — actions arrive over IPC from main process
  if (window.api && window.api.onMenuAction) {
    window.api.onMenuAction(action => {
      if (action.startsWith('tab:')) {
        const tab = action.slice(4);
        ui.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        render();
        return;
      }
      switch (action) {
        case 'import:csv':       importCsvFile().catch(console.error); break;
        case 'import:json':      loadCollectionFile().catch(console.error); break;
        case 'export:json':      saveCollection().catch(console.error); break;
        case 'refresh:prices':   refreshPrices(); break;
        case 'refresh:sl':       if (typeof refreshSlData === 'function') refreshSlData(); break;
        case 'settings:open':    showSettings(); break;
        case 'settings:reset':   showSettings(); break; // user clicks Reset Database button inside
        case 'updates:check':
          showSettings();
          setTimeout(() => {
            const b = document.getElementById('cfg-check-updates');
            if (b) b.click();
          }, 50);
          break;
        case 'about:show':       showAbout(); break;
        case 'logs:toggle':      toggleLogPanel(); break;
      }
    });
  }

  // Modal dismiss
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') hideModal();
  });
  document.getElementById('modal-close').addEventListener('click', hideModal);

  // Load cached SL data from SQLite (from a previous Refresh SL Data click)
  if (typeof loadSlDataFromCache === 'function') await loadSlDataFromCache();

  // Expose helpers/state to the Svelte renderer (window.app + window.collection)
  window.collection = collection;
  window.app = {
    fmt, fmtPct, esc, FOIL_LABEL,
    cardCurrentValue, totalCardsValue, totalSealedValue,
    binderValueMap, topMovers,
    valueByColor: analyzeByColor,
    valueByType: analyzeByType,
    valueByMana: analyzeByManaValue,
    refreshPrices,
    renderCardOfTheDay,
    rerollCotd: () => { ui.cotdOffset = (ui.cotdOffset || 0) + 1; render(); },
    // Legacy panel renderers — Svelte wrappers @html them in.
    renderColorPanel,
    renderTypePanel,
    renderManaValuePanel,
    renderRarityPanel,
    renderStatsPanel,
    renderCardCountBySet,
    renderValueBySet,
    renderCardCountByYear,
    renderTop10ValueCards,
    showCardHoverPreview,
    hideCardHoverPreview,
    findCollectionCardById,
  };

  // Auto-load from SQLite on startup
  window.logger?.info('App', 'Starting up — loading collection from SQLite…');
  const loaded = await autoLoad();
  if (loaded) {
    const el = document.getElementById('autosave-status');
    if (el) {
      el.textContent = `● Restored (${collection.cards.length.toLocaleString()} cards)`;
      el.style.opacity = '1';
      el._fadeTimer = setTimeout(() => { el.style.opacity = '0.4'; }, 5000);
    }
    window.logger?.success('App', `Loaded ${collection.cards.length.toLocaleString()} cards · ${(collection.sealed || []).length} sealed · ${Object.keys(collection.priceHistory || {}).length.toLocaleString()} price-history series`);
  } else {
    window.logger?.info('App', 'No prior collection found — starting fresh');
  }

  render();

  // Auto-refresh once per calendar day on first open — runs after render so the
  // UI is visible before the network requests start.
  if (collection.cards.length > 0) {
    const todayStr = new Date().toDateString();
    const lastStr  = collection.lastPriceRefresh
      ? new Date(collection.lastPriceRefresh).toDateString()
      : null;
    if (lastStr !== todayStr) {
      window.logger?.info('App', 'First open today — auto-refreshing prices and SL data…');
      setTimeout(async () => {
        await refreshPrices();
        if (typeof refreshSlData === 'function') refreshSlData();
      }, 800);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
