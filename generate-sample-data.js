// Run with: node generate-sample-data.js
// Fetches real cards from Scryfall and writes sample-collection.csv

const fs = require('fs');
const https = require('https');

const BINDERS = ['Alpha Collection', 'Modern Staples', 'Draft Pickups'];
const CONDITIONS = ['near_mint', 'near_mint', 'near_mint', 'lightly_played', 'lightly_played', 'moderately_played'];
const OUTPUT = 'sample-collection.csv';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'SampleDataGen/1.0 (personal project)', 'Accept': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// Scryfall random page search — returns up to 175 cards per page
async function fetchPage(query, page = 1) {
  const url = `https://api.scryfall.com/cards/search?q=${encodeURIComponent(query)}&page=${page}&order=random`;
  const json = await fetchJson(url);
  return json.data || [];
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function cardToCsvRow(card, binder) {
  const foilRoll = Math.random();
  const foil = card.foil && foilRoll < 0.08 ? 'foil'
             : card.etched && foilRoll < 0.12 ? 'etched'
             : 'normal';
  const qty = Math.random() < 0.7 ? 1 : Math.random() < 0.6 ? 2 : Math.random() < 0.5 ? 3 : 4;
  const condition = pick(CONDITIONS);
  const purchasePrice = card.prices?.usd ? (parseFloat(card.prices.usd) * (0.8 + Math.random() * 0.4)).toFixed(2) : '';
  const name = (card.name || '').replace(/"/g, '""');
  const setName = (card.set_name || '').replace(/"/g, '""');
  return `"${card.id}","${name}","${card.set || ''}","${setName}","${card.collector_number || ''}","${card.rarity || 'common'}","${foil}","${qty}","${binder}","${condition}","${purchasePrice}"`;
}

async function main() {
  const rows = [];
  const seen = new Set();

  const queries = [
    // Recent sets (2024-2025)
    { q: 'set:dsk',     binder: 'Draft Pickups',   target: 80  },
    { q: 'set:blb',     binder: 'Draft Pickups',   target: 80  },
    { q: 'set:mh3',     binder: 'Modern Staples',  target: 80  },
    { q: 'set:otj',     binder: 'Draft Pickups',   target: 60  },
    { q: 'set:mkm',     binder: 'Draft Pickups',   target: 60  },
    { q: 'set:lci',     binder: 'Draft Pickups',   target: 60  },
    { q: 'set:woe',     binder: 'Draft Pickups',   target: 50  },
    { q: 'set:big',     binder: 'Modern Staples',  target: 40  },
    // Modern staples / older recent sets
    { q: 'set:mh2',     binder: 'Modern Staples',  target: 60  },
    { q: 'set:2x2',     binder: 'Modern Staples',  target: 50  },
    { q: 'set:clb',     binder: 'Modern Staples',  target: 50  },
    { q: 'set:neo',     binder: 'Draft Pickups',   target: 50  },
    { q: 'set:vow',     binder: 'Draft Pickups',   target: 40  },
    // Old/iconic sets
    { q: 'set:lea rarity:r', binder: 'Alpha Collection', target: 15 },
    { q: 'set:leb rarity:r', binder: 'Alpha Collection', target: 10 },
    { q: 'set:3ed',     binder: 'Alpha Collection', target: 30 },
    { q: 'set:4ed',     binder: 'Alpha Collection', target: 30 },
    { q: 'set:ice',     binder: 'Alpha Collection', target: 30 },
    { q: 'set:mir',     binder: 'Alpha Collection', target: 30 },
    { q: 'set:tmp',     binder: 'Alpha Collection', target: 25 },
    { q: 'set:usg',     binder: 'Alpha Collection', target: 25 },
    { q: 'set:mmq',     binder: 'Alpha Collection', target: 20 },
    { q: 'set:inv',     binder: 'Alpha Collection', target: 20 },
  ];

  console.log('Fetching cards from Scryfall…');

  for (const { q, binder, target } of queries) {
    let collected = [];
    let page = 1;
    while (collected.length < target) {
      try {
        const cards = await fetchPage(q, page);
        if (!cards.length) break;
        for (const c of cards) {
          if (!seen.has(c.id) && c.lang === 'en') {
            seen.add(c.id);
            collected.push(c);
          }
          if (collected.length >= target) break;
        }
        page++;
        await sleep(120); // respect Scryfall rate limit
      } catch (e) {
        // page doesn't exist or error — stop
        break;
      }
    }
    console.log(`  ${q.padEnd(25)} binder="${binder}" → ${collected.length} cards`);
    for (const c of collected) rows.push(cardToCsvRow(c, binder));
    await sleep(120);
  }

  // Shuffle rows so binders are interleaved
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }

  const header = '"Scryfall ID","Name","Set Code","Set Name","Collector Number","Rarity","Foil Type","Quantity","Binder Name","Condition","Purchase Price"';
  fs.writeFileSync(OUTPUT, [header, ...rows].join('\n'), 'utf8');
  console.log(`\nWrote ${rows.length} cards to ${OUTPUT}`);
}

main().catch(console.error);
