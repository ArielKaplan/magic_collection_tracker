import { insightsEnabled, localIntelligenceConfigured, setInsightsEnabled, setLocalIntelligenceEnabled, syncFeatureVisibility } from './features.js';
import { hideModal, showModal } from './modals.js';
import { clearPendingPriceSnaps } from './prices.js';
import { render } from './render.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { renderTickerTape, tickerSettings } from './ticker.js';
import { updaterUI, wireUpdaterUI } from './updaterUI.js';
import { esc, toast } from './utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// BACKUPS & RECOVERY — one-click restore + manual backup
// ─────────────────────────────────────────────────────────────────────────────
async function wireBackupsSection() {
  const listEl = document.getElementById('cfg-backups-list');
  const nowBtn = document.getElementById('cfg-backup-now');
  const openBtn = document.getElementById('cfg-open-backups');
  if (!listEl || !window.api?.backups) { if (listEl) listEl.textContent = 'Backups are unavailable.'; return; }

  if (openBtn) openBtn.addEventListener('click', () => window.api.backups.openFolder());
  if (nowBtn) nowBtn.addEventListener('click', async () => {
    nowBtn.disabled = true; nowBtn.textContent = '💾 Backing up…';
    const r = await window.api.backups.createNow();
    nowBtn.disabled = false; nowBtn.textContent = '💾 Back up now';
    toast(r?.ok ? `Backup created (${r.sizeMB} MB)` : (r?.error || 'Backup failed'), r?.ok ? 'success' : 'error');
    if (r?.ok) renderList();
  });

  async function renderList() {
    let backups = [];
    try { backups = await window.api.backups.list(); } catch { /* leave empty */ }
    if (!backups.length) {
      listEl.innerHTML = '<div class="settings-empty-row">No backups yet — one is written automatically each day.</div>';
      return;
    }
    listEl.innerHTML = backups.map((b, i) => `
      <div class="settings-backup-row">
        <span><strong>${esc(b.date)}</strong><small>${b.sizeMB} MB${i === 0 ? ' · latest' : ''}</small></span>
        <button class="btn btn-ghost btn-sm" data-restore="${i}">↺ Restore</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', async () => {
      const b = backups[Number(btn.dataset.restore)];
      if (!b) return;
      if (!confirm(`Restore the backup from ${b.date}?\n\nThe app will restart and load this backup. Your current data is set aside first (backups/pre-restore) so this can be undone.`)) return;
      showModal(`<div style="padding:34px;text-align:center">
        <div style="font-size:24px;margin-bottom:10px">↺</div>
        <h2 style="margin:0 0 6px">Restoring backup…</h2>
        <div style="color:var(--text-muted);font-size:13px">The app will restart in a moment.</div></div>`);
      const r = await window.api.backups.restore(b.path);
      if (!r || !r.ok) { hideModal(); toast((r && r.error) || 'Restore failed', 'error'); }
    }));
  }
  renderList();
}

const sectionButton = (id, icon, label, description, active) => `
  <button class="settings-nav-item${active === id ? ' active' : ''}" data-settings-section="${id}">
    <span class="settings-nav-icon">${icon}</span>
    <span><strong>${label}</strong><small>${description}</small></span>
  </button>`;

const settingCard = (title, description, body, extraClass = '') => `
  <div class="settings-card ${extraClass}">
    <div class="settings-card-head"><h3>${title}</h3>${description ? `<p>${description}</p>` : ''}</div>
    ${body}
  </div>`;

function updatesCard() {
  if (updaterUI.channel !== 'github') return settingCard('Updates', '', `
    <p class="settings-copy">This build is updated by ${esc(updaterUI.channel === 'steam' ? 'Steam' : updaterUI.channel)}. New versions install automatically from your library. <span id="upd-current"></span></p>`);
  return settingCard('Updates', 'Check GitHub Releases, download an update, and restart when it is ready.', `
    <span id="upd-current" class="settings-inline-status"></span>
    <div class="settings-button-row">
      <button class="btn btn-sm" id="cfg-check-updates">Check for Updates</button>
      <button class="btn btn-sm" id="cfg-whats-new" style="display:none">What's New</button>
      <button class="btn btn-sm" id="cfg-download-update" style="display:none">Download Update</button>
      <button class="btn btn-primary btn-sm" id="cfg-install-update" style="display:none">Restart &amp; Install</button>
    </div>
    <div id="upd-status" class="settings-update-status"></div>
    <div id="upd-progress-wrap" style="display:none;margin-top:10px">
      <div class="settings-progress"><div id="upd-progress-bar" style="width:0%"></div></div>
      <div id="upd-progress-text" class="settings-progress-text"></div>
    </div>`);
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MODAL — sectioned workspace, one focused panel at a time
// ─────────────────────────────────────────────────────────────────────────────
export function showSettings(initialSection = 'general') {
  collection.settings = collection.settings || {};
  const allowedSections = new Set(['general', 'features', 'pricing', 'secret-lair', 'data', 'updates']);
  if (!allowedSections.has(initialSection)) initialSection = 'general';
  const tcfg = tickerSettings();
  const tickerBinders = [...new Set(collection.cards.map(c => c.binderName).filter(Boolean))].sort();
  const tickerSets = [...new Set(collection.cards.map(c => c.setName).filter(Boolean))].sort();
  const chipHtml = (vals, selected) => vals.map(v =>
    `<button type="button" class="col-chip${selected.includes(v) ? ' col-chip-on' : ''}" data-val="${esc(v)}">${esc(v)}</button>`
  ).join('');
  const panelClass = id => `settings-panel${initialSection === id ? ' active' : ''}`;

  showModal(`
    <div class="settings-app">
      <header class="settings-header">
        <div class="settings-header-mark">⚙</div>
        <div><h2>Settings</h2><p>Personalize Mana Ledger and manage your local data.</p></div>
      </header>

      <div class="settings-layout">
        <nav class="settings-nav" aria-label="Settings sections">
          ${sectionButton('general', '◫', 'General', 'Ticker and display', initialSection)}
          ${sectionButton('features', '✦', 'Features', 'Optional workspaces', initialSection)}
          ${sectionButton('pricing', '＄', 'Pricing', 'Sources and tokens', initialSection)}
          ${sectionButton('secret-lair', '◇', 'Secret Lair', 'Data and P&L', initialSection)}
          ${sectionButton('data', '▰', 'Data & Backups', 'Recovery and reset', initialSection)}
          ${sectionButton('updates', '↻', 'Updates & Support', 'Version and feedback', initialSection)}
          <div class="settings-nav-foot"><span>All preferences stay on this computer.</span></div>
        </nav>

        <div class="settings-stage">
          <section class="${panelClass('general')}" data-settings-panel="general">
            <div class="settings-panel-title"><span>General</span><h2>Make the workspace yours</h2><p>Control the collection ticker without changing any collection data.</p></div>
            ${settingCard('Ticker Tape', 'Choose which cards scroll across the top and how quickly. With no binders or sets selected, your whole collection is eligible.', `
              <div class="form-group">
                <label>Scroll speed</label>
                <div class="settings-range"><span>Slow</span><input type="range" id="cfg-ticker-speed" min="1" max="10" step="1" value="${tcfg.speed}"><span>Fast</span></div>
              </div>
              <div class="form-group"><label>Binders <em>none selected = all</em></label>
                <div class="col-picker-chips settings-chip-box" id="cfg-ticker-binders">${chipHtml(tickerBinders, tcfg.binders) || '<span class="settings-placeholder">No binders yet</span>'}</div>
              </div>
              <div class="form-group"><label>Sets <em>none selected = all</em></label>
                <div class="col-picker-chips settings-chip-box settings-chip-box-tall" id="cfg-ticker-sets">${chipHtml(tickerSets, tcfg.sets) || '<span class="settings-placeholder">No sets yet</span>'}</div>
              </div>`)}
          </section>

          <section class="${panelClass('features')}" data-settings-panel="features">
            <div class="settings-panel-title"><span>Features</span><h2>Choose what appears in your workspace</h2><p>Optional areas stay out of sight until you explicitly turn them on.</p></div>
            ${settingCard('Advanced features', 'These switches are local preferences—not accounts, subscriptions, or access locks. Both features are off by default.', `
              <div class="settings-feature-stack">
                <label class="settings-feature-row" for="cfg-insights-enabled">
                  <span class="settings-feature-icon">✦</span>
                  <span class="settings-feature-copy"><strong>Insights workspace</strong><small>Build readiness, explainable opportunity signals, and reusable custom reports.</small><span>${(collection.savedReports || []).length.toLocaleString()} saved report${(collection.savedReports || []).length === 1 ? '' : 's'} on this computer</span></span>
                  <input type="checkbox" id="cfg-insights-enabled" ${insightsEnabled() ? 'checked' : ''}>
                  <span class="settings-switch" aria-hidden="true"></span>
                </label>
                <label class="settings-feature-row settings-feature-row-nested" for="cfg-local-intelligence-enabled">
                  <span class="settings-feature-icon settings-feature-icon-ai">AI</span>
                  <span class="settings-feature-copy"><strong>Local Intelligence <em>experimental</em></strong><small>Offline data guardian, entity matching, attention ranking, and natural-language report interpretation.</small><span>Embedded model v1.0 · no API key · no collection data leaves this computer</span></span>
                  <input type="checkbox" id="cfg-local-intelligence-enabled" ${localIntelligenceConfigured() ? 'checked' : ''}>
                  <span class="settings-switch" aria-hidden="true"></span>
                </label>
              </div>
              <div class="settings-feature-note">Local Intelligence lives inside <strong>Insights</strong> and requires it. Turning either feature off hides its workspace without deleting reports or changing collection records.</div>`)}
          </section>

          <section class="${panelClass('pricing')}" data-settings-panel="pricing">
            <div class="settings-panel-title"><span>Pricing</span><h2>Price data and marketplace connections</h2><p>Choose the speed/bandwidth tradeoff and add optional comparison sources.</p></div>
            ${settingCard('Scryfall price engine', 'Bulk data makes full refreshes fast and avoids per-card rate limits.', `
              <label class="settings-check-row"><input type="checkbox" id="cfg-bulk-data" ${collection.settings.useBulkData !== false ? 'checked' : ''}><span><strong>Use Scryfall bulk data for prices</strong><small>Downloads the full price file about once per day (~500 MB). Turn off to use the slower, lower-bandwidth batch API.</small></span></label>`)}
            ${settingCard('Sealed and marketplace pricing', 'TCGCSV/TCGplayer is built in. The services below are optional comparison sources.', `
              <div class="settings-source-strip"><span><b>TCGCSV</b> Built in · no key required</span><span><b>PriceCharting</b> Paid API token</span><span><b>CardTrader</b> Profile API token</span></div>
              <div class="form-group"><label>PriceCharting API token <em>optional</em></label><input type="password" id="cfg-pckey" placeholder="Paste your PriceCharting API token" value="${esc(collection.settings.pricechartingKey || '')}"></div>
              <div class="form-group"><label>CardTrader API token <em>optional</em></label><input type="password" id="cfg-cardtrader-key" placeholder="Enables exact blueprint listing comparisons" value="${esc(collection.settings.cardTraderToken || '')}"><small class="settings-field-help">Sent only to api.cardtrader.com and joined through the product's exact blueprint ID.</small></div>
              <div class="settings-button-row"><button class="btn btn-ghost btn-sm" data-act="open-url" data-arg="https://www.pricecharting.com/api-documentation">PriceCharting docs ↗</button><button class="btn btn-ghost btn-sm" data-act="open-url" data-arg="https://www.cardtrader.com/docs/api/full/reference">CardTrader docs ↗</button></div>`)}
          </section>

          <section class="${panelClass('secret-lair')}" data-settings-panel="secret-lair">
            <div class="settings-panel-title"><span>Secret Lair</span><h2>Data model and economic defaults</h2><p>Understand the reconciled source model and tune fallback cost basis.</p></div>
            ${settingCard('Secret Lair data', 'The baseline reconciles MTGJSON, Scryfall, TCGCSV, mtg.wiki, and official Wizards announcements.', `
              <p class="settings-copy">Check for New Cards refreshes exact products and contents, wiki grouping/MSRP, the bonus catalog, and official launch context. Each source keeps its last known good cache if validation fails.</p>
              <p class="settings-copy">Personal grouping fixes and notes are made with <strong>✎ Edit</strong> in the Explorer and remain local.</p>
              <button class="btn btn-ghost" data-act="showSlDataGuide">Open the full Secret Lair data guide</button>`)}
            ${settingCard('P&L fallback cost basis', 'Used only when a drop is not linked to a sealed product with its own recorded cost. Wiki MSRP still wins when available.', `
              <div class="form-row"><div class="form-group"><label>Non-foil drop MSRP (USD)</label><input type="number" id="cfg-msrp-nonfoil" step="0.01" min="0" value="${collection.settings.slMsrpNonfoil ?? 29.99}"></div><div class="form-group"><label>Foil drop MSRP (USD)</label><input type="number" id="cfg-msrp-foil" step="0.01" min="0" value="${collection.settings.slMsrpFoil ?? 39.99}"></div></div>`)}
          </section>

          <section class="${panelClass('data')}" data-settings-panel="data">
            <div class="settings-panel-title"><span>Data &amp; Backups</span><h2>Protect and manage your local vault</h2><p>Backups are recoverable. Destructive cleanup actions are clearly separated below.</p></div>
            ${settingCard('Backups & recovery', 'A verified backup is written daily and the latest 10 are kept. A restore first sets your current database aside so it can be undone.', `
              <div class="settings-button-row"><button class="btn btn-sm" id="cfg-backup-now">💾 Back up now</button><button class="btn btn-sm" id="cfg-open-backups">📂 Open backups folder</button></div>
              <div id="cfg-backups-list" class="settings-backups-list">Loading backups…</div>`)}
            ${settingCard('Targeted data cleanup', 'These actions permanently delete only the selected category from SQLite.', `
              <div class="settings-button-row"><button class="btn btn-danger btn-sm" id="cfg-clear-cards">Clear All Cards</button><button class="btn btn-danger btn-sm" id="cfg-clear-sealed">Clear All Sealed</button><button class="btn btn-danger btn-sm" id="cfg-clear-hist">Clear Price History</button></div>`)}
            ${settingCard('Danger zone', 'Wipe cards, sealed products, prices, metadata, preferences, optional features, reports, and cached Secret Lair data.', `
              <div class="settings-danger-row"><span><strong>Reset the entire database</strong><small>Cannot be undone. Save or create a backup first if you may need this data again.</small></span><button class="btn btn-danger" id="cfg-reset-all">⚠ Reset Entire Database</button></div>`, 'settings-danger-card')}
          </section>

          <section class="${panelClass('updates')}" data-settings-panel="updates">
            <div class="settings-panel-title"><span>Updates &amp; Support</span><h2>Keep current and stay in touch</h2><p>Manage app updates, read release notes, or send feedback directly.</p></div>
            ${updatesCard()}
            ${settingCard('Support Mana Ledger', 'Mana Ledger is free and local-first. Feedback shapes what gets built next.', `
              <div class="settings-support-grid"><button class="settings-support-action" data-act="open-url" data-arg="https://ko-fi.com/sarcasticsoftware"><span>♥</span><strong>Buy me a coffee</strong><small>Support ongoing development on Ko-fi</small></button><button class="settings-support-action" data-act="showFeedback"><span>💬</span><strong>Send feedback</strong><small>Report a bug or suggest the next feature</small></button></div>`)}
          </section>
        </div>
      </div>

      <footer class="settings-footer">
        <span>Changes apply when you save.</span>
        <div><button class="btn" id="cfg-cancel">Cancel</button><button class="btn btn-primary" id="cfg-save">Save Settings</button></div>
      </footer>
    </div>`, 'settings');

  // Section navigation keeps the modal compact: one focused panel, no giant list.
  const navButtons = [...document.querySelectorAll('.settings-nav-item')];
  const panels = [...document.querySelectorAll('.settings-panel')];
  navButtons.forEach(btn => btn.addEventListener('click', () => {
    const section = btn.dataset.settingsSection;
    navButtons.forEach(b => b.classList.toggle('active', b === btn));
    panels.forEach(panel => panel.classList.toggle('active', panel.dataset.settingsPanel === section));
    const stage = document.querySelector('.settings-stage');
    if (stage) stage.scrollTop = 0;
  }));

  document.getElementById('cfg-cancel')?.addEventListener('click', hideModal);
  wireBackupsSection();

  const insightsToggle = document.getElementById('cfg-insights-enabled');
  const intelligenceToggle = document.getElementById('cfg-local-intelligence-enabled');
  intelligenceToggle?.addEventListener('change', () => {
    if (intelligenceToggle.checked && insightsToggle) insightsToggle.checked = true;
  });
  insightsToggle?.addEventListener('change', () => {
    if (!insightsToggle.checked && intelligenceToggle) intelligenceToggle.checked = false;
  });

  for (const id of ['cfg-ticker-binders', 'cfg-ticker-sets']) {
    document.getElementById(id)?.addEventListener('click', e => {
      const chip = e.target.closest('.col-chip');
      if (chip) chip.classList.toggle('col-chip-on');
    });
  }

  document.getElementById('cfg-save')?.addEventListener('click', () => {
    collection.settings.pricechartingKey = document.getElementById('cfg-pckey')?.value.trim() || '';
    collection.settings.cardTraderToken = document.getElementById('cfg-cardtrader-key')?.value.trim() || '';
    const pickChips = id => [...document.querySelectorAll(`#${id} .col-chip-on`)].map(b => b.dataset.val);
    collection.settings.ticker = {
      speed: parseInt(document.getElementById('cfg-ticker-speed')?.value, 10) || 4,
      binders: pickChips('cfg-ticker-binders'), sets: pickChips('cfg-ticker-sets'),
    };
    const nf = parseFloat(document.getElementById('cfg-msrp-nonfoil')?.value);
    const ff = parseFloat(document.getElementById('cfg-msrp-foil')?.value);
    collection.settings.slMsrpNonfoil = (!isNaN(nf) && nf >= 0) ? nf : 29.99;
    collection.settings.slMsrpFoil = (!isNaN(ff) && ff >= 0) ? ff : 39.99;
    collection.settings.useBulkData = !!document.getElementById('cfg-bulk-data')?.checked;
    setInsightsEnabled(!!document.getElementById('cfg-insights-enabled')?.checked);
    setLocalIntelligenceEnabled(!!document.getElementById('cfg-local-intelligence-enabled')?.checked);
    syncFeatureVisibility();
    hideModal(); renderTickerTape(); autoSave(); render();
    toast('Settings saved', 'success');
  });

  document.getElementById('cfg-clear-cards')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL cards from the database? This cannot be undone.')) return;
    await window.api.cards.clear(); collection.cards = [];
    hideModal(); render(); toast('Cards cleared from database', 'info');
  });
  document.getElementById('cfg-clear-sealed')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL sealed products from the database? This cannot be undone.')) return;
    await window.api.sealed.clear(); collection.sealed = [];
    hideModal(); render(); toast('Sealed products cleared from database', 'info');
  });
  document.getElementById('cfg-clear-hist')?.addEventListener('click', async () => {
    if (!confirm('Delete ALL price history from the database? This cannot be undone.')) return;
    await window.api.prices.clear(); collection.priceHistory = {}; collection.marketPriceHistory = {};
    clearPendingPriceSnaps(); hideModal(); render(); toast('Price history cleared from database', 'info');
  });
  document.getElementById('cfg-reset-all')?.addEventListener('click', async () => {
    if (!confirm('⚠ RESET ENTIRE DATABASE\n\nThis deletes EVERYTHING:\n• All cards\n• All sealed products\n• All price history\n• All card metadata\n• All settings and optional features\n• Saved Insights reports\n• Cached Secret Lair data\n\nThis cannot be undone. Continue?')) return;
    if (!confirm('Last chance — really wipe everything?')) return;
    await window.api.data.reset();
    collection.cards = []; collection.sealed = []; collection.priceHistory = {}; collection.marketPriceHistory = {};
    collection.cardMetadata = {}; collection.failedLookups = []; collection.slPurchaseLots = []; collection.slBonusPulls = [];
    collection.slWatchList = []; collection.slMarketQuotes = []; collection.savedReports = [];
    collection.settings = { pricechartingKey: '', cardTraderToken: '', insightsEnabled: false, localIntelligenceEnabled: false };
    collection.lastPriceRefresh = null;
    clearPendingPriceSnaps(); syncFeatureVisibility(); hideModal(); render();
    toast('Database reset — starting fresh', 'success');
  });

  wireUpdaterUI();
}
