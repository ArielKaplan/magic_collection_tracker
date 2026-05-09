# Secret Lair Tracker — Desktop

A Magic: The Gathering collection tracker focused on Secret Lair drops, with sealed-product tracking and per-card price history. Electron + SQLite, single-window desktop app for Windows.

## Features

- **Cards tab** — full collection view with binder/set/CMC/condition filters, sortable columns, per-card price history sparklines
- **Sealed tab** — track sealed products with eBay-API-driven price lookups
- **Gallery tab** — Scryfall image grid for your collection, click into per-card details
- **Secret Lair viewer** — browse all SL drops & superdrops, see ownership progress per drop, click any card for details (fetches Scryfall on the fly for unowned cards)
- **Dashboard** — drag-and-drop reorderable panels covering portfolio value, top movers, value-by-binder/color/type/CMC/rarity/set/year, top 10 most valuable, card of the day
- **Failed Lookups tab** — surfaces Scryfall failures with a filter by reason and a one-click retry for batch errors (useful after a rate-limit hit)
- Native Windows menu bar with keyboard shortcuts (Ctrl+I import, Ctrl+S save, F5 refresh, Ctrl+1-6 to switch tabs, etc.)
- Status bar at bottom with live card count, total value, last-refresh timestamp, autosave state
- SQLite backend stored at `%APPDATA%\secret-lair-tracker\collection.db`

## Tech

- [Electron](https://www.electronjs.org/) shell, [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for storage, [Inter](https://rsms.me/inter/) for type
- [Scryfall API](https://scryfall.com/docs/api) for card prices & images
- [MTGJSON SLD](https://mtgjson.com/api/v5/SLD.json) for Secret Lair drop / card mappings
- [eBay Browse API](https://developer.ebay.com/api-docs/buy/browse/overview.html) for sealed-product pricing (your credentials, set in Settings)

## Project structure

```
src/
├── main/
│   ├── main.js        # Electron main process — window, menu, IPC
│   ├── db.js          # SQLite layer (better-sqlite3)
│   └── schema.sql
├── preload.js         # contextBridge — exposes window.api to renderer
└── renderer/
    ├── index.html
    ├── styles.css
    ├── secretlair.js  # Static SL drop dataset + runtime cache
    └── app.js         # All UI / business logic
```

## Development

```
npm install
npm start          # launches the app in dev mode
npm run build      # produces a Windows installer in dist/
```

If `better-sqlite3` fails to install (typical on systems without Visual Studio C++ Build Tools):

```
npm install --ignore-scripts
npx @electron/rebuild -f -w better-sqlite3
node node_modules/electron/install.js
```

## License

ISC
