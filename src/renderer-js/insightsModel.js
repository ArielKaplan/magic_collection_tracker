// insightsModel.js — pure calculations behind the Insights workspace.
//
// These functions accept data explicitly so their recommendations are easy to
// test, explain, and reuse. Nothing here fetches data or mutates the collection.

const number = (v, fallback = 0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const lower = v => String(v || '').trim().toLowerCase();

export function finishKey(finish) {
  if (finish === 'foil' || finish === 'etched') return finish;
  return 'normal';
}

export function latestPrice(histories, scryfallId, finish = 'normal') {
  const sid = lower(scryfallId);
  if (!sid) return null;
  const key = `${sid}|${finishKey(finish)}`;
  const rows = histories?.[key];
  if (rows?.length) {
    const value = number(rows[rows.length - 1]?.price, NaN);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return null;
}

export function collectionNameInventory(cards) {
  const out = new Map();
  for (const card of cards || []) {
    if (card.status === 'sold') continue;
    const key = lower(card.name) || lower(card.scryfallId);
    if (!key) continue;
    out.set(key, (out.get(key) || 0) + Math.max(0, number(card.quantity, 1)));
  }
  return out;
}

export function collectionExactInventory(cards) {
  const out = new Map();
  for (const card of cards || []) {
    if (card.status === 'sold' || !card.scryfallId) continue;
    const key = `${lower(card.scryfallId)}|${finishKey(card.foil)}`;
    out.set(key, (out.get(key) || 0) + Math.max(0, number(card.quantity, 1)));
  }
  return out;
}

// Saved deck ownership is name-level: any printing of a card can satisfy a
// deck slot. Inventory is consumed as rows are evaluated so split main/side
// entries cannot reuse the same physical copy twice.
export function savedDeckBuildCandidate(deck, cards = [], histories = {}, opts = {}) {
  const inventory = opts.nameInventory || collectionNameInventory(cards);
  const consumed = new Map();
  let total = 0, owned = 0, missingValue = 0, pricedMissing = 0;
  for (const row of deck?.cards || []) {
    const need = Math.max(0, number(row.quantity, 1));
    const key = lower(row.name) || lower(row.scryfallId);
    const alreadyUsed = consumed.get(key) || 0;
    const available = Math.max(0, (inventory.get(key) || 0) - alreadyUsed);
    const used = Math.min(available, need);
    consumed.set(key, alreadyUsed + used);
    total += need;
    owned += used;
    const short = need - used;
    if (short > 0) {
      const price = latestPrice(histories, row.scryfallId, row.foil)
        ?? (finishKey(row.foil) !== 'normal' ? latestPrice(histories, row.scryfallId, 'normal') : null);
      if (price != null) { missingValue += price * short; pricedMissing += short; }
    }
  }
  const missing = Math.max(0, total - owned);
  return {
    source: 'saved', id: deck?.id || '', name: deck?.name || 'Untitled deck',
    group: deck?.format || 'other', detail: deck?.description || '',
    total, owned, missing, completion: total ? owned / total * 100 : 0,
    missingValue, pricedMissing,
  };
}

// Precon readiness is intentionally stricter: exact Scryfall printing + exact
// finish + required quantity. Tokens do not count toward a playable deck.
export function preconBuildCandidate(deck, rows = [], cards = [], histories = {}, opts = {}) {
  const match = opts.match === 'playable' ? 'playable' : 'exact';
  const inventory = match === 'playable'
    ? (opts.nameInventory || collectionNameInventory(cards))
    : (opts.exactInventory || collectionExactInventory(cards));
  const consumed = new Map();
  let total = 0, owned = 0, missingValue = 0, pricedMissing = 0;
  for (const row of rows || []) {
    if (row.board === 'token') continue;
    const need = Math.max(0, number(row.count, 1));
    const key = match === 'playable'
      ? (lower(row.name) || lower(row.sid))
      : `${lower(row.sid)}|${finishKey(row.finish)}`;
    const alreadyUsed = consumed.get(key) || 0;
    const available = Math.max(0, (inventory.get(key) || 0) - alreadyUsed);
    const used = Math.min(available, need);
    consumed.set(key, alreadyUsed + used);
    total += need;
    owned += used;
    const short = need - used;
    if (short > 0) {
      const price = latestPrice(histories, row.sid, row.finish)
        ?? (match === 'playable' && finishKey(row.finish) !== 'normal' ? latestPrice(histories, row.sid, 'normal') : null);
      if (price != null) { missingValue += price * short; pricedMissing += short; }
    }
  }
  const missing = Math.max(0, total - owned);
  return {
    source: 'precon', id: deck?.file || '', name: deck?.name || 'Unknown precon', match,
    group: deck?.type || 'Preconstructed deck', detail: deck?.commander || deck?.date || '',
    date: deck?.date || '', total, owned, missing,
    completion: total ? owned / total * 100 : 0, missingValue, pricedMissing,
  };
}

function marketLatest(histories, sid, finish) {
  return latestPrice(histories, sid, finish);
}

function maxSavedDeckDemand(decks) {
  const max = new Map();
  for (const deck of decks || []) {
    const demand = new Map();
    for (const row of deck.cards || []) {
      const key = lower(row.name) || lower(row.scryfallId);
      if (!key) continue;
      demand.set(key, (demand.get(key) || 0) + Math.max(0, number(row.quantity, 1)));
    }
    for (const [key, qty] of demand) max.set(key, Math.max(max.get(key) || 0, qty));
  }
  return max;
}

function slSinglesValue(product, histories) {
  let value = 0, priced = 0, required = 0;
  for (const row of product?.cards || []) {
    const qty = Math.max(0, number(row.count, 1));
    required += qty;
    const price = latestPrice(histories, row.scryfallId, row.finish);
    if (price != null) { value += price * qty; priced += qty; }
  }
  return { value, priced, required };
}

// Deterministic, explainable opportunity rules. Every result carries the
// threshold and comparison that caused it to appear.
export function scanOpportunities({
  cards = [], decks = [], wantList = [], priceHistory = {}, marketPriceHistory = {},
  slProducts = [], sealedCatalog = [], duplicateMinValue = 10,
  moveMinPercent = 20, moveMinDollars = 5, sealedMinPercent = 15, sealedMinDollars = 10,
} = {}) {
  const results = [];
  const ownedSids = new Set((cards || []).filter(c => c.status !== 'sold').map(c => lower(c.scryfallId)).filter(Boolean));

  for (const item of wantList || []) {
    if (item.maxPrice == null || ownedSids.has(lower(item.scryfallId))) continue;
    const current = latestPrice(priceHistory, item.scryfallId, item.foil)
      ?? marketLatest(marketPriceHistory, item.scryfallId, item.foil);
    const target = number(item.maxPrice, NaN);
    if (current == null || !Number.isFinite(target) || current > target) continue;
    results.push({
      id: `want:${item.id || item.scryfallId}`, type: 'want-target', sourceId: item.id || '',
      name: item.name || 'Wanted card', status: 'At target', score: Math.max(0, target - current),
      value: current, gain: target - current,
      details: `Current ${current.toFixed(2)} is at or below your ${target.toFixed(2)} target.`,
      rule: 'Want-list current price ≤ user target', action: 'Open Want List',
    });
  }

  const reserved = maxSavedDeckDemand(decks);
  const byName = new Map();
  for (const card of cards || []) {
    if (card.status === 'sold') continue;
    const key = lower(card.name) || lower(card.scryfallId);
    if (!key) continue;
    let group = byName.get(key);
    if (!group) { group = { name: card.name || 'Unknown card', quantity: 0, knownValue: 0, pricedQty: 0, sourceId: card.id || '' }; byName.set(key, group); }
    const qty = Math.max(0, number(card.quantity, 1));
    group.quantity += qty;
    const price = latestPrice(priceHistory, card.scryfallId, card.foil)
      ?? marketLatest(marketPriceHistory, card.scryfallId, card.foil);
    if (price != null) { group.knownValue += price * qty; group.pricedQty += qty; }
  }
  for (const [key, group] of byName) {
    const deckNeed = reserved.get(key) || 0;
    const excess = Math.max(0, group.quantity - deckNeed);
    if (!excess || !group.pricedQty) continue;
    const average = group.knownValue / group.pricedQty;
    const excessValue = average * excess;
    if (excessValue < duplicateMinValue) continue;
    results.push({
      id: `duplicate:${key}`, type: 'duplicate', sourceId: group.sourceId,
      name: group.name, status: `${excess} surplus`, score: excessValue,
      value: excessValue, quantity: excess,
      details: `You own ${group.quantity}; the largest requirement in any one saved deck is ${deckNeed}. Estimated surplus value ${excessValue.toFixed(2)}.`,
      rule: `Copies above largest saved-deck demand, estimated surplus ≥ ${duplicateMinValue.toFixed(2)}`,
      action: 'Open Card Collection',
    });
  }

  const seenMoves = new Set();
  for (const card of cards || []) {
    if (card.status === 'sold' || !card.scryfallId) continue;
    const key = `${lower(card.scryfallId)}|${finishKey(card.foil)}`;
    if (seenMoves.has(key)) continue;
    seenMoves.add(key);
    const hist = priceHistory[key] || [];
    if (hist.length < 2) continue;
    const previous = number(hist[hist.length - 2]?.price, NaN);
    const current = number(hist[hist.length - 1]?.price, NaN);
    if (!(previous > 0) || !(current > 0)) continue;
    const delta = current - previous;
    const pct = delta / previous * 100;
    if (Math.abs(delta) < moveMinDollars || Math.abs(pct) < moveMinPercent) continue;
    results.push({
      id: `move:${key}`, type: 'market-move', sourceId: card.id || '',
      name: card.name || 'Collection card', status: pct >= 0 ? `Up ${pct.toFixed(0)}%` : `Down ${Math.abs(pct).toFixed(0)}%`,
      score: Math.abs(delta) * Math.max(1, number(card.quantity, 1)), value: current,
      gain: delta * Math.max(1, number(card.quantity, 1)),
      details: `Latest recorded price ${current.toFixed(2)} vs previous ${previous.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%).`,
      rule: `Latest move ≥ ${moveMinPercent}% and ≥ ${moveMinDollars.toFixed(2)} per copy`,
      action: 'Open Card Collection',
    });
  }

  const sealedByProduct = new Map();
  for (const row of sealedCatalog || []) {
    const id = String(row.productId ?? row.tcgplayerProductId ?? '');
    const price = number(row.marketPrice, NaN);
    if (id && Number.isFinite(price) && price > 0) sealedByProduct.set(id, { ...row, marketPrice: price });
  }
  const seenProducts = new Set();
  for (const product of slProducts || []) {
    const pid = String(product.tcgplayerProductId || product.identifiers?.tcgplayerProductId || '');
    if (!pid || product.lowConfidence || seenProducts.has(pid)) continue;
    seenProducts.add(pid);
    const sealed = sealedByProduct.get(pid);
    if (!sealed) continue;
    const singles = slSinglesValue(product, priceHistory);
    if (!singles.required || singles.priced !== singles.required) continue;
    const spread = singles.value - sealed.marketPrice;
    const pct = sealed.marketPrice > 0 ? spread / sealed.marketPrice * 100 : 0;
    if (spread < sealedMinDollars || pct < sealedMinPercent) continue;
    results.push({
      id: `sl-value:${pid}`, type: 'sealed-value', sourceId: product.legacyDrop || product.dropName || '',
      name: product.legacyDrop || product.dropName || product.name || 'Secret Lair SKU',
      status: `${pct.toFixed(0)}% spread`, score: spread, value: sealed.marketPrice, gain: spread,
      details: `All ${singles.required} guaranteed card copies price to ${singles.value.toFixed(2)} vs exact sealed market ${sealed.marketPrice.toFixed(2)}.`,
      rule: `Fully priced guaranteed singles exceed exact sealed market by ≥ ${sealedMinPercent}% and ≥ ${sealedMinDollars.toFixed(2)}`,
      action: 'Open Secret Lair Explorer',
    });
  }

  return results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

export function filterReportRows(rows, report = {}) {
  const query = lower(report.query);
  const status = lower(report.status);
  const has = (v) => v !== '' && v != null && Number.isFinite(Number(v));
  let out = (rows || []).filter(row => {
    if (query && !Object.values(row).some(v => lower(v).includes(query))) return false;
    if (status && status !== 'all' && lower(row.status) !== status) return false;
    if (has(report.minValue) && !(Number(row.value) >= Number(report.minValue))) return false;
    if (has(report.minGain) && !(Number(row.gain) >= Number(report.minGain))) return false;
    if (has(report.minCompletion) && !(Number(row.completion) >= Number(report.minCompletion))) return false;
    if (has(report.maxMissing) && !(Number(row.missing) <= Number(report.maxMissing))) return false;
    return true;
  });

  const [field, direction] = String(report.sort || 'name_asc').split('_');
  const dir = direction === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    const av = a[field], bv = b[field];
    if (typeof av === 'number' || typeof bv === 'number') return ((Number(av) || 0) - (Number(bv) || 0)) * dir || lower(a.name).localeCompare(lower(b.name));
    return lower(av).localeCompare(lower(bv)) * dir || lower(a.name).localeCompare(lower(b.name));
  });
  const limit = Math.max(0, number(report.limit, 0));
  return limit ? out.slice(0, limit) : out;
}
