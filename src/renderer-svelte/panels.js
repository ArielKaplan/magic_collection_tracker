// Authoritative list of panels available on the Dashboard. New panels are
// added here once and they automatically appear in the visibility toggle
// chips, the auto-arrange grid, and the panel registry lookup.
import KpiTotalValue   from './panels/KpiTotalValue.svelte';
import KpiCardsValue   from './panels/KpiCardsValue.svelte';
import KpiSealedValue  from './panels/KpiSealedValue.svelte';
import KpiCostBasis    from './panels/KpiCostBasis.svelte';
import KpiBinders      from './panels/KpiBinders.svelte';
import KpiLastRefresh  from './panels/KpiLastRefresh.svelte';
import TopMovers       from './panels/TopMovers.svelte';
import ValueByBinder   from './panels/ValueByBinder.svelte';
import Top10           from './panels/Top10.svelte';
import ValueByColor    from './panels/ValueByColor.svelte';
import ValueByType     from './panels/ValueByType.svelte';
import ValueByMana     from './panels/ValueByMana.svelte';
import ValueByRarity   from './panels/ValueByRarity.svelte';
import Stats           from './panels/Stats.svelte';
import CardCountBySet  from './panels/CardCountBySet.svelte';
import ValueBySet      from './panels/ValueBySet.svelte';
import CardCountByYear from './panels/CardCountByYear.svelte';
import CardOfTheDay    from './panels/CardOfTheDay.svelte';
import PortfolioHistory from './panels/PortfolioHistory.svelte';
import KpiWantList     from './panels/KpiWantList.svelte';
import KpiRealizedGains from './panels/KpiRealizedGains.svelte';
import RealizedGains   from './panels/RealizedGains.svelte';
import SecretLairIndex from './panels/SecretLairIndex.svelte';

