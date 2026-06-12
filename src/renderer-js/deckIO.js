import { SCRYFALL_COLLECTION } from './constants.js';
import { parseCsv, parseCsvLine } from './csv.js';
import { DECK_BOARDS, DECK_FORMATS, DECK_FORMAT_ORDER, addCardToDeck, captureScryfallCard, createDeck, deckById } from './decks.js';
import { _normHdr } from './importWizard.js';
import { copyToClipboard, hideModal, showModal } from './modals.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, netFetch, sleep, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// DECK IMPORT — Moxfield / Archidekt / ManaBox / MTGA text and CSV exports
// ─────────────────────────────────────────────────────────────────────────────

// Section headers seen in the wild across Moxfield, Archidekt, ManaBox, MTGA.
export const DECK_SECTION_HEADERS = {
  commander: 'commander', commanders: 'commander', 'commander(s)': 'commander', oathbreaker: 'commander', 'signature spell': 'commander',
  deck: 'main', main: 'main', mainboard: 'main', maindeck: 'main', 'main deck': 'main',
  sideboard: 'side', side: 'side',
  maybeboard: 'maybe', maybe: 'maybe', considering: 'maybe', wishlist: 'maybe',
  companion: 'side', tokens: 'skip', token: 'skip', about: 'about',
};

// Parse one decklist card line. Handles:
//   "1 Sol Ring"                          plain
//   "4x Lightning Bolt"                   x suffix
//   "1 Sol Ring (C21) 263"                ManaBox / Moxfield / MTGA set+number
//   "1 Sol Ring (C21) 263 *F*"            Moxfield foil marker (*E* = etched)
//   "1x Sol Ring (c21) 263 [Ramp]"        Archidekt category tags
export function parseDeckLine(line) {
  const m = line.match(/^(\d+)\s*[xX]?\s+(.+)$/);
  let qty, rest;
  if (m) { qty = parseInt(m[1]); rest = m[2]; }
  else { qty = 1; rest = line; }  // bare card name → 1 copy

  let foil = 'normal';
  if (/\*E\*/i.test(rest)) foil = 'etched';
  else if (/\*F\*|\(foil\)/i.test(rest)) foil = 'foil';
  rest = rest.replace(/\*[FE]\*/gi, '').replace(/\(foil\)/gi, '');
  rest = rest.replace(/\s*\[[^\]]*\]\s*/g, ' ');           // archidekt [Category]
  rest = rest.replace(/\s*\^[^^]*\^\s*/g, ' ');            // archidekt ^colors^

  let setCode = '', collectorNumber = '';
  const setM = rest.match(/\s+\(([A-Za-z0-9]{2,6})\)(?:\s+([\w\-★†]+))?\s*$/);
  if (setM) {
    setCode = setM[1].toLowerCase();
    collectorNumber = setM[2] || '';
    rest = rest.slice(0, setM.index);
  }
  const name = rest.trim();
  if (!name || !qty) return null;
  return { quantity: qty, name, setCode, collectorNumber, foil, board: null };
}

export function parseDeckText(text) {
  const entries = [];
  let board = 'main';
  let suggestedName = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('#')) continue;

    // Section header? (bare word or "Word:" with no leading quantity)
    const headerKey = line.replace(/:$/, '').toLowerCase();
    if (DECK_SECTION_HEADERS[headerKey] !== undefined) {
      board = DECK_SECTION_HEADERS[headerKey];
      continue;
    }
    if (board === 'about') {
      // MTGA "About" section: "Name My Cool Deck"
      if (/^name\s+/i.test(line)) suggestedName = line.replace(/^name\s+/i, '').trim();
      continue;
    }
    if (board === 'skip') continue;

    const entry = parseDeckLine(line);
    if (entry) { entry.board = board; entries.push(entry); }
  }
  return { entries, suggestedName };
}

// CSV deck import — header alias detection covers Moxfield, Archidekt, and
// ManaBox CSV exports without a mapping wizard.
export const DECK_CSV_ALIASES = {
  quantity:        ['count', 'quantity', 'qty', 'amount', 'copies'],
  name:            ['name', 'card name', 'card'],
  setCode:         ['edition code', 'set code', 'setcode', 'set', 'code', 'edition'],
  setName:         ['edition name', 'set name', 'setname'],
  collectorNumber: ['collector number', 'collector_number', 'card number', 'number'],
  foil:            ['foil', 'finish', 'printing'],
  board:           ['board', 'section', 'category', 'zone', 'location'],
  scryfallId:      ['scryfall id', 'scryfall_id', 'scryfallid'],
};

