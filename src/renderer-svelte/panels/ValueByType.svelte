<script>
  import { collectionVersion } from '../stores.js';
  import { withFilteredCollection } from '../filter.js';
  export let filter = null;
  $: $collectionVersion;
  $: html = withFilteredCollection(filter, () => window.app?.renderTypePanel?.() || '');
</script>
{@html html}
