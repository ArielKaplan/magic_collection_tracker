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

  // No linked sealed → cost defaults to flat MSRP (non-foil singles → 29.99)
  collection.sealed = [];
  const noBasis = computeDropPnL().find(r => r.drop === 'Phyrexian Praetors');
  check('no sealed → cost defaults to 29.99 (costIsDefault)', noBasis && near(noBasis.cost, 29.99) && noBasis.costIsDefault === true, noBasis);
  check('no sealed → gainPct from default basis', noBasis && near(noBasis.gainPct, (200 - 29.99) / 29.99 * 100), noBasis && noBasis.gainPct);

  // Foil singles → foil MSRP default (39.99)
  collection.cards = [{ id: 'cf', scryfallId: 'aaaa', name: 'X', foil: 'foil', quantity: 1, purchasePrice: 0 }];
  collection.priceHistory = { 'aaaa|foil': [{ date: '2026-06-18', price: 10 }] };
  const foilRow = computeDropPnL().find(r => r.drop === 'Phyrexian Praetors');
  check('foil single → cost defaults to 39.99', foilRow && near(foilRow.cost, 39.99) && foilRow.anyFoil === true, foilRow);

  // Settings override the default MSRP
  collection.settings = { slMsrpFoil: 50 };
  const overridden = computeDropPnL().find(r => r.drop === 'Phyrexian Praetors');
  check('settings override foil MSRP default (50)', overridden && near(overridden.cost, 50), overridden && overridden.cost);
  collection.settings = {};

  // ── Phase 2: crack-or-keep ────────────────────────────────────────────────
  const { sumDropSingles, sealedKeepValue, dropFinish } = await import('../src/renderer-js/slTab.js');

  // sumDropSingles: each printing is its own Scryfall object; price = usd ?? foil ?? etched.
  // Dedupe per card NAME, taking the max across that card's printings.
  const cards = [
    { name: 'A', prices: { usd: '12.00' } },                        // nonfoil printing -> 12
    { name: 'A', prices: { usd: null, usd_foil: '25.00' } },        // foil printing -> 25 (max wins)
    { name: 'B', prices: { usd: null, usd_foil: '4.00' } },         // foil-only -> 4
    { name: 'C', prices: { usd: null, usd_foil: null, usd_etched: '7.50' } }, // etched -> 7.5
    { name: 'D', prices: {} },                                      // unpriced -> skipped
  ];
  const agg = sumDropSingles(cards);
  check('sumDropSingles dedupes by name + best finish (25+4+7.5=36.5)', near(agg.value, 36.5), agg.value);
  check('sumDropSingles priced count = 3 (A,B,C)', agg.priced === 3, agg.priced);

  // finish-aware pricing: a foil drop values usd_foil, a non-foil drop values usd
  const ff = [{ name: 'X', prices: { usd: '10.00', usd_foil: '30.00' } }];
  check('finish=normal prefers non-foil price (10)', near(sumDropSingles(ff, 'normal').value, 10), sumDropSingles(ff, 'normal').value);
  check('finish=foil prefers foil price (30)', near(sumDropSingles(ff, 'foil').value, 30), sumDropSingles(ff, 'foil').value);
  check('dropFinish: "… Rainbow Foil" -> foil', dropFinish('Garden Buds Rainbow Foil') === 'foil');
  check('dropFinish: "… Etched Foil" -> etched', dropFinish('Crocodile Jackson Etched Foil') === 'etched');
  check('dropFinish: base drop -> normal', dropFinish('Garden Buds') === 'normal');

  // sealedKeepValue: only still-sealed copies count toward keep value
  collection.sealed = [
    { id: 'k1', dropName: 'City Styles', status: 'sealed', quantity: 2, priceHistory: [{ date: '2026-06-18', price: 45 }] },
    { id: 'k2', dropName: 'City Styles', status: 'opened', quantity: 1, priceHistory: [{ date: '2026-06-18', price: 45 }] },
  ];
  const keep = sealedKeepValue('City Styles');
  check('keep value = 2 sealed * 45 = 90 (opened excluded)', keep && near(keep.value, 90) && keep.qty === 2, keep);
  check('no sealed copies → keep null', sealedKeepValue('Nonexistent Drop') === null);

  // Held sealed but no market price looked up → value null, qty counted
  collection.sealed = [{ id: 'k3', dropName: 'City Styles', status: 'sealed', quantity: 1, priceHistory: [] }];
  const keepNoPrice = sealedKeepValue('City Styles');
  check('held sealed w/o price → value null, qty 1', keepNoPrice && keepNoPrice.value === null && keepNoPrice.qty === 1, keepNoPrice);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll drop-P&L + crack-or-keep smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
