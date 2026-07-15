import { describe, expect, it } from 'vitest';
import {
  buildOpenedProductCards,
  buildOwnedCardFromCatalog,
  catalogFinishOptions,
  catalogPrice,
  planCardImport,
} from '../src/renderer-js/acquisition.js';

const printing = (id, name, prices = { usd: '10.00', usd_foil: '20.00' }) => ({
  id,
  name,
  set: 'sld',
  set_name: 'Secret Lair Drop',
  collector_number: id,
  rarity: 'rare',
  lang: 'en',
  finishes: ['nonfoil', 'foil'],
  prices,
});

describe('catalog acquisition', () => {
  it('exposes only supported finishes and their matching prices', () => {
    const card = printing('1', 'Sol Ring');
    expect(catalogFinishOptions(card)).toEqual(['normal', 'foil']);
    expect(catalogPrice(card, 'normal')).toBe(10);
    expect(catalogPrice(card, 'foil')).toBe(20);
  });

  it('builds an owned row for the exact printing with acquisition metadata', () => {
    const owned = buildOwnedCardFromCatalog(printing('ABC', 'Arcane Signet'), {
      id: 'owned-1', quantity: 2, foil: 'foil', binderName: 'Commander',
      purchasePrice: 4.5, acquiredAt: '2026-07-15',
    });
    expect(owned).toMatchObject({
      id: 'owned-1', scryfallId: 'abc', name: 'Arcane Signet', setCode: 'sld',
      quantity: 2, foil: 'foil', binderName: 'Commander', purchasePrice: 4.5,
      acquiredAt: '2026-07-15', status: 'owned',
    });
  });
});

describe('repeat-import planning', () => {
  const existing = [
    { id: 'manual', name: 'Manual card', scryfallId: 'manual-sid', foil: 'normal', binderName: 'A', manaboxId: '', status: 'owned' },
    { id: 'keep-id', name: 'Old name', scryfallId: 'sid-1', foil: 'normal', binderName: 'A', manaboxId: 'mb-1', quantity: 1, status: 'owned' },
    { id: 'remove-id', name: 'Absent export row', scryfallId: 'sid-2', foil: 'normal', binderName: 'A', manaboxId: 'mb-2', status: 'owned' },
    { id: 'sold-id', name: 'Sold history', scryfallId: 'sid-3', foil: 'normal', binderName: 'A', manaboxId: 'mb-3', status: 'sold' },
  ];
  const incoming = [
    { id: 'throwaway', name: 'Updated name', scryfallId: 'sid-1', foil: 'normal', binderName: 'A', manaboxId: 'mb-1', quantity: 4 },
    { id: 'new-id', name: 'New export row', scryfallId: 'sid-4', foil: 'normal', binderName: 'A', manaboxId: 'mb-4', quantity: 1 },
  ];

  it('merge updates matches without deleting absent rows', () => {
    const plan = planCardImport(existing, incoming, 'merge');
    expect(plan.stats).toEqual({ added: 1, updated: 1, removed: 0, imported: 2 });
    expect(plan.nextCards.find(c => c.manaboxId === 'mb-1')).toMatchObject({ id: 'keep-id', quantity: 4, name: 'Updated name' });
    expect(plan.nextCards.some(c => c.id === 'remove-id')).toBe(true);
  });

  it('reconcile replaces only live ManaBox rows and preserves manual/sold records', () => {
    const plan = planCardImport(existing, incoming, 'reconcile');
    expect(plan.stats).toEqual({ added: 1, updated: 1, removed: 1, imported: 2 });
    expect(plan.removedCards.map(c => c.id)).toEqual(['remove-id']);
    expect(plan.nextCards.some(c => c.id === 'manual')).toBe(true);
    expect(plan.nextCards.some(c => c.id === 'sold-id')).toBe(true);
    expect(plan.nextCards.find(c => c.manaboxId === 'mb-1').id).toBe('keep-id');
    expect(plan.managedCards.map(c => c.manaboxId).sort()).toEqual(['mb-1', 'mb-4']);
  });
});

describe('opened-product cost allocation', () => {
  it('allocates one product cost across exact printings and records provenance', () => {
    const cards = [
      printing('a', 'Card A', { usd: '10.00' }),
      printing('b', 'Card B', { usd: '30.00' }),
    ];
    let n = 0;
    const opened = buildOpenedProductCards(cards, {
      idFactory: () => `row-${++n}`,
      productUnitCost: 40,
      quantity: 2,
      binderName: 'Opened',
      acquiredAt: '2026-07-15',
      sourceProductId: 'product-1',
      sourceProductName: 'A Drop',
      allocation: 'market',
    });
    expect(opened).toHaveLength(2);
    expect(opened.reduce((sum, c) => sum + c.purchasePrice, 0)).toBeCloseTo(40, 4);
    expect(opened.map(c => c.purchasePrice)).toEqual([10, 30]);
    expect(opened.every(c => c.quantity === 2 && c.sourceProductId === 'product-1')).toBe(true);
    expect(opened.every(c => c.sourceProductName === 'A Drop' && c.acquiredAt === '2026-07-15')).toBe(true);
  });
});
