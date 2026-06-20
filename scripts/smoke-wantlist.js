// Throwaway smoke test for the renderer-side want-list logic. Stubs the browser
// globals + SL data maps, then exercises add/dedup/remove, target editing,
// summary math, price-watch threshold detection, and the SL "add missing" flow.
// Run: node scripts/smoke-wantlist.js
'use strict';
const noop = () => {};
const stubNode = () => ({
  innerHTML: '', textContent: '', value: '', className: '', style: {}, dataset: {},
  classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
  appendChild: noop, removeChild: noop, remove: noop, insertBefore: noop,
  querySelector: () => null, querySelectorAll: () => [], addEventListener: noop,
  setAttribute: noop, getAttribute: () => null, closest: () => null,
  focus: noop, setSelectionRange: noop, getBoundingClientRect: () => ({ top: 0, left: 0, width: 0, height: 0 }),
});
const okAsync = async () => {};
globalThis.window = {
  addEventListener: noop, logger: { success: noop, warn: noop, info: noop },
  // Minimal api stub so autoSave() (fired by mutations) completes quietly.
  api: {
    cards: { bulkUpsert: okAsync }, prices: { bulkStore: okAsync }, metadata: { bulkUpsert: okAsync },
    failures: { replace: okAsync }, settings: { set: okAsync }, sealed: { replace: okAsync },
    wantlist: { replace: okAsync }, decks: { upsert: okAsync }, portfolio: { record: okAsync },
  },
};
globalThis.document = {
  addEventListener: noop, getElementById: () => stubNode(), createElement: () => stubNode(),
  querySelector: () => null, querySelectorAll: () => [], body: { dataset: {} },
};
// SL data maps the want-list helpers read from (normally globals from secretlair.js)
globalThis.SL_SCRYFALL_TO_NAME   = { d1: 'Drop Card 1', d2: 'Drop Card 2', d3: 'Drop Card 3' };
globalThis.SL_SCRYFALL_TO_NUMBER = { d1: '101', d2: '102', d3: '103' };
globalThis.SL_SCRYFALL_TO_DROPS  = { d1: ['City Styles'], d2: ['City Styles'], d3: ['City Styles'] };
globalThis.SL_DROP_TO_SCRYFALL_IDS = { 'City Styles': ['d1', 'd2', 'd3'] };

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { collection } = await import('../src/renderer-js/state.js');
  const W = await import('../src/renderer-js/wantlist.js');
  // Expose the SL helpers as window globals too (some read bare globals — already set above)

  collection.cards = [];
  collection.priceHistory = {};
  collection.marketPriceHistory = {};
  collection.wantList = [];

  // add + dedup
  check('addToWantList adds', W.addToWantList({ scryfallId: 'AAA', name: 'Alpha', foil: 'normal' }, { silent: true }) === true);
  check('dedup: same scryfallId rejected', W.addToWantList({ scryfallId: 'aaa', name: 'Alpha dup', foil: 'normal' }, { silent: true }) === false);
  check('isCardWanted true (case-insensitive)', W.isCardWanted('aaa') === true && W.isCardWanted('AAA') === true);
  check('stored scryfallId lowercased', collection.wantList[0].scryfallId === 'aaa', collection.wantList[0]);

  // target editing
  const id0 = collection.wantList[0].id;
  W.setWantTarget(id0, '7.5');
  check('setWantTarget sets number', collection.wantList[0].maxPrice === 7.5, collection.wantList[0].maxPrice);
  W.setWantTarget(id0, '');
  check('setWantTarget clears to null on empty', collection.wantList[0].maxPrice === null);

  // summary + thresholds — price 'aaa' at 6, target 5 (not hit); add 'bbb' priced 2, target 3 (hit)
  collection.priceHistory['aaa|normal'] = [{ date: '2026-06-20', price: 6 }];
  W.setWantTarget(id0, '5');
  W.addToWantList({ scryfallId: 'BBB', name: 'Beta', foil: 'normal', maxPrice: 3 }, { silent: true });
  collection.priceHistory['bbb|normal'] = [{ date: '2026-06-20', price: 2 }];

  const sum = W.wantListSummary();
  check('summary count', sum.count === 2, sum);
  check('summary acquireCost = 6 + 2', sum.acquireCost === 8, sum.acquireCost);
  check('summary withTarget = 2', sum.withTarget === 2, sum);
  check('summary atTarget = 1 (only bbb ≤ target)', sum.atTarget === 1, sum);

  const hits = W.checkWantListThresholds();
  check('threshold hit is bbb only', hits.length === 1 && hits[0].scryfallId === 'bbb', hits.map(h => h.scryfallId));

  // SL add-missing: owns d2 already → adds d1 + d3 only
  collection.cards = [{ scryfallId: 'd2', foil: 'normal', quantity: 1 }];
  W.addDropMissingToWantList('City Styles');
  const dropAdds = collection.wantList.filter(w => w.dropName === 'City Styles').map(w => w.scryfallId).sort();
  check('add-missing skips owned, adds the rest', JSON.stringify(dropAdds) === JSON.stringify(['d1', 'd3']), dropAdds);
  check('SL add resolves name from map', collection.wantList.find(w => w.scryfallId === 'd1')?.name === 'Drop Card 1');

  // remove
  W.removeFromWantList(id0);
  check('removeFromWantList removes', !collection.wantList.some(w => w.id === id0));

  console.log(failures ? `\n${failures} FAILURES` : '\nAll want-list renderer smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
