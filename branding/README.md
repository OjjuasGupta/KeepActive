# KeepActive brand assets

The KeepActive identity is the **Crimson & Cream** mark: a flat, stencil-cut
K. A solid stem and a single mitred chevron are separated by a thin cut of
negative space, set in cream on a crimson superellipse tile. There are no
glows, bevels or drop shadows. It is built to stay legible from the 16 px
Chrome toolbar icon up to the store listing.

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
| `preview.html` | Toolbar and pixel-level QA sheet |

The production icons live in `../icons/`:

- `icon16/32/48/128.png` — default brand icon (same as active)
- `icon-green-16/32/48/128.png` — active state (crimson tile)
- `icon-green-dim-16/32/48/128.png` — paused or off-schedule (stone tile)
- `icon-red-16/32/48/128.png` — disabled (charcoal tile, dimmed mark)

The `green` / `dim` / `red` file names are kept so `../background.js` needs no
changes. They name the states, not the colours.

## Optical sizing

- **48 / 128 px and larger**: full proportions, plus a faint vertical tile
  gradient and a top-edge highlight.
- **32 px**: heavier stem and chevron, a wider cut, and a slightly larger mark.
  The highlight is dropped.
- **16 px**: heavier again, with a cut wide enough (about 1 px) to stay open on
  the toolbar.
- The tile is a true superellipse (n = 5), not a rounded rectangle. The mark
  is centred on its full width, stem to arm tips.

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

`../store-assets/patch-logo.html` replaces the logo inside the existing store
screenshots without recapturing them.
