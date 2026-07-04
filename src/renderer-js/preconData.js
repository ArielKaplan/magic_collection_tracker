// preconData.js — Precon Explorer data layer.
//
// The catalog (every physical preconstructed deck, 1993→) lives in SQLite
// (precon_decks / precon_deck_cards), seeded at init from a baked MTGJSON
// snapshot (src/main/precon-seed.json, built by scripts/precon-build/) and
// appended to by refreshPreconData() — decklists are immutable once printed,
// so sync is an append-only diff against MTGJSON's DeckList.json.
//
// Deck headers load at startup (cheap, ~1k rows). The full card-membership
// map (~40k rows) loads lazily the first time the Precon tab opens.
//
// transformMtgjsonDeck() is the single source of truth for turning a raw
// MTGJSON deck file into our shape — scripts/precon-build/emit-seed.js
// imports it too, so the baked seed and the live sync can never drift.

import { autoSave } from './storage.js';
import { fetchScryfallBatch } from './prices.js';
import { render } from './render.js';
import { searchTcgcsvLocal } from './sealedPricing.js';
import { finishGroup } from './slData.js';
import { collection } from './state.js';
import { netFetch, toast } from './utils.js';
import { addToWantList, wantItemByScryfall } from './wantlist.js';

// ── pure transform (shared with the build pipeline) ─────────────────────────

const WUBRG = ['W', 'U', 'B', 'R', 'G'];

function entryFinish(e) {
  const f = e.finishes || [];
  if (e.isEtched) return 'etched';
  if (e.isFoil) {
    if (f.includes('foil')) return 'foil';
    if (f.includes('etched')) return 'etched';
    return 'foil';
  }
  if (f.includes('nonfoil')) return 'nonfoil';
  if (f.includes('foil')) return 'foil';
  if (f.includes('etched')) return 'etched';
  return 'nonfoil';
}

// Raw MTGJSON deck file (json.data) → our seed/sync deck shape.
// Cards are compact arrays: [scryfallId, name, count, finish, board, setCode, number].
export function transformMtgjsonDeck(raw) {
  const boards = [
    ['commander', raw.commander || []],
    ['main', raw.mainBoard || []],
    ['side', raw.sideBoard || []],
    ['token', raw.tokens || []],
  ];
  const cards = [];
  const colorSet = new Set();
  const commanderNames = [];
  for (const [board, entries] of boards) {
    for (const e of entries) {
      const sid = (e.identifiers && e.identifiers.scryfallId || '').toLowerCase();
      if (!sid) continue;
      cards.push([sid, e.name, e.count || 1, entryFinish(e), board, (e.setCode || '').toUpperCase(), e.number || '']);
      if (board === 'commander') {
        commanderNames.push(e.name);
      } else if (board === 'main' && !(raw.commander || []).length) {
        for (const c of (e.colorIdentity || [])) colorSet.add(c);
      }
    }
  }
  if ((raw.commander || []).length) {
    colorSet.clear();
    for (const e of raw.commander) for (const c of (e.colorIdentity || [])) colorSet.add(c);
  }
  return {
    file: null,   // caller fills from DeckList fileName (the stable id)
    name: raw.name,
    type: raw.type,
    code: raw.code,
    date: raw.releaseDate || null,
    colors: WUBRG.filter(c => colorSet.has(c)).join(''),
    commander: commanderNames.join(' // '),
    variantOf: null,
    cards,
  };
}

// The deck types the Explorer carries — physical products someone can shelf.
// Kept in sync with scripts/precon-build/fetch-decks.js SCOPE_TYPES.
export const PRECON_SCOPE_TYPES = new Set([
  'Commander Deck', 'Theme Deck', 'Intro Pack', 'Duel Deck', 'Planeswalker Deck',
  'World Championship Deck', 'Challenger Deck', 'Pioneer Challenger Deck',
  'Event Deck', 'Starter Deck', 'Welcome Deck', 'Game Night Deck', 'Brawl Deck',
  'Guild Kit', 'Premium Deck', 'Archenemy Deck', 'Planechase Deck', 'Box Set',
  'Enhanced Deck', 'Advanced Deck', 'Advanced Pack', 'Clash Pack', 'Starter Kit',
  'Spellslinger Starter Kit', 'Pro Tour Deck', 'Modern Event Deck', 'Dandan Deck',
]);

