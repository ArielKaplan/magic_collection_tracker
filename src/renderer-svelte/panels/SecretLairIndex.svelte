<script>
  import { onMount, onDestroy } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  import { collectionVersion } from '../stores.js';

  Chart.register(...registerables);

  // Secret Lair portfolio — collection-wide, not binder-filterable.
  // eslint-disable-next-line no-unused-vars
  export let filter = null;

  let canvas;
  let chart = null;
  let mounted = false;
  let count = 0;

  $: idx = ($collectionVersion, window.app?.computeSlIndex?.() ?? null);
  $: if (mounted) { $collectionVersion; drawChart(); }

  onMount(() => { mounted = true; drawChart(); });
  onDestroy(() => { if (chart) { chart.destroy(); chart = null; } });

  function slSnaps() {
    const arr = (window.collection?.portfolioSnapshots || []).filter(s => s.slValue != null || s.slCost != null);
    return [...arr].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function shortDate(d) {
    const [y, m, day] = (d || '').split('-').map(Number);
    if (!y) return d;
    return new Date(y, (m || 1) - 1, day || 1).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function drawChart() {
    if (!canvas) return;
    if (chart) { chart.destroy(); chart = null; }

    const snaps = slSnaps();
    count = snaps.length;
    if (!snaps.length) return;

    const labels = snaps.map(s => shortDate(s.date));
    const value  = snaps.map(s => s.slValue ?? 0);
    const cost   = snaps.map(s => s.slCost ?? 0);

    const tickColor = '#a3a1aa';
    const gridColor = 'rgba(255,255,255,0.05)';
    const fmt = v => window.app?.fmt?.(v) ?? `$${(v ?? 0).toFixed(2)}`;

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'SL value', data: value, borderColor: '#3dba6f', backgroundColor: '#3dba6f22',
            borderWidth: 2.5, fill: true, tension: 0.25, pointRadius: snaps.length > 30 ? 0 : 2, pointHoverRadius: 4 },
          { label: 'Cost (MSRP)', data: cost, borderColor: '#7a7692', backgroundColor: 'transparent',
            borderWidth: 1.5, borderDash: [5, 4], fill: false, tension: 0.25, pointRadius: 0, pointHoverRadius: 4 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'top', align: 'end',
            labels: { color: tickColor, font: { size: 10, family: 'Inter, Segoe UI, sans-serif' }, boxWidth: 10, padding: 8, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: tickColor, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
               grid: { color: 'transparent' }, border: { color: 'rgba(255,255,255,0.08)' } },
          y: { ticks: { color: tickColor, font: { size: 10 }, callback: v => fmt(v) },
               grid: { color: gridColor }, border: { color: 'rgba(255,255,255,0.08)' } },
        },
      },
    });
  }

  const fmt = v => window.app?.fmt?.(v) ?? '—';
  $: ret = idx ? idx.totalReturn : 0;
  $: retColor = ret >= 0 ? 'var(--green, #3dba6f)' : 'var(--red, #e05555)';
</script>

{#if !idx || idx.dropCount === 0}
  <p class="empty">No Secret Lair holdings yet. Own singles from a drop or add a sealed drop (with its price) to start tracking your SL index.</p>
{:else}
  <div class="head">
    <div class="ret" style="color:{retColor}">{ret >= 0 ? '+' : ''}{fmt(ret)}</div>
    <div class="sub">
      total return on {fmt(idx.cost)} cost
      {#if idx.totalReturnPct != null}· <span style="color:{retColor}">{idx.totalReturnPct >= 0 ? '+' : ''}{idx.totalReturnPct.toFixed(0)}%</span>{/if}
      · {fmt(idx.realized)} realized
    </div>
  </div>
  {#if count > 0}
    <div class="chart-wrap"><canvas bind:this={canvas}></canvas></div>
  {:else}
    <p class="hint">The value-over-time line fills in as daily price-refresh snapshots accrue.</p>
  {/if}
{/if}

<style>
  .head { margin-bottom: 8px; }
  .ret { font-size: 24px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
  .sub { font-size: 11.5px; color: var(--text-dim, #7a7692); margin-top: 4px; }
  .chart-wrap { width: 100%; height: calc(100% - 46px); min-height: 120px; display: flex; align-items: stretch; }
  canvas { width: 100% !important; height: 100% !important; }
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 8px 0; line-height: 1.5; }
  .hint { color: var(--text-muted, #4a4668); font-size: 10.5px; margin: 0; }
</style>
