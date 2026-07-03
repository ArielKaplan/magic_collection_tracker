import { renderCards } from './cardsTab.js';
import { renderDecks } from './decks.js';
import { renderFailedLookupsTab } from './failures.js';
import { attachContentListeners } from './hover.js';
import { updateRefreshUI } from './prices.js';
import { renderPreconTab } from './preconTab.js';
import { renderSealed } from './sealedTab.js';
import { renderSearchTab } from './search.js';
import { renderSlViewer } from './slTab.js';
import { collection, ui } from './state.js';
import { updateStatusBar } from './statusbar.js';
import { renderTickerTape } from './ticker.js';
import { renderWantList, updateWantBadge } from './wantlist.js';



// ─────────────────────────────────────────────────────────────────────────────
// RENDER ORCHESTRATION
// ─────────────────────────────────────────────────────────────────────────────
export function render() {
  const content = document.getElementById('content');

  // Tear down any active Svelte component when leaving the dashboard tab
  if (ui.activeTab !== 'dashboard' && window.svelteApp) window.svelteApp.unmountDashboard();

  try {
    switch (ui.activeTab) {
      case 'dashboard':
        content.innerHTML = '<div id="svelte-dashboard-mount" style="height:100%"></div>';
        if (window.svelteApp) {
          window.svelteApp.mountDashboard(document.getElementById('svelte-dashboard-mount'));
          window.svelteApp.notifyDataChanged();
        } else {
          // Svelte bundle failed to load (it ships locally, so this means a
          // broken install/build, not a timing race)
          content.innerHTML = '<div class="empty-state" style="padding:40px"><p>Dashboard failed to load — try restarting the app. If it persists, rebuild with <code>npm run build:renderer</code>.</p></div>';
        }
        break;
      case 'cards':     content.innerHTML = renderCards();             break;
      case 'sealed':    content.innerHTML = renderSealed();            break;
      case 'decks':     content.innerHTML = renderDecks();             break;
      case 'slviewer':  content.innerHTML = renderSlViewer();          break;
      case 'precons':   content.innerHTML = renderPreconTab();         break;
      case 'wantlist':  content.innerHTML = renderWantList();          break;
      case 'failures':  content.innerHTML = renderFailedLookupsTab();  break;
      case 'search':    content.innerHTML = renderSearchTab();         break;
    }
  } catch (e) {
    console.error('Render error:', e);
    content.innerHTML = `<div style="padding:24px;color:#f87171;font-family:monospace">Render error: ${e.message}<br><pre style="font-size:11px;margin-top:8px;opacity:.7">${e.stack || ''}</pre></div>`;
  }
  attachContentListeners();
  updateRefreshUI();
  updateFailedBadge();
  updateWantBadge();
  updateStatusBar();
  renderTickerTape();

  // Notify Svelte that the underlying data may have changed (no-op if not on dashboard)
  if (window.svelteApp) window.svelteApp.notifyDataChanged();
}

export function updateFailedBadge() {
  const count = (collection.failedLookups || []).length;
  const tab = document.getElementById('failuresTab');
  if (!tab) return;

  const existing = tab.querySelector('.fail-badge');
  if (count > 0) {
    if (existing) {
      existing.textContent = count;
    } else {
      const badge = document.createElement('span');
      badge.className = 'fail-badge';
      badge.textContent = count;
      tab.appendChild(badge);
    }
  } else if (existing) {
    existing.remove();
  }
}

