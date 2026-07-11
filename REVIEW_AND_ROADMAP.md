# Engineering Review & Strategic Roadmap — June 2026

A point-in-time deep review of this codebase (conducted June 12, 2026 at v0.9.0) and the
product strategy that came out of it. **Read PROJECT_CONTEXT.md first** for current
architecture; this document preserves the reasoning behind the decisions so a new session
can pick up the conversation without re-deriving it.

**Current plan of record:** see **"Journey to 1.0 → Steam → monetization"** (July 9, 2026)
at the bottom of this file — 1.0 stamping, the Steam free-release path, and why the app
can't be sold.

## Status of the review findings

The review below was written against v0.9.0 *before* remediation. Two phases were
implemented immediately after (June 12, 2026), so several findings are **already fixed**:

| Finding | Status |
|---|---|
| autoSave rewrote entire price history on every save | ✅ Fixed — delta saves via `pendingPriceSnaps` queue (prices.js) |
| PriceCharting key / MTGJSON through corsproxy.io & allorigins | ✅ Fixed — main-process `net:fetch` IPC with host allowlist, uses Electron `net.fetch` (Chromium stack; Node fetch gets 400/401 from Scryfall/TCGCSV) |
| No automatic DB backups | ✅ Fixed — daily backup to `userData/backups`, keeps 10 |
| `sandbox: false`, unvalidated `openExternal` | ✅ Fixed |
| ~500 lines dead legacy dashboard (incl. broken `renderBottom10ValueCards`) | ✅ Deleted |
| 6,000-line app.js monolith | ✅ Split into 28 ES modules in `src/renderer-js/`, Vite bundles whole renderer (Phase 1) |
| Stale worktree, stale PROJECT_CONTEXT.md | ✅ Cleaned up / rewritten |
| innerHTML/inline-onclick XSS surface, no CSP | ⚠️ Open — retire incrementally as tabs migrate to Svelte (Phase 3); CSP needs inline handlers gone first |
| No unit tests for pure logic | ⚠️ Open — Phase 2 (vitest on csv, deckIO, price fallback, formats) |
| Window-global bridge between modules / Svelte / inline handlers | ⚠️ Open by design — `src/renderer-js/main.js` exposes all exports on `window`; retire per-tab in Phase 3 |

Phased plan agreed with the owner:
- **Phase 0** (✅ shipped): urgent fixes above.
- **Phase 1** (✅ shipped): module split, whole-renderer Vite build, smoke tests rewritten to import real modules.
- **Phase 2** (next, anytime): vitest for pure modules — csv.js, deckIO.js, the foil→etched
  price-fallback in prices.js, DECK_FORMATS legality. These are the most intricate,
  regression-prone functions; currently only smoke tests cover them.
- **Phase 3** (ongoing, per-tab): migrate tabs to Svelte one at a time (Decks or Sealed
  first — smallest/newest), replacing the window-global bridge with real stores; then add
  a CSP. **Don't rewrite the app**; strangler migration only.

### Update — v0.11.0 (June 13, 2026): two roadmap items handled

Two Secret Lair items shipped in **v0.11.0**: (1) the hand-curated superdrop hierarchy in
`secretlair.js` was **rebuilt from source** (MTGJSON + Scryfall + mtg.wiki) via a new
`scripts/sl-build/` pipeline — fixing the empty 2025+ superdrops and the orphan
"Recent Additions" pile; and (2) a **first cut of the curation UI** (strategy item #4
below) shipped as a *local, per-install* override editor. Full context for resuming cold
in a fresh session is in the **"Session handoff (v0.11.0)"** section at the very bottom of
this file.

---

## The original review (June 12, 2026, v0.9.0)

**TL;DR:** A genuinely good hobby app with real product instincts — the activity log,
failed-lookups tab, foil→etched price fallback, and import wizard show someone who
actually uses the thing and fixed what hurt. But app.js had doubled to 6,067 lines,
the persistence layer had a performance time bomb, and the API key leaked through a
third-party proxy. It didn't need a rewrite — it needed a deliberate strangler
migration, two urgent fixes, and a decision about what the app *is*.

### What's genuinely good

- **The main process is clean.** main.js and db.js are tight, well-commented, properly
  transactional, prepared statements throughout. `contextIsolation: true`,
  `nodeIntegration: false`, a real preload bridge — better Electron hygiene than most
  commercial apps.
- **The schema is sensible.** Dual-source price history with a composite PK, deck cards
  that link-or-placeholder against owned cards, "deck value never counts toward
  collection value" documented *in the schema file*.
- **Operational empathy.** Activity log with categories, failed-lookups tab with retry,
  rate-limit backoff with user-visible countdowns, batch-error vs not-found vs no-price
  distinction. Hobby apps never have this.
- **Domain depth is the moat.** The hand-curated superdrop hierarchy, the etched-foil
  fallback, the collector-number backfill for MTGJSON's patchy subsets — Moxfield and
  ManaBox don't do any of this.

### Architecture assessment

- **SQLite is a mirror, not a database.** The actual data model is one big JSON object in
  renderer memory (`collection`); SQLite is a serialization target. At ~5–10k cards this
  is fine and snappy — acknowledge the choice, stop paying the mirror tax (done: delta
  price saves). The one place SQL should genuinely win is price history (the only
  unbounded table).
- **The renderer was three runtimes taped together**: secretlair.js globals, a 6,067-line
  classic-script monolith rendering via innerHTML strings, and a Svelte dashboard
  reaching back via `window.app.*`. The `window.*` bridge is the structural debt; the
  module split (Phase 1) contains it, Phase 3 retires it.
