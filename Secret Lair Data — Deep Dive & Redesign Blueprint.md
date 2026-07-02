# Secret Lair Data — Deep Dive & Redesign Blueprint
*Written 2026-07-02 at v0.27.0. Research question: is there a better dataset than what we have, how should the superdrop → drop → card hierarchy be organized, and how do we make foil vs. non-foil first-class? Every claim below marked ✅ was verified live today against the actual sources.*

---

## Executive summary

**There is no better dataset out there — nobody has built one. But the app is using its existing sources at a fraction of their capability.** The single biggest finding: MTGJSON already models Secret Lair *relationally and finish-aware* — every purchasable SKU is a `sealedProduct` with a TCGplayer product ID, pointing at a deck whose entries carry a per-card `isFoil` flag and resolve to exact Scryfall printings. The app's current refresh throws all of that away and reconstructs drops by regex-parsing display-name strings, which is precisely why foil/non-foil keeps being painful. The fix is not a new source; it's **replacing the name-string spine with the ID spine that already exists** — and adding two cheap upgrades: in-app wiki sync (superdrops + real per-drop MSRPs + upcoming drops) and an exact TCGplayer-ID join for sealed prices.

---

## 1. How the SL data is structured today (as-is)

Four layers, all keyed by **display-name strings**:

1. **Baked baseline** — `src/renderer/secretlair.js` data literals, generated 2026-06-13 by `scripts/sl-build/`:
   - `SL_SUPERDROPS` — `[{superdrop, date, drops: [names]}]` (100 groups, 353 drops)
   - `SL_DROP_CARDS` — drop name → card *names*
   - `SL_SCRYFALL_TO_DROPS` — scryfall id → array of drop names (`drops[0]` treated as "primary")
   - `SL_SCRYFALL_TO_NAME`, `SL_SCRYFALL_TO_NUMBER` — id → name / collector number
