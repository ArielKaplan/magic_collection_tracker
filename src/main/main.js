const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs   = require('fs');
const db   = require('./db');

const isDev = process.argv.includes('--dev');
let mainWindow = null;

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
        { label: 'Import CSV…',        accelerator: 'CmdOrCtrl+I', click: () => sendMenu('import:csv') },
        { label: 'Load Collection…',   accelerator: 'CmdOrCtrl+O', click: () => sendMenu('import:json') },
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
        tabItem('Dashboard',       'dashboard',  'CmdOrCtrl+1'),
        tabItem('Cards',           'cards',      'CmdOrCtrl+2'),
        tabItem('Sealed Product',  'sealed',     'CmdOrCtrl+3'),
        tabItem('Gallery',         'gallery',    'CmdOrCtrl+4'),
        tabItem('Secret Lair',     'slviewer',   'CmdOrCtrl+5'),
        tabItem('Failed Lookups',  'failures',   'CmdOrCtrl+6'),
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
        { label: 'Refresh Secret Lair…',  click: () => sendMenu('refresh:sl') },
        { type: 'separator' },
        { label: 'Settings…',             accelerator: 'CmdOrCtrl+,', click: () => sendMenu('settings:open') },
      ],
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Open Database Folder', click: () => shell.openPath(app.getPath('userData')) },
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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#1a1a30',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(buildMenu());
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ─────────────────────────────────────────────────────────────
function registerIpc() {
  // Cards
  ipcMain.handle('cards:list',         ()              => db.listCards());
  ipcMain.handle('cards:bulkUpsert',   (_e, cards)     => db.bulkUpsertCards(cards));
  ipcMain.handle('cards:delete',       (_e, id)        => db.deleteCard(id));
  ipcMain.handle('cards:updateScry',   (_e, id, sid)   => db.updateCardScryfallId(id, sid));

  // Sealed
  ipcMain.handle('sealed:list',        ()              => db.listSealed());
  ipcMain.handle('sealed:upsert',      (_e, item)      => db.upsertSealed(item));
  ipcMain.handle('sealed:delete',      (_e, id)        => db.deleteSealed(id));

  // Prices
  ipcMain.handle('prices:getCurrent',  (_e, sid, foil) => db.getCurrentPrice(sid, foil));
  ipcMain.handle('prices:history',     (_e, sid, foil) => db.getPriceHistory(sid, foil));
  ipcMain.handle('prices:bulkStore',   (_e, snaps)     => db.bulkStorePrices(snaps));
  ipcMain.handle('prices:all',         ()              => db.getAllPriceHistory());

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
  ipcMain.handle('sl:replace',          (_e, dc, std)  => db.replaceSlData(dc, std));
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
  ipcMain.handle('app:openExternal',   (_e, url) => shell.openExternal(url));
}

app.whenReady().then(() => {
  db.init(dbPath());
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
