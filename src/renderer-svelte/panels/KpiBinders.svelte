<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: cards = filterCards(window.collection?.cards || [], filter);
  $: binders = new Set(cards.map(c => c.binderName || '')).size;
  $: sealed = (window.collection?.sealed || []).filter(i => i.status !== 'sold').length;
</script>

<div class="kpi">
  <div class="value">{binders}</div>
  <div class="sub">{sealed} sealed product{sealed === 1 ? '' : 's'} tracked</div>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 5px; }
  .value { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; color: var(--text, #ececef); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 11.5px; color: var(--text-dim, #a3a1aa); line-height: 1.35; }
</style>