export function parseDeckCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return { entries: [], suggestedName: null };
  const headers = Object.keys(rows[0]);
  const mapping = {};
  for (const [field, aliases] of Object.entries(DECK_CSV_ALIASES)) {
    const hit = headers.find(h => aliases.includes(_normHdr(h)));
    if (hit) mapping[field] = hit;
  }
  if (!mapping.name) return { entries: [], suggestedName: null };

  const entries = [];
  for (const row of rows) {
    const name = (row[mapping.name] || '').trim();
    if (!name) continue;
    const rawBoard = (mapping.board ? row[mapping.board] : '').toLowerCase();
    const board = /command/.test(rawBoard) ? 'commander'
      : /side/.test(rawBoard) ? 'side'
      : /maybe|consider/.test(rawBoard) ? 'maybe' : 'main';
    const rawFoil = (mapping.foil ? row[mapping.foil] : '').toLowerCase();
    const foil = /etched/.test(rawFoil) ? 'etched' : /foil|^true$|^yes$/.test(rawFoil) ? 'foil' : 'normal';
    entries.push({
      quantity: Math.max(1, parseInt(mapping.quantity ? row[mapping.quantity] : '1') || 1),
      name,
      setCode: (mapping.setCode ? row[mapping.setCode] : '').toLowerCase().trim(),
      setName: mapping.setName ? row[mapping.setName] : '',
      collectorNumber: mapping.collectorNumber ? row[mapping.collectorNumber] : '',
      scryfallId: (mapping.scryfallId ? row[mapping.scryfallId] : '').toLowerCase().trim(),
      foil, board,
    });
  }
  return { entries, suggestedName: null };
}

export function parseDeckList(text) {
  // CSV if the first non-empty line has commas and looks like a known header
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  if (firstLine.includes(',')) {
    const hdrs = parseCsvLine(firstLine).map(h => _normHdr(h));
    const knownAliases = Object.values(DECK_CSV_ALIASES).flat();
    if (hdrs.filter(h => knownAliases.includes(h)).length >= 2) return parseDeckCsv(text);
  }
  return parseDeckText(text);
}

