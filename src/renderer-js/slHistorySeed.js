// Build-time reviewed MTGJSON AllPrices slice. The desktop never downloads the
// global payload; it imports only exact SLD printing/finish series baked by the
// data workflow. Live Scryfall points win on overlapping dates.

import seed from '../renderer/sl-price-seed.json' with { type: 'json' };
import { collection } from './state.js';

export function slHistorySeedInfo() {
  return { generatedAt: seed.generatedAt || null, sourceVersion: seed.sourceVersion || null, series: Object.keys(seed.series || {}).length };
}

export async function applySlHistorySeed() {
  const series = seed.series || {};
  const keys = Object.keys(series);
  if (!keys.length || !seed.generatedAt || !window.api?.prices?.bulkStore) return { applied: 0, reason: 'empty' };
  if (collection.settings.slHistorySeedVersion === seed.generatedAt) return { applied: 0, reason: 'current' };
  const snapshots = [];
  for (const key of keys) {
    const split = key.lastIndexOf('|');
    const sid = key.slice(0, split), foil = key.slice(split + 1);
    if (!sid || !foil) continue;
    const existing = collection.priceHistory[key] || [];
    const byDate = new Map((series[key] || []).map(p => [p.date, {
      date: p.date, price: Number(p.price), source: 'mtgjson-seed', provider: p.provider,
    }]));
    // Locally observed points are more specific and replace seed dates. Older
    // seed-only dates remain useful as the source's rolling window advances,
    // but a newly shipped seed replaces an older seed value for the same date.
    for (const p of existing) {
      if (p.source !== 'mtgjson-seed' || !byDate.has(p.date)) byDate.set(p.date, p);
    }
    collection.priceHistory[key] = [...byDate.values()].filter(p => Number.isFinite(p.price) && p.price > 0).sort((a,b)=>a.date.localeCompare(b.date));
    for (const p of (series[key] || [])) if (Number.isFinite(Number(p.price)) && Number(p.price) > 0) snapshots.push({ scryfallId: sid, foil, date: p.date, price: Number(p.price), source: 'mtgjson-seed' });
  }
  for (let i = 0; i < snapshots.length; i += 5000) await window.api.prices.bulkStore(snapshots.slice(i, i + 5000));
  collection.settings.slHistorySeedVersion = seed.generatedAt;
  await window.api.settings.set('settings_blob', JSON.stringify(collection.settings));
  window.logger?.success?.('SL', `Applied reviewed MTGJSON history seed: ${keys.length.toLocaleString()} printing/finish series · ${snapshots.length.toLocaleString()} points`);
  return { applied: snapshots.length, series: keys.length };
}
