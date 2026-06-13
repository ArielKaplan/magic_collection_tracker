// scripts/sl-build/reconcile.js  (v2 — name-keyed, wiki overlay)
//
// MTGJSON `subsets` already maps drop -> cards (it's what the live app uses), so
// we DON'T re-derive that. This script generates only the broken layer: the
// superdrop grouping. It takes the authoritative list of drop names from MTGJSON,
// dates each drop from Scryfall `released_at`, and overlays the superdrop + date
// from the wiki (2019-2024) or a release-month table (2025+).
//
// Output:
//   out/superdrops.json  — [{ superdrop, date, drops:[name...] }] ordered by date
//   out/report.md        — coverage, 2025+ drops needing names, collisions, stale wiki rows
//
// Run: node scripts/sl-build/reconcile.js   (after fetch-sources.js)

const fs = require('fs');
const path = require('path');
const CACHE = path.join(__dirname, 'cache');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const load = (f) => JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8'));

const baseNum = (n) => { const m = String(n || '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
const cleanName = (s) => String(s || '').replace(/'{2,}/g, '').replace(/\[\[|\]\]/g, '').trim(); // strip wiki italic/link markup
const norm = (s) => cleanName(s).toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
// MTGJSON drop names that differ from the wiki's spelling (MTGJSON canonical -> wiki spelling)
const DROP_ALIAS = {
  'Dungeons & Dragons: Honor Among Thieves': 'D&D: Honor Among Thieves',
};
// try exact, then strip a trailing " - Extra Life YYYY" (MTGJSON adds it), then alias
const matchWiki = (wiki, name) => {
  for (const t of [norm(name), norm(name.replace(/\s*-\s*Extra Life \d+$/i, '')), norm(DROP_ALIAS[name] || '')]) {
    if (t && wiki.has(t)) return wiki.get(t);
  }
  return null;
};
const mode = (arr) => { const m = {}; let best = null, bc = 0; for (const x of arr) { if (!x) continue; m[x] = (m[x] || 0) + 1; if (m[x] > bc) { bc = m[x]; best = x; } } return best; };

// 2025+ / Dec-2019 superdrop naming (wiki doesn't cover these). release-month -> name.
// SEEDED from the existing dataset + known WotC calendar; flagged needsReview in report.
const SUPERDROP_BY_MONTH = {
  '2019-12': 'December 2019',
  '2025-01': 'Lunar Lair (Year of the Snake)',
  '2025-02': 'Aetherdrift Superdrop',
  '2025-03': 'Roll for Initiative Superdrop',
  '2025-04': 'Tarkir: Dragonstorm Superdrop',
  '2025-05': 'Spring Superdrop 2025',
  '2025-06': 'Final Fantasy Superdrop',
  '2025-07': 'Final Fantasy Superdrop',
  '2025-08': 'Edge of Eternities Superdrop',
  '2025-09': 'Back to School Superdrop',
  '2025-10': 'Spider-Man Superdrop',
  '2025-11': 'Secretversary Superdrop 2025',
  '2025-12': 'Secretversary Superdrop 2025',
  '2026-01': 'Winter Superdrop 2026',
};

// ── MTGJSON: authoritative drop names + their cards' collector numbers ───────
const mtgCards = load('mtgjson-sld.json').data.cards;
const drops = new Map(); // normName -> { name, sids:Set, bases:[] }
for (const c of mtgCards) {
  const sid = (c.identifiers?.scryfallId || '').toLowerCase();
  const base = baseNum(c.number);
  for (const d of c.subsets || []) {
    const k = norm(d);
    if (!drops.has(k)) drops.set(k, { name: d, sids: new Set(), bases: [] });
    const e = drops.get(k);
    if (sid) e.sids.add(sid);
    if (base != null) e.bases.push(base);
  }
}

// ── Scryfall: scryfallId -> released_at; date each drop (mode across its cards) ─
const scry = load('scryfall-sld.json');
const dateById = new Map();
for (const c of scry) dateById.set((c.id || '').toLowerCase(), c.released_at);
for (const e of drops.values()) {
  e.date = mode([...e.sids].map((s) => dateById.get(s))) || null;
}

// ── Wiki: normName -> [{ superdrop, date, lo, hi }] (collisions kept as array) ─
const wt = fs.readFileSync(path.join(CACHE, 'mtgwiki-dropseries.wikitext'), 'utf8');
const body = wt.slice(wt.indexOf('=Drop list='), wt.indexOf('====Artist Series===='));
const wiki = new Map();
const wikiRows = [];
for (const b of body.split(/\n\|-/)) {
  let superdrop = null, drop = null;
  let m;
  if ((m = b.match(/\{\{SLD\|([^|}]+)\|([^|}]+)\}\}/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
  else if ((m = b.match(/\{\{SLC\|([^|}]+)\|([^|}]+)\}\}/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
  else if ((m = b.match(/\[\[Secret Lair Drop Series \(([^)]+)\)\|([^|\]]+)\]\]/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); } // parenthetical superdrop (Dec 2019)
  else if ((m = b.match(/\[\[Secret Lair Drop Series:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
  else if ((m = b.match(/\[\[Secret Lair Commander Deck:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { drop = cleanName(m[2]); superdrop = null; }
  else if ((m = b.match(/\{\{SLD\|([^|}]+)\}\}/))) { drop = cleanName(m[1]); }
  else if ((m = b.match(/\{\{SLC\|([^|}]+)\}\}/))) { drop = cleanName(m[1]); } // SLC single-arg = standalone special/commander drop
  else if ((m = b.match(/\[\[Secret Lair:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { drop = cleanName(m[2]); superdrop = null; } // bare = standalone drop
  else if ((m = b.match(/\[\[Secret Lair Drop Series:\s*([^|\]]+)\]\]/))) { drop = cleanName(m[1]); superdrop = null; } // no-pipe = standalone drop
  if (!drop) continue;
  const dateM = b.match(/(\d{4}-\d{2}-\d{2})/);
  let lo = null, hi = null;
  for (const r of b.matchAll(/(\d{2,4})\s*-\s*(\d{2,4})/g)) { const a = +r[1], z = +r[2]; if (a > z || z - a > 60) continue; if (lo == null || a < lo) lo = a; if (hi == null || z > hi) hi = z; }
  const row = { drop, superdrop, date: dateM ? dateM[1] : null, lo, hi };
  wikiRows.push(row);
  const k = norm(drop);
  if (!wiki.has(k)) wiki.set(k, []);
  wiki.get(k).push(row);
}

// ── Resolve each MTGJSON drop -> superdrop + date ────────────────────────────
const collisions = [];
const usedRows = new Set();
const resolved = []; // { name, superdrop, date, source, needsReview }
for (const [k, e] of drops) {
  const rows = matchWiki(wiki, e.name);
  let superdrop, date, source, needsReview = false;
  if (rows && rows.length === 1) {
    superdrop = rows[0].superdrop; date = rows[0].date || e.date; source = 'wiki'; usedRows.add(rows[0]);
  } else if (rows && rows.length > 1) {
    // name collision: split by collector range against this drop's card numbers
    const lo = Math.min(...e.bases), hi = Math.max(...e.bases);
    const pick = rows.find((r) => r.lo != null && lo >= r.lo - 2 && hi <= r.hi + 2) || rows[0];
    superdrop = pick.superdrop; date = pick.date || e.date; source = 'wiki(collision)'; usedRows.add(pick);
    collisions.push({ name: e.name, superdrops: rows.map((r) => `${r.superdrop} [${r.date}]`), picked: superdrop, cardNums: `${lo}-${hi}` });
  } else {
    // not in wiki -> 2025+/Dec-2019: name by release month
    date = e.date;
    const ym = date ? date.slice(0, 7) : null;
    superdrop = (ym && SUPERDROP_BY_MONTH[ym]) || (ym ? `Unknown ${ym}` : 'Unknown');
    source = 'month'; needsReview = true;
  }
  resolved.push({ name: e.name, superdrop: superdrop || null, date, source, needsReview, cards: e.sids.size });
}

// ── Assemble superdrop grouping (ordered by date) ───────────────────────────
const byKey = new Map(); // superdrop||standalone -> { superdrop, date, drops:[] }
for (const r of resolved) {
  const key = r.superdrop || `standalone:${r.name}`;
  if (!byKey.has(key)) byKey.set(key, { superdrop: r.superdrop, date: r.date, drops: [] });
  const g = byKey.get(key);
  g.drops.push(r.name);
  if (r.date && (!g.date || r.date < g.date)) g.date = r.date; // earliest member date
}
const superdrops = [...byKey.values()].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
superdrops.forEach((s) => s.drops.sort());

fs.writeFileSync(path.join(OUT, 'superdrops.json'), JSON.stringify(superdrops, null, 2));

// ── Report ──────────────────────────────────────────────────────────────────
const wikiResolved = resolved.filter((r) => r.source.startsWith('wiki')).length;
const monthResolved = resolved.filter((r) => r.source === 'month');
const usedWikiNames = new Set(resolved.filter(r => r.source.startsWith('wiki')).map(r => norm(r.name)));
const staleWiki = wikiRows.filter((r) => !usedRows.has(r));

const R = [];
R.push('# Secret Lair superdrop grouping — report', '');
R.push(`- MTGJSON drops: **${drops.size}**`);
R.push(`- Resolved via wiki: **${wikiResolved}**   ·   via release-month (2025+/Dec2019): **${monthResolved.length}**`);
R.push(`- Superdrops + standalones: **${superdrops.length}**`);
R.push(`- Name collisions (same drop name, 2+ superdrops): **${collisions.length}**`);
R.push(`- Wiki rows with no MTGJSON match (specials/typos/not-yet-in-MTGJSON): **${staleWiki.length}**`, '');

R.push(`## ⚠️ Drops needing superdrop confirmation (${monthResolved.length}) — 2025+ & Dec 2019`, '');
const bySd = {};
for (const r of monthResolved) (bySd[r.superdrop] ||= []).push(r);
for (const [sd, rs] of Object.entries(bySd).sort((a, b) => (a[1][0].date||'').localeCompare(b[1][0].date||''))) {
  R.push(`### ${sd}  _(${rs.length} drops)_`);
  for (const r of rs.sort((a, b) => (a.date||'').localeCompare(b.date||''))) R.push(`- [${r.date || '?'}] ${r.name} (${r.cards} cards)`);
  R.push('');
}

R.push(`## Name collisions resolved by collector range (${collisions.length})`, '');
for (const c of collisions) R.push(`- **${c.name}** (#${c.cardNums}) ∈ {${c.superdrops.join(', ')}} → picked **${c.picked}**`);
R.push('');

R.push(`## Wiki rows not found in MTGJSON (${staleWiki.length}) — review for typos/specials`, '');
for (const r of staleWiki.slice(0, 80)) R.push(`- "${r.drop}" — ${r.superdrop || '(standalone)'} [${r.date}]`);
R.push('');

fs.writeFileSync(path.join(OUT, 'report.md'), R.join('\n'));

// ── stdout ───────────────────────────────────────────────────────────────────
console.log(`MTGJSON drops: ${drops.size}`);
console.log(`resolved: wiki=${wikiResolved}  month=${monthResolved.length}  | superdrops=${superdrops.length}  collisions=${collisions.length}  staleWiki=${staleWiki.length}`);
console.log('\n--- 2025+/Dec2019 superdrops (needs confirm) ---');
for (const [sd, rs] of Object.entries(bySd).sort((a, b) => (a[1][0].date||'').localeCompare(b[1][0].date||''))) {
  console.log(`  ${(rs[0].date||'?').slice(0,7)}  ${sd.padEnd(34)} ${rs.length} drops`);
}
console.log('\n--- collisions ---');
collisions.forEach(c => console.log(`  ${c.name}  -> ${c.picked}  (of ${c.superdrops.join(' | ')})`));