- **Security posture: good bones, soft interior.** ~31 innerHTML sinks + ~26 inline
  onclick handlers fed by CSV/Scryfall/MTGJSON/TCGCSV data. `esc()`/`escJs()` applied
  diligently, but the pattern fails open — one missed escape = arbitrary JS with full
  `window.api` access (including `data:reset`). A malicious shared CSV is a real (if
  unlikely) vector given the friend-sharing model. Mitigations: the delegated
  data-attribute dispatch pattern (already used for right-click menus) is the model;
  apply to clicks as tabs migrate; CSP once inline handlers are gone.

### Feature recommendations from the review (ranked value-per-effort)

1. **Collection value over time** — ✅ **SHIPPED v0.16.0.** `portfolio_snapshots (date,
   cards_value, sealed_value, cost_basis, card_count)`, one row per *day* (UPSERT — last
   refresh of the day wins), recorded at the end of `refreshPrices`; Dashboard "Value Over
   Time" line chart (total/cards/sealed vs. cost basis). Snapshots accrue going forward —
   no retroactive reconstruction (price_history has survivorship bias).
2. **General "Add card" to collection** — the deck add-cards modal already searches
   Scryfall (`deckIO.js` / `decks.js`); reuse with a binder picker. Closes the "bought
   three singles at the LGS" gap (currently only CSV import / JSON merge / SL Explorer
   right-click can add cards).
3. **SL drop completion %** — superdrop tiles already show owned bars; push down to drop
   tiles ("4/7 owned").
4. **Want list + price watch** — ✅ **SHIPPED v0.17.0.** Want List tab (Ctrl+8) with
   per-card target price; want-list cards join the refresh price-fetch set and
   `checkWantListThresholds()` flags any at/under target (toast + log + green tab badge).
   Populated from the SL Explorer (★ "Add missing to want list" on incomplete drops),
   the card popup, or Scryfall name search; ★ on missing Explorer tiles; dashboard KPI.
   `want_list` table + `wantlist.js`. See the handoff at the bottom.
5. **Sold/realized-gains tracking** — `disposed_at` + `sale_price` instead of hard
   delete; makes cost-basis KPI honest.
6. **Scryfall bulk data option** — one daily `default-cards` download via net:fetch gives
   every price with zero rate limits, deleting the whole 429/backoff/batch-error
   category. Optional; the batch flow works.

Explicitly deferred: multi-currency, condition-based price adjustment, cloud sync —
all large, none serve the "one collector, one machine, deep SL focus" identity.

Retired by the review: legacy dashboard fallback, CORS proxy chains, (incrementally)
the inline-onclick/escJs pattern.

---

## Where to take it — the strategy (agreed June 2026)

The screenshot from the Explorer tab crystallized the thesis: the superdrop tiles
already show **"30/60 owned"** progress bars. The killer feature is half-built and
unnamed.

**The structural insight: this app owns a data asset, not just code.** Moxfield,
Archidekt, and ManaBox treat Secret Lair as just another set code — a flat pile of SLD
printings. The *drop* as a unit of meaning (this card belongs to "City Styles", which
shipped in April Superdrop 2022, which cost $29.99 foil) exists nowhere in their data
models. The hand-curated hierarchy in secretlair.js — maintained through 2026, plus the
collector-number backfill papering over MTGJSON's patchy foil tagging — is tedious,
ongoing curation nobody else is doing. That's exactly what makes it defensible:
software is easy to copy; a maintained dataset isn't.

**What the SL collector wants that nothing provides:** Secret Lair is unique in MTG
because every product has a *known purchase price* (≈$29.99/$39.99 MSRP) and a
*knowable current value* (sum of singles, or sealed market price). Drops are the only
MTG product where per-purchase P&L is naturally computable. The questions an SL
collector asks: *Which drops did I make money on? Should I crack this sealed drop or
keep it? What am I missing from drops I started? Is the new drop worth buying at MSRP?*
No tool answers any of these. This app is four features away from answering all of them:

1. **Drop P&L ledger.** ✅ **SHIPPED v0.13.0** (cost model refined v0.15.0). Per-drop sortable
   ledger (💰 P&L view in the SL Explorer): MSRP paid → current value (owned singles +
   still-sealed copies) → gain/loss $/%, totals, ★ best-buy, per-drop summary banner. **Cost
   basis defaults to the flat SL MSRP** (~$29.99/$39.99, foil-aware, configurable) since drops
   are bought whole; a linked sealed product's real price overrides. The screenshot feature.
2. **Crack-or-keep → Singles vs. Sealed.** ✅ **SHIPPED v0.14.0, generalized v0.15.0.** Drop-detail
   panel compares the drop as singles (on-demand Scryfall fetch) vs as a sealed box (linked
   product or TCGCSV index) — crack-or-keep verdict when held sealed, cheapest-to-complete
   otherwise. *Build-time reality vs. the "mostly a join" framing:* there was no sealed↔drop link
   (added a `dropName` field) and singles prices for unowned cards needed an on-demand fetch.
3. **Drop completion + auto want list.** Drop-level "4/7 owned" tiles, then one-click
   "add missing to want list." A want list with prices turns every incomplete drop into
   a shopping list — and is the natural home for price-threshold alerts during refresh.
4. **The curation UI** (on the roadmap since v0.2) is the *strategic* feature, not a
   chore. **[v0.11.0 — local editing shipped: regroup drops + notes, stored per-install in
   `sl_overrides`. The export/import + community-sync step below is what remains.]** Once
   the hierarchy is user-editable in SQLite, it's exportable JSON: a friend
   imports the curation; later a GitHub-hosted community file becomes the canonical SL
   dataset the app syncs, the way it syncs MTGJSON. At that point the app isn't
   competing with Moxfield — it's the reference tool for a product line WotC ships
   forty times a year.

