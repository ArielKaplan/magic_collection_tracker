<script>
  export let name = 'chart';
  export let size = 16;

  const paths = {
    total: 'M12 2v20M17 5.5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H7',
    cards: 'M4 4h13a2 2 0 0 1 2 2v12H6a2 2 0 0 1-2-2V4Zm4 4h7M8 12h7M8 16h4',
    sealed: 'm21 8-9-5-9 5 9 5 9-5ZM3 8v8l9 5 9-5V8M12 13v8',
    cost: 'M20.6 13.4 11 3.8A2 2 0 0 0 9.6 3H4a1 1 0 0 0-1 1v5.6A2 2 0 0 0 3.6 11l9.6 9.6a2 2 0 0 0 2.8 0l4.6-4.6a2 2 0 0 0 0-2.6ZM7 7h.01',
    folder: 'M3 6h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6Z',
    star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2-4.5-4.4 6.2-.9L12 3Z',
    gain: 'M3 17 9 11l4 4 8-9M15 6h6v6',
    refresh: 'M20 6v5h-5M4 18v-5h5M18.5 9A7 7 0 0 0 6 6.5L4 9m16 6-2 2.5A7 7 0 0 1 5.5 15',
    chart: 'M4 19V9m6 10V5m6 14v-7m4 7H2',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6m-6 4h4',
    card: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 6h18',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
    palette: 'M12 3a9 9 0 0 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h2a7 7 0 0 0 0-10h-2ZM7.5 10h.01M9.5 6.5h.01M14 6h.01M17 9h.01',
    dragon: 'M4 18c3-6 5-10 10-13-1 4 1 5 5 5-3 2-4 5-3 9-4-3-8-3-12-1Zm8-4 4 5',
    bolt: 'm13 2-8 12h7l-1 8 8-12h-7l1-8Z',
    sparkle: 'm12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z',
    stats: 'M4 20V10h4v10H4Zm6 0V4h4v16h-4Zm6 0v-7h4v7h-4Z',
    archive: 'M4 4h16v4H4V4Zm2 4h12v12H6V8Zm4 4h4',
    gem: 'm12 3 8 6-8 12L4 9l8-6Zm-8 6h16M8 4.5 10 9l2 12 2-12 2-4.5',
    calendar: 'M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Zm2-2v4m10-4v4M3 9h18',
    sliders: 'M4 7h10M18 7h2M4 17h2m4 0h10M14 4v6M8 14v6',
    plus: 'M12 5v14M5 12h14',
    arrange: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
    reset: 'M4 9V4m0 0h5M4 4l3 3a8 8 0 1 1-2 8',
    info: 'M12 17v-6m0-4h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    filter: 'M4 5h16l-6 7v6l-4 2v-8L4 5Z',
    up: 'm8 14 4-4 4 4',
    down: 'm8 10 4 4 4-4',
    close: 'm7 7 10 10M17 7 7 17',
    trash: 'M4 7h16M9 7V4h6v3m3 0-1 14H7L6 7m4 4v6m4-6v6',
    check: 'm5 12 4 4L19 6',
  };

  const aliases = {
    'kpi-total': 'total', 'kpi-cards': 'cards', 'kpi-sealed': 'sealed', 'kpi-cost': 'cost',
    'kpi-binders': 'folder', 'kpi-want': 'star', 'kpi-realized': 'gain', 'kpi-refresh': 'refresh',
    'portfolio-history': 'chart', 'realized-gains': 'receipt', 'sl-index': 'chart', 'cotd': 'card',
    'top-movers': 'gain', 'val-binder': 'chart', 'top10': 'list', 'val-color': 'palette',
    'val-type': 'dragon', 'val-cmc': 'bolt', 'val-rarity': 'sparkle', 'stats': 'stats',
    'set-count': 'archive', 'set-value': 'gem', 'year-count': 'calendar',
  };

  $: path = paths[name] || paths[aliases[name]] || paths.chart;
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  fill="none"
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={path}></path>
</svg>

<style>
  svg { display: block; flex: 0 0 auto; }
</style>
