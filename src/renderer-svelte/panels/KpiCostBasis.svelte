<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: cards = filterCards(window.collection?.cards || [], filter);
  $: costCards  = cards.reduce((s, c) => s + (c.purchasePrice || 0) * (c.quantity || 1), 0);
  $: costSealed = (window.collection?.sealed || []).filter(i => i.status !== 'sold').reduce((s, i) => s + (i.purchasePrice || 0) * (i.quantity || 1), 0);
  $: total = costCards + costSealed;
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(total) ?? '—'}</div>
  <div class="sub">Cards {window.app?.fmt(costCards) ?? '—'} · Sealed {window.app?.fmt(costSealed) ?? '—'}</div>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
  .value { font-size: 27px; font-weight: 700; letter-spacing: -0.025em; color: var(--text, #ece9e1); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 12px; color: var(--text-dim, #a3a1aa); line-height: 1.4; }
</style>
