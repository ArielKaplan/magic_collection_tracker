// Verifies the release-notes sanitizer (updaterUI.sanitizeNotesHtml) in a real
// Chromium DOM: renders the allowed formatting tags but strips scripts, images,
// event handlers, and javascript: links. Runs the ACTUAL source (sliced out of
// updaterUI.js and injected) so the test can't drift from the implementation.
// Run: npx electron scripts/smoke-whatsnew.js
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer-js', 'updaterUI.js'), 'utf8');
// Pull the NOTES_KEEP/NOTES_DROP consts + the sanitizeNotesHtml function body.
const start = src.indexOf('const NOTES_KEEP');
const endMarker = 'return out.innerHTML;\n}';
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) { console.error('FAIL — could not locate sanitizeNotesHtml in source'); process.exit(1); }
const fnSource = src.slice(start, end + endMarker.length).replace(/^export\s+/m, '');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<html><body></body></html>');

  const result = await win.webContents.executeJavaScript(`(() => {
    ${fnSource}
    const out = {};
    out.notes = sanitizeNotesHtml('<h3>Added</h3>\\n<ul>\\n<li><strong>Value Over Time</strong> a chart</li>\\n</ul>');
    out.script = sanitizeNotesHtml('<p>ok</p><script>window.__pwned=1;</scr'+'ipt>');
    out.img = sanitizeNotesHtml('<img src=x onerror="window.__pwned=1">');
    out.handler = sanitizeNotesHtml('<p onclick="window.__pwned=1">hi <b>there</b></p>');
    out.goodLink = sanitizeNotesHtml('<a href="https://example.com" onclick="evil()">link</a>');
    out.jsLink = sanitizeNotesHtml('<a href="javascript:alert(1)">x</a>');
    out.unknown = sanitizeNotesHtml('<div style="x" onmouseover="evil()"><p>kept</p></div>');
    out.pwned = !!window.__pwned;
    return out;
  })()`);

  let failures = 0;
  const check = (label, cond, detail) => {
    if (cond) console.log('  ok  ' + label);
    else { failures++; console.error('FAIL  ' + label + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')); }
  };

  check('renders allowed tags (h3/ul/li/strong)',
    /<h3>Added<\/h3>/.test(result.notes) && /<li><strong>Value Over Time<\/strong>/.test(result.notes), result.notes);
  check('no executable side effects', result.pwned === false, result.pwned);
  check('strips <script> entirely', !/script/i.test(result.script) && /<p>ok<\/p>/.test(result.script), result.script);
  check('drops <img> and onerror', !/<img/i.test(result.img) && !/onerror/i.test(result.img), result.img);
  check('strips event-handler attributes', !/onclick/i.test(result.handler) && /<p>hi <b>there<\/b><\/p>/.test(result.handler), result.handler);
  check('keeps valid http(s) link, drops onclick', /<a href="https:\/\/example\.com">link<\/a>/.test(result.goodLink) && !/onclick/i.test(result.goodLink), result.goodLink);
  check('drops javascript: href', !/javascript:/i.test(result.jsLink), result.jsLink);
  check('unwraps unknown tag, keeps child + strips attrs', /<p>kept<\/p>/.test(result.unknown) && !/<div/i.test(result.unknown) && !/onmouseover|style/i.test(result.unknown), result.unknown);

  console.log(failures ? `\n${failures} FAILURES` : '\nAll What\'s New sanitizer smoke tests passed.');
  win.destroy();
  app.exit(failures ? 1 : 0);
});
