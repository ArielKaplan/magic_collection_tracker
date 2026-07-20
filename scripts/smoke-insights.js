// Render smoke test for all three Insights workspace views.
'use strict';
const noop = () => {};
globalThis.window = { addEventListener: noop, api: {} };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null,
  body: { dataset: {} },
};
globalThis.confirm = () => true;
globalThis.SL_DROP_TO_SUPERDROP = {};

(async () => {
  const { renderInsights } = await import('../src/renderer-js/insights.js');
  const { collection, tcgcsvCache, ui } = await import('../src/renderer-js/state.js');
  const { preconState } = await import('../src/renderer-js/preconData.js');
  const { setSlProducts } = await import('../src/renderer-js/slData.js');

  collection.cards = [
    { id: 'c1', name: 'Sol Ring', scryfallId: 'sid-ring', foil: 'normal', quantity: 2, status: 'owned', binderName: 'Main', purchasePrice: 1 },
    { id: 'c2', name: 'Big Mover', scryfallId: 'sid-move', foil: 'normal', quantity: 1, status: 'owned', binderName: 'Trade', purchasePrice: 4 },
  ];
  collection.decks = [{ id: 'd1', name: 'Ready-ish Commander', format: 'commander', cards: [
    { name: 'Sol Ring', scryfallId: 'sid-ring', foil: 'normal', quantity: 1 },
    { name: 'Missing Card', scryfallId: 'sid-missing', foil: 'normal', quantity: 1 },
  ] }];
  collection.wantList = [{ id: 'w1', name: 'Wanted Card', scryfallId: 'sid-want', foil: 'normal', maxPrice: 10 }];
  collection.priceHistory = {
    'sid-ring|normal': [{ date: '2026-07-20', price: 5 }],
    'sid-move|normal': [{ date: '2026-07-19', price: 10 }, { date: '2026-07-20', price: 20 }],
    'sid-missing|normal': [{ date: '2026-07-20', price: 2 }],
    'sid-want|normal': [{ date: '2026-07-20', price: 8 }],
    'sid-sl|normal': [{ date: '2026-07-20', price: 40 }],
  };
  preconState.decks = [{ file: 'p1', name: 'Test Precon', type: 'Commander Deck', commander: 'Test Commander' }];
  preconState.byFile = new Map(preconState.decks.map(d => [d.file, d]));
  preconState.cards = new Map([['p1', [{ sid: 'sid-ring', name: 'Sol Ring', count: 1, finish: 'nonfoil', board: 'main' }]]]);
  setSlProducts([{ legacyDrop: 'Test Drop', tcgplayerProductId: '42', lowConfidence: false, cards: [{ scryfallId: 'sid-sl', finish: 'nonfoil', count: 1 }] }]);
  tcgcsvCache.sealedProducts = [{ productId: '42', marketPrice: 20 }];

  ui.insights.view = 'build';
  const build = renderInsights();
  ui.insights.view = 'opportunities';
  const opportunities = renderInsights();
  collection.savedReports = [{ id: 'r1', name: 'Valuable cards', dataset: 'cards', minValue: 5, sort: 'value_desc', columns: ['name', 'value'] }];
  ui.insights.reportId = 'r1';
  ui.insights.view = 'reports';
  const reports = renderInsights();

  const checks = {
    build: build.includes('Ready-ish Commander') && build.includes('Test Precon') && build.includes('50%'),
    opportunities: opportunities.includes('Wanted Card') && opportunities.includes('Big Mover') && opportunities.includes('Test Drop'),
    reports: reports.includes('Valuable cards') && reports.includes('Sol Ring') && reports.includes('$10.00'),
  };
  console.log(checks);
  if (!Object.values(checks).every(Boolean)) process.exit(1);
  console.log('Insights render smoke tests passed.');
})().catch(err => { console.error(err); process.exit(1); });
