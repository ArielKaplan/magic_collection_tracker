<script>
  import { collectionVersion } from '../stores.js';
  export let filter = null;
  $: $collectionVersion;
  $: rg = window.app?.realizedGains?.() ?? { gain: 0, proceeds: 0, cost: 0, count: 0, byYear: new Map() };
  // Newest year first; 'Unknown' (no disposal date) sinks to the bottom.
  $: years = [...(rg.byYear?.entries?.() ?? [])]
      .sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[0].localeCompare(a[0]));
  $: maxAbs = Math.max(1, ...years.map(([, y]) => Math.abs(y.gain)));
  const fmt = n => window.app?.fmt(n) ?? '—';
</script>

{#if !rg.count}
  <div class="empty">
    No sales recorded yet. Right-click a card or sealed product →
    <strong>💵 Sell / dispose</strong> to log a sale and see realized gains here.
  </div>
{:else}
  <div class="totals">
    <div class="big" class:up={rg.gain >= 0} class:down={rg.gain < 0}>
      {rg.gain >= 0 ? '+' : ''}{fmt(rg.gain)}
    </div>
    <div class="totals-sub">
      net realized · {fmt(rg.proceeds)} proceeds − {fmt(rg.cost)} cost · {rg.count} sale{rg.count === 1 ? '' : 's'}
    </div>
  </div>
  <div class="rows">
    {#each years as [year, y] (year)}
      <div class="row">
        <div class="yr">{year}</div>
        <div class="track">
          <div class="fill" class:neg={y.gain < 0}
               style="width:{(Math.abs(y.gain) / maxAbs * 100).toFixed(1)}%"></div>
        </div>
        <div class="amt" class:up={y.gain >= 0} class:down={y.gain < 0}>
          {y.gain >= 0 ? '+' : ''}{fmt(y.gain)}
        </div>
      </div>
      <div class="sub">{y.count} sale{y.count === 1 ? '' : 's'} · {fmt(y.proceeds)} proceeds</div>
    {/each}
  </div>
{/if}

<style>
  .empty { color: var(--text-muted, #9a96aa); font-size: 13px; line-height: 1.6; padding: 8px 2px; }
  .totals { margin-bottom: 14px; }
  .big { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
  .totals-sub { font-size: 11.5px; color: var(--text-dim, #7a7692); margin-top: 4px; }
  .rows { display: flex; flex-direction: column; }
  .row { display: flex; align-items: center; gap: 10px; }
  .yr { width: 56px; font-size: 13px; font-weight: 600; color: var(--text, #ece9e1); }
  .track { flex: 1; height: 9px; background: var(--surface-2, #1c1a26); border-radius: 5px; overflow: hidden; }
  .fill { height: 100%; background: var(--green, #3dba6f); border-radius: 5px; }
  .fill.neg { background: var(--red, #e05555); }
  .amt { width: 84px; text-align: right; font-size: 13px; font-weight: 700; }
  .sub { font-size: 10.5px; color: var(--text-dim, #7a7692); margin: 1px 0 9px 66px; }
  .up { color: var(--green, #3dba6f); }
  .down { color: var(--red, #e05555); }
</style>
