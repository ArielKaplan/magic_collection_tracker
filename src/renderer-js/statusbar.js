import { totalCardsValue, totalSealedValue } from './analytics.js';
import { hideModal, showModal } from './modals.js';
import { sparkline } from './prices.js';
import { render } from './render.js';
import { collection, ui } from './state.js';
import { esc, fmt, toast, today } from './utils.js';


// ── Status bar (bottom of window) ───────────────────────────────────────────
export function updateStatusBar() {
  const cardCountEl = document.getElementById('sb-cards');
  const valueEl     = document.getElementById('sb-value');
  const refreshEl   = document.getElementById('sb-refresh');
  const issuesEl    = document.getElementById('sb-issues');
  if (!cardCountEl) return; // status bar not in DOM (shouldn't happen)

  const owned        = collection.cards.filter(c => c.status !== 'sold');
  const totalCards   = owned.reduce((s, c) => s + (c.quantity || 1), 0);
  const totalValue   = (totalCardsValue() ?? 0) + (totalSealedValue() ?? 0);
  cardCountEl.textContent = `${totalCards.toLocaleString()} cards · ${owned.length.toLocaleString()} entries`;
  valueEl.textContent     = fmt(totalValue);

  if (ui.refreshing) {
    refreshEl.textContent = `↻ Refreshing prices… ${ui.refreshProgress}%`;
    refreshEl.style.color = 'var(--text-dim)';
  } else {
    refreshEl.style.color = '';
    if (collection.lastPriceRefresh) {
      const d = new Date(collection.lastPriceRefresh);
      const now = Date.now();
      const ageMin = Math.floor((now - d.getTime()) / 60000);
      let agoStr;
      if (ageMin < 1)        agoStr = 'just now';
      else if (ageMin < 60)  agoStr = `${ageMin}m ago`;
      else if (ageMin < 1440) agoStr = `${Math.floor(ageMin/60)}h ago`;
      else                   agoStr = `${Math.floor(ageMin/1440)}d ago`;
      refreshEl.textContent = `Last refresh: ${agoStr}`;
      refreshEl.title = d.toLocaleString();
    } else {
      refreshEl.textContent = 'Never refreshed';
      refreshEl.title = '';
    }
  }

  const failCount = (collection.failedLookups || []).length;
  if (failCount > 0) {
    issuesEl.style.display = '';
    issuesEl.className = 'sb-section sb-issues-warn';
    issuesEl.textContent = `⚠ ${failCount} issue${failCount !== 1 ? 's' : ''}`;
    issuesEl.onclick = () => { ui.activeTab = 'failures'; document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'failures')); render(); };
  } else {
    issuesEl.style.display = 'none';
  }
}

