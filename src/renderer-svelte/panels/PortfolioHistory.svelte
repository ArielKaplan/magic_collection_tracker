<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  import { collectionVersion } from '../stores.js';

  Chart.register(...registerables);

  // Collection-wide series — not binder-filterable (snapshots aren't stored
  // per binder), so `filter` is accepted (every panel gets it) but ignored.
  // eslint-disable-next-line no-unused-vars
  export let filter = null;

  let canvas;
  let chart = null;
  let mounted = false;
  let count = 0;

  $: if (mounted) { $collectionVersion; refresh(); }

  onMount(() => { mounted = true; refresh(); });
  onDestroy(() => { if (chart) { chart.destroy(); chart = null; } });

  // count must be set BEFORE drawChart: the {#if} needs to flip and mount the
  // canvas first, or drawChart's canvas guard exits and the chart never draws
  // (the empty-state deadlock this replaces).
  async function refresh() {
    count = snapshots().length;
    await tick();
    drawChart();
  }

  function snapshots() {
    const arr = window.collection?.portfolioSnapshots || [];
    return [...arr].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  }

  function shortDate(d) {
    // d is YYYY-MM-DD (local). Parse as local, not UTC, to avoid off-by-one.
    const [y, m, day] = (d || '').split('-').map(Number);
    if (!y) return d;
    return new Date(y, (m || 1) - 1, day || 1)
      .toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function drawChart() {
    if (chart) { chart.destroy(); chart = null; }
    if (!canvas) return;

    const snaps = snapshots();
    if (!snaps.length) return;

    const labels = snaps.map(s => shortDate(s.date));
    const total  = snaps.map(s => (s.cardsValue || 0) + (s.sealedValue || 0));
    const cards  = snaps.map(s => s.cardsValue || 0);
    const sealed = snaps.map(s => s.sealedValue || 0);
    const cost   = snaps.map(s => s.costBasis || 0);

    const tickColor = '#a3a1aa';
    const gridColor = 'rgba(255,255,255,0.05)';
    const fmt = v => window.app?.fmt?.(v) ?? `$${(v ?? 0).toFixed(2)}`;

    const line = (label, data, color, opts = {}) => ({
      label, data,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: 2,
      pointRadius: snaps.length > 30 ? 0 : 2,
      pointHoverRadius: 4,
      tension: 0.25,
      ...opts,
    });

    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          line('Total',  total,  '#c89b3c', { fill: true, borderWidth: 2.5 }),
          line('Cards',  cards,  '#5b9cf6'),
          line('Sealed', sealed, '#f08030'),
          line('Cost basis', cost, '#7a7692', { borderDash: [5, 4], borderWidth: 1.5, fill: false }),
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: tickColor, font: { size: 10, family: 'Inter, Segoe UI, sans-serif' }, boxWidth: 10, padding: 8, usePointStyle: true },
          },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` },
          },
        },
        scales: {
          x: {
            ticks: { color: tickColor, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
            grid: { color: 'transparent' },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            ticks: { color: tickColor, font: { size: 10 }, callback: v => fmt(v) },
            grid: { color: gridColor },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
        },
      },
    });
  }
</script>

{#if count === 0}
  <div class="empty-state"><strong>Start your value history</strong><span>Refresh prices to record the first daily portfolio snapshot.</span></div>
{:else if count === 1}
  <div class="empty-state tracking"><strong>Tracking started today</strong><span>Your trend line appears after the next daily price snapshot.</span></div>
{:else}
  <div class="chart-wrap">
    <canvas bind:this={canvas}></canvas>
  </div>
{/if}

<style>
  .chart-wrap { width: 100%; height: 100%; min-height: 140px; display: flex; align-items: stretch; }
  canvas { width: 100% !important; height: 100% !important; }
  .empty-state { height: 100%; min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 24px; border: 1px dashed var(--border); border-radius: 10px; background: rgba(255,255,255,.012); }
  .empty-state::before { content: ''; width: 42px; height: 24px; margin-bottom: 14px; border-left: 2px solid var(--accent); border-bottom: 2px solid var(--accent); clip-path: polygon(0 70%,25% 48%,43% 62%,68% 20%,100% 0,100% 100%,0 100%); opacity: .75; }
  .empty-state strong { color: var(--text); font-size: 13.5px; font-weight: 650; }
  .empty-state span { max-width: 360px; margin-top: 5px; color: var(--text-muted); font-size: 11.5px; line-height: 1.5; }
  .empty-state.tracking::before { opacity: 1; }
</style>
