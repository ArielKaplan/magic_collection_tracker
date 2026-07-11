// bulkData.js — Scryfall bulk "default_cards" engine (main process).
//
// One ~500MB download per day replaces hundreds of rate-limited batch calls:
// the file is streamed to disk, line-parsed into a compact per-printing index
// (id, prices, finishes, name/set/number, mana/type/color/rarity), and served
// from an in-memory map. The renderer's fetchScryfallBatch() consults this
// first and only hits the network for ids the index doesn't know — which
// makes full price refreshes, SL singles pricing, precon details, and
// printings tabs near-instant and 429-proof.
//
// Uses Node's global fetch (NOT Electron net) so ELECTRON_RUN_AS_NODE smoke
// tests exercise the real download/parse paths; Scryfall accepts plain Node
// fetch when a proper User-Agent is sent (same as scripts/sl-build).

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const UA = 'ManaLedger/1.0 (https://github.com/sarcasticsoftwarestudio/mana-ledger)';
const MAX_AGE_MS = 20 * 60 * 60 * 1000;   // one refresh per day, aligned with the daily price refresh

let dir = null;
let indexMap = null;                       // Map(id → compact card) once loaded
let state = 'empty';                       // empty | downloading | building | ready | error
let meta = { fetchedAt: null, count: 0 };
let inflight = null;                       // ensureFresh() de-dup

const metaPath = () => path.join(dir, 'meta.json');
const indexPath = () => path.join(dir, 'index.json');

function init(userDataPath) {
  dir = path.join(userDataPath, 'bulk');
  fs.mkdirSync(dir, { recursive: true });
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(), 'utf8'));
    if (fs.existsSync(indexPath())) state = 'ready';   // loaded lazily on first lookup
  } catch { /* fresh install */ }
}

// The slice of a Scryfall card object the app actually consumes — shaped so
// consumers can treat entries exactly like /cards/collection results.
function extractCompact(c) {
  const face = (c.card_faces && c.card_faces[0]) || {};
  return {
    id: (c.id || '').toLowerCase(),
    name: c.name,
    set: c.set,
    set_name: c.set_name,
    collector_number: c.collector_number,
    released_at: c.released_at,
    finishes: c.finishes || [],
    prices: c.prices || {},
    rarity: c.rarity,
    mana_cost: c.mana_cost || face.mana_cost || '',
    cmc: c.cmc ?? 0,
    type_line: c.type_line || face.type_line || '',
    colors: (c.colors && c.colors.length ? c.colors : (face.colors || [])),
    color_identity: c.color_identity || [],
    oracle_text: c.oracle_text || face.oracle_text || '',
  };
}

// Scryfall bulk files put one card object per line inside the JSON array —
// parse line-by-line so a ~500MB file never becomes one giant heap spike.
async function parseBulkFile(filePath, onCard) {
  const rl = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
  let parsed = 0, failed = 0;
  for await (let line of rl) {
    line = line.trim();
    if (!line || line === '[' || line === ']') continue;
    if (line.endsWith(',')) line = line.slice(0, -1);
    if (!line.startsWith('{')) continue;
    try { onCard(JSON.parse(line)); parsed++; }
    catch { failed++; }
  }
  return { parsed, failed };
}

async function downloadAndBuild(log) {
  state = 'downloading';
  log(`Fetching Scryfall bulk-data catalog…`);
  const catResp = await fetch('https://api.scryfall.com/bulk-data', { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!catResp.ok) throw new Error(`bulk-data catalog HTTP ${catResp.status}`);
  const entry = ((await catResp.json()).data || []).find(d => d.type === 'default_cards');
  if (!entry || !entry.download_uri) throw new Error('default_cards entry missing from catalog');

  const rawPath = path.join(dir, 'default-cards.raw.json');
  log(`Downloading default_cards (~${Math.round((entry.size || 0) / 1024 / 1024)} MB) — once a day…`);
  const dl = await fetch(entry.download_uri, { headers: { 'User-Agent': UA } });
  if (!dl.ok || !dl.body) throw new Error(`bulk download HTTP ${dl.status}`);
  await pipeline(Readable.fromWeb(dl.body), fs.createWriteStream(rawPath));

  state = 'building';
  log('Building the price index…');
  const compact = [];
  const { parsed, failed } = await parseBulkFile(rawPath, c => { if (c.id) compact.push(extractCompact(c)); });
  if (compact.length < 1000) throw new Error(`bulk parse produced only ${compact.length} cards (${failed} line failures)`);
  fs.writeFileSync(indexPath(), JSON.stringify(compact));
  meta = { fetchedAt: new Date().toISOString(), count: compact.length, sourceUpdatedAt: entry.updated_at || null };
  fs.writeFileSync(metaPath(), JSON.stringify(meta));
  try { fs.unlinkSync(rawPath); } catch { /* disk hygiene only */ }

  indexMap = new Map(compact.map(c => [c.id, c]));
  state = 'ready';
  log(`Bulk index ready — ${compact.length.toLocaleString()} printings (${parsed} parsed, ${failed} skipped)`);
}

function loadIndexIfNeeded() {
  if (indexMap || !fs.existsSync(indexPath())) return;
  const compact = JSON.parse(fs.readFileSync(indexPath(), 'utf8'));
  indexMap = new Map(compact.map(c => [c.id, c]));
  state = 'ready';
}

// Refresh the index when stale (>20h). Concurrent callers share one download.
async function ensureFresh(force, log = () => {}) {
  if (!dir) throw new Error('bulkData.init not called');
  const fresh = meta.fetchedAt && (Date.now() - new Date(meta.fetchedAt).getTime()) < MAX_AGE_MS;
  if (!force && fresh && fs.existsSync(indexPath())) { loadIndexIfNeeded(); return status(); }
  if (!inflight) {
    inflight = downloadAndBuild(log)
      .catch(e => { state = fs.existsSync(indexPath()) ? 'ready' : 'error'; throw e; })
      .finally(() => { inflight = null; });
  }
  await inflight;
  return status();
}

// ids → { found: [compact cards], missing: [ids] }. Never throws on a cold
// cache — an empty index just reports everything missing and the renderer's
// network fallback takes over.
function lookup(ids) {
  try { loadIndexIfNeeded(); } catch { /* corrupt index — treat as cold */ }
  const found = [], missing = [];
  for (const id of (ids || [])) {
    const hit = indexMap && indexMap.get((id || '').toLowerCase());
    if (hit) found.push(hit); else missing.push(id);
  }
  return { found, missing };
}

function status() {
  return { state, fetchedAt: meta.fetchedAt || null, count: meta.count || 0, loaded: !!indexMap };
}

module.exports = { init, ensureFresh, lookup, status, parseBulkFile, extractCompact };
