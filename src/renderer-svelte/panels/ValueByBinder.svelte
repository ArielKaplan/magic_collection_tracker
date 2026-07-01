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
      <div class="lbl" title={name}>{name}</div>
      <div class="track"><div class="fill" style:width={`${(info.value / maxVal * 100).toFixed(1)}%`}></div></div>
      <div class="val">{window.app?.fmt(info.value)}</div>
    </div>
    <div class="sub">{info.qty} copies</div>
  {/each}
{/if}

<style>
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 6px 0; }
  .row { display: grid; grid-template-columns: 110px 1fr 80px; gap: 8px; align-items: center; padding: 4px 0 0; }
  .lbl { font-size: 12px; color: var(--text, #ece9e1); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { height: 6px; background: var(--border, #252545); border-radius: 3px; overflow: hidden; }
  .fill { height: 100%; background: linear-gradient(90deg, var(--accent, #c89b3c), var(--accent2, #e8b84b)); }
  .val { text-align: right; font-size: 12px; font-weight: 600; color: var(--text, #ececef); }
  .sub { font-size: 10px; color: var(--text-muted, #4a4668); padding: 0 0 6px 0; }
</style>
