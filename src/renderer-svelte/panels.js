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

export const PANELS = [
  // KPIs (compact summary widgets)
  { id: 'kpi-total',     title: 'Total Value',          icon: '💰', component: KpiTotalValue,   defaultSize: { w: 220, h: 120 } },
  { id: 'kpi-cards',     title: 'Cards Value',          icon: '🃏', component: KpiCardsValue,   defaultSize: { w: 220, h: 120 } },
  { id: 'kpi-sealed',    title: 'Sealed Value',         icon: '📦', component: KpiSealedValue,  defaultSize: { w: 220, h: 120 } },
  { id: 'kpi-cost',      title: 'Cost Basis',           icon: '🏷️', component: KpiCostBasis,    defaultSize: { w: 220, h: 120 } },
  { id: 'kpi-binders',   title: 'Binders',              icon: '📂', component: KpiBinders,      defaultSize: { w: 220, h: 120 } },
  { id: 'kpi-refresh',   title: 'Last Refresh',         icon: '🔄', component: KpiLastRefresh,  defaultSize: { w: 220, h: 120 }, filterable: false },

  // Content panels
  { id: 'cotd',          title: 'Card of the Day',      icon: '🎴', component: CardOfTheDay,    defaultSize: { w: 280, h: 380 }, filterable: false },
  { id: 'top-movers',    title: 'Top Movers',           icon: '📈', component: TopMovers,       defaultSize: { w: 460, h: 320 } },
  { id: 'val-binder',    title: 'Value by Binder',      icon: '📊', component: ValueByBinder,   defaultSize: { w: 360, h: 300 } },
  { id: 'top10',         title: 'Top 10 Cards',         icon: '🏆', component: Top10,           defaultSize: { w: 360, h: 380 } },
  { id: 'val-color',     title: 'Value by Color',       icon: '🎨', component: ValueByColor,    defaultSize: { w: 360, h: 240 } },
  { id: 'val-type',      title: 'Value by Card Type',   icon: '🐉', component: ValueByType,     defaultSize: { w: 360, h: 280 } },
  { id: 'val-cmc',       title: 'Value by Mana Value',  icon: '⚡', component: ValueByMana,     defaultSize: { w: 720, h: 260 } },
  { id: 'val-rarity',    title: 'Value by Rarity',      icon: '✦', component: ValueByRarity,   defaultSize: { w: 320, h: 240 } },
  { id: 'stats',         title: 'Collection Stats',     icon: '📋', component: Stats,           defaultSize: { w: 320, h: 320 } },
  { id: 'set-count',     title: 'Card Count by Set',    icon: '🗂️', component: CardCountBySet,  defaultSize: { w: 360, h: 360 } },
  { id: 'set-value',     title: 'Value by Set',         icon: '💎', component: ValueBySet,      defaultSize: { w: 360, h: 360 } },
  { id: 'year-count',    title: 'Card Count by Year',   icon: '📅', component: CardCountByYear, defaultSize: { w: 720, h: 240 } },
];

export function panelDef(id) {
  return PANELS.find(p => p.id === id);
}

export function defaultLayout() {
  // Tile panels in a tidy grid with no overlap. KPIs run across the top row,
  // bigger content panels flow below in row-major order.
  const out = [];
  const gap = 12;
  const canvasW = 1480; // soft cap; content wraps when exceeded

  // KPIs row(s)
  let x = 12, y = 12;
  let rowMax = 0;
  for (const id of ['kpi-total', 'kpi-cards', 'kpi-sealed', 'kpi-cost', 'kpi-binders', 'kpi-refresh']) {
    const def = panelDef(id);
    if (x + def.defaultSize.w > canvasW) { x = 12; y += rowMax + gap; rowMax = 0; }
    out.push({ id, x, y, width: def.defaultSize.w, height: def.defaultSize.h, collapsed: false, visible: true, zIndex: out.length + 1 });
    x += def.defaultSize.w + gap;
    rowMax = Math.max(rowMax, def.defaultSize.h);
  }

  // Content panels — flow into rows, wrapping when canvas width is hit
  x = 12; y += rowMax + gap; rowMax = 0;
  const contentIds = [
    'cotd', 'top-movers', 'val-binder',
    'top10', 'val-color', 'val-type',
    'val-rarity', 'stats',
    'val-cmc',                        // wide
    'set-count', 'set-value',
    'year-count',                     // wide
  ];
  for (const id of contentIds) {
    const def = panelDef(id);
    if (x + def.defaultSize.w > canvasW) { x = 12; y += rowMax + gap; rowMax = 0; }
    out.push({ id, x, y, width: def.defaultSize.w, height: def.defaultSize.h, collapsed: false, visible: true, zIndex: out.length + 1 });
    x += def.defaultSize.w + gap;
    rowMax = Math.max(rowMax, def.defaultSize.h);
  }
  return out;
}
