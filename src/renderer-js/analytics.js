import { FOIL_LABEL } from './constants.js';
import { getCurrentPrice, getPriceChange, getPriceHistory } from './prices.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { esc, fmt } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// OWNERSHIP — sold cards/products linger in the tables (status='sold') to power
// realized P&L, but must never count toward owned value, cost basis, or stats.
// Everything that asks "what do I have / what's it worth" goes through these.
// ─────────────────────────────────────────────────────────────────────────────
export function ownedCards()  { return collection.cards.filter(c => c.status !== 'sold'); }
export function soldCards()   { return collection.cards.filter(c => c.status === 'sold'); }
export function ownedSealed()  { return (collection.sealed || []).filter(i => i.status !== 'sold'); }
export function soldSealed()   { return (collection.sealed || []).filter(i => i.status === 'sold'); }

// Net realized gain on one disposed entry: proceeds − fees − what it cost.
// `salePrice` is the total proceeds for the whole entry (all copies sold).
export function entryRealized(entry) {
  const proceeds = entry.salePrice || 0;
  const fees     = entry.saleFees || 0;
  const cost     = (entry.purchasePrice || 0) * (entry.quantity || 1);
  return { proceeds, fees, cost, gain: proceeds - fees - cost };
}

// Aggregate realized gains across sold cards + sold sealed, with a per-year
// breakdown (keyed on the disposal year). Powers the Realized Gains KPI/panel.
export function realizedGains() {
  const sold = [...soldCards(), ...soldSealed()];
  const totals = { proceeds: 0, fees: 0, cost: 0, gain: 0, count: 0 };
  const byYear = new Map();   // 'YYYY' → { proceeds, fees, cost, gain, count }
  for (const e of sold) {
    const r = entryRealized(e);
    totals.proceeds += r.proceeds; totals.fees += r.fees;
    totals.cost += r.cost;         totals.gain += r.gain;
    totals.count++;
    const year = (e.disposedAt || '').slice(0, 4) || 'Unknown';
    const y = byYear.get(year) || { proceeds: 0, fees: 0, cost: 0, gain: 0, count: 0 };
    y.proceeds += r.proceeds; y.fees += r.fees; y.cost += r.cost; y.gain += r.gain; y.count++;
    byYear.set(year, y);
  }
  return { ...totals, byYear };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE CALCULATIONS
// ─────────────────────────────────────────────────────────────────────────────
export function cardCurrentValue(card) {
  const p = getCurrentPrice(card.scryfallId, card.foil);
  return p != null ? p * card.quantity : null;
}

export function totalCardsValue() {
  let t = 0, has = false;
  for (const c of ownedCards()) {
    const v = cardCurrentValue(c);
    if (v != null) { t += v; has = true; }
  }
  return has ? t : null;
}

export function totalSealedValue() {
  let t = 0, has = false;
  for (const i of ownedSealed()) {
    const h = i.priceHistory;
    if (h?.length) { t += h[h.length - 1].price * i.quantity; has = true; }
  }
  return has ? t : null;
}

// Recorded purchase price of everything owned (cards + sealed). Mirrors the
// Cost Basis KPI so the portfolio snapshot's cost line matches the dashboard.
// Sold entries are excluded — their cost belongs to realized P&L, not cost basis.
export function totalCostBasis() {
  let t = 0;
  for (const c of ownedCards())  t += (c.purchasePrice || 0) * (c.quantity || 1);
  for (const i of ownedSealed()) t += (i.purchasePrice || 0) * (i.quantity || 1);
  return t;
}

// Persist one daily snapshot of collection value (UPSERT keyed on the local
// date). Called at the end of a price refresh so we accrue a value-over-time
// series going forward. Skips days with no priced value at all so a fully
// failed refresh can't drop a bogus $0 point onto the chart.
export async function recordPortfolioSnapshot() {
  const cardsValue  = totalCardsValue();
  const sealedValue = totalSealedValue();
  if (cardsValue == null && sealedValue == null) return;

  // Secret Lair slice — Σ computeDropPnL() value/cost (resolved via the window
  // bridge to avoid an analytics↔slTab import cycle; it's call-time only).
  // null when no SL drops are engaged, so non-SL users get no bogus $0 SL line.
  let slValue = null, slCost = null;
  const slRows = (typeof window !== 'undefined' && window.computeDropPnL) ? window.computeDropPnL() : [];
  if (slRows.length) {
    slValue = slRows.reduce((s, r) => s + (r.value || 0), 0);
    slCost  = slRows.reduce((s, r) => s + (r.cost  || 0), 0);
  }

  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const snap = {
    date,
    cardsValue:  cardsValue  ?? 0,
    sealedValue: sealedValue ?? 0,
    costBasis:   totalCostBasis(),
    cardCount:   ownedCards().reduce((s, c) => s + (c.quantity || 1), 0),
    slValue,
    slCost,
  };

  try {
    await window.api.portfolio?.record(snap);
    // Keep the in-memory series in sync so the dashboard chart refreshes without
    // a reload (render() bumps collectionVersion → the Svelte panel re-reads it).
    if (!Array.isArray(collection.portfolioSnapshots)) collection.portfolioSnapshots = [];
    const arr = collection.portfolioSnapshots;
    const idx = arr.findIndex(s => s.date === date);
    if (idx >= 0) arr[idx] = snap; else arr.push(snap);
    arr.sort((a, b) => a.date.localeCompare(b.date));
  } catch (err) {
    window.logger?.warn?.('Portfolio', `Snapshot failed: ${err.message}`);
  }
}

export function binderValueMap() {
  const map = new Map();
  for (const c of ownedCards()) {
    const v = cardCurrentValue(c) ?? (c.purchasePrice * c.quantity);
    const e = map.get(c.binderName) || { value: 0, qty: 0 };
    map.set(c.binderName, { value: e.value + v, qty: e.qty + c.quantity });
  }
  return map;
}

export function topMovers(limit = 10) {
  const out = [];
  for (const c of ownedCards()) {
    const h  = getPriceHistory(c.scryfallId, c.foil);
    const ch = getPriceChange(h);
    if (ch) out.push({ card: c, change: ch });
  }
  out.sort((a, b) => Math.abs(b.change.pct) - Math.abs(a.change.pct));
  return out.slice(0, limit);
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────
export const COLOR_META = {
  W: { name: 'White',      text: '#f0e890', bar: 'rgba(240,232,144,.55)', pip: '#f0e890' },
  U: { name: 'Blue',       text: '#5b9cf6', bar: 'rgba(91,156,246,.45)',  pip: '#5b9cf6' },
  B: { name: 'Black',      text: '#b090e0', bar: 'rgba(176,144,224,.4)',  pip: '#b090e0' },
  R: { name: 'Red',        text: '#e05555', bar: 'rgba(224,85,85,.45)',   pip: '#e05555' },
  G: { name: 'Green',      text: '#3dba6f', bar: 'rgba(61,186,111,.45)',  pip: '#3dba6f' },
  M: { name: 'Multicolor', text: '#e8b84b', bar: 'rgba(232,184,75,.45)',  pip: '#e8b84b' },
  C: { name: 'Colorless',  text: '#9090a8', bar: 'rgba(144,144,168,.3)',  pip: '#9090a8' },
};
export const COLOR_ORDER  = ['W', 'U', 'B', 'R', 'G', 'M', 'C'];
export const TYPE_ORDER   = ['Creature','Instant','Sorcery','Enchantment','Artifact','Planeswalker','Land','Battle','Other'];
export const TYPE_COLORS  = {
  Creature: '#5b9cf6', Instant: '#3dba6f', Sorcery: '#e05555',
  Enchantment: '#b090e0', Artifact: '#9090a8', Planeswalker: '#e8b84b',
  Land: '#7a5e22', Battle: '#f08030', Other: '#4a4668'
};

export function cardMeta(scryfallId) {
  return collection.cardMetadata?.[scryfallId] || null;
}

export function parseMainType(typeLine) {
  if (!typeLine) return 'Other';
  for (const t of TYPE_ORDER.slice(0, -1)) {
    if (typeLine.includes(t)) return t;
  }
  return 'Other';
}

export function resolveColor(scryfallId) {
  const m = cardMeta(scryfallId);
  if (!m) return null;
  const c = m.colors || [];
  if (c.length === 0) return 'C';
  if (c.length  >  1) return 'M';
  return c[0];
}

export function analyzeByColor() {
  const result = {};
  for (const card of ownedCards()) {
    const color = resolveColor(card.scryfallId);
    if (!color) continue;
    const val = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    if (!result[color]) result[color] = { value: 0, qty: 0 };
    result[color].value += val;
    result[color].qty   += card.quantity;
  }
  return result;
}

export function analyzeByType() {
  const result = {};
  for (const card of ownedCards()) {
    const m = cardMeta(card.scryfallId);
    if (!m) continue;
    const type = parseMainType(m.type_line);
    const val  = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    if (!result[type]) result[type] = { value: 0, qty: 0 };
    result[type].value += val;
    result[type].qty   += card.quantity;
  }
  return result;
}

export function analyzeByManaValue() {
  const keys   = ['0','1','2','3','4','5','6+'];
  const values = Object.fromEntries(keys.map(k => [k, 0]));
  const qtys   = Object.fromEntries(keys.map(k => [k, 0]));
  for (const card of ownedCards()) {
    const m = cardMeta(card.scryfallId);
    if (!m || m.cmc == null) continue;
    // Skip lands from mana curve (they skew everything to 0)
    if (parseMainType(m.type_line) === 'Land') continue;
    const key = Math.floor(m.cmc) >= 6 ? '6+' : String(Math.floor(m.cmc));
    const val = cardCurrentValue(card) ?? (card.purchasePrice * card.quantity);
    values[key] += val;
    qtys[key]   += card.quantity;
  }
  return { values, qtys, keys };
}

export function hasMetadata() {
  return Object.keys(collection.cardMetadata || {}).length > 0;
}

// ── Set analytics ─────────────────────────────────────────────────────────────
export function analyzeBySet() {
  const sets = new Map(); // setCode → { setName, qty, value }
  for (const c of ownedCards()) {
    const key = c.setCode || '???';
    if (!sets.has(key)) sets.set(key, { setName: c.setName || key, qty: 0, value: 0 });
    const s = sets.get(key);
    s.qty   += c.quantity;
    const v  = cardCurrentValue(c);
    if (v != null) s.value += v;
  }
  return sets;
}

// ── Year analytics ────────────────────────────────────────────────────────────
export function analyzeByYear() {
  // ManaBox set names often include year in the set name, but we can extract
  // year from purchaseDate or fall back to parsing setName.
  // Most reliable: setCode → release year lookup via a simple heuristic.
  // We'll bucket by the first 4-digit year found in setName, else 'Unknown'.
  const years = new Map();
  for (const c of ownedCards()) {
    const match = (c.setName || '').match(/\b(19|20)\d{2}\b/);
    const year  = match ? match[0] : 'Unknown';
    if (!years.has(year)) years.set(year, { qty: 0, value: 0 });
    const y = years.get(year);
    y.qty += c.quantity;
    const v = cardCurrentValue(c);
    if (v != null) y.value += v;
  }
  return years;
}

// ── Top 10 most valuable individual card entries ───────────────────────────────
export function topValueCards(n = 10) {
  return ownedCards()
    .map(c => ({ card: c, value: cardCurrentValue(c) ?? 0 }))
    .filter(x => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// ── Card of the Day ───────────────────────────────────────────────────────────
export function getCardOfTheDay() {
  const cards = ownedCards();
  if (!cards.length) return null;
  const d = new Date();
  const dateSeed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  const raw = (dateSeed + (ui.cotdOffset || 0)) * 2654435761;
  const idx = Math.abs(raw) % cards.length;
  return cards[idx];
}

export function renderCardOfTheDay() {
  const card = getCardOfTheDay();
  if (!card) return '<p style="color:var(--text-muted);font-size:13px">No cards in collection.</p>';

  const id = card.scryfallId ? card.scryfallId.toLowerCase() : null;
  const imgUrl = id
    ? `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`
    : null;
  const value = cardCurrentValue(card);
  const totalVal = value != null ? value * card.quantity : null;
  const foilLabel = card.foil !== 'normal' ? FOIL_LABEL[card.foil] : null;

  return `
    <div style="display:flex;gap:14px;align-items:flex-start">
      ${imgUrl ? `
        <img src="${esc(imgUrl)}" alt="${esc(card.name)}"
          style="width:155px;flex-shrink:0;border-radius:10px;box-shadow:0 4px 18px rgba(0,0,0,0.6)"
          data-imgerr="hide">` : ''}
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:700;color:var(--text);line-height:1.25;margin-bottom:2px">${esc(card.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${esc(card.setName)} · ${esc(card.setCode.toUpperCase())}</div>
        ${foilLabel ? `<span class="badge badge-${card.foil}" style="margin-bottom:8px;display:inline-block">${foilLabel}</span>` : ''}
        <div style="display:grid;grid-template-columns:auto 1fr;gap:2px 8px;font-size:12px;color:var(--text-dim);margin-bottom:10px">
          <span style="color:var(--text-muted)">Binder</span><span>${esc(card.binderName)}</span>
          <span style="color:var(--text-muted)">Rarity</span><span style="text-transform:capitalize">${esc(card.rarity || '—')}</span>
          <span style="color:var(--text-muted)">Qty</span><span>${card.quantity}</span>
          ${card.condition ? `<span style="color:var(--text-muted)">Cond</span><span>${esc(card.condition)}</span>` : ''}
        </div>
        ${value != null
          ? `<div style="font-size:20px;font-weight:700;color:var(--text);margin-bottom:2px">${fmt(value)}</div>
             ${card.quantity > 1 ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:10px">× ${card.quantity} = ${fmt(totalVal)}</div>` : '<div style="margin-bottom:10px"></div>'}`
          : '<div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">No price data</div>'}
        <button class="btn btn-ghost" style="font-size:11px;padding:3px 10px" data-act="ui-inc" data-path="cotdOffset">🎲 New Card</button>
      </div>
    </div>`;
}

// ── Render: Card Count by Set ─────────────────────────────────────────────────
export function renderCardCountBySet() {
  const sets = analyzeBySet();
  if (!sets.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(sets.entries()).sort((a, b) => b[1].qty - a[1].qty).slice(0, 20);
  const max = sorted[0][1].qty;
  return sorted.map(([code, { setName, qty }]) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(setName)}">${esc(setName)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(qty / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${qty.toLocaleString()}</div>
    </div>
    <div class="bar-sub" style="margin-bottom:3px">${esc(code.toUpperCase())}</div>
  `).join('');
}

// ── Render: Total Value by Set ────────────────────────────────────────────────
export function renderValueBySet() {
  const sets = analyzeBySet();
  if (!sets.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(sets.entries())
    .filter(([, s]) => s.value > 0)
    .sort((a, b) => b[1].value - a[1].value)
    .slice(0, 20);
  if (!sorted.length) return '<p style="color:var(--text-muted);font-size:13px">Refresh prices to see set values.</p>';
  const max = sorted[0][1].value;
  return sorted.map(([code, { setName, value, qty }]) => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(setName)}">${esc(setName)}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(value / max * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${fmt(value)}</div>
    </div>
    <div class="bar-sub" style="margin-bottom:3px">${esc(code.toUpperCase())} · ${qty} copies</div>
  `).join('');
}

// ── Render: Card Count by Year ────────────────────────────────────────────────
export function renderCardCountByYear() {
  const years = analyzeByYear();
  if (!years.size) return '<p style="color:var(--text-muted);font-size:13px">No data yet.</p>';
  const sorted = Array.from(years.entries())
    .filter(([y]) => y !== 'Unknown')
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (!sorted.length) return '<p style="color:var(--text-muted);font-size:13px">No year data found in set names.</p>';
  const max = Math.max(1, ...sorted.map(([, v]) => v.qty));
  const barColors = ['#5b9cf6','#3dba6f','#e8b84b','#f08030','#e05555','#9b7bfa','#60c8c8'];
  return `
    <div class="mv-chart" style="height:200px">
      ${sorted.map(([year, { qty }], i) => {
        const pct = (qty / max * 100).toFixed(1);
        const color = barColors[i % barColors.length];
        return `
          <div class="mv-col">
            <div class="mv-val" style="font-size:9px">${qty.toLocaleString()}</div>
            <div class="mv-bar-wrap">
              <div class="mv-bar" style="height:${pct}%;background:${color}44;border-top:2px solid ${color}"></div>
            </div>
            <div class="mv-key" style="font-size:10px">${year}</div>
          </div>`;
      }).join('')}
    </div>`;
}

// ── Render: Top 10 Most Valuable Cards ────────────────────────────────────────
export function renderTop10ValueCards() {
  const top = topValueCards(10);
  if (!top.length) return '<p style="color:var(--text-muted);font-size:13px">Refresh prices to see top cards.</p>';
  return `<div class="table-wrap"><table>
    <thead><tr><th>#</th><th>Name</th><th>Set</th><th>Foil</th><th>Qty</th><th>Market</th><th>Total</th></tr></thead>
    <tbody>
      ${top.map(({ card: c, value }, i) => `
        <tr>
          <td style="color:var(--text-muted);font-weight:700;font-size:13px">${i + 1}</td>
          <td style="font-weight:600;max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(c.name)}">${esc(c.name)}</td>
          <td style="color:var(--text-muted);font-size:11.5px;font-weight:600">${esc(c.setCode.toUpperCase())}</td>
          <td>${c.foil !== 'normal' ? `<span class="badge badge-${c.foil}">${FOIL_LABEL[c.foil]}</span>` : '<span style="color:var(--text-muted)">—</span>'}</td>
          <td style="text-align:center">${c.quantity}</td>
          <td style="font-weight:700;color:var(--text)">${fmt(value)}</td>
          <td style="font-weight:700">${fmt(value * c.quantity)}</td>
        </tr>`).join('')}
    </tbody>
  </table></div>`;
}



export function renderRarityPanel() {
  const rm = { mythic: { qty: 0, val: 0 }, rare: { qty: 0, val: 0 }, uncommon: { qty: 0, val: 0 }, common: { qty: 0, val: 0 } };
  for (const c of ownedCards()) {
    const r = c.rarity || 'common';
    if (!rm[r]) rm[r] = { qty: 0, val: 0 };
    rm[r].qty += c.quantity;
    const v = cardCurrentValue(c);
    if (v != null) rm[r].val += v;
  }
  const maxVal = Math.max(1, ...Object.values(rm).map(v => v.val));
  const order = ['mythic', 'rare', 'uncommon', 'common'];
  return order.map(r => `
    <div class="bar-row">
      <div class="bar-label" style="text-transform:capitalize">${r}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(rm[r].val / maxVal * 100).toFixed(1)}%"></div></div>
      <div class="bar-val">${fmt(rm[r].val)}</div>
    </div>
    <div class="bar-sub">${rm[r].qty} copies</div>
  `).join('');
}

// ── Color Panel ──────────────────────────────────────────────────────────────
export function renderColorPanel() {
  if (!hasMetadata()) return noMetaMsg();
  const data = analyzeByColor();
  const rows = COLOR_ORDER.filter(c => data[c]);
  if (!rows.length) return '<p style="color:var(--text-muted);font-size:13px">No color data yet.</p>';
  const maxVal = Math.max(1, ...rows.map(c => data[c].value));
  const total  = rows.reduce((s, c) => s + data[c].value, 0);
  return rows.map(c => {
    const { value, qty } = data[c];
    const cm  = COLOR_META[c];
    const pct = (value / maxVal * 100).toFixed(1);
    const share = total > 0 ? (value / total * 100).toFixed(0) : 0;
    return `
      <div class="analytics-row">
        <div class="color-pip" style="color:${cm.text};border-color:${cm.text}22;background:${cm.bar.replace('.45','.1')}">${c}</div>
        <div class="a-label">${cm.name}</div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${pct}%;background:${cm.bar};border-right:2px solid ${cm.pip}"></div>
        </div>
        <div class="a-val">${fmt(value)}</div>
        <div class="a-pct">${share}%</div>
      </div>
      <div class="analytics-sub">${qty} copies</div>`;
  }).join('');
}

// ── Type Panel ───────────────────────────────────────────────────────────────
export function renderTypePanel() {
  if (!hasMetadata()) return noMetaMsg();
  const data  = analyzeByType();
  const order = TYPE_ORDER.filter(t => data[t]);
  if (!order.length) return '<p style="color:var(--text-muted);font-size:13px">No type data yet.</p>';
  const maxVal = Math.max(1, ...order.map(t => data[t].value));
  return order.map(t => {
    const { value, qty } = data[t];
    const color = TYPE_COLORS[t] || '#4a4668';
    const pct   = (value / maxVal * 100).toFixed(1);
    return `
      <div class="analytics-row">
        <div class="type-dot" style="background:${color}"></div>
        <div class="a-label">${t}</div>
        <div class="bar-track" style="flex:1">
          <div class="bar-fill" style="width:${pct}%;background:${color}33;border-right:2px solid ${color}"></div>
        </div>
        <div class="a-val">${fmt(value)}</div>
      </div>
      <div class="analytics-sub">${qty} copies</div>`;
  }).join('');
}

// ── Mana Value Panel ─────────────────────────────────────────────────────────
export function fmtShort(n) {
  if (!n || n < 0.01) return '';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + n.toFixed(0);
}

export function renderManaValuePanel() {
  if (!hasMetadata()) return noMetaMsg();
  const { values, qtys, keys } = analyzeByManaValue();
  const maxVal   = Math.max(1, ...keys.map(k => values[k]));
  const totalQty = keys.reduce((s, k) => s + qtys[k], 0);
  if (totalQty === 0) return '<p style="color:var(--text-muted);font-size:13px">No mana value data yet.</p>';
  const barColors = ['#9090a8','#5b9cf6','#3dba6f','#e8b84b','#f08030','#e05555','#b090e0'];
  return `
    <div class="mv-chart">
      ${keys.map((k, i) => {
        const pct   = maxVal > 0 ? (values[k] / maxVal * 100) : 0;
        const color = barColors[i] || '#4a4668';
        return `
          <div class="mv-col">
            <div class="mv-val">${fmtShort(values[k])}</div>
            <div class="mv-bar-wrap">
              <div class="mv-bar" style="height:${Math.max(pct, values[k] > 0 ? 2 : 0).toFixed(1)}%;background:${color}44;border-top:2px solid ${color}"></div>
            </div>
            <div class="mv-key">${k}</div>
            <div class="mv-qty">${qtys[k] > 0 ? qtys[k] : ''}</div>
          </div>`;
      }).join('')}
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:8px;text-align:center;letter-spacing:.03em">
      CMC distribution — lands excluded · label = copies
    </div>`;
}

export function noMetaMsg() {
  return `<div style="text-align:center;padding:20px 0;color:var(--text-muted);font-size:13px">
    Click <strong style="color:var(--accent)">↻ Refresh Prices</strong> to load card data from Scryfall.
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
export function renderStatsPanel() {
  const cards = ownedCards();
  if (!cards.length)
    return '<p style="color:var(--text-muted);font-size:13px;padding:10px 0">Import cards to see stats.</p>';

  const total    = cards.length;
  const totalQty = cards.reduce((s, c) => s + c.quantity, 0);
  const priced   = cards.filter(c => getCurrentPrice(c.scryfallId, c.foil) != null).length;
  const foils    = cards.filter(c => c.foil !== 'normal').reduce((s, c) => s + c.quantity, 0);
  const langs    = new Set(cards.map(c => c.language)).size;
  const misprints = cards.filter(c => c.misprint).length;
  const altered  = cards.filter(c => c.altered).length;
  const sets     = new Set(cards.map(c => c.setCode)).size;

  const rows = [
    ['Entries', total.toLocaleString()],
    ['Total Copies', totalQty.toLocaleString()],
    ['Priced', `${priced.toLocaleString()} / ${total.toLocaleString()} (${Math.round(priced / total * 100)}%)`],
    ['Unique Sets', sets],
    ['Foil / Etched Copies', foils.toLocaleString()],
    ['Languages', langs],
    ['Misprints', misprints],
    ['Altered', altered],
  ];
  return rows.map(([l, v]) => `
    <div class="stat-row"><span class="stat-label">${l}</span><span class="stat-value">${v}</span></div>
  `).join('');
}

