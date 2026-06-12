# Engineering Review & Strategic Roadmap — June 2026

A point-in-time deep review of this codebase (conducted June 12, 2026 at v0.9.0) and the
product strategy that came out of it. **Read PROJECT_CONTEXT.md first** for current
architecture; this document preserves the reasoning behind the decisions so a new session
can pick up the conversation without re-deriving it.

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

1. **Collection value over time** — `portfolio_snapshots (date, cards_value,
   sealed_value, cost_basis)`, one row per refresh, dashboard line chart. The data is
   already being collected; reconstructing retroactively from price_history has
   survivorship bias, so snapshot going forward. ~100 lines.
2. **General "Add card" to collection** — the deck add-cards modal already searches
   Scryfall (`deckIO.js` / `decks.js`); reuse with a binder picker. Closes the "bought
   three singles at the LGS" gap (currently only CSV import / JSON merge / SL Explorer
   right-click can add cards).
3. **SL drop completion %** — superdrop tiles already show owned bars; push down to drop
   tiles ("4/7 owned").
4. **Want list + price watch** — wanted flag, shown in Explorer, optional "alert under
   $X" during the daily refresh.
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

1. **Drop P&L ledger.** Sealed drops are already trackable ("Add drop to Sealed") and
   singles carry cost basis. Connect them: per-drop view showing MSRP paid → current
   singles sum → gain/loss, sortable. "Your best buy: *Phyrexian Praetors* +412%."
   This is the screenshot-and-share feature — how the app spreads beyond one friend.
2. **Crack-or-keep.** TCGCSV and PriceCharting both carry SLD *sealed* prices and are
   already fetched. Per sealed drop: sealed market value vs sum-of-singles value, side
   by side. A genuinely novel decision tool; mostly a join over existing data.
3. **Drop completion + auto want list.** Drop-level "4/7 owned" tiles, then one-click
   "add missing to want list." A want list with prices turns every incomplete drop into
   a shopping list — and is the natural home for price-threshold alerts during refresh.
4. **The curation UI** (on the roadmap since v0.2) is the *strategic* feature, not a
   chore. Once the hierarchy is user-editable in SQLite, it's exportable JSON: a friend
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
1. Next release: **portfolio snapshots + drop-level completion** (small, visible, both
   build on what exists).
2. Headline release: **drop P&L + crack-or-keep** — the release that makes the app
   *about* something.
3. Then the **curation UI**, once the drop views prove which hierarchy edits matter.
4. Phase 2 (vitest) and Phase 3 (per-tab Svelte migration) run alongside any of it.
