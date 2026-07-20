# Secret Lair Data — Final Model and Source Guide

*Final implementation reference · 2026-07-20 · Mana Ledger 1.3.x*

## Shareable summary

Mana Ledger does not rely on one “Secret Lair database,” because no single source describes the whole product. It reconciles specialist sources into one finish-aware product model:

- **MTGJSON is the product-and-contents backbone.** It tells us which purchasable SKU points to which deck, exact card UUIDs, quantities and foil flags. It also supplies stable marketplace identifiers.
- **Scryfall describes and prices the exact card printing.** It supplies printing metadata, supported finishes, daily USD/EUR prices, art, artist, images and rules text.
- **TCGCSV supplies TCGplayer sealed-product prices.** MTGJSON's TCGplayer product ID makes this an exact ID join rather than a name guess. Mana Ledger retains market, low, mid, high and direct-low values plus subtype and product metadata.
- **mtg.wiki supplies the Secret Lair-specific release structure that the catalog APIs do not model.** The Drop Series table supplies superdrops, release dates, nonfoil/foil MSRP and upcoming drops. Its separate Bonus Cards table supplies documented inserts, variants, exclusivity and notes.
- **Official Wizards announcements supply launch context.** Recent articles add official publication/sale timing, bundle names, promotion details and WPN/store notes. Dollar amounts are intentionally ignored because an article titled for a superdrop can quote individual-SKU prices.
- **PriceCharting is an optional secondary sealed estimate.** It is queried only when the user supplies a paid API token.
- **CardTrader is an optional live-listing comparison.** When the user supplies a profile API token, Mana Ledger queries the exact preserved CardTrader blueprint ID and keeps each returned currency separate.
- **A reviewed MTGJSON AllPrices slice seeds history.** The build workflow extracts only exact Secret Lair printing/finish USD retail series; the desktop never downloads the global file.
- **Local SQLite stores ownership, history and intelligence overlays.** Collection copies, bundle purchase lots and allocated landed cost, observed bonus pulls, watches, labeled market observations, user overrides, daily snapshots and last-known-good source caches remain on the user's computer.

The economic unit is a **purchasable SKU**, not a display-name string. The ownership unit is an **exact Scryfall printing plus finish**. A nonfoil copy therefore cannot complete a foil product, even when both products use the same Scryfall printing ID.

User-authored intelligence is deliberately orthogonal to sourced truth: a purchase-lot allocation can change cost basis, but an observed bonus pull or marketplace quote never changes the product's guaranteed-contents contract.

## 1. Source contracts

### MTGJSON `SLD.json`

Role: canonical relational spine for released Secret Lair products and contents.

Mana Ledger reads:

- set cards and tokens;
- MTGJSON card UUID, name, collector number, finishes and subsets;
- every card identifier MTGJSON publishes, including Scryfall and marketplace IDs;
- decks, their boards, quantity and per-entry `isFoil`;
- sealed products with UUID, product name, subtype, release date, contents and every marketplace identifier;
- `tcgplayerProductId` as the primary exact sealed-pricing join.

Observed on 2026-07-20: MTGJSON SLD version `5.3.0+20260720` contained 2,649 cards, 68 tokens, 709 decks and 943 sealed rows. Among 734 Secret Lair/Commander products, 722 had a deck reference and 713 had a TCGplayer product ID. Counts change as the catalog is corrected.

Why it is the backbone: `sealedProduct → contents.deck → deck entry → card UUID → Scryfall ID` explicitly answers “which printing, in which quantity and finish, belongs to this SKU?” Name parsing cannot answer that reliably.

Preserved sealed-product identifiers currently include fields such as `cardKingdomId`, `cardtraderId`, `csiId`, `hareruyaId`, `mcmId`, `tcgplayerProductId` and `tntId` when MTGJSON supplies them. They are stored as JSON so future identifiers do not require a database migration.

### Scryfall

Role: canonical exact-printing metadata and the primary card-price feed.

Mana Ledger reads or retains:

- Scryfall printing ID, card/set names and collector number;
- release date, rarity, mana cost/value, type, colors, identity and oracle text;
- `finishes[]` and the finish-specific `prices` object;
- USD, USD foil, USD etched and available EUR prices;
- art/artist IDs, illustration ID, image URIs and flavor text;
- language, promo types, frame effects, full-art and border metadata;
- Scryfall's TCGplayer and Cardmarket identifiers when present.

