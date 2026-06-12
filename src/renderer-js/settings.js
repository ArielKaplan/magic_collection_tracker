import { hideModal, showModal } from './modals.js';
import { clearPendingPriceSnaps } from './prices.js';
import { render } from './render.js';
import { collection } from './state.js';
import { autoSave } from './storage.js';
import { renderTickerTape, tickerSettings } from './ticker.js';
import { wireUpdaterUI } from './updaterUI.js';
import { esc, toast } from './utils.js';


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
      <strong style="color:var(--text)">PriceCharting</strong> adds a second source with broader coverage. Get a free key at
      <a href="https://www.pricecharting.com/api" target="_blank">pricecharting.com/api</a> (email signup only, no approval).
    </p>
    <div class="form-group">
      <label>PriceCharting API Key <span style="color:var(--text-dim);font-weight:400">(optional)</span></label>
      <input type="text" id="cfg-pckey" placeholder="Paste your PriceCharting API key here" value="${esc(collection.settings.pricechartingKey || '')}">
    </div>

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

    <h3 style="margin-top:22px">Updates</h3>
    <p style="font-size:13px;color:var(--text-dim);margin-bottom:10px;line-height:1.55">
      Check GitHub Releases for a newer version. If one exists, the app will download it and
      restart to install. <span id="upd-current" style="color:var(--text-muted)"></span>
    </p>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-sm" id="cfg-check-updates">Check for Updates</button>
      <button class="btn btn-sm" id="cfg-download-update" style="display:none">Download Update</button>
      <button class="btn btn-primary btn-sm" id="cfg-install-update" style="display:none">Restart &amp; Install</button>
    </div>
    <div id="upd-status" style="margin-top:10px;font-size:12px;color:var(--text-muted);min-height:16px"></div>
    <div id="upd-progress-wrap" style="display:none;margin-top:8px">
      <div style="background:#222;border-radius:4px;height:8px;overflow:hidden">
        <div id="upd-progress-bar" style="background:var(--accent,#6366f1);height:100%;width:0%;transition:width .2s"></div>
      </div>
      <div id="upd-progress-text" style="font-size:11px;color:var(--text-muted);margin-top:4px"></div>
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

  // Ticker filter chips toggle on click
  for (const id of ['cfg-ticker-binders', 'cfg-ticker-sets']) {
    document.getElementById(id).addEventListener('click', e => {
      const chip = e.target.closest('.col-chip');
      if (chip) chip.classList.toggle('col-chip-on');
    });
  }

  document.getElementById('cfg-save').addEventListener('click', () => {
    collection.settings.pricechartingKey = document.getElementById('cfg-pckey').value.trim();
    const pickChips = id =>
      [...document.querySelectorAll(`#${id} .col-chip-on`)].map(b => b.dataset.val);
    collection.settings.ticker = {
      speed:   parseInt(document.getElementById('cfg-ticker-speed').value, 10) || 4,
      binders: pickChips('cfg-ticker-binders'),
      sets:    pickChips('cfg-ticker-sets'),
    };
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
    collection.settings            = { pricechartingKey: '' };
    collection.lastPriceRefresh    = null;
    clearPendingPriceSnaps();
    hideModal();
    render();
    toast('Database reset — starting fresh', 'success');
  });

  // Updates section
  wireUpdaterUI();
}

