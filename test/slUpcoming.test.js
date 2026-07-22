import { describe, expect, it } from 'vitest';
import { buildUpcomingLairs, compactUpcomingScryfallCard, sumUpcomingCheapest } from '../src/renderer-js/slUpcoming.js';

describe('upcoming Secret Lair source join', () => {
  const announcements = [{
    title: 'Secret Lair: Superdrop of the Moonlight Jellies',
    url: 'https://magic.wizards.com/example',
    saleDate: '2099-07-27',
    summary: 'Stardew Valley comes to Secret Lair.',
    revealedDrops: [{
      name: 'Secret Lair x Stardew Valley: Welcome to Stardew Valley',
      cards: [
        { name: 'Stardew Valley', displayName: 'Stardew Valley', quantity: 1 },
        { name: 'Wedding Ring', displayName: `Wedding Ring as "Mermaid's Pendant"`, quantity: 1 },
        { name: 'Food', displayName: 'Food Token', quantity: 1 },
      ],
    }],
  }];

  const cards = [
    { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', name: 'Stardew Valley', released_at: '2099-07-27', collector_number: '2801', image_uris: { normal: 'https://cards.scryfall.io/normal/front/a/a/a.jpg' } },
    { id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', name: 'Wedding Ring', flavor_name: "Mermaid's Pendant", released_at: '2099-07-27', collector_number: '2802', image_uris: { normal: 'https://cards.scryfall.io/normal/front/b/b/b.jpg' } },
  ];

  it('keeps the exact future Scryfall fields needed by the UI', () => {
    expect(compactUpcomingScryfallCard(cards[1])).toMatchObject({
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      name: 'Wedding Ring',
      flavorName: "Mermaid's Pendant",
      releasedAt: '2099-07-27',
      collectorNumber: '2802',
    });
  });

  it('joins official drop contents to exact Scryfall IDs and reports gaps honestly', () => {
    const groups = buildUpcomingLairs(cards, announcements, [], '2099-07-01');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      drop: 'Secret Lair x Stardew Valley: Welcome to Stardew Valley',
      releaseDate: '2099-07-27',
      status: 'partial',
    });
    expect(groups[0].cards.map(card => card.id)).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    expect(groups[0].unmatchedCards.map(card => card.name)).toEqual(['Food']);
  });

  it('fills announced-name gaps with labeled reference printings without treating them as exact SLD previews', () => {
    const references = [
      { id: 'cccccccc-cccc-cccc-cccc-cccccccccccc', name: 'Wedding Ring', released_at: '2021-11-19', set: 'voc', collector_number: '32' },
      { id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', name: 'Food', released_at: '2024-01-01', set: 'tclb', collector_number: '18' },
    ];
    const groups = buildUpcomingLairs([cards[0]], announcements, [], '2099-07-01', references);
    expect(groups[0].cards.map(card => card.name)).toEqual(['Stardew Valley']);
    expect(groups[0].referenceCards.map(card => card.name)).toEqual(['Wedding Ring', 'Food']);
    expect(groups[0].unmatchedCards).toEqual([]);
    expect(groups[0].status).toBe('partial');
  });

  it('expands a multi-token quantity into every distinct future Scryfall printing', () => {
    const tokenAnnouncement = [{
      title: 'Secret Lair: A Marvelous Mathoms Superdrop',
      saleDate: '2099-08-17',
      revealedDrops: [{ name: 'Second Breakfast and Beyond', cards: [{ name: 'Food', displayName: 'Food Tokens', quantity: 7 }] }],
    }];
    const tokens = Array.from({ length: 7 }, (_, index) => ({
      id: `${index + 1}`.repeat(8) + '-aaaa-bbbb-cccc-111111111111',
      name: 'Food',
      flavor_name: `Meal ${index + 1}`,
      released_at: '2099-08-17',
      collector_number: String(2545 + index),
    }));
    const full = buildUpcomingLairs(tokens, tokenAnnouncement, [], '2099-08-01')[0];
    expect(full.cards).toHaveLength(7);
    expect(full.cards.map(card => card.collectorNumber)).toEqual(['2545', '2546', '2547', '2548', '2549', '2550', '2551']);
    expect(full).toMatchObject({ expectedCount: 7, matchedCount: 7, pendingCount: 0, status: 'full' });

    const partial = buildUpcomingLairs(tokens.slice(0, 1), tokenAnnouncement, [], '2099-08-01')[0];
    expect(partial.cards).toHaveLength(1);
    expect(partial.unmatchedCards[0]).toMatchObject({ name: 'Food', quantity: 6, variantGroup: true });
    expect(partial).toMatchObject({ expectedCount: 7, matchedCount: 1, pendingCount: 6, status: 'partial' });
  });

  it('prices announced quantities from the cheapest available printing by card name', () => {
    const estimate = sumUpcomingCheapest([
      { name: 'Wedding Ring', quantity: 1 },
      { name: 'Food', quantity: 7 },
      { name: 'Unpriced Preview', quantity: 1 },
    ], {
      'Wedding Ring': { price: 4.5, set_name: 'Crimson Vow Commander' },
      Food: { price: 0.25, set_name: 'Tokens' },
    });
    expect(estimate.value).toBe(6.25);
    expect(estimate).toMatchObject({ totalCopies: 9, pricedCopies: 8, missingNames: ['Unpriced Preview'] });
  });

  it('preserves announced wiki drops even before any card IDs are public', () => {
    const groups = buildUpcomingLairs([], [], [{
      drop: 'Unrevealed Drop', superdrop: 'Future Superdrop', date: '2099-08-10',
    }], '2099-07-01');
    expect(groups[0]).toMatchObject({ drop: 'Unrevealed Drop', status: 'announced', cards: [] });
  });
});
