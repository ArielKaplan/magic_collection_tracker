// Smoke test for the main-process net:fetch path: hits the same endpoints the
// renderer uses, with the same headers the IPC handler sends.
// Run: npx electron scripts/smoke-netfetch.js
const { app, net } = require('electron');

async function probe(label, url, opts) {
  const headers = {
    'User-Agent': `SecretLairTracker/${app.getVersion()}`,
    'Accept': 'application/json',
    ...(opts?.headers || {}),
  };
  try {
    const resp = await net.fetch(url, { method: opts?.method || 'GET', headers, body: opts?.body });
    const text = await resp.text();
    let detail = '';
    try {
      const j = JSON.parse(text);
      if (Array.isArray(j)) detail = `${j.length} items`;
      else if (j.data) detail = `${(j.data.length ?? Object.keys(j.data).length)} data`;
      else if (j.results) detail = `${j.results.length} results`;
    } catch { detail = `${text.length} bytes (non-JSON)`; }
    console.log(`${resp.ok ? ' ok ' : 'FAIL'} ${label}: HTTP ${resp.status} · ${detail}`);
    return resp.ok;
  } catch (e) {
    console.log(`FAIL ${label}: ${e.message}`);
    return false;
  }
}

app.whenReady().then(async () => {
  const sample = 'f295b713-1d6a-43fd-910d-fb35414bf58a'; // Dusk // Dawn, a stable Scryfall ID
  const results = await Promise.all([
    probe('scryfall POST /cards/collection', 'https://api.scryfall.com/cards/collection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifiers: [{ id: sample }] }),
    }),
    probe('tcgcsv groups', 'https://tcgcsv.com/tcgplayer/1/groups'),
    probe('scryfall GET /cards/:id', `https://api.scryfall.com/cards/${sample}`),
  ]);
  process.exit(results.every(Boolean) ? 0 : 1);
});