The main process builds a compact local index from Scryfall's daily `default_cards` bulk file. This turns thousands of repeated API lookups into one daily download and preserves the last built index if a refresh fails.

Observed on 2026-07-20: `set:sld` returned 2,628 printings. MTGJSON and Scryfall counts are not expected to match exactly because their inclusion timing and object types differ.

### TCGCSV / TCGplayer data

Role: primary current-value source for sealed products and TCGplayer market data.

Join: `sl_products.tcgplayer_product_id = TCGCSV productId`.

Mana Ledger retains:

- group and product IDs;
- group/product name;
- market, low, mid, high and direct-low price;
- price subtype and all price rows when more than one exists;
- image/product URL, modification timestamp and presale metadata when published;
- upstream `last-updated.txt` plus the local cache timestamp.

Market remains the default displayed sealed value. Mid then low are fallbacks when market is absent. The other fields provide context rather than silently changing valuation.

Observed on 2026-07-20 in Secret Lair group 2576: 4,157 products and 4,963 price rows, of which 4,848 had market values. TCGCSV is product-level data; it is not condition- or SKU-inventory-specific transaction history.

### mtg.wiki — Drop Series

Role: curated Secret Lair release semantics unavailable from MTGJSON or Scryfall.

Mana Ledger reads:

- sequence number;
- canonical drop name;
- superdrop grouping;
- release date;
- nonfoil and foil MSRP;
- future rows announced before card records exist.

The live parser requires at least 100 plausible rows before replacing the previous cache. Fresh products that are absent from the baked baseline can therefore be grouped and costed without waiting for an app release.

### mtg.wiki — Bonus Cards

Role: supplemental catalog of documented bonus inserts.

Mana Ledger reads:

- SLD collector number;
- bonus type;
- card name;
- variant;
- explicit “Exclusive to” relationship;
- notes and chase/random indicators.

The live HTML parser is table- and rowspan-aware. It produced 466 catalog rows in the 2026-07-20 validation run.

Important semantic rule: a bonus row is **not guaranteed product contents**. It never affects completion, missing-card lists, crack value or sealed deck contents. Only an explicit exclusivity value is shown on an individual drop. Generic randomized pools remain global context.

### Official Wizards announcement archive and articles

Role: authoritative launch and promotion context for recently announced Secret Lairs.

Mana Ledger reads recent Secret Lair announcement cards and enriches up to the first 20 articles with:

- official article URL and title;
- publication time;
- inferred sale date and stated time zone;
- bundle headings;
- promotion, while-supplies-last and WPN/game-store notes.

It deliberately does not parse dollar amounts. The article title often names a whole superdrop while the body prices one constituent drop, bundle or shipping threshold, so assigning any of those amounts to the article row would create a false product-level fact. Older cached `prices` fields are removed when loaded.

This source is HTML rather than a stable public API. The parser therefore validates that it found Secret Lair announcement links before replacing the prior cache. On 2026-07-20 it found five current archive results and successfully extracted the newest article's official publication time and 9 a.m. PT launch time.

Official announcements enrich the model; they do not override exact released contents from MTGJSON.

### PriceCharting (optional)

Role: user-selected secondary current estimate for sealed collectibles.

Implementation details:

- requires the user's paid API token;
- sends the documented `t` token parameter;
- searches `/api/products` and reads individual `/api/product` records;
- prefers `new-price`, falling back to `loose-price`;
- does not provide Mana Ledger's historical product series.

The token is sent only to `www.pricecharting.com` through the main-process host allowlist. Settings now links to the current API documentation and no longer describes the service as a free email-signup API.

### CardTrader (optional)

Role: source-labeled cross-market sealed listing comparison.

Implementation details:

- requires the user's CardTrader profile API token;
- joins the product with MTGJSON's preserved `cardtraderId`, used as CardTrader's `blueprint_id`;
- queries `GET /api/v2/marketplace/products?blueprint_id=…`;
- retains the lowest in-stock listing separately for every returned currency;
- records the observation date, listing count and exact blueprint context;
- never currency-converts or blends the listing into the primary TCGCSV valuation.

The token is sent only to `api.cardtrader.com` through the main-process host allowlist. CardTrader documents Bearer-token authentication and cautions that the marketplace endpoint is lightly cached, so Mana Ledger presents it as a listing observation rather than a guaranteed executable price.

