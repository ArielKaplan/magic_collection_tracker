# Secret Lair dataset build pipeline

Regenerates the static Secret Lair dataset baked into `src/renderer/secretlair.js`
(superdrop → drop → card hierarchy) by reconciling three sources. The drop layer is
**immutable** — a released drop never changes superdrop — so this is a one-time/
occasional backfill, not a live sync.

## Run order

```sh
node scripts/sl-build/fetch-sources.js   # download sources -> cache/  (~11 MB)
node scripts/sl-build/reconcile.js        # reconcile -> out/superdrops.json + out/report.md
node scripts/sl-build/emit-secretlair.js  # bake data into src/renderer/secretlair.js
node scripts/sl-build/smoke-secretlair.js # validate the baked file (vm sandbox)
```

Re-run all four whenever a new superdrop lands (or to pick up wiki/MTGJSON fixes).

## Sources & roles

| Source | Provides | Notes |
|---|---|---|
| **MTGJSON** `SLD.json` | drop ↔ cards (`subsets` field) + collector numbers | authoritative for which cards are in a drop |
| **Scryfall** `set:sld` | per-card `released_at` | dates each drop (dates are staggered *within* a superdrop, so they can't define superdrop boundaries) |
| **mtg.wiki** `Secret Lair/Drop Series` | superdrop ↔ drop grouping + names | the only source for the superdrop layer. **mtg.wiki**, not Fandom — Fandom (`mtg.fandom.com`) is stale and stops at end-2024 |

## How reconciliation works

`reconcile.js` takes the authoritative drop list from MTGJSON, dates each drop from
Scryfall, and overlays the superdrop + date from the wiki (joined on normalized drop
name, with collector-range tie-breaking for the rare name collision, plus a few
spelling aliases). Anything the wiki doesn't cover falls back to a release-month
table. Output is one canonical grouping; `report.md` lists any discrepancies.

`emit-secretlair.js` recomputes the four data maps — `SL_SUPERDROPS`,
`SL_DROP_CARDS`, `SL_SCRYFALL_TO_DROPS`, `SL_SCRYFALL_TO_NAME` (with the same
foil/variant backfill the live Refresh uses) — and splices them into the data
literals of `secretlair.js`. The runtime **code** in that file is hand-maintained
and left untouched.

`cache/` (downloaded sources) and `out/` (generated grouping + report) are both
git-ignored — re-run the scripts to regenerate them.
