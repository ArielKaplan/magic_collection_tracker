import { cardCurrentValue } from './analytics.js';
import { FOIL_LABEL } from './constants.js';
import { showModal } from './modals.js';
import { collection } from './state.js';
import { esc, escJs, fmt } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// GALLERY (card-image modal)
// The gallery grid itself now lives as a *view* of the Card Collection tab
// (cardsTab.js, ui.cards.view === 'gallery'); this module keeps the per-card
// detail modal that both the grid and other tiles open.
// ─────────────────────────────────────────────────────────────────────────────
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
            <span class="sl-type-badge">${esc(s.drop)}</span>
            <span style="color:var(--text-muted)">Superdrop</span>
            <span>${esc(s.superdrop)}</span>
          `).join('') : ''}
        </div>

        <div style="display:flex;gap:20px;margin-bottom:14px;flex-wrap:wrap">
          ${value != null ? `<div>
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">Market price</div>
            <div style="font-size:22px;font-weight:700;color:var(--text)">${fmt(value)}</div>
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

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost" style="font-size:12px" onclick="viewInCollection('${escJs(card.name)}')">View in collection →</button>
          ${scryfallUrl ? `<a href="${esc(scryfallUrl)}" target="_blank" class="btn btn-ghost" style="font-size:12px;text-decoration:none">View on Scryfall ↗</a>` : ''}
        </div>
      </div>
    </div>`);
}
