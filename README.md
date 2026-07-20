# Mana Ledger

*(formerly Secret Lair Tracker — same app, same data; renamed for storefront release since "Secret Lair" is a Wizards of the Coast trademark)*

**A financial and reference terminal for Magic: The Gathering — built around Secret Lair drops and preconstructed decks.** Track what you own, what it's worth, and whether it paid off, with depth that general collection trackers don't touch. Local-first: your data lives in a single SQLite file on your machine, backed up automatically. Windows desktop app (Electron).

Most trackers treat a Secret Lair as just another set code and a precon as a pile of loose printings. This one models the **drop** and the **deck** as first-class things with a purchase price and a knowable value — so it can answer questions nothing else does: *Which drops made money? Should I crack this sealed one or keep it? Is the new drop worth buying at MSRP? What am I missing from a deck I'm building?*

## What it does

- **Card Collection** — Table + Gallery views over your binders, with filters, dual pricing (Scryfall low + TCGplayer market), Δ price, sparklines, sold/realized-gains tracking, hover previews everywhere, and exact-printing acquisition directly from live search.
- **Secret Lair Explorer** — every SL drop and superdrop, **finish-aware** (non-foil, Foil Edition, Rainbow Foil are distinct SKUs with their own ownership and value). Per-drop **P&L** (MSRP paid → current value → gain), a **crack-or-keep** verdict on sealed drops, the **📈 Index** (your SL holdings as an asset class), completion bars, exclusive bonus-card context, and upcoming/official-announcement strips. Each source has an independently validated last-known-good cache.
- **Precon Explorer** — every physical preconstructed deck ever sold (1993→today): Commander precons, Challenger/Duel/Theme/Intro/Planeswalker decks, Guild Kits, and more. Browse product line → deck → full decklist (Gallery or sortable Table view), finish-aware ownership, a **"Worth it?"** panel (assumed MSRP vs. singles vs. sealed market), and one-click "want the missing cards."
- **Global search** — type a card name and see **everywhere it lives**: your binders, decks that play it, SL drops and precons that include it, and sealed products that contain it. Plus live catalog search across Scryfall & TCGCSV in pinned, comparable result tabs, with one-click entry into the owned-card flow.
- **Decks** — played lists with format legality, Moxfield/Archidekt/ManaBox/MTGA import/export, ownership filters, and missing-card actions (buy on TCGplayer, add to want list). Deck value never counts toward collection value.
- **Want List** — cards to acquire with per-card target prices; price-watch flags anything at/under target after a refresh.
- **Dashboard** — drag/resize Svelte panels: value over time, realized gains, the SL Index, top movers, value-by-binder/color/type/mana/rarity/set, and more.
- **Failed Lookups** — pricing failures grouped by reason with one-click retry.

## Trust & data

- **Local-first.** Everything is a single SQLite file at `%APPDATA%\secret-lair-tracker\collection.db`. No account, no cloud, no telemetry.
- **Automatic backups.** A verified backup is written daily (latest 10 kept). **Settings → Backups & Recovery** restores any of them in one click — it checks the backup is healthy, sets your current data aside first (so a restore is reversible), and restarts.
- **First-run welcome** walks a new install through importing a collection (ManaBox / Moxfield / Archidekt CSV).
- **Repeat-import safety.** ManaBox CSVs can merge normally or explicitly reconcile only ManaBox-managed rows after an add/update/remove preview; manual cards and sold history are left alone.
- **Fast, resilient pricing.** An optional daily Scryfall bulk download prices everything locally (no rate limits). Every external source degrades gracefully — if one is down or changes shape, the app keeps its last-good/baked data instead of crashing.
- **Security.** Sandboxed renderer, context isolation, all network through a main-process host allowlist, a Content-Security-Policy, and sanitization of imported (untrusted) text.

## Data sources

All fetched through the main process (host-allowlisted `net:fetch` IPC — no CORS proxies, keys stay first-party):

