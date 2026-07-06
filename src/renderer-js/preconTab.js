// preconTab.js — the Precon Explorer: every physical preconstructed deck,
// browsable product line → deck → cards, with ownership, hover previews, and
// the same economics treatment the SL Explorer gets (assumed MSRP vs. singles
// vs. sealed market). Mirrors slTab.js's structure and reuses its card tiles.

import {
  addPreconMissingToWantList, ensurePreconCards, ensurePreconDetails,
  ownedFinishKeySet, preconCardsFor, preconMsrpDefault, preconOwnedStats,
  preconState, refreshPreconData, rowPrice, sealedPriceForPrecon,
} from './preconData.js';
import { slCardTile } from './slTab.js';
import { ui } from './state.js';
import { esc, escJs, fmt } from './utils.js';

// Curated product-line order — the lines people actually shop, then history.
const LINE_ORDER = [
  'Commander Deck', 'Challenger Deck', 'Pioneer Challenger Deck', 'Duel Deck',
  'Theme Deck', 'Intro Pack', 'Planeswalker Deck', 'Event Deck', 'Brawl Deck',
  'Guild Kit', 'Game Night Deck', 'Premium Deck', 'Archenemy Deck',
  'Planechase Deck', 'Clash Pack', 'Starter Deck', 'Starter Kit',
  'Spellslinger Starter Kit', 'Welcome Deck', 'World Championship Deck',
  'Pro Tour Deck', 'Modern Event Deck', 'Box Set', 'Enhanced Deck',
  'Advanced Deck', 'Advanced Pack', 'Dandan Deck',
];

const PIP_COLORS = { W: '#e8e3c9', U: '#4e8fd1', B: '#8a7f91', R: '#d34a3f', G: '#3f9d5d' };
function colorPips(colors) {
  if (!colors) return `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#9aa0a6;opacity:.7" title="Colorless"></span>`;
  return colors.split('').map(c =>
    `<span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:${PIP_COLORS[c] || '#9aa0a6'};border:1px solid rgba(0,0,0,.35)" title="${c}"></span>`
  ).join('<span style="display:inline-block;width:3px"></span>');
}

const BOARD_LABEL = { commander: 'Commander', main: 'Main deck', side: 'Sideboard', token: 'Tokens' };
const BOARD_RANK = { commander: 0, main: 1, side: 2, token: 3 };
const RARITY_RANK = { mythic: 0, rare: 1, uncommon: 2, common: 3, special: 4, bonus: 5 };

