import { describe, it, expect } from 'vitest';
import { makeMatcher } from '../src/renderer-js/search.js';

describe('makeMatcher — word-boundary / prefix-of-word semantics', () => {
  it('matches the start of a word, not mid-word', () => {
    const m = makeMatcher('ring');
    expect(m('The One Ring')).toBe(true);       // start of "Ring"
    expect(m('Ringleader')).toBe(true);         // start of a word
    expect(m('Sheoldred, Whispering One')).toBe(false);  // "ring" is mid-word
  });
  it('matches a prefix of a word', () => {
    const m = makeMatcher('trea');
    expect(m('Treasure Map')).toBe(true);
    expect(m('Treetop Village')).toBe(false);   // "trea" is not a prefix of "Treetop"
  });
  it('requires every term (AND) across all fields', () => {
    const m = makeMatcher('sol ring');
    expect(m('Sol Ring')).toBe(true);
    expect(m('Sol', 'Ring of Three Wishes')).toBe(true);   // terms may come from different fields
    expect(m('Sol Talisman')).toBe(false);      // "ring" absent
  });
  it('is case-insensitive', () => {
    expect(makeMatcher('SOL')('sol ring')).toBe(true);
  });
  it('matches set codes and collector numbers as fields', () => {
    const m = makeMatcher('mh2');
    expect(m('Ragavan', 'Modern Horizons 2', 'MH2', '138')).toBe(true);
  });
  it('escapes regex metacharacters in the query', () => {
    const m = makeMatcher('a+b');
    expect(m('a+b test')).toBe(true);           // treated literally, no throw
    expect(m('axb')).toBe(false);
  });
  it('empty query matches nothing', () => {
    expect(makeMatcher('')('anything')).toBe(false);
    expect(makeMatcher('   ')('anything')).toBe(false);
  });
});