- **[MTGJSON](https://mtgjson.com/)** — the relational Secret Lair product/content spine: sealed SKU and every marketplace identifier → deck → exact card UUID/Scryfall ID/count/finish; also the precon catalog
- **[Scryfall](https://scryfall.com/docs/api)** — exact printing metadata, finishes, USD/EUR card prices, art/artist/promo fields, images, oracle data, and daily bulk data
- **[TCGCSV](https://tcgcsv.com/)** — exact TCGplayer product-ID joins plus sealed market/low/mid/high/direct-low, subtype, product, presale, and group metadata
- **[mtg.wiki](https://mtg.wiki/)** — superdrop grouping, dates, nonfoil/foil MSRP, upcoming drops, and the separate bonus-card/variant/exclusivity catalog
- **[Wizards announcements](https://magic.wizards.com/en/news/announcements?search=Secret+Lair)** — official recent sale windows, stated USD prices, bundles, promotions, and WPN/store notes
- **[PriceCharting](https://www.pricecharting.com/api-documentation)** *(optional)* — a second current sealed estimate using the user's paid API token

See [Secret Lair Data — Final Model](./Secret%20Lair%20Data%20%E2%80%94%20Final%20Model.md) for the complete source contract, schema, reconciliation rules, failure behavior, and limitations. The same user-facing overview is built into **Help → Secret Lair Data Guide**.

## Project structure

```
src/
├── main/            # Electron main process (Node)
│   ├── main.js      # window, menu, IPC, net:fetch allowlist, backups, updater
│   ├── db.js        # SQLite layer (better-sqlite3) + schema migrations
│   ├── backups.js   # list / verified backup / one-click restore
│   ├── bulkData.js  # Scryfall bulk-data engine
│   └── schema.sql
├── preload.js       # contextBridge — window.api (IPC only)
├── renderer/
│   ├── index.html   # shell + CSP; loads secretlair.js + Vite bundles
│   ├── styles.css
│   ├── secretlair.js        # baked Secret Lair dataset (generated) + runtime
│   └── dist/                # Vite output (do not edit)
├── renderer-js/     # the renderer, ~35 ES modules (Vite-bundled)
│                    #   slData/slTab/slWiki, preconData/preconTab, search,
│                    #   prices, cardsTab, decks, wantlist, firstRun, settings…
└── renderer-svelte/ # the drag/resize dashboard (Svelte)

scripts/
├── sl-build/        # regenerate the baked Secret Lair dataset from source
├── precon-build/    # build the baked precon catalog from MTGJSON
├── smoke-*.js       # integration smoke tests (import the real modules)
└── release.js       # version bump + tag
test/                # Vitest unit tests (pure modules)
```

## Development

```sh
npm install
npm start                  # build renderer + launch
npm run dev                # + devtools
npm test                   # vitest unit tests
npm run test:smoke         # renderer smoke suite
npm run build              # Windows installer → dist/
npm run release:tag -- minor   # bump + tag; CI builds & publishes the installer
```

Releases are gated: CI runs the full unit + smoke suite before it will build and publish an installer, so a failing test can't ship.

If `better-sqlite3` fails to install (no Visual Studio C++ Build Tools):

```sh
npm install --ignore-scripts
npx @electron/rebuild -f -w better-sqlite3
node node_modules/electron/install.js
```

## Privacy

Mana Ledger collects **nothing**. There is no account, no telemetry, no analytics, and no
crash reporting service. Your collection lives in a single SQLite file on your own machine
and never leaves it. The only network traffic the app produces is fetching public card data
and prices (Scryfall, MTGJSON, TCGCSV, mtg.wiki, public Wizards announcements, and — only if you add your own paid token —
PriceCharting); these requests carry no personal information. Checking for updates contacts
GitHub (or is handled by Steam on the Steam build). Feedback is only ever sent when you
explicitly write and submit it yourself, and contains only what you typed.

## License

ISC
