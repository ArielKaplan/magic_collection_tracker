<script>
  import { onDestroy } from 'svelte';
  import { Chart, registerables } from 'chart.js';
  import { collectionVersion } from '../stores.js';
  import { filterCards } from '../filter.js';

  Chart.register(...registerables);

  export let filter = null;
  export let config = {};

  let canvas;
  let chart = null;
  let mounted = false;

  // Reactive: redraw whenever data, filter, or config changes
  $: if (mounted) { $collectionVersion; filter; config; drawChart(); }

  import { onMount } from 'svelte';
  onMount(() => { mounted = true; drawChart(); });
  onDestroy(() => { if (chart) { chart.destroy(); chart = null; } });

  const COLORS = [
    '#c89b3c','#5b9cf6','#3dba6f','#9b7bfa',
    '#f08030','#e05555','#f5c842','#60c8c8',
    '#e87ca0','#7bc85b','#a78bfa','#fb923c',
    '#34d399','#60a5fa','#f472b6',
  ];

  const X_AXIS_LABELS = {
    binder: 'Binder', color: 'Color', rarity: 'Rarity',
    set: 'Set', condition: 'Condition', language: 'Language',
    type: 'Card Type', cmc: 'Mana Cost',
  };

  const Y_AXIS_LABELS = {
    value: 'Market Value', count: 'Unique Cards', qty: '# Copies',
    cost: 'Cost Basis', avg: 'Avg Price', gain: 'Gain / Loss',
  };

  function getGroupKeys(card, xAxis) {
    switch (xAxis) {
      case 'binder': return [card.binderName || 'Unknown'];
      case 'rarity': return [card.rarity || 'Unknown'];
      case 'set': return [card.setCode ? `${card.setCode} — ${card.setName || card.setCode}` : 'Unknown'];
      case 'condition': return [card.condition || 'Unknown'];
      case 'language': return [(card.language || 'en').toUpperCase()];
      case 'color': {
        const meta = window.collection?.cardMetadata?.[card.scryfallId];
        const colors = meta?.colors || [];
        if (colors.length === 0) return ['Colorless'];
        if (colors.length > 1) return ['Multicolor'];
        const map = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
        return [map[colors[0]] || colors[0]];
      }
      case 'type': {
        const meta = window.collection?.cardMetadata?.[card.scryfallId];
        const typeLine = (meta?.type_line || '').split(' — ')[0];
        const mainTypes = ['Creature','Instant','Sorcery','Enchantment','Artifact','Land','Planeswalker','Battle'];
        const found = typeLine.split(' ').find(t => mainTypes.includes(t));
        return [found || typeLine.split(' ')[0] || 'Unknown'];
      }
      case 'cmc': {
        const meta = window.collection?.cardMetadata?.[card.scryfallId];
        const cmc = meta?.cmc;
        return [cmc != null ? String(Math.round(cmc)) : '?'];
      }
      default: return [card.binderName || 'Unknown'];
    }
  }

  function computeData() {
    const cards = filterCards(window.collection?.cards || [], filter);
    const { xAxis = 'binder', yAxis = 'value', limit = 15 } = config;

    const groups = new Map();
    for (const c of cards) {
      for (const key of getGroupKeys(c, xAxis)) {
        if (!groups.has(key)) groups.set(key, { qty: 0, value: 0, cost: 0, count: 0 });
        const g = groups.get(key);
        g.count++;
        g.qty += c.quantity || 1;
        const v = window.app?.cardCurrentValue?.(c) ?? 0;
        g.value += v * (c.quantity || 1);
        g.cost += (c.purchasePrice || 0) * (c.quantity || 1);
      }
    }

    let entries = [...groups.entries()].map(([label, g]) => {
      let y;
      switch (yAxis) {
        case 'value': y = g.value; break;
        case 'count': y = g.count; break;
        case 'qty':   y = g.qty;   break;
        case 'cost':  y = g.cost;  break;
        case 'avg':   y = g.qty > 0 ? g.value / g.qty : 0; break;
        case 'gain':  y = g.value - g.cost; break;
        default:      y = g.value;
      }
      return { label, y };
    });

    entries.sort((a, b) => b.y - a.y);
    const lim = Number(config.limit) || 15;
    if (lim > 0) entries = entries.slice(0, lim);
    return entries;
  }

  function drawChart() {
    if (!canvas) return;
    if (chart) { chart.destroy(); chart = null; }

    const entries = computeData();
    if (!entries.length) return;

    const { chartType = 'bar', yAxis = 'value' } = config;
    const isMoney = ['value', 'cost', 'avg', 'gain'].includes(yAxis);
    const isPie = chartType === 'pie' || chartType === 'doughnut';
    const isHBar = chartType === 'bar-h';
    const actualType = (isPie ? chartType : 'bar');

    const labels = entries.map(e => e.label);
    const data   = entries.map(e => e.y);
    const bgColors = entries.map((_, i) =>
      isPie ? COLORS[i % COLORS.length] : COLORS[i % COLORS.length] + 'bb'
    );
    const borderColors = entries.map((_, i) => COLORS[i % COLORS.length]);

    const gridColor = 'rgba(255,255,255,0.05)';
    const tickColor = '#a3a1aa';
    const fmt = v => isMoney ? (window.app?.fmt?.(v) ?? `$${v.toFixed(2)}`) : v.toLocaleString();

    chart = new Chart(canvas, {
      type: actualType,
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgColors,
          borderColor: isPie ? 'transparent' : borderColors,
          borderWidth: isPie ? 0 : 1,
          borderRadius: isPie ? 0 : 3,
        }],
      },
      options: {
        indexAxis: isHBar ? 'y' : 'x',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 200 },
        plugins: {
          legend: {
            display: isPie,
            position: 'right',
            labels: { color: tickColor, font: { size: 10, family: 'Inter, Segoe UI, sans-serif' }, boxWidth: 10, padding: 6 },
          },
          tooltip: {
            callbacks: {
              label: ctx => {
                const v = isHBar ? ctx.parsed.x : (isPie ? ctx.parsed : ctx.parsed.y);
                return ` ${fmt(v)}`;
              },
            },
          },
        },
        scales: isPie ? {} : {
          x: {
            ticks: { color: tickColor, font: { size: 10 }, maxRotation: isHBar ? 0 : 35,
              callback: isHBar ? (v => fmt(v)) : undefined },
            grid: { color: isHBar ? gridColor : 'transparent' },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            ticks: { color: tickColor, font: { size: 10 },
              callback: isHBar ? undefined : (v => fmt(v)) },
            grid: { color: isHBar ? 'transparent' : gridColor },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
        },
      },
    });
  }
</script>

{#if !config || !config.xAxis}
  <p class="empty">No chart configuration found.</p>
{:else}
  <div class="chart-wrap">
    <canvas bind:this={canvas}></canvas>
  </div>
{/if}

<style>
  .chart-wrap {
    width: 100%;
    height: 100%;
    min-height: 140px;
    display: flex;
    align-items: stretch;
  }
  canvas { width: 100% !important; height: 100% !important; }
  .empty { color: var(--text-muted, #4a4668); font-size: 12px; padding: 8px 0; }
</style>
