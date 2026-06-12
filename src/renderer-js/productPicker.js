import { hideModal, showModal } from './modals.js';
import { showAddSealedModal } from './sealedModals.js';
import { ensureTcgcsvCache, refreshTcgcsvCache, searchPriceCharting } from './sealedPricing.js';
import { collection, tcgcsvCache } from './state.js';
import { esc, fmt, netFetch, toast } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT PICKER — unified search + set browser for the TCGplayer catalog.
// Full-size dialog; searches product names live, streams in results while the
// index syncs, and lets you drill into any set from the rail on the left.
// ─────────────────────────────────────────────────────────────────────────────
export function showProductPicker(opts = {}) {
  const { title = 'Find Sealed Product', initialQuery = '', onPick = null, onManual = null } = opts;
  let query         = initialQuery;
  let selectedGid   = null;     // null = search across all sets
  let selectedGname = '';
  let groupProducts = null;     // live-fetched full product list of the selected set
  let groupLoading  = false;
  let pcResults     = [];       // PriceCharting results, appended on demand
  let debounce;

  ensureTcgcsvCache();          // load persisted index / kick off background sync

  showModal(`
    <h2 style="margin-bottom:6px">${esc(title)}</h2>
    <input type="text" id="pp-search" class="pp-search"
      placeholder="Search products — try “So Salty” or “Artist Series”…" value="${esc(query)}">
    <div class="pp-body">
      <div class="pp-rail">
        <input type="text" id="pp-set-filter" class="pp-set-filter" placeholder="Filter sets…">
        <div class="pp-sets" id="pp-sets"></div>
      </div>
      <div class="pp-main">
        <div class="pp-results" id="pp-results"></div>
      </div>
    </div>
    <div class="pp-foot">
      <span class="pp-status" id="pp-status"></span>
      <span style="flex:1"></span>
      ${collection.settings.pricechartingKey ? '<button class="btn btn-sm" id="pp-pc-btn">+ PriceCharting</button>' : ''}
      <button class="btn" id="pp-manual">✎ Enter manually</button>
      <button class="btn btn-ghost" id="pp-cancel">Cancel</button>
    </div>`, 'xl');

  const $id = id => document.getElementById(id);
  function close() { tcgcsvCache.onProgress = null; hideModal(); }

  function fmtRow(p) {
    return `
      <div class="pp-item" data-name="${esc(p.name)}" data-price="${p.marketPrice ?? ''}"
           data-pc="${p.source === 'pricecharting' ? esc(p.id) : ''}" data-set="${esc(p.consoleName || '')}">
        <div class="pp-item-main">
          <div class="pp-item-name">${esc(p.name)}</div>
          <div class="pp-item-set">${esc(p.consoleName || '')}</div>
        </div>
        ${p.source === 'pricecharting' ? '<span class="pp-item-src">PriceCharting</span>' : ''}
        <div class="pp-item-price">${p.marketPrice != null ? fmt(p.marketPrice) : '—'}</div>
      </div>`;
  }

  function currentResults() {
    if (selectedGid) {
      const toks = query.toLowerCase().split(/\s+/).filter(Boolean);
      return (groupProducts || []).filter(p => toks.every(t => p.name.toLowerCase().includes(t)));
    }
    if (query.trim()) return [...searchTcgcsvLocal(query, 200), ...pcResults];
    // Idle: surface the priciest Secret Lair products as a starting point
    return tcgcsvCache.sealedProducts
      .filter(p => (p.consoleName || '').toLowerCase().includes('secret lair') && p.marketPrice != null)
      .sort((a, b) => b.marketPrice - a.marketPrice)
      .slice(0, 30);
  }

  function renderResults() {
    const el = $id('pp-results'); if (!el) return;
    if (selectedGid && groupLoading) { el.innerHTML = '<div class="pp-empty">Loading set…</div>'; return; }
    const rows = currentResults();
    if (!rows.length) {
      el.innerHTML = `<div class="pp-empty">${
        tcgcsvCache.syncing ? 'No matches yet — the product index is still loading (watch the status below)…'
        : !tcgcsvCache.sealedProducts.length ? 'Product index is empty — click “load now” below.'
        : query.trim() ? `No products match “${esc(query)}”. Try fewer words, or pick the set on the left.`
        : 'Type to search across every set, or pick a set on the left.'}</div>`;
      return;
    }
    const heading = !selectedGid && !query.trim()
      ? '<div class="pp-heading">Popular Secret Lair products — or just start typing</div>' : '';
    el.innerHTML = heading + rows.map(fmtRow).join('');
    el.querySelectorAll('.pp-item').forEach(item => {
      item.addEventListener('click', () => {
        const price = item.dataset.price ? parseFloat(item.dataset.price) : NaN;
        const sel = {
          name:    item.dataset.name,
          price:   isNaN(price) ? null : price,
          pcId:    item.dataset.pc || null,
          setName: item.dataset.set || '',
        };
        close();
        onPick?.(sel);
      });
    });
  }

  function renderSets() {
    const el = $id('pp-sets'); if (!el) return;
    const f = ($id('pp-set-filter')?.value || '').toLowerCase();
    const groups = (tcgcsvCache.groups || [])
      .filter(g => g.name && (!f || g.name.toLowerCase().includes(f)))
      .sort((a, b) => a.name.localeCompare(b.name));
    el.innerHTML = `
      <div class="pp-set${selectedGid == null ? ' on' : ''}" data-gid="">All sets</div>
      ${groups.map(g => `<div class="pp-set${String(selectedGid) === String(g.groupId) ? ' on' : ''}" data-gid="${g.groupId}" title="${esc(g.name)}">${esc(g.name)}</div>`).join('')}`;
    el.querySelectorAll('.pp-set').forEach(s =>
      s.addEventListener('click', () => selectSet(s.dataset.gid, s.textContent)));
  }

  async function selectSet(gid, gname) {
    if (!gid) {
      selectedGid = null; selectedGname = ''; groupProducts = null;
      renderSets(); renderResults();
      return;
    }
    selectedGid = gid; selectedGname = gname; groupProducts = null; groupLoading = true;
    renderSets(); renderResults();
    try {
      // Live fetch so the set view shows ALL its products, not just the
      // sealed-keyword subset kept in the search index.
      const [prodResp, priceResp] = await Promise.all([
        netFetch(`https://tcgcsv.com/tcgplayer/1/${gid}/products`),
        netFetch(`https://tcgcsv.com/tcgplayer/1/${gid}/prices`),
      ]);
      if (!prodResp.ok || !priceResp.ok) throw new Error('fetch failed');
      const products = await prodResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const prices   = await priceResp.json().then(r => Array.isArray(r) ? r : (r.results || []));
      const priceMap = {};
      for (const p of prices) {
        const id = p.productId ?? p.skuId;
        const price = p.marketPrice ?? p.midPrice ?? p.lowPrice;
        if (id != null && price != null && (priceMap[id] == null || price > priceMap[id])) priceMap[id] = price;
      }
      groupProducts = products
        .map(p => ({
          id: `tcgcsv-${gid}-${p.productId}`,
          name: p.name || p.cleanName || '',
          consoleName: gname,
          marketPrice: priceMap[p.productId] != null ? parseFloat(priceMap[p.productId]) : null,
          source: 'tcgcsv',
        }))
        .filter(p => p.name)
        .sort((a, b) => (b.marketPrice ?? -1) - (a.marketPrice ?? -1));
    } catch (err) {
      groupProducts = [];
      toast('Could not load set: ' + err.message, 'error');
    }
    groupLoading = false;
    if (String(selectedGid) === String(gid)) renderResults();
  }

  function renderStatus() {
    const el = $id('pp-status'); if (!el) return;
    if (tcgcsvCache.syncing) {
      el.innerHTML = `<span class="pp-sync-dot"></span>Indexing sets… ${tcgcsvCache.syncDone}/${tcgcsvCache.syncTotal} — results update live`;
    } else if (tcgcsvCache.sealedProducts.length) {
      const t = tcgcsvCache.lastRefresh ? new Date(tcgcsvCache.lastRefresh).toLocaleString() : '?';
      el.innerHTML = `${tcgcsvCache.sealedProducts.length.toLocaleString()} products indexed · ${t} · <a href="#" id="pp-refresh">↻ refresh</a>`;
    } else {
      el.innerHTML = `Product index empty · <a href="#" id="pp-refresh">↻ load now</a>`;
    }
    $id('pp-refresh')?.addEventListener('click', e => {
      e.preventDefault();
      refreshTcgcsvCache();
      renderStatus();
    });
  }

  // Live updates while the background sync streams products in
  let lastPaint = 0;
  tcgcsvCache.onProgress = () => {
    if (!document.getElementById('pp-results')) { tcgcsvCache.onProgress = null; return; }
    renderStatus();
    const now = Date.now();
    if (now - lastPaint > 400) {
      lastPaint = now;
      renderSets();
      if (!selectedGid) renderResults();
    }
  };

  $id('pp-search').addEventListener('input', e => {
    query = e.target.value;
    pcResults = [];
    clearTimeout(debounce);
    debounce = setTimeout(renderResults, 200);
  });
  $id('pp-set-filter').addEventListener('input', renderSets);
  $id('pp-cancel').addEventListener('click', close);
  $id('pp-manual').addEventListener('click', () => { const q = query.trim(); close(); onManual?.(q); });
  $id('pp-pc-btn')?.addEventListener('click', async () => {
    const btn = $id('pp-pc-btn');
    if (!query.trim()) { toast('Type a search first', 'info'); return; }
    btn.textContent = 'Searching…'; btn.disabled = true;
    try {
      pcResults = await searchPriceCharting(query);
      renderResults();
      if (!pcResults.length) toast('No PriceCharting results', 'info');
    } catch (err) { toast('PriceCharting: ' + err.message, 'error'); }
    finally { btn.textContent = '+ PriceCharting'; btn.disabled = false; }
  });

  renderSets(); renderResults(); renderStatus();
  const search = $id('pp-search');
  search.focus();
  if (query) search.select();
}

// Entry point for "+ Add Product": pick from the catalog (auto-fills name,
// price, and set) or fall through to a blank manual form.
export function openAddProductFlow() {
  showProductPicker({
    title: 'Add Sealed Product',
    onPick: sel => showAddSealedModal(null, {
      name: sel.name, price: sel.price, pcId: sel.pcId,
      setName: sel.setName, linkedName: sel.name,
    }),
    onManual: q => showAddSealedModal(null, { name: q || '' }),
  });
}

