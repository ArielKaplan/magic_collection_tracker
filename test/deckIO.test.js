import { describe, it, expect } from 'vitest';
import { parseDeckLine, parseDeckText, parseDeckList } from '../src/renderer-js/deckIO.js';

describe('parseDeckLine', () => {
  it('parses quantity + name', () => {
    expect(parseDeckLine('3 Lightning Bolt')).toMatchObject({ quantity: 3, name: 'Lightning Bolt', foil: 'normal' });
  });
  it('accepts the "3x" form', () => {
    expect(parseDeckLine('3x Lightning Bolt')).toMatchObject({ quantity: 3, name: 'Lightning Bolt' });
  });
  it('defaults a bare name to 1 copy', () => {
    expect(parseDeckLine('Sol Ring')).toMatchObject({ quantity: 1, name: 'Sol Ring' });
  });
  it('detects foil and etched markers and strips them', () => {
    expect(parseDeckLine('1 Sol Ring *F*')).toMatchObject({ name: 'Sol Ring', foil: 'foil' });
    expect(parseDeckLine('1 Sol Ring *E*')).toMatchObject({ name: 'Sol Ring', foil: 'etched' });
    expect(parseDeckLine('1 Sol Ring (foil)')).toMatchObject({ name: 'Sol Ring', foil: 'foil' });
  });
  it('pulls set code + collector number from a trailing (SET) NUM', () => {
    expect(parseDeckLine('1 Sol Ring (C21) 263')).toMatchObject({ name: 'Sol Ring', setCode: 'c21', collectorNumber: '263' });
  });
  it('strips archidekt [Category] and ^colors^ annotations', () => {
    expect(parseDeckLine('1 Sol Ring [Ramp] ^Colorless^')).toMatchObject({ name: 'Sol Ring' });
  });
  it('returns null for an empty line', () => {
    expect(parseDeckLine('')).toBeNull();
  });
});

describe('parseDeckText', () => {
  it('assigns boards from section headers', () => {
    const { entries } = parseDeckText('Commander\n1 Atraxa, Praetors\' Voice\n\nDeck\n1 Sol Ring\n\nSideboard\n1 Naturalize');
    const byName = Object.fromEntries(entries.map(e => [e.name, e.board]));
    expect(byName["Atraxa, Praetors' Voice"]).toBe('commander');
    expect(byName['Sol Ring']).toBe('main');
    expect(byName['Naturalize']).toBe('side');
  });
  it('skips comments and blank lines', () => {
    const { entries } = parseDeckText('// my deck\n\n# note\n2 Forest');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ quantity: 2, name: 'Forest' });
  });
  it('reads an MTGA About/Name block as the suggested name', () => {
    const { suggestedName } = parseDeckText('About\nName Gruul Aggro\n\nDeck\n1 Forest');
    expect(suggestedName).toBe('Gruul Aggro');
  });
});

describe('parseDeckList (format autodetect)', () => {
  it('routes a known CSV header to the CSV parser', () => {
    const { entries } = parseDeckList('Name,Quantity,Foil\nSol Ring,2,foil\nForest,10,');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ name: 'Sol Ring', quantity: 2, foil: 'foil' });
  });
  it('routes plain text to the text parser', () => {
    const { entries } = parseDeckList('2 Sol Ring\n1 Forest');
    expect(entries.map(e => e.name)).toEqual(['Sol Ring', 'Forest']);
  });
});
