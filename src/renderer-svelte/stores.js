import { writable } from 'svelte/store';

// Bumps whenever the legacy app.js mutates the collection. Components that
// derive values from window.collection should depend on this store so they
// re-render at the right times.
export const collectionVersion = writable(0);

// Persisted dashboard layout state ([{id, x, y, width, height, collapsed,
// visible, zIndex}, ...]). Hydrated/saved via window.api.settings.
export const layout = writable([]);

// Whether snap-to-grid is on; user-toggleable from the Dashboard toolbar.
export const snapEnabled = writable(false);
export const SNAP_PX = 8;
