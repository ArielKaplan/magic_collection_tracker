import { cardCurrentValue, topMovers } from './analytics.js';
import { hideCardHoverPreview, showCardHoverPreview } from './hover.js';
import { showCardContextMenu } from './modals.js';
import { render } from './render.js';
import { collection } from './state.js';
import { esc, fmt, fmtPct } from './utils.js';


// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
// Dow-Jones-style ticker tape — top movers scroll across the top of the app.
// Re-renders on every render() call (cheap; mostly DOM string assignment).
// Configurable via Settings → Ticker Tape: binder/set filters + scroll speed.
export function tickerSettings() {
  const t = collection.settings.ticker || {};
  return {
    binders: Array.isArray(t.binders) ? t.binders : [],
    sets:    Array.isArray(t.sets)    ? t.sets    : [],
    speed:   Math.min(10, Math.max(1, parseInt(t.speed, 10) || 4)),
  };
}

export function renderTickerTape() {
  const el = document.getElementById('ticker-tape');
  if (!el) return;

  const cfg = tickerSettings();
  const binderSel = new Set(cfg.binders);
  const setSel    = new Set(cfg.sets);
  const hasFilter = binderSel.size > 0 || setSel.size > 0;
  const passes = c =>
    (binderSel.size === 0 || binderSel.has(c.binderName)) &&
    (setSel.size === 0    || setSel.has(c.setName));

  const movers = topMovers(Infinity).filter(m => passes(m.card)).slice(0, 40);
  // Fallback: if we don't have enough movers yet (need 2+ refreshes), show
  // top-valued cards instead so the strip isn't empty.
  let items = movers.map(({ card, change }) => ({
    card,
    name: card.name,
    setCode: card.setCode,
    price: change.current,
    pct: change.pct,
    dir: change.pct >= 0 ? 'up' : 'down',
  }));
  if (items.length < 12) {
    const valuable = collection.cards
      .filter(passes)
      .map(c => ({ c, v: cardCurrentValue(c) ?? 0 }))
      .filter(x => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 24)
      .map(({ c, v }) => ({
        card: c,
        name: c.name,
        setCode: c.setCode,
        price: v,
        pct: null,
        dir: 'flat',
      }));
    // Merge — dedup by id-ish key
    const seen = new Set(items.map(i => i.name + i.setCode));
    for (const v of valuable) {
      const k = v.name + v.setCode;
      if (!seen.has(k)) { items.push(v); seen.add(k); }
    }
  }

  if (items.length === 0) {
    el.innerHTML = hasFilter
      ? `<div class="ticker-empty">No cards match the ticker filters — adjust them in Settings.</div>`
      : `<div class="ticker-empty">No price data yet — refresh prices to populate the ticker.</div>`;
    el.classList.add('ticker-tape--empty');
    return;
  }
  el.classList.remove('ticker-tape--empty');

  const fmtItem = it => {
    const arrow = it.dir === 'up' ? '▲' : it.dir === 'down' ? '▼' : '·';
    const pctTxt = it.pct != null ? ` ${arrow} ${fmtPct(it.pct)}` : '';
    return `
      <span class="tk-item tk-${it.dir}">
        <span class="tk-name" title="${esc(it.name)}">${esc(it.name)}</span>
        <span class="tk-set">${esc(it.setCode)}</span>
        <span class="tk-price">${fmt(it.price)}</span>
        <span class="tk-chg">${pctTxt}</span>
      </span>`;
  };

  // Scale loop duration with item count so per-item pace stays constant
  // regardless of how many entries the filters leave. speed 4 ≈ 3s per item
  // (matches the old fixed 120s with a full 40-item strip).
  const duration = Math.max(20, Math.round(items.length * 12 / cfg.speed));

  // Duplicate the strip so the CSS marquee can loop seamlessly.
  const strip = items.map(fmtItem).join('');
  el.innerHTML = `
    <div class="ticker-track" style="animation-duration:${duration}s">
      <div class="ticker-strip">${strip}</div>
      <div class="ticker-strip" aria-hidden="true">${strip}</div>
    </div>`;

  // Hovering an entry pauses the marquee (CSS) and shows the card preview;
  // right-click opens the full card context menu.
  el.querySelectorAll('.tk-item').forEach((tk, i) => {
    const card = items[i % items.length].card;
    if (!card) return;
    tk.addEventListener('mouseenter', () => showCardHoverPreview(tk, card));
    tk.addEventListener('mouseleave', () => hideCardHoverPreview());
    tk.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showCardContextMenu(e.clientX, e.clientY, card);
    });
  });
}

