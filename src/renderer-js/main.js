import * as NS_constants from './constants.js';
import * as NS_state from './state.js';
import * as NS_logger from './logger.js';
import * as NS_utils from './utils.js';
import * as NS_csv from './csv.js';
import * as NS_storage from './storage.js';
import * as NS_importWizard from './importWizard.js';
import * as NS_prices from './prices.js';
import * as NS_statusbar from './statusbar.js';
import * as NS_sealedPricing from './sealedPricing.js';
import * as NS_analytics from './analytics.js';
import * as NS_render from './render.js';
import * as NS_ticker from './ticker.js';
import * as NS_cardsTab from './cardsTab.js';
import * as NS_gallery from './gallery.js';
import * as NS_slTab from './slTab.js';
import * as NS_failures from './failures.js';
import * as NS_sealedTab from './sealedTab.js';
import * as NS_decks from './decks.js';
import * as NS_deckIO from './deckIO.js';
import * as NS_modals from './modals.js';
import * as NS_productPicker from './productPicker.js';
import * as NS_sealedModals from './sealedModals.js';
import * as NS_exportModal from './exportModal.js';
import * as NS_settings from './settings.js';
import * as NS_updaterUI from './updaterUI.js';
import * as NS_hover from './hover.js';
import * as NS_wantlist from './wantlist.js';
import { analyzeByColor, analyzeByManaValue, analyzeByType, binderValueMap, cardCurrentValue, realizedGains, renderCardCountBySet, renderCardCountByYear, renderCardOfTheDay, renderColorPanel, renderManaValuePanel, renderRarityPanel, renderStatsPanel, renderTop10ValueCards, renderTypePanel, renderValueBySet, topMovers, totalCardsValue, totalSealedValue } from './analytics.js';
import { FOIL_LABEL } from './constants.js';
import { showDeckImportModal } from './deckIO.js';
import { findCollectionCardById, hideCardHoverPreview, showCardHoverPreview } from './hover.js';
import { closeLogPanel, toggleLogPanel } from './logger.js';
import { hideModal } from './modals.js';
import { refreshPrices } from './prices.js';
import { render } from './render.js';
import { showSettings } from './settings.js';
import { computeSlIndex, loadSlOverrides, refreshSlData } from './slTab.js';
import { collection, ui } from './state.js';
import { showAbout } from './statusbar.js';
import { autoLoad, importCsvFile, loadCollectionFile, saveCollection } from './storage.js';
import { esc, fmt, fmtPct, toast, today } from './utils.js';

// Expose every module export as a window global. Inline onclick handlers in
// rendered HTML and a few Svelte panels resolve functions by global name —
// this preserves the classic-script contract. Remove as tabs migrate to
// components with real event wiring.
const WINDOW_DENYLIST = new Set(['window', 'document', 'location', 'top', 'parent', 'self', 'frames', 'length', 'name', 'status', 'history', 'origin', 'closed', 'opener', 'navigator', 'screen']);
for (const ns of [NS_constants, NS_state, NS_logger, NS_utils, NS_csv, NS_storage, NS_importWizard, NS_prices, NS_statusbar, NS_sealedPricing, NS_analytics, NS_render, NS_ticker, NS_cardsTab, NS_gallery, NS_slTab, NS_failures, NS_sealedTab, NS_decks, NS_deckIO, NS_modals, NS_productPicker, NS_sealedModals, NS_exportModal, NS_settings, NS_updaterUI, NS_hover, NS_wantlist]) {
  for (const [key, value] of Object.entries(ns)) {
    if (WINDOW_DENYLIST.has(key)) continue;
    try { window[key] = value; } catch { /* read-only window prop — skip */ }
  }
}



