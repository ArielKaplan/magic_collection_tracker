// scripts/precon-build/resolve-tcg.js
// Resolves each precon deck's TCGplayer product id for an exact TCGCSV sealed-
// price join. A deck file carries `sealedProductUuids` (uuids only); the
// uuid→tcgplayerProductId mapping lives in the SET files' `sealedProduct`
// arrays. So: collect the uuids + set codes from the cached deck files, fetch
// each unique set file once, build a uuid→tcgId map, and write
// cache/tcg-ids.json = { deckFile: tcgId }. emit-seed.js bakes it in.
//
// Run after fetch-decks.js:  node scripts/precon-build/resolve-tcg.js

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache');
const DECKS = path.join(CACHE, 'decks');
const SETS = path.join(CACHE, 'sets');
fs.mkdirSync(SETS, { recursive: true });

const UA = 'SecretLairTracker/0.32.0 (https://github.com/ArielKaplan/magic_collection_tracker; akaplan.nj@gmail.com)';
const headers = { 'User-Agent': UA, 'Accept': 'application/json' };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // 1. Read cached deck files → { file, code, uuids[] }
  const deckFiles = fs.readdirSync(DECKS).filter(f => f.endsWith('.json'));
  const decks = [];
  const codes = new Set();
  for (const f of deckFiles) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(path.join(DECKS, f), 'utf8')).data; } catch { continue; }
    if (!raw) continue;
    const uuids = raw.sealedProductUuids || [];
    if (!uuids.length || !raw.code) continue;
    decks.push({ file: f.replace(/\.json$/, ''), code: raw.code, uuids });
    codes.add(raw.code);
  }
  console.log(`decks with sealedProductUuids: ${decks.length} · unique sets: ${codes.size}`);

  // 2. Fetch each unique set file once (cached/resumable), index uuid → tcgId
  const uuidToTcg = new Map();
  let fetched = 0, cached = 0, failed = 0, indexed = 0;
  for (const code of codes) {
    const out = path.join(SETS, `${code}.json`);
    let setData;
    if (fs.existsSync(out) && fs.statSync(out).size > 200) {
      cached++;
      try { setData = JSON.parse(fs.readFileSync(out, 'utf8')).data; } catch { setData = null; }
    } else {
      try {
        const r = await fetch(`https://mtgjson.com/api/v5/${code}.json`, { headers });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        fs.writeFileSync(out, text);
        setData = JSON.parse(text).data;
        fetched++;
        if ((fetched) % 25 === 0) console.log(`  … ${fetched} sets fetched, ${cached} cached, ${codes.size - fetched - cached} left`);
        await sleep(90);
      } catch (e) { failed++; console.error(`  FAIL ${code}: ${e.message}`); continue; }
    }
    for (const p of (setData?.sealedProduct || [])) {
      const tcg = p.identifiers?.tcgplayerProductId;
      if (p.uuid && tcg) { uuidToTcg.set(p.uuid, String(tcg)); indexed++; }
    }
  }
  console.log(`sets: ${fetched} fetched, ${cached} cached, ${failed} failed · sealedProduct tcg ids indexed: ${indexed}`);

  // 3. Resolve each deck → first sealedProductUuid that has a tcgId
  const out = {};
  let resolved = 0;
  for (const d of decks) {
    for (const u of d.uuids) {
      const tcg = uuidToTcg.get(u);
      if (tcg) { out[d.file] = tcg; resolved++; break; }
    }
  }
  fs.writeFileSync(path.join(CACHE, 'tcg-ids.json'), JSON.stringify(out));
  console.log(`resolved tcgplayerProductId for ${resolved}/${decks.length} decks → cache/tcg-ids.json`);
})().catch(e => { console.error('RESOLVE FAILED:', e.message); process.exit(1); });
