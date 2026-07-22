<script>
  import { onMount, onDestroy } from 'svelte';
  import Panel from './Panel.svelte';
  import LedgerIcon from './LedgerIcon.svelte';
  import CustomChart from './panels/CustomChart.svelte';
  import { PANELS, panelDef, isCustomPanel, defaultLayout } from './panels.js';
  import { layout, snapEnabled, dashboardRange } from './stores.js';
  import { DASHBOARD_RANGES, normalizeDashboardRange } from './timeRange.js';

  const SETTING_KEY = 'dashboard_layout_v2';
  const AUTO_KEY = 'dashboard_auto_layout';
  const VISUAL_LAYOUT_KEY = 'dashboard_visual_layout_version';
  const RANGE_KEY = 'dashboard_time_range_v1';
  const VISUAL_LAYOUT_VERSION = 3;
  let saveTimer;
  let canvasEl;
  let resizeObs;
  let arrangeTimer;
  let autoLayout = true;
  let responsiveWidths = new Map();
  let showCustomize = false;
  let customizeEl;
  let selectedRange = 'all';

  const PANEL_GROUPS = [
    { label: 'Portfolio summary', ids: ['kpi-total', 'kpi-cards', 'kpi-sealed', 'kpi-cost', 'kpi-realized', 'kpi-refresh'] },
    { label: 'Collection', ids: ['kpi-binders', 'kpi-want', 'cotd', 'top10', 'stats'] },
    { label: 'Performance', ids: ['portfolio-history', 'sl-index', 'realized-gains', 'top-movers'] },
    { label: 'Breakdowns', ids: ['val-binder', 'val-color', 'val-type', 'val-cmc', 'val-rarity', 'set-count', 'set-value', 'year-count'] },
  ];
  const CURATED_ORDER = [
    'kpi-total', 'kpi-cards', 'kpi-sealed', 'kpi-cost',
    'kpi-binders', 'kpi-want', 'kpi-realized', 'kpi-refresh',
    'portfolio-history', 'sl-index',
    'top-movers', 'val-binder',
    'cotd', 'top10', 'stats', 'realized-gains',
    'val-color', 'val-type', 'val-rarity', 'val-cmc',
    'set-count', 'set-value', 'year-count',
  ];

  let panelsState = [];
  const unsub = layout.subscribe(v => panelsState = v);
  onDestroy(unsub);
  const unsubRange = dashboardRange.subscribe(value => selectedRange = value);
  onDestroy(unsubRange);

  onMount(async () => {
    const [raw, rawAuto, rawVisualVersion, rawRange] = await Promise.all([
      window.api.settings.get(SETTING_KEY),
      window.api.settings.get(AUTO_KEY),
      window.api.settings.get(VISUAL_LAYOUT_KEY),
      window.api.settings.get(RANGE_KEY),
    ]);
    dashboardRange.set(normalizeDashboardRange(rawRange));
    autoLayout = rawAuto == null || rawAuto === '' ? true : rawAuto === '1';
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch {} }
    let initial = (parsed && Array.isArray(parsed) && parsed.length) ? parsed : defaultLayout();

    // Auto-arranged dashboards adopt the new editorial sizing once. Manual
    // layouts remain untouched because their positions are user-authored.
    if (autoLayout && Number(rawVisualVersion || 0) < VISUAL_LAYOUT_VERSION) {
      initial = initial.map(p => {
        const def = panelDef(p.id);
        return def ? { ...p, width: def.defaultSize.w, height: def.defaultSize.h } : p;
      });
      window.api.settings.set(VISUAL_LAYOUT_KEY, String(VISUAL_LAYOUT_VERSION)).catch?.(() => {});
    }
    // Ensure every defined panel has a state row (so newly-added panel types
    // appear after a code update without the user needing to reset). They're
    // added visible — a new panel type is a new feature worth surfacing; the
    // user can hide it. Auto-layout (on by default) tiles it into the canvas.
    for (const def of PANELS) {
      if (!initial.find(p => p.id === def.id)) {
        initial.push({ id: def.id, x: 14, y: 14, width: def.defaultSize.w, height: def.defaultSize.h, collapsed: false, visible: def.defaultVisible !== false, zIndex: initial.length + 1 });
      }
    }
    // Clamp into bounds — panels dragged to negative coords would render
    // clipped under the toolbar / off the left edge with no way to scroll.
    for (const p of initial) { p.x = Math.max(0, p.x || 0); p.y = Math.max(0, p.y || 0); }
    layout.set(initial);

    if (autoLayout) requestAnimationFrame(arrangeToCanvas);

    // Re-flow on window/canvas resize while auto layout is on.
    resizeObs = new ResizeObserver(() => {
      if (!autoLayout) return;
      clearTimeout(arrangeTimer);
      arrangeTimer = setTimeout(arrangeToCanvas, 120);
    });
    if (canvasEl) resizeObs.observe(canvasEl);
  });
  onDestroy(() => { resizeObs?.disconnect(); clearTimeout(arrangeTimer); });
  onMount(() => {
    const closeCustomize = event => {
      if (showCustomize && customizeEl && !customizeEl.contains(event.target)) showCustomize = false;
    };
    window.addEventListener('pointerdown', closeCustomize);
    return () => window.removeEventListener('pointerdown', closeCustomize);
  });

  function canvasWidth() {
    return Math.max(320, (canvasEl?.clientWidth || 1480) - 14);
  }

  // Tile all visible panels into the actual canvas width, keeping each
  // panel's current size. Built-ins flow in canonical order, custom charts
  // append at the end. Hidden panels are left untouched.
  function arrangeToCanvas() {
    const W = canvasWidth();
    const gap = 14;
    const order = [];
    for (const id of CURATED_ORDER) {
      const def = panelDef(id);
      const p = panelsState.find(pp => pp.id === id && pp.visible);
      if (p) order.push({ panel: p, breakBefore: def?.breakBefore === true });
    }
    for (const p of panelsState) {
      if (p.visible && isCustomPanel(p.id)) order.push({ panel: p, breakBefore: false });
    }
    let x = 14, y = 14, rowMax = 0;
    const pos = new Map();
    const widths = new Map();
    for (const { panel: p, breakBefore } of order) {
      const h = p.collapsed ? 40 : p.height;
      const displayWidth = Math.min(p.width, Math.max(280, W - 14));
      if (x > 14 && (breakBefore || x + displayWidth > W)) { x = 14; y += rowMax + gap; rowMax = 0; }
      pos.set(p.id, { x, y });
      widths.set(p.id, displayWidth);
      x += displayWidth + gap;
      rowMax = Math.max(rowMax, h);
    }
    responsiveWidths = widths;
    panelsState = panelsState.map(p => pos.has(p.id) ? { ...p, ...pos.get(p.id) } : p);
    layout.set(panelsState);
    scheduleSave();
  }

  function setAutoLayout(v) {
    autoLayout = v;
    if (!v) responsiveWidths = new Map();
    window.api.settings.set(AUTO_KEY, v ? '1' : '0').catch?.(() => {});
    if (v) arrangeToCanvas();
  }

  // Debounced save — every layout change triggers a re-save 250ms later.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await window.api.settings.set(SETTING_KEY, JSON.stringify(panelsState)); } catch {}
    }, 250);
  }

  function updatePanel(id, patch) {
    const prev = panelsState.find(p => p.id === id);
    const dragged  = prev && ['x', 'y'].some(k => patch[k] != null && patch[k] !== prev[k]);
    const resized  = prev && ['width', 'height'].some(k => patch[k] != null && patch[k] !== prev[k]);
    const folded   = prev && patch.collapsed != null && patch.collapsed !== prev.collapsed;
    panelsState = panelsState.map(p => p.id === id ? { ...p, ...patch } : p);
    layout.set(panelsState);
    scheduleSave();
    if (!autoLayout) return;
    // Dragging a panel means the user wants manual placement; resizing or
    // collapsing just changes the flow, so re-tile around the new size.
    if (dragged && !folded) setAutoLayout(false);
    else if (resized || folded) arrangeToCanvas();
  }

  function bringToFront(id) {
    const max = Math.max(0, ...panelsState.map(p => p.zIndex || 0));
    updatePanel(id, { zIndex: max + 1 });
  }

  function autoArrange() {
    if (!autoLayout) setAutoLayout(true);   // arranges as a side effect
    else arrangeToCanvas();
  }

  function resetLayout() {
    if (!confirm('Reset dashboard to default layout? Your panel positions will be lost.')) return;
    panelsState = defaultLayout(canvasWidth());
    layout.set(panelsState);
    scheduleSave();
    setAutoLayout(true);
  }

  function toggleVisible(id) {
    const p = panelsState.find(pp => pp.id === id);
    if (!p) return;
    if (!p.visible) bringToFront(id);
    updatePanel(id, { visible: !p.visible });
    if (autoLayout) arrangeToCanvas();
  }

  function toggleSnap() { snapEnabled.update(v => !v); }
  function setDashboardRange(value) {
    const normalized = normalizeDashboardRange(value);
    dashboardRange.set(normalized);
    window.api.settings.set(RANGE_KEY, normalized).catch?.(() => {});
  }
  function handleKeydown(event) {
    if (event.key === 'Escape') showCustomize = false;
  }
  let snap = false;
  const unsub2 = snapEnabled.subscribe(v => snap = v);
  onDestroy(unsub2);

  $: visiblePanels = panelsState.filter(p => p.visible);

  // ── Custom chart builder ───────────────────────────────────────────────────
  let showNewChartModal = false;
  let newChart = { title: '', chartType: 'bar', xAxis: 'binder', yAxis: 'value', limit: 15 };

  const X_AXIS_OPTIONS = [
    { value: 'binder',    label: 'Binder' },
    { value: 'color',     label: 'Color' },
    { value: 'rarity',    label: 'Rarity' },
    { value: 'set',       label: 'Set' },
    { value: 'type',      label: 'Card Type' },
    { value: 'cmc',       label: 'Mana Cost (CMC)' },
    { value: 'condition', label: 'Condition' },
    { value: 'language',  label: 'Language' },
  ];
  const Y_AXIS_OPTIONS = [
    { value: 'value', label: 'Market Value' },
    { value: 'qty',   label: '# Copies' },
    { value: 'count', label: 'Unique Cards' },
    { value: 'cost',  label: 'Cost Basis' },
    { value: 'avg',   label: 'Avg Price per Copy' },
    { value: 'gain',  label: 'Gain / Loss' },
  ];
  const CHART_TYPES = [
    { value: 'bar',       label: '▊ Bar' },
    { value: 'bar-h',     label: '▭ H-Bar' },
    { value: 'pie',       label: '◉ Pie' },
    { value: 'doughnut',  label: '◎ Donut' },
  ];

  function openNewChartModal() {
    newChart = { title: '', chartType: 'bar', xAxis: 'binder', yAxis: 'value', limit: 15 };
    showNewChartModal = true;
  }

  function createCustomChart() {
    const id = `custom-${Date.now()}`;
    const maxZ = Math.max(0, ...panelsState.map(p => p.zIndex || 0));
    const panel = {
      id,
      x: 60, y: 60,
      width: 480, height: 340,
      collapsed: false, visible: true,
      zIndex: maxZ + 1,
      filter: null,
      config: { ...newChart, title: newChart.title || `${newChart.xAxis} by ${newChart.yAxis}` },
    };
    panelsState = [...panelsState, panel];
    layout.set(panelsState);
    scheduleSave();
    showNewChartModal = false;
    if (autoLayout) arrangeToCanvas();
  }

  function deleteCustomPanel(id) {
    panelsState = panelsState.filter(p => p.id !== id);
    layout.set(panelsState);
    scheduleSave();
    if (autoLayout) arrangeToCanvas();
  }
