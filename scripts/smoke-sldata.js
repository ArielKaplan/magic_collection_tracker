// smoke-sldata.js — exercises the finish-aware SL model builder (slData.js)
// against a real MTGJSON SLD.json fixture (scripts/sl-build/cache/, gitignored;
// run scripts/sl-build/fetch-sources.js first if missing).
//
// The two fixtures that matter — both foil regimes:
//   Regime A (separate ★ printings): Goblin & Squabblin' — the Foil Edition
//     deck references five ★ ids; base and foil products must NOT share ids.
//   Regime B (shared printing): Goblingram — foil deck references the same
//     uuids as base with isFoil:true; products share ids but differ in finish.
//
// Run: node scripts/smoke-sldata.js

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ok = (cond, label) => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
};

(async () => {
  const mod = await import('../src/renderer-js/slData.js');
  const { buildSlModel, projectLegacy, setSlProducts, slProductForDrop,
          requiredFinishFor, attributeDropFor, slDropModelFinish, finishGroup } = mod;

  const fixture = path.join(__dirname, 'sl-build', 'cache', 'mtgjson-sld.json');
  if (!fs.existsSync(fixture)) {
    console.error('Fixture missing: ' + fixture + ' — run node scripts/sl-build/fetch-sources.js');
    process.exit(1);
  }
  const json = JSON.parse(fs.readFileSync(fixture, 'utf8'));

  console.log('buildSlModel over the SLD fixture…');
  const model = buildSlModel(json);
  const byLegacy = new Map(model.products.map(p => [p.legacyDrop, p]));

  console.log('\n— shape sanity —');
  ok(model.products.length > 600, `products built (${model.products.length})`);
  ok(Object.keys(model.scryfallToName).length > 2400, `name map covers printings (${Object.keys(model.scryfallToName).length})`);
  const withTcg = model.products.filter(p => p.tcgplayerProductId).length;
  ok(withTcg > 600, `products carrying tcgplayerProductId (${withTcg})`);
  const orphanCards = json.data.cards.filter(c => {
    const sid = (c.identifiers?.scryfallId || '').toLowerCase();
    return sid && (c.subsets || []).length && !model.products.some(p => p.cards.some(x => x.scryfallId === sid));
  });
  ok(orphanCards.length === 0, `every subset-tagged printing is in some product (${orphanCards.length} orphans)`);

  console.log('\n— Regime A: Goblin & Squabblin\' (★ foil printings) —');
  const gsBase = byLegacy.get("Goblin & Squabblin'");
  const gsFoil = [...byLegacy.values()].find(p => p.dropName === "Goblin & Squabblin'" && p.finishLabel);
  ok(!!gsBase, 'base product exists');
  ok(!!gsFoil, `foil product exists (${gsFoil ? gsFoil.legacyDrop : '—'})`);
  if (gsBase && gsFoil) {
    ok(gsBase.finish === 'nonfoil', `base finish = nonfoil (${gsBase.finish})`);
    ok(gsFoil.finish === 'foil', `foil finish = foil (${gsFoil.finish})`);
    ok(gsBase.cards.length === 5 && gsFoil.cards.length === 5, `5 cards each (${gsBase.cards.length}/${gsFoil.cards.length})`);
    const baseIds = new Set(gsBase.cards.map(c => c.scryfallId));
    const foilIds = new Set(gsFoil.cards.map(c => c.scryfallId));
    ok([...foilIds].every(id => !baseIds.has(id)), 'base and foil products share NO scryfall ids');
    ok(gsFoil.cards.every(c => c.number.includes('★')), 'foil product holds the ★ printings');
    ok(gsFoil.cards.every(c => c.finish === 'foil'), 'foil product cards recorded as foil');
    ok(gsBase.cards.every(c => c.finish === 'nonfoil'), 'base product cards recorded as nonfoil');
    ok(!!gsFoil.tcgplayerProductId, `foil SKU keeps its tcgplayerProductId (${gsFoil.tcgplayerProductId})`);
  }

  console.log('\n— Regime B: Goblingram (shared printings, isFoil entries) —');
  const ggBase = byLegacy.get('Goblingram');
  const ggFoil = [...byLegacy.values()].find(p => p.dropName === 'Goblingram' && p.finishLabel);
  ok(!!ggBase && !!ggFoil, `both products exist (${ggFoil ? ggFoil.legacyDrop : '—'})`);
  if (ggBase && ggFoil) {
    const baseIds = new Set(ggBase.cards.map(c => c.scryfallId));
    const foilOnly = ggFoil.cards.filter(c => !c.number.includes('★'));
    ok(foilOnly.length > 0 && foilOnly.every(c => baseIds.has(c.scryfallId)), 'foil product references the same printings as base');
    ok(ggFoil.cards.every(c => c.finish === 'foil'), 'foil product cards recorded as foil');
    ok(ggBase.cards.filter(c => baseIds.has(c.scryfallId)).every(c => c.finish === 'nonfoil'), 'base product cards recorded as nonfoil');
  }

  console.log('\n— legacy projection —');
  const legacy = projectLegacy(model);
  ok(Object.keys(legacy.dropCards).length === model.products.length, `one legacy drop per product (${Object.keys(legacy.dropCards).length})`);
  if (gsFoil) {
    const starId = gsFoil.cards[0].scryfallId;
    const drops = legacy.scryfallToDrops[starId] || [];
    ok(drops[0] === gsFoil.legacyDrop, `★ printing's primary drop is the foil SKU (${drops[0]})`);
  }
  if (ggBase && ggFoil) {
    const sharedId = ggBase.cards[0].scryfallId;
    const drops = legacy.scryfallToDrops[sharedId] || [];
    ok(drops[0] === 'Goblingram', `shared printing's primary drop is the base (${drops[0]})`);
    ok(drops.includes(ggFoil.legacyDrop), 'shared printing also maps to the foil SKU');
  }

  console.log('\n— registry: ownership + attribution semantics —');
  setSlProducts(model.products);
  if (ggBase && ggFoil) {
    const sharedId = ggBase.cards[0].scryfallId;
    ok(requiredFinishFor('Goblingram', sharedId) === 'nonfoil', 'base drop requires a nonfoil copy');
    ok(requiredFinishFor(ggFoil.legacyDrop, sharedId) === 'foil', 'foil drop requires a foil copy');
    ok(attributeDropFor(sharedId, 'normal') === 'Goblingram', 'nonfoil copy attributes to base drop');
    ok(attributeDropFor(sharedId, 'foil') === ggFoil.legacyDrop, 'foil copy attributes to foil drop');
    ok(slDropModelFinish(ggFoil.legacyDrop) === 'foil', 'model finish for pricing = foil');
    ok(slDropModelFinish('Goblingram') === 'nonfoil', 'model finish for base = nonfoil');
  }
  if (gsFoil) {
    const starId = gsFoil.cards[0].scryfallId;
    ok(attributeDropFor(starId, 'foil') === gsFoil.legacyDrop, '★ foil copy attributes to the foil SKU');
    ok(requiredFinishFor("Goblin & Squabblin'", starId) === null, '★ id is unknown to the base drop (no cross-lighting)');
  }
  ok(finishGroup('normal') === 'nonfoil' && finishGroup('foil') === 'foil' && finishGroup('etched') === 'etched', 'finishGroup mapping');

  console.log('\n— foil-only base SKUs (no finish label, foil contents) —');
  const eldraine = byLegacy.get('Eldraine Wonderland');
  ok(!!eldraine, 'Eldraine Wonderland product exists');
  if (eldraine) ok(eldraine.finish === 'foil', `foil-only drop detected as foil from contents (${eldraine.finish})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE CRASHED:', e); process.exit(1); });
