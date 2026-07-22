// Official Secret Lair announcement enrichment from magic.wizards.com.
// The official source is authoritative for article dates, sale windows, bundle
// headings and promotional/WPN notes. Dollar amounts are deliberately ignored:
// an article can describe a superdrop while quoting individual SKU prices.

import { netFetch } from './utils.js';

const ARCHIVE_URL = 'https://magic.wizards.com/en/news/announcements?search=Secret+Lair';
const SETTINGS_KEY = 'sl_announcement_data';
const MAX_RECENT_ANNOUNCEMENTS = 20;

const SERIALIZED_PAGE_DATA = /(?:window\.)?__(?:NUXT|NEXT_DATA)__|webpackChunk|publishedVersion|contentType|\\u00(?:22|2F|3A)/i;

// Wizards pages contain a large serialized application-state object. Older
// builds could cache that object as prose when it mentioned a promotion or WPN.
// Keep cached/displayed strings human-sized and discard unmistakable page data.
const cleanHumanText = (value, maxLength) => {
  if (value == null) return '';
  let clean = String(value).replace(/\s+/g, ' ').trim();
  const leakAt = clean.search(/(?:window\.)?__(?:NUXT|NEXT_DATA)__\s*=/i);
  if (leakAt >= 0) clean = clean.slice(0, leakAt).trim();
  if (!clean || SERIALIZED_PAGE_DATA.test(clean)) return '';
  if (maxLength && clean.length > maxLength) clean = `${clean.slice(0, maxLength).trimEnd()}…`;
  return clean;
};

const cleanHumanList = (values, maxItems, maxLength) => [...new Set((Array.isArray(values) ? values : [])
  .map(value => cleanHumanText(value, maxLength))
  .filter(Boolean))].slice(0, maxItems);

// Remove legacy price fields and parser leaks when loading caches from older
// builds. This keeps existing installs clean before the next network refresh.
export const sanitizeAnnouncementRow = row => {
  const { prices: _legacyPrices, ...clean } = row || {};
  return {
    ...clean,
    title: cleanHumanText(clean.title, 240) || 'Secret Lair announcement',
    summary: cleanHumanText(clean.summary, 700),
    bundles: cleanHumanList(clean.bundles, 20, 240),
    officialNotes: cleanHumanList(clean.officialNotes, 12, 420),
  };
};

const decode = s => String(s || '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'").replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
  .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)));
