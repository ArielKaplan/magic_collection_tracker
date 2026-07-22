// Throwaway smoke test for the renderer-side realized-gains logic. Stubs the
// browser globals, then exercises ownedCards/soldCards filtering and the
// realizedGains aggregation (net = proceeds − fees − cost, per-year buckets).
// Run: node scripts/smoke-realized.js
'use strict';
const noop = () => {};
const stubNode = () => ({
  innerHTML: '', textContent: '', value: '', className: '', style: {}, dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, removeChild: noop, remove: noop, insertBefore: noop,
  querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
  setAttribute: noop, getAttribute: () => null, closest: () => null, focus: noop,
});
globalThis.window = { addEventListener: noop, logger: { success: noop, warn: noop, info: noop } };
globalThis.document = {
  addEventListener: noop, getElementById: () => stubNode(), createElement: () => stubNode(),
  querySelector: () => null, querySelectorAll: () => [], body: { dataset: {} },
};

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { collection } = await import('../src/renderer-js/state.js');
  const A = await import('../src/renderer-js/analytics.js');

  collection.cards = [
    { id: 'o1', name: 'Owned A', foil: 'normal', quantity: 2, purchasePrice: 5, status: 'owned' },
    { id: 'o2', name: 'Owned B', foil: 'normal', quantity: 1, purchasePrice: 3 }, // no status → owned
    { id: 's1', name: 'Sold 25', foil: 'foil', quantity: 1, purchasePrice: 10, status: 'sold',
      disposedAt: '2025-08-01', salePrice: 40, saleFees: 3 },                       // net = 40-3-10 = 27
    { id: 's2', name: 'Sold 26', foil: 'normal', quantity: 2, purchasePrice: 4, status: 'sold',
      disposedAt: '2026-02-10', salePrice: 12, saleFees: 0 },                       // cost=8, net=12-0-8 = 4
  ];
  collection.sealed = [
    { id: 'se1', name: 'Sealed Owned', quantity: 1, purchasePrice: 100, status: 'sealed' },
    { id: 'se2', name: 'Sealed Sold', quantity: 1, purchasePrice: 30, status: 'sold',
      disposedAt: '2026-05-01', salePrice: 75, saleFees: 5 },                       // net = 75-5-30 = 40
  ];

  // ── ownership partitioning ─────────────────────────────────────────────────
  check('ownedCards excludes sold', A.ownedCards().length === 2 && A.ownedCards().every(c => c.status !== 'sold'));
  check('soldCards picks only sold', A.soldCards().length === 2 && A.soldCards().every(c => c.status === 'sold'));
  check('ownedSealed excludes sold', A.ownedSealed().length === 1 && A.ownedSealed()[0].id === 'se1');
  check('soldSealed picks only sold', A.soldSealed().length === 1 && A.soldSealed()[0].id === 'se2');

  // ── entryRealized math (quantity-aware cost) ───────────────────────────────
  const r = A.entryRealized(collection.cards.find(c => c.id === 's2'));
  check('entryRealized: cost = price × qty', r.cost === 8, r);
  check('entryRealized: gain = proceeds − fees − cost', r.gain === 4, r);

  // ── realizedGains aggregate + per-year split ───────────────────────────────
  const rg = A.realizedGains();
  check('realized count = cards sold + sealed sold', rg.count === 3, rg.count);
  check('realized total gain = 27 + 4 + 40', rg.gain === 71, rg.gain);
  check('realized proceeds = 40 + 12 + 75', rg.proceeds === 127, rg.proceeds);
  check('realized cost = 10 + 8 + 30', rg.cost === 48, rg.cost);
  check('byYear 2025 = 27 (1 sale)', rg.byYear.get('2025')?.gain === 27 && rg.byYear.get('2025')?.count === 1, [...rg.byYear]);
  check('byYear 2026 = 44 (2 sales: 4 + 40)', rg.byYear.get('2026')?.gain === 44 && rg.byYear.get('2026')?.count === 2, [...rg.byYear]);
  const recent = A.realizedGains(30);
  check('bounded realized range anchors to latest sale', recent.count === 1 && recent.gain === 40, recent);

  // ── owned-only value/cost basis ────────────────────────────────────────────
  check('totalCostBasis excludes sold (cards 13 + sealed 100 = 113)', A.totalCostBasis() === 113, A.totalCostBasis());
  collection.sealed.push({ id: 'opened-1', name: 'Opened Drop', quantity: 1, purchasePrice: 30, status: 'opened' });
  collection.cards.push({ id: 'from-open', name: 'Generated Card', quantity: 1, purchasePrice: 30, status: 'owned', sourceProductId: 'opened-1' });
  check('opened product is provenance, not a second owned asset', !A.ownedSealed().some(s => s.id === 'opened-1'));
  check('opened product cost is counted once via generated cards', A.totalCostBasis() === 143, A.totalCostBasis());

  // ── no-sales case ──────────────────────────────────────────────────────────
  collection.cards = collection.cards.filter(c => c.status !== 'sold');
  collection.sealed = collection.sealed.filter(c => c.status !== 'sold');
  const empty = A.realizedGains();
  check('no sales → zeroed totals', empty.count === 0 && empty.gain === 0 && empty.byYear.size === 0, empty);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll realized-gains smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
