// smoke-precon.js — exercises the Precon Explorer's pure logic:
// transformMtgjsonDeck (the shared seed/sync transform), finish-aware
// ownership stats, the reverse card→precon index, and MSRP-era defaults.
// Uses real MTGJSON deck files from scripts/precon-build/cache/ (gitignored;
// run fetch-decks.js first if missing).
//
// Run: node scripts/smoke-precon.js
'use strict';
const fs = require('fs');
const path = require('path');

const noop = () => {};
globalThis.window = { addEventListener: noop };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const mod = await import('../src/renderer-js/preconData.js');
  const { transformMtgjsonDeck, preconMsrpDefault, preconOwnedStats, ownedFinishKeySet,
          preconsContaining, preconState, PRECON_SCOPE_TYPES } = mod;
  const { collection } = await import('../src/renderer-js/state.js');

  const DECKS = path.join(__dirname, 'precon-build', 'cache', 'decks');
  if (!fs.existsSync(DECKS)) {
    console.error('Fixture cache missing — run node scripts/precon-build/fetch-decks.js');
    process.exit(1);
  }
  const load = f => JSON.parse(fs.readFileSync(path.join(DECKS, f + '.json'), 'utf8')).data;

  console.log('— transformMtgjsonDeck: modern commander precon —');
  const files = fs.readdirSync(DECKS).map(f => f.replace(/\.json$/, ''));
  const avengers = files.find(f => /AvengersAssemble_/.test(f) && !/Collector/.test(f));
  ok(!!avengers, `fixture found (${avengers})`);
  if (avengers) {
    const d = transformMtgjsonDeck(load(avengers));
    ok(d.commander.length > 0, `commander detected (${d.commander})`);
    ok(/^[WUBRG]+$/.test(d.colors), `colors from commander identity (${d.colors})`);
    const boards = new Set(d.cards.map(c => c[4]));
    ok(boards.has('commander') && boards.has('main'), `boards present (${[...boards].join(',')})`);
    ok(d.cards.every(c => /^[0-9a-f-]{36}$/.test(c[0])), 'every row carries a scryfall id');
    ok(d.cards.every(c => ['nonfoil', 'foil', 'etched'].includes(c[3])), 'every row carries a finish');
  }

  console.log('\n— transform: WC deck (sideboard) + theme deck (colors from main) —');
  const wc = files.find(f => /WorldChampionship/i.test(f));
  if (wc) {
    const d = transformMtgjsonDeck(load(wc));
    ok(d.commander === '', 'no commander on a constructed deck');
    ok(d.cards.length > 0, `cards resolved (${d.cards.length})`);
  }
  const theme = files.find(f => {
    try { return load(f).type === 'Theme Deck'; } catch { return false; }
  });
  if (theme) {
    const d = transformMtgjsonDeck(load(theme));
    ok(d.colors.length >= 1 && d.colors.length <= 5, `theme deck colors from main board (${d.colors || '∅'})`);
  }

  console.log('\n— ownership: finish-aware stats + reverse index —');
  // Synthetic deck: two nonfoil cards + one foil card.
  preconState.decks = [{ file: 'TestDeck_X', name: 'Test Deck', type: 'Commander Deck', code: 'TST', date: '2025-01-01', colors: 'UR', commander: 'Testy', cardCount: 3 }];
  preconState.byFile = new Map(preconState.decks.map(d => [d.file, d]));
  preconState.cards = new Map([['TestDeck_X', [
    { sid: 'sid-a', name: 'Alpha', count: 1, finish: 'nonfoil', board: 'main', set: 'TST', num: '1' },
    { sid: 'sid-b', name: 'Beta', count: 1, finish: 'nonfoil', board: 'main', set: 'TST', num: '2' },
    { sid: 'sid-c', name: 'Gamma', count: 1, finish: 'foil', board: 'commander', set: 'TST', num: '3' },
    { sid: 'sid-t', name: 'Token', count: 1, finish: 'nonfoil', board: 'token', set: 'TST', num: 'T1' },
  ]]]);
  preconState.reverse = new Map([['sid-a', new Set(['TestDeck_X'])], ['sid-b', new Set(['TestDeck_X'])], ['sid-c', new Set(['TestDeck_X'])]]);

  collection.cards = [
    { id: '1', scryfallId: 'sid-a', name: 'Alpha', foil: 'normal', quantity: 1 },          // counts (nonfoil match)
    { id: '2', scryfallId: 'sid-c', name: 'Gamma', foil: 'normal', quantity: 1 },          // does NOT count (deck wants foil)
    { id: '3', scryfallId: 'sid-b', name: 'Beta', foil: 'normal', quantity: 1, status: 'sold' }, // sold — excluded
  ];
  const keys = ownedFinishKeySet();
  const stats = preconOwnedStats('TestDeck_X', keys);
  ok(stats.total === 3, `tokens excluded from totals (${stats.total})`);
  ok(stats.owned === 1, `finish-aware ownership: nonfoil copy ≠ foil slot, sold excluded (${stats.owned})`);
  const containing = preconsContaining('sid-c');
  ok(containing.length === 1 && containing[0].name === 'Test Deck', 'reverse index resolves headers');
  ok(preconsContaining('sid-zzz').length === 0, 'unknown id → no precons');

  console.log('\n— MSRP era defaults —');
  ok(preconMsrpDefault('Commander Deck', '2018-06-08') === 34.99, 'commander 2018 → 34.99');
  ok(preconMsrpDefault('Commander Deck', '2021-04-23') === 39.99, 'commander 2021 → 39.99');
  ok(preconMsrpDefault('Commander Deck', '2026-06-26') === 44.99, 'commander 2026 → 44.99');
  ok(preconMsrpDefault('Theme Deck', '1999-10-04') === 9.99, 'theme deck → 9.99');
  ok(preconMsrpDefault('Box Set', '2020-11-20') === null, 'multi-deck box → no assumed MSRP');
  ok(PRECON_SCOPE_TYPES.has('Commander Deck') && !PRECON_SCOPE_TYPES.has('Secret Lair Drop'), 'scope excludes SLD');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASHED:', e); process.exit(1); });
