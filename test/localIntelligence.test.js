import { describe, expect, it } from 'vitest';
import {
  findCrossSourceMatches,
  interpretLocalQuery,
  rankLocalOpportunities,
  runLocalQuery,
  scanDataGuardian,
  scoreEntityMatch,
} from '../src/renderer-js/localIntelligence.js';

describe('Local Intelligence entity matcher', () => {
  it('scores source-name variants above unrelated products', () => {
    const match = scoreEntityMatch('Secret Lair: Cats Are the Best Foil Edition', 'Cats Are the Best', { leftFinish: 'foil', rightFinish: 'foil' });
    const miss = scoreEntityMatch('Cats Are the Best', 'Phyrexian Praetors');
    expect(match.score).toBeGreaterThan(80);
    expect(match.score).toBeGreaterThan(miss.score + 50);
  });

  it('returns only confident cross-source candidates', () => {
    const rows = findCrossSourceMatches(
      [{ id: 'owned', name: 'Secret Lair: Cats Are the Best' }],
      [{ id: 'cats', name: 'Cats Are the Best' }, { id: 'other', name: 'The Walking Dead' }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].right.id).toBe('cats');
  });
});

describe('Local Data Guardian', () => {
  it('flags an implausible adjacent price spike without changing the source rows', () => {
    const history = [{ date: '2026-01-01', price: 20 }, { date: '2026-02-01', price: 21 }, { date: '2026-03-01', price: 99 }];
    const input = { cards: [{ id: 'c1', name: 'Test Card', scryfallId: 'abc', quantity: 1 }], priceHistory: { 'abc|normal': history } };
    const issues = scanDataGuardian(input);
    expect(issues.some(issue => issue.type === 'price-anomaly' && issue.name === 'Test Card')).toBe(true);
    expect(history[2].price).toBe(99);
  });
});

describe('Local opportunity ranker', () => {
  it('adds explainable attention and confidence without calling it a forecast', () => {
    const [row] = rankLocalOpportunities([{ id: 'x', type: 'sealed-value', name: 'Test Drop', gain: 80, score: 80 }]);
    expect(row.attentionScore).toBeGreaterThan(70);
    expect(row.confidence).toBeGreaterThan(80);
    expect(row.modelReasons.join(' ')).toContain('exact sealed identity');
  });
});

describe('Local query interpreter', () => {
  it('maps natural language to a bounded report recipe', () => {
    const result = interpretLocalQuery('show foil cards under $40 with gains');
    expect(result.dataset).toBe('cards');
    expect(result.filters).toMatchObject({ finish: 'foil', maxValue: 40, minGain: 0 });
    const rows = runLocalQuery([
      { name: 'Hit', finish: 'foil', value: 30, gain: 5 },
      { name: 'Too much', finish: 'foil', value: 50, gain: 10 },
      { name: 'Wrong finish', finish: 'normal', value: 20, gain: 5 },
    ], result);
    expect(rows.map(row => row.name)).toEqual(['Hit']);
  });
});
