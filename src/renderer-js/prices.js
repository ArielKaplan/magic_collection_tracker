import { SCRYFALL_COLLECTION } from './constants.js';
import { render, updateFailedBadge } from './render.js';
import { collection, ui } from './state.js';
import { updateStatusBar } from './statusbar.js';
import { autoSave } from './storage.js';
import { netFetch, sleep, toast, today } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// PRICE HISTORY
// ─────────────────────────────────────────────────────────────────────────────
export function priceKey(scryfallId, foilType) { return `${scryfallId}|${foilType}`; }

// Snapshots recorded since the last autoSave — flushed as a delta instead of
// re-mirroring the entire price history to SQLite on every save. Reassignment
// happens only here; other modules go through the take/restore/clear helpers
// (imported ES-module bindings can't be reassigned).
export let pendingPriceSnaps = [];

export function takePendingPriceSnaps() {
  const taken = pendingPriceSnaps;
  pendingPriceSnaps = [];
  return taken;
}
export function restorePendingPriceSnaps(snaps) {
  pendingPriceSnaps = snaps.concat(pendingPriceSnaps);
}
export function clearPendingPriceSnaps() {
  pendingPriceSnaps = [];
}

// Re-key priceHistory so all UUIDs are lowercase (fixes mismatches from old imports)
export function normalizePriceHistoryKeys(hist) {
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

export function getCurrentPrice(scryfallId, foilType) {
  const h = collection.priceHistory[priceKey(scryfallId, foilType)];
  return h?.length ? h[h.length - 1].price : null;
}

export function getPriceHistory(scryfallId, foilType) {
  return collection.priceHistory[priceKey(scryfallId, foilType)] || [];
}

export function storePriceSnapshot(scryfallId, foilType, price) {
  if (price == null || isNaN(price) || price <= 0) return;
  const key = priceKey(scryfallId, foilType);
  if (!collection.priceHistory[key]) collection.priceHistory[key] = [];
  const hist = collection.priceHistory[key];
  const t = today();
  const todayIdx = hist.findIndex(h => h.date === t);
  if (todayIdx >= 0) {
    if (hist[todayIdx].price === price) return;
    hist[todayIdx].price = price;
  } else {
    const last = hist[hist.length - 1];
    if (last && last.price === price) return;
    hist.push({ date: t, price });
  }
  pendingPriceSnaps.push({ scryfallId, foil: foilType, date: t, price, source: 'scryfall' });
}

export function storeMarketPriceSnapshot(scryfallId, foilType, price) {
  if (price == null || isNaN(price) || price <= 0) return;
  const key = priceKey(scryfallId, foilType);
  if (!collection.marketPriceHistory[key]) collection.marketPriceHistory[key] = [];
  const hist = collection.marketPriceHistory[key];
  const t = today();
  const todayIdx = hist.findIndex(h => h.date === t);
  if (todayIdx >= 0) {
    if (hist[todayIdx].price === price) return;
    hist[todayIdx].price = price;
  } else {
    const last = hist[hist.length - 1];
    if (last && last.price === price) return;
    hist.push({ date: t, price });
  }
  pendingPriceSnaps.push({ scryfallId, foil: foilType, date: t, price, source: 'tcgcsv' });
}

export function getCurrentMarketPrice(scryfallId, foilType) {
  const h = collection.marketPriceHistory[priceKey(scryfallId, foilType)];
  return h?.length ? h[h.length - 1].price : null;
}

export function getPriceChange(history) {
  if (!history || history.length < 2) return null;
  const cur  = history[history.length - 1].price;
  const prev = history[history.length - 2].price;
  if (!prev) return null;
  return { current: cur, previous: prev, diff: cur - prev, pct: ((cur - prev) / prev) * 100 };
}

export function sparkline(history, w = 70, h = 22) {
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
export async function fetchScryfallBatch(ids) {
  const DELAYS = [2000, 4000, 8000];
  for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
    const resp = await netFetch(SCRYFALL_COLLECTION, {
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
export async function fetchTcgcsvMarketPrices(cardPairs) {
  // cardPairs: [{scryfallId, foil, setName, name, collectorNumber}]
  let groups;
  try {
    const resp = await netFetch('https://tcgcsv.com/tcgplayer/1/groups');
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
          netFetch(`https://tcgcsv.com/tcgplayer/1/${groupId}/products`),
          netFetch(`https://tcgcsv.com/tcgplayer/1/${groupId}/prices`),
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

export async function refreshPrices() {
  if (ui.refreshing) return;
  const allDeckCards = (collection.decks || []).flatMap(d => d.cards || []);
  if (!collection.cards.length && !allDeckCards.length) { toast('No cards to refresh', 'info'); return; }

  // Gather unique (scryfallId, foil) pairs — normalize IDs to lowercase so
  // Scryfall cache lookups always match (Scryfall returns lowercase UUIDs).
  // Deck cards are included so unowned deck entries get prices too.
  const pairMap = new Map();
  for (const c of [...collection.cards, ...allDeckCards]) {
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
               || collection.cards.find(c => c.scryfallId === scryfallId)
               || allDeckCards.find(c => c.scryfallId === scryfallId);
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

export function updateRefreshUI() {
  const bar = document.getElementById('refresh-progress-fill');
  if (bar) bar.style.width = ui.refreshProgress + '%';
  // Refresh state surfaces in the status bar (see updateStatusBar)
  updateStatusBar();
}