// ─────────────────────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  // Tab buttons (always present in nav — attach once)
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      ui.activeTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      render();
    });
  });

  // Sidebar Settings button
  const sbs = document.getElementById('sidebarSettings');
  if (sbs) sbs.addEventListener('click', showSettings);

  // Top-bar update pill (shown when the main process reports a new version)
  NS_updaterUI.wireUpdateBadge();

  // Activity log panel — status-bar button + close + clear
  const sbLogs = document.getElementById('sb-logs');
  if (sbLogs) sbLogs.addEventListener('click', toggleLogPanel);
  const logsClose = document.getElementById('logs-close');
  if (logsClose) logsClose.addEventListener('click', closeLogPanel);
  const logsClear = document.getElementById('logs-clear');
  if (logsClear) logsClear.addEventListener('click', () => window.logger.clear());
  // Ctrl+L global toggle
  document.addEventListener('keydown', e => {
    if (e.key === 'l' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      toggleLogPanel();
    }
  });

  // Native menu bar — actions arrive over IPC from main process
  if (window.api && window.api.onMenuAction) {
    window.api.onMenuAction(action => {
      if (action.startsWith('tab:')) {
        const tab = action.slice(4);
        ui.activeTab = tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        render();
        return;
      }
      switch (action) {
        case 'import:csv':       importCsvFile().catch(console.error); break;
        case 'import:deck':      showDeckImportModal(); break;
        case 'import:json':      loadCollectionFile().catch(console.error); break;
        case 'export:json':      saveCollection().catch(console.error); break;
        case 'refresh:prices':   refreshPrices(); break;
        case 'refresh:sl':       if (typeof refreshSlData === 'function') refreshSlData(); break;
        case 'settings:open':    showSettings(); break;
        case 'settings:reset':   showSettings(); break; // user clicks Reset Database button inside
        case 'updates:check':
          showSettings();
          setTimeout(() => {
            const b = document.getElementById('cfg-check-updates');
            if (b) b.click();
          }, 50);
          break;
        case 'about:show':       showAbout(); break;
        case 'logs:toggle':      toggleLogPanel(); break;
      }
    });
  }

  // Modal dismiss
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target.id === 'modal-overlay') hideModal();
  });
  document.getElementById('modal-close').addEventListener('click', hideModal);

  // Load cached SL data from SQLite (from a previous "Check for New Cards" click)
  if (typeof loadSlDataFromCache === 'function') await loadSlDataFromCache();
  // Apply this user's local Secret Lair grouping/note overrides on top of the baked data
  await loadSlOverrides();

  // Expose helpers/state to the Svelte renderer (window.app + window.collection)
  window.collection = collection;
  window.app = {
    fmt, fmtPct, esc, FOIL_LABEL,
    cardCurrentValue, totalCardsValue, totalSealedValue,
    binderValueMap, topMovers, realizedGains, computeSlIndex,
    wantListSummary: NS_wantlist.wantListSummary,
    valueByColor: analyzeByColor,
    valueByType: analyzeByType,
    valueByMana: analyzeByManaValue,
    refreshPrices,
    renderCardOfTheDay,
    rerollCotd: () => { ui.cotdOffset = (ui.cotdOffset || 0) + 1; render(); },
    // Legacy panel renderers — Svelte wrappers @html them in.
    renderColorPanel,
    renderTypePanel,
    renderManaValuePanel,
    renderRarityPanel,
    renderStatsPanel,
    renderCardCountBySet,
    renderValueBySet,
    renderCardCountByYear,
    renderTop10ValueCards,
    showCardHoverPreview,
    hideCardHoverPreview,
    findCollectionCardById,
  };

  // Auto-load from SQLite on startup
  window.logger?.info('App', 'Starting up — loading collection from SQLite…');
  const loaded = await autoLoad();
  if (loaded) {
    const el = document.getElementById('autosave-status');
    if (el) {
      el.textContent = `● Restored (${collection.cards.length.toLocaleString()} cards)`;
      el.style.opacity = '1';
      el._fadeTimer = setTimeout(() => { el.style.opacity = '0.4'; }, 5000);
    }
    window.logger?.success('App', `Loaded ${collection.cards.length.toLocaleString()} cards · ${(collection.sealed || []).length} sealed · ${Object.keys(collection.priceHistory || {}).length.toLocaleString()} price-history series`);
  } else {
    window.logger?.info('App', 'No prior collection found — starting fresh');
  }

  render();

  // Surface any backup-health warning from the main process — e.g. today's
  // automatic backup was skipped because the live DB failed its integrity check.
  try {
    const health = await window.api.app?.backupHealth?.();
    if (health && health.message) {
      window.logger?.error('Backup', `${health.message}${health.detail ? ' (' + health.detail + ')' : ''}`);
      toast(health.message, health.level === 'error' ? 'error' : 'info', 14000);
    }
  } catch { /* older main process without backupHealth — ignore */ }

  // Auto-refresh once per calendar day on first open — runs after render so the
  // UI is visible before the network requests start.
  if (collection.cards.length > 0) {
    const todayStr = new Date().toDateString();
    const lastStr  = collection.lastPriceRefresh
      ? new Date(collection.lastPriceRefresh).toDateString()
      : null;
    if (lastStr !== todayStr) {
      window.logger?.info('App', 'First open today — auto-refreshing prices and SL data…');
      setTimeout(async () => {
        await refreshPrices();
        if (typeof refreshSlData === 'function') refreshSlData();
      }, 800);
    }
  }
}

document.addEventListener('DOMContentLoaded', init);


