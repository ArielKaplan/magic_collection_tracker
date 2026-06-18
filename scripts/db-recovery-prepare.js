// Build the restored DB in temp (NON-destructive): clean 06-13 backup + the
// recovered sl_overrides note. Verify integrity + that the note reads back.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const tmp = path.join(process.env.TEMP, 'sltracker-recovery');
const restored = path.join(tmp, 'restored-collection.db');
fs.copyFileSync(path.join(tmp, 'backups', 'collection-2026-06-13.db'), restored);

const slOverrides = fs.readFileSync(path.join(tmp, 'recovered-sl_overrides.json'), 'utf8');

const db = new Database(restored);
db.prepare('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
  .run('sl_overrides', slOverrides);
// Flush WAL into the main file so the restored DB is a single self-contained file.
db.pragma('wal_checkpoint(TRUNCATE)');

console.log('integrity_check:', db.pragma('integrity_check').map(r => r.integrity_check).join('; '));
console.log('cards         :', db.prepare('SELECT COUNT(*) n FROM cards').get().n);
console.log('price_history :', db.prepare('SELECT COUNT(*) n FROM price_history').get().n);
console.log('card_metadata :', db.prepare('SELECT COUNT(*) n FROM card_metadata').get().n);
console.log('settings keys :', db.prepare('SELECT key FROM settings').all().map(r => r.key).join(', '));
console.log('sl_overrides  :', db.prepare("SELECT value FROM settings WHERE key='sl_overrides'").get().value);
db.close();

const sz = fs.statSync(restored).size;
console.log(`\nrestored file: ${restored}  (${sz} bytes)`);
console.log('done.');
