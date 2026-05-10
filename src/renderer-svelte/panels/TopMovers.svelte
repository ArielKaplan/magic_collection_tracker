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
          <td class="name" title={m.card.name}>{m.card.name}</td>
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
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { text-align: left; font-weight: 600; color: var(--text-dim, #7a7692); border-bottom: 1px solid var(--border, #252545); padding: 4px 6px; font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.05em; }
  td { padding: 4px 6px; border-bottom: 1px solid rgba(255,255,255,0.03); }
  .name { font-weight: 600; max-width: 130px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dim { color: var(--text-dim, #7a7692); }
  .strong { font-weight: 700; }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
