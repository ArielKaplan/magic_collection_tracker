// Secret Lair Intelligence — user-authored overlays and decision tools built
// on the finish-aware product spine. Sourced contents remain immutable; bundle
// costs, observed bonus pulls, watches and secondary quotes live separately.

import { ownedCards } from './analytics.js';
import { hideModal, showModal } from './modals.js';
import { fetchScryfallBatch } from './prices.js';
import { finishGroup, getSlProducts, slProductForDrop } from './slData.js';
import { slHistorySeedInfo } from './slHistorySeed.js';
import { allSlBonusCards, slBonusCardsForDrop, slBonusInfo } from './slBonus.js';
import { slAnnouncementInfo, slAnnouncements } from './slAnnouncements.js';
import { slWikiInfo, slWikiMsrp, slWikiRowFor, upcomingSlDrops } from './slWiki.js';
import { collection, tcgcsvCache } from './state.js';
import { esc, fmt, netFetch, toast, today, uid } from './utils.js';

const rerender = () => { if (typeof window !== 'undefined') window.render?.(); };
const save = () => { if (typeof window !== 'undefined') window.autoSave?.(); };
const norm = s => String(s || '').toLowerCase().replace(/\band\b/g, '').replace(/[^a-z0-9]+/g, '');
const money = n => Number.isFinite(Number(n)) ? fmt(Number(n)) : '—';
const marketMoney = (n, currency = 'USD') => {
  if (!Number.isFinite(Number(n))) return '—';
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(n)); }
  catch { return `${currency} ${Number(n).toFixed(2)}`; }
};
const dateLabel = d => d ? String(d).slice(0, 10) : 'Unknown';
const sourceAge = at => {
  if (!at) return 'not cached';
  const days = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 86400000));
  return days === 0 ? 'today' : `${days}d ago`;
};

function infoForDrop(drop) {
  return (typeof SL_DROP_TO_SUPERDROP !== 'undefined' && SL_DROP_TO_SUPERDROP[drop]) || {};
}

export function activeSlLotItems() {
  const rows = [];
  for (const lot of (collection.slPurchaseLots || [])) {
    for (const [index, item] of (lot.items || []).entries()) {
      if (!item.dropName || item.status === 'sold') continue;
      rows.push({ ...item, lotId: lot.id, lotName: lot.name, acquiredAt: lot.acquiredAt, index });
    }
  }
  return rows;
}

function exactTcgcsvProduct(product) {
  const wanted = String(product?.tcgplayerProductId || '');
  return wanted ? (tcgcsvCache.sealedProducts || []).find(p => String(p.productId || '') === wanted) || null : null;
}

export function slLotPnlRows() {
  return activeSlLotItems().map(item => {
    const product = item.productUuid ? getSlProducts().find(p => p.uuid === item.productUuid) : slProductForDrop(item.dropName);
    const quote = exactTcgcsvProduct(product);
    return {
      ...item,
      quantity: Number(item.quantity) || 1,
      allocatedCost: Number(item.allocatedCost) || 0,
      marketValue: item.status === 'sealed' && quote?.marketPrice != null ? Number(quote.marketPrice) : null,
    };
  });
}

export function slLotHeldQuantity(drop) {
  return activeSlLotItems().filter(x => x.dropName === drop && x.status === 'sealed')
    .reduce((n, x) => n + (Number(x.quantity) || 1), 0);
}

export function computeSlProductCompletion(drop, cards = ownedCards()) {
  const product = slProductForDrop(drop);
  if (!product) return { drop, product: null, rows: [], required: 0, owned: 0, missing: 0, wrongFinish: 0, pct: 0 };
  const rows = (product.cards || []).map(req => {
    const matching = cards.filter(c => (c.scryfallId || '').toLowerCase() === req.scryfallId && finishGroup(c.foil) === req.finish);
    const wrong = cards.filter(c => (c.scryfallId || '').toLowerCase() === req.scryfallId && finishGroup(c.foil) !== req.finish);
    const owned = matching.reduce((n, c) => n + (Number(c.quantity) || 1), 0);
    const wrongQty = wrong.reduce((n, c) => n + (Number(c.quantity) || 1), 0);
    const required = Number(req.count) || 1;
    return { ...req, required, owned, missing: Math.max(0, required - owned), extra: Math.max(0, owned - required), wrongQty };
  });
  const required = rows.reduce((n, r) => n + r.required, 0);
  const exactOwned = rows.reduce((n, r) => n + Math.min(r.required, r.owned), 0);
  return {
    drop, product, rows, required, owned: exactOwned,
    missing: rows.reduce((n, r) => n + r.missing, 0),
    wrongFinish: rows.reduce((n, r) => n + r.wrongQty, 0),
    pct: required ? Math.round(exactOwned / required * 100) : 0,
  };
}

