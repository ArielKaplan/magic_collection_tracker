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

## [0.21.0] - 2026-06-22
### Added
- **One place to import everything.** Your card collection, sealed products, and decks now come in through a single **Import** wizard — pick what you're importing on one screen, reachable from **File → Import…** (Ctrl+I) or the new **↑ Import** button on each tab. The card CSV column-mapper and the decklist importer work exactly as before; they just live in one workflow now instead of three separate places.
- **Sealed product import.** You can finally bring sealed products back in from a CSV — including this app's own sealed export — so a wipe-and-restore now covers your shelf, not just your cards. Columns auto-match, and re-importing a product you already have (same name, type, and set) updates it in place instead of creating a duplicate.

### Fixed
- **The sealed export now includes the Secret Lair Drop column**, so the drop each product is linked to survives an export → re-import round-trip.

## [0.20.0] - 2026-06-22
### Added
- **The Secret Lair Index — your drops as an asset class.** A new **📈 Index** view in the Secret Lair Explorer treats your Secret Lair holdings as an investment: **MSRP paid → current value → unrealized gain → realized gain → total return** (holdings + flips combined, the v0.20.0 sell data folded in), plus a **best & worst drops** leaderboard, an **ROI distribution** (how many drops are up vs. down and by how much), and a **crack-vs-keep** rollup across the drops you hold sealed. A matching **Secret Lair Index** dashboard panel charts your SL market value vs. the MSRP you paid **over time** (one point per day prices refresh). It's the question no other tool answers: *has Secret Lair actually paid off for me?*
- **Realized gains — sell tracking.** Cards and sealed products can now be **sold** instead of deleted: right-click → **💵 Sell / dispose** records the proceeds, fees, date, and a note (sell part of a stack and the rest stays in your collection). Sold items leave your value and cost-basis totals but live on as a realized-P&L record. A new **Sold** view in the Card Collection (status dropdown) shows the ledger — proceeds, fees, net gain, and % per sale — and the Sealed tab gets a **Sold** filter. Two new dashboard panels: a **Realized Gains** KPI (lifetime net locked in) and **Realized Gains by Year**. "Undo sale" puts anything back. Deleting is still there for fixing mistakes, but it no longer hides a sale from your P&L.
- **Honest cost basis & totals.** Because sold items are now tracked rather than removed, your Cost Basis, Total Value, collection stats, Secret Lair drop P&L, deck ownership, and want-list "missing" all count only what you still own.

## [0.19.0] - 2026-06-20
### Added
- **Sort controls in the Card Collection Gallery view** — sort the card-image grid by Name, Card #, Value, Rarity, or mana value (CMC); click the active option again to flip the direction. The chosen order carries over to the Table view too.
- **Gallery view for the Want List** — a Table/Gallery toggle, matching Card Collection. Cards at/under their target get a gold ring + 🎯.
- **Gallery view for Decks** — a List/Gallery toggle on the deck page; in the grid, cards you don't own a full playset of are dimmed with an ownership badge.
- **Own / Missing filter + missing-card actions on decks.** Filter a deck to **All / Owned / Missing**, and act on the cards you're short: **🛒 Buy missing** opens them on TCGPlayer Mass Entry (straight into your cart), **★ Want missing** adds them to your Want List, and **⧉ Copy** copies them as a text list.

## [0.18.0] - 2026-06-20
### Changed
- **Gallery is now a view inside Card Collection, not a separate tab.** Card Collection has a **Table / Gallery** toggle (like the Secret Lair Explorer's view switcher) — both share the same binder sidebar, search, and filters, so you can flip between the spreadsheet and the card-image grid without losing your place. The standalone Gallery tab has been removed.

## [0.17.0] - 2026-06-20
### Reliability
- **Fixed a database-corruption risk.** The app now refuses to run a second copy of itself (a second window just focuses the one already open) and closes the database cleanly on exit. Two copies writing the same database file at once was the most likely cause of the rare "database is malformed" errors; this closes that hole.
### Added
- **Want list + price watch.** A new **Want List** tab (Ctrl+8) tracks cards you're hunting, with an optional target price per card. After each price refresh, any card at or below its target is flagged — with a toast, an activity-log entry, and a green count badge on the tab. Add cards by right-clicking a missing card or an incomplete drop in the Secret Lair Explorer (★ "Add missing to want list" turns any unfinished drop into a shopping list), from the card's detail popup, or by searching Scryfall by name. Missing cards on your want list show a ★ in the Explorer, and a new dashboard "Want List" KPI shows the count, total cost to acquire, and how many have hit your target. Acquiring a card removes it from the list automatically.

## [0.16.1] - 2026-06-20
### Fixed
- **Release notes now render properly in the "What's New" screen** — headings, bullet lists, and bold text show formatted instead of as raw HTML tags.

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