// Resolve parsed entries: link to owned collection cards first, then fetch
// unowned cards from Scryfall (batched), so every entry gets a scryfallId,
// image, metadata, and price where possible.
export async function resolveDeckEntries(entries) {
  // Index the collection by name for owned-card linking
  const byName = new Map();
  for (const c of collection.cards) {
    const n = c.name.toLowerCase();
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(c);
  }

  let linked = 0;
  const unresolved = [];
  for (const e of entries) {
    if (e.scryfallId) { linked++; continue; }  // CSV gave us the exact printing
    const candidates = byName.get(e.name.toLowerCase()) || [];
    const match = candidates.find(c => e.setCode && c.setCode?.toLowerCase() === e.setCode &&
                                       e.collectorNumber && c.collectorNumber === e.collectorNumber)
               || candidates.find(c => e.setCode && c.setCode?.toLowerCase() === e.setCode)
               || candidates[0];
    if (match && match.scryfallId) {
      e.scryfallId = match.scryfallId;
      e.cardId = match.id;
      e.setCode = e.setCode || match.setCode;
      e.setName = e.setName || match.setName;
      e.collectorNumber = e.collectorNumber || match.collectorNumber;
      linked++;
    } else {
      unresolved.push(e);
    }
  }

  // Batch-fetch the rest from Scryfall /cards/collection (75 identifiers max)
  let fetched = 0;
  for (let i = 0; i < unresolved.length; i += 75) {
    const chunk = unresolved.slice(i, i + 75);
    const identifiers = chunk.map(e =>
      e.setCode && e.collectorNumber
        ? { set: e.setCode, collector_number: e.collectorNumber }
        : { name: e.name });
    try {
      const resp = await netFetch(SCRYFALL_COLLECTION, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const cardsByName = new Map();
      const cardsBySetCn = new Map();
      for (const card of data.data || []) {
        captureScryfallCard(card);
        const frontName = (card.name || '').split('//')[0].trim().toLowerCase();
        cardsByName.set((card.name || '').toLowerCase(), card);
        if (!cardsByName.has(frontName)) cardsByName.set(frontName, card);
        cardsBySetCn.set(`${card.set}|${card.collector_number}`, card);
      }
      for (const e of chunk) {
        const card = (e.setCode && e.collectorNumber && cardsBySetCn.get(`${e.setCode}|${e.collectorNumber}`))
                  || cardsByName.get(e.name.toLowerCase());
        if (!card) continue;
        e.scryfallId = (card.id || '').toLowerCase();
        e.name = card.name.includes('//') && !e.name.includes('//') ? card.name : e.name;
        e.setCode = e.setCode || card.set || '';
        e.setName = e.setName || card.set_name || '';
        e.collectorNumber = e.collectorNumber || card.collector_number || '';
        fetched++;
      }
    } catch (err) {
      window.logger?.warn('Deck', `Scryfall lookup failed for a batch of ${chunk.length}: ${err.message}`);
    }
    if (i + 75 < unresolved.length) await sleep(150);
  }

  const missing = entries.filter(e => !e.scryfallId).length;
  return { linked, fetched, missing };
}

export function showDeckImportModal() {
  showModal(`
    <h2>Import Deck</h2>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;line-height:1.5">
      Paste a decklist from <strong>Moxfield</strong>, <strong>Archidekt</strong>, <strong>ManaBox</strong>, or MTG Arena —
      or load a .txt / .csv export. Cards you own are linked to your collection;
      cards you don't own are added as <em>unowned</em> deck cards (they never affect your collection value).
    </div>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div class="form-group" style="flex:1;margin:0"><label>Deck name</label><input type="text" id="di-name" placeholder="Imported deck name"></div>
      <div class="form-group" style="margin:0"><label>Format</label>
        <select id="di-format">
          ${DECK_FORMAT_ORDER.map(k => `<option value="${k}">${DECK_FORMATS[k].label}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-group">
      <label style="display:flex;justify-content:space-between;align-items:center">Decklist
        <button class="btn btn-sm" id="di-file">📄 Load from file…</button>
      </label>
      <textarea id="di-text" rows="12" placeholder="1 Sol Ring (C21) 263&#10;1 Arcane Signet&#10;4 Lightning Bolt&#10;&#10;SIDEBOARD:&#10;2 Abrade" style="width:100%;font-family:monospace;font-size:12px;resize:vertical"></textarea>
      <div id="di-preview" style="font-size:11.5px;color:var(--text-muted);margin-top:6px"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn" id="di-cancel">Cancel</button>
      <button class="btn btn-primary" id="di-import">Import Deck</button>
    </div>`, 'wide');

  const textEl = document.getElementById('di-text');
  const nameEl = document.getElementById('di-name');
  const preview = document.getElementById('di-preview');

  const updatePreview = () => {
    const txt = textEl.value;
    if (!txt.trim()) { preview.textContent = ''; return; }
    const { entries, suggestedName } = parseDeckList(txt);
    if (suggestedName && !nameEl.value) nameEl.value = suggestedName;
    const total = entries.reduce((s, e) => s + e.quantity, 0);
    const boards = {};
    for (const e of entries) boards[e.board || 'main'] = (boards[e.board || 'main'] || 0) + e.quantity;
    preview.textContent = entries.length
      ? `Parsed ${entries.length} lines · ${total} cards (${Object.entries(boards).map(([b, n]) => `${DECK_BOARDS[b] || b}: ${n}`).join(' · ')})`
      : 'No card lines recognized yet…';
  };
  let debounce = null;
  textEl.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(updatePreview, 250); });

  document.getElementById('di-file').addEventListener('click', async () => {
    const result = await window.api.dialog.openDeck();
    if (!result) return;
    textEl.value = result.text;
    if (!nameEl.value && result.path) {
      nameEl.value = result.path.split(/[\\/]/).pop().replace(/\.(txt|csv|dec|dek)$/i, '');
    }
    updatePreview();
  });

  document.getElementById('di-cancel').addEventListener('click', hideModal);
  document.getElementById('di-import').addEventListener('click', async () => {
    const { entries, suggestedName } = parseDeckList(textEl.value);
    if (!entries.length) { toast('No cards recognized — check the list format', 'error'); return; }
    const name = nameEl.value.trim() || suggestedName || 'Imported Deck';
    const format = document.getElementById('di-format').value;

    const btn = document.getElementById('di-import');
    btn.disabled = true;
    btn.textContent = 'Resolving cards…';
    window.logger?.info('Deck', `Importing “${name}”: ${entries.length} entries…`);

    const { linked, fetched, missing } = await resolveDeckEntries(entries);

    const deck = createDeck(name, format);
    for (const e of entries) {
      addCardToDeck(deck, e, e.board || 'main', e.quantity);
    }
    ui.decks.deckId = deck.id;
    ui.activeTab = 'decks';
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'decks'));
    hideModal(); render(); autoSave();

    const bits = [`${entries.reduce((s, e) => s + e.quantity, 0)} cards`, `${linked} matched to your collection`, `${fetched} fetched from Scryfall`];
    if (missing) bits.push(`${missing} unresolved (name-only)`);
    toast(`Imported “${name}” — ${bits.join(' · ')}`, missing ? 'warning' : 'success', 6000);
    window.logger?.success('Deck', `Imported “${name}”: ${bits.join(' · ')}`);
  });

  nameEl.focus();
}

// ─────────────────────────────────────────────────────────────────────────────
// DECK EXPORT — text (Moxfield / ManaBox / MTGA compatible) and CSV
// ─────────────────────────────────────────────────────────────────────────────
export function deckToText(deck) {
  const line = dc => `${dc.quantity || 1} ${dc.name}` +
    (dc.setCode ? ` (${dc.setCode.toUpperCase()})${dc.collectorNumber ? ' ' + dc.collectorNumber : ''}` : '') +
    (dc.foil === 'foil' ? ' *F*' : dc.foil === 'etched' ? ' *E*' : '');
  const section = (label, board) => {
    const cards = (deck.cards || []).filter(c => (c.board || 'main') === board);
    if (!cards.length) return '';
    return `${label}\n${cards.map(line).join('\n')}\n`;
  };
  return [
    section('Commander', 'commander'),
    section('Deck', 'main'),
    section('Sideboard', 'side'),
    section('Maybeboard', 'maybe'),
  ].filter(Boolean).join('\n').trim() + '\n';
}

export function deckToCsv(deck) {
  const headers = ['Count', 'Name', 'Edition', 'Collector Number', 'Foil', 'Board', 'Scryfall ID'];
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = (deck.cards || []).map(dc => [
    dc.quantity || 1, dc.name, (dc.setCode || '').toLowerCase(), dc.collectorNumber || '',
    dc.foil === 'normal' ? '' : dc.foil, DECK_BOARDS[dc.board] || 'Mainboard', dc.scryfallId || '',
  ].map(csvCell).join(','));
  return [headers.join(','), ...rows].join('\n') + '\n';
}

export function showDeckExportModal(deckId) {
  const deck = deckById(deckId);
  if (!deck) return;
  const safeName = deck.name.replace(/[^\w\- ]+/g, '').trim() || 'deck';
  showModal(`
    <h2>Export — ${esc(deck.name)}</h2>
    <div style="font-size:12px;color:var(--text-dim);margin-bottom:16px;line-height:1.5">
      <strong>Text</strong> pastes directly into Moxfield, Archidekt, ManaBox, and MTG Arena imports.<br>
      <strong>CSV</strong> includes set codes, collector numbers, and Scryfall IDs.
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-primary" id="dx-copy">📋 Copy decklist to clipboard</button>
      <button class="btn" id="dx-txt">⤓ Save as text file (.txt)</button>
      <button class="btn" id="dx-csv">⤓ Save as CSV (.csv)</button>
    </div>`);
  document.getElementById('dx-copy').addEventListener('click', () => {
    copyToClipboard(deckToText(deck), 'Decklist');
    hideModal();
  });
  document.getElementById('dx-txt').addEventListener('click', async () => {
    const p = await window.api.dialog.saveFile({
      title: 'Export deck as text', defaultPath: `${safeName}.txt`,
      filterName: 'Text files', extensions: ['txt'], content: deckToText(deck),
    });
    if (p) { toast(`Deck exported to ${p}`, 'success'); hideModal(); }
  });
  document.getElementById('dx-csv').addEventListener('click', async () => {
    const p = await window.api.dialog.saveFile({
      title: 'Export deck as CSV', defaultPath: `${safeName}.csv`,
      filterName: 'CSV files', extensions: ['csv'], content: deckToCsv(deck),
    });
    if (p) { toast(`Deck exported to ${p}`, 'success'); hideModal(); }
  });
}

