<script>
  import { collectionVersion } from '../stores.js';
  // Filter is for binders, which doesn't affect sealed products — accept prop, ignore.
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: sv = window.app?.totalSealedValue() ?? 0;
  $: qty = (window.collection?.sealed || []).filter(i => i.status !== 'sold').reduce((s, i) => s + (i.quantity || 1), 0);
</script>

<div class="kpi">
  <div class="value">{window.app?.fmt(sv) ?? '—'}</div>
  <div class="sub">{qty} item{qty === 1 ? '' : 's'} tracked</div>
</div>

<style>
  .kpi { height: 100%; display: flex; flex-direction: column; justify-content: center; gap: 7px; }
  .value { font-size: 27px; font-weight: 700; letter-spacing: -0.025em; color: var(--text, #ececef); line-height: 1.05; font-variant-numeric: tabular-nums lining-nums; }
  .sub { font-size: 12px; color: var(--text-dim, #a3a1aa); line-height: 1.4; }
</style>
