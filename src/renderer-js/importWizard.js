import { parseCsv, parseCsvHeaders } from './csv.js';
import { hideModal, showModal } from './modals.js';
import { render } from './render.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { esc, toast, uid } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// CSV IMPORT WIZARD
// ─────────────────────────────────────────────────────────────────────────────

export const IMPORT_FIELD_DEFS = [
  { key: 'name',                  label: 'Card Name',         required: true,  aliases: ['name','card name','card_name'] },
  { key: 'scryfallId',            label: 'Scryfall ID',       required: true,  aliases: ['scryfall id','scryfall_id','scryfallid','scryfall'] },
  { key: 'setCode',               label: 'Set Code',          required: false, aliases: ['set code','set_code','setcode','set'] },
  { key: 'setName',               label: 'Set Name',          required: false, aliases: ['set name','set_name','setname','edition'] },
  { key: 'collectorNumber',       label: 'Collector #',       required: false, aliases: ['collector number','collector_number','collectornumber','number','card number'] },
  { key: 'foil',                  label: 'Foil Type',         required: false, aliases: ['foil','foil type','foil_type','printing'] },
  { key: 'rarity',                label: 'Rarity',            required: false, aliases: ['rarity','card rarity'] },
  { key: 'quantity',              label: 'Quantity',          required: false, aliases: ['quantity','qty','count','amount','copies'] },
  { key: 'binderName',            label: 'Binder / Folder',   required: false, aliases: ['binder name','binder_name','binder','folder','location'] },
  { key: 'binderType',            label: 'Binder Type',       required: false, aliases: ['binder type','binder_type'] },
  { key: 'purchasePrice',         label: 'Purchase Price',    required: false, aliases: ['purchase price','purchase_price','price','cost','paid'] },
  { key: 'purchasePriceCurrency', label: 'Currency',          required: false, aliases: ['purchase price currency','currency','purchase_price_currency'] },
  { key: 'condition',             label: 'Condition',         required: false, aliases: ['condition','grade','quality'] },
  { key: 'language',              label: 'Language',          required: false, aliases: ['language','lang','locale'] },
  { key: 'manaboxId',             label: 'ManaBox ID',        required: false, aliases: ['manabox id','manabox_id','manaboxid'] },
  { key: 'misprint',              label: 'Misprint',          required: false, aliases: ['misprint','is misprint'] },
  { key: 'altered',               label: 'Altered',           required: false, aliases: ['altered','is altered','modified'] },
];

export let _wizard = null;

export function _normHdr(h) { return h.toLowerCase().replace(/[\s_\-]+/g, ' ').trim(); }

export function autoDetectMapping(headers) {
  const normed = headers.map(_normHdr);
  const mapping = {};
  for (const def of IMPORT_FIELD_DEFS) {
    const found = def.aliases.find(a => normed.includes(a));
    mapping[def.key] = found != null ? headers[normed.indexOf(found)] : '';
  }
  return mapping;
}

export function csvRowToCardWithMapping(row, mapping) {
  const get = key => { const col = mapping[key]; return col ? (row[col] ?? '').toString().trim() : ''; };
  const name = get('name');
  if (!name) return null;
  const rawFoil = get('foil').toLowerCase();
  const foil = rawFoil === 'foil' || rawFoil === 'true' || rawFoil === 'yes' ? 'foil'
    : rawFoil === 'etched' ? 'etched' : 'normal';
  const COND_MAP = {
    nm:'near_mint','near mint':'near_mint','near_mint':'near_mint',
    lp:'lightly_played','lightly played':'lightly_played','lightly_played':'lightly_played',
    mp:'moderately_played','moderately played':'moderately_played','moderately_played':'moderately_played',
    hp:'heavily_played','heavily played':'heavily_played','heavily_played':'heavily_played',
    d:'damaged','dmg':'damaged','damaged':'damaged'
  };
  const rawCond = get('condition').toLowerCase();
  const condition = COND_MAP[rawCond] || rawCond || 'near_mint';
  const qty = parseInt(get('quantity') || '1', 10);
  return {
    id: uid(), name,
    scryfallId: get('scryfallId').toLowerCase(),
    setCode: (get('setCode') || '').toLowerCase(),
    setName: get('setName'),
    collectorNumber: get('collectorNumber'),
    foil, rarity: (get('rarity') || 'common').toLowerCase(),
    quantity: isNaN(qty) || qty < 1 ? 1 : qty,
    binderName: get('binderName') || '',
    binderType: get('binderType') || 'binder',
    manaboxId: get('manaboxId') || '',
    purchasePrice: parseFloat(get('purchasePrice')) || 0,
    purchasePriceCurrency: get('purchasePriceCurrency') || 'USD',
    condition,
    language: (get('language') || 'en').toLowerCase(),
    misprint: get('misprint').toLowerCase() === 'true',
    altered: get('altered').toLowerCase() === 'true',
  };
}

