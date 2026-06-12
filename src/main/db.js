// SQLite layer — all DB access lives here. Renderer never touches the DB
// directly; it goes through IPC, which calls into these functions.
const Database = require('better-sqlite3');
const fs       = require('fs');
const path     = require('path');

let db = null;

function init(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  // ── In-place migrations for older databases (idempotent) ─────────────────
  // Add oracle_text column to card_metadata if it doesn't exist. ALTER TABLE
  // throws "duplicate column" on already-migrated DBs — that's fine, catch it.
  try { db.exec('ALTER TABLE card_metadata ADD COLUMN oracle_text TEXT'); }
  catch (e) { /* column already exists */ }

  try { db.exec('ALTER TABLE sealed ADD COLUMN price_history TEXT'); }
  catch (e) { /* column already exists */ }

  // Migrate price_history to include source column + updated PK if needed
  const phCols = db.prepare('PRAGMA table_info(price_history)').all().map(c => c.name);
  if (!phCols.includes('source')) {
    db.exec(`
      CREATE TABLE price_history_new (
        scryfall_id  TEXT NOT NULL,
        foil         TEXT NOT NULL,
        date         TEXT NOT NULL,
        source       TEXT NOT NULL DEFAULT 'scryfall',
        price        REAL NOT NULL,
        PRIMARY KEY (scryfall_id, foil, date, source)
      );
      INSERT INTO price_history_new (scryfall_id, foil, date, source, price)
        SELECT scryfall_id, foil, date, 'scryfall', price FROM price_history;
      DROP TABLE price_history;
      ALTER TABLE price_history_new RENAME TO price_history;
      CREATE INDEX IF NOT EXISTS idx_price_lookup ON price_history(scryfall_id, foil, date DESC);
    `);
  }

  return db;
}

// ── Cards ────────────────────────────────────────────────────────────────────
const cardCols = [
  'id','scryfall_id','manabox_id','name','set_code','set_name','collector_number',
  'foil','rarity','quantity','binder_name','binder_type','purchase_price',
  'purchase_price_currency','condition','language','misprint','altered'
];
const insertCardStmt = () => db.prepare(`
  INSERT INTO cards (${cardCols.join(',')})
  VALUES (${cardCols.map(c => '@' + c).join(',')})
  ON CONFLICT(id) DO UPDATE SET
    scryfall_id=excluded.scryfall_id, name=excluded.name, set_code=excluded.set_code,
    set_name=excluded.set_name, collector_number=excluded.collector_number,
    foil=excluded.foil, rarity=excluded.rarity, quantity=excluded.quantity,
    binder_name=excluded.binder_name, purchase_price=excluded.purchase_price,
    condition=excluded.condition, language=excluded.language,
    misprint=excluded.misprint, altered=excluded.altered,
    updated_at=datetime('now')
`);

function listCards() {
  return db.prepare('SELECT * FROM cards').all();
}

function bulkUpsertCards(cards) {
  const stmt = insertCardStmt();
  const tx = db.transaction((arr) => {
    for (const c of arr) {
      stmt.run({
        id:                       c.id,
        scryfall_id:              c.scryfallId || null,
        manabox_id:               c.manaboxId || null,
        name:                     c.name,
        set_code:                 c.setCode || null,
        set_name:                 c.setName || null,
        collector_number:         c.collectorNumber || null,
        foil:                     c.foil || 'normal',
        rarity:                   c.rarity || null,
        quantity:                 c.quantity || 1,
        binder_name:              c.binderName || null,
        binder_type:              c.binderType || null,
        purchase_price:           c.purchasePrice ?? 0,
        purchase_price_currency:  c.purchasePriceCurrency || 'USD',
        condition:                c.condition || 'near_mint',
        language:                 c.language || 'en',
        misprint:                 c.misprint ? 1 : 0,
        altered:                  c.altered ? 1 : 0,
      });
    }
  });
  tx(cards);
  return cards.length;
}

function deleteCard(id) {
  return db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes;
}

function updateCardScryfallId(id, scryfallId) {
  return db.prepare(`UPDATE cards SET scryfall_id=?, updated_at=datetime('now') WHERE id=?`)
    .run((scryfallId || '').trim().toLowerCase(), id).changes;
}

