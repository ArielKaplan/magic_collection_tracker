const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net, screen, clipboard } = require('electron');
const path = require('path');
const fs   = require('fs');
const db   = require('./db');
const bulkData = require('./bulkData');
const backups = require('./backups');
const { autoUpdater } = require('electron-updater');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

// Distribution channel — baked into the packaged package.json at build time
// (electron-builder --config.extraMetadata.slChannel=steam, see build:steam).
// 'github' (default) self-updates from GitHub Releases; any other channel
// (e.g. 'steam') never touches electron-updater — the store owns updating,
// and a self-update would break its file verification.
const CHANNEL = require('../../package.json').slChannel || 'github';
const SELF_UPDATES = CHANNEL === 'github';

// Donations are the sanctioned money path for MTG fan content (WotC Fan
// Content Policy allows donations/sponsorships; selling is not allowed).
const KOFI_URL = 'https://ko-fi.com/sarcasticsoftware';
const FEEDBACK_EMAIL = 'sarcasticsoftwarestudio@gmail.com';
// Web3Forms access key for in-app feedback delivery (email relay, no server).
// Public-by-design (it can only send mail TO our address); rotate on the
// Web3Forms dashboard if it ever attracts spam. Empty = in-app send disabled;
// the feedback modal falls back to the open-your-email-app flow.
const FEEDBACK_RELAY_KEY = 'b99dc757-aca5-48b8-9eeb-f61312489b15';

// ── Crash guard ──────────────────────────────────────────────────────────────
// A stranger's crash should end in a dialog with a feedback path, not a
// silent exit or a dead white window. Data is safe either way: SQLite +
// daily verified backups live on disk.
let crashDialogShown = false;
function showCrashDialog(message, detail) {
  if (crashDialogShown) return 2;
  crashDialogShown = true;
  try {
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Mana Ledger',
      message,
      detail: `Your collection is not damaged — the database and daily backups are safe on disk.\n\nIf this keeps happening, choose "Copy details" and email them to ${FEEDBACK_EMAIL}.\n\n${String(detail || '').slice(0, 1200)}`,
      buttons: ['Restart Mana Ledger', 'Copy details && close', 'Close'],
      defaultId: 0, cancelId: 2, noLink: true,
    });
    if (choice === 1) {
      try { clipboard.writeText(`Mana Ledger v${app.getVersion()} crash report\n\n${message}\n\n${detail}`); } catch { /* clipboard is best-effort */ }
    }
    return choice;
  } catch { return 2; }
}

process.on('uncaughtException', (err) => {
  console.error('[crash] uncaught exception in main:', err);
  try { db.close(); } catch { /* may not be open yet */ }
  const choice = showCrashDialog('Mana Ledger hit an unexpected error.', err && (err.stack || err.message) || String(err));
  if (choice === 0) app.relaunch();
  app.exit(1);
});

// Test/portable hook: point the whole profile (DB, backups, bulk cache, the
// single-instance lock) at a custom directory, so a fresh-install run can
// coexist with the real one:  "Mana Ledger.exe" --user-data-dir=D:\tmp\slt
// Must run before the single-instance lock and before anything touches userData.
const udArg = process.argv.find(a => a.startsWith('--user-data-dir='));
if (udArg) {
  const dir = udArg.slice('--user-data-dir='.length).replace(/^"+|"+$/g, '');
  if (dir) app.setPath('userData', path.resolve(dir));
}

// electron-updater: we drive everything from the UI, no auto downloads
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function sendUpdater(event, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('updater:event', { event, payload });
  }
}

autoUpdater.on('checking-for-update', () => sendUpdater('checking'));
autoUpdater.on('update-available',    (info) => sendUpdater('available',     { version: info.version, releaseNotes: info.releaseNotes, releaseDate: info.releaseDate }));
autoUpdater.on('update-not-available',(info) => sendUpdater('not-available', { version: info.version }));
autoUpdater.on('error',               (err)  => sendUpdater('error',         { message: err == null ? 'unknown' : (err.stack || err.message || String(err)) }));
autoUpdater.on('download-progress',   (p)    => sendUpdater('progress',      { percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total }));
autoUpdater.on('update-downloaded',   (info) => sendUpdater('downloaded',    { version: info.version }));

