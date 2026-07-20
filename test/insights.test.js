import { describe, expect, it } from 'vitest';
import {
  filterReportRows,
  preconBuildCandidate,
  savedDeckBuildCandidate,
  scanOpportunities,
} from '../src/renderer-js/insightsModel.js';

const history = (sid, finish, ...prices) => ({
  [`${sid}|${finish}`]: prices.map((price, i) => ({ date: `2026-07-${String(i + 1).padStart(2, '0')}`, price })),
});

describe('What can I build?', () => {
  it('uses any printing by name for saved decks and consumes quantities once', () => {
    const deck = {
      id: 'd1', name: 'Test deck', format: 'commander',
      cards: [
        { name: 'Sol Ring', scryfallId: 'wanted-print', foil: 'normal', quantity: 1, board: 'main' },
        { name: 'Sol Ring', scryfallId: 'wanted-print', foil: 'normal', quantity: 1, board: 'side' },
      ],
    };
    const cards = [{ name: 'Sol Ring', scryfallId: 'different-print', foil: 'foil', quantity: 1, status: 'owned' }];
    const result = savedDeckBuildCandidate(deck, cards, history('wanted-print', 'normal', 2));
    expect(result).toMatchObject({ total: 2, owned: 1, missing: 1, completion: 50, missingValue: 2, pricedMissing: 1 });
  });

  it('requires exact printing, finish, and count for precon readiness', () => {
    const deck = { file: 'precon-1', name: 'Exact deck', type: 'Commander Deck' };
    const rows = [
      { sid: 'same-id', finish: 'foil', count: 2, board: 'main' },
      { sid: 'token-id', finish: 'nonfoil', count: 1, board: 'token' },
    ];
    const cards = [
      { name: 'Card', scryfallId: 'same-id', foil: 'foil', quantity: 1, status: 'owned' },
      { name: 'Card', scryfallId: 'same-id', foil: 'normal', quantity: 5, status: 'owned' },
    ];
    const result = preconBuildCandidate(deck, rows, cards, history('same-id', 'foil', 8));
    expect(result).toMatchObject({ total: 2, owned: 1, missing: 1, completion: 50, missingValue: 8 });
  });

  it('can separately answer playable precon readiness using any printing by name', () => {
    const deck = { file: 'precon-2', name: 'Playable deck', type: 'Commander Deck' };
    const rows = [{ sid: 'exact-id', name: 'Arcane Signet', finish: 'foil', count: 1, board: 'main' }];
    const cards = [{ name: 'Arcane Signet', scryfallId: 'other-id', foil: 'normal', quantity: 1, status: 'owned' }];
    const result = preconBuildCandidate(deck, rows, cards, {}, { match: 'playable' });
    expect(result).toMatchObject({ total: 1, owned: 1, missing: 0, completion: 100, match: 'playable' });
  });
});

describe('Opportunity scanner', () => {
  it('surfaces transparent target, duplicate, mover, and exact fully-priced SL spread rules', () => {
    const priceHistory = {
      ...history('want-id', 'normal', 9),
      ...history('dup-id', 'normal', 12),
      ...history('move-id', 'normal', 10, 18),
      ...history('sl-a', 'normal', 30),
      ...history('sl-b', 'normal', 20),
    };
    const results = scanOpportunities({
      cards: [
        { id: 'dup', name: 'Spare Card', scryfallId: 'dup-id', foil: 'normal', quantity: 3, status: 'owned' },
        { id: 'move', name: 'Mover', scryfallId: 'move-id', foil: 'normal', quantity: 1, status: 'owned' },
      ],
      decks: [{ cards: [{ name: 'Spare Card', quantity: 1 }] }],
      wantList: [{ id: 'w1', name: 'Wanted', scryfallId: 'want-id', foil: 'normal', maxPrice: 10 }],
      priceHistory,
      slProducts: [{
        legacyDrop: 'Exact SL', tcgplayerProductId: '42', lowConfidence: false,
        cards: [
          { scryfallId: 'sl-a', finish: 'nonfoil', count: 1 },
          { scryfallId: 'sl-b', finish: 'nonfoil', count: 1 },
        ],
      }],
      sealedCatalog: [{ productId: '42', marketPrice: 30 }],
    });
    expect(new Set(results.map(r => r.type))).toEqual(new Set(['want-target', 'duplicate', 'market-move', 'sealed-value']));
    expect(results.find(r => r.type === 'duplicate').details).toContain('largest requirement');
    expect(results.find(r => r.type === 'sealed-value').details).toContain('All 2 guaranteed');
  });

  it('does not surface a Secret Lair spread when any guaranteed copy is unpriced', () => {
    const results = scanOpportunities({
      priceHistory: history('sl-a', 'normal', 100),
      slProducts: [{ legacyDrop: 'Partial SL', tcgplayerProductId: '7', cards: [
        { scryfallId: 'sl-a', finish: 'nonfoil', count: 1 },
        { scryfallId: 'sl-missing', finish: 'nonfoil', count: 1 },
      ] }],
      sealedCatalog: [{ productId: '7', marketPrice: 10 }],
    });
    expect(results.some(r => r.type === 'sealed-value')).toBe(false);
  });
});

describe('User-defined reports', () => {
  it('combines query, numeric filters, sorting, and limits deterministically', () => {
    const rows = [
      { name: 'Alpha Commander', status: 'incomplete', completion: 95, missing: 5, value: 40 },
      { name: 'Beta Commander', status: 'incomplete', completion: 92, missing: 8, value: 20 },
      { name: 'Gamma Modern', status: 'incomplete', completion: 99, missing: 1, value: 10 },
    ];
    const result = filterReportRows(rows, {
      query: 'commander', status: 'incomplete', minCompletion: 90, maxMissing: 10,
      sort: 'value_desc', limit: 1,
    });
    expect(result.map(r => r.name)).toEqual(['Alpha Commander']);
  });
});
