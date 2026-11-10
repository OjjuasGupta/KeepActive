# KeepActive brand assets

The KeepActive identity is a custom geometric **K monogram** on a deep forest
squircle with a mint gradient. It replaces the old red/white concentric-ring
icon and is designed to stay legible from a 16 px Chrome toolbar icon to the
128 px store listing.

## Files

| File | Purpose |
|---|---|
| `keepactive-mark.svg` | Production vector mark (512 × 512, transparent corners) |
| `keepactive-mark-2048.png` | High-resolution master render |
| `keepactive-lockup.png` | Horizontal mark + wordmark, transparent, for light backgrounds |
| `keepactive-lockup-dark.png` | Horizontal mark + wordmark, transparent, for dark backgrounds |
| `keepactive-lockup-cream.png` | Lockup on the brand ivory background |
| `keepactive-lockup-forest.png` | Lockup on the brand forest background |
| `keepactive-brand-sheet.png` | 2400 × 1500 brand presentation: mark, lockup, states, sizes, palette |
| `render.html` | Exact SVG/canvas renderer used to export the PNG icon set |
| `preview.html` | Toolbar and pixel-level QA sheet |

The production icons live in `../icons/`:

- `icon16/32/48/128.png` — default brand icon (same as active)
- `icon-green-16/32/48/128.png` — active state
- `icon-green-dim-16/32/48/128.png` — paused or off-schedule
- `icon-red-16/32/48/128.png` — disabled

## Optical sizing

- **16 / 32 px** drop the glow, rim light, and gradient. The K uses a thicker
  stroke and a solid mint fill so Chrome's rasterizer keeps the silhouette.
- **48 / 128 px** use the full gradient, a subtle rim, and a soft ambient glow.
- The K is optically centered inside the squircle rather than mathematically
  aligned to the old artwork.

## Palette

| Token | Hex | Use |
|---|---|---|
| Forest | `#0C3B2F` | Primary squircle, light edge |
| Deep forest | `#041A15` | Squircle shadow edge |
| Mint | `#3EE0A1` | K gradient midpoint, active accent |
| Mint light | `#D6FBEA` | K gradient highlight |
| Forest deep | `#047857` | K gradient shadow |
| Ivory | `#F3EFE5` | Brand presentation background |
| Sage | `#8AA99A` | Paused / dim K |
| Maroon | `#351218` | Disabled squircle |
| Rose | `#FB7185` | Disabled K |

## Regenerating

1. Open `render.html` in the test Chrome instance.
2. Call `renderIcon(state, size)` for each state and size.
3. Write the returned PNG data URLs to `../icons/`.
4. Rebuild the packages with `..\tools\build.ps1`.

`../background.js` keeps the original icon filenames and state mapping, so the
new assets drop in without code changes.