// ── Sealed ───────────────────────────────────────────────────────────────────
function listSealed() {
  return db.prepare('SELECT * FROM sealed').all().map(r => ({
    ...r,
    priceHistory: r.price_history ? JSON.parse(r.price_history) : [],
  }));
}
function upsertSealed(item) {
  const cols = ['id','name','product_type','set_code','set_name','quantity','purchase_price','current_value','status','notes','price_history'];
  db.prepare(`INSERT INTO sealed (${cols.join(',')})
    VALUES (${cols.map(c => '@' + c).join(',')})
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, product_type=excluded.product_type, set_code=excluded.set_code,
      set_name=excluded.set_name, quantity=excluded.quantity,
      purchase_price=excluded.purchase_price, current_value=excluded.current_value,
      status=excluded.status, notes=excluded.notes, price_history=excluded.price_history,
      updated_at=datetime('now')`).run({
    id: item.id, name: item.name, product_type: item.productType || null,
    set_code: item.setCode || null, set_name: item.setName || null,
    quantity: item.quantity || 1, purchase_price: item.purchasePrice ?? 0,
    current_value: item.currentValue ?? null, status: item.status || 'sealed',
    notes: item.notes || null,
    price_history: item.priceHistory?.length ? JSON.stringify(item.priceHistory) : null,
  });
}
function deleteSealed(id) { return db.prepare('DELETE FROM sealed WHERE id=?').run(id).changes; }

// ── Decks ────────────────────────────────────────────────────────────────────
function listDecks() {
  const decks = db.prepare('SELECT * FROM decks ORDER BY name').all();
  const cardStmt = db.prepare('SELECT * FROM deck_cards WHERE deck_id = ?');
  return decks.map(d => ({
    id: d.id,
    name: d.name,
    format: d.format || 'commander',
    description: d.description || '',
    createdAt: d.created_at,
    cards: cardStmt.all(d.id).map(c => ({
      id: c.id,
      cardId: c.card_id || null,
      scryfallId: c.scryfall_id || '',
      name: c.name,
      setCode: c.set_code || '',
      setName: c.set_name || '',
      collectorNumber: c.collector_number || '',
      foil: c.foil || 'normal',
      quantity: c.quantity || 1,
      board: c.board || 'main',
    })),
  }));
}

