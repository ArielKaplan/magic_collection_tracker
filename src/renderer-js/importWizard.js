import { PRODUCT_TYPES } from './constants.js';
import { planCardImport } from './acquisition.js';
import { parseCsv, parseCsvHeaders } from './csv.js';
import { deckImportBodyHtml, wireDeckImportForm } from './deckIO.js';
import { hideModal, showModal } from './modals.js';
import { render } from './render.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { esc, toast, today, uid } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED IMPORT WIZARD
// ─────────────────────────────────────────────────────────────────────────────
// One workflow for every kind of import. The landing screen picks a type, then:
//   • Cards / Sealed → a shared CSV flow (File → Map Columns → Review), driven by
//     per-kind field definitions and an import function (see IMPORT_KINDS).
//   • Decks → the paste / load-a-file decklist flow (markup + wiring live in
//     deckIO.js so deck parsing stays in one place).
// Reached everywhere through showImportHub(kind?).

// ── Card column definitions ──────────────────────────────────────────────────
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
  { key: 'acquiredAt',            label: 'Acquired Date',     required: false, aliases: ['acquired date','acquired_at','purchase date','date acquired','date added'] },
  { key: 'sourceProductId',       label: 'Source Product ID', required: false, aliases: ['source product id','source_product_id','opened product id'] },
  { key: 'sourceProductName',     label: 'Source Product',    required: false, aliases: ['source product','source product name','source_product_name','opened from'] },
];

// ── Sealed column definitions ─────────────────────────────────────────────────
// Aliases line up with this app's own sealed export (see exportModal.js) so an
// export → re-import round-trips cleanly after a wipe.
export const SEALED_IMPORT_FIELDS = [
  { key: 'name',          label: 'Product Name',     required: true,  aliases: ['name','product name','product'] },
  { key: 'productType',   label: 'Product Type',     required: false, aliases: ['product type','type','producttype','product_type'] },
  { key: 'setCode',       label: 'Set Code',         required: false, aliases: ['set code','set_code','setcode','set'] },
  { key: 'setName',       label: 'Set Name',         required: false, aliases: ['set name','set_name','setname','edition'] },
  { key: 'quantity',      label: 'Quantity',         required: false, aliases: ['quantity','qty','count','amount'] },
  { key: 'status',        label: 'Status',           required: false, aliases: ['status','state'] },
  { key: 'purchasePrice', label: 'Purchase Price',   required: false, aliases: ['purchase price','purchase_price','cost','paid'] },
  { key: 'currentPrice',  label: 'Current Price',    required: false, aliases: ['current price','market price','market value','price','currentprice'] },
  { key: 'dropName',      label: 'Secret Lair Drop', required: false, aliases: ['secret lair drop','drop','drop name','dropname'] },
  { key: 'notes',         label: 'Notes',            required: false, aliases: ['notes','note','comment','comments'] },
];

export function _normHdr(h) { return h.toLowerCase().replace(/[\s_\-]+/g, ' ').trim(); }

export function autoDetectMapping(headers, fields = IMPORT_FIELD_DEFS) {
  const normed = headers.map(_normHdr);
  const mapping = {};
  for (const def of fields) {
    const found = def.aliases.find(a => normed.includes(a));
    mapping[def.key] = found != null ? headers[normed.indexOf(found)] : '';
  }
  return mapping;
}

// ── Row → record converters ───────────────────────────────────────────────────
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
    acquiredAt: get('acquiredAt') || '',
    sourceProductId: get('sourceProductId') || '',
    sourceProductName: get('sourceProductName') || '',
  };
}

