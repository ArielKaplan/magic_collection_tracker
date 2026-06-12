import { uid } from './utils.js';


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
  return {
    id: uid(),
    binderName: row['Binder Name'] || '',
    binderType: row['Binder Type'] || 'binder',
    name: row['Name'] || '',
    setCode: row['Set code'] || '',
    setName: row['Set name'] || '',
    collectorNumber: row['Collector number'] || '',
    foil: row['Foil'] || 'normal',
    rarity: (row['Rarity'] || '').toLowerCase(),
    quantity: Math.max(1, parseInt(row['Quantity']) || 1),
    manaboxId: row['ManaBox ID'] || '',
    scryfallId: (row['Scryfall ID'] || '').trim().toLowerCase(),
    purchasePrice: parseFloat(row['Purchase price']) || 0,
    purchasePriceCurrency: row['Purchase price currency'] || 'USD',
    misprint: row['Misprint'] === 'true',
    altered: row['Altered'] === 'true',
    condition: row['Condition'] || 'near_mint',
    language: row['Language'] || 'en'
  };
}

