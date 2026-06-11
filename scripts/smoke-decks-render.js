// Throwaway render smoke test: ensures the Decks tab render functions produce
// HTML without throwing. Run: node scripts/smoke-decks-render.js
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const noop = () => {};
const sandbox = {
  console, crypto: require('crypto'), setTimeout, clearTimeout,
  fetch: async () => { throw new Error('no net'); },
  navigator: { clipboard: {} },
  window: { addEventListener: noop },
  document: { addEventListener: noop, getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, body: { dataset: {} } },
  confirm: () => true,
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.js'), 'utf-8'), sandbox, { filename: 'app.js' });

const out = vm.runInContext(`
(() => {
  const empty = renderDecks();
  collection.cards = [{ id: 'c1', scryfallId: 'aaaa1111-1111-4111-8111-111111111111', name: 'Sol Ring', setCode: 'c21', setName: 'C21', collectorNumber: '263', foil: 'normal', quantity: 2, binderName: 'Main', purchasePrice: 0, language: 'en', condition: 'near_mint' }];
  collection.priceHistory = {};
  collection.cardMetadata = {};
  const deck = createDeck('My Deck', 'commander');
  addCardToDeck(deck, { scryfallId: 'aaaa1111-1111-4111-8111-111111111111', name: 'Sol Ring', setCode: 'c21' }, 'main', 1);
  addCardToDeck(deck, { scryfallId: 'bbbb1111-1111-4111-8111-111111111111', name: 'Krenko, Mob Boss', setCode: 'ddt', foil: 'foil' }, 'commander', 1);
  addCardToDeck(deck, { name: 'Mystery Card With No SID' }, 'side', 2);
  const list = renderDecks();
  ui.decks.deckId = deck.id;
  const detail = renderDecks();
  ui.decks.deckId = 'nonexistent';
  const fallback = renderDecks();
  return {
    emptyOk: empty.includes('No decks yet'),
    listOk: list.includes('deck-tile') && list.includes('My Deck'),
    detailOk: detail.includes('deck-detail') && detail.includes('Krenko') && detail.includes('Mainboard') && detail.includes('Sideboard'),
    legalityFlagged: detail.includes('deck-legality-bad'),
    unownedPill: detail.includes('own-none'),
    ownedPill: detail.includes('own-full'),
    fallbackOk: fallback.includes('deck-tile'),
  };
})()
`, sandbox);

console.log(out);
if (Object.values(out).every(Boolean)) console.log('All render smoke tests passed.');
else { console.error('RENDER FAILURES'); process.exit(1); }
