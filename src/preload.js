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
    clear:   ()      => inv('sealed:clear'),
  },
  prices: {
    getCurrent:  (sid, foil) => inv('prices:getCurrent', sid, foil),
    history:     (sid, foil) => inv('prices:history', sid, foil),
    bulkStore:   (snaps)     => inv('prices:bulkStore', snaps),
    all:         ()          => inv('prices:all'),
    clear:       ()          => inv('prices:clear'),
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
    replace:  (dc, std, stn)  => inv('sl:replace', dc, std, stn),
    get:      ()              => inv('sl:get'),
  },
  dialog: {
    openCsv:   ()      => inv('dialog:openCsv'),
    openJson:  ()      => inv('dialog:openJson'),
    saveJson:  (json)  => inv('dialog:saveJson', json),
  },
  app: {
    dbPath:        ()       => inv('app:dbPath'),
    openExternal:  (url)    => inv('app:openExternal', url),
    platform:      process.platform,
  },
  // Listen for menu actions from the native menu bar
  onMenuAction:    (handler) => ipcRenderer.on('menu:action', (_e, action) => handler(action)),
});
