import { describe, it, expect } from 'vitest';
import { parseCsvLine, parseCsv, parseCsvHeaders, csvRowToCard, sanitizeText } from '../src/renderer-js/csv.js';

describe('sanitizeText (import trust boundary)', () => {
  it('strips angle brackets so imported text cannot inject markup', () => {
    expect(sanitizeText('<img src=x onerror=alert(1)>')).toBe('img src=x onerror=alert(1)');
    expect(sanitizeText('Sol Ring')).toBe('Sol Ring');
  });
  it('drops control characters', () => {
    expect(sanitizeText('Ab' + String.fromCharCode(0, 9, 31, 127) + 'cd')).toBe('Abcd');
  });
  it('leaves legitimate MTG punctuation intact', () => {
    expect(sanitizeText("Urza's Saga")).toBe("Urza's Saga");
    expect(sanitizeText('Yidris, Maelstrom Wielder')).toBe('Yidris, Maelstrom Wielder');
    expect(sanitizeText('Fire // Ice')).toBe('Fire // Ice');
  });
  it('coerces null/undefined to empty', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });
});

describe('parseCsvLine', () => {
  it('splits plain fields', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('keeps commas inside quotes', () => {
    expect(parseCsvLine('"Urza, Lord High Artificer",MH1,1')).toEqual(['Urza, Lord High Artificer', 'MH1', '1']);
  });
  it('unescapes doubled quotes', () => {
    expect(parseCsvLine('"She said ""hi""",x')).toEqual(['She said "hi"', 'x']);
  });
  it('preserves empty trailing field', () => {
    expect(parseCsvLine('a,,')).toEqual(['a', '', '']);
  });
});

describe('parseCsv', () => {
  it('maps headers to values and trims', () => {
    const rows = parseCsv('Name, Qty\nSol Ring, 2\nMana Crypt, 1');
    expect(rows).toEqual([{ Name: 'Sol Ring', Qty: '2' }, { Name: 'Mana Crypt', Qty: '1' }]);
  });
  it('drops fully-empty rows', () => {
    const rows = parseCsv('Name,Qty\nSol Ring,1\n,\nMana Crypt,1');
    expect(rows.map(r => r.Name)).toEqual(['Sol Ring', 'Mana Crypt']);
  });
  it('returns [] with only a header', () => {
    expect(parseCsv('Name,Qty')).toEqual([]);
  });
});

describe('parseCsvHeaders', () => {
  it('reads and trims the first line', () => {
    expect(parseCsvHeaders(' Name , Set code ,Foil\nx,y,z')).toEqual(['Name', 'Set code', 'Foil']);
  });
});

describe('csvRowToCard', () => {
  it('maps ManaBox columns and normalizes', () => {
    const c = csvRowToCard({
      'Binder Name': 'Rares', 'Name': 'Ragavan, Nimble Pilferer', 'Set code': 'MH2',
      'Collector number': '138', 'Foil': 'foil', 'Rarity': 'Mythic', 'Quantity': '3',
      'Scryfall ID': 'A1B2C3D4', 'Purchase price': '42.5',
    });
    expect(c.name).toBe('Ragavan, Nimble Pilferer');
    expect(c.foil).toBe('foil');
    expect(c.rarity).toBe('mythic');            // lowercased
    expect(c.quantity).toBe(3);
    expect(c.scryfallId).toBe('a1b2c3d4');      // lowercased + trimmed
    expect(c.purchasePrice).toBeCloseTo(42.5);
    expect(c.id).toBeTruthy();                  // uid assigned
  });
  it('defaults foil to normal and quantity to at least 1', () => {
    const c = csvRowToCard({ 'Name': 'Forest', 'Quantity': '0' });
    expect(c.foil).toBe('normal');
    expect(c.quantity).toBe(1);
    expect(c.condition).toBe('near_mint');
    expect(c.language).toBe('en');
  });
  it('sanitizes untrusted free-text fields (a shared CSV cannot inject markup)', () => {
    const c = csvRowToCard({ 'Name': 'Evil<script>x</script>', 'Binder Name': 'B<b>' });
    expect(c.name).toBe('Evilscriptx/script');   // angle brackets gone
    expect(c.binderName).toBe('Bb');
  });
});
