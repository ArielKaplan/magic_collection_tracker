import { cardCurrentValue } from './analytics.js';
import { showGalleryModal } from './gallery.js';
import { showModal } from './modals.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { esc, escJs, fmt, netFetch, toast } from './utils.js';


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

    const newDropCards = {};
    const newScryfallToDrops = {};
    const newScryfallToName = {};

    // Pass 1: trust MTGJSON's `subsets` field where present.
    for (const card of cards) {
      const sid  = (card.identifiers?.scryfallId || '').toLowerCase();
      const name = card.name;
      const subs = card.subsets || [];
      if (sid && name) newScryfallToName[sid] = name;
      if (sid && subs.length) newScryfallToDrops[sid] = subs;
      for (const drop of subs) {
        if (!newDropCards[drop]) newDropCards[drop] = [];
        if (!newDropCards[drop].includes(name)) newDropCards[drop].push(name);
      }
    }

    // Pass 2: foil/star backfill — base collector number → drops. Foil printings
    // (collector "1485★") inherit the drop tag of the regular printing ("1485")
    // when MTGJSON failed to tag them in `subsets` directly.
    const baseKeyToDrops = {};
    for (const card of cards) {
      const num  = (card.number || '').replace(/[★*]/g, '').trim();
      const subs = card.subsets || [];
      if (!num || !subs.length) continue;
      const key = `${num}|${card.name}`;
      if (!baseKeyToDrops[key]) baseKeyToDrops[key] = new Set();
      for (const d of subs) baseKeyToDrops[key].add(d);
    }
    let backfilled = 0;
    for (const card of cards) {
      const sid = (card.identifiers?.scryfallId || '').toLowerCase();
      if (!sid) continue;
      // Only backfill cards that don't already have any drop tags
      if (newScryfallToDrops[sid] && newScryfallToDrops[sid].length) continue;
      const num = (card.number || '').replace(/[★*]/g, '').trim();
      const key = `${num}|${card.name}`;
      const drops = baseKeyToDrops[key];
      if (drops && drops.size > 0) {
        newScryfallToDrops[sid] = [...drops];
        backfilled++;
      }
    }
    if (backfilled > 0) window.logger?.info('SL', `Backfilled ${backfilled} foil/variant printings via base collector number`);

    applySlDataUpdate(newDropCards, newScryfallToDrops, newScryfallToName);
    await saveSlDataToCache(newDropCards, newScryfallToDrops, newScryfallToName);

    const drops = Object.keys(newDropCards).length;
    toast(`SL data updated — ${drops} drops, ${cards.length} cards`, 'success');
    window.logger?.success('SL', `Updated: ${drops} drops · ${cards.length.toLocaleString()} cards · ${Object.keys(newScryfallToDrops).length.toLocaleString()} mapped printings`);
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

