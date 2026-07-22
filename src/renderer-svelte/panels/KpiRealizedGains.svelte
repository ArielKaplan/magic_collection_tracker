<script>
  import { collectionVersion, dashboardRange } from '../stores.js';
  import { dashboardRangeDays, dashboardRangeDescription } from '../timeRange.js';
  // Realized gains are collection-wide (cards + sealed) — binder filter doesn't apply.
  export let filter = null;
  $: $collectionVersion;
  $: rg = window.app?.realizedGains?.(dashboardRangeDays($dashboardRange)) ?? { gain: 0, proceeds: 0, count: 0 };
  $: rangeSuffix = $dashboardRange === 'all' ? '' : ` in ${dashboardRangeDescription($dashboardRange).toLowerCase()}`;
</script>

<div class="kpi">
  <div class="value" class:up={rg.gain >= 0} class:down={rg.gain < 0}>
    {rg.count ? (rg.gain >= 0 ? '+' : '') + (window.app?.fmt(rg.gain) ?? '—') : '—'}
  </div>
  <div class="sub">
    {#if rg.count}
      {rg.count} sold{rangeSuffix} · {window.app?.fmt(rg.proceeds) ?? '—'} proceeds
    {:else}
      {$dashboardRange === 'all' ? 'No sales recorded yet' : `No sales in ${dashboardRangeDescription($dashboardRange).toLowerCase()}`}
    {/if}
  </div>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 5px; }
  .value { font-size: 25px; font-weight: 700; letter-spacing: -0.02em; color: var(--text, #ece9e1); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 11.5px; color: var(--text-dim, #a3a1aa); line-height: 1.35; }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
