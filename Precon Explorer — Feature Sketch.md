# Precon Explorer — Feature Sketch
*Sketched 2026-07-02 at v0.28.0. The Secret Lair Explorer's sibling: every preconstructed deck ever printed — name, colors, full decklist, hover previews, ownership, and the same economics treatment. All dataset claims below were verified live today.*

---

## The concept

A rail item beside the SL Explorer that answers, for precons, what the Explorer answers for drops:

- *Which precons exist, and what's in them?* (browse by product line → deck → cards)
- *How much of this precon do I already own?* (ownership dots + completion %, finish-aware)
- *Is this precon worth buying?* (MSRP vs. sum-of-singles vs. sealed market price — the crack-or-keep of precons)
- *Which precon did this card come from?* (reverse lookup — a genuinely new power the SL work doesn't have)

The thesis carries over exactly: Moxfield and ManaBox treat a Commander precon's cards as loose printings. The *deck as a purchasable product* — this card came in "Avengers Assemble," which shipped 2026-06-26 at $44.99 — is a unit of meaning nobody else models. Same moat shape, second product line.

---

## The dataset — verified, and the hurdle is already solved

**The hurdle isn't real: MTGJSON catalogs every precon the same way it catalogs SLD.** Probed live today:

- **`DeckList.json`** (one ~300 KB fetch): **2,810 decks, 1993 → 2026**, each with `code, fileName, name, releaseDate, type`. 255 decks added in 2025, 156 so far in 2026 — it's actively maintained within days of release (the Marvel commander precons from 2026-06-26 are already in).
- **Per-deck files** (`/api/v5/decks/<fileName>.json`): fully hydrated card entries — `scryfallId, name, count, finishes, isFoil, colorIdentity, colors, manaValue, number, setCode, rarity, edhrecRank` — plus `commander`, `displayCommander`, `tokens`, and **`sealedProductUuids`** → the set file's sealedProduct → **`tcgplayerProductId`** → exact TCGCSV market price. This is the *identical* relational chain the v0.28.0 SL product model walks, including finish variants ("Avengers Assemble" vs. "Avengers Assemble Collector's Edition" = the precon analog of Foil Editions).
- Raw deck files are ~200–250 KB each (bloated by `foreignData` translations); stripped to what we need they're ~3–5 KB. Full v1 scope ≈ a few MB in SQLite.

**Type distribution** (the scope decision writes itself):

| In scope v1 (~1,100 decks) | Count | Defer / exclude | Count | Why |
|---|---|---|---|---|
| Commander Deck | 190 | Secret Lair Drop | 703 | SL Explorer owns these |
| Theme Deck (1997→) | 220 | Jumpstart | 570 | half-decks; add later as a toggle |
| Intro Pack | 167 | MTGO Redemption / MTGO * | 218 | digital, not products you shelve |
| Duel Deck | 52 | Shandalar / DotP / Sample / Demo | ~120 | video-game & demo lists |
| Planeswalker Deck | 41 | Deck Builder's Toolkit / Land Pack | 73 | not really "a decklist" |
| World Championship Deck | 32 | | | |
| Challenger (+Pioneer) | 30 | | | |
| Event Deck | 26 | | | |
| Starter/Welcome/Game Night/Brawl/Guild Kit/Premium/Archenemy/Planechase/Box Set/etc. | ~350 | | | |

**Staticness — exactly as you guessed.** A printed decklist never changes. The sync model is append-only: fetch `DeckList.json`, diff `fileName` against what's stored, fetch only the new deck files, strip, insert. "Check for new precons" button + a quiet monthly auto-check (or piggyback the existing daily SL refresh — it's one 300 KB request to notice nothing's new). A `scripts/precon-build/` pipeline (mirroring `sl-build/`) bakes a seed dataset so fresh installs browse offline.

---

## Data architecture — reuse the v0.28.0 pattern wholesale

Two tables, shaped like `sl_products` / `sl_product_cards` (same idioms, same db.js patterns):

```sql
precon_decks (
  file_name TEXT PRIMARY KEY,      -- MTGJSON fileName (stable id)
  name, deck_type, set_code, release_date,
  colors TEXT,                     -- computed color identity, e.g. "WUR"
  commander TEXT,                  -- display name(s), '' for non-commander
  variant_of TEXT,                 -- base deck for Collector's Editions
  tcgplayer_product_id TEXT,       -- via sealedProductUuids → exact TCGCSV join
  msrp REAL                        -- era/type default table, user-editable
)
precon_deck_cards (
  deck_file TEXT, scryfall_id TEXT, name TEXT,
  count INTEGER, finish TEXT, board TEXT,   -- main | commander | token
  set_code TEXT, number TEXT,
  PRIMARY KEY (deck_file, scryfall_id, finish, board)
)
```

- **Colors**: commander's `colorIdentity` for commander decks, union of card identities otherwise — the data is in every card entry, computed at sync time, rendered as mana pips on the tile.
- **Finish-awareness comes free**: per-entry `isFoil` + `finishes` feed the same `finishGroup` vocabulary; Collector's Editions become `variant_of` rows grouped beside their base — the exact UI convention v0.28.0 established for foil drops.
- **Ownership**: the same `(scryfallId, finish)` key the SL registry uses. One shared helper serves both explorers.
- **Reverse index**: `precon_deck_cards(scryfall_id)` indexed → "appears in N precons" on any card popup, and a Precons group in global search.

## UI — the SL Explorer's floor plan, re-let

- **Rail item** (🧱 Precon Explorer) → **landing**: product-line tiles (Commander Decks · Challenger Decks · Duel Decks · Theme Decks · …) with owned-completion bars — the superdrop grid, verbatim.
- **Line view**: deck tiles sorted by date — name, color pips, set code, release date, sealed price, `X / 100 owned` bar. Search + year filter. (Drop tiles, verbatim.)
- **Deck view**: commander hero card, then the card grid reusing `.gallery-card` tiles, hover previews (hover.js already resolves any scryfallId), owned/missing styling, "★ Want missing," and the economics banner:
  - **Precon P&L**: MSRP → current singles value → gain%, with a linked owned sealed product overriding MSRP (the `dropName` linking pattern, generalized).
  - **Buy-the-precon-or-the-singles verdict**: sealed market price via the exact `tcgplayer_product_id` join (shipped in v0.28.0) vs. on-demand Scryfall batch pricing (the `priceSlDropSingles` machinery, reused).
- Notes/overrides later if wanted — same `sl_overrides` pattern.

## What's genuinely new vs. reuse

Roughly **70% reuse**: tiles, hover, want-list, ownership keys, TCGCSV join, on-demand pricing, sync/persist idioms — all shipped. Genuinely new: the DeckList sync + diff (small), colors computation (trivial), MSRP table for precons (the only real data gap — MSRPs vary by era/type; start with a defaults table like `slMsrpDefault`, refine from mtg.wiki product pages later), and the reverse card→precon index (small, high delight).

## Phasing

1. **Phase A — data**: `precon-build` pipeline + tables + in-app sync with append-only diff. The only heavy lift.
2. **Phase B — explorer**: rail item + three views, reusing SL rendering wholesale.
3. **Phase C — economics + search**: P&L banner, singles-vs-sealed verdict, global-search group, card-popup "appears in" line.

Each phase ships alone. A is invisible, B is the feature, C makes it the *only* tool that answers "was this precon worth it."

## Risks / notes

- Strip `foreignData` at sync or the deck files are 50× heavier than needed.
- Old theme decks may lack `sealedProductUuids`/TCGplayer ids — degrade to name search or no price, same as SL's lowConfidence products.
- Exclude `code = 'SLD'` decks here (the SL Explorer owns them); cross-link instead.
- Jumpstart (570 half-decks) would double the catalog for marginal value — keep it behind a later toggle.
- MSRP defaults need an era table (a 1998 Theme Deck was $9.99; a 2026 Commander precon is $44.99+). User-editable per deck, like the SL MSRP settings.
