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
- Native-resolution sprites (pipeline v7, below) on 96×96 cells, feet-anchored at y=88 (128×128/y=118 if any cell's art exceeds 88px). No quantize, no outline pass, no forced art heights.
- Art resolution is DECOUPLED from world size: the renderer scales the character to ~1.6 tiles regardless of art pixel count. "Canonical density" means the pitch the raws actually carry, measured per sheet and recorded — character sheet: 5.12; anchor building: 4.00.

## Pipeline v7 — canonical post chain

1. chromaKey — magenta background → transparency.
2. erodeAlpha(round(pitch/2)) — strips the chroma blend band scaled to the measured pitch.
3. estimatePitch + refineLattice — fractional art pitch by octave-proof gradient comb, then joint pitch×phase polish; sheetPitch = median across a sheet's cells.
4. resampleClusterLattice — one output pixel per art cell; dominant ε-cluster (≤8/channel) of the central 60% window, weighted-mean color.
5. despeckle(3) — removes opaque islands under 3px (removals logged, >2 flagged).
6. fillPinholes(2) — fills fully-enclosed transparent holes ≤2px.
7. sweepMagentaCensus — repaints RARE magenta-predicate colors (count < max(2, 0.5% opaque)) from neighbor mode; frequent matchers (wine outline) are palette and stay.
8. repairOutlineBlends — two-sided blend snap: silhouette pixels within RGB distance 12 of the fill→outline segment commit to their majority side (t ≥ 0.4 → nearest outline color; t ∈ [0.15, 0.4) → inward fill color; t < 0.15 stays — fill-committed within noise). Authored pixel art has no fractional-membership pixels; both targets are existing colors (zero new colors) and outline pixel count grows by at most the outline-snap count (no line-weight change). Gate: reconErr with snapped pixels excluded must match the pre-snap output ±0.0005 (total reconErr vs the eroded source is NOT a gate here — the source contains the blends being removed).
9. registration + feet-anchor — walk frames aligned to their idle by opaque-mask registration; bbox bottom on the feet line.

PRECEDENT (controller-ruled, do not re-litigate): a dimetric diagonal edge with t < 0.15 shading — e.g. building-1's door-base steps — is AUTHORED art, not blend confusion. Inking such pixels to the outline (as the first v7 draft did) is overreach; FILL_T stays 0.15.

RETRACTED: the v4 "soft-lattice" flags (8 cells at 40–44% ambiguity) were a 5-bit binning metric artifact — under ε-cluster dominance the same cells measure 0.2–3%. Do not regenerate cells on that old list. Dropped stages, kept deprecated in sheet.ts: driftField (regressed reconErr; offsets were edge jitter), mergeSheetColors (single-linkage chaining collapses natural palettes).

## Atmosphere

- Stylized-dramatic grading: deep blue moonlit nights with warm window glow, golden dawns, grey-green storm light, snow-blued winters.

## Canonical style anchor

- `content/reference/style-anchor.png` (the approved T6 cottage raw) is THE art-style reference for the entire simulation: pixel density ("blocky but not too much"), palette warmth, cute rounded style.
- Measured: detectArtScale = 4 on the 512px generation canvas → effective art resolution 128×128 (each art pixel ≈ 4 source px).
- LAW: style-anchor.png is the FIRST input_reference on EVERY generation (all classes) and the FIRST judge refSheet.
- style-anchor.png stays RAW — never post-processed. It is the generation/judge reference, not a shipped sprite.
- Prompts for non-character classes append: "match the pixel density, palette warmth, and cute rounded style of the first reference image exactly".

## Character standard v3 — mirror standard

SUPERSEDES Character standard v2 (below) after the v2 sheet failed human review: nothing
faced west (the model ignores compass prose), and the four independently generated facings
drifted into four different characters. Ratified 2026-08-16 (sprite-rethink proposal,
Option A + prompt cookbook).

### Authored vs derived facings

- Characters author TWO facings only: SE = front ¾ view, NE = back ¾ view.
  SW = horizontal flip of SE (all cells); NW = horizontal flip of NE — derived in code,
  zero generation, facing-correct by construction.
- The asymmetry/no-mirror law is BUILDINGS ONLY (the NW-light lock stays for structures).
  Characters mirror freely; asymmetric props may swap sides on mirrored facings
  (Ambidextrous Sprite — accepted per Stardew/Pokémon/Mega Man precedent; user-ruled).
- Prompts name facings as VIEWS, never compass prose: "front three-quarter view",
  "back three-quarter view, seen from behind". Spatial-prose clauses ("body turned toward
  the bottom-left of the frame") are BANNED — the model demonstrably ignores them.

### Simplified character spec

- Stardew-class, ~3 heads tall.
- 2-3 signature features MAX on the sprite: cap + overalls + satchel. Collar, rolled
  sleeves, and the satchel charm survive only in portraits/concept art — never at
  sprite scale.

### Walk cadence

- 3 unique walk frames per authored facing: contact-a, passing, contact-b.
- Playback F1-F2-F1-F3: contact-a → passing → contact-b → passing, ~180 ms/frame.
- The 24-cell sheet contract (4 facings × 6 poses) is unchanged for the renderer:
  passing-a = passing-b = the one passing frame; sleep-se/sw = the one sleep cell,
  sleep-ne/nw = its flip.

### Generation (gen-character-v4.ts)

- Call 1 — master: ONE image, two figures side by side on magenta (front ¾ + back ¾ of
  the simplified design); the identity root attached to every later call. Reasoning
  (thinking) generation when the API accepts it — extract the FINAL image only.
- Calls 2-3 — per authored facing: one 1×4 wide-canvas strip (1536×512, proven):
  idle, contact-a, passing, contact-b; master attached.
- Call 4 — ONE sleep pose, master attached.
- Surviving stages: magenta chroma key, sliceStrip, coarsen-to-fit/lattice/quantize
  (v7 chain), stride check WITHIN a strip, ONE coherence gate (palette-jaccard +
  silhouette bbox vs master).
- DELETED from the v4 path: distance matrices, mirror-dupe detection, cross-facing gate,
  seeded sleep, per-facing sleep palette gates, guide-image machinery, compass-prose
  clauses, judge-as-facing-arbiter.
- Facing gate: the C13 vision gate SCREENS facing on every asset and may auto-reject the
  obviously wrong way round. HUMAN EYEBALL on the contact sheet + walking GIFs remains the
  FINAL and ONLY authority for masters — the pipeline never *claims* a master's facing is
  correct, only that it is not obviously wrong. (Narrowed 2026-08-16 by the C13 addendum §1;
  user-accepted, ruling 2.)

## Character standard v2 (SUPERSEDED by v3, above)

SUPERSEDES the v1 3-pose standard (below) after the v1 sheet failed human review: ne/nw back views were one drawing (straight distance 0.123 vs cross-facing median 0.310), sw/idle was a 0.030 mirror of se/idle, and the se strides were rigid (0.091) — all *flagged* by the old lax thresholds and shipped anyway. v2 makes every one of those a hard failure.

### Sheet

- 4 dimetric facings × 6 cells: idle, contact-A, passing-A, contact-B, passing-B, sleep.
- 96×96 cells, feet-anchored at y=88; sheet layout keeps the cols=facings convention: 4 columns (sw, se, ne, nw left→right) × 6 pose rows (top→bottom, `POSES_V2` order) = **384×576**.
- Renderer notes: walk loop is contact-A → passing-A → contact-B → passing-B at 8fps; the renderer bobs passing frames 1px down (render-time only — never baked into cells); blob shadow under characters; portraits drive inspector/wiki/dialogue; emotes render as a 16×16 overlay above the head.

### Generation doctrine AMENDMENT (one facing per call)

- A single call may draw ONE facing as a 1×5 horizontal phase strip (same figure, five walk phases side by side) — identity stays coherent within one drawing. Multi-facing sheets remain BANNED.
- Strip slicing is mechanical (`sliceStrip`): cluster opaque columns into 5 segments — robust to uneven spacing, never assumes equal fifths — then per-frame registration and anchorToCanvas as in pipeline v7.
- The sleep cell generates as its own single-cell call per facing (a lying pose does not belong in the walk strip).

### Identity

- ~~Identity asymmetry LAW: every character design carries left-right asymmetric markers (e.g. satchel on the left hip, cap brim tilted right) so no facing can be a mirror of another. The markers live in CHAR_DESC and every prompt.~~ **RESCINDED for characters by standard v3 (asymmetry law is buildings-only; characters mirror).**
- Every character's identity root is its CONCEPT image (`scripts/gen-concept.ts`: one high-detail box-art style image establishing costume, palette, accessories — not a sprite, no pixel constraints). Sprites and portraits both derive from it: when a concept exists it is inserted as an input_reference immediately after the style anchor.
- Re-examined against an external workflow and deliberately KEPT: east-mirroring stays banned (NW-light law unchanged) and chroma stays magenta (green would collide with the sage palette).

### Hard QA gates (exported from `sheet.ts`; fail → regen that strip, max 2 retries, then BLOCKED — never ship a flagged sheet)

All ratios are × the sheet's pairwise-median cell distance; calibrated against the rejected v1 sheet (median 0.310):

- Cross-facing near-dupe: straight distance < 0.55×median → FAIL (catches v1 ne/nw at 0.123 vs 0.171 cutoff).
- Cross-facing mirror-dupe: mirrored distance < 0.35×median → FAIL (catches v1 sw/se at 0.030 vs 0.109 cutoff).
- Stride differentiation within a facing: d(contact-A, contact-B) and d(passing-A, passing-B) each ≥ 0.35×median (catches v1 se at 0.091); every contact vs passing pair ≥ 0.25×median.
- Frame coherence within a facing (NEW — v1 had none and per-frame generation drifted costume details), every frame vs the facing's idle: (a) palette agreement — Jaccard over ε-clusters (single-linkage ≤8/channel like v7, clusters under 1% opaque population ignored) ≥ 0.80; (b) silhouette area within ±18% of idle; (c) head-region stability — opaque-mask disagreement over the top 40% of the bbox ≤ 0.20 (v1 legit frames measure ≤ 0.123; legs move, heads don't).
- Sleep cells: palette agreement vs idle (same 0.80 gate) plus lying-silhouette sanity (opaque bbox wider than tall).

### Portraits

- Class `portrait`, bust framing, same villager, same palette; generated 512 on magenta (chromaKey only when actually magenta), shipped 128×128 through the v7 primitive chain.
- Base neutral: 3 candidates + judge + report, HUMAN pick. Six expressions (happy, sad, angry, surprised, weary, asleep): 2 candidates each, refs = style anchor, (concept), chosen neutral raw. Consistency gate vs neutral: palette Jaccard ≥ 0.75, silhouette bbox within ±12%.

### Emotes

- 12 authored 16×16 glyphs drawn in code (`src/emotes.ts`, warm-pastel palette constants): exclaim, question, heart, star, sleep, hunger, cold, rain, hurt, talk, idea, anger. Deterministic — never generated.

## Facings

- ~~Characters: 4 dimetric facings (sw, se, ne, nw) × 3 poses (idle, walk-a, walk-b) per sheet; cells 96×96 at art height 64 (feet-anchored at y=88), sheet 384×288. Column order sw, se, ne, nw (left→right) and row order idle, walk-a, walk-b (top→bottom), as in `sheet.ts`. Walk animation = idle, walk-a, idle, walk-b loop.~~ **SUPERSEDED by Character standard v2 (above).**
- Buildings: up to 2 authored facings — door-sw (default) and door-se variant; codex id suffix `#se`. NEVER mirror BUILDING sprites: light is locked from the north-west (mirroring flips it). Characters are exempt — standard v3 derives SW/NW by horizontal flip; mirrored NW-light shading at 3-head chibi scale is unnoticed (genre precedent).
- Engine note: Structure has no facing field yet (C2); facing is asset-selection-only until then.
