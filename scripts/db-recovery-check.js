// One-off DB recovery diagnostic. Opens each candidate file READ-ONLY, runs
// PRAGMA integrity_check, and counts key tables. Never writes to originals.
const path = require('path');
const Database = require('better-sqlite3');

const tmp = path.join(process.env.TEMP, 'sltracker-recovery');
const candidates = [
  ['live (db+wal)',   path.join(tmp, 'live', 'collection.db')],
  ['backup 06-18',    path.join(tmp, 'backups', 'collection-2026-06-18.db')],
  ['backup 06-13',    path.join(tmp, 'backups', 'collection-2026-06-13.db')],
  ['backup 06-12',    path.join(tmp, 'backups', 'collection-2026-06-12.db')],
];

const TABLES = ['cards', 'sealed', 'decks', 'deck_cards', 'price_history', 'card_metadata', 'settings'];

for (const [label, file] of candidates) {
  console.log('\n===== ' + label + ' =====');
  console.log(file);
  let db;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
  } catch (e) {
    console.log('  OPEN FAILED:', e.message);
    continue;
  }
  try {
    const ic = db.pragma('integrity_check');
    const result = ic.map(r => r.integrity_check).join('; ');
    console.log('  integrity_check:', result);
  } catch (e) {
    console.log('  integrity_check ERROR:', e.message);
  }
  for (const t of TABLES) {
    try {
      const n = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
      console.log(`  ${t.padEnd(14)} ${n}`);
    } catch (e) {
      console.log(`  ${t.padEnd(14)} ERROR: ${e.message}`);
    }
  }
  // Newest price snapshot date = how fresh the data is
  try {
    const d = db.prepare('SELECT MAX(date) AS d FROM price_history').get().d;
    console.log('  latest price_history date:', d);
  } catch (e) { /* table may be unreadable */ }
  db.close();
}
console.log('\ndone.');
