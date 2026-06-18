// Try to recover individual setting VALUES from the corrupt live DB via targeted
// index-assisted reads (SELECT value WHERE key=?), which can dodge the corrupt
// table-scan path. Compare each to the clean 06-13 backup. Read-only.
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const tmp = path.join(process.env.TEMP, 'sltracker-recovery');
const live = new Database(path.join(tmp, 'live', 'collection.db'), { readonly: true });
const bk   = new Database(path.join(tmp, 'backups', 'collection-2026-06-13.db'), { readonly: true });

const keys = ['dashboard_layout_v2','last_price_refresh','settings_blob','sl_data_updated_at','sl_overrides','sl_scryfall_to_name','tcgcsv_cache'];

const recovered = {};
for (const k of keys) {
  let liveVal = null, liveErr = null;
  try { liveVal = live.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null; }
  catch (e) { liveErr = e.message; }
  let bkVal = null;
  try { bkVal = bk.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? null; }
  catch (e) {}
  const same = liveVal != null && bkVal != null && liveVal === bkVal;
  const status = liveErr ? `READ-ERR (${liveErr})`
    : liveVal == null ? 'live=null'
    : bkVal == null ? `LIVE-ONLY len=${String(liveVal).length}`
    : same ? 'identical'
    : `DIFFERS live=${String(liveVal).length} bk=${String(bkVal).length}`;
  console.log(`  ${k.padEnd(20)} ${status}`);
  if (!liveErr && liveVal != null) recovered[k] = liveVal;
}

// Persist the recovered sl_overrides specifically (the irreplaceable curation).
if (recovered.sl_overrides) {
  const out = path.join(tmp, 'recovered-sl_overrides.json');
  fs.writeFileSync(out, recovered.sl_overrides, 'utf8');
  console.log('\nWROTE recovered sl_overrides ->', out);
  console.log('  preview:', recovered.sl_overrides.slice(0, 400));
} else {
  console.log('\nsl_overrides NOT recoverable from live DB.');
}

live.close(); bk.close();
console.log('\ndone.');
