<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import interact from 'interactjs';
  import { snapEnabled, SNAP_PX, collectionVersion } from './stores.js';
  import { isFilterActive, chipState, cycleBinderState, emptyFilter } from './filter.js';

  export let id;
  export let title;
  export let icon = '';
  export let description = '';          // help text shown via ⓘ button
  export let x = 0;
  export let y = 0;
  export let width = 320;
  export let height = 220;
  export let collapsed = false;
  export let zIndex = 1;
  export let filter = null;             // { binders: { include: [], exclude: [] } } | null
  export let filterable = true;         // false = no filter button (e.g. Card of the Day)
  export let deletable = false;         // true = show delete button (custom charts)

  const dispatch = createEventDispatcher();
  let el, popoverEl;

  let snap = false;
  const unsub = snapEnabled.subscribe(v => snap = v);
  onDestroy(unsub);

  // Keep binder list reactive to data changes
  let binderList = [];
  const unsubV = collectionVersion.subscribe(() => {
    binderList = [...new Set((window.collection?.cards || []).map(c => c.binderName).filter(Boolean))].sort();
  });
  onDestroy(unsubV);

  $: filterActive = isFilterActive(filter);
  $: filterSummary = filter
    ? `${(filter.binders?.include?.length || 0)} incl · ${(filter.binders?.exclude?.length || 0)} excl`
    : '';

  let showInfo = false;
  let infoAbove = false;
  function toggleInfo() {
    showInfo = !showInfo;
    if (showInfo) {
      bringToFront();
      // Flip popover above the panel if there isn't room below the header
      const rect = el.getBoundingClientRect();
      infoAbove = rect.top + 36 + 200 > window.innerHeight;
    }
  }

  let showFilter = false;
  function toggleFilter() {
    showFilter = !showFilter;
    if (showFilter) bringToFront();
  }
  function dismissFilter(e) {
    if (showFilter && popoverEl && !popoverEl.contains(e.target)) {
      // Don't dismiss if click was on the filter button itself
      const filterBtn = el?.querySelector('.filter-btn');
      if (filterBtn && filterBtn.contains(e.target)) return;
      showFilter = false;
    }
  }
  onMount(() => {
    document.addEventListener('mousedown', dismissFilter);
    return () => document.removeEventListener('mousedown', dismissFilter);
  });

  function toggleBinder(b) {
    const next = cycleBinderState(filter || emptyFilter(), b);
    dispatch('change', { x, y, width, height, collapsed, filter: next });
  }
  function clearFilter() {
    dispatch('change', { x, y, width, height, collapsed, filter: emptyFilter() });
  }

  onMount(() => {
    const interactable = interact(el)
      .draggable({
        allowFrom: '.panel-handle',
        listeners: {
          move(event) { x += event.dx; y += event.dy; },
          end() {
            if (snap) { x = Math.round(x / SNAP_PX) * SNAP_PX; y = Math.round(y / SNAP_PX) * SNAP_PX; }
            dispatch('change', { x, y, width, height, collapsed, filter });
          },
        },
        modifiers: [
          interact.modifiers.restrictRect({
            restriction: { left: 0, top: 0, right: Infinity, bottom: Infinity },
          }),
        ],
        inertia: false,
      })
      .resizable({
        edges: { right: true, bottom: true, top: false, left: false },
        margin: 12,
        listeners: {
          move(event) {
            width  = Math.max(180, event.rect.width);
            height = Math.max(72,  event.rect.height);
          },
          end() {
            if (snap) { width = Math.round(width / SNAP_PX) * SNAP_PX; height = Math.round(height / SNAP_PX) * SNAP_PX; }
            dispatch('change', { x, y, width, height, collapsed, filter });
          },
        },
      });
    return () => interactable.unset();
  });

  function bringToFront() { dispatch('focus', {}); }
  function toggleCollapse() {
    collapsed = !collapsed;
    dispatch('change', { x, y, width, height, collapsed, filter });
  }
  function close() { dispatch('hide', {}); }
</script>

<div
  class="panel-card"
  class:collapsed
  bind:this={el}
  on:pointerdown={bringToFront}
  style:transform={`translate(${x}px, ${y}px)`}
  style:width={`${width}px`}
  style:height={collapsed ? `34px` : `${height}px`}
  style:z-index={zIndex}
