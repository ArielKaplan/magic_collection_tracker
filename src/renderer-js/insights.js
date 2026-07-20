// insights.js — decision workspace built from the user's local collection.

import { addDeckMissingToWantList, deckFormat } from './decks.js';
import { registerActions } from './dispatch.js';
import { collectionExactInventory, collectionNameInventory, latestPrice, filterReportRows, preconBuildCandidate, savedDeckBuildCandidate, scanOpportunities } from './insightsModel.js';
import { hideModal, showModal } from './modals.js';
import { addPreconMissingToWantList, ensurePreconCards, preconState } from './preconData.js';
import { render } from './render.js';
import { getSlProducts } from './slData.js';
import { collection, tcgcsvCache, ui } from './state.js';
import { autoSave } from './storage.js';
import { esc, fmt, toast, today, uid } from './utils.js';

const BUILD_PAGE_SIZE = 50;

const OPPORTUNITY_TYPES = {
  'want-target':  { label: 'Target hit', icon: '🎯', tone: 'green' },
  duplicate:      { label: 'Surplus copy', icon: '♻', tone: 'orange' },
  'market-move':  { label: 'Market move', icon: '↗', tone: 'blue' },
  'sealed-value': { label: 'Sealed vs singles', icon: '◇', tone: 'purple' },
};

const REPORT_COLUMNS = {
  name:       { label: 'Name', format: v => esc(v || '—') },
  group:      { label: 'Group / type', format: v => esc(v || '—') },
  status:     { label: 'Status', format: v => esc(v || '—') },
  finish:     { label: 'Finish', format: v => esc(v || '—') },
  quantity:   { label: 'Quantity', format: v => v == null ? '—' : Number(v).toLocaleString() },
  cost:       { label: 'Cost / target', format: v => v == null ? '—' : fmt(v) },
  value:      { label: 'Value / estimate', format: v => v == null ? '—' : fmt(v) },
  gain:       { label: 'Gain / headroom', format: v => v == null ? '—' : `${v >= 0 ? '+' : ''}${fmt(v)}` },
  completion: { label: 'Completion', format: v => v == null ? '—' : `${Number(v).toFixed(0)}%` },
  missing:    { label: 'Missing', format: v => v == null ? '—' : Number(v).toLocaleString() },
  details:    { label: 'Details', format: v => esc(v || '—') },
  rule:       { label: 'Rule', format: v => esc(v || '—') },
};

const REPORT_DATASETS = {
  cards: {
    label: 'Card Collection',
    columns: ['name', 'group', 'status', 'finish', 'quantity', 'cost', 'value', 'gain'],
  },
  sealed: {
    label: 'Sealed Collection',
    columns: ['name', 'group', 'status', 'quantity', 'cost', 'value', 'gain'],
  },
  decks: {
    label: 'Saved Deck Readiness',
    columns: ['name', 'group', 'completion', 'missing', 'value'],
  },
  precons: {
    label: 'Precon Readiness',
    columns: ['name', 'group', 'completion', 'missing', 'value'],
  },
  wantlist: {
    label: 'Want List',
    columns: ['name', 'group', 'status', 'finish', 'cost', 'value', 'gain'],
  },
  opportunities: {
    label: 'Current Opportunities',
    columns: ['name', 'group', 'status', 'value', 'gain', 'details', 'rule'],
  },
};

function activateTab(tab) {
  ui.activeTab = tab;
  if (typeof document !== 'undefined') {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  }
}

export function allBuildCandidates(preconMatch = ui.insights?.preconMatch || 'playable') {
  const nameInventory = collectionNameInventory(collection.cards);
  const exactInventory = preconMatch === 'exact' ? collectionExactInventory(collection.cards) : null;
  const saved = (collection.decks || []).map(deck => ({
    ...savedDeckBuildCandidate(deck, collection.cards, collection.priceHistory, { nameInventory }),
    group: deckFormat(deck).label,
  }));
  if (!preconState.cards) return saved;
  const precons = preconState.decks.map(deck => preconBuildCandidate(
    deck, preconState.cards.get(deck.file) || [], collection.cards, collection.priceHistory,
    { match: preconMatch, nameInventory, exactInventory },
  ));
  return [...saved, ...precons];
}

