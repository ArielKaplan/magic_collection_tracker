// scripts/precon-build/emit-seed.js
// Transforms cache/decks/*.json (from fetch-decks.js) into the compact baked
// seed the app ships: src/main/precon-seed.json. The main process imports it
// into precon_decks/precon_deck_cards on first init (see db.js seedPrecons).
//
// The per-deck transform is imported from the renderer's preconData.js —
// single source of truth, so the baked seed and the in-app sync agree.
//
// Per-deck: { file, name, type, code, date, colors, commander, variantOf, cards }
// Per-card (array, order matters): [scryfallId, name, count, finish, board, setCode, number]
//
// Run: node scripts/precon-build/emit-seed.js

const fs = require('fs');
const path = require('path');

// preconData.js sits in the renderer module graph — stub the DOM globals its
// transitive imports touch at module scope (same trick as the smoke tests).
const noop = () => {};
globalThis.window = { addEventListener: noop };
globalThis.document = {
  addEventListener: noop, getElementById: () => null, querySelectorAll: () => [],
  querySelector: () => null,
  createElement: () => ({ style: {}, classList: { add: noop, remove: noop, toggle: noop }, appendChild: noop, remove: noop, addEventListener: noop }),
  body: { dataset: {} },
};

const CACHE = path.join(__dirname, 'cache');
const DECKS = path.join(CACHE, 'decks');
const OUT = path.join(__dirname, '..', '..', 'src', 'main', 'precon-seed.json');

(async () => {
  const { transformMtgjsonDeck } = await import('../../src/renderer-js/preconData.js');

  const list = JSON.parse(fs.readFileSync(path.join(CACHE, 'DeckList.json'), 'utf8'));
  const byFile = new Map(list.map(d => [d.fileName, d]));

  const decks = [];
  const files = fs.readdirSync(DECKS).filter(f => f.endsWith('.json'));
  let skipped = 0;
  for (const f of files) {
    const fileName = f.replace(/\.json$/, '');
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(DECKS, f), 'utf8')).data; }
    catch { skipped++; continue; }
    if (!raw || !raw.name) { skipped++; continue; }
    const deck = transformMtgjsonDeck(raw);
    deck.file = fileName;
    if (!deck.date && byFile.has(fileName)) deck.date = byFile.get(fileName).releaseDate || null;
    if (!deck.cards.length) { skipped++; continue; }
    decks.push(deck);
  }

  // Exact TCGplayer product ids resolved by resolve-tcg.js (deck → tcgId).
  let tcgIds = {};
  try { tcgIds = JSON.parse(fs.readFileSync(path.join(CACHE, 'tcg-ids.json'), 'utf8')); }
  catch { console.warn('  (no cache/tcg-ids.json — run resolve-tcg.js for exact sealed-price joins)'); }
  let withTcg = 0;
  for (const d of decks) { if (tcgIds[d.file]) { d.tcgplayerProductId = tcgIds[d.file]; withTcg++; } }

  // Collector's Edition variants → link to their base deck (same code + type).
  const byKey = new Map(decks.map(d => [`${d.code}|${d.type}|${d.name.toLowerCase()}`, d]));
  let variants = 0;
  for (const d of decks) {
    const m = d.name.match(/^(.*) Collector's Edition$/i);
    if (!m) continue;
    const base = byKey.get(`${d.code}|${d.type}|${m[1].toLowerCase()}`);
    if (base) { d.variantOf = base.file; variants++; }
  }

  decks.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name));

  // version 2: adds Jumpstart decks + exact tcgplayerProductId. db.js re-seeds
  // (idempotent upsert) when the baked version outranks the stored one, so
  // existing installs pick up the new decks + ids on their next launch.
  const seed = { version: 2, generatedAt: new Date().toISOString(), decks };
  fs.writeFileSync(OUT, JSON.stringify(seed));
  const cardRows = decks.reduce((s, d) => s + d.cards.length, 0);
  const types = {};
  for (const d of decks) types[d.type] = (types[d.type] || 0) + 1;
  console.log(`Wrote ${OUT}`);
  console.log(`decks: ${decks.length} (${skipped} skipped) · card rows: ${cardRows.toLocaleString()} · CE variants linked: ${variants} · tcgIds: ${withTcg}`);
  console.log(`size: ${(fs.statSync(OUT).size / 1024 / 1024).toFixed(1)} MB`);
  console.log('types:', JSON.stringify(types));
})().catch(e => { console.error('EMIT FAILED:', e); process.exit(1); });