>
  <header class="panel-handle">
    {#if icon}<span class="panel-icon">{icon}</span>{/if}
    <span class="panel-title">{title}</span>
    <span class="panel-actions">
      {#if description}
        <button class="panel-btn info-btn" class:info-on={showInfo} title="About this panel" on:click={toggleInfo} on:pointerdown|stopPropagation>ⓘ</button>
      {/if}
      {#if filterable}
        <button
          class="panel-btn filter-btn"
          class:filter-on={filterActive}
          title={filterActive ? `Filter: ${filterSummary}` : 'Filter by binder'}
          on:click={toggleFilter}
          on:pointerdown|stopPropagation
        >
          ⚲
          {#if filterActive}<span class="filter-dot"></span>{/if}
        </button>
      {/if}
      <button class="panel-btn" title={collapsed ? 'Expand' : 'Collapse'} on:click={toggleCollapse} on:pointerdown|stopPropagation>
        {collapsed ? '▾' : '▴'}
      </button>
      {#if deletable}
        <button class="panel-btn panel-btn-delete" title="Delete chart" on:click={() => dispatch('delete')} on:pointerdown|stopPropagation>🗑</button>
      {:else}
        <button class="panel-btn" title="Hide" on:click={close} on:pointerdown|stopPropagation>×</button>
      {/if}
    </span>
  </header>

  {#if !collapsed}
    <div class="panel-body"><slot {filter} /></div>

    {#if showFilter && filterable}
      <div class="filter-popover" bind:this={popoverEl} on:pointerdown|stopPropagation>
        <div class="fp-head">
          <span class="fp-title">Binder filter</span>
          {#if filterActive}<button class="fp-clear" on:click={clearFilter}>Clear</button>{/if}
        </div>
        <div class="fp-hint">Click to cycle: <span class="dot dot-inc"></span> include · <span class="dot dot-exc"></span> exclude · neutral.</div>
        {#if binderList.length === 0}
          <div class="fp-empty">No binders in collection.</div>
        {:else}
          <div class="fp-chips">
            {#each binderList as b}
              {@const state = chipState(filter, b)}
              <button class="fp-chip" class:fp-include={state === 'include'} class:fp-exclude={state === 'exclude'} on:click={() => toggleBinder(b)} title={b}>
                {#if state === 'include'}✓ {:else if state === 'exclude'}✗ {/if}{b}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if showInfo && description}
      <div class="info-popover" class:above={infoAbove} on:pointerdown|stopPropagation>
        <div class="info-head">
          <span class="info-title">About this panel</span>
          <button class="fp-clear" on:click={() => showInfo = false}>✕</button>
        </div>
        <p class="info-body">{description}</p>
      </div>
    {/if}

    <div class="panel-resize-r"></div>
    <div class="panel-resize-b"></div>
    <div class="panel-resize-br"></div>
  {/if}
</div>

<style>
  .panel-card {
    position: absolute;
    top: 0; left: 0;
    background: var(--surface, #10101e);
    border: 1px solid var(--border, #252545);
    border-radius: 10px;
    box-shadow: 0 2px 12px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    overflow: visible;          /* popover can spill out */
    transition: box-shadow 0.15s, border-color 0.15s;
    user-select: none;
  }
  .panel-card:hover { border-color: var(--border2, #303058); box-shadow: 0 4px 18px rgba(0,0,0,0.5); }

  .panel-handle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 6px 10px;
    background: rgba(255,255,255,0.025);
    border-bottom: 1px solid var(--border, #252545);
    cursor: grab;
    flex-shrink: 0;
    height: 34px;
    border-radius: 10px 10px 0 0;
  }
  .panel-handle:active { cursor: grabbing; }
  .panel-icon { font-size: 13px; opacity: 0.85; }
  .panel-title { font-size: 11.5px; font-weight: 600; color: var(--text, #ece9e1); flex: 1; letter-spacing: 0.02em; text-transform: uppercase; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .panel-actions { display: flex; gap: 2px; }
  .panel-btn {
    width: 22px; height: 22px;
    border: none;
    background: transparent;
    color: var(--text-dim, #7a7692);
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
    position: relative;
  }
  .panel-btn:hover { background: rgba(255,255,255,0.08); color: var(--text, #ece9e1); }
  .filter-btn.filter-on { color: var(--accent2, #e8b84b); }
  .info-btn { font-size: 13px; }
  .info-btn.info-on { color: var(--accent2, #e8b84b); }

  .info-popover {
    position: absolute;
    top: 36px;
    right: 6px;
    width: 260px;
    z-index: 99999;
    background: var(--surface2, #181830);
    border: 1px solid var(--border2, #303058);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    padding: 10px 12px 12px;
  }
  .info-popover.above {
    top: auto;
    bottom: 36px;
    margin-bottom: 2px;
  }
  .info-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .info-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted, #6f6d76); }
  .info-body { font-size: 11.5px; color: var(--text-dim, #7a7692); line-height: 1.55; margin: 0; }
  .panel-btn-delete:hover { color: #e05555 !important; background: rgba(224,85,85,0.12) !important; }
  .filter-dot {
    position: absolute;
    top: 2px; right: 2px;
    width: 6px; height: 6px;
    background: var(--accent2, #e8b84b);
    border-radius: 50%;
    box-shadow: 0 0 0 2px var(--surface, #10101e);
  }

  .panel-body {
    flex: 1;
    padding: 12px 14px;
    overflow: auto;
    font-size: 12.5px;
    color: var(--text, #ece9e1);
  }

  /* Filter popover */
  .filter-popover {
    position: absolute;
    top: 36px;
    right: 6px;
    width: 240px;
    max-height: 320px;
    background: var(--surface2, #181830);
    border: 1px solid var(--border2, #303058);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.6);
    padding: 10px 10px 12px;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .fp-head { display: flex; align-items: center; justify-content: space-between; }
  .fp-title { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted, #6f6d76); }
  .fp-clear {
    background: transparent;
    border: 1px solid var(--border2, #303058);
    border-radius: 4px;
    color: var(--text-dim, #7a7692);
    font-size: 10px;
    padding: 2px 8px;
    cursor: pointer;
    font-family: inherit;
  }
  .fp-clear:hover { color: var(--text, #ece9e1); }
  .fp-hint { font-size: 10px; color: var(--text-muted, #4a4668); line-height: 1.5; }
  .fp-empty { font-size: 11px; color: var(--text-muted, #4a4668); padding: 6px 0; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; vertical-align: middle; margin: 0 2px; }
  .dot-inc { background: #3dba6f; }
  .dot-exc { background: #e05555; }
  .fp-chips { display: flex; flex-wrap: wrap; gap: 4px; max-height: 200px; overflow-y: auto; padding-right: 2px; }
  .fp-chip {
    background: transparent;
    border: 1px solid var(--border, #252545);
    color: var(--text-dim, #7a7692);
    font-size: 10.5px;
    padding: 3px 8px;
    border-radius: 99px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: all 0.12s;
  }
  .fp-chip:hover { color: var(--text, #ece9e1); border-color: var(--border2, #303058); }
  .fp-chip.fp-include { color: #3dba6f; border-color: rgba(61,186,111,0.4); background: rgba(61,186,111,0.10); }
  .fp-chip.fp-exclude { color: #e05555; border-color: rgba(224,85,85,0.4); background: rgba(224,85,85,0.10); text-decoration: line-through; }

  /* Resize handles */
  .panel-resize-r,
  .panel-resize-b,
  .panel-resize-br { position: absolute; background: transparent; }
  .panel-resize-r  { top: 0; right: 0; width: 6px; bottom: 12px; cursor: ew-resize; }
  .panel-resize-b  { left: 0; right: 12px; bottom: 0; height: 6px; cursor: ns-resize; }
  .panel-resize-br { right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize; }
  .panel-resize-br::after {
    content: '';
    position: absolute;
    right: 3px; bottom: 3px;
    width: 8px; height: 8px;
    border-right: 2px solid var(--text-muted, #4a4668);
    border-bottom: 2px solid var(--text-muted, #4a4668);
    border-bottom-right-radius: 3px;
    opacity: 0.6;
  }
  .panel-card:hover .panel-resize-br::after { opacity: 1; }

  .collapsed .panel-handle { border-bottom: none; border-radius: 10px; }
</style>
