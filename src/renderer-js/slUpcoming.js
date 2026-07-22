// Upcoming Secret Lair previews.
//
// Wizards announcements know product/drop names and revealed contents, while
// Scryfall knows exact future SLD printing IDs and card images. This module
// joins those two sources without pretending that unrevealed cards exist.

import { refreshSlAnnouncements, slAnnouncements } from './slAnnouncements.js';
import { upcomingSlDrops } from './slWiki.js';
import { netFetch, today } from './utils.js';

const SETTINGS_KEY = 'sl_upcoming_data';
const MAX_PAGES = 5;
const COLLECTION_BATCH_SIZE = 75;

const clean = (value, max = 300) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
const norm = value => clean(value).toLowerCase()
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u2013\u2014]/g, '-')
  .replace(/\s+tokens?$/i, '')
  .replace(/[^a-z0-9]+/g, '');
const safeImage = value => /^https:\/\/cards\.scryfall\.io\//i.test(value || '') ? String(value) : '';

export function compactUpcomingScryfallCard(card) {
  const face = card?.card_faces?.find(item => item?.image_uris) || card?.card_faces?.[0] || {};
  const images = card?.image_uris || face.image_uris || {};
  return {
    id: clean(card?.id, 60).toLowerCase(),
    name: clean(card?.name, 180),
    flavorName: clean(card?.flavor_name || card?.flavorName || face.flavor_name, 180),
    releasedAt: clean(card?.released_at || card?.releasedAt, 10),
    collectorNumber: clean(card?.collector_number || card?.collectorNumber, 40),
    finishes: Array.isArray(card?.finishes) ? card.finishes.map(value => clean(value, 20)).filter(Boolean) : [],
    typeLine: clean(card?.type_line || card?.typeLine || face.type_line, 180),
    rarity: clean(card?.rarity, 30),
    setCode: clean(card?.set || card?.setCode, 12).toLowerCase(),
    imageUri: safeImage(images.normal || card?.imageUri),
    artCrop: safeImage(images.art_crop || card?.artCrop),
    scryfallUri: /^https:\/\/scryfall\.com\//i.test(card?.scryfall_uri || card?.scryfallUri || '') ? (card.scryfall_uri || card.scryfallUri) : '',
  };
}

const sanitizeCache = value => ({
  fetchedAt: clean(value?.fetchedAt, 40),
  cards: (Array.isArray(value?.cards) ? value.cards : [])
    .map(compactUpcomingScryfallCard)
    .filter(card => card.id && card.name && card.releasedAt),
  references: (Array.isArray(value?.references) ? value.references : [])
    .map(compactUpcomingScryfallCard)
    .filter(card => card.id && card.name && card.releasedAt),
});

let upcomingData = null; // { fetchedAt, cards, references }

export async function loadSlUpcomingFromSettings() {
  try {
    const raw = await window.api?.settings?.get(SETTINGS_KEY);
    if (raw) upcomingData = sanitizeCache(JSON.parse(raw));
  } catch (error) {
    window.logger?.warn?.('SL', `upcoming preview cache load failed: ${error.message}`);
  }
}

