import { normalizePriceHistoryKeys, pendingPriceSnaps, restorePendingPriceSnaps, takePendingPriceSnaps } from './prices.js';
import { render } from './render.js';
import { collection } from './state.js';
import { toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// STORAGE — import / export
// ─────────────────────────────────────────────────────────────────────────────

// ── Storage layer (SQLite via Electron IPC) ─────────────────────────────────
// Renderer keeps the in-memory `collection` cache; autoSave/autoLoad sync with
// the SQLite database living in the user's app-data folder.

export async function autoSave() {
  // Take ownership of the pending snapshots up front; restore on failure so
  // they get retried on the next save instead of being lost.
  const priceSnaps = takePendingPriceSnaps();
  try {
    const settingsJson = JSON.stringify(collection.settings || {});

    await Promise.all([
      window.api.cards.bulkUpsert(collection.cards),
      // Price history is append-only: persist only the snapshots recorded
      // since the last save. Mirroring the full history here used to rewrite
      // every row on every save — O(all-history) and growing daily.
      priceSnaps.length ? window.api.prices.bulkStore(priceSnaps) : Promise.resolve(),
      window.api.metadata.bulkUpsert(
        Object.entries(collection.cardMetadata || {}).map(([id, m]) => ({ scryfallId: id, ...m }))
      ),
      window.api.failures.replace(collection.failedLookups || []),
      window.api.settings.set('settings_blob', settingsJson),
      window.api.settings.set('last_price_refresh', collection.lastPriceRefresh || ''),
      // Authoritative full replace — keeps the sealed table exactly in sync with
      // memory so a deleted product can never linger (sealed is small & bounded).
      window.api.sealed.replace(collection.sealed || []),
      // Want list — same authoritative full-replace (small & bounded).
      window.api.wantlist?.replace?.(collection.wantList || []) ?? Promise.resolve(),
      ...(collection.decks || []).map(d => window.api.decks.upsert(d)),
    ]);

    const el = document.getElementById('autosave-status');
    if (el) {
      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.textContent = `● Saved ${t}`;
      el.style.opacity = '1';
      clearTimeout(el._fadeTimer);
      el._fadeTimer = setTimeout(() => { el.style.opacity = '0.4'; }, 3000);
    }
  } catch (err) {
    restorePendingPriceSnaps(priceSnaps);
    console.warn('Auto-save failed:', err);
    window.logger?.error('Save', `autoSave failed: ${err.message}`);
  }
}

export async function autoLoad() {
  try {
    const [cardRows, sealedRows, deckRows, prices, metadata, failures, settings, snapshots, wantRows] = await Promise.all([
      window.api.cards.list(),
      window.api.sealed.list(),
      window.api.decks.list(),
      window.api.prices.all(),
      window.api.metadata.all(),
      window.api.failures.list(),
      window.api.settings.all(),
      window.api.portfolio?.list?.() ?? Promise.resolve([]),
      window.api.wantlist?.list?.() ?? Promise.resolve([]),
    ]);

    if (!cardRows.length && !sealedRows.length && !deckRows.length && !Object.keys(prices).length) return false;

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
      status: r.status === 'sold' ? 'sold' : 'owned',
      disposedAt: r.disposed_at || '',
      salePrice: r.sale_price ?? null,
      saleFees: r.sale_fees ?? 0,
      saleNote: r.sale_note || '',
    }));
    collection.sealed = sealedRows.map(r => ({
      id: r.id, name: r.name, productType: r.product_type, setCode: r.set_code,
      setName: r.set_name, quantity: r.quantity, purchasePrice: r.purchase_price,
      currentValue: r.current_value, status: r.status, notes: r.notes,
      dropName: r.drop_name || '',
      disposedAt: r.disposed_at || '',
      salePrice: r.sale_price ?? null,
      saleFees: r.sale_fees ?? 0,
      saleNote: r.sale_note || '',
      priceHistory: r.priceHistory || [],
    }));
    collection.decks = deckRows || [];
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
    collection.portfolioSnapshots = Array.isArray(snapshots) ? snapshots : [];
    collection.wantList = Array.isArray(wantRows) ? wantRows : [];
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

export async function saveCollection() {
  // Manual export to JSON file (backup) using native save dialog
  const json = JSON.stringify(collection, null, 2);
  const savedPath = await window.api.dialog.saveJson(json);
  if (savedPath) toast(`Backup saved to ${savedPath}`, 'success');
}

export async function loadCollectionFile() {
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
    // but existing dates not present in incoming are preserved. Incoming
    // entries are queued for the delta save (autoSave no longer mirrors the
    // full history).
    const incomingPrices = normalizePriceHistoryKeys(data.priceHistory || {});
    for (const [k, hist] of Object.entries(incomingPrices)) {
      if (!collection.priceHistory[k]) collection.priceHistory[k] = [];
      const byDate = {};
      for (const h of collection.priceHistory[k]) byDate[h.date] = h;
      for (const h of hist) byDate[h.date] = h; // incoming wins
      collection.priceHistory[k] = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
      const [sid, foil] = k.split('|');
      for (const h of hist) pendingPriceSnaps.push({ scryfallId: sid, foil, date: h.date, price: h.price, source: 'scryfall' });
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


