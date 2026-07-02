// DB round-trip test for the finish-aware SL product model (v0.28.0):
// sl_products + sl_product_cards persist through replaceSlData/getSlData,
// omitting the products argument leaves the stored model untouched (older
// callers), clearSlData and resetAll wipe it, and re-init is idempotent.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-sldata-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-sldata-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

const dropCards = { "Goblin & Squabblin'": ['Goblin Lackey'], "Goblin & Squabblin' Foil": ['Goblin Lackey'] };
const std = { 'sid-base': ["Goblin & Squabblin'"], 'sid-star': ["Goblin & Squabblin' Foil"] };
const stn = { 'sid-base': 'Goblin Lackey', 'sid-star': 'Goblin Lackey' };
const products = [
  { uuid: 'p-base', legacyDrop: "Goblin & Squabblin'", dropName: "Goblin & Squabblin'",
    finishLabel: '', finish: 'nonfoil', tcgplayerProductId: '501841', releaseDate: '2023-06-26',
    lowConfidence: false, cards: [{ scryfallId: 'sid-base', name: 'Goblin Lackey', number: '1311', finish: 'nonfoil', count: 1 }] },
  { uuid: 'p-foil', legacyDrop: "Goblin & Squabblin' Foil", dropName: "Goblin & Squabblin'",
    finishLabel: 'Foil', finish: 'foil', tcgplayerProductId: '501840', releaseDate: '2023-06-26',
    lowConfidence: false, cards: [{ scryfallId: 'sid-star', name: 'Goblin Lackey', number: '1311★', finish: 'foil', count: 1 }] },
];

// ── Round-trip ───────────────────────────────────────────────────────────────
db.replaceSlData(dropCards, std, stn, products);
let got = db.getSlData();
check('legacy maps round-trip', got.dropCards["Goblin & Squabblin'"]?.length === 1 && got.scryfallToDrops['sid-star']?.[0] === "Goblin & Squabblin' Foil", got.dropCards);
check('two products round-trip', Array.isArray(got.products) && got.products.length === 2, got.products?.length);
const foil = (got.products || []).find(x => x.uuid === 'p-foil');
check('product fields round-trip (camelCased)',
  foil && foil.legacyDrop === "Goblin & Squabblin' Foil" && foil.finish === 'foil'
    && foil.finishLabel === 'Foil' && foil.tcgplayerProductId === '501840' && foil.lowConfidence === false,
  foil);
check('product cards round-trip with finish + ★ number',
  foil && foil.cards.length === 1 && foil.cards[0].scryfallId === 'sid-star'
    && foil.cards[0].finish === 'foil' && foil.cards[0].number === '1311★',
  foil && foil.cards);

// ── Omitting products (legacy caller) must not clobber the stored model ─────
db.replaceSlData(dropCards, std, stn);
got = db.getSlData();
check('products survive a products-less replace', got.products.length === 2, got.products.length);

// ── Restart idempotency ──────────────────────────────────────────────────────
db.close();
let reinitThrew = false;
try { db.init(p); } catch (e) { reinitThrew = true; }
check('re-init does not throw', !reinitThrew);
got = db.getSlData();
check('model survives restart', got.products.length === 2 && got.products.find(x => x.uuid === 'p-foil').cards[0].finish === 'foil', got.products.length);

// ── clearSlData + resetAll wipe the model ────────────────────────────────────
db.replaceSlData(dropCards, std, stn, products);
db.clearSlData();
got = db.getSlData();
check('clearSlData clears products', got.products.length === 0, got.products.length);
db.replaceSlData(dropCards, std, stn, products);
db.resetAll();
got = db.getSlData();
check('resetAll clears products', got.products.length === 0, got.products.length);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll SL product-model DB smoke tests passed.');
process.exit(failures ? 1 : 0);