// Helper: send a menu action to the renderer
function sendMenu(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('menu:action', action);
  }
}

function buildMenu() {
  const tabItem = (label, idx, accelerator) => ({
    label, accelerator, click: () => sendMenu(`tab:${idx}`),
  });

  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'Import…',            accelerator: 'CmdOrCtrl+I', click: () => sendMenu('import:hub') },
        { label: 'Import Deck…',       accelerator: 'CmdOrCtrl+D', click: () => sendMenu('import:deck') },
        { type: 'separator' },
        { label: 'Load Collection (JSON)…', accelerator: 'CmdOrCtrl+O', click: () => sendMenu('import:json') },
        { label: 'Save Collection…',   accelerator: 'CmdOrCtrl+S', click: () => sendMenu('export:json') },
        { type: 'separator' },
        { label: 'Reset Database…',    click: () => sendMenu('settings:reset') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        tabItem('Dashboard',                'dashboard',  'CmdOrCtrl+1'),
        tabItem('Card Collection',          'cards',      'CmdOrCtrl+2'),
        tabItem('Sealed Collection',        'sealed',     'CmdOrCtrl+3'),
        tabItem('Secret Lair Explorer',     'slviewer',   'CmdOrCtrl+5'),
        tabItem('Failed Lookups',           'failures',   'CmdOrCtrl+6'),
        tabItem('Decks',                    'decks',      'CmdOrCtrl+7'),
        tabItem('Precon Explorer',          'precons',    'CmdOrCtrl+9'),
        tabItem('Want List',                'wantlist',   'CmdOrCtrl+8'),
        { type: 'separator' },
        { label: 'Toggle Activity Log', accelerator: 'CmdOrCtrl+L', click: () => sendMenu('logs:toggle') },
        { type: 'separator' },
        { role: 'reload',           accelerator: 'CmdOrCtrl+R' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Tools',
      submenu: [
        { label: 'Refresh Prices',        accelerator: 'F5',          click: () => sendMenu('refresh:prices') },
        { label: 'Check for New SL Cards…',  click: () => sendMenu('refresh:sl') },
        { type: 'separator' },
        { label: 'Settings…',             accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings:open') },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open Database Folder', click: () => shell.openPath(app.getPath('userData')) },
        ...(SELF_UPDATES ? [{ label: 'Check for Updates…', click: () => sendMenu('updates:check') }] : []),
        { label: 'Keyboard Shortcuts', click: () => sendMenu('shortcuts:show') },
        { type: 'separator' },
        { label: '♥ Support Mana Ledger', click: () => shell.openExternal(KOFI_URL) },
        { label: '💬 Send Feedback…', click: () => sendMenu('feedback:show') },
        { label: 'About Mana Ledger', click: () => sendMenu('about:show') },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

function dbPath() {
  // %APPDATA%/Secret Lair Tracker/collection.db on Windows
  const dir = path.join(app.getPath('userData'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'collection.db');
}

// Silent background checks: shortly after launch, then every few hours so a
// long-running session still notices a release. Notifies the renderer if an
// update is available (it shows the top-bar pill); no download until the user
// clicks. Network errors shouldn't disrupt the user, so they're logged only.
const UPDATE_RECHECK_MS = 3 * 60 * 60 * 1000; // 3 hours
function runUpdateCheck(reason) {
  autoUpdater.checkForUpdates().catch((err) => {
    console.warn(`[updater] ${reason} check failed:`, err && err.message);
  });
}
function scheduleStartupUpdateCheck() {
  if (isDev || !SELF_UPDATES) return;
  setTimeout(() => runUpdateCheck('startup'), 8000);
  setInterval(() => runUpdateCheck('periodic'), UPDATE_RECHECK_MS);
}

function createWindow() {
  // Restore the last window geometry (only when it still lands on a live
  // display — a disconnected monitor must not strand the window off-screen).
  let saved = null;
  try {
    const raw = JSON.parse(db.getSetting('window_bounds') || 'null');
    if (raw && raw.width >= 1024 && raw.height >= 700 && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      const wa = screen.getDisplayMatching(raw).workArea;
      const overlapsX = raw.x < wa.x + wa.width - 80 && raw.x + raw.width > wa.x + 80;
      const overlapsY = raw.y >= wa.y - 20 && raw.y < wa.y + wa.height - 80;
      if (overlapsX && overlapsY) saved = raw;
    }
  } catch { /* fresh profile or malformed — use defaults */ }

  mainWindow = new BrowserWindow({
    width: saved ? saved.width : 1400,
    height: saved ? saved.height : 900,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#131118',
    icon: path.join(__dirname, '..', 'renderer', 'favicon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (saved && saved.maximized) mainWindow.maximize();

  Menu.setApplicationMenu(buildMenu());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  // Persist geometry on close (normal bounds, so un-maximizing later restores
  // the real size rather than the maximized one).
  mainWindow.on('close', () => {
    try {
      const b = mainWindow.getNormalBounds();
      db.setSetting('window_bounds', JSON.stringify({ ...b, maximized: mainWindow.isMaximized() }));
    } catch { /* best effort */ }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Renderer death (GPU fault, OOM, …) — offer a restart instead of a dead
// white window.
app.on('render-process-gone', (_e, _wc, details) => {
  if (details.reason === 'clean-exit') return;
  console.error('[crash] renderer gone:', details.reason);
  const choice = showCrashDialog(`Mana Ledger's window crashed (${details.reason}).`, `Renderer process gone: ${JSON.stringify(details)}`);
  crashDialogShown = false; // recoverable — future incidents may dialog again
  if (choice === 0) app.relaunch();
  app.exit(1);
});

// Hosts the renderer is allowed to reach through net:fetch. The main process
// has no CORS, so this replaces the third-party proxy fallbacks (corsproxy,
// allorigins) the renderer used to need — and keeps API keys first-party.
const ALLOWED_FETCH_HOSTS = new Set([
  'api.scryfall.com',
  'mtgjson.com',
  'tcgcsv.com',
  'www.pricecharting.com',
  'mtg.wiki',           // Drop Series table: superdrop grouping + per-drop MSRPs + upcoming drops
]);

// ── IPC handlers ─────────────────────────────────────────────────────────────
function registerIpc() {
  // Network proxy for the renderer — validates host, returns body as text.
  ipcMain.handle('net:fetch', async (_e, url, opts) => {
    let parsed;
    try { parsed = new URL(url); } catch { return { ok: false, status: 0, error: `Invalid URL: ${url}` }; }
    if (parsed.protocol !== 'https:' || !ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
      return { ok: false, status: 0, error: `Host not allowed: ${parsed.hostname}` };
    }
    try {
      // net.fetch uses the Chromium network stack — APIs that reject bare
      // Node/undici requests (Scryfall, Cloudflare-fronted hosts) accept it.
      const headers = {
        'User-Agent': `ManaLedger/${app.getVersion()} (https://github.com/sarcasticsoftwarestudio/mana-ledger)`,
        'Accept': 'application/json',
        ...(opts?.headers || {}),
      };
      const resp = await net.fetch(url, {
        method: opts?.method || 'GET',
        headers,
        body: opts?.body || undefined,
      });
      const text = await resp.text();
      return { ok: resp.ok, status: resp.status, text };
    } catch (err) {
      return { ok: false, status: 0, error: err.message || String(err) };
    }
  });

  // Cards
  ipcMain.handle('cards:list',         ()              => db.listCards());
  ipcMain.handle('cards:bulkUpsert',   (_e, cards)     => db.bulkUpsertCards(cards));
  ipcMain.handle('cards:replaceManaged', (_e, cards)   => db.replaceManagedCards(cards));
  ipcMain.handle('cards:delete',       (_e, id)        => db.deleteCard(id));
  ipcMain.handle('cards:updateScry',   (_e, id, sid)   => db.updateCardScryfallId(id, sid));

  // Sealed
  ipcMain.handle('sealed:list',        ()              => db.listSealed());
  ipcMain.handle('sealed:upsert',      (_e, item)      => db.upsertSealed(item));
  ipcMain.handle('sealed:delete',      (_e, id)        => db.deleteSealed(id));
  ipcMain.handle('sealed:replace',     (_e, items)     => db.replaceSealed(items));

  // Want list
  ipcMain.handle('wantlist:list',      ()              => db.listWantList());
  ipcMain.handle('wantlist:replace',   (_e, items)     => db.replaceWantList(items));

  // Decks
  ipcMain.handle('decks:list',         ()              => db.listDecks());
  ipcMain.handle('decks:upsert',       (_e, deck)      => db.upsertDeck(deck));
  ipcMain.handle('decks:delete',       (_e, id)        => db.deleteDeck(id));
  ipcMain.handle('decks:clear',        ()              => db.clearDecks());

  // Prices
  ipcMain.handle('prices:getCurrent',  (_e, sid, foil) => db.getCurrentPrice(sid, foil));
  ipcMain.handle('prices:history',     (_e, sid, foil) => db.getPriceHistory(sid, foil));
  ipcMain.handle('prices:bulkStore',   (_e, snaps)     => db.bulkStorePrices(snaps));
  ipcMain.handle('prices:all',         ()              => db.getAllPriceHistory());

  // Portfolio snapshots (collection value over time)
  ipcMain.handle('portfolio:record',   (_e, snap)      => db.recordPortfolioSnapshot(snap));
  ipcMain.handle('portfolio:list',     ()              => db.getPortfolioSnapshots());

  // Metadata
  ipcMain.handle('metadata:bulkUpsert', (_e, entries)  => db.bulkUpsertMetadata(entries));
  ipcMain.handle('metadata:all',        ()             => db.getAllMetadata());

  // Failures
  ipcMain.handle('failures:list',       ()             => db.listFailedLookups());
  ipcMain.handle('failures:replace',    (_e, fails)    => db.replaceFailedLookups(fails));

  // Settings
  ipcMain.handle('settings:get',        (_e, key)      => db.getSetting(key));
  ipcMain.handle('settings:set',        (_e, k, v)     => db.setSetting(k, v));
  ipcMain.handle('settings:all',        ()             => db.getAllSettings());

  // SL data
  ipcMain.handle('sl:replace',          (_e, dc, std, stn, products) => db.replaceSlData(dc, std, stn, products));
  ipcMain.handle('sl:get',              ()             => db.getSlData());

  // Precon Explorer catalog
  ipcMain.handle('precon:list',         ()             => db.listPreconDecks());
  ipcMain.handle('precon:cards',        ()             => db.listPreconDeckCards());
  ipcMain.handle('precon:upsert',       (_e, decks)    => db.upsertPreconDecks(decks));

  // Scryfall bulk-data engine — daily download in main, instant lookups after
  ipcMain.handle('bulk:ensure',         (_e, force)    => bulkData.ensureFresh(force, msg => console.log('[bulk]', msg)));
  ipcMain.handle('bulk:lookup',         (_e, ids)      => bulkData.lookup(ids));
  ipcMain.handle('bulk:cheapestByNames', (_e, names)   => bulkData.cheapestByNames(names));
  ipcMain.handle('bulk:status',         ()             => bulkData.status());

  // Backups & recovery — list, restore (relaunches), back up now, open folder
  ipcMain.handle('backups:list',        ()             => listBackups());
  ipcMain.handle('backups:restore',     (_e, p)        => restoreBackup(p));
  ipcMain.handle('backups:createNow',   ()             => backupNow());
  ipcMain.handle('backups:openFolder',  ()             => { const d = backupsDir(); fs.mkdirSync(d, { recursive: true }); return shell.openPath(d); });

  // File dialogs
  ipcMain.handle('dialog:openCsv', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import ManaBox CSV',
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = fs.readFileSync(res.filePaths[0], 'utf-8');
    return { path: res.filePaths[0], text };
  });

  ipcMain.handle('dialog:openJson', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import legacy collection.json',
      filters: [{ name: 'JSON files', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = fs.readFileSync(res.filePaths[0], 'utf-8');
    return { path: res.filePaths[0], text };
  });

  ipcMain.handle('dialog:openDeck', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Import Deck (text or CSV)',
      filters: [
        { name: 'Deck files', extensions: ['txt', 'csv', 'dec', 'dek'] },
        { name: 'All files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });
    if (res.canceled || !res.filePaths[0]) return null;
    const text = fs.readFileSync(res.filePaths[0], 'utf-8');
    return { path: res.filePaths[0], text };
  });

  ipcMain.handle('dialog:saveFile', async (_e, opts) => {
    const { title, defaultPath, filterName, extensions, content } = opts || {};
    const res = await dialog.showSaveDialog({
      title: title || 'Export',
      defaultPath: defaultPath || 'export.txt',
      filters: [{ name: filterName || 'All files', extensions: extensions || ['*'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, content ?? '', 'utf-8');
    return res.filePath;
  });

  ipcMain.handle('dialog:saveJson', async (_e, json) => {
    const res = await dialog.showSaveDialog({
      title: 'Export collection backup',
      defaultPath: 'collection-backup.json',
      filters: [{ name: 'JSON files', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return null;
    fs.writeFileSync(res.filePath, json, 'utf-8');
    return res.filePath;
  });

  // Clear / reset
  ipcMain.handle('cards:clear',    () => db.clearCards());
  ipcMain.handle('sealed:clear',   () => db.clearSealed());
  ipcMain.handle('prices:clear',   () => db.clearPriceHistory());
  ipcMain.handle('metadata:clear', () => db.clearMetadata());
  ipcMain.handle('data:reset',     () => db.resetAll());

  // App info
  ipcMain.handle('app:dbPath',         () => dbPath());
  ipcMain.handle('app:openExternal',   (_e, url) => {
    let parsed;
    try { parsed = new URL(url); } catch { return; }
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return shell.openExternal(url);
    // mailto: allowed ONLY to the feedback address — content can't compose
    // arbitrary mail links through this bridge.
    if (parsed.protocol === 'mailto:' && parsed.pathname === FEEDBACK_EMAIL) return shell.openExternal(url);
  });
  ipcMain.handle('app:version',        () => app.getVersion());
  ipcMain.handle('app:channel',        () => CHANNEL);
  ipcMain.handle('app:backupHealth',   () => backupHealth);

  // Feedback relay — POSTs to Web3Forms (delivers to FEEDBACK_EMAIL) when a
  // key is configured; the renderer falls back to the email-app flow when not.
  ipcMain.handle('feedback:enabled', () => !!FEEDBACK_RELAY_KEY);
  ipcMain.handle('feedback:send', async (_e, message, replyTo) => {
    if (!FEEDBACK_RELAY_KEY) return { ok: false, unconfigured: true };
    if (!message || typeof message !== 'string') return { ok: false, error: 'empty message' };
    try {
      const payload = {
        access_key: FEEDBACK_RELAY_KEY,
        subject: `Mana Ledger v${app.getVersion()} — feedback`,
        from_name: `Mana Ledger v${app.getVersion()} (${CHANNEL})`,
        message: message.slice(0, 8000),
      };
      if (replyTo && typeof replyTo === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo)) payload.email = replyTo;
      const r = await net.fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
      const j = await r.json().catch(() => null);
      return { ok: !!(r.ok && j && j.success) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  // Updater — inert on non-github channels (the store owns updating)
  ipcMain.handle('updater:check', async () => {
    if (!SELF_UPDATES) return { ok: false, channel: CHANNEL };
    if (isDev) {
      sendUpdater('error', { message: 'Update checks are disabled in dev mode. Build an installed copy to test.' });
      return { ok: false, devMode: true };
    }
    try {
      const r = await autoUpdater.checkForUpdates();
      return { ok: true, version: r && r.updateInfo ? r.updateInfo.version : null };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('updater:download', async () => {
    if (!SELF_UPDATES) return { ok: false, channel: CHANNEL };
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('updater:install', () => {
    if (!SELF_UPDATES) return { ok: false, channel: CHANNEL };
    // quitAndInstall(isSilent, isForceRunAfter)
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  });
}

// One backup per calendar day, kept in userData/backups, pruned to the 10
// newest. The collection is years of hand-curation in a single file — this is
// the insurance policy.
//
// Hardened against silent corruption: a corrupt live DB is NEVER backed up and
// NEVER triggers a prune (which would otherwise roll a good backup off the end
// and replace it with a corrupt copy). Freshly written backups are verified
// before older ones are pruned, so every file in the folder is known-good.
const BACKUP_KEEP = 10;

// Surfaced to the renderer on startup (toast + activity log) — null when healthy.
let backupHealth = null;

// Preserve a copy of the corrupt live DB (+ WAL/SHM) for diagnosis / manual
// recovery. Once per day, never pruned (lives in a subfolder).
function quarantineCorruptDb(backupsDir) {
  try {
    const qdir = path.join(backupsDir, 'corrupt');
    if (!fs.existsSync(qdir)) fs.mkdirSync(qdir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const live = dbPath();
    for (const suffix of ['', '-wal', '-shm']) {
      const src = live + suffix;
      const dst = path.join(qdir, `collection-${stamp}.db${suffix}`);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    console.log('[backup] quarantined corrupt DB copy to', qdir);
    return qdir;
  } catch (e) {
    console.warn('[backup] quarantine failed:', e && e.message);
    return null;
  }
}

async function runDailyBackup() {
  try {
    const dir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // 1. Never back up (or prune) from a corrupt live DB.
    const health = db.integrityCheck();
    if (!health.ok) {
      console.warn('[backup] live DB failed integrity_check — skipping backup & prune to protect existing backups:', health.detail);
      quarantineCorruptDb(dir);
      backupHealth = {
        level: 'error',
        message: 'Your collection database failed an integrity check. Today\'s automatic backup was skipped so it can\'t overwrite your good backups, and a copy of the damaged database was set aside. Restore from a recent backup soon.',
        detail: health.detail,
      };
      return;
    }

    // 2. Write today's backup (once/day) and verify it before trusting it.
    const stamp = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `collection-${stamp}.db`);
    if (!fs.existsSync(dest)) {
      await db.backupTo(dest);
      const verify = db.integrityCheckFile(dest);
      if (!verify.ok) {
        console.warn('[backup] freshly written backup failed verification — discarding, not pruning:', verify.detail);
        try { fs.unlinkSync(dest); } catch {}
        backupHealth = {
          level: 'warn',
          message: 'Today\'s automatic backup could not be verified and was discarded. Your existing backups are unchanged.',
          detail: verify.detail,
        };
        return;
      }
      console.log('[backup] wrote + verified', dest);
    }

    // 3. Prune to the newest N — safe now, since every file was verified at write time.
    const files = fs.readdirSync(dir)
      .filter(f => /^collection-\d{4}-\d{2}-\d{2}\.db$/.test(f))
      .sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(dir, files.shift()));
    }
  } catch (err) {
    console.warn('[backup] failed:', err && err.message);
  }
}

const backupsDir = () => path.join(app.getPath('userData'), 'backups');

// Backup list / restore / on-demand backup live in ./backups.js (dependency-
// injected + unit-tested). These thin wrappers supply the live deps.
function listBackups() { return backups.listBackups(backupsDir()); }
function backupNow()   { return backups.backupNow({ db, dir: backupsDir(), keep: BACKUP_KEEP }); }
function restoreBackup(backupPath) {
  return backups.restoreBackup({
    db, live: dbPath(), dir: backupsDir(), backupPath,
    // let the IPC reply flush, then restart into the restored DB
    onDone: () => { app.relaunch(); setTimeout(() => app.exit(0), 250); },
  });
}

// Single-instance lock — CRITICAL for data integrity. Two processes opening the
// same SQLite (WAL) file and both writing corrupts it ("database disk image is
// malformed"); this happened twice. Refuse to start a second copy and instead
// focus the one already running.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    db.init(dbPath());
    bulkData.init(app.getPath('userData'));
    registerIpc();
    createWindow();
    scheduleStartupUpdateCheck();
    runDailyBackup();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Clean shutdown: checkpoint + close the DB so the WAL is flushed and can't be
  // left dangling for a later process to replay. Runs after all windows close.
  app.on('will-quit', () => {
    try { db.close(); } catch (e) { /* best effort */ }
  });
}
