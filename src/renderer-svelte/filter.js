// Shared per-panel filter helpers. Panels receive a `filter` prop describing
// which binders to include/exclude; this module turns that into the actual
// scoped card list and provides a swap-render-restore wrapper for legacy
// HTML-string renderers that read window.collection.cards directly.

export function emptyFilter() {
  return { binders: { include: [], exclude: [] } };
}

export function isFilterActive(filter) {
  if (!filter || !filter.binders) return false;
  return (filter.binders.include?.length || 0) + (filter.binders.exclude?.length || 0) > 0;
}

export function filterCards(cards, filter) {
  // Sold cards linger in the collection for realized P&L but are never part of
  // the live dashboard — drop them before any binder filtering.
  const owned = cards.filter(c => c.status !== 'sold');
  if (!isFilterActive(filter)) return owned;
  const inc = new Set(filter.binders.include || []);
  const exc = new Set(filter.binders.exclude || []);
  return owned.filter(c => {
    const b = c.binderName || '';
    if (inc.size > 0 && !inc.has(b)) return false;
    if (exc.has(b)) return false;
    return true;
  });
}

// Cycle a chip's state: neutral -> include -> exclude -> neutral.
export function cycleBinderState(filter, binderName) {
  const f = {
    binders: {
      include: [...(filter?.binders?.include || [])],
      exclude: [...(filter?.binders?.exclude || [])],
    },
  };
  const inInc = f.binders.include.includes(binderName);
  const inExc = f.binders.exclude.includes(binderName);
  if (!inInc && !inExc)       f.binders.include.push(binderName);
  else if (inInc) {
    f.binders.include = f.binders.include.filter(b => b !== binderName);
    f.binders.exclude.push(binderName);
  } else {
    f.binders.exclude = f.binders.exclude.filter(b => b !== binderName);
  }
  return f;
}

export function chipState(filter, binderName) {
  if (filter?.binders?.include?.includes(binderName)) return 'include';
  if (filter?.binders?.exclude?.includes(binderName)) return 'exclude';
  return 'neutral';
}

// Run a function while window.collection.cards is temporarily swapped to a
// filtered subset. Used by panels that delegate to the legacy HTML renderers
// in app.js (those read window.collection.cards directly).
export function withFilteredCollection(filter, fn) {
  const c = window.collection;
  if (!c || !isFilterActive(filter)) return fn();
  const orig = c.cards;
  c.cards = filterCards(orig, filter);
  try { return fn(); }
  finally { c.cards = orig; }
}
