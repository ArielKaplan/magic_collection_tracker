import { cardCurrentValue, entryRealized, ownedCards, ownedSealed, soldCards, soldSealed } from './analytics.js';
import { showGalleryModal } from './gallery.js';
import { hideModal, showModal } from './modals.js';
import { fetchScryfallBatch } from './prices.js';
import { render } from './render.js';
import { searchTcgcsvLocal } from './sealedPricing.js';
import { attributeDropFor, buildSlModel, finishGroup, projectLegacy, requiredFinishFor, setSlProducts, slDropModelFinish, slProductForDrop } from './slData.js';
import { refreshSlWikiData, slWikiGroupFor, slWikiMsrp, upcomingSlDrops } from './slWiki.js';
import { collection, tcgcsvCache, ui } from './state.js';
import { esc, fmt, netFetch, toast } from './utils.js';
import { addDropMissingToWantList, isCardWanted, toggleSlCardWant } from './wantlist.js';


// ─────────────────────────────────────────────────────────────────────────────
// LOCAL USER OVERRIDES (per-install, never shipped)
// The sourced dataset baked into secretlair.js is the shared baseline. These
// overrides live ONLY in this user's SQLite (settings key 'sl_overrides') and
// let them re-group drops or attach notes without touching the built-in data or
// anyone else's copy. Shape:
//   { drops:{ [drop]: { superdrop?, note? } }, superdrops:{ [sd]: { note? } }, cards:{ [scryfallId]: { note? } } }
// ─────────────────────────────────────────────────────────────────────────────
let slOverrides = { drops: {}, superdrops: {}, cards: {} };
let slBaseHome = null;   // drop -> baseline superdrop (snapshot of sourced grouping)
let slBaseDate = null;   // superdrop -> baseline date

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATED ACTIONS — the hardening that gates community curation sync.
// Untrusted text (drop names, superdrop names, notes — soon other people's
// curation) must never be interpolated into inline JS: one missed escJs was
// arbitrary code with full window.api access. Elements carry
// data-slact="<action>" + data-arg="<value>" (plain HTML attributes, esc()'d
// like any text) and ONE document-level listener dispatches. escJs remains
// only where we mint the value ourselves.
// ─────────────────────────────────────────────────────────────────────────────
const SL_ACTIONS = {
  'open-drop':      a => { ui.slViewer.view = 'drops'; ui.slViewer.drop = a; ui.slViewer.page = 0; render(); },
  'open-superdrop': a => { ui.slViewer.superdrop = a; ui.slViewer.drop = ''; render(); },
  'card-modal':     a => showSlViewerModal(a),
  'edit-drop':      a => editSlDrop(a),
  'reset-drop':     a => resetSlDrop(a),
  'commit-drop':    a => commitSlDrop(a),
  'commit-note':    (a, el) => commitSlNote(el.dataset.bucket || 'cards', a),
  'price-singles':  a => priceSlDropSingles(a),
  'want-missing':   a => addDropMissingToWantList(a),
  'edit-sd-note':   a => editSlSuperdropNote(a),
  'edit-card-note': a => editSlCardNote(a),
  'toggle-want':    (a, el) => { toggleSlCardWant(a); el.innerHTML = isCardWanted(a) ? '★ On want list' : '☆ Add to want list'; },
  'add-owned':      a => { if (typeof window !== 'undefined' && window.showAddOwnedCardModal) window.showAddOwnedCardModal(a); },
  'open-printings': a => { if (typeof window !== 'undefined' && window.openPrintingsTab) window.openPrintingsTab(a); },
  'open-precon':    a => { hideModal(); ui.precons.line = ''; ui.precons.deck = a; ui.activeTab = 'precons'; render(); },
};

// Bound once at startup (renderer main.js); delegation on document reaches
// both re-rendered tab content and modal HTML.
export function initSlActionDispatch() {
  if (typeof document === 'undefined' || window.__slActionsBound) return;
  window.__slActionsBound = true;
  document.addEventListener('click', e => {
    const el = e.target.closest ? e.target.closest('[data-slact]') : null;
    if (!el) return;
    const fn = SL_ACTIONS[el.dataset.slact];
    if (!fn) return;
    e.preventDefault();
    e.stopPropagation();
    fn(el.dataset.arg ?? '', el);
  });
}

function captureSlBase() {
  if (slBaseHome) return;
  slBaseHome = {}; slBaseDate = {};
  if (typeof SL_SUPERDROPS === 'undefined') return;
  for (const sd of SL_SUPERDROPS) {
    slBaseDate[sd.superdrop] = sd.date;
    for (const d of sd.drops) slBaseHome[d] = sd.superdrop;
  }
}

// SL_SUPERDROPS + SL_DROP_TO_SUPERDROP = baseline grouping, with overrides applied.
function rebuildSlGrouping() {
  captureSlBase();
  if (typeof SL_SUPERDROPS === 'undefined') return;
  const home = { ...slBaseHome };
  // keep drops that appeared after the baseline (e.g. a refresh's "Recent Additions")
  for (const [drop, info] of Object.entries(SL_DROP_TO_SUPERDROP)) {
    if (!(drop in home)) home[drop] = info.superdrop;
  }
  // Group finish variants ("Garden Buds Rainbow Foil") under their base drop's
  // superdrop so the Explorer shows foil and non-foil versions together rather
  // than scattering the foil SKUs into "Recent Additions". Only names ending in a
  // recognized foil phrase regroup, so distinct drops that merely share a prefix
  // (e.g. "City Styles 2: Dressed to Kill") are left alone.
  const baseByLower = new Map(Object.keys(home).map(d => [d.toLowerCase(), d]));
  const FINISH_RE = /^(.+?)\s+(?:rainbow |confetti |galaxy |raised |etched |gilded |textured |surge |traditional |neon )?foil$/i;
  for (const drop of Object.keys(home)) {
    const m = drop.match(FINISH_RE);
    if (!m) continue;
    const base = baseByLower.get(m[1].toLowerCase());
    if (base && base !== drop && home[base]) home[drop] = home[base];
  }
  // Wiki grouping for drops the baked dataset doesn't know yet — fresh drops
  // that would otherwise pile into "Recent Additions" until the next re-bake.
  const wikiSdDate = {};
  for (const [drop, sdName] of Object.entries(home)) {
    if (sdName && sdName !== 'Recent Additions') continue;
    const g = slWikiGroupFor(drop);
    if (g && g.superdrop) {
      home[drop] = g.superdrop;
      if (g.date && (!wikiSdDate[g.superdrop] || g.date < wikiSdDate[g.superdrop])) wikiSdDate[g.superdrop] = g.date;
    }
  }
  // apply this user's reassignments
  for (const [drop, ov] of Object.entries(slOverrides.drops)) {
    if (ov && ov.superdrop) home[drop] = ov.superdrop;
  }
  const bySd = {};
  for (const [drop, sdName] of Object.entries(home)) {
    if (!bySd[sdName]) bySd[sdName] = { superdrop: sdName, date: slBaseDate[sdName] || wikiSdDate[sdName] || '', drops: [] };
    bySd[sdName].drops.push(drop);
  }
  const arr = Object.values(bySd).sort((a, b) =>
    (a.date || '9999').localeCompare(b.date || '9999') || a.superdrop.localeCompare(b.superdrop));
  arr.forEach(s => s.drops.sort());
  SL_SUPERDROPS.length = 0;
  arr.forEach(s => SL_SUPERDROPS.push(s));
  for (const k in SL_DROP_TO_SUPERDROP) delete SL_DROP_TO_SUPERDROP[k];
  for (const sd of SL_SUPERDROPS)
    for (const d of sd.drops) SL_DROP_TO_SUPERDROP[d] = { superdrop: sd.superdrop, date: sd.date };
}

// Called once at startup (main.js) after the static data + cache have loaded.
export async function loadSlOverrides() {
  try {
    const raw = await window.api?.settings?.get('sl_overrides');
    if (raw) {
      const o = JSON.parse(raw);
      slOverrides = { drops: o.drops || {}, superdrops: o.superdrops || {}, cards: o.cards || {} };
    }
  } catch (e) { window.logger?.warn?.('SL', `overrides load failed: ${e.message}`); }
  captureSlBase();
  rebuildSlGrouping();
}

async function persistSlOverrides() {
  try { await window.api?.settings?.set('sl_overrides', JSON.stringify(slOverrides)); }
  catch (e) { toast(`Couldn't save edit: ${e.message}`, 'error'); }
}

// set/clear a field on an override entry, pruning empty entries
function setOvField(bucket, key, field, value) {
  const store = slOverrides[bucket];
  const entry = store[key] || (store[key] = {});
  const isDefault = field === 'superdrop' && value === slBaseHome?.[key];
  if (value == null || value === '' || isDefault) delete entry[field];
  else entry[field] = value;
  if (Object.keys(entry).length === 0) delete store[key];
}

// getters used by the renderer
export function slDropNote(drop)     { return slOverrides.drops[drop]?.note || ''; }
export function slSuperdropNote(sd)   { return slOverrides.superdrops[sd]?.note || ''; }
export function slCardNote(id)        { return slOverrides.cards[id]?.note || ''; }
export function slDropEdited(drop)    { return !!slOverrides.drops[drop]; }

