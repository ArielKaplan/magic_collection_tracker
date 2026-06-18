// Throwaway test for the backup-hardening integrity checks.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-backup-integrity.js
'use strict';
const db = require('../src/main/db.js');
const os = require('os');
const fs = require('fs');
const path = require('path');

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

(async () => {
  // 1. A healthy live DB passes integrityCheck()
  const live = path.join(os.tmpdir(), `slt-integ-${Date.now()}.db`);
  db.init(live);
  db.bulkUpsertCards([{ id: 'c1', name: 'Sol Ring', scryfallId: 'abc', quantity: 1 }]);
  const h = db.integrityCheck();
  check('healthy DB integrityCheck() ok', h.ok, h);

  // 2. A backup of it verifies clean (db.backup is async — must await)
  const good = path.join(os.tmpdir(), `slt-integ-good-${Date.now()}.db`);
  await db.backupTo(good);
  check('fresh backup integrityCheckFile() ok', db.integrityCheckFile(good).ok, db.integrityCheckFile(good));

  // 3. A synthetically corrupted copy fails (page 1 header kept; pages 2+ scribbled)
  const bad = path.join(os.tmpdir(), `slt-integ-bad-${Date.now()}.db`);
  fs.copyFileSync(good, bad);
  const fd = fs.openSync(bad, 'r+');
  fs.writeSync(fd, Buffer.alloc(3000, 0xff), 0, 3000, 4096);
  fs.closeSync(fd);
  const bc = db.integrityCheckFile(bad);
  check('corrupted file integrityCheckFile() NOT ok', !bc.ok, bc);

  // 4. Bonus: real corrupt + clean backups from the June 2026 incident, if staged
  const realCorrupt = path.join(os.tmpdir(), 'sltracker-recovery', 'backups', 'collection-2026-06-18.db');
  const realClean   = path.join(os.tmpdir(), 'sltracker-recovery', 'backups', 'collection-2026-06-13.db');
  if (fs.existsSync(realCorrupt)) check('real incident corrupt backup detected', !db.integrityCheckFile(realCorrupt).ok, db.integrityCheckFile(realCorrupt).detail);
  if (fs.existsSync(realClean))   check('real incident clean backup verified', db.integrityCheckFile(realClean).ok, db.integrityCheckFile(realClean).detail);

  for (const f of [live, good, bad]) { try { fs.unlinkSync(f); } catch {} }
  console.log(failures ? `\n${failures} FAILURES` : '\nAll backup-integrity smoke tests passed.');
  process.exit(failures ? 1 : 0);
})();