// The Table view: the decklist as a sortable data grid — mana cost, color,
// type, rarity, finish, qty, and per-row-finish price. Column data comes from
// the on-demand Scryfall detail fetch (shared with the singles valuation).
function deckTable(deck, ownedKeys) {
  const details = preconState.details.get(deck.file);
  if (!details) {
    if (!preconState.pricing.has(deck.file)) ensurePreconDetails(deck.file);
    return `<div style="padding:40px;text-align:center;color:var(--text-muted)">⏳ Loading card details from Scryfall…</div>`;
  }
  const pv = ui.precons;
  const [field, dir] = (pv.tableSort || 'name_asc').split('_');
  const mul = dir === 'desc' ? -1 : 1;

  const rows = preconCardsFor(deck.file).filter(r => r.board !== 'token').map(r => {
    const d = details.get(r.sid) || {};
    return {
      ...r,
      manaCost: d.manaCost || '',
      cmc: d.cmc ?? null,
      typeLine: d.typeLine || '',
      colors: d.colors || [],
      rarity: d.rarity || '',
      price: d.prices ? rowPrice(d.prices, r.finish) : null,
      owned: ownedKeys.has(`${r.sid}|${r.finish}`),
    };
  });

  const keyFns = {
    name:   r => r.name || '',
    cost:   r => r.cmc ?? -1,
    color:  r => (r.colors.length ? r.colors.join('') : 'ZZ'),   // colorless last
    type:   r => r.typeLine,
    rarity: r => RARITY_RANK[r.rarity] ?? 9,
    price:  r => r.price ?? -1,
    owned:  r => Number(r.owned),
  };
  const key = keyFns[field] || keyFns.name;
  rows.sort((a, b) => {
    const bo = (BOARD_RANK[a.board] ?? 9) - (BOARD_RANK[b.board] ?? 9);
    if (field === 'name' && bo !== 0) return bo;   // default sort keeps commander on top
    const av = key(a), bv = key(b);
    if (typeof av === 'string') return av.localeCompare(bv) * mul || (a.name || '').localeCompare(b.name || '');
    return (av - bv) * mul || (a.name || '').localeCompare(b.name || '');
  });

  const th = (label, f) => {
    const active = field === f;
    const arrow = active ? (dir === 'desc' ? ' ↓' : ' ↑') : '';
    return `<th style="cursor:pointer;white-space:nowrap;user-select:none${active ? ';color:var(--accent2)' : ''}"
      data-act="ui-set" data-path="precons.tableSort" data-val="${f}_${active && dir === 'asc' ? 'desc' : 'asc'}">${label}${arrow}</th>`;
  };

  const body = rows.map(r => `
    <tr data-precon-sid="${esc(r.sid)}" style="cursor:pointer${r.owned ? '' : ';opacity:.62'}" data-act="showSlViewerModal" data-arg="${esc(r.sid)}">
      <td>${r.owned ? '<span style="color:var(--green)">✓</span>' : '<span style="color:var(--text-muted)">✗</span>'}</td>
      <td style="font-weight:600;color:var(--text)">${esc(r.name)}${r.board === 'commander' ? ' <span title="Commander">👑</span>' : ''}${r.board === 'side' ? ' <span style="font-size:10px;color:var(--text-muted)">(SB)</span>' : ''}</td>
      <td style="font-family:var(--mono,monospace);font-size:12px;white-space:nowrap">${esc(r.manaCost)}</td>
      <td>${colorPips(r.colors.join(''))}</td>
      <td style="font-size:12px">${esc(r.typeLine)}</td>
      <td style="text-transform:capitalize;font-size:12px">${esc(r.rarity)}</td>
      <td style="font-size:12px">${r.finish === 'nonfoil' ? '—' : `<span class="badge badge-${r.finish === 'etched' ? 'etched' : 'foil'}">${r.finish === 'etched' ? 'Etched' : 'Foil'}</span>`}</td>
      <td style="text-align:center">${r.count}</td>
      <td style="text-align:right;font-weight:600">${r.price != null ? fmt(r.price) : '<span style="color:var(--text-muted)">—</span>'}</td>
    </tr>`).join('');

  return `
    <div style="overflow-x:auto">
      <table class="cards-table" style="width:100%;font-size:13px">
        <thead><tr>
          ${th('Own', 'owned')}${th('Card', 'name')}${th('Cost', 'cost')}${th('Color', 'color')}${th('Type', 'type')}${th('Rarity', 'rarity')}<th>Finish</th><th>Qty</th>${th('Price', 'price')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`;
}

function refreshBar() {
  return `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <span style="font-size:12px;color:var(--text-muted);flex:1">${preconState.decks.length.toLocaleString()} preconstructed decks · 1993 → today · decklists never change, new ones are fetched on demand</span>
      <button class="btn btn-ghost" style="font-size:12px;white-space:nowrap"
        title="Checks MTGJSON's deck catalog for precons released since this dataset was built and fetches just the new ones."
        data-act="refreshPreconData" ${preconState.syncing ? 'disabled' : ''}>
        ${preconState.syncing ? '⏳ Checking…' : '↻ Check for New Precons'}
      </button>
    </div>`;
}

function breadcrumb(pv, deck) {
  const root = `<a class="bc-link" data-act="ui-set" data-path="precons.line" data-val="" data-also="precons.deck=">Precon Explorer</a>`;
  const sep = `<span class="bc-sep">›</span>`;
  if (deck) {
    const line = `<a class="bc-link" data-act="ui-set" data-path="precons.deck" data-val="">${esc(deck.type || 'Decks')}</a>`;
    return `<nav class="sl-breadcrumb">${root}${sep}${line}${sep}<span class="bc-current">${esc(deck.name)}</span></nav>`;
  }
  if (pv.line) return `<nav class="sl-breadcrumb">${root}${sep}<span class="bc-current">${esc(pv.line)}</span></nav>`;
  return `<nav class="sl-breadcrumb"><span class="bc-current">Precon Explorer</span></nav>`;
}

