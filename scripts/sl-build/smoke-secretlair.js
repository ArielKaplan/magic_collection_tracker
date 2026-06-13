// scripts/sl-build/smoke-secretlair.js
// Loads the generated src/renderer/secretlair.js in a vm sandbox (no DOM/window
// needed — top level only declares data + computes maps) and asserts the bake.
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, '..', '..', 'src', 'renderer', 'secretlair.js');
let src = fs.readFileSync(file, 'utf8');
src += '\nglobalThis.__SL = { SL_SUPERDROPS, SL_DROP_CARDS, SL_SCRYFALL_TO_DROPS, SL_SCRYFALL_TO_NAME, SL_DROP_TO_SUPERDROP, SL_CARD_TO_DROPS, SL_DROP_TO_SCRYFALL_IDS, getSlInfo, getSlInfoById };';

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx, { filename: 'secretlair.js' });
const SL = ctx.__SL;

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

console.log('parse + load:');
ok(Array.isArray(SL.SL_SUPERDROPS) && SL.SL_SUPERDROPS.length > 80, `SL_SUPERDROPS = ${SL.SL_SUPERDROPS.length}`);
ok(Object.keys(SL.SL_DROP_CARDS).length > 340, `SL_DROP_CARDS drops = ${Object.keys(SL.SL_DROP_CARDS).length}`);
ok(Object.keys(SL.SL_SCRYFALL_TO_DROPS).length > 1800, `SL_SCRYFALL_TO_DROPS drop-mapped ids = ${Object.keys(SL.SL_SCRYFALL_TO_DROPS).length}`);
ok(Object.keys(SL.SL_SCRYFALL_TO_NAME).length > 2400, `SL_SCRYFALL_TO_NAME ids = ${Object.keys(SL.SL_SCRYFALL_TO_NAME).length}`);
ok(Object.keys(SL.SL_DROP_TO_SUPERDROP).length > 340, `SL_DROP_TO_SUPERDROP computed = ${Object.keys(SL.SL_DROP_TO_SUPERDROP).length}`);
ok(Object.keys(SL.SL_DROP_TO_SCRYFALL_IDS).length > 340, `SL_DROP_TO_SCRYFALL_IDS computed = ${Object.keys(SL.SL_DROP_TO_SCRYFALL_IDS).length}`);

console.log('\ngrouping correctness:');
const sd = (drop) => (SL.SL_DROP_TO_SUPERDROP[drop] || {}).superdrop;
ok(sd('Uncharted') === 'PlayStation Superdrop', `Uncharted -> ${sd('Uncharted')}`);
ok(sd('Ghost of Tsushima') === 'PlayStation Superdrop', `Ghost of Tsushima -> ${sd('Ghost of Tsushima')}`);
ok(sd('Sonic: Turbo Gear') === 'Sonic Superdrop', `Sonic: Turbo Gear -> ${sd('Sonic: Turbo Gear')}`);
ok(sd('Final Fantasy: Game Over') === 'Summer Superdrop 2025', `Final Fantasy: Game Over -> ${sd('Final Fantasy: Game Over')}`);
ok(sd("Marvel's Spider-Man: Mana Symbiote") === "Marvel's Spider-Man Superdrop", `Spider-Man drop -> ${sd("Marvel's Spider-Man: Mana Symbiote")}`);
ok(sd("Marvel's Deadpool") === "Marvel's Deadpool", `Deadpool (standalone, self-named) -> ${sd("Marvel's Deadpool")}`);
ok(sd('The Walking Dead') === 'The Walking Dead', `The Walking Dead (standalone) -> ${sd('The Walking Dead')}`);

console.log('\ncard-level lookups:');
const fancy = SL.getSlInfo('Nathan Drake, Treasure Hunter');
ok(fancy.length > 0 && fancy[0].drop === 'Uncharted' && fancy[0].superdrop === 'PlayStation Superdrop', `getSlInfo('Nathan Drake...') -> ${JSON.stringify(fancy)}`);
// a foil-backfilled id should resolve to its drop via getSlInfoById
const someId = Object.keys(SL.SL_SCRYFALL_TO_DROPS)[0];
ok(SL.getSlInfoById(someId).length > 0, `getSlInfoById sample id resolves (${someId})`);

console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'}`);
process.exit(fail ? 1 : 0);
