// User-facing Secret Lair data guide (Help -> Secret Lair Data Guide).
// Keep this aligned with the repository's final data-model document.

import { showModal } from './modals.js';
import { getSlProducts } from './slData.js';
import { slAnnouncementInfo } from './slAnnouncements.js';
import { slBonusInfo } from './slBonus.js';
import { slWikiInfo } from './slWiki.js';
import { tcgcsvCache } from './state.js';
import { esc } from './utils.js';

const when = value => value ? new Date(value).toLocaleString() : 'Not cached yet';
const row = (source, role, data, cadence) => `
  <tr>
    <td style="padding:9px 10px;vertical-align:top;font-weight:650;color:var(--text)">${source}</td>
    <td style="padding:9px 10px;vertical-align:top;color:var(--text-dim)">${role}</td>
    <td style="padding:9px 10px;vertical-align:top;color:var(--text-dim)">${data}</td>
    <td style="padding:9px 10px;vertical-align:top;color:var(--text-muted);white-space:nowrap">${cadence}</td>
  </tr>`;

export function showSlDataGuide() {
  const products = getSlProducts();
  const wiki = slWikiInfo();
  const bonus = slBonusInfo();
  const official = slAnnouncementInfo();
  const ids = new Set();
  for (const p of products) for (const key of Object.keys(p.identifiers || {})) ids.add(key);

  showModal(`
    <div style="max-width:920px">
      <h2 style="margin:0 0 5px">Secret Lair Data Guide</h2>
      <p style="color:var(--text-dim);font-size:13px;line-height:1.55;margin:0 0 16px">
        Mana Ledger reconciles several specialist sources because no single catalog contains exact products,
        printings, finishes, pricing, launch details, and randomized bonus cards. The product model is the core;
        every other feed enriches it and can fail independently without erasing the last known good data.
      </p>

      <h3 style="font-size:13px;margin:18px 0 8px">What comes from each source</h3>
      <div style="overflow:auto;border:1px solid var(--border);border-radius:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="background:var(--surface2);text-align:left">
            <th style="padding:8px 10px">Source</th><th style="padding:8px 10px">Job</th><th style="padding:8px 10px">Fields we use</th><th style="padding:8px 10px">Refresh</th>
          </tr></thead>
          <tbody>
            ${row('MTGJSON SLD', 'Product and contents backbone', 'Sealed SKU UUID/name/subtype/release date; all marketplace identifiers; sealedProduct → deck → exact MTGJSON card UUID/Scryfall ID/count/finish; subsets as coverage fallback.', 'Daily / manual')}
            ${row('Scryfall', 'Printing metadata and card prices', 'Exact printing, set and collector number; finish availability; USD/USD foil/USD etched and EUR prices; art, artist, promo/frame/full-art metadata; images and oracle data.', 'Bulk daily')}
            ${row('TCGCSV / TCGplayer', 'Sealed market pricing', 'Exact tcgplayerProductId join; market, low, mid, high, direct-low and subtype; product/group names, URL/image, presale and modification metadata.', 'Daily cache')}
            ${row('mtg.wiki Drop Series', 'Curated release structure', 'Superdrop grouping, release date, nonfoil MSRP, foil MSRP, and announced-but-unreleased rows.', 'With SL sync')}
            ${row('mtg.wiki Bonus Cards', 'Supplemental insert catalog', 'SLD collector number, type, card, variant, explicit drop exclusivity, notes and chase/random signals. Bonus rows never count as guaranteed contents.', 'With SL sync')}
            ${row('Wizards announcements', 'Official launch context', 'Recent official article, publication date, sale date/time, stated USD prices, bundle headings, promotion and WPN/store notes.', 'With SL sync')}
            ${row('PriceCharting (optional)', 'Second sealed estimate', 'Current new/sealed or loose value returned for a user-selected product. Requires the user’s paid API token; it is not historical data.', 'On demand')}
            ${row('Local SQLite', 'Ownership and history', 'Collection copies, product links, cost basis, daily price snapshots, user grouping/note overrides, and every last-known-good source cache.', 'Continuous')}
          </tbody>
        </table>
      </div>

      <h3 style="font-size:13px;margin:18px 0 8px">How the model works</h3>
      <ol style="font-size:12.5px;color:var(--text-dim);line-height:1.65;padding-left:20px;margin:0 0 14px">
        <li><strong style="color:var(--text)">One row per purchasable SKU.</strong> Nonfoil, foil, rainbow foil, etched, and Commander products remain separate even when they share a base drop name.</li>
        <li><strong style="color:var(--text)">Relational contents.</strong> MTGJSON product deck references resolve to exact card UUIDs, then Scryfall printing IDs. Per-entry <code>isFoil</code> plus printing finishes determines the required finish and quantity.</li>
        <li><strong style="color:var(--text)">Exact ownership.</strong> A nonfoil copy cannot complete a foil SKU. P&amp;L and missing-card checks use Scryfall ID + finish, not card-name guesses.</li>
        <li><strong style="color:var(--text)">Confidence is explicit.</strong> A product synthesized from subset tags is marked low-confidence. Collector-number sibling backfill repairs known orphan foil printings without rewriting the source.</li>
        <li><strong style="color:var(--text)">Enrichment stays separate.</strong> MSRP, official launch notes, bonus inserts and prices decorate products; they never silently mutate guaranteed contents.</li>
      </ol>

      <div style="padding:10px 12px;border-left:3px solid var(--accent2);background:var(--surface);border-radius:6px;font-size:12px;color:var(--text-dim);line-height:1.55">
        <strong style="color:var(--text)">Pricing meaning:</strong> card values are printing-and-finish specific. Sealed TCGCSV market is the primary product estimate;
        low/mid/high/direct-low are retained for context. Prices are estimates, not guaranteed sale proceeds, and exclude condition, fees, shipping and tax unless you record them locally.
      </div>

      <h3 style="font-size:13px;margin:18px 0 8px">Source health on this computer</h3>
      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;font-size:12px;color:var(--text-dim)">
        <div style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">Product model</strong><br>${products.length.toLocaleString()} SKUs · IDs: ${esc([...ids].sort().join(', ') || 'none cached')}</div>
        <div style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">Drop Series wiki</strong><br>${wiki?.count?.toLocaleString() || 0} rows · ${esc(when(wiki?.fetchedAt))}</div>
        <div style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">Bonus catalog</strong><br>${bonus?.count?.toLocaleString() || 0} rows · ${esc(when(bonus?.fetchedAt))}</div>
        <div style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">Official articles</strong><br>${official?.count?.toLocaleString() || 0} rows · ${esc(when(official?.fetchedAt))}</div>
        <div style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">TCGCSV products</strong><br>${tcgcsvCache.sealedProducts.length.toLocaleString()} rows · ${esc(when(tcgcsvCache.lastRefresh))}</div>
        <div id="sl-help-scryfall-health" style="padding:9px 11px;background:var(--surface);border-radius:7px"><strong style="color:var(--text)">Scryfall bulk index</strong><br>Checking local index…</div>
      </div>

      <h3 style="font-size:13px;margin:18px 0 8px">Limits and safeguards</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.6;margin:0 0 14px">
        Source names can disagree, prices can be missing, announcement HTML can change, and randomized bonus odds are often unpublished.
        Mana Ledger therefore prefers stable IDs over names, records low-confidence fallbacks, validates live parses, and keeps each last-known-good cache.
        User corrections and notes stay local and are applied after sourced grouping.
      </p>

      <p style="font-size:11px;color:var(--text-muted);line-height:1.5;margin:0 0 16px">
        Mana Ledger is unofficial Fan Content. Source links:
        <a href="#" data-act="open-url" data-arg="https://mtgjson.com">MTGJSON</a> ·
        <a href="#" data-act="open-url" data-arg="https://scryfall.com/docs/api">Scryfall</a> ·
        <a href="#" data-act="open-url" data-arg="https://tcgcsv.com">TCGCSV</a> ·
        <a href="#" data-act="open-url" data-arg="https://mtg.wiki/page/Secret_Lair/Drop_Series">mtg.wiki</a> ·
        <a href="#" data-act="open-url" data-arg="https://magic.wizards.com/en/news/announcements?search=Secret+Lair">Wizards</a>.
      </p>
      <div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" data-act="hideModal">Close</button></div>
    </div>`, 'xl');
  window.api?.bulk?.status?.().then(status => {
    const el = document.getElementById('sl-help-scryfall-health');
    if (!el) return;
    el.innerHTML = `<strong style="color:var(--text)">Scryfall bulk index</strong><br>${Number(status?.count || 0).toLocaleString()} printings · ${esc(when(status?.fetchedAt))}`;
  }).catch(() => {});
}
