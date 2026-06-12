// One-shot mechanical splitter: src/renderer/app.js → src/renderer-js/*.js
// ES modules. Splits at anchor declarations, prepends `export` to top-level
// declarations, generates cross-module imports from a declaration index, and
// reports identifiers it can't resolve (candidates for missed globals).
// Run: node scripts/split-app.js
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'renderer', 'app.js');
const OUT = path.join(__dirname, '..', 'src', 'renderer-js');

// [moduleName, anchor] — each segment runs from its anchor (banner comments
// directly above are pulled in) to the next anchor. Order must match the file.
const SEGMENTS = [
  ['constants',     null], // file start
  ['state',         'let collection = makeCollection()'],
  ['logger',        'const LOG_BUFFER_SIZE'],
  ['state',         'function makeCollection()'],
  ['utils',         'function uid()'],
  ['csv',           'function parseCsvLine(line)'],
  ['storage',       'async function autoSave()'],
  ['importWizard',  'const IMPORT_FIELD_DEFS'],
  ['prices',        'function priceKey(scryfallId'],
  ['statusbar',     'function updateStatusBar()'],
  ['sealedPricing', 'const SEALED_KEYWORDS'],
  ['analytics',     'function cardCurrentValue(card)'],
  ['render',        'function render() {'],
  ['ticker',        'function tickerSettings()'],
  ['analytics',     'function renderRarityPanel()'],
  ['cardsTab',      'function renderCards()'],
  ['gallery',       'function renderGallery()'],
  ['slTab',         'async function refreshSlData()'],
  ['failures',      'async function retryFailedLookups()'],
  ['cardsTab',      'function filteredCards()'],
  ['sealedTab',     'function renderSealed()'],
  ['decks',         'const DECK_FORMATS'],
  ['deckIO',        'const DECK_SECTION_HEADERS'],
  ['modals',        'function showModal(html'],
  ['productPicker', 'function showProductPicker(opts'],
  ['sealedModals',  'function showAddSealedModal(editId'],
  ['exportModal',   'const EXPORT_LANG_NAMES'],
  ['settings',      'function showSettings()'],
  ['updaterUI',     'const updaterUI = '],
  ['hover',         'let _hoverShowTimer'],
  ['main',          'async function init()'],
];

const lines = fs.readFileSync(SRC, 'utf-8').split(/\r?\n/);

// Resolve anchors to line indices (0-based), walking back over banner comments.
const starts = SEGMENTS.map(([name, anchor], i) => {
  if (anchor === null) return { name, line: 0 };
  let idx = lines.findIndex(l => l.startsWith(anchor));
  if (idx < 0) { console.error(`ANCHOR NOT FOUND: ${anchor}`); process.exit(1); }
  while (idx > 0 && (/^\s*\/\//.test(lines[idx - 1]) || /^\s*$/.test(lines[idx - 1]))) idx--;
  return { name, line: idx };
});
for (let i = 1; i < starts.length; i++) {
  if (starts[i].line <= starts[i - 1].line) {
    console.error(`SEGMENT ORDER VIOLATION at ${starts[i].name}`); process.exit(1);
  }
}

// Collect each module's source lines.
const moduleLines = new Map();
starts.forEach((s, i) => {
  const end = i + 1 < starts.length ? starts[i + 1].line : lines.length;
  const chunk = lines.slice(s.line, end);
  if (!moduleLines.has(s.name)) moduleLines.set(s.name, []);
  moduleLines.get(s.name).push(...chunk, '');
});

// Index top-level declarations: name → module.
const DECL_RE = /^(?:async function|function|const|let) ([A-Za-z_$][\w$]*)/;
const declOwner = new Map();
for (const [mod, mls] of moduleLines) {
  for (const l of mls) {
    const m = l.match(DECL_RE);
    if (!m) continue;
    if (declOwner.has(m[1]) && declOwner.get(m[1]) !== mod) {
      console.error(`DUPLICATE top-level decl across modules: ${m[1]} (${declOwner.get(m[1])} vs ${mod})`);
      process.exit(1);
    }
    declOwner.set(m[1], mod);
  }
}

// Globals that are legitimately bare in module code.
const slSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'secretlair.js'), 'utf-8');
const SL_GLOBALS = new Set([...slSrc.matchAll(/^(?:async function|function|const|let|var) ([A-Za-z_$][\w$]*)/gm)].map(m => m[1]));
const KNOWN = new Set([
  // language
  'true','false','null','undefined','NaN','Infinity','this','arguments','new','typeof','instanceof','in','of','delete','void',
  'function','async','await','return','if','else','for','while','do','switch','case','default','break','continue','try','catch',
  'finally','throw','const','let','var','class','extends','super','import','export','from','yield','static','get','set',
  // builtins
  'Object','Array','JSON','Math','Date','Promise','Set','Map','WeakMap','RegExp','Number','String','Boolean','Symbol','Error',
  'TypeError','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','structuredClone',
  'console','crypto','navigator','alert','confirm','prompt','requestAnimationFrame','cancelAnimationFrame',
  'setTimeout','clearTimeout','setInterval','clearInterval','URL','URLSearchParams','Blob','FileReader','Image','fetch',
  'localStorage','sessionStorage','performance','AbortController','ResizeObserver','IntersectionObserver','CustomEvent',
  'window','document','globalThis','Intl','queueMicrotask','atob','btoa','TextEncoder','TextDecoder','MutationObserver',
]);

