import { showEditScryfallModal } from './cardsTab.js';
import { addOwnedCardToDeck, ctxDeckSubmenu, deckById, showDeckCardContextMenu, showDeckTileContextMenu } from './decks.js';
import { entryRealized } from './analytics.js';
import { buildOpenedProductCards, buildOwnedCardFromCatalog, catalogFinishOptions, catalogPrice, dropFinishHint } from './acquisition.js';
import { FOIL_LABEL } from './constants.js';
import { showGalleryModal } from './gallery.js';
import { hideCardHoverPreview } from './hover.js';
import { fetchScryfallBatch, getCurrentPrice, storePriceSnapshot } from './prices.js';
import { showProductPicker } from './productPicker.js';
import { render } from './render.js';
import { showAddSealedModal, showUpdatePriceModal } from './sealedModals.js';
import { showSlViewerModal } from './slTab.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, netFetch, toast, today, uid } from './utils.js';
import { addDropMissingToWantList, isCardWanted, toggleSlCardWant, wantItemByScryfall } from './wantlist.js';


// ─────────────────────────────────────────────────────────────────────────────
// MODAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────
export function showModal(html, size = null) {
  document.getElementById('modal-content').innerHTML = html;
  const overlay = document.getElementById('modal-overlay');
  overlay.classList.remove('hidden');
  const modal = overlay.querySelector('.modal');
  if (modal) {
    modal.classList.toggle('modal-wide', size === true || size === 'wide');
    modal.classList.toggle('modal-xl',   size === 'xl');
    modal.classList.toggle('modal-settings', size === 'settings');
    modal.classList.toggle('modal-card', size === 'card');
  }
}
export function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  const modal = document.querySelector('#modal-overlay .modal');
  if (modal) modal.classList.remove('modal-wide', 'modal-xl', 'modal-settings', 'modal-card');
}

