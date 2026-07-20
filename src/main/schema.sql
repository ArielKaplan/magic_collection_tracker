-- Secret Lair Tracker — SQLite schema v1
-- One row per CSV-imported card (multiple entries can share scryfall_id+foil)
CREATE TABLE IF NOT EXISTS cards (
  id                       TEXT PRIMARY KEY,
  scryfall_id              TEXT,
  manabox_id               TEXT,
  name                     TEXT NOT NULL,
  set_code                 TEXT,
  set_name                 TEXT,
  collector_number         TEXT,
  foil                     TEXT NOT NULL DEFAULT 'normal',
  rarity                   TEXT,
  quantity                 INTEGER NOT NULL DEFAULT 1,
  binder_name              TEXT,
  binder_type              TEXT,
  purchase_price           REAL DEFAULT 0,
  purchase_price_currency  TEXT DEFAULT 'USD',
  condition                TEXT DEFAULT 'near_mint',
  language                 TEXT DEFAULT 'en',
  misprint                 INTEGER DEFAULT 0,
  altered                  INTEGER DEFAULT 0,
  acquired_at              TEXT,
  source_product_id        TEXT,
  source_product_name      TEXT,
  -- Disposition / realized-gains tracking. A card stays in this table after it's
  -- sold (status='sold') so it can power realized P&L — it just stops counting
  -- toward owned value/cost-basis. status='owned' is the live collection.
  status                   TEXT NOT NULL DEFAULT 'owned',  -- owned | sold
  disposed_at              TEXT,        -- YYYY-MM-DD the entry was sold
  sale_price               REAL,        -- total proceeds for this entry (all copies)
  sale_fees                REAL DEFAULT 0,
  sale_note                TEXT,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cards_scryfall  ON cards(scryfall_id);
CREATE INDEX IF NOT EXISTS idx_cards_binder    ON cards(binder_name);
CREATE INDEX IF NOT EXISTS idx_cards_set       ON cards(set_code);
CREATE INDEX IF NOT EXISTS idx_cards_name      ON cards(name);
CREATE INDEX IF NOT EXISTS idx_cards_dedup     ON cards(manabox_id, scryfall_id, foil);

CREATE TABLE IF NOT EXISTS sealed (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  product_type    TEXT,
  set_code        TEXT,
  set_name        TEXT,
  quantity        INTEGER DEFAULT 1,
  purchase_price  REAL DEFAULT 0,
  current_value   REAL,
  status          TEXT DEFAULT 'sealed',   -- sealed | opened | sold
  notes           TEXT,
  drop_name       TEXT,
  pricecharting_id TEXT,
  linked_scryfall_ids TEXT,          -- JSON array of exact product contents
  opened_from_id  TEXT,
  -- Disposition / realized-gains tracking (mirrors cards). status='sold' keeps
  -- the row for realized P&L but drops it from owned value/cost-basis.
  disposed_at     TEXT,
  sale_price      REAL,
  sale_fees       REAL DEFAULT 0,
  sale_note       TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Want list — cards the user wants to acquire (typically NOT owned). Populated
-- mostly from the Secret Lair Explorer (missing cards / incomplete drops). An
-- optional max_price is a price-watch threshold checked after each refresh.
-- Small & bounded, so the renderer rewrites it wholesale (replaceWantList).
CREATE TABLE IF NOT EXISTS want_list (
  id               TEXT PRIMARY KEY,
  scryfall_id      TEXT,
  name             TEXT NOT NULL,
  set_code         TEXT,
  set_name         TEXT,
  collector_number TEXT,
  foil             TEXT DEFAULT 'normal',
  drop_name        TEXT,
  max_price        REAL,
  note             TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_want_scryfall ON want_list(scryfall_id);

-- One snapshot per (scryfall_id, foil, date, source)
-- source = 'scryfall' (TCGPlayer low via Scryfall) | 'tcgcsv' (TCGPlayer market via TCGCSV)
CREATE TABLE IF NOT EXISTS price_history (
  scryfall_id  TEXT NOT NULL,
  foil         TEXT NOT NULL,
  date         TEXT NOT NULL,
  source       TEXT NOT NULL DEFAULT 'scryfall',
  price        REAL NOT NULL,
  PRIMARY KEY (scryfall_id, foil, date, source)
);
CREATE INDEX IF NOT EXISTS idx_price_lookup ON price_history(scryfall_id, foil, date DESC);

CREATE TABLE IF NOT EXISTS card_metadata (
  scryfall_id     TEXT PRIMARY KEY,
  colors          TEXT,           -- JSON array
  color_identity  TEXT,           -- JSON array
  type_line       TEXT,
  cmc             REAL,
  power           TEXT,
  toughness       TEXT,
  oracle_text     TEXT,
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Cleared & repopulated on every refresh
CREATE TABLE IF NOT EXISTS failed_lookups (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT,
  set_code         TEXT,
  set_name         TEXT,
  collector_number TEXT,
  foil             TEXT,
  binder_name      TEXT,
  scryfall_id      TEXT,
  reason           TEXT NOT NULL,
  reason_label     TEXT,
  affected_entries INTEGER DEFAULT 1,
  created_at       TEXT DEFAULT (datetime('now'))
);

-- Secret Lair drop data (replaces SL_DROP_CARDS / SL_SCRYFALL_TO_DROPS in JS)
CREATE TABLE IF NOT EXISTS sl_drop_cards (
  drop_name  TEXT NOT NULL,
  card_name  TEXT NOT NULL,
  PRIMARY KEY (drop_name, card_name)
);
CREATE TABLE IF NOT EXISTS sl_scryfall_drops (
  scryfall_id  TEXT NOT NULL,
  drop_name    TEXT NOT NULL,
  PRIMARY KEY (scryfall_id, drop_name)
);
CREATE INDEX IF NOT EXISTS idx_sl_drop_lookup ON sl_scryfall_drops(drop_name);

-- Finish-aware SL product model (v0.28.0). One row per purchasable SKU —
-- "Goblin & Squabblin'" and "Goblin & Squabblin' Foil" are separate products
-- of the same drop. Built from MTGJSON sealedProduct → deck contents (with
-- per-entry isFoil) by the renderer's buildSlModel(); the legacy name-keyed
-- maps above are projections of this. legacy_drop is the display/join name
-- the rest of the app uses; tcgplayer_product_id joins TCGCSV exactly.
CREATE TABLE IF NOT EXISTS sl_products (
  uuid                  TEXT PRIMARY KEY,
  product_name          TEXT,
  subtype               TEXT,
  identifiers_json      TEXT DEFAULT '{}',
  legacy_drop           TEXT NOT NULL,
  drop_name             TEXT NOT NULL,
  finish_label          TEXT DEFAULT '',
  finish                TEXT NOT NULL DEFAULT 'nonfoil',  -- nonfoil | foil | etched
  tcgplayer_product_id  TEXT,
  release_date          TEXT,
  low_confidence        INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sl_products_drop ON sl_products(legacy_drop);

-- Which printings, in which finish, a product contains. The (scryfall_id,
-- finish) pair is what makes foil and non-foil truly distinct: a non-foil
-- copy of a shared printing matches the base product's row, never the foil's.
CREATE TABLE IF NOT EXISTS sl_product_cards (
  product_uuid      TEXT NOT NULL,
  mtgjson_uuid      TEXT,
  identifiers_json  TEXT DEFAULT '{}',
  scryfall_id       TEXT NOT NULL,
  card_name         TEXT,
  collector_number  TEXT,
  finish            TEXT NOT NULL DEFAULT 'nonfoil',
  count             INTEGER DEFAULT 1,
  PRIMARY KEY (product_uuid, scryfall_id, finish)
);
CREATE INDEX IF NOT EXISTS idx_sl_product_cards_sid ON sl_product_cards(scryfall_id);

-- Decks — a deck is a *played* list, distinct from binders (the owned collection).
-- Deck cards may link to an owned collection card (card_id) or be unowned
-- placeholders identified by scryfall_id/name. Deck contents never count
-- toward collection value — that stays binder-only.
CREATE TABLE IF NOT EXISTS decks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  format      TEXT DEFAULT 'commander',
  description TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deck_cards (
  id               TEXT PRIMARY KEY,
  deck_id          TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  card_id          TEXT,             -- nullable link to cards.id when owned
  scryfall_id      TEXT,
  name             TEXT NOT NULL,
  set_code         TEXT,
  set_name         TEXT,
  collector_number TEXT,
  foil             TEXT DEFAULT 'normal',
  quantity         INTEGER NOT NULL DEFAULT 1,
  board            TEXT NOT NULL DEFAULT 'main',  -- main | side | commander
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_deck_cards_deck ON deck_cards(deck_id);

-- Collection value over time — one row per calendar day, written after each
-- price refresh (the day's last refresh wins via UPSERT). We snapshot going
-- forward rather than reconstructing from price_history, which has survivorship
-- bias (it only knows about cards still owned today). Powers the dashboard
-- "Value Over Time" line chart.
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  date          TEXT PRIMARY KEY,        -- YYYY-MM-DD (local date)
  cards_value   REAL,
  sealed_value  REAL,
  cost_basis    REAL,
  card_count    INTEGER,
  -- Secret Lair slice of the same snapshot — current value (owned SL singles at
  -- market + still-sealed SL drops) vs cost (flat-MSRP default + linked sealed),
  -- i.e. Σ computeDropPnL(). Powers the "Secret Lair Index" over-time chart.
  sl_value      REAL,
  sl_cost       REAL,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Precon Explorer (v0.29.0) — every physical preconstructed deck, seeded from
-- a baked MTGJSON snapshot (src/main/precon-seed.json, imported at init when
-- the table is empty) and appended to by the in-app "Check for new precons"
-- sync. Decklists are immutable once printed, so rows are only ever added,
-- never rewritten (except a re-seed after a pipeline refresh).
CREATE TABLE IF NOT EXISTS precon_decks (
  file_name             TEXT PRIMARY KEY,   -- MTGJSON deck fileName (stable id)
  name                  TEXT NOT NULL,
  deck_type             TEXT,               -- Commander Deck | Theme Deck | …
  set_code              TEXT,
  release_date          TEXT,
  colors                TEXT DEFAULT '',    -- WUBRG-ordered color identity, '' = colorless
  commander             TEXT DEFAULT '',    -- display name(s), '' for non-commander decks
  variant_of            TEXT,               -- base deck file_name (Collector's Editions)
  tcgplayer_product_id  TEXT,               -- reserved for the exact-join upgrade
  msrp                  REAL,               -- reserved; era/type default computed in renderer
  card_count            INTEGER DEFAULT 0   -- total copies across boards (tile display)
);
CREATE INDEX IF NOT EXISTS idx_precon_decks_type ON precon_decks(deck_type);

CREATE TABLE IF NOT EXISTS precon_deck_cards (
  deck_file    TEXT NOT NULL,
  scryfall_id  TEXT NOT NULL,
  card_name    TEXT,
  count        INTEGER DEFAULT 1,
  finish       TEXT NOT NULL DEFAULT 'nonfoil',  -- nonfoil | foil | etched
  board        TEXT NOT NULL DEFAULT 'main',     -- main | side | commander | token
  set_code     TEXT,
  number       TEXT,
  PRIMARY KEY (deck_file, scryfall_id, finish, board)
);
CREATE INDEX IF NOT EXISTS idx_precon_cards_sid ON precon_deck_cards(scryfall_id);

-- Key-value bag for misc settings (eBay creds, last_price_refresh, sl_data_updated_at, etc.)
CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

-- Schema versioning, in case we add migrations later
CREATE TABLE IF NOT EXISTS schema_version (
  version  INTEGER PRIMARY KEY,
  applied  TEXT DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO schema_version (version) VALUES (1);
