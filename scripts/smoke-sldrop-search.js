// Throwaway smoke test for the Secret Lair drop typeahead's matching logic.
// Exercises normalization (curly quotes / en-dashes), ranking, empty-query
// recency, and the product-name → query heuristic.
// Run: node scripts/smoke-sldrop-search.js
'use strict';
const noop = () => {};
globalThis.window = { addEventListener: noop };
globalThis.document = {
  addEventListener: noop,
  getElementById: () => null,
  querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};
globalThis.confirm = () => true;
globalThis.localStorage = { getItem: () => null, setItem: noop };

// Stand in for the baked secretlair.js global. Names deliberately use a curly
// apostrophe and an en-dash to prove normalization works.
globalThis.SL_DROP_TO_SUPERDROP = {
  'Li’l Walkers':                    { superdrop: 'February Superdrop 2022', date: '2022-02' },
  'Showcase: Kaldheim – Part 1':     { superdrop: 'Smitten', date: '2021-02' },
  'Phyrexian Praetors: Compleat Edition': { superdrop: 'All-Natural Superdrop', date: '2021-06' },
  'Oishii! Tokens':                       { superdrop: 'Recent Additions', date: '2026-04' },
  'The Walking Dead':                     { superdrop: 'The Walking Dead', date: '2020-10' },
};

// A drop that has cards but no superdrop grouping — must still be searchable.
// Also seed a punctuation duplicate pair: the curated (colon) spelling is grouped,
// the stripped spelling is a leftover "Recent Additions" — the dedup must keep one.
globalThis.SL_DROP_TO_SUPERDROP['Horizon: Into the Forbidden West Foil'] = { superdrop: 'PlayStation Superdrop', date: '2025-10' };
globalThis.SL_DROP_TO_SUPERDROP['Horizon Into the Forbidden West Foil'] = { superdrop: 'Recent Additions', date: '' };
globalThis.SL_DROP_CARDS = {
  'Ungrouped Mystery Drop': ['Some Card', 'Another Card'],
  'Horizon Into the Forbidden West Foil': ['A'],
  'Horizon: Into the Forbidden West Foil': ['A'],
};

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { searchSlDrops, dropQueryFromProductName } = await import('../src/renderer-js/sealedModals.js');
  const names = q => searchSlDrops(q).map(m => m.drop);

  // ── Normalization ───────────────────────────────────────────────────────────
  check('curly apostrophe: "lil walkers" finds Li’l Walkers', names("lil walkers").includes('Li’l Walkers'), names('lil walkers'));
  check('straight apostrophe: "li\'l" finds Li’l Walkers', names("li'l").includes('Li’l Walkers'), names("li'l"));
  check('en-dash: "kaldheim part 1" finds the – name', names('kaldheim part 1').includes('Showcase: Kaldheim – Part 1'), names('kaldheim part 1'));
  check('substring: "praetors" finds Phyrexian Praetors', names('praetors').includes('Phyrexian Praetors: Compleat Edition'));
  check('recent refreshed drop: "oishii" finds Oishii! Tokens', names('oishii').includes('Oishii! Tokens'));
  check('card-only drop (no superdrop) is searchable', names('mystery').includes('Ungrouped Mystery Drop'), names('mystery'));

  // ── Dedup of punctuation duplicates ─────────────────────────────────────────
  const horizon = names('horizon forbidden west');
  check('punctuation duplicate collapses to one', horizon.length === 1, horizon);
  check('dedup keeps the canonical (colon) spelling', horizon[0] === 'Horizon: Into the Forbidden West Foil', horizon);
  check('card-only drop labeled Standalone', (searchSlDrops('mystery')[0] || {}).superdrop === 'Standalone');

  // ── Ranking ───────────────────────────────────────────────────────────────────
  check('prefix beats substring (walking → The Walking Dead first)', names('walking')[0] === 'The Walking Dead', names('walking'));
  check('no match returns empty', searchSlDrops('zzzzznotadrop').length === 0);

  // ── Empty query = most recent first ─────────────────────────────────────────
  check('empty query newest first (Oishii 2026-04)', names('')[0] === 'Oishii! Tokens', names(''));
  check('limit respected', searchSlDrops('', 2).length === 2);

  // ── Product-name → query heuristic ──────────────────────────────────────────
  check('strips "Secret Lair Drop:" + edition suffix',
        dropQueryFromProductName('Secret Lair Drop: Oishii! Tokens - Rainbow Foil Edition') === 'Oishii! Tokens',
        dropQueryFromProductName('Secret Lair Drop: Oishii! Tokens - Rainbow Foil Edition'));
  check('strips "Secret Lair:" prefix',
        dropQueryFromProductName('Secret Lair: Phyrexian Praetors') === 'Phyrexian Praetors',
        dropQueryFromProductName('Secret Lair: Phyrexian Praetors'));
  check('product name guess actually finds the drop',
        searchSlDrops(dropQueryFromProductName('Secret Lair Drop: Oishii! Tokens - Rainbow Foil Edition')).map(m => m.drop).includes('Oishii! Tokens'));

  console.log(failures ? `\n${failures} FAILURES` : '\nAll smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