export function currentOpportunities() {
  return scanOpportunities({
    cards: collection.cards,
    decks: collection.decks,
    wantList: collection.wantList,
    priceHistory: collection.priceHistory,
    marketPriceHistory: collection.marketPriceHistory,
    slProducts: getSlProducts(),
    sealedCatalog: tcgcsvCache.sealedProducts,
  });
}

function openBuild(kind, id) {
  if (kind === 'saved') {
    ui.decks.deckId = id;
    activateTab('decks');
  } else {
    ui.precons.line = '';
    ui.precons.deck = id;
    activateTab('precons');
  }
  render();
}

function openOpportunity(id) {
  const item = currentOpportunities().find(o => o.id === id);
  if (!item) return;
  if (item.type === 'want-target') {
    activateTab('wantlist');
  } else if (item.type === 'sealed-value') {
    const drop = item.sourceId;
    ui.slViewer.view = 'drops';
    ui.slViewer.drop = drop;
    ui.slViewer.superdrop = (globalThis.SL_DROP_TO_SUPERDROP?.[drop]?.superdrop) || '';
    ui.slViewer.page = 0;
    activateTab('slviewer');
  } else {
    ui.cards.search = item.name;
    ui.cards.page = 1;
    activateTab('cards');
  }
  render();
}

let actionsRegistered = false;
export function initInsightsActions() {
  if (actionsRegistered) return;
  actionsRegistered = true;
  registerActions({
    'insights-view': (el) => { ui.insights.view = el.dataset.view; render(); },
    'insights-open-build': (el) => openBuild(el.dataset.kind, el.dataset.id),
    'insights-add-missing': (el) => {
      if (el.dataset.kind === 'saved') addDeckMissingToWantList(el.dataset.id);
      else addPreconMissingToWantList(el.dataset.id);
    },
    'insights-open-opportunity': (el) => openOpportunity(el.dataset.id),
    'insights-new-report': () => showReportEditor(),
    'insights-edit-report': (el) => showReportEditor(el.dataset.id),
    'insights-select-report': (el) => { ui.insights.reportId = el.dataset.id; render(); },
    'insights-delete-report': (el) => deleteReport(el.dataset.id),
    'insights-template-report': (el) => addReportTemplate(el.dataset.template),
    'insights-export-report': (el) => exportReport(el.dataset.id),
  });
}

function workspaceNav() {
  const tabs = [
    ['build', '🧰', 'What can I build?'],
    ['opportunities', '✦', 'Opportunity scanner'],
    ['reports', '▤', 'User-defined reports'],
  ];
  return `
    <div class="insights-head">
      <div>
        <h2>Insights</h2>
        <p>Your collection data, turned into decisions. Every result stays local and links back to its source.</p>
      </div>
      <div class="insights-freshness" title="Insights update whenever your collection or prices change">
        Live from ${collection.lastPriceRefresh ? `prices refreshed ${esc(collection.lastPriceRefresh)}` : 'your currently stored prices'}
      </div>
    </div>
    <div class="insights-tabs" role="tablist">
      ${tabs.map(([id, icon, label]) => `<button class="insights-tab ${ui.insights.view === id ? 'active' : ''}" data-act="insights-view" data-view="${id}"><span>${icon}</span>${label}</button>`).join('')}
    </div>`;
}

function buildSort(candidates, sort) {
  const rows = [...candidates];
  const name = (a, b) => a.name.localeCompare(b.name);
  const sorts = {
    completion_desc: (a, b) => b.completion - a.completion || a.missing - b.missing || name(a, b),
    missing_asc: (a, b) => a.missing - b.missing || b.completion - a.completion || name(a, b),
    cost_asc: (a, b) => (a.pricedMissing ? a.missingValue : Infinity) - (b.pricedMissing ? b.missingValue : Infinity) || name(a, b),
    newest_desc: (a, b) => String(b.date || '').localeCompare(String(a.date || '')) || name(a, b),
    name_asc: name,
  };
  return rows.sort(sorts[sort] || sorts.completion_desc);
}

