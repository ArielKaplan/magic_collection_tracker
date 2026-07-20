// slData.js — the finish-aware relational Secret Lair model.
//
// MTGJSON already models Secret Lair relationally: every purchasable SKU is a
// `sealedProduct` whose `contents.deck` points at a deck whose entries carry a
// per-card `isFoil` flag and resolve (uuid → scryfallId) to exact printings.
// That covers BOTH foil regimes:
//   Regime A — separate foil printings ("1311★", finishes:["foil"], own
//              scryfall id): the "… Foil Edition" deck references the ★ ids.
//   Regime B — shared printing (finishes:["foil","nonfoil"]): the foil deck
//              references the same uuids with isFoil:true.
// buildSlModel() walks that chain instead of regex-parsing product names, so
// "which printings, in which finish, belong to which SKU" is data, not string
// luck. The legacy name-keyed globals (SL_DROP_CARDS & co.) are *projected*
// from this model — every existing render path keeps working — while new
// finish-aware consumers (ownership, P&L attribution, drop pricing) query the
// registry at the bottom of this file.
//
// This module is deliberately dependency-free and window-free in its pure
// parts so Node smoke tests can import and exercise the real builder
// (scripts/smoke-sldata.js) against a cached SLD.json fixture.

// ── shared helpers ───────────────────────────────────────────────────────────

// Collection `foil` field ('normal'|'foil'|'etched') → model finish vocabulary.
export function finishGroup(foil) {
  if (foil === 'foil') return 'foil';
  if (foil === 'etched') return 'etched';
  return 'nonfoil';
}

// Punctuation-insensitive key — product names strip punctuation ("Iron Maiden
// Album Art") while subsets keep it ("Iron Maiden: Album Art"), and spell
// "&" out as "and" ("Goblin and Squabblin" vs "Goblin & Squabblin'"), so the
// word "and" is treated as noise too.
const norm = s => (s || '').toLowerCase().replace(/\band\b/g, '').replace(/[^a-z0-9]+/g, '');

