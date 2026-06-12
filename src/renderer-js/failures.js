import { FOIL_LABEL } from './constants.js';
import { fetchScryfallBatch, priceKey, storePriceSnapshot } from './prices.js';
import { render, updateFailedBadge } from './render.js';
import { collection, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, sleep, toast } from './utils.js';


export async function retryFailedLookups() {
  const retryable = (collection.failedLookups || []).filter(f => f.reason === 'batch_error');
  if (!retryable.length) { toast('No batch errors to retry', 'info'); return; }

  ui.failures.retrying = true;
  render();

  // Build unique (scryfallId, foil) pairs from all collection cards that match failed IDs
  const failedIdSet = new Set(retryable.map(f => f.scryfallId).filter(Boolean));
  const pairMap = new Map();
  for (const c of collection.cards) {
    if (!c.scryfallId || !failedIdSet.has(c.scryfallId)) continue;
    pairMap.set(priceKey(c.scryfallId, c.foil), { scryfallId: c.scryfallId, foil: c.foil });
  }
  const pairs      = Array.from(pairMap.values());
  const uniqueIds  = [...new Set(pairs.map(p => p.scryfallId))];
  const chunks     = [];
  for (let i = 0; i < uniqueIds.length; i += 75) chunks.push(uniqueIds.slice(i, i + 75));

  const scryfallCache  = new Map();
  const notFoundIds    = new Set();
  const stillFailedIds = new Set();

  for (const chunk of chunks) {
    try {
      const data = await fetchScryfallBatch(chunk);
      for (const card of (data.data || [])) scryfallCache.set(card.id.toLowerCase(), card);
      for (const nf of (data.not_found || [])) if (nf.id) notFoundIds.add(nf.id.toLowerCase());
    } catch (err) {
      for (const id of chunk) stillFailedIds.add(id);
    }
    await sleep(200);
  }

  // Store prices for resolved cards
  const resolvedIds = new Set();
  for (const { scryfallId, foil } of pairs) {
    const card = scryfallCache.get(scryfallId);
    if (!card) continue;
    const prices = card.prices || {};
    let raw;
    if (foil === 'foil')        raw = prices.usd_foil   ?? prices.usd_etched ?? prices.usd;
    else if (foil === 'etched') raw = prices.usd_etched ?? prices.usd_foil;
    else                        raw = prices.usd;
    const price = parseFloat(raw);
    if (!isNaN(price)) {
      storePriceSnapshot(scryfallId, foil, price);
      resolvedIds.add(scryfallId);
    }
  }

  // Update failedLookups: remove resolved, upgrade not_found, keep still-failing
  collection.failedLookups = (collection.failedLookups || []).map(f => {
    if (f.reason !== 'batch_error') return f;
    if (resolvedIds.has(f.scryfallId))    return null; // resolved — remove
    if (notFoundIds.has(f.scryfallId))    return { ...f, reason: 'not_found', reasonLabel: 'ID not found in Scryfall' };
    if (stillFailedIds.has(f.scryfallId)) return f;    // still rate-limited
    return null;
  }).filter(Boolean);

  ui.failures.retrying = false;
  const msg = `Retry done: ${resolvedIds.size} priced, ${notFoundIds.size} not found, ${stillFailedIds.size} still failing`;
  toast(msg, resolvedIds.size > 0 ? 'success' : 'warning');
  render();
  updateFailedBadge();
  autoSave();
}

