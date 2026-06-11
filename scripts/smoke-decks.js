// Throwaway smoke test for the deck feature's pure logic.
// Loads app.js with browser-global stubs, then exercises the deck parser,
// validator, stats, and exporters. Run: node scripts/smoke-decks.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const noop = () => {};
const sandbox = {
  console,
  crypto: require('crypto').webcrypto ?? { randomUUID: () => require('crypto').randomUUID() },
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: async () => { throw new Error('no network in smoke test'); },
  navigator: { clipboard: { writeText: async () => {} } },
  window: { addEventListener: noop },
  document: {
    addEventListener: noop,
    getElementById: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
    body: { dataset: {} },
  },
  confirm: () => true,
  localStorage: { getItem: () => null, setItem: noop },
};
sandbox.window.logger = undefined; // app.js assigns it
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf-8');
vm.runInContext(code, sandbox, { filename: 'app.js' });

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label}${detail ? ' — ' + JSON.stringify(detail) : ''}`); }
};

// ── parseDeckLine / parseDeckText ───────────────────────────────────────────
const r = vm.runInContext(`
(() => {
  const out = {};
  out.plain   = parseDeckLine('1 Sol Ring');
  out.xSuffix = parseDeckLine('4x Lightning Bolt');
  out.setNum  = parseDeckLine('1 Sol Ring (C21) 263');
  out.foil    = parseDeckLine('3 Verdant Catacombs (MH2) 260 *F*');
  out.etched  = parseDeckLine('1 Sol Ring (SLD) 1117 *E*');
  out.archi   = parseDeckLine('1x Krenko, Mob Boss (ddt) 46 [Premium,Commander{top}]');
  out.bare    = parseDeckLine('Counterspell');
  out.text = parseDeckText([
    'About',
    'Name Goblin Storm',
    '',
    'Commander',
    '1 Krenko, Mob Boss (DDT) 46',
    '',
    'Deck',
    '4 Lightning Bolt',
    '20 Mountain',
    '// a comment',
    '',
    'Sideboard',
    '2 Abrade (VOW) 139',
  ].join('\\n'));
  out.csv = parseDeckList([
    'Count,Name,Edition,Collector Number,Foil,Board',
    '1,"Atraxa, Praetors\\' Voice",2xm,190,foil,Commander',
    '4,Cultivate,c21,184,,Mainboard',
    '2,Abrade,vow,139,etched,Sideboard',
  ].join('\\n'));
  return out;
})()
`, sandbox);

check('plain line', r.plain.quantity === 1 && r.plain.name === 'Sol Ring' && r.plain.foil === 'normal');
check('4x suffix', r.xSuffix.quantity === 4 && r.xSuffix.name === 'Lightning Bolt');
check('set+collector', r.setNum.setCode === 'c21' && r.setNum.collectorNumber === '263' && r.setNum.name === 'Sol Ring');
check('moxfield foil *F*', r.foil.foil === 'foil' && r.foil.name === 'Verdant Catacombs' && r.foil.setCode === 'mh2', r.foil);
check('etched *E*', r.etched.foil === 'etched' && r.etched.collectorNumber === '1117');
check('archidekt tags stripped', r.archi.name === 'Krenko, Mob Boss' && r.archi.setCode === 'ddt' && r.archi.collectorNumber === '46', r.archi);
check('bare name = qty 1', r.bare.quantity === 1 && r.bare.name === 'Counterspell');

const t = r.text;
check('mtga About name', t.suggestedName === 'Goblin Storm', t.suggestedName);
check('text entries count', t.entries.length === 4, t.entries.map(e => e.name));
check('commander section', t.entries[0].board === 'commander' && t.entries[0].name === 'Krenko, Mob Boss');
check('main section', t.entries[1].board === 'main' && t.entries[2].board === 'main');
check('side section', t.entries[3].board === 'side' && t.entries[3].quantity === 2);

const c = r.csv;
check('csv parsed 3 entries', c.entries.length === 3, c.entries);
check('csv commander board + foil', c.entries[0].board === 'commander' && c.entries[0].foil === 'foil' && c.entries[0].name === "Atraxa, Praetors' Voice", c.entries[0]);
check('csv etched + side', c.entries[2].foil === 'etched' && c.entries[2].board === 'side');

// ── validation + stats + export ─────────────────────────────────────────────
const v = vm.runInContext(`
(() => {
  // Seed an owned collection: 1 Sol Ring owned, 30 Mountains owned
  collection.cards = [
    { id: 'c1', scryfallId: 'aaaa', name: 'Sol Ring', setCode: 'c21', setName: 'Commander 2021', collectorNumber: '263', foil: 'normal', quantity: 1, binderName: 'Main', purchasePrice: 0 },
    { id: 'c2', scryfallId: 'bbbb', name: 'Mountain', setCode: 'unf', setName: 'Unfinity', collectorNumber: '235', foil: 'normal', quantity: 30, binderName: 'Lands', purchasePrice: 0 },
  ];
  collection.priceHistory = { 'aaaa|normal': [{ date: '2026-06-10', price: 2.5 }], 'cccc|normal': [{ date: '2026-06-10', price: 40 }] };
  collection.cardMetadata = {
    'cccc': { colors: ['R'], color_identity: ['R'], type_line: 'Legendary Creature — Goblin Warrior', cmc: 4, oracle_text: '' },
    'dddd': { colors: ['U'], color_identity: ['U'], type_line: 'Instant', cmc: 2, oracle_text: 'Counter target spell.' },
  };

  const deck = createDeck('Test Krenko', 'commander');
  addCardToDeck(deck, { scryfallId: 'cccc', name: 'Krenko, Mob Boss', setCode: 'ddt' }, 'commander', 1);
  addCardToDeck(deck, { scryfallId: 'aaaa', name: 'Sol Ring', setCode: 'c21', cardId: 'c1' }, 'main', 1);
  addCardToDeck(deck, { scryfallId: 'bbbb', name: 'Mountain', setCode: 'unf' }, 'main', 30);
  addCardToDeck(deck, { scryfallId: 'dddd', name: 'Counterspell', setCode: 'mh2' }, 'main', 2);

  // merge check: adding Sol Ring again should bump qty, not duplicate
  addCardToDeck(deck, { scryfallId: 'aaaa', name: 'Sol Ring', setCode: 'c21' }, 'main', 1);

  const issues = validateDeck(deck);
  const stats = deckStats(deck);
  const text = deckToText(deck);
  const csv = deckToCsv(deck);
  const entries = deck.cards.length;
  return { issues, stats, text, csv, entries, deckCount: collection.decks.length };
})()
`, sandbox);

check('merge dedupes same printing', v.entries === 4, v.entries);
const msgs = v.issues.map(i => i.msg).join(' | ');
check('size violation flagged (35 < 100)', /35 cards/.test(msgs), msgs);
check('singleton violation flagged (2x Sol Ring)', /Sol Ring/.test(msgs) && /singleton/.test(msgs), msgs);
check('color identity violation (Counterspell in Krenko)', /Counterspell/.test(msgs), msgs);
check('basic lands exempt from copy limit', !/Mountain/.test(msgs), msgs);
check('stats total 35', v.stats.total === 35, v.stats);
check('owned: 1 Sol Ring + 30 Mountains = 31, missing 4', v.stats.ownedCount === 31 && v.stats.missingCount === 4, v.stats);
check('deck value = 2*2.50 + 40 = 45', Math.abs(v.stats.value - 45) < 0.001, v.stats);
check('owned value counts only owned copies (1×2.50)', Math.abs(v.stats.ownedValue - 2.5) < 0.001, v.stats);
check('missing value (1×2.50 + 1×40 = 42.50)', Math.abs(v.stats.missingValue - 42.5) < 0.001, v.stats);
check('text export has Commander section', /^Commander\n1 Krenko, Mob Boss \(DDT\)/m.test(v.text), v.text);
check('text export has Deck section', /^Deck\n/m.test(v.text), v.text);
check('csv export quotes comma names', /"Krenko, Mob Boss"/.test(v.csv), v.csv);
check('csv export has header', /^Count,Name,Edition/.test(v.csv));

console.log(failures ? `\n${failures} FAILURES` : '\nAll smoke tests passed.');
process.exit(failures ? 1 : 0);
