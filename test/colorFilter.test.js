import { describe, expect, it } from 'vitest';
import { colorIdentityMatches } from '../src/renderer-js/utils.js';

// The Cards-tab color pips: a card matches when its color identity is a
// non-empty subset of the selected colors; C admits colorless.
describe('colorIdentityMatches — subset semantics', () => {
  it('no pips selected matches everything (filter off)', () => {
    expect(colorIdentityMatches(['U'], [])).toBe(true);
    expect(colorIdentityMatches([], [])).toBe(true);
    expect(colorIdentityMatches(undefined, [])).toBe(true);
    expect(colorIdentityMatches(['W', 'U', 'B', 'R', 'G'], null)).toBe(true);
  });

  it('U+G shows mono-U, mono-G, and exactly UG', () => {
    const sel = ['U', 'G'];
    expect(colorIdentityMatches(['U'], sel)).toBe(true);
    expect(colorIdentityMatches(['G'], sel)).toBe(true);
    expect(colorIdentityMatches(['G', 'U'], sel)).toBe(true);
  });

  it('U+G hides cards whose identity spills outside the selection', () => {
    const sel = ['U', 'G'];
    expect(colorIdentityMatches(['W'], sel)).toBe(false);
    expect(colorIdentityMatches(['U', 'B'], sel)).toBe(false);
    expect(colorIdentityMatches(['W', 'U', 'G'], sel)).toBe(false);
  });

  it('colorless cards only match when the C pip is selected', () => {
    expect(colorIdentityMatches([], ['U', 'G'])).toBe(false);
    expect(colorIdentityMatches([], ['C'])).toBe(true);
    expect(colorIdentityMatches([], ['U', 'C'])).toBe(true);
  });

  it('C alongside colors still admits the colored subsets', () => {
    const sel = ['U', 'C'];
    expect(colorIdentityMatches(['U'], sel)).toBe(true);
    expect(colorIdentityMatches(['G'], sel)).toBe(false);
  });

  it('cards with no cached metadata are hidden while pips are active', () => {
    expect(colorIdentityMatches(undefined, ['U'])).toBe(false);
    expect(colorIdentityMatches(null, ['C'])).toBe(false);
  });
});
