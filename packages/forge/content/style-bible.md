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

The 40-color master palette governs UI chrome, tints, and terrain, and is a JUDGE HARMONY criterion for sprites — it is no longer a per-pixel clamp on generated sprites (quantize retained for terrain pending its first generation).

Sprites ship UNQUANTIZED: character cells and reference sprites keep their generated colors (hard quantization proved a visual regression). Cross-asset palette cohesion is judge-enforced; revisit mechanical harmonization only when multiple characters exist.

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

- Sprites carry their own outlines (the generated art includes a dark silhouette outline) — NO outline pass on sprites.
- No outlines on terrain.
- The mechanical outline pass (darken factor 0.55) is retained for terrain pending its first generation.

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
- Native-resolution sprites (pipeline v4: measured fractional pitch + mode resample at natural heights — no forced art height, no quantize, no outline pass) on 96×96 cells, feet-anchored at y=88 (128×128/y=118 if any cell's art exceeds 88px).
- Art resolution is DECOUPLED from world size: the renderer scales the character to ~1.6 tiles regardless of art pixel count. "Canonical density" means the pitch the raws actually carry, measured per sheet and recorded — character sheet: 5.12; anchor building: 4.00.

## Atmosphere

- Stylized-dramatic grading: deep blue moonlit nights with warm window glow, golden dawns, grey-green storm light, snow-blued winters.

## Canonical style anchor

- `content/reference/style-anchor.png` (the approved T6 cottage raw) is THE art-style reference for the entire simulation: pixel density ("blocky but not too much"), palette warmth, cute rounded style.
- Measured: detectArtScale = 4 on the 512px generation canvas → effective art resolution 128×128 (each art pixel ≈ 4 source px).
- LAW: style-anchor.png is the FIRST input_reference on EVERY generation (all classes) and the FIRST judge refSheet.
- style-anchor.png stays RAW — never post-processed. It is the generation/judge reference, not a shipped sprite.
- Prompts for non-character classes append: "match the pixel density, palette warmth, and cute rounded style of the first reference image exactly".

## Facings

- Characters: 4 dimetric facings (sw, se, ne, nw) × 3 poses (idle, walk-a, walk-b) per sheet; cells 96×96 at art height 64 (feet-anchored at y=88), sheet 384×288. Column order sw, se, ne, nw (left→right) and row order idle, walk-a, walk-b (top→bottom), as in `sheet.ts`. Walk animation = idle, walk-a, idle, walk-b loop.
- Buildings: up to 2 authored facings — door-sw (default) and door-se variant; codex id suffix `#se`. NEVER mirror sprites: light is locked from the north-west (mirroring flips it).
- Engine note: Structure has no facing field yet (C2); facing is asset-selection-only until then.
