<script>
  import { collectionVersion } from '../stores.js';
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: s = window.app?.wantListSummary?.() || { count: 0, acquireCost: 0, atTarget: 0, withTarget: 0 };
</script>

<div class="kpi">
  <div class="value">{s.count}</div>
  <div class="sub">
    {window.app?.fmt(s.acquireCost) ?? '—'} to acquire{#if s.withTarget} · <span class="hit">{s.atTarget}/{s.withTarget} at target</span>{/if}
  </div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 22px; font-weight: 800; letter-spacing: -0.02em; color: var(--text, #ece9e1); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
  .hit { color: var(--green, #7bd89f); font-weight: 600; }
</style>
