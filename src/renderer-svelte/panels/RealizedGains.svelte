<script>
  import { collectionVersion, dashboardRange } from '../stores.js';
  import { dashboardRangeDays, dashboardRangeDescription } from '../timeRange.js';
  export let filter = null;
  $: $collectionVersion;
  $: rg = window.app?.realizedGains?.(dashboardRangeDays($dashboardRange)) ?? { gain: 0, proceeds: 0, cost: 0, count: 0, byYear: new Map() };
  $: totalSales = window.app?.realizedGains?.()?.count ?? 0;
  // Newest year first; 'Unknown' (no disposal date) sinks to the bottom.
  $: years = [...(rg.byYear?.entries?.() ?? [])]
      .sort((a, b) => (a[0] === 'Unknown') - (b[0] === 'Unknown') || b[0].localeCompare(a[0]));
  $: maxAbs = Math.max(1, ...years.map(([, y]) => Math.abs(y.gain)));
  const fmt = n => window.app?.fmt(n) ?? '—';
</script>

{#if !rg.count}
  <div class="empty">
    <span class="empty-mark"></span>
    <div>
      <strong>{totalSales ? `No realized activity in ${dashboardRangeDescription($dashboardRange).toLowerCase()}` : 'No realized activity yet'}</strong>
      <p>{totalSales ? 'Choose a longer history range to include earlier sales.' : 'Use Sell / dispose on a card or sealed product to build this history.'}</p>
    </div>
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
  .empty { height: 100%; min-height: 110px; display: flex; align-items: center; justify-content: center; gap: 13px; padding: 18px; color: var(--text-muted, #6f6d76); border: 1px dashed var(--border); border-radius: 10px; background: rgba(255,255,255,.012); }
  .empty-mark { width: 34px; height: 34px; flex: 0 0 auto; border: 1px solid var(--border2); border-radius: 50%; position: relative; }
  .empty-mark::before { content: ''; position: absolute; left: 9px; right: 9px; top: 16px; height: 1px; background: var(--text-muted); }
  .empty strong,.empty p { display: block; }
  .empty strong { color: var(--text); font-size: 12.5px; font-weight: 640; }
  .empty p { margin: 4px 0 0; max-width: 280px; font-size: 11px; line-height: 1.5; }
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
