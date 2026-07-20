


// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
export let collection = makeCollection();

// TCGCSV in-memory cache — full sealed product preload
export let tcgcsvCache = {
  groups:         null,   // all MTG groups from TCGCSV
  sealedProducts: [],     // flat array of all sealed products with prices
  lastRefresh:    null,
  sourceUpdatedAt:null,   // upstream TCGCSV timestamp (when available)
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
    condition: 'all', language: 'all', status: 'owned',  // owned | sold | all
    colors: [],      // color-identity pips (W/U/B/R/G/C) — subset match, empty = off
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
  insights: {
    view: 'build',             // 'build' | 'opportunities' | 'reports'
    search: '',
    buildSource: 'all',        // 'all' | 'saved' | 'precon'
    buildSort: 'completion_desc',
    buildMaxMissing: 'all',
    preconMatch: 'playable',   // 'playable' (any printing) | 'exact' (printing + finish)
    buildPage: 1,
    opportunityType: 'all',
    reportId: '',
    aiQuery: '',
  },
  slViewer: { superdrop: '', drop: '', page: 0, sort: 'date_desc', search: '', view: 'drops', layout: 'tiles', pnlSort: 'gainpct_desc', indexExpanded: false, indexYear: 'all', indexFinish: 'all', indexSuperdrop: 'all', indexSubtype: 'all', indexConfidence: 'all', indexHolding: 'all', indexReportSort: 'return_desc' },
  slRefreshing: false,
  precons: { line: '', deck: '', search: '', sort: 'date_desc', deckView: 'gallery', tableSort: 'name_asc', showJumpstart: false },
  failures: { filter: 'all', retrying: false },
  refreshing: false,
  refreshProgress: 0
};


export function makeCollection() {
  return {
    version: 3,
    lastPriceRefresh: null,
    settings: { pricechartingKey: '', cardTraderToken: '', insightsEnabled: false, localIntelligenceEnabled: false },
    cards: [],
    sealed: [],
    wantList: [],   // cards the user wants to acquire (see wantlist.js)
    // Secret Lair intelligence records are user-authored overlays. They never
    // rewrite sourced product contents and are persisted as separate SQLite
    // settings blobs so backups/export retain the full decision history.
    slPurchaseLots: [], // bundle/lot cost basis + per-SKU allocations
    slBonusPulls: [],   // observed bonus cards (supplemental, never guaranteed)
    slWatchList: [],    // watched drops/upcoming sales and optional target prices
    slMarketQuotes: [], // labeled manual/secondary market observations
    decks: [],
    savedReports: [],   // local, reusable Insights report definitions
    priceHistory: {},
    marketPriceHistory: {},  // scryfallId|foil → [{date,price}] from TCGCSV (market price)
    cardMetadata: {},  // scryfallId → { colors, type_line, cmc, color_identity }
    failedLookups: [],  // populated on each price refresh
    portfolioSnapshots: []  // [{date, cardsValue, sealedValue, costBasis, cardCount}] — value over time
  };
}

