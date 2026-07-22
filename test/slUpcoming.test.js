import { describe, expect, it } from 'vitest';
import { buildUpcomingLairs, compactUpcomingScryfallCard } from '../src/renderer-js/slUpcoming.js';

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

  it('preserves announced wiki drops even before any card IDs are public', () => {
    const groups = buildUpcomingLairs([], [], [{
      drop: 'Unrevealed Drop', superdrop: 'Future Superdrop', date: '2099-08-10',
    }], '2099-07-01');
    expect(groups[0]).toMatchObject({ drop: 'Unrevealed Drop', status: 'announced', cards: [] });
  });
});
