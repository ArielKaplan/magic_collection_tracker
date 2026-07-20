// localIntelligence.js — embedded, offline inference for Mana Ledger.
//
// This is deliberately a small, explainable model rather than a general LLM.
// It scores structured features already present in the local collection. It
// performs no network requests, does not train on user data, and never mutates
// source truth.

export const LOCAL_INTELLIGENCE_MODEL = Object.freeze({
  id: 'mana-local-intelligence',
  version: '1.0.0',
  kind: 'explainable hybrid ensemble',
  jobs: ['data-guardian', 'entity-matcher', 'attention-ranker', 'query-interpreter'],
  privacy: 'offline',
});

const ENTITY_WEIGHTS = Object.freeze({
  intercept: -5.15,
  exact: 5.4,
  tokenJaccard: 3.15,
  trigramDice: 2.45,
  prefix: 0.75,
  lengthRatio: 0.7,
  numberAgreement: 0.65,
  finishAgreement: 0.35,
  groupAgreement: 0.35,
});

const INTENT_MODEL = Object.freeze({
  cards: {
    bias: 0.2,
    terms: { card: 2.3, cards: 2.3, binder: 1.8, printing: 1.2, foil: 0.7, etched: 0.7, rarity: 0.8, set: 0.4 },
  },
  sealed: {
    bias: 0,
    terms: { sealed: 3.2, box: 1.7, boxes: 1.7, unopened: 2.2, product: 0.7, products: 0.7 },
  },
  decks: {
    bias: 0,
    terms: { deck: 2.6, decks: 2.6, brew: 1.5, brews: 1.5, build: 1.0, commander: 0.6 },
  },
  precons: {
    bias: 0,
    terms: { precon: 3.4, precons: 3.4, preconstructed: 3.0, reconstruction: 1.5 },
  },
  wantlist: {
    bias: 0,
    terms: { want: 2.2, wanted: 2.4, wishlist: 3.0, target: 1.7, acquire: 1.5, buy: 0.8 },
  },
  opportunities: {
    bias: 0,
    terms: { opportunity: 3.1, opportunities: 3.1, signal: 2.0, signals: 2.0, surplus: 1.8, mover: 1.6, spread: 1.6 },
  },
});

const number = (value, fallback = 0) => value !== '' && value != null && Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const sigmoid = value => 1 / (1 + Math.exp(-value));
const lower = value => String(value || '').trim().toLowerCase();

function finishKey(value) {
  const text = lower(value);
  if (text.includes('etched')) return 'etched';
  if (text.includes('foil')) return 'foil';
  return 'normal';
}

