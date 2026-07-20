import { beforeEach, describe, expect, it } from 'vitest';
import { setSlProducts } from '../src/renderer-js/slData.js';
import { collection, tcgcsvCache } from '../src/renderer-js/state.js';
import { computeSlProductCompletion, slDataQuality, slLotPnlRows, slProductHistoryStats, slWatchAlerts } from '../src/renderer-js/slIntelligence.js';

const product = {
  uuid: 'sku-1', name: 'Secret Lair Drop: Test Foil', subtype: 'secret_lair',
  identifiers: { tcgplayerProductId: '42', cardtraderId: '77' },
  tcgplayerProductId: '42', legacyDrop: 'Test Drop Foil', dropName: 'Test Drop',
  finish: 'foil', finishLabel: 'Foil', releaseDate: '2025-01-01', lowConfidence: false,
  cards: [
    { scryfallId: 'aaaa', name: 'Alpha', number: '1', finish: 'foil', count: 2 },
    { scryfallId: 'bbbb', name: 'Beta', number: '2', finish: 'foil', count: 1 },
  ],
};

beforeEach(() => {
  globalThis.SL_DROP_TO_SUPERDROP = { 'Test Drop Foil': { superdrop: 'Test Superdrop', date: '2025-01' } };
  setSlProducts([product]);
  collection.cards = [];
  collection.sealed = [];
  collection.slPurchaseLots = [];
  collection.slBonusPulls = [];
  collection.slWatchList = [];
  collection.slMarketQuotes = [];
  collection.settings = {};
  collection.priceHistory = {};
  tcgcsvCache.sealedProducts = [];
});

describe('Secret Lair intelligence overlays', () => {
  it('audits exact quantities and flags wrong finishes separately', () => {
    collection.cards = [
      { id: '1', scryfallId: 'aaaa', foil: 'foil', quantity: 1, status: 'owned' },
      { id: '2', scryfallId: 'aaaa', foil: 'normal', quantity: 3, status: 'owned' },
      { id: '3', scryfallId: 'bbbb', foil: 'foil', quantity: 1, status: 'owned' },
    ];
    const report = computeSlProductCompletion('Test Drop Foil');
    expect(report).toMatchObject({ required: 3, owned: 2, missing: 1, wrongFinish: 3, pct: 67 });
    expect(report.rows[0]).toMatchObject({ required: 2, owned: 1, missing: 1, wrongQty: 3 });
  });

  it('turns allocated bundle cost and exact product quotes into P&L rows', () => {
    collection.slPurchaseLots = [{ id: 'lot', name: 'Bundle', acquiredAt: '2025-01-01', items: [{ productUuid: 'sku-1', dropName: 'Test Drop Foil', quantity: 2, status: 'sealed', allocatedCost: 54.32 }] }];
    tcgcsvCache.sealedProducts = [{ productId: 42, marketPrice: 80 }];
    expect(slLotPnlRows()[0]).toMatchObject({ allocatedCost: 54.32, quantity: 2, marketValue: 80 });
  });

  it('reports source-quality gaps without hiding exact products', () => {
    expect(slDataQuality()).toMatchObject({ total: 1, exact: 1, lowConfidence: 0, noTcg: 0, empty: 0 });
  });

  it('builds a transparent product-level history from exact finish series', () => {
    collection.priceHistory = {
      'aaaa|foil': [{ date: '2025-01-01', price: 10 }, { date: '2025-02-01', price: 15 }],
      'bbbb|foil': [{ date: '2025-01-01', price: 5 }, { date: '2025-02-01', price: 5 }],
    };
    const stats = slProductHistoryStats('Test Drop Foil');
    expect(stats.points).toBe(2);
    expect(stats.start).toBe(25); // 2× Alpha + 1× Beta
    expect(stats.end).toBe(35);
    expect(stats.returnPct).toBeCloseTo(40);
  });

  it('evaluates source-labeled watch targets', () => {
    collection.slWatchList = [{ id: 'w', dropName: 'Test Drop Foil', targetPrice: 90, notifySale: false }];
    tcgcsvCache.sealedProducts = [{ productId: 42, marketPrice: 80 }];
    expect(slWatchAlerts()).toEqual([expect.objectContaining({ type: 'price', dropName: 'Test Drop Foil' })]);
  });
});
