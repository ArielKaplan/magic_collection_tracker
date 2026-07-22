import { beforeEach, describe, expect, it } from 'vitest';
import { collection, makeCollection } from '../src/renderer-js/state.js';
import { realizedGains, topMovers } from '../src/renderer-js/analytics.js';

beforeEach(() => {
  Object.assign(collection, makeCollection());
});

describe('range-aware dashboard analytics', () => {
  it('limits realized gains relative to the latest recorded sale', () => {
    collection.cards = [
      { id: 'older', status: 'sold', disposedAt: '2026-01-01', quantity: 1, purchasePrice: 5, salePrice: 10 },
      { id: 'recent', status: 'sold', disposedAt: '2026-03-31', quantity: 1, purchasePrice: 10, salePrice: 30 },
    ];

    expect(realizedGains().gain).toBe(25);
    expect(realizedGains(30)).toMatchObject({ count: 1, gain: 20 });

    collection.portfolioSnapshots = [{ date: '2026-04-30' }];
    expect(realizedGains(30)).toMatchObject({ count: 0, gain: 0 });
  });

  it('compares the first and last quotes inside the selected mover range', () => {
    collection.cards = [{ id: 'card-1', scryfallId: 'abc', foil: 'normal', status: 'owned', quantity: 1 }];
    collection.priceHistory = {
      'abc|normal': [
        { date: '2026-01-01', price: 10 },
        { date: '2026-01-25', price: 15 },
        { date: '2026-01-31', price: 12 },
      ],
    };

    expect(topMovers(10)[0].change.pct).toBeCloseTo(-20);
    expect(topMovers(10, 7)[0].change.pct).toBeCloseTo(-20);
    expect(topMovers(10, 0)[0].change.pct).toBeCloseTo(20);
  });
});
