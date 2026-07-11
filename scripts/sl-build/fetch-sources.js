// scripts/sl-build/fetch-sources.js
// One-time source downloader for the Secret Lair dataset backfill.
// Pulls all three sources into scripts/sl-build/cache/ for offline parsing.
//   - MTGJSON SLD.json     -> authoritative drop <-> cards (scryfallId)
//   - Scryfall set:sld      -> per-card released_at (per-drop date validation)
//   - MTG Wiki Drop Series  -> human superdrop <-> drop grouping + names
//
// Run: node scripts/sl-build/fetch-sources.js
// Requires Node 18+ (global fetch).

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache');
fs.mkdirSync(CACHE, { recursive: true });

const UA = 'ManaLedger/1.0 (https://github.com/sarcasticsoftwarestudio/mana-ledger; sarcasticsoftwarestudio@gmail.com)';
const headers = { 'User-Agent': UA, 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const write = (name, obj) =>
  fs.writeFileSync(path.join(CACHE, name), typeof obj === 'string' ? obj : JSON.stringify(obj));

async function getMtgjson() {
  process.stdout.write('MTGJSON SLD.json … ');
  const r = await fetch('https://mtgjson.com/api/v5/SLD.json', { headers });
  if (!r.ok) throw new Error(`MTGJSON HTTP ${r.status}`);
  const text = await r.text();
  write('mtgjson-sld.json', text);
  const j = JSON.parse(text);
  console.log(`ok — ${j.data?.cards?.length ?? 0} cards, ${j.data?.tokens?.length ?? 0} tokens`);
}

async function getScryfall() {
  process.stdout.write('Scryfall set:sld … ');
  const all = [];
  let url = 'https://api.scryfall.com/cards/search?q=set%3Asld&unique=prints&order=set';
  let pages = 0;
  while (url) {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error(`Scryfall HTTP ${r.status}`);
    const j = await r.json();
    for (const c of j.data || []) {
      all.push({
        id: c.id,
        oracle_id: c.oracle_id,
        name: c.name,
        collector_number: c.collector_number,
        released_at: c.released_at,
        set: c.set,
        set_name: c.set_name,
        promo_types: c.promo_types || [],
        frame_effects: c.frame_effects || [],
        finishes: c.finishes || [],
      });
    }
    pages++;
    url = j.has_more ? j.next_page : null;
    await sleep(120); // be polite to Scryfall
  }
  write('scryfall-sld.json', all);
  console.log(`ok — ${all.length} prints across ${pages} pages`);
}

async function getWiki() {
  // mtg.wiki (community successor to the Fandom wiki) is more complete & current —
  // its master Drop Series table covers 2019 → 2026 in one parseable table.
  process.stdout.write('mtg.wiki Drop Series … ');
  const api =
    'https://mtg.wiki/api.php?action=parse&page=Secret%20Lair%2FDrop%20Series&prop=wikitext&format=json';
  const r = await fetch(api, { headers });
  if (!r.ok) throw new Error(`Wiki HTTP ${r.status}`);
  const j = await r.json();
  const wt = j.parse?.wikitext?.['*'] || '';
  write('mtgwiki-dropseries.wikitext', wt);
  console.log(`ok — ${wt.length} bytes`);
}

(async () => {
  await getMtgjson();
  await getScryfall();
  await getWiki();
  console.log('\nAll sources cached in', CACHE);
})().catch((e) => {
  console.error('FETCH FAILED:', e.message);
  process.exit(1);
});