// Universal exact-printing acquisition flow. It is reachable from live search
// results, the printings tab, and any unowned card detail modal.
export async function showAddOwnedCardModal(cardOrId) {
  let card = cardOrId && typeof cardOrId === 'object' ? cardOrId : null;
  const sid = card ? card.id : String(cardOrId || '').trim().toLowerCase();
  if (!card) {
    showModal('<h2>Add owned card</h2><div class="sr-loading">Loading exact printing details…</div>');
    try {
      const resp = await netFetch(`https://api.scryfall.com/cards/${encodeURIComponent(sid)}`);
      if (!resp.ok) throw new Error(`Scryfall HTTP ${resp.status}`);
      card = await resp.json();
    } catch (e) {
      showModal(`<h2>Add owned card</h2><p style="color:var(--red)">Could not load this printing: ${esc(e.message)}</p><button class="btn" id="aoc-close">Close</button>`);
      document.getElementById('aoc-close')?.addEventListener('click', hideModal);
      return;
    }
  }

  const finishes = catalogFinishOptions(card);
  const binders = [...new Set(collection.cards.filter(c => c.status !== 'sold' && c.binderName).map(c => c.binderName))].sort();
  const image = card.image_uris?.small || card.card_faces?.[0]?.image_uris?.small || '';
  const defaultFinish = finishes.includes('normal') ? 'normal' : finishes[0];
  const finishLabel = { normal: 'Non-foil', foil: 'Foil', etched: 'Etched foil' };
  showModal(`
    <h2>Add owned card</h2>
    <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      ${image ? `<img src="${esc(image)}" alt="" style="width:145px;border-radius:9px;box-shadow:0 4px 18px rgba(0,0,0,.45)" data-imgerr="hide">` : ''}
      <div style="flex:1;min-width:280px">
        <div style="font-size:16px;font-weight:700">${esc(card.name)}</div>
        <div style="font-size:12px;color:var(--text-muted);margin:3px 0 14px">${esc(card.set_name || '')} · ${esc((card.set || '').toUpperCase())} #${esc(card.collector_number || '?')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:11px">
          <div class="form-group" style="margin:0">
            <label>Binder / location</label>
            <input id="aoc-binder" list="aoc-binders" value="Unsorted" placeholder="Unsorted">
            <datalist id="aoc-binders">${binders.map(b => `<option value="${esc(b)}"></option>`).join('')}</datalist>
          </div>
          <div class="form-group" style="margin:0">
            <label>Finish</label>
            <select id="aoc-finish">${finishes.map(f => `<option value="${f}"${f === defaultFinish ? ' selected' : ''}>${finishLabel[f]}</option>`).join('')}</select>
          </div>
          <div class="form-group" style="margin:0">
            <label>Quantity</label>
            <input type="number" id="aoc-qty" min="1" step="1" value="1">
          </div>
          <div class="form-group" style="margin:0">
            <label>Condition</label>
            <select id="aoc-condition">
              <option value="near_mint">Near Mint</option><option value="lightly_played">Lightly Played</option>
              <option value="moderately_played">Moderately Played</option><option value="heavily_played">Heavily Played</option>
              <option value="damaged">Damaged</option>
            </select>
          </div>
          <div class="form-group" style="margin:0">
            <label>Unit cost</label>
            <input type="number" id="aoc-cost" min="0" step="0.01" placeholder="0.00">
            <div id="aoc-market" style="font-size:11px;color:var(--text-muted);margin-top:3px"></div>
          </div>
          <div class="form-group" style="margin:0">
            <label>Acquired</label>
            <input type="date" id="aoc-date" value="${today()}">
          </div>
          <div class="form-group" style="margin:0">
            <label>Currency</label>
            <input id="aoc-currency" value="USD" maxlength="3" style="text-transform:uppercase">
          </div>
          <div class="form-group" style="margin:0">
            <label>Language</label>
            <input id="aoc-language" value="${esc(card.lang || 'en')}" maxlength="8">
          </div>
        </div>
      </div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="aoc-cancel">Cancel</button>
      <button class="btn btn-primary" id="aoc-save">Add to collection</button>
    </div>`, 'wide');

  const $ = id => document.getElementById(id);
  const updateMarket = () => {
    const price = catalogPrice(card, $('aoc-finish').value);
    $('aoc-market').textContent = price == null ? 'No current USD price' : `Current market reference: ${fmt(price)}`;
  };
  $('aoc-finish').addEventListener('change', updateMarket);
  updateMarket();
  $('aoc-cancel').addEventListener('click', hideModal);
  $('aoc-save').addEventListener('click', async () => {
    const save = $('aoc-save');
    save.disabled = true;
    try {
      const owned = buildOwnedCardFromCatalog(card, {
        id: uid(),
        foil: $('aoc-finish').value,
        quantity: $('aoc-qty').value,
        binderName: $('aoc-binder').value.trim() || 'Unsorted',
        purchasePrice: $('aoc-cost').value,
        purchasePriceCurrency: ($('aoc-currency').value.trim() || 'USD').toUpperCase(),
        condition: $('aoc-condition').value,
        language: $('aoc-language').value.trim() || 'en',
        acquiredAt: $('aoc-date').value || today(),
      });
      collection.cards.push(owned);
      collection.cardMetadata[owned.scryfallId] = {
        colors: card.colors || card.card_faces?.[0]?.colors || [],
        color_identity: card.color_identity || [], type_line: card.type_line || '',
        cmc: card.cmc ?? null, power: card.power ?? null, toughness: card.toughness ?? null,
        oracle_text: card.oracle_text || card.card_faces?.[0]?.oracle_text || '',
      };
      const market = catalogPrice(card, owned.foil);
      if (market != null) storePriceSnapshot(owned.scryfallId, owned.foil, market);
      const wanted = wantItemByScryfall(owned.scryfallId);
      if (wanted) collection.wantList = collection.wantList.filter(w => w.id !== wanted.id);
      await autoSave();
      hideModal(); render();
      toast(`${owned.quantity} × ${owned.name} added to ${owned.binderName}`, 'success');
      window.logger?.success?.('Collection', `Added ${owned.quantity} × ${owned.name} (${owned.setCode.toUpperCase()} #${owned.collectorNumber}) to ${owned.binderName}`);
    } catch (e) {
      save.disabled = false;
      toast(`Could not add card: ${e.message}`, 'error');
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENUS — right-click actions on cards, drops, and sealed products
// ─────────────────────────────────────────────────────────────────────────────
export let _ctxEl = null;

export function closeContextMenu() {
  if (!_ctxEl) return;
  _ctxEl.remove();
  _ctxEl = null;
  document.removeEventListener('mousedown', _ctxDismiss, true);
  document.removeEventListener('keydown', _ctxKey, true);
  document.removeEventListener('wheel', _ctxWheel, true);
  window.removeEventListener('blur', closeContextMenu);
}
export function _ctxDismiss(e) { if (_ctxEl && !_ctxEl.contains(e.target)) closeContextMenu(); }
export function _ctxKey(e)     { if (e.key === 'Escape') closeContextMenu(); }
export function _ctxWheel(e)   { if (_ctxEl && !_ctxEl.contains(e.target)) closeContextMenu(); }

export function showContextMenu(x, y, items) {
  closeContextMenu();
  hideCardHoverPreview();
  _ctxEl = document.createElement('div');
  _ctxEl.className = 'ctx-menu';
  _ctxEl.appendChild(buildCtxList(items));
  document.body.appendChild(_ctxEl);
  const r = _ctxEl.getBoundingClientRect();
  _ctxEl.style.left = Math.max(8, Math.min(x, window.innerWidth  - r.width  - 8)) + 'px';
  _ctxEl.style.top  = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
  document.addEventListener('mousedown', _ctxDismiss, true);
  document.addEventListener('keydown', _ctxKey, true);
  document.addEventListener('wheel', _ctxWheel, true);
  window.addEventListener('blur', closeContextMenu);
}

// items: { label, icon?, danger?, disabled?, action?, sub? } | '---' | { header }
export function buildCtxList(items) {
  const list = document.createElement('div');
  list.className = 'ctx-list';
  for (const it of items) {
    if (it === '---') {
      const s = document.createElement('div');
      s.className = 'ctx-sep';
      list.appendChild(s);
      continue;
    }
    if (it.header != null) {
      const h = document.createElement('div');
      h.className = 'ctx-header';
      h.textContent = it.header;
      h.title = it.header;
      list.appendChild(h);
      continue;
    }
    const row = document.createElement('div');
    row.className = 'ctx-item' + (it.danger ? ' ctx-danger' : '') + (it.disabled ? ' ctx-disabled' : '');
    row.innerHTML = `<span class="ctx-ico">${it.icon || ''}</span><span class="ctx-lbl"></span>${it.sub && !it.disabled ? '<span class="ctx-arrow">›</span>' : ''}`;
    row.querySelector('.ctx-lbl').textContent = it.label;
    if (it.sub && !it.disabled) {
      const sub = document.createElement('div');
      sub.className = 'ctx-sub';
      sub.appendChild(buildCtxList(it.sub));
      row.appendChild(sub);
      row.addEventListener('mouseenter', () => {
        sub.classList.remove('flip');
        sub.style.top = '';
        requestAnimationFrame(() => {
          const sr = sub.getBoundingClientRect();
          if (!sr.width) return;
          if (sr.right > window.innerWidth - 8) sub.classList.add('flip');
          const over = sr.bottom - (window.innerHeight - 8);
          if (over > 0) sub.style.top = `${-7 - over}px`;
        });
      });
    } else if (!it.disabled && it.action) {
      row.addEventListener('click', e => {
        e.stopPropagation();
        closeContextMenu();
        it.action();
      });
    }
    list.appendChild(row);
  }
  return list;
}

// Small input dialog — Electron renderers don't support window.prompt().
export function promptText(title, placeholder, cb) {
  showModal(`
    <h2 style="font-size:18px">${esc(title)}</h2>
    <div class="form-group"><input type="text" id="prompt-input" placeholder="${esc(placeholder)}"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px">
      <button class="btn" id="prompt-cancel">Cancel</button>
      <button class="btn btn-primary" id="prompt-ok">OK</button>
    </div>`);
  const input = document.getElementById('prompt-input');
  input.focus();
  const done = () => {
    const v = input.value.trim();
    hideModal();
    if (v) cb(v);
  };
  document.getElementById('prompt-ok').addEventListener('click', done);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
  document.getElementById('prompt-cancel').addEventListener('click', hideModal);
}

// Submenu listing every binder plus a "New binder…" prompt.
export function ctxBinderSubmenu(applyFn, currentBinder = null) {
  const binders = [...new Set(collection.cards.map(c => c.binderName).filter(Boolean))].sort();
  const items = binders.map(b => ({
    label: b,
    icon: currentBinder === b ? '✓' : '',
    disabled: currentBinder === b,
    action: () => applyFn(b),
  }));
  if (items.length) items.push('---');
  items.push({ label: 'New binder…', icon: '＋', action: () => promptText('New binder', 'Binder name', name => applyFn(name)) });
  return items;
}

// ── Card actions ─────────────────────────────────────────────────────────────
export function moveCardToBinder(card, binder) {
  card.binderName = binder;
  render(); autoSave();
  toast(`${card.name} → ${binder}`, 'success');
}

export function changeCardQty(card, delta) {
  card.quantity = Math.max(1, (card.quantity || 1) + delta);
  render(); autoSave();
  toast(`${card.name}: ${card.quantity} cop${card.quantity !== 1 ? 'ies' : 'y'}`, 'success');
}

export async function deleteCardEntry(card) {
  const qty = card.quantity || 1;
  if (!confirm(`Delete “${card.name}” (${qty} cop${qty !== 1 ? 'ies' : 'y'}) from your collection?\n\nUse this only to fix a mistake — to record a sale, use “Sell / dispose” instead so it counts toward realized gains.`)) return;
  collection.cards = collection.cards.filter(c => c.id !== card.id);
  try { await window.api.cards.remove(card.id); } catch {}
  render(); autoSave();
  toast(`${card.name} removed`, 'info');
}

// ── Sell / dispose — records a realized sale instead of hard-deleting ─────────
// Selling part of an entry splits it: the remaining copies stay owned, the sold
// copies become a separate status='sold' entry that carries the sale details.
export function showSellCardModal(card) {
  const maxQty   = card.quantity || 1;
  const unit     = getCurrentPrice(card.scryfallId, card.foil);            // current market, per copy
  const suggested = unit != null ? (unit * maxQty).toFixed(2) : '';
  showModal(`
    <h2>💵 Sell / dispose</h2>
    <div style="margin-bottom:16px">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(card.name)}</div>
      <div style="font-size:12px;color:var(--text-dim)">${esc(card.setName)} · ${esc(card.setCode)} #${esc(card.collectorNumber)} · ${FOIL_LABEL[card.foil] || card.foil} · ${esc(card.binderName)}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Cost basis ${fmt((card.purchasePrice || 0) * maxQty)}${unit != null ? ` · current market ${fmt(unit * maxQty)}` : ''}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0">
        <label>Copies sold</label>
        <input type="number" id="sell-qty" min="1" max="${maxQty}" step="1" value="${maxQty}" ${maxQty === 1 ? 'disabled' : ''}>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">of ${maxQty} owned</div>
      </div>
      <div class="form-group" style="margin:0">
        <label>Total proceeds ($)</label>
        <input type="number" id="sell-price" min="0" step="0.01" value="${suggested}" placeholder="0.00">
      </div>
      <div class="form-group" style="margin:0">
        <label>Fees / shipping ($)</label>
        <input type="number" id="sell-fees" min="0" step="0.01" value="0" placeholder="0.00">
      </div>
      <div class="form-group" style="margin:0">
        <label>Date sold</label>
        <input type="date" id="sell-date" value="${esc(today())}">
      </div>
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Note (optional)</label>
      <input type="text" id="sell-note" placeholder="e.g. sold on TCGplayer, traded to a friend…">
    </div>
    <div id="sell-preview" style="font-size:13px;color:var(--text-muted);margin-top:12px;min-height:18px"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-primary" id="sell-confirm">Record sale</button>
      <button class="btn btn-ghost" id="sell-cancel">Cancel</button>
    </div>
  `);

  const $ = id => document.getElementById(id);
  const updatePreview = () => {
    const qty   = Math.min(maxQty, Math.max(1, parseInt($('sell-qty').value, 10) || 1));
    const price = parseFloat($('sell-price').value) || 0;
    const fees  = parseFloat($('sell-fees').value)  || 0;
    const cost  = (card.purchasePrice || 0) * qty;
    const gain  = price - fees - cost;
    const c     = gain >= 0 ? 'var(--green)' : '#f87171';
    $('sell-preview').innerHTML = `Net realized on ${qty} cop${qty !== 1 ? 'ies' : 'y'}: <strong style="color:${c}">${gain >= 0 ? '+' : ''}${fmt(gain)}</strong> <span style="color:var(--text-dim)">(proceeds ${fmt(price)} − fees ${fmt(fees)} − cost ${fmt(cost)})</span>`;
  };
  ['sell-qty', 'sell-price', 'sell-fees'].forEach(id => $(id)?.addEventListener('input', updatePreview));
  updatePreview();

  $('sell-confirm').addEventListener('click', () => {
    const qty   = Math.min(maxQty, Math.max(1, parseInt($('sell-qty').value, 10) || 1));
    const price = parseFloat($('sell-price').value);
    if (isNaN(price) || price < 0) { toast('Enter the total proceeds (0 or more)', 'error'); return; }
    const fees  = Math.max(0, parseFloat($('sell-fees').value) || 0);
    const date  = $('sell-date').value || today();
    const note  = $('sell-note').value.trim();
    const sale  = { status: 'sold', disposedAt: date, salePrice: price, saleFees: fees, saleNote: note };

    if (qty >= maxQty) {
      Object.assign(card, sale);                       // whole entry sold
    } else {
      card.quantity -= qty;                            // remaining copies stay owned
      collection.cards.push({ ...card, id: uid(), quantity: qty, ...sale });
    }
    const { gain } = entryRealized({ ...sale, purchasePrice: card.purchasePrice, quantity: qty });
    hideModal(); render(); autoSave();
    toast(`Sold ${qty} × ${card.name} — net ${gain >= 0 ? '+' : ''}${fmt(gain)} realized`, 'success');
    window.logger?.success?.('Sold', `${qty} × ${card.name} for ${fmt(price)} (net ${gain >= 0 ? '+' : ''}${fmt(gain)})`);
  });
  $('sell-cancel').addEventListener('click', hideModal);
  $('sell-price').focus();
  $('sell-price').select();
}

export function undoCardSale(card) {
  Object.assign(card, { status: 'owned', disposedAt: '', salePrice: null, saleFees: 0, saleNote: '' });
  render(); autoSave();
  toast(`${card.name} restored to your collection`, 'info');
}

// ── Sell / dispose a sealed product (mirrors showSellCardModal) ───────────────
export function showSellSealedModal(item) {
  const maxQty = item.quantity || 1;
  const hist   = item.priceHistory || [];
  const unit   = hist.length ? hist[hist.length - 1].price : null;
  const suggested = unit != null ? (unit * maxQty).toFixed(2) : '';
  showModal(`
    <h2>💵 Sell / dispose</h2>
    <div style="margin-bottom:16px">
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(item.name)}</div>
      <div style="font-size:12px;color:var(--text-dim)">${esc(item.productType || 'Sealed')}${item.dropName ? ` · ${esc(item.dropName)}` : ''}</div>
      <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Cost basis ${fmt((item.purchasePrice || 0) * maxQty)}${unit != null ? ` · current market ${fmt(unit * maxQty)}` : ''}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group" style="margin:0">
        <label>Units sold</label>
        <input type="number" id="sell-qty" min="1" max="${maxQty}" step="1" value="${maxQty}" ${maxQty === 1 ? 'disabled' : ''}>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px">of ${maxQty} owned</div>
      </div>
      <div class="form-group" style="margin:0">
        <label>Total proceeds ($)</label>
        <input type="number" id="sell-price" min="0" step="0.01" value="${suggested}" placeholder="0.00">
      </div>
      <div class="form-group" style="margin:0">
        <label>Fees / shipping ($)</label>
        <input type="number" id="sell-fees" min="0" step="0.01" value="0" placeholder="0.00">
      </div>
      <div class="form-group" style="margin:0">
        <label>Date sold</label>
        <input type="date" id="sell-date" value="${esc(today())}">
      </div>
    </div>
    <div class="form-group" style="margin-top:12px">
      <label>Note (optional)</label>
      <input type="text" id="sell-note" placeholder="e.g. sold sealed on eBay…">
    </div>
    <div id="sell-preview" style="font-size:13px;color:var(--text-muted);margin-top:12px;min-height:18px"></div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn btn-primary" id="sell-confirm">Record sale</button>
      <button class="btn btn-ghost" id="sell-cancel">Cancel</button>
    </div>
  `);

  const $ = id => document.getElementById(id);
  const updatePreview = () => {
    const qty   = Math.min(maxQty, Math.max(1, parseInt($('sell-qty').value, 10) || 1));
    const price = parseFloat($('sell-price').value) || 0;
    const fees  = parseFloat($('sell-fees').value)  || 0;
    const cost  = (item.purchasePrice || 0) * qty;
    const gain  = price - fees - cost;
    const c     = gain >= 0 ? 'var(--green)' : '#f87171';
    $('sell-preview').innerHTML = `Net realized on ${qty} unit${qty !== 1 ? 's' : ''}: <strong style="color:${c}">${gain >= 0 ? '+' : ''}${fmt(gain)}</strong> <span style="color:var(--text-dim)">(proceeds ${fmt(price)} − fees ${fmt(fees)} − cost ${fmt(cost)})</span>`;
  };
  ['sell-qty', 'sell-price', 'sell-fees'].forEach(id => $(id)?.addEventListener('input', updatePreview));
  updatePreview();

  $('sell-confirm').addEventListener('click', () => {
    const qty   = Math.min(maxQty, Math.max(1, parseInt($('sell-qty').value, 10) || 1));
    const price = parseFloat($('sell-price').value);
    if (isNaN(price) || price < 0) { toast('Enter the total proceeds (0 or more)', 'error'); return; }
    const fees  = Math.max(0, parseFloat($('sell-fees').value) || 0);
    const date  = $('sell-date').value || today();
    const note  = $('sell-note').value.trim();
    const sale  = { status: 'sold', disposedAt: date, salePrice: price, saleFees: fees, saleNote: note };

    if (qty >= maxQty) {
      Object.assign(item, sale);
    } else {
      item.quantity -= qty;
      collection.sealed.push({ ...item, id: uid(), quantity: qty, ...sale });
    }
    const gain = price - fees - (item.purchasePrice || 0) * qty;
    hideModal(); render(); autoSave();
    toast(`Sold ${qty} × ${item.name} — net ${gain >= 0 ? '+' : ''}${fmt(gain)} realized`, 'success');
    window.logger?.success?.('Sold', `${qty} × ${item.name} (sealed) for ${fmt(price)} (net ${gain >= 0 ? '+' : ''}${fmt(gain)})`);
  });
  $('sell-cancel').addEventListener('click', hideModal);
  $('sell-price').focus();
  $('sell-price').select();
}

export function undoSealedSale(item) {
  Object.assign(item, { status: 'sealed', disposedAt: '', salePrice: null, saleFees: 0, saleNote: '' });
  render(); autoSave();
  toast(`${item.name} restored to your sealed collection`, 'info');
}

export function openCardOnScryfall(card) {
  const url = card.setCode && card.collectorNumber
    ? `https://scryfall.com/card/${card.setCode.toLowerCase()}/${encodeURIComponent(card.collectorNumber)}`
    : `https://scryfall.com/search?q=${encodeURIComponent('!"' + card.name + '"')}`;
  window.api.app.openExternal(url);
}

export function copyToClipboard(text, what = 'Copied') {
  navigator.clipboard.writeText(text).then(
    () => toast(`${what} copied`, 'info'),
    () => toast('Copy failed', 'error'),
  );
}

export function showCardContextMenu(x, y, card) {
  const qty = card.quantity || 1;
  // Sold entries get a slimmed menu — they're a realized-gains record, not a live card.
  if (card.status === 'sold') {
    showContextMenu(x, y, [
      { header: `${card.name} — sold` },
      { icon: '👁', label: 'View details', action: () => showGalleryModal(card.id) },
      { icon: '↩', label: 'Undo sale (back to collection)', action: () => undoCardSale(card) },
      '---',
      { icon: '🌐', label: 'View on Scryfall', action: () => openCardOnScryfall(card) },
      { icon: '📋', label: 'Copy name', action: () => copyToClipboard(card.name, 'Name') },
      '---',
      { icon: '🗑', label: 'Delete record', danger: true, action: () => deleteCardEntry(card) },
    ]);
    return;
  }
  showContextMenu(x, y, [
    { header: card.name },
    { icon: '👁', label: 'View details', action: () => showGalleryModal(card.id) },
    { icon: '📂', label: 'Move to binder', sub: ctxBinderSubmenu(b => moveCardToBinder(card, b), card.binderName) },
    { icon: '🛡', label: 'Add to deck', sub: ctxDeckSubmenu(d => addOwnedCardToDeck(card, d)) },
    { icon: '📤', label: card.binderName && card.binderName !== 'Unsorted' ? `Remove from “${card.binderName}”` : 'Remove from binder',
      disabled: !card.binderName || card.binderName === 'Unsorted',
      action: () => moveCardToBinder(card, 'Unsorted') },
    '---',
    { icon: '＋', label: 'Add a copy', action: () => changeCardQty(card, +1) },
    { icon: '－', label: 'Remove a copy', disabled: qty <= 1, action: () => changeCardQty(card, -1) },
    { icon: '✎', label: 'Edit Scryfall ID', action: () => showEditScryfallModal(card.id) },
    '---',
    { icon: '💵', label: qty > 1 ? `Sell / dispose (${qty} copies)…` : 'Sell / dispose…', action: () => showSellCardModal(card) },
    { icon: '🌐', label: 'View on Scryfall', action: () => openCardOnScryfall(card) },
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(card.name, 'Name') },
    '---',
    { icon: '🗑', label: 'Delete entry (mistake)', danger: true, action: () => deleteCardEntry(card) },
  ]);
}

// ── Secret Lair explorer actions ─────────────────────────────────────────────
export function addSlCardToCollection(scryfallId, binder, opts = {}) {
  const name = (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[scryfallId]) || 'Unknown card';
  collection.cards.push({
    id: uid(),
    scryfallId,
    manaboxId: '',
    name,
    setCode: 'SLD',
    setName: 'Secret Lair Drop',
    collectorNumber: '',
    foil: 'normal',
    rarity: 'rare',
    quantity: 1,
    binderName: binder,
    binderType: 'binder',
    purchasePrice: 0,
    purchasePriceCurrency: 'USD',
    condition: 'near_mint',
    language: 'en',
    misprint: false,
    altered: false,
  });
  // Acquired it — drop it from the want list if it was on there.
  const wanted = wantItemByScryfall(scryfallId);
  if (wanted) collection.wantList = collection.wantList.filter(w => w.id !== wanted.id);
  if (!opts.silent) {
    render(); autoSave();
    toast(`${name} added to ${binder} — prices fill in on next refresh`, 'success');
  }
  return name;
}

export function showSlCardContextMenu(x, y, scryfallId) {
  const owned = collection.cards.filter(c => c.scryfallId === scryfallId && c.status !== 'sold');
  if (owned.length) {
    // Owned printing — full card menu (acts on the first matching entry)
    showCardContextMenu(x, y, owned[0]);
    return;
  }
  const name = (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[scryfallId]) || 'Card';
  const wanted = isCardWanted(scryfallId);
  showContextMenu(x, y, [
    { header: name },
    { icon: '👁', label: 'View details', action: () => showSlViewerModal(scryfallId) },
    { icon: '📥', label: 'Add to collection in binder', sub: ctxBinderSubmenu(b => addSlCardToCollection(scryfallId, b)) },
    { icon: wanted ? '☆' : '★', label: wanted ? 'Remove from want list' : 'Add to want list', action: () => toggleSlCardWant(scryfallId) },
    '---',
    { icon: '🌐', label: 'View on Scryfall', action: () => openCardOnScryfall({ name }) },
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(name, 'Name') },
  ]);
}

export function addDropCardsToBinder(drop, ids, binder) {
  for (const sid of ids) addSlCardToCollection(sid, binder, { silent: true });
  render(); autoSave();
  toast(`Added ${ids.length} cards from “${drop}” to ${binder} — prices fill in on next refresh`, 'success');
}

export function addDropToSealed(drop) {
  showProductPicker({
    title: 'Add Drop to Sealed Collection',
    initialQuery: drop,
    onPick: sel => showAddSealedModal(null, {
      name: sel.name, price: sel.price, pcId: sel.pcId,
      setName: sel.setName, linkedName: sel.name,
      productType: 'Secret Lair', dropName: drop,
    }),
    onManual: q => showAddSealedModal(null, { name: q || drop, productType: 'Secret Lair', dropName: drop }),
  });
}

export function sealedProductCardIds(item) {
  const fromDrop = item?.dropName && typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined'
    ? (SL_DROP_TO_SCRYFALL_IDS[item.dropName] || [])
    : [];
  return [...new Set([...fromDrop, ...(item?.linkedScryfallIds || [])].filter(Boolean).map(id => String(id).toLowerCase()))];
}

function openedCardsForProduct(item) {
  return collection.cards.filter(c => c.sourceProductId === item.id);
}

// Converts one or more sealed Secret Lair units into their exact known card
// printings. The opened-product row remains as provenance, while its cost basis
// is transferred across the generated card rows.
export function showOpenSecretLairModal(item) {
  if (!item || item.status !== 'sealed') return;
  const ids = sealedProductCardIds(item);
  if (!ids.length) {
    toast('No card list is linked to this product. Choose its Secret Lair drop in Edit Product first.', 'error');
    return;
  }
  const maxQty = Math.max(1, item.quantity || 1);
  const binders = [...new Set(collection.cards.filter(c => c.status !== 'sold' && c.binderName).map(c => c.binderName))].sort();
  const finish = dropFinishHint(item.dropName || item.name);
  const finishText = finish === 'normal' ? 'non-foil' : finish === 'etched' ? 'etched foil' : 'foil';
  showModal(`
    <h2>Open into collection</h2>
    <div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(item.name)}</div>
    <p class="wiz-meta">Creates ${ids.length} exact ${finishText} printing${ids.length === 1 ? '' : 's'} per product and links them back to this purchase. Known listed contents are included; randomized bonus cards are not added automatically.</p>
    <div class="form-row">
      <div class="form-group">
        <label>Products to open</label>
        <input type="number" id="slo-qty" min="1" max="${maxQty}" step="1" value="1">
      </div>
      <div class="form-group">
        <label>Binder / location</label>
        <input id="slo-binder" list="slo-binders" value="Unsorted" placeholder="Unsorted">
        <datalist id="slo-binders">${binders.map(b => `<option value="${esc(b)}"></option>`).join('')}</datalist>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label>Opened date</label>
        <input type="date" id="slo-date" value="${today()}">
      </div>
      <div class="form-group">
        <label>Cost allocation</label>
        <select id="slo-allocation">
          <option value="market">Proportional to current card prices</option>
          <option value="equal">Equal amount per card</option>
        </select>
      </div>
    </div>
    <div style="padding:10px 12px;border-radius:8px;background:var(--surface2);font-size:12px;color:var(--text-muted)">
      ${fmt(item.purchasePrice || 0)} purchase cost per product will move from sealed inventory to the generated cards. Portfolio cost basis will not be counted twice.
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:20px">
      <button class="btn" id="slo-cancel">Cancel</button>
      <button class="btn btn-primary" id="slo-open">Open product</button>
    </div>`, 'wide');

  document.getElementById('slo-cancel').addEventListener('click', hideModal);
  document.getElementById('slo-open').addEventListener('click', async () => {
    const button = document.getElementById('slo-open');
    const units = Math.max(1, Math.min(maxQty, parseInt(document.getElementById('slo-qty').value, 10) || 1));
    button.disabled = true;
    button.textContent = 'Loading exact printings…';
    try {
      const result = await fetchScryfallBatch(ids);
      const fetched = result?.data || [];
      const byId = new Map(fetched.map(card => [String(card.id).toLowerCase(), card]));
      const missing = ids.filter(id => !byId.has(id));
      if (missing.length) throw new Error(`${missing.length} linked printing${missing.length === 1 ? ' is' : 's are'} unavailable from Scryfall`);
      const catalogCards = ids.map(id => byId.get(id));
      const openingId = units < maxQty ? uid() : item.id;
      const cards = buildOpenedProductCards(catalogCards, {
        idFactory: uid,
        foil: finish,
        quantity: units,
        binderName: document.getElementById('slo-binder').value.trim() || 'Unsorted',
        productUnitCost: item.purchasePrice || 0,
        purchasePriceCurrency: item.purchasePriceCurrency || 'USD',
        acquiredAt: document.getElementById('slo-date').value || today(),
        sourceProductId: openingId,
        sourceProductName: item.name,
        allocation: document.getElementById('slo-allocation').value,
      });

      let openedItem = item;
      if (units < maxQty) {
        item.quantity = maxQty - units;
        openedItem = {
          ...item,
          id: openingId,
          status: 'opened',
          quantity: units,
          openedFromId: item.id,
          linkedScryfallIds: ids,
          priceHistory: [...(item.priceHistory || [])],
        };
        collection.sealed.push(openedItem);
      } else {
        item.status = 'opened';
        item.openedFromId = item.openedFromId || '';
        item.linkedScryfallIds = ids;
      }
      collection.cards.push(...cards);

      const acquiredIds = new Set(cards.map(c => c.scryfallId));
      collection.wantList = collection.wantList.filter(w => !acquiredIds.has((w.scryfallId || '').toLowerCase()));
      for (const card of catalogCards) {
        collection.cardMetadata[card.id] = {
          colors: card.colors || card.card_faces?.[0]?.colors || [],
          color_identity: card.color_identity || [], type_line: card.type_line || '',
          cmc: card.cmc ?? null, power: card.power ?? null, toughness: card.toughness ?? null,
          oracle_text: card.oracle_text || card.card_faces?.[0]?.oracle_text || '',
        };
        const generated = cards.find(c => c.scryfallId === card.id);
        const market = generated ? catalogPrice(card, generated.foil) : null;
        if (generated && market != null) storePriceSnapshot(generated.scryfallId, generated.foil, market);
      }

      hideModal();
      render();
      await autoSave();
      toast(`Opened ${units} × ${item.name}: ${cards.length} collection rows created`, 'success');
      window.logger?.success?.('Collection', `Opened ${units} × ${item.name} into ${cards.length} linked card rows`);
    } catch (e) {
      button.disabled = false;
      button.textContent = 'Open product';
      toast(`Could not open product: ${e.message}`, 'error');
      window.logger?.error?.('Collection', `Open product failed: ${e.message}`);
    }
  });
}

export async function undoSecretLairOpen(item) {
  const generated = openedCardsForProduct(item);
  if (!generated.length) {
    toast('No generated cards are linked to this opening.', 'error');
    return;
  }
  if (generated.some(c => c.status === 'sold')) {
    toast('This opening cannot be undone because one or more generated cards were sold.', 'error');
    return;
  }
  const copies = generated.reduce((sum, c) => sum + (c.quantity || 1), 0);
  if (!confirm(`Undo opening “${item.name}”?\n\nThis removes ${generated.length} generated card rows (${copies} copies) and restores the sealed quantity.`)) return;

  const removals = await Promise.allSettled(generated.map(c => window.api.cards.remove(c.id)));
  if (removals.some(r => r.status === 'rejected')) {
    await autoSave();
    toast('Could not remove all generated cards; no in-memory changes were made.', 'error');
    return;
  }
  const generatedIds = new Set(generated.map(c => c.id));
  collection.cards = collection.cards.filter(c => !generatedIds.has(c.id));
  const parent = item.openedFromId ? collection.sealed.find(s => s.id === item.openedFromId) : null;
  if (parent) {
    parent.quantity = (parent.quantity || 0) + (item.quantity || 1);
    collection.sealed = collection.sealed.filter(s => s.id !== item.id);
  } else {
    item.status = 'sealed';
    item.openedFromId = '';
  }
  render();
  await autoSave();
  toast(`${item.name} restored to sealed inventory`, 'success');
  window.logger?.success?.('Collection', `Undid opening for ${item.name}; removed ${generated.length} linked card rows`);
}

export function showSlDropContextMenu(x, y, drop) {
  const ids = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined' && SL_DROP_TO_SCRYFALL_IDS[drop]) || [];
  const ownedIds = new Set(collection.cards.filter(c => c.status !== 'sold').map(c => c.scryfallId).filter(Boolean));
  const missing = ids.filter(id => !ownedIds.has(id));
  showContextMenu(x, y, [
    { header: drop },
    { icon: '👁', label: 'Open drop', action: () => { ui.slViewer.drop = drop; ui.slViewer.page = 0; render(); } },
    '---',
    { icon: '📦', label: 'Add drop to Sealed Collection…', action: () => addDropToSealed(drop) },
    { icon: '📥', label: `Add missing cards to binder (${missing.length})`, disabled: !missing.length,
      sub: ctxBinderSubmenu(b => addDropCardsToBinder(drop, missing, b)) },
    { icon: '📂', label: `Add ALL cards to binder (${ids.length})`, disabled: !ids.length,
      sub: ctxBinderSubmenu(b => addDropCardsToBinder(drop, ids, b)) },
    { icon: '★', label: `Add missing to want list (${missing.length})`, disabled: !missing.length,
      action: () => addDropMissingToWantList(drop) },
    '---',
    { icon: '📋', label: 'Copy drop name', action: () => copyToClipboard(drop, 'Drop name') },
  ]);
}

export function showSuperdropContextMenu(x, y, superdrop) {
  const sd = (typeof SL_SUPERDROPS !== 'undefined' && SL_SUPERDROPS.find(s => s.superdrop === superdrop)) || null;
  const drops = sd?.drops || [];
  showContextMenu(x, y, [
    { header: superdrop },
    { icon: '👁', label: 'Open superdrop', action: () => { ui.slViewer.superdrop = superdrop; ui.slViewer.drop = ''; render(); } },
    { icon: '📦', label: 'Add a drop to Sealed Collection', disabled: !drops.length,
      sub: drops.map(d => ({ label: d, action: () => addDropToSealed(d) })) },
    '---',
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(superdrop, 'Name') },
  ]);
}

// ── Sealed product actions ───────────────────────────────────────────────────
export function showSealedContextMenu(x, y, item) {
  // Sold product — realized record, slimmed menu.
  if (item.status === 'sold') {
    showContextMenu(x, y, [
      { header: `${item.name} — sold` },
      { icon: '↩', label: 'Undo sale (back to collection)', action: () => undoSealedSale(item) },
      '---',
      { icon: '📋', label: 'Copy name', action: () => copyToClipboard(item.name, 'Name') },
      '---',
      { icon: '🗑', label: 'Delete record', danger: true, action: async () => {
          if (!confirm(`Delete the sold record for “${item.name}”?`)) return;
          collection.sealed = collection.sealed.filter(i => i.id !== item.id);
          try { await window.api.sealed.remove(item.id); } catch {}
          render(); autoSave();
          toast('Record removed', 'info');
        } },
    ]);
    return;
  }
  const generated = openedCardsForProduct(item);
  if (generated.length) {
    showContextMenu(x, y, [
      { header: `${item.name} — opened into collection` },
      { icon: '↩', label: `Undo opening (${generated.length} card rows)…`, action: () => undoSecretLairOpen(item) },
      '---',
      { icon: '📋', label: 'Copy name', action: () => copyToClipboard(item.name, 'Name') },
    ]);
    return;
  }
  const sealed = item.status === 'sealed';
  const canOpenIntoCollection = sealed && sealedProductCardIds(item).length > 0;
  showContextMenu(x, y, [
    { header: item.name },
    { icon: '✎', label: 'Edit product', action: () => showAddSealedModal(item.id) },
    { icon: '💲', label: 'Update price', action: () => showUpdatePriceModal(item.id) },
    ...(canOpenIntoCollection ? [
      { icon: '📂', label: 'Open into collection…', action: () => showOpenSecretLairModal(item) },
    ] : []),
    { icon: sealed ? '○' : '●', label: sealed && canOpenIntoCollection ? 'Mark opened without adding cards' : sealed ? 'Mark opened' : 'Mark sealed',
      action: () => { item.status = sealed ? 'opened' : 'sealed'; render(); autoSave(); toast(`${item.name} marked ${item.status}`, 'info'); } },
    '---',
    { icon: '＋', label: 'Add one', action: () => { item.quantity = (item.quantity || 1) + 1; render(); autoSave(); toast(`${item.name}: ×${item.quantity}`, 'success'); } },
    { icon: '－', label: 'Remove one', disabled: (item.quantity || 1) <= 1,
      action: () => { item.quantity = Math.max(1, (item.quantity || 1) - 1); render(); autoSave(); toast(`${item.name}: ×${item.quantity}`, 'success'); } },
    '---',
    { icon: '💵', label: 'Sell / dispose…', action: () => showSellSealedModal(item) },
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(item.name, 'Name') },
    '---',
    { icon: '🗑', label: 'Delete product (mistake)', danger: true, action: async () => {
        if (!confirm(`Delete “${item.name}” from your sealed collection?\n\nUse this only to fix a mistake — to record a sale, use “Sell / dispose”.`)) return;
        collection.sealed = collection.sealed.filter(i => i.id !== item.id);
        try { await window.api.sealed.remove(item.id); } catch {}
        render(); autoSave();
        toast('Product removed', 'info');
      } },
  ]);
}

