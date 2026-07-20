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
node scripts/sl-build/extract-price-seed.js # reviewed SL-only AllPrices history seed (large build input)
```

Re-run the full sequence whenever a new superdrop lands (or to pick up wiki/MTGJSON fixes).
`.github/workflows/secret-lair-data.yml` runs this every day and opens a PR only
when the baked baseline changes. On Sundays (and manual runs) it also refreshes
the compact `src/renderer/sl-price-seed.json` asset from MTGJSON AllPrices; the
desktop app never downloads that global payload. The extractor streams the compressed file and retains only SLD UUID records, so the expanded global JSON is never held in memory. Its reconciliation report is uploaded as a
workflow artifact so generated changes still receive human review.

## Sources & roles

| Source | Provides | Notes |
|---|---|---|
| **MTGJSON** `SLD.json` | drop ↔ cards (`subsets` field) + collector numbers | authoritative for which cards are in a drop |
| **Scryfall** `set:sld` | per-card `released_at` | dates each drop (dates are staggered *within* a superdrop, so they can't define superdrop boundaries) |
| **mtg.wiki** `Secret Lair/Drop Series` | superdrop ↔ drop grouping + names | the only source for the superdrop layer. **mtg.wiki**, not Fandom — Fandom (`mtg.fandom.com`) is stale and stops at end-2024 |
| **MTGJSON** `AllPrices` | reviewed 90-day exact-printing/finish history seed | build-time only; TCGplayer/Card Kingdom USD retail, latest 7 daily + older weekly points |

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

The app's live sync also fetches the mtg.wiki bonus-card table and recent official
Wizards announcements. Those are validated last-known-good enrichment caches,
not baked into `secretlair.js`, because they change independently and bonus cards
must remain separate from guaranteed product contents.
