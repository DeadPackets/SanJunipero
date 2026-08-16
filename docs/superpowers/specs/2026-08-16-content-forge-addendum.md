# San Junipero — Spec Addendum: C13 "Content Forge"

**Date:** 2026-08-16
**Status:** DRAFT — pending user review. Extends `docs/superpowers/specs/2026-08-15-san-junipero-design.md` §7 (asset forge) and `packages/forge/content/style-bible.md` (the art law this chunk's vision rubric encodes). Companions: C11 addendum (`2026-08-16-deep-world-addendum.DRAFT.md` — map law §9, light/furniture item kinds), C12 addendum (`2026-08-16-deep-presentation-addendum.DRAFT.md` — the renderer that consumes every pixel here), C10 plan (`2026-08-16-10-presentation.DRAFT.md` — tileset renderer, interiors T10/T11, showcase Task 3 superseded below).
**Chunk order (RULED 2026-08-16 evening):** C13 is a **NEW PARALLEL LANE** — forge/content + codex only, runnable alongside C9/C10 like the old asset lane. Gate: **G13**.
**Scope authority:** v1-core-findings-ledger.md §A8.5 in full, under the §D A8-round rulings.
**Level:** SPEC — pipeline systems, content catalog, template, validators, config, gate outline. Task plan authored at lane kickoff.

**The philosophy in one sentence: agents author the what, the pipeline owns the look — and from C13 on, the pipeline also *proves* the look, mechanically and by machine eye, before any human is asked to.** Nothing in this chunk touches world physics; the sim never blocks on art; the catalog is art and records, never availability — what exists in the world stays the business of genesis fixtures, foraging, crafting, and the arbiter.

---

## 1. VISION-QA GATE — every forge asset passes a structured rubric

Every forge-generated asset (characters, buildings, items, icons, terrain, portraits) passes a
vision-LLM rubric before it can register in the codex. This is the automation of the eye that
caught Amara's density drift, Nadia's wrong facing, and the standing-stone patch by hand —
each of which this gate would have auto-caught (ledger A8.5a).

### Model + invocation (house law)

- Judge model: `forge.visionQa.model`, default **`google/gemini-3.7-flash`** via OpenRouter (vision input: the processed asset on a neutral checker card + the relevant references).
- **Key-safe invocation is the house law and is referenced, never restated loosely:** all live forge scripts run via `node --env-file=<repo>/.env` (the pinned tsx CLI path in the standing rules); `OPENROUTER_API_KEY` is read from env only, never inlined, never logged, never committed. Scripts refuse to run without it (existing forge convention, unchanged).

### The rubric (seven criteria — each scored 0–10 with evidence, binary ones hard-fail)

| # | Criterion | What the judge is shown / asked | Pass rule |
|---|---|---|---|
| 1 | Palette compliance vs `MASTER_PALETTE` | The asset + the 40-color palette card. Sprites ship unquantized (style-bible law) — this is the **judge-harmony** criterion made systematic: colors must sit inside the palette's warmth families; clashing hues fail. Terrain remains mechanically quantized upstream. | score ≥ `minScore` |
| 2 | Single figure | Exactly one subject; no duplicate figures, vignettes, ground shadows baked as scenery, or margin doodles. | binary hard-fail |
| 3 | Background transparency / chroma residue | Post-chain output on the checker card: no magenta residue, no halo band, alpha edge clean (the v7 chain's job, verified by eye-machine). | binary hard-fail |
| 4 | Proportion / pitch vs Standard v3 | Characters: ~3 heads tall, simplified 2–3 signature features; measured pitch vs canonical density (character sheets 5.12, buildings 4.00 — style-bible measured constants) within ±20%. | score ≥ `minScore` |
| 5 | Facing correctness per view | Characters: front ¾ (SE) vs back ¾ (NE) as commissioned; buildings: door-sw / door-se as commissioned. **Screen only, never authority for masters** — see the facing-law note below. | score ≥ `minScore` |
| 6 | Detail-density vs the Omar reference | Omar's approved sheet (characters) / `style-anchor.png` (everything else) shown as the density anchor: "blocky but not too much" — too flat and too noisy both fail. | score ≥ `minScore` |
| 7 | Footprint / feet alignment | Characters: feet on the anchor line (y=88 convention). Buildings: base sits ON the footprint diamond (also mechanically checked, §4 — the vision half catches perspective skew the pixel check can't). | score ≥ `minScore` |

### Structured verdict (Zod `.strict()`, structured output — the same discipline as every judge in this repo)

```ts
export const VisionCriterionSchema = z.object({
  pass: z.boolean(), score: z.number().min(0).max(10), evidence: z.string().min(1),
}).strict()
export const VisionVerdictSchema = z.object({
  assetId: z.string(), model: z.string(), rubricVersion: z.string(),
  criteria: z.object({
    palette: VisionCriterionSchema, singleFigure: VisionCriterionSchema,
    transparency: VisionCriterionSchema, proportion: VisionCriterionSchema,
    facing: VisionCriterionSchema, density: VisionCriterionSchema,
    alignment: VisionCriterionSchema,
  }).strict(),
  overall: z.enum(['pass', 'retry', 'blocked']),
  feedback: z.string(),   // concrete, prompt-ready: what to change on the retry
}).strict()
```

`overall` derivation is code, not the model's mood: any hard-fail criterion failed → `retry`;
any scored criterion < `forge.visionQa.minScore` (default 7) → `retry`; retries exhausted →
`blocked`. The model supplies scores and evidence; the pipeline supplies the verdict.

### Retry loop, spend ledger, telemetry

- **Auto-retry-with-feedback:** a `retry` verdict regenerates the asset with `feedback` appended to the generation prompt (after the style boilerplate, before the commission text), max `forge.visionQa.maxRetries` (default 3), then `blocked` — a blocked asset never ships silently; it queues for human review (masters) or re-commission (props). The existing placeholder law stands: the sim never blocks on art.
- **Spend ledger:** every judge call books through the existing forge `budget.ts` ledger with `kind: 'vision_qa'`, per-asset rows; per-asset QA cost cap `forge.visionQa.costCapPerAssetUsd` (default 0.05) with the standing ~$5/item anomaly stop above it. Spend is reported at the gate, not capped globally (budgets-unlocked house rule).
- **Pass-rate telemetry:** rolling first-pass and within-retries pass rates per asset class, persisted in the forge DB — the G13 threshold reads this table, and it is the tuning instrument for prompt cookbook changes.

### Facing law (explicit amendment to the style bible — logged, not slipped in)

Style bible v3 says "Facing gate = HUMAN EYEBALL … never automated, never claimed by the
pipeline." C13 **narrows, not repeals**: the vision gate SCREENS facing on every asset
(auto-rejecting the obvious wrong-way Nadia case before a human ever looks), and **human eyeball
remains the final and only authority for masters** (character sheets, key building masters).
The pipeline still never *claims* facing correctness for a master — it claims only "not
obviously wrong." The one-line style-bible edit is listed in the plan's audit task.

### Retrofit

The gate applies **backwards**: an audit pass runs the full rubric over every existing shipped
asset (cast sheets, portraits, buildings, tiles). Failures on masters queue for human eyeball
with the verdict attached; failures on props queue for regeneration through the normal loop.
The audit report (per-asset verdicts, pass rates) is a G13 artifact.

---

## 2. PREMADE LIBRARY — 50 catalog entries (ruled range 40–60)

Interiors need real furniture art, not placeholders; the world needs its object vocabulary drawn
before the town asks for it. Every entry = **world sprite** (16–24 px, style-bible item law) +
**inventory icon** (16 px; furniture-class icons at 24 px — they read as silhouettes, not
postage stamps) + **codex record** `{class: 'item', kind, meta}`. All entries pass the §1 gate.

| Category | Entries | Count |
|---|---|---|
| Tools | axe, hoe, knife, hammer, shovel, fishing rod, bucket, waterskin, needle, saw | 10 |
| Foods | bread, berries, fish, venison, rabbit meat, stew, field mushroom, pale mushroom, herb bundle, wheat sheaf | 10 |
| Materials | timber, stone, clay, fiber, hide, cloth, rope, charcoal, gravel | 9 |
| Ritual/symbolic objects | offering bowl, totem, banner, candle, garland, carved charm | 6 |
| **Furniture** | bed, table, chair, bench, shelf, crate, barrel, rug, hearth, lantern, loom, anvil, chest, stool, cookpot | 15 |
| **Total** | | **50** |

Notes bound by other chunks' law: the pale mushroom must look *almost* identical to the field
mushroom (C12 §10 — the art never labels the danger); the lantern is catalog **art**, while the
lantern **item** stays arbiter-territory in-world (C11 §6) — the drawing waits for the invention.

### Furniture placement metadata → C10 T10/T11 upgrade (the placeholder law superseded)

Furniture codex records carry `meta.interior` (Zod `.strict()`):

```ts
meta.interior: {
  slots: { w: number, h: number },                 // interior-grid footprint (1×1 or 1×2)
  placement: 'floor' | 'wall',                     // rugs/shelves are wall/floor-constrained
  interiorKinds: InteriorKind[],                   // which interiors may lay this out
  isBed?: true, isHearth?: true, providesLight?: true,   // consumed by bedSlots / tone / §19-render
}
```

C10 Task 10's `FurnishingKind` (6 hardcoded kinds) **widens to the library**: `INTERIOR_LAYOUTS`
entries resolve their sprite via codex lookup (kind → library record → texture URL), and Task
11's `makePlaceholder` fallback is retained but demoted to the no-record case. Declared seam:
`FurnishingKind` becomes `string` validated against the codex at parse time; the six original
kinds are guaranteed present in the library (bed, hearth, table, shelf, crate → chest/crate,
tools → anvil+saw wall rack), so C10's layouts compile unchanged before and after C13 lands.
This is the "upgrade their placeholder law" ruling made concrete.

### God-layer items — the SAME pipeline

Agent-invented items (arbiter `spawn_item` codifications, C9 §8) flow through the identical
commission → generate → post-chain → **§1 vision gate** → codex path, on demand, at world
runtime. No second pipeline, no lesser bar for invented things — the town's first fishing rod
gets the same eye as the founders' axes. Emergence law: inclusion in this catalog gives an item
**art, never existence** — the library pre-draws the probable vocabulary; the world still only
contains what genesis, labor, or adjudication puts in it.

---

## 3. CITY TEMPLATE — genesis city upgrade of the showcase map

The bare-plaza showcase grows into a small city worth waking up in. One pure module,
deterministic, Zod-strict, **128×128-compatible under the C11 §9 map law** (the template stamps
into the genesis 128×128 near the river bend; anchor is genesis input `cityTemplate.anchor`).

| Layer | Contents |
|---|---|
| Districts | **Homes cluster** (huts around a shared yard, NE of the square), **market square** (the plaza, widened — stalls are future town labor, not template content), **farm belt** (tilled-ready meadow south, within `fertilityAt` reach of the river/future channels), **riverfront** (the west bank: fishing frontage, clay and reeds). Districts are *layout*, never law — no zoning exists; "district" is planner/viewer vocabulary only. |
| Buildings (11 total, within the ruled 8–12) | 5 huts, 1 storehouse, 2 workshop sheds — all **complete, with furnished interiors laid out from the §2 furniture library** (huts: bed/table/chair/rug + hearth; storehouse: shelves/crates/barrels; sheds: anvil/bench/tool rack) — plus well, communal fire_pit, wagon (lore prop). The standing stone stands beyond the edge of town, unexplained, per C11 §9. |
| Roads | A road grid joining the districts (autotiled per §4), the C11 §9 starter spine included; the riverfront path runs the bank. **No bridge** — the far bank stays an earned milestone (C11 §2 law, restated because a template author WILL be tempted). |
| Growth plots | Empty road-adjacent cleared-grass pockets in every district. A "plot" is literally empty buildable ground next to a road — zero reservation mechanics, zero engine state; the road-adjacency *benefit* (C11 §3) is why life will fill them. |

Contract:

```ts
export const CityTemplateSchema = z.object({
  anchor: z.object({ x: z.number().int(), y: z.number().int() }).strict(),
  tiles: z.array(z.object({ dx: z.number().int(), dy: z.number().int(), to: z.number().int() }).strict()),
  structures: z.array(z.object({
    kind: z.string(), dx: z.number().int(), dy: z.number().int(),
    w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4),
    furnishings: z.array(z.object({ kind: z.string(), slot: z.object({ x: z.number().int(), y: z.number().int() }).strict() }).strict()),
  }).strict()),
}).strict()
export function makeCityTemplate(): z.infer<typeof CityTemplateSchema>   // pure, two calls deep-equal
```

C11 §9's genesis-town table remains authoritative for kits, communal stock, forageables, fauna,
and the rulebook seed — the template supplies the *built* layer it describes, at city scale.
One deliberate delta from C11 §9's text: **starter huts 3 → 5** under the A8 "prebuilt good
city" ruling (deviation 2, flagged for user veto — a one-line C11 edit if confirmed).

**Supersession (C10 Task 3):** the 48×48 `makeShowcaseMap` remains a **dev fixture only** (it
already was, per C11 §9); from C13 on, gates and genesis run on the city template inside the
128×128 world. The corresponding one-line AMENDMENT is appended to the C10 plan draft.

---

## 4. GRID / ALIGNMENT — validators and road autotiling

### Automated alignment validator (forge CI gate — kills the "unnatural placement" class)

For every building asset, the validator renders the sprite onto a test grid at its declared
footprint anchor and checks, per asset:

1. **Feet line (pixel check):** the opaque bbox bottom sits within ±2 px of the footprint diamond's near vertex row; zero opaque pixels below it.
2. **Base fit (pixel check):** the sprite's base-row opaque extent falls inside the footprint diamond's horizontal extent (±¼ tile), so no wall overhangs a neighboring tile.
3. **Seat check (vision):** one §1-family judge call on the composited test-grid render — "does the building sit ON the diamond: not floating, not sunken, not perspective-skewed" — catching what pixel arithmetic cannot (skew, painted ground shadows).

Runs as a forge CI gate over every registered building (retrofit included, §1) and over every
future building registration. Fail → the §1 retry loop with the validator's finding as feedback.

### Road autotiling — dimetric connection set (exactly 15 tiles, enumerated)

Neighbor model: tile-space N/E/S/W (`(x,y−1)`, `(x+1,y)`, `(x,y+1)`, `(x−1,y)`), which on the
dimetric screen read as NE/SE/SW/NW edges respectively (C6 projection math). The set:

| Group | Tiles | Count |
|---|---|---|
| Straight | `straight-ns`, `straight-ew` | 2 |
| Corner | `corner-ne`, `corner-es`, `corner-sw`, `corner-wn` | 4 |
| T | `t-no-n`, `t-no-e`, `t-no-s`, `t-no-w` (named by the missing arm) | 4 |
| Cross | `cross` | 1 |
| End-cap | `cap-n`, `cap-e`, `cap-s`, `cap-w` (open toward the named arm) | 4 |
| **Total** | | **15** |

```ts
export type RoadAutotileKey = /* the 15 literals above */
export function roadAutotile(n: { n: boolean; e: boolean; s: boolean; w: boolean }): RoadAutotileKey
// pure and TOTAL over all 16 neighbor combinations; the isolated tile (0 neighbors)
// maps to 'cap-s' by convention — a road stub faces the viewer (deviation 3).
```

### Manifest extension (declared — the ONLY runtime-adjacent surface C13 touches)

`TilesetManifest` (`packages/forge/src/terrainManifest.ts`, mirrored shape in
`packages/shared`) gains an optional strict block:

```ts
autotile: z.object({
  road: z.object({ file: z.string(), tiles: z.record(RoadAutotileKeySchema, z.number().int()) })
    .strict().refine(r => Object.keys(r.tiles).length === 15, { message: 'all 15 road tiles required' }),
}).strict().optional()
```

C10's tileset renderer consumes it behind its existing seam: `tilesetPlan` resolves a road
tile through `roadAutotile(neighbors)` **when the autotile block exists**, and falls back to
the current flat road variants otherwise — C10 compiles and renders correctly before and after
C13 lands; no C10 task is reopened. `roadAutotile` + the key type live in `@sj/shared`.

---

## 5. Config keys (forge/ops-side — NOT world-law; no world physics reads any of this)

```
forge.visionQa.enabled: true          forge.visionQa.model: 'google/gemini-3.7-flash'
forge.visionQa.minScore: 7            forge.visionQa.maxRetries: 3
forge.visionQa.costCapPerAssetUsd: 0.05   forge.visionQa.rubricVersion: 'v1'
library.iconSizePx: 16                library.furnitureIconSizePx: 24
cityTemplate.anchor: {x, y}           (genesis input, consumed by the C11 §9 fixture)
alignment.feetTolerancePx: 2          alignment.baseFitToleranceQuarterTiles: 1
```

Key handling: env only, per §1's house-law reference. No key, no live run — and the offline
halves (schemas, `roadAutotile`, template, pixel checks) run keyless in CI regardless.

## 6. Parallel-lane law (binding boundary)

- **C13 touches:** `packages/forge` (pipeline, judges, validators, scripts), `packages/forge/content` (style bible edit per §1, library art, template data), the asset **codex** (new records), and `packages/shared` **only** for the declared schema additions: the `TilesetManifest.autotile` block, `RoadAutotileKey` + `roadAutotile`, and the codex `meta.interior` fields.
- **C13 never touches:** engine code, agents, arbiter runtime, narrator, gateway, or web runtime code. The C10 renderer seam (§4) and interior seam (§2) are *consumed by C10/C12 code that already exists or is already planned* — C13 supplies data and schemas, never patches consumers.
- **Concurrency:** runs alongside C9/C10 with zero file-level overlap except `packages/shared` (additive, optional-field, parse-compatible — declared here so the lanes cannot surprise each other). Merge order is free.
- **Laws inherited whole:** emergence law (art ≠ availability, §2), naming law (codex kind names are registry vocabulary; anything the town coins is quoted with provenance per C11 §10 — the catalog never puts words in their mouths), one-way glass (the forge and its judges are ops-plane; nothing here can reach a prompt), determinism (every C13 function that anything replays — template, autotile, validators' pixel half — is pure; generation and vision verdicts are ops-side content production, outside world state, like all forge output), human framing (codex descriptions are diegetic; no AI/model vocabulary in any viewer-reachable string).

## 7. GATE G13 — outline (full protocol written with the plan)

**G13a — automated ($0 beyond judge calls already spent):**
- `VisionVerdictSchema` round-trips; `overall` derivation exact over fixture verdicts (hard-fail, low-score, pass, retries-exhausted → blocked).
- `roadAutotile` total: all 16 neighbor combos → the 15 keys, isolated → `cap-s`; manifest refine rejects a 14-tile set.
- `makeCityTemplate()` parses Zod-strict; deterministic (two calls deep-equal); stamps inside 128×128 at the genesis anchor; road-grid BFS from the market square reaches every building's door tile; every furnishing kind exists in the library; **no water tile carries road** (the no-bridge law as a test).
- Alignment validator pixel half exact on authored good/floating/sunken/overhanging fixtures.
- Codex records for all 50 entries parse; furniture records all carry `meta.interior`; the six C10 `FurnishingKind` originals are present.

**G13b — judged + human-evidenced:**
- **Vision-QA pass-rate threshold:** over the full 50-entry library batch (sprite + icon), ≥ 90% pass within the retry budget and first-pass rate is reported; every `blocked` asset resolved (human ruling or re-commission) before gate close. Retrofit audit report over existing cast/buildings attached.
- **Library sheet human eyeball:** one contact sheet — all 50 world sprites + icons on the palette card — human-approved. The human eye remains the only final art authority (house law).
- **Alignment validator green over all buildings:** the template's 11 + every retrofit building.
- **Autotile visual check:** a scripted test map exercising all 15 tiles (ring + cross + stubs) rendered through C10's tileset path, screenshot human-checked — roads read as roads at a glance.
- **Interiors live:** each furnished interior kind renders in C10 T11 with library furniture replacing placeholders (screenshot per kind).
- **Spend report:** total C13 generation + judge spend reported (no cap; ~$5/item anomaly stop enforced throughout).

## Deviations & assumptions (logged, not silently decided)

1. **Style-bible facing law narrowed** (§1): vision gate screens facing on every asset; human eyeball stays final and exclusive for masters. The bible's "never automated" line becomes "never automated *as authority*"; edit listed for the plan's audit task.
2. **Genesis huts 3 → 5** (§3): the A8 "prebuilt good city" ruling reads as more than three homes; C11 §9's table otherwise stands verbatim. Flagged for user veto — one-line C11 edit if confirmed.
3. **Isolated road tile → `cap-s`** (§4): a deterministic convention; any choice was arbitrary, so it is written down.
4. **Icon sizes split by class** (§2): the ruling said "16 or 24 px" — 16 px standard, 24 px for furniture, because furniture silhouettes die at 16.
5. **Library sized at 50** (§2): mid-range of the ruled 40–60; the enumerated catalog is the spec, additions ride the same pipeline.
6. **`FurnishingKind` widens to codex-validated `string`** (§2) rather than a frozen enum — the god-layer item path means furniture-like inventions must be layout-able without a code change; parse-time validation keeps it strict.
7. **Judge criteria thresholds** (`minScore` 7, density ±20%) are calibration defaults — G13's telemetry is the instrument for tuning them; changes are config, not spec edits.

## POST-REVIEW USER RULINGS (2026-08-16 evening, final round — binding)

1. **City template: 5 starter huts CONFIRMED, each owned by its founder at genesis**
   (`owner` rows in the template's structure entries; storehouse/well/fire pit/plaza are
   PUBLIC, owner null). See the C11 addendum's final-round ruling 1 for the structure-
   ownership law this rides on.
2. Facing-law narrowing (deviation 1) ACCEPTED by controller: the vision gate may flag/reject
   facings automatically; human eyeball remains the final authority for masters.
