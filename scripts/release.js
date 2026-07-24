#!/usr/bin/env node
// Bump version in package.json, commit, tag, and push.
// CI (.github/workflows/release.yml) takes over from the tag push and builds/publishes.
//
// Usage:
//   npm run release:tag -- patch     # 0.5.0 -> 0.5.1
//   npm run release:tag -- minor     # 0.5.0 -> 0.6.0
//   npm run release:tag -- major     # 0.5.0 -> 1.0.0
//   npm run release:tag -- 0.7.2     # explicit

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: npm run release:tag -- <patch|minor|major|x.y.z>');
  process.exit(1);
}

const run = (cmd) => {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit' });
};
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();

// Refuse to release with a dirty tree — would confuse the tag-to-build mapping.
const status = out('git status --porcelain');
if (status) {
  console.error('Working tree is dirty. Commit or stash first:\n' + status);
  process.exit(1);
}

const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const cur = pkg.version;
const [maj, min, pat] = cur.split('.').map(Number);

let next;
if (arg === 'patch')      next = `${maj}.${min}.${pat + 1}`;
else if (arg === 'minor') next = `${maj}.${min + 1}.0`;
else if (arg === 'major') next = `${maj + 1}.0.0`;
else if (/^\d+\.\d+\.\d+$/.test(arg)) next = arg;
else {
  console.error(`Invalid version: ${arg}`);
  process.exit(1);
}

console.log(`Releasing v${cur} -> v${next}`);

pkg.version = next;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

run('git add package.json');

// Promote CHANGELOG.md [Unreleased] -> [next] - date, and open a fresh
// [Unreleased]. CI sets the GitHub release notes from the [next] section.
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md');
if (fs.existsSync(changelogPath)) {
  let cl = fs.readFileSync(changelogPath, 'utf8');
  const date = new Date().toISOString().slice(0, 10);
  const m = cl.match(/^##\s+\[Unreleased\][^\n]*\n([\s\S]*?)(?=\n##\s|$)/m);
  const unreleasedBody = m ? m[1].trim() : '';
  if (!unreleasedBody) {
    console.warn('\n⚠  CHANGELOG.md [Unreleased] is empty — this release will have no in-app notes.');
  }
  if (/^##\s+\[Unreleased\]/m.test(cl)) {
    cl = cl.replace(/^##\s+\[Unreleased\][^\n]*$/m, `## [Unreleased]\n\n## [${next}] - ${date}`);
    fs.writeFileSync(changelogPath, cl);
    run('git add CHANGELOG.md');
  } else {
    console.warn('\n⚠  No [Unreleased] section in CHANGELOG.md — skipping changelog promotion.');
  }
}
// Keep package-lock.json's version fields in sync if it exists. Only edit the
// version fields — never re-resolve the tree here: npm 11's --package-lock-only
// strips esbuild's nested optional platform deps (pulled in via vitest), and
// npm 10 (Node 22's bundled npm, used by the data-refresh workflow) rejects
// the resulting lockfile at `npm ci`.
const lockPath = path.join(__dirname, '..', 'package-lock.json');
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = next;
  if (lock.packages && lock.packages['']) lock.packages[''].version = next;
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  run('git add package-lock.json');
}
run(`git commit -m "chore: release v${next}"`);
run(`git tag -a v${next} -m "v${next}"`);
run('git push');
run(`git push origin v${next}`);

console.log(`\nTag v${next} pushed. GitHub Actions will build and publish the installer.`);
console.log(`Watch: https://github.com/sarcasticsoftwarestudio/mana-ledger/actions`);
