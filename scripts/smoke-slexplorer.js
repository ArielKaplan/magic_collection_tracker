// Throwaway smoke test for the Secret Lair Explorer's grid sorting + layouts.
// Exercises the date sort (wiki release date first, MTGJSON product releaseDate
// fallback, undated entries last in either direction) and the tiles/table
// layout toggle (Released + MSRP columns, rows navigate like tiles).
// Run: node scripts/smoke-slexplorer.js
'use strict';
const noop = () => {};
const WIKI_ROWS = [
  { seq: 1, drop: 'Alpha Drop',  superdrop: 'Test SD', date: '2020-01-15', msrpNonfoil: 29.99, msrpFoil: 39.99 },
  { seq: 2, drop: 'Middle Drop', superdrop: 'Test SD', date: '2022-05-10', msrpNonfoil: 24.99, msrpFoil: 34.99 },
  { seq: 3, drop: 'Zeta Drop',   superdrop: 'Test SD', date: '2024-08-01', msrpNonfoil: 29.99, msrpFoil: null },
];
const ANNOUNCEMENTS = Array.from({ length: 6 }, (_, i) => ({
  url: `https://magic.wizards.com/en/news/announcements/secret-lair-${i + 1}`,
  title: `Secret Lair Announcement ${i + 1}`,
  publishedAt: `2026-07-${String(20 - i).padStart(2, '0')}T12:00:00Z`,
  saleDate: i === 0 ? '2099-08-10' : `2026-08-${String(10 + i).padStart(2, '0')}`,
  summary: `Official summary ${i + 1}`,
  revealedDrops: i === 0 ? [{ name: 'Future Preview Drop', cards: [{ name: 'Future Card', displayName: 'Future Card', quantity: 1 }] }] : [],
  prices: [{ amount: 29.99, currency: 'USD' }], // legacy cache field must be discarded
}));
const UPCOMING = { fetchedAt: '2026-07-22', cards: [{
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Future Card', releasedAt: '2099-08-10',
  collectorNumber: '9999', finishes: ['nonfoil'], imageUri: 'https://cards.scryfall.io/normal/front/a/a/a.jpg',
}] };
globalThis.window = {
  addEventListener: noop,
  api: { settings: { get: async k => k === 'sl_wiki_data'
    ? JSON.stringify({ fetchedAt: '2026-07-19', rows: WIKI_ROWS })
    : k === 'sl_announcement_data' ? JSON.stringify({ fetchedAt: '2026-07-20', rows: ANNOUNCEMENTS })
    : k === 'sl_upcoming_data' ? JSON.stringify(UPCOMING) : null, set: async () => {} } },
};
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};
globalThis.confirm = () => true;

