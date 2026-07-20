// Extract a compact, reviewed Secret Lair-only price-history seed from the
// global MTGJSON AllPrices payload. The app ships only this exact SLD slice.
// Keeps the latest 7 daily points plus one point per older ISO week (~90 days).
//
// Inputs:
//   scripts/sl-build/cache/mtgjson-sld.json (from fetch-sources.js)
//   MTGJSON_ALL_PRICES=/path/to/AllPrices.json[.gz] (optional)
// Otherwise downloads https://mtgjson.com/api/v5/AllPrices.json.gz.

'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CACHE = path.join(__dirname, 'cache');
const OUT = path.resolve(__dirname, '../../src/renderer/sl-price-seed.json');
const SLD = path.join(CACHE, 'mtgjson-sld.json');
const UA = 'ManaLedger/1.0 (https://github.com/sarcasticsoftwarestudio/mana-ledger)';

const readJson = file => {
  const raw = fs.readFileSync(file);
  const buf = file.endsWith('.gz') ? zlib.gunzipSync(raw) : raw;
  return JSON.parse(buf.toString('utf8'));
};

function extractSelectedPrices(file, wanted) {
  return new Promise((resolve, reject) => {
    let input = fs.createReadStream(file);
    if (file.endsWith('.gz')) input = input.pipe(zlib.createGunzip());
    input.setEncoding('utf8');
    let buffer = '', started = false, meta = {}, settled = false;
    const data = {};
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve({ meta, data });
    };
    const drain = () => {
      if (!started) {
        const marker = buffer.indexOf('"data"');
        if (marker < 0) return;
        const open = buffer.indexOf('{', marker + 6);
        if (open < 0) return;
        const metaMatch = buffer.slice(0, marker).match(/"meta"\s*:\s*(\{[\s\S]*\})\s*,\s*$/);
        if (metaMatch) meta = JSON.parse(metaMatch[1]);
        buffer = buffer.slice(open + 1);
        started = true;
      }
      while (buffer.length) {
        let i = 0;
        while (i < buffer.length && /[\s,]/.test(buffer[i])) i++;
        if (i >= buffer.length) { buffer = ''; return; }
        if (buffer[i] === '}') { finish(); input.destroy(); return; }
        if (buffer[i] !== '"') throw new Error(`Unexpected AllPrices token near ${buffer.slice(i, i + 30)}`);
        let keyEnd = i + 1, escaped = false;
        for (; keyEnd < buffer.length; keyEnd++) {
          const ch = buffer[keyEnd];
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') break;
        }
        if (keyEnd >= buffer.length) { buffer = buffer.slice(i); return; }
        const key = JSON.parse(buffer.slice(i, keyEnd + 1));
        let valueStart = keyEnd + 1;
        while (valueStart < buffer.length && /\s/.test(buffer[valueStart])) valueStart++;
        if (valueStart >= buffer.length || buffer[valueStart] !== ':') { buffer = buffer.slice(i); return; }
        valueStart++;
        while (valueStart < buffer.length && /\s/.test(buffer[valueStart])) valueStart++;
        if (valueStart >= buffer.length) { buffer = buffer.slice(i); return; }
        if (buffer[valueStart] !== '{') throw new Error(`Expected object for AllPrices key ${key}`);
        let depth = 0, inString = false; escaped = false;
        let valueEnd = valueStart;
        for (; valueEnd < buffer.length; valueEnd++) {
          const ch = buffer[valueEnd];
          if (inString) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') inString = false;
          } else if (ch === '"') inString = true;
          else if (ch === '{') depth++;
          else if (ch === '}' && --depth === 0) break;
        }
        if (valueEnd >= buffer.length) { buffer = buffer.slice(i); return; }
        if (wanted.has(key)) data[key] = JSON.parse(buffer.slice(valueStart, valueEnd + 1));
        buffer = buffer.slice(valueEnd + 1);
      }
    };
    input.on('data', chunk => {
      if (settled) return;
      try { buffer += chunk; drain(); }
      catch (e) { input.destroy(); finish(e); }
    });
    input.on('error', finish);
    input.on('end', () => {
      if (!settled) {
        try { drain(); }
        catch (e) { finish(e); return; }
        if (!settled) finish(new Error('AllPrices ended before the data object was complete'));
      }
    });
  });
}

