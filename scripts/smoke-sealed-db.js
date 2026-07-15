// Throwaway DB round-trip test for the sealed table — focuses on persistence of
// deletes (the bug) and the new authoritative replaceSealed.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-sealed-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-sealed-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

const mk = (id, name, over = {}) => ({
  id, name, productType: 'secret_lair', setCode: 'sld', setName: 'Secret Lair Drop',
  quantity: 1, purchasePrice: 29.99, currentValue: 40, status: 'sealed', notes: '',
  pricechartingId: 'pc-123', linkedScryfallIds: ['sid-a', 'sid-b'], openedFromId: 'parent-1',
  priceHistory: [{ date: '2026-06-18', price: 40, source: 'manual' }], ...over,
});

// upsert + list round-trip
db.upsertSealed(mk('s1', 'Foil Praetors'));
db.upsertSealed(mk('s2', 'Bobblehead', { status: 'opened', quantity: 2 }));
let list = db.listSealed();
check('two sealed listed', list.length === 2, list.map(s => s.id));
const s1 = list.find(s => s.id === 's1');
check('fields round-trip', s1 && s1.name === 'Foil Praetors' && s1.purchase_price === 29.99 && s1.status === 'sealed', s1);
check('priceHistory parsed back to array', Array.isArray(s1.priceHistory) && s1.priceHistory[0].price === 40, s1 && s1.priceHistory);
check('catalog/content/opening links round-trip', s1.pricecharting_id === 'pc-123' && s1.opened_from_id === 'parent-1' && s1.linkedScryfallIds.join(',') === 'sid-a,sid-b', s1);

// deleteSealed persists
db.deleteSealed('s1');
list = db.listSealed();
check('deleteSealed removes the row', list.length === 1 && list[0].id === 's2', list.map(s => s.id));

// replaceSealed = authoritative full sync: removing s2 from the list must drop it,
// adding s3 must insert it, in one call.
db.replaceSealed([mk('s3', 'Artist Series')]);
list = db.listSealed();
check('replaceSealed drops missing + adds new', list.length === 1 && list[0].id === 's3', list.map(s => s.id));

// replaceSealed with [] empties the table (the "deleted my last product" case)
db.replaceSealed([]);
check('replaceSealed([]) empties table', db.listSealed().length === 0);

// edits survive a replace (status/qty change is just a new snapshot of memory)
db.replaceSealed([mk('s3', 'Artist Series', { status: 'opened', quantity: 5 })]);
const after = db.listSealed()[0];
check('replaceSealed persists edits', after.status === 'opened' && after.quantity === 5, after);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll sealed DB smoke tests passed.');
process.exit(failures ? 1 : 0);
