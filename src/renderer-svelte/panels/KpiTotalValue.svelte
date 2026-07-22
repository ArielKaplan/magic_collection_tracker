<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards, withFilteredCollection } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: cards = filterCards(window.collection?.cards || [], filter);
  $: cardsValue = cards.reduce((s, c) => {
    const v = window.app?.cardCurrentValue?.(c);
    return s + (v ?? 0);
  }, 0);
  $: tot = cardsValue + (window.app?.totalSealedValue() ?? 0);
  $: cost = cards.reduce((s, c) => s + (c.purchasePrice || 0) * (c.quantity || 1), 0)
         +  (window.collection?.sealed || []).filter(i => i.status !== 'sold').reduce((s, i) => s + (i.purchasePrice || 0) * (i.quantity || 1), 0);
  $: gain = tot - cost;
  $: gainPct = cost > 0 ? (gain / cost) * 100 : null;
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(tot) ?? '—'}</div>
  <div class="sub" class:up={gain >= 0} class:down={gain < 0}>
    {gain >= 0 ? '▲' : '▼'} {window.app?.fmt(Math.abs(gain)) ?? '—'}
    {#if gainPct != null}({window.app?.fmtPct(gainPct) ?? ''}){/if}
    vs cost basis
  </div>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
  .value { font-size: 32px; font-weight: 700; letter-spacing: -0.025em; color: var(--text, #ececef); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 12px; color: var(--text-dim, #a3a1aa); line-height: 1.4; }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
