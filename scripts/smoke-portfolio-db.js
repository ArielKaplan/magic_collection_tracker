// Throwaway DB round-trip test for portfolio_snapshots — the "collection value
// over time" series. Verifies record/list ordering, the daily UPSERT (last
// refresh of a day wins), and that resetAll clears the table.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-portfolio-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-portfolio-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

// record + list round-trip, returned ascending by date
db.recordPortfolioSnapshot({ date: '2026-06-20', cardsValue: 100, sealedValue: 40, costBasis: 90, cardCount: 12 });
db.recordPortfolioSnapshot({ date: '2026-06-18', cardsValue: 80,  sealedValue: 30, costBasis: 90, cardCount: 12 });
let list = db.getPortfolioSnapshots();
check('two snapshots listed', list.length === 2, list.map(s => s.date));
check('sorted ascending by date', list[0].date === '2026-06-18' && list[1].date === '2026-06-20', list.map(s => s.date));
check('fields round-trip (camelCase)',
  list[1].cardsValue === 100 && list[1].sealedValue === 40 && list[1].costBasis === 90 && list[1].cardCount === 12, list[1]);

// daily UPSERT — re-recording the same date overwrites (last refresh wins), no dupe row
db.recordPortfolioSnapshot({ date: '2026-06-20', cardsValue: 125, sealedValue: 45, costBasis: 90, cardCount: 13 });
list = db.getPortfolioSnapshots();
const jun20 = list.filter(s => s.date === '2026-06-20');
check('same-day record upserts (no duplicate)', jun20.length === 1, list.map(s => s.date));
check('upsert overwrote with latest values', jun20[0] && jun20[0].cardsValue === 125 && jun20[0].cardCount === 13, jun20[0]);
check('still exactly two distinct days', list.length === 2, list.map(s => s.date));

// null-safe fields persist as null
db.recordPortfolioSnapshot({ date: '2026-06-21', cardsValue: 50 });
const jun21 = db.getPortfolioSnapshots().find(s => s.date === '2026-06-21');
check('missing fields stored as null', jun21 && jun21.sealedValue === null && jun21.costBasis === null, jun21);

// resetAll wipes the table
db.resetAll();
check('resetAll clears portfolio_snapshots', db.getPortfolioSnapshots().length === 0);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll portfolio DB smoke tests passed.');
process.exit(failures ? 1 : 0);