// Scan the raw source. Words inside strings/comments produce spurious imports,
// which are harmless (unused bindings); a regex-based string stripper risks
// MISSING real identifiers inside template literals, which is not.
function scannable(src) {
  return src;
}

// Generate each module file with imports.
fs.mkdirSync(OUT, { recursive: true });
const unresolvedReport = {};
const moduleNames = [...moduleLines.keys()];

for (const [mod, mls] of moduleLines) {
  const ownDecls = new Set(mls.map(l => (l.match(DECL_RE) || [])[1]).filter(Boolean));
  const body = mls.map(l => DECL_RE.test(l) && mod !== 'main' ? 'export ' + l : l).join('\n');

  // Find identifiers used (not preceded by '.', not property keys).
  const used = new Set();
  const scan = scannable(mls.join('\n'));
  for (const m of scan.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b(?!\s*:)/g)) used.add(m[1]);

  const importsByMod = new Map();
  const unresolved = [];
  for (const name of used) {
    if (ownDecls.has(name) || KNOWN.has(name) || SL_GLOBALS.has(name)) continue;
    const owner = declOwner.get(name);
    if (owner && owner !== mod) {
      if (!importsByMod.has(owner)) importsByMod.set(owner, []);
      importsByMod.get(owner).push(name);
    } else if (!owner) {
      unresolved.push(name);
    }
  }
  if (unresolved.length) unresolvedReport[mod] = unresolved.sort();

  const importLines = [...importsByMod.entries()]
    .sort()
    .map(([m, names]) => `import { ${names.sort().join(', ')} } from './${m}.js';`);

  let header = importLines.join('\n');
  if (mod === 'main') {
    // Entry: import every module namespace and expose exports as globals —
    // inline on*="" handlers and the Svelte bridge rely on global names,
    // exactly as they did when app.js was a classic script.
    const nsImports = moduleNames.filter(m => m !== 'main')
      .map(m => `import * as NS_${m} from './${m}.js';`).join('\n');
    const nsList = moduleNames.filter(m => m !== 'main').map(m => `NS_${m}`).join(', ');
    header = nsImports + '\n' + header + `

// Expose every module export as a window global. Inline onclick handlers in
// rendered HTML and a few Svelte panels resolve functions by global name —
// this preserves the classic-script contract. Remove as tabs migrate to
// components with real event wiring.
const WINDOW_DENYLIST = new Set(['window', 'document', 'location', 'top', 'parent', 'self', 'frames', 'length', 'name', 'status', 'history', 'origin', 'closed', 'opener', 'navigator', 'screen']);
for (const ns of [${nsList}]) {
  for (const [key, value] of Object.entries(ns)) {
    if (WINDOW_DENYLIST.has(key)) continue;
    try { window[key] = value; } catch { /* read-only window prop — skip */ }
  }
}
`;
  }
  fs.writeFileSync(path.join(OUT, `${mod}.js`), header + '\n\n' + body + '\n');
}

console.log('Modules written:', moduleNames.join(', '));
console.log('\nUnresolved identifiers (verify each is a real global):');
for (const [mod, names] of Object.entries(unresolvedReport)) {
  console.log(`  ${mod}: ${names.join(', ')}`);
}
