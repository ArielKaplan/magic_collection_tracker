<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: cards = filterCards(window.collection?.cards || [], filter);
  $: cv = cards.reduce((s, c) => s + (window.app?.cardCurrentValue?.(c) ?? 0), 0);
  $: qty = cards.reduce((s, c) => s + (c.quantity || 1), 0);
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(cv) ?? '—'}</div>
  <div class="sub">{qty.toLocaleString()} copies · {cards.length.toLocaleString()} entries</div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--accent2, #e8b84b); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
</style>