export function slProductHistoryStats(drop) {
  const product = slProductForDrop(drop);
  if (!product) return null;
  const totals = new Map();
  const coverage = new Map();
  for (const card of (product.cards || [])) {
    const foil = card.finish === 'nonfoil' ? 'normal' : card.finish;
    for (const point of (collection.priceHistory[`${card.scryfallId}|${foil}`] || [])) {
      const price = Number(point.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      totals.set(point.date, (totals.get(point.date) || 0) + price * (Number(card.count) || 1));
      coverage.set(point.date, (coverage.get(point.date) || 0) + 1);
    }
  }
  const requiredRows = (product.cards || []).length;
  const rows = [...totals].map(([date, value]) => ({ date, value, coverage: coverage.get(date) || 0 }))
    .filter(x => x.coverage >= Math.max(1, Math.ceil(requiredRows * .75))).sort((a,b)=>a.date.localeCompare(b.date));
  if (rows.length < 2) return { rows, points: rows.length, returnPct: null, volatility: null, low: rows[0]?.value ?? null, high: rows[0]?.value ?? null };
  const returns = [];
  for (let i = 1; i < rows.length; i++) if (rows[i - 1].value > 0) returns.push((rows[i].value - rows[i - 1].value) / rows[i - 1].value * 100);
  const mean = returns.reduce((a,b)=>a+b,0) / (returns.length || 1);
  const variance = returns.reduce((n,x)=>n+(x-mean)**2,0) / (returns.length || 1);
  return { rows, points: rows.length, start: rows[0].value, end: rows.at(-1).value, returnPct: (rows.at(-1).value - rows[0].value) / rows[0].value * 100, volatility: Math.sqrt(variance), low: Math.min(...rows.map(x=>x.value)), high: Math.max(...rows.map(x=>x.value)) };
}

const priceForFinish = (card, finish) => {
  const p = card?.prices || {};
  const raw = finish === 'foil' ? (p.usd_foil ?? p.usd) : finish === 'etched' ? (p.usd_etched ?? p.usd_foil ?? p.usd) : (p.usd ?? p.usd_foil);
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

export async function showSlCompletionReport(drop) {
  const report = computeSlProductCompletion(drop);
  if (!report.product) { toast('No exact product model is available for this drop yet.', 'info'); return; }
  const priceById = new Map();
  try {
    const ids = [...new Set(report.rows.map(r => r.scryfallId))];
    for (let i = 0; i < ids.length; i += 75) {
      const result = await fetchScryfallBatch(ids.slice(i, i + 75));
      for (const c of (result.data || [])) priceById.set(c.id.toLowerCase(), c);
    }
  } catch { /* ownership audit remains useful without prices */ }
  let missingValue = 0, pricedMissing = 0;
  const body = report.rows.map(r => {
    const unit = priceForFinish(priceById.get(r.scryfallId), r.finish);
    if (unit != null && r.missing) { missingValue += unit * r.missing; pricedMissing += r.missing; }
    const status = r.missing === 0
      ? `<span style="color:var(--green);font-weight:700">✓ Complete${r.extra ? ` · +${r.extra} extra` : ''}</span>`
      : `<span style="color:#f87171;font-weight:700">${r.missing} missing</span>${r.wrongQty ? ` <span style="color:#f59e0b">· ${r.wrongQty} wrong finish</span>` : ''}`;
    return `<tr style="border-top:1px solid var(--border)">
      <td style="padding:7px 9px"><strong>${esc(r.name)}</strong><div style="font-size:10.5px;color:var(--text-muted)">#${esc(r.number || '?')} · ${esc(r.scryfallId)}</div></td>
      <td style="padding:7px 9px;text-transform:capitalize">${esc(r.finish)}</td>
      <td style="padding:7px 9px;text-align:center">${r.owned} / ${r.required}</td>
      <td style="padding:7px 9px">${status}</td>
      <td style="padding:7px 9px;text-align:right">${r.missing && unit != null ? fmt(unit * r.missing) : '—'}</td>
    </tr>`;
  }).join('');
  showModal(`
    <div style="max-width:980px">
      <h2 style="margin:0 0 4px">Exact completion · ${esc(drop)}</h2>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">${esc(report.product.name)} · exact printing + required finish + quantity</div>
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px">
        <span class="sl-type-badge">${report.owned}/${report.required} exact (${report.pct}%)</span>
        <span class="sl-type-badge" style="color:${report.missing ? '#f87171' : 'var(--green)'}">${report.missing} missing</span>
        <span class="sl-type-badge" style="color:${report.wrongFinish ? '#f59e0b' : 'var(--text-muted)'}">${report.wrongFinish} wrong-finish copies</span>
        <span class="sl-type-badge">Missing value ${pricedMissing ? `≈ ${fmt(missingValue)}` : 'not priced'}</span>
      </div>
      <div style="max-height:520px;overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)">
          <th style="padding:7px 9px;text-align:left">Printing</th><th style="padding:7px 9px;text-align:left">Required finish</th><th style="padding:7px 9px">Owned</th><th style="padding:7px 9px;text-align:left">Audit</th><th style="padding:7px 9px;text-align:right">Acquire</th>
        </tr></thead><tbody>${body}</tbody></table>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        ${report.missing ? `<button class="btn btn-ghost" data-act="wantSlCompletionMissing" data-arg="${esc(drop)}">★ Add missing to Want List</button>` : ''}
        <button class="btn btn-primary" data-act="hideModal">Close</button>
      </div>
    </div>`, 'xl');
}

export function wantSlCompletionMissing(drop) {
  window.addDropMissingToWantList?.(drop);
  hideModal();
}

function marketplaceLinks(product) {
  const q = encodeURIComponent(product?.name || product?.legacyDrop || 'Secret Lair');
  const ids = product?.identifiers || {};
  return [
    ['TCGplayer', product?.tcgplayerProductId ? `https://www.tcgplayer.com/product/${encodeURIComponent(product.tcgplayerProductId)}` : `https://www.tcgplayer.com/search/magic/product?q=${q}`],
    ['Cardmarket', `https://www.cardmarket.com/en/Magic/Products/Search?searchString=${q}`],
    ['CardTrader', `https://www.cardtrader.com/cards?query=${q}`],
    ['Card Kingdom', `https://www.cardkingdom.com/catalog/search?search=header&filter%5Bname%5D=${q}`],
  ].map(([name, url]) => ({ name, url, id: name === 'Cardmarket' ? ids.mcmId : name === 'CardTrader' ? ids.cardtraderId : name === 'Card Kingdom' ? ids.cardKingdomId : product?.tcgplayerProductId }));
}

export function marketComparisonForDrop(drop) {
  const product = slProductForDrop(drop);
  const tcg = exactTcgcsvProduct(product);
  const linked = (collection.sealed || []).find(s => s.dropName === drop && s.pricechartingId);
  const pcLatest = linked?.priceHistory?.length ? linked.priceHistory[linked.priceHistory.length - 1] : null;
  const manual = (collection.slMarketQuotes || []).filter(q => q.dropName === drop || (q.productUuid && q.productUuid === product?.uuid));
  const rows = [];
  if (tcg) rows.push({ source: 'TCGplayer / TCGCSV', currency: 'USD', type: 'market', value: tcg.marketPrice, low: tcg.lowPrice, mid: tcg.midPrice, high: tcg.highPrice, at: tcg.modifiedOn || tcgcsvCache.sourceUpdatedAt });
  if (pcLatest) rows.push({ source: 'PriceCharting', currency: 'USD', type: pcLatest.source || 'sealed', value: pcLatest.price, at: pcLatest.date });
  rows.push(...manual.map(q => ({ source: q.source, currency: q.currency || 'USD', type: q.quoteType || 'listed', value: Number(q.amount), at: q.observedAt, url: q.url, note: q.note, id: q.id })));
  return { product, rows, links: marketplaceLinks(product) };
}

export async function refreshSlCardTraderQuote(drop) {
  const product = slProductForDrop(drop);
  const blueprintId = product?.identifiers?.cardtraderId;
  const token = collection.settings.cardTraderToken;
  if (!blueprintId) { toast('This SKU has no CardTrader blueprint ID.', 'info'); return; }
  if (!token) { toast('Add your CardTrader API token in Settings first.', 'info'); return; }
  try {
    const resp = await netFetch(`https://api.cardtrader.com/api/v2/marketplace/products?blueprint_id=${encodeURIComponent(blueprintId)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const raw = await resp.json();
    const rows = Array.isArray(raw) ? raw : (raw.results || raw.products || []);
    const cheapest = new Map();
    for (const row of rows) {
      if ((Number(row.quantity) || 0) <= 0) continue;
      const cents = Number(row.price?.cents ?? row.price_cents);
      const currency = String(row.price?.currency ?? row.price_currency ?? '').toUpperCase();
      if (!Number.isFinite(cents) || cents < 0 || !currency) continue;
      const amount = cents / 100;
      if (!cheapest.has(currency) || amount < cheapest.get(currency)) cheapest.set(currency, amount);
    }
    collection.slMarketQuotes = (collection.slMarketQuotes || []).filter(q => !(q.dropName === drop && q.source === 'CardTrader' && q.automated));
    for (const [currency, amount] of cheapest) collection.slMarketQuotes.push({ id: uid(), dropName: drop, productUuid: product.uuid, source: 'CardTrader', amount, currency, quoteType: 'lowest listed', observedAt: today(), url: `https://www.cardtrader.com/cards?query=${encodeURIComponent(product.name)}`, note: `${rows.length} marketplace listings returned for blueprint ${blueprintId}`, automated: true });
    save();
    toast(cheapest.size ? `CardTrader refreshed · ${[...cheapest].map(([c,v])=>`${c} ${v.toFixed(2)}`).join(' · ')}` : 'CardTrader returned no in-stock listings.', cheapest.size ? 'success' : 'info');
    showSlProductTruth(drop);
  } catch (e) { toast(`CardTrader refresh failed: ${e.message}`, 'error'); }
}

export function showSlProductTruth(drop) {
  const product = slProductForDrop(drop);
  if (!product) { toast('No product record is available for this drop yet.', 'info'); return; }
  const wiki = slWikiRowFor(drop);
  const market = marketComparisonForDrop(drop);
  const history = slProductHistoryStats(drop);
  const identifiers = Object.entries(product.identifiers || {}).sort(([a], [b]) => a.localeCompare(b));
  const finishCounts = {};
  for (const c of (product.cards || [])) finishCounts[c.finish] = (finishCounts[c.finish] || 0) + (Number(c.count) || 1);
  const marketRows = market.rows.length ? market.rows.map(r => `<tr style="border-top:1px solid var(--border)">
      <td style="padding:7px 9px;font-weight:650">${esc(r.source)}</td><td style="padding:7px 9px">${esc(r.currency)} · ${esc(r.type)}</td>
      <td style="padding:7px 9px;text-align:right;font-weight:700">${esc(marketMoney(r.value, r.currency))}</td>
      <td style="padding:7px 9px;color:var(--text-muted)">${r.low != null ? `low ${esc(marketMoney(r.low, r.currency))} · mid ${esc(marketMoney(r.mid, r.currency))} · high ${esc(marketMoney(r.high, r.currency))}` : esc(r.note || '')}</td>
      <td style="padding:7px 9px;color:var(--text-muted)">${esc(dateLabel(r.at))}</td>
    </tr>`).join('') : `<tr><td colspan="5" style="padding:14px;color:var(--text-muted)">No market observation cached yet.</td></tr>`;
  showModal(`
    <div style="max-width:980px">
      <h2 style="margin:0 0 4px">Product truth · ${esc(drop)}</h2>
      <div style="color:var(--text-muted);font-size:12px;margin-bottom:14px">Sourced identity, guaranteed contents contract, confidence and market observations</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;font-size:12px;margin-bottom:14px">
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>SKU</strong><br>${esc(product.name)}<br><span style="color:var(--text-muted)">${esc(product.uuid)}</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>Finish / contents</strong><br>${esc(product.finishLabel || product.finish)} · ${(product.cards || []).reduce((n,c)=>n+(Number(c.count)||1),0)} copies<br><span style="color:var(--text-muted)">${esc(Object.entries(finishCounts).map(([k,v])=>`${v} ${k}`).join(' · '))}</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>Confidence</strong><br><span style="color:${product.lowConfidence ? '#f59e0b' : 'var(--green)'}">${product.lowConfidence ? 'Fallback / review recommended' : 'Exact sealed-product chain'}</span><br><span style="color:var(--text-muted)">${esc(product.subtype || 'unknown subtype')}</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>Release</strong><br>${esc(wiki?.date || product.releaseDate || 'Unknown')}<br><span style="color:var(--text-muted)">${esc(infoForDrop(drop).superdrop || wiki?.superdrop || 'Standalone')}</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>MSRP</strong><br>${money(slWikiMsrp(drop, product.finish))}<br><span style="color:var(--text-muted)">finish-aware wiki MSRP</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>Identifiers</strong><br>${identifiers.length} preserved<br><span style="color:var(--text-muted)">${esc(identifiers.map(([k]) => k).join(', ') || 'none')}</span></div>
        <div style="padding:10px;background:var(--surface);border-radius:7px"><strong>Historical singles</strong><br>${history?.returnPct == null ? 'Not enough points' : `${history.returnPct >= 0 ? '+' : ''}${history.returnPct.toFixed(1)}%`}<br><span style="color:var(--text-muted)">${history?.points || 0} product-value points${history?.volatility != null ? ` · ${history.volatility.toFixed(1)}% interval volatility` : ''}</span></div>
      </div>
      <details style="margin:0 0 12px"><summary style="cursor:pointer;font-size:12px;font-weight:700">Guaranteed contents · ${(product.cards || []).length} printing/finish rows</summary><div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:7px;margin-top:7px">${(product.cards || []).map(c=>`<div style="display:grid;grid-template-columns:1fr 90px 54px;gap:8px;padding:6px 9px;border-top:1px solid var(--border);font-size:11px"><span><strong>${esc(c.name)}</strong> <span style="color:var(--text-muted)">#${esc(c.number || '?')}</span></span><span style="text-transform:capitalize">${esc(c.finish)}</span><span style="text-align:right">×${c.count || 1}</span></div>`).join('')}</div></details>
      <h3 style="font-size:13px;margin:12px 0 7px">Cross-market observations</h3>
      <div style="overflow:auto;border:1px solid var(--border);border-radius:8px"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)"><th style="padding:7px 9px;text-align:left">Source</th><th style="padding:7px 9px;text-align:left">Basis</th><th style="padding:7px 9px;text-align:right">Value</th><th style="padding:7px 9px;text-align:left">Context</th><th style="padding:7px 9px;text-align:left">Observed</th></tr></thead><tbody>${marketRows}</tbody></table></div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:10px">${market.links.map(x => `<a href="#" class="btn btn-ghost" style="font-size:11px" data-act="open-url" data-arg="${esc(x.url)}">${esc(x.name)}${x.id ? ` · ID ${esc(x.id)}` : ''} ↗</a>`).join('')}</div>
      <details style="margin-top:12px"><summary style="cursor:pointer;font-size:12px;font-weight:700">All preserved identifiers</summary><pre style="font-size:11px;white-space:pre-wrap;color:var(--text-dim)">${esc(JSON.stringify(product.identifiers || {}, null, 2))}</pre></details>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">${product.identifiers?.cardtraderId ? `<button class="btn btn-ghost" data-act="refreshSlCardTraderQuote" data-arg="${esc(drop)}">↻ CardTrader listings</button>` : ''}<button class="btn btn-ghost" data-act="showSlMarketQuoteModal" data-arg="${esc(drop)}">＋ Add market observation</button><button class="btn btn-primary" data-act="hideModal">Close</button></div>
    </div>`, 'xl');
}

export function showSlMarketQuoteModal(drop) {
  showModal(`<h2>Add market observation</h2>
    <p style="font-size:12px;color:var(--text-muted)">${esc(drop)} · values stay source/currency labeled and are never silently blended.</p>
    <div class="form-row"><div class="form-group"><label>Source</label><input id="slq-source" placeholder="Cardmarket, CardTrader, local store…"></div><div class="form-group"><label>Currency</label><select id="slq-currency"><option>USD</option><option>EUR</option><option>GBP</option><option>CAD</option><option>JPY</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Amount</label><input id="slq-amount" type="number" min="0" step="0.01"></div><div class="form-group"><label>Quote basis</label><select id="slq-type"><option value="market">Market</option><option value="listed">Listed</option><option value="sold">Sold</option><option value="offer">Offer</option></select></div></div>
    <div class="form-row"><div class="form-group"><label>Observed</label><input id="slq-date" type="date" value="${today()}"></div><div class="form-group"><label>URL (optional)</label><input id="slq-url" type="url"></div></div>
    <div class="form-group"><label>Note</label><textarea id="slq-note" rows="2"></textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-act="hideModal">Cancel</button><button class="btn btn-primary" id="slq-save">Save observation</button></div>`);
  document.getElementById('slq-save')?.addEventListener('click', () => {
    const source = document.getElementById('slq-source').value.trim();
    const amount = Number(document.getElementById('slq-amount').value);
    if (!source || !Number.isFinite(amount) || amount < 0) { toast('Enter a source and valid amount.', 'error'); return; }
    collection.slMarketQuotes.push({ id: uid(), dropName: drop, productUuid: slProductForDrop(drop)?.uuid || '', source, amount, currency: document.getElementById('slq-currency').value, quoteType: document.getElementById('slq-type').value, observedAt: document.getElementById('slq-date').value || today(), url: document.getElementById('slq-url').value.trim(), note: document.getElementById('slq-note').value.trim() });
    hideModal(); save(); rerender(); toast('Market observation saved.', 'success');
  });
}

function productsForSuperdrop(superdrop) {
  return getSlProducts().filter(p => infoForDrop(p.legacyDrop).superdrop === superdrop && (p.cards || []).length)
    .sort((a, b) => a.legacyDrop.localeCompare(b.legacyDrop));
}

export function showSlBundleLotModal() {
  const supers = (typeof SL_SUPERDROPS !== 'undefined' ? SL_SUPERDROPS : []).filter(x => productsForSuperdrop(x.superdrop).length);
  showModal(`<div style="max-width:900px"><h2 style="margin-bottom:4px">Add bundle purchase lot</h2>
    <p style="font-size:12px;color:var(--text-muted);margin-top:0">Record one landed purchase and allocate its cost across the exact SKUs you received.</p>
    <div class="form-row"><div class="form-group"><label>Bundle / superdrop</label><select id="sll-super">${supers.map(s => `<option value="${esc(s.superdrop)}">${esc(s.superdrop)}</option>`).join('')}</select></div><div class="form-group"><label>Purchased</label><input id="sll-date" type="date" value="${today()}"></div></div>
    <div class="form-row"><div class="form-group"><label>Subtotal</label><input id="sll-subtotal" type="number" min="0" step="0.01"></div><div class="form-group"><label>Tax</label><input id="sll-tax" type="number" min="0" step="0.01" value="0"></div><div class="form-group"><label>Shipping</label><input id="sll-shipping" type="number" min="0" step="0.01" value="0"></div><div class="form-group"><label>Other fees</label><input id="sll-fees" type="number" min="0" step="0.01" value="0"></div></div>
    <div class="form-row"><div class="form-group"><label>Allocate landed cost by</label><select id="sll-method"><option value="msrp">Relative MSRP</option><option value="equal">Equal per SKU</option></select></div><div class="form-group"><label>Lot name</label><input id="sll-name" placeholder="Optional custom name"></div></div>
    <div id="sll-items" style="max-height:330px;overflow:auto;border:1px solid var(--border);border-radius:8px;margin:8px 0 12px"></div>
    <div class="form-group"><label>Note</label><textarea id="sll-note" rows="2"></textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-act="hideModal">Cancel</button><button class="btn btn-primary" id="sll-save">Save and allocate</button></div></div>`, 'xl');
  const superEl = document.getElementById('sll-super');
  const itemsEl = document.getElementById('sll-items');
  const draw = () => {
    const rows = productsForSuperdrop(superEl.value);
    itemsEl.innerHTML = rows.map((p, i) => `<label style="display:grid;grid-template-columns:auto 1fr 90px 90px;gap:9px;align-items:center;padding:8px 10px;border-top:${i ? '1px solid var(--border)' : '0'};font-size:12px">
      <input type="checkbox" class="sll-pick" data-uuid="${esc(p.uuid)}" checked>
      <span><strong>${esc(p.legacyDrop)}</strong><br><span style="color:var(--text-muted)">${esc(p.finishLabel || p.finish)} · ${p.cards.length} entries</span></span>
      <span style="color:var(--text-muted)">MSRP ${money(slWikiMsrp(p.legacyDrop, p.finish))}</span>
      <input type="number" class="sll-qty" min="1" value="1" title="Quantity">
    </label>`).join('') || '<div style="padding:14px;color:var(--text-muted)">No exact SKUs found.</div>';
  };
  superEl?.addEventListener('change', draw); draw();
  document.getElementById('sll-save')?.addEventListener('click', () => {
    const subtotal = Number(document.getElementById('sll-subtotal').value);
    const tax = Number(document.getElementById('sll-tax').value) || 0;
    const shipping = Number(document.getElementById('sll-shipping').value) || 0;
    const fees = Number(document.getElementById('sll-fees').value) || 0;
    if (!Number.isFinite(subtotal) || subtotal < 0) { toast('Enter the bundle subtotal.', 'error'); return; }
    const selected = [...itemsEl.querySelectorAll('.sll-pick:checked')].map(el => {
      const product = getSlProducts().find(p => p.uuid === el.dataset.uuid);
      const qty = Math.max(1, Number(el.closest('label').querySelector('.sll-qty').value) || 1);
      return { product, qty };
    }).filter(x => x.product);
    if (!selected.length) { toast('Select at least one SKU.', 'error'); return; }
    const total = subtotal + tax + shipping + fees;
    const method = document.getElementById('sll-method').value;
    const weights = selected.map(x => method === 'msrp' ? (slWikiMsrp(x.product.legacyDrop, x.product.finish) || 1) * x.qty : x.qty);
    const weightTotal = weights.reduce((a, b) => a + b, 0) || selected.length;
    let allocated = 0;
    const items = selected.map((x, i) => {
      const cost = i === selected.length - 1 ? total - allocated : Math.round(total * weights[i] / weightTotal * 100) / 100;
      allocated += cost;
      return { productUuid: x.product.uuid, dropName: x.product.legacyDrop, productName: x.product.name, finish: x.product.finish, quantity: x.qty, status: 'sealed', allocatedCost: cost, allocationWeight: weights[i] };
    });
    collection.slPurchaseLots.push({ id: uid(), name: document.getElementById('sll-name').value.trim() || superEl.value, superdrop: superEl.value, acquiredAt: document.getElementById('sll-date').value || today(), subtotal, tax, shipping, fees, total, currency: 'USD', allocationMethod: method, note: document.getElementById('sll-note').value.trim(), items });
    hideModal(); save(); rerender(); toast(`Bundle saved · ${items.length} SKUs allocated across ${fmt(total)} landed cost.`, 'success');
  });
}

export function deleteSlPurchaseLot(id) {
  const lot = (collection.slPurchaseLots || []).find(x => x.id === id);
  if (!lot || !confirm(`Remove purchase lot “${lot.name}”?\n\nThis removes its allocated cost basis but does not delete collection cards.`)) return;
  collection.slPurchaseLots = collection.slPurchaseLots.filter(x => x.id !== id); save(); rerender(); toast('Purchase lot removed.', 'success');
}

export function cycleSlLotItemStatus(arg) {
  const [lotId, indexRaw] = String(arg || '').split('|');
  const item = collection.slPurchaseLots.find(x => x.id === lotId)?.items?.[Number(indexRaw)];
  if (!item) return;
  item.status = item.status === 'sealed' ? 'opened' : item.status === 'opened' ? 'sold' : 'sealed';
  save(); rerender();
}

export function showSlBonusPullModal(drop) {
  const rows = slBonusCardsForDrop(drop);
  showModal(`<h2>Log observed bonus pull</h2><p style="font-size:12px;color:var(--text-muted)">${esc(drop)} · observations remain separate from guaranteed contents.</p>
    <div class="form-group"><label>Documented bonus</label><select id="slb-known"><option value="">Manual / not in catalog</option>${rows.map((r,i)=>`<option value="${i}">${esc(r.cardName)}${r.variant ? ` · ${esc(r.variant)}` : ''}</option>`).join('')}</select></div>
    <div class="form-row"><div class="form-group"><label>Card name</label><input id="slb-name"></div><div class="form-group"><label>Collector number</label><input id="slb-number"></div></div>
    <div class="form-row"><div class="form-group"><label>Variant</label><input id="slb-variant"></div><div class="form-group"><label>Opened</label><input id="slb-date" type="date" value="${today()}"></div><div class="form-group"><label>Quantity</label><input id="slb-qty" type="number" min="1" value="1"></div></div>
    <div class="form-group"><label>Note</label><textarea id="slb-note" rows="2"></textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-act="hideModal">Cancel</button><button class="btn btn-primary" id="slb-save">Log pull</button></div>`);
  document.getElementById('slb-known')?.addEventListener('change', e => {
    const row = rows[Number(e.target.value)]; if (!row) return;
    document.getElementById('slb-name').value = row.cardName || '';
    document.getElementById('slb-number').value = row.collectorNumber || '';
    document.getElementById('slb-variant').value = row.variant || '';
  });
  document.getElementById('slb-save')?.addEventListener('click', () => {
    const cardName = document.getElementById('slb-name').value.trim();
    if (!cardName) { toast('Enter the observed bonus card.', 'error'); return; }
    collection.slBonusPulls.push({ id: uid(), dropName: drop, productUuid: slProductForDrop(drop)?.uuid || '', cardName, collectorNumber: document.getElementById('slb-number').value.trim(), variant: document.getElementById('slb-variant').value.trim(), openedAt: document.getElementById('slb-date').value || today(), quantity: Math.max(1, Number(document.getElementById('slb-qty').value) || 1), note: document.getElementById('slb-note').value.trim() });
    hideModal(); save(); rerender(); toast('Bonus pull logged.', 'success');
  });
}

export function deleteSlBonusPull(id) {
  collection.slBonusPulls = (collection.slBonusPulls || []).filter(x => x.id !== id); save(); rerender();
}

export function showSlWatchModal(drop) {
  const existing = (collection.slWatchList || []).find(x => x.dropName === drop) || {};
  showModal(`<h2>${existing.id ? 'Edit' : 'Watch'} Secret Lair</h2><p style="font-size:12px;color:var(--text-muted)">${esc(drop)}</p>
    <div class="form-row"><div class="form-group"><label>Target sealed price (optional)</label><input id="slw-target" type="number" min="0" step="0.01" value="${existing.targetPrice ?? ''}"></div><div class="form-group"><label>Notify for sale window</label><select id="slw-sale"><option value="true" ${existing.notifySale !== false ? 'selected' : ''}>Yes</option><option value="false" ${existing.notifySale === false ? 'selected' : ''}>No</option></select></div></div>
    <div class="form-group"><label>Note</label><textarea id="slw-note" rows="2">${esc(existing.note || '')}</textarea></div>
    <div style="display:flex;justify-content:flex-end;gap:8px">${existing.id ? `<button class="btn" id="slw-remove" style="margin-right:auto">Remove watch</button>` : ''}<button class="btn" data-act="hideModal">Cancel</button><button class="btn btn-primary" id="slw-save">Save watch</button></div>`);
  document.getElementById('slw-remove')?.addEventListener('click', () => { collection.slWatchList = collection.slWatchList.filter(x => x.id !== existing.id); hideModal(); save(); rerender(); });
  document.getElementById('slw-save')?.addEventListener('click', () => {
    const row = { id: existing.id || uid(), dropName: drop, productUuid: slProductForDrop(drop)?.uuid || '', targetPrice: Number(document.getElementById('slw-target').value) || null, notifySale: document.getElementById('slw-sale').value === 'true', note: document.getElementById('slw-note').value.trim(), createdAt: existing.createdAt || new Date().toISOString() };
    const i = collection.slWatchList.findIndex(x => x.id === row.id); if (i >= 0) collection.slWatchList[i] = row; else collection.slWatchList.push(row);
    hideModal(); save(); rerender(); toast('Watch saved.', 'success');
  });
}

export function slWatchAlerts(now = new Date()) {
  const alerts = [];
  for (const watch of (collection.slWatchList || [])) {
    const comparison = marketComparisonForDrop(watch.dropName);
    const usdMarket = comparison.rows.find(r => r.currency === 'USD' && Number.isFinite(Number(r.value)));
    if (watch.targetPrice && usdMarket && Number(usdMarket.value) <= Number(watch.targetPrice)) {
      alerts.push({ type: 'price', dropName: watch.dropName, message: `${watch.dropName} is ${fmt(Number(usdMarket.value))}, at or below your ${fmt(Number(watch.targetPrice))} target.` });
    }
    if (watch.notifySale !== false) {
      const key = norm(watch.dropName);
      const ann = slAnnouncements().find(a => a.saleDate && (norm(a.title).includes(key) || key.includes(norm(a.title).replace(/secretlair|superdrop/g, ''))));
      if (ann?.saleDate) {
        const days = Math.ceil((new Date(`${ann.saleDate}T12:00:00`).getTime() - now.getTime()) / 86400000);
        if (days >= 0 && days <= 14) alerts.push({ type: 'sale', dropName: watch.dropName, message: `${watch.dropName} goes on sale ${days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`} (${ann.saleDate}).` });
      }
    }
  }
  return alerts;
}

