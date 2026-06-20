


// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
export let collection = makeCollection();

// TCGCSV in-memory cache — full sealed product preload
export let tcgcsvCache = {
  groups:         null,   // all MTG groups from TCGCSV
  sealedProducts: [],     // flat array of all sealed products with prices
  lastRefresh:    null,
  syncing:        false,
  syncDone:       0,
  syncTotal:      0,
};

export let ui = {
  activeTab: 'dashboard',
  cards: {
    view: 'table',   // 'table' | 'gallery' — the Gallery view lives here now
    binder: { include: [], exclude: [] },
    search: '', foil: 'all', rarity: 'all',
    condition: 'all', language: 'all',
    sortField: 'name', sortDir: 'asc',
    page: 1, perPage: 50,
    columns: {
      setCode: true, foil: true, rarity: true, condition: true,
      language: true, quantity: true, purchasePrice: true,
      currentPrice: true, marketPrice: true, priceDelta: true, trend: true, flags: true,
      setName: false, binderName: false
    },
    colPickerOpen: false,
  },
  sealed: { search: '', type: 'all', status: 'all' },
  wantList: { search: '', groupByDrop: false, view: 'table' },
  decks: { deckId: null, search: '', view: 'list', ownFilter: 'all' },
  slViewer: { superdrop: '', drop: '', page: 0, sort: 'date_desc', search: '', view: 'drops', pnlSort: 'gainpct_desc' },
  slRefreshing: false,
  failures: { filter: 'all', retrying: false },
  refreshing: false,
  refreshProgress: 0
};


export function makeCollection() {
  return {
    version: 3,
    lastPriceRefresh: null,
    settings: { pricechartingKey: '' },
    cards: [],
    sealed: [],
    wantList: [],   // cards the user wants to acquire (see wantlist.js)
    decks: [],
    priceHistory: {},
    marketPriceHistory: {},  // scryfallId|foil → [{date,price}] from TCGCSV (market price)
    cardMetadata: {},  // scryfallId → { colors, type_line, cmc, color_identity }
    failedLookups: [],  // populated on each price refresh
    portfolioSnapshots: []  // [{date, cardsValue, sealedValue, costBasis, cardCount}] — value over time
  };
}

