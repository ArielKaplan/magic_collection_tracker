<script>
  import { collectionVersion } from '../stores.js';
  import { withFilteredCollection } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: data = withFilteredCollection(filter, () => window.app?.valueByColor?.() || {});
  $: rows = Object.entries(data).sort((a, b) => b[1].value - a[1].value);
  $: maxVal = Math.max(1, ...rows.map(r => r[1].value));

  const COLOR_LABEL = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', C: 'Colorless', M: 'Multicolor' };
  const COLOR_DOT   = { W: '#f0e6c0', U: '#5b9cf6', B: '#5e3d6b', R: '#e05555', G: '#3dba6f', C: '#9aa0b0', M: '#c89b3c' };
</script>

{#if rows.length === 0}
  <p class="empty">No color data — run a price refresh, or no cards match this filter.</p>
{:else}
  {#each rows as [code, info]}
    <div class="row">
      <span class="dot" style:background={COLOR_DOT[code] || '#888'}></span>
      <span class="lbl">{COLOR_LABEL[code] || code}</span>
      <div class="track"><div class="fill" style:width={`${(info.value / maxVal * 100).toFixed(1)}%`} style:background={COLOR_DOT[code] || '#888'}></div></div>
      <span class="val">{window.app?.fmt(info.value)}</span>
    </div>
  {/each}
{/if}

<style>
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 6px 0; }
  .row { display: grid; grid-template-columns: 14px 80px 1fr 70px; gap: 8px; align-items: center; padding: 5px 0; font-size: 12px; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .lbl { color: var(--text, #ece9e1); }
  .track { height: 6px; background: var(--border, #252545); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; opacity: 0.8; }
  .val { text-align: right; font-weight: 600; color: var(--accent2, #e8b84b); }
</style>