### Local SQLite

Role: private user state, last-known-good caches and history.

It stores:

- owned/sold card and sealed records;
- cost basis, proceeds, fees and notes;
- exact source-product links;
- daily card/sealed price history and portfolio snapshots;
- Secret Lair model tables and legacy projections;
- user grouping/note overrides;
- supplemental source caches and timestamps.
- bundle purchase lots with subtotal, tax, shipping, other fees, allocation method and per-SKU landed-cost allocations;
- observed bonus pulls, watched drops/targets and source/currency-labeled secondary market observations;
- the applied Secret Lair history-seed version.

No collection contents are sent to a source provider.

## 2. Final relational model

### `sl_products` — one row per purchasable SKU

| Field | Meaning |
|---|---|
| `uuid` | Stable MTGJSON sealed-product UUID, or a namespaced synthetic fallback |
| `product_name` | Original sealed-product name |
| `subtype` | MTGJSON product subtype (`secret_lair`, `commander`, or `synthetic`) |
| `identifiers_json` | Every marketplace identifier supplied by MTGJSON |
| `legacy_drop` | Current display/join name used by existing UI maps |
| `drop_name` | Base drop shared by finish SKUs |
| `finish_label` | Human label such as Foil or Rainbow Foil |
| `finish` | Normalized `nonfoil`, `foil`, or `etched` economic finish |
| `tcgplayer_product_id` | Convenience exact join into TCGCSV |
| `release_date` | Product release date when supplied |
| `low_confidence` | True when contents required a fallback/synthetic product |

### `sl_product_cards` — exact guaranteed contents

| Field | Meaning |
|---|---|
| `product_uuid` | Parent SKU |
| `mtgjson_uuid` | Exact MTGJSON card/token UUID |
| `identifiers_json` | All identifiers for that printing |
| `scryfall_id` | Exact Scryfall printing |
| `card_name` | Display name |
| `collector_number` | SLD collector number, including ★ variants |
| `finish` | Finish required by this product entry |
| `count` | Quantity in the product |

Primary membership is `(product_uuid, scryfall_id, finish)`. The runtime ownership key is `(scryfall_id, finish)`.

The legacy `sl_drop_cards` and `sl_scryfall_drops` relations remain as projections for existing UI paths. They are outputs of the product model, not the source of truth.

### User intelligence overlays

The renderer maintains four versionable arrays which are persisted as independent JSON settings blobs in SQLite and included in manual JSON backups:

| Record | Important fields | Economic effect |
|---|---|---|
| `slPurchaseLots` | lot ID/name/date, subtotal, tax, shipping, fees, total, allocation method; items with product UUID, drop, finish, quantity, status and allocated cost | Allocated cost becomes the exact P&L basis; sealed items use exact-ID TCGCSV value |
| `slBonusPulls` | drop/product, observed card, collector number, variant, date, quantity, note | Journal only; never changes guaranteed contents or completion |
| `slWatchList` | drop/product, target sealed price, sale-window flag, note | Produces local refresh-time price/sale alerts |
| `slMarketQuotes` | product/drop, source, amount, currency, quote basis, date, URL/note | Comparison only; never silently replaces primary value |

Bundle allocations may be equal per SKU or weighted by each SKU's finish-aware wiki MSRP. The full landed total is allocated with rounding settled on the final item, so the child costs always sum back to the purchase lot.

## 3. Reconciliation algorithm

1. Index every MTGJSON card/token UUID to its Scryfall ID, metadata and all identifiers.
2. Build canonical drop spellings from card subsets and the baked known-drop list.
3. For each Secret Lair or Secret Lair Commander sealed product:
   - exclude bundle packaging without deck contents;
   - resolve its deck references;
   - walk main, commander, side and token boards;
   - combine entry `isFoil` with the printing's supported finishes;
   - record exact printing, finish and quantity;
   - preserve the original product plus every marketplace ID.
4. Add explicit `contents.card` records when MTGJSON places guaranteed cards directly on a product.
5. Use subset-tagged printings to cover a released drop that lacks a usable sealed-product chain. Mark synthesized products low-confidence.
6. Use collector-number sibling backfill only for orphan printings such as a ★ foil whose base printing is already placed. The printing keeps its native finish.
7. Project legacy name maps from the relational model.
8. Overlay live wiki grouping/MSRP and local user overrides. Overrides always remain local.
9. Join TCGCSV by exact TCGplayer product ID. Use names only for catalog search/fallback selection, never when a stable ID is present.
10. Keep bonus cards and announcements as separate enrichments.

