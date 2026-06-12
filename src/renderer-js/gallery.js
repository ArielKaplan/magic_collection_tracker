import { cardCurrentValue } from './analytics.js';
import { FOIL_LABEL } from './constants.js';
import { showModal } from './modals.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { esc, fmt } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// GALLERY TAB
// ─────────────────────────────────────────────────────────────────────────────
export function renderGallery() {
  const g = ui.gallery;

  const binders  = [...new Set(collection.cards.map(c => c.binderName))].sort();
  const sets     = [...new Set(collection.cards.map(c => c.setName).filter(Boolean))].sort();
  const cmcVals  = [...new Set(
    collection.cards
      .map(c => collection.cardMetadata?.[c.scryfallId]?.cmc)
      .filter(v => v != null)
  )].sort((a, b) => a - b);

  let cards = collection.cards.filter(c => c.scryfallId);
  if (g.binder) cards = cards.filter(c => c.binderName === g.binder);
  if (g.set)    cards = cards.filter(c => c.setName === g.set);
  if (g.cmc !== '' && g.cmc != null) {
    const cmcNum = parseFloat(g.cmc);
    cards = cards.filter(c => {
      const meta = collection.cardMetadata?.[c.scryfallId];
      return meta?.cmc != null && meta.cmc === cmcNum;
    });
  }
  if (g.search) {
    const q = g.search.toLowerCase();
    cards = cards.filter(c => {
      if (c.name.toLowerCase().includes(q)) return true;
      if ((c.setName || '').toLowerCase().includes(q)) return true;
      const meta = collection.cardMetadata?.[c.scryfallId];
      if (meta?.type_line?.toLowerCase().includes(q)) return true;
      if (meta?.oracle_text?.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  // Sort
  const sortField = g.sortField || 'name';
  const sortDir   = g.sortDir   || 'asc';
  cards = [...cards].sort((a, b) => {
    let av, bv;
    if (sortField === 'name') {
      av = a.name.toLowerCase(); bv = b.name.toLowerCase();
    } else if (sortField === 'value') {
      av = cardCurrentValue(a) ?? -1; bv = cardCurrentValue(b) ?? -1;
    } else if (sortField === 'number') {
      av = parseInt(a.collectorNumber) || 0; bv = parseInt(b.collectorNumber) || 0;
    } else if (sortField === 'cmc') {
      av = collection.cardMetadata?.[a.scryfallId]?.cmc ?? 999;
      bv = collection.cardMetadata?.[b.scryfallId]?.cmc ?? 999;
    }
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ?  1 : -1;
    return 0;
  });

  const perPage = 100;
  const total   = cards.length;
  const shown   = cards.slice(0, (g.page + 1) * perPage);
  const hasMore = total > shown.length;

  const activeFilters = [g.binder, g.set, g.cmc !== '' && g.cmc != null ? `CMC ${g.cmc}` : '', g.search].filter(Boolean).length;

  function sel(field, val) { return field === val ? ' selected' : ''; }
  function sortBtn(field, label) {
    const active = sortField === field;
    const nextDir = active && sortDir === 'asc' ? 'desc' : 'asc';
    const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
    return `<button class="btn${active ? ' btn-primary' : ' btn-ghost'}" style="font-size:12px;padding:5px 10px"
      onclick="ui.gallery.sortField='${field}';ui.gallery.sortDir='${nextDir}';ui.gallery.page=0;render()">${label}${arrow}</button>`;
  }

  return `
    <div class="gallery-filters">
      <div class="gallery-filter-row">
        <select onchange="ui.gallery.binder=this.value;ui.gallery.page=0;render()">
          <option value="">All Binders</option>
          ${binders.map(b => `<option value="${esc(b)}"${sel(g.binder,b)}>${esc(b)}</option>`).join('')}
        </select>
        <select onchange="ui.gallery.set=this.value;ui.gallery.page=0;render()">
          <option value="">All Sets</option>
          ${sets.map(s => `<option value="${esc(s)}"${sel(g.set,s)}>${esc(s)}</option>`).join('')}
        </select>
        <select onchange="ui.gallery.cmc=this.value;ui.gallery.page=0;render()">
          <option value="">Any CMC</option>
          ${cmcVals.map(v => `<option value="${v}"${sel(String(g.cmc),String(v))}>${v === 0 ? '0 (Land/Free)' : v}</option>`).join('')}
        </select>
        <div style="display:flex;gap:6px;flex:1;min-width:180px">
          <input type="text" id="gallerySearch" class="search-input" placeholder="Search name, set, type, or oracle text…"
            value="${esc(g.search)}"
            onkeydown="if(event.key==='Enter'){ui.gallery.search=this.value;ui.gallery.page=0;render()}"
            style="flex:1;min-width:0">
          <button class="btn" onclick="ui.gallery.search=document.getElementById('gallerySearch').value;ui.gallery.page=0;render()">Search</button>
          ${g.search ? `<button class="btn btn-ghost" onclick="ui.gallery.search='';ui.gallery.page=0;render()">✕</button>` : ''}
        </div>
        ${activeFilters > 0 ? `<button class="btn btn-ghost" style="white-space:nowrap;font-size:12px" onclick="ui.gallery={binder:'',set:'',cmc:'',search:'',sortField:'name',sortDir:'asc',page:0};render()">Clear all</button>` : ''}
      </div>
      <div class="gallery-filter-row" style="align-items:center;gap:8px">
        <span style="font-size:12px;color:var(--text-muted);white-space:nowrap">Sort:</span>
        ${sortBtn('name',   'Name')}
        ${sortBtn('number', 'Card #')}
        ${sortBtn('value',  'Value')}
        ${sortBtn('cmc',    'CMC')}
        <span style="margin-left:auto;font-size:13px;color:var(--text-muted);white-space:nowrap">${total.toLocaleString()} card${total !== 1 ? 's' : ''}</span>
      </div>
    </div>

    ${total === 0
      ? `<div style="padding:40px;text-align:center;color:var(--text-muted)">No cards match your filters.</div>`
      : `<div class="gallery-grid">
          ${shown.map(c => {
            const id  = c.scryfallId.toLowerCase();
            const img = `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
            const val = cardCurrentValue(c);
            return `
              <div class="gallery-card" data-card-id="${esc(c.id)}" onclick="showGalleryModal('${esc(c.id)}')" title="${esc(c.name)}">
                <img src="${esc(img)}" alt="${esc(c.name)}" loading="lazy"
                  onerror="this.closest('.gallery-card').style.display='none'">
                ${c.foil !== 'normal' ? `<span class="gallery-foil">${FOIL_LABEL[c.foil]}</span>` : ''}
                ${val != null ? `<span class="gallery-price">${fmt(val)}</span>` : ''}
              </div>`;
          }).join('')}
        </div>
        ${hasMore ? `
          <div style="text-align:center;padding:28px 0">
            <button class="btn btn-primary" onclick="ui.gallery.page++;render()">
              Load more — ${(total - shown.length).toLocaleString()} remaining
            </button>
          </div>` : ''}`}`;
}

export function showGalleryModal(cardId) {
  const card = collection.cards.find(c => c.id === cardId);
  if (!card) return;

  const id    = card.scryfallId ? card.scryfallId.toLowerCase() : null;
  const img   = id ? `https://cards.scryfall.io/large/front/${id[0]}/${id[1]}/${id}.jpg` : null;
  const scryfallUrl = id ? `https://scryfall.com/card/${(card.setCode||'').toLowerCase()}/${card.collectorNumber||''}` : null;
  const value = cardCurrentValue(card);
  const cost  = card.purchasePrice ?? 0;
  const gain  = value != null ? value - cost : null;
  const slInfo = typeof getSlInfoById === 'function' ? getSlInfoById(card.scryfallId) : (typeof getSlInfo === 'function' ? getSlInfo(card.name) : []);

  const hist  = id ? (collection.priceHistory[`${card.scryfallId}|${card.foil}`] || []) : [];
  const spark = hist.length >= 2 ? renderSparkline(hist.map(h => h.price)) : '';

  showModal(`
    <div style="display:flex;gap:22px;align-items:flex-start;flex-wrap:wrap">
      ${img ? `<img src="${esc(img)}" alt="${esc(card.name)}"
        style="width:240px;border-radius:12px;box-shadow:0 6px 28px rgba(0,0,0,0.65);flex-shrink:0"
        onerror="this.style.display='none'">` : ''}
      <div style="flex:1;min-width:200px">
        <h2 style="margin:0 0 4px">${esc(card.name)}</h2>
        <div style="color:var(--text-muted);font-size:13px;margin-bottom:14px">${esc(card.setName)} · ${esc((card.setCode||'').toUpperCase())} · #${esc(card.collectorNumber||'?')}</div>

        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;font-size:13px;margin-bottom:16px">
          <span style="color:var(--text-muted)">Binder</span>    <span>${esc(card.binderName)}</span>
          <span style="color:var(--text-muted)">Rarity</span>    <span style="text-transform:capitalize">${esc(card.rarity||'—')}</span>
          <span style="color:var(--text-muted)">Foil</span>      <span>${card.foil !== 'normal' ? `<span class="badge badge-${card.foil}">${FOIL_LABEL[card.foil]}</span>` : 'Normal'}</span>
          <span style="color:var(--text-muted)">Condition</span> <span>${esc(card.condition||'—')}</span>
          <span style="color:var(--text-muted)">Language</span>  <span>${esc(card.language||'—')}</span>
          <span style="color:var(--text-muted)">Qty owned</span> <span>${card.quantity}</span>
          ${slInfo.length ? slInfo.map(s => `
            <span style="color:var(--text-muted)">SL Drop</span>
            <span style="color:var(--accent2);font-weight:600">${esc(s.drop)}</span>
            <span style="color:var(--text-muted)">Superdrop</span>
            <span>${esc(s.superdrop)}</span>
          `).join('') : ''}
        </div>

        <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">
          ${value != null ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Market price</div>
            <div style="font-size:22px;font-weight:700;color:var(--accent2)">${fmt(value)}</div>
          </div>` : ''}
          ${cost ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Cost basis</div>
            <div style="font-size:18px;font-weight:600">${fmt(cost)}</div>
          </div>` : ''}
          ${gain != null ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Gain/Loss</div>
            <div style="font-size:18px;font-weight:700" class="${gain >= 0 ? 'price-up' : 'price-down'}">${gain >= 0 ? '+' : ''}${fmt(gain)}</div>
          </div>` : ''}
        </div>

        ${spark ? `<div style="margin-bottom:14px">
          <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Price history</div>
          ${spark}
        </div>` : ''}

        ${scryfallUrl ? `<a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>` : ''}
      </div>
    </div>`);
}

