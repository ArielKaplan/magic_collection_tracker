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
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; color: var(--accent2, #e8b84b); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
</style>