// Economics banner: assumed MSRP vs. singles-now vs. sealed market.
function deckEconomicsBanner(deck) {
  const file = deck.file;
  const msrp = preconMsrpDefault(deck.type, deck.date);
  const singles = preconState.singles.get(file);
  const pricing = preconState.pricing.has(file);
  const sealed = sealedPriceForPrecon(deck);

  const singlesCell = pricing
    ? `<span style="color:var(--text-muted)">⏳ Pricing…</span>`
    : singles
      ? `<strong style="color:var(--text)">${fmt(singles.value)}</strong> <span style="font-size:11px;color:var(--text-muted)">(${singles.priced}/${singles.rows} priced)</span>
         <button class="btn btn-ghost" style="font-size:11px;padding:2px 8px;margin-left:4px" data-act="pricePreconSingles" data-arg="${esc(file)}">↻</button>`
      : `<button class="btn btn-sm" data-act="pricePreconSingles" data-arg="${esc(file)}">💰 Price the singles</button>`;

  const sealedCell = sealed
    ? `<strong style="color:var(--text)">${fmt(sealed.price)}</strong> <span style="font-size:11px;color:var(--text-muted)" title="${esc(sealed.name || '')}">≈ TCGCSV</span>`
    : `<span style="color:var(--text-muted)">— <span style="font-size:11px">(sync price data on the Sealed tab)</span></span>`;

  let verdict = '';
  if (singles && (sealed || msrp != null)) {
    const parts = [];
    if (msrp != null) {
      const diff = singles.value - msrp;
      const pct = msrp > 0 ? Math.round(Math.abs(diff) / msrp * 100) : null;
      parts.push(`<span style="font-weight:700;color:${diff >= 0 ? 'var(--green)' : '#f87171'}">vs ≈MSRP: ${diff >= 0 ? '+' : '−'}${fmt(Math.abs(diff))}${pct != null ? ` (${pct}%)` : ''}</span>`);
    }
    if (sealed) {
      const diff = singles.value - sealed.price;
      parts.push(diff >= 0
        ? `<span style="font-weight:700;color:var(--green)">🃏 The singles are worth ${fmt(Math.abs(diff))} more than a sealed copy.</span>`
        : `<span style="font-weight:700;color:var(--text)">📦 A sealed copy carries a ${fmt(Math.abs(diff))} premium over its singles.</span>`);
    }
    verdict = `<div style="margin-top:8px;display:flex;gap:18px;flex-wrap:wrap">${parts.join('')}</div>`;
  }

  return `
    <div style="margin:0 0 12px;padding:11px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:13px">
      <div style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:700;color:var(--text)">💎 Worth it?</span>
        <span><span style="color:var(--text-muted)">MSRP</span> ${msrp != null ? `≈ <strong style="color:var(--text)">${fmt(msrp)}</strong>` : '<span style="color:var(--text-muted)">—</span>'}</span>
        <span style="margin-left:auto"><span style="color:var(--text-muted)">As singles</span> ${singlesCell}</span>
        <span><span style="color:var(--text-muted)">Sealed market</span> ${sealedCell}</span>
      </div>
      ${verdict}
    </div>`;
}

