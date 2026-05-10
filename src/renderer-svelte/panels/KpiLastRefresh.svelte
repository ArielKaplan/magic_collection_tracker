<script>
  import { collectionVersion } from '../stores.js';
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: when = window.collection?.lastPriceRefresh ? new Date(window.collection.lastPriceRefresh) : null;
  $: human = when ? when.toLocaleString() : 'Never';
</script>

<div class="kpi">
  <div class="value" title={human}>{human}</div>
  <button class="action" on:click={() => window.app?.refreshPrices?.()}>↻ Refresh now</button>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 8px; padding-top: 4px; }
  .value { font-size: 13px; font-weight: 600; color: var(--text, #ece9e1); line-height: 1.3; word-wrap: break-word; }
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
  }
  .action:hover { background: rgba(200,155,60,0.1); }
</style>
