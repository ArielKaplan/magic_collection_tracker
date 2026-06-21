<script>
  import { collectionVersion } from '../stores.js';
  // Realized gains are collection-wide (cards + sealed) — binder filter doesn't apply.
  export let filter = null;
  $: $collectionVersion;
  $: rg = window.app?.realizedGains?.() ?? { gain: 0, proceeds: 0, count: 0 };
</script>

<div class="kpi">
  <div class="value" class:up={rg.gain >= 0} class:down={rg.gain < 0}>
    {rg.count ? (rg.gain >= 0 ? '+' : '') + (window.app?.fmt(rg.gain) ?? '—') : '—'}
  </div>
  <div class="sub">
    {#if rg.count}
      {rg.count} sold · {window.app?.fmt(rg.proceeds) ?? '—'} proceeds
    {:else}
      No sales recorded yet
    {/if}
  </div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--text, #ece9e1); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
