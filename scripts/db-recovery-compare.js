// Probe how much of cards/sealed/settings is actually retrievable from the
// corrupt-but-openable live DB, and compare to the clean 06-13 backup.
// Read-only; operates on the temp copies.
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const tmp = path.join(process.env.TEMP, 'sltracker-recovery');
const live = new Database(path.join(tmp, 'live', 'collection.db'), { readonly: true });
const bk   = new Database(path.join(tmp, 'backups', 'collection-2026-06-13.db'), { readonly: true });

// Iterate row by row so one bad page doesn't abort the whole read.
function safeScan(db, table) {
  let n = 0, err = null;
  const rows = [];
  try {
    const stmt = db.prepare(`SELECT * FROM ${table}`);
    for (const r of stmt.iterate()) { rows.push(r); n++; }
  } catch (e) { err = e.message; }
  return { n, err, rows };
}

for (const [label, db] of [['LIVE', live], ['06-13', bk]]) {
  console.log(`\n===== ${label} =====`);
  for (const t of ['cards', 'sealed', 'settings']) {
    const r = safeScan(db, t);
    console.log(`  ${t.padEnd(9)} read ${r.n} rows${r.err ? '  <-- ERROR after that many: ' + r.err : ' (clean)'}`);
  }
}

// If cards fully readable from live, hash-compare to 06-13
const lc = safeScan(live, 'cards');
const bc = safeScan(bk, 'cards');
if (!lc.err && !bc.err) {
  const h = rows => crypto.createHash('sha1').update(JSON.stringify(
    rows.map(r => JSON.stringify(r)).sort())).digest('hex').slice(0, 12);
  console.log(`\ncards content hash  LIVE ${h(lc.rows)}  vs  06-13 ${h(bc.rows)}  identical=${h(lc.rows) === h(bc.rows)}`);
  if (h(lc.rows) !== h(bc.rows)) {
    const b = new Map(bc.rows.map(r => [r.id, JSON.stringify(r)]));
    const l = new Map(lc.rows.map(r => [r.id, JSON.stringify(r)]));
    let added = 0, changed = 0, removed = 0;
    for (const [id, j] of l) { if (!b.has(id)) added++; else if (b.get(id) !== j) changed++; }
    for (const id of b.keys()) if (!l.has(id)) removed++;
    console.log(`  added-since-0613=${added}  changed=${changed}  removed=${removed}`);
  }
}

console.log('\n-- settings keys --');
try { console.log('  LIVE :', live.prepare('SELECT key FROM settings').all().map(r => r.key).join(', ')); } catch (e) { console.log('  LIVE settings err', e.message); }
try { console.log('  06-13:', bk.prepare('SELECT key FROM settings').all().map(r => r.key).join(', ')); } catch (e) {}

live.close(); bk.close();
console.log('\ndone.');