export function normalizeEntityName(value) {
  return lower(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(secret lair|drop series|drop|edition|the)\b/g, ' ')
    .replace(/\b(non[- ]?foil|traditional foil|rainbow foil|etched foil|foil)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return normalizeEntityName(value).split(' ').filter(Boolean);
}

function trigrams(value) {
  const normalized = `  ${normalizeEntityName(value)}  `;
  const out = new Set();
  for (let i = 0; i < normalized.length - 2; i++) out.add(normalized.slice(i, i + 3));
  return out;
}

function setSimilarity(left, right) {
  if (!left.size && !right.size) return 1;
  let overlap = 0;
  for (const item of left) if (right.has(item)) overlap += 1;
  return { overlap, union: left.size + right.size - overlap };
}

function tokenJaccard(left, right) {
  const result = setSimilarity(new Set(tokens(left)), new Set(tokens(right)));
  return result.union ? result.overlap / result.union : 0;
}

function trigramDice(left, right) {
  const a = trigrams(left), b = trigrams(right);
  const result = setSimilarity(a, b);
  return a.size + b.size ? (2 * result.overlap) / (a.size + b.size) : 0;
}

function extractedNumbers(value) {
  return [...lower(value).matchAll(/\d+/g)].map(match => match[0]);
}

function entityFeatures(left, right, context = {}) {
  const a = normalizeEntityName(left), b = normalizeEntityName(right);
  const numsA = extractedNumbers(left), numsB = extractedNumbers(right);
  const numberAgreement = !numsA.length && !numsB.length ? 0.5
    : numsA.join('|') === numsB.join('|') ? 1 : 0;
  const maxLength = Math.max(a.length, b.length, 1);
  return {
    exact: a && a === b ? 1 : 0,
    tokenJaccard: tokenJaccard(a, b),
    trigramDice: trigramDice(a, b),
    prefix: a && b && (a.startsWith(b) || b.startsWith(a)) ? 1 : 0,
    lengthRatio: Math.min(a.length, b.length) / maxLength,
    numberAgreement,
    finishAgreement: finishKey(context.leftFinish || left) === finishKey(context.rightFinish || right) ? 1 : 0,
    groupAgreement: context.leftGroup && context.rightGroup && normalizeEntityName(context.leftGroup) === normalizeEntityName(context.rightGroup) ? 1 : 0,
  };
}

export function scoreEntityMatch(left, right, context = {}) {
  const features = entityFeatures(left, right, context);
  let logit = ENTITY_WEIGHTS.intercept;
  for (const [key, value] of Object.entries(features)) logit += value * (ENTITY_WEIGHTS[key] || 0);
  const confidence = sigmoid(logit);
  const reasons = [];
  if (features.exact) reasons.push('same normalized product name');
  else {
    if (features.tokenJaccard >= 0.7) reasons.push('strong word overlap');
    if (features.trigramDice >= 0.72) reasons.push('strong spelling similarity');
    if (features.prefix) reasons.push('one name contains the other');
  }
  if (features.numberAgreement === 0 && (extractedNumbers(left).length || extractedNumbers(right).length)) reasons.push('number mismatch lowers confidence');
  if (!features.finishAgreement) reasons.push('finish mismatch lowers confidence');
  return { confidence, score: Math.round(confidence * 100), features, reasons };
}

export function findCrossSourceMatches(leftRows = [], rightRows = [], options = {}) {
  const limit = Math.max(1, number(options.limit, 12));
  const minimum = clamp(number(options.minimum, 0.76));
  const results = [];
  for (const left of leftRows.slice(0, 500)) {
    if (!left?.name) continue;
    let best = null;
    for (const right of rightRows.slice(0, 1500)) {
      if (!right?.name) continue;
      const result = scoreEntityMatch(left.name, right.name, {
        leftFinish: left.finish, rightFinish: right.finish,
        leftGroup: left.group, rightGroup: right.group,
      });
      if (!best || result.confidence > best.confidence) best = { left, right, ...result };
    }
    if (best && best.confidence >= minimum) results.push(best);
  }
  return results.sort((a, b) => b.confidence - a.confidence || a.left.name.localeCompare(b.left.name)).slice(0, limit);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function priceAnomaly(name, key, history, source) {
  const rows = (history || []).map(row => ({ date: row?.date || '', price: number(row?.price, NaN) })).filter(row => row.price > 0);
  if (rows.length < 2) return null;
  const latest = rows[rows.length - 1].price;
  const previous = rows[rows.length - 2].price;
  const baselineRows = rows.slice(0, -1).map(row => row.price);
  const baseline = median(baselineRows) || previous;
  const absoluteMove = latest - previous;
  const ratio = Math.max(latest, previous) / Math.max(0.01, Math.min(latest, previous));
  const deviations = baselineRows.map(value => Math.abs(value - baseline));
  const mad = median(deviations);
  const robustZ = mad > 0 ? Math.abs(latest - baseline) / (1.4826 * mad) : Math.abs(latest - baseline) / Math.max(1, baseline * 0.12);
  if (!((ratio >= 2.5 && Math.abs(absoluteMove) >= 8) || (robustZ >= 5 && Math.abs(latest - baseline) >= 5))) return null;
  const confidence = clamp(0.55 + Math.min(0.24, Math.log2(ratio) * 0.08) + Math.min(0.14, rows.length * 0.015));
  const direction = latest >= previous ? 'spike' : 'drop';
  return {
    id: `price:${source}:${key}`,
    type: 'price-anomaly',
    severity: ratio >= 5 || robustZ >= 10 ? 'high' : 'medium',
    confidence,
    score: Math.round(confidence * 100),
    name,
    title: `Unusual recorded price ${direction}`,
    details: `${source} moved from $${previous.toFixed(2)} to $${latest.toFixed(2)}; the prior median was $${baseline.toFixed(2)}.`,
    evidence: `${ratio.toFixed(1)}x adjacent-price ratio · ${rows.length} stored observations`,
  };
}

export function scanDataGuardian({ cards = [], sealed = [], priceHistory = {}, marketPriceHistory = {}, slProducts = [] } = {}) {
  const issues = [];
  const owned = cards.filter(card => card?.status !== 'sold');
  const seenPriceKeys = new Set();
  for (const card of owned) {
    const quantity = number(card.quantity, 1);
    if (!card.scryfallId) {
      issues.push({
        id: `identity:${card.id || card.name}`,
        type: 'identity-gap', severity: 'medium', confidence: 1, score: 100,
        name: card.name || 'Unnamed card', title: 'Owned card has no printing identity',
        details: 'This row cannot participate in exact-printing joins or finish-aware price history until it has a Scryfall ID.',
        evidence: 'Required identity field is empty',
      });
    }
    if (!(quantity > 0)) {
      issues.push({
        id: `quantity:${card.id || card.name}`,
        type: 'invalid-value', severity: 'high', confidence: 1, score: 100,
        name: card.name || 'Unnamed card', title: 'Invalid owned quantity',
        details: `The stored quantity is ${String(card.quantity)}. Owned collection quantities must be greater than zero.`,
        evidence: 'Deterministic schema check',
      });
    }
    const sid = lower(card.scryfallId);
    if (!sid) continue;
    const key = `${sid}|${finishKey(card.foil)}`;
    if (seenPriceKeys.has(key)) continue;
    seenPriceKeys.add(key);
    const primary = priceAnomaly(card.name || sid, key, priceHistory[key], 'Scryfall history');
    const market = priceAnomaly(card.name || sid, key, marketPriceHistory[key], 'TCGplayer market history');
    if (primary) issues.push(primary);
    if (market) issues.push(market);
  }

  for (const item of sealed.filter(row => row?.status !== 'sold')) {
    const issue = priceAnomaly(item.name || 'Sealed product', item.id || item.name, item.priceHistory, 'sealed history');
    if (issue) issues.push(issue);
  }

  const lowConfidence = slProducts.filter(product => product?.lowConfidence).length;
  const missingMarketplace = slProducts.filter(product => !(product?.tcgplayerProductId || product?.identifiers?.tcgplayerProductId)).length;
  if (lowConfidence) issues.push({
    id: 'sl:low-confidence', type: 'source-quality', severity: 'medium', confidence: 1, score: 100,
    name: 'Secret Lair product model', title: `${lowConfidence.toLocaleString()} low-confidence product joins`,
    details: 'These products remain visible, but exact economic comparisons should not treat their identity as confirmed.',
    evidence: 'Existing source-quality flags; no records were changed',
  });
  if (missingMarketplace) issues.push({
    id: 'sl:missing-marketplace', type: 'coverage-gap', severity: 'low', confidence: 1, score: 100,
    name: 'Secret Lair product model', title: `${missingMarketplace.toLocaleString()} products lack an exact TCGplayer ID`,
    details: 'They cannot receive exact sealed-market comparisons until a source supplies a marketplace identifier.',
    evidence: 'Marketplace identity coverage check',
  });

  const severityOrder = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => (severityOrder[a.severity] ?? 9) - (severityOrder[b.severity] ?? 9) || b.confidence - a.confidence).slice(0, 80);
}

export function rankLocalOpportunities(opportunities = []) {
  return opportunities.map(item => {
    const magnitude = clamp(Math.log1p(Math.abs(number(item.gain, item.score))) / 5);
    const intent = item.type === 'want-target' ? 1 : item.type === 'duplicate' ? 0.7 : 0.45;
    const evidence = item.type === 'sealed-value' ? 1 : item.type === 'market-move' ? 0.78 : 0.72;
    const exactness = item.type === 'sealed-value' ? 1 : item.type === 'want-target' ? 0.9 : 0.7;
    const probability = sigmoid(-1.55 + magnitude * 1.8 + intent * 0.8 + evidence * 1.0 + exactness * 0.65);
    const attentionScore = Math.round(probability * 100);
    const reasons = [];
    if (item.type === 'want-target') reasons.push('directly tied to your saved target');
    if (item.type === 'sealed-value') reasons.push('exact sealed identity and fully priced guaranteed contents');
    if (item.type === 'market-move') reasons.push('supported by consecutive stored observations');
    if (item.type === 'duplicate') reasons.push('quantity exceeds maximum saved-deck demand');
    if (magnitude >= 0.65) reasons.push('large dollar magnitude relative to other signals');
    return {
      ...item,
      attentionScore,
      confidence: Math.round(clamp(0.5 + evidence * 0.28 + exactness * 0.17) * 100),
      attention: attentionScore >= 80 ? 'Review first' : attentionScore >= 65 ? 'Worth reviewing' : 'Watch',
      modelReasons: reasons,
    };
  }).sort((a, b) => b.attentionScore - a.attentionScore || b.score - a.score || a.name.localeCompare(b.name));
}

function queryTokens(query) {
  return lower(query).replace(/[^a-z0-9$%.-]+/g, ' ').split(/\s+/).filter(Boolean);
}

function firstNumber(query, pattern) {
  const match = lower(query).match(pattern);
  return match ? number(match[1], null) : null;
}

export function interpretLocalQuery(query) {
  const text = lower(query);
  const words = queryTokens(text);
  const scores = Object.entries(INTENT_MODEL).map(([dataset, model]) => {
    let score = model.bias;
    for (const word of words) score += model.terms[word] || 0;
    if (dataset === 'precons' && text.includes('preconstructed deck')) score += 2;
    if (dataset === 'wantlist' && text.includes('want list')) score += 2;
    return { dataset, score };
  }).sort((a, b) => b.score - a.score);
  const top = scores[0];
  const exp = scores.map(row => Math.exp(row.score - top.score));
  const confidence = exp[0] / exp.reduce((sum, value) => sum + value, 0);
  const filters = {};
  const under = firstNumber(text, /(?:under|below|less than|at most|max(?:imum)?(?: of)?)\s*\$?([0-9]+(?:\.[0-9]+)?)/);
  const over = firstNumber(text, /(?:over|above|more than|at least|min(?:imum)?(?: of)?)\s*\$?([0-9]+(?:\.[0-9]+)?)/);
  const gainUnder = firstNumber(text, /(?:gain|profit|headroom)[^0-9]{0,14}(?:under|below|less than|at most)\s*\$?([0-9]+(?:\.[0-9]+)?)/);
  const gainOver = firstNumber(text, /(?:gain|profit|headroom)[^0-9]{0,14}(?:over|above|more than|at least)\s*\$?([0-9]+(?:\.[0-9]+)?)/);
  if (under != null) filters.maxValue = under;
  if (over != null) filters.minValue = over;
  if (gainUnder != null) { filters.maxGain = gainUnder; delete filters.maxValue; }
  if (gainOver != null) { filters.minGain = gainOver; delete filters.minValue; }
  const completion = firstNumber(text, /([0-9]+(?:\.[0-9]+)?)\s*%?\s*(?:complete|completion|built)/);
  const missing = firstNumber(text, /(?:at most|max(?:imum)?(?: of)?|under|below|with)?\s*([0-9]+)\s*(?:or fewer\s*)?missing/);
  if (completion != null) filters.minCompletion = completion;
  if (missing != null) filters.maxMissing = missing;
  if (/\betched\b/.test(text)) filters.finish = 'etched';
  else if (/\b(non[- ]?foil|regular)\b/.test(text)) filters.finish = 'normal';
  else if (/\bfoil\b/.test(text)) filters.finish = 'foil';
  if (/\bsold\b/.test(text)) filters.status = 'sold';
  else if (/\bcomplete\b/.test(text) && !/\bincomplete\b/.test(text)) filters.status = 'complete';
  else if (/\bincomplete\b/.test(text)) filters.status = 'incomplete';
  else if (/\bowned\b/.test(text)) filters.status = 'owned';
  if (/\b(loss|losses|losing|down)\b/.test(text)) filters.maxGain = -0.01;
  else if (/\b(gain|gains|profit|profitable|up)\b/.test(text) && filters.minGain == null) filters.minGain = 0;
  const quoted = text.match(/[“"]([^”"]+)[”"]/);
  if (quoted) filters.text = quoted[1];
  const sort = /\b(cheapest|lowest|least)\b/.test(text) ? 'value_asc'
    : /\b(most valuable|highest value|expensive)\b/.test(text) ? 'value_desc'
    : /\b(best gain|biggest gain|highest gain)\b/.test(text) ? 'gain_desc'
    : /\b(fewest missing|closest)\b/.test(text) ? 'missing_asc'
    : 'name_asc';
  return {
    query: String(query || '').trim(),
    dataset: top.dataset,
    confidence,
    score: Math.round(confidence * 100),
    filters,
    sort,
    alternatives: scores.slice(1, 3).map(row => row.dataset),
  };
}

export function runLocalQuery(rows = [], interpretation = {}) {
  const filters = interpretation.filters || {};
  const text = lower(filters.text);
  const out = rows.filter(row => {
    if (text && !Object.values(row).some(value => lower(value).includes(text))) return false;
    if (filters.finish && finishKey(row.finish) !== filters.finish) return false;
    if (filters.status && lower(row.status) !== filters.status) return false;
    if (filters.minValue != null && !(number(row.value, -Infinity) >= filters.minValue)) return false;
    if (filters.maxValue != null && !(number(row.value, Infinity) <= filters.maxValue)) return false;
    if (filters.minGain != null && !(number(row.gain, -Infinity) >= filters.minGain)) return false;
    if (filters.maxGain != null && !(number(row.gain, Infinity) <= filters.maxGain)) return false;
    if (filters.minCompletion != null && !(number(row.completion, -Infinity) >= filters.minCompletion)) return false;
    if (filters.maxMissing != null && !(number(row.missing, Infinity) <= filters.maxMissing)) return false;
    return true;
  });
  const [field, direction] = String(interpretation.sort || 'name_asc').split('_');
  const multiplier = direction === 'desc' ? -1 : 1;
  out.sort((a, b) => {
    if (field === 'name') return lower(a.name).localeCompare(lower(b.name)) * multiplier;
    return (number(a[field]) - number(b[field])) * multiplier || lower(a.name).localeCompare(lower(b.name));
  });
  return out.slice(0, 50);
}
