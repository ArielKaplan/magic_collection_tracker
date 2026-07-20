import { hideModal, showModal } from './modals.js';
import { clearPendingPriceSnaps } from './prices.js';
import { render } from './render.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { renderTickerTape, tickerSettings } from './ticker.js';
import { updaterUI, wireUpdaterUI } from './updaterUI.js';
import { esc, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// BACKUPS & RECOVERY (Settings section) — one-click restore + manual backup
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
      listEl.innerHTML = '<div style="padding:8px 0;color:var(--text-muted)">No backups yet — one is written automatically each day.</div>';
      return;
    }
    listEl.innerHTML = backups.map((b, i) => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-top:1px solid var(--border)">
        <span style="flex:1"><strong style="color:var(--text)">${esc(b.date)}</strong>
          <span style="color:var(--text-muted);font-size:12px">· ${b.sizeMB} MB${i === 0 ? ' · latest' : ''}</span></span>
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
      // On success the main process relaunches the app — nothing more to do here.
    }));
  }
  renderList();
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS MODAL
// ─────────────────────────────────────────────────────────────────────────────
export function showSettings() {
  const tcfg = tickerSettings();
  const tickerBinders = [...new Set(collection.cards.map(c => c.binderName).filter(Boolean))].sort();
  const tickerSets    = [...new Set(collection.cards.map(c => c.setName).filter(Boolean))].sort();
  const chipHtml = (vals, selected) => vals.map(v =>
    `<button type="button" class="col-chip${selected.includes(v) ? ' col-chip-on' : ''}" data-val="${esc(v)}">${esc(v)}</button>`
  ).join('');

  showModal(`
    <h2>Settings</h2>

    <h3>Ticker Tape</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Choose which cards scroll across the top and how fast. With nothing selected,
      the ticker shows your whole collection (biggest price movers first).
    </p>
    <div class="form-group">
      <label>Scroll Speed</label>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:11px;color:var(--text-muted)">Slow</span>
        <input type="range" id="cfg-ticker-speed" min="1" max="10" step="1" value="${tcfg.speed}"
          style="flex:1;accent-color:var(--accent)">
        <span style="font-size:11px;color:var(--text-muted)">Fast</span>
      </div>
    </div>
    <div class="form-group">
      <label>Binders <span style="color:var(--text-muted);font-weight:400">(none selected = all)</span></label>
      <div class="col-picker-chips" id="cfg-ticker-binders" style="max-height:110px;overflow-y:auto;padding:2px">
        ${chipHtml(tickerBinders, tcfg.binders) || '<span style="font-size:12px;color:var(--text-muted)">No binders yet</span>'}
      </div>
    </div>
    <div class="form-group">
      <label>Sets <span style="color:var(--text-muted);font-weight:400">(none selected = all)</span></label>
      <div class="col-picker-chips" id="cfg-ticker-sets" style="max-height:140px;overflow-y:auto;padding:2px">
        ${chipHtml(tickerSets, tcfg.sets) || '<span style="font-size:12px;color:var(--text-muted)">No sets yet</span>'}
      </div>
    </div>

    <h3 style="margin-top:22px">Sealed Product Pricing</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      <strong style="color:var(--text)">TCGCSV</strong> is built-in and free — no key needed. It searches TCGPlayer group data and works automatically.<br>
      <strong style="color:var(--text)">PriceCharting</strong> adds a second current-value source with broader collectible coverage.
      It requires a paid API subscription and token; see
      <a href="https://www.pricecharting.com/api-documentation" target="_blank">PriceCharting API documentation</a>.<br>
      <strong style="color:var(--text)">CardTrader</strong> can add live lowest listings by exact blueprint ID when you provide your profile API token; see
      <a href="https://www.cardtrader.com/docs/api/full/reference" target="_blank">CardTrader API documentation</a>.
    </p>
    <div class="form-group">
      <label>PriceCharting API Token <span style="color:var(--text-dim);font-weight:400">(optional)</span></label>
      <input type="password" id="cfg-pckey" placeholder="Paste your PriceCharting API token here" value="${esc(collection.settings.pricechartingKey || '')}">
    </div>
    <div class="form-group">
      <label>CardTrader API Token <span style="color:var(--text-dim);font-weight:400">(optional)</span></label>
      <input type="password" id="cfg-cardtrader-key" placeholder="Enables exact blueprint listing comparisons" value="${esc(collection.settings.cardTraderToken || '')}">
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">Sent only to <code>api.cardtrader.com</code>. The product model’s CardTrader ID is used as the exact blueprint join.</div>
    </div>

    <h3 style="margin-top:22px">Secret Lair Data</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:6px;line-height:1.55">
      The built-in baseline is reconciled from MTGJSON, Scryfall, TCGCSV, and mtg.wiki. <strong style="color:var(--text)">Check for New Cards</strong>
      refreshes exact products/contents, live wiki grouping and MSRP, the bonus-card catalog, and recent official Wizards announcements. Each feed keeps its last known good cache if a source fails validation.
    </p>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:6px;line-height:1.55">
      To fix or re-group a drop just for yourself, use the <strong style="color:var(--text)">✎ Edit</strong> buttons in the Secret Lair Explorer — your groupings and notes save only on this computer and never affect the shared dataset.
    </p>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      To update the built-in dataset for everyone (e.g. when a new superdrop drops), re-run the build pipeline in <code>scripts/sl-build/</code> (see its README) and ship a new version.
    </p>
    <p style="margin:8px 0 14px"><button class="btn btn-ghost" data-act="showSlDataGuide">Open the full Secret Lair data guide</button></p>

    <h3 style="margin-top:22px">Secret Lair P&amp;L</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      Default cost basis for the 💰 P&amp;L view when a drop isn't linked to a sealed product with a
      recorded price. Secret Lair is bought as whole drops, so P&amp;L assumes you paid the drop's
      flat MSRP. Foil/non-foil is picked automatically from the cards you own.
    </p>
    <div class="form-row">
      <div class="form-group">
        <label>Default MSRP — non-foil drop (USD)</label>
        <input type="number" id="cfg-msrp-nonfoil" step="0.01" min="0" value="${collection.settings.slMsrpNonfoil ?? 29.99}">
      </div>
      <div class="form-group">
        <label>Default MSRP — foil drop (USD)</label>
        <input type="number" id="cfg-msrp-foil" step="0.01" min="0" value="${collection.settings.slMsrpFoil ?? 39.99}">
      </div>
    </div>

    <h3 style="margin-top:22px">Price Data</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      With bulk data on, the app downloads Scryfall's full price file once a day (~500 MB)
      and prices everything locally — full refreshes finish in seconds, with no rate limits.
      Turn it off to use the slower per-batch API (much less bandwidth).
    </p>
    <div class="form-group">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400">
        <input type="checkbox" id="cfg-bulk-data" ${collection.settings.useBulkData !== false ? 'checked' : ''}>
        Use Scryfall bulk data for prices (recommended)
      </label>
    </div>

    <h3 style="margin-top:22px">Backups &amp; Recovery</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      The app writes a verified backup once a day and keeps the latest 10. If something ever
      goes wrong, restore any of them below — the app restarts into the restored data, and your
      current data is set aside first (under <code>backups/pre-restore</code>) so a restore can be undone.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn btn-sm" id="cfg-backup-now">💾 Back up now</button>
      <button class="btn btn-sm" id="cfg-open-backups">📂 Open backups folder</button>
    </div>
    <div id="cfg-backups-list" style="font-size:13px;color:var(--text-muted)">Loading backups…</div>

    <h3 style="margin-top:22px">Data Management</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Each button below permanently deletes data from the SQLite database.
      "Load Collection" merges imported data with what's already here — your existing data is preserved unless you reset first.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="btn btn-danger btn-sm" id="cfg-clear-cards">Clear All Cards</button>
      <button class="btn btn-danger btn-sm" id="cfg-clear-sealed">Clear All Sealed</button>
      <button class="btn btn-danger btn-sm" id="cfg-clear-hist">Clear Price History</button>
    </div>

    ${updaterUI.channel === 'github' ? `
    <h3 style="margin-top:22px">Updates</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      Check GitHub Releases for a newer version. If one exists, the app will download it and
      restart to install. <span id="upd-current" style="color:var(--text-muted)"></span>
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-sm" id="cfg-check-updates">Check for Updates</button>
      <button class="btn btn-sm" id="cfg-whats-new" style="display:none">What's New</button>
      <button class="btn btn-sm" id="cfg-download-update" style="display:none">Download Update</button>
      <button class="btn btn-primary btn-sm" id="cfg-install-update" style="display:none">Restart &amp; Install</button>
    </div>
    <div id="upd-status" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
    <div id="upd-progress-wrap" style="display:none;margin-top:8px">
      <div style="background:#222;border-radius:4px;height:8px;overflow:hidden">
        <div id="upd-progress-bar" style="background:var(--accent,#6366f1);height:100%;width:0%;transition:width .2s"></div>
      </div>
      <div id="upd-progress-text" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
    </div>` : `
    <h3 style="margin-top:22px">Updates</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      This build is updated by ${esc(updaterUI.channel === 'steam' ? 'Steam' : updaterUI.channel)} —
      new versions install automatically from your library.
      <span id="upd-current" style="color:var(--text-muted)"></span>
    </p>`}

    <h3 style="margin-top:22px">Support Mana Ledger</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      Mana Ledger is free and always will be. If it's earned a spot in your toolbox,
      a coffee keeps the lights on and the price data flowing.
    </p>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm" data-act="open-url" data-arg="https://ko-fi.com/sarcasticsoftware">♥ Buy me a coffee on Ko-fi</button>
      <button class="btn btn-sm" data-act="showFeedback">💬 Send Feedback</button>
    </div>

    <h3 style="margin-top:22px;color:#f87171">Danger Zone</h3>
    <p style="font-size:12px;color:var(--text-muted);margin-bottom:10px;line-height:1.5">
      Wipe the entire database — cards, sealed, prices, metadata, settings, SL cache.
      The app restarts with empty memory. <strong style="color:#f87171">Cannot be undone.</strong>
      Export "Save Collection" first if you want a backup.
    </p>
    <button class="btn btn-danger" id="cfg-reset-all" style="font-weight:700">⚠ Reset Entire Database</button>

    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:26px">
      <button class="btn" id="cfg-cancel">Cancel</button>
      <button class="btn btn-primary" id="cfg-save">Save Settings</button>
    </div>`);

  document.getElementById('cfg-cancel').addEventListener('click', hideModal);
  wireBackupsSection();

  // Ticker filter chips toggle on click
  for (const id of ['cfg-ticker-binders', 'cfg-ticker-sets']) {
    document.getElementById(id).addEventListener('click', e => {
      const chip = e.target.closest('.col-chip');
      if (chip) chip.classList.toggle('col-chip-on');
    });
  }

  document.getElementById('cfg-save').addEventListener('click', () => {
    collection.settings.pricechartingKey = document.getElementById('cfg-pckey').value.trim();
    collection.settings.cardTraderToken = document.getElementById('cfg-cardtrader-key').value.trim();
    const pickChips = id =>
      [...document.querySelectorAll(`#${id} .col-chip-on`)].map(b => b.dataset.val);
    collection.settings.ticker = {
      speed:   parseInt(document.getElementById('cfg-ticker-speed').value, 10) || 4,
      binders: pickChips('cfg-ticker-binders'),
      sets:    pickChips('cfg-ticker-sets'),
    };
    const nf = parseFloat(document.getElementById('cfg-msrp-nonfoil').value);
    const ff = parseFloat(document.getElementById('cfg-msrp-foil').value);
    collection.settings.slMsrpNonfoil = (!isNaN(nf) && nf >= 0) ? nf : 29.99;
    collection.settings.slMsrpFoil    = (!isNaN(ff) && ff >= 0) ? ff : 39.99;
    collection.settings.useBulkData   = !!document.getElementById('cfg-bulk-data')?.checked;
    hideModal();
    renderTickerTape();
    autoSave();
    toast('Settings saved', 'success');
  });
  document.getElementById('cfg-clear-cards').addEventListener('click', async () => {
    if (!confirm('Delete ALL cards from the database? This cannot be undone.')) return;
    await window.api.cards.clear();
    collection.cards = [];
    hideModal(); render(); toast('Cards cleared from database', 'info');
  });
  document.getElementById('cfg-clear-sealed').addEventListener('click', async () => {
    if (!confirm('Delete ALL sealed products from the database? This cannot be undone.')) return;
    await window.api.sealed.clear();
    collection.sealed = [];
    hideModal(); render(); toast('Sealed products cleared from database', 'info');
  });
  document.getElementById('cfg-clear-hist').addEventListener('click', async () => {
    if (!confirm('Delete ALL price history from the database? This cannot be undone.')) return;
    await window.api.prices.clear();
    collection.priceHistory = {};
    collection.marketPriceHistory = {};
    clearPendingPriceSnaps();
    hideModal(); render(); toast('Price history cleared from database', 'info');
  });
  document.getElementById('cfg-reset-all').addEventListener('click', async () => {
    if (!confirm('⚠ RESET ENTIRE DATABASE\n\nThis deletes EVERYTHING:\n• All cards\n• All sealed products\n• All price history\n• All card metadata\n• All settings\n• Cached Secret Lair data\n\nThis cannot be undone. Continue?')) return;
    if (!confirm('Last chance — really wipe everything?')) return;
    await window.api.data.reset();
    // Reset in-memory state to a fresh collection
    collection.cards               = [];
    collection.sealed              = [];
    collection.priceHistory        = {};
    collection.marketPriceHistory  = {};
    collection.cardMetadata        = {};
    collection.failedLookups       = [];
    collection.slPurchaseLots      = [];
    collection.slBonusPulls        = [];
    collection.slWatchList         = [];
    collection.slMarketQuotes      = [];
    collection.savedReports       = [];
    collection.settings            = { pricechartingKey: '', cardTraderToken: '' };
    collection.lastPriceRefresh    = null;
    clearPendingPriceSnaps();
    hideModal();
    render();
    toast('Database reset — starting fresh', 'success');
  });

  // Updates section
  wireUpdaterUI();
}

