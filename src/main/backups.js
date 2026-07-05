// backups.js — backup listing, on-demand backup, and one-click restore.
//
// Dependency-injected (db handle, paths, relaunch fn) so the file-moving logic
// — the data-critical part, run right next to the DB that has corrupted twice —
// can be unit-tested against a temp dir (scripts/smoke-backups.js) instead of
// only in the live app. main.js wires the real deps + Electron relaunch.
//
// The restore sequence follows the hard-won recovery rules: verify the backup
// FIRST, close the live DB cleanly, move the current db + -wal + -shm ASIDE
// together (never leave a stale WAL next to the restored file — SQLite replays
// it), copy the backup into place, then relaunch. Pre-restore state is kept so
// an accidental restore is reversible.

const fs = require('fs');
const path = require('path');

const BACKUP_RE = /^collection-\d{4}-\d{2}-\d{2}\.db$/;

// Newest-first list of the dated daily backups, with size for the UI.
function listBackups(dir) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => BACKUP_RE.test(f))
      .map(f => {
        const p = path.join(dir, f);
        const st = fs.statSync(p);
        return { name: f, date: f.slice(11, 21), path: p, sizeMB: +(st.size / 1024 / 1024).toFixed(1), mtime: st.mtimeMs };
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch { return []; }
}

// Force a verified backup now (same guards as the daily job, minus once-a-day).
async function backupNow({ db, dir, keep }) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const health = db.integrityCheck();
    if (!health.ok) return { ok: false, error: 'The live database failed its integrity check, so no backup was made.' };
    const dest = path.join(dir, `collection-${new Date().toISOString().slice(0, 10)}.db`);
    if (fs.existsSync(dest)) { try { fs.unlinkSync(dest); } catch {} }
    await db.backupTo(dest);
    const verify = db.integrityCheckFile(dest);
    if (!verify.ok) { try { fs.unlinkSync(dest); } catch {}; return { ok: false, error: 'The backup could not be verified and was discarded.' }; }
    const files = fs.readdirSync(dir).filter(f => BACKUP_RE.test(f)).sort();
    while (files.length > keep) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch {} }
    return { ok: true, path: dest, sizeMB: +(fs.statSync(dest).size / 1024 / 1024).toFixed(1) };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Restore `backupPath` over `live`, then call onDone() (the relaunch). Only
// touches paths inside `dir`. Returns { ok } — onDone is invoked ONLY on
// success, so a failed verify/copy leaves the running app on its current DB.
async function restoreBackup({ db, live, dir, backupPath, onDone }) {
  try {
    const resolved = path.resolve(backupPath || '');
    if (!resolved.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(resolved)) {
      return { ok: false, error: 'That backup could not be found.' };
    }
    const verify = db.integrityCheckFile(resolved);
    if (!verify.ok) return { ok: false, error: 'That backup failed its integrity check, so nothing was changed.', detail: verify.detail };

    db.close();   // checkpoint WAL + release the handle so the files can be moved

    const aside = path.join(dir, 'pre-restore', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(aside, { recursive: true });
    for (const suf of ['', '-wal', '-shm']) {
      const f = live + suf;
      if (!fs.existsSync(f)) continue;
      try { fs.renameSync(f, path.join(aside, path.basename(f))); }
      catch { if (suf) { try { fs.unlinkSync(f); } catch {} } }   // a stale wal/shm MUST NOT remain
    }
    fs.copyFileSync(resolved, live);

    if (typeof onDone === 'function') onDone();
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

module.exports = { listBackups, backupNow, restoreBackup, BACKUP_RE };