export function renderFailedLookupsTab() {
  const failed = collection.failedLookups || [];
  const filt   = ui.failures.filter || 'all';

  const REASON_COLOR = {
    not_found:   { bg: 'rgba(239,68,68,0.12)',  border: 'rgba(239,68,68,0.35)',  text: '#f87171' },
    no_price:    { bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.35)', text: '#fbbf24' },
    missing_id:  { bg: 'rgba(139,92,246,0.12)', border: 'rgba(139,92,246,0.35)', text: '#a78bfa' },
    batch_error: { bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)', text: '#60a5fa' },
  };
  const REASON_LABEL = {
    all: 'All', not_found: 'ID not found', no_price: 'No price',
    missing_id: 'No Scryfall ID', batch_error: 'Rate limit / batch error',
  };

  const counts = { not_found: 0, no_price: 0, missing_id: 0, batch_error: 0 };
  for (const f of failed) if (counts[f.reason] !== undefined) counts[f.reason]++;

  const visible = filt === 'all' ? failed : failed.filter(f => f.reason === filt);
  const batchCount = counts.batch_error;
  const isRetrying = ui.failures.retrying;

  if (!failed.length) return `
    <div class="empty-state">
      <div class="empty-state-icon">✓</div>
      <h3>No failed lookups</h3>
      <p>All cards were successfully priced on the last refresh.</p>
    </div>`;

  // Filter buttons
  const filterBtn = (key) => {
    const n     = key === 'all' ? failed.length : counts[key];
    const rc    = REASON_COLOR[key];
    const label = REASON_LABEL[key];
    const active = filt === key;
    const style = active
      ? `background:${rc ? rc.bg : 'rgba(255,255,255,0.08)'};color:${rc ? rc.text : 'var(--text)'};border-color:${rc ? rc.border : 'var(--border)'};font-weight:700`
      : `background:transparent;color:var(--text-muted);border-color:var(--border)`;
    return `<button onclick="ui.failures.filter='${key}';render()"
      style="padding:5px 12px;border-radius:99px;font-size:12px;border:1px solid;cursor:pointer;${style}">
      ${esc(label)} <strong>${n}</strong>
    </button>`;
  };

  const rows = visible.map(f => {
    const rc = REASON_COLOR[f.reason] || REASON_COLOR.not_found;
    const badge = `<span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:700;background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};white-space:nowrap">${esc(f.reasonLabel)}</span>`;
    const scryLink = f.scryfallId
      ? `<a href="https://scryfall.com/card/${esc((f.setCode || '').toLowerCase())}/${esc(f.collectorNumber || '')}/" target="_blank" style="font-size:11px;color:var(--accent)" title="${esc(f.scryfallId)}">↗ View</a>`
      : '<span style="color:var(--text-muted);font-size:11px">—</span>';
    const foilBadge = f.foil && f.foil !== 'normal'
      ? `<span class="badge badge-${f.foil}" style="font-size:10px">${FOIL_LABEL[f.foil]}</span>`
      : '<span style="color:var(--text-dim);font-size:11px">—</span>';
    const affected = (f.affectedEntries || 0) > 1
      ? `<span style="color:var(--text-muted);font-size:11px;margin-left:4px">(×${f.affectedEntries})</span>` : '';
    return `<tr>
      <td style="font-weight:500;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(f.name)}">${esc(f.name)}</td>
      <td style="color:var(--text-dim);white-space:nowrap;font-size:12px">${esc(f.setCode || '—')} <span style="font-size:11px">#${esc(f.collectorNumber || '?')}</span></td>
      <td style="font-size:12px;color:var(--text-dim)">${esc(f.setName || '—')}</td>
      <td>${foilBadge}</td>
      <td style="color:var(--text-dim);font-size:12px">${esc(f.binderName || '—')}</td>
      <td>${badge}${affected}</td>
      <td>${scryLink}</td>
    </tr>`;
  }).join('');

  return `
    <div class="panel failed-lookups-panel" style="border-color:rgba(239,68,68,0.25)">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;flex-wrap:wrap">
        <div class="panel-title" style="margin:0">
          <div class="panel-icon" style="background:rgba(239,68,68,0.15)">⚠</div>
          <h2 style="background:linear-gradient(135deg,#f87171,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin:0">Failed Lookups</h2>
        </div>
        ${batchCount > 0 ? `
        <button class="btn btn-primary" style="font-size:12px;margin-left:auto" onclick="retryFailedLookups()" ${isRetrying ? 'disabled' : ''}>
          ${isRetrying ? '⏳ Retrying…' : `↻ Retry ${batchCount} batch error${batchCount !== 1 ? 's' : ''}`}
        </button>` : ''}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
        ${filterBtn('all')}
        ${counts.batch_error ? filterBtn('batch_error') : ''}
        ${counts.not_found   ? filterBtn('not_found')   : ''}
        ${counts.no_price    ? filterBtn('no_price')     : ''}
        ${counts.missing_id  ? filterBtn('missing_id')   : ''}
      </div>
      <p style="font-size:12px;color:var(--text-muted);margin-bottom:14px;line-height:1.6">
        Showing ${visible.length} of ${failed.length} entries.
        <strong style="color:var(--text-dim)">Rate limit / batch error</strong>: hit "Retry" above after waiting.
        <strong style="color:var(--text-dim)">ID not found</strong>: stale UUID — click ↗ to look up the correct card.
        <strong style="color:var(--text-dim)">No price</strong>: Scryfall has no USD data for that foil type.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Name</th><th>Set / #</th><th>Set Name</th><th>Foil</th><th>Binder</th><th>Issue</th><th>Link</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:30px">No entries for this filter</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
}

