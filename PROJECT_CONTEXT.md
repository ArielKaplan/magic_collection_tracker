# Secret Lair Tracker — Project Context

A handoff document for new Claude sessions. Read this first before making changes.
For the June 2026 deep code review, the remediation status of its findings, and the
full product strategy / feature roadmap reasoning, see **REVIEW_AND_ROADMAP.md**.

---

## What this is

A **Windows desktop app** for tracking a Magic: The Gathering collection, with a primary focus on Secret Lair (SLD) drops. Built as an **Electron** shell with the renderer split into **ES modules** (`src/renderer-js/`, Vite-bundled) plus a **Svelte** free-form dashboard. Persistent local storage via **SQLite** (`better-sqlite3`).

Lives at: `C:\Users\Akapl\Documents\Secret Lair Tracker Desktop\`
Git: https://github.com/ArielKaplan/magic_collection_tracker (branch: `main`)
Current version: see `package.json` (0.15.x as of June 2026)

Recent (v0.12–0.15, June 2026): **drop P&L + crack-or-keep shipped** (the headline — 💰 P&L
view in the SL Explorer + per-drop "Singles vs. Sealed" panel; sealed products carry a
`dropName`). v0.15.0 made P&L cost basis default to the flat Secret Lair MSRP (~$29.99/$39.99,
foil-aware, configurable in Settings) and generalized crack-or-keep into Singles-vs-Sealed for
set-completion decisions. Also (v0.12): unowned SL cards show full Scryfall metadata on hover;
Discord-style in-app updater (top-bar pill + "What's New" modal, notes driven from
`CHANGELOG.md`); sealed deletions persist (authoritative `replaceSealed`); corruption-aware
daily backup. See REVIEW_AND_ROADMAP.md handoffs for details. **Next roadmap item: portfolio
snapshots + drop-level completion %.**

The user is a prolific MTG collector tracking thousands of cards (~4,750 entries, 6,200+ copies) across many binders. ManaBox CSV is the source of truth for imports.

There's an **older web app** at `C:\Users\Akapl\Documents\Secret Lair Tracker\` (HTML-only, no Electron). That's the predecessor — don't change it unless explicitly asked.

---

## Tech stack

| Layer | What |
|---|---|
| Shell | Electron 33 (`sandbox: true`, contextIsolation) |
| Main process | Node.js, `better-sqlite3`, `net:fetch` IPC proxy for ALL external HTTP |
| Renderer (most tabs) | Vanilla JS as **28 ES modules** in `src/renderer-js/`, Vite-bundled to `src/renderer/dist/app-main.js` |
| Renderer (Dashboard) | Svelte 4 components in `src/renderer-svelte/`, bundled to `dist/svelte-app.{js,css}` |
| Drag/resize | Interact.js |
| Build/packaging | electron-builder → NSIS installer; GitHub Actions release on `v*` tags |
| Updates | electron-updater against GitHub Releases, driven from Settings UI |
| Storage | SQLite at `%APPDATA%\secret-lair-tracker\collection.db`; daily backups in `backups\` (keeps 10) |

External data sources (all fetched **via the main process** — `net:fetch` IPC with a host allowlist; no CORS, no proxies):
- **Scryfall API** — card prices (`/cards/collection` POST, batched 75 IDs), card metadata, deck-import resolution
- **MTGJSON SLD.json** — Secret Lair drop → card mapping (~15 MB, direct fetch)
- **TCGCSV** — TCGPlayer market prices for cards + sealed product index
- **PriceCharting** — optional sealed pricing, user supplies API key in Settings

---

## File layout

```
src/
├── main/
│   ├── main.js          # Electron main: window, menu, IPC, net:fetch allowlist,
│   │                    # daily DB backup, updater wiring
│   ├── db.js            # SQLite layer (read/write/migrate/backup)
│   └── schema.sql       # cards, sealed, decks, deck_cards, price_history,
│                        # card_metadata, failed_lookups, sl_*, settings
├── preload.js           # contextBridge — window.api (incl. api.net.fetch)
├── renderer/
│   ├── index.html       # Shell: loads secretlair.js (classic) + dist bundles (ESM)
│   ├── styles.css       # All styling — legacy CSS var names are load-bearing
│   ├── secretlair.js    # Static SL hierarchy + runtime cache fns (classic script,
│   │                    # globals consumed by the module bundle)
│   └── dist/            # Vite output — DO NOT edit (app-main.js, svelte-app.{js,css})
└── renderer-js/         # The renderer, split from the old app.js monolith (June 2026)
    ├── main.js          # Entry: imports all modules, exposes exports as window
    │                    # globals (inline onclick + Svelte bridge contract), init()
    ├── state.js         # collection / ui / tcgcsvCache (mutated, never reassigned)
    ├── constants, logger, utils, csv, storage, importWizard, prices,
    ├── statusbar, sealedPricing, analytics, render, ticker, cardsTab,
    ├── gallery, slTab, failures, sealedTab, decks, deckIO, modals,
    ├── productPicker, sealedModals, exportModal, settings, updaterUI, hover
    └── package.json     # {"type":"module"} — scopes ESM so Node can import these

