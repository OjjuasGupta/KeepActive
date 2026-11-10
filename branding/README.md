# KeepActive brand assets

The KeepActive identity is the **Presence** mark: a cream disc with a status
badge cut into its upper-right shoulder, on a crimson superellipse tile. It
abstracts the universal "available" indicator. The design is flat, with no
letterform, glow or bevel, and stays legible from the 16 px Chrome toolbar
icon up to the store listing.

## Files

| File | Purpose |
|---|---|
| `keepactive-mark.svg` | Production vector mark (512 × 512, transparent corners) |
| `keepactive-mark-2048.png` | High-resolution master render |
| `keepactive-lockup.png` | Horizontal mark + wordmark, transparent, for light backgrounds |
| `keepactive-lockup-dark.png` | Horizontal mark + wordmark, transparent, for dark backgrounds |
| `keepactive-lockup-cream.png` | Lockup on the brand cream background |
| `keepactive-lockup-crimson.png` | Lockup on the brand crimson background |
| `keepactive-brand-sheet.png` | 2400 × 1500 brand presentation: mark, lockup, states, sizes, palette |
| `render.html` | Exact SVG/canvas renderer used to export the PNG icon set |
| `concepts.html` | The three symbol concepts reviewed (Awake, Presence, Steady pulse) |
| `preview.html` | Toolbar and pixel-level QA sheet |

## States

The badge carries the toolbar state, so the icon is readable without colour:

| State | Icon files | Tile | Badge |
|---|---|---|---|
| Active | `icon16/32/48/128.png`, `icon-green-*.png` | Crimson | Solid dot |
| Paused / off-schedule | `icon-green-dim-*.png` | Stone | Ring |
| Disabled | `icon-red-*.png` | Charcoal, dimmed disc | Empty notch |

The `green` / `dim` / `red` file names are kept so `../background.js` needs no
changes. They name the states, not the colours.

## Optical sizing

- **48 / 128 px and larger**: full proportions, a faint vertical tile gradient,
  and a top-edge highlight.
- **32 px**: a larger disc and badge, a wider notch, no highlight.
- **16 px**: larger again, with a notch wide enough to keep the badge
  visibly separate on the toolbar.
- The tile is a true superellipse (n = 5), not a rounded rectangle.

## Palette

| Token | Hex | Use |
|---|---|---|
| Crimson | `#A11D2C` | Primary brand colour, accents |
| Crimson light / deep | `#B02536` → `#8A1626` | Active tile gradient |
| Cream | `#F6EDDF` | Mark, light backgrounds |
| Ivory | `#F3EFE5` | Brand presentation background |
| Stone | `#9C9084` → `#7D7268` | Paused tile |
| Charcoal | `#3D3532` → `#2A2422` | Disabled tile, wordmark text (`#2A2220`) |

## Regenerating

1. Open `render.html` in the test Chrome instance.
2. Call `renderIcon(state, size)` for each state (`green`, `dim`, `red`) and size.
3. Write the returned PNG data URLs to `../icons/`.
4. Rebuild the packages with `..\tools\build.ps1`.

After rebuilding, `../tools/capture-store-assets.mjs` recaptures the store
screenshots and promo tile from the packaged build (see its header for setup).
