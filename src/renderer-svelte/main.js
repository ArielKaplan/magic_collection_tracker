// Entry point for the Svelte-bundled portion of the renderer.
// Currently exposes only the Dashboard mount, but additional tabs (Cards,
// Sealed, Gallery, etc.) can be added the same way as we migrate them.
import Dashboard from './Dashboard.svelte';
import { collectionVersion } from './stores.js';

let activeDashboard = null;

window.svelteApp = {
  mountDashboard(target) {
    if (activeDashboard) activeDashboard.$destroy();
    activeDashboard = new Dashboard({ target });
    return activeDashboard;
  },
  unmountDashboard() {
    if (activeDashboard) { activeDashboard.$destroy(); activeDashboard = null; }
  },
  // The legacy app.js calls this after autoSave / data mutations so Svelte
  // components observing the version store re-pull from window.collection.
  notifyDataChanged() {
    collectionVersion.update(n => n + 1);
  },
};
