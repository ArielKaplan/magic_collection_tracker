<script>
  import { collectionVersion } from '../stores.js';
  import { withFilteredCollection } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: movers = withFilteredCollection(filter, () => window.app?.topMovers?.() || []);
</script>

{#if movers.length === 0}
  <p class="empty">Refresh prices at least twice to see movers.</p>
{:else}
  <table>
    <thead><tr><th>Card</th><th>Foil</th><th>Set</th><th>Before</th><th>After</th><th>Δ</th></tr></thead>
    <tbody>
      {#each movers as m}
        <tr>
          <td class="name" title={m.card.name}
            on:mouseenter={e => window.app?.showCardHoverPreview?.(e.currentTarget, m.card)}
            on:mouseleave={() => window.app?.hideCardHoverPreview?.()}
          >{m.card.name}</td>
          <td>{m.card.foil !== 'normal' ? (window.app?.FOIL_LABEL?.[m.card.foil] || m.card.foil) : '—'}</td>
          <td class="dim">{m.card.setCode}</td>
          <td class="dim">{window.app?.fmt(m.change.previous)}</td>
          <td class="strong">{window.app?.fmt(m.change.current)}</td>
          <td class="strong" class:up={m.change.pct >= 0} class:down={m.change.pct < 0}>{window.app?.fmtPct(m.change.pct)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 6px 0; }
  table { width: 100%; border-collapse: collapse; table-layout: auto; font-size: 12px; }
  th { text-align: left; font-weight: 650; color: var(--text-muted, #6f6d76); border-bottom: 1px solid var(--border, #252545); padding: 5px 8px 8px; font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.065em; }
  td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.035); line-height: 1.25; }
  th:nth-child(n+4), td:nth-child(n+4) { text-align: right; font-variant-numeric: tabular-nums lining-nums; }
  tbody tr:hover td { background: rgba(255,255,255,.018); }
  .name { font-weight: 620; min-width: 150px; max-width: 260px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dim { color: var(--text-dim, #7a7692); }
  .strong { font-weight: 680; }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
