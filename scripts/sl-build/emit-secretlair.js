// scripts/sl-build/emit-secretlair.js
// Full static bake: regenerates the DATA literals inside src/renderer/secretlair.js
// from the reconciled sources. Leaves all runtime CODE (computed maps + functions)
// untouched — only the four generated consts are spliced in place:
//   SL_SUPERDROPS, SL_DROP_CARDS, SL_SCRYFALL_TO_DROPS, SL_SCRYFALL_TO_NAME
//
// Run order:  fetch-sources.js → reconcile.js → emit-secretlair.js
//
// Foil/variant backfill mirrors src/renderer-js/slTab.js: printings MTGJSON didn't
// tag in `subsets` inherit the drop(s) of the regular printing sharing their base
// collector number + name.

const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'cache');
const OUT = path.join(__dirname, 'out');
const TARGET = path.join(__dirname, '..', '..', 'src', 'renderer', 'secretlair.js');
const load = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

const baseNum = (n) => { const m = String(n || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };

// ── Inputs ──────────────────────────────────────────────────────────────────
const mtg = load('mtgjson-sld.json').data.cards;
const superdropsRaw = JSON.parse(fs.readFileSync(path.join(OUT, 'superdrops.json'), 'utf8'));

// ── scryfallId → drops, with foil/variant backfill ──────────────────────────
const scryfallToDrops = {};   // id -> [drop, ...]   (only ids with ≥1 drop)
const scryfallToName = {};    // id -> name          (every printing)
const scryfallToNumber = {};  // id -> collector number string (e.g. "1485", "1485★")
const baseKeyToDrops = {};    // `${base}|${name}` -> Set(drop)

for (const c of mtg) {
  const sid = (c.identifiers?.scryfallId || '').toLowerCase();
  if (!sid) continue;
  scryfallToName[sid] = c.name;
  if (c.number) scryfallToNumber[sid] = c.number;
  const subs = c.subsets || [];
  if (subs.length) scryfallToDrops[sid] = [...subs];
  const base = baseNum(c.number);
  if (base != null && subs.length) {
    const key = `${base}|${c.name}`;
    (baseKeyToDrops[key] ||= new Set());
    for (const d of subs) baseKeyToDrops[key].add(d);
  }
}
let backfilled = 0;
for (const c of mtg) {
  const sid = (c.identifiers?.scryfallId || '').toLowerCase();
  if (!sid || (scryfallToDrops[sid] && scryfallToDrops[sid].length)) continue;
  const base = baseNum(c.number);
  if (base == null) continue;
  const drops = baseKeyToDrops[`${base}|${c.name}`];
  if (drops && drops.size) { scryfallToDrops[sid] = [...drops]; backfilled++; }
}

// ── drop → sorted unique card names ─────────────────────────────────────────
const dropCards = {};
for (const [sid, drops] of Object.entries(scryfallToDrops)) {
  const name = scryfallToName[sid];
  for (const d of drops) {
    (dropCards[d] ||= new Set());
    if (name) dropCards[d].add(name);
  }
}
const dropCardsArr = {};
for (const d of Object.keys(dropCards).sort()) dropCardsArr[d] = [...dropCards[d]].sort();

// ── SL_SUPERDROPS: named superdrops + standalone drops (self-named) ─────────
// Standalone drops (no superdrop in the wiki) become single-drop superdrops named
// after the drop, so every drop has a home and sorts into the date timeline.
const superdrops = superdropsRaw
  .map((s) => ({
    superdrop: s.superdrop || s.drops[0],
    date: (s.date || '').slice(0, 7),       // YYYY-MM for display
    drops: [...s.drops].sort(),
  }))
  .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.superdrop.localeCompare(b.superdrop));

// ── Formatting helpers (valid, escaped JS via JSON.stringify) ───────────────
const q = (s) => JSON.stringify(s);
const supLit = '[\n' + superdrops.map((s) =>
  `  { superdrop: ${q(s.superdrop)}, date: ${q(s.date)}, drops: ${q(s.drops)} },`).join('\n') + '\n]';
const dropCardsLit = '{\n' + Object.entries(dropCardsArr).map(([d, cards]) =>
  `  ${q(d)}: ${q(cards)},`).join('\n') + '\n}';
const s2dLit = '{\n' + Object.keys(scryfallToDrops).sort().map((id) =>
  `  ${q(id)}: ${q(scryfallToDrops[id])},`).join('\n') + '\n}';
const s2nLit = '{\n' + Object.keys(scryfallToName).sort().map((id) =>
  `  ${q(id)}: ${q(scryfallToName[id])},`).join('\n') + '\n}';
const s2numLit = '{\n' + Object.keys(scryfallToNumber).sort().map((id) =>
  `  ${q(id)}: ${q(scryfallToNumber[id])},`).join('\n') + '\n}';

const totalCards = Object.keys(scryfallToName).length;
const mappedCards = Object.keys(scryfallToDrops).length;
const header =
`// secretlair.js — Static Secret Lair dataset (GENERATED — do not hand-edit the data blocks)
// Regenerated ${new Date().toISOString().slice(0, 10)} by scripts/sl-build/emit-secretlair.js
// Sources: MTGJSON SLD.json (drop↔cards) · Scryfall set:sld (dates) · mtg.wiki Drop Series (grouping)
// ${superdrops.length} superdrops/standalones · ${Object.keys(dropCardsArr).length} drops · ${totalCards} printings (${mappedCards} drop-mapped, ${backfilled} foil-backfilled)
// Runtime code below the data blocks is hand-maintained.

`;

// ── Splice into secretlair.js ───────────────────────────────────────────────
let src = fs.readFileSync(TARGET, 'utf8');
const before = src.length;
const replace = (re, lit, label) => {
  if (!re.test(src)) throw new Error(`anchor not found: ${label}`);
  src = src.replace(re, () => lit);
};
replace(/^[\s\S]*?(?=const SL_SUPERDROPS = \[)/, header, 'header');
replace(/const SL_SUPERDROPS = \[[\s\S]*?\n\];/, `const SL_SUPERDROPS = ${supLit};`, 'SL_SUPERDROPS');
replace(/const SL_DROP_CARDS = \{[\s\S]*?\n\};/, `const SL_DROP_CARDS = ${dropCardsLit};`, 'SL_DROP_CARDS');
replace(/const SL_SCRYFALL_TO_DROPS = \{[\s\S]*?\n\};/, `const SL_SCRYFALL_TO_DROPS = ${s2dLit};`, 'SL_SCRYFALL_TO_DROPS');
replace(/const SL_SCRYFALL_TO_NAME = \{[\s\S]*?\n\};(\s*const SL_SCRYFALL_TO_NUMBER = \{[\s\S]*?\n\};)?/,
  `const SL_SCRYFALL_TO_NAME = ${s2nLit};\n\nconst SL_SCRYFALL_TO_NUMBER = ${s2numLit};`,
  'SL_SCRYFALL_TO_NAME + SL_SCRYFALL_TO_NUMBER');

fs.writeFileSync(TARGET, src);
console.log(`wrote ${path.relative(process.cwd(), TARGET)}`);
console.log(`  superdrops: ${superdrops.length} (named ${superdropsRaw.filter(s=>s.superdrop).length} + standalone ${superdropsRaw.filter(s=>!s.superdrop).length})`);
console.log(`  drops: ${Object.keys(dropCardsArr).length} | printings: ${totalCards} | mapped: ${mappedCards} | foil-backfilled: ${backfilled}`);
console.log(`  file size: ${before} -> ${src.length} bytes`);
