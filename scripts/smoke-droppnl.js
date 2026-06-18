// Throwaway smoke test for the Drop P&L computation (Phase 1).
// Run: node scripts/smoke-droppnl.js
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

// SL classic-script globals (normally baked into secretlair.js)
globalThis.SL_SCRYFALL_TO_DROPS = {
  aaaa: ['Phyrexian Praetors'],
  bbbb: ['Phyrexian Praetors'],
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
  const { computeDropPnL } = await import('../src/renderer-js/slTab.js');
  const { collection } = await import('../src/renderer-js/state.js');

  collection.cards = [
    { id: 'c1', scryfallId: 'aaaa', name: 'Elesh Norn',   foil: 'normal', quantity: 1, purchasePrice: 0 },
    { id: 'c2', scryfallId: 'bbbb', name: 'Jin-Gitaxias', foil: 'normal', quantity: 2, purchasePrice: 0 },
    { id: 'c3', scryfallId: 'cccc', name: 'City Island',  foil: 'normal', quantity: 1, purchasePrice: 0 },
    { id: 'c4', scryfallId: 'zzzz', name: 'Not an SLD',   foil: 'normal', quantity: 1, purchasePrice: 0 }, // not in any drop
  ];
  collection.priceHistory = {
    'aaaa|normal': [{ date: '2026-06-18', price: 100 }],
    'bbbb|normal': [{ date: '2026-06-18', price: 50 }],
    'cccc|normal': [{ date: '2026-06-18', price: 8 }],
  };
  collection.marketPriceHistory = {};
  collection.sealed = [
    // Cracked Praetors box: MSRP cost basis, no sealed value (it became the singles)
    { id: 's1', dropName: 'Phyrexian Praetors', status: 'opened', quantity: 1, purchasePrice: 29.99, priceHistory: [] },
    // Still-sealed City Styles: MSRP cost + sealed market value 45
    { id: 's2', dropName: 'City Styles', status: 'sealed', quantity: 1, purchasePrice: 29.99, priceHistory: [{ date: '2026-06-18', price: 45 }] },
    // Sealed product with no drop link → ignored
    { id: 's3', dropName: '', status: 'sealed', quantity: 1, purchasePrice: 10, priceHistory: [{ date: '2026-06-18', price: 12 }] },
  ];

  const pnl = computeDropPnL();
  const by = Object.fromEntries(pnl.map(r => [r.drop, r]));

  check('only engaged drops listed (2)', pnl.length === 2, pnl.map(r => r.drop));

  const p = by['Phyrexian Praetors'];
  check('praetors cost = MSRP 29.99', p && near(p.cost, 29.99), p && p.cost);
  check('praetors value = singles 200', p && near(p.value, 200), p && p.value);     // 100 + 50*2
  check('praetors gain = 170.01', p && near(p.gain, 170.01), p && p.gain);
  check('praetors counts (opened 1, singles 3)', p && p.openedQty === 1 && p.singlesQty === 3 && p.sealedQty === 0, p);

  const cs = by['City Styles'];
  check('citystyles cost 29.99', cs && near(cs.cost, 29.99), cs && cs.cost);
  check('citystyles value = single 8 + sealed 45 = 53', cs && near(cs.value, 53), cs && cs.value);
  check('citystyles sealedQty 1, singlesQty 1', cs && cs.sealedQty === 1 && cs.singlesQty === 1, cs);
  check('citystyles gainPct = 23.01/29.99*100', cs && near(cs.gainPct, 23.01 / 29.99 * 100), cs && cs.gainPct);

  // Drop with cost 0 → gainPct null (no basis)
  collection.sealed = [];
  const noBasis = computeDropPnL().find(r => r.drop === 'Phyrexian Praetors');
  check('no sealed → cost 0, gainPct null', noBasis && noBasis.cost === 0 && noBasis.gainPct === null, noBasis);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll drop-P&L smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