src/renderer-svelte/     # Svelte dashboard (18 panels + custom chart builder)
scripts/                 # smoke tests + release helper (see Verification below)
vite.config.mjs          # Multi-entry build: app-main + svelte-app → renderer/dist
```

### Renderer module conventions (important)

- The split was mechanical (June 2026, `scripts/split-app.js` documents how). Modules
  import each other freely; circular imports exist and are fine (function refs only).
- **Every module export is also exposed as a `window` global** by `main.js` — inline
  `onclick="..."` handlers in rendered HTML and the Svelte panels (`window.app`,
  `window.collection`) depend on this. Don't remove the exposure loop until those are
  migrated to real event wiring.
- `collection`, `ui`, `tcgcsvCache` in `state.js` are **mutated, never reassigned**
  (Svelte's filter swap and the window bridge rely on stable object identity).
- `pendingPriceSnaps` (prices.js) is reassigned only inside prices.js; other modules
  use `takePendingPriceSnaps` / `restorePendingPriceSnaps` / `clearPendingPriceSnaps`.
- `secretlair.js` stays a classic script; modules reference its globals bare.

---

## Tabs (Ctrl+1…7)

1. **Dashboard** — Svelte canvas, 18 drag/resize panels, per-panel binder filter, custom chart builder. Layout in `settings.dashboard_layout_v2`.
2. **Card Collection** — table view: filters, column picker, dual pricing (Scryfall low + TCG market), Δ price, sparklines. Search matches name/set/type/oracle.
3. **Sealed Collection** — sealed products, TCGCSV/PriceCharting lookups, sealed/opened status.
4. **Gallery** — image grid, hover previews.
5. **Secret Lair Explorer** — superdrops → drops → cards, ownership indicators + per-drop owned counts.
6. **Failed Lookups** — pricing failures by reason, retry button for batch errors.
7. **Decks** — played lists, format legality (DECK_FORMATS), Moxfield/Archidekt/ManaBox/MTGA import/export. Deck value NEVER counts toward collection value.

Native chrome: menu bar with accelerators (Ctrl+I import CSV, F5 refresh prices, Ctrl+L activity log, Ctrl+, settings), status bar, slide-in activity log, card hover previews everywhere, right-click context menus on cards/drops/sealed.

---

## Data flow

1. **Import CSV** (Ctrl+I) — ManaBox export through the column-mapping wizard. Dedup on manaboxId + scryfallId + foil.
2. **Refresh Prices** (F5, auto once per day on first open) — Scryfall batches with 429 backoff (2s/4s/8s), then TCGCSV market-price pass. Foil→etched price fallback is load-bearing (don't remove). Deck cards included.
3. **Price persistence is delta-based**: `storePriceSnapshot`/`storeMarketPriceSnapshot` queue new snapshots; `autoSave()` flushes only the queue (restored on failure). autoSave does NOT rewrite price history.
4. **Refresh SL Data** — MTGJSON SLD.json via net:fetch (`json.data.cards`, NOT Object.values), collector-number backfill for foils, stored in SQLite.
5. **Backups** — main process writes `backups/collection-YYYY-MM-DD.db` once per day on launch, prunes to 10. **Corruption-aware (v0.12.2):** `runDailyBackup` runs `PRAGMA integrity_check` first — if the live DB is malformed it skips the backup AND the prune (so a corrupt copy can't roll a good backup off the rotation), quarantines the bad DB to `backups/corrupt/`, and surfaces a warning to the renderer via `app:backupHealth`; freshly written backups are verified before older ones are pruned.

---

## Verification / smoke tests

```powershell
node scripts\smoke-decks.js          # deck parse/validate/stats/export (imports renderer-js modules)
node scripts\smoke-decks-render.js   # Decks tab render functions
$env:ELECTRON_RUN_AS_NODE=1; npx electron scripts\smoke-decks-db.js   # db.js deck round-trip
npx electron scripts\smoke-netfetch.js   # main-process net.fetch against live endpoints
```
Launch with logs: `$env:ELECTRON_ENABLE_LOGGING="1"; npx electron . --dev`

---

## Known quirks / fragile areas

- **Scryfall IDs normalized to lowercase** at every entry point.
- **Foil → etched price fallback** in refreshPrices — hundreds of SLD foils only have `usd_etched`. Don't remove.
- **net:fetch host allowlist** in main.js: api.scryfall.com, mtgjson.com, tcgcsv.com, www.pricecharting.com. New data sources must be added there.
- **Scryfall rate limits**: sustained full-collection refreshes can 429 partway; failures land in Failed Lookups with a working "Retry batch errors" button. Don't run several full refreshes back-to-back.
- **MTGJSON `subsets` is patchy for foils** — collector-number backfill catches most. If "I own X but it's unowned", Refresh SL Data first.
- **Superdrop hierarchy hand-curated** in `secretlair.js` SL_SUPERDROPS (filled through 2026-01). Unmapped drops bucket to "Recent Additions". Planned curation UI not built yet.
- **CSS var names are a load-bearing API** — redefine values, never rename (Svelte panels + inline styles reference them).
- **Native binaries**: better-sqlite3 needs Electron rebuild. If `npm install` fails: `npm install --ignore-scripts`, then `npx @electron/rebuild -f -w better-sqlite3`, then `node node_modules/electron/install.js`.
- **Windows Developer Mode must be ON** for electron-builder winCodeSign cache extraction.
- **PowerShell + git here-strings**: assign the message to `$msg` first, then `git commit -m $msg`.

---

## Working rules / user preferences

These are explicit user-stated preferences. Honor them.

- **Bump `package.json` version on every installer build.** Minor (`0.X.0`) for features, patch for fixes. Own commit titled "Bump version to X.Y.Z".
- **Commit + push to `main` is the default** when user says "commit" or "make it official". `--no-ff` for feature-branch merges.
- **Don't push without being asked.**
- **Windows + PowerShell**, execution policy blocks `.ps1`: prefix `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force`, use `npm.cmd`/`npx.cmd`.
- **Git config**: `user.name = Ariel Kaplan`, `user.email = Ariel.Kaplan@ppfa.org`.
- **Friend-sharing model**: installer never bundles user data; DB persists across upgrades at `%APPDATA%\secret-lair-tracker\collection.db`.

---

## Common tasks

```powershell
npm start                  # build renderer + launch Electron
npm run build              # Windows installer → dist\
npm run build:renderer     # just rebuild dist bundles
npm run release:tag        # tag-based release (GitHub Actions builds installer)
```

Change → what to rebuild:
- **renderer-js or Svelte module** → `npm run build:renderer`, then Ctrl+R in app (or `npm start`)
- **main.js / db.js / preload.js** → restart Electron
- **styles.css / index.html / secretlair.js** → Ctrl+R in app (not bundled)

---

## Roadmap (decided June 2026 — niche-first strategy)

The differentiator is Secret Lair depth, not general collection management. Priorities:

1. **Collection value over time** — `portfolio_snapshots` table, one row per refresh, dashboard line chart.
2. **General "Add card" to collection** — reuse the deck add-card Scryfall search with a binder picker.
3. **SL drop completion %** — surface owned/total on drop tiles (superdrop bars exist already).
4. **Want list + price watch** — wanted flag, Explorer integration, threshold alerts during refresh.
5. **Sold/realized-gains tracking** — `disposed_at` + `sale_price` instead of hard delete.
6. **In-app SL superdrop curation UI** (long-planned) — user-editable hierarchy overriding SL_SUPERDROPS, stored in SQLite.
- Decks is feature-complete; don't expand it.
- Phase 2 of the refactor: vitest for pure modules (csv, deckIO, price fallback, formats). Phase 3: migrate tabs to Svelte one at a time, retiring the window-global bridge.