// ── Edit a drop: reassign superdrop + note ──────────────────────────────────
export function editSlDrop(drop) {
  const curSd  = SL_DROP_TO_SUPERDROP[drop]?.superdrop || '';
  const baseSd = slBaseHome?.[drop] || '';
  const note   = slDropNote(drop);
  const all    = [...new Set(SL_SUPERDROPS.map(s => s.superdrop))].sort();
  const pristine = (curSd === baseSd) && !note;
  showModal(`
    <h2 style="margin:0 0 4px">Edit drop</h2>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:18px">${esc(drop)} · saved only on this computer</div>
    <div class="form-group">
      <label>Superdrop <span style="color:var(--text-muted);font-weight:400">(type a new name to regroup, e.g. "Festival in a Box")</span></label>
      <input id="sl-ed-sd" list="sl-ed-sd-list" value="${esc(curSd)}" placeholder="Type or pick a superdrop…" autocomplete="off" style="width:100%">
      <datalist id="sl-ed-sd-list">${all.map(s => `<option value="${esc(s)}"></option>`).join('')}</datalist>
      ${baseSd && curSd !== baseSd ? `<div style="font-size:11px;color:var(--text-muted);margin-top:6px">Sourced grouping: ${esc(baseSd)}</div>` : ''}
    </div>
    <div class="form-group">
      <label>Note <span style="color:var(--text-muted);font-weight:400">(optional)</span></label>
      <textarea id="sl-ed-note" rows="3" style="width:100%;resize:vertical;font-family:inherit">${esc(note)}</textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:22px">
      <button class="btn btn-ghost btn-sm" data-slact="reset-drop" data-arg="${esc(drop)}"${pristine ? ' disabled' : ''}>↺ Reset to sourced</button>
      <div style="display:flex;gap:10px">
        <button class="btn" data-act="hideModal">Cancel</button>
        <button class="btn btn-primary" data-slact="commit-drop" data-arg="${esc(drop)}">Save</button>
      </div>
    </div>`);
}
export async function commitSlDrop(drop) {
  const sd  = document.getElementById('sl-ed-sd').value.trim();
  const note = document.getElementById('sl-ed-note').value.trim();
  if (!sd) { toast('Enter a superdrop name', 'error'); return; }
  setOvField('drops', drop, 'superdrop', sd);
  setOvField('drops', drop, 'note', note);
  rebuildSlGrouping();
  await persistSlOverrides();
  ui.slViewer.superdrop = SL_DROP_TO_SUPERDROP[drop]?.superdrop || '';
  hideModal(); render();
  toast('Saved on this computer', 'success');
}
export async function resetSlDrop(drop) {
  delete slOverrides.drops[drop];
  rebuildSlGrouping();
  await persistSlOverrides();
  ui.slViewer.superdrop = SL_DROP_TO_SUPERDROP[drop]?.superdrop || '';
  hideModal(); render();
  toast('Reverted to sourced grouping', 'info');
}

// ── Notes on a superdrop / a card ───────────────────────────────────────────
export function editSlSuperdropNote(sd) {
  showModal(`
    <h2 style="margin:0 0 4px">Superdrop note</h2>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">${esc(sd)} · saved only on this computer</div>
    <div class="form-group">
      <textarea id="sl-ed-note" rows="4" style="width:100%;resize:vertical;font-family:inherit" placeholder="Add a note…">${esc(slSuperdropNote(sd))}</textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn" data-act="hideModal">Cancel</button>
      <button class="btn btn-primary" data-slact="commit-note" data-bucket="superdrops" data-arg="${esc(sd)}">Save</button>
    </div>`);
}
export function editSlCardNote(id) {
  showModal(`
    <h2 style="margin:0 0 4px">Card note</h2>
    <div style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Saved only on this computer</div>
    <div class="form-group">
      <textarea id="sl-ed-note" rows="4" style="width:100%;resize:vertical;font-family:inherit" placeholder="Add a note…">${esc(slCardNote(id))}</textarea>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn" data-act="hideModal">Cancel</button>
      <button class="btn btn-primary" data-slact="commit-note" data-bucket="cards" data-arg="${esc(id)}">Save</button>
    </div>`);
}
export async function commitSlNote(bucket, key) {
  setOvField(bucket, key, 'note', document.getElementById('sl-ed-note').value.trim());
  await persistSlOverrides();
  hideModal(); render();
  toast('Saved on this computer', 'success');
}