export function csvRowToSealed(row, mapping) {
  const get = key => { const col = mapping[key]; return col ? (row[col] ?? '').toString().trim() : ''; };
  const name = get('name');
  if (!name) return null;
  const qty = parseInt(get('quantity') || '1', 10);
  const rawStatus = get('status').toLowerCase();
  const status = rawStatus === 'opened' ? 'opened' : rawStatus === 'sold' ? 'sold' : 'sealed';
  const rawType = get('productType');
  const productType = PRODUCT_TYPES.find(t => t.toLowerCase() === rawType.toLowerCase()) || rawType || 'Other';
  const cur = parseFloat(get('currentPrice'));
  const t = today();
  const item = {
    id: uid(),
    name,
    productType,
    setCode: get('setCode').toLowerCase(),
    setName: get('setName'),
    status,
    quantity: isNaN(qty) || qty < 1 ? 1 : qty,
    purchasePrice: parseFloat(get('purchasePrice')) || 0,
    purchasePriceCurrency: 'USD',
    dateAdded: t,
    notes: get('notes') || '',
    dropName: get('dropName') || '',
    pricechartingId: null,
    linkedScryfallIds: [],
    priceHistory: [],
  };
  if (!isNaN(cur) && cur > 0) item.priceHistory.push({ date: t, price: cur, source: 'import' });
  return item;
}