export async function refreshSlUpcomingData(opts = {}) {
  try {
    const query = encodeURIComponent(`set:sld date>=${today()}`);
    let url = `https://api.scryfall.com/cards/search?q=${query}&order=released&dir=asc&unique=prints`;
    const cards = [];
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const response = await netFetch(url, { headers: { Accept: 'application/json' } });
      if (response.status === 404 && page === 0) break; // Valid "no future printings" search result.
      if (!response.ok) throw new Error(`HTTP ${response.status} from Scryfall`);
      const json = await response.json();
      cards.push(...(json.data || []).map(compactUpcomingScryfallCard));
      url = json.has_more ? json.next_page : null;
    }
    const announcedNames = [];
    const seenNames = new Set();
    for (const article of slAnnouncements()) {
      if (!article?.saleDate || article.saleDate <= today()) continue;
      for (const drop of (article.revealedDrops || [])) {
        for (const item of (drop.cards || [])) {
          const name = clean(item?.name, 180);
          const key = norm(name);
          if (name && !seenNames.has(key)) {
            seenNames.add(key);
            announcedNames.push(name);
          }
        }
      }
    }

    // Scryfall may not have assigned the future SLD printing yet. Resolve the
    // announced oracle names in bulk so the UI can show a clearly labeled
    // reference printing instead of an empty silhouette in the meantime.
    const references = [];
    for (let i = 0; i < announcedNames.length; i += COLLECTION_BATCH_SIZE) {
      const identifiers = announcedNames.slice(i, i + COLLECTION_BATCH_SIZE).map(name => ({ name }));
      const response = await netFetch('https://api.scryfall.com/cards/collection', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifiers }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} from Scryfall collection lookup`);
      const json = await response.json();
      references.push(...(json.data || []).map(compactUpcomingScryfallCard));
    }

    upcomingData = sanitizeCache({ fetchedAt: new Date().toISOString(), cards, references });
    await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(upcomingData));
    window.logger?.success?.('SL', `Upcoming previews: ${upcomingData.cards.length} future Scryfall printings · ${upcomingData.references.length} named references`);
    return true;
  } catch (error) {
    if (!opts.silent) window.logger?.warn?.('SL', `upcoming preview sync failed (using last good data): ${error.message}`);
    return false;
  }
}

export async function refreshUpcomingSources(opts = {}) {
  const announcementsOk = await refreshSlAnnouncements({ silent: true });
  const previewsOk = await refreshSlUpcomingData({ silent: true });
  if (!opts.silent && (!announcementsOk || !previewsOk)) {
    window.logger?.warn?.('SL', 'Upcoming preview refresh completed with a source unavailable; last-good cache retained where possible');
  }
  return announcementsOk && previewsOk;
}

const articleGroupName = title => clean(title, 240).replace(/^Secret Lair\s*:\s*/i, '') || 'Upcoming Secret Lair';

export function buildUpcomingLairs(cards, announcements = [], wikiRows = [], asOf = today(), referenceCards = []) {
  const futureCards = (Array.isArray(cards) ? cards : [])
    .map(compactUpcomingScryfallCard)
    .filter(card => card.id && card.releasedAt > asOf);
  const references = (Array.isArray(referenceCards) ? referenceCards : [])
    .map(compactUpcomingScryfallCard)
    .filter(card => card.id && card.name);
  const groups = [];
  const seen = new Set();

  for (const article of (Array.isArray(announcements) ? announcements : [])) {
    const releaseDate = clean(article?.saleDate, 10);
    if (!releaseDate || releaseDate <= asOf) continue;
    const announcedDrops = Array.isArray(article?.revealedDrops) ? article.revealedDrops : [];
    const dropRows = announcedDrops.length ? announcedDrops : [{ name: article.title, cards: [] }];
    for (const announced of dropRows) {
      const drop = clean(announced?.name || article.title, 240);
      const key = `${norm(drop)}|${releaseDate}`;
      if (!drop || seen.has(key)) continue;

      const expectedCards = (Array.isArray(announced?.cards) ? announced.cards : []).map(item => ({
        name: clean(item?.name, 180),
        displayName: clean(item?.displayName || item?.name, 220),
        quantity: Math.max(1, Number(item?.quantity) || 1),
      })).filter(item => item.name);
      const matched = [];
      const referenceMatches = [];
      const unmatched = [];
      for (const expected of expectedCards) {
        const expectedKey = norm(expected.name);
        const card = futureCards.find(item => item.releasedAt === releaseDate
          && (norm(item.name) === expectedKey || norm(item.flavorName) === expectedKey))
          || references.find(item => item.releasedAt === releaseDate && item.setCode === 'sld'
            && (norm(item.name) === expectedKey || norm(item.flavorName) === expectedKey));
        if (card) matched.push({ ...card, quantity: expected.quantity, displayName: expected.displayName });
        else {
          const reference = references.find(item => norm(item.name) === expectedKey || norm(item.flavorName) === expectedKey);
          if (reference) referenceMatches.push({ ...reference, quantity: expected.quantity, displayName: expected.displayName });
          else unmatched.push(expected);
        }
      }

      const coveredCount = matched.length + referenceMatches.length;

      groups.push({
        drop,
        superdrop: articleGroupName(article.title),
        releaseDate,
        url: clean(article.url, 500),
        summary: clean(article.summary, 700),
        cards: matched,
        referenceCards: referenceMatches,
        expectedCards,
        unmatchedCards: unmatched,
        status: !expectedCards.length ? 'announced'
          : (matched.length === expectedCards.length ? 'full'
            : (coveredCount === expectedCards.length && !matched.length ? 'outlined'
              : (coveredCount ? 'partial' : 'pending'))),
        source: 'Wizards + Scryfall',
      });
      seen.add(key);
    }
  }

  for (const row of (Array.isArray(wikiRows) ? wikiRows : [])) {
    const releaseDate = clean(row?.date, 10);
    const drop = clean(row?.drop, 240);
    const key = `${norm(drop)}|${releaseDate}`;
    if (!drop || !releaseDate || releaseDate <= asOf || seen.has(key)) continue;
    groups.push({
      drop,
      superdrop: clean(row.superdrop, 240) || 'Standalone',
      releaseDate,
      url: '',
      summary: '',
      cards: [],
      referenceCards: [],
      expectedCards: [],
      unmatchedCards: [],
      status: 'announced',
      source: 'mtg.wiki',
    });
    seen.add(key);
  }

  return groups.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.drop.localeCompare(b.drop));
}

export function slUpcomingGroups() {
  return buildUpcomingLairs(upcomingData?.cards || [], slAnnouncements(), upcomingSlDrops(), today(), upcomingData?.references || []);
}

export function slUpcomingCardContext(scryfallId) {
  const id = String(scryfallId || '').toLowerCase();
  for (const group of slUpcomingGroups()) {
    const card = group.cards.find(item => item.id === id);
    if (card) return { ...group, card, matchType: 'exact' };
    const reference = group.referenceCards.find(item => item.id === id);
    if (reference) return { ...group, card: reference, matchType: 'reference' };
  }
  return null;
}

export function slUpcomingInfo() {
  const groups = slUpcomingGroups();
  return upcomingData ? {
    fetchedAt: upcomingData.fetchedAt,
    printingCount: upcomingData.cards.length,
    groupCount: groups.length,
    matchedCount: groups.reduce((sum, group) => sum + group.cards.length, 0),
    referenceCount: groups.reduce((sum, group) => sum + group.referenceCards.length, 0),
  } : null;
}
