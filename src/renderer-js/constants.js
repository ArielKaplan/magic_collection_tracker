import { collection } from './state.js';

'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
export const SCRYFALL_COLLECTION = 'https://api.scryfall.com/cards/collection';
export const TCGCSV_GROUPS = 'https://tcgcsv.com/tcgplayer/1/groups';
export const PC_API        = 'https://www.pricecharting.com/api';

export const CONDITION_SHORT = {
  mint: 'M', near_mint: 'NM', lightly_played: 'LP',
  moderately_played: 'MP', heavily_played: 'HP', damaged: 'DMG'
};
export const CONDITION_FULL = {
  mint: 'Mint', near_mint: 'Near Mint', lightly_played: 'Lightly Played',
  moderately_played: 'Moderately Played', heavily_played: 'Heavily Played', damaged: 'Damaged'
};
export const FOIL_LABEL = { normal: '—', foil: 'Foil', etched: 'Etched' };
export const RARITY_ORDER = { common: 0, uncommon: 1, rare: 2, mythic: 3 };
export const PRODUCT_TYPES = [
  'Secret Lair', 'Booster Box', 'Set Booster Box',
  'Collector Booster Box', 'Bundle', 'Commander Deck',
  'Prerelease Kit', 'Starter Kit', 'Other'
];

