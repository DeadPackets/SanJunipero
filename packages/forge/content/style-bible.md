# San Junipero Style Bible

Versioned doc + reference sheet (the 3 reference images from Task 6), injected into every generation. Locked per spec §7 — agents author the what; the pipeline owns the look.

> **PALETTE STATUS: LOCKED (2026-08-15)** — human sign-off on `out/calibration/palette-tints.png` (Task 4). All assets quantize to this palette; any change requires a new calibration sheet and re-lock.

## Projection & camera

- 2:1 dimetric projection, fixed camera.
- Light always from the north-west.

## Grid

- Base tile: 32×16 px diamond.
- Structures occupy 1×1 … 4×4 tile footprints.

## Detail density

- Mid-res, Stardew-class: ~64px sprite for a 1×1 building.
- Items 16–24px. Characters ~32px tall.

## Palette (40 colors, warm cozy pastel)

Every asset is quantized to this palette, no exceptions.

| Ramp | Hexes |
|---|---|
| Cream stone ×5 | `#FFF6E9` `#F6E8D5` `#E8D5BC` `#D4BC9E` `#B89D7E` |
| Honey wood ×5 | `#F2C879` `#E0A95E` `#C68A48` `#A66E38` `#7E512B` |
| Sage green ×5 | `#DCE8C8` `#B9D19A` `#93B573` `#6F9455` `#4F7040` |
| Dusty rose ×4 | `#F2C6C2` `#E09E9B` `#C47876` `#9E5A5C` |
| Water/sky ×5 | `#D6EAF2` `#A8CFE0` `#7FB0C9` `#5A8CAB` `#3E6786` |
| Warm grey ×5 | `#E9E2DA` `#CFC6BC` `#ABA198` `#857D75` `#5D5751` |
| Shadow darks ×4 | `#43394A` `#322B38` `#241F2B` `#171420` |
| Warm accents ×4 | `#F7A66B` `#E8785A` `#8A6FA8` `#F4E289` |
| Skin tones ×3 | `#F5D3B3` `#D9A876` `#9C6B47` |

## Outlines

- Selective soft outlines: dark shade of the local color (darken factor 0.55) on characters and objects.
- No outlines on terrain.
- The outline pass recolors edges automatically.

## Rendering

- Hard pixels, no anti-aliasing, NEAREST scaling only.

## Mood

- Cutesy, rounded silhouettes, oversized doors and windows.
- Saturated but soft.

## Reference anchor

- Stardew Valley — the sole anchor: proportions, warmth, readable silhouettes.

## Characters

- ~3 heads tall (Stardew-like).
- Age bands (child / adult / elder) must read clearly in the rigs.

## Atmosphere

- Stylized-dramatic grading: deep blue moonlit nights with warm window glow, golden dawns, grey-green storm light, snow-blued winters.