export function renderSlViewer() {
  const sv = ui.slViewer;
  const hasSl = typeof SL_SUPERDROPS !== 'undefined' && typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined';
  if (!hasSl) return `<div style="padding:40px;text-align:center;color:var(--text-muted)">Secret Lair data not loaded.</div>`;

  const ownedIds = new Set(collection.cards.map(c => c.scryfallId).filter(Boolean));
  // SLD-set names the user owns somewhere — only used as a *drop count* fallback
  // for the rare case where a drop's card list contains a name that has no
  // scryfallIds tagged to it at all (MTGJSON data gap).
  const ownedSldNames = new Set(
    collection.cards
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
      if (ownedIds.has(id)) directMatchedNames.add(n);
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
        onclick="refreshSlData()" ${ui.slRefreshing ? 'disabled' : ''}>
        ${ui.slRefreshing ? '⏳ Fetching…' : '↻ Refresh SL Data'}
      </button>
    </div>`;

  function sdSelect() {
    return `<select onchange="ui.slViewer.superdrop=this.value;ui.slViewer.drop='';ui.slViewer.page=0;render()">
      <option value="">All Superdrops</option>
      ${superdrops.map(sd => `<option value="${esc(sd)}"${sv.superdrop===sd?' selected':''}>${esc(sd)}</option>`).join('')}
    </select>`;
  }

  function dropSelect(drops) {
    return `<select onchange="ui.slViewer.drop=this.value;ui.slViewer.page=0;render()">
      <option value="">All Drops</option>
      ${drops.map(d => `<option value="${esc(d)}"${sv.drop===d?' selected':''}>${esc(d)}</option>`).join('')}
    </select>`;
  }

  // Breadcrumb shown above the toolbar — clickable segments walk back up the
  // hierarchy. Last segment is the current page (not clickable, accent color).
  function breadcrumb() {
    const root = `<a class="bc-link" onclick="ui.slViewer.superdrop='';ui.slViewer.drop='';ui.slViewer.page=0;render()">Secret Lair Explorer</a>`;
    const sep = `<span class="bc-sep">›</span>`;
    if (sv.drop) {
      const sdSeg = sv.superdrop
        ? `<a class="bc-link" onclick="ui.slViewer.drop='';ui.slViewer.page=0;render()">${esc(sv.superdrop)}</a>`
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
        <input type="text" id="slSearchInput" placeholder="Search by drop, superdrop, or card name…"
          value="${esc(sv.search || '')}"
          oninput="ui.slViewer.search=this.value;ui.slViewer.page=0;render();setTimeout(()=>{const el=document.getElementById('slSearchInput');if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length)}},0)"
          style="flex:1;min-width:200px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
        ${sv.search ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" onclick="ui.slViewer.search='';render()">✕</button>` : ''}
        <span style="color:var(--text-muted);font-size:11px;white-space:nowrap">Sort:</span>
        <select onchange="ui.slViewer.sort=this.value;render()" style="font-size:12px">
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
    const cards = SL_DROP_CARDS[drop] || [];
    return cards.some(c => c.toLowerCase().includes(q));
  }
  function superdropMatchesSearch(sd, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    if (sd.superdrop.toLowerCase().includes(q)) return true;
    return (sd.drops || []).some(d => dropMatchesSearch(d, q));
  }

  // Drop selected — show card grid for that drop
  if (sv.drop) {
    const cardIds = SL_DROP_TO_SCRYFALL_IDS[sv.drop] || [];
    const stats = dropOwnedNameStats(sv.drop);
    const PAGE_SIZE = 100;
    const shown = cardIds.slice(0, (sv.page + 1) * PAGE_SIZE);
    const hasMore = cardIds.length > shown.length;
    const drops = getDropsForSuperdrop(sv.superdrop);
    const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;

    return refreshBtn + breadcrumb() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${drops.length ? dropSelect(drops) : ''}
          <button class="btn btn-ghost" style="font-size:12px" onclick="ui.slViewer.drop='';ui.slViewer.page=0;render()">← Back to Superdrop</button>
          <span style="margin-left:auto;font-size:13px;font-weight:700;color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">
            ${stats.owned} / ${stats.total} cards owned (${pct}%)
          </span>
        </div>
      </div>
      <div class="gallery-grid">
        ${shown.map(scryfallId => {
          const id = scryfallId.toLowerCase();
          const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
          // Strict per-printing ownership: only credit if the user's collection
          // has this exact scryfallId. Different printings of the same card name
          // are separate tiles and tracked separately.
          const ownedCards = collection.cards.filter(c => c.scryfallId === scryfallId);
          const owned = ownedCards.length > 0;
          const totalQty = ownedCards.reduce((s, c) => s + (c.quantity || 1), 0);
          const val = owned ? cardCurrentValue(ownedCards[0]) : null;
          return `
            <div class="gallery-card${owned ? ' sl-card-owned' : ' sl-card-missing'}" data-sl-card="${esc(scryfallId)}"
              onclick="showSlViewerModal('${esc(scryfallId)}')" title="${owned ? `Owned (qty: ${totalQty})` : 'Not in collection'}">
              <img src="${esc(img)}" alt="" loading="lazy"
                onerror="this.closest('.gallery-card').style.display='none'"
                style="${owned ? '' : 'filter:grayscale(60%) brightness(0.65)'}">
              ${owned
                ? `<span class="sl-owned-badge">✓ ${totalQty}</span>`
                : `<span class="sl-missing-badge">✗</span>`}
              ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
            </div>`;
        }).join('')}
      </div>
      ${hasMore ? `<div style="text-align:center;padding:28px 0">
        <button class="btn btn-primary" onclick="ui.slViewer.page++;render()">Load more — ${(cardIds.length - shown.length).toLocaleString()} remaining</button>
      </div>` : ''}`;
  }

  // Superdrop selected (no specific drop) — show drop list within it
  if (sv.superdrop) {
    const sdObj = SL_SUPERDROPS.find(s => s.superdrop === sv.superdrop);
    const allDrops = sdObj ? [...sdObj.drops] : [];
    const drops = sortDrops(allDrops.filter(d => dropMatchesSearch(d, sv.search)));
    return refreshBtn + breadcrumb() + sortSearchBar() + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          ${sdSelect()}
          ${dropSelect(allDrops.sort())}
        </div>
      </div>
      ${drops.length === 0
        ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No drops match "${esc(sv.search)}".</div>`
        : `<div class="sl-superdrop-grid">
        ${drops.map(drop => {
          const stats = dropOwnedNameStats(drop);
          const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;
          return `
            <div class="sl-superdrop-card" data-sl-drop="${esc(drop)}" onclick="ui.slViewer.drop='${escJs(drop)}';ui.slViewer.page=0;render()">
              <div class="sl-superdrop-name">${esc(drop)}</div>
              <div class="sl-superdrop-meta">${stats.total} card${stats.total !== 1 ? 's' : ''}</div>
              <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pct}%"></div></div>
              <div class="sl-superdrop-count" style="color:${stats.owned===stats.total&&stats.total>0?'var(--green)':'var(--text-muted)'}">${stats.owned} / ${stats.total} owned</div>
            </div>`;
        }).join('')}
      </div>`}`;
  }

  // Landing — show all superdrops as completion cards
  const visibleSuperdrops = sortSuperdrops(SL_SUPERDROPS.filter(sd => superdropMatchesSearch(sd, sv.search)));
  return refreshBtn + sortSearchBar() + `
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
          <div class="sl-superdrop-card" data-sl-superdrop="${esc(sd.superdrop)}" onclick="ui.slViewer.superdrop='${escJs(sd.superdrop)}';ui.slViewer.drop='';render()">
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
  const ownedCards = collection.cards.filter(c => c.scryfallId === scryfallId);
  if (ownedCards.length > 0) {
    showGalleryModal(ownedCards[0].id);
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
        onerror="this.style.display='none'">
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
          <span style="color:var(--text-muted)">SL Drop</span><span style="color:var(--accent2);font-weight:600">${esc(s.drop)}</span>
          <span style="color:var(--text-muted)">Superdrop</span><span>${esc(s.superdrop)}</span>
        `).join('') : ''}
        <span style="color:var(--text-muted)">In binder</span><span style="color:#f87171;font-weight:600">Not owned</span>
      </div>
      ${data.prices?.usd ? `<div style="font-size:22px;font-weight:700;color:var(--accent2);margin-bottom:14px">$${data.prices.usd}</div>` : ''}
      <a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>`;
  } catch (e) {
    const el = document.getElementById('sl-modal-details');
    if (el) el.textContent = 'Failed to load card details.';
  }
}

