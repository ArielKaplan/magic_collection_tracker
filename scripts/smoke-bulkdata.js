// smoke-bulkdata.js — exercises the Scryfall bulk-data engine (src/main/bulkData.js):
// the line parser and compact extractor on a synthetic bulk-style file, lookup
// semantics on a cold cache, and — with --live — the REAL daily download into a
// temp dir (validates the full fetch → stream → parse → index → lookup path).
//
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-bulkdata.js [--live]
'use strict';
const bulk = require('../src/main/bulkData.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-bulk-'));

  // ── extractCompact: faces fallback + field shape ──────────────────────────
  const compact = bulk.extractCompact({
    id: 'ABC-123', name: 'Two-Face // Other', set: 'tst', set_name: 'Test', collector_number: '1',
    finishes: ['nonfoil', 'foil'], prices: { usd: '1.23', usd_foil: '4.56' }, rarity: 'rare',
    card_faces: [{ mana_cost: '{1}{U}', type_line: 'Instant', colors: ['U'], oracle_text: 'Draw.' }],
    cmc: 2, color_identity: ['U'],
  });
  check('id lowercased', compact.id === 'abc-123', compact.id);
  check('face fallback for mana/type/colors', compact.mana_cost === '{1}{U}' && compact.type_line === 'Instant' && compact.colors.join('') === 'U', compact);
  check('prices carried through', compact.prices.usd_foil === '4.56', compact.prices);

  // ── line parser on a synthetic bulk-style file ────────────────────────────
  const f = path.join(tmp, 'synthetic.json');
  fs.writeFileSync(f, [
    '[',
    JSON.stringify({ id: 'AAA', name: 'Alpha', prices: { usd: '1.00' } }) + ',',
    JSON.stringify({ id: 'BBB', name: 'Beta', prices: { usd_foil: '2.00' } }) + ',',
    '{THIS OBJECT IS BROKEN JSON},',
    JSON.stringify({ id: 'CCC', name: 'Gamma', prices: {} }),
    ']',
  ].join('\n'));
  const got = [];
  const { parsed, failed } = await bulk.parseBulkFile(f, c => got.push(c.id));
  check('parses one object per line', parsed === 3 && got.join(',') === 'AAA,BBB,CCC', { parsed, got });
  check('garbage lines skipped, not fatal', failed === 1, failed);

  // ── cold-cache lookup: everything missing, nothing throws ─────────────────
  bulk.init(tmp);
  const cold = bulk.lookup(['abc', 'def']);
  check('cold cache → all missing', cold.found.length === 0 && cold.missing.length === 2, cold);
  check('status reports empty', bulk.status().state === 'empty', bulk.status());

  // ── cheapestByNames on a synthetic warm index ─────────────────────────────
  // An upcoming SL print has no price; the cheapest OTHER print (any finish) wins.
  fs.writeFileSync(path.join(tmp, 'bulk', 'index.json'), JSON.stringify([
    { id: 'p1', name: 'Squirrel Girl', set: 'sld', set_name: 'Secret Lair Drop', prices: {} },
    { id: 'p2', name: 'Squirrel Girl', set: 'mar', set_name: 'Marvel Super Heroes', prices: { usd: '1.90', usd_foil: '4.00' } },
    { id: 'p3', name: 'Squirrel Girl', set: 'oth', set_name: 'Other Set', prices: { usd_foil: '2.50' } },
    { id: 'p4', name: 'No Price Anywhere', set: 'x', set_name: 'X', prices: {} },
  ]));
  const cheap = bulk.cheapestByNames(['Squirrel Girl', 'No Price Anywhere', 'Unknown Card']);
  check('cheapest = lowest across prints & finishes (1.90 @ Marvel Super Heroes)',
    cheap.found['Squirrel Girl'] && Math.abs(cheap.found['Squirrel Girl'].price - 1.90) < 1e-9
      && cheap.found['Squirrel Girl'].set_name === 'Marvel Super Heroes',
    cheap.found['Squirrel Girl']);
  check('unpriced + unknown names reported missing',
    cheap.missing.length === 2 && cheap.missing.includes('No Price Anywhere') && cheap.missing.includes('Unknown Card'),
    cheap.missing);

  // ── optional: the real download (also pre-warms nothing — temp dir) ───────
  if (process.argv.includes('--live')) {
    console.log('\n  --live: real download into temp dir (this takes a few minutes)…');
    const st = await bulk.ensureFresh(true, m => console.log('   [bulk]', m));
    check('live: index built', st.state === 'ready' && st.count > 50000, st);
    // Goblin Lackey #1311 (SLD) — a printing we know exists.
    const hit = bulk.lookup(['16cd79f1-0000-0000-0000-000000000000', '2a8b2dd7-4c7a-51b0-98a3-33a1c65402c8']);
    check('live: lookup returns found/missing split', hit.found.length + hit.missing.length === 2, hit);
  }

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILURES` : '\nAll bulk-data smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASHED:', e); process.exit(1); });