// Strip sealed-product boilerplate down to the drop-ish name.
const cleanProductName = n => (n || '')
  .replace(/^\s*secret lair (?:drop|commander deck)\s+/i, '')
  .replace(/\bsecret lair x\s+/i, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

// Trailing finish phrase ("… Rainbow Foil", "… Foil", "… Etched Foil"). The
// adjective list matches known Scryfall promo finishes; a bare trailing "Foil"
// is caught by the optional group, so unknown future adjectives still split
// (they just land in the base-name retry below).
const FINISH_TAIL = /\s+((?:rainbow|confetti|galaxy|raised|etched|gilded|textured|surge|traditional|neon|halo|dazzle|prismatic|fracture)\s+)?foil(?:\s+edition)?$/i;

// A deck-entry's concrete finish, honoring the entry's isFoil flag against the
// printing's actual finish capabilities.
function entryFinish(isFoil, finishes) {
  const f = finishes || [];
  if (isFoil) {
    if (f.includes('foil')) return 'foil';
    if (f.includes('etched')) return 'etched';
    return 'foil';                    // trust the flag even on patchy data
  }
  if (f.includes('nonfoil')) return 'nonfoil';
  // Non-foil entry on a foil-only printing (foil-only drops): native finish.
  if (f.includes('foil')) return 'foil';
  if (f.includes('etched')) return 'etched';
  return 'nonfoil';
}

// A printing's "native" finish — what owning a copy of it most likely means.
function nativeFinish(finishes) {
  const f = finishes || [];
  if (f.includes('nonfoil')) return 'nonfoil';
  if (f.includes('foil')) return 'foil';
  if (f.includes('etched')) return 'etched';
  return 'nonfoil';
}

const mode = arr => {
  const m = {}; let best = null, bc = 0;
  for (const x of arr) { if (!x) continue; m[x] = (m[x] || 0) + 1; if (m[x] > bc) { bc = m[x]; best = x; } }
  return best;
};

// ── the model builder (pure) ─────────────────────────────────────────────────
//
// buildSlModel(json, { knownDrops }) → {
//   products: [{ uuid, name, subtype, identifiers, dropName, legacyDrop,
//                finishLabel, finish, tcgplayerProductId, releaseDate,
//                lowConfidence, cards: [{ mtgjsonUuid, identifiers,
//                scryfallId, name, number, finish, count }] }],
//   scryfallToName: { sid → name },
// }
// `knownDrops` (optional array of names, e.g. the baked drop list) only helps
// restore canonical punctuation for products whose base drop MTGJSON's
// subsets don't cover — it never adds cards.
export function buildSlModel(json, opts = {}) {
  const data = json && json.data ? json.data : {};
  const cards = Array.isArray(data.cards) ? data.cards : [];
  const tokens = Array.isArray(data.tokens) ? data.tokens : [];
  const decks = Array.isArray(data.decks) ? data.decks : [];
  const sealed = Array.isArray(data.sealedProduct) ? data.sealedProduct : [];

  // Printing indexes
  const uuidToCard = new Map();
  const scryfallToName = {};
  for (const c of [...cards, ...tokens]) {
    const sid = (c.identifiers && c.identifiers.scryfallId || '').toLowerCase();
    if (!sid) continue;
    if (c.name) scryfallToName[sid] = c.name;
    if (c.uuid) uuidToCard.set(c.uuid, {
      uuid: c.uuid, sid, name: c.name, number: c.number || '', finishes: c.finishes || [],
      subsets: c.subsets || [], identifiers: { ...(c.identifiers || {}) },
    });
  }

  // Canonical drop spellings: MTGJSON subsets first, then any caller-known names.
  const canonical = new Map();
  for (const c of cards) for (const s of (c.subsets || [])) if (!canonical.has(norm(s))) canonical.set(norm(s), s);
  for (const d of (opts.knownDrops || [])) if (!canonical.has(norm(d))) canonical.set(norm(d), d);

  const deckByName = new Map(decks.map(d => [d.name, d]));

  const products = [];
  const byLegacy = new Map();            // legacyDrop lower → product (dedup)
  const membership = new Map();          // sid → Set(product)

  const addCard = (product, sid, name, number, finish, count, mtgjsonUuid = null, identifiers = {}) => {
    let row = product.cards.find(x => x.scryfallId === sid && x.finish === finish);
    if (row) { row.count += count || 1; return; }
    product.cards.push({ mtgjsonUuid, identifiers: { ...identifiers }, scryfallId: sid, name, number, finish, count: count || 1 });
    if (!membership.has(sid)) membership.set(sid, new Set());
    membership.get(sid).add(product);
  };

  // Split "<base> <finish phrase>" with a canonical-prefix retry so unknown
  // finish adjectives ("X Sparkle Foil") still find their base drop.
  const splitFinish = (cleaned) => {
    const fm = cleaned.match(FINISH_TAIL);
    if (!fm) return { baseName: cleaned, finishLabel: '' };
    let baseName = cleaned.slice(0, fm.index).trim();
    let finishLabel = cleaned.slice(fm.index).trim().replace(/\s+edition$/i, '');
    if (!canonical.has(norm(baseName))) {
      const words = baseName.split(/\s+/);
      for (let take = 1; take <= 2 && words.length - take >= 1; take++) {
        const candidate = words.slice(0, words.length - take).join(' ');
        if (canonical.has(norm(candidate))) {
          finishLabel = `${words.slice(words.length - take).join(' ')} ${finishLabel}`;
          baseName = candidate;
          break;
        }
      }
    }
    return { baseName, finishLabel };
  };

  // ── Pass P: one product per secret_lair SKU, cards from deck contents ─────
  // subtype 'commander' = the Secret Lair Commander decks (Goblin Storm, Heads
  // I Win…, From Cute to Brute, …) — full ~100-card decks whose cards mostly
  // carry no subsets, so skipping them left those drops nearly empty.
  for (const p of sealed) {
    if (p.subtype !== 'secret_lair' && p.subtype !== 'commander') continue;
    // A few multi-drop bundles are mislabeled subtype 'secret_lair' — they're
    // packaging, not drops, and have no deck contents (empty-drop clutter).
    if (/^\s*secret lair bundle\b/i.test(p.name || '')) continue;
    const cleaned = cleanProductName(p.name);
    if (!cleaned) continue;
    let { baseName, finishLabel } = splitFinish(cleaned);
    let canon = canonical.get(norm(baseName));
    // The referenced deck's name carries canonical punctuation ("Goblin &
    // Squabblin' Foil Edition") where the product name doesn't — prefer its
    // base spelling when the product name fails to resolve. The product
    // name's finish label stays (it's the descriptive one: "Rainbow Foil").
    if (!canon && p.contents && p.contents.deck && p.contents.deck.length) {
      const fromDeck = splitFinish(p.contents.deck[0].name || '');
      const deckCanon = canonical.get(norm(fromDeck.baseName));
      if (deckCanon) {
        canon = deckCanon;
        if (!finishLabel && fromDeck.finishLabel) finishLabel = fromDeck.finishLabel;
      }
    }
    const dropName = canon || baseName;
    const legacyDrop = finishLabel ? `${dropName} ${finishLabel}` : dropName;
    const lk = legacyDrop.toLowerCase();
    if (byLegacy.has(lk)) continue;                    // duplicate SKU listing

    const product = {
      uuid: p.uuid || `product:${lk}`,
      name: p.name || legacyDrop,
      subtype: p.subtype || 'secret_lair',
      // Preserve every marketplace identifier MTGJSON knows. TCGplayer is the
      // primary exact join today, while Card Kingdom/Cardmarket/CardTrader/etc.
      // remain available to future price adapters without another data rebuild.
      identifiers: { ...(p.identifiers || {}) },
      dropName, legacyDrop, finishLabel,
      finish: /etched/i.test(finishLabel) ? 'etched' : (finishLabel ? 'foil' : 'nonfoil'),
      tcgplayerProductId: (p.identifiers && p.identifiers.tcgplayerProductId) || null,
      releaseDate: p.releaseDate || null,
      lowConfidence: false,
      cards: [],
    };
    byLegacy.set(lk, product);
    products.push(product);

    for (const dref of (p.contents && p.contents.deck || [])) {
      const dk = deckByName.get(dref.name);
      if (!dk) continue;
      const entries = [...(dk.mainBoard || []), ...(dk.commander || []), ...(dk.sideBoard || []), ...(dk.tokens || [])];
      for (const e of entries) {
        const info = uuidToCard.get(e.uuid);
        if (!info) continue;
        addCard(product, info.sid, info.name, info.number, entryFinish(!!e.isFoil, info.finishes), e.count, info.uuid, info.identifiers);
      }
    }
    // Explicit card contents (bonus cards on a handful of products)
    for (const ce of (p.contents && p.contents.card || [])) {
      const info = ce.uuid ? uuidToCard.get(ce.uuid) : null;
      if (!info) continue;
      addCard(product, info.sid, info.name, info.number, entryFinish(!!ce.foil, info.finishes), 1, info.uuid, info.identifiers);
    }
    // Let real contents refine the label-derived finish (foil-only base SKUs
    // like Eldraine Wonderland come out 'foil' here even with no label).
    const m = mode(product.cards.map(c => c.finish));
    if (m) product.finish = m;
    if (!product.cards.length) product.lowConfidence = true;
  }

  // ── Pass S: subsets coverage — every subset-tagged printing belongs to its
  // base product (creates a lowConfidence product for drops with no SKU). ────
  const baseProductFor = (dropName) => {
    const lk = dropName.toLowerCase();
    let product = byLegacy.get(lk);
    if (!product) {
      product = {
        uuid: `synthetic:${norm(dropName)}`,
        name: dropName, subtype: 'synthetic', identifiers: {},
        dropName, legacyDrop: dropName, finishLabel: '',
        finish: 'nonfoil', tcgplayerProductId: null, releaseDate: null,
        lowConfidence: true, cards: [],
      };
      byLegacy.set(lk, product);
      products.push(product);
    }
    return product;
  };
  for (const c of cards) {
    const sid = (c.identifiers && c.identifiers.scryfallId || '').toLowerCase();
    if (!sid || !(c.subsets || []).length) continue;
    for (const s of c.subsets) {
      const dropName = canonical.get(norm(s)) || s;
      const product = baseProductFor(dropName);
      if (!product.cards.some(x => x.scryfallId === sid)) {
        addCard(product, sid, c.name, c.number || '', nativeFinish(c.finishes), 1, c.uuid || null, c.identifiers || {});
      }
    }
  }
  // Recompute finish on products that gained subset cards with no deck data.
  for (const p of products) {
    if (!p.finishLabel && p.cards.length) {
      const m = mode(p.cards.map(c => c.finish));
      if (m) p.finish = m;
    }
  }

  // ── Pass B: collector-number backfill for orphans (★ foils MTGJSON forgot
  // to tag anywhere). Prefer a same-drop product matching the orphan's native
  // finish; otherwise ride along in the sibling's base product — the finish
  // recorded per card keeps ownership honest either way. ────────────────────
  const baseKey = c => `${(c.number || '').replace(/[★*]/g, '').trim()}|${c.name}`;
  const siblingProducts = new Map();     // baseKey → Set(product)
  for (const c of cards) {
    const sid = (c.identifiers && c.identifiers.scryfallId || '').toLowerCase();
    if (!sid || !membership.has(sid)) continue;
    const k = baseKey(c);
    if (!siblingProducts.has(k)) siblingProducts.set(k, new Set());
    for (const p of membership.get(sid)) siblingProducts.get(k).add(p);
  }
  for (const c of cards) {
    const sid = (c.identifiers && c.identifiers.scryfallId || '').toLowerCase();
    if (!sid || membership.has(sid)) continue;
    const sibs = siblingProducts.get(baseKey(c));
    if (!sibs || !sibs.size) continue;
    const fin = nativeFinish(c.finishes);
    const drops = new Set([...sibs].map(p => p.dropName));
    for (const dropName of drops) {
      const candidates = [...sibs].filter(p => p.dropName === dropName);
      const target = candidates.find(p => p.finish === fin) || candidates.find(p => !p.finishLabel) || candidates[0];
      if (target && !target.cards.some(x => x.scryfallId === sid)) {
        addCard(target, sid, c.name, c.number || '', fin, 1, c.uuid || null, c.identifiers || {});
      }
    }
  }

  return { products, scryfallToName };
}

// ── legacy projection (pure) ─────────────────────────────────────────────────
// The name-keyed maps the whole renderer already consumes. drops[0] is treated
// as a card's primary drop downstream, so order each printing's drops with the
// finish-matching product first (a ★ foil's primary drop is the Foil Edition,
// a shared printing's primary drop is the base).
export function projectLegacy(model) {
  const dropCards = {};
  const scryfallToDrops = {};
  const perSid = new Map();              // sid → [{legacyDrop, finish, base}]

  for (const p of model.products) {
    if (!dropCards[p.legacyDrop]) dropCards[p.legacyDrop] = [];
    for (const c of p.cards) {
      if (!dropCards[p.legacyDrop].includes(c.name)) dropCards[p.legacyDrop].push(c.name);
      if (!perSid.has(c.scryfallId)) perSid.set(c.scryfallId, []);
      perSid.get(c.scryfallId).push({ legacyDrop: p.legacyDrop, finish: c.finish, base: !p.finishLabel });
    }
  }
  for (const [sid, rows] of perSid) {
    // Stable order: base products first, then finish variants — but a printing
    // that only exists in one finish leads with the product that matches it.
    rows.sort((a, b) => (b.base - a.base));
    scryfallToDrops[sid] = [...new Set(rows.map(r => r.legacyDrop))];
  }
  return { dropCards, scryfallToDrops, scryfallToName: model.scryfallToName };
}

// ── runtime registry (renderer state; harmless under Node) ──────────────────
let slProducts = [];
let productByDrop = new Map();           // legacyDrop lower → product
let finishByDropCard = new Map();        // legacyDrop lower → Map(sid → finish)
let attribution = new Map();             // `${sid}|${finish}` → legacyDrop

export function setSlProducts(products) {
  slProducts = Array.isArray(products) ? products : [];
  productByDrop = new Map();
  finishByDropCard = new Map();
  attribution = new Map();
  for (const p of slProducts) {
    const lk = (p.legacyDrop || '').toLowerCase();
    if (!lk) continue;
    if (!productByDrop.has(lk)) productByDrop.set(lk, p);
    let fm = finishByDropCard.get(lk);
    if (!fm) { fm = new Map(); finishByDropCard.set(lk, fm); }
    for (const c of (p.cards || [])) {
      if (!fm.has(c.scryfallId)) fm.set(c.scryfallId, c.finish);
      const key = `${c.scryfallId}|${c.finish}`;
      // First product wins, except a confident product beats a lowConfidence one.
      if (!attribution.has(key) || (attribution.get(key).lowConfidence && !p.lowConfidence)) {
        attribution.set(key, p);
      }
    }
  }
}

export function getSlProducts() { return slProducts; }
export function hasSlProducts() { return slProducts.length > 0; }

// The product behind a legacy drop name (null when the model doesn't know it).
export function slProductForDrop(drop) {
  return productByDrop.get((drop || '').toLowerCase()) || null;
}

// Which finish a copy must be to count toward `drop`'s ownership of `sid`.
// null → model has no opinion (caller falls back to finish-blind matching).
export function requiredFinishFor(drop, sid) {
  const fm = finishByDropCard.get((drop || '').toLowerCase());
  return fm && fm.get(sid) || null;
}

// The drop an owned copy (sid + collection foil value) belongs to, per model.
export function attributeDropFor(sid, foil) {
  const hit = attribution.get(`${sid}|${finishGroup(foil)}`);
  return hit ? hit.legacyDrop : null;
}

// Model-backed drop finish for pricing ('nonfoil'|'foil'|'etched'; null = unknown).
export function slDropModelFinish(drop) {
  const p = slProductForDrop(drop);
  return p ? p.finish : null;
}

// A legacy drop name's base drop ("Goblingram Rainbow Foil" → "Goblingram") —
// the product model's word when it knows the drop, name-stripping otherwise.
// The wiki table and MSRPs are keyed by base drop names.
export function slBaseDropName(drop) {
  const p = slProductForDrop(drop);
  if (p) return p.dropName;
  const m = (drop || '').match(FINISH_TAIL);
  return m ? drop.slice(0, m.index).trim() : (drop || '');
}