## 4. Finish rules

Secret Lair data uses two real foil regimes:

1. **Separate printing:** a foil has its own Scryfall ID and often a ★ collector number. The foil and base products contain disjoint printing IDs.
2. **Shared printing:** the same Scryfall ID supports both foil and nonfoil. MTGJSON's deck entry `isFoil` distinguishes the products.

Mana Ledger handles both by recording finish on every product-card edge. Product-name finish parsing is now a labeling/canonicalization fallback, not the ownership truth.

## 5. Pricing and history

### Singles

- Exact Scryfall printing + required finish selects `usd`, `usd_foil` or `usd_etched`.
- TCGplayer market history for collection cards is retained separately when available.
- Rich Scryfall metadata is cached with the printing.

### Sealed

- Exact TCGCSV market is primary.
- TCGCSV mid/low are fallback values.
- Low, mid, high, direct-low, subtype and presale fields remain visible to future comparisons and diagnostics.
- PriceCharting is optional and on demand.

### Historical data decision

Mana Ledger records local daily history and portfolio snapshots and now ships a reviewed Secret Lair-only seed produced from MTGJSON `AllPrices`:

1. The GitHub data workflow—not the desktop—downloads the large global payload.
2. The extractor joins only SLD MTGJSON UUIDs to exact Scryfall printing IDs and supported finishes.
3. It accepts TCGplayer USD retail first and Card Kingdom USD retail second. Cardmarket EUR is deliberately excluded from the USD seed.
4. It retains the latest seven daily observations plus one older observation per week, providing a compact view of the 90-day source window.
5. The generated asset is versioned (`schemaVersion`, generation time, source version and per-series provider).
6. On first use of a new seed, points are inserted under source `mtgjson-seed`; local/live Scryfall observations replace seed values on overlapping dates in the in-memory view.

Product Truth can aggregate those exact printing/finish series into a guaranteed-singles product history. It reports change, range and interval volatility only when at least 75% of product rows are priced on an observation date.

Prices are estimates, not guaranteed proceeds. Condition, language, taxes, shipping, platform fees and liquidity can materially change realized value.

## 6. Freshness, caching and failure behavior

| Feed | Normal refresh | Replacement gate | Failure behavior |
|---|---|---|---|
| MTGJSON SLD | Daily first-open/manual SL sync | non-empty valid `data.cards`, successful model build | keep baked/SQLite model; report failure |
| Scryfall bulk | Up to daily | valid bulk catalog and more than 1,000 parsed cards | keep prior compact index; API fallback for misses |
| TCGCSV | Daily cache/on demand | successful groups/products/prices per group | retain existing collection prices; partial group failures logged |
| wiki Drop Series | SL sync | at least 100 parsed rows | keep last good cache plus baked grouping |
| wiki Bonus Cards | SL sync | at least 100 parsed rows | keep last good cache; bonus UI may be absent |
| Wizards announcements | SL sync | at least one relevant archive article | keep last good cache; official strip may be absent |
| MTGJSON SL history seed | Weekly reviewed build/manual workflow | exact SLD UUID + finish, positive USD retail points, versioned compact output | prior shipped seed remains; desktop performs no global download |
| CardTrader | On demand | authenticated exact blueprint response with in-stock positive listing | prior observation remains; TCGCSV remains primary |
| PriceCharting | On demand | successful API status | TCGCSV remains available |

The sources are isolated. A Wizards layout change cannot erase product contents; a wiki failure cannot erase the baked grouping; a TCGCSV group failure cannot corrupt MTGJSON membership.

## 7. Automated maintenance

The baked shared baseline remains important for fresh installs and offline use. `.github/workflows/secret-lair-data.yml` now runs daily:

1. fetch MTGJSON, Scryfall and mtg.wiki pipeline inputs;
2. reconcile and emit `src/renderer/secretlair.js`;
3. run the generated-data smoke test and all unit tests;
4. upload the reconciliation report as an artifact;
5. on Sundays or manual runs, extract the compact reviewed SLD-only `AllPrices` seed;
6. open a reviewable pull request only when the baked baseline or history seed changed.

The live bonus and official announcement sources are not baked because they are independent contextual feeds and should not be confused with guaranteed contents.

