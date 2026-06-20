// Throwaway DB round-trip test for the want_list table.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-wantlist-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-wantlist-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

db.replaceWantList([
  { id: 'w1', scryfallId: 'aaa', name: 'Card One', setCode: 'sld', setName: 'Secret Lair Drop', collectorNumber: '12', foil: 'normal', dropName: 'City Styles', maxPrice: 5, note: 'cheap' },
  { id: 'w2', scryfallId: 'bbb', name: 'Card Two', foil: 'foil' },
]);
let list = db.listWantList();
check('two want items listed', list.length === 2, list.map(w => w.id));
const w1 = list.find(w => w.id === 'w1');
check('fields round-trip (camelCase)',
  w1 && w1.name === 'Card One' && w1.foil === 'normal' && w1.dropName === 'City Styles' && w1.maxPrice === 5, w1);
const w2 = list.find(w => w.id === 'w2');
check('omitted maxPrice stored as null', w2 && w2.maxPrice === null, w2);

// Authoritative replace: dropping w2, adding w3, editing w1 in one call
db.replaceWantList([
  { id: 'w1', scryfallId: 'aaa', name: 'Card One', foil: 'normal', maxPrice: 3 },
  { id: 'w3', scryfallId: 'ccc', name: 'Card Three', foil: 'normal' },
]);
list = db.listWantList();
check('replace drops missing + adds new', list.length === 2 && list.some(w => w.id === 'w3') && !list.some(w => w.id === 'w2'), list.map(w => w.id));
check('replace persists edits', list.find(w => w.id === 'w1').maxPrice === 3, list.find(w => w.id === 'w1'));

db.replaceWantList([]);
check('replace([]) empties table', db.listWantList().length === 0);

db.replaceWantList([{ id: 'w9', name: 'Survivor', foil: 'normal' }]);
db.resetAll();
check('resetAll clears want_list', db.listWantList().length === 0);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll want_list DB smoke tests passed.');
process.exit(failures ? 1 : 0);
