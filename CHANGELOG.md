# Changelog

All notable changes to Mana Ledger (formerly Secret Lair Tracker) are recorded here.
The format follows [Keep a Changelog](https://keepachangelog.com/).

**How this works:** add notes under **[Unreleased]** as you make changes.
`npm run release:tag -- <patch|minor|major>` promotes that section to the new
version (stamped with today's date) and opens a fresh empty [Unreleased]. The
release workflow then sets each GitHub release's notes — and therefore the
in-app "What's New" screen — from that version's section. Keep entries
user-facing: what changed, not how.

## [Unreleased]
### Changed
- **Mana Ledger has a new home.** The project now lives under its studio, Sarcastic Software Studios — new website at sarcasticsoftwarestudio.github.io/magic_collection_tracker. Nothing changes on your end: updates keep arriving automatically, and your data is untouched.

## [1.0.8] - 2026-07-11
### Fixed
- **The account corner no longer shows a hardcoded name.** The bottom-left vault chip said "Akapl" for every user (a leftover from development); it now reads "My Collection".

## [1.0.7] - 2026-07-11
### Changed
- **Feedback now sends straight from the app.** Help → Send Feedback delivers your message directly to the developer with one click — no email app needed (there's an optional field for your address if you'd like a reply). If the feedback service is ever unreachable, it falls back to the old open-your-email-app flow.

## [1.0.6] - 2026-07-11
### Fixed
- **The "Value Over Time" and "Secret Lair Index" charts were stuck on "no history yet"** even after weeks of daily snapshots — a chicken-and-egg bug where the chart couldn't draw until its canvas appeared, and the canvas couldn't appear until the chart drew. Both dashboard charts now show your full value history.

## [1.0.5] - 2026-07-11
### Added
- **The app now remembers your window.** Size, position, and maximized state are restored on launch (and safely reset if your monitor setup changed).
- **A crash safety net.** If the app ever hits a fatal error, you'll get a clear dialog — restart, or copy the technical details to send along — instead of a silent exit or a frozen white window. Your collection and backups are untouched either way.
- **Help → Keyboard Shortcuts** — all the Ctrl-keys on one card.
- **Groundwork for one-click feedback.** The feedback form can now deliver straight from inside the app once the delivery service is switched on; until then it keeps using your email app.

## [1.0.4] - 2026-07-11
### Added
- **💬 Send Feedback.** Help → Send Feedback (also in Settings → Support) opens a short form; hitting send opens your own email app with the message pre-addressed to the developer. Nothing is sent in the background, and your collection data is never included.

### Changed
- **About dialog now carries the Wizards Fan Content Policy notice** (the legal line all MTG fan projects are required to display).

## [1.0.3] - 2026-07-11
### Changed
- **The coffee cup moved up front.** The Ko-fi support button now sits next to the Mana Ledger logo in the top-left corner — one click, always visible, instead of tucked away in Settings and the Help menu (it's still in those places too).

## [1.0.2] - 2026-07-11
### Added
- **♥ Support Mana Ledger.** The app is free and always will be (Wizards' fan-content rules require it, and we like it that way). If it's earned a spot in your toolbox, there's now a Ko-fi donation link in Settings, the About dialog, and the Help menu. Entirely optional — donations fund the coffee that funds the code.

## [1.0.1] - 2026-07-11
### Security
- **Major engine update.** The app's underlying browser engine (Electron/Chromium) jumped from a 2024 build to the current, fully security-patched release — nine major versions of Chromium security fixes, applied in one update. Nothing changes in how the app looks or works; this is pure under-the-hood protection, and it's the kind of update that will now happen routinely.

## [1.0.0] - 2026-07-10

### Milestone
- **Version 1.0 — and a new name: Mana Ledger.** Same app, same data — nothing moves, nothing re-imports, updates keep arriving automatically. The new name is one that can stand on a public storefront (a free Steam release is in the works; "Secret Lair" is Wizards of the Coast's trademark, so it stays in the app's descriptions, not its title). The 1.0 stamp marks what the last months built: a first-run welcome, one-click verified backup restore, releases that can't ship with failing tests, a locked-down renderer (strict Content-Security-Policy), price sources that fail soft instead of crashing — and the deepest Secret Lair + precon dataset of any tracker.

### Changed
- **Window title, installer, and in-app branding now say Mana Ledger.** Your database location, settings, and backups are completely untouched by the rename.
- **About dialog now shows the real installed version** (it was stuck displaying "0.4.0" forever).
- **Steam groundwork under the hood:** a Steam-channel build that leaves all updating to Steam. GitHub-channel installs (this one) are unaffected and keep self-updating.

## [0.38.0] - 2026-07-10
### Added
- **Filter your collection by color.** The Card Collection filter bar now has the five mana-color pips plus colorless. Select any combination and the view narrows to cards whose color identity fits inside it — pick blue + green and you'll see your mono-blue, mono-green, and Simic cards, nothing else. Works in Table, Gallery, and Sold views, and stacks with search and every other filter.

### Changed
- **The Binders button found a better home.** It moved from the floating pill in the bottom-left corner (where it sat on top of the vault area) into the filter bar next to the Table/Gallery toggle — and it now lights up whenever a binder filter is active, so you can tell at a glance why your list looks short.

## [0.37.0] - 2026-07-07
### Security
- **Locked-down scripting (the last hardening step).** Every button, link, and control in the app moved off inline JavaScript onto a single safe event system, so the app can now enforce a strict Content-Security-Policy that forbids inline scripts entirely. In plain terms: even if hostile text ever slipped past the app's other defenses — from a shared collection file or, later, community-shared curation — the browser engine simply won't run it. This closes the last known avenue for a malicious file to execute code in the app.

## [0.36.0] - 2026-07-05
### Security
- **Stronger protection against malicious shared files.** The app now enforces a Content-Security-Policy — locking down where it can load resources from and blocking an injected script from phoning out to anywhere except the known card-data services — and it sanitizes the text in imported CSVs, so a booby-trapped collection file a friend sends you can't slip active content into the app. (Belt-and-suspenders on top of the escaping that was already there.)

## [0.35.0] - 2026-07-05
### Changed
- **Every release is now automatically tested before it ships.** The build pipeline runs the full unit-test and smoke-test suite first, and won't publish an update if anything fails — so a regression can't reach your copy of the app.

## [0.34.0] - 2026-07-05
### Added
- **A proper welcome for new users.** On a fresh install the app now greets you with a one-screen intro — what it's for, and a single button to import your collection (ManaBox / Moxfield / Archidekt CSV) — so you're not staring at an empty app wondering where to start. It appears once and never nags again.
- **One-click restore from a backup.** Settings now has a **Backups & Recovery** section: the app already makes a verified backup every day (keeping the latest 10), and you can now restore any of them with one click — the app checks the backup is healthy, sets your current data aside first (so a restore can be undone), swaps it in, and restarts. There's also a **Back up now** button and a shortcut to open the backups folder. No more needing a techie to recover your data.

## [0.33.2] - 2026-07-05
### Added
- **Jumpstart decks in the Precon Explorer.** The 570 Jumpstart half-decks (2020, 2022, and the set-based ones) are now in the catalog, tucked behind a **"Show Jumpstart"** toggle on the Explorer's landing page so they don't crowd the everyday product lines.
- **Exact sealed prices for precons.** Where a precon's sealed product is known to TCGplayer (813 decks), its "Worth it?" sealed price now comes from an exact product-ID match instead of a name guess — the right box, every time. Older product lines (Theme Decks, Intro Packs, Duel Decks, and more) are now indexed by the price sync too, so they can show a sealed price at all.

### Changed
- **Under the hood: real unit tests.** Added a Vitest suite covering the trickiest pure logic — CSV import parsing, decklist parsing, the search matcher, and the Secret Lair finish-aware model — so these keep working as the app evolves. Your catalog also self-updates to the expanded precon dataset on launch (no reset needed).

## [0.32.0] - 2026-07-04
### Added
- **Search now finds a card everywhere it lives.** Type a card name and, alongside your owned copies, the results now show every place that card turns up: **decks that play it** (click → jump to the deck), **Secret Lair drops that include it**, **precon decks that run it** (click → the decklist), and **sealed products that contain it** — so a sealed Secret Lair shows up when you search a card printed inside it. Each cross-reference row is tagged with "contains <card>" so it's clear why it matched, and occurrence rows in the full results view get the usual hover preview. Searching a product or deck by its own name works exactly as before.

## [0.31.0] - 2026-07-04
### Added
- **Live wiki sync — real MSRPs, fresh superdrops, and upcoming drops.** "Check for New Cards" now also pulls the community wiki's Drop Series table: **Drop P&L uses each drop's actual MSRP** (non-foil and foil priced separately — a $51.99 drop no longer pretends it cost $29.99), brand-new drops land under their **real superdrop** the moment the wiki knows it instead of waiting in "Recent Additions" for an app update, and the Explorer's landing page shows a **🔮 Upcoming** strip of announced-but-unreleased drops with their dates and prices.
- **Scryfall bulk data — price refreshes in seconds.** The app now downloads Scryfall's complete daily price file (~500 MB, once a day, in the background) and prices everything locally: full collection refreshes, Secret Lair singles pricing, precon tables, and printings tabs all skip the rate-limited API — no more 429 backoffs mid-refresh. It's on by default and can be turned off in Settings → Price Data if bandwidth matters more than speed.

### Changed
- **Security hardening in the Secret Lair Explorer.** All interactive elements in the Explorer (and the card tiles it shares with the Precon Explorer) moved off inline JavaScript onto a safer delegated event system — groundwork for safely importing community-shared curation down the road.

## [0.30.0] - 2026-07-03
### Added
- **Table view for precon decklists.** Every precon deck page now has a **🖼 Gallery / 📊 Table** toggle: the table shows each card's **mana cost, color, type, rarity, finish, quantity, and current price** in sortable columns (click any header), with an owned ✓/✗ per card and the same hover previews. Card data loads once per deck from Scryfall and also powers the "Worth it?" singles total.
- **The Secret Lair Commander decks are in the Precon Explorer.** Goblin Storm, Heads I Win Tails You Lose, From Cute to Brute, Angels, Raining Cats and Dogs, 20 Ways to Win, and Everyone's Invited! now appear as full playable decklists (~100 cards each) under Commander Decks — while the SL Explorer keeps showing their collectible SLD printings. They straddle both worlds, so now they live in both.
- **New precons arrive on their own.** The daily refresh now quietly checks MTGJSON's deck catalog and appends any newly released precons — no button-clicking required (the ↻ button is still there for impatience).

### Fixed
- **Secret Lair Commander decks were nearly empty in the Explorer.** Goblin Storm (and the other SL Commander drops) showed only one or two cards — their product records were being skipped. They now show all of their Secret Lair printings (~20 cards each).
- **Ghost "Secret Lair Bundle …" entries with zero cards** no longer appear — a few multi-drop bundle products were mislabeled in the source data and slipped in as empty drops.
- **June's drops now group properly.** The built-in Secret Lair dataset was rebuilt from source (362 drops, every one resolved to its superdrop) — Witch's Familiar and the rest of the Cats Are the Best Superdrop, Goblin Storm, and other recent drops now sit under their real superdrops instead of piling up in "Recent Additions" (where the base and Foil versions read like duplicates).

## [0.29.0] - 2026-07-03
### Added
- **The Precon Explorer.** A new section in the rail (Ctrl+9) that catalogs **every physical preconstructed deck Magic has ever sold — 975 decks from 1993 to today**: Commander precons, Challenger and Duel Decks, Theme Decks, Intro Packs, Planeswalker Decks, World Championship decks, Guild Kits, and more. Browse product line → deck → full decklist with the same card tiles, hover previews, and owned/missing indicators as the Secret Lair Explorer — ownership is finish-aware, so a Collector's Edition foil slot only lights up for a foil copy. Each deck shows its **color identity, commander, release date, and completion bar**, and a **"Worth it?" panel** compares the deck's assumed MSRP against the current value of its singles (priced on demand) and the sealed market price, with a verdict. **★ Want missing** turns any partly-owned precon into a shopping list.
- **Precons in global search.** Deck names, commanders, and set codes now match in the command-bar search — jump straight to any precon's decklist.
- **"Came in a precon" on card popups.** A card's detail popup now lists the preconstructed decks that printing shipped in, with one-click links to each deck.
- **Always current, never stale.** Decklists never change once printed, so the catalog ships built-in and a **↻ Check for New Precons** button fetches just the decks released since — a few seconds, not a re-download.

## [0.28.0] - 2026-07-02
### Changed
- **Foil and non-foil Secret Lair drops are now truly distinct.** The Explorer's drop data is rebuilt on a per-product basis straight from MTGJSON's sealed-product catalog — each purchasable version of a drop (non-foil, Foil Edition, Rainbow Foil, …) now knows exactly which printings it contains and in which finish. Owning a non-foil card no longer lights up the foil drop as owned (and vice versa), special foil printings (the ★ collector numbers) count toward the foil version they actually belong to, and Drop P&L credits each of your copies to the version you actually hold. Foil-only drops are also priced by their foil values automatically — no more guessing from the drop's name.
- **Exact sealed-price matching.** When a drop's sealed price comes from the TCGCSV index, it now matches by TCGplayer product ID instead of name search wherever possible — the right SKU, every time (takes effect after the next price-data sync).

## [0.27.0] - 2026-07-02
### Added
- **Card previews in search.** Hovering a card in the search dropdown or the Search Results view now shows the same floating card overview used everywhere else — image, price, type, binder, and oracle text at a glance.
- **Click a card you own → straight to its binder.** Clicking an owned card in search results now jumps to the binder holding it (your most valuable copy, if you have several), lands on the right page, scrolls to the card, and pulses it with a brief gold highlight so your eye lands exactly where it should. Cards you don't own still open their detail popup.

## [0.26.0] - 2026-07-01
### Added
- **Full search results, in tabs.** Press Enter in the search box (or hit "See all") to open the **Search Results** view — now with **live catalog search**: your matches are joined by results straight from **Scryfall** (every card) and the **sealed catalog (TCGCSV)**, grouped into sections with owned/not-owned dots. Each search opens as its own **pinned tab**, so you can keep several searches side-by-side and flip between them to compare. **"View all printings ◇"** (on any card result or in a card's detail popup) opens a dedicated tab listing every printing of that card with prices. Open tabs are **remembered between sessions**, and you can close any you're done with.

### Changed
- **Sharper search matching.** Search now matches whole-word starts instead of any substring, so typing "ring" finds *The One Ring* without also dredging up *Sheoldred, Whispering One* — while partial typing like "trea" → *Treasure* still works.

## [0.25.0] - 2026-07-01
### Added
- **Global search in the command bar.** Start typing in the top search box and get instant, grouped results across your collection and the Secret Lair catalog — **Cards** (with an owned/not-owned dot and how many printings you hold), **Sets, Binders, Sealed, Decks, Want List, Secret Lair drops,** and **Failed Lookups**. Click any result to jump to it; clicking a card opens its details with a **"View in collection"** link. **⌘K / Ctrl+K** focuses the box, and **Enter** opens a full **Search Results** view (new item in the rail) with every match. *Coming next: live full-catalog search across Scryfall & TCGCSV, and multiple frozen result tabs for side-by-side comparison.*

## [0.24.0] - 2026-07-01
### Changed
- **New navigation — a left rail instead of top tabs.** The app is now laid out like a desktop trading terminal: a fixed left sidebar holds all your sections (Dashboard, Card Collection, Sealed, Decks, Secret Lair Explorer, Want List, Failed Lookups) with icons and your account at the bottom, a slim command bar up top carries the price-refresh status and a **Refresh Prices** button, and a full-width status bar along the bottom shows your card count, portfolio total, and save state. More room for your data, and everything's one click away from anywhere.

## [0.23.0] - 2026-07-01
### Changed
- **A new look — "Pro Instrument."** The app moves from the violet Material theme to a neutral-dark, trading-terminal palette with restrained gold accents. Gold now carries meaning: it marks the primary action, active navigation, and focus — while your portfolio numbers, prices, and totals read in clean high-contrast white. Tighter type (Inter, with JetBrains Mono for figures), tighter corners, and quieter borders throughout.

### Fixed
- **Finish-aware drop pricing.** A Secret Lair drop's value now follows its finish — a "… Rainbow Foil" or "… Etched Foil" drop is priced from its foil/etched singles instead of the best price across all finishes — so the crack-or-keep math matches what you actually hold.

## [0.22.0] - 2026-06-22
### Added
- **Linking a sealed product to a Secret Lair drop is now a real search.** The "Secret Lair Drop" field on the add/edit sealed form is a proper typeahead: forgiving matching (curly quotes, en-dashes, and apostrophes no longer trip it up), ranked results showing the superdrop and date, keyboard navigation, and suggestions based on the product's name. A "Load latest Secret Lair drops" button pulls the newest list right from the field.
- **Foil and non-foil drops are now distinct.** A Secret Lair data refresh now captures each drop's real finishes (e.g. "Garden Buds Rainbow Foil", "Iron Maiden: Album Art Foil") plus token/deck-only drops the old data source missed entirely (Oishii! Tokens, FINAL FANTASY, Hatsune Miku, Garfield, and more), and the Explorer groups each foil version next to its base drop.

### Fixed
- **No more duplicate drops in the link dropdown** — entries that differed only by punctuation collapse to the canonical name, while foil and non-foil stay separate.

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
