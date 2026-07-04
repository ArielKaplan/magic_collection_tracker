// smoke-search-containment.js — the "where does this card show up" search.
// A single card-name query (Catharsis) must surface every surface that
// contains it: owned cards, decks that play it, SL drops that include it,
// precon decks that play it, and sealed products whose linked SL drop has it.
// Run: node scripts/smoke-search-containment.js
'use strict';
const noop = () => {};
globalThis.window = { addEventListener: noop, app: {} };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};

// SL classic-script globals the search reads bare (with typeof guards).
globalThis.SL_DROP_TO_SUPERDROP = {
  'Cathartic Remedies': { superdrop: 'Test Superdrop', date: '2025-01-01' },
  'Unrelated Drop':      { superdrop: 'Test Superdrop', date: '2025-01-01' },
};
globalThis.SL_DROP_CARDS = {
  'Cathartic Remedies': ['Catharsis', 'Some Other Card'],
  'Unrelated Drop':     ['Nothing Relevant'],
};
globalThis.SL_CARD_TO_DROPS = { 'Catharsis': ['Cathartic Remedies'], 'Some Other Card': ['Cathartic Remedies'], 'Nothing Relevant': ['Unrelated Drop'] };
globalThis.SL_DROP_TO_SCRYFALL_IDS = { 'Cathartic Remedies': ['sid-cat'], 'Unrelated Drop': ['sid-none'] };

let pass = 0, fail = 0;
const ok = (c, label, d) => { if (c) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.error(`  ✗ ${label}${d !== undefined ? ' — ' + JSON.stringify(d) : ''}`); } };

(async () => {
  const { quickSearch } = await import('../src/renderer-js/search.js');
  const { collection } = await import('../src/renderer-js/state.js');
  const { preconState } = await import('../src/renderer-js/preconData.js');

  // Owned copy of Catharsis in a binder + an unrelated card.
  collection.cards = [
    { id: 'c1', name: 'Catharsis', scryfallId: 'sid-cat', foil: 'normal', quantity: 1, binderName: 'Binder A', setCode: 'TST', collectorNumber: '1', status: 'owned' },
    { id: 'c2', name: 'Filler', scryfallId: 'sid-x', foil: 'normal', quantity: 1, binderName: 'Binder A', status: 'owned' },
  ];
  // A deck that plays Catharsis (name does NOT contain it → forces containment)
  // + a deck that doesn't play it.
  collection.decks = [
    { id: 'd1', name: 'My Enchantment Brew', cards: [{ name: 'Catharsis', scryfallId: 'sid-cat' }, { name: 'Filler', scryfallId: 'sid-x' }] },
    { id: 'd2', name: 'Unrelated Deck', cards: [{ name: 'Something Else', scryfallId: 'sid-y' }] },
  ];
  // A sealed Secret Lair linked to the drop that contains Catharsis.
  collection.sealed = [
    { id: 's1', name: 'Sealed Cathartic Remedies', dropName: 'Cathartic Remedies', type: 'Secret Lair', status: 'sealed' },
    { id: 's2', name: 'Some Booster Box', dropName: '', type: 'Booster Box', status: 'sealed' },
  ];
  collection.wantList = [];
  collection.failedLookups = [];

  // Precon membership: one deck plays Catharsis, one doesn't.
  preconState.decks = [
    { file: 'Deck_A', name: 'Angelic Tribute', type: 'Commander Deck', code: 'TST', date: '2025-01-01', commander: 'Someone', colors: 'W', cardCount: 2 },
    { file: 'Deck_B', name: 'Other Precon', type: 'Commander Deck', code: 'TST', date: '2025-01-01', commander: 'Nobody', colors: 'U', cardCount: 1 },
  ];
  preconState.byFile = new Map(preconState.decks.map(d => [d.file, d]));
  preconState.cards = new Map([
    ['Deck_A', [{ sid: 'sid-cat', name: 'Catharsis', count: 1, finish: 'nonfoil', board: 'main' }, { sid: 'sid-x', name: 'Filler', count: 1, finish: 'nonfoil', board: 'main' }]],
    ['Deck_B', [{ sid: 'sid-y', name: 'Something Else', count: 1, finish: 'nonfoil', board: 'main' }]],
  ]);
  preconState.reverse = new Map();

  const res = quickSearch('Catharsis', Infinity);
  const g = key => (res.groups.find(x => x.key === key) || { items: [] }).items;

  console.log('— every surface containing Catharsis —');
  ok(g('cards').some(i => i.name === 'Catharsis' && i.owned), 'Cards: owned Catharsis present');

  const dk = g('decks');
  ok(dk.some(i => i.id === 'd1' && i.viaCard === 'Catharsis'), 'Decks: "My Enchantment Brew" matched via contained card', dk);
  ok(!dk.some(i => i.id === 'd2'), 'Decks: unrelated deck excluded');

  const sl = g('sldrops');
  ok(sl.some(i => i.name === 'Cathartic Remedies' && i.viaCard === 'Catharsis'), 'SL drops: drop containing Catharsis surfaced', sl);
  ok(!sl.some(i => i.name === 'Unrelated Drop'), 'SL drops: unrelated drop excluded');

  const pc = g('precons');
  ok(pc.some(i => i.file === 'Deck_A' && i.viaCard === 'Catharsis'), 'Precons: deck playing Catharsis surfaced', pc);
  ok(!pc.some(i => i.file === 'Deck_B'), 'Precons: unrelated precon excluded');

  const sd = g('sealed');
  ok(sd.some(i => i.id === 's1' && i.viaCard === 'Catharsis'), 'Sealed: SL product containing Catharsis surfaced', sd);
  ok(!sd.some(i => i.id === 's2'), 'Sealed: unrelated booster box excluded');

  console.log('\n— name matches still work (no regressions) —');
  const byName = quickSearch('Cathartic', Infinity);
  const slN = (byName.groups.find(x => x.key === 'sldrops') || { items: [] }).items;
  ok(slN.some(i => i.name === 'Cathartic Remedies' && !i.viaCard), 'drop name match has no viaCard annotation', slN);
  const sdN = (byName.groups.find(x => x.key === 'sealed') || { items: [] }).items;
  ok(sdN.some(i => i.id === 's1' && !i.viaCard), 'sealed name match has no viaCard annotation');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASHED:', e); process.exit(1); });