**Supporting layer:** portfolio snapshots (above) — every P&L feature gets more
compelling with a time axis, and the delta-save plumbing makes it ~100 lines.

**What to consciously NOT do:**
- **Decks is feature-complete.** It's the table-stakes feature that keeps the app
  self-sufficient, not a growth direction.
- **No cloud sync, no accounts, no social.** Local-first single-file SQLite is a
  *feature* for collectors (their data, their machine, daily backups included).
- **Don't chase ManaBox's scanning.** ManaBox is the ingestion pipeline; let it stay one.

**Agreed sequence:**
1. ~~Next release: **portfolio snapshots + drop-level completion**~~ ✅ **SHIPPED.**
   Drop-level completion was already done (landing/drop tiles + drop-detail header all show
   `X / Y owned` + progress bars). Portfolio snapshots shipped **v0.16.0** — see the handoff
   at the bottom.
2. ~~Headline release: **drop P&L + crack-or-keep**~~ ✅ **SHIPPED (v0.13.0 + v0.14.0).**
   The release that makes the app *about* something.
3. Then the **curation UI** export/import + community sync, once the drop views prove
   which hierarchy edits matter (local editing already shipped v0.11.0).
4. Phase 2 (vitest) and Phase 3 (per-tab Svelte migration) run alongside any of it.

