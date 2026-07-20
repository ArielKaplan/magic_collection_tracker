'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { compact, vendorSeries, extractSelectedPrices } = require('./sl-build/extract-price-seed.js');

let failures = 0;
const check = (label, cond) => { if (cond) console.log(`  ok  ${label}`); else { failures++; console.error(`FAIL  ${label}`); } };

(async () => {
  const real = {};
  for (let i = 0; i < 40; i++) { const d = new Date(Date.UTC(2026, 0, 1 + i)); real[d.toISOString().slice(0,10)] = i + 1; }
  const rows = compact(real);
  check('history downsample keeps latest seven daily observations', rows.slice(-7).every((x,i)=>x.price===34+i));
  check('history downsample is smaller than the raw series', rows.length < 40 && rows.length > 7);

  const hit = vendorSeries({ paper: { tcgplayer: { retail: { normal: { '2026-01-01': 12.5 } } }, cardmarket: { retail: { normal: { '2026-01-01': 2 } } } } }, 'normal');
  check('USD TCGplayer retail wins and EUR Cardmarket is not mixed', hit.provider === 'tcgplayer' && hit.points['2026-01-01'] === 12.5);
  check('missing USD vendor returns null even when Cardmarket exists', vendorSeries({ paper: { cardmarket: { retail: { normal: { '2026-01-01': 2 } } } } }, 'normal') === null);

  const sample = path.join(os.tmpdir(), `sl-price-stream-${Date.now()}.json`);
  fs.writeFileSync(sample, JSON.stringify({ meta: { date: '2026-01-01', version: 'test' }, data: { keep: { paper: { tcgplayer: {} } }, skip: { large: 'x'.repeat(200000) } } }));
  const parsed = await extractSelectedPrices(sample, new Set(['keep']));
  try { fs.unlinkSync(sample); } catch {}
  check('stream parser retains only requested UUID records', parsed.meta.version === 'test' && parsed.data.keep && !parsed.data.skip);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll Secret Lair price-seed smoke tests passed.');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
