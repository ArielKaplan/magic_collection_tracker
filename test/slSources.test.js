import { describe, expect, it } from 'vitest';
import { parseBonusCardsHtml } from '../src/renderer-js/slBonus.js';
import { parseAnnouncementArchiveHtml, parseAnnouncementDetailHtml } from '../src/renderer-js/slAnnouncements.js';

describe('Secret Lair supplemental source parsers', () => {
  it('parses the bonus table without shifting rowspan columns', () => {
    const html = `<table>
      <tr><th>SLD#</th><th>Type</th><th>Bonus card</th><th>Variant</th><th>Exclusive to</th><th>Notes</th></tr>
      <tr><td>501</td><td rowspan="2">Stained-glass</td><td>Karn, the Great Creator</td><td></td><td></td><td>Random insert</td></tr>
      <tr><td>502</td><td>Teferi, Time Raveler</td><td>Alternate art</td><td>Drop of Doom</td><td>Chase card</td></tr>
    </table>`;
    const rows = parseBonusCardsHtml(html);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      collectorNumber: '502', type: 'Stained-glass', cardName: 'Teferi, Time Raveler',
      variant: 'Alternate art', exclusiveTo: 'Drop of Doom', chase: true,
    });
  });

  it('extracts recent official archive cards', () => {
    const rows = parseAnnouncementArchiveHtml(`<article>
      <h3><a href="/en/news/announcements/secret-lair-example">Secret Lair Example Superdrop</a></h3>
      <time datetime="2026-07-17T05:30-07:00"></time><p>Arrives August 17.</p>
    </article>`);
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe('https://magic.wizards.com/en/news/announcements/secret-lair-example');
    expect(rows[0].publishedAt).toContain('2026-07-17');
  });

  it('extracts official sale time, prices, bundles and promotion notes', () => {
    const row = parseAnnouncementDetailHtml(`
      <h1>Secret Lair Example Superdrop</h1>
      <time datetime="2026-07-17T05:30-07:00"></time>
      <p>Visit MagicSecretLair.com on August 17, at 9 a.m. PT.</p>
      <h2>Everything Bundle</h2><p>Non-foil — $29.99 USD</p><p>Foil — $39.99 USD</p>
      <p>Promotional card available while supplies last at participating WPN game stores.</p>
    `, { url: 'https://example.test' });
    expect(row.saleDate).toBe('2026-08-17');
    expect(row.saleTime).toBe('9 a.m. PT');
    expect(row.prices.map(p => p.amount)).toEqual(expect.arrayContaining([29.99, 39.99]));
    expect(row.bundles).toContain('Everything Bundle');
    expect(row.officialNotes[0]).toMatch(/supplies last/i);
  });
});