async function allPrices(wanted) {
  const supplied = process.env.MTGJSON_ALL_PRICES;
  if (supplied) return extractSelectedPrices(path.resolve(supplied), wanted);
  const cached = path.join(CACHE, 'AllPrices.json.gz');
  if (!fs.existsSync(cached)) {
    process.stdout.write('Downloading MTGJSON AllPrices.json.gz (build-time only)… ');
    const resp = await fetch('https://mtgjson.com/api/v5/AllPrices.json.gz', { headers: { 'User-Agent': UA, Accept: 'application/gzip' } });
    if (!resp.ok) throw new Error(`AllPrices HTTP ${resp.status}`);
    fs.writeFileSync(cached, Buffer.from(await resp.arrayBuffer()));
    console.log(`${(fs.statSync(cached).size / 1024 / 1024).toFixed(1)} MB`);
  }
  return extractSelectedPrices(cached, wanted);
}

const getCI = (obj, key) => Object.entries(obj || {}).find(([k]) => k.toLowerCase() === key.toLowerCase())?.[1];
function vendorSeries(price, finish) {
  const paper = getCI(price, 'paper') || {};
  // Both are USD retail sources. Cardmarket is deliberately not used here
  // because its EUR series must never be silently mixed into USD history.
  for (const provider of ['tcgplayer', 'cardkingdom']) {
    const retail = getCI(getCI(paper, provider), 'retail');
    const points = getCI(retail, finish);
    if (points && typeof points === 'object' && Object.keys(points).length) return { provider, points };
  }
  return null;
}

function compact(points) {
  const rows = Object.entries(points || {}).map(([date, price]) => ({ date, price: Number(price) }))
    .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.price) && p.price > 0)
    .sort((a,b)=>a.date.localeCompare(b.date));
  if (rows.length <= 14) return rows;
  const recent = rows.slice(-7);
  const weekly = new Map();
  for (const row of rows.slice(0, -7)) {
    const d = new Date(`${row.date}T12:00:00Z`);
    const week = `${d.getUTCFullYear()}-${Math.floor((d - Date.UTC(d.getUTCFullYear(),0,1)) / 604800000)}`;
    weekly.set(week, row); // last observation in the week
  }
  return [...weekly.values(), ...recent].sort((a,b)=>a.date.localeCompare(b.date));
}

async function main() {
  if (!fs.existsSync(SLD)) throw new Error('Run fetch-sources.js first (mtgjson-sld.json missing)');
  const sld = readJson(SLD);
  const cards = [...(sld.data?.cards || []), ...(sld.data?.tokens || [])];
  const wanted = new Set(cards.map(card => card.uuid).filter(Boolean));
  const prices = await allPrices(wanted);
  const byUuid = prices.data || prices;
  const series = {};
  for (const card of cards) {
    const sid = String(card.identifiers?.scryfallId || '').toLowerCase();
    if (!sid || !card.uuid || !byUuid[card.uuid]) continue;
    for (const sourceFinish of (card.finishes || [])) {
      const finish = sourceFinish === 'nonfoil' ? 'normal' : sourceFinish;
      const hit = vendorSeries(byUuid[card.uuid], sourceFinish === 'nonfoil' ? 'normal' : sourceFinish);
      if (!hit) continue;
      const rows = compact(hit.points).map(p => ({ ...p, provider: hit.provider }));
      if (!rows.length) continue;
      series[`${sid}|${finish}`] = rows;
    }
  }
  const points = Object.values(series).reduce((n, rows) => n + rows.length, 0);
  const output = { schemaVersion: 1, generatedAt: new Date().toISOString(), sourceVersion: prices.meta?.version || prices.meta?.date || null, source: 'MTGJSON AllPrices (TCGplayer/Card Kingdom USD retail; SL-only reviewed build slice)', series };
  fs.writeFileSync(OUT, JSON.stringify(output));
  console.log(`Wrote ${Object.keys(series).length.toLocaleString()} series / ${points.toLocaleString()} points to ${OUT}`);
}

module.exports = { compact, vendorSeries, extractSelectedPrices };
if (require.main === module) main().catch(e => { console.error('SL PRICE SEED FAILED:', e.message); process.exit(1); });