// ── state ────────────────────────────────────────────────────────────────────

export const preconState = {
  decks: [],           // headers (file, name, type, code, date, colors, commander, variantOf, cardCount)
  byFile: new Map(),
  cards: null,         // Map(file → [{sid, name, count, finish, board, set, num}]) — lazy
  cardsLoading: false,
  reverse: null,       // Map(sid → Set(file)) — built with cards
  syncing: false,
  singles: new Map(),  // file → { value, priced, rows } — computed from details
  details: new Map(),  // file → Map(sid → { manaCost, cmc, typeLine, colors, rarity, prices }) — Scryfall, on demand
  pricing: new Set(),  // files being fetched right now
};

// Startup: deck headers only.
export async function loadPreconHeaders() {
  try {
    const rows = await window.api?.precons?.list();
    if (Array.isArray(rows)) {
      preconState.decks = rows;
      preconState.byFile = new Map(rows.map(d => [d.file, d]));
    }
  } catch (e) { window.logger?.warn?.('Precon', `headers load failed: ${e.message}`); }
}

// Lazy: full membership map, first Precon tab open (or reverse-lookup need).
export async function ensurePreconCards() {
  if (preconState.cards || preconState.cardsLoading) return;
  preconState.cardsLoading = true;
  try {
    const rows = await window.api?.precons?.cards();
    const map = new Map();
    const rev = new Map();
    for (const [file, sid, name, count, finish, board, set, num] of (rows || [])) {
      if (!map.has(file)) map.set(file, []);
      map.get(file).push({ sid, name, count: count || 1, finish: finish || 'nonfoil', board: board || 'main', set: set || '', num: num || '' });
      if (!rev.has(sid)) rev.set(sid, new Set());
      rev.get(sid).add(file);
    }
    preconState.cards = map;
    preconState.reverse = rev;
    window.logger?.info?.('Precon', `Loaded ${(rows || []).length.toLocaleString()} deck-card rows for ${map.size} decks`);
  } catch (e) {
    window.logger?.error?.('Precon', `card map load failed: ${e.message}`);
  } finally {
    preconState.cardsLoading = false;
    render();
  }
}

export function preconCardsFor(file) {
  return (preconState.cards && preconState.cards.get(file)) || [];
}

// Reverse lookup: which precons contain this printing? (Headers only — cheap
// to render anywhere. Returns [] until the membership map has loaded.)
export function preconsContaining(scryfallId) {
  const sid = (scryfallId || '').toLowerCase();
  if (!preconState.reverse) { ensurePreconCards(); return []; }
  const files = preconState.reverse.get(sid);
  if (!files) return [];
  return [...files].map(f => preconState.byFile.get(f)).filter(Boolean);
}

// Card-NAME → decks index, for the global search's "which precons contain a
// card named X" containment matching (a typed query has a name, not an id).
// Built once from the membership map and cached until it reloads. Returns null
// (and kicks off the lazy load) until the map is available, so the first
// search after launch may miss precons — the next keystroke has them.
let _preconNameIndex = null;
let _preconNameIndexFor = null;
export function preconNameIndex() {
  if (!preconState.cards) { ensurePreconCards(); return null; }
  if (_preconNameIndex && _preconNameIndexFor === preconState.cards) return _preconNameIndex;
  const idx = new Map();
  for (const [file, rows] of preconState.cards) {
    for (const r of rows) {
      if (r.board === 'token') continue;              // tokens aren't "the card" you search for
      const key = (r.name || '').toLowerCase();
      if (!key) continue;
      let e = idx.get(key);
      if (!e) { e = { name: r.name, sid: r.sid, files: new Set() }; idx.set(key, e); }
      e.files.add(file);
    }
  }
  _preconNameIndex = idx;
  _preconNameIndexFor = preconState.cards;
  return idx;
}

// ── sync: append-only diff against MTGJSON's DeckList.json ──────────────────

