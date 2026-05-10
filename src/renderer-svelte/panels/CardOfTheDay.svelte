<script>
  import { collectionVersion } from '../stores.js';
  // eslint-disable-next-line no-unused-vars
  export let filter = null;
  $: $collectionVersion;
  $: html = window.app?.renderCardOfTheDay?.() || '<p style="color:var(--text-muted)">Card of the Day not available.</p>';
</script>

<div class="cotd">{@html html}</div>

<style>
  .cotd { font-size: 12px; }
  :global(.cotd img) { max-width: 100%; height: auto; }
</style>
