// slWiki.js — live sync of mtg.wiki's "Secret Lair/Drop Series" table.
//
// The wiki is the ONLY machine-readable source for three things MTGJSON and
// Scryfall don't carry: the superdrop grouping, each drop's real MSRP (as
// separate non-foil and foil columns), and drops that are announced but not
// yet released. The sl-build pipeline bakes the grouping occasionally; this
// module keeps it live between bakes — one ~60KB MediaWiki API call during
// "Check for New Cards", parsed with the same wikitext rules the pipeline
// uses (scripts/sl-build/reconcile.js), persisted to settings.
//
// Consumers: rebuildSlGrouping (homes fresh drops that would otherwise sit in
// "Recent Additions"), computeDropPnL (real per-drop MSRPs, finish-aware,
// before the flat defaults), and the Explorer landing's Upcoming strip.

import { slBaseDropName } from './slData.js';
import { netFetch } from './utils.js';

const WIKI_API = 'https://mtg.wiki/api.php?action=parse&page=Secret%20Lair%2FDrop%20Series&prop=wikitext&format=json';
const SETTINGS_KEY = 'sl_wiki_data';

const cleanName = s => String(s || '').replace(/'{2,}/g, '').replace(/\[\[|\]\]/g, '').trim();
const norm = s => (s || '').toLowerCase().replace(/[‘’]/g, "'").replace(/[–—]/g, '-')
  .replace(/\band\b/g, '').replace(/[^a-z0-9]+/g, '');

// ── pure parser (fixture-tested in scripts/smoke-slwiki.js) ─────────────────
// One row per drop: { seq, drop, superdrop, date, msrpNonfoil, msrpFoil }.
// Cell layout: # | drop | SLD# | date | price(non-foil) | price(foil) | … —
// prices are read positionally after the date cell, with a scan fallback when
// rowspans shift the layout (commander-deck rows).
export function parseDropSeriesWikitext(wt) {
  const start = wt.indexOf('=Drop list=');
  const end = wt.indexOf('====Artist Series====');
  const body = wt.slice(start >= 0 ? start : 0, end > start ? end : undefined);
  const priceIn = c => {
    const m = String(c || '').match(/\$\s*([\d,]+\.\d{2})/);
    return m ? parseFloat(m[1].replace(/,/g, '')) : null;
  };
  const rows = [];
  for (const block of body.split(/\n\|-/).slice(1)) {
    let superdrop = null, drop = null, m;
    if ((m = block.match(/\{\{SLD\|([^|}]+)\|([^|}]+)\}\}/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
    else if ((m = block.match(/\{\{SLC\|([^|}]+)\|([^|}]+)\}\}/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
    else if ((m = block.match(/\[\[Secret Lair Drop Series \(([^)]+)\)\|([^|\]]+)\]\]/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
    else if ((m = block.match(/\[\[Secret Lair Drop Series:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { superdrop = cleanName(m[1]); drop = cleanName(m[2]); }
    else if ((m = block.match(/\[\[Secret Lair Commander Deck:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { drop = cleanName(m[2]); }
    else if ((m = block.match(/\{\{SLD\|([^|}]+)\}\}/))) { drop = cleanName(m[1]); }
    else if ((m = block.match(/\{\{SLC\|([^|}]+)\}\}/))) { drop = cleanName(m[1]); }
    else if ((m = block.match(/\[\[Secret Lair:\s*([^|\]]+)\|([^|\]]+)\]\]/))) { drop = cleanName(m[2]); }
    else if ((m = block.match(/\[\[Secret Lair Drop Series:\s*([^|\]]+)\]\]/))) { drop = cleanName(m[1]); }
    if (!drop) continue;

    const seqM = block.match(/^\s*(?:rowspan="\d+"\s*\|\s*)?(\d{1,4})\s*$/m);
    const dateM = block.match(/(\d{4}-\d{2}-\d{2})/);
    const cells = block.split(/\n\|(?!-)/);
    let msrpNonfoil = null, msrpFoil = null;
    const di = cells.findIndex(c => /\d{4}-\d{2}-\d{2}/.test(c));
    if (di >= 0) { msrpNonfoil = priceIn(cells[di + 1]); msrpFoil = priceIn(cells[di + 2]); }
    if (msrpNonfoil == null && msrpFoil == null) {
      const all = [...block.matchAll(/\$\s*([\d,]+\.\d{2})/g)].map(x => parseFloat(x[1].replace(/,/g, '')));
      if (all.length === 2) { msrpNonfoil = all[0]; msrpFoil = all[1]; }
    }
    rows.push({ seq: seqM ? +seqM[1] : null, drop, superdrop: superdrop || null, date: dateM ? dateM[1] : null, msrpNonfoil, msrpFoil });
  }
  return rows;
}

// ── runtime state ────────────────────────────────────────────────────────────
let wikiData = null;                 // { fetchedAt, rows }
let byDrop = new Map();              // norm(drop) → row (later rows win — the fresh ones matter)

function indexRows() {
  byDrop = new Map();
  for (const r of (wikiData?.rows || [])) byDrop.set(norm(r.drop), r);
}

export async function loadSlWikiFromSettings() {
  try {
    const raw = await window.api?.settings?.get(SETTINGS_KEY);
    if (raw) { wikiData = JSON.parse(raw); indexRows(); }
  } catch (e) { window.logger?.warn?.('SL', `wiki data load failed: ${e.message}`); }
}

// Fetch + parse + persist. Defensive: a failed fetch or a mangled table keeps
// the previous good data (the app always has the baked grouping underneath).
export async function refreshSlWikiData(opts = {}) {
  try {
    const resp = await netFetch(WIKI_API);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from mtg.wiki`);
    const j = await resp.json();
    const wt = j?.parse?.wikitext?.['*'] || '';
    const rows = parseDropSeriesWikitext(wt);
    if (rows.length < 100) throw new Error(`parsed only ${rows.length} rows — table layout changed?`);
    wikiData = { fetchedAt: new Date().toISOString(), rows };
    indexRows();
    await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(wikiData));
    window.logger?.success?.('SL', `Wiki sync: ${rows.length} drops, MSRPs + grouping current`);
    return true;
  } catch (e) {
    if (!opts.silent) window.logger?.warn?.('SL', `Wiki sync failed (using last good data): ${e.message}`);
    return false;
  }
}

// ── accessors ────────────────────────────────────────────────────────────────
export function slWikiRowFor(dropName) {
  return byDrop.get(norm(slBaseDropName(dropName))) || null;
}

// The drop's real MSRP at the given finish ('normal'|'foil'|'etched' — the
// pricing vocabulary dropFinish() speaks). null → caller falls back to defaults.
export function slWikiMsrp(dropName, finish) {
  const r = slWikiRowFor(dropName);
  if (!r) return null;
  return finish === 'foil' || finish === 'etched'
    ? (r.msrpFoil ?? r.msrpNonfoil ?? null)
    : (r.msrpNonfoil ?? r.msrpFoil ?? null);
}

// Superdrop home for a drop the baked dataset doesn't know yet.
export function slWikiGroupFor(dropName) {
  const r = slWikiRowFor(dropName);
  return r && r.superdrop ? { superdrop: r.superdrop, date: (r.date || '').slice(0, 7) } : null;
}

// Announced-but-unreleased drops (the wiki lists them ahead of time).
export function upcomingSlDrops() {
  const today = new Date().toISOString().slice(0, 10);
  return (wikiData?.rows || []).filter(r => r.date && r.date > today)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function slWikiInfo() {
  return wikiData ? { fetchedAt: wikiData.fetchedAt, count: wikiData.rows.length } : null;
}
