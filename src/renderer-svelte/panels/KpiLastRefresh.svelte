<script>
  import { collectionVersion } from '../stores.js';
  import LedgerIcon from '../LedgerIcon.svelte';
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: when = window.collection?.lastPriceRefresh ? new Date(window.collection.lastPriceRefresh) : null;
  $: human = when ? when.toLocaleString() : 'Never';
</script>

<div class="kpi">
  <div class="value" title={human}>{human}</div>
  <button class="action" on:click={() => window.app?.refreshPrices?.()}><LedgerIcon name="refresh" size={12} /> Refresh now</button>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 8px; }
  .value { font-size: 13px; font-weight: 600; color: var(--text, #ece9e1); line-height: 1.3; word-wrap: break-word; font-variant-numeric: tabular-nums lining-nums; }
  .action {
    align-self: flex-start;
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--border2, #303058);
    border-radius: 6px;
    color: var(--accent2, #e8b84b);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .action:hover { background: rgba(200,155,60,0.1); }
</style>
