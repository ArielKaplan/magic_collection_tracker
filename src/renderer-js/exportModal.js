import { CONDITION_FULL } from './constants.js';
import { hideModal, showModal } from './modals.js';
import { getPriceHistory } from './prices.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { esc, toast, today } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// EXPORT — cards & sealed to CSV / JSON / Markdown / Text, with app presets
// ─────────────────────────────────────────────────────────────────────────────
export const EXPORT_LANG_NAMES = {
  en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
  pt: 'Portuguese', ja: 'Japanese', ko: 'Korean', ru: 'Russian',
  zhs: 'Chinese Simplified', zht: 'Chinese Traditional', ph: 'Phyrexian',
};
export const ARCHIDEKT_CONDITION = {
  mint: 'NM', near_mint: 'NM', lightly_played: 'LP',
  moderately_played: 'MP', heavily_played: 'HP', damaged: 'D',
};
export const exportLang = code => EXPORT_LANG_NAMES[(code || 'en').toLowerCase()] || code;

export function exportUnitPrice(c) {
  const h = getPriceHistory(c.scryfallId, c.foil);
  return h?.length ? h[h.length - 1].price : null;
}
export function sealedUnitPrice(i) {
  return i.priceHistory?.length ? i.priceHistory[i.priceHistory.length - 1].price : null;
}

export const EXPORT_COLUMNS = {
  cards: [
    { key: 'name',            label: 'Name',             get: c => c.name },
    { key: 'setCode',         label: 'Set Code',         get: c => c.setCode },
    { key: 'setName',         label: 'Set Name',         get: c => c.setName },
    { key: 'collectorNumber', label: 'Collector Number', get: c => c.collectorNumber },
    { key: 'foil',            label: 'Foil',             get: c => c.foil },
    { key: 'rarity',          label: 'Rarity',           get: c => c.rarity },
    { key: 'quantity',        label: 'Quantity',         get: c => c.quantity },
    { key: 'binderName',      label: 'Binder',           get: c => c.binderName },
    { key: 'condition',       label: 'Condition',        get: c => CONDITION_FULL[c.condition] || c.condition },
    { key: 'language',        label: 'Language',         get: c => c.language },
    { key: 'purchasePrice',   label: 'Purchase Price',   get: c => c.purchasePrice },
    { key: 'currency',        label: 'Currency',         get: c => c.purchasePriceCurrency },
    { key: 'currentPrice',    label: 'Current Price',    get: c => exportUnitPrice(c) ?? '' },
    { key: 'totalValue',      label: 'Total Value',      get: c => { const u = exportUnitPrice(c); return u != null ? +(u * c.quantity).toFixed(2) : ''; } },
    { key: 'scryfallId',      label: 'Scryfall ID',      get: c => c.scryfallId },
    { key: 'manaboxId',       label: 'ManaBox ID',       get: c => c.manaboxId },
    { key: 'misprint',        label: 'Misprint',         get: c => c.misprint ? 'true' : 'false' },
    { key: 'altered',         label: 'Altered',          get: c => c.altered ? 'true' : 'false' },
  ],
  sealed: [
    { key: 'name',          label: 'Name',           get: i => i.name },
    { key: 'productType',   label: 'Product Type',   get: i => i.productType },
    { key: 'setCode',       label: 'Set Code',       get: i => i.setCode },
    { key: 'setName',       label: 'Set Name',       get: i => i.setName },
    { key: 'quantity',      label: 'Quantity',       get: i => i.quantity },
    { key: 'status',        label: 'Status',         get: i => i.status },
    { key: 'purchasePrice', label: 'Purchase Price', get: i => i.purchasePrice },
    { key: 'currentPrice',  label: 'Current Price',  get: i => sealedUnitPrice(i) ?? '' },
    { key: 'totalValue',    label: 'Total Value',    get: i => { const u = sealedUnitPrice(i); return u != null ? +(u * i.quantity).toFixed(2) : ''; } },
    { key: 'notes',         label: 'Notes',          get: i => i.notes || '' },
  ],
};

