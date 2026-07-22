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
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
  .value { font-size: 27px; font-weight: 700; letter-spacing: -0.025em; color: var(--text, #ececef); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 12px; color: var(--text-dim, #a3a1aa); line-height: 1.4; }
</style>