// ── Per-kind CSV import configuration ─────────────────────────────────────────
export const IMPORT_KINDS = {
  cards: {
    title: 'Card Collection',
    noun: 'cards',
    fileHint: 'Choose a CSV export from ManaBox, Moxfield, Archidekt, or this app. You’ll match the columns before importing.',
    fields: IMPORT_FIELD_DEFS,
    rowToItem: csvRowToCardWithMapping,
    perform: _performCardImport,
    reviewNote: 'Cards with a matching Scryfall ID + foil + binder are updated. All others are added as new.',
  },
  sealed: {
    title: 'Sealed Products',
    noun: 'products',
    fileHint: 'Choose a CSV export of sealed products — including this app’s own sealed export. You’ll match the columns before importing.',
    fields: SEALED_IMPORT_FIELDS,
    rowToItem: csvRowToSealed,
    perform: _performSealedImport,
    reviewNote: 'Products with a matching name, type, and set are updated. All others are added as new. Price-lookup links can be re-attached afterward from each product.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// WIZARD STATE + ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
// _wizard.view: 'choose' | 'csv' | 'deck'.  For 'csv', _wizard.step is 1..3.
export let _wizard = null;

export function showImportHub(kind = null) {
  const view = kind === 'decks' ? 'deck'
    : (kind === 'cards' || kind === 'sealed') ? 'csv'
    : 'choose';
  _wizard = {
    view,
    kind: view === 'csv' ? kind : null,
    step: 1,
    fileName: null, filePath: null,
    headers: [], rows: [], mapping: {},
    importMode: 'merge', reconcileConfirmed: false,
  };
  _renderHub();
}

function _renderHub() {
  if (_wizard.view === 'choose') return _showChooser();
  if (_wizard.view === 'deck')   return _showDeckStep();
  return _showWizardStep();
}

export function _wizardClose() {
  _wizard = null;
  document.querySelector('.modal')?.classList.remove('modal-wide', 'modal-xl');
  hideModal();
}

function _backToChooser() {
  _wizard.view = 'choose';
  _wizard.kind = null;
  _wizard.step = 1;
  _wizard.fileName = null; _wizard.filePath = null;
  _wizard.headers = []; _wizard.rows = []; _wizard.mapping = {};
  _wizard.importMode = 'merge'; _wizard.reconcileConfirmed = false;
  _renderHub();
}

// ─────────────────────────────────────────────────────────────────────────────
// LANDING SCREEN — pick what to import
// ─────────────────────────────────────────────────────────────────────────────
function _showChooser() {
  const pick = (kind, icon, title, desc) => `
    <button class="import-pick" data-pick="${kind}">
      <span class="import-pick-ico">${icon}</span>
      <span class="import-pick-body">
        <span class="import-pick-title">${title}</span>
        <span class="import-pick-desc">${desc}</span>
      </span>
      <span class="import-pick-arrow">→</span>
    </button>`;
  showModal(`
    <h2>Import</h2>
    <p class="wiz-meta">Bring data into your tracker — choose what you’d like to import.</p>
    <div class="import-pick-grid">
      ${pick('cards', '🃏', 'Card Collection', 'A CSV export from ManaBox, Moxfield, Archidekt, or this app. Map the columns, then import.')}
      ${pick('sealed', '📦', 'Sealed Products', 'A CSV of booster boxes, bundles, and Secret Lairs — including this app’s own sealed export.')}
      ${pick('decks', '🛡', 'Decks', 'Paste or load a decklist from Moxfield, Archidekt, ManaBox, or MTG Arena.')}
    </div>
    <div class="wiz-footer"><button class="btn" id="wiz-cancel">Cancel</button></div>
  `);
  document.getElementById('wiz-cancel').addEventListener('click', _wizardClose);
  document.querySelectorAll('.import-pick').forEach(b => b.addEventListener('click', () => {
    const choice = b.dataset.pick;
    if (choice === 'decks') {
      _wizard.view = 'deck';
    } else {
      _wizard.view = 'csv';
      _wizard.kind = choice;
      _wizard.step = 1;
      _wizard.fileName = null; _wizard.filePath = null;
      _wizard.headers = []; _wizard.rows = []; _wizard.mapping = {};
      _wizard.importMode = 'merge'; _wizard.reconcileConfirmed = false;
    }
    _renderHub();
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// DECK STEP — embeds the decklist form from deckIO inside the wizard chrome
// ─────────────────────────────────────────────────────────────────────────────
function _showDeckStep() {
  showModal(`
    <h2>Import Deck</h2>
    ${deckImportBodyHtml()}
    <div class="wiz-footer">
      ${_footerLeft()}
      <button class="btn btn-primary" id="di-import">Import Deck</button>
    </div>`, 'wide');
  document.getElementById('wiz-changetype')?.addEventListener('click', _backToChooser);
  wireDeckImportForm({ importBtnId: 'di-import', onComplete: _wizardClose });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV FLOW — File → Map Columns → Review (shared by cards + sealed)
// ─────────────────────────────────────────────────────────────────────────────
function _stepBar(active) {
  const labels = ['File', 'Map Columns', 'Review'];
  return `<div class="wiz-steps">${labels.map((s, i) => {
    const n = i + 1;
    const cls = n === active ? 'wiz-step active' : n < active ? 'wiz-step done' : 'wiz-step';
    return `<span class="${cls}">${n < active ? '✓ ' : ''}${n}. ${s}</span>${i < labels.length - 1 ? '<span class="wiz-sep">›</span>' : ''}`;
  }).join('')}</div>`;
}

function _footerLeft() {
  return `<button class="btn btn-ghost" id="wiz-changetype">← Change type</button><span style="flex:1"></span>`;
}

async function _pickCsvFile() {
  const result = await window.api.dialog.openCsv();
  if (!result) return;
  const headers = parseCsvHeaders(result.text);
  if (!headers.length) { toast('CSV has no headers — check the file format', 'error'); return; }
  const rows = parseCsv(result.text);
  if (!rows.length) { toast('CSV appears empty', 'error'); return; }
  _wizard.filePath = result.path;
  _wizard.fileName = (result.path || '').split(/[/\\]/).pop() || 'import.csv';
  _wizard.headers = headers;
  _wizard.rows = rows;
  _wizard.mapping = autoDetectMapping(headers, IMPORT_KINDS[_wizard.kind].fields);
  _wizard.step = 1;
  _showWizardStep();
}

function renderCsvStep1() {
  const { kind, fileName, headers, rows } = _wizard;
  const cfg = IMPORT_KINDS[kind];
  if (!rows.length) {
    return `
      ${_stepBar(1)}
      <h2>Import ${cfg.title}</h2>
      <p class="wiz-meta">${cfg.fileHint}</p>
      <div class="import-drop" id="wiz-pickfile">
        <div class="import-drop-ico">📄</div>
        <div class="import-drop-title">Choose a CSV file…</div>
        <div class="import-drop-sub">Click to browse for a .csv file to import</div>
      </div>
      <div class="wiz-footer">
        ${_footerLeft()}
        <button class="btn btn-primary" id="wiz-pickfile-btn">📄 Choose File…</button>
      </div>`;
  }
  const previewRows = rows.slice(0, 10);
  const maxCols = Math.min(headers.length, 7);
  const vis = headers.slice(0, maxCols);
  const extra = headers.length - maxCols;
  return `
    ${_stepBar(1)}
    <h2>Import ${cfg.title}</h2>
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
      ${_footerLeft()}
      <button class="btn" id="wiz-pickfile-btn">Choose a different file…</button>
      <button class="btn btn-primary" id="wiz-next">Map Columns →</button>
    </div>`;
}

function renderCsvStep2() {
  const { kind, headers, mapping } = _wizard;
  const fields = IMPORT_KINDS[kind].fields;
  const sel = key => {
    const cur = mapping[key] || '';
    return `<select id="wmap-${esc(key)}" class="wiz-sel">
      <option value=""${!cur ? ' selected' : ''}>— not mapped —</option>
      ${headers.map(h => `<option value="${esc(h)}"${cur === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}
    </select>`;
  };
  const req = fields.filter(d => d.required);
  const opt = fields.filter(d => !d.required);
  return `
    ${_stepBar(2)}
    <h2>Map Columns</h2>
    <p class="wiz-meta">Match your CSV columns to app fields. <span style="color:var(--accent)">★</span> fields are required.</p>
    <div class="wiz-body">
      ${req.length ? `<div class="wiz-section-label">Required</div>
      <div class="wiz-map-grid">
        ${req.map(d => `<div class="wiz-map-row">
          <label class="wiz-map-lbl"><span class="wiz-req">★</span>${esc(d.label)}</label>
          ${sel(d.key)}
        </div>`).join('')}
      </div>` : ''}
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

function renderCsvStep3() {
  const { kind, rows, mapping } = _wizard;
  const cfg = IMPORT_KINDS[kind];
  const nameCol = mapping['name'];
  const importable = nameCol ? rows.filter(r => (r[nameCol] || '').trim()).length : 0;
  const incoming = kind === 'cards'
    ? rows.map(r => csvRowToCardWithMapping(r, mapping)).filter(Boolean)
    : [];
  const canReconcile = kind === 'cards' && !!mapping.manaboxId && incoming.length > 0 && incoming.every(c => c.manaboxId);
  if (!canReconcile && _wizard.importMode === 'reconcile') _wizard.importMode = 'merge';
  const plan = kind === 'cards'
    ? planCardImport(collection.cards, incoming, _wizard.importMode)
    : null;
  const needsReconcileConfirmation = _wizard.importMode === 'reconcile' && (plan?.stats.removed || 0) > 0;
  const req = cfg.fields.filter(d => d.required);
  const mappedOpt = cfg.fields.filter(d => !d.required && mapping[d.key]).length;
  const lines = [];
  for (const d of req) {
    if (mapping[d.key]) lines.push({ ok: true,  text: `${d.label} → "${mapping[d.key]}"` });
    else                lines.push({ ok: false, text: `${d.label} not mapped` });
  }
  lines.push({ ok: true, text: `${mappedOpt} optional field${mappedOpt !== 1 ? 's' : ''} mapped` });
  if (importable === 0) lines.push({ ok: false, text: 'No importable rows found — check your name column mapping' });
  const modePicker = kind === 'cards' ? `
    <div class="wiz-section-label" style="margin-top:14px">Repeat-import behavior</div>
    <div class="wiz-summary" style="margin-top:6px">
      <label class="wiz-sum-row" style="cursor:pointer">
        <input type="radio" name="wiz-import-mode" value="merge"${_wizard.importMode !== 'reconcile' ? ' checked' : ''}>
        <span><strong>Merge</strong> — add new rows and update matches; keep everything else.</span>
      </label>
      <label class="wiz-sum-row${canReconcile ? '' : ' wiz-warn'}" style="cursor:${canReconcile ? 'pointer' : 'not-allowed'}">
        <input type="radio" name="wiz-import-mode" value="reconcile"${_wizard.importMode === 'reconcile' ? ' checked' : ''}${canReconcile ? '' : ' disabled'}>
        <span><strong>Reconcile ManaBox</strong> — make live ManaBox-managed cards match this export. Manual cards and sold history are preserved.${canReconcile ? '' : ' Map a complete ManaBox ID column to enable this.'}</span>
      </label>
    </div>
    ${_wizard.importMode === 'reconcile' ? `
      <div class="wiz-summary" style="margin-top:8px">
        <div class="wiz-sum-row wiz-ok">${plan.stats.added} add · ${plan.stats.updated} update · ${plan.stats.removed} remove</div>
        ${needsReconcileConfirmation ? `<label class="wiz-sum-row wiz-warn" style="cursor:pointer">
          <input type="checkbox" id="wiz-reconcile-confirm"${_wizard.reconcileConfirmed ? ' checked' : ''}>
          <span>I understand ${plan.stats.removed} ManaBox-managed row${plan.stats.removed === 1 ? '' : 's'} absent from this file will be removed.</span>
        </label>` : ''}
      </div>` : ''}` : '';
  const importDisabled = importable === 0 || (needsReconcileConfirmation && !_wizard.reconcileConfirmed);
  const importLabel = _wizard.importMode === 'reconcile'
    ? `Reconcile ${importable.toLocaleString()} ${cfg.noun}`
    : `Import ${importable.toLocaleString()} ${cfg.noun}`;
  return `
    ${_stepBar(3)}
    <h2>Review & Import</h2>
    <div class="wiz-summary">
      <div class="wiz-sum-row wiz-ok">✓ ${importable.toLocaleString()} ${cfg.noun} ready to import</div>
      ${lines.map(l => `<div class="wiz-sum-row ${l.ok ? 'wiz-ok' : 'wiz-warn'}">${l.ok ? '✓' : '⚠'} ${esc(l.text)}</div>`).join('')}
    </div>
    <p class="wiz-meta" style="margin-top:12px">${cfg.reviewNote}</p>
    ${modePicker}
    <div class="wiz-footer">
      <button class="btn" id="wiz-back">← Back</button>
      <button class="btn btn-primary" id="wiz-import"${importDisabled ? ' disabled' : ''}>
        ${importLabel}
      </button>
    </div>`;
}

function _wizardReadMapping() {
  const m = {};
  for (const d of IMPORT_KINDS[_wizard.kind].fields) {
    const el = document.getElementById(`wmap-${d.key}`);
    if (el) m[d.key] = el.value;
  }
  return m;
}

function _attachCsvListeners() {
  const step = _wizard.step;
  document.getElementById('wiz-changetype')?.addEventListener('click', _backToChooser);
  document.getElementById('wiz-pickfile')?.addEventListener('click', _pickCsvFile);
  document.getElementById('wiz-pickfile-btn')?.addEventListener('click', _pickCsvFile);
  document.getElementById('wiz-back')?.addEventListener('click', () => {
    if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 1; }
    else if (step === 3) { _wizard.step = 2; }
    _showWizardStep();
  });
  document.getElementById('wiz-next')?.addEventListener('click', () => {
    if (step === 1) { _wizard.step = 2; }
    else if (step === 2) { _wizard.mapping = _wizardReadMapping(); _wizard.step = 3; }
    _showWizardStep();
  });
  document.getElementById('wiz-import')?.addEventListener('click', () => IMPORT_KINDS[_wizard.kind].perform());
  document.querySelectorAll('input[name="wiz-import-mode"]').forEach(el => el.addEventListener('change', () => {
    _wizard.importMode = el.value;
    _wizard.reconcileConfirmed = false;
    _showWizardStep();
  }));
  document.getElementById('wiz-reconcile-confirm')?.addEventListener('change', e => {
    _wizard.reconcileConfirmed = e.target.checked;
    _showWizardStep();
  });
}

function _showWizardStep() {
  const html = _wizard.step === 1 ? renderCsvStep1()
    : _wizard.step === 2 ? renderCsvStep2()
    : renderCsvStep3();
  showModal(html, 'wide');
  _attachCsvListeners();
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT EXECUTION
// ─────────────────────────────────────────────────────────────────────────────
async function _performCardImport() {
  const { rows, mapping } = _wizard;
  const incoming = rows.map(r => csvRowToCardWithMapping(r, mapping)).filter(Boolean);
  const skipped = rows.length - incoming.length;
  const mode = _wizard.importMode === 'reconcile' ? 'reconcile' : 'merge';
  if (mode === 'reconcile' && (!mapping.manaboxId || incoming.some(c => !c.manaboxId))) {
    toast('Reconcile requires a ManaBox ID on every importable row.', 'error');
    return;
  }
  const plan = planCardImport(collection.cards, incoming, mode);
  if (mode === 'reconcile' && plan.stats.removed > 0 && !_wizard.reconcileConfirmed) {
    toast('Confirm the removals before reconciling.', 'error');
    return;
  }
  if (mode === 'reconcile') {
    try {
      await window.api.cards.replaceManaged(plan.managedCards);
    } catch (err) {
      window.logger?.error('Import', `ManaBox reconciliation failed: ${err.message}`);
      toast(`Reconciliation failed: ${err.message}`, 'error');
      return;
    }
  }
  collection.cards = plan.nextCards;
  _wizardClose();
  const action = mode === 'reconcile' ? 'Reconciled' : 'Imported';
  toast(`${action} — ${plan.stats.added} added, ${plan.stats.updated} updated${plan.stats.removed ? `, ${plan.stats.removed} removed` : ''}${skipped ? `, ${skipped} skipped` : ''}`, 'success');
  window.logger?.success('Import', `Cards: ${plan.stats.added} new + ${plan.stats.updated} updated${plan.stats.removed ? ` - ${plan.stats.removed} removed` : ''}${skipped ? ` + ${skipped} skipped` : ''}`);
  render();
  await autoSave();
}

function _performSealedImport() {
  const { rows, mapping } = _wizard;
  const incoming = rows.map(r => csvRowToSealed(r, mapping)).filter(Boolean);
  let added = 0, updated = 0;
  for (const item of incoming) {
    // Match a live (non-sold) product with the same name, type, and set; sold
    // records carry sale details the export doesn't, so we never overwrite them.
    const idx = collection.sealed.findIndex(s =>
      s.status !== 'sold' &&
      s.name.toLowerCase() === item.name.toLowerCase() &&
      (s.productType || '') === item.productType &&
      (s.setCode || '') === item.setCode);
    if (idx >= 0) {
      const existing = collection.sealed[idx];
      const priceHistory = (existing.priceHistory || []).slice();
      for (const h of item.priceHistory) {
        const ti = priceHistory.findIndex(x => x.date === h.date);
        if (ti >= 0) priceHistory[ti] = h; else priceHistory.push(h);
      }
      collection.sealed[idx] = {
        ...existing, ...item,
        id: existing.id,
        pricechartingId: existing.pricechartingId ?? null,
        linkedScryfallIds: existing.linkedScryfallIds || [],
        priceHistory,
      };
      updated++;
    } else {
      collection.sealed.push(item);
      added++;
    }
  }
  _wizardClose();
  toast(`Imported — ${added} added, ${updated} updated`, 'success');
  window.logger?.success('Import', `Sealed: ${added} new + ${updated} updated`);
  render();
  autoSave();
}
