<script>
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: rows = filterCards(window.collection?.cards || [], filter)
    .map(c => ({ c, v: window.app?.cardCurrentValue?.(c) ?? 0 }))
    .filter(r => r.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
</script>

{#if rows.length === 0}
  <p class="empty">No priced cards in this filter.</p>
{:else}
  <ol class="list">
    {#each rows as r, i}
      <li>
        <span class="rank">{i + 1}</span>
        <span class="name" title={r.c.name}
          on:mouseenter={e => window.app?.showCardHoverPreview?.(e.currentTarget, r.c)}
          on:mouseleave={() => window.app?.hideCardHoverPreview?.()}
        >{r.c.name}</span>
        {#if r.c.foil !== 'normal'}<span class="foil">{window.app?.FOIL_LABEL?.[r.c.foil] || r.c.foil}</span>{/if}
        <span class="set">{r.c.setCode}</span>
        <span class="val">{window.app?.fmt(r.v)}</span>
      </li>
    {/each}
  </ol>
{/if}

<style>
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 6px 0; }
  .list { list-style: none; padding: 0; margin: 0; }
  li { display: grid; grid-template-columns: 18px 1fr auto auto auto; gap: 6px; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.03); align-items: center; font-size: 12px; }
  .rank { color: var(--text-muted, #4a4668); font-weight: 700; font-size: 10.5px; text-align: right; }
  .name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .foil { font-size: 9.5px; padding: 1px 5px; border-radius: 99px; background: rgba(200,155,60,0.15); color: var(--accent2, #e8b84b); }
  .set { color: var(--text-dim, #7a7692); font-size: 10.5px; font-weight: 600; }
  .val { font-weight: 700; color: var(--accent2, #e8b84b); text-align: right; min-width: 56px; }
</style>