// Presets emit CSVs with the exact headers those apps expect on import.
export const EXPORT_PRESETS = {
  manabox: {
    label: 'ManaBox',
    note: 'Matches the ManaBox CSV format, so it imports back into ManaBox losslessly.',
    columns: [
      ['Name', c => c.name], ['Set code', c => c.setCode], ['Set name', c => c.setName],
      ['Collector number', c => c.collectorNumber], ['Foil', c => c.foil],
      ['Rarity', c => c.rarity], ['Quantity', c => c.quantity],
      ['ManaBox ID', c => c.manaboxId], ['Scryfall ID', c => c.scryfallId],
      ['Purchase price', c => c.purchasePrice], ['Misprint', c => c.misprint ? 'true' : 'false'],
      ['Altered', c => c.altered ? 'true' : 'false'], ['Condition', c => c.condition],
      ['Language', c => c.language], ['Purchase price currency', c => c.purchasePriceCurrency],
    ],
  },
  moxfield: {
    label: 'Moxfield',
    note: 'Import via Moxfield → Collection → Import → CSV.',
    columns: [
      ['Count', c => c.quantity], ['Name', c => c.name], ['Edition', c => c.setCode],
      ['Condition', c => CONDITION_FULL[c.condition] || c.condition],
      ['Language', c => exportLang(c.language)],
      ['Foil', c => c.foil === 'normal' ? '' : c.foil],
      ['Collector Number', c => c.collectorNumber],
      ['Purchase Price', c => c.purchasePrice || ''],
    ],
  },
  archidekt: {
    label: 'Archidekt',
    note: 'Import via Archidekt → Collection → Import; confirm the column mapping if prompted.',
    columns: [
      ['Quantity', c => c.quantity], ['Name', c => c.name],
      ['Finish', c => c.foil === 'foil' ? 'Foil' : c.foil === 'etched' ? 'Etched' : 'Non-foil'],
      ['Condition', c => ARCHIDEKT_CONDITION[c.condition] || 'NM'],
      ['Edition Code', c => c.setCode], ['Collector Number', c => c.collectorNumber],
      ['Language', c => exportLang(c.language)],
      ['Purchase Price', c => c.purchasePrice || ''],
      ['Scryfall ID', c => c.scryfallId],
    ],
  },
};

export const EXPORT_FORMATS = [
  { id: 'csv',  label: 'CSV',      ext: 'csv',  filter: 'CSV files' },
  { id: 'json', label: 'JSON',     ext: 'json', filter: 'JSON files' },
  { id: 'md',   label: 'Markdown', ext: 'md',   filter: 'Markdown files' },
  { id: 'txt',  label: 'Text',     ext: 'txt',  filter: 'Text files' },
];

