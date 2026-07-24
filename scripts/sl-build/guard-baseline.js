// scripts/sl-build/guard-baseline.js
// Compares a freshly emitted Secret Lair baseline against the previous bake.
// Exits 0 when the refresh looks routine (data grew or held steady) and 1 when
// it shrank — the signal that an upstream source (MTGJSON / Scryfall / mtg.wiki)
// regressed and a human should review the change as a PR instead of auto-merging.
//
// Usage:
//   node guard-baseline.js <old-secretlair.js> <old-seed.json> <new-secretlair.js> <new-seed.json>
const fs = require('fs');
const vm = require('vm');

const [oldJs, oldSeed, newJs, newSeed] = process.argv.slice(2);
if (!oldJs || !oldSeed || !newJs || !newSeed) {
  console.error('Usage: node guard-baseline.js <old-secretlair.js> <old-seed.json> <new-secretlair.js> <new-seed.json>');
  process.exit(2);
}

// Same vm-sandbox trick as smoke-secretlair.js: the file only declares data and
// computes maps at top level, so it loads without a DOM.
function baselineCounts(file) {
  let src = fs.readFileSync(file, 'utf8');
  src += '\nglobalThis.__SL = { SL_SUPERDROPS, SL_DROP_CARDS, SL_SCRYFALL_TO_NAME };';
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: file });
  return {
    superdrops: ctx.__SL.SL_SUPERDROPS.length,
    drops: Object.keys(ctx.__SL.SL_DROP_CARDS).length,
    printings: Object.keys(ctx.__SL.SL_SCRYFALL_TO_NAME).length,
  };
}

function seedSeriesCount(file) {
  return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).series || {}).length;
}

const before = baselineCounts(oldJs);
const after = baselineCounts(newJs);
const seedBefore = seedSeriesCount(oldSeed);
const seedAfter = seedSeriesCount(newSeed);

console.log(
  `superdrops ${before.superdrops} -> ${after.superdrops}, ` +
  `drops ${before.drops} -> ${after.drops}, ` +
  `printings ${before.printings} -> ${after.printings}, ` +
  `seed series ${seedBefore} -> ${seedAfter}`
);

// Secret Lairs are never delisted, so the catalog should only grow. The
// reviewed seed may legitimately prune the odd series; beyond 2% it reads as an
// upstream AllPrices regression.
const reasons = [];
for (const key of ['superdrops', 'drops', 'printings']) {
  if (after[key] < before[key]) reasons.push(`- ${key} decreased: ${before[key]} -> ${after[key]}`);
}
if (seedAfter < Math.floor(seedBefore * 0.98)) {
  reasons.push(`- price-seed series shrank more than 2%: ${seedBefore} -> ${seedAfter}`);
}

if (reasons.length) {
  console.log(reasons.join('\n'));
  process.exit(1);
}
