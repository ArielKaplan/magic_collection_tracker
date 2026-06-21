// Throwaway DB round-trip test for the disposition / realized-gains columns
// (v0.20.0). Verifies that status + sale fields persist for cards and sealed,
// that the migration is idempotent across a "restart" (init → close → init),
// and that resetAll clears everything.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-realized-db.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

const p = path.join(os.tmpdir(), `slt-realized-test-${Date.now()}.db`);
db.init(p);

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

// ── Cards: an owned entry and a sold one ─────────────────────────────────────
db.bulkUpsertCards([
  { id: 'c-own', scryfallId: 'aaa', name: 'Kept Card', foil: 'normal', quantity: 2, purchasePrice: 5 },
  { id: 'c-sold', scryfallId: 'bbb', name: 'Flipped Card', foil: 'foil', quantity: 1,
    purchasePrice: 10, status: 'sold', disposedAt: '2026-06-15', salePrice: 40, saleFees: 3, saleNote: 'sold on TCG' },
]);
let cards = db.listCards();
const own = cards.find(c => c.id === 'c-own');
const sold = cards.find(c => c.id === 'c-sold');
check('owned card defaults status=owned', own && own.status === 'owned', own && own.status);
check('sold card persists status=sold', sold && sold.status === 'sold', sold && sold.status);
check('sold card sale fields round-trip',
  sold && sold.disposed_at === '2026-06-15' && sold.sale_price === 40 && sold.sale_fees === 3 && sold.sale_note === 'sold on TCG',
  sold);

// ── Sealed: a sold product ───────────────────────────────────────────────────
db.replaceSealed([
  { id: 's-own', name: 'Sealed Box', productType: 'Booster Box', quantity: 1, purchasePrice: 100, status: 'sealed' },
  { id: 's-sold', name: 'Flipped Drop', productType: 'Secret Lair', quantity: 1, purchasePrice: 30,
    status: 'sold', disposedAt: '2026-06-10', salePrice: 75, saleFees: 5, saleNote: 'eBay' },
]);
let sealed = db.listSealed();
const sSold = sealed.find(i => i.id === 's-sold');
check('sold sealed persists status=sold', sSold && sSold.status === 'sold', sSold && sSold.status);
check('sold sealed sale fields round-trip',
  sSold && sSold.disposed_at === '2026-06-10' && sSold.sale_price === 75 && sSold.sale_fees === 5,
  sSold);

// ── Migration idempotency: simulate an app restart (re-init the same file) ────
db.close();
let reinitThrew = false;
try { db.init(p); } catch (e) { reinitThrew = true; }
check('re-init (migration re-run) does not throw', !reinitThrew);
cards = db.listCards();
check('data survives restart', cards.length === 2 && cards.find(c => c.id === 'c-sold').status === 'sold', cards.map(c => c.id));

// ── resetAll wipes both tables ───────────────────────────────────────────────
db.resetAll();
check('resetAll clears cards', db.listCards().length === 0);
check('resetAll clears sealed', db.listSealed().length === 0);

try { fs.unlinkSync(p); } catch {}
console.log(failures ? `\n${failures} FAILURES` : '\nAll realized-gains DB smoke tests passed.');
process.exit(failures ? 1 : 0);
