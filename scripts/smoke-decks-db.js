// Throwaway DB round-trip test for the decks tables.
// Run with Electron's Node ABI: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-decks-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-deck-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

db.upsertDeck({
  id: 'd1', name: 'Test Deck', format: 'commander', description: 'desc',
  cards: [
    { id: 'dc1', cardId: 'c9', scryfallId: 'abc', name: 'Sol Ring', setCode: 'c21', setName: 'Commander 2021', collectorNumber: '263', foil: 'normal', quantity: 1, board: 'main' },
    { id: 'dc2', cardId: null, scryfallId: 'def', name: 'Krenko, Mob Boss', setCode: 'ddt', setName: '', collectorNumber: '46', foil: 'foil', quantity: 1, board: 'commander' },
  ],
});

let decks = db.listDecks();
check('one deck listed', decks.length === 1, decks);
check('deck fields round-trip', decks[0].name === 'Test Deck' && decks[0].format === 'commander' && decks[0].description === 'desc', decks[0]);
check('two cards round-trip', decks[0].cards.length === 2, decks[0].cards);
const dc1 = decks[0].cards.find(c => c.id === 'dc1');
const dc2 = decks[0].cards.find(c => c.id === 'dc2');
check('card link fields', dc1.cardId === 'c9' && dc1.scryfallId === 'abc' && dc1.board === 'main', dc1);
check('unowned commander entry', dc2.cardId === null && dc2.board === 'commander' && dc2.foil === 'foil', dc2);

// Rewrite-on-upsert (card list replaced, not appended)
db.upsertDeck({ id: 'd1', name: 'Renamed', format: 'modern', cards: [{ id: 'dc3', name: 'Bolt', quantity: 4, board: 'main' }] });
decks = db.listDecks();
check('upsert replaces card list', decks[0].cards.length === 1 && decks[0].cards[0].name === 'Bolt', decks[0].cards);
check('upsert updates deck row', decks[0].name === 'Renamed' && decks[0].format === 'modern', decks[0]);

// Cascade delete
db.deleteDeck('d1');
check('deck deleted', db.listDecks().length === 0);

// resetAll includes decks
db.upsertDeck({ id: 'd2', name: 'X', format: 'other', cards: [{ id: 'dc9', name: 'Y', quantity: 1, board: 'main' }] });
db.resetAll();
check('resetAll clears decks', db.listDecks().length === 0);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll DB smoke tests passed.');
process.exit(failures ? 1 : 0);
