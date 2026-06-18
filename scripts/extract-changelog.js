#!/usr/bin/env node
// Extract one version's section body from CHANGELOG.md.
//   node scripts/extract-changelog.js <version> [outFile]
// Prints (or writes, UTF-8) the lines under "## [<version>] ..." up to the next
// "## " heading, without the heading itself. Exit 1 if missing/empty so the
// release workflow can skip setting notes rather than blanking them.
'use strict';
const fs = require('fs');
const path = require('path');

const version = (process.argv[2] || '').replace(/^v/, '');
const outFile = process.argv[3];
if (!version) { console.error('usage: extract-changelog.js <version> [outFile]'); process.exit(2); }

const md = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = md.split(/\r?\n/);

// Match "## [0.12.2] - 2026-06-18", "## 0.12.2", or "## v0.12.2"
const head = new RegExp(`^##\\s+\\[?v?${version.replace(/\./g, '\\.')}\\]?(\\s|$)`);
let start = -1;
for (let i = 0; i < lines.length; i++) { if (head.test(lines[i])) { start = i; break; } }
if (start === -1) { console.error(`No CHANGELOG entry for ${version}`); process.exit(1); }

let end = lines.length;
for (let i = start + 1; i < lines.length; i++) { if (/^##\s/.test(lines[i])) { end = i; break; } }

const body = lines.slice(start + 1, end).join('\n').trim();
if (!body) { console.error(`Empty CHANGELOG entry for ${version}`); process.exit(1); }

if (outFile) fs.writeFileSync(outFile, body + '\n', 'utf8');
else process.stdout.write(body + '\n');
