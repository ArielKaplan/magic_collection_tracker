// scripts/precon-build/fetch-decks.js
// One-time/occasional downloader for the Precon Explorer dataset.
// Pulls MTGJSON's DeckList.json, filters to the in-scope preconstructed-deck
// types, and fetches each deck file into cache/decks/ (gitignored, resumable â€”
// already-cached decks are skipped, so incremental re-runs only fetch new ones).
//
// Run: node scripts/precon-build/fetch-decks.js
// Then: node scripts/precon-build/emit-seed.js

const fs = require('fs');
const path = require('path');

const CACHE = path.join(__dirname, 'cache');
const DECKS = path.join(CACHE, 'decks');
fs.mkdirSync(DECKS, { recursive: true });

const UA = 'ManaLedger/1.0 (https://github.com/sarcasticsoftwarestudio/magic_collection_tracker; sarcasticsoftwarestudio@gmail.com)';
const headers = { 'User-Agent': UA, 'Accept': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Physical preconstructed products someone can own and shelf. Excluded on
// purpose: Secret Lair Drop (the SL Explorer owns those), Jumpstart (570
// half-decks â€” later, behind a toggle), MTGO/Arena/Shandalar/DotP (digital),
// Sample/Demo/Welcome Booster (not real decklists), Deck Builder's Toolkit /
// Bundle Land Pack (not decks), SDCC promo sets (promo cards, not decks).
const SCOPE_TYPES = new Set([
  'Commander Deck', 'Theme Deck', 'Intro Pack', 'Duel Deck', 'Planeswalker Deck',
  'World Championship Deck', 'Challenger Deck', 'Pioneer Challenger Deck',
  'Event Deck', 'Starter Deck', 'Welcome Deck', 'Game Night Deck', 'Brawl Deck',
  'Guild Kit', 'Premium Deck', 'Archenemy Deck', 'Planechase Deck', 'Box Set',
  'Enhanced Deck', 'Advanced Deck', 'Advanced Pack', 'Clash Pack', 'Starter Kit',
  'Spellslinger Starter Kit', 'Pro Tour Deck', 'Modern Event Deck', 'Dandan Deck',
  'Jumpstart',   // 570 half-decks â€” hidden behind a toggle in the Explorer
]);

(async () => {
  process.stdout.write('MTGJSON DeckList.json â€¦ ');
  const r = await fetch('https://mtgjson.com/api/v5/DeckList.json', { headers });
  if (!r.ok) throw new Error(`DeckList HTTP ${r.status}`);
  const list = (await r.json()).data || [];
  fs.writeFileSync(path.join(CACHE, 'DeckList.json'), JSON.stringify(list));
  console.log(`ok â€” ${list.length} decks cataloged`);

  // SLD decks are the SL Explorer's turf â€” EXCEPT the Secret Lair Commander
  // decks (Goblin Storm, Heads I Winâ€¦, From Cute to Brute, â€¦), which straddle
  // both: the SL Explorer shows their SLD printings, the Precon Explorer the
  // full ~100-card playable deck.
  const scoped = list.filter(d => SCOPE_TYPES.has(d.type) && (d.code !== 'SLD' || d.type === 'Commander Deck'));
  console.log(`in scope: ${scoped.length} decks (${SCOPE_TYPES.size} types)`);

  let fetched = 0, cached = 0, failed = 0;
  const CONCURRENCY = 4;
  const queue = [...scoped];
  const worker = async () => {
    while (queue.length) {
      const d = queue.shift();
      const out = path.join(DECKS, d.fileName + '.json');
      if (fs.existsSync(out) && fs.statSync(out).size > 200) { cached++; continue; }
      try {
        const resp = await fetch(`https://mtgjson.com/api/v5/decks/${d.fileName}.json`, { headers });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        fs.writeFileSync(out, await resp.text());
        fetched++;
        if ((fetched + failed) % 50 === 0) console.log(`  â€¦ ${fetched} fetched, ${cached} cached, ${failed} failed, ${queue.length} left`);
      } catch (e) {
        failed++;
        console.error(`  FAIL ${d.fileName}: ${e.message}`);
      }
      await sleep(80);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\nDone: ${fetched} fetched, ${cached} already cached, ${failed} failed â†’ ${DECKS}`);
  if (failed > 0) process.exit(1);
})().catch(e => { console.error('FETCH FAILED:', e.message); process.exit(1); });
