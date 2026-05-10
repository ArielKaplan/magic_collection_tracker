<script>
  import { collectionVersion } from '../stores.js';
  // Filter is for binders, which doesn't affect sealed products — accept prop, ignore.
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: sv = window.app?.totalSealedValue() ?? 0;
  $: qty = (window.collection?.sealed || []).reduce((s, i) => s + (i.quantity || 1), 0);
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(sv) ?? '—'}</div>
  <div class="sub">{qty} item{qty === 1 ? '' : 's'} tracked</div>
</div>

<style>
  .kpi { display: flex; flex-direction: column; gap: 4px; padding-top: 4px; }
  .value { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--accent2, #e8b84b); line-height: 1; }
  .sub { font-size: 11px; color: var(--text-dim, #7a7692); }
</style>
