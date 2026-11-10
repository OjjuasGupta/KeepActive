# Changelog

All notable changes to KeepActive are recorded here. Versions match `manifest.json`.

## 1.1.0 — 2026-11-10 (first Chrome Web Store submission)

### Added
- Occasional neutral click on the Teams page background (never buttons, links or inputs); on by default, toggle in the Control Deck.
- Occasional focus and visibility pings while the Teams tab is visible.
- Per-site toggles for `teams.microsoft.com` and `teams.cloud.microsoft`.
- Real keyboard, mouse, wheel and touch input in Teams tabs triggers Smart Pause immediately.
- Diagnostic Console entry for every activity cycle.
- Privacy policy contact section (`filmfrenzy777@gmail.com`); public copy published from `docs/` via GitHub Pages.
- Landing page in `docs/` with a self-hosted 3D scene (`site/`), reduced-motion fallback and social preview image.

### Changed
- New Crimson & Cream "Presence" logo; toolbar badge shows active, paused and off states.
- 128 px icons now follow Chrome Web Store guidance (96 px artwork, 16 px transparent padding).
- Pointer events target the element under the pointer instead of the document.
- Setup guide accurately describes the optional background click.
- Store screenshots recaptured from the packaged build (`tools/capture-store-assets.mjs`).

### Fixed
- Lost diagnostic log entries: the content script now forwards entries to the service worker, which is the single writer.

## 1.0.0

- Initial internal release: display keep-awake, Teams Web activity, work schedule, Smart Pause and optional native helper (full build only).
