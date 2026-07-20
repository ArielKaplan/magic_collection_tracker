import { PC_API, TCGCSV_GROUPS } from './constants.js';
import { collection, tcgcsvCache } from './state.js';
import { netFetch, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// SEALED PRODUCT PRICING — TCGCSV (free) + PriceCharting (optional key)
// ─────────────────────────────────────────────────────────────────────────────
export const SEALED_KEYWORDS = [
  'booster box', 'set booster box', 'collector booster', 'bundle', 'secret lair',
  'commander deck', 'prerelease kit', 'starter kit',
  // Precon product lines — so the Precon Explorer's older decks resolve a
  // sealed price and these products show up in the sealed catalog search.
  'theme deck', 'intro pack', 'duel deck', 'planeswalker deck', 'challenger deck',
  'event deck', 'guild kit', 'planechase', 'archenemy', 'clash pack', 'game night',
  'brawl deck', 'jumpstart', 'premium deck',
];

export function updateSyncBtn() {
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

// The synced product index is persisted to the settings table so it survives
// restarts — without it, product-level search only works after a full sync.
export const TCGCSV_CACHE_KEY = 'tcgcsv_cache';
export const TCGCSV_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;   // resync after a day

export function tcgcsvCacheStale() {
  return !tcgcsvCache.lastRefresh ||
    (Date.now() - new Date(tcgcsvCache.lastRefresh).getTime()) > TCGCSV_CACHE_MAX_AGE_MS;
}

export async function loadTcgcsvCache() {
  if (tcgcsvCache.sealedProducts.length || tcgcsvCache.syncing) return;
  try {
    const raw = await window.api.settings.get(TCGCSV_CACHE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.sealedProducts) && data.sealedProducts.length) {
      tcgcsvCache.groups         = data.groups || null;
      tcgcsvCache.sealedProducts = data.sealedProducts;
      tcgcsvCache.lastRefresh    = data.lastRefresh || null;
      tcgcsvCache.sourceUpdatedAt= data.sourceUpdatedAt || null;
      updateSyncBtn();
      tcgcsvCache.onProgress?.();
    }
  } catch (e) {
    window.logger?.debug('Sealed', `Cached product index unreadable: ${e.message}`);
  }
}

export async function persistTcgcsvCache() {
  try {
    await window.api.settings.set(TCGCSV_CACHE_KEY, JSON.stringify({
      groups:         tcgcsvCache.groups,
      sealedProducts: tcgcsvCache.sealedProducts,
      lastRefresh:    tcgcsvCache.lastRefresh,
      sourceUpdatedAt:tcgcsvCache.sourceUpdatedAt,
    }));
  } catch (e) {
    window.logger?.debug('Sealed', `Could not persist product index: ${e.message}`);
  }
}

// Load the persisted index, then rebuild it in the background when stale.
export async function ensureTcgcsvCache() {
  await loadTcgcsvCache();
  if (!tcgcsvCache.syncing && (tcgcsvCacheStale() || !tcgcsvCache.sealedProducts.length)) {
    refreshTcgcsvCache();   // intentionally not awaited — results stream in live
  }
}

export async function refreshTcgcsvCache() {
  if (tcgcsvCache.syncing) return;
  const previousProducts = tcgcsvCache.sealedProducts;
  const previousSourceUpdatedAt = tcgcsvCache.sourceUpdatedAt;
  tcgcsvCache.syncing        = true;
  tcgcsvCache.sealedProducts = [];
  tcgcsvCache.syncDone       = 0;
  tcgcsvCache.syncTotal      = 0;
  updateSyncBtn();
  window.logger?.info('Sealed', 'TCGCSV sync started — fetching MTG group list…');

  try {
    // Upstream timestamp is informative only; a failure here must not block
    // product and price ingestion.
    try {
      const stamp = await netFetch('https://tcgcsv.com/last-updated.txt');
      if (stamp.ok) tcgcsvCache.sourceUpdatedAt = (await stamp.text()).trim() || null;
    } catch { /* optional metadata */ }
    // Step 1: fetch all groups
    const grpResp = await netFetch(TCGCSV_GROUPS);
    if (!grpResp.ok) throw new Error(`Groups fetch failed (${grpResp.status})`);
    const grpRaw = await grpResp.json();
    tcgcsvCache.groups    = Array.isArray(grpRaw) ? grpRaw : (grpRaw.results || grpRaw.groups || []);
    tcgcsvCache.syncTotal = tcgcsvCache.groups.length;
    updateSyncBtn();
    window.logger?.info('Sealed', `Found ${tcgcsvCache.groups.length} MTG groups — fetching products & prices…`);

    // Step 2: fetch /products + /prices per group, join by productId
    // Smaller batches + delay between batches to avoid rate limiting.
    // Secret Lair groups go first, then newest sets — the picker shows
    // results live during the sync, so the most-wanted products land early.
    const slFirst = g => ((g.name || '').toLowerCase().includes('secret lair') ? 0 : 1);
    const fetchOrder = [...tcgcsvCache.groups].sort((a, b) =>
      slFirst(a) - slFirst(b) || String(b.publishedOn || '').localeCompare(String(a.publishedOn || '')));

    const BATCH = 5;
    const BATCH_DELAY_MS = 150;
    const allSealed = [];
    tcgcsvCache.sealedProducts = allSealed;   // live view — grows as batches land
    let errors = 0;
    const failedGroupIds = new Set();

    for (let i = 0; i < fetchOrder.length; i += BATCH) {
      const batch = fetchOrder.slice(i, i + BATCH);
      await Promise.all(batch.map(async g => {
        try {
          const [prodResp, priceResp] = await Promise.all([
            netFetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/products`),
            netFetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/prices`),
          ]);
          if (!prodResp.ok || !priceResp.ok) { errors++; failedGroupIds.add(String(g.groupId)); return; }

          const prodRaw  = await prodResp.json();
          const priceRaw = await priceResp.json();
          const products = Array.isArray(prodRaw)  ? prodRaw  : (prodRaw.results  || []);
          const prices   = Array.isArray(priceRaw) ? priceRaw : (priceRaw.results || []);

          // Build productId → marketPrice map
          const priceMap = {};
          for (const p of prices) {
            const id = p.productId ?? p.skuId;
            if (id != null) {
              if (!priceMap[id]) priceMap[id] = [];
              priceMap[id].push({
                subTypeName: p.subTypeName || p.subtypeName || p.printing || 'Normal',
                lowPrice: p.lowPrice != null ? +p.lowPrice : null,
                midPrice: p.midPrice != null ? +p.midPrice : null,
                highPrice: p.highPrice != null ? +p.highPrice : null,
                marketPrice: p.marketPrice != null ? +p.marketPrice : null,
                directLowPrice: p.directLowPrice != null ? +p.directLowPrice : null,
              });
            }
          }

          for (const p of products) {
            const name = p.name || p.cleanName || p.productName || '';
            if (!name) continue;
            const isSealed = SEALED_KEYWORDS.some(kw => name.toLowerCase().includes(kw));
            if (!isSealed) continue;
            const priceRows = priceMap[p.productId] || [];
            const primary = [...priceRows].sort((a, b) =>
              (Number(/^normal$/i.test(b.subTypeName)) - Number(/^normal$/i.test(a.subTypeName)))
              || ((b.marketPrice ?? -1) - (a.marketPrice ?? -1)))[0] || {};
            allSealed.push({
              id:          `tcgcsv-${g.groupId}-${p.productId}`,
              productId:   p.productId,   // exact-join key (MTGJSON sealedProduct.identifiers.tcgplayerProductId)
              name,
              consoleName: g.name,
              groupId:      g.groupId,
              marketPrice:  primary.marketPrice ?? primary.midPrice ?? primary.lowPrice ?? null,
              lowPrice:     primary.lowPrice ?? null,
              midPrice:     primary.midPrice ?? null,
              highPrice:    primary.highPrice ?? null,
              directLowPrice: primary.directLowPrice ?? null,
              priceSubtype: primary.subTypeName || null,
              priceRows,
              imageUrl:     p.imageUrl || null,
              productUrl:   p.url || null,
              modifiedOn:   p.modifiedOn || null,
              presaleInfo:  p.presaleInfo || null,
              source:      'tcgcsv',
            });
          }
        } catch (e) {
          errors++;
          failedGroupIds.add(String(g.groupId));
          window.logger?.debug('Sealed', `Group ${g.groupId} (${g.name}) failed: ${e.message}`);
        }
        tcgcsvCache.syncDone++;
      }));
      updateSyncBtn();
      tcgcsvCache.onProgress?.();
      // Throttle between batches
      if (i + BATCH < fetchOrder.length) await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    // Preserve last-good rows for just the groups that failed this run. A
    // partial upstream outage must not make previously known products vanish.
    if (failedGroupIds.size && previousProducts.length) {
      const seen = new Set(allSealed.map(p => String(p.productId ?? p.id)));
      for (const p of previousProducts) {
        const gid = String(p.groupId ?? String(p.id || '').match(/^tcgcsv-(\d+)-/)?.[1] ?? '');
        const key = String(p.productId ?? p.id);
        if (failedGroupIds.has(gid) && !seen.has(key)) { allSealed.push(p); seen.add(key); }
      }
    }
    if (!allSealed.length && previousProducts.length) {
      tcgcsvCache.sealedProducts = previousProducts;
      tcgcsvCache.sourceUpdatedAt = previousSourceUpdatedAt;
      throw new Error('No product rows were returned; kept the last good cache');
    }
    tcgcsvCache.lastRefresh = new Date().toISOString();
    await persistTcgcsvCache();

    const withPrice    = allSealed.filter(p => p.marketPrice != null).length;
    const summaryMsg   = `Loaded ${allSealed.length} sealed products (${withPrice} with prices) from ${tcgcsvCache.groups.length} groups${errors ? ` · ${errors} group errors` : ''}`;
    toast(summaryMsg, allSealed.length > 0 ? 'success' : 'warn');
    if (allSealed.length > 0) window.logger?.success('Sealed', summaryMsg);
    else window.logger?.warn('Sealed', summaryMsg + ' — check network or try again');
  } catch (err) {
    if (!tcgcsvCache.sealedProducts.length && previousProducts.length) {
      tcgcsvCache.sealedProducts = previousProducts;
      tcgcsvCache.sourceUpdatedAt = previousSourceUpdatedAt;
    }
    toast('TCGCSV sync failed: ' + err.message, 'error');
    window.logger?.error('Sealed', `TCGCSV sync failed: ${err.message}`);
  } finally {
    tcgcsvCache.syncing = false;
    updateSyncBtn();
    tcgcsvCache.onProgress?.();
  }
}

// Rank-aware local search over the synced index. Every word of the query
// must appear in the product or set name ("so salty" → "Secret Lair Drop:
// So Salty"), with whole-phrase and prefix matches ranked first.
export function searchTcgcsvLocal(query, limit = 200) {
  const phrase = query.toLowerCase().trim();
  const toks = phrase.split(/\s+/).filter(Boolean);
  if (!toks.length) return [];
  const scored = [];
  for (const p of tcgcsvCache.sealedProducts) {
    const name = p.name.toLowerCase();
    const grp  = (p.consoleName || '').toLowerCase();
    if (!toks.every(t => name.includes(t) || grp.includes(t))) continue;
    let score = 0;
    if (name.startsWith(phrase))    score += 100;
    else if (name.includes(phrase)) score += 60;
    if (toks.every(t => name.includes(t))) score += 20;
    if (p.marketPrice != null)      score += 5;
    scored.push([score, p]);
  }
  scored.sort((a, b) => b[0] - a[0] || (b[1].marketPrice ?? 0) - (a[1].marketPrice ?? 0));
  return scored.slice(0, limit).map(s => s[1]);
}

export async function searchTcgcsv(query) {
  const q = query.toLowerCase().trim();

  // Use the persisted index when available (instant, product-level matches)
  await loadTcgcsvCache();
  if (tcgcsvCache.sealedProducts.length) {
    return searchTcgcsvLocal(query, 30);
  }

  // No index yet — start building it in the background for next time…
  ensureTcgcsvCache();
  // …and meanwhile do a quick live group-name search as fallback
  if (!tcgcsvCache.groups) {
    const resp = await netFetch(TCGCSV_GROUPS);
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
        netFetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/products`),
        netFetch(`https://tcgcsv.com/tcgplayer/1/${g.groupId}/prices`),
      ]);
      if (!prodResp.ok || !priceResp.ok) return;
      const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const priceMap = {};
      prices.forEach(p => {
        if (p.productId == null) return;
        if (!priceMap[p.productId]) priceMap[p.productId] = [];
        priceMap[p.productId].push(p);
      });
      products.forEach(p => {
        const name  = p.name || p.cleanName || p.productName || '';
        const row = (priceMap[p.productId] || []).find(x => /^normal$/i.test(x.subTypeName || '')) || (priceMap[p.productId] || [])[0];
        const price = row?.marketPrice ?? row?.midPrice ?? row?.lowPrice;
        if (name && price != null) results.push({
          id:          `tcgcsv-${g.groupId}-${p.productId}`,
          productId:   p.productId,
          name,
          consoleName: g.name,
          marketPrice: parseFloat(price),
          lowPrice: row?.lowPrice != null ? +row.lowPrice : null,
          midPrice: row?.midPrice != null ? +row.midPrice : null,
          highPrice: row?.highPrice != null ? +row.highPrice : null,
          directLowPrice: row?.directLowPrice != null ? +row.directLowPrice : null,
          priceSubtype: row?.subTypeName || null,
          imageUrl: p.imageUrl || null,
          productUrl: p.url || null,
          source:      'tcgcsv',
        });
      });
    } catch {}
  }));
  return results;
}

export async function searchPriceCharting(query) {
  const key = collection.settings.pricechartingKey;
  if (!key) throw new Error('PriceCharting API token not set — add it in Settings');
  const target = `${PC_API}/products?t=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}`;
  const resp = await netFetch(target);
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

export async function fetchPriceChartingById(id) {
  const key = collection.settings.pricechartingKey;
  if (!key) throw new Error('PriceCharting API token not set — add it in Settings');
  const target = `${PC_API}/product?t=${encodeURIComponent(key)}&id=${encodeURIComponent(id)}`;
  const resp = await netFetch(target);
  if (!resp.ok) throw new Error(`Price fetch failed (${resp.status})`);
  const data = await resp.json();
  if (data.status !== 'success') throw new Error(data['error-message'] || 'Price fetch failed');
  const sealed = data['new-price']   != null ? data['new-price']   / 100 : null;
  const loose  = data['loose-price'] != null ? data['loose-price'] / 100 : null;
  return sealed ?? loose;
}

export async function searchSealedPrice(query) {
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

