'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const SCRYFALL_COLLECTION = 'https://api.scryfall.com/cards/collection';
const EBAY_TOKEN_URL  = 'https://corsproxy.io/?url=https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_SEARCH_URL = 'https://corsproxy.io/?url=https://api.ebay.com/buy/browse/v1/item_summary/search';

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
let ui = {
  activeTab: 'dashboard',
  cards: {
    binder: 'all', search: '', foil: 'all', rarity: 'all',
    condition: 'all', language: 'all',
    sortField: 'name', sortDir: 'asc',
    page: 1, perPage: 50
  },
  sealed: { search: '', type: 'all', status: 'all' },
  gallery: { binder: '', set: '', cmc: '', search: '', sortField: 'name', sortDir: 'asc', page: 0 },
  slViewer: { superdrop: '', drop: '', page: 0 },
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
    settings: { ebayClientId: '', ebayClientSecret: '' },
    cards: [],
    sealed: [],
    priceHistory: {},
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

    // Flatten priceHistory into a list of snapshot rows for bulkStore
    const priceSnaps = [];
    for (const [k, hist] of Object.entries(collection.priceHistory || {})) {
      const [sid, foil] = k.split('|');
      for (const h of hist) priceSnaps.push({ scryfallId: sid, foil, date: h.date, price: h.price });
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
    }));
    collection.priceHistory  = prices;
    collection.cardMetadata  = metadata;
    collection.failedLookups = failures;
    collection.settings = settings.settings_blob
      ? JSON.parse(settings.settings_blob)
      : { ebayClientId: '', ebayClientSecret: '' };
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

    // Settings: keep current (don't overwrite eBay creds with imported values)
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
  const rows = parseCsv(result.text);
  const incoming = rows.map(csvRowToCard).filter(c => c.scryfallId && c.name);
  let added = 0, updated = 0;

  for (const card of incoming) {
    const idx = card.manaboxId
      ? collection.cards.findIndex(c =>
          c.manaboxId === card.manaboxId &&
          c.scryfallId === card.scryfallId &&
          c.foil === card.foil)
      : -1;
    if (idx >= 0) { collection.cards[idx] = { ...collection.cards[idx], ...card }; updated++; }
    else           { collection.cards.push(card); added++; }
  }

  toast(`CSV imported — ${added} added, ${updated} updated`, 'success');
  window.logger?.success('Import', `CSV: ${added} new + ${updated} updated cards from ${result.path?.split(/[\\/]/).pop() || 'file'}`);
  render();
  await autoSave();
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

    // Metadata (store once per scryfallId)
    if (!collection.cardMetadata[scryfallId]) {
      collection.cardMetadata[scryfallId] = {
        colors:         card.colors         || [],
        color_identity: card.color_identity || [],
        type_line:      card.type_line      || '',
        cmc:            card.cmc            ?? null,
        power:          card.power          ?? null,
        toughness:      card.toughness      ?? null,
      };
    }
  }

  collection.failedLookups = failedLookups;
  if (!collection.cardMetadata) collection.cardMetadata = {};

  const summary = `Refresh complete: ${pricedCount}/${pairs.length} priced · ${notFoundIds.size} not found · ${batchFailedIds.size} batch errors · ${failedLookups.length} total issues`;
  if (failedLookups.length === 0) window.logger?.success('Price', summary);
  else if (batchFailedIds.size > 0) window.logger?.warn('Price', summary);
  else window.logger?.info('Price', summary);

  collection.lastPriceRefresh = new Date().toISOString();
  ui.refreshing = false;
  ui.refreshProgress = 0;

  const parts = [`${pricedCount} of ${pairs.length} printings priced`];
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
  showModal(`
    <h2>Secret Lair Tracker</h2>
    <p style="color:var(--text-dim);font-size:13px;margin:6px 0 14px">Desktop edition · Electron + SQLite</p>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;font-size:13px;line-height:1.7">
      <span style="color:var(--text-muted)">Version</span><span>0.1.0</span>
      <span style="color:var(--text-muted)">Cards</span><span>${collection.cards.length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Sealed</span><span>${collection.sealed.length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Last refresh</span><span>${collection.lastPriceRefresh ? new Date(collection.lastPriceRefresh).toLocaleString() : 'Never'}</span>
    </div>
    <p style="font-size:11px;color:var(--text-muted);margin-top:18px;line-height:1.5">
      Card prices via <a href="#" onclick="window.api.app.openExternal('https://scryfall.com');return false">Scryfall</a>.
      Secret Lair drop data via <a href="#" onclick="window.api.app.openExternal('https://mtgjson.com');return false">MTGJSON</a>.
      Sealed prices via eBay Browse API (your credentials, configured in Settings).
    </p>
    <div style="display:flex;justify-content:flex-end;margin-top:18px">
      <button class="btn btn-primary" onclick="hideModal()">Close</button>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// EBAY API
// ─────────────────────────────────────────────────────────────────────────────
async function getEbayToken() {
  const { ebayClientId, ebayClientSecret } = collection.settings;
  if (!ebayClientId || !ebayClientSecret)
    throw new Error('eBay credentials not set — open Settings to configure them');

  const creds = btoa(`${ebayClientId}:${ebayClientSecret}`);
  const resp  = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope'
  });
  if (!resp.ok) throw new Error(`eBay auth failed (${resp.status}) — check your credentials in Settings`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('eBay returned no token — check your credentials');
  return data.access_token;
}

async function searchEbayPrice(query) {
  const token = await getEbayToken();
  const params = new URLSearchParams({
    q: query,
    filter: 'conditions:{NEW}',
    sort: 'price',
    limit: '10'
  });
  const resp = await fetch(`${EBAY_SEARCH_URL}?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US'
    }
  });
  if (!resp.ok) throw new Error(`eBay search failed (${resp.status})`);
  const data = await resp.json();
  const prices = (data.itemSummaries || [])
    .map(i => parseFloat(i.price?.value))
    .filter(p => !isNaN(p) && p > 0)
    .sort((a, b) => a - b);
  if (!prices.length) return null;
  return prices[Math.floor(prices.length / 2)]; // median
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

  return `
    <div class="summary-grid">
      <div class="summary-card">
        <div class="s-icon">💰</div>
        <div class="s-label">Total Portfolio Value</div>
        <div class="s-value">${fmt(tot)}</div>
        <div class="s-sub ${gainClass}">
          ${gainLoss >= 0 ? '▲' : '▼'} ${fmt(Math.abs(gainLoss))}
          ${gainPct != null ? ` (${fmtPct(gainPct)})` : ''} vs cost basis
        </div>
      </div>
      <div class="summary-card">
        <div class="s-icon">🃏</div>
        <div class="s-label">Cards Value</div>
        <div class="s-value">${fmt(cv)}</div>
        <div class="s-sub">${totalQty.toLocaleString()} copies · ${collection.cards.length.toLocaleString()} entries</div>
      </div>
      <div class="summary-card">
        <div class="s-icon">📦</div>
        <div class="s-label">Sealed Value</div>
        <div class="s-value">${fmt(sv)}</div>
        <div class="s-sub">${sealedQty} item${sealedQty !== 1 ? 's' : ''} tracked</div>
      </div>
      <div class="summary-card">
        <div class="s-icon">🏷️</div>
        <div class="s-label">Total Cost Basis</div>
        <div class="s-value">${fmt(totalCost)}</div>
        <div class="s-sub">Cards ${fmt(costCards)} · Sealed ${fmt(costSealed)}</div>
      </div>
      <div class="summary-card">
        <div class="s-icon">📂</div>
        <div class="s-label">Binders</div>
        <div class="s-value">${binders.size}</div>
        <div class="s-sub">${collection.sealed.length} sealed products tracked</div>
      </div>
      <div class="summary-card">
        <div class="s-icon">🔄</div>
        <div class="s-label">Last Price Refresh</div>
        <div class="s-value" style="font-size:13px;margin-top:4px;letter-spacing:0">${lastRefresh}</div>
        ${ui.refreshing ? `<div class="progress-bar"><div class="progress-fill" id="refresh-progress-fill" style="width:${ui.refreshProgress}%"></div></div>` : ''}
      </div>
    </div>

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
  const th = (field, label) => `<th data-sort="${field}" class="${s.sortField === field ? 'sort-' + s.sortDir : ''}">${label}</th>`;

  return `
    <div class="cards-layout">
      <div class="binder-sidebar">
        <div class="binder-sidebar-title">Binders</div>
        ${[['all', 'All Binders'], ...allBinders.map(b => [b, b])].map(([val, label], i) => {
          const qty = val === 'all'
            ? collection.cards.reduce((s, c) => s + c.quantity, 0)
            : collection.cards.filter(c => c.binderName === val).reduce((s, c) => s + c.quantity, 0);
          const dotColors = ['#c89b3c','#5b9cf6','#3dba6f','#9b7bfa','#f08030','#e05555','#f5c842','#60c8c8','#e87ca0','#7bc85b'];
          const dot = val === 'all' ? '#7a7692' : dotColors[(i - 1) % dotColors.length];
          return `<div class="binder-item ${s.binder === val ? 'active' : ''}" data-binder="${esc(val)}">
            <div class="b-dot" style="background:${dot}"></div>
            <span class="b-name" title="${esc(label)}">${esc(label)}</span>
            <span class="b-count">${qty}</span>
          </div>`;
        }).join('')}
      </div>

      <div>
        <div class="filter-bar">
          <div style="display:flex;gap:6px;align-items:center">
            <input type="text" id="cardSearch" placeholder="Search name, set… (Enter to search)" value="${esc(s.search)}" style="flex:1;min-width:200px">
            <button class="btn" id="cardSearchBtn" style="padding:7px 14px;font-size:13px">Search</button>
            ${s.search ? `<button class="btn btn-ghost" id="cardSearchClear" style="padding:7px 10px;font-size:13px" title="Clear search">✕</button>` : ''}
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
              ${th('setCode', 'Set')}
              <th>Foil</th>
              ${th('rarity', 'Rarity')}
              ${th('condition', 'Cond')}
              <th>Lang</th>
              ${th('quantity', 'Qty')}
              ${th('purchasePrice', 'Cost')}
              ${th('currentPrice', 'Market')}
              <th>Δ Price</th>
              <th>Trend</th>
              <th>Flags</th>
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
  const hist     = getPriceHistory(card.scryfallId, card.foil);
  const curPrice = getCurrentPrice(card.scryfallId, card.foil);
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
  return `<tr>
    <td style="padding:0 4px 0 8px"><button class="btn-row-edit" data-card-id="${esc(card.id)}" title="Edit Scryfall ID">✎</button></td>
    <td style="font-weight:500;max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(card.name)}">${esc(card.name)}</td>
    <td style="color:var(--text-dim);white-space:nowrap">${esc(card.setCode)} <span style="font-size:11px">#${esc(card.collectorNumber)}</span></td>
    <td>${foilBadge || '<span style="color:var(--text-dim)">—</span>'}</td>
    <td><span class="badge badge-${card.rarity}">${card.rarity}</span></td>
    <td style="font-weight:500">${cond}</td>
    <td style="color:var(--text-dim);font-size:12px">${card.language.toUpperCase()}</td>
    <td style="text-align:center">${card.quantity}</td>
    <td>${fmt(card.purchasePrice)}</td>
    <td style="font-weight:600">${curPrice != null ? fmt(curPrice) : '<span style="color:var(--text-dim)">—</span>'}</td>
    <td>${changeHtml}</td>
    <td>${sparkline(hist)}</td>
    <td>${flags}</td>
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
    cards = cards.filter(c => c.name.toLowerCase().includes(q) || (c.setName || '').toLowerCase().includes(q));
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
          <input type="text" id="gallerySearch" class="search-input" placeholder="Search name or set…"
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

  // Drop selected — show card grid for that drop
  if (sv.drop) {
    const cardIds = SL_DROP_TO_SCRYFALL_IDS[sv.drop] || [];
    const stats = dropOwnedNameStats(sv.drop);
    const PAGE_SIZE = 100;
    const shown = cardIds.slice(0, (sv.page + 1) * PAGE_SIZE);
    const hasMore = cardIds.length > shown.length;
    const drops = getDropsForSuperdrop(sv.superdrop);
    const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;

    return refreshBtn + `
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
    const drops = sdObj ? [...sdObj.drops].sort() : [];
    return refreshBtn + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${dropSelect(drops)}
        </div>
      </div>
      <div class="sl-superdrop-grid">
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
      </div>`;
  }

  // Landing — show all superdrops as completion cards
  return refreshBtn + `
    <div class="gallery-filters">
      <div class="gallery-filter-row">
        ${sdSelect()}
      </div>
    </div>
    <div class="sl-superdrop-grid">
      ${SL_SUPERDROPS.map(sd => {
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
            <div class="sl-superdrop-meta">${sd.date} · ${sd.drops.length} drop${sd.drops.length !== 1 ? 's' : ''}</div>
            <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
            <div class="sl-superdrop-count" style="color:${owned===total&&total>0?'var(--green)':'var(--text-muted)'}">${owned} / ${total} owned</div>
          </div>`;
      }).join('')}
    </div>`;
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
  if (s.binder !== 'all')    cards = cards.filter(c => c.binderName === s.binder);
  if (s.search) {
    const q = s.search.toLowerCase();
    cards = cards.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.setName.toLowerCase().includes(q) ||
      c.setCode.toLowerCase().includes(q)
    );
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
      <button class="btn btn-primary" id="addSealedBtn">+ Add Product</button>
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
        ${collection.sealed.length === 0
          ? '<button class="btn btn-primary" id="addSealedBtn2">+ Add Your First Product</button>'
          : ''}
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
function showModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD / EDIT SEALED MODAL
// ─────────────────────────────────────────────────────────────────────────────
function showAddSealedModal(editId = null) {
  const ex = editId ? collection.sealed.find(i => i.id === editId) : null;
  const e  = ex || {};
  const lastPrice = e.priceHistory?.length ? e.priceHistory[e.priceHistory.length - 1].price : '';

  showModal(`
    <h2>${ex ? 'Edit' : 'Add'} Sealed Product</h2>
    <div class="form-group">
      <label>Product Name *</label>
      <input type="text" id="sl-name" placeholder="e.g. Secret Lair: Artist Series – Sidharth Chaturvedi" value="${esc(e.name || '')}">
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
      <div class="input-with-btn">
        <input type="number" id="sl-price" step="0.01" min="0" placeholder="Enter manually or use eBay lookup" value="${lastPrice}">
        <button class="btn" id="sl-ebay-btn" style="white-space:nowrap">eBay Lookup</button>
      </div>
    </div>
    <div class="form-group">
      <label>eBay Search Term</label>
      <input type="text" id="sl-ebay-query" placeholder="e.g. Secret Lair Artist Series sealed MTG" value="${esc(e.ebaySearchTerm || '')}">
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

  document.getElementById('sl-ebay-btn').addEventListener('click', async () => {
    const query = (document.getElementById('sl-ebay-query').value || document.getElementById('sl-name').value).trim();
    if (!query) { toast('Enter a product name or search term first', 'error'); return; }
    if (!collection.settings.ebayClientId) { toast('Configure eBay credentials in Settings first', 'error'); return; }
    const btn = document.getElementById('sl-ebay-btn');
    btn.textContent = 'Searching…'; btn.disabled = true;
    try {
      const price = await searchEbayPrice(query);
      if (price != null) {
        document.getElementById('sl-price').value = price.toFixed(2);
        toast(`eBay median: ${fmt(price)}`, 'success');
      } else {
        toast('No listings found for that search term', 'error');
      }
    } catch (err) {
      toast('eBay error: ' + err.message, 'error');
    } finally {
      btn.textContent = 'eBay Lookup'; btn.disabled = false;
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
      ebaySearchTerm: document.getElementById('sl-ebay-query').value.trim(),
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
      <div class="input-with-btn">
        <input type="number" id="up-price" step="0.01" min="0" placeholder="0.00">
        <button class="btn" id="up-ebay">eBay Lookup</button>
      </div>
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

  document.getElementById('up-ebay').addEventListener('click', async () => {
    const query = item.ebaySearchTerm || item.name;
    if (!collection.settings.ebayClientId) { toast('Configure eBay credentials in Settings', 'error'); return; }
    const btn = document.getElementById('up-ebay');
    btn.textContent = 'Searching…'; btn.disabled = true;
    try {
      const price = await searchEbayPrice(query);
      if (price != null) { document.getElementById('up-price').value = price.toFixed(2); toast(`eBay median: ${fmt(price)}`, 'success'); }
      else toast('No listings found', 'error');
    } catch (err) { toast('eBay error: ' + err.message, 'error'); }
    finally { btn.textContent = 'eBay Lookup'; btn.disabled = false; }
  });

  document.getElementById('up-save').addEventListener('click', () => {
    const price = parseFloat(document.getElementById('up-price').value);
    if (isNaN(price) || price < 0) { toast('Enter a valid price', 'error'); return; }
    if (!item.priceHistory) item.priceHistory = [];
    const t = today();
    const ti = item.priceHistory.findIndex(h => h.date === t);
    const entry = { date: t, price, source: 'manual' };
    if (ti >= 0) item.priceHistory[ti] = entry;
    else item.priceHistory.push(entry);
    hideModal();
    render();
    autoSave();
    toast('Price updated!', 'success');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MODAL
// ─────────────────────────────────────────────────────────────────────────────
function showSettings() {
  showModal(`
    <h2>Settings</h2>

    <h3>eBay API — Sealed Product Pricing</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:14px;line-height:1.55">
      Sign up free at <a href="https://developer.ebay.com" target="_blank">developer.ebay.com</a>,
      create an application, and paste your Production credentials below.
      Credentials are stored only in your <code>collection.json</code> file and sent directly to eBay.
    </p>
    <div class="form-group">
      <label>App ID (Client ID)</label>
      <input type="text" id="cfg-cid" placeholder="YourAppName-XXXX-PRD-XXXXXXXX-XXXXXXXX" value="${esc(collection.settings.ebayClientId || '')}">
    </div>
    <div class="form-group">
      <label>Cert ID (Client Secret)</label>
      <input type="password" id="cfg-csec" placeholder="PRD-XXXXXXXXXXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX" value="${esc(collection.settings.ebayClientSecret || '')}">
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
  document.getElementById('cfg-save').addEventListener('click', () => {
    collection.settings.ebayClientId     = document.getElementById('cfg-cid').value.trim();
    collection.settings.ebayClientSecret = document.getElementById('cfg-csec').value.trim();
    hideModal();
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
    hideModal(); render(); toast('Price history cleared from database', 'info');
  });
  document.getElementById('cfg-reset-all').addEventListener('click', async () => {
    if (!confirm('⚠ RESET ENTIRE DATABASE\n\nThis deletes EVERYTHING:\n• All cards\n• All sealed products\n• All price history\n• All card metadata\n• All settings (eBay credentials)\n• Cached Secret Lair data\n\nThis cannot be undone. Continue?')) return;
    if (!confirm('Last chance — really wipe everything?')) return;
    await window.api.data.reset();
    // Reset in-memory state to a fresh collection
    collection.cards         = [];
    collection.sealed        = [];
    collection.priceHistory  = {};
    collection.cardMetadata  = {};
    collection.failedLookups = [];
    collection.settings      = { ebayClientId: '', ebayClientSecret: '' };
    collection.lastPriceRefresh = null;
    hideModal();
    render();
    toast('Database reset — starting fresh', 'success');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENERS (re-attached after each render)
// ─────────────────────────────────────────────────────────────────────────────
function attachContentListeners() {
  // Dashboard drag-and-drop reorder
  if (ui.activeTab === 'dashboard') attachDashboardDragHandlers();

  // Empty state CSV import
  const emptyCsv = document.getElementById('emptyCsvBtn');
  if (emptyCsv) emptyCsv.addEventListener('click', () => importCsvFile().catch(console.error));

  // Binder sidebar
  document.querySelectorAll('.binder-item').forEach(el => {
    el.addEventListener('click', () => {
      ui.cards.binder = el.dataset.binder;
      ui.cards.page   = 1;
      render();
    });
  });

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

  // Add sealed buttons
  ['addSealedBtn', 'addSealedBtn2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', () => showAddSealedModal());
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
  };

  // Auto-load from SQLite on startup
  window.logger?.info('App', 'Starting up — loading collection from SQLite…');
  const loaded = await autoLoad();
  if (loaded) {
    const el = document.getElementById('autosave-status');
    if (el) {
      const t = collection.lastPriceRefresh
        ? new Date(collection.lastPriceRefresh).toLocaleDateString()
        : 'previously';
      el.textContent = `● Restored (${collection.cards.length.toLocaleString()} cards)`;
      el.style.opacity = '1';
      el._fadeTimer = setTimeout(() => { el.style.opacity = '0.4'; }, 5000);
    }
    window.logger?.success('App', `Loaded ${collection.cards.length.toLocaleString()} cards · ${(collection.sealed || []).length} sealed · ${Object.keys(collection.priceHistory || {}).length.toLocaleString()} price-history series`);
  } else {
    window.logger?.info('App', 'No prior collection found — starting fresh');
  }

  render();
}

document.addEventListener('DOMContentLoaded', init);