</script>

<svelte:window on:keydown={handleKeydown} />

<div class="dashboard-root">
  <header class="dash-toolbar">
    <div class="dash-heading">
      <span>Mana Ledger</span>
      <strong>Portfolio dashboard</strong>
    </div>

    <div class="history-range" role="group" aria-label="Dashboard history range" title="Updates Value over time, Secret Lair Index, Realized gains, and Top movers">
      <span class="history-range-label">History</span>
      <div class="history-range-options">
        {#each DASHBOARD_RANGES as option}
          <button
            class:active={selectedRange === option.value}
            aria-pressed={selectedRange === option.value}
            aria-label={option.description}
            title={option.description}
            on:click={() => setDashboardRange(option.value)}
          >{option.label}</button>
        {/each}
      </div>
    </div>

    <div class="dash-actions">
      <div class="customize-shell" bind:this={customizeEl}>
        <button class="tb-btn" class:tb-btn-active={showCustomize} aria-expanded={showCustomize} on:click={() => showCustomize = !showCustomize}>
          <LedgerIcon name="sliders" size={15} />
          Customize
          <span class="visible-count">{visiblePanels.length}</span>
        </button>

        {#if showCustomize}
          <div class="customize-popover">
            <div class="customize-head">
              <div><span>Dashboard panels</span><strong>Choose what earns space</strong></div>
              <button on:click={() => showCustomize = false} aria-label="Close customization"><LedgerIcon name="close" size={15} /></button>
            </div>
            <div class="customize-groups">
              {#each PANEL_GROUPS as group}
                <section>
                  <h3>{group.label}</h3>
                  <div class="customize-grid">
                    {#each group.ids as panelId}
                      {@const def = panelDef(panelId)}
                      {@const p = panelsState.find(pp => pp.id === panelId)}
                      {#if def && p}
                        <button class:on={p.visible} class="customize-item" on:click={() => toggleVisible(panelId)} aria-pressed={p.visible}>
                          <span class="customize-icon"><LedgerIcon name={panelId} size={15} /></span>
                          <span>{def.title}</span>
                          <span class="customize-check">{#if p.visible}<LedgerIcon name="check" size={13} />{/if}</span>
                        </button>
                      {/if}
                    {/each}
                  </div>
                </section>
              {/each}
            </div>
            <div class="customize-foot">
              <button on:click={toggleSnap} class:on={snap} aria-pressed={snap}>
                <span class="mini-switch"><span></span></span>
                Snap panels to an 8px grid
              </button>
              <span>{visiblePanels.length} of {PANELS.length} visible</span>
            </div>
          </div>
        {/if}
      </div>

      <button class="tb-btn tb-btn-new" on:click={openNewChartModal} title="Add a custom chart panel">
        <LedgerIcon name="plus" size={15} /> New chart
      </button>
      <button class="tb-btn" class:tb-btn-active={autoLayout} on:click={autoArrange}
        title={autoLayout ? 'Auto-layout is on. Drag a panel to take manual control.' : 'Arrange visible panels and re-flow them on resize'}>
        <LedgerIcon name="arrange" size={15} /> Arrange
      </button>
      <button class="tb-btn tb-btn-quiet" on:click={resetLayout} title="Reset to the curated default layout">
        <LedgerIcon name="reset" size={15} /> Reset
      </button>
    </div>
  </header>

  {#if showNewChartModal}
    <div class="nc-overlay" on:click|self={() => showNewChartModal = false}>
      <div class="nc-modal">
        <div class="nc-header">
          <span class="nc-title">New Custom Chart</span>
          <button class="nc-close" on:click={() => showNewChartModal = false}>×</button>
        </div>

        <div class="nc-body">
          <div class="nc-field">
            <label>Title <span class="nc-opt">(optional)</span></label>
            <input type="text" bind:value={newChart.title} placeholder="e.g. Value by Binder" />
          </div>

          <div class="nc-field">
            <label>Chart Type</label>
            <div class="nc-type-row">
              {#each CHART_TYPES as t}
                <button
                  class="nc-type-btn"
                  class:nc-type-on={newChart.chartType === t.value}
                  on:click={() => newChart.chartType = t.value}
                >{t.label}</button>
              {/each}
            </div>
          </div>

          <div class="nc-row">
            <div class="nc-field">
              <label>Group by (X axis)</label>
              <select bind:value={newChart.xAxis}>
                {#each X_AXIS_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
            <div class="nc-field">
              <label>Value (Y axis)</label>
              <select bind:value={newChart.yAxis}>
                {#each Y_AXIS_OPTIONS as o}<option value={o.value}>{o.label}</option>{/each}
              </select>
            </div>
          </div>

          <div class="nc-field nc-field-sm">
            <label>Show top <strong>{newChart.limit}</strong> items</label>
            <input type="range" min="5" max="50" step="1" bind:value={newChart.limit} />
          </div>
        </div>

        <div class="nc-footer">
          <button class="nc-btn-cancel" on:click={() => showNewChartModal = false}>Cancel</button>
          <button class="nc-btn-create" on:click={createCustomChart}>Create Chart</button>
        </div>
      </div>
    </div>
  {/if}

  <div class="dash-canvas" bind:this={canvasEl}>
    {#each visiblePanels as p (p.id)}
      {@const def = panelDef(p.id)}
      {#if def}
        <Panel
          id={p.id}
          title={def.title}
          description={def.description || ''}
          x={p.x}
          y={p.y}
          width={responsiveWidths.get(p.id) || p.width}
          height={p.height}
          collapsed={p.collapsed}
          zIndex={p.zIndex}
          filter={p.filter || null}
          filterable={def.filterable !== false}
          on:change={e => updatePanel(p.id, e.detail)}
          on:focus={() => bringToFront(p.id)}
          on:hide={() => updatePanel(p.id, { visible: false })}
          let:filter
        >
          <svelte:component this={def.component} {filter} />
        </Panel>
      {:else if isCustomPanel(p.id) && p.config}
        <Panel
          id={p.id}
          title={p.config.title || 'Custom Chart'}
          x={p.x}
          y={p.y}
          width={responsiveWidths.get(p.id) || p.width}
          height={p.height}
          collapsed={p.collapsed}
          zIndex={p.zIndex}
          filter={p.filter || null}
          filterable={true}
          deletable={true}
          on:change={e => updatePanel(p.id, e.detail)}
          on:focus={() => bringToFront(p.id)}
          on:delete={() => deleteCustomPanel(p.id)}
          let:filter
        >
          <CustomChart {filter} config={p.config} />
        </Panel>
      {/if}
    {/each}
  </div>
</div>

<style>
  .dashboard-root {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
  }

  .dash-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 10px 16px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--surface2, #1d1d22) 52%, var(--surface, #16161a)), var(--surface, #16161a));
    border-bottom: 1px solid var(--border, #252545);
    flex-shrink: 0;
    min-height: 58px;
    position: relative;
    z-index: 100;
  }
  .dash-heading { display: flex; flex-direction: column; min-width: 150px; }
  .dash-heading span { color: var(--accent, #c89b3c); font-size: 9px; font-weight: 750; letter-spacing: .09em; line-height: 1.2; text-transform: uppercase; }
  .dash-heading strong { margin-top: 2px; color: var(--text, #ececef); font-size: 16px; font-weight: 680; letter-spacing: -.015em; line-height: 1.25; }
  .history-range { display: flex; align-items: center; gap: 8px; margin-left: auto; color: var(--text-muted, #6f6d76); }
  .history-range-label { font-size: 9px; font-weight: 720; letter-spacing: .075em; text-transform: uppercase; }
  .history-range-options { display: inline-flex; align-items: center; padding: 3px; background: rgba(0,0,0,.18); border: 1px solid var(--border, #252545); border-radius: 9px; }
  .history-range-options button { min-width: 34px; height: 26px; padding: 0 8px; color: var(--text-muted, #6f6d76); background: transparent; border: 0; border-radius: 6px; font: inherit; font-size: 10.5px; font-weight: 650; font-variant-numeric: tabular-nums; cursor: pointer; transition: color .12s ease, background .12s ease, box-shadow .12s ease; }
  .history-range-options button:hover { color: var(--text, #ececef); background: rgba(255,255,255,.045); }
  .history-range-options button.active { color: #17130b; background: var(--accent2, #e8b84b); box-shadow: 0 2px 9px rgba(0,0,0,.26); }
  .dash-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; min-width: 0; }
  .customize-shell { position: relative; }

  .tb-btn {
    min-height: 34px;
    padding: 6px 11px;
    background: transparent;
    border: 1px solid var(--border, #252545);
    border-radius: 8px;
    color: var(--text-dim, #a3a1aa);
    font-size: 11.5px;
    font-weight: 580;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .tb-btn:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); background: rgba(255,255,255,0.04); }
  .tb-btn-active { color: var(--text, #ececef); border-color: color-mix(in srgb, var(--accent, #c89b3c) 55%, var(--border)); background: var(--accent-soft, rgba(200,155,60,.12)); }
  .tb-btn-new { color: #16130b; border-color: var(--accent, #c89b3c); background: var(--accent2, #e8b84b); font-weight: 680; }
  .tb-btn-new:hover { background: #f0c45a; border-color: #f0c45a; color: #16130b; }
  .tb-btn-quiet { border-color: transparent; }
  .visible-count { min-width: 19px; height: 18px; display: grid; place-items: center; padding: 0 5px; border-radius: 99px; color: var(--text-dim); background: rgba(255,255,255,.055); font-size: 9.5px; font-variant-numeric: tabular-nums; }

  .customize-popover {
    position: absolute;
    z-index: 10;
    top: calc(100% + 10px);
    right: 0;
    width: min(680px, calc(100vw - 40px));
    max-height: min(690px, calc(100vh - 112px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    color: var(--text, #ececef);
    background: color-mix(in srgb, var(--surface2, #1d1d22) 76%, var(--surface, #16161a));
    border: 1px solid var(--border2, #3a3a44);
    border-radius: 14px;
    box-shadow: 0 22px 70px rgba(0,0,0,.62);
  }
  .customize-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 18px 14px; border-bottom: 1px solid var(--border); }
  .customize-head div span,
  .customize-head div strong { display: block; }
  .customize-head div span { color: var(--accent, #c89b3c); font-size: 9px; font-weight: 750; letter-spacing: .085em; text-transform: uppercase; }
  .customize-head div strong { margin-top: 3px; font-size: 15px; font-weight: 680; letter-spacing: -.01em; }
  .customize-head > button { width: 30px; height: 30px; display: grid; place-items: center; color: var(--text-dim); background: transparent; border: 0; border-radius: 7px; cursor: pointer; }
  .customize-head > button:hover { color: var(--text); background: rgba(255,255,255,.055); }
  .customize-groups { min-height: 0; overflow-y: auto; padding: 14px 16px 18px; }
  .customize-groups section + section { margin-top: 16px; }
  .customize-groups h3 { margin: 0 0 7px 2px; color: var(--text-muted, #6f6d76); font-size: 9.5px; font-weight: 700; letter-spacing: .075em; text-transform: uppercase; }
  .customize-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
  .customize-item { min-width: 0; display: grid; grid-template-columns: 28px minmax(0, 1fr) 20px; align-items: center; gap: 8px; min-height: 42px; padding: 6px 9px; color: var(--text-dim); background: rgba(0,0,0,.12); border: 1px solid transparent; border-radius: 9px; font: inherit; font-size: 11.5px; text-align: left; cursor: pointer; }
  .customize-item:hover { color: var(--text); background: rgba(255,255,255,.035); border-color: var(--border); }
  .customize-item.on { color: var(--text); background: rgba(200,155,60,.065); border-color: rgba(200,155,60,.18); }
  .customize-icon { width: 28px; height: 28px; display: grid; place-items: center; color: var(--text-muted); background: rgba(255,255,255,.035); border-radius: 7px; }
  .customize-item.on .customize-icon,
  .customize-check { color: var(--accent2, #e8b84b); }
  .customize-item > span:nth-child(2) { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .customize-check { width: 20px; height: 20px; display: grid; place-items: center; }
  .customize-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 16px; color: var(--text-muted); border-top: 1px solid var(--border); font-size: 10px; }
  .customize-foot > button { display: inline-flex; align-items: center; gap: 8px; padding: 0; color: var(--text-dim); background: transparent; border: 0; font: inherit; font-size: 11px; cursor: pointer; }
  .mini-switch { width: 28px; height: 16px; padding: 2px; display: block; border-radius: 99px; background: var(--border2); transition: background .14s ease; }
  .mini-switch span { display: block; width: 12px; height: 12px; border-radius: 50%; background: var(--text-muted); transition: transform .14s ease, background .14s ease; }
  .customize-foot > button.on .mini-switch { background: var(--accent, #c89b3c); }
  .customize-foot > button.on .mini-switch span { transform: translateX(12px); background: #fff7e3; }

  @media (max-width: 760px) {
    .dash-toolbar { align-items: flex-start; flex-direction: column; gap: 9px; }
    .history-range { width: 100%; margin-left: 0; }
    .history-range-options { flex: 1; }
    .history-range-options button { flex: 1; }
    .dash-actions { width: 100%; justify-content: flex-start; overflow-x: auto; }
    .customize-grid { grid-template-columns: 1fr; }
    .customize-popover { position: fixed; top: 104px; left: 12px; right: 12px; width: auto; }
  }

  /* ── New Chart Modal ──────────────────────────────────────────────── */
  .nc-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(3px);
    z-index: 99998;
    display: flex; align-items: center; justify-content: center;
  }
  .nc-modal {
    background: var(--surface, #10101e);
    border: 1px solid var(--border2, #303058);
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.7);
    width: 460px;
    max-width: calc(100vw - 32px);
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .nc-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 16px 12px;
    border-bottom: 1px solid var(--border, #252545);
  }
  .nc-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: var(--text-muted, #6f6d76); }
  .nc-close {
    background: transparent; border: none; color: var(--text-dim, #7a7692);
    font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px;
    font-family: inherit;
  }
  .nc-close:hover { color: var(--text, #ece9e1); }
  .nc-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
  .nc-field { display: flex; flex-direction: column; gap: 6px; flex: 1; }
  .nc-field label { font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-dim, #7a7692); }
  .nc-opt { font-weight: 400; text-transform: none; letter-spacing: 0; opacity: 0.7; }
  .nc-field input[type="text"],
  .nc-field select {
    background: var(--surface2, #181830); border: 1px solid var(--border, #252545);
    border-radius: 6px; color: var(--text, #ece9e1); font-size: 12.5px;
    padding: 7px 10px; font-family: inherit; outline: none;
  }
  .nc-field input[type="text"]:focus,
  .nc-field select:focus { border-color: var(--accent2, #e8b84b); }
  .nc-type-row { display: flex; gap: 6px; }
  .nc-type-btn {
    flex: 1; padding: 7px 4px; border-radius: 6px; font-size: 12px;
    border: 1px solid var(--border, #252545); background: transparent;
    color: var(--text-dim, #7a7692); cursor: pointer; font-family: inherit;
    transition: all 0.12s;
  }
  .nc-type-btn:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); }
  .nc-type-on { color: var(--accent2, #e8b84b) !important; border-color: rgba(200,155,60,0.5) !important; background: rgba(200,155,60,0.1) !important; }
  .nc-row { display: flex; gap: 12px; }
  .nc-field-sm input[type="range"] { width: 100%; accent-color: var(--accent2, #e8b84b); }
  .nc-footer {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--border, #252545);
  }
  .nc-btn-cancel {
    padding: 7px 16px; border-radius: 6px; font-size: 12.5px; cursor: pointer;
    border: 1px solid var(--border, #252545); background: transparent;
    color: var(--text-dim, #7a7692); font-family: inherit; transition: all 0.12s;
  }
  .nc-btn-cancel:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); }
  .nc-btn-create {
    padding: 7px 20px; border-radius: 6px; font-size: 12.5px; font-weight: 600;
    cursor: pointer; border: 1px solid rgba(200,155,60,0.5);
    background: rgba(200,155,60,0.15); color: var(--accent2, #e8b84b);
    font-family: inherit; transition: all 0.12s;
  }
  .nc-btn-create:hover { background: rgba(200,155,60,0.25); border-color: rgba(200,155,60,0.8); }

  .dash-canvas {
    position: relative;
    flex: 1;
    overflow: auto;
    background: radial-gradient(ellipse at 50% -12%, rgba(200,155,60,.025), transparent 38%), var(--bg, #0e0e10);
  }
</style>