// ─────────────────────────────────────────────────────────────────────────────
// SECRET LAIR VIEWER TAB
// ─────────────────────────────────────────────────────────────────────────────
export async function refreshSlData() {
  if (ui.slRefreshing) return;
  ui.slRefreshing = true;
  render();

  try {
    toast('Fetching Secret Lair data from MTGJSON… (may take a moment)', 'info', 10000);
    window.logger?.info('SL', 'Fetching MTGJSON SLD.json…');
    // Fetched via the main process — no CORS there, so no proxy fallbacks needed.
    const SLD_URL = 'https://mtgjson.com/api/v5/SLD.json';
    const resp = await netFetch(SLD_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from mtgjson.com`);
    const json = await resp.json();
    window.logger?.success('SL', 'Fetched SLD.json from mtgjson.com');
    // MTGJSON v5 set files are shaped as { data: { code, name, cards: [...], tokens: [...], ... } }
    // — the actual card list lives at data.cards, NOT Object.values(data).
    const cards = (json.data && Array.isArray(json.data.cards)) ? json.data.cards : [];
    if (!cards.length) throw new Error('No cards in MTGJSON response (data.cards was empty or missing)');
    window.logger?.info('SL', `Parsed ${cards.length.toLocaleString()} cards from MTGJSON`);

    // Build the finish-aware relational model: sealedProduct → deck contents
    // (per-entry isFoil) → exact printings, plus subsets coverage and the
    // collector-number backfill for orphaned ★ foils — all in slData.js. The
    // legacy name-keyed maps the renderer consumes are projections of it.
    // Known drop names only help restore canonical punctuation for products
    // whose base spelling MTGJSON's subsets don't cover.
    const knownDrops = typeof SL_DROP_TO_SUPERDROP !== 'undefined' ? Object.keys(SL_DROP_TO_SUPERDROP) : [];
    const model = buildSlModel(json, { knownDrops });
    const legacy = projectLegacy(model);

    // Make the refresh authoritative: clear the previous derived maps (including the
    // baked snapshot and the prior "Recent Additions" bucket) so a fresh fetch fully
    // redefines the drop set. Without this, names from older data or a previous
    // harvest strategy linger in memory as duplicates until the next restart.
    if (typeof SL_DROP_CARDS !== 'undefined') for (const k in SL_DROP_CARDS) delete SL_DROP_CARDS[k];
    if (typeof SL_SCRYFALL_TO_DROPS !== 'undefined') for (const k in SL_SCRYFALL_TO_DROPS) delete SL_SCRYFALL_TO_DROPS[k];
    if (typeof SL_SCRYFALL_TO_NAME !== 'undefined') for (const k in SL_SCRYFALL_TO_NAME) delete SL_SCRYFALL_TO_NAME[k];
    if (typeof SL_SUPERDROPS !== 'undefined') {
      const ri = SL_SUPERDROPS.findIndex(sd => sd.superdrop === 'Recent Additions');
      if (ri >= 0) SL_SUPERDROPS.splice(ri, 1);
    }
    applySlDataUpdate(legacy.dropCards, legacy.scryfallToDrops, legacy.scryfallToName);
    setSlProducts(model.products);   // finish-aware registry (ownership, P&L, pricing)
    await refreshSlWikiData({ silent: true });   // grouping + MSRPs + upcoming, before regrouping
    rebuildSlGrouping(); // re-apply this user's local grouping edits on top of the refreshed data
    await saveSlDataToCache(legacy.dropCards, legacy.scryfallToDrops, legacy.scryfallToName, model.products);

    const drops = Object.keys(legacy.dropCards).length;
    toast(`SL data updated — ${drops} drops, ${cards.length} cards`, 'success');
    window.logger?.success('SL', `Updated: ${model.products.length} products across ${drops} drops · ${cards.length.toLocaleString()} cards · ${Object.keys(legacy.scryfallToDrops).length.toLocaleString()} mapped printings`);
  } catch (e) {
    toast(`Failed to refresh SL data: ${e.message}`, 'error');
    window.logger?.error('SL', `Refresh failed: ${e.message}`);
  }

  ui.slRefreshing = false;
  render();
}
export function getDropsForSuperdrop(superdrop) {
  if (!superdrop || typeof SL_SUPERDROPS === 'undefined') return [];
  const sd = SL_SUPERDROPS.find(s => s.superdrop === superdrop);
  return sd ? [...sd.drops].sort() : [];
}

// Sort key for SLD collector numbers. Plain numerics ("1", "1485", foil "1485★")
// come first in numeric order (foil right after its base); prefixed specials like
// "IFIYW-1" sort after all numerics, grouped by prefix then number.
function slCollectorSortKey(num) {
  const s = String(num || '');
  const core = s.replace(/[★*]/g, '');
  const foil = /[★*]/.test(s) ? 1 : 0;
  const lead = core.match(/^(\d+)(.*)$/);                    // begins with digits → sort by that number
  if (lead) return { group: 0, n: parseInt(lead[1], 10), suffix: lead[2], prefix: '', foil, s };
  const pm = core.match(/^(.*?)(\d+)?$/);                    // letter-prefixed (IFIYW-1, SCTLR, VS) → after all numbers
  return { group: 1, prefix: (pm && pm[1]) || core, n: pm && pm[2] ? parseInt(pm[2], 10) : 0, suffix: '', foil, s };
}

// Shared card tile used by both the drop view and the collector-number view.
// numLabel (collector number) is shown only when provided.
// requiredFinish (optional, 'nonfoil'|'foil'|'etched') scopes the owned check
// to copies of that finish — a drop-detail tile for a Foil Edition SKU only
// lights up for foil copies. Omitted (collector view) = any finish counts.
// Exported: the Precon Explorer renders its decklists with the same tiles.
export function slCardTile(scryfallId, numLabel, requiredFinish) {
  const id = scryfallId.toLowerCase();
  const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
  const ownedPrintings = ownedCards().filter(c => c.scryfallId === scryfallId
    && (!requiredFinish || finishGroup(c.foil) === requiredFinish));
  const owned = ownedPrintings.length > 0;
  const totalQty = ownedPrintings.reduce((s, c) => s + (c.quantity || 1), 0);
  const val = owned ? cardCurrentValue(ownedPrintings[0]) : null;
  const note = slCardNote(scryfallId);
  const wanted = !owned && isCardWanted(scryfallId);
  return `
    <div class="gallery-card${owned ? ' sl-card-owned' : ' sl-card-missing'}${wanted ? ' sl-card-wanted' : ''}" data-sl-card="${esc(scryfallId)}"
      data-slact="card-modal" data-arg="${esc(scryfallId)}" title="${owned ? `Owned (qty: ${totalQty})` : (wanted ? 'On your want list' : 'Not in collection')}${numLabel ? ` · #${esc(numLabel)}` : ''}">
      <img src="${esc(img)}" alt="" loading="lazy"
        data-imgerr="hide-card"
        style="${owned ? '' : 'filter:grayscale(60%) brightness(0.65)'}">
      ${owned ? `<span class="sl-owned-badge">✓ ${totalQty}</span>` : (wanted ? `<span class="sl-want-badge">★</span>` : `<span class="sl-missing-badge">✗</span>`)}
      ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
      ${numLabel ? `<span style="position:absolute;bottom:4px;left:4px;background:rgba(0,0,0,.72);color:#fff;font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;pointer-events:none">#${esc(numLabel)}</span>` : ''}
      ${note ? `<span title="${esc(note)}" style="position:absolute;top:4px;left:4px;font-size:12px;pointer-events:none">📝</span>` : ''}
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DROP P&L
// Cost basis = MSRP paid. Secret Lair is bought as whole drops, so the default
// cost is the flat drop MSRP (≈$29.99 non-foil / $39.99 foil, configurable in
// Settings) — NOT the sum of cheap per-single purchase prices. A linked sealed
// product's actual purchase price overrides the default when present.
// Current value = market value of owned singles + still-sealed copies (opened
// boxes already became the singles). A drop is listed if you own ≥1 of its
// singles or any sealed product linked to it.
// ─────────────────────────────────────────────────────────────────────────────
function sealedMarketValue(item) {
  const h = item.priceHistory;
  return h?.length ? h[h.length - 1].price : (item.currentValue ?? null);
}

// Configurable flat MSRP defaults (Settings → Secret Lair P&L).
export function slMsrpDefault(foil) {
  const s = collection.settings || {};
  return foil ? (s.slMsrpFoil ?? 39.99) : (s.slMsrpNonfoil ?? 29.99);
}

export function computeDropPnL() {
  if (typeof SL_SCRYFALL_TO_DROPS === 'undefined') return [];
  const rows = {};
  const get = (drop) => {
    if (!rows[drop]) {
      const sd = (typeof SL_DROP_TO_SUPERDROP !== 'undefined' && SL_DROP_TO_SUPERDROP[drop]) || {};
      rows[drop] = {
        drop, superdrop: sd.superdrop || 'Standalone', date: sd.date || '',
        value: 0, singlesQty: 0, sealedQty: 0, openedQty: 0,
        sealedCost: 0, anyFoil: false,
      };
    }
    return rows[drop];
  };

  // Owned singles → the drop whose SKU actually contains this printing in
  // this finish (a foil copy of a shared printing lands on the Foil Edition,
  // not the base drop). Falls back to the primary legacy drop when the
  // product model doesn't know the pair (pre-model cache, unmapped cards).
  // Sold copies have left the collection, so they no longer count toward value.
  for (const c of ownedCards()) {
    if (!c.scryfallId) continue;
    const drops = SL_SCRYFALL_TO_DROPS[c.scryfallId];
    if (!drops || !drops.length) continue;
    const attributed = attributeDropFor(c.scryfallId, c.foil);
    const r = get(attributed && drops.includes(attributed) ? attributed : drops[0]);
    const v = cardCurrentValue(c);
    r.value += v ?? 0;
    r.singlesQty += c.quantity || 1;
    if (c.foil && c.foil !== 'normal') r.anyFoil = true;
  }

  // Linked sealed products: a real purchase price is the actual cost basis.
  // Include opened provenance rows here so actual product purchase cost remains
  // attached to the drop. Portfolio valuation excludes these rows separately to
  // avoid counting them alongside their generated cards.
  for (const s of (collection.sealed || []).filter(item => item.status !== 'sold')) {
    if (!s.dropName) continue;
    const r = get(s.dropName);
    const qty = s.quantity || 1;
    r.sealedCost += (s.purchasePrice || 0) * qty;
    if (s.status === 'sealed') {
      const mv = sealedMarketValue(s);
      if (mv != null) r.value += mv * qty;
      r.sealedQty += qty;
    } else {
      r.openedQty += qty;
    }
  }

  return Object.values(rows).map(r => {
    // Real linked-sealed cost wins; otherwise assume one drop bought at MSRP —
    // the wiki's actual per-drop MSRP (finish-aware: a Foil SKU costs the foil
    // column) when synced, the flat settings default as the last resort.
    const costIsDefault = !(r.sealedCost > 0);
    let cost = r.sealedCost;
    if (costIsDefault) {
      const wiki = slWikiMsrp(r.drop, dropFinish(r.drop));
      cost = wiki != null ? wiki : slMsrpDefault(r.anyFoil);
    }
    const gain = r.value - cost;
    return { ...r, cost, costIsDefault, gain, gainPct: cost > 0 ? (gain / cost) * 100 : null };
  });
}

function sortPnlRows(list) {
  const [field, dir] = (ui.slViewer.pnlSort || 'gainpct_desc').split('_');
  const mul = dir === 'asc' ? 1 : -1;
  const keyFns = { gainpct: r => r.gainPct, gain: r => r.gain, value: r => r.value, cost: r => r.cost, name: r => r.drop, date: r => r.date };
  const key = keyFns[field] || keyFns.gainpct;
  return [...list].sort((a, b) => {
    const av = key(a), bv = key(b);
    if (field === 'name' || field === 'date') return String(av).localeCompare(String(bv)) * mul;
    if (av == null && bv == null) return 0;
    if (av == null) return 1;   // nulls always last
    if (bv == null) return -1;
    return (av - bv) * mul;
  });
}

// Toggle sort field/direction for the P&L ledger (exposed on window via main.js).
export function sortSlPnl(field) {
  const [curField, curDir] = (ui.slViewer.pnlSort || '').split('_');
  ui.slViewer.pnlSort = `${field}_${curField === field && curDir === 'desc' ? 'asc' : 'desc'}`;
  render();
}

// ─────────────────────────────────────────────────────────────────────────────
// SECRET LAIR INDEX — your Secret Lair holdings treated as an asset class.
// Aggregates the per-drop P&L ledger into a portfolio headline (cost → value →
// unrealized + realized → total return), a best/worst leaderboard, an ROI
// distribution, and a sealed crack-vs-keep rollup. Pure compute over
// computeDropPnL() + realized sold-SL items; the over-time curve lives in the
// SecretLairIndex dashboard panel (fed by portfolio_snapshots.sl_value/sl_cost).
// ─────────────────────────────────────────────────────────────────────────────
function isSlSoldCard(c) {
  return c.scryfallId && typeof SL_SCRYFALL_TO_DROPS !== 'undefined' && !!SL_SCRYFALL_TO_DROPS[c.scryfallId];
}
function isSlSoldSealed(s) {
  return !!s.dropName || s.productType === 'Secret Lair';
}

// Drops you currently hold at least one *sealed* (unopened) copy of.
function sealedHeldDrops() {
  const set = new Set();
  for (const s of ownedSealed()) {
    if (s.dropName && s.status === 'sealed') set.add(s.dropName);
  }
  return [...set];
}

export function computeSlIndex() {
  const rows  = computeDropPnL();                       // owned-only, per drop
  const cost  = rows.reduce((s, r) => s + (r.cost  || 0), 0);
  const value = rows.reduce((s, r) => s + (r.value || 0), 0);
  const unrealized    = value - cost;
  const unrealizedPct = cost > 0 ? (unrealized / cost) * 100 : null;

  // Realized SL P&L — sold singles that map to an SL drop + sold sealed linked
  // to a drop (or marked as a Secret Lair product).
  let realized = 0, realizedCount = 0;
  for (const c of soldCards())  { if (isSlSoldCard(c))   { realized += entryRealized(c).gain; realizedCount++; } }
  for (const s of soldSealed()) { if (isSlSoldSealed(s)) { realized += entryRealized(s).gain; realizedCount++; } }

  const totalReturn    = unrealized + realized;
  const totalCost      = cost;                          // cost basis of what you still hold
  const totalReturnPct = totalCost > 0 ? (totalReturn / totalCost) * 100 : null;

  // Best / worst by ROI% (drops with a computable percentage), de-duplicated so
  // a tiny collection doesn't show the same drop as both best and worst.
  const ranked  = rows.filter(r => r.gainPct != null).sort((a, b) => b.gainPct - a.gainPct);
  const best    = ranked.slice(0, 3);
  const bestSet = new Set(best.map(r => r.drop));
  const worst   = ranked.slice().reverse().filter(r => !bestSet.has(r.drop)).slice(0, 2);

  // ROI distribution buckets.
  const buckets = [
    { label: 'Loss',    cls: 'neg', test: p => p < 0,             count: 0 },
    { label: '0–50%',   cls: 'pos', test: p => p >= 0 && p < 50,  count: 0 },
    { label: '50–100%', cls: 'pos', test: p => p >= 50 && p < 100, count: 0 },
    { label: '100%+',   cls: 'pos', test: p => p >= 100,          count: 0 },
  ];
  let withPct = 0;
  for (const r of rows) {
    if (r.gainPct == null) continue;
    withPct++;
    const b = buckets.find(x => x.test(r.gainPct));
    if (b) b.count++;
  }
  const winners = rows.filter(r => r.gainPct != null && r.gainPct >= 0).length;

  // Sealed crack-vs-keep rollup — uses already-priced singles from the in-memory
  // cache (the "Price sealed singles" button fills it on demand; no auto-fetch).
  const heldDrops = sealedHeldDrops();
  let keepTotal = 0, crackTotal = 0, pricedCount = 0;
  for (const drop of heldDrops) {
    const k = sealedKeepValue(drop);
    if (k && k.value != null) keepTotal += k.value;
    const cached = slDropSinglesCache.get(drop);
    if (cached) { crackTotal += cached.value; pricedCount++; }
  }

  return {
    dropCount: rows.length, cost, value, unrealized, unrealizedPct,
    realized, realizedCount, totalReturn, totalReturnPct,
    best, worst, buckets, withPct, winners,
    crackVsKeep: { heldCount: heldDrops.length, pricedCount, keepTotal, crackTotal, drops: heldDrops },
  };
}

// Price every held-sealed drop's singles (sequential, on demand) so the
// crack-vs-keep rollup can compare. Bound to the Index view's button.
export async function priceAllSealedDropsSingles() {
  for (const drop of sealedHeldDrops()) {
    if (slDropSinglesCache.has(drop)) continue;
    await priceSlDropSingles(drop);   // each call re-renders on completion
  }
}

// The Index view body (headline → leaderboard → distribution → crack-vs-keep).
function renderSlIndexBody(idx) {
  if (idx.dropCount === 0) {
    return `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      No Secret Lair P&amp;L yet.<br>Own singles from a drop, or add a sealed drop with its purchase price, to see your index.
    </div>`;
  }
  const gc   = (n) => n == null ? 'var(--text-muted)' : (n >= 0 ? 'var(--green)' : '#f87171');
  const sign = (n) => n >= 0 ? '+' : '';
  const pct  = (n) => n == null ? '' : `${sign(n)}${n.toFixed(0)}%`;

  const card = (label, valueHtml, subHtml = '', accent = false) => `
    <div style="flex:1 1 130px;min-width:120px;background:${accent ? 'var(--green-dim)' : 'var(--surface)'};border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:4px">${label}</div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-.02em">${valueHtml}</div>
      ${subHtml ? `<div style="font-size:11px;margin-top:2px">${subHtml}</div>` : ''}
    </div>`;

  const headline = `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">
      ${card('MSRP paid', fmt(idx.cost))}
      ${card('Current value', fmt(idx.value))}
      ${card('Unrealized', `<span style="color:${gc(idx.unrealized)}">${sign(idx.unrealized)}${fmt(idx.unrealized)}</span>`,
              `<span style="color:${gc(idx.unrealizedPct)}">${pct(idx.unrealizedPct)}</span>`)}
      ${card('Realized', `<span style="color:${gc(idx.realized)}">${idx.realizedCount ? sign(idx.realized) + fmt(idx.realized) : '—'}</span>`,
              `<span style="color:var(--text-muted)">${idx.realizedCount} sale${idx.realizedCount === 1 ? '' : 's'}</span>`)}
      ${card('Total SL return', `<span style="color:${gc(idx.totalReturn)}">${sign(idx.totalReturn)}${fmt(idx.totalReturn)}</span>`,
              `<span style="color:${gc(idx.totalReturnPct)}">${pct(idx.totalReturnPct)} on cost</span>`, true)}
    </div>`;

  const dropLink = (r) => `<a class="bc-link" data-slact="open-drop" data-arg="${esc(r.drop)}" style="font-weight:600">${esc(r.drop)}</a>`;
  const lbRow = (r) => `
    <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:5px 0">
      <div style="min-width:0">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px">${dropLink(r)}</div>
        <div style="font-size:11px;color:var(--text-muted)">${esc(r.superdrop || 'Standalone')}</div>
      </div>
      <div style="text-align:right;white-space:nowrap">
        <span style="font-weight:700;color:${gc(r.gainPct)}">${pct(r.gainPct)}</span>
        <div style="font-size:11px;color:var(--text-muted)">${sign(r.gain)}${fmt(r.gain)}</div>
      </div>
    </div>`;

  const leaderboard = `
    <div style="flex:1 1 280px;min-width:240px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">🏆 Best &amp; worst drops</div>
      ${idx.best.map(lbRow).join('')}
      ${idx.worst.length ? `<div style="border-top:1px solid var(--border);margin:6px 0"></div>${idx.worst.map(lbRow).join('')}` : ''}
    </div>`;

  const maxBucket = Math.max(1, ...idx.buckets.map(b => b.count));
  const distRow = (b) => `
    <div style="display:flex;align-items:center;gap:8px;margin:7px 0">
      <span style="font-size:12px;width:62px;color:var(--text-muted)">${b.label}</span>
      <div style="flex:1;height:10px;background:var(--surface2);border-radius:5px;overflow:hidden">
        <div style="width:${(b.count / maxBucket * 100).toFixed(0)}%;height:100%;background:${b.cls === 'neg' ? '#f87171' : 'var(--green)'};opacity:${b.cls === 'neg' ? .7 : .85}"></div>
      </div>
      <span style="font-size:12px;width:20px;text-align:right">${b.count}</span>
    </div>`;
  const distribution = `
    <div style="flex:1 1 280px;min-width:240px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 14px">
      <div style="font-size:13px;font-weight:700;margin-bottom:8px">📊 ROI distribution</div>
      ${idx.buckets.map(distRow).join('')}
      <div style="font-size:11px;color:var(--text-muted);margin-top:8px">${idx.dropCount} drops engaged · ${idx.winners} up, ${idx.withPct - idx.winners} down</div>
    </div>`;

  // Crack-vs-keep rollup across sealed-held drops.
  const cvk = idx.crackVsKeep;
  let crackKeep = '';
  if (cvk.heldCount > 0) {
    const allPriced = cvk.pricedCount >= cvk.heldCount;
    const verdict = !allPriced ? ''
      : cvk.crackTotal > cvk.keepTotal
        ? `<span style="margin-left:auto;color:var(--green);font-weight:600">Cracking wins by ${fmt(cvk.crackTotal - cvk.keepTotal)}</span>`
        : `<span style="margin-left:auto;color:var(--text);font-weight:600">Keeping wins by ${fmt(cvk.keepTotal - cvk.crackTotal)}</span>`;
    crackKeep = `
      <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-top:14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:12px 16px">
        <span style="font-size:13px;font-weight:700">📦 ${cvk.heldCount} sealed drop${cvk.heldCount === 1 ? '' : 's'} held</span>
        <span style="font-size:13px;color:var(--text-muted)">Keep <strong style="color:var(--text)">${fmt(cvk.keepTotal)}</strong></span>
        <span style="font-size:13px;color:var(--text-muted)">Crack ${cvk.pricedCount ? `<strong style="color:var(--text)">${fmt(cvk.crackTotal)}</strong>` : '<span style="color:var(--text-muted)">— not priced</span>'}</span>
        ${allPriced ? verdict : `<button class="btn btn-ghost" style="font-size:12px;margin-left:auto" data-act="priceAllSealedDropsSingles">Price sealed singles (${cvk.heldCount - cvk.pricedCount} left)</button>`}
      </div>`;
  }

  return `${headline}
    <div style="display:flex;gap:12px;flex-wrap:wrap">${leaderboard}${distribution}</div>
    ${crackKeep}
    <div style="font-size:11px;color:var(--text-muted);margin-top:14px;text-align:center">
      📈 The Secret Lair value-over-time chart lives on your Dashboard (“Secret Lair Index” panel).
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CRACK OR KEEP (Phase 2) — for a drop you hold sealed, compare the sealed market
// value ("keep") against the current sum-of-singles if you opened it ("crack").
// Singles for an unopened drop usually aren't in your collection, so their prices
// are fetched on demand from Scryfall and cached in memory (not price history).
// ─────────────────────────────────────────────────────────────────────────────
const slDropSinglesCache = new Map();  // drop -> { value, priced, names, at }
const slDropPricing = new Set();        // drops with a fetch in flight

// "Keep" value: market value of still-sealed copies of this drop you hold.
// Returns { value, qty } (value null if held but never price-looked-up), or null.
export function sealedKeepValue(drop) {
  let value = 0, qty = 0, hasPrice = false;
  for (const s of (collection.sealed || [])) {
    if (s.dropName !== drop || s.status !== 'sealed') continue;
    qty += s.quantity || 1;
    const mv = sealedMarketValue(s);
    if (mv != null) { value += mv * (s.quantity || 1); hasPrice = true; }
  }
  if (!qty) return null;
  return { value: hasPrice ? value : null, qty };
}

// Which Scryfall finish a drop's singles should be valued at. The product
// model knows each SKU's real finish (from MTGJSON deck contents); the name
// regex only remains as a fallback for pre-model cached data.
export function dropFinish(drop) {
  const modelFinish = slDropModelFinish(drop);
  if (modelFinish) return modelFinish === 'nonfoil' ? 'normal' : modelFinish;
  if (/\betched\b/i.test(drop)) return 'etched';
  if (/\bfoil$/i.test(drop)) return 'foil';
  return 'normal';
}

// Pure aggregation: sum a drop's singles, deduped per card name. `finish` chooses
// which Scryfall price to prefer ('foil' → usd_foil, 'etched' → usd_etched, else
// non-foil usd), each falling back to the other finishes when the preferred price
// is missing (e.g. a foil-only card in a non-foil drop).
export function sumDropSingles(cards, finish = 'normal') {
  const order = finish === 'foil' ? ['usd_foil', 'usd', 'usd_etched']
    : finish === 'etched' ? ['usd_etched', 'usd_foil', 'usd']
    : ['usd', 'usd_foil', 'usd_etched'];
  const byName = {};
  for (const card of (cards || [])) {
    const p = card.prices || {};
    let val = NaN;
    for (const k of order) { const v = parseFloat(p[k]); if (!isNaN(v)) { val = v; break; } }
    if (isNaN(val)) continue;
    const name = card.name || card.id;
    byName[name] = Math.max(byName[name] ?? 0, val);
  }
  return { value: Object.values(byName).reduce((a, b) => a + b, 0), priced: Object.keys(byName).length };
}

// Fetch + cache the sum-of-singles for a drop (Scryfall batch, on demand).
export async function priceSlDropSingles(drop) {
  if (slDropPricing.has(drop)) return;
  const ids = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined' && SL_DROP_TO_SCRYFALL_IDS[drop]) || [];
  if (!ids.length) { toast('No cards are mapped to this drop yet — try "Check for New Cards".', 'info'); return; }
  slDropPricing.add(drop);
  render();
  try {
    const uniq = [...new Set(ids.map(id => id.toLowerCase()))];
    const cards = [];
    for (let i = 0; i < uniq.length; i += 75) {
      const data = await fetchScryfallBatch(uniq.slice(i, i + 75));
      for (const c of (data.data || [])) cards.push(c);
    }
    const { value, priced } = sumDropSingles(cards, dropFinish(drop));
    const totalNames = (typeof SL_DROP_CARDS !== 'undefined' && SL_DROP_CARDS[drop]?.length) || priced;
    slDropSinglesCache.set(drop, { value, priced, names: totalNames, at: Date.now() });
  } catch (e) {
    toast(`Couldn't price singles: ${e.message}`, 'error');
  } finally {
    slDropPricing.delete(drop);
    render();
  }
}

// Best-effort current sealed-box price for a drop: a linked sealed product's
// price if you have one; else an *exact* TCGplayer-id join into the synced
// TCGCSV index (the product model carries each SKU's tcgplayerProductId);
// else the fuzzy name match as a last resort.
function sealedPriceForDrop(drop) {
  for (const s of ownedSealed()) {
    if (s.dropName === drop) { const mv = sealedMarketValue(s); if (mv != null) return { price: mv, source: 'linked' }; }
  }
  try {
    const product = slProductForDrop(drop);
    if (product && product.tcgplayerProductId) {
      const wanted = String(product.tcgplayerProductId);
      const hit = (tcgcsvCache.sealedProducts || []).find(p => String(p.productId ?? '') === wanted);
      if (hit && hit.marketPrice != null) return { price: hit.marketPrice, source: 'tcgcsv', name: hit.name };
    }
    const hit = (searchTcgcsvLocal(drop, 1) || [])[0];
    if (hit && hit.marketPrice != null) return { price: hit.marketPrice, source: 'tcgcsv', name: hit.name };
  } catch { /* cache not synced */ }
  return null;
}

// "Singles vs. Sealed" economics for the drop detail page — compare the drop as a
// sealed box against the sum of its individual cards. Frames the verdict as
// crack-or-keep when you hold it sealed, or cheapest-to-complete otherwise.
function dropEconomicsBanner(drop) {
  const held = sealedKeepValue(drop);          // you hold ≥1 sealed copy?
  const sealed = sealedPriceForDrop(drop);     // { price, source } | null
  const crack = slDropSinglesCache.get(drop);  // cached singles total | undefined
  const pricing = slDropPricing.has(drop);

  const singlesCell = pricing
    ? `<span style="color:var(--text-muted)">⏳ Pricing…</span>`
    : crack
      ? `<strong style="color:var(--text)">${fmt(crack.value)}</strong> <span style="font-size:11px;color:var(--text-muted)">(${crack.priced}/${crack.names} cards)</span>
         <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px;margin-left:4px" data-slact="price-singles" data-arg="${esc(drop)}">↻</button>`
      : `<button class="btn btn-sm" data-slact="price-singles" data-arg="${esc(drop)}">💰 Price the singles</button>`;

  const sealedCell = sealed
    ? `<strong style="color:var(--text)">${fmt(sealed.price)}</strong>${sealed.source === 'tcgcsv' ? ` <span style="font-size:11px;color:var(--text-muted)" title="${esc(sealed.name || '')}">≈ TCGCSV</span>` : ''}`
    : `<span style="color:var(--text-muted)">— <span style="font-size:11px">(sync TCGCSV, or add &amp; link the sealed product)</span></span>`;

  let verdict = '';
  if (crack && sealed) {
    const diff = crack.value - sealed.price;   // singles minus one sealed box
    const pct = sealed.price > 0 ? Math.round(Math.abs(diff) / sealed.price * 100) : null;
    const amt = `${fmt(Math.abs(diff))}${pct != null ? ` (${pct}%)` : ''}`;
    if (held) {
      verdict = diff >= 0
        ? `<div style="margin-top:8px;font-weight:700;color:var(--green)">✂️ Crack it — the singles are worth ${amt} more than the sealed box.</div>`
        : `<div style="margin-top:8px;font-weight:700;color:var(--text)">📦 Keep it sealed — the box carries a ${amt} premium over its singles.</div>`;
    } else {
      verdict = diff >= 0
        ? `<div style="margin-top:8px;font-weight:700;color:var(--text)">📦 To complete this drop, the sealed box is cheaper by ${amt}.</div>`
        : `<div style="margin-top:8px;font-weight:700;color:var(--green)">🃏 To complete this drop, buying the singles is cheaper by ${amt}.</div>`;
    }
  }

  return `
    <div style="margin:0 0 12px;padding:11px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px">
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700;color:var(--text)">💎 ${held ? 'Crack or Keep' : 'Singles vs. Sealed'}</span>
        ${held ? `<span style="color:var(--text-muted);font-size:12px">You hold ${held.qty} sealed</span>` : ''}
        <span style="margin-left:auto"><span style="color:var(--text-muted)">As singles</span> ${singlesCell}</span>
        <span><span style="color:var(--text-muted)">As sealed box</span> ${sealedCell}</span>
      </div>
      ${verdict}
    </div>`;
}

export function renderSlViewer() {
  const sv = ui.slViewer;
  const hasSl = typeof SL_SUPERDROPS !== 'undefined' && typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined';
  if (!hasSl) return `<div style="padding:40px;text-align:center;color:var(--text-muted)">Secret Lair data not loaded.</div>`;

  const ownedIds = new Set(ownedCards().map(c => c.scryfallId).filter(Boolean));
  // (scryfallId, finish) pairs — the finish-aware ownership key. A drop whose
  // SKU requires foil copies only counts foil copies as owned.
  const ownedFinishKeys = new Set(ownedCards().filter(c => c.scryfallId)
    .map(c => `${c.scryfallId}|${finishGroup(c.foil)}`));
  // Finish-aware per-drop ownership: the model says which finish this drop
  // needs for this printing; no opinion → finish-blind (today's behavior).
  const ownsInDrop = (drop, id) => {
    const required = requiredFinishFor(drop, id);
    return required ? ownedFinishKeys.has(`${id}|${required}`) : ownedIds.has(id);
  };
  // SLD-set names the user owns somewhere — only used as a *drop count* fallback
  // for the rare case where a drop's card list contains a name that has no
  // scryfallIds tagged to it at all (MTGJSON data gap).
  const ownedSldNames = new Set(
    ownedCards()
      .filter(c => (c.setCode || '').toUpperCase() === 'SLD' && c.name)
      .map(c => c.name)
  );

  // Drop-specific count: a name in the drop is "owned" if either
  //   (a) user has a direct scryfallId match on any tile of that name in this drop, OR
  //   (b) no tile of that name exists in the drop's ID list AND user has the name in SLD.
  // Crucially: owning the same card name in a *different* drop does NOT credit this drop.
  const dropOwnedNameStats = (drop) => {
    const names = SL_DROP_CARDS[drop] || [];
    const idsInDrop = SL_DROP_TO_SCRYFALL_IDS[drop] || [];

    // Names with at least one tile that the user owns by direct ID match
    const directMatchedNames = new Set();
    // Names that have any tile in this drop (so we can detect data-gap cases)
    const namesWithTiles = new Set();
    for (const id of idsInDrop) {
      const n = SL_SCRYFALL_TO_NAME?.[id];
      if (!n) continue;
      namesWithTiles.add(n);
      if (ownsInDrop(drop, id)) directMatchedNames.add(n);
    }

    let owned = 0;
    for (const name of names) {
      if (directMatchedNames.has(name)) { owned++; continue; }
      // Data-gap fallback: drop says this card belongs but no tile maps to it
      if (!namesWithTiles.has(name) && ownedSldNames.has(name)) owned++;
    }
    return { owned, total: names.length };
  };
  const superdrops = SL_SUPERDROPS.map(sd => sd.superdrop);

  const cacheInfo = typeof getSlCacheInfo === 'function' ? getSlCacheInfo() : null;
  const lastUpdated = cacheInfo?.updatedAt
    ? `Last updated ${new Date(cacheInfo.updatedAt).toLocaleDateString()}`
    : 'Using built-in dataset';
  const refreshBtn = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:12px;color:var(--text-muted);flex:1">${esc(lastUpdated)}</span>
      <button class="btn btn-ghost" style="font-size:12px;white-space:nowrap"
        title="Re-fetches the latest Secret Lair card lists from MTGJSON. Superdrop groupings come from the built-in dataset — edit those with the ✎ buttons below; brand-new drops land under 'Recent Additions' until the dataset is rebuilt."
        data-act="refreshSlData" ${ui.slRefreshing ? 'disabled' : ''}>
        ${ui.slRefreshing ? '⏳ Checking…' : '↻ Check for New Cards'}
      </button>
    </div>`;

  function sdSelect() {
    return `<select data-act="ui-set" data-path="slViewer.superdrop" data-also="slViewer.drop=;slViewer.page=0">
      <option value="">All Superdrops</option>
      ${superdrops.map(sd => `<option value="${esc(sd)}"${sv.superdrop===sd?' selected':''}>${esc(sd)}</option>`).join('')}
    </select>`;
  }

  function dropSelect(drops) {
    return `<select data-act="ui-set" data-path="slViewer.drop" data-also="slViewer.page=0">
      <option value="">All Drops</option>
      ${drops.map(d => `<option value="${esc(d)}"${sv.drop===d?' selected':''}>${esc(d)}</option>`).join('')}
    </select>`;
  }

  // Breadcrumb shown above the toolbar — clickable segments walk back up the
  // hierarchy. Last segment is the current page (not clickable, accent color).
  function breadcrumb() {
    const root = `<a class="bc-link" data-act="ui-set" data-path="slViewer.superdrop" data-val="" data-also="slViewer.drop=;slViewer.page=0">Secret Lair Explorer</a>`;
    const sep = `<span class="bc-sep">›</span>`;
    if (sv.drop) {
      const sdSeg = sv.superdrop
        ? `<a class="bc-link" data-act="ui-set" data-path="slViewer.drop" data-val="" data-also="slViewer.page=0">${esc(sv.superdrop)}</a>`
        : '';
      return `<nav class="sl-breadcrumb">${root}${sv.superdrop ? sep + sdSeg : ''}${sep}<span class="bc-current">${esc(sv.drop)}</span></nav>`;
    }
    if (sv.superdrop) {
      return `<nav class="sl-breadcrumb">${root}${sep}<span class="bc-current">${esc(sv.superdrop)}</span></nav>`;
    }
    return `<nav class="sl-breadcrumb"><span class="bc-current">Secret Lair Explorer</span></nav>`;
  }

  // Sort + search bar shown above the grid on landing & superdrop views
  function sortSearchBar() {
    const opts = [
      ['date_desc', 'Date ↓ (newest first)'],
      ['date_asc',  'Date ↑ (oldest first)'],
      ['name_asc',  'Name A→Z'],
      ['name_desc', 'Name Z→A'],
    ];
    return `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <input type="text" id="slSearchInput" placeholder="Search drops, superdrops, cards, or notes…"
          value="${esc(sv.search || '')}"
          data-act="ui-set" data-path="slViewer.search" data-also="slViewer.page=0" data-refocus="slSearchInput"
          style="flex:1;min-width:200px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
        ${sv.search ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" data-act="ui-set" data-path="slViewer.search" data-val="">✕</button>` : ''}
        <span style="color:var(--text-muted);font-size:11px;white-space:nowrap">Sort:</span>
        <select data-act="ui-set" data-path="slViewer.sort" style="font-size:12px">
          ${opts.map(([v, label]) => `<option value="${v}"${sv.sort===v?' selected':''}>${label}</option>`).join('')}
        </select>
      </div>`;
  }

  // Helpers for sorting + searching
  function sortSuperdrops(list) {
    const arr = [...list];
    const dir = sv.sort.endsWith('_desc') ? -1 : 1;
    if (sv.sort.startsWith('date')) {
      arr.sort((a, b) => (a.date || '').localeCompare(b.date || '') * dir);
    } else {
      arr.sort((a, b) => a.superdrop.localeCompare(b.superdrop) * dir);
    }
    return arr;
  }
  function sortDrops(list) {
    const arr = [...list];
    const dir = sv.sort.endsWith('_desc') ? -1 : 1;
    // Drops don't have their own dates — sort alphabetically when "by date" is chosen too
    arr.sort((a, b) => a.localeCompare(b) * dir);
    return arr;
  }
  // Returns true if a drop matches the current search query (by drop name or
  // any of its card names).
  function dropMatchesSearch(drop, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (drop.toLowerCase().includes(q)) return true;
    if (slDropNote(drop).toLowerCase().includes(q)) return true;
    const cards = SL_DROP_CARDS[drop] || [];
    if (cards.some(c => c.toLowerCase().includes(q))) return true;
    // card-level notes on any printing in this drop
    const ids = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined' && SL_DROP_TO_SCRYFALL_IDS[drop]) || [];
    return ids.some(id => slCardNote(id).toLowerCase().includes(q));
  }
  function superdropMatchesSearch(sd, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (sd.superdrop.toLowerCase().includes(q)) return true;
    if (slSuperdropNote(sd.superdrop).toLowerCase().includes(q)) return true;
    return (sd.drops || []).some(d => dropMatchesSearch(d, q));
  }

  // View toggle — hierarchical "by superdrop" vs. flat "by collector number"
  function viewToggle() {
    const v = sv.view || 'drops';
    const b = (id, label) => `<button class="btn ${v === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px" data-act="ui-set" data-path="slViewer.view" data-val="${id}" data-also="slViewer.page=0">${label}</button>`;
    return `<div style="display:flex;gap:8px;margin-bottom:12px">${b('drops', '📦 By Superdrop')}${b('collector', '🔢 By Collector №')}${b('pnl', '💰 P&L')}${b('index', '📈 Index')}</div>`;
  }

  // Collector-number view — flat gallery of every SLD printing, ordered by number
  if ((sv.view || 'drops') === 'collector') {
    const numbers = typeof SL_SCRYFALL_TO_NUMBER !== 'undefined' ? SL_SCRYFALL_TO_NUMBER : {};
    let list = Object.keys(SL_SCRYFALL_TO_NAME).map(id => {
      const num = String(numbers[id] || '');
      return { id, num, key: slCollectorSortKey(num) };
    });
    const q = (sv.search || '').toLowerCase().trim();
    if (q) list = list.filter(c =>
      c.num.toLowerCase().includes(q) ||
      (SL_SCRYFALL_TO_NAME[c.id] || '').toLowerCase().includes(q) ||
      slCardNote(c.id).toLowerCase().includes(q));
    list.sort((a, b) => {
      const ka = a.key, kb = b.key;
      if (ka.group !== kb.group) return ka.group - kb.group;           // digit-leading numbers before letter-prefixed specials
      if (ka.group === 0) return ka.n - kb.n || ka.suffix.localeCompare(kb.suffix) || ka.foil - kb.foil || ka.s.localeCompare(kb.s);
      return ka.prefix.localeCompare(kb.prefix) || ka.n - kb.n || ka.foil - kb.foil || ka.s.localeCompare(kb.s);
    });
    const ownedN = list.reduce((n, c) => n + (ownedIds.has(c.id) ? 1 : 0), 0);
    const v = sv.view || 'drops';
    const tb = (id, label) => `<button class="btn ${v === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;white-space:nowrap" data-act="ui-set" data-path="slViewer.view" data-val="${id}" data-also="slViewer.page=0">${label}</button>`;
    // One merged control bar: view toggle + search + owned count, all on a single row.
    const headerBar = `
      <div style="display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <div style="display:flex;gap:6px;flex-shrink:0">${tb('drops', '📦 By Superdrop')}${tb('collector', '🔢 By Collector №')}${tb('pnl', '💰 P&L')}${tb('index', '📈 Index')}</div>
        <input type="text" id="slSearchInput" placeholder="Search by collector number, card name, or note…"
          value="${esc(sv.search || '')}"
          data-act="ui-set" data-path="slViewer.search" data-refocus="slSearchInput"
          style="flex:1;min-width:160px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
        ${sv.search ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" data-act="ui-set" data-path="slViewer.search" data-val="">✕</button>` : ''}
        <span style="color:var(--text-muted);font-size:12px;white-space:nowrap;flex-shrink:0">${ownedN.toLocaleString()} / ${list.length.toLocaleString()} owned</span>
      </div>`;
    // Fixed header + its own scroll region: the merged bar never moves and nothing
    // can peek above it. The gallery loads every printing at once (no pagination);
    // lazy <img loading="lazy"> means only on-screen tiles actually fetch.
    return `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="flex:0 0 auto;background:var(--bg);padding-bottom:10px;box-shadow:0 6px 10px -8px rgba(0,0,0,.55)">
          ${headerBar}
        </div>
        <div style="flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;padding-top:10px">
          <div class="gallery-grid">
            ${list.map(c => slCardTile(c.id, c.num)).join('')}
          </div>
        </div>
      </div>`;
  }

  // Secret Lair Index — portfolio headline + leaderboard + distribution
  if (sv.view === 'index') {
    const tbi = (id, label) => `<button class="btn ${sv.view === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;white-space:nowrap" data-act="ui-set" data-path="slViewer.view" data-val="${id}" data-also="slViewer.page=0">${label}</button>`;
    const idxHeader = `
      <div style="display:flex;gap:6px;align-items:center;padding:8px 12px;margin-bottom:14px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        ${tbi('drops', '📦 By Superdrop')}${tbi('collector', '🔢 By Collector №')}${tbi('pnl', '💰 P&L')}${tbi('index', '📈 Index')}
      </div>`;
    return idxHeader + renderSlIndexBody(computeSlIndex());
  }

  // P&L ledger — per-drop MSRP paid vs current value, sortable
  if (sv.view === 'pnl') {
    const rows = sortPnlRows(computeDropPnL());
    const v = sv.view;
    const tb = (id, label) => `<button class="btn ${v === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px;white-space:nowrap" data-act="ui-set" data-path="slViewer.view" data-val="${id}" data-also="slViewer.page=0">${label}</button>`;
    const tot = rows.reduce((a, r) => { a.cost += r.cost; a.value += r.value; return a; }, { cost: 0, value: 0 });
    const totGain = tot.value - tot.cost;
    const totPct = tot.cost > 0 ? (totGain / tot.cost * 100) : null;
    const [sf, sdir] = (sv.pnlSort || 'gainpct_desc').split('_');
    const arrow = (f) => sf === f ? (sdir === 'asc' ? ' ↑' : ' ↓') : '';
    const gcol = (n) => n == null ? 'var(--text-muted)' : (n >= 0 ? 'var(--green)' : '#f87171');
    const money = (n) => (n == null || n === 0) ? '—' : fmt(n);
    const pct = (n) => n == null ? '—' : `${n >= 0 ? '+' : ''}${n.toFixed(0)}%`;
    const best = rows.filter(r => r.gainPct != null).sort((a, b) => b.gainPct - a.gainPct)[0];

    const headerBar = `
      <div style="display:flex;gap:10px;align-items:center;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <div style="display:flex;gap:6px;flex-shrink:0">${tb('drops', '📦 By Superdrop')}${tb('collector', '🔢 By Collector №')}${tb('pnl', '💰 P&L')}${tb('index', '📈 Index')}</div>
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">
          ${rows.length} drop${rows.length !== 1 ? 's' : ''} · paid <strong style="color:var(--text)">${money(tot.cost)}</strong> · now <strong style="color:var(--text)">${money(tot.value)}</strong> ·
          <strong style="color:${gcol(totGain)}">${totGain >= 0 ? '+' : ''}${fmt(totGain)}${totPct != null ? ` (${pct(totPct)})` : ''}</strong>
        </span>
      </div>`;

    const th = (field, label, align = 'right') => `<th data-act="sortSlPnl" data-arg="${field}" style="cursor:pointer;text-align:${align};padding:8px 10px;position:sticky;top:0;background:var(--bg);white-space:nowrap;user-select:none;border-bottom:1px solid var(--border)">${label}${arrow(field)}</th>`;

    const body = rows.length === 0
      ? `<tr><td colspan="5" style="padding:34px;text-align:center;color:var(--text-muted)">No Secret Lair P&L yet.<br>Own singles from a drop, or add a sealed drop with its purchase price (right-click a drop → "Add drop to Sealed Collection"), to see gain/loss here.</td></tr>`
      : rows.map(r => {
          const held = [];
          if (r.sealedQty) held.push(`${r.sealedQty} sealed`);
          if (r.openedQty) held.push(`${r.openedQty} opened`);
          if (r.singlesQty) held.push(`${r.singlesQty} single${r.singlesQty !== 1 ? 's' : ''}`);
          return `<tr style="border-top:1px solid var(--border)">
            <td style="padding:8px 10px">
              <a class="bc-link" data-slact="open-drop" data-arg="${esc(r.drop)}" style="font-weight:600">${esc(r.drop)}</a>
              ${best && best.drop === r.drop ? ` <span style="font-size:10px;background:var(--green-dim);color:var(--green);padding:1px 6px;border-radius:99px">★ best</span>` : ''}
              <div style="font-size:11px;color:var(--text-muted)">${esc(r.superdrop)}${held.length ? ' · ' + held.join(', ') : ''}</div>
            </td>
            <td style="padding:8px 10px;text-align:right">${r.costIsDefault ? `<span title="Assumed Secret Lair MSRP — link a sealed product for the exact cost" style="color:var(--text-muted)">≈${fmt(r.cost)}</span>` : money(r.cost)}</td>
            <td style="padding:8px 10px;text-align:right">${money(r.value)}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:600;color:${gcol(r.gain)}">${r.gain >= 0 ? '+' : ''}${fmt(r.gain)}</td>
            <td style="padding:8px 10px;text-align:right;font-weight:700;color:${gcol(r.gainPct)}">${pct(r.gainPct)}</td>
          </tr>`;
        }).join('');

    return `
      <div style="display:flex;flex-direction:column;height:100%">
        <div style="flex:0 0 auto;background:var(--bg);padding-bottom:10px;box-shadow:0 6px 10px -8px rgba(0,0,0,.55)">${headerBar}</div>
        <div style="flex:1 1 auto;min-height:0;overflow-y:auto;padding-top:6px">
          <table style="width:100%;border-collapse:collapse;font-size:13px">
            <thead><tr>
              ${th('name', 'Drop', 'left')}
              ${th('cost', 'MSRP paid')}
              ${th('value', 'Current value')}
              ${th('gain', 'Gain / Loss')}
              ${th('gainpct', '%')}
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Drop selected — show card grid for that drop
  if (sv.drop) {
    const cardIds = SL_DROP_TO_SCRYFALL_IDS[sv.drop] || [];
    const missingIds = cardIds.filter(id => !ownsInDrop(sv.drop, id));
    const wantedMissing = missingIds.filter(id => isCardWanted(id)).length;
    const stats = dropOwnedNameStats(sv.drop);
    const PAGE_SIZE = 100;
    const shown = cardIds.slice(0, (sv.page + 1) * PAGE_SIZE);
    const hasMore = cardIds.length > shown.length;
    const drops = getDropsForSuperdrop(sv.superdrop);
    const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;

    // Compact P&L summary for this drop.
    const pnl = computeDropPnL().find(r => r.drop === sv.drop);
    const gcol = (n) => n == null ? 'var(--text-muted)' : (n >= 0 ? 'var(--green)' : '#f87171');
    const pnlBanner = (pnl && (pnl.cost > 0 || pnl.value > 0)) ? `
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap;margin:0 0 12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px">
        <span style="font-weight:700;color:var(--text)">💰 Drop P&L</span>
        <span><span style="color:var(--text-muted)">${pnl.costIsDefault ? 'MSRP (assumed)' : 'MSRP paid'}</span> ${pnl.costIsDefault ? '≈' : ''}${fmt(pnl.cost)}</span>
        <span><span style="color:var(--text-muted)">Current value</span> ${pnl.value > 0 ? fmt(pnl.value) : '—'}</span>
        <span style="font-weight:700;color:${gcol(pnl.gain)}">${pnl.gain >= 0 ? '+' : ''}${fmt(pnl.gain)}${pnl.gainPct != null ? ` (${pnl.gainPct >= 0 ? '+' : ''}${pnl.gainPct.toFixed(0)}%)` : ''}</span>
        ${pnl.costIsDefault ? `<span style="color:var(--text-muted);font-size:11px;margin-left:auto">Assumed MSRP — link a sealed product (edit it → "Secret Lair Drop") for the exact cost</span>` : ''}
      </div>` : '';

    return viewToggle() + refreshBtn + breadcrumb() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${drops.length ? dropSelect(drops) : ''}
          <button class="btn btn-ghost" style="font-size:12px" data-act="ui-set" data-path="slViewer.drop" data-val="" data-also="slViewer.page=0">← Back to Superdrop</button>
          <button class="btn btn-ghost" style="font-size:12px" data-slact="edit-drop" data-arg="${esc(sv.drop)}">${slDropEdited(sv.drop) ? '✎ Edit (customized)' : '✎ Edit grouping / note'}</button>
          ${missingIds.length ? `<button class="btn btn-ghost" style="font-size:12px" data-slact="want-missing" data-arg="${esc(sv.drop)}" title="Add this drop's missing cards to your want list">★ Want ${missingIds.length} missing${wantedMissing ? ` (${wantedMissing} on list)` : ''}</button>` : ''}
          <span style="margin-left:auto;font-size:13px;font-weight:700;color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">
            ${stats.owned} / ${stats.total} cards owned (${pct}%)
          </span>
        </div>
      </div>
      ${slDropNote(sv.drop) ? `<div style="margin:0 0 12px;padding:9px 13px;background:var(--surface);border-left:3px solid var(--accent2);border-radius:6px;font-size:13px;color:var(--text);white-space:pre-wrap">📝 ${esc(slDropNote(sv.drop))}</div>` : ''}
      ${pnlBanner}
      ${dropEconomicsBanner(sv.drop)}
      <div class="gallery-grid">
        ${shown.map(scryfallId => slCardTile(scryfallId, undefined, requiredFinishFor(sv.drop, scryfallId))).join('')}
      </div>
      ${hasMore ? `<div style="text-align:center;padding:28px 0">
        <button class="btn btn-primary" data-act="ui-inc" data-path="slViewer.page">Load more — ${(cardIds.length - shown.length).toLocaleString()} remaining</button>
      </div>` : ''}`;
  }

  // Superdrop selected (no specific drop) — show drop list within it
  if (sv.superdrop) {
    const sdObj = SL_SUPERDROPS.find(s => s.superdrop === sv.superdrop);
    const allDrops = sdObj ? [...sdObj.drops] : [];
    const drops = sortDrops(allDrops.filter(d => dropMatchesSearch(d, sv.search)));
    return viewToggle() + refreshBtn + breadcrumb() + sortSearchBar() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${dropSelect(allDrops.sort())}
          <button class="btn btn-ghost" style="font-size:12px;margin-left:auto" data-slact="edit-sd-note" data-arg="${esc(sv.superdrop)}">${slSuperdropNote(sv.superdrop) ? '✎ Edit note' : '✎ Add note'}</button>
        </div>
      </div>
      ${slSuperdropNote(sv.superdrop) ? `<div style="margin:0 0 14px;padding:9px 13px;background:var(--surface);border-left:3px solid var(--accent2);border-radius:6px;font-size:13px;color:var(--text);white-space:pre-wrap">📝 ${esc(slSuperdropNote(sv.superdrop))}</div>` : ''}
      ${drops.length === 0
        ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No drops match "${esc(sv.search)}".</div>`
        : `<div class="sl-superdrop-grid">
        ${drops.map(drop => {
          const stats = dropOwnedNameStats(drop);
          const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;
          return `
            <div class="sl-superdrop-card" data-sl-drop="${esc(drop)}" data-slact="open-drop" data-arg="${esc(drop)}">
              <div class="sl-superdrop-name">${esc(drop)}</div>
              <div class="sl-superdrop-meta">${stats.total} card${stats.total !== 1 ? 's' : ''}</div>
              <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
              <div class="sl-superdrop-count" style="color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">${stats.owned} / ${stats.total} owned</div>
            </div>`;
        }).join('')}
      </div>`}`;
  }

  // Landing — show all superdrops as completion cards, with announced-but-
  // unreleased drops (from the wiki sync) surfaced up top.
  const upcoming = upcomingSlDrops();
  const upcomingStrip = upcoming.length ? `
    <div style="margin:0 0 14px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent2);border-radius:8px;font-size:13px">
      <span style="font-weight:700;color:var(--text)">🔮 Upcoming</span>
      <span style="color:var(--text-muted);font-size:11px;margin-left:6px">announced, not yet released</span>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin-top:6px">
        ${upcoming.slice(0, 8).map(r => `
          <span><strong style="color:var(--text)">${esc(r.drop)}</strong>
            <span style="color:var(--text-muted);font-size:12px"> · ${esc(r.superdrop || 'standalone')} · ${esc(r.date)}${r.msrpNonfoil != null ? ` · ${fmt(r.msrpNonfoil)}${r.msrpFoil != null ? ' / ' + fmt(r.msrpFoil) + ' foil' : ''}` : ''}</span>
          </span>`).join('')}
        ${upcoming.length > 8 ? `<span style="color:var(--text-muted);font-size:12px">+${upcoming.length - 8} more</span>` : ''}
      </div>
    </div>` : '';
  const visibleSuperdrops = sortSuperdrops(SL_SUPERDROPS.filter(sd => superdropMatchesSearch(sd, sv.search)));
  return viewToggle() + refreshBtn + sortSearchBar() + upcomingStrip + `
    ${visibleSuperdrops.length === 0
      ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No superdrops match "${esc(sv.search)}".</div>`
      : `<div class="sl-superdrop-grid">
      ${visibleSuperdrops.map(sd => {
        // Sum per-drop name stats so superdrop totals match drop totals.
        let owned = 0, total = 0;
        for (const d of sd.drops) {
          const s = dropOwnedNameStats(d);
          owned += s.owned;
          total += s.total;
        }
        const pct = total ? Math.round(owned / total * 100) : 0;
        return `
          <div class="sl-superdrop-card" data-sl-superdrop="${esc(sd.superdrop)}" data-slact="open-superdrop" data-arg="${esc(sd.superdrop)}">
            <div class="sl-superdrop-name">${esc(sd.superdrop)}</div>
            <div class="sl-superdrop-meta">${sd.date || '—'} · ${sd.drops.length} drop${sd.drops.length !== 1 ? 's' : ''}</div>
            <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
            <div class="sl-superdrop-count" style="color:${owned===total&&total>0?'var(--green)':'var(--text-muted)'}">${owned} / ${total} owned</div>
          </div>`;
      }).join('')}
    </div>`}`;
}

export async function showSlViewerModal(scryfallId) {
  // Strict per-printing ownership — only direct scryfallId match counts. If
  // user owns a different printing of the same card name, that's not "this
  // card" and the modal should show Scryfall details + "Not owned".
  const ownedPrintings = ownedCards().filter(c => c.scryfallId === scryfallId);
  if (ownedPrintings.length > 0) {
    showGalleryModal(ownedPrintings[0].id);
    return;
  }

  // Not owned — show stub modal then populate via Scryfall
  const id = scryfallId.toLowerCase();
  const img = `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg`;
  const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(scryfallId) : [];

  showModal(`
    <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
      <img src="${esc(img)}" alt=""
        style="width:240px;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,0.65);flex-shrink:0"
        data-imgerr="hide">
      <div style="flex:1;min-width:200px">
        <div id="sl-modal-details" style="color:var(--text-muted);font-size:13px;padding-top:8px">Loading card details…</div>
      </div>
    </div>`);

  try {
    const resp = await netFetch(`https://api.scryfall.com/cards/${scryfallId}`);
    const data = await resp.json();
    const el = document.getElementById('sl-modal-details');
    if (!el) return;
    const scryfallUrl = `https://scryfall.com/card/${(data.set || '').toLowerCase()}/${data.collector_number || ''}`;
    const oracleText = (data.oracle_text || data.card_faces?.[0]?.oracle_text || '').substring(0, 300);
    el.innerHTML = `
      <h2 style="margin:0 0 4px;color:var(--text)">${esc(data.name || '')}</h2>
      <div style="color:var(--text-muted);font-size:13px;margin-bottom:14px">${esc(data.set_name || '')} · ${esc((data.set || '').toUpperCase())} · #${esc(data.collector_number || '?')}</div>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;margin-bottom:16px">
        <span style="color:var(--text-muted)">Rarity</span>   <span style="text-transform:capitalize">${esc(data.rarity || '—')}</span>
        <span style="color:var(--text-muted)">Type</span>     <span>${esc(data.type_line || '—')}</span>
        <span style="color:var(--text-muted)">CMC</span>      <span>${data.cmc ?? '—'}</span>
        ${oracleText ? `<span style="color:var(--text-muted);align-self:start">Oracle</span><span style="font-style:italic;font-size:12px;line-height:1.5">${esc(oracleText)}${(data.oracle_text||'').length > 300 ? '…' : ''}</span>` : ''}
        ${slInfo.length ? slInfo.map(s => `
          <span style="color:var(--text-muted)">SL Drop</span><span class="sl-type-badge">${esc(s.drop)}</span>
          <span style="color:var(--text-muted)">Superdrop</span><span>${esc(s.superdrop)}</span>
        `).join('') : ''}
        ${(typeof preconsContaining === 'function' ? preconsContaining(scryfallId) : []).slice(0, 3).map(p => `
          <span style="color:var(--text-muted)">Precon</span>
          <span><a class="bc-link" data-slact="open-precon" data-arg="${esc(p.file)}">${esc(p.name)}</a> <span style="color:var(--text-muted);font-size:11px">${esc(p.type || '')}</span></span>
        `).join('')}
        <span style="color:var(--text-muted)">In binder</span><span style="color:#f87171;font-weight:600">Not owned</span>
      </div>
      ${data.prices?.usd ? `<div style="font-size:22px;font-weight:700;color:var(--text);margin-bottom:14px">$${data.prices.usd}</div>` : ''}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>
        <button class="btn btn-ghost" style="font-size:12px" data-slact="open-printings" data-arg="${esc(data.name || '')}">View all printings ◇</button>
        <button class="btn btn-primary" style="font-size:12px" data-slact="add-owned" data-arg="${esc(scryfallId)}">＋ Add owned copy</button>
        <button class="btn btn-ghost" style="font-size:12px" data-slact="toggle-want" data-arg="${esc(scryfallId)}">${isCardWanted(scryfallId) ? '★ On want list' : '☆ Add to want list'}</button>
        <button class="btn btn-ghost" style="font-size:12px" data-slact="edit-card-note" data-arg="${esc(scryfallId)}">✎ ${slCardNote(scryfallId) ? 'Edit' : 'Add'} note</button>
      </div>
      ${slCardNote(scryfallId) ? `<div style="margin-top:12px;padding:9px 13px;background:var(--surface);border-left:3px solid var(--accent2);border-radius:6px;font-size:13px;color:var(--text);white-space:pre-wrap">📝 ${esc(slCardNote(scryfallId))}</div>` : ''}`;
  } catch (e) {
    const el = document.getElementById('sl-modal-details');
    if (el) el.textContent = 'Failed to load card details.';
  }
}

