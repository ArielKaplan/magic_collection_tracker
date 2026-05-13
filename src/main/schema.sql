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
  status          TEXT DEFAULT 'sealed',
  notes           TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

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
