<script>
  import { onMount, onDestroy } from 'svelte';
  import Panel from './Panel.svelte';
  import CustomChart from './panels/CustomChart.svelte';
  import { PANELS, panelDef, isCustomPanel, defaultLayout } from './panels.js';
  import { layout, snapEnabled } from './stores.js';

  const SETTING_KEY = 'dashboard_layout_v2';
  let saveTimer;

  let panelsState = [];
  const unsub = layout.subscribe(v => panelsState = v);
  onDestroy(unsub);

  onMount(async () => {
    const raw = await window.api.settings.get(SETTING_KEY);
    let parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch {} }
    const initial = (parsed && Array.isArray(parsed) && parsed.length) ? parsed : defaultLayout();
    // Ensure every defined panel has a state row (so newly-added panel types
    // appear after a code update without the user needing to reset)
    for (const def of PANELS) {
      if (!initial.find(p => p.id === def.id)) {
        initial.push({ id: def.id, x: 12, y: 12, width: def.defaultSize.w, height: def.defaultSize.h, collapsed: false, visible: false, zIndex: initial.length + 1 });
      }
    }
    layout.set(initial);
  });

  // Debounced save — every layout change triggers a re-save 250ms later.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await window.api.settings.set(SETTING_KEY, JSON.stringify(panelsState)); } catch {}
    }, 250);
  }

  function updatePanel(id, patch) {
    panelsState = panelsState.map(p => p.id === id ? { ...p, ...patch } : p);
    layout.set(panelsState);
    scheduleSave();
  }

  function bringToFront(id) {
    const max = Math.max(0, ...panelsState.map(p => p.zIndex || 0));
    updatePanel(id, { zIndex: max + 1 });
  }

  function autoArrange() {
    const visibleIds = new Set(panelsState.filter(p => p.visible).map(p => p.id));
    const fresh = defaultLayout();
    panelsState = fresh.map(p => ({ ...p, visible: visibleIds.has(p.id) || p.visible }));
    layout.set(panelsState);
    scheduleSave();
  }

  function resetLayout() {
    if (!confirm('Reset dashboard to default layout? Your panel positions will be lost.')) return;
    panelsState = defaultLayout();
    layout.set(panelsState);
    scheduleSave();
  }

  function toggleVisible(id) {
    const p = panelsState.find(pp => pp.id === id);
    if (!p) return;
    if (!p.visible) bringToFront(id);
    updatePanel(id, { visible: !p.visible });
  }

  function toggleSnap() { snapEnabled.update(v => !v); }
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
  }

  function deleteCustomPanel(id) {
    panelsState = panelsState.filter(p => p.id !== id);
    layout.set(panelsState);
    scheduleSave();
  }
</script>

<div class="dashboard-root">
  <div class="dash-toolbar">
    <span class="dash-title">DASHBOARD</span>
    <span class="dash-divider"></span>

    <div class="dash-chips">
      {#each PANELS as def}
        {@const p = panelsState.find(pp => pp.id === def.id)}
        <button
          class="chip"
          class:on={p?.visible}
          on:click={() => toggleVisible(def.id)}
          title={p?.visible ? `Hide ${def.title}` : `Show ${def.title}`}
        >
          <span>{def.icon}</span><span>{def.title}</span>
        </button>
      {/each}
    </div>

    <span class="dash-spacer"></span>
    <button class="tb-btn tb-btn-new" on:click={openNewChartModal} title="Add a custom chart panel">
      ＋ New Chart
    </button>
    <button class="tb-btn" on:click={toggleSnap} title="Snap-to-grid (8px)">
      <span class={snap ? 'tb-on' : ''}>⊞</span> Snap
    </button>
    <button class="tb-btn" on:click={autoArrange} title="Tile all visible panels">
      ▦ Auto-arrange
    </button>
    <button class="tb-btn" on:click={resetLayout} title="Reset to default layout">
      ↺ Reset
    </button>
  </div>

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

  <div class="dash-canvas">
    {#each visiblePanels as p (p.id)}
      {@const def = panelDef(p.id)}
      {#if def}
        <Panel
          id={p.id}
          title={def.title}
          icon={def.icon}
          x={p.x}
          y={p.y}
          width={p.width}
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
          icon="📊"
          x={p.x}
          y={p.y}
          width={p.width}
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
  }

  .dash-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--surface, #10101e);
    border-bottom: 1px solid var(--border, #252545);
    flex-shrink: 0;
    flex-wrap: wrap;
    min-height: 40px;
  }
  .dash-title { font-size: 11px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent2, #e8b84b); }
  .dash-divider { width: 1px; height: 16px; background: var(--border, #252545); }
  .dash-spacer { flex: 1; }

  .dash-chips { display: flex; gap: 4px; flex-wrap: wrap; }
  .chip {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 3px 8px;
    border-radius: 99px;
    border: 1px solid var(--border, #252545);
    background: transparent;
    color: var(--text-dim, #7a7692);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    transition: all 0.12s;
    line-height: 1.4;
  }
  .chip:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); }
  .chip.on {
    color: var(--accent2, #e8b84b);
    border-color: rgba(200,155,60,0.4);
    background: rgba(200,155,60,0.1);
  }

  .tb-btn {
    padding: 4px 10px;
    background: transparent;
    border: 1px solid var(--border, #252545);
    border-radius: 6px;
    color: var(--text-dim, #7a7692);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    transition: all 0.12s;
  }
  .tb-btn:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); background: rgba(255,255,255,0.04); }
  .tb-on { color: var(--accent2, #e8b84b); }
  .tb-btn-new { color: var(--accent2, #e8b84b); border-color: rgba(200,155,60,0.4); }
  .tb-btn-new:hover { background: rgba(200,155,60,0.1); border-color: rgba(200,155,60,0.6); color: var(--accent2, #e8b84b); }

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
  .nc-title { font-size: 13px; font-weight: 700; letter-spacing: 0.04em; color: var(--accent2, #e8b84b); }
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
    background:
      radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0) 0 0 / 24px 24px;
  }
</style>
