// DB round-trip + seed test for the Precon Explorer catalog (v0.29.0):
// init on a fresh DB imports the real baked seed (src/main/precon-seed.json),
// upsert appends, re-init doesn't double-seed, resetAll restores the catalog.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-precon-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-precon-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

// ── Seed import on first init ────────────────────────────────────────────────
let decks = db.listPreconDecks();
check('seed imported on fresh init (~975 decks)', decks.length > 900, decks.length);
const withColors = decks.filter(d => d.colors).length;
check('colors populated for most decks', withColors > decks.length * 0.7, withColors);
const commander = decks.find(d => d.type === 'Commander Deck' && d.commander);
check('commander decks carry commander names', !!commander, commander && commander.name);

let cards = db.listPreconDeckCards();
check('card rows imported (~40k, compact arrays)', cards.length > 30000 && Array.isArray(cards[0]) && cards[0].length === 8, cards.length);
const finishes = new Set(cards.map(r => r[4]));
check('finishes are the model vocabulary', [...finishes].every(f => ['nonfoil', 'foil', 'etched'].includes(f)), [...finishes]);

// ── Append (the in-app sync path) ────────────────────────────────────────────
db.upsertPreconDecks([{
  file: 'SmokeDeck_TST', name: 'Smoke Deck', type: 'Commander Deck', code: 'TST',
  date: '2026-07-01', colors: 'WU', commander: 'Smokey', variantOf: null,
  cards: [['sid-x', 'Test Card', 2, 'foil', 'main', 'TST', '42']],
}]);
decks = db.listPreconDecks();
const smoke = decks.find(d => d.file === 'SmokeDeck_TST');
check('appended deck round-trips (cardCount sums copies)', smoke && smoke.cardCount === 2 && smoke.colors === 'WU', smoke);

// ── Re-init must not double-seed ─────────────────────────────────────────────
const before = decks.length;
db.close();
db.init(p);
decks = db.listPreconDecks();
check('re-init keeps the catalog (no double seed)', decks.length === before, `${decks.length} vs ${before}`);
check('appended deck survives restart', !!decks.find(d => d.file === 'SmokeDeck_TST'));

// ── resetAll restores the pristine catalog ───────────────────────────────────
db.resetAll();
decks = db.listPreconDecks();
check('resetAll re-seeds the catalog', decks.length > 900, decks.length);
check('resetAll drops appended decks (back to baked)', !decks.find(d => d.file === 'SmokeDeck_TST'));

db.close();
try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll precon DB smoke tests passed.');
process.exit(failures ? 1 : 0);
