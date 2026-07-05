import { uid } from './utils.js';


// Neutralize imported text at the trust boundary. CSVs (and, later, shared
// curation) are untrusted input rendered all over the app via innerHTML; the
// render paths escape with esc()/escJs(), but that pattern fails open on a
// single miss. Stripping the HTML tag characters (and control chars) from
// imported strings means even a missed downstream escape can't produce markup
// or a rogue inline handler. No legitimate MTG card/set/binder text contains
// '<' or '>', so this changes nothing real.
export function sanitizeText(s) {
  const stripped = String(s == null ? '' : s).replace(/[<>]/g, '');
  let out = '';
  for (const ch of stripped) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127) out += ch;   // drop C0 control chars + DEL
  }
  return out.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PARSING
// ─────────────────────────────────────────────────────────────────────────────
export function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => row[h] = (vals[i] ?? '').trim());
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

export function parseCsvHeaders(text) {
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  return parseCsvLine(firstLine).map(h => h.trim()).filter(Boolean);
}

export function csvRowToCard(row) {
  // Free-text fields from the (untrusted) CSV are sanitized; ids/enums/numbers
  // are constrained by their own parsing below.
  return {
    id: uid(),
    binderName: sanitizeText(row['Binder Name'] || ''),
    binderType: sanitizeText(row['Binder Type'] || 'binder') || 'binder',
    name: sanitizeText(row['Name'] || ''),
    setCode: sanitizeText(row['Set code'] || ''),
    setName: sanitizeText(row['Set name'] || ''),
    collectorNumber: sanitizeText(row['Collector number'] || ''),
    foil: row['Foil'] || 'normal',
    rarity: (row['Rarity'] || '').toLowerCase(),
    quantity: Math.max(1, parseInt(row['Quantity']) || 1),
    manaboxId: sanitizeText(row['ManaBox ID'] || ''),
    scryfallId: (row['Scryfall ID'] || '').trim().toLowerCase(),
    purchasePrice: parseFloat(row['Purchase price']) || 0,
    purchasePriceCurrency: sanitizeText(row['Purchase price currency'] || 'USD') || 'USD',
    misprint: row['Misprint'] === 'true',
    altered: row['Altered'] === 'true',
    condition: sanitizeText(row['Condition'] || 'near_mint') || 'near_mint',
    language: sanitizeText(row['Language'] || 'en') || 'en'
  };
}
