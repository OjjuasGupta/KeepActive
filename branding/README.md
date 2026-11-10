# KeepActive brand assets

The KeepActive identity is the **Emerald & Gold** mark: a high-contrast gold
K (heavy stem and leg, hairline arm) inside an open gold ring. The ring's gap
holds a single gold dot, an "always on" indicator. Everything sits on a deep
emerald squircle with a champagne hairline bevel. It is built to stay legible
from the 16 px Chrome toolbar icon up to the store listing.

## Files

| File | Purpose |
|---|---|
| `keepactive-mark.svg` | Production vector mark (512 × 512, transparent corners) |
| `keepactive-mark-2048.png` | High-resolution master render |
| `keepactive-lockup.png` | Horizontal mark + wordmark, transparent, for light backgrounds |
| `keepactive-lockup-dark.png` | Horizontal mark + wordmark, transparent, for dark backgrounds |
| `keepactive-lockup-cream.png` | Lockup on the brand ivory background |
| `keepactive-lockup-forest.png` | Lockup on the deep emerald background |
| `keepactive-brand-sheet.png` | 2400 × 1500 brand presentation: mark, lockup, states, sizes, palette |
| `render.html` | Exact SVG/canvas renderer used to export the PNG icon set |
| `preview.html` | Toolbar and pixel-level QA sheet |

The production icons live in `../icons/`:

- `icon16/32/48/128.png` — default brand icon (same as active)
- `icon-green-16/32/48/128.png` — active state (emerald tile)
- `icon-green-dim-16/32/48/128.png` — paused or off-schedule (slate tile, muted gold)
- `icon-red-16/32/48/128.png` — disabled (garnet tile)

## Optical sizing

- **48 / 128 px and larger** use the full mark: ring, dot, hairline bevel,
  top-left sheen, and a soft drop shadow under the gold.
- **32 px** drops the bevel, sheen, and shadow, and thickens the ring and
  every K stroke.
- **16 px** drops the ring and enlarges the K so the gold silhouette survives
  toolbar rasterization.
- The K sits slightly left of centre to balance the leg optically, and its
  terminals are cut horizontally.

## Palette

| Token | Hex | Use |
|---|---|---|
| Emerald | `#11785A` | Active tile, light edge |
| Deep emerald | `#033023` → `#011A13` | Active tile, shadow edge |
| Gold | `#C99A3D` | Mark midtone, accents |
| Champagne | `#FFF4D6` → `#EBCB83` | Gold highlight |
| Antique gold | `#8F6420` | Gold shadow, accent text on light backgrounds |
| Ivory | `#F3EFE5` | Brand presentation background |
| Slate | `#3E5A51` | Paused tile |
| Garnet | `#7A1F33` | Disabled tile |

## Regenerating

1. Open `render.html` in the test Chrome instance.
2. Call `renderIcon(state, size)` for each state (`green`, `dim`, `red`) and size.
3. Write the returned PNG data URLs to `../icons/`.
4. Rebuild the packages with `..\tools\build.ps1`.

`../background.js` keeps the original icon filenames and state mapping, so the
new assets drop in without code changes. `../store-assets/patch-logo.html`
replaces the logo inside the existing store screenshots without recapturing
them.
