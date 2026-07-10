// Bridge between Electron main process and the renderer.
// The renderer sees this as `window.api.*` — no direct Node access.
const { contextBridge, ipcRenderer } = require('electron');

const inv = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  cards: {
    list:           ()             => inv('cards:list'),
    bulkUpsert:     (cards)        => inv('cards:bulkUpsert', cards),
    remove:         (id)           => inv('cards:delete', id),
    updateScryfall: (id, sid)      => inv('cards:updateScry', id, sid),
    clear:          ()             => inv('cards:clear'),
  },
  sealed: {
    list:    ()      => inv('sealed:list'),
    upsert:  (item)  => inv('sealed:upsert', item),
    remove:  (id)    => inv('sealed:delete', id),
    replace: (items) => inv('sealed:replace', items),
    clear:   ()      => inv('sealed:clear'),
  },
  wantlist: {
    list:    ()      => inv('wantlist:list'),
    replace: (items) => inv('wantlist:replace', items),
  },
  decks: {
    list:    ()      => inv('decks:list'),
    upsert:  (deck)  => inv('decks:upsert', deck),
    remove:  (id)    => inv('decks:delete', id),
    clear:   ()      => inv('decks:clear'),
  },
  prices: {
    getCurrent:  (sid, foil) => inv('prices:getCurrent', sid, foil),
    history:     (sid, foil) => inv('prices:history', sid, foil),
    bulkStore:   (snaps)     => inv('prices:bulkStore', snaps),
    all:         ()          => inv('prices:all'),
    clear:       ()          => inv('prices:clear'),
  },
  portfolio: {
    record:  (snap) => inv('portfolio:record', snap),
    list:    ()     => inv('portfolio:list'),
  },
  metadata: {
    bulkUpsert:  (entries)   => inv('metadata:bulkUpsert', entries),
    all:         ()          => inv('metadata:all'),
    clear:       ()          => inv('metadata:clear'),
  },
  data: {
    reset:       ()          => inv('data:reset'),
  },
  failures: {
    list:    ()      => inv('failures:list'),
    replace: (fails) => inv('failures:replace', fails),
  },
  settings: {
    get:  (key)     => inv('settings:get', key),
    set:  (k, v)    => inv('settings:set', k, v),
    all:  ()        => inv('settings:all'),
  },
  sl: {
    replace:  (dc, std, stn, products)  => inv('sl:replace', dc, std, stn, products),
    get:      ()                        => inv('sl:get'),
  },
  precons: {
    list:    ()      => inv('precon:list'),
    cards:   ()      => inv('precon:cards'),
    upsert:  (decks) => inv('precon:upsert', decks),
  },
  bulk: {
    ensure:  (force) => inv('bulk:ensure', force),
    lookup:  (ids)   => inv('bulk:lookup', ids),
    status:  ()      => inv('bulk:status'),
  },
  backups: {
    list:       ()  => inv('backups:list'),
    restore:    (p) => inv('backups:restore', p),
    createNow:  ()  => inv('backups:createNow'),
    openFolder: ()  => inv('backups:openFolder'),
  },
  dialog: {
    openCsv:   ()      => inv('dialog:openCsv'),
    openDeck:  ()      => inv('dialog:openDeck'),
    openJson:  ()      => inv('dialog:openJson'),
    saveJson:  (json)  => inv('dialog:saveJson', json),
    saveFile:  (opts)  => inv('dialog:saveFile', opts),
  },
  net: {
    fetch: (url, opts) => inv('net:fetch', url, opts),
  },
  app: {
    dbPath:        ()       => inv('app:dbPath'),
    openExternal:  (url)    => inv('app:openExternal', url),
    version:       ()       => inv('app:version'),
    channel:       ()       => inv('app:channel'),
    backupHealth:  ()       => inv('app:backupHealth'),
    platform:      process.platform,
  },
  updater: {
    check:    () => inv('updater:check'),
    download: () => inv('updater:download'),
    install:  () => inv('updater:install'),
    onEvent:  (handler) => ipcRenderer.on('updater:event', (_e, msg) => handler(msg)),
  },
  // Listen for menu actions from the native menu bar
  onMenuAction:    (handler) => ipcRenderer.on('menu:action', (_e, action) => handler(action)),
});