## 8. User-facing surfaces

- **Help → Secret Lair Data Guide:** source breakdown, model behavior, pricing semantics, limits and live cache health.
- **Settings → Secret Lair Data:** summary plus a direct link to the full guide.
- **Secret Lair Explorer:** Data Guide button beside refresh; upcoming wiki rows; official Wizards article strip; per-drop explicit bonus-card panel.
- **Drop actions:** Product Truth, Exact Completion, Log Bonus and Watch expose the relational model without conflating sourced and observed data.
- **Official announcements:** the Explorer landing shows the four newest cached articles as a compact preview; “View all” opens the dedicated Announcements view containing every cached result (up to 20), with dates, summaries, bundle headings, official notes and links to the source articles.
- **Secret Lair Intelligence:** bundle purchase lots/landed-cost allocations, release radar and watch alerts, source-quality metrics, observed bonus journal and market-observation counts.
- **Index full report:** filters for year, finish, superdrop, subtype, holding state and confidence; selectable ranking; cohort metrics; CSV export; every row opens its drop.
- **Insights Opportunity Scanner:** a sealed-vs-singles signal is eligible only when the sealed price joins by exact TCGplayer product ID, the product is not low-confidence, and every guaranteed printing/finish quantity has a stored price. The displayed spread excludes bonus cards and exposes the triggering thresholds.
- **Crack or Keep:** gross guaranteed-singles/sealed values plus estimated net proceeds under editable fee/shipping assumptions; unknown bonus odds are excluded.
- **About:** complete source attribution.

## 9. Known limits

- Source release timing differs; temporary count mismatches are normal.
- MTGJSON contents can contain curation gaps. Those are marked with low-confidence fallbacks rather than hidden.
- TCGCSV supplies aggregate product pricing, not condition-specific live inventory or guaranteed transaction prices.
- CardTrader values are current listings in the user's account currency, not completed-sale history; currencies remain separate.
- Cardmarket's former public API documentation endpoint currently returns HTTP 410, so Mana Ledger preserves its MTGJSON ID and offers outbound/manual observation workflows instead of depending on an unavailable contract.
- Random bonus-card odds are often unpublished. Mana Ledger never invents odds or treats a catalog row as guaranteed.
- Official announcement HTML is less stable than a public API, so extraction is conservative and last-known-good.
- Display-name normalization remains necessary for user-facing grouping, but stable IDs control membership and pricing whenever available.
- Local user overrides can intentionally differ from sourced grouping and are never published automatically.

### Complementary sources evaluated but not treated as runtime truth

- **[`mtgjson/mtg-sealed-content`](https://github.com/mtgjson/mtg-sealed-content):** this is the upstream curation project behind MTGJSON sealed contents. It is the right correction/contribution channel when a product chain is wrong, but consuming both it and the published MTGJSON build would duplicate one authority.
- **MTGJSON `AllPrices`:** now consumed only by the reviewed weekly build extractor; the global payload remains deliberately excluded from desktop runtime.
- **The Secret Lair storefront:** useful for browsing current commerce, but its SPA/product availability is not a durable historical catalog. Official Wizards announcement articles are the more stable official launch record.
- **Other marketplaces:** CardTrader now has an optional exact-blueprint adapter. Cardmarket, Card Kingdom and other preserved identifiers remain available as outbound/manual observations unless a stable, licensed API contract is configured. They are never mixed into the primary TCGCSV/Scryfall valuation because currencies, conditions, fees and price definitions are not interchangeable.

## 10. Source and attribution links

- [MTGJSON](https://mtgjson.com/)
- [Scryfall API and bulk data](https://scryfall.com/docs/api)
- [TCGCSV](https://tcgcsv.com/)
- [CardTrader API](https://www.cardtrader.com/docs/api/full/reference)
- [mtg.wiki Secret Lair Drop Series](https://mtg.wiki/page/Secret_Lair/Drop_Series)
- [mtg.wiki Secret Lair Bonus Cards](https://mtg.wiki/page/Secret_Lair/Bonus_cards)
- [Wizards announcement archive](https://magic.wizards.com/en/news/announcements?search=Secret+Lair)
- [PriceCharting API documentation](https://www.pricecharting.com/api-documentation)

Mana Ledger is unofficial Fan Content permitted under the Wizards of the Coast Fan Content Policy. It is not approved or endorsed by Wizards of the Coast.