const DROPS = ['Alpha Drop', 'Middle Drop Rainbow Foil', 'Product Only Drop', 'Undated Drop', 'Zeta Drop'];
globalThis.SL_SUPERDROPS = [
  { superdrop: 'Test SD',   date: '2020-01', drops: DROPS },
  { superdrop: 'Newer SD',  date: '2024-08', drops: [] },
  { superdrop: 'No-date SD', date: '',       drops: [] },
];
globalThis.SL_DROP_TO_SUPERDROP = Object.fromEntries(DROPS.map(d => [d, { superdrop: 'Test SD', date: '2020-01' }]));
globalThis.SL_DROP_TO_SCRYFALL_IDS = Object.fromEntries(DROPS.map(d => [d, []]));
globalThis.SL_DROP_CARDS = Object.fromEntries(DROPS.map(d => [d, ['Card A']]));
globalThis.SL_SCRYFALL_TO_NAME = {};

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { renderSlViewer } = await import('../src/renderer-js/slTab.js');
  const { loadSlWikiFromSettings } = await import('../src/renderer-js/slWiki.js');
  const { loadSlAnnouncementsFromSettings, slAnnouncements } = await import('../src/renderer-js/slAnnouncements.js');
  const { loadSlUpcomingFromSettings } = await import('../src/renderer-js/slUpcoming.js');
  const { setSlProducts } = await import('../src/renderer-js/slData.js');
  const { collection, ui } = await import('../src/renderer-js/state.js');

  await loadSlWikiFromSettings();
  await loadSlAnnouncementsFromSettings();
  await loadSlUpcomingFromSettings();
  setSlProducts([{ uuid: 'p1', dropName: 'Product Only Drop', legacyDrop: 'Product Only Drop', finishLabel: '', finish: 'nonfoil', tcgplayerProductId: null, releaseDate: '2023-03-03', lowConfidence: false, cards: [] }]);

  const sv = ui.slViewer;
  const tileOrder = html => [...html.matchAll(/data-sl-drop="([^"]+)"/g)].map(m => m[1]);
  const rowOrder = (html, act) => [...html.matchAll(new RegExp(`data-slact="${act}" data-arg="([^"]+)"`, 'g'))].map(m => m[1]);

  // ── drop date sort inside a superdrop (tiles) ───────────────────────────────
  Object.assign(sv, { superdrop: 'Test SD', drop: '', page: 0, search: '', view: 'drops', layout: 'tiles', sort: 'date_desc' });
  let order = tileOrder(renderSlViewer());
  check('date_desc: newest first, undated last',
    JSON.stringify(order) === JSON.stringify(['Zeta Drop', 'Product Only Drop', 'Middle Drop Rainbow Foil', 'Alpha Drop', 'Undated Drop']), order);

  sv.sort = 'date_asc';
  order = tileOrder(renderSlViewer());
  check('date_asc: oldest first, undated still last',
    JSON.stringify(order) === JSON.stringify(['Alpha Drop', 'Middle Drop Rainbow Foil', 'Product Only Drop', 'Zeta Drop', 'Undated Drop']), order);

  sv.sort = 'name_desc';
  order = tileOrder(renderSlViewer());
  check('name_desc still reverse-alphabetical', order[0] === 'Zeta Drop' && order[order.length - 1] === 'Alpha Drop', order);

  // ── drops table layout ──────────────────────────────────────────────────────
  Object.assign(sv, { sort: 'date_desc', layout: 'table' });
  const dt = renderSlViewer();
  check('table layout renders a table', dt.includes('<table>') && dt.includes('table-wrap'));
  check('table has Released + MSRP headers', dt.includes('Released') && dt.includes('MSRP'));
  check('table rows navigate via open-drop, date order kept',
    JSON.stringify(rowOrder(dt, 'open-drop')) === JSON.stringify(['Zeta Drop', 'Product Only Drop', 'Middle Drop Rainbow Foil', 'Alpha Drop', 'Undated Drop']), rowOrder(dt, 'open-drop'));
  check('wiki date shown', dt.includes('2024-08-01'));
  check('product releaseDate fallback shown', dt.includes('2023-03-03'));
  check('foil variant gets base drop wiki date', dt.includes('2022-05-10'));
  check('foil variant MSRP is the foil price', dt.includes('$34.99'), dt.match(/\$\d+\.\d\d/g));
  check('undated drop shows an em dash date', /<td[^>]*>—<\/td>/.test(dt));
  check('active sort header marked', dt.includes('Released ↓'));

  // ── landing (superdrops) table ──────────────────────────────────────────────
  Object.assign(sv, { superdrop: '', drop: '', layout: 'table', sort: 'date_desc' });
  const lt = renderSlViewer();
  const sdOrder = rowOrder(lt, 'open-superdrop');
  check('landing table rows navigate via open-superdrop, newest first, undated last',
    JSON.stringify(sdOrder) === JSON.stringify(['Newer SD', 'Test SD', 'No-date SD']), sdOrder);
  check('landing table has Drops column header', lt.includes('>Drops<'));
  check('upcoming feature is absent from the Explorer while its advanced setting is off',
    !lt.includes('Upcoming Secret Lairs') && !lt.includes('data-val="upcoming"'));

  const officialPreview = lt.slice(lt.indexOf('Official Wizards announcements'));
  check('landing announcement strip previews exactly four articles',
    (officialPreview.match(/Secret Lair Announcement \d/g) || []).length === 4 && officialPreview.includes('View all · 6'));
  check('legacy announcement prices are removed on cache load',
    slAnnouncements().every(row => !Object.hasOwn(row, 'prices')));

  Object.assign(sv, { view: 'announcements', superdrop: '', drop: '' });
  const av = renderSlViewer();
  check('all-announcements view renders every cached article',
    ANNOUNCEMENTS.every(row => av.includes(row.title)) && av.includes('6 recent articles'));
  check('all-announcements view explains omitted product prices and contains no parsed price',
    av.includes('Product prices are omitted') && !av.includes('$29.99') && !av.includes('announced price'));

  collection.settings.upcomingSecretLairsEnabled = true;
  Object.assign(sv, { view: 'upcoming', upcomingDrop: '', search: '' });
  const uv = renderSlViewer();
  check('upcoming view renders an official drop with exact Scryfall coverage',
    uv.includes('Explore upcoming Secret Lairs') && uv.includes('Future Preview Drop') && uv.includes('<strong>1</strong> exact preview ID'));
  sv.upcomingDrop = 'Future Preview Drop';
  const ud = renderSlViewer();
  check('upcoming drop reuses the card gallery with a preview printing',
    ud.includes('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') && ud.includes('sl-card-preview') && ud.includes('1 of 1'));

  // ── landing tiles date sort: undated superdrop last both directions ─────────
  sv.view = 'drops'; sv.layout = 'tiles'; sv.sort = 'date_asc';
  const la = renderSlViewer();
  const sdTiles = [...la.matchAll(/data-sl-superdrop="([^"]+)"/g)].map(m => m[1]);
  check('landing tiles date_asc: undated superdrop last',
    JSON.stringify(sdTiles) === JSON.stringify(['Test SD', 'Newer SD', 'No-date SD']), sdTiles);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll Secret Lair Explorer smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