// Full replace per deck: upsert the deck row, then rewrite its card list.
// Deck lists are small (≤ a few hundred rows), so replace is simpler and safer
// than diffing.
function upsertDeck(deck) {
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO decks (id, name, format, description)
      VALUES (@id, @name, @format, @description)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, format=excluded.format,
        description=excluded.description, updated_at=datetime('now')`).run({
      id: deck.id, name: deck.name,
      format: deck.format || 'commander',
      description: deck.description || null,
    });
    db.prepare('DELETE FROM deck_cards WHERE deck_id = ?').run(deck.id);
    const stmt = db.prepare(`INSERT INTO deck_cards
      (id, deck_id, card_id, scryfall_id, name, set_code, set_name, collector_number, foil, quantity, board)
      VALUES (@id, @deck_id, @card_id, @scryfall_id, @name, @set_code, @set_name, @collector_number, @foil, @quantity, @board)`);
    for (const c of deck.cards || []) stmt.run({
      id: c.id,
      deck_id: deck.id,
      card_id: c.cardId || null,
      scryfall_id: c.scryfallId || null,
      name: c.name,
      set_code: c.setCode || null,
      set_name: c.setName || null,
      collector_number: c.collectorNumber || null,
      foil: c.foil || 'normal',
      quantity: c.quantity || 1,
      board: c.board || 'main',
    });
  });
  tx();
}

function deleteDeck(id) {
  // ON DELETE CASCADE clears deck_cards (foreign_keys pragma is ON)
  return db.prepare('DELETE FROM decks WHERE id = ?').run(id).changes;
}

function clearDecks() {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM deck_cards').run();
    db.prepare('DELETE FROM decks').run();
  });
  tx();
}

// ── Price history ────────────────────────────────────────────────────────────
function getCurrentPrice(scryfallId, foil) {
  const row = db.prepare(`
    SELECT price FROM price_history
    WHERE scryfall_id=? AND foil=?
    ORDER BY date DESC LIMIT 1
  `).get(scryfallId, foil);
  return row ? row.price : null;
}

function getPriceHistory(scryfallId, foil) {
  return db.prepare(`
    SELECT date, price FROM price_history
    WHERE scryfall_id=? AND foil=?
    ORDER BY date ASC
  `).all(scryfallId, foil);
}

function bulkStorePrices(snapshots) {
  // snapshots: [{ scryfallId, foil, date, price, source? }]
  // source defaults to 'scryfall'; use 'tcgcsv' for TCGPlayer market prices
  const stmt = db.prepare(`
    INSERT INTO price_history (scryfall_id, foil, date, source, price)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(scryfall_id, foil, date, source) DO UPDATE SET price=excluded.price
  `);
  const tx = db.transaction((arr) => {
    for (const s of arr) stmt.run(s.scryfallId, s.foil, s.date, s.source || 'scryfall', s.price);
  });
  tx(snapshots);
  return snapshots.length;
}

function getAllPriceHistory() {
  // Returns { scryfall: { 'id|foil': [{date,price},...] }, tcgcsv: { 'id|foil': [...] } }
  const rows = db.prepare(`
    SELECT scryfall_id, foil, date, source, price FROM price_history ORDER BY date ASC
  `).all();
  const scryfall = {}, tcgcsv = {};
  for (const r of rows) {
    const k = `${r.scryfall_id}|${r.foil}`;
    const bucket = r.source === 'tcgcsv' ? tcgcsv : scryfall;
    if (!bucket[k]) bucket[k] = [];
    bucket[k].push({ date: r.date, price: r.price });
  }
  return { scryfall, tcgcsv };
}

// ── Metadata ─────────────────────────────────────────────────────────────────
function bulkUpsertMetadata(entries) {
  const stmt = db.prepare(`
    INSERT INTO card_metadata (scryfall_id, colors, color_identity, type_line, cmc, power, toughness, oracle_text)
    VALUES (@scryfall_id, @colors, @color_identity, @type_line, @cmc, @power, @toughness, @oracle_text)
    ON CONFLICT(scryfall_id) DO UPDATE SET
      colors=excluded.colors, color_identity=excluded.color_identity,
      type_line=excluded.type_line, cmc=excluded.cmc,
      power=excluded.power, toughness=excluded.toughness,
      oracle_text=COALESCE(excluded.oracle_text, card_metadata.oracle_text),
      updated_at=datetime('now')
  `);
  const tx = db.transaction((arr) => {
    for (const e of arr) stmt.run({
      scryfall_id:    e.scryfallId,
      colors:         JSON.stringify(e.colors || []),
      color_identity: JSON.stringify(e.color_identity || []),
      type_line:      e.type_line || null,
      cmc:            e.cmc ?? null,
      power:          e.power ?? null,
      toughness:      e.toughness ?? null,
      oracle_text:    e.oracle_text || null,
    });
  });
  tx(entries);
}

function getAllMetadata() {
  const rows = db.prepare('SELECT * FROM card_metadata').all();
  const out = {};
  for (const r of rows) {
    out[r.scryfall_id] = {
      colors:         JSON.parse(r.colors || '[]'),
      color_identity: JSON.parse(r.color_identity || '[]'),
      type_line:      r.type_line,
      cmc:            r.cmc,
      power:          r.power,
      toughness:      r.toughness,
      oracle_text:    r.oracle_text,
    };
  }
  return out;
}

// ── Failed lookups ───────────────────────────────────────────────────────────
function listFailedLookups() {
  const rows = db.prepare('SELECT * FROM failed_lookups').all();
  return rows.map(r => ({
    id: r.id, name: r.name, setCode: r.set_code, setName: r.set_name,
    collectorNumber: r.collector_number, foil: r.foil, binderName: r.binder_name,
    scryfallId: r.scryfall_id, reason: r.reason, reasonLabel: r.reason_label,
    affectedEntries: r.affected_entries,
  }));
}

function replaceFailedLookups(failures) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM failed_lookups').run();
    const stmt = db.prepare(`
      INSERT INTO failed_lookups
        (name, set_code, set_name, collector_number, foil, binder_name, scryfall_id, reason, reason_label, affected_entries)
      VALUES (@name, @set_code, @set_name, @collector_number, @foil, @binder_name, @scryfall_id, @reason, @reason_label, @affected_entries)
    `);
    for (const f of failures) stmt.run({
      name: f.name || null, set_code: f.setCode || null, set_name: f.setName || null,
      collector_number: f.collectorNumber || null, foil: f.foil || null,
      binder_name: f.binderName || null, scryfall_id: f.scryfallId || null,
      reason: f.reason, reason_label: f.reasonLabel || f.reason,
      affected_entries: f.affectedEntries || 1,
    });
  });
  tx();
}

// ── Settings ─────────────────────────────────────────────────────────────────
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value : null;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, value);
}
function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

// ── SL drop data ─────────────────────────────────────────────────────────────
function replaceSlData(dropCards, scryfallToDrops, scryfallToName) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sl_drop_cards').run();
    db.prepare('DELETE FROM sl_scryfall_drops').run();
    const dc = db.prepare('INSERT OR IGNORE INTO sl_drop_cards (drop_name, card_name) VALUES (?, ?)');
    for (const [drop, cards] of Object.entries(dropCards || {}))
      for (const c of cards) dc.run(drop, c);
    const sd = db.prepare('INSERT OR IGNORE INTO sl_scryfall_drops (scryfall_id, drop_name) VALUES (?, ?)');
    for (const [id, drops] of Object.entries(scryfallToDrops || {}))
      for (const d of drops) sd.run(id, d);
    // Name map persisted as a settings JSON blob — small (~120kB) and read in one shot.
    if (scryfallToName) setSetting('sl_scryfall_to_name', JSON.stringify(scryfallToName));
    setSetting('sl_data_updated_at', new Date().toISOString());
  });
  tx();
}

function getSlData() {
  const dropCards = {};
  for (const r of db.prepare('SELECT drop_name, card_name FROM sl_drop_cards').all()) {
    if (!dropCards[r.drop_name]) dropCards[r.drop_name] = [];
    dropCards[r.drop_name].push(r.card_name);
  }
  const scryfallToDrops = {};
  for (const r of db.prepare('SELECT scryfall_id, drop_name FROM sl_scryfall_drops').all()) {
    if (!scryfallToDrops[r.scryfall_id]) scryfallToDrops[r.scryfall_id] = [];
    scryfallToDrops[r.scryfall_id].push(r.drop_name);
  }
  let scryfallToName = {};
  try {
    const raw = getSetting('sl_scryfall_to_name');
    if (raw) scryfallToName = JSON.parse(raw);
  } catch { /* ignore — empty map is fine */ }
  return { dropCards, scryfallToDrops, scryfallToName, updatedAt: getSetting('sl_data_updated_at') };
}

// ── Clear / reset ────────────────────────────────────────────────────────────
function clearCards()         { return db.prepare('DELETE FROM cards').run().changes; }
function clearSealed()        { return db.prepare('DELETE FROM sealed').run().changes; }
function clearPriceHistory()  { return db.prepare('DELETE FROM price_history').run().changes; }
function clearMetadata()      { return db.prepare('DELETE FROM card_metadata').run().changes; }
function clearFailures()      { return db.prepare('DELETE FROM failed_lookups').run().changes; }
function clearSettings()      { return db.prepare('DELETE FROM settings').run().changes; }
function clearSlData() {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sl_drop_cards').run();
    db.prepare('DELETE FROM sl_scryfall_drops').run();
  });
  tx();
}

// Online backup via better-sqlite3 — safe while the DB is open (WAL included).
function backupTo(destPath) {
  return db.backup(destPath);
}

// Nuke everything except schema. Returns counts.
function resetAll() {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM cards').run();
    db.prepare('DELETE FROM sealed').run();
    db.prepare('DELETE FROM deck_cards').run();
    db.prepare('DELETE FROM decks').run();
    db.prepare('DELETE FROM price_history').run();
    db.prepare('DELETE FROM card_metadata').run();
    db.prepare('DELETE FROM failed_lookups').run();
    db.prepare('DELETE FROM sl_drop_cards').run();
    db.prepare('DELETE FROM sl_scryfall_drops').run();
    db.prepare('DELETE FROM settings').run();
  });
  tx();
  // VACUUM can't run inside a transaction; do it separately to reclaim disk
  try { db.exec('VACUUM'); } catch (e) { /* ignore — non-fatal */ }
  return { ok: true };
}

module.exports = {
  init,
  // cards
  listCards, bulkUpsertCards, deleteCard, updateCardScryfallId, clearCards,
  // sealed
  listSealed, upsertSealed, deleteSealed, clearSealed,
  // decks
  listDecks, upsertDeck, deleteDeck, clearDecks,
  // prices
  getCurrentPrice, getPriceHistory, bulkStorePrices, getAllPriceHistory, clearPriceHistory,
  // metadata
  bulkUpsertMetadata, getAllMetadata, clearMetadata,
  // failures
  listFailedLookups, replaceFailedLookups, clearFailures,
  // settings
  getSetting, setSetting, getAllSettings, clearSettings,
  // SL
  replaceSlData, getSlData, clearSlData,
  // backup
  backupTo,
  // nuclear
  resetAll,
};
