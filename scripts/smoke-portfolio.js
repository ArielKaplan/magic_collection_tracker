// Throwaway smoke test for the renderer-side portfolio snapshot logic.
// Imports the real analytics module with browser-global stubs and a fake
// window.api.portfolio that captures the recorded snapshot, then checks the
// computed values, the in-memory upsert, and the skip-when-no-value guard.
// Run: node scripts/smoke-portfolio.js
'use strict';
const noop = () => {};
let recorded = [];
globalThis.window = {
  addEventListener: noop,
  api: { portfolio: { record: async (snap) => { recorded.push(snap); } } },
  logger: { warn: noop },
};
globalThis.document = { addEventListener: noop, getElementById: () => null, body: { dataset: {} } };

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { collection } = await import('../src/renderer-js/state.js');
  const { recordPortfolioSnapshot, totalCostBasis } = await import('../src/renderer-js/analytics.js');

  // No value at all → should skip recording (no bogus $0 point)
  collection.cards = [];
  collection.sealed = [];
  collection.priceHistory = {};
  recorded = [];
  await recordPortfolioSnapshot();
  check('skips snapshot when nothing is priced', recorded.length === 0 && (collection.portfolioSnapshots || []).length === 0, recorded);

  // Set up a small priced collection
  collection.cards = [
    { scryfallId: 'a', foil: 'normal', quantity: 2, purchasePrice: 5 },   // value 2×10=20, cost 10
    { scryfallId: 'b', foil: 'foil',   quantity: 1, purchasePrice: 30 },  // value 1×50=50, cost 30
  ];
  collection.priceHistory = {
    'a|normal': [{ date: '2026-06-01', price: 8 }, { date: '2026-06-20', price: 10 }], // latest 10
    'b|foil':   [{ date: '2026-06-20', price: 50 }],
  };
  collection.sealed = [
    { quantity: 2, purchasePrice: 25, priceHistory: [{ date: '2026-06-20', price: 40 }] }, // value 2×40=80, cost 50
  ];

  check('totalCostBasis sums cards + sealed', totalCostBasis() === 10 + 30 + 50, totalCostBasis());

  recorded = [];
  await recordPortfolioSnapshot();
  const snap = recorded[0];
  check('records exactly one snapshot', recorded.length === 1);
  check('cardsValue = sum(price × qty)', snap && snap.cardsValue === 20 + 50, snap && snap.cardsValue);
  check('sealedValue = sum(latest × qty)', snap && snap.sealedValue === 80, snap && snap.sealedValue);
  check('costBasis matches totalCostBasis', snap && snap.costBasis === 90, snap && snap.costBasis);
  check('cardCount = total copies', snap && snap.cardCount === 3, snap && snap.cardCount);
  check('date is YYYY-MM-DD', snap && /^\d{4}-\d{2}-\d{2}$/.test(snap.date), snap && snap.date);
  check('in-memory series updated', collection.portfolioSnapshots.length === 1 && collection.portfolioSnapshots[0].date === snap.date, collection.portfolioSnapshots);

  // Re-record same day → in-memory upsert, no duplicate
  collection.cards[0].quantity = 3; // value now 3×10=30
  await recordPortfolioSnapshot();
  check('same-day re-record upserts in memory (no dupe)', collection.portfolioSnapshots.length === 1, collection.portfolioSnapshots);
  check('upsert reflects new value', collection.portfolioSnapshots[0].cardsValue === 30 + 50, collection.portfolioSnapshots[0]);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll portfolio renderer smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
