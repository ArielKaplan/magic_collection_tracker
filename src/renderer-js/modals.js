import { showEditScryfallModal } from './cardsTab.js';
import { addOwnedCardToDeck, ctxDeckSubmenu, deckById, showDeckCardContextMenu, showDeckTileContextMenu } from './decks.js';
import { showGalleryModal } from './gallery.js';
import { hideCardHoverPreview } from './hover.js';
import { showProductPicker } from './productPicker.js';
import { render } from './render.js';
import { showAddSealedModal, showUpdatePriceModal } from './sealedModals.js';
import { showSlViewerModal } from './slTab.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, toast, uid } from './utils.js';


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
  if (!confirm(`Delete “${card.name}” (${qty} cop${qty !== 1 ? 'ies' : 'y'}) from your collection?`)) return;
  collection.cards = collection.cards.filter(c => c.id !== card.id);
  try { await window.api.cards.remove(card.id); } catch {}
  render(); autoSave();
  toast(`${card.name} removed`, 'info');
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
    { icon: '🌐', label: 'View on Scryfall', action: () => openCardOnScryfall(card) },
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(card.name, 'Name') },
    '---',
    { icon: '🗑', label: qty > 1 ? `Delete entry (${qty} copies)` : 'Delete entry', danger: true, action: () => deleteCardEntry(card) },
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
  if (!opts.silent) {
    render(); autoSave();
    toast(`${name} added to ${binder} — prices fill in on next refresh`, 'success');
  }
  return name;
}

export function showSlCardContextMenu(x, y, scryfallId) {
  const owned = collection.cards.filter(c => c.scryfallId === scryfallId);
  if (owned.length) {
    // Owned printing — full card menu (acts on the first matching entry)
    showCardContextMenu(x, y, owned[0]);
    return;
  }
  const name = (typeof SL_SCRYFALL_TO_NAME !== 'undefined' && SL_SCRYFALL_TO_NAME[scryfallId]) || 'Card';
  showContextMenu(x, y, [
    { header: name },
    { icon: '👁', label: 'View details', action: () => showSlViewerModal(scryfallId) },
    { icon: '📥', label: 'Add to collection in binder', sub: ctxBinderSubmenu(b => addSlCardToCollection(scryfallId, b)) },
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
    }),
    onManual: q => showAddSealedModal(null, { name: q || drop, productType: 'Secret Lair' }),
  });
}

export function showSlDropContextMenu(x, y, drop) {
  const ids = (typeof SL_DROP_TO_SCRYFALL_IDS !== 'undefined' && SL_DROP_TO_SCRYFALL_IDS[drop]) || [];
  const ownedIds = new Set(collection.cards.map(c => c.scryfallId).filter(Boolean));
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
    { icon: '📋', label: 'Copy name', action: () => copyToClipboard(item.name, 'Name') },
    '---',
    { icon: '🗑', label: 'Delete product', danger: true, action: () => {
        if (!confirm(`Delete “${item.name}” from your sealed collection?`)) return;
        collection.sealed = collection.sealed.filter(i => i.id !== item.id);
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