// ── Global right-click dispatch — one listener, delegated by data attribute ──
document.addEventListener('contextmenu', e => {
  const cardEl = e.target.closest('[data-card-id]');
  if (cardEl) {
    const card = collection.cards.find(c => String(c.id) === String(cardEl.dataset.cardId));
    if (card) { e.preventDefault(); showCardContextMenu(e.clientX, e.clientY, card); return; }
  }
  const slCardEl = e.target.closest('[data-sl-card]');
  if (slCardEl) { e.preventDefault(); showSlCardContextMenu(e.clientX, e.clientY, slCardEl.dataset.slCard); return; }
  const dropEl = e.target.closest('[data-sl-drop]');
  if (dropEl) { e.preventDefault(); showSlDropContextMenu(e.clientX, e.clientY, dropEl.dataset.slDrop); return; }
  const sdEl = e.target.closest('[data-sl-superdrop]');
  if (sdEl) { e.preventDefault(); showSuperdropContextMenu(e.clientX, e.clientY, sdEl.dataset.slSuperdrop); return; }
  const sealedEl = e.target.closest('.sealed-item[data-id]');
  if (sealedEl) {
    const item = collection.sealed.find(i => String(i.id) === String(sealedEl.dataset.id));
    if (item) { e.preventDefault(); showSealedContextMenu(e.clientX, e.clientY, item); return; }
  }
  const deckTileEl = e.target.closest('.deck-tile[data-deck-id]');
  if (deckTileEl) {
    const deck = deckById(deckTileEl.dataset.deckId);
    if (deck) { e.preventDefault(); showDeckTileContextMenu(e.clientX, e.clientY, deck); return; }
  }
  const deckRowEl = e.target.closest('[data-deck-entry]');
  if (deckRowEl && ui.decks.deckId) {
    const deck = deckById(ui.decks.deckId);
    const dc = deck?.cards.find(c => c.id === deckRowEl.dataset.deckEntry);
    if (deck && dc) { e.preventDefault(); showDeckCardContextMenu(e.clientX, e.clientY, deck, dc); return; }
  }
});

