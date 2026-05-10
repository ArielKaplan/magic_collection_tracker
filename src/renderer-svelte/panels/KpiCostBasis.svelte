<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: cards = filterCards(window.collection?.cards || [], filter);
  $: costCards  = cards.reduce((s, c) => s + (c.purchasePrice || 0) * (c.quantity || 1), 0);
  $: costSealed = (window.collection?.sealed || []).reduce((s, i) => s + (i.purchasePrice || 0) * (i.quantity || 1), 0);
  $: total = costCards + costSealed;
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(total) ?? '—'}</div>
  <div class="sub">Cards {window.app?.fmt(costCards) ?? '—'} · Sealed {window.app?.fmt(costSealed) ?? '—'}</div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--text, #ece9e1); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
</style>
