import { describe, it, expect } from 'vitest';
import { finishGroup, buildSlModel, projectLegacy } from '../src/renderer-js/slData.js';

describe('finishGroup', () => {
  it('maps collection foil values to the model vocabulary', () => {
    expect(finishGroup('normal')).toBe('nonfoil');
    expect(finishGroup(undefined)).toBe('nonfoil');
    expect(finishGroup('foil')).toBe('foil');
    expect(finishGroup('etched')).toBe('etched');
  });
});

// A tiny synthetic MTGJSON SLD shape exercising both foil regimes without a
// network fetch: Regime A (separate ★ foil printing, own scryfall id) and
// Regime B would need shared uuids — here we cover A + a subset-only base.
function fixture() {
  return {
    data: {
      cards: [
        { name: 'Goblin Lackey', number: '1311', finishes: ['nonfoil'], subsets: ["Goblin & Squabblin'"],
          uuid: 'u-base', identifiers: { scryfallId: 'sid-base' } },
        { name: 'Goblin Lackey', number: '1311★', finishes: ['foil'], uuid: 'u-star',
          identifiers: { scryfallId: 'sid-star' } },   // no subset — the ★ foil
      ],
      tokens: [],
      decks: [
        { name: "Goblin & Squabblin'", mainBoard: [{ uuid: 'u-base', count: 1 }] },
        { name: "Goblin & Squabblin' Foil Edition", mainBoard: [{ uuid: 'u-star', count: 1, isFoil: true }] },
      ],
      sealedProduct: [
        { subtype: 'secret_lair', name: 'Secret Lair Drop Goblin and Squabblin', uuid: 'p-base',
          identifiers: { tcgplayerProductId: '501841' }, contents: { deck: [{ name: "Goblin & Squabblin'" }] } },
        { subtype: 'secret_lair', name: 'Secret Lair Drop Goblin and Squabblin Foil', uuid: 'p-foil',
          identifiers: { tcgplayerProductId: '501840' }, contents: { deck: [{ name: "Goblin & Squabblin' Foil Edition" }] } },
      ],
    },
  };
}

describe('buildSlModel — finish-aware products', () => {
  const model = buildSlModel(fixture());
  const byLegacy = new Map(model.products.map(p => [p.legacyDrop, p]));

  it('creates a base product and a foil product for the drop', () => {
    const base = byLegacy.get("Goblin & Squabblin'");
    const foil = [...byLegacy.values()].find(p => p.dropName === "Goblin & Squabblin'" && p.finishLabel);
    expect(base).toBeTruthy();
    expect(foil).toBeTruthy();
    expect(base.finish).toBe('nonfoil');
    expect(foil.finish).toBe('foil');
  });

  it('gives the base and foil products disjoint scryfall ids (Regime A)', () => {
    const base = byLegacy.get("Goblin & Squabblin'");
    const foil = [...byLegacy.values()].find(p => p.finishLabel);
    const baseIds = new Set(base.cards.map(c => c.scryfallId));
    expect(foil.cards.every(c => !baseIds.has(c.scryfallId))).toBe(true);
    expect(foil.cards[0].number).toContain('★');
    expect(foil.cards.every(c => c.finish === 'foil')).toBe(true);
  });

  it('carries the TCGplayer product id per SKU', () => {
    expect(byLegacy.get("Goblin & Squabblin'").tcgplayerProductId).toBe('501841');
    expect([...byLegacy.values()].find(p => p.finishLabel).tcgplayerProductId).toBe('501840');
  });
});

describe('projectLegacy — name-keyed maps for the renderer', () => {
  const model = buildSlModel(fixture());
  const legacy = projectLegacy(model);

  it('emits one legacy drop per product', () => {
    expect(Object.keys(legacy.dropCards).length).toBe(model.products.length);
  });
  it("routes the ★ printing's primary drop to the foil SKU", () => {
    expect(legacy.scryfallToDrops['sid-star'][0]).toBe("Goblin & Squabblin' Foil");
  });
  it("routes the base printing's primary drop to the base SKU", () => {
    expect(legacy.scryfallToDrops['sid-base'][0]).toBe("Goblin & Squabblin'");
  });
});
