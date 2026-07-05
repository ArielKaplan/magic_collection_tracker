// smoke-backups.js — the data-critical backup/restore file logic (backups.js)
// against a real better-sqlite3 DB in a temp dir. Verifies: list ordering,
// verified backup-now + prune, and the restore sequence (verify → close →
// move current db+wal+shm aside → copy backup into place → onDone), including
// that a corrupt backup is REJECTED and that no stale -wal survives a restore.
// Run: $env:ELECTRON_RUN_AS_NODE=1; npx electron scripts/smoke-backups.js
'use strict';
const db = require('../src/main/db.js');
const backups = require('../src/main/backups.js');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failures = 0;
const check = (label, cond, detail) => {
  if (cond) console.log(`  ok  ${label}`);
  else { failures++; console.error(`FAIL  ${label} — ${JSON.stringify(detail)}`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'slt-backups-'));
const live = path.join(root, 'collection.db');
const dir = path.join(root, 'backups');
fs.mkdirSync(dir, { recursive: true });

(async () => {
  // ── A live DB with one recognizable card ──────────────────────────────────
  db.init(live);
  db.bulkUpsertCards([{ id: 'card-original', scryfallId: 'sid', name: 'Original Card', foil: 'normal', quantity: 1 }]);

  // ── backupNow: writes a verified, dated backup ────────────────────────────
  const b1 = await backups.backupNow({ db, dir, keep: 10 });
  check('backupNow succeeds', b1.ok, b1);
  check('backup file written', b1.ok && fs.existsSync(b1.path), b1.path);

  // ── listBackups: sees it ──────────────────────────────────────────────────
  let list = backups.listBackups(dir);
  check('listBackups returns the backup', list.length === 1 && /^\d{4}-\d{2}-\d{2}$/.test(list[0].date), list);

  // Seed extra dated backups to test newest-first ordering + prune.
  for (const d of ['2024-01-01', '2024-06-15', '2025-12-31']) fs.copyFileSync(b1.path, path.join(dir, `collection-${d}.db`));
  list = backups.listBackups(dir);
  check('list is newest-first', list[0].date >= list[list.length - 1].date && list.length >= 4, list.map(x => x.date));

  const goodBackup = list.find(x => x.date === '2024-06-15').path;

  // ── Mutate the live DB AFTER the backup, so restore is observable ──────────
  db.bulkUpsertCards([{ id: 'card-later', scryfallId: 'sid2', name: 'Added After Backup', foil: 'normal', quantity: 1 }]);
  check('live DB now has 2 cards', db.listCards().length === 2);
  // force a -wal to exist (WAL mode) so we can prove it doesn't survive restore
  check('a -wal file exists pre-restore', fs.existsSync(live + '-wal'));

  // ── Restore rejects a corrupt backup, changes nothing ─────────────────────
  const badPath = path.join(dir, 'collection-2020-01-01.db');
  fs.writeFileSync(badPath, 'this is not a sqlite database');
  let onDoneCalls = 0;
  const bad = await backups.restoreBackup({ db, live, dir, backupPath: badPath, onDone: () => onDoneCalls++ });
  check('corrupt backup is rejected', !bad.ok && onDoneCalls === 0, bad);
  check('live DB untouched after rejected restore', db.listCards().length === 2);

  // ── Restore a good backup: db reverts, wal gone, pre-restore kept ─────────
  const good = await backups.restoreBackup({ db, live, dir, backupPath: goodBackup, onDone: () => onDoneCalls++ });
  check('good restore returns ok + calls onDone (relaunch)', good.ok && onDoneCalls === 1, { good, onDoneCalls });
  check('no stale -wal/-shm beside the restored DB', !fs.existsSync(live + '-wal') && !fs.existsSync(live + '-shm'));
  check('pre-restore snapshot kept (reversible)', fs.existsSync(path.join(dir, 'pre-restore')) && fs.readdirSync(path.join(dir, 'pre-restore')).length === 1);

  // Re-open the restored DB — it should be the pre-mutation state (1 card).
  db.init(live);
  const cards = db.listCards();
  check('restored DB is the backed-up state (1 card, the original)', cards.length === 1 && cards[0].id === 'card-original', cards.map(c => c.id));
  db.close();

  // ── prune keeps only N ────────────────────────────────────────────────────
  for (let i = 0; i < 15; i++) fs.copyFileSync(goodBackup, path.join(dir, `collection-2023-01-${String(i + 1).padStart(2, '0')}.db`));
  db.init(live);
  const b2 = await backups.backupNow({ db, dir, keep: 10 });
  check('backupNow prunes to keep=10', b2.ok && backups.listBackups(dir).length === 10, backups.listBackups(dir).length);
  db.close();

  try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  console.log(failures ? `\n${failures} FAILURES` : '\nAll backup/restore smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASHED:', e); process.exit(1); });