export function buildExportContent(format, header, rows) {
  if (format === 'csv') {
    const q = v => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [header.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\r\n');
  }
  if (format === 'json') {
    return JSON.stringify(rows.map(r => Object.fromEntries(header.map((h, i) => [h, r[i]]))), null, 2);
  }
  if (format === 'md') {
    const mdesc = v => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    return [
      `| ${header.map(mdesc).join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...rows.map(r => `| ${r.map(mdesc).join(' | ')} |`),
    ].join('\n');
  }
  // txt — fixed-width padded columns
  const cells = [header, ...rows].map(r => r.map(v => String(v ?? '').replace(/\r?\n/g, ' ')));
  const widths = header.map((_, i) => Math.max(...cells.map(r => r[i].length)));
  const line = r => r.map((v, i) => v.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cells[0]), widths.map(w => '─'.repeat(w)).join('  '), ...cells.slice(1).map(line)].join('\n');
}

export function showExportModal(kind) {
  const isCards = kind === 'cards';
  const data = isCards ? collection.cards : collection.sealed;
  if (!data.length) { toast(`Nothing to export — your ${isCards ? 'card' : 'sealed'} collection is empty`, 'info'); return; }

  const colDefs = EXPORT_COLUMNS[kind];
  const saved = collection.settings.export?.[kind] || {};
  const state = {
    format: EXPORT_FORMATS.some(f => f.id === saved.format) ? saved.format : 'csv',
    preset: isCards && EXPORT_PRESETS[saved.preset] ? saved.preset : 'custom',
    columns: new Set(Array.isArray(saved.columns) && saved.columns.length
      ? saved.columns.filter(k => colDefs.some(d => d.key === k))
      : colDefs.map(d => d.key)),
  };
  if (!state.columns.size) colDefs.forEach(d => state.columns.add(d.key));

  showModal(`
    <h2>Export ${isCards ? 'Card' : 'Sealed'} Collection</h2>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:14px">
      Exports all ${data.length.toLocaleString()} ${isCards ? 'card entries' : 'products'} to a file.
    </p>
    ${isCards ? `
    <h3>Preset</h3>
    <div class="col-picker-chips" id="exp-presets" style="margin-bottom:8px">
      <button class="col-chip" data-preset="custom">Custom</button>
      ${Object.entries(EXPORT_PRESETS).map(([id, p]) => `<button class="col-chip" data-preset="${id}">${p.label}</button>`).join('')}
    </div>
    <div id="exp-preset-note" style="font-size:11.5px;color:var(--text-muted);margin-bottom:14px;min-height:14px"></div>
    ` : ''}
    <h3>Format</h3>
    <div class="col-picker-chips" id="exp-formats" style="margin-bottom:16px">
      ${EXPORT_FORMATS.map(f => `<button class="col-chip" data-format="${f.id}">${f.label}</button>`).join('')}
    </div>
    <div id="exp-columns-wrap">
      <h3>Columns</h3>
      <div class="col-picker-chips" id="exp-columns" style="max-height:150px;overflow-y:auto;padding:2px">
        ${colDefs.map(d => `<button class="col-chip" data-colkey="${d.key}">${esc(d.label)}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-ghost btn-sm" id="exp-cols-all">Select all</button>
        <button class="btn btn-ghost btn-sm" id="exp-cols-none">Select none</button>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:24px">
      <button class="btn" id="exp-cancel">Cancel</button>
      <button class="btn btn-primary" id="exp-go">⤓ Export</button>
    </div>`);

  const sync = () => {
    document.querySelectorAll('#exp-presets .col-chip').forEach(b =>
      b.classList.toggle('col-chip-on', b.dataset.preset === state.preset));
    const note = document.getElementById('exp-preset-note');
    if (note) note.textContent = state.preset !== 'custom'
      ? `${EXPORT_PRESETS[state.preset].note} The preset defines the columns and always exports CSV.`
      : '';
    document.querySelectorAll('#exp-formats .col-chip').forEach(b => {
      const locked = state.preset !== 'custom';
      b.classList.toggle('col-chip-on', locked ? b.dataset.format === 'csv' : b.dataset.format === state.format);
      b.disabled = locked && b.dataset.format !== 'csv';
      b.style.opacity = b.disabled ? '0.4' : '';
    });
    const wrap = document.getElementById('exp-columns-wrap');
    if (wrap) wrap.style.display = state.preset !== 'custom' ? 'none' : '';
    document.querySelectorAll('#exp-columns .col-chip').forEach(b =>
      b.classList.toggle('col-chip-on', state.columns.has(b.dataset.colkey)));
  };

  document.getElementById('exp-presets')?.addEventListener('click', e => {
    const b = e.target.closest('[data-preset]'); if (!b) return;
    state.preset = b.dataset.preset;
    if (state.preset !== 'custom') state.format = 'csv';
    sync();
  });
  document.getElementById('exp-formats').addEventListener('click', e => {
    const b = e.target.closest('[data-format]'); if (!b || b.disabled) return;
    state.format = b.dataset.format; sync();
  });
  document.getElementById('exp-columns').addEventListener('click', e => {
    const b = e.target.closest('[data-colkey]'); if (!b) return;
    const k = b.dataset.colkey;
    if (state.columns.has(k)) state.columns.delete(k); else state.columns.add(k);
    sync();
  });
  document.getElementById('exp-cols-all').addEventListener('click', () => { colDefs.forEach(d => state.columns.add(d.key)); sync(); });
  document.getElementById('exp-cols-none').addEventListener('click', () => { state.columns.clear(); sync(); });
  document.getElementById('exp-cancel').addEventListener('click', hideModal);

  document.getElementById('exp-go').addEventListener('click', async () => {
    let header, rowFns, format = state.format, baseName;
    if (state.preset !== 'custom') {
      const p = EXPORT_PRESETS[state.preset];
      header  = p.columns.map(([h]) => h);
      rowFns  = p.columns.map(([, fn]) => fn);
      format  = 'csv';
      baseName = `${state.preset}-export`;
    } else {
      const chosen = colDefs.filter(d => state.columns.has(d.key));
      if (!chosen.length) { toast('Pick at least one column', 'error'); return; }
      header  = chosen.map(d => d.label);
      rowFns  = chosen.map(d => d.get);
      baseName = `${kind}-export`;
    }
    const rows    = data.map(item => rowFns.map(fn => fn(item)));
    const fmtDef  = EXPORT_FORMATS.find(f => f.id === format);
    const content = buildExportContent(format, header, rows);
    const path = await window.api.dialog.saveFile({
      title: `Export ${isCards ? 'cards' : 'sealed collection'}`,
      defaultPath: `${baseName}-${today()}.${fmtDef.ext}`,
      filterName: fmtDef.filter,
      extensions: [fmtDef.ext],
      content,
    });
    if (!path) return;  // cancelled — keep the modal open
    collection.settings.export = collection.settings.export || {};
    collection.settings.export[kind] = { format: state.format, preset: state.preset, columns: [...state.columns] };
    autoSave();
    hideModal();
    toast(`Exported ${rows.length.toLocaleString()} ${isCards ? 'entries' : 'products'} → ${path.split(/[\\/]/).pop()}`, 'success');
    window.logger?.info?.('Export', `Wrote ${path}`);
  });

  sync();
}

