// Live Secret Lair bonus-card catalog from mtg.wiki.
//
// Bonus cards are intentionally separate from the guaranteed sealed-product
// contents in slData.js: some are randomized/chase inserts and must never make
// a normal drop look "incomplete" in collection tracking. The catalog adds
// collector number, variant, exclusivity and notes as supplemental context.

import { slBaseDropName } from './slData.js';
import { netFetch } from './utils.js';

const BONUS_API = 'https://mtg.wiki/api.php?action=parse&page=Secret%20Lair%2FBonus%20cards&prop=text&format=json';
const SETTINGS_KEY = 'sl_bonus_data';

const decode = s => String(s || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&ndash;/gi, '–')
  .replace(/&mdash;/gi, '—')
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));

const cleanCell = html => decode(String(html || '')
  .replace(/<br\s*\/?\s*>/gi, '; ')
  .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, '')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\[[a-z]\]/gi, '')
  .replace(/\s+/g, ' ')
  .trim();

const norm = s => String(s || '').toLowerCase()
  .replace(/[‘’]/g, "'").replace(/\band\b/g, '').replace(/[^a-z0-9]+/g, '');

// Pure HTML-table parser. A tiny rowspan-aware grid matters here: the wiki
// groups repeated values with rowspans, so a naive cell-position parser shifts
// Variant/Exclusive/Notes into the wrong columns on continuation rows.
export function parseBonusCardsHtml(html) {
  const rows = [];
  const spans = new Map(); // column -> { value, left }
  for (const rm of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rawCells = [...rm[1].matchAll(/<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi)];
    if (!rawCells.length || rawCells.every(c => c[1].toLowerCase() === 'th')) continue;

    const grid = [];
    for (const [col, span] of spans) if (span.left > 0) grid[col] = span.value;
    let col = 0;
    for (const c of rawCells) {
      while (grid[col] !== undefined) col++;
      const value = cleanCell(c[3]);
      grid[col] = value;
      const rowspan = +(c[2].match(/rowspan\s*=\s*["']?(\d+)/i)?.[1] || 1);
      if (rowspan > 1) spans.set(col, { value, left: rowspan });
      const colspan = +(c[2].match(/colspan\s*=\s*["']?(\d+)/i)?.[1] || 1);
      for (let extra = 1; extra < colspan; extra++) grid[col + extra] = value;
      col += colspan;
    }
    for (const [key, span] of spans) {
      span.left--;
      if (span.left <= 0) spans.delete(key);
    }

    const collectorNumber = (grid[0] || '').replace(/^SLD\s*#?\s*/i, '').trim();
    if (!collectorNumber || !/\d/.test(collectorNumber)) continue;
    const cardName = grid[2] || '';
    if (!cardName) continue;
    const notes = grid[5] || '';
    rows.push({
      collectorNumber,
      type: grid[1] || '',
      cardName,
      variant: grid[3] || '',
      exclusiveTo: grid[4] || '',
      notes,
      chase: /chase|random|rare|scarce|one in|odds/i.test(`${grid[1] || ''} ${grid[3] || ''} ${notes}`),
    });
  }
  return rows;
}

let bonusData = null; // { fetchedAt, rows }

export async function loadSlBonusFromSettings() {
  try {
    const raw = await window.api?.settings?.get(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.rows)) bonusData = parsed;
    }
  } catch (e) { window.logger?.warn?.('SL', `bonus-card cache load failed: ${e.message}`); }
}

export async function refreshSlBonusData(opts = {}) {
  try {
    const resp = await netFetch(BONUS_API);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from mtg.wiki`);
    const json = await resp.json();
    const rows = parseBonusCardsHtml(json?.parse?.text?.['*'] || '');
    if (rows.length < 100) throw new Error(`parsed only ${rows.length} bonus rows — table layout changed?`);
    bonusData = { fetchedAt: new Date().toISOString(), rows };
    await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(bonusData));
    window.logger?.success?.('SL', `Bonus catalog sync: ${rows.length} documented inserts`);
    return true;
  } catch (e) {
    if (!opts.silent) window.logger?.warn?.('SL', `Bonus catalog sync failed (using last good data): ${e.message}`);
    return false;
  }
}

export function allSlBonusCards() { return bonusData?.rows || []; }

// Only explicit exclusivity is used for a drop-level join. Generic randomized
// bonus pools stay in the global catalog instead of being falsely promised as
// contents of every drop.
export function slBonusCardsForDrop(dropName) {
  const key = norm(slBaseDropName(dropName));
  if (!key) return [];
  return (bonusData?.rows || []).filter(r => {
    const ex = norm(r.exclusiveTo);
    return ex && ex.includes(key);
  });
}

export function slBonusInfo() {
  return bonusData ? { fetchedAt: bonusData.fetchedAt, count: bonusData.rows.length } : null;
}