function buildReadinessView() {
  if (!preconState.cards && !preconState.cardsLoading) ensurePreconCards();
  const iv = ui.insights;
  const q = String(iv.search || '').toLowerCase();
  const maxMissing = iv.buildMaxMissing === 'all' ? null : Number(iv.buildMaxMissing);
  let rows = allBuildCandidates().filter(row => {
    if (iv.buildSource !== 'all' && row.source !== iv.buildSource) return false;
    if (q && !`${row.name} ${row.group} ${row.detail}`.toLowerCase().includes(q)) return false;
    if (maxMissing != null && row.missing > maxMissing) return false;
    return true;
  });
  rows = buildSort(rows, iv.buildSort);
  const complete = rows.filter(r => r.total > 0 && r.missing === 0).length;
  const close = rows.filter(r => r.missing > 0 && r.missing <= 10).length;
  const totalPages = Math.max(1, Math.ceil(rows.length / BUILD_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(iv.buildPage) || 1), totalPages);
  if (page !== iv.buildPage) iv.buildPage = page;
  const shown = rows.slice((page - 1) * BUILD_PAGE_SIZE, page * BUILD_PAGE_SIZE);

  return `
    <section class="insights-panel">
      <div class="insights-kpis">
        <div><strong>${rows.length.toLocaleString()}</strong><span>matching builds</span></div>
        <div><strong class="ins-positive">${complete.toLocaleString()}</strong><span>complete now</span></div>
        <div><strong>${close.toLocaleString()}</strong><span>10 or fewer missing</span></div>
        <div><strong>${(collection.cards || []).filter(c => c.status !== 'sold').reduce((s, c) => s + (c.quantity || 1), 0).toLocaleString()}</strong><span>owned copies analyzed</span></div>
      </div>
      <div class="insights-callout">
        <strong>How readiness works:</strong> saved decks accept any printing by card name. Precons can be checked as a playable list (any printing) or as an exact product reconstruction (printing + finish). Required quantities count; tokens do not.
      </div>
      <div class="filter-bar insights-filter">
        <input id="insightsBuildSearch" type="text" placeholder="Search decks, commanders, or product lines…" value="${esc(iv.search)}" data-act="ui-set" data-path="insights.search" data-also="insights.buildPage=1" data-refocus="insightsBuildSearch">
        <select data-act="ui-set" data-path="insights.buildSource" data-also="insights.buildPage=1">
          <option value="all" ${iv.buildSource === 'all' ? 'selected' : ''}>Saved decks + precons</option>
          <option value="saved" ${iv.buildSource === 'saved' ? 'selected' : ''}>Saved decks</option>
          <option value="precon" ${iv.buildSource === 'precon' ? 'selected' : ''}>Precons</option>
        </select>
        <select data-act="ui-set" data-path="insights.buildMaxMissing" data-also="insights.buildPage=1">
          <option value="all" ${iv.buildMaxMissing === 'all' ? 'selected' : ''}>Any missing count</option>
          ${[0, 5, 10, 20].map(n => `<option value="${n}" ${String(iv.buildMaxMissing) === String(n) ? 'selected' : ''}>${n === 0 ? 'Complete now' : `≤ ${n} missing`}</option>`).join('')}
        </select>
        <select data-act="ui-set" data-path="insights.preconMatch" data-also="insights.buildPage=1" title="How owned cards satisfy precon decklist slots">
          <option value="playable" ${iv.preconMatch === 'playable' ? 'selected' : ''}>Precons: playable (any printing)</option>
          <option value="exact" ${iv.preconMatch === 'exact' ? 'selected' : ''}>Precons: exact product</option>
        </select>
        <select data-act="ui-set" data-path="insights.buildSort" data-also="insights.buildPage=1">
          <option value="completion_desc" ${iv.buildSort === 'completion_desc' ? 'selected' : ''}>Best completion</option>
          <option value="missing_asc" ${iv.buildSort === 'missing_asc' ? 'selected' : ''}>Fewest missing</option>
          <option value="cost_asc" ${iv.buildSort === 'cost_asc' ? 'selected' : ''}>Lowest known missing cost</option>
          <option value="newest_desc" ${iv.buildSort === 'newest_desc' ? 'selected' : ''}>Newest precons</option>
          <option value="name_asc" ${iv.buildSort === 'name_asc' ? 'selected' : ''}>Name</option>
        </select>
      </div>
      ${preconState.cardsLoading ? '<div class="insights-loading">Loading the precon membership map… saved decks are available now.</div>' : ''}
      ${shown.length ? `<div class="insights-table-wrap"><table class="insights-table">
        <thead><tr><th>Build</th><th>Source</th><th>Readiness</th><th>Owned</th><th>Missing</th><th>Known missing cost</th><th></th></tr></thead>
        <tbody>${shown.map(row => {
          const pct = Math.round(row.completion);
          const coverage = row.missing ? `${row.pricedMissing}/${row.missing} priced` : 'complete';
          return `<tr data-act="insights-open-build" data-kind="${row.source}" data-id="${esc(row.id)}">
            <td><strong>${esc(row.name)}</strong><small>${esc(row.detail || row.group)}</small></td>
            <td><span class="ins-source ins-source-${row.source}">${row.source === 'saved' ? 'Saved deck' : `Precon · ${row.match === 'exact' ? 'exact' : 'playable'}`}</span><small>${esc(row.group)}</small></td>
            <td><div class="ins-progress"><span style="width:${Math.max(0, Math.min(100, pct))}%"></span></div><small>${pct}%</small></td>
            <td>${row.owned.toLocaleString()} / ${row.total.toLocaleString()}</td>
            <td class="${row.missing === 0 ? 'ins-positive' : ''}">${row.missing === 0 ? '✓ Ready' : row.missing.toLocaleString()}</td>
            <td>${row.missing === 0 ? '—' : row.pricedMissing ? `≈ ${fmt(row.missingValue)}<small>${coverage}</small>` : '<span class="ins-muted">Not yet priced</span>'}</td>
            <td>${row.missing ? `<button class="btn btn-sm" data-act="insights-add-missing" data-kind="${row.source}" data-id="${esc(row.id)}" title="Add the missing cards to your Want List">☆ Want missing</button>` : '<span class="ins-ready-mark">Build now →</span>'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>` : '<div class="insights-empty"><strong>No builds match these filters.</strong><span>Try widening the missing-card limit or clearing the search.</span></div>'}
      ${rows.length > BUILD_PAGE_SIZE ? `<div class="ins-pagination"><button class="btn btn-sm" data-act="ui-set" data-path="insights.buildPage" data-val="${Math.max(1, page - 1)}" ${page === 1 ? 'disabled' : ''}>← Previous</button><span>Page ${page} of ${totalPages} · ${rows.length.toLocaleString()} builds</span><button class="btn btn-sm" data-act="ui-set" data-path="insights.buildPage" data-val="${Math.min(totalPages, page + 1)}" ${page === totalPages ? 'disabled' : ''}>Next →</button></div>` : ''}
    </section>`;
}

function opportunityView() {
  const all = currentOpportunities();
  const type = ui.insights.opportunityType;
  const shown = type === 'all' ? all : all.filter(o => o.type === type);
  const counts = Object.fromEntries(Object.keys(OPPORTUNITY_TYPES).map(k => [k, all.filter(o => o.type === k).length]));
  return `
    <section class="insights-panel">
      <div class="insights-kpis insights-opportunity-kpis">
        <div><strong>${all.length}</strong><span>current signals</span></div>
        <div><strong class="ins-positive">${counts['want-target'] || 0}</strong><span>target hits</span></div>
        <div><strong>${counts.duplicate || 0}</strong><span>surplus holdings</span></div>
        <div><strong>${counts['sealed-value'] || 0}</strong><span>complete SL spreads</span></div>
      </div>
      <div class="insights-callout">
        <strong>This is a scanner, not financial advice.</strong> It only surfaces deterministic conditions in your stored data. Secret Lair spreads require an exact TCGplayer product match and prices for every guaranteed card copy; bonus cards are never counted.
      </div>
      <div class="ins-opportunity-filters">
        <button class="${type === 'all' ? 'active' : ''}" data-act="ui-set" data-path="insights.opportunityType" data-val="all">All <b>${all.length}</b></button>
        ${Object.entries(OPPORTUNITY_TYPES).map(([id, meta]) => `<button class="${type === id ? 'active' : ''}" data-act="ui-set" data-path="insights.opportunityType" data-val="${id}">${meta.icon} ${meta.label} <b>${counts[id] || 0}</b></button>`).join('')}
      </div>
      ${shown.length ? `<div class="ins-opportunity-grid">${shown.map(item => {
        const meta = OPPORTUNITY_TYPES[item.type];
        return `<article class="ins-opportunity-card ins-tone-${meta.tone}">
          <div class="ins-opportunity-icon">${meta.icon}</div>
          <div class="ins-opportunity-body">
            <div class="ins-opportunity-meta"><span>${meta.label}</span><b>${esc(item.status)}</b></div>
            <h3>${esc(item.name)}</h3>
            <p>${esc(item.details)}</p>
            <details><summary>Why this appeared</summary><div>${esc(item.rule)}</div></details>
          </div>
          <button class="btn btn-sm" data-act="insights-open-opportunity" data-id="${esc(item.id)}">${esc(item.action)} →</button>
        </article>`;
      }).join('')}</div>` : `<div class="insights-empty"><strong>No signals match this filter right now.</strong><span>Targets, price history, saved decks, and a synced sealed catalog create more scanner coverage.</span></div>`}
    </section>`;
}

function ownedBySid(sid) {
  const wanted = String(sid || '').toLowerCase();
  return !!wanted && (collection.cards || []).some(c => c.status !== 'sold' && String(c.scryfallId || '').toLowerCase() === wanted);
}

export function reportDatasetRows(dataset) {
  if (dataset === 'cards') return (collection.cards || []).map(card => {
    const qty = Number(card.quantity || 1);
    const price = latestPrice(collection.priceHistory, card.scryfallId, card.foil)
      ?? latestPrice(collection.marketPriceHistory, card.scryfallId, card.foil);
    const cost = Number(card.purchasePrice || 0) * qty;
    const value = price == null ? null : price * qty;
    return { name: card.name, group: card.binderName || card.setName || card.setCode, status: card.status || 'owned', finish: card.foil || 'normal', quantity: qty, cost, value, gain: value == null ? null : value - cost };
  });
  if (dataset === 'sealed') return (collection.sealed || []).map(item => {
    const qty = Number(item.quantity || 1);
    const hist = item.priceHistory || [];
    const unit = hist.length ? Number(hist[hist.length - 1].price) : (item.currentValue ?? null);
    const cost = Number(item.purchasePrice || 0) * qty;
    const value = unit == null ? null : unit * qty;
    return { name: item.name, group: item.productType || item.setName, status: item.status || 'sealed', quantity: qty, cost, value, gain: value == null ? null : value - cost };
  });
  if (dataset === 'decks' || dataset === 'precons') return allBuildCandidates('playable')
    .filter(row => row.source === (dataset === 'decks' ? 'saved' : 'precon'))
    .map(row => ({ name: row.name, group: row.group, status: row.missing === 0 ? 'complete' : 'incomplete', completion: row.completion, missing: row.missing, value: row.pricedMissing ? row.missingValue : null, details: row.detail }));
  if (dataset === 'wantlist') return (collection.wantList || []).map(item => {
    const current = latestPrice(collection.priceHistory, item.scryfallId, item.foil)
      ?? latestPrice(collection.marketPriceHistory, item.scryfallId, item.foil);
    const target = item.maxPrice == null ? null : Number(item.maxPrice);
    const isOwned = ownedBySid(item.scryfallId);
    const atTarget = target != null && current != null && current <= target;
    return { name: item.name, group: item.dropName || item.setName || item.setCode, status: isOwned ? 'owned' : atTarget ? 'at target' : 'watching', finish: item.foil || 'normal', cost: target, value: current, gain: target != null && current != null ? target - current : null, details: item.note || '' };
  });
  if (dataset === 'opportunities') return currentOpportunities().map(item => ({
    name: item.name, group: OPPORTUNITY_TYPES[item.type]?.label || item.type, status: item.status,
    value: item.value ?? null, gain: item.gain ?? null, details: item.details, rule: item.rule,
  }));
  return [];
}

export function runReport(report) {
  return filterReportRows(reportDatasetRows(report?.dataset), report);
}

function reportSummary(report, count) {
  const dataset = REPORT_DATASETS[report.dataset]?.label || report.dataset;
  const parts = [dataset, `${count.toLocaleString()} rows`];
  if (report.query) parts.push(`search “${report.query}”`);
  if (report.status && report.status !== 'all') parts.push(`status ${report.status}`);
  if (report.minValue !== '' && report.minValue != null) parts.push(`value ≥ ${fmt(report.minValue)}`);
  if (report.minGain !== '' && report.minGain != null) parts.push(`gain ≥ ${fmt(report.minGain)}`);
  if (report.minCompletion !== '' && report.minCompletion != null) parts.push(`completion ≥ ${report.minCompletion}%`);
  if (report.maxMissing !== '' && report.maxMissing != null) parts.push(`missing ≤ ${report.maxMissing}`);
  return parts;
}

function reportView() {
  const reports = collection.savedReports || [];
  if (reports.length && !reports.some(r => r.id === ui.insights.reportId)) ui.insights.reportId = reports[0].id;
  const report = reports.find(r => r.id === ui.insights.reportId) || null;
  const rows = report ? runReport(report) : [];
  const columns = report ? (report.columns || REPORT_DATASETS[report.dataset]?.columns || ['name']) : [];

  return `
    <section class="insights-panel report-workspace">
      <aside class="report-sidebar">
        <div class="report-sidebar-head"><strong>Saved reports</strong><button class="btn btn-sm btn-primary" data-act="insights-new-report">+ New</button></div>
        ${reports.length ? `<div class="report-list">${reports.map(r => `<button class="report-list-item ${r.id === report?.id ? 'active' : ''}" data-act="insights-select-report" data-id="${esc(r.id)}"><strong>${esc(r.name)}</strong><small>${esc(REPORT_DATASETS[r.dataset]?.label || r.dataset)}</small></button>`).join('')}</div>` : '<p class="ins-muted" style="font-size:12px">No saved reports yet. Start with a template or build your own.</p>'}
        <div class="report-templates">
          <span>Quick templates</span>
          <button data-act="insights-template-report" data-template="buildable">90%+ buildable decks</button>
          <button data-act="insights-template-report" data-template="high-value">High-value cards</button>
          <button data-act="insights-template-report" data-template="target-hits">Want-list target hits</button>
          <button data-act="insights-template-report" data-template="sl-spreads">Secret Lair value spreads</button>
        </div>
      </aside>
      <div class="report-main">
        ${report ? `
          <div class="report-title-row">
            <div><h3>${esc(report.name)}</h3><div class="report-chips">${reportSummary(report, rows.length).map(x => `<span>${esc(x)}</span>`).join('')}</div></div>
            <div class="report-actions"><button class="btn btn-sm" data-act="insights-edit-report" data-id="${esc(report.id)}">✎ Edit</button><button class="btn btn-sm" data-act="insights-export-report" data-id="${esc(report.id)}">⇩ CSV</button><button class="btn btn-sm btn-danger" data-act="insights-delete-report" data-id="${esc(report.id)}">Delete</button></div>
          </div>
          ${rows.length ? `<div class="insights-table-wrap"><table class="insights-table report-table"><thead><tr>${columns.map(key => `<th>${esc(REPORT_COLUMNS[key]?.label || key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(key => `<td>${REPORT_COLUMNS[key]?.format(row[key]) ?? esc(row[key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '<div class="insights-empty"><strong>This report currently returns zero rows.</strong><span>Edit its filters or refresh the underlying collection data.</span></div>'}
        ` : `<div class="insights-empty report-empty"><strong>Build a reusable view of your data.</strong><span>Choose a template on the left or create a custom report with your own dataset, filters, sort, limit, and columns.</span><button class="btn btn-primary" data-act="insights-new-report">+ Create a report</button></div>`}
      </div>
    </section>`;
}

function selectedReportColumns(dataset, chosen = null) {
  const allowed = REPORT_DATASETS[dataset]?.columns || ['name'];
  const selected = new Set(chosen?.length ? chosen : allowed);
  return allowed.map(key => `<label class="report-column-choice"><input type="checkbox" value="${key}" ${selected.has(key) ? 'checked' : ''}><span>${esc(REPORT_COLUMNS[key].label)}</span></label>`).join('');
}

export function showReportEditor(id = '') {
  const existing = (collection.savedReports || []).find(r => r.id === id);
  const draft = existing ? { ...existing, columns: [...(existing.columns || [])] } : {
    id: '', name: '', dataset: 'cards', query: '', status: '', minValue: '', minGain: '',
    minCompletion: '', maxMissing: '', sort: 'name_asc', limit: '', columns: REPORT_DATASETS.cards.columns,
  };
  showModal(`
    <h2>${existing ? 'Edit report' : 'New custom report'}</h2>
    <p style="color:var(--text-dim);font-size:13px;margin:-4px 0 16px">Reports run against live local data. A saved report stores the recipe, not a frozen copy of the rows.</p>
    <div class="report-editor-grid">
      <div class="form-group report-span-2"><label>Report name</label><input id="reportName" value="${esc(draft.name)}" placeholder="e.g. Commander decks I can finish under $50"></div>
      <div class="form-group"><label>Dataset</label><select id="reportDataset">${Object.entries(REPORT_DATASETS).map(([key, ds]) => `<option value="${key}" ${draft.dataset === key ? 'selected' : ''}>${esc(ds.label)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Sort</label><select id="reportSort">
        ${[['name_asc','Name A–Z'],['value_desc','Value high–low'],['gain_desc','Gain high–low'],['completion_desc','Completion high–low'],['missing_asc','Missing low–high']].map(([v,l]) => `<option value="${v}" ${draft.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select></div>
      <div class="form-group report-span-2"><label>Text contains</label><input id="reportQuery" value="${esc(draft.query)}" placeholder="Searches every displayed field"></div>
      <div class="form-group"><label>Exact status</label><input id="reportStatus" value="${esc(draft.status)}" placeholder="owned, complete, at target…"></div>
      <div class="form-group"><label>Maximum rows</label><input id="reportLimit" type="number" min="0" value="${esc(draft.limit)}" placeholder="All rows"></div>
      <div class="form-group"><label>Minimum value ($)</label><input id="reportMinValue" type="number" step="0.01" value="${esc(draft.minValue)}"></div>
      <div class="form-group"><label>Minimum gain ($)</label><input id="reportMinGain" type="number" step="0.01" value="${esc(draft.minGain)}"></div>
      <div class="form-group"><label>Minimum completion (%)</label><input id="reportMinCompletion" type="number" min="0" max="100" value="${esc(draft.minCompletion)}"></div>
      <div class="form-group"><label>Maximum missing</label><input id="reportMaxMissing" type="number" min="0" value="${esc(draft.maxMissing)}"></div>
      <div class="form-group report-span-2"><label>Columns</label><div id="reportColumns" class="report-column-grid">${selectedReportColumns(draft.dataset, draft.columns)}</div></div>
    </div>
    <div class="insights-callout" style="margin-top:12px">Filters that do not apply to a dataset return no rows. For example, completion and missing are available on deck and precon reports.</div>
    <div class="modal-actions"><button class="btn" id="reportCancel">Cancel</button><button class="btn btn-primary" id="reportSave">${existing ? 'Save changes' : 'Create report'}</button></div>
  `, 'wide');

  const datasetEl = document.getElementById('reportDataset');
  datasetEl?.addEventListener('change', () => {
    document.getElementById('reportColumns').innerHTML = selectedReportColumns(datasetEl.value);
  });
  document.getElementById('reportCancel')?.addEventListener('click', hideModal);
  document.getElementById('reportSave')?.addEventListener('click', () => {
    const name = document.getElementById('reportName')?.value.trim();
    if (!name) { toast('Give the report a name', 'error'); return; }
    const columns = [...document.querySelectorAll('#reportColumns input:checked')].map(x => x.value);
    if (!columns.length) { toast('Choose at least one column', 'error'); return; }
    const value = field => document.getElementById(field)?.value ?? '';
    const report = {
      id: existing?.id || uid(), name, dataset: value('reportDataset'), query: value('reportQuery').trim(),
      status: value('reportStatus').trim(), minValue: value('reportMinValue'), minGain: value('reportMinGain'),
      minCompletion: value('reportMinCompletion'), maxMissing: value('reportMaxMissing'),
      sort: value('reportSort'), limit: value('reportLimit'), columns,
      createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    collection.savedReports = collection.savedReports || [];
    const at = collection.savedReports.findIndex(r => r.id === report.id);
    if (at >= 0) collection.savedReports[at] = report; else collection.savedReports.push(report);
    ui.insights.reportId = report.id;
    hideModal(); autoSave(); render();
    toast(`${existing ? 'Updated' : 'Created'} “${report.name}”`, 'success');
  });
  setTimeout(() => document.getElementById('reportName')?.focus(), 0);
}

function deleteReport(id) {
  const report = (collection.savedReports || []).find(r => r.id === id);
  if (!report || !confirm(`Delete report “${report.name}”? The underlying collection data is not affected.`)) return;
  collection.savedReports = collection.savedReports.filter(r => r.id !== id);
  ui.insights.reportId = collection.savedReports[0]?.id || '';
  autoSave(); render(); toast(`Deleted “${report.name}”`, 'info');
}

function addReportTemplate(template) {
  const templates = {
    buildable: { name: 'Decks I can finish', dataset: 'decks', minCompletion: '90', maxMissing: '10', sort: 'completion_desc' },
    'high-value': { name: 'High-value cards', dataset: 'cards', minValue: '25', sort: 'value_desc' },
    'target-hits': { name: 'Want-list target hits', dataset: 'wantlist', status: 'at target', sort: 'gain_desc' },
    'sl-spreads': { name: 'Secret Lair sealed value spreads', dataset: 'opportunities', status: '', query: 'sealed vs singles', sort: 'gain_desc' },
  };
  const base = templates[template];
  if (!base) return;
  const report = {
    id: uid(), query: '', status: '', minValue: '', minGain: '', minCompletion: '', maxMissing: '', limit: '',
    ...base, columns: REPORT_DATASETS[base.dataset].columns, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  collection.savedReports = collection.savedReports || [];
  collection.savedReports.push(report);
  ui.insights.reportId = report.id;
  autoSave(); render(); toast(`Created “${report.name}”`, 'success');
}

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportReport(id) {
  const report = (collection.savedReports || []).find(r => r.id === id);
  if (!report) return;
  const rows = runReport(report);
  const columns = report.columns || REPORT_DATASETS[report.dataset]?.columns || ['name'];
  const lines = [columns.map(k => csvCell(REPORT_COLUMNS[k]?.label || k)).join(',')];
  for (const row of rows) lines.push(columns.map(k => csvCell(row[k])).join(','));
  const safeName = report.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report';
  const path = await window.api.dialog.saveFile({
    title: `Export ${report.name}`,
    defaultPath: `${safeName}-${today()}.csv`,
    filterName: 'CSV files', extensions: ['csv'], content: '\uFEFF' + lines.join('\r\n'),
  });
  if (path) toast(`Exported ${rows.length.toLocaleString()} rows → ${path.split(/[\\/]/).pop()}`, 'success');
}

export function renderInsights() {
  if (!ui.insights) ui.insights = { view: 'build', search: '', buildSource: 'all', buildSort: 'completion_desc', buildMaxMissing: 'all', preconMatch: 'playable', buildPage: 1, opportunityType: 'all', reportId: '' };
  const view = ui.insights.view === 'opportunities' ? opportunityView()
    : ui.insights.view === 'reports' ? reportView()
    : buildReadinessView();
  return `<div class="insights-page">${workspaceNav()}${view}</div>`;
}
