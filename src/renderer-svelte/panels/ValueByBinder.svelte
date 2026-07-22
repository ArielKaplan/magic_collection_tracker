<script>
  import { collectionVersion } from '../stores.js';
  import { withFilteredCollection } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: rows = withFilteredCollection(filter, () => {
    const m = window.app?.binderValueMap?.();
    return m ? [...m.entries()].sort((a, b) => b[1].value - a[1].value) : [];
  });
  $: maxVal = Math.max(1, ...rows.map(r => r[1].value));
</script>

{#if rows.length === 0}
  <p class="empty">No cards match this filter.</p>
{:else}
  {#each rows as [name, info]}
    <div class="row">
      <div class="identity">
        <div class="lbl" title={name}>{name}</div>
        <div class="sub">{info.qty.toLocaleString()} copies</div>
      </div>
      <div class="val">{window.app?.fmt(info.value)}</div>
      <div class="track"><div class="fill" style:width={`${(info.value / maxVal * 100).toFixed(1)}%`}></div></div>
    </div>
  {/each}
{/if}

<style>
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 6px 0; }
  .row { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 6px 14px; align-items: end; padding: 5px 0 9px; }
  .identity { min-width: 0; }
  .lbl { font-size: 12.5px; font-weight: 580; color: var(--text, #ece9e1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sub { margin-top: 1px; font-size: 10.5px; color: var(--text-muted, #6f6d76); }
  .track { grid-column: 1 / -1; height: 5px; background: var(--border, #252545); border-radius: 99px; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(90deg, var(--accent, #c89b3c), var(--accent2, #e8b84b)); border-radius: inherit; }
  .val { text-align: right; font-size: 12.5px; font-weight: 650; color: var(--text, #ececef); font-variant-numeric: tabular-nums lining-nums; }
</style>
