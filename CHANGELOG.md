# Changelog

All notable changes to Secret Lair Tracker are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/).

**How this works:** add notes under **[Unreleased]** as you make changes.
`npm run release:tag -- <patch|minor|major>` promotes that section to the new
version (stamped with today's date) and opens a fresh empty [Unreleased]. The
release workflow then sets each GitHub release's notes — and therefore the
in-app "What's New" screen — from that version's section. Keep entries
user-facing: what changed, not how.

## [Unreleased]

## [0.16.0] - 2026-06-20
### Added
- **Value Over Time (Dashboard).** A new line-chart panel tracks your collection's market value going forward — total, cards, and sealed, plotted against your cost basis. One snapshot is recorded each day prices refresh (prices auto-refresh once daily on first open), so the history builds up from now on.

## [0.15.0] - 2026-06-18
### Changed
- **Drop P&L now defaults to the flat Secret Lair MSRP** (≈$29.99 non-foil / $39.99 foil, configurable in Settings → Secret Lair P&L; foil/non-foil picked automatically from the cards you own) instead of summing cheap per-single purchase prices — since Secret Lair is bought as whole drops. A sealed product linked to the drop still overrides it with its actual price; assumed costs are marked with "≈".
### Added
- **Singles vs. Sealed on each drop page** — compare completing a drop by buying its individual cards (priced on demand from Scryfall) against buying the sealed box (from a linked product, or the TCGCSV index after a sync), with a verdict on which is cheaper — and the crack-or-keep verdict when you hold it sealed.

## [0.14.0] - 2026-06-18
### Added
- **Crack or Keep (Secret Lair Explorer).** On a drop you hold sealed, a new panel compares keeping it sealed (its sealed market value) against cracking it open (the current sum of its singles, fetched on demand from Scryfall) — with a clear verdict on which is worth more and by how much.

## [0.13.0] - 2026-06-18
### Added
- **Drop P&L in the Secret Lair Explorer.** A new **💰 P&L** view lists each drop you've engaged with — **MSRP paid** (purchase price of linked sealed products) vs. **current value** (your singles + any still-sealed copies) — with sortable gain/loss columns, totals, and a "best buy" marker. Each drop's detail page shows a compact P&L summary too.
- **Link a sealed product to its drop:** new optional "Secret Lair Drop" field on the add/edit sealed form (auto-filled when you add a drop to Sealed), which powers the P&L cost basis.

## [0.12.2] - 2026-06-18
### Reliability
- **Daily backups are now corruption-aware.** Before backing up, the app checks the database's integrity. If it's damaged, the automatic backup is skipped so it can't overwrite your good backups, the damaged file is set aside, and you're warned — and every new backup is verified before older ones are rotated out.
### Fixed
- The update screen now shows your current version instead of "v?".
- Release notes now display in the "What's New" screen.

## [0.12.1] - 2026-06-18
### Fixed
- **Sealed products now stay deleted** — previously a sealed product you removed would reappear after restarting the app.
- Sealed collection saves are now authoritative, so what's stored can't drift from what you see on screen.

## [0.12.0] - 2026-06-18
### Added
- **Secret Lair Explorer — full details on hover for cards you don't own** (type, rules text, rarity, artist, price, and which drop/superdrop it belongs to).
- **In-app updates** — an Update pill appears in the top bar when a new version is available, with a "What's New" view; one click downloads and restarts into the new version.
