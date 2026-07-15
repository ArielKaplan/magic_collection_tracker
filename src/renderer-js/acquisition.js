// Pure acquisition helpers shared by catalog adds, repeat-import reconciliation,
// and the sealed-product "open into collection" workflow. Keeping the planning
// here makes the data-changing UI paths small and gives the risky matching / cost
// allocation rules direct unit coverage.

export function catalogFinishOptions(card) {
  const raw = Array.isArray(card?.finishes) ? card.finishes : [];
  const out = [];
  if (raw.includes('nonfoil') || (!raw.length && card?.prices?.usd != null)) out.push('normal');
  if (raw.includes('foil') || card?.prices?.usd_foil != null) out.push('foil');
  if (raw.includes('etched') || card?.prices?.usd_etched != null) out.push('etched');
  return out.length ? [...new Set(out)] : ['normal'];
}

export function catalogPrice(card, foil = 'normal') {
  const p = card?.prices || {};
  const raw = foil === 'foil' ? p.usd_foil : foil === 'etched' ? p.usd_etched : p.usd;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

export function chooseCatalogFinish(card, preferred = 'normal') {
  const options = catalogFinishOptions(card);
  if (options.includes(preferred)) return preferred;
  if (preferred === 'foil' && options.includes('etched')) return 'etched';
  if (preferred === 'etched' && options.includes('foil')) return 'foil';
  return options[0];
}

export function dropFinishHint(dropName = '') {
  const n = String(dropName).toLowerCase();
  if (n.includes('etched')) return 'etched';
  if (n.includes('foil')) return 'foil';
  return 'normal';
}

export function buildOwnedCardFromCatalog(card, opts = {}) {
  if (!card?.id || !card?.name) throw new Error('Catalog card needs an id and name');
  const foil = chooseCatalogFinish(card, opts.foil || 'normal');
  const qty = Math.max(1, Number.parseInt(opts.quantity || 1, 10) || 1);
  return {
    id: opts.id || '',
    scryfallId: String(card.id).trim().toLowerCase(),
    manaboxId: opts.manaboxId || '',
    name: card.name,
    setCode: String(card.set || opts.setCode || '').toLowerCase(),
    setName: card.set_name || opts.setName || '',
    collectorNumber: String(card.collector_number || opts.collectorNumber || ''),
    foil,
    rarity: String(card.rarity || opts.rarity || 'common').toLowerCase(),
    quantity: qty,
    binderName: opts.binderName || 'Unsorted',
    binderType: opts.binderType || 'binder',
    purchasePrice: Math.max(0, Number.parseFloat(opts.purchasePrice) || 0),
    purchasePriceCurrency: opts.purchasePriceCurrency || 'USD',
    condition: opts.condition || 'near_mint',
    language: String(opts.language || card.lang || 'en').toLowerCase(),
    misprint: !!opts.misprint,
    altered: !!opts.altered,
    status: 'owned',
    acquiredAt: opts.acquiredAt || '',
    sourceProductId: opts.sourceProductId || '',
    sourceProductName: opts.sourceProductName || '',
  };
}

export function findCardImportMatch(cards, card) {
  if (card.manaboxId) {
    return cards.findIndex(c => c.status !== 'sold' && c.manaboxId === card.manaboxId &&
      c.scryfallId === card.scryfallId && c.foil === card.foil);
  }
  if (card.scryfallId) {
    return cards.findIndex(c => c.status !== 'sold' && c.scryfallId === card.scryfallId &&
      c.foil === card.foil && c.binderName === card.binderName);
  }
  return -1;
}

// Returns a complete next collection but never mutates either input. Reconcile
// only replaces live ManaBox-managed rows; manual additions and sold history are
// deliberately preserved.
export function planCardImport(existing, incoming, mode = 'merge') {
  const source = (existing || []).map(c => ({ ...c }));
  const rows = (incoming || []).filter(c => c?.name).map(c => ({ ...c }));
  const managedBefore = source.filter(c => c.manaboxId && c.status !== 'sold');
  const base = mode === 'reconcile'
    ? source.filter(c => !c.manaboxId || c.status === 'sold')
    : source;
  const matchingPool = mode === 'reconcile'
    ? managedBefore.slice()
    : base.slice();
  const next = base.slice();
  const matchedIds = new Set();
  let added = 0, updated = 0;

  for (const card of rows) {
    const matchIdx = findCardImportMatch(matchingPool, card);
    if (matchIdx >= 0) {
      const old = matchingPool[matchIdx];
      const merged = { ...old, ...card, id: old.id, status: old.status || 'owned' };
      matchedIds.add(old.id);
      const idx = next.findIndex(c => c.id === old.id);
      if (idx >= 0) next[idx] = merged; else next.push(merged);
      matchingPool[matchIdx] = merged;
      updated++;
    } else {
      const addedCard = { status: 'owned', ...card };
      next.push(addedCard);
      matchingPool.push(addedCard);
      added++;
    }
  }

  const removedCards = mode === 'reconcile'
    ? managedBefore.filter(c => !matchedIds.has(c.id))
    : [];
  return {
    nextCards: next,
    managedCards: next.filter(c => c.manaboxId && c.status !== 'sold'),
    removedCards,
    stats: { added, updated, removed: removedCards.length, imported: rows.length },
  };
}

// Build one collection row per exact printing in an opened product. Cost basis
// is per copy: proportional allocation uses current card prices when available,
// otherwise the product cost is divided evenly.
export function buildOpenedProductCards(cards, opts = {}) {
  const source = (cards || []).filter(c => c?.id && c?.name);
  if (!source.length) return [];
  const preferred = opts.foil || 'normal';
  const finishes = source.map(c => chooseCatalogFinish(c, preferred));
  const prices = source.map((c, i) => catalogPrice(c, finishes[i]));
  const pricedTotal = prices.reduce((sum, p) => sum + (p || 0), 0);
  const unitCost = Math.max(0, Number.parseFloat(opts.productUnitCost) || 0);
  const equal = unitCost / source.length;
  const idFactory = opts.idFactory || (() => '');
  const allocations = prices.map(p => opts.allocation === 'equal' || pricedTotal <= 0
    ? equal
    : unitCost * ((p || 0) / pricedTotal));
  const rounded = allocations.map(n => +n.toFixed(4));
  // Put the sub-cent rounding remainder on the last row so the generated card
  // cost basis is exactly the product's recorded per-unit purchase cost.
  rounded[rounded.length - 1] = +(rounded[rounded.length - 1] + unitCost - rounded.reduce((sum, n) => sum + n, 0)).toFixed(4);

  return source.map((card, i) => {
    return buildOwnedCardFromCatalog(card, {
      id: idFactory(),
      foil: finishes[i],
      quantity: opts.quantity || 1,
      binderName: opts.binderName || 'Unsorted',
      purchasePrice: rounded[i],
      purchasePriceCurrency: opts.purchasePriceCurrency || 'USD',
      condition: opts.condition || 'near_mint',
      language: opts.language || card.lang || 'en',
      acquiredAt: opts.acquiredAt || '',
      sourceProductId: opts.sourceProductId || '',
      sourceProductName: opts.sourceProductName || '',
    });
  });
}
