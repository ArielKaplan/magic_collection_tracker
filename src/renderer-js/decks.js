import { TYPE_ORDER, cardMeta, parseMainType } from './analytics.js';
import { FOIL_LABEL } from './constants.js';
import { showDeckExportModal } from './deckIO.js';
import { showGalleryModal } from './gallery.js';
import { copyToClipboard, hideModal, openCardOnScryfall, promptText, showContextMenu, showModal } from './modals.js';
import { getCurrentPrice, storePriceSnapshot } from './prices.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, netFetch, toast, uid } from './utils.js';
import { addToWantList } from './wantlist.js';


// ─────────────────────────────────────────────────────────────────────────────
// DECKS — played lists, distinct from binders (the owned collection).
// A deck entry can link to an owned collection card (cardId) or be an unowned
// placeholder resolved via Scryfall. Deck contents NEVER count toward
// collection value — that stays binder-only. Deck value is informational.
// ─────────────────────────────────────────────────────────────────────────────

// Format rules sourced from the MTG Comprehensive Rules / format pages:
// Commander 100-card singleton w/ color identity, constructed formats 60+ with
// 4-copy limit and 15-card sideboard, Brawl/Oathbreaker 60-card singleton.
export const DECK_FORMATS = {
  commander:   { label: 'Commander',  minSize: 100, maxSize: 100, copyLimit: 1, sideboard: 0,  commanders: { min: 1, max: 2 }, colorIdentity: true,
    rules: 'Exactly 100 cards including commander(s) · singleton (1 copy max, except basic lands) · all cards must match the commander’s color identity · no sideboard' },
  brawl:       { label: 'Brawl',      minSize: 60,  maxSize: 60,  copyLimit: 1, sideboard: 0,  commanders: { min: 1, max: 1 }, colorIdentity: true,
    rules: '60 cards including the commander · singleton · Standard-legal cards only · color identity applies' },
  oathbreaker: { label: 'Oathbreaker', minSize: 60, maxSize: 60,  copyLimit: 1, sideboard: 0,  commanders: { min: 1, max: 2 }, colorIdentity: true,
    rules: 'Exactly 60 cards including oathbreaker + signature spell · singleton · color identity applies' },
  standard:    { label: 'Standard',   minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies of any card (basic lands exempt) across deck + sideboard · sideboard up to 15 · only recent Standard-legal sets' },
  pioneer:     { label: 'Pioneer',    minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies (basic lands exempt) · sideboard up to 15 · sets from Return to Ravnica forward' },
  modern:      { label: 'Modern',     minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies (basic lands exempt) · sideboard up to 15 · sets from 8th Edition forward' },
  legacy:      { label: 'Legacy',     minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies (basic lands exempt) · sideboard up to 15 · all sets legal (banned list applies)' },
  vintage:     { label: 'Vintage',    minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies (basic lands exempt; some cards restricted to 1) · sideboard up to 15 · all sets legal' },
  pauper:      { label: 'Pauper',     minSize: 60,  maxSize: null, copyLimit: 4, sideboard: 15, commanders: null, colorIdentity: false,
    rules: 'Minimum 60 cards · max 4 copies (basic lands exempt) · sideboard up to 15 · commons only' },
  other:       { label: 'Casual / Other', minSize: null, maxSize: null, copyLimit: null, sideboard: null, commanders: null, colorIdentity: false,
    rules: 'No deck-building restrictions enforced' },
};
export const DECK_FORMAT_ORDER = ['commander', 'standard', 'modern', 'pioneer', 'legacy', 'vintage', 'pauper', 'brawl', 'oathbreaker', 'other'];
export const DECK_BOARDS = { commander: 'Commander', main: 'Mainboard', side: 'Sideboard', maybe: 'Maybeboard' };

export const BASIC_LAND_NAMES = new Set([
  'plains', 'island', 'swamp', 'mountain', 'forest', 'wastes',
  'snow-covered plains', 'snow-covered island', 'snow-covered swamp',
  'snow-covered mountain', 'snow-covered forest', 'snow-covered wastes',
]);

export function deckById(id) { return (collection.decks || []).find(d => d.id === id); }
export function deckFormat(deck) { return DECK_FORMATS[deck.format] || DECK_FORMATS.other; }

export function sidImageUrl(sid, size = 'normal') {
  const id = (sid || '').toLowerCase();
  return id ? `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg` : '';
}

// Copy-limit exemption: basic lands, or oracle text that says "any number"
// (Relentless Rats, Persistent Petitioners, etc.)
export function deckCopyExempt(dc) {
  if (BASIC_LAND_NAMES.has((dc.name || '').toLowerCase())) return true;
  const m = dc.scryfallId ? cardMeta(dc.scryfallId) : null;
  return !!(m?.oracle_text && /any number of cards named/i.test(m.oracle_text));
}

// Ownership maps: how many copies of each card (by name, and by exact printing)
// exist in the binder collection. Name-level match counts any printing you own.
export function deckOwnedMaps() {
  const bySid = new Map(), byName = new Map();
  for (const c of collection.cards) {
    if (c.status === 'sold') continue;   // sold cards aren't owned for deck purposes
    if (c.scryfallId) bySid.set(c.scryfallId, (bySid.get(c.scryfallId) || 0) + c.quantity);
    const n = (c.name || '').toLowerCase();
    if (n) byName.set(n, (byName.get(n) || 0) + c.quantity);
  }
  return { bySid, byName };
}

export function deckCardOwnedQty(dc, maps) {
  const byName = maps.byName.get((dc.name || '').toLowerCase()) || 0;
  const bySid  = dc.scryfallId ? (maps.bySid.get(dc.scryfallId) || 0) : 0;
  return Math.max(byName, bySid);
}

export function deckCardPrice(dc) {
  if (!dc.scryfallId) return null;
  return getCurrentPrice(dc.scryfallId, dc.foil || 'normal')
      ?? (dc.foil !== 'normal' ? getCurrentPrice(dc.scryfallId, 'normal') : null);
}

// Deck stats — value is informational and intentionally separate from
// collection value (no double counting: owned copies are valued in binders,
// unowned copies aren't owned at all).
export function deckStats(deck, maps = deckOwnedMaps()) {
  let total = 0, value = 0, ownedValue = 0, missingValue = 0, ownedCount = 0;
  for (const dc of deck.cards || []) {
    const qty = dc.quantity || 1;
    total += qty;
    const owned = Math.min(qty, deckCardOwnedQty(dc, maps));
    ownedCount += owned;
    const p = deckCardPrice(dc);
    if (p != null) {
      value        += p * qty;
      ownedValue   += p * owned;
      missingValue += p * (qty - owned);
    }
  }
  return { total, value, ownedValue, missingValue, ownedCount, missingCount: total - ownedCount };
}

// Cards you still need: deck entries where owned < needed. `qty` is the shortfall.
// Powers the "buy / want / copy missing" actions on the deck page.
export function deckMissingCards(deck, maps = deckOwnedMaps()) {
  const out = [];
  for (const dc of deck.cards || []) {
    const need  = dc.quantity || 1;
    const owned = Math.min(need, deckCardOwnedQty(dc, maps));
    const short = need - owned;
    if (short > 0) out.push({ ...dc, qty: short });
  }
  return out;
}

// Open the missing cards on TCGPlayer's Mass Entry (drops them into the cart /
// optimizer). Format: "qty name" lines joined by "||".
export function buyDeckMissingOnTcg(deckId) {
  const deck = deckById(deckId); if (!deck) return;
  const missing = deckMissingCards(deck);
  if (!missing.length) { toast('You already own every card in this deck 🎉', 'info'); return; }
  const c = missing.map(m => `${m.qty} ${m.name}`).join('||');
  const url = `https://www.tcgplayer.com/massentry?productline=Magic&c=${encodeURIComponent(c)}`;
  window.api.app.openExternal(url);
  toast(`Opening ${missing.length} missing card${missing.length !== 1 ? 's' : ''} on TCGPlayer…`, 'info');
}

export function addDeckMissingToWantList(deckId) {
  const deck = deckById(deckId); if (!deck) return;
  const missing = deckMissingCards(deck);
  let added = 0;
  for (const m of missing) {
    if (addToWantList({ scryfallId: m.scryfallId, name: m.name, setCode: m.setCode, setName: m.setName,
      collectorNumber: m.collectorNumber, foil: m.foil || 'normal' }, { silent: true })) added++;
  }
  render(); autoSave();
  toast(added ? `★ Added ${added} card${added !== 1 ? 's' : ''} to your want list`
              : 'Those cards are already on your want list', added ? 'success' : 'info');
}

export function copyDeckMissing(deckId) {
  const deck = deckById(deckId); if (!deck) return;
  const missing = deckMissingCards(deck);
  if (!missing.length) { toast('Nothing missing to copy', 'info'); return; }
  copyToClipboard(missing.map(m => `${m.qty} ${m.name}`).join('\n'), `${missing.length} missing card${missing.length !== 1 ? 's' : ''}`);
}

// Validate a deck against its format's construction rules.
// Returns [{ level: 'error'|'warn', msg }]. Only checks what we can verify
// locally (size, copy limits, commander count, color identity via metadata).
// Banned/restricted lists and set legality aren't checked.
export function validateDeck(deck) {
  const f = deckFormat(deck);
  const issues = [];
  const cards = deck.cards || [];
  const qty = arr => arr.reduce((s, c) => s + (c.quantity || 1), 0);
  const cmd  = cards.filter(c => c.board === 'commander');
  const main = cards.filter(c => c.board === 'main' || !c.board);
  const side = cards.filter(c => c.board === 'side');
  const deckSize = qty(main) + qty(cmd); // commanders count toward deck size

  if (f.commanders) {
    const n = qty(cmd);
    if (n < f.commanders.min) issues.push({ level: 'error', msg: `Needs a commander — right-click a card and choose “Set as commander”` });
    else if (n > f.commanders.max) issues.push({ level: 'error', msg: `Too many commanders (${n}, max ${f.commanders.max})` });
  } else if (cmd.length) {
    issues.push({ level: 'warn', msg: `${deckFormat(deck).label} decks don’t have a commander — those cards count as mainboard here` });
  }

  if (f.minSize != null && deckSize < f.minSize) issues.push({ level: 'error', msg: `Deck has ${deckSize} cards — needs ${f.maxSize === f.minSize ? 'exactly' : 'at least'} ${f.minSize}` });
  if (f.maxSize != null && deckSize > f.maxSize) issues.push({ level: 'error', msg: `Deck has ${deckSize} cards — maximum is ${f.maxSize}` });
  if (f.sideboard != null && qty(side) > f.sideboard) {
    issues.push({ level: 'error', msg: f.sideboard === 0 ? `${f.label} has no sideboard (${qty(side)} cards in sideboard)` : `Sideboard has ${qty(side)} cards — maximum is ${f.sideboard}` });
  }

  if (f.copyLimit != null) {
    // Copy limit applies across deck + sideboard (CR 100.4a)
    const counts = new Map();
    for (const dc of [...main, ...cmd, ...side]) {
      if (deckCopyExempt(dc)) continue;
      const n = (dc.name || '').toLowerCase();
      counts.set(n, (counts.get(n) || 0) + (dc.quantity || 1));
    }
    const over = [...counts.entries()].filter(([, n]) => n > f.copyLimit);
    for (const [name, n] of over.slice(0, 6)) {
      const display = cards.find(c => c.name.toLowerCase() === name)?.name || name;
      issues.push({ level: 'error', msg: `${n}× ${display} — limit is ${f.copyLimit} cop${f.copyLimit === 1 ? 'y (singleton)' : 'ies'}` });
    }
    if (over.length > 6) issues.push({ level: 'error', msg: `…and ${over.length - 6} more cards over the copy limit` });
  }

  if (f.colorIdentity && cmd.length) {
    const identity = new Set();
    let cmdMetaKnown = true;
    for (const c of cmd) {
      const m = c.scryfallId ? cardMeta(c.scryfallId) : null;
      if (m?.color_identity) m.color_identity.forEach(x => identity.add(x));
      else cmdMetaKnown = false;
    }
    if (cmdMetaKnown) {
      const offenders = [];
      for (const dc of [...main, ...side]) {
        const m = dc.scryfallId ? cardMeta(dc.scryfallId) : null;
        if (!m?.color_identity) continue; // unknown — can't verify
        if (m.color_identity.some(x => !identity.has(x))) offenders.push(dc.name);
      }
      if (offenders.length) {
        const shown = offenders.slice(0, 4).join(', ');
        issues.push({ level: 'error', msg: `Outside commander color identity: ${shown}${offenders.length > 4 ? ` +${offenders.length - 4} more` : ''}` });
      }
    }
  }

  return issues;
}

// ── Deck CRUD ────────────────────────────────────────────────────────────────
export function createDeck(name, format = 'commander') {
  const deck = { id: uid(), name, format, description: '', cards: [] };
  collection.decks = collection.decks || [];
  collection.decks.push(deck);
  return deck;
}

export async function deleteDeck(deck) {
  if (!confirm(`Delete deck “${deck.name}”? Cards in your collection are not affected.`)) return;
  collection.decks = collection.decks.filter(d => d.id !== deck.id);
  try { await window.api.decks.remove(deck.id); } catch { /* removed on next save */ }
  if (ui.decks.deckId === deck.id) ui.decks.deckId = null;
  render(); autoSave();
  toast(`Deck “${deck.name}” deleted`, 'info');
  window.logger?.info('Deck', `Deleted deck “${deck.name}”`);
}

// Add a card to a deck, merging with an existing entry for the same printing
// on the same board. `src` may be an owned collection card (has .id in the
// collection) or a plain descriptor from import/search.
export function addCardToDeck(deck, src, board = 'main', qty = 1) {
  const sid = (src.scryfallId || '').toLowerCase();
  const existing = (deck.cards || []).find(dc =>
    dc.board === board && (dc.foil || 'normal') === (src.foil || 'normal') &&
    ((sid && dc.scryfallId === sid) || (!sid && !dc.scryfallId && dc.name.toLowerCase() === src.name.toLowerCase())));
  if (existing) {
    existing.quantity = (existing.quantity || 1) + qty;
    if (!existing.cardId && src.cardId) existing.cardId = src.cardId;
    return existing;
  }
  const entry = {
    id: uid(),
    cardId: src.cardId || null,
    scryfallId: sid,
    name: src.name,
    setCode: src.setCode || '',
    setName: src.setName || '',
    collectorNumber: src.collectorNumber || '',
    foil: src.foil || 'normal',
    quantity: qty,
    board,
  };
  deck.cards.push(entry);
  return entry;
}

// "Add to deck" from a card you own (context menu on collection rows).
export function addOwnedCardToDeck(card, deck) {
  addCardToDeck(deck, {
    cardId: card.id, scryfallId: card.scryfallId, name: card.name,
    setCode: card.setCode, setName: card.setName,
    collectorNumber: card.collectorNumber, foil: card.foil,
  }, 'main', 1);
  render(); autoSave();
  toast(`${card.name} → ${deck.name}`, 'success');
}

// Submenu listing every deck plus a "New deck…" prompt.
export function ctxDeckSubmenu(applyFn) {
  const decks = [...(collection.decks || [])].sort((a, b) => a.name.localeCompare(b.name));
  const items = decks.map(d => ({
    label: `${d.name} (${deckFormat(d).label})`,
    action: () => applyFn(d),
  }));
  if (items.length) items.push('---');
  items.push({ label: 'New deck…', icon: '＋', action: () => promptText('New deck', 'Deck name', name => {
    const deck = createDeck(name, 'commander');
    applyFn(deck);
  }) });
  return items;
}

// Capture metadata + price snapshots from a full Scryfall card object so
// deck cards added from search/import are immediately priced and analyzable.
export function captureScryfallCard(card) {
  const sid = (card.id || '').toLowerCase();
  if (!sid) return;
  if (!collection.cardMetadata) collection.cardMetadata = {};
  const oracleText = card.oracle_text || card.card_faces?.[0]?.oracle_text || '';
  if (!collection.cardMetadata[sid]) {
    collection.cardMetadata[sid] = {
      colors:         card.colors         || card.card_faces?.[0]?.colors || [],
      color_identity: card.color_identity || [],
      type_line:      card.type_line      || '',
      cmc:            card.cmc            ?? null,
      power:          card.power          ?? null,
      toughness:      card.toughness      ?? null,
      oracle_text:    oracleText,
    };
  }
  const prices = card.prices || {};
  if (prices.usd        != null) storePriceSnapshot(sid, 'normal', parseFloat(prices.usd));
  if (prices.usd_foil   != null) storePriceSnapshot(sid, 'foil',   parseFloat(prices.usd_foil));
  if (prices.usd_etched != null) storePriceSnapshot(sid, 'etched', parseFloat(prices.usd_etched));
}

// ── Decks tab rendering ──────────────────────────────────────────────────────
export function renderDecks() {
  if (ui.decks.deckId) {
    const deck = deckById(ui.decks.deckId);
    if (deck) return renderDeckDetail(deck);
    ui.decks.deckId = null;
  }

  const decks = collection.decks || [];
  if (!decks.length) return `
    <div class="empty-state">
      <div class="empty-state-icon">🛡️</div>
      <h3>No decks yet</h3>
      <p>Build a deck from your collection, or import one from Moxfield, Archidekt, or ManaBox.<br>
      Decks track what you <em>play</em> — they never change your collection's value.</p>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:8px">
        <button class="btn btn-primary" id="deckNewBtn">＋ New Deck</button>
        <button class="btn" id="deckImportBtn">⤒ Import Deck</button>
      </div>
    </div>`;

  const q = ui.decks.search.toLowerCase();
  const maps = deckOwnedMaps();
  const shown = decks
    .filter(d => !q || d.name.toLowerCase().includes(q) || deckFormat(d).label.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  return `
    <div class="decks-page">
      <div class="filter-bar" style="margin-bottom:16px">
        <input type="text" id="deckSearch" placeholder="Search decks…" value="${esc(ui.decks.search)}" style="flex:1;min-width:200px;max-width:340px">
        <span style="flex:1"></span>
        <button class="btn" id="deckImportBtn">⤒ Import Deck</button>
        <button class="btn btn-primary" id="deckNewBtn">＋ New Deck</button>
      </div>
      <div class="deck-grid">
        ${shown.map(d => renderDeckTile(d, maps)).join('')
          || '<div style="color:var(--text-dim);padding:30px">No decks match your search</div>'}
      </div>
    </div>`;
}

export function renderDeckTile(deck, maps) {
  const f = deckFormat(deck);
  const stats = deckStats(deck, maps);
  const issues = validateDeck(deck);
  const errors = issues.filter(i => i.level === 'error').length;
  const cover = deck.cards.find(c => c.board === 'commander' && c.scryfallId)
             || deck.cards.find(c => c.scryfallId);
  const coverUrl = cover ? sidImageUrl(cover.scryfallId, 'art_crop') : '';
  const ownedPct = stats.total ? Math.round((stats.ownedCount / stats.total) * 100) : 0;
  const legality = f.minSize == null
    ? `<span class="deck-legal-dot" style="background:var(--text-muted)" title="Casual — no rules enforced"></span>`
    : errors === 0
      ? `<span class="deck-legal-dot" style="background:var(--green)" title="Passes ${f.label} deck-building checks"></span>`
      : `<span class="deck-legal-dot" style="background:var(--red)" title="${errors} deck-building issue${errors > 1 ? 's' : ''}"></span>`;

  return `
    <div class="deck-tile" data-deck-id="${esc(deck.id)}">
      <div class="deck-cover">${coverUrl ? `<img src="${esc(coverUrl)}" alt="" loading="lazy" data-imgerr="remove">` : '<div class="deck-cover-blank">🛡️</div>'}
        <span class="deck-format-badge">${esc(f.label)}</span>
      </div>
      <div class="deck-tile-body">
        <div class="deck-tile-name" title="${esc(deck.name)}">${legality} ${esc(deck.name)}</div>
        <div class="deck-tile-meta">
          <span>${stats.total} cards</span>
          <span class="${ownedPct === 100 ? 'price-up' : ''}">${ownedPct}% owned</span>
          <span>${fmt(stats.value)}</span>
        </div>
        ${stats.missingCount ? `<div class="deck-tile-missing">${stats.missingCount} missing · ${fmt(stats.missingValue)} to complete</div>` : '<div class="deck-tile-missing" style="color:var(--green)">Fully owned ✓</div>'}
      </div>
    </div>`;
}

export function renderDeckDetail(deck) {
  const f = deckFormat(deck);
  const maps = deckOwnedMaps();
  const stats = deckStats(deck, maps);
  const issues = validateDeck(deck);
  const errors = issues.filter(i => i.level === 'error');

  // Ownership filter (All / Owned / Missing) — "owned" = you have every copy the
  // deck needs; "missing" = you're short at least one copy.
  const ownF = ui.decks.ownFilter || 'all';
  const isFullyOwned = (dc) => Math.min(dc.quantity || 1, deckCardOwnedQty(dc, maps)) >= (dc.quantity || 1);
  const matchesOwn = (dc) => ownF === 'all' || (ownF === 'owned' ? isFullyOwned(dc) : !isFullyOwned(dc));

  const boards = ['commander', 'main', 'side', 'maybe'];
  const sections = boards.map(b => {
    const cards = (deck.cards || []).filter(c => (c.board || 'main') === b).filter(matchesOwn);
    if (!cards.length) return '';
    return renderDeckBoard(deck, b, cards, maps);
  }).join('');

  // View toggle + ownership filter + actions on the cards you don't own yet.
  const vBtn = (id, label) => `<button class="btn ${ui.decks.view === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px" data-act="ui-set" data-path="decks.view" data-val="${id}">${label}</button>`;
  const oBtn = (id, label) => `<button class="btn ${ownF === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px" data-act="ui-set" data-path="decks.ownFilter" data-val="${id}">${label}</button>`;
  const deckControls = `
    <div class="deck-controls" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 12px">
      <div style="display:flex;gap:4px">${vBtn('list', '▤ List')}${vBtn('gallery', '▦ Gallery')}</div>
      <span style="color:var(--text-muted);font-size:12px;margin-left:4px">Show:</span>
      <div style="display:flex;gap:4px">${oBtn('all', 'All')}${oBtn('owned', 'Owned')}${oBtn('missing', 'Missing')}</div>
      ${stats.missingCount ? `<div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-ghost" style="font-size:12px" data-act="buyDeckMissingOnTcg" data-arg="${esc(deck.id)}" title="Open the missing cards on TCGPlayer Mass Entry (adds them to your cart)">🛒 Buy missing</button>
        <button class="btn btn-ghost" style="font-size:12px" data-act="addDeckMissingToWantList" data-arg="${esc(deck.id)}" title="Add the missing cards to your Want List">★ Want missing</button>
        <button class="btn btn-ghost" style="font-size:12px" data-act="copyDeckMissing" data-arg="${esc(deck.id)}" title="Copy the missing cards as a text list">⧉ Copy</button>
      </div>` : ''}
    </div>`;

  const legalityHtml = f.minSize == null
    ? `<div class="deck-legality deck-legality-ok"><span>♾</span> Casual deck — no construction rules enforced</div>`
    : errors.length === 0
      ? `<div class="deck-legality deck-legality-ok"><span>✓</span> Passes ${esc(f.label)} deck-building checks <span class="deck-rules-hint" title="${esc(f.rules)}">ⓘ</span></div>`
      : `<div class="deck-legality deck-legality-bad">
          <div class="deck-legality-title"><span>✕</span> ${errors.length} ${esc(f.label)} issue${errors.length > 1 ? 's' : ''} <span class="deck-rules-hint" title="${esc(f.rules)}">ⓘ</span></div>
          ${issues.map(i => `<div class="deck-issue ${i.level === 'warn' ? 'deck-issue-warn' : ''}">• ${esc(i.msg)}</div>`).join('')}
        </div>`;

  return `
    <div class="deck-detail">
      <div class="deck-detail-head">
        <button class="btn btn-ghost" id="deckBackBtn" title="Back to decks">← Decks</button>
        <h2 class="deck-title" id="deckTitle" title="Click to rename">${esc(deck.name)} <span class="deck-title-edit">✎</span></h2>
        <select id="deckFormatSelect" title="Deck format">
          ${DECK_FORMAT_ORDER.map(k => `<option value="${k}" ${deck.format === k ? 'selected' : ''}>${DECK_FORMATS[k].label}</option>`).join('')}
        </select>
        <span style="flex:1"></span>
        <button class="btn btn-primary" id="deckAddCardsBtn">＋ Add Cards</button>
        <button class="btn" id="deckExportBtn" title="Export to Moxfield / Archidekt / ManaBox">⤓ Export</button>
        <button class="btn btn-ghost" id="deckDeleteBtn" title="Delete deck" style="color:var(--red)">🗑</button>
      </div>

      <div class="deck-stats-strip">
        <div class="deck-stat"><div class="deck-stat-val">${stats.total}</div><div class="deck-stat-lbl">Cards</div></div>
        <div class="deck-stat"><div class="deck-stat-val ${stats.missingCount === 0 ? 'price-up' : ''}">${stats.ownedCount}/${stats.total}</div><div class="deck-stat-lbl">Owned</div></div>
        <div class="deck-stat"><div class="deck-stat-val">${fmt(stats.value)}</div><div class="deck-stat-lbl">Deck Value</div></div>
        <div class="deck-stat"><div class="deck-stat-val">${fmt(stats.ownedValue)}</div><div class="deck-stat-lbl">You Own</div></div>
        <div class="deck-stat"><div class="deck-stat-val" style="color:${stats.missingValue > 0 ? 'var(--orange)' : 'var(--green)'}">${fmt(stats.missingValue)}</div><div class="deck-stat-lbl">To Complete</div></div>
      </div>
      <div class="deck-value-note">Deck value is informational — owned copies are already counted in your binders; missing cards are never added to your collection totals.</div>

      ${legalityHtml}

      ${(deck.cards || []).length ? deckControls : ''}

      ${sections || ((deck.cards || []).length
        ? `<div class="empty-state" style="padding:40px"><p>No ${ownF === 'owned' ? 'fully-owned' : 'missing'} cards in this deck.</p></div>`
        : `<div class="empty-state" style="padding:40px"><p>This deck is empty — click <strong>＋ Add Cards</strong> to search your collection and Scryfall, or right-click cards anywhere in the app.</p></div>`)}
    </div>`;
}

export function renderDeckBoard(deck, board, cards, maps) {
  const f = deckFormat(deck);
  const qty = cards.reduce((s, c) => s + (c.quantity || 1), 0);
  const val = cards.reduce((s, c) => { const p = deckCardPrice(c); return s + (p != null ? p * (c.quantity || 1) : 0); }, 0);

  // Group mainboard by card type for readability; other boards stay flat
  let groups;
  if (board === 'main') {
    const byType = new Map();
    for (const dc of cards) {
      const t = parseMainType(dc.scryfallId ? cardMeta(dc.scryfallId)?.type_line : '');
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(dc);
    }
    groups = TYPE_ORDER.filter(t => byType.has(t)).map(t => [t, byType.get(t)]);
  } else {
    groups = [[null, cards]];
  }

  const limitNote = board === 'side' && f.sideboard ? ` / ${f.sideboard}` : '';
  const bodyHtml = ui.decks.view === 'gallery'
    ? `<div class="gallery-grid" style="margin-top:6px">
        ${cards.slice().sort((a, b) => a.name.localeCompare(b.name)).map(dc => deckGalleryTile(dc, maps)).join('')}
      </div>`
    : `<table class="deck-table">
        <tbody>
        ${groups.map(([type, list]) => `
          ${type ? `<tr class="deck-group-row"><td colspan="6">${esc(type)} (${list.reduce((s, c) => s + (c.quantity || 1), 0)})</td></tr>` : ''}
          ${list
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(dc => renderDeckCardRow(dc, maps))
            .join('')}
        `).join('')}
        </tbody>
      </table>`;
  return `
    <div class="deck-board">
      <div class="deck-board-title">${esc(DECK_BOARDS[board] || board)} <span class="deck-board-count">${qty}${limitNote} · ${fmt(val)}</span></div>
      ${bodyHtml}
    </div>`;
}

// Gallery tile for a deck entry — card image dimmed when you don't own a full
// playset, with an ownership badge. Click opens the card modal (owned → your
// copy, unowned → Scryfall details). data-deck-entry keeps the right-click menu.
function deckGalleryTile(dc, maps) {
  const need  = dc.quantity || 1;
  const owned = Math.min(need, deckCardOwnedQty(dc, maps));
  const id    = (dc.scryfallId || '').toLowerCase();
  const img   = sidImageUrl(id);
  const full  = owned >= need;
  const badgeBg  = full ? 'rgba(27,110,61,.92)' : owned > 0 ? 'rgba(201,155,60,.95)' : 'rgba(179,38,30,.85)';
  const badgeTxt = full ? `✓ ${need}×` : owned > 0 ? `${owned}/${need}` : `✗ ${need}×`;
  return `<div class="gallery-card${full ? '' : ' sl-card-missing'}" data-deck-entry="${esc(dc.id)}" ${id ? `data-act="showSlViewerModal" data-arg="${esc(id)}"` : ''} title="${esc(dc.name)}">
    ${img
      ? `<img src="${esc(img)}" alt="${esc(dc.name)}" loading="lazy" style="${full ? '' : 'filter:grayscale(45%) brightness(.72)'}" data-imgerr="hide-card">`
      : `<div style="aspect-ratio:488/680;display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;font-size:11px;color:var(--text-muted);background:var(--surface2)">${esc(dc.name)}</div>`}
    <span class="sl-owned-badge" style="background:${badgeBg}">${badgeTxt}</span>
  </div>`;
}

export function renderDeckCardRow(dc, maps) {
  const qty = dc.quantity || 1;
  const owned = deckCardOwnedQty(dc, maps);
  const ownedClamped = Math.min(qty, owned);
  const pill = ownedClamped >= qty
    ? `<span class="owned-pill own-full" title="You own ${owned} cop${owned !== 1 ? 'ies' : 'y'}">✓ Owned</span>`
    : ownedClamped > 0
      ? `<span class="owned-pill own-part" title="You own ${owned} of ${qty} needed">${ownedClamped}/${qty}</span>`
      : `<span class="owned-pill own-none" title="Not in your collection">✗ Need ${qty}</span>`;
  const p = deckCardPrice(dc);
  const foilBadge = dc.foil && dc.foil !== 'normal'
    ? `<span class="badge badge-${dc.foil}">${FOIL_LABEL[dc.foil] || dc.foil}</span>` : '';
  return `<tr class="deck-row" data-deck-entry="${esc(dc.id)}">
    <td class="deck-qty">${qty}×</td>
    <td class="deck-name">${esc(dc.name)} ${foilBadge}</td>
    <td class="deck-set">${dc.setCode ? `${esc(dc.setCode.toUpperCase())}${dc.collectorNumber ? ` #${esc(dc.collectorNumber)}` : ''}` : '<span style="opacity:.4">—</span>'}</td>
    <td class="deck-owned">${pill}</td>
    <td class="deck-price">${p != null ? fmt(p) : '<span style="color:var(--text-dim)">—</span>'}</td>
    <td class="deck-price-tot">${p != null ? fmt(p * qty) : ''}</td>
  </tr>`;
}

// ── Deck modals: new deck / add cards ────────────────────────────────────────
export function showNewDeckModal() {
  showModal(`
    <h2>New Deck</h2>
    <div class="form-group"><label>Deck name</label><input type="text" id="nd-name" placeholder="e.g. Atraxa Superfriends"></div>
    <div class="form-group"><label>Format</label>
      <select id="nd-format">
        ${DECK_FORMAT_ORDER.map(k => `<option value="${k}">${DECK_FORMATS[k].label}</option>`).join('')}
      </select>
      <div id="nd-rules" style="font-size:11px;color:var(--text-muted);margin-top:6px;line-height:1.5">${esc(DECK_FORMATS.commander.rules)}</div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="nd-cancel">Cancel</button>
      <button class="btn btn-primary" id="nd-create">Create Deck</button>
    </div>`);
  const fmtSel = document.getElementById('nd-format');
  fmtSel.addEventListener('change', () => {
    document.getElementById('nd-rules').textContent = (DECK_FORMATS[fmtSel.value] || DECK_FORMATS.other).rules;
  });
  const create = () => {
    const name = document.getElementById('nd-name').value.trim();
    if (!name) { toast('Give the deck a name', 'error'); return; }
    const deck = createDeck(name, fmtSel.value);
    ui.decks.deckId = deck.id;
    hideModal(); render(); autoSave();
    window.logger?.success('Deck', `Created deck “${name}” (${DECK_FORMATS[deck.format].label})`);
  };
  document.getElementById('nd-create').addEventListener('click', create);
  document.getElementById('nd-name').addEventListener('keydown', e => { if (e.key === 'Enter') create(); });
  document.getElementById('nd-cancel').addEventListener('click', hideModal);
  document.getElementById('nd-name').focus();
}

export let _deckAddResults = [];   // rows currently shown in the Add Cards modal

export function showDeckAddCardModal(deckId) {
  const deck = deckById(deckId);
  if (!deck) return;
  const isCmdFormat = !!deckFormat(deck).commanders;
  showModal(`
    <h2>Add Cards — ${esc(deck.name)}</h2>
    <div style="display:flex;gap:8px;margin-bottom:4px">
      <input type="text" id="dac-search" placeholder="Search your collection… (Enter)" style="flex:1">
      <select id="dac-board">
        <option value="main">Mainboard</option>
        ${isCmdFormat ? '<option value="commander">Commander</option>' : ''}
        ${!isCmdFormat ? '<option value="side">Sideboard</option>' : ''}
        <option value="maybe">Maybeboard</option>
      </select>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">Your collection is searched first. Use “Search Scryfall” for cards you don't own — they're added to the deck only, never to your collection.</div>
    <div id="dac-results" class="deck-add-results"><div style="color:var(--text-dim);padding:20px">Type to search your collection…</div></div>
  `, 'wide');

  const input = document.getElementById('dac-search');
  const resultsEl = document.getElementById('dac-results');

  const renderResults = () => {
    const q = input.value.trim();
    if (!q) { resultsEl.innerHTML = '<div style="color:var(--text-dim);padding:20px">Type to search your collection…</div>'; return; }
    const ql = q.toLowerCase();
    // Aggregate owned matches by printing (scryfallId|foil)
    const seen = new Map();
    for (const c of collection.cards) {
      if (c.status === 'sold') continue;
      if (!c.name.toLowerCase().includes(ql)) continue;
      const key = `${c.scryfallId}|${c.foil}`;
      const e = seen.get(key);
      if (e) e.ownedQty += c.quantity;
      else seen.set(key, { src: 'collection', cardId: c.id, scryfallId: c.scryfallId, name: c.name, setCode: c.setCode, setName: c.setName, collectorNumber: c.collectorNumber, foil: c.foil, ownedQty: c.quantity });
    }
    _deckAddResults = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
    resultsEl.innerHTML = `
      ${_deckAddResults.length ? '' : `<div style="color:var(--text-dim);padding:14px 4px">No matches in your collection.</div>`}
      ${_deckAddResults.map((r, i) => deckAddRowHtml(r, i)).join('')}
      <div style="padding:10px 4px">
        <button class="btn" id="dac-scryfall">🔍 Search Scryfall for “${esc(q)}”</button>
      </div>`;
    wireResultRows();
  };

  const deckAddRowHtml = (r, i) => {
    const p = r.scryfallId ? (getCurrentPrice(r.scryfallId, r.foil || 'normal') ?? getCurrentPrice(r.scryfallId, 'normal')) : (r.price ?? null);
    return `<div class="dac-row">
      <span class="dac-name">${esc(r.name)}${r.foil && r.foil !== 'normal' ? ` <span class="badge badge-${r.foil}">${FOIL_LABEL[r.foil] || r.foil}</span>` : ''}</span>
      <span class="dac-set">${esc((r.setCode || '').toUpperCase())}${r.collectorNumber ? ` #${esc(r.collectorNumber)}` : ''}</span>
      <span class="dac-owned">${r.src === 'collection' ? `<span class="owned-pill own-full">✓ ×${r.ownedQty}</span>` : '<span class="owned-pill own-none">not owned</span>'}</span>
      <span class="dac-price">${p != null ? fmt(p) : '—'}</span>
      <button class="btn btn-sm" data-add-idx="${i}">＋ Add</button>
    </div>`;
  };

  const wireResultRows = () => {
    resultsEl.querySelectorAll('[data-add-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const r = _deckAddResults[parseInt(btn.dataset.addIdx)];
        if (!r) return;
        if (r.scryCard) captureScryfallCard(r.scryCard);
        const board = document.getElementById('dac-board').value;
        addCardToDeck(deck, r, board, 1);
        autoSave();
        toast(`${r.name} → ${DECK_BOARDS[board] || board}`, 'success');
        btn.textContent = '✓ Added';
        setTimeout(() => { btn.textContent = '＋ Add'; }, 1200);
      });
    });
    const scryBtn = document.getElementById('dac-scryfall');
    if (scryBtn) scryBtn.addEventListener('click', async () => {
      scryBtn.disabled = true;
      scryBtn.textContent = 'Searching Scryfall…';
      try {
        const resp = await netFetch(`https://api.scryfall.com/cards/search?q=${encodeURIComponent(input.value.trim())}&unique=cards&order=name`);
        if (!resp.ok) throw new Error(resp.status === 404 ? 'No cards found' : `HTTP ${resp.status}`);
        const data = await resp.json();
        const cards = (data.data || []).slice(0, 25);
        _deckAddResults = cards.map(c => ({
          src: 'scryfall', scryCard: c,
          scryfallId: (c.id || '').toLowerCase(), name: c.name,
          setCode: c.set || '', setName: c.set_name || '',
          collectorNumber: c.collector_number || '', foil: 'normal',
          price: c.prices?.usd != null ? parseFloat(c.prices.usd) : null,
        }));
        resultsEl.innerHTML = `
          <div style="font-size:11px;color:var(--text-muted);padding:4px">Scryfall results — added to the deck as unowned cards:</div>
          ${_deckAddResults.map((r, i) => deckAddRowHtml(r, i)).join('')}`;
        wireResultRows();
      } catch (err) {
        scryBtn.disabled = false;
        scryBtn.textContent = `🔍 Search Scryfall again`;
        toast(`Scryfall search failed: ${err.message}`, 'error');
      }
    });
  };

  let debounce = null;
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(renderResults, 220); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') renderResults(); });
  input.focus();
}

// ── Deck context menus ───────────────────────────────────────────────────────
export function showDeckTileContextMenu(x, y, deck) {
  showContextMenu(x, y, [
    { header: deck.name },
    { icon: '👁', label: 'Open deck', action: () => { ui.decks.deckId = deck.id; render(); } },
    { icon: '✎', label: 'Rename…', action: () => promptText('Rename deck', deck.name, name => { deck.name = name; render(); autoSave(); }) },
    { icon: '⚖', label: 'Change format', sub: DECK_FORMAT_ORDER.map(k => ({
        label: DECK_FORMATS[k].label, icon: deck.format === k ? '✓' : '', disabled: deck.format === k,
        action: () => { deck.format = k; render(); autoSave(); } })) },
    '---',
    { icon: '⤓', label: 'Export…', action: () => showDeckExportModal(deck.id) },
    '---',
    { icon: '🗑', label: 'Delete deck', danger: true, action: () => deleteDeck(deck) },
  ]);
}

export function showDeckCardContextMenu(x, y, deck, dc) {
  const f = deckFormat(deck);
  const ownedCard = (dc.cardId && collection.cards.find(c => c.id === dc.cardId && c.status !== 'sold'))
                 || (dc.scryfallId && collection.cards.find(c => c.scryfallId === dc.scryfallId && c.status !== 'sold'))
                 || collection.cards.find(c => c.status !== 'sold' && c.name.toLowerCase() === dc.name.toLowerCase());
  const saveAndRender = () => { render(); autoSave(); };
  const boardItems = ['main', 'side', 'maybe', ...(f.commanders ? ['commander'] : [])]
    .filter(b => b !== dc.board)
    .map(b => ({ label: DECK_BOARDS[b], action: () => { dc.board = b; saveAndRender(); toast(`${dc.name} → ${DECK_BOARDS[b]}`, 'success'); } }));

  showContextMenu(x, y, [
    { header: dc.name },
    ...(ownedCard ? [{ icon: '👁', label: 'View in collection', action: () => showGalleryModal(ownedCard.id) }] : []),
    ...(f.commanders && dc.board !== 'commander'
      ? [{ icon: '👑', label: 'Set as commander', action: () => { dc.board = 'commander'; saveAndRender(); toast(`${dc.name} is now the commander`, 'success'); } }]
      : []),
    { icon: '⇄', label: 'Move to', sub: boardItems },
    '---',
    { icon: '＋', label: 'Add a copy', action: () => { dc.quantity = (dc.quantity || 1) + 1; saveAndRender(); } },
    { icon: '－', label: 'Remove a copy', disabled: (dc.quantity || 1) <= 1, action: () => { dc.quantity = Math.max(1, (dc.quantity || 1) - 1); saveAndRender(); } },
    '---',
    { icon: '🌐', label: 'View on Scryfall', action: () => openCardOnScryfall(dc) },
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(dc.name, 'Name') },
    '---',
    { icon: '🗑', label: 'Remove from deck', danger: true, action: () => {
        deck.cards = deck.cards.filter(c => c.id !== dc.id);
        saveAndRender();
        toast(`${dc.name} removed from ${deck.name}`, 'info');
      } },
  ]);
}

