<script>
  import { collectionVersion } from '../stores.js';
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: html = window.app?.renderCardOfTheDay?.() || '<p style="color:var(--text-muted)">Card of the Day not available.</p>';
</script>

<div class="cotd">{@html html}</div>

<style>
  .cotd { min-width: 0; height: 100%; font-size: 12px; }
  :global(.cotd-layout) { min-width: 0; display: grid; grid-template-columns: minmax(120px, 46%) minmax(0, 1fr); gap: 16px; align-items: start; }
  :global(.cotd-image) { display: block; width: 100%; max-width: 180px; height: auto; border-radius: 11px; box-shadow: 0 8px 26px rgba(0,0,0,.45); }
  :global(.cotd-copy) { min-width: 0; }
  :global(.cotd-name) { color: var(--text); font-size: 16px; font-weight: 680; line-height: 1.25; letter-spacing: -.015em; }
  :global(.cotd-set) { margin-top: 3px; color: var(--text-muted); font-size: 10.5px; line-height: 1.35; }
  :global(.cotd-badge) { display: inline-flex; margin-top: 8px; }
  :global(.cotd-meta) { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 10px; margin: 12px 0; color: var(--text-muted); font-size: 11px; }
  :global(.cotd-meta strong) { min-width: 0; overflow: hidden; text-overflow: ellipsis; color: var(--text-dim); font-weight: 520; white-space: nowrap; }
  :global(.cotd-price) { color: var(--text); font-size: 24px; font-weight: 700; line-height: 1.05; letter-spacing: -.02em; font-variant-numeric: tabular-nums lining-nums; }
  :global(.cotd-total) { margin-top: 3px; color: var(--text-muted); font-size: 10.5px; }
  :global(.cotd-action) { margin-top: 12px; padding: 5px 10px !important; font-size: 10.5px !important; }
  @media (max-width: 320px) {
    :global(.cotd-layout) { grid-template-columns: 1fr; }
    :global(.cotd-image) { max-width: 170px; justify-self: center; }
  }
</style>
