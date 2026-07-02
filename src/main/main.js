const { app, BrowserWindow, Menu, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs   = require('fs');
const db   = require('./db');
const { autoUpdater } = require('electron-updater');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

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
        { label: 'Check for Updates…', click: () => sendMenu('updates:check') },
        { label: 'About Secret Lair Tracker', click: () => sendMenu('about:show') },
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
  if (isDev) return;
  setTimeout(() => runUpdateCheck('startup'), 8000);
  setInterval(() => runUpdateCheck('periodic'), UPDATE_RECHECK_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
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

  Menu.setApplicationMenu(buildMenu());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// Hosts the renderer is allowed to reach through net:fetch. The main process
// has no CORS, so this replaces the third-party proxy fallbacks (corsproxy,
// allorigins) the renderer used to need — and keeps API keys first-party.
const ALLOWED_FETCH_HOSTS = new Set([
  'api.scryfall.com',
  'mtgjson.com',
  'tcgcsv.com',
  'www.pricecharting.com',
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
        'User-Agent': `SecretLairTracker/${app.getVersion()}`,
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
  });
  ipcMain.handle('app:version',        () => app.getVersion());
  ipcMain.handle('app:backupHealth',   () => backupHealth);

  // Updater
  ipcMain.handle('updater:check', async () => {
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
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
  ipcMain.handle('updater:install', () => {
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