export const PANELS = [
  // KPIs (compact summary widgets)
  { id: 'kpi-total',   title: 'Total value',        icon: '💰', component: KpiTotalValue,   defaultSize: { w: 360, h: 144 },
    description: 'Combined market value of all cards and sealed products. Cards use the Scryfall low price; sealed uses the TCGPlayer market price via TCGCSV.' },
  { id: 'kpi-cards',   title: 'Cards value',        icon: '🃏', component: KpiCardsValue,   defaultSize: { w: 260, h: 144 },
    description: 'Total current market value of all individual cards — Scryfall low price × quantity for each card.' },
  { id: 'kpi-sealed',  title: 'Sealed value',       icon: '📦', component: KpiSealedValue,  defaultSize: { w: 260, h: 144 },
    description: 'Total current market value of all sealed products (booster boxes, bundles, Secret Lair drops, etc.) using the TCGPlayer market price.' },
  { id: 'kpi-cost',    title: 'Cost basis',         icon: '🏷️', component: KpiCostBasis,    defaultSize: { w: 300, h: 144 },
    description: 'Total purchase price of everything in your collection as recorded when you acquired it. ManaBox auto-fills this from the TCGPlayer price at time of acquisition, so it approximates what each card was worth when you got it — not necessarily what you literally paid.' },
  { id: 'kpi-binders', title: 'Binders',            icon: '📂', component: KpiBinders,      defaultSize: { w: 230, h: 122 }, breakBefore: true,
    description: 'Number of distinct binders (named collections or storage locations) in your collection.' },
  { id: 'kpi-want',    title: 'Want list',          icon: '★', component: KpiWantList,     defaultSize: { w: 230, h: 122 }, filterable: false,
    description: 'Cards on your want list, the total current price to acquire them all, and how many have dropped to or below your target price. Add cards by right-clicking missing cards (or incomplete drops) in the Secret Lair Explorer.' },
  { id: 'kpi-realized', title: 'Realized gains',     icon: '💵', component: KpiRealizedGains, defaultSize: { w: 270, h: 122 }, filterable: false,
    description: 'Net profit/loss you have actually locked in by selling cards or sealed products — total proceeds minus fees minus what those items cost you. Record a sale by right-clicking a card or sealed product → "Sell / dispose".' },
  { id: 'kpi-refresh', title: 'Last refresh',       icon: '🔄', component: KpiLastRefresh,  defaultSize: { w: 300, h: 122 }, filterable: false,
    description: 'When prices were last fetched from Scryfall (low prices) and TCGCSV (market prices). Prices auto-refresh once per day on first open.' },

  // Content panels
  { id: 'portfolio-history', title: 'Value over time', icon: '📈', component: PortfolioHistory, defaultSize: { w: 780, h: 330 }, filterable: false, breakBefore: true,
    description: 'Your collection\'s market value over time — total, cards, and sealed, against your cost basis (dashed). One snapshot is recorded per day each time prices refresh (prices auto-refresh once daily on first open), so the line builds up going forward.' },
  { id: 'realized-gains', title: 'Realized gains by year', icon: '🧾', component: RealizedGains, defaultSize: { w: 440, h: 240 }, filterable: false,
    description: 'Net realized profit/loss within the selected dashboard history range, broken down by sale year (proceeds − fees − cost). Builds up as you record sales via right-click → "Sell / dispose".' },
  { id: 'sl-index',    title: 'Secret Lair index',   icon: '📈', component: SecretLairIndex, defaultSize: { w: 440, h: 330 }, filterable: false,
    description: 'Your Secret Lair holdings as an asset class: total return (unrealized + realized) on what you paid, plotted over time — SL market value vs. the MSRP you paid. One point accrues per day prices refresh. Full breakdown lives in the Secret Lair Explorer → 📈 Index.' },
  { id: 'cotd',        title: 'Card of the day',    icon: '🎴', component: CardOfTheDay,    defaultSize: { w: 340, h: 420 }, filterable: false, breakBefore: true,
    description: 'A randomly highlighted card from your collection, chosen fresh each day. Click the reroll button to pick a different card.' },
  { id: 'top-movers',  title: 'Top movers',         icon: '📈', component: TopMovers,       defaultSize: { w: 760, h: 340 }, breakBefore: true,
    description: 'Cards whose prices changed the most across the selected dashboard history range. Gainers are shown in green and losers in red. Requires at least two price snapshots in the range.' },
  { id: 'val-binder',  title: 'Value by binder',    icon: '📊', component: ValueByBinder,   defaultSize: { w: 440, h: 340 },
    description: 'Total collection value broken down by binder name. Cards without a binder are grouped together.' },
  { id: 'top10',       title: 'Top 10 cards',       icon: '🏆', component: Top10,           defaultSize: { w: 420, h: 420 },
    description: 'Your ten most valuable individual cards ranked by current market price (Scryfall low). Quantity is factored in — a card you own 4 copies of ranks higher.' },
  { id: 'val-color',   title: 'Value by color',     icon: '🎨', component: ValueByColor,    defaultSize: { w: 360, h: 240 },
    description: 'Collection value distributed by card color identity. Multi-color cards are counted once per color they belong to.' },
  { id: 'val-type',    title: 'Value by card type',  icon: '🐉', component: ValueByType,     defaultSize: { w: 360, h: 280 },
    description: 'Collection value broken down by card type (Creature, Instant, Sorcery, Enchantment, Artifact, Land, Planeswalker, etc.).' },
  { id: 'val-cmc',     title: 'Value by mana value', icon: '⚡', component: ValueByMana,     defaultSize: { w: 720, h: 260 },
    description: 'Collection value grouped by converted mana cost (CMC). Shows where the value is concentrated in your curve — cheap spells vs. expensive finishers.' },
  { id: 'val-rarity',  title: 'Value by rarity',    icon: '✦', component: ValueByRarity,   defaultSize: { w: 320, h: 240 },
    description: 'Collection value split by card rarity: Common, Uncommon, Rare, and Mythic Rare. Mythics typically dominate even if you own fewer of them.' },
  { id: 'stats',       title: 'Collection stats',   icon: '📋', component: Stats,           defaultSize: { w: 380, h: 320 },
    description: 'General statistics about your collection: unique card names, total copies, number of sets represented, foil count, and more.' },
  { id: 'set-count',   title: 'Card count by set',  icon: '🗂️', component: CardCountBySet,  defaultSize: { w: 360, h: 360 },
    description: 'Number of cards you own from each Magic set, sorted by count. Useful for seeing which sets you have the deepest coverage of.' },
  { id: 'set-value',   title: 'Value by set',       icon: '💎', component: ValueBySet,      defaultSize: { w: 360, h: 360 },
    description: 'Total market value of cards you own from each Magic set. Helps identify which sets are contributing the most to your collection value.' },
  { id: 'year-count',  title: 'Card count by year', icon: '📅', component: CardCountByYear, defaultSize: { w: 720, h: 240 },
    description: 'Number of cards you own by the year they were printed. Shows how your collection spans Magic\'s history from 1993 to today.' },
];

export const CUSTOM_PREFIX = 'custom-';
export const isCustomPanel = id => typeof id === 'string' && id.startsWith(CUSTOM_PREFIX);

export function panelDef(id) {
  return PANELS.find(p => p.id === id);
}

export function defaultLayout(canvasW = 1480) {
  // Curated portfolio hierarchy: headline financials, supporting KPIs, major
  // trends, actionable breakdowns, then collection discovery.
  const out = [];
  const gap = 14;
  const orderedIds = [
    'kpi-total', 'kpi-cards', 'kpi-sealed', 'kpi-cost',
    'kpi-binders', 'kpi-want', 'kpi-realized', 'kpi-refresh',
    'portfolio-history', 'sl-index',
    'top-movers', 'val-binder',
    'cotd', 'top10', 'stats', 'realized-gains',
    'val-color', 'val-type', 'val-rarity', 'val-cmc',
    'set-count', 'set-value', 'year-count',
  ];
  let x = 14, y = 14, rowMax = 0;
  for (const id of orderedIds) {
    const def = panelDef(id);
    if (x > 14 && (def.breakBefore || x + def.defaultSize.w > canvasW)) { x = 14; y += rowMax + gap; rowMax = 0; }
    out.push({ id, x, y, width: def.defaultSize.w, height: def.defaultSize.h, collapsed: false, visible: def.defaultVisible !== false, zIndex: out.length + 1 });
    x += def.defaultSize.w + gap;
    rowMax = Math.max(rowMax, def.defaultSize.h);
  }
  return out;
}