export function evaluateSlWatchAlerts(notifyUser = true) {
  const alerts = slWatchAlerts();
  if (notifyUser && alerts.length) {
    const key = alerts.map(a => `${a.type}:${a.dropName}:${a.message}`).join('|');
    if (collection.settings.slLastWatchAlertKey !== key) {
      collection.settings.slLastWatchAlertKey = key;
      toast(alerts[0].message + (alerts.length > 1 ? ` · ${alerts.length - 1} more in Intelligence` : ''), 'info', 12000);
      save();
    }
  }
  return alerts;
}

export function showSlEconomicsSettings() {
  const fee = collection.settings.slSellingFeePct ?? 13;
  const shipping = collection.settings.slSellingShipping ?? 5;
  showModal(`<h2>Crack-or-keep assumptions</h2><p style="font-size:12px;color:var(--text-muted)">Used only for net decision estimates; raw source prices remain unchanged.</p>
    <div class="form-row"><div class="form-group"><label>Selling fees (%)</label><input id="sle-fee" type="number" min="0" max="100" step="0.1" value="${fee}"></div><div class="form-group"><label>Outbound shipping per sale</label><input id="sle-ship" type="number" min="0" step="0.01" value="${shipping}"></div></div>
    <div style="display:flex;justify-content:flex-end;gap:8px"><button class="btn" data-act="hideModal">Cancel</button><button class="btn btn-primary" id="sle-save">Save assumptions</button></div>`);
  document.getElementById('sle-save')?.addEventListener('click', () => {
    collection.settings.slSellingFeePct = Math.max(0, Math.min(100, Number(document.getElementById('sle-fee').value) || 0));
    collection.settings.slSellingShipping = Math.max(0, Number(document.getElementById('sle-ship').value) || 0);
    hideModal(); save(); rerender(); toast('Economics assumptions saved.', 'success');
  });
}