const visibleHtml = html => String(html || '')
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
const text = html => decode(visibleHtml(html)
  .replace(/<(?:br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const absolute = href => href?.startsWith('http') ? href : `https://magic.wizards.com${href?.startsWith('/') ? '' : '/'}${href || ''}`;

export function parseAnnouncementArchiveHtml(html) {
  const out = [];
  const seen = new Set();
  const blocks = String(html || '').match(/<article\b[\s\S]*?<\/article>/gi) || [String(html || '')];
  for (const block of blocks) {
    const links = [...block.matchAll(/<a\b[^>]*href=["']([^"']*\/en\/news\/announcements\/[^"'#?]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const m of links) {
      const url = absolute(m[1]);
      if (seen.has(url)) continue;
      const title = text(m[2]) || text(block.match(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1]);
      if (!/secret\s+lair/i.test(`${title} ${text(block)}`)) continue;
      const publishedAt = block.match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1] || null;
      const summary = text(block.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] || '').slice(0, 600);
      seen.add(url);
      out.push({ url, title: title || 'Secret Lair announcement', publishedAt, summary });
      break;
    }
  }
  return out;
}

const isoDate = (raw, fallbackYear) => {
  if (!raw) return null;
  const dated = /\b\d{4}\b/.test(raw) || !fallbackYear ? raw : `${raw}, ${fallbackYear}`;
  const d = new Date(dated);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function parseAnnouncementDetailHtml(html, seed = {}) {
  const source = visibleHtml(html);
  const body = text(source);
  const h1 = text(source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const publishedAt = String(html || '').match(/"datePublished"\s*:\s*"([^"]+)"/i)?.[1]
    || String(html || '').match(/<time\b[^>]*datetime=["']([^"']+)/i)?.[1]
    || seed.publishedAt || null;
  const salePhrase = body.match(/(?:available|arrives|launch(?:es)?|on sale|sale begins|goes live|MagicSecretLair\.com)[^\n.]{0,180}?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s+\d{4})?)/i);
  const timeM = body.match(/(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?))\s*(P[DT])/i);
  const bundles = [...source.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?bundle[\s\S]*?)<\/h\1>/gi)]
    .map(m => text(m[2])).filter(Boolean);
  const proseBlocks = [...source.matchAll(/<(p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => text(m[2])).filter(Boolean);
  const noteLines = proseBlocks.filter(line => /while supplies last|promotion|promo card|WPN|game store/i.test(line));
  const firstSummary = proseBlocks.find(line => line.length >= 40 && !noteLines.includes(line));
  return sanitizeAnnouncementRow({
    ...seed,
    title: h1 || seed.title || 'Secret Lair announcement',
    publishedAt,
    saleDate: isoDate(salePhrase?.[1], String(publishedAt || '').slice(0, 4)),
    saleTime: timeM ? `${timeM[1]} ${timeM[2].toUpperCase()}` : null,
    bundles: [...new Set(bundles)].slice(0, 20),
    officialNotes: [...new Set(noteLines)].slice(0, 12),
    summary: seed.summary || firstSummary || body.slice(0, 600),
  });
}

let announcementData = null; // { fetchedAt, rows }

export async function loadSlAnnouncementsFromSettings() {
  try {
    const raw = await window.api?.settings?.get(SETTINGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.rows)) {
        const rows = parsed.rows.map(sanitizeAnnouncementRow);
        const cacheNeededCleanup = JSON.stringify(rows) !== JSON.stringify(parsed.rows);
        announcementData = { ...parsed, rows };
        if (cacheNeededCleanup) await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(announcementData));
      }
    }
  } catch (e) { window.logger?.warn?.('SL', `official-announcement cache load failed: ${e.message}`); }
}

export async function refreshSlAnnouncements(opts = {}) {
  try {
    const resp = await netFetch(ARCHIVE_URL, { headers: { Accept: 'text/html' } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status} from magic.wizards.com`);
    const seeds = parseAnnouncementArchiveHtml(await resp.text());
    if (!seeds.length) throw new Error('no Secret Lair announcement links parsed — archive layout changed?');
    const previousByUrl = new Map((announcementData?.rows || []).map(r => [r.url, sanitizeAnnouncementRow(r)]));
    const rows = await Promise.all(seeds.slice(0, MAX_RECENT_ANNOUNCEMENTS).map(async seed => {
      try {
        const detail = await netFetch(seed.url, { headers: { Accept: 'text/html' } });
        if (!detail.ok) return previousByUrl.get(seed.url) || seed;
        const parsed = parseAnnouncementDetailHtml(await detail.text(), seed);
        const old = previousByUrl.get(seed.url);
        return old ? {
          ...old, ...parsed,
          bundles: parsed.bundles?.length ? parsed.bundles : (old.bundles || []),
          officialNotes: parsed.officialNotes?.length ? parsed.officialNotes : (old.officialNotes || []),
        } : parsed;
      } catch { return previousByUrl.get(seed.url) || seed; }
    }));
    announcementData = { fetchedAt: new Date().toISOString(), rows: rows.map(sanitizeAnnouncementRow) };
    await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(announcementData));
    window.logger?.success?.('SL', `Official announcements sync: ${rows.length} recent Wizards articles`);
    return true;
  } catch (e) {
    if (!opts.silent) window.logger?.warn?.('SL', `Official announcements sync failed (using last good data): ${e.message}`);
    return false;
  }
}

export function slAnnouncements() { return announcementData?.rows || []; }
export function slAnnouncementInfo() {
  return announcementData ? { fetchedAt: announcementData.fetchedAt, count: announcementData.rows.length } : null;
}
