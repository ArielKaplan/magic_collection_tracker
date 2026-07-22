// Upcoming Secret Lair previews.
//
// Wizards announcements know product/drop names and revealed contents, while
// Scryfall knows exact future SLD printing IDs and card images. This module
// joins those two sources without pretending that unrevealed cards exist.

import { slAnnouncements } from './slAnnouncements.js';
import { upcomingSlDrops } from './slWiki.js';
import { netFetch, today } from './utils.js';

const SETTINGS_KEY = 'sl_upcoming_data';
const MAX_PAGES = 5;

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
});

let upcomingData = null; // { fetchedAt, cards }

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
    upcomingData = sanitizeCache({ fetchedAt: new Date().toISOString(), cards });
    await window.api?.settings?.set(SETTINGS_KEY, JSON.stringify(upcomingData));
    window.logger?.success?.('SL', `Upcoming previews: ${upcomingData.cards.length} future Scryfall printings`);
    return true;
  } catch (error) {
    if (!opts.silent) window.logger?.warn?.('SL', `upcoming preview sync failed (using last good data): ${error.message}`);
    return false;
  }
}

const articleGroupName = title => clean(title, 240).replace(/^Secret Lair\s*:\s*/i, '') || 'Upcoming Secret Lair';

export function buildUpcomingLairs(cards, announcements = [], wikiRows = [], asOf = today()) {
  const futureCards = (Array.isArray(cards) ? cards : [])
    .map(compactUpcomingScryfallCard)
    .filter(card => card.id && card.releasedAt > asOf);
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
      const unmatched = [];
      for (const expected of expectedCards) {
        const expectedKey = norm(expected.name);
        const card = futureCards.find(item => item.releasedAt === releaseDate
          && (norm(item.name) === expectedKey || norm(item.flavorName) === expectedKey));
        if (card) matched.push({ ...card, quantity: expected.quantity, displayName: expected.displayName });
        else unmatched.push(expected);
      }

      groups.push({
        drop,
        superdrop: articleGroupName(article.title),
        releaseDate,
        url: clean(article.url, 500),
        summary: clean(article.summary, 700),
        cards: matched,
        expectedCards,
        unmatchedCards: unmatched,
        status: !expectedCards.length ? 'announced' : (matched.length === expectedCards.length ? 'full' : (matched.length ? 'partial' : 'pending')),
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
  return buildUpcomingLairs(upcomingData?.cards || [], slAnnouncements(), upcomingSlDrops(), today());
}

export function slUpcomingCardContext(scryfallId) {
  const id = String(scryfallId || '').toLowerCase();
  for (const group of slUpcomingGroups()) {
    const card = group.cards.find(item => item.id === id);
    if (card) return { ...group, card };
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
  } : null;
}
