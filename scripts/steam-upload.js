#!/usr/bin/env node
// Build the Steam-channel app and upload it to Steamworks via SteamPipe.
//
//   npm run steam:ship               # build:steam + upload
//   npm run steam:ship -- --skip-build   # upload the existing dist/win-unpacked
//
// One-time setup:
//   1. Fill in steam/steam.json (appId, depotId, account).
//   2. Install steamcmd and either put it on PATH or set STEAMCMD to the exe:
//      https://developer.valvesoftware.com/wiki/SteamCMD
// First upload prompts for your Steam password + Steam Guard code; steamcmd
// caches the session after that.

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const cfgPath = path.join(root, 'steam', 'steam.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
for (const key of ['appId', 'depotId', 'account']) {
  if (!cfg[key] || /REPLACE/.test(cfg[key])) {
    console.error(`steam/steam.json: "${key}" is not filled in yet.`);
    process.exit(1);
  }
}

const version = require(path.join(root, 'package.json')).version;
const contentRoot = path.join(root, 'dist', 'win-unpacked');
const logDir = path.join(root, 'dist', 'steam-logs');

if (!process.argv.includes('--skip-build')) {
  console.log('Building Steam channel (updater-inert)…');
  execSync('npm run build:steam', { cwd: root, stdio: 'inherit' });
}
if (!fs.existsSync(path.join(contentRoot, 'Mana Ledger.exe'))) {
  console.error(`No build found at ${contentRoot} — run without --skip-build.`);
  process.exit(1);
}

// Generated fresh each run so the description carries the real version.
const vdfPath = path.join(root, 'dist', 'steam-app-build.vdf');
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(vdfPath, `"AppBuild"
{
  "AppID" "${cfg.appId}"
  "Desc" "Mana Ledger v${version} (steam channel)"
  "BuildOutput" "${logDir.replace(/\\/g, '\\\\')}"
  "ContentRoot" "${contentRoot.replace(/\\/g, '\\\\')}"
  "SetLive" "${cfg.branch || ''}"
  "Depots"
  {
    "${cfg.depotId}"
    {
      "FileMapping"
      {
        "LocalPath" "*"
        "DepotPath" "."
        "Recursive" "1"
      }
    }
  }
}
`);

const steamcmd = process.env.STEAMCMD || 'steamcmd';
console.log(`Uploading v${version} to app ${cfg.appId}, depot ${cfg.depotId}…`);
const r = spawnSync(steamcmd, ['+login', cfg.account, '+run_app_build', vdfPath, '+quit'], { stdio: 'inherit', shell: false });
if (r.error && r.error.code === 'ENOENT') {
  console.error('\nsteamcmd not found. Install it and add to PATH, or set STEAMCMD to the exe path.');
  process.exit(1);
}
process.exit(r.status ?? 1);