// opts.silent: the daily background check — quiet unless something was added.
export async function refreshPreconData(opts = {}) {
  if (preconState.syncing) return;
  preconState.syncing = true;
  render();
  try {
    if (!opts.silent) toast('Checking MTGJSON for new preconstructed decks…', 'info', 8000);
    const resp = await netFetch('https://mtgjson.com/api/v5/DeckList.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from mtgjson.com`);
    // SLD is the SL Explorer's turf — except the Secret Lair Commander decks,
    // which straddle both (full playable decklist lives here).
    const list = ((await resp.json()).data || [])
      .filter(d => PRECON_SCOPE_TYPES.has(d.type) && (d.code !== 'SLD' || d.type === 'Commander Deck'));
    const missing = list.filter(d => !preconState.byFile.has(d.fileName));
    if (!missing.length) {
      if (!opts.silent) toast('Precon catalog is up to date — no new decks.', 'success');
      window.logger?.info?.('Precon', 'Catalog up to date');
      return;
    }
    window.logger?.info?.('Precon', `${missing.length} new deck${missing.length !== 1 ? 's' : ''} — fetching decklists…`);
    const added = [];
    for (const d of missing) {
      try {
        const r = await netFetch(`https://mtgjson.com/api/v5/decks/${d.fileName}.json`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const deck = transformMtgjsonDeck((await r.json()).data || {});
        deck.file = d.fileName;
        if (!deck.date) deck.date = d.releaseDate || null;
        if (deck.cards.length) added.push(deck);
      } catch (e) {
        window.logger?.warn?.('Precon', `${d.fileName}: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 100));
    }
    if (added.length) {
      await window.api.precons.upsert(added);
      await loadPreconHeaders();
      // Fold the new decks into the in-memory maps without a full reload.
      if (preconState.cards) {
        for (const deck of added) {
          const rows = deck.cards.map(([sid, name, count, finish, board, set, num]) =>
            ({ sid, name, count, finish, board, set, num }));
          preconState.cards.set(deck.file, rows);
          for (const r of rows) {
            if (!preconState.reverse.has(r.sid)) preconState.reverse.set(r.sid, new Set());
            preconState.reverse.get(r.sid).add(deck.file);
          }
        }
      }
      toast(`Added ${added.length} new precon deck${added.length !== 1 ? 's' : ''} 🧱`, 'success');
      window.logger?.success?.('Precon', `Catalog now ${preconState.decks.length} decks`);
    } else {
      toast('New decks were listed but none could be fetched — try again later.', 'error');
    }
  } catch (e) {
    if (!opts.silent) toast(`Precon check failed: ${e.message}`, 'error');
    window.logger?.error?.('Precon', `sync failed: ${e.message}`);
  } finally {
    preconState.syncing = false;
    render();
  }
}

// ── economics ────────────────────────────────────────────────────────────────

// Assumed MSRP by product type and era — shown with ≈ everywhere. null means
// "no honest default" (multi-deck boxes, promos, giveaways).
export function preconMsrpDefault(type, date) {
  const y = parseInt((date || '').slice(0, 4), 10) || 0;
  switch (type) {
    case 'Commander Deck':           return y >= 2023 ? 44.99 : (y >= 2020 ? 39.99 : 34.99);
    case 'Challenger Deck':
    case 'Pioneer Challenger Deck':  return 29.99;
    case 'Brawl Deck':               return 29.99;
    case 'Event Deck':               return 24.99;
    case 'Clash Pack':               return 24.99;
    case 'Duel Deck':                return 21.99;
    case 'Guild Kit':                return 19.99;
    case 'Archenemy Deck':
    case 'Planechase Deck':          return 19.99;
    case 'Planeswalker Deck':        return 14.99;
    case 'Intro Pack':               return 12.99;
    case 'Theme Deck':
    case 'Starter Deck':             return 9.99;
    case 'Premium Deck':             return 34.99;
    case 'Modern Event Deck':        return 74.99;
    case 'World Championship Deck':  return 14.99;
    case 'Starter Kit':
    case 'Spellslinger Starter Kit': return 24.99;
    default: return null;            // Box Set, Game Night, Welcome, Pro Tour, …
  }
}

// Best-effort sealed market price via the synced TCGCSV index (fuzzy name
// match — the exact tcgplayerProductId join is a pipeline upgrade later).
export function sealedPriceForPrecon(deck) {
  try {
    for (const q of [deck.name, `${deck.name} ${(deck.type || '').split(' ')[0]}`]) {
      const hit = (searchTcgcsvLocal(q, 1) || [])[0];
      if (hit && hit.marketPrice != null) return { price: hit.marketPrice, name: hit.name };
    }
  } catch { /* index not synced */ }
  return null;
}

// A row's price given its finish, from a Scryfall prices object.
export function rowPrice(prices, finish) {
  const p = prices || {};
  const order = finish === 'foil' ? ['usd_foil', 'usd', 'usd_etched']
    : finish === 'etched' ? ['usd_etched', 'usd_foil', 'usd']
    : ['usd', 'usd_foil', 'usd_etched'];
  for (const k of order) {
    const v = parseFloat(p[k]);
    if (!isNaN(v)) return v;
  }
  return null;
}

// On-demand Scryfall detail fetch for a deck — one batch pass feeds BOTH the
// singles valuation (Σ price × count at each row's finish, tokens excluded)
// and the Table view's data columns (mana cost, type, color, rarity, price).
export async function ensurePreconDetails(file) {
  if (preconState.pricing.has(file) || preconState.details.has(file)) return;
  const rows = preconCardsFor(file).filter(r => r.board !== 'token');
  if (!rows.length) { toast('No cards mapped for this deck.', 'info'); return; }
  preconState.pricing.add(file);
  render();
  try {
    const uniq = [...new Set(rows.map(r => r.sid))];
    const details = new Map();
    for (let i = 0; i < uniq.length; i += 75) {
      const data = await fetchScryfallBatch(uniq.slice(i, i + 75));
      for (const c of (data.data || [])) {
        const face = (c.card_faces && c.card_faces[0]) || {};
        details.set((c.id || '').toLowerCase(), {
          manaCost: c.mana_cost || face.mana_cost || '',
          cmc: c.cmc ?? 0,
          typeLine: c.type_line || face.type_line || '',
          colors: (c.colors && c.colors.length ? c.colors : (c.color_identity || [])),
          rarity: c.rarity || '',
          prices: c.prices || {},
        });
      }
    }
    preconState.details.set(file, details);
    let value = 0, priced = 0;
    for (const r of rows) {
      const d = details.get(r.sid);
      if (!d) continue;
      const v = rowPrice(d.prices, r.finish);
      if (v != null) { value += v * (r.count || 1); priced++; }
    }
    preconState.singles.set(file, { value, priced, rows: rows.length, at: Date.now() });
  } catch (e) {
    toast(`Couldn't load card details: ${e.message}`, 'error');
  } finally {
    preconState.pricing.delete(file);
    render();
  }
}

// Back-compat name — the economics banner's button predates the Table view.
export const pricePreconSingles = ensurePreconDetails;

// ── ownership + want list ────────────────────────────────────────────────────

// (scryfallId|finish) keys for everything currently owned — finish-aware, the
// same vocabulary the SL Explorer uses.
export function ownedFinishKeySet() {
  const set = new Set();
  for (const c of collection.cards) {
    if (c.status === 'sold' || !c.scryfallId) continue;
    set.add(`${c.scryfallId}|${finishGroup(c.foil)}`);
  }
  return set;
}

// Distinct-card ownership stats for a deck (tokens excluded, counts ignored —
// "do I have this card from this deck" per printing+finish).
export function preconOwnedStats(file, ownedKeys) {
  const rows = preconCardsFor(file).filter(r => r.board !== 'token');
  const seen = new Set();
  let owned = 0, total = 0;
  for (const r of rows) {
    const k = `${r.sid}|${r.finish}`;
    if (seen.has(k)) continue;
    seen.add(k);
    total++;
    if (ownedKeys.has(k)) owned++;
  }
  return { owned, total };
}

export function addPreconMissingToWantList(file) {
  const deck = preconState.byFile.get(file);
  if (!deck) return;
  const ownedKeys = ownedFinishKeySet();
  let added = 0;
  for (const r of preconCardsFor(file)) {
    if (r.board === 'token') continue;
    if (ownedKeys.has(`${r.sid}|${r.finish}`) || wantItemByScryfall(r.sid)) continue;
    if (addToWantList({
      scryfallId: r.sid, name: r.name, setCode: r.set, collectorNumber: r.num,
      foil: r.finish === 'nonfoil' ? 'normal' : r.finish, note: `Precon: ${deck.name}`,
    }, { silent: true })) added++;
  }
  render(); autoSave();
  toast(added ? `★ Added ${added} missing card${added !== 1 ? 's' : ''} from “${deck.name}” to your want list`
              : `No new missing cards to add from “${deck.name}”`, added ? 'success' : 'info');
}
