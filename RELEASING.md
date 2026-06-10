# Releasing

The app uses [electron-updater](https://www.electron.build/auto-update) with the
GitHub Releases provider. A push to a `v*` tag triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml), which builds
the Windows installer and uploads it (plus `latest.yml`) as release assets.
Installed copies of the app pick it up via Settings → Updates.

## One-command release

```sh
npm run release:tag -- patch    # 0.5.0 -> 0.5.1
npm run release:tag -- minor    # 0.5.0 -> 0.6.0
npm run release:tag -- major    # 0.5.0 -> 1.0.0
npm run release:tag -- 0.7.2    # explicit
```

The script bumps `package.json`, commits, tags, and pushes. CI does the rest.

## Manual release

```sh
# 1. Bump version, commit, tag
npm version patch          # or minor / major / x.y.z
git push --follow-tags

# 2. CI runs automatically. To build locally instead:
$env:GH_TOKEN = "<personal access token with repo scope>"
npm run release
```

## Verifying

1. After CI finishes, check
   <https://github.com/ArielKaplan/magic_collection_tracker/releases> — the new
   release should have `Secret Lair Tracker Setup X.Y.Z.exe`, `latest.yml`,
   and a `.blockmap`.
2. Open an older installed copy of the app → Settings → **Check for Updates**.
   It should report the new version and offer to download.

## Code signing (TODO)

Windows shows a SmartScreen warning for unsigned installers. To remove it, get a
code-signing certificate and set these GitHub Actions secrets:

- `CSC_LINK` — base64 of the `.pfx` file (or an `https://` URL)
- `CSC_KEY_PASSWORD` — the cert password

electron-builder picks them up automatically; no workflow changes needed.

## Notes

- Don't edit `latest.yml` by hand — it's generated and signed against the
  installer's blockmap.
- The startup check is silent (no toast unless an update exists). Manual checks
  happen in Settings → Updates. Both are disabled in dev mode (`npm run dev`).