export function slDataQuality() {
  const products = getSlProducts();
  const identifierCoverage = {};
  for (const p of products) for (const k of Object.keys(p.identifiers || {})) identifierCoverage[k] = (identifierCoverage[k] || 0) + 1;
  return {
    total: products.length,
    exact: products.filter(p => !p.lowConfidence).length,
    lowConfidence: products.filter(p => p.lowConfidence).length,
    empty: products.filter(p => !(p.cards || []).length).length,
    noTcg: products.filter(p => !p.tcgplayerProductId).length,
    noRelease: products.filter(p => !p.releaseDate && !slWikiRowFor(p.legacyDrop)?.date).length,
    noWiki: products.filter(p => !slWikiRowFor(p.legacyDrop)).length,
    identifierCoverage,
  };
}

export function renderSlIntelligenceView() {
  const q = slDataQuality();
  const officialUpcoming = slAnnouncements().filter(a => a.saleDate && a.saleDate >= today()).map(a => ({ drop: a.title, superdrop: 'Official Wizards announcement', date: a.saleDate, msrpNonfoil: null, msrpFoil: null, url: a.url, official: true }));
  const upcoming = [...officialUpcoming, ...upcomingSlDrops()].filter((r, i, all) => all.findIndex(x => norm(x.drop) === norm(r.drop)) === i).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999')).slice(0, 14);
  const watches = collection.slWatchList || [];
  const alerts = slWatchAlerts();
  const lots = collection.slPurchaseLots || [];
  const pulls = collection.slBonusPulls || [];
  const quotes = collection.slMarketQuotes || [];
  const historySeed = slHistorySeedInfo();
  const lotsHtml = lots.length ? lots.map(lot => `<div style="padding:10px 12px;border-top:1px solid var(--border)">
      <div style="display:flex;gap:8px;align-items:baseline"><strong>${esc(lot.name)}</strong><span style="color:var(--text-muted);font-size:11px">${esc(lot.acquiredAt)} · ${lot.items?.length || 0} SKUs · ${esc(lot.allocationMethod)}</span><span style="margin-left:auto;font-weight:700">${money(lot.total)}</span><button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" data-act="deleteSlPurchaseLot" data-arg="${esc(lot.id)}">Remove</button></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${(lot.items || []).map((x,i)=>`<button class="btn btn-ghost" style="font-size:10px;padding:2px 7px" data-act="cycleSlLotItemStatus" data-arg="${esc(lot.id)}|${i}" title="Click to cycle sealed → opened → sold">${esc(x.dropName)} · ${esc(x.status)} · ${money(x.allocatedCost)}</button>`).join('')}</div>
    </div>`).join('') : '<div style="padding:18px;color:var(--text-muted)">No bundle lots yet.</div>';
  const radarRows = upcoming.length ? upcoming.map(r => `<tr style="border-top:1px solid var(--border)"><td style="padding:7px 9px"><strong>${esc(r.drop)}</strong><div style="font-size:10.5px;color:var(--text-muted)">${esc(r.superdrop || 'Upcoming')}</div></td><td style="padding:7px 9px">${esc(r.date || 'TBA')}</td><td style="padding:7px 9px;text-align:right">${r.msrpNonfoil != null ? money(r.msrpNonfoil) : '—'}${r.msrpFoil != null ? ` / ${money(r.msrpFoil)} foil` : ''}</td><td style="padding:7px 9px;text-align:right">${r.official ? `<a href="#" class="btn btn-ghost" style="font-size:10px" data-act="open-url" data-arg="${esc(r.url)}">Official ↗</a>` : `<button class="btn btn-ghost" style="font-size:10px" data-act="showSlWatchModal" data-arg="${esc(r.drop)}">Watch</button>`}</td></tr>`).join('') : '<tr><td colspan="4" style="padding:14px;color:var(--text-muted)">No upcoming wiki or official rows cached.</td></tr>';
  const pullRows = pulls.length ? pulls.slice().reverse().slice(0, 20).map(p => `<div style="display:flex;gap:8px;padding:7px 0;border-top:1px solid var(--border);font-size:12px"><span>🎁</span><span><strong>${esc(p.cardName)}</strong><br><span style="color:var(--text-muted)">${esc(p.dropName)} · ${esc(p.openedAt)}${p.variant ? ` · ${esc(p.variant)}` : ''}</span></span><span style="margin-left:auto">×${p.quantity || 1}</span><button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" data-act="deleteSlBonusPull" data-arg="${esc(p.id)}">×</button></div>`).join('') : '<div style="padding:14px;color:var(--text-muted)">No observed bonus pulls logged.</div>';
  return `<div style="display:grid;gap:12px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><div><h2 style="font-size:16px;margin:0">Secret Lair Intelligence</h2><div style="font-size:11px;color:var(--text-muted)">Exact products, landed cost, observed bonuses, release radar and source health</div></div><button class="btn btn-primary" style="margin-left:auto" data-act="showSlBundleLotModal">＋ Bundle purchase</button><button class="btn btn-ghost" data-act="showSlEconomicsSettings">Net-value assumptions</button></div>
    ${alerts.length ? `<div style="padding:10px 12px;background:var(--green-dim);border:1px solid var(--green);border-radius:8px;font-size:12px"><strong>🔔 ${alerts.length} watch alert${alerts.length === 1 ? '' : 's'}</strong><div style="margin-top:4px">${alerts.map(a=>esc(a.message)).join('<br>')}</div></div>` : ''}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(105px,1fr));gap:8px">${[['SKUs',q.total],['Exact chains',q.exact],['Review',q.lowConfidence],['No TCG ID',q.noTcg],['Watched',watches.length],['Market quotes',quotes.length],['History series',historySeed.series]].map(([a,b])=>`<div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px"><div style="font-size:11px;color:var(--text-muted)">${a}</div><div style="font-size:20px;font-weight:800">${b}</div></div>`).join('')}</div>
    <div style="display:grid;grid-template-columns:minmax(0,1.3fr) minmax(300px,.7fr);gap:12px">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden"><div style="padding:10px 12px;font-weight:700">📅 Release radar</div><div style="max-height:330px;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:var(--surface2)"><th style="padding:7px 9px;text-align:left">Drop</th><th style="padding:7px 9px;text-align:left">Sale / release</th><th style="padding:7px 9px;text-align:right">MSRP</th><th></th></tr></thead><tbody>${radarRows}</tbody></table></div></div>
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px"><div style="font-weight:700;margin-bottom:6px">🔎 Data quality</div><div style="font-size:12px;line-height:1.8;color:var(--text-dim)">Low confidence <strong>${q.lowConfidence}</strong><br>Empty products <strong>${q.empty}</strong><br>No release date <strong>${q.noRelease}</strong><br>No wiki match <strong>${q.noWiki}</strong><br>Wiki ${sourceAge(slWikiInfo()?.fetchedAt)} · Bonus ${sourceAge(slBonusInfo()?.fetchedAt)} · Wizards ${sourceAge(slAnnouncementInfo()?.fetchedAt)} · TCGCSV ${sourceAge(tcgcsvCache.lastRefresh)}</div><details style="font-size:11px;margin-top:8px"><summary style="cursor:pointer">Identifier coverage</summary><div style="color:var(--text-muted);margin-top:5px">${esc(Object.entries(q.identifierCoverage).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}: ${v}`).join(' · '))}</div></details></div>
    </div>
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;overflow:hidden"><div style="display:flex;align-items:center;padding:10px 12px"><strong>🧾 Bundle lots &amp; allocated landed cost</strong><button class="btn btn-ghost" style="font-size:11px;margin-left:auto" data-act="showSlBundleLotModal">Add lot</button></div>${lotsHtml}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px"><strong>🎁 Observed bonus journal</strong>${pullRows}</div><div style="background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px 12px"><strong>★ Watch list</strong>${watches.length ? watches.map(w=>`<div style="display:flex;gap:8px;align-items:center;padding:7px 0;border-top:1px solid var(--border);font-size:12px"><span><strong>${esc(w.dropName)}</strong>${w.note ? `<br><span style="color:var(--text-muted)">${esc(w.note)}</span>` : ''}</span><span style="margin-left:auto">${w.targetPrice ? `target ${money(w.targetPrice)}` : 'sale radar'}</span><button class="btn btn-ghost" style="font-size:10px" data-act="showSlWatchModal" data-arg="${esc(w.dropName)}">Edit</button></div>`).join('') : '<div style="padding:14px 0;color:var(--text-muted);font-size:12px">Nothing watched yet. Use Watch on a drop or radar row.</div>'}</div></div>
    <div style="font-size:10.5px;color:var(--text-muted);text-align:center">Bonus observations never change guaranteed completion. Market sources and currencies remain separate. Alerts are evaluated when Mana Ledger refreshes data.</div>
  </div>`;
}

export function slIntelligenceSummary() {
  return { lots: collection.slPurchaseLots?.length || 0, pulls: collection.slBonusPulls?.length || 0, watches: collection.slWatchList?.length || 0, quotes: collection.slMarketQuotes?.length || 0, bonusCatalog: allSlBonusCards().length, announcements: slAnnouncements().length };
}