export function showAbout() {
  const termStyle = 'font-weight:600;color:var(--text);white-space:nowrap';
  const defStyle  = 'color:var(--text-dim);font-size:12px;line-height:1.55';
  showModal(`
    <h2 style="margin-bottom:4px">Mana Ledger</h2>
    <p style="color:var(--text-dim);font-size:13px;margin:4px 0 14px">Desktop edition · Electron + SQLite · a Sarcastic Software Studios production</p>

    <div style="display:grid;grid-template-columns:auto 1fr;gap:5px 16px;font-size:13px;line-height:1.7;margin-bottom:18px">
      <span style="color:var(--text-muted)">Version</span><span id="about-version">…</span>
      <span style="color:var(--text-muted)">Cards</span><span>${collection.cards.length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Sealed</span><span>${(collection.sealed || []).length.toLocaleString()}</span>
      <span style="color:var(--text-muted)">Last refresh</span><span>${collection.lastPriceRefresh ? new Date(collection.lastPriceRefresh).toLocaleString() : 'Never'}</span>
    </div>

    <h3 style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:0 0 10px">Price Column Glossary</h3>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin-bottom:18px">
      <span style="${termStyle}">Low (SCR)</span>
      <span style="${defStyle}">The cheapest active listing on TCGPlayer right now, as reported by Scryfall. This is what you could theoretically buy the card for today — but it may be a single heavily-played copy or an outlier listing.</span>

      <span style="${termStyle}">Mkt (TCG)</span>
      <span style="${defStyle}">TCGPlayer's market price — a weighted average of what the card has actually sold for recently. This is the most realistic indicator of a card's true value and what most other trackers use.</span>

      <span style="${termStyle}">Cost (basis)</span>
      <span style="${defStyle}">What you paid (or what the card was worth when you acquired it). ManaBox records the TCGPlayer price automatically when you add a card, so this is a historical snapshot — not necessarily your literal out-of-pocket cost.</span>

      <span style="${termStyle}">Δ Price</span>
      <span style="${defStyle}">Percentage change between the two most recent price snapshots for that card. Requires at least two refresh dates to show movement.</span>

      <span style="${termStyle}">Trend</span>
      <span style="${defStyle}">A sparkline chart of the card's low price over all recorded refresh dates. Rising line = price going up; falling line = price going down.</span>
    </div>

    <h3 style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted);margin:0 0 10px">Dashboard Terms</h3>
    <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 14px;margin-bottom:18px">
      <span style="${termStyle}">Total Value</span>
      <span style="${defStyle}">Cards value + sealed value combined. Uses Scryfall low price for cards and TCGPlayer market price for sealed products.</span>

      <span style="${termStyle}">Cost Basis</span>
      <span style="${defStyle}">The sum of all purchase prices across your collection. Compare this to Total Value to see your overall gain or loss.</span>

      <span style="${termStyle}">Gain / Loss</span>
      <span style="${defStyle}">Total Value minus Cost Basis. A positive number means your collection is worth more than you paid; negative means it's worth less. Shown as both a dollar amount and a percentage.</span>

      <span style="${termStyle}">Top Movers</span>
      <span style="${defStyle}">Cards with the largest price change (up or down) since the previous refresh. Useful for spotting spikes from new set releases, bans, or tournament results.</span>
    </div>

    <p style="font-size:11px;color:var(--text-muted);line-height:1.5;margin-bottom:16px">
      Low prices via <a href="#" data-act="open-url" data-arg="https://scryfall.com">Scryfall</a> ·
      Market prices via <a href="#" data-act="open-url" data-arg="https://tcgcsv.com">TCGCSV</a> ·
      SL drop data via <a href="#" data-act="open-url" data-arg="https://mtgjson.com">MTGJSON</a> ·
      Sealed prices via TCGCSV and PriceCharting (optional key in Settings).
    </p>
    <p style="font-size:10.5px;color:var(--text-muted);line-height:1.5;margin-bottom:14px">
      Mana Ledger is unofficial Fan Content permitted under the Wizards of the Coast Fan Content
      Policy. Not approved or endorsed by Wizards. Portions of the materials used are property of
      Wizards of the Coast. © Wizards of the Coast LLC.
    </p>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
      <button class="btn" data-act="open-url" data-arg="https://ko-fi.com/sarcasticsoftware"
              title="Mana Ledger is free — donations keep it that way">♥ Support Mana Ledger</button>
      <button class="btn btn-primary" data-act="hideModal">Close</button>
    </div>`);
  // Fill the real installed version (was a hardcoded, permanently stale string).
  window.api?.app?.version?.().then(v => {
    const el = document.getElementById('about-version');
    if (el && v) el.textContent = `v${v}`;
  }).catch(() => {});
}

// ── Feedback (Help → Send Feedback, Settings → Support) ─────────────────────
// No server, no telemetry — feedback goes out through the user's own email
// app via a mailto: link (main process allows mailto: only to this address).
const FEEDBACK_EMAIL = 'sarcasticsoftwarestudio@gmail.com';

export function showFeedback() {
  showModal(`
    <h2>Send Feedback</h2>
    <p style="color:var(--text-dim);font-size:13px;line-height:1.6;margin:6px 0 14px">
      Found a bug? Want a feature? Write it below and hit the button — it opens your
      email app with the message addressed to <strong>${esc(FEEDBACK_EMAIL)}</strong>.
      Nothing is sent in the background, and your collection data is never included.
    </p>
    <div class="form-group">
      <label>Message</label>
      <textarea id="feedback-text" rows="6" placeholder="What's working? What's broken? What's missing?"
                style="width:100%;resize:vertical"></textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;flex-wrap:wrap">
      <button class="btn" data-act="copyFeedbackAddress" title="If the email button doesn't work, copy the address and use any mail app">⧉ Copy address</button>
      <button class="btn btn-primary" data-act="sendFeedbackEmail">✉ Open in Email App</button>
      <button class="btn btn-ghost" data-act="hideModal">Close</button>
    </div>`);
}

export async function sendFeedbackEmail() {
  const txt = document.getElementById('feedback-text')?.value?.trim() || '';
  let ver = '';
  try { ver = await window.api.app.version(); } catch {}
  const subject = encodeURIComponent(`Mana Ledger${ver ? ' v' + ver : ''} — feedback`);
  const body = encodeURIComponent(`${txt}\n\n—\nMana Ledger${ver ? ' v' + ver : ''} · Windows`);
  window.api.app.openExternal(`mailto:${FEEDBACK_EMAIL}?subject=${subject}&body=${body}`);
}

export function copyFeedbackAddress() {
  navigator.clipboard?.writeText(FEEDBACK_EMAIL)
    .then(() => toast('Email address copied', 'success'))
    .catch(() => toast(FEEDBACK_EMAIL, 'info', 8000));
}

