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
function listSealed() { return db.prepare('SELECT * FROM sealed').all(); }
function upsertSealed(item) {
  const cols = ['id','name','product_type','set_code','set_name','quantity','purchase_price','current_value','status','notes'];
  db.prepare(`INSERT INTO sealed (${cols.join(',')})
    VALUES (${cols.map(c => '@' + c).join(',')})
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name, product_type=excluded.product_type, set_code=excluded.set_code,
      set_name=excluded.set_name, quantity=excluded.quantity,
      purchase_price=excluded.purchase_price, current_value=excluded.current_value,
      status=excluded.status, notes=excluded.notes, updated_at=datetime('now')`).run({
    id: item.id, name: item.name, product_type: item.productType || null,
    set_code: item.setCode || null, set_name: item.setName || null,
    quantity: item.quantity || 1, purchase_price: item.purchasePrice ?? 0,
    current_value: item.currentValue ?? null, status: item.status || 'sealed',
    notes: item.notes || null,
  });
}
function deleteSealed(id) { return db.prepare('DELETE FROM sealed WHERE id=?').run(id).changes; }

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
  // snapshots: [{ scryfallId, foil, date, price }]
  const stmt = db.prepare(`
    INSERT INTO price_history (scryfall_id, foil, date, price)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scryfall_id, foil, date) DO UPDATE SET price=excluded.price
  `);
  const tx = db.transaction((arr) => {
    for (const s of arr) stmt.run(s.scryfallId, s.foil, s.date, s.price);
  });
  tx(snapshots);
  return snapshots.length;
}

function getAllPriceHistory() {
  // For dashboard summaries that scan everything once. Returns map keyed
  // 'scryfallId|foil' -> [{date, price}, ...]
  const rows = db.prepare(`
    SELECT scryfall_id, foil, date, price FROM price_history ORDER BY date ASC
  `).all();
  const out = {};
  for (const r of rows) {
    const k = `${r.scryfall_id}|${r.foil}`;
    if (!out[k]) out[k] = [];
    out[k].push({ date: r.date, price: r.price });
  }
  return out;
}

// ── Metadata ─────────────────────────────────────────────────────────────────
function bulkUpsertMetadata(entries) {
  const stmt = db.prepare(`
    INSERT INTO card_metadata (scryfall_id, colors, color_identity, type_line, cmc, power, toughness)
    VALUES (@scryfall_id, @colors, @color_identity, @type_line, @cmc, @power, @toughness)
    ON CONFLICT(scryfall_id) DO UPDATE SET
      colors=excluded.colors, color_identity=excluded.color_identity,
      type_line=excluded.type_line, cmc=excluded.cmc,
      power=excluded.power, toughness=excluded.toughness,
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
function replaceSlData(dropCards, scryfallToDrops) {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM sl_drop_cards').run();
    db.prepare('DELETE FROM sl_scryfall_drops').run();
    const dc = db.prepare('INSERT OR IGNORE INTO sl_drop_cards (drop_name, card_name) VALUES (?, ?)');
    for (const [drop, cards] of Object.entries(dropCards || {}))
      for (const c of cards) dc.run(drop, c);
    const sd = db.prepare('INSERT OR IGNORE INTO sl_scryfall_drops (scryfall_id, drop_name) VALUES (?, ?)');
    for (const [id, drops] of Object.entries(scryfallToDrops || {}))
      for (const d of drops) sd.run(id, d);
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
  return { dropCards, scryfallToDrops, updatedAt: getSetting('sl_data_updated_at') };
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

// Nuke everything except schema. Returns counts.
function resetAll() {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM cards').run();
    db.prepare('DELETE FROM sealed').run();
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
  // nuclear
  resetAll,
};
