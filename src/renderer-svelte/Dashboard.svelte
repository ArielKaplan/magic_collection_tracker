<script>
  import { onMount, onDestroy } from 'svelte';
  import Panel from './Panel.svelte';
  import { PANELS, panelDef, defaultLayout } from './panels.js';
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

  .dash-canvas {
    position: relative;
    flex: 1;
    overflow: auto;
    background:
      radial-gradient(circle at 1px 1px, rgba(255,255,255,0.025) 1px, transparent 0) 0 0 / 24px 24px;
  }
</style>
