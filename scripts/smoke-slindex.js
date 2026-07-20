// Throwaway smoke test for the Secret Lair Index aggregation (v0.21.0).
// Exercises the portfolio headline (cost → value → unrealized + realized →
// total return), the realized-SL scoping (sold SL items only), and the ROI
// distribution buckets. Run: node scripts/smoke-slindex.js
'use strict';
const noop = () => {};
globalThis.window = { addEventListener: noop };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};
globalThis.confirm = () => true;

globalThis.SL_SCRYFALL_TO_DROPS = {
  aaaa: ['Phyrexian Praetors'],
  cccc: ['City Styles'],
};
globalThis.SL_DROP_TO_SUPERDROP = {
  'Phyrexian Praetors': { superdrop: 'Winter 2022', date: '2022-12-02' },
  'City Styles':        { superdrop: 'April 2022',  date: '2022-04-25' },
};

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

(async () => {
  const { computeSlIndex, renderSlIndexBody } = await import('../src/renderer-js/slTab.js');
  const { collection, ui } = await import('../src/renderer-js/state.js');

  collection.settings = {};
  collection.marketPriceHistory = {};
  collection.priceHistory = {
    'aaaa|normal': [{ date: '2026-06-18', price: 100 }],
    'cccc|normal': [{ date: '2026-06-18', price: 8 }],
  };
  collection.cards = [
    { id: 'c1', scryfallId: 'aaaa', name: 'Elesh Norn',  foil: 'normal', quantity: 1, purchasePrice: 0, status: 'owned' },
    { id: 'c3', scryfallId: 'cccc', name: 'City Island', foil: 'normal', quantity: 1, purchasePrice: 0, status: 'owned' },
    // sold SL single — realized gain = 40 - 0 - 10 = 30
    { id: 'sld', scryfallId: 'aaaa', name: 'Elesh Norn', foil: 'normal', quantity: 1, purchasePrice: 10,
      status: 'sold', disposedAt: '2026-05-01', salePrice: 40, saleFees: 0 },
    // sold NON-SL single — must NOT count toward realized SL
    { id: 'snon', scryfallId: 'zzzz', name: 'Random', foil: 'normal', quantity: 1, purchasePrice: 10,
      status: 'sold', disposedAt: '2026-05-01', salePrice: 100, saleFees: 0 },
  ];
  collection.sealed = [
    // owned, still sealed → City Styles cost 29.99, value adds sealed 45
    { id: 's2', dropName: 'City Styles', status: 'sealed', quantity: 1, purchasePrice: 29.99, priceHistory: [{ date: '2026-06-18', price: 45 }] },
    // sold SL sealed — realized gain = 75 - 5 - 30 = 40
    { id: 'ssold', dropName: 'City Styles', status: 'sold', quantity: 1, purchasePrice: 30, salePrice: 75, saleFees: 5, priceHistory: [] },
  ];

  const idx = computeSlIndex();

  // ── headline ────────────────────────────────────────────────────────────────
  check('dropCount = 2 engaged drops', idx.dropCount === 2, idx.dropCount);
  check('cost = 29.99 (default) + 29.99 (linked) = 59.98', near(idx.cost, 59.98), idx.cost);
  check('value = 100 + (8 + 45) = 153', near(idx.value, 153), idx.value);
  check('unrealized = 93.02', near(idx.unrealized, 93.02), idx.unrealized);

  // ── realized SL scoping ──────────────────────────────────────────────────────
  check('realized = 30 (SL single) + 40 (SL sealed) = 70', near(idx.realized, 70), idx.realized);
  check('realizedCount = 2 (non-SL sold excluded)', idx.realizedCount === 2, idx.realizedCount);
  check('totalReturn = unrealized 93.02 + realized 70 = 163.02', near(idx.totalReturn, 163.02), idx.totalReturn);

  // ── distribution ─────────────────────────────────────────────────────────────
  const b = Object.fromEntries(idx.buckets.map(x => [x.label, x.count]));
  check('Praetors (~233%) → 100%+ bucket', b['100%+'] === 1, b);
  check('City Styles (~77%) → 50–100% bucket', b['50–100%'] === 1, b);
  check('no losses', b['Loss'] === 0, b);
  check('winners = 2, withPct = 2', idx.winners === 2 && idx.withPct === 2, { w: idx.winners, p: idx.withPct });

  // ── leaderboard ──────────────────────────────────────────────────────────────
  check('best lists both drops, no overlap with worst', idx.best.length === 2 && idx.worst.length === 0,
    { best: idx.best.map(r => r.drop), worst: idx.worst.map(r => r.drop) });
  check('full ranking retains every ROI row in best-to-worst order',
    idx.ranked.length === 2 && idx.ranked[0].gainPct >= idx.ranked[1].gainPct,
    idx.ranked.map(r => ({ drop: r.drop, gainPct: r.gainPct })));
  ui.slViewer.indexExpanded = true;
  const expandedHtml = renderSlIndexBody(idx);
  check('expanded Index renders the full clickable report',
    expandedHtml.includes('Full Secret Lair performance report')
      && expandedHtml.includes('data-slact="open-drop"')
      && expandedHtml.includes('2 of 2 engaged drops'),
    expandedHtml.slice(0, 200));

  // ── crack-vs-keep rollup ─────────────────────────────────────────────────────
  check('1 sealed drop held, keep = 45', idx.crackVsKeep.heldCount === 1 && near(idx.crackVsKeep.keepTotal, 45), idx.crackVsKeep);

  // ── empty case ───────────────────────────────────────────────────────────────
  collection.cards = [];
  collection.sealed = [];
  check('no SL holdings → dropCount 0', computeSlIndex().dropCount === 0);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll Secret Lair Index smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
