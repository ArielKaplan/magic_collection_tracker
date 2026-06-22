// Throwaway smoke test for the unified import wizard's pure logic.
// Verifies the sealed CSV importer round-trips this app's own sealed export,
// and that the deck-form helpers the wizard depends on are exported.
// Run: node scripts/smoke-import.js
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

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail !== undefined ? ' — ' + JSON.stringify(detail) : ''}`); }
};

(async () => {
  const { autoDetectMapping, csvRowToSealed, SEALED_IMPORT_FIELDS, IMPORT_KINDS } =
    await import('../src/renderer-js/importWizard.js');
  const { deckImportBodyHtml, wireDeckImportForm } = await import('../src/renderer-js/deckIO.js');
  const { EXPORT_COLUMNS } = await import('../src/renderer-js/exportModal.js');

  // ── Round-trip: the app's own sealed export headers auto-detect correctly ────
  const exportHeaders = EXPORT_COLUMNS.sealed.map(c => c.label);
  const mapping = autoDetectMapping(exportHeaders, SEALED_IMPORT_FIELDS);

  check('name auto-mapped',          mapping.name === 'Name', mapping.name);
  check('productType auto-mapped',   mapping.productType === 'Product Type', mapping.productType);
  check('setCode auto-mapped',       mapping.setCode === 'Set Code', mapping.setCode);
  check('setName auto-mapped',       mapping.setName === 'Set Name', mapping.setName);
  check('dropName auto-mapped',      mapping.dropName === 'Secret Lair Drop', mapping.dropName);
  check('quantity auto-mapped',      mapping.quantity === 'Quantity', mapping.quantity);
  check('status auto-mapped',        mapping.status === 'Status', mapping.status);
  check('purchasePrice auto-mapped', mapping.purchasePrice === 'Purchase Price', mapping.purchasePrice);
  check('currentPrice auto-mapped',  mapping.currentPrice === 'Current Price', mapping.currentPrice);
  check('notes auto-mapped',         mapping.notes === 'Notes', mapping.notes);
  // "Total Value" is a derived export column with no import target — must stay unmapped
  check('no field grabs Total Value', !Object.values(mapping).includes('Total Value'), mapping);

  // ── Row → product conversion ────────────────────────────────────────────────
  const row = {
    'Name': 'Secret Lair: Artist Series – Sidharth Chaturvedi',
    'Product Type': 'Secret Lair',
    'Set Code': 'SLD',
    'Set Name': 'Secret Lair Drop',
    'Secret Lair Drop': 'Phyrexian Praetors',
    'Quantity': '2',
    'Status': 'sealed',
    'Purchase Price': '29.99',
    'Current Price': '45.50',
    'Total Value': '91.00',
    'Notes': 'foil edition',
  };
  const item = csvRowToSealed(row, mapping);
  check('product name',        item.name === row['Name'], item.name);
  check('product type',        item.productType === 'Secret Lair', item.productType);
  check('set code lowercased', item.setCode === 'sld', item.setCode);
  check('quantity parsed',     item.quantity === 2, item.quantity);
  check('status sealed',       item.status === 'sealed', item.status);
  check('purchase price',      item.purchasePrice === 29.99, item.purchasePrice);
  check('notes carried',       item.notes === 'foil edition', item.notes);
  check('drop name carried',   item.dropName === 'Phyrexian Praetors', item.dropName);
  check('currentPrice seeds priceHistory',
        item.priceHistory.length === 1 && item.priceHistory[0].price === 45.5 && item.priceHistory[0].source === 'import',
        item.priceHistory);
  check('has fresh id + empty links', typeof item.id === 'string' && item.id.length > 0 && Array.isArray(item.linkedScryfallIds) && item.linkedScryfallIds.length === 0);

  // status normalization
  check('opened status', csvRowToSealed({ ...row, 'Status': 'OPENED' }, mapping).status === 'opened');
  check('sold status',   csvRowToSealed({ ...row, 'Status': 'sold' }, mapping).status === 'sold');
  check('blank status defaults sealed', csvRowToSealed({ ...row, 'Status': '' }, mapping).status === 'sealed');

  // productType normalization
  check('unknown type kept verbatim', csvRowToSealed({ ...row, 'Product Type': 'Fat Pack' }, mapping).productType === 'Fat Pack');
  check('blank type defaults Other',  csvRowToSealed({ ...row, 'Product Type': '' }, mapping).productType === 'Other');
  check('case-insensitive type match', csvRowToSealed({ ...row, 'Product Type': 'booster box' }, mapping).productType === 'Booster Box');

  // no current price → no seeded history
  check('no current price → empty history', csvRowToSealed({ ...row, 'Current Price': '' }, mapping).priceHistory.length === 0);

  // row with no name → skipped (null)
  check('nameless row skipped', csvRowToSealed({ ...row, 'Name': '' }, mapping) === null);

  // ── Wizard plumbing ─────────────────────────────────────────────────────────
  check('IMPORT_KINDS has cards + sealed', !!IMPORT_KINDS.cards && !!IMPORT_KINDS.sealed);
  check('sealed kind wired to converter', IMPORT_KINDS.sealed.rowToItem === csvRowToSealed);
  check('sealed kind has perform fn', typeof IMPORT_KINDS.sealed.perform === 'function');
  check('deckImportBodyHtml returns markup', typeof deckImportBodyHtml() === 'string' && deckImportBodyHtml().includes('di-text'));
  check('wireDeckImportForm is a function', typeof wireDeckImportForm === 'function');

  console.log(failures ? `\n${failures} FAILURES` : '\nAll smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