2. **Live refresh** — `refreshSlData()` in `slTab.js` ("Check for New Cards"), three passes over MTGJSON SLD.json:
   - Pass 1: trust `subsets` (drop tags on card entries)
   - Pass 2: collector-number backfill (★ foils inherit the base number's drop)
   - Pass 3: harvest `sealedProduct` SKUs as finish-variant drops **by parsing finish words out of product name strings**; resolves deck contents uuid → scryfall id, **ignoring the per-entry `isFoil` flag**
   - Result persisted to SQLite (`sl_drop_cards`, `sl_scryfall_drops` via `window.api.sl.replace`)
3. **Override layer** — `sl_overrides` settings blob; `rebuildSlGrouping()` = baked baseline + a finish-regroup regex (so "X Rainbow Foil" sits next to "X") + user edits
4. **Consumption** — ownership = set-intersection on scryfall ids per drop; P&L attributes every owned copy to `drops[0]`; `dropFinish(name)` regex-parses the drop *name* to decide whether to price `usd`, `usd_foil`, or `usd_etched`

**Finish is inferred from name strings by regex in three different places** (`rebuildSlGrouping`, `refreshSlData` Pass 3, `dropFinish`) — three chances to disagree, and none of them consulted when deciding whether *your copy* belongs to the foil or non-foil version.

---

## 2. The foil/non-foil problem, root-caused

There are **two distinct foil regimes** in Secret Lair, and the current model handles neither precisely. Verified against MTGJSON (✅ both chains traced end-to-end today):

**Regime A — separate foil printing (★ collector numbers).** *Example: Goblin & Squabblin'.*
- `Goblin Lackey #1311` — `finishes:["nonfoil"]`, subset-tagged to the drop, own scryfall id
- `Goblin Lackey #1311★` — `finishes:["foil"]`, **no subset tag**, *different* scryfall id
- MTGJSON deck **"Goblin & Squabblin' Foil Edition"** references exactly the five ★ printings with `isFoil:true`; the base deck references the five base printings
- Product "Secret Lair Drop Goblin and Squabblin Foil" → `tcgplayerProductId 501840` → TCGCSV names it "Rainbow Foil Edition", market $502.66 ✅

**Regime B — same printing, two finishes.** *Example: Goblingram.*
- `Brash Taunter #1614` — `finishes:["foil","nonfoil"]`, one scryfall id, priced by `usd` vs `usd_foil` columns
- Deck **"Goblingram Foil Edition"** references the *same* uuids as the base deck but with `isFoil:true` per entry
- Two separate products (tcg 551444 base / 551443 rainbow foil) pointing at the two decks

**What breaks today because the model is name-keyed and isFoil-blind:**
- A ★ foil id ends up mapped to **both** the base drop (Pass 2 backfill) and the foil drop (Pass 3), and P&L attributes owned copies to `drops[0]` — the base drop — so foil holdings are costed/valued under the wrong SKU.
- In Regime B, the foil-variant drop gets the *identical* scryfall-id set as the base, so **owning a non-foil copy lights the Rainbow Foil drop as owned** (and vice versa). Your copy's `foil` field is never consulted.
- Cross-source naming disagrees — MTGJSON deck says "Foil Edition", MTGJSON product says "Foil", TCGCSV says "Rainbow Foil Edition", the wiki says something else — so every string join is a fuzzy join with aliases. IDs never disagree.
- Newer finish vocabulary silently degrades: Scryfall promo_types in SLD today include `halofoil` (15) and `dazzlefoil` (7), which none of the three regexes know about.
- MSRP is a flat guess (`$29.99/$39.99` from settings) with foil-ness inferred from *owned copies*. Real per-drop MSRPs vary: Two Scoops drops are $51.99/$71.99, commander decks ~$150, bundles more.

---

## 3. The dataset landscape (research findings, verified 2026-07-02)

Searched for community/canonical SL datasets: **none exist** — no GitHub JSON dataset, no API with drop semantics. The drop-as-entity lives only in marketing copy, the wiki, and this app. That's the moat; it also means no shortcut. What does exist, per source:

| Source | Uniquely authoritative for | Freshness | Verified |
|---|---|---|---|
| **MTGJSON `SLD.json`** | The full relational spine: 709 `secret_lair` sealedProducts (697 with deck contents, **706 with `tcgplayerProductId`**), decks with **per-entry `isFoil`**, cards with `finishes[]`, uuid→scryfallId, collector numbers | Daily builds (today's: `5.3.0+20260702`) ✅ | ✅ |
| **Scryfall `set:sld`** | Printings + prices (`usd`/`usd_foil`/`usd_etched`); special finishes as ★ printings tagged with `promo_types` (rainbowfoil 191, galaxyfoil 20, confetti 18, halo 15, raised 15, dazzle 7…); bulk-data download kills rate limits | Prices daily | ✅ (cache) |
| **mtg.wiki "Secret Lair/Drop Series"** | The superdrop grouping (exists nowhere else machine-readable), official drop sequence numbers, **per-drop MSRP in separate non-foil and foil columns**, collector ranges, and **upcoming drops before release** — a 2026-07-13 drop is already listed | Community-maintained, current through *future* ✅ | ✅ (live API probe, 63 KB wikitext, drop #385) |
| **TCGCSV group 2576** ("Secret Lair Drop Series") | Live sealed + singles market prices: 4,142 products (~839 sealed SKUs), **joins exactly on `tcgplayerProductId`** — probe: MTGJSON id 624749 → "Spongebob Squarepants Bundle - Rainbow Foil Edition", market $308.45 | Daily 20:00 UTC | ✅ (live join test) |
| **`mtgjson/mtg-sealed-content`** (GitHub) | The *upstream* repo where sealedProduct contents are curated — where to file/fix gaps, and an early-visibility channel | Ongoing | found |

Supporting facts:
- The baked dataset (353 drops, June 13) is already **32 drops behind** the wiki (#385) — the manual pipeline cadence is slipping, on schedule.
- The official store (`secretlair.wizards.com`) has FOILS/NON-FOILS catalog pages — a possible announcement scrape, but it's a marketing SPA; treat the wiki as the stable proxy for "what's coming."
- Nothing here requires new scraping infrastructure: MTGJSON + Scryfall + TCGCSV are already in the `net:fetch` allowlist. Only `mtg.wiki` needs adding (one line in main.js).

**Verdict: keep all five sources, change the join.** Each is authoritative for exactly one layer, they cross-validate, and the natural keys to bind them (`sealedProduct.uuid`, `tcgplayerProductId`, `scryfallId`+finish) are all present and verified working.

---

## 4. The recommended data model

Elevate SL data from name-keyed JS globals to first-class relations. **The drop stays the display unit; the *product (SKU)* becomes the economic unit; the printing+finish becomes the ownership unit.**

```sql
sl_superdrops   (id PK, name, date, kind)                    -- wiki grouping layer
sl_drops        (id PK, name, superdrop_id FK, wiki_seq,
                 release_date, kind)                          -- drop | commander | bundle
sl_products     (uuid PK,                                     -- MTGJSON sealedProduct.uuid
                 drop_id FK,
                 finish_label,                                -- '' | 'Foil Edition' | 'Rainbow Foil' | …
                 tcgplayer_product_id,                        -- exact TCGCSV join ✅
                 msrp REAL,                                   -- from wiki price columns
                 release_date)
sl_product_cards(product_uuid FK, scryfall_id, finish, count) -- finish: nonfoil|foil|etched
                                                              -- from deck contents + isFoil ✅
```

Consequences:
- **Ownership becomes exact.** An owned copy `(scryfallId, foil)` matches `sl_product_cards` rows precisely: a non-foil copy lights the non-foil SKU, a ★ or foil copy lights the foil SKU. Completion % per SKU *and* per drop. This is the fix for the problem that has been dogging the foil/non-foil work.
- **Valuation needs no name parsing.** A product's singles value = Σ over its `product_cards`, choosing the price column from the row's `finish` — not from words in the drop name. Regime A prices ★ printings' `usd_foil`; Regime B prices the shared printing's `usd_foil`; both fall out of the same query.
- **P&L attributes to the right SKU.** Cost basis per product uses its real `msrp` (wiki), overridden by a linked owned sealed product's actual purchase price, exactly as today — but "Garden Buds" and "Garden Buds Rainbow Foil" stop sharing/stealing each other's copies.
- **Sealed pricing becomes a join, not a search.** `tcgplayer_product_id` → TCGCSV group 2576 replaces `searchTcgcsvLocal()` fuzzy name matching.
- **The Explorer shows one tile per drop** with finish badges/toggle (non-foil | foil), rather than two look-alike drops scattered by string luck.
- **Superdrop rollups become honest aggregations** — Σ product values per drop, Σ drops per superdrop, per finish.
- `sl_overrides` keeps working — regrouping moves a `drop_id` between superdrops; migrate existing name-keyed overrides once via a name→id map. Community curation sync later exports/imports against stable IDs instead of punctuation-sensitive names.

**Migration is strangler-style, consistent with house rules:** keep the `SL_*` globals as a *generated view* of the new tables at load, so every existing render path keeps working; move views (P&L → drop detail → Explorer grid) onto the relational API one at a time. Safety nets stay: keep the collector-number backfill for the 12 products without deck contents, and keep the name heuristics as a last-resort fallback flagged `low_confidence`.

---

## 5. Refresh strategy — how it stays current with zero heroics

**Tier 1 — in-app, automatic (the existing "Check for New Cards", upgraded):**
- MTGJSON SLD.json builds **daily** (verified today), Scryfall prices daily. Rebuild the relational tables on refresh — using `contents.deck` + `isFoil` + `finishes` instead of the three name-parsing passes.
- **Add `mtg.wiki` to the net:fetch allowlist** and pull the Drop Series wikitext in-app (single 63 KB MediaWiki API call, parser already written in `reconcile.js` — move it to a shared module). This makes superdrop grouping, per-drop MSRPs, *and upcoming drops* refresh live instead of waiting for a pipeline re-run.
- **Upcoming-drops detection for free:** wiki rows dated in the future (one is listed *today*) → an "Upcoming" section in the Explorer + an alert when a new superdrop appears. This is where the SL dataset meets the v1-roadmap Alerts feature.
- Parse defensively: wikitext is community-edited. Cache last-good parse, diff against previous, degrade to baked data on failure. The app always owns an offline baseline.

**Tier 2 — the `sl-build` pipeline becomes a robot (and the community-sync publisher):**
- Keep it as the generator of the shipped baseline (new installs work offline). But stop running it by hand: a **scheduled GitHub Action** runs fetch → reconcile → emit → smoke, and opens a PR when the dataset changed. The 32-drops-behind problem never recurs.
- The Action's JSON output *is* the "GitHub-hosted canonical SL dataset" the roadmap's Community Curation Sync wants to sync — the pipeline stops being a chore and becomes the publishing arm of the moat.

**Prices:**
- **Scryfall bulk `default-cards` daily** (already the top backlog item) — prices every SLD printing including all ★ foils in one download, no 429s.
- **TCGCSV group 2576 daily** for sealed SKU prices via the exact ID join.
- Optionally record per-drop/per-finish value history alongside `portfolio_snapshots` — "this drop's singles value over time, foil vs non-foil" is a chart nobody else can draw.

---

## 6. What this unlocks (why it's the crown jewel)

1. **Foil vs. non-foil as truly distinct items** — distinct SKUs, distinct MSRPs, distinct ownership, distinct ROI — displayed together on one drop page. *"You own the non-foil (5/5, +$41 vs MSRP) and 2/5 of the Rainbow Foil ($502 sealed market)."*
2. **Real MSRPs everywhere** — the flat-$29.99 assumption replaced by the wiki's per-drop non-foil/foil price columns; P&L stops approximating exactly where it matters most.
3. **"Should I buy this drop?" on announcement day** — the wiki lists drops before release and MTGJSON/Scryfall pick up cards at preview time: singles-EV vs MSRP verdict *while the drop is still on sale*. That's the recurring-use feature that answers SL FOMO, and no tool on the internet does it.
4. **Superdrop-level rollups** — value, cost, ROI, completion by superdrop, per finish, over time.
5. **A publishable dataset** — the relational SL dataset with stable IDs is the artifact the community-sync roadmap item distributes. Software is copyable; this isn't.

---

## 7. Suggested sequencing

| Phase | Work | Size |
|---|---|---|
| 1. Data spine | Relational rebuild of `refreshSlData` (products/decks/isFoil/finishes → new tables); `SL_*` globals become generated views; smoke tests for both foil regimes (Goblin & Squabblin' ★ case + Goblingram shared-printing case as fixtures) | The big one — do first |
| 2. Wiki in-app | Allowlist mtg.wiki; shared wikitext parser; superdrops + MSRP + upcoming drops live; "Upcoming" Explorer section | Small |
| 3. Pricing joins | Scryfall bulk data; TCGCSV exact join by product id; per-finish rollups in Explorer/P&L/Index | Medium |
| 4. Publish | GitHub Action pipeline → hosted dataset → community sync (v1 roadmap #3, now with a proper backbone) | Medium, after SL-tab hardening |

**Risks & cautions**
- mtg.wiki is community-run: defensive parsing, last-good caching, baked fallback (all cheap).
- 12 of 709 products lack deck contents; 9 are card-only — keep the collector-number backfill as the safety net for those.
- Don't orphan `sl_overrides`: migrate name keys → drop ids once, keep accepting name keys on import.
- ManaBox imports already carry per-printing scryfall ids, so ★ foils arrive correctly distinguished; the `foil` column on owned copies covers Regime B. No import changes needed.
- Naming across sources genuinely disagrees ("Foil Edition" vs "Foil" vs "Rainbow Foil Edition") — never join on names again; that's the whole lesson.

---

## Appendix: verified evidence trail (2026-07-02)

- MTGJSON SLD.json: 2,597 cards (121 ★ numbers, 59 etched), 691 decks, 924 sealedProducts (709 `secret_lair`, 208 `secret_lair_bundle`); every card has `finishes[]`; meta `5.3.0+20260702` (daily builds).
- Foil Regime A chain: product "Goblin and Squabblin Foil" (tcg 501840) → deck "Goblin & Squabblin' Foil Edition" → 5 ★ printings, `isFoil:true`, own scryfall ids → TCGCSV "Rainbow Foil Edition" market $502.66.
- Foil Regime B chain: "Goblingram Foil Edition" deck → same uuids as base deck, `isFoil:true`, `finishes:["foil","nonfoil"]`.
- TCGCSV: Magic category groups include 2576 "Secret Lair Drop Series" (4,142 products), 22970 "Secret Lair Showdown", 17667 "Countdown Kit", commander-deck groups; join test MTGJSON `tcgplayerProductId` 624749 → market $308.45. Requires a proper User-Agent header. Daily refresh ~20:00 UTC.
- mtg.wiki MediaWiki API (`mtg.wiki/api.php`, page `Secret Lair/Drop Series`): HTTP 200, 63,281 bytes wikitext; table columns = seq #, drop (SLD/SLC template with superdrop arg), collector range, release date, **price non-foil**, **price foil**, MTGA sleeves, MTGO, notes; 43 dates in 2026, latest **2026-07-13** (future/preorder); max drop seq **385** vs baked 353.
- Scryfall SLD finishes distribution: foil+nonfoil 1,493 · foil-only 786 · nonfoil-only 235 · etched combos 58; special-finish promo_types incl. rainbowfoil 191, galaxyfoil 20, confettifoil 18, halofoil 15, raisedfoil 15, dazzlefoil 7.
- Community dataset search: no machine-readable SL drop dataset exists anywhere public.