← *Top remaining product item: **curation export/import + community sync** (#3 above /
strategy item #4) — local SL editing already shipped v0.11.0; export the `sl_overrides`
blob → friend imports → eventually a GitHub-hosted community SL dataset the app syncs.
Then sold/realized-gains tracking (REVIEW feature #5).*

---

## Session handoff (v0.11.0 — June 13, 2026)

Two June-2026 sessions delivered a Secret Lair data + curation overhaul, shipped as
**v0.11.0** (installer published to GitHub Releases; friends update via Settings → Check
for Updates). Everything below is on `main`. This is the full context to resume cold.
Companion auto-memory notes: `sl-metadata-sourcing.md`, `sl-explorer-next-steps.md`.

### 1. The SL hierarchy is now rebuilt from source (was hand-typed)

The hand-typed superdrop hierarchy in `secretlair.js` had gone stale — 2025/2026
superdrops were empty `drops: []` and unknown drops landed in a "Recent Additions"
orphan pile. It is now **regenerated from three cross-validating sources** by a
one-time/occasional pipeline in **`scripts/sl-build/`** (see its `README.md`):

```
node scripts/sl-build/fetch-sources.js   # download sources -> cache/ (gitignored)
node scripts/sl-build/reconcile.js        # reconcile -> out/superdrops.json + report.md (gitignored)
node scripts/sl-build/emit-secretlair.js  # bake data into src/renderer/secretlair.js
node scripts/sl-build/smoke-secretlair.js # vm-sandbox validation of the baked file
```

- **Sources & roles:** **MTGJSON `SLD.json`** = drop↔cards (each card's `subsets`) +
  collector numbers (authoritative for membership); **Scryfall `set:sld`** = per-card
  `released_at` (dates each drop); **mtg.wiki "Secret Lair/Drop Series"** = the superdrop
  grouping. **Use mtg.wiki, NOT the Fandom wiki** — `mtg.fandom.com` is stale and stops
  end-2024; `mtg.wiki` (MediaWiki API at `mtg.wiki/api.php`) covers 2019→2026 in the same
  parseable wikitext table.
- **What gets baked** into `src/renderer/secretlair.js` (data literals only — the
  generator splices them and leaves the hand-maintained runtime code below untouched):
  `SL_SUPERDROPS` (grouping), `SL_DROP_CARDS`, `SL_SCRYFALL_TO_DROPS`,
  `SL_SCRYFALL_TO_NAME`, and **`SL_SCRYFALL_TO_NUMBER`** (collector numbers — new, powers
  the collector view). Foil/variant backfill (base collector number + name) mirrors the
  live refresh path.
- **Result:** all **353 drops** resolve — **49 named superdrops + 51 standalone drops**,
  0 collisions. 2025–2026 names (PlayStation, Sonic, Marvel's Spider-Man, Avatar,
  Summer/Winter Superdrop 2025, etc.) come straight from mtg.wiki.
- **Maintainer gotcha:** superdrop grouping exists ONLY in the wiki/marketing — never in
  MTGJSON/Scryfall. And dates *within* a superdrop are staggered per drop, so release date
  alone cannot draw superdrop boundaries. So when a new superdrop drops, re-run the
  pipeline once mtg.wiki lists it (or hand-place drops via the editor below in the interim).

### 2. Local curation UI shipped (first cut of strategy item #4)

A **per-install override layer** in `src/renderer-js/slTab.js`, persisted as a JSON blob
in SQLite under settings key **`sl_overrides`** (via `window.api.settings` — no new IPC/DB
schema). Local-only: never shipped, never affects the baked dataset or anyone else's copy.

- **Capabilities:** regroup any drop into a different/new superdrop (free-text `<datalist>`
  combobox — the "Festival in a Box" use case), and attach notes to drops, superdrops, and
  cards. "↺ Reset to sourced" reverts a drop to the baked grouping.
- **Mechanics:** `loadSlOverrides()` runs at startup in renderer `main.js` (right after
  `loadSlDataFromCache()`) and calls `rebuildSlGrouping()`, which recomputes
  `SL_SUPERDROPS` + `SL_DROP_TO_SUPERDROP` = *baseline + overrides*. A one-time baseline
  snapshot (`slBaseHome`/`slBaseDate`) keeps edits reversible and surviving a
  "Check for New Cards" refresh (which also calls `rebuildSlGrouping`).
- **Searchable notes:** Explorer search matches note text at all three levels.
- **"By Collector №" view:** toggle flips the Explorer into a flat gallery of every SLD
  printing in collector-number order — owned/not-owned styling, click-to-modal, searchable
  by number/name/note, **no pagination** (lazy `<img>`), under one **fixed merged toolbar**
  (toggle + search + owned count). Custom sort: plain numerics first (foils/variants
  `1485★`, `633Φ`, `1012a` nestle by their number), letter-prefixed specials
  (`IFIYW-1`, `SCTLR`, `VS`) last. Shared `slCardTile()` helper renders tiles for both views.
- **Relabels:** "Refresh SL Data" → "Check for New Cards" (button + Tools menu); new
  Settings → "Secret Lair Data" section explains built-in vs. local-edit vs. rebuild.

**Remaining strategic step (item #4):** the `sl_overrides` JSON is the seed for
**export/import** → friend imports your curation → eventually a GitHub-hosted community
file the app syncs like MTGJSON. Not built yet.

### What did NOT change — still the priority for the next session

The headline roadmap features are untouched and remain the plan, in order:
1. **Portfolio snapshots + drop-level completion %** (next release — small, visible).
2. **Drop P&L ledger + crack-or-keep** (the headline release — makes the app *about* something).
3. **Want list + price watch.**
4. **Curation export/import + community sync** (now has a concrete foundation in `sl_overrides`).

Phase 2 (vitest) and Phase 3 (per-tab Svelte migration, then CSP) still open. Note: the SL
editor added several inline-`onclick` handlers (`editSlDrop`, `commitSlDrop`, `commitSlNote`,
`resetSlDrop`, …) exposed on `window` via the module-export bridge — consistent with the
existing pattern, but it adds to the inline-handler / window-global surface that Phase 3 retires.

### File map
- **Data + runtime:** `src/renderer/secretlair.js` (data blocks generated; code hand-maintained).
- **Editor + views:** `src/renderer-js/slTab.js`. **Startup hook:** `src/renderer-js/main.js`
  (`loadSlOverrides`). **View state:** `src/renderer-js/state.js` (`slViewer.view`).
  **Settings note:** `src/renderer-js/settings.js`. **Menu label:** `src/main/main.js`.
- **Build pipeline:** `scripts/sl-build/` (+ `README.md`).
- **Release:** `npm run release:tag -- <minor|patch>` (scripts/release.js) bumps + tags +
  pushes; `.github/workflows/release.yml` builds + publishes the installer on the tag.

---

## Session handoff (v0.12.x — June 18, 2026)

A polish/reliability session — no headline roadmap features. Shipped v0.12.0→v0.12.2
(all on `main`, installers published). The four roadmap items above are still the plan
and untouched. What changed:

- **Unowned-card hover (v0.12.0):** SL Explorer tiles for cards you don't own now fetch
  full Scryfall metadata on hover (type, oracle, rarity, artist, price, drop/superdrop,
  "Owned: No") — instant image/name/drop partial, then async upgrade, cached, with a race
  token so a slow fetch can't clobber a newer preview. `src/renderer-js/hover.js`.
- **Discord-style updater (v0.12.0):** top-bar **update pill** (`#update-pill` in index.html)
  → **"What's New" modal** with release notes → one-click download + auto-restart; mirrored
  in Settings. Main process re-checks every 3h + on startup. `src/renderer-js/updaterUI.js`,
  `src/main/main.js`. v0.12.2 fixed the "v?" (current version now fetched at startup in
  `wireUpdateBadge`).
- **Release notes are CHANGELOG-driven (committed, activates next release):** edit
  `CHANGELOG.md` under `## [Unreleased]`; `release.js` promotes it to `## [X.Y.Z] - date`;
  the workflow sets the GitHub release body (and thus the in-app What's New) via
  `scripts/extract-changelog.js`. See RELEASING.md.
- **Sealed persistence (v0.12.1):** deletes now hit the DB (`window.api.sealed.remove`), and
  `autoSave` does an authoritative `replaceSealed` so the table can't drift. Sealed was always
  in `collection.db` (its own table) — NOT merged into cards. `src/main/db.js`, `storage.js`.
- **Corruption-aware backups (v0.12.2):** see PROJECT_CONTEXT Data-flow #5 + the
  `db-corruption-recovery` memory. Triggered by a real June-18 corruption incident, recovered
  from the 06-13 backup (cards/sealed/decks intact; ~5 days of price snapshots lost).
- **New smoke tests:** `scripts/smoke-sealed-db.js`, `scripts/smoke-backup-integrity.js`,
  plus one-off `scripts/db-recovery-*.js`.

Still open, unchanged: Phase 2 (vitest), Phase 3 (per-tab Svelte + CSP) — and the updater +
SL editor keep adding to the inline-`onclick`/window-global surface Phase 3 retires.

## Session handoff (v0.13.0–v0.15.0 — June 18, 2026): headline feature SHIPPED

The **drop P&L + crack-or-keep** headline (strategy items #1–#2 above) is done — the
release set that makes the app *about* per-purchase P&L. All on `main`, installers published
through **v0.15.0**.

- **Drop P&L (v0.13.0):** new **💰 P&L** view in the SL Explorer (third toggle) — sortable
  ledger of drops you've engaged with: MSRP paid vs current value vs gain/loss $/%, totals,
  ★ best-buy, per-drop summary banner. `computeDropPnL`/`sortSlPnl`/`sortPnlRows` in `slTab.js`;
  sort state `ui.slViewer.pnlSort`.
- **The linchpin — sealed↔drop link:** sealed products gained a **`dropName`** column
  (schema + idempotent migration + upsert/replace + an editable "Secret Lair Drop" field on the
  add/edit form, auto-set by `addDropToSealed`). Without this there was no cost-basis join.
- **Crack-or-keep → Singles vs. Sealed (v0.14.0, generalized v0.15.0):** the drop-detail panel
  is now `dropEconomicsBanner` (renamed from `crackOrKeepBanner`). It shows **As singles**
  (`sumDropSingles` over `priceSlDropSingles` — on-demand `fetchScryfallBatch`, deduped per
  name/best finish, cached in a module Map, NOT price history) vs **As sealed box**
  (`sealedPriceForDrop`: a linked product's price, else `searchTcgcsvLocal` best-match from the
  synced TCGCSV index). Verdict = crack-or-keep when held sealed (`sealedKeepValue`, opened
  copies excluded), else cheapest-to-complete for acquisition.
- **Flat-MSRP cost default (v0.15.0):** because SL is bought as whole drops, `computeDropPnL`
  cost basis now defaults to a flat MSRP (`slMsrpDefault(foil)` → `collection.settings.slMsrp{Nonfoil,Foil}`,
  defaults 29.99/39.99, foil auto-detected from owned singles, editable in Settings → "Secret Lair
  P&L"). A linked sealed product's real purchase price overrides it; defaulted costs render with a
  `≈` marker + `costIsDefault` flag. This replaced the old behavior of summing per-single purchase
  prices (which read as misleadingly tiny costs).
- **Tests:** `scripts/smoke-droppnl.js` (P&L math, flat-MSRP/foil/settings defaults, Singles-vs-Sealed aggregation + keep-value).

## Session handoff (v0.16.0 — June 20, 2026): portfolio snapshots SHIPPED

Strategy sequence item **#1 is now fully done.** Its drop-level-completion half was already
shipped (the SL Explorer landing tiles, drop tiles, and drop-detail header all show
`X / Y owned` + progress bars — done during the v0.11/P&L work). This session added the
remaining half: **collection value over time.**

- **Schema:** new `portfolio_snapshots (date PK, cards_value, sealed_value, cost_basis,
  card_count, created_at)` in `src/main/schema.sql`. No migration needed — `db.exec(schema)`
  runs the idempotent `CREATE TABLE IF NOT EXISTS` on every init. Cleared by `resetAll`.
- **DB layer (`src/main/db.js`):** `recordPortfolioSnapshot(snap)` (UPSERT on `date` — the
  day's last refresh wins, so the chart never shows two points for one day),
  `getPortfolioSnapshots()` (camelCased, date-ascending), `clearPortfolioSnapshots()`.
- **IPC/bridge:** `portfolio:record` / `portfolio:list` in `src/main/main.js`;
  `window.api.portfolio.{record,list}` in `preload.js`.
- **Recording (`src/renderer-js/analytics.js`):** `recordPortfolioSnapshot()` computes
  cards value (`totalCardsValue`), sealed value (`totalSealedValue`), `totalCostBasis()`
  (cards+sealed purchase price, mirrors the Cost Basis KPI), and total copies; writes one
  row keyed on the **local** date and keeps `collection.portfolioSnapshots` in sync in
  memory. **Skips** when nothing is priced (no bogus $0 point). Called at the end of
  `refreshPrices` (prices.js) before `render()`. *(Note: analytics.js ↔ prices.js is now a
  circular import — fine, runtime function refs only, per the module conventions.)*
- **Load:** `autoLoad` (storage.js) fetches the series into `collection.portfolioSnapshots`;
  field added to `makeCollection()` in state.js.
- **Dashboard chart:** `src/renderer-svelte/panels/PortfolioHistory.svelte` — a Chart.js
  line chart (total / cards / sealed solid + cost basis dashed), reads
  `window.collection.portfolioSnapshots`, reactive on `collectionVersion` (bumped by
  `render()`). Registered as panel `portfolio-history` ("Value Over Time", `filterable:false`,
  720×300) in `panels.js` and placed first in the content flow of `defaultLayout`.
- **Existing-user visibility:** `Dashboard.svelte`'s layout-merge now appends newly-added
  panel types as `visible: true` (was `false`) so a new panel actually appears for users with
  a saved `dashboard_layout_v2` — realizing the merge comment's stated intent.
- **Tests:** `scripts/smoke-portfolio-db.js` (DB round-trip, daily UPSERT, null fields,
  resetAll) and `scripts/smoke-portfolio.js` (renderer compute/skip/in-memory upsert).
  Verified live: the daily auto-refresh wrote one real snapshot to the user's DB
  (cards ≈ $26.2k, sealed $291.50, cost ≈ $18.5k, 6,269 copies).

**Not yet released:** version still `0.15.0`, the CHANGELOG entry sits under `## [Unreleased]`.
Run `npm run release:tag -- minor` to ship as **v0.16.0** (bumps + promotes changelog + tags +
the workflow builds/publishes the installer + in-app "What's New").

v0.16.0 shipped, then **v0.16.1** fixed the "What's New" modal showing raw HTML release notes
(electron-updater hands the GitHub body over as HTML; the modal had been `esc()`-ing it). Fix:
`sanitizeNotesHtml` in `updaterUI.js` — a tag-allowlist sanitizer (parses into an inert
document, keeps basic formatting tags, drops every attribute except a validated http(s) href,
discards script/style/img/handlers); links route through `window.api.app.openExternal`. Test:
`scripts/smoke-whatsnew.js` (runs the real sanitizer in a Chromium DOM). **Caveat:** release
notes are rendered by the *installed* client, so the fix only takes effect for versions ≥0.16.1.

## Session handoff (v0.17.0 — June 20, 2026): want list + price watch SHIPPED

REVIEW feature **#4 is done** — the want list, woven into the SL Explorer rather than siloed.

- **Schema/DB:** new `want_list (id PK, scryfall_id, name, set_code, set_name,
  collector_number, foil, drop_name, max_price, note, created_at)` in `schema.sql`. `db.js`:
  `listWantList` / `replaceWantList` (authoritative full-replace, mirrors sealed) /
  `clearWantList`; cleared by `resetAll`. IPC `wantlist:list`/`wantlist:replace`,
  `window.api.wantlist.*` in preload. `collection.wantList` in state; loaded in `autoLoad`,
  saved via `replaceWantList` in `autoSave`.
- **Core module `src/renderer-js/wantlist.js`:** add/remove/dedup (by scryfallId, case-insensitive),
  `setWantTarget`, `addSlCardToWantList` (uses the baked `SL_SCRYFALL_TO_*` maps),
  `toggleSlCardWant`, `addDropMissingToWantList` (the incomplete-drop shopping-list flow),
  `wantListSummary` (count / acquireCost / atTarget / withTarget), `checkWantListThresholds`
  (the price-watch — toast + log + badge), `updateWantBadge`, `showWantSearchModal` (Scryfall
  name search), and `renderWantList` (the tab). Exposed on `window` via the main.js loop.
- **Tab:** `wantlist` tab button in `index.html` (id `wantlistTab` for the badge), dispatch +
  `updateWantBadge()` in `render.js`, `ui.wantList` state, Ctrl+8 in the native View menu.
- **Price watch:** want-list `(scryfallId, foil)` pairs join the refresh fetch set in
  `refreshPrices`; a fallback pass backfills a best-available price for foil-only cards stored
  as 'normal'; `checkWantListThresholds()` runs after the snapshot. *(prices.js ↔ wantlist.js
  is another runtime circular import — fine.)*
- **SL Explorer integration (`modals.js`, `slTab.js`):** "★ Add/Remove want list" in the
  missing-card context menu; "★ Add missing to want list (N)" in the drop context menu **and**
  a header button on the drop page; "☆ Add to want list" toggle in the unowned-card popup; a
  gold ★ on missing tiles that are wanted (`.sl-want-badge` / `.sl-card-wanted`). Acquiring a
  card via `addSlCardToCollection` auto-removes it from the want list.
- **Dashboard KPI:** `KpiWantList.svelte` (`kpi-want`, `filterable:false`) — count, cost to
  acquire, at-target; `window.app.wantListSummary` feeds it.
- **Tests:** `scripts/smoke-wantlist-db.js` (DB round-trip, authoritative replace, reset) and
  `scripts/smoke-wantlist.js` (add/dedup/remove, target editing, summary math, threshold
  detection, SL add-missing). Verified the tab live via screenshot (count + cost + "at target"
  header, editable targets, "🎯 hit" rows, green tab badge).

**Reliability fix shipped in the same v0.17.0 set — the repeat DB-corruption root cause.**
`collection.db` hit "database disk image is malformed" twice (06-18, 06-20). Root cause: the app
had **no `app.requestSingleInstanceLock()`** and never closed the DB on quit, so two copies could
open the same WAL file and write concurrently (classic SQLITE_CORRUPT) — and an abrupt kill mid-write
left a dangling WAL. Fixes (main.js + db.js): single-instance lock (`second-instance` focuses the
existing window); `will-quit` → `db.close()` (`wal_checkpoint(TRUNCATE)` + close, so no dangling WAL);
`busy_timeout=5000` + `synchronous=FULL`. Verified live: a 2nd instance exits in ~1s without opening
the DB; after a graceful close the `-wal`/`-shm` are gone (checkpointed in) and integrity = ok. The
06-20 incident was recovered by restoring the verified-clean same-day backup (see the
`db-corruption-recovery` memory — **kill all electron + close gracefully before any restore; never
force-kill**). 06-18 and 06-20 malformed backups sit in `backups/` (06-13/06-12/06-20 are clean).

**Not yet released:** version still `0.16.1`, CHANGELOG entry under `## [Unreleased]`. Run
`npm run release:tag -- minor` to ship as **v0.17.0**.

Next remaining product roadmap item is the **curation UI export/import + community sync**
(local SL editing shipped v0.11.0; export the `sl_overrides` blob → import → GitHub-hosted
community SL dataset). Then sold/realized-gains tracking (REVIEW #5). Phase 2 (vitest) /
Phase 3 (Svelte + CSP) still open; this work added more inline-`onclick`/window-global surface
(the want-list table + context-menu entries) that Phase 3 retires.

---

# Journey to 1.0 → Steam → monetization (July 9, 2026)

Assessment + agreed plan from the July 9 session, written against **v0.37.0**. This section
is the reference for "what sits between here and a public release." (Everything between
v0.17 and v0.37 — realized gains, SL Index, finish-aware data model, Precon Explorer,
left-rail shell, global search, CSP/inline-handler retirement — shipped without handoffs
in this file; see CHANGELOG.md and the auto-memory notes.)

## 1.0 status: the app is there — stamp it

All six definition-of-done criteria (agreed 2026-07-05) are shipped as of v0.35–v0.37:

1. First-run onboarding (`firstRun.js` welcome → import/restore/skip)
2. One-click verified backup restore (Settings → Backups & Recovery)
3. CI test gate — release workflow runs vitest + smoke suites before building/publishing
4. Strict CSP — `script-src 'self'`, zero inline handlers, no unsafe-inline/eval (v0.36–0.37)
5. Source-drift resilience — all six external feeds fail soft on outage AND shape drift
6. README/identity refresh ("financial & reference terminal for SL + precons")

**v0.37.0 is 1.0 in substance.** What remains before stamping:

1. **Clean-machine test (the only real gate).** Install the release build on a fresh
   Windows user/VM: first-run flow → sample CSV import → price refresh → restart →
   backup restore. Years of dogfooding state on the dev machine can mask first-run bugs;
   this is the highest-value pre-1.0 hour.
2. `npm run release:tag -- major` → **v1.0.0** with a milestone CHANGELOG entry.

**Community Curation Sync stays the 1.1 headline** (unblocked since v0.31.0); Alerts +
Collection Report remain fast-follows. Nothing else gates 1.0. Consciously still NOT
doing: cloud/accounts/social, scanning, multi-currency.

## Steam — as a FREE release

Steam accepts non-game software (Software → Utilities); collection managers exist there.
Two sides of work:

### Valve's side (process, ~2–4 weeks elapsed, mostly waiting)

- **Steamworks partner account:** identity verification, tax interview, bank details —
  required even for a free app.
- **$100 Steam Direct fee** per product; recoupable only after $1,000 adjusted gross
  revenue — i.e. never, for a free app. Treat as shelf-space cost.
  (https://partner.steamgames.com/doc/gettingstarted/appfee)
- **Store assets:** ~6 capsule image sizes, ≥5 screenshots at 1920×1080, short + long
  descriptions. Only `build/icon.png` exists today — a small but real design task. The
  P&L ledger and SL Explorer views are the pitch; screenshot those.
- **Two review gates:** store-page review (days), then build review pre-launch; the page
  must sit public as "Coming Soon" ~2 weeks before release.
- **Content survey:** includes an AI-generated-content disclosure (answer honestly given
  how this app is built) and a requires-internet note ("runs offline with last-good
  data" is a good store-page line, and true).

### Our side (packaging, ~2–4 sessions)

1. **Steam takes the unpacked app directory, not the NSIS installer.** Add a
   `dir`/win-unpacked packaging path and upload via SteamPipe (`steamcmd`) as a Windows
   x64 depot. NSIS remains the GitHub-channel artifact.
2. **Distribution-channel flag — the one real code change.** Steam builds must fully
   disable electron-updater: no `checkForUpdates`, no update pill, no Settings updater
   section, no GitHub `publish` step. Steam owns updating; self-updating out from under
   it breaks depot file verification. Design it as a channel concept (build-time flag)
   so GitHub + Steam builds coexist.
3. **Already correct, no change needed:** DB in `%APPDATA%\secret-lair-tracker` survives
   Steam install/verify/uninstall; single-instance lock covers Steam double-launch;
   graceful offline degradation.
4. **Steamworks SDK: skip at launch.** No achievements/overlay needed for software
   titles; zero SDK integration is fine. **No Steam Cloud for `collection.db`** — WAL
   sync is exactly the corruption class this app learned the hard way (see
   db-corruption history).
5. **Code signing: not needed for the Steam channel** (Steam is the trust layer).
   SmartScreen only affects the GitHub NSIS channel — separate, optional decision.

**The real gate is IP review:** submission affirms we have the rights to the content we
ship. That's the monetization/naming section below — the IP question and the money
question are the same question.

## Monetization — researched verdict (July 9, 2026): can't charge for it

The code is 100% ours and every dependency (Electron, better-sqlite3, chart.js,
interactjs) is MIT/permissive — no blocker there. The blocker is that the app's entire
visible surface is WotC IP + community data whose terms require free access:

- **WotC Fan Content Policy** — the only license we have to display card images, card
  names, and the Secret Lair product line: *"You can't require payments, surveys,
  downloads, subscriptions, or email registration to access your Fan Content"* and
  *"You can't sell or license your Fan Content to any third parties for any type of
  compensation."* A price tag exits the policy entirely — at which point it's selling
  WotC's copyrighted card images with no license at all.
  (https://company.wizards.com/en/legal/fancontentpolicy)
- **Scryfall API terms** (primary price/image/metadata source) independently prohibit
  paywalling: you may not require payment or subscriptions in exchange for access to
  Scryfall data; the API is offered free *under* the Fan Content Policy.
  (https://scryfall.com/docs/api/ , https://scryfall.com/docs/terms)
- **TCGCSV (TCGplayer prices) and mtg.wiki** (MSRPs, superdrop grouping) carry the same
  community/non-commercial expectations — weaker legal teeth, same direction.
- Paid MTG apps exist (Delver Lens, TopDecked) in a **selectively-tolerated gray zone** —
  a bad foundation on a storefront where one trademark complaint pulls the listing.
- Economics anyway: at $0.99 minus Valve's 30%, recouping the $100 fee alone takes
  **~1,450 sales**. Free-with-affiliate-links almost certainly out-earns a price tag.

### Sanctioned money paths

The policy explicitly allows *"sponsorships, ad revenue, and donations"*:

1. **Free app + donation link** (Ko-fi/Patreon in Settings/About) — the Scryfall /
   Moxfield model.
2. **TCGplayer affiliate program** — the buy actions already exist ("Buy on TCGplayer
   Mass Entry", per-card buys in decks/want list); adding a partner/affiliate code to
   those URLs is the natural, fully-sanctioned path in this ecosystem.

### Naming — action required regardless of price

The policy also says *"Don't use Wizards' logos and trademarks"* — and **"Secret Lair"
is WotC's product trademark.** In store *description* text, "a collection tracker for
Magic: The Gathering Secret Lair drops" is defensible nominative use; as the product
*title* on a commercial storefront it is not — it's the single most exposed thing about
this plan, more than the card images. Before any store page goes up:

- Pick a storefront name that doesn't contain the mark (the README's "financial
  terminal" framing is raw material).
- Rename only the product surface: title bar, `productName`/installer branding, store
  copy. **Keep `package.json` `name` (`secret-lair-tracker` → the `%APPDATA%` userData
  path) and `appId` (`com.akapl.secretlairtracker`) stable** — changing those orphans
  every existing install's database and breaks auto-update continuity for the GitHub
  channel.

## Agreed sequence

1. Clean-machine install test → stamp **v1.0.0**. ✅ DONE (v1.0.0 shipped 2026-07-10)
2. Choose the storefront name; rename the product surface (internal IDs stay).
   ✅ DONE — **Mana Ledger** (v1.0.0)
3. Build the Steam channel: `dir` packaging target + updater kill-switch flag →
   Steamworks onboarding → store assets → page + build reviews.
   ✅ Packaging/assets/copy done; Steamworks onboarding in progress (user side).
4. Ship **free**, with a donation link and TCGplayer affiliate codes wired into the
   existing buy actions. ✅ Ko-fi shipped (v1.0.2/1.0.3); affiliate awaiting
   TCGplayer/Impact approval (site verified via meta tag on the landing page).
5. Optional stepping stone: **itch.io** first (no fee, no review queue) — same
   "strangers install this cold" learning, flushes out first-run bugs while Valve's
   review runs.

---

## Queued work — 2026-07-11 (pick up in a fresh session)

Status at queue time: v1.0.9 shipped; repo lives at
**github.com/sarcasticsoftwarestudio/mana-ledger** (transferred + renamed — old URLs
redirect, updater verified through the two-hop chain; NEVER recreate repos at the old
names). Landing page: **sarcasticsoftwarestudio.github.io/mana-ledger**. In-app feedback
relay live (Web3Forms). Steam capsules + 6 screenshots ready in
`Documents\Sarcastic Software Branding\mana-ledger-steam\`.

1. **Landing page: direct-download button.** The "Download for Windows" button links to
   the GitHub releases page; make it start the installer download. Gotcha: the stable
   `releases/latest/download/<asset>` URL needs a fixed asset name, but our artifact name
   embeds the version (and the updater's latest.yml references it — don't rename the
   artifact). Plan: small client-side fetch of
   `api.github.com/repos/sarcasticsoftwarestudio/mana-ledger/releases/latest` (GitHub API
   allows CORS), point the button's href at the .exe asset's browser_download_url,
   keep the releases page as no-JS fallback. Add a caption: version · size · Windows 10/11.
2. **Windows-only clarity.** Say it plainly on the landing page hero ("Windows 10/11 —
   no macOS/Linux version"), in the README, and in the Steam store copy; on Steamworks,
   tick ONLY the Windows platform box.
3. **Code signing / SmartScreen ("unknown publisher" warning on the GitHub installer).**
   Options to evaluate in-session, in rough order of preference:
   - **Azure Trusted Signing** (~$10/mo): cheapest legitimate route, integrates with
     electron-builder, builds SmartScreen reputation fast. Check current availability of
     *individual* (non-LLC) identity validation — availability has shifted over time.
   - **OV code-signing cert** (Certum's open-source dev cert ~€70/yr is the solo-dev
     favorite; Sectigo/SSL.com ~$200-400/yr): signs the exe, but SmartScreen still warns
     until download volume builds reputation — signing ≠ instant trust.
   - **EV cert** (~$300+/yr + hardware token): instant SmartScreen reputation, heavier
     validation, usually wants a legal entity.
   - **Do nothing for the GitHub channel** and lean on Steam: Steam installs bypass
     SmartScreen entirely, and friends already trust the source. Decide how much the
     GitHub channel matters before spending.
   CI note: whichever cert route wins, signing happens in the release workflow
   (electron-builder win.sign config + secrets in GitHub Actions).
4. **Steam trailer** (deferred item from the release checklist): 30-60s screen capture.
   Shot list: dashboard (charts) → SL Explorer → drop P&L → crack-or-keep → precons →
   logo card. OBS on the user's machine; storyboard + title cards can be prepared in
   session; upload alongside capsules.
5. **Steam launch announcement + community hub** (deferred): pinned welcome/roadmap
   thread, "how to report bugs" post (point at Help → Send Feedback), day-one
   announcement. Draft in session, post at page launch.
6. **Steam beta branch** (deferred): set up `beta` branch in Steamworks alongside
   `default`; push builds to beta first (friends opt in via branch code), promote to
   default after a soak. The Steam-side equivalent of the GitHub-channel dogfooding.

Also still open from earlier: **Steamworks onboarding** (user side — capsules/screens/copy
all ready to paste), **TCGplayer affiliate wiring** (waiting on Impact approval; then add
the tracking template to the buy actions), **community curation sync** (the 1.1 headline),
and the **sarcastic.software domain** (would end the Pages-URL churn permanently).
