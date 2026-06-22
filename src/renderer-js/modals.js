import { showEditScryfallModal } from './cardsTab.js';
import { addOwnedCardToDeck, ctxDeckSubmenu, deckById, showDeckCardContextMenu, showDeckTileContextMenu } from './decks.js';
import { entryRealized } from './analytics.js';
import { FOIL_LABEL } from './constants.js';
import { showGalleryModal } from './gallery.js';
import { hideCardHoverPreview } from './hover.js';
import { getCurrentPrice } from './prices.js';
import { showProductPicker } from './productPicker.js';
import { render } from './render.js';
import { showAddSealedModal, showUpdatePriceModal } from './sealedModals.js';
import { showSlViewerModal } from './slTab.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, toast, today, uid } from './utils.js';
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
  }
}
export function hideModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  const modal = document.querySelector('#modal-overlay .modal');
  if (modal) modal.classList.remove('modal-wide', 'modal-xl');
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
  const sealed = item.status === 'sealed';
  showContextMenu(x, y, [
    { header: item.name },
    { icon: '✎', label: 'Edit product', action: () => showAddSealedModal(item.id) },
    { icon: '💲', label: 'Update price', action: () => showUpdatePriceModal(item.id) },
    { icon: sealed ? '○' : '●', label: sealed ? 'Mark opened' : 'Mark sealed',
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