export function renderPreconTab() {
  const pv = ui.precons;

  if (!preconState.decks.length) {
    return `<div style="padding:40px;text-align:center;color:var(--text-muted)">
      No precon catalog loaded.<br>The baked dataset seeds on first launch — try restarting the app,
      or click ↻ Check for New Precons after a restart.<br><br>
      <button class="btn" data-act="refreshPreconData">↻ Check for New Precons</button>
    </div>`;
  }

  // The membership map loads lazily on first open — gate until it lands.
  if (!preconState.cards) {
    ensurePreconCards();
    return `<div style="padding:60px;text-align:center;color:var(--text-muted)">
      <div style="font-size:22px;margin-bottom:10px">🧱</div>
      Loading ${preconState.decks.length.toLocaleString()} decklists…
    </div>`;
  }

  const ownedKeys = ownedFinishKeySet();
  const statsFor = (file) => preconOwnedStats(file, ownedKeys);

  // ── Deck detail ────────────────────────────────────────────────────────────
  if (pv.deck) {
    const deck = preconState.byFile.get(pv.deck);
    if (!deck) { pv.deck = ''; return renderPreconTab(); }
    const rows = preconCardsFor(deck.file);
    const stats = statsFor(deck.file);
    const pct = stats.total ? Math.round(stats.owned / stats.total * 100) : 0;
    const missing = rows.filter(r => r.board !== 'token' && !ownedKeys.has(`${r.sid}|${r.finish}`));
    const base = deck.variantOf ? preconState.byFile.get(deck.variantOf) : null;

    const body = (pv.deckView === 'table')
      ? deckTable(deck, ownedKeys)
      : ['commander', 'main', 'side', 'token'].map(board => {
          const bRows = rows.filter(r => r.board === board);
          if (!bRows.length) return '';
          const grid = bRows.map(r => slCardTile(r.sid, r.num, r.finish)).join('');
          return `
            <div style="margin:14px 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted)">
              ${BOARD_LABEL[board]} · ${bRows.length}
            </div>
            <div class="gallery-grid">${grid}</div>`;
        }).join('');

    const viewBtn = (id, label) =>
      `<button class="btn ${pv.deckView === id ? 'btn-primary' : 'btn-ghost'}" style="font-size:12px" data-act="ui-set" data-path="precons.deckView" data-val="${id}">${label}</button>`;

    return refreshBar() + breadcrumb(pv, deck) + `
      <div class="gallery-filters">
        <div class="gallery-filter-row">
          <button class="btn btn-ghost" style="font-size:12px" data-act="ui-set" data-path="precons.deck" data-val="">← Back to ${esc(deck.type || 'decks')}</button>
          ${viewBtn('gallery', '🖼 Gallery')}${viewBtn('table', '📊 Table')}
          ${missing.length ? `<button class="btn btn-ghost" style="font-size:12px" data-act="addPreconMissingToWantList" data-arg="${esc(deck.file)}" title="Add this deck's missing cards to your want list">★ Want ${missing.length} missing</button>` : ''}
          <span style="display:flex;align-items:center;gap:6px;margin-left:8px">${colorPips(deck.colors)}</span>
          <span style="font-size:12px;color:var(--text-muted)">${esc(deck.type || '')} · ${esc(deck.code || '')} · ${esc(deck.date || '—')}${base ? ` · variant of ${esc(base.name)}` : ''}</span>
          ${deck.commander ? `<span style="font-size:12px;color:var(--text-muted)">👑 ${esc(deck.commander)}</span>` : ''}
          <span style="margin-left:auto;font-size:13px;font-weight:700;color:${stats.owned === stats.total && stats.total > 0 ? 'var(--green)' : 'var(--text-muted)'}">
            ${stats.owned} / ${stats.total} cards owned (${pct}%)
          </span>
        </div>
      </div>
      ${deckEconomicsBanner(deck)}
      ${body}`;
  }

  // ── Line view (one product line's decks) ───────────────────────────────────
  if (pv.line) {
    let decks = preconState.decks.filter(d => d.type === pv.line);
    const q = (pv.search || '').toLowerCase().trim();
    if (q) decks = decks.filter(d =>
      d.name.toLowerCase().includes(q) || (d.commander || '').toLowerCase().includes(q) || (d.code || '').toLowerCase().includes(q));
    const dir = pv.sort.endsWith('_desc') ? -1 : 1;
    if (pv.sort.startsWith('name')) decks.sort((a, b) => a.name.localeCompare(b.name) * dir);
    else if (pv.sort.startsWith('own')) decks.sort((a, b) => {
      const sa = statsFor(a.file), sb = statsFor(b.file);
      return ((sb.total ? sb.owned / sb.total : 0) - (sa.total ? sa.owned / sa.total : 0));
    });
    else decks.sort((a, b) => ((a.date || '9999').localeCompare(b.date || '9999') || a.name.localeCompare(b.name)) * dir);

    const opts = [['date_desc', 'Date ↓'], ['date_asc', 'Date ↑'], ['name_asc', 'Name A→Z'], ['own_desc', 'Completion ↓']];
    return refreshBar() + breadcrumb(pv) + `
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
        <input type="text" id="preconSearchInput" placeholder="Search decks, commanders, or set codes…"
          value="${esc(pv.search || '')}"
          data-act="ui-set" data-path="precons.search" data-refocus="preconSearchInput"
          style="flex:1;min-width:200px;padding:6px 10px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:13px;font-family:inherit">
        ${pv.search ? `<button class="btn btn-ghost" style="font-size:12px;padding:4px 10px" data-act="ui-set" data-path="precons.search" data-val="">✕</button>` : ''}
        <span style="color:var(--text-muted);font-size:11px;white-space:nowrap">Sort:</span>
        <select data-act="ui-set" data-path="precons.sort" style="font-size:12px">
          ${opts.map(([v, l]) => `<option value="${v}"${pv.sort === v ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      ${decks.length === 0
        ? `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:13px">No decks match "${esc(pv.search)}".</div>`
        : `<div class="sl-superdrop-grid">
          ${decks.map(d => {
            const s = statsFor(d.file);
            const pc = s.total ? Math.round(s.owned / s.total * 100) : 0;
            return `
              <div class="sl-superdrop-card" data-act="ui-set" data-path="precons.deck" data-val="${esc(d.file)}">
                <div class="sl-superdrop-name">${esc(d.name)}</div>
                <div class="sl-superdrop-meta" style="display:flex;align-items:center;gap:6px">
                  ${colorPips(d.colors)}
                  <span>${esc(d.code || '')} · ${d.date || '—'} · ${d.cardCount} cards</span>
                </div>
                ${d.commander ? `<div class="sl-superdrop-meta" style="margin-top:2px">👑 ${esc(d.commander)}</div>` : ''}
                <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pc}%"></div></div>
                <div class="sl-superdrop-count" style="color:${s.owned === s.total && s.total > 0 ? 'var(--green)' : 'var(--text-muted)'}">${s.owned} / ${s.total} owned</div>
              </div>`;
          }).join('')}
        </div>`}`;
  }

  // ── Landing: product-line tiles ────────────────────────────────────────────
  const byType = new Map();
  for (const d of preconState.decks) {
    if (!byType.has(d.type)) byType.set(d.type, []);
    byType.get(d.type).push(d);
  }
  // Jumpstart is 570 half-decks — off by default, revealed by the toggle.
  const hasJumpstart = byType.has('Jumpstart');
  let lines = [...byType.keys()].sort((a, b) => {
    const ia = LINE_ORDER.indexOf(a), ib = LINE_ORDER.indexOf(b);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || a.localeCompare(b);
  });
  if (!pv.showJumpstart) lines = lines.filter(l => l !== 'Jumpstart');

  const jumpToggle = hasJumpstart ? `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-muted)">
        <input type="checkbox" ${pv.showJumpstart ? 'checked' : ''} data-act="ui-set" data-path="precons.showJumpstart">
        Show Jumpstart (${byType.get('Jumpstart').length} half-decks)
      </label>
    </div>` : '';

  return refreshBar() + breadcrumb(pv) + jumpToggle + `
    <div class="sl-superdrop-grid">
      ${lines.map(line => {
        const decks = byType.get(line);
        let owned = 0, total = 0;
        for (const d of decks) { const s = statsFor(d.file); owned += s.owned; total += s.total; }
        const pc = total ? Math.round(owned / total * 100) : 0;
        const dates = decks.map(d => (d.date || '').slice(0, 4)).filter(Boolean).sort();
        const range = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}–${dates[dates.length - 1]}`) : '—';
        return `
          <div class="sl-superdrop-card" data-act="ui-set" data-path="precons.line" data-val="${esc(line)}" data-also="precons.search=">
            <div class="sl-superdrop-name">${esc(line)}s</div>
            <div class="sl-superdrop-meta">${range} · ${decks.length} deck${decks.length !== 1 ? 's' : ''}</div>
            <div class="sl-progress-bar"><div class="sl-progress-fill" style="width:${pc}%"></div></div>
            <div class="sl-superdrop-count" style="color:${owned === total && total > 0 ? 'var(--green)' : 'var(--text-muted)'}">${owned} / ${total} owned</div>
          </div>`;
      }).join('')}
    </div>`;
}