export function _wizardStepBar(active) {
  return `<div class="wiz-steps">${['Preview','Map Columns','Import'].map((s, i) => {
    const n = i + 1;
    const cls = n === active ? 'wiz-step active' : n < active ? 'wiz-step done' : 'wiz-step';
    return `<span class="${cls}">${n < active ? '✓ ' : ''}${n}. ${s}</span>${i < 2 ? '<span class="wiz-sep">›</span>' : ''}`;
  }).join('')}</div>`;
}

export function renderWizardStep1() {
  const { fileName, headers, rows } = _wizard;
  const previewRows = rows.slice(0, 10);
  const maxCols = Math.min(headers.length, 7);
  const vis = headers.slice(0, maxCols);
  const extra = headers.length - maxCols;
  return `
    ${_wizardStepBar(1)}
    <h2>CSV Preview</h2>
    <p class="wiz-meta">
      <strong>${esc(fileName)}</strong> &nbsp;·&nbsp;
      <strong>${rows.length.toLocaleString()}</strong> rows &nbsp;·&nbsp;
      <strong>${headers.length}</strong> columns
    </p>
    <div class="wiz-chips">
      ${headers.map(h => `<span class="wiz-chip">${esc(h)}</span>`).join('')}
    </div>
    <div class="wiz-scroll">
      <table class="wiz-table">
        <thead><tr>
          ${vis.map(h => `<th>${esc(h)}</th>`).join('')}
          ${extra > 0 ? `<th class="dim">+${extra} more</th>` : ''}
        </tr></thead>
        <tbody>
          ${previewRows.map(r => `<tr>
            ${vis.map(h => `<td>${esc((r[h] || '').substring(0, 36))}</td>`).join('')}
            ${extra > 0 ? '<td class="dim">…</td>' : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="wiz-footer">
      <button class="btn" id="wiz-cancel">Cancel</button>
      <button class="btn btn-primary" id="wiz-next">Map Columns →</button>
    </div>`;
}

export function renderWizardStep2() {
  const { headers, mapping } = _wizard;
  const sel = key => {
    const cur = mapping[key] || '';
    return `<select id="wmap-${esc(key)}" class="wiz-sel">
      <option value=""${!cur ? ' selected' : ''}>— not mapped —</option>
      ${headers.map(h => `<option value="${esc(h)}"${cur === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}
    </select>`;
  };
  const req = IMPORT_FIELD_DEFS.filter(d => d.required);
  const opt = IMPORT_FIELD_DEFS.filter(d => !d.required);
  return `
    ${_wizardStepBar(2)}
    <h2>Map Columns</h2>
    <p class="wiz-meta">Match your CSV columns to app fields. <span style="color:var(--accent)">★</span> fields are needed for price lookups.</p>
    <div class="wiz-body">
      <div class="wiz-section-label">Required</div>
      <div class="wiz-map-grid">
        ${req.map(d => `<div class="wiz-map-row">
          <label class="wiz-map-lbl"><span class="wiz-req">★</span>${esc(d.label)}</label>
          ${sel(d.key)}
        </div>`).join('')}
      </div>
      <div class="wiz-section-label" style="margin-top:12px">Optional</div>
      <div class="wiz-map-grid wiz-map-2col">
        ${opt.map(d => `<div class="wiz-map-row">
          <label class="wiz-map-lbl">${esc(d.label)}</label>
          ${sel(d.key)}
        </div>`).join('')}
      </div>
    </div>
    <div class="wiz-footer">
      <button class="btn" id="wiz-back">← Back</button>
      <button class="btn btn-primary" id="wiz-next">Review →</button>
    </div>`;
}

export function renderWizardStep3() {
  const { rows, mapping } = _wizard;
  const nameCol = mapping['name'];
  const importable = nameCol ? rows.filter(r => (r[nameCol] || '').trim()).length : 0;
  const req = IMPORT_FIELD_DEFS.filter(d => d.required);
  const mappedOpt = IMPORT_FIELD_DEFS.filter(d => !d.required && mapping[d.key]).length;
  const lines = [];
  for (const d of req) {
    if (mapping[d.key]) lines.push({ ok: true,  text: `${d.label} → "${mapping[d.key]}"` });
    else                lines.push({ ok: false, text: `${d.label} not mapped — cards won't have Scryfall pricing` });
  }
  lines.push({ ok: true, text: `${mappedOpt} optional field${mappedOpt !== 1 ? 's' : ''} mapped` });
  if (importable === 0) lines.push({ ok: false, text: 'No importable rows found — check your Name column mapping' });
  return `
    ${_wizardStepBar(3)}
    <h2>Review & Import</h2>
    <div class="wiz-summary">
      <div class="wiz-sum-row wiz-ok">✓ ${importable.toLocaleString()} rows ready to import</div>
      ${lines.map(l => `<div class="wiz-sum-row ${l.ok ? 'wiz-ok' : 'wiz-warn'}">${l.ok ? '✓' : '⚠'} ${esc(l.text)}</div>`).join('')}
    </div>
    <p class="wiz-meta" style="margin-top:12px">
      Cards with matching Scryfall ID + foil + binder will be updated. All others are added as new.
    </p>
    <div class="wiz-footer">
      <button class="btn" id="wiz-back">← Back</button>
      <button class="btn btn-primary" id="wiz-import"${importable === 0 ? ' disabled' : ''}>
        Import ${importable.toLocaleString()} Rows
      </button>
    </div>`;
}

export function _wizardReadMapping() {
  const m = {};
  for (const d of IMPORT_FIELD_DEFS) {
    const el = document.getElementById(`wmap-${d.key}`);
    if (el) m[d.key] = el.value;
  }
  return m;
}

export function _wizardClose() {
  _wizard = null;
  document.querySelector('.modal')?.classList.remove('modal-wide');
  hideModal();
}

export function _wizardPerformImport() {
  const { rows, mapping } = _wizard;
  const incoming = rows.map(r => csvRowToCardWithMapping(r, mapping)).filter(Boolean);
  let added = 0, updated = 0, skipped = 0;
  for (const card of incoming) {
    if (!card.name) { skipped++; continue; }
    let idx = -1;
    if (card.manaboxId) {
      idx = collection.cards.findIndex(c =>
        c.manaboxId === card.manaboxId && c.scryfallId === card.scryfallId && c.foil === card.foil);
    } else if (card.scryfallId) {
      idx = collection.cards.findIndex(c =>
        c.scryfallId === card.scryfallId && c.foil === card.foil && c.binderName === card.binderName);
    }
    if (idx >= 0) { collection.cards[idx] = { ...collection.cards[idx], ...card }; updated++; }
    else { collection.cards.push(card); added++; }
  }
  _wizardClose();
  toast(`Imported — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ''}`, 'success');
  window.logger?.success('Import', `Wizard: ${added} new + ${updated} updated${skipped ? ` + ${skipped} skipped` : ''}`);
  render();
  autoSave();
}

export function _attachWizardListeners() {
  const step = _wizard?.step;
  document.getElementById('wiz-cancel')?.addEventListener('click', _wizardClose);
  document.getElementById('wiz-back')?.addEventListener('click', () => {
    if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 1; }
    if (step === 3) { _wizard.step = 2; }
    _showWizardStep();
  });
  document.getElementById('wiz-next')?.addEventListener('click', () => {
    if (step === 1) { _wizard.step = 2; }
    if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 3; }
    _showWizardStep();
  });
  document.getElementById('wiz-import')?.addEventListener('click', _wizardPerformImport);
}

export function _showWizardStep() {
  const html = _wizard.step === 1 ? renderWizardStep1()
    : _wizard.step === 2 ? renderWizardStep2()
    : renderWizardStep3();
  showModal(html);
  _attachWizardListeners();
}

export function showImportWizard({ path: filePath, text }) {
  const headers = parseCsvHeaders(text);
  if (!headers.length) { toast('CSV has no headers — check the file format', 'error'); return; }
  const rows = parseCsv(text);
  if (!rows.length) { toast('CSV appears empty', 'error'); return; }
  const fileName = (filePath || '').split(/[/\\]/).pop() || 'import.csv';
  _wizard = { step: 1, filePath, fileName, headers, rows, mapping: autoDetectMapping(headers) };
  document.querySelector('.modal')?.classList.add('modal-wide');
  _showWizardStep();
}

