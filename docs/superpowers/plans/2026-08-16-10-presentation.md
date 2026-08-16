# C10 — Town Presentation & UX Implementation Plan (DRAFT for controller review)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The living documentary: the C6 observatory stops being a wireframe and becomes the window the design spec promised. Textured dimetric terrain (grass/earth/stone/road tile art) replaces the flat-color ground; a designed showcase town map (plaza, roads, building plots, riverbank) demonstrates the C9 road lattice; the chrome becomes an information-dense documentary shell (clock/weather/population strip, lens hints, real empty states); every thing on the map is hoverable and clickable; a curated important-event log (deaths, births, households, fires, completions, firsts) jumps the timeline; the bonds lens grows a per-bond detail panel; C7's recorded days become the Moments lens with playback; and C9 interiors render as separate interior scenes — gated by G10 (two browsers at 60fps, scrub, interior enter/exit, moments playback, chronicle event jump).

**Architecture:** C10 owns visual/UX; C9 owns engine/world-law. Every renderer change is read-only over the same `fold`-backed `WorldStore`; the gateway gains five read-only data endpoints (`/api/chronicle`, `/api/chapters` real reader, `/api/milestones`, `/api/bonds`, `/api/moments`) that scan the event store and C7's `narrator.db` — never a write path. Textured ground is a one-time baked `RenderTexture` (spec §15) fed by codex `class:'terrain'` records the forge paints deterministically in-palette. Interiors are a second Pixi sub-scene driven by C9's `insideId` occupancy; the outside world stays on the main scene. The Moments lens drives the existing scrub mechanism through a pure `MomentPlayer` state machine. Zero world-state writes, zero engine RNG — presentation-only viewer-side randomness is allowed (C6 Task 14 law), but ground variety uses a deterministic `(x,y)` hash so re-bakes are stable.

**Tech Stack:** Node 24, TS ESM, Vitest; React 19 + Vite 8, `pixi.js@^8`, `react-force-graph-2d@^1` (web); `better-sqlite3@^13`, Zod 4 (gateway/forge); `@sj/forge` `RawImage`/`encodePng`/`AssetCodex` (tile pipeline); `@sj/narrator` `NarratorStore` (moments/chapters/milestones readers). No new runtime dependencies. Zero LLM calls in this chunk ($0 API budget); tile art is code-painted, not generated (see Global Constraints).

**Spec:** `docs/superpowers/specs/2026-08-15-san-junipero-design.md` §7 (Style Bible: palette law, pixel-art conventions, tone rule, observatory chrome), §8 (Observatory lenses), §15 Frontend table (binding tech picks), §10 (founders world: forking river, meadow, forest edge, rocky hill, standing stone, wagon, storehouse). Living-world addendum `2026-08-16-living-world-addendum.DRAFT.md` §1 (interiors: `insideId`, earshot, occupancy, door), §3 (partnership inference via `co_slept`). Renderer notes: `packages/forge/content/style-bible.md` (tone rule: grave scenes suppress cartoon effects; palette; `RawImage`/`encodePng`; codex `class:'terrain'` exists). User rulings 2026-08-16 (design gate, binding): gamification = living documentary (no points/quests/leaderboards); town ground = textured tiles + road network; interiors = separate interior scenes; C9 owns world-law, C10 owns visual/UX.

## Global Constraints

- Spec §8 verbatim: "Read-only by construction." C10 never writes `events`/world tables, never draws RNG the engine records. Golden replay G1/G2 stay green — CI proof in the gate task. Ground variety and transition randomness are viewer-side presentation only.
- Spec §15 verbatim: renderer is PixiJS 8.x mounted in a React ref (NOT @pixi/react); `scaleMode:'nearest'`, `antialias:false`, `roundPixels:true`, integer zoom; hand-rolled dimetric (`screenX=(x−y)·w/2, screenY=(x+y)·h/2`, depth-sort `x+y`); static ground baked once into a `RenderTexture`; hot-load via `Assets.add/load` + explicit `texture.source.unload()`.
- Spec §7 tone rule verbatim: grave scenes suppress all cartoon effects — the renderer goes still. Interior fade/cut transitions are structural, not cartoon; they are exempt from tone suppression (camera moves are not effects).
- Spec §5 human framing: no viewer-facing text references AI/tools/prompts. New chrome copy speaks about townsfolk, never machinery.
- **Living-documentary law (user ruling 2026-08-16):** no points, quests, leaderboards, or progress meters anywhere. Entertainment = watching the town; information density + click-anything is the only "reward". All copy reads as observation, never as a game.
- Determinism law untouched: the gateway/web never write world state; the showcase map is genesis initial-conditions input (terrain + structure placement), folded at genesis exactly like C6's `makeFixtureMap`; it is NOT a runtime world edit. Renderer-side `Math.random` is presentation-only (C6 Task 14 precedent).
- Tile-art independence (C5→C6 contract extended): the textured ground falls back to C6's flat palette-true diamonds (`groundPlan`) until codex terrain records exist; real tiles hot-swap in. No task blocks on art.
- Road tiles are C9-owned engine physics (new `TileId` + `TERRAIN_COST` preference — C9 Task 1b). C10 paints and renders the road texture and showcases it; it does not author the tile id or the pathfinding preference.
- Every render tunable lives in an exported `const` in its module; every new schema is Zod `.strict()`; every schema consumes a `.strict()` payload or `z.enum` — no loose object literals.
- Chunk contract: C10 depends on C9 Tasks 1b (roads), 2 (interiors: `insideId`, `agent_entered`/`agent_exited`), 2b (sleep-in-bed law), T11/T12 (relationships → bonds); and on C7 (narrator.db: scenes/chapters/milestones). Tasks proceed against stubs/contracts where marked; no task silently assumes a later chunk's symbol exists.
- Roadmap globals: TypeScript ESM, strict tsconfig, Vitest TDD per task, commit per task, Zod 4, monorepo layout `packages/{...,web,gateway,forge,narrator}`.
- Worktree gotcha: EnterWorktree branches from stale origin/main — first action after creating the worktree is `git merge main --ff`.

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/terrain.ts` | `TerrainTileManifestSchema`, `parseTerrainTileManifest` (tile-art contract) |
| `packages/shared/src/bonds.ts` | `BondSchema`, `BondsResponseSchema` (C9 T11/T12 contract + stub shape) |
| `packages/shared/src/moments.ts` | `MomentSchema`, `MomentsResponseSchema` (C7 scene → moment contract) |
| `packages/shared/src/chronicle.ts` | `ChronicleEntrySchema`, `CHRONICLE_WEIGHTS`, `CHRONICLE_ICONS` (importance classifier) |
| `packages/forge/src/terrainTiles.ts` | deterministic in-palette tile painter + codex ingest (`registerTerrainTiles`) |
| `packages/gateway/src/narratorApi.ts` | `/api/chronicle`, `/api/chapters` (real), `/api/milestones`, `/api/moments` — read `narrator.db` + events |
| `packages/gateway/src/bonds.ts` | `/api/bonds` deterministic proxy (C9 T11/T12 swap point) |
| `packages/gateway/src/showcaseMap.ts` | designed town map + structure placement (genesis fixture, Zod-strict) |
| `packages/web/src/render/tileset.ts` | `tileKind`, `tileVariant`, `resolveTerrainTile` (pure) |
| `packages/web/src/render/ground.ts` | textured ground bake + flat-diamond fallback |
| `packages/web/src/render/interiors.ts` | interior layouts, occupancy, transition (pure) |
| `packages/web/src/render/interiorScene.ts` | Pixi interior sub-scene + fade/cut assembly |
| `packages/web/src/render/nameTags.ts` | hover name-tag layer |
| `packages/web/src/ui/StatusStrip.tsx` + `townStats.ts` | clock/weather/population strip + lens hints |
| `packages/web/src/ui/ChroniclePanel.tsx` + `importantFeed.ts` | curated important-event feed + scrub-to-event |
| `packages/web/src/ui/BondDetailPanel.tsx` + `bondsModel.ts` | bond detail + redesigned graph |
| `packages/web/src/ui/MomentsLens.tsx` + `momentsPlayer.ts` | moments list, thumbnails, playback, deep-link |
| `packages/web/src/ui/route.ts` | `/moment/<id>` deep-link route extension |

## Interfaces produced (C8/rehearsal consume — binding)

```ts
// @sj/shared — new schema modules (re-exported from index)
// terrain.ts
TerrainTileManifestSchema  // { version:'v1-terrain-tile', kind: TerrainTileKind, variant:0|1|2|3, wPx, hPx }
TerrainTileKind = 'grass'|'earth'|'water'|'forest'|'rock'|'sand'|'farmland'|'road'
parseTerrainTileManifest(meta: string | null): TerrainTileManifest | null
// bonds.ts
BondSchema = { id, aId, bId, kind: BondKind, strength: number, formedTick, lastUpdatedTick,
               history: Array<{ tick, kind: string, note: string }> }
BondKind = 'partner'|'kin'|'friend'|'rival'|'owe'|'work'
BondsResponseSchema = { bonds: Bond[], asOfTick: number }
// moments.ts
MomentSchema = { id: number, day, startTick, endTick, title, cast: string[], location: string|null }
MomentsResponseSchema = { moments: Moment[] }
// chronicle.ts
CHRONICLE_WEIGHTS: Record<string, number>; CHRONICLE_ICONS: Record<string, string>
ChronicleEntrySchema = { seq, tick, type, icon, label }

// @sj/forge — terrainTiles.ts
paintTerrainTile(kind: TerrainTileKind, variant: number): RawImage
registerTerrainTiles(codex: AssetCodex): Promise<AssetRecord[]>

// @sj/gateway — new endpoints (all GET, read-only; narrator.db opened readonly when present)
/api/chronicle?fromTick=&toTick= → { entries: ChronicleEntry[] }
/api/chapters                     → Array<{ day, title }>            // real C7 reader (replaces C6 stub)
/api/milestones                    → Array<{ kind, label, day, tick }> // C7 firsts ledger
/api/bonds                         → BondsResponse                    // deterministic proxy until C9 T11/T12
/api/moments                       → MomentsResponse                  // C7 scenes; [] until a day is narrated

// @sj/web
Route gains momentId: number | null          // '/moment/<id>' (2 segs) vs '/moment/:day/:time' (3 segs)
```

## Deferred spec items (explicit — see Open Questions)

1. **Full-scene moment thumbnails** (a mini-render of the scene at `startTick`) — deferred; C10 ships a deterministic pixel-postcard thumbnail (frame + day + cast + location motif). A real scene capture would need a second headless renderer; the deep-link + playback is the substance, the postcard is the affordance.
2. **Meadow-to-city timelapse export** — still C7/C8 (C6 deferral stands); scrub is the mechanism, nothing here reopens it.
3. **Society edges from ledger-derived trust/debt/grudge/love** — C6 shipped a deterministic interaction proxy; C10 upgrades the *shape* to bonds (kind/strength/history) behind the same contract. The semantic upgrade (ledger-sentiment) remains C9 T11/T12's job; C10 swaps the reader, never re-derives sentiment.
4. **Newspaper-rendered digest** — C7; C6 ships the digest shell, unchanged here.

---

### Task 1: Forge terrain tile-art pipeline — palette-true code-painted tiles + codex ingest

**Files:**
- Create: `packages/shared/src/terrain.ts`, `packages/shared/src/terrain.test.ts`
- Create: `packages/forge/src/terrainTiles.ts`, `packages/forge/src/terrainTiles.test.ts`
- Modify: `packages/shared/src/index.ts` (re-export `terrain.js`), `packages/forge/src/index.ts` (re-export `terrainTiles.js`)

**Interfaces:**
- Consumes: `RawImage`/`encodePng`/`paletteRgb`/`AssetCodex` (`@sj/forge`), `AssetRecord` (`@sj/shared`).
- Produces (binding for Task 2):

```ts
// packages/shared/src/terrain.ts
import { z } from 'zod'
export const TERRAIN_TILE_KINDS = ['grass','earth','water','forest','rock','sand','farmland','road'] as const
export type TerrainTileKind = typeof TERRAIN_TILE_KINDS[number]
export const TerrainTileManifestSchema = z.object({
  version: z.literal('v1-terrain-tile'),
  kind: z.enum(TERRAIN_TILE_KINDS),
  variant: z.number().int().min(0).max(3),
  wPx: z.number().int().positive(),
  hPx: z.number().int().positive(),
}).strict()
export type TerrainTileManifest = z.infer<typeof TerrainTileManifestSchema>
export function parseTerrainTileManifest(meta: string | null): TerrainTileManifest | null {
  if (meta === null) return null
  const r = TerrainTileManifestSchema.safeParse(JSON.parse(meta))
  return r.success ? r.data : null
}
```

```ts
// packages/forge/src/terrainTiles.ts
import { paletteRgb, type Rgb } from './palette.js'
import type { RawImage } from './post/raw.js'
import { encodePng } from './post/raw.js'
import { AssetCodex } from './codex.js'
import type { TerrainTileKind } from '@sj/shared'

export const TERRAIN_TILE_W = 32, TERRAIN_TILE_H = 16   // base tile diamond (Style Bible grid)
export const TERRAIN_VARIANTS = 4
export const TERRAIN_COLORS: Record<TerrainTileKind, { base: number; light: number; dark: number; speck: number }> = {
  grass:     { base: 0x93B573, light: 0xB9D19A, dark: 0x6F9455, speck: 0x4F7040 },
  earth:     { base: 0xC68A48, light: 0xE0A95E, dark: 0xA66E38, speck: 0x7E512B },
  water:     { base: 0x7FB0C9, light: 0xA8CFE0, dark: 0x5A8CAB, speck: 0xD6EAF2 },
  forest:    { base: 0x4F7040, light: 0x6F9455, dark: 0x3E5A33, speck: 0x93B573 },
  rock:      { base: 0xABA198, light: 0xCFC6BC, dark: 0x857D75, speck: 0x5D5751 },
  sand:      { base: 0xE8D5BC, light: 0xF6E8D5, dark: 0xD4BC9E, speck: 0xB89D7E },
  farmland:  { base: 0xA66E38, light: 0xC68A48, dark: 0x7E512B, speck: 0x6F9455 },
  road:      { base: 0xD4BC9E, light: 0xE8D5BC, dark: 0xB89D7E, speck: 0x857D75 }, // packed-stone, distinct from grass/dirt
}

// one dimetric diamond top-face; NW-light edge: upper-left lit, lower-right shaded
export function paintTerrainTile(kind: TerrainTileKind, variant: number): RawImage {
  const pal = paletteRgb()
  const { base, light, dark, speck } = TERRAIN_COLORS[kind]
  const data = new Uint8ClampedArray(TERRAIN_TILE_W * TERRAIN_TILE_H * 4)
  const put = (x: number, y: number, hex: number): void => {
    const c = pal.find((p) => (p[0] << 16 | p[1] << 8 | p[2]) === hex)!
    data.set([c[0], c[1], c[2], 255], (y * TERRAIN_TILE_W + x) * 4)
  }
  for (let y = 0; y < TERRAIN_TILE_H; y++) {
    for (let x = 0; x < TERRAIN_TILE_W; x++) {
      const dx = Math.abs(x - 15.5) / 16, dy = Math.abs(y - 7.5) / 8   // diamond |x−16|/16 + |y−8|/8 ≤ 1
      if (dx + dy > 1) continue
      const c = dx + dy > 0.82 ? dark : base                          // rim shade both sides
      const edge = dx + dy > 0.82 ? c : (x < 16 && y < 8 ? light : c) // NW top-left lit
      put(x, y, edge)
    }
  }
  for (let i = 0; i < 7; i++) {                                       // variant-seeded speckle (deterministic)
    const sx = 4 + ((variant * 7 + i * 5) % (TERRAIN_TILE_W - 8))
    const sy = 3 + ((variant * 3 + i * 11) % (TERRAIN_TILE_H - 6))
    if ((Math.abs(sx - 15.5) / 16 + Math.abs(sy - 7.5) / 8) <= 0.6) put(sx, sy, speck)
  }
  return { width: TERRAIN_TILE_W, height: TERRAIN_TILE_H, data }
}

// ingest exactly like buildings: class 'terrain', kind = tile kind, meta = manifest JSON
export async function registerTerrainTiles(codex: AssetCodex): Promise<AssetRecord[]> {
  const out: AssetRecord[] = []
  for (const kind of ['grass','earth','water','forest','rock','sand','farmland','road'] as const) {
    for (let variant = 0; variant < TERRAIN_VARIANTS; variant++) {
      const png = await encodePng(paintTerrainTile(kind, variant))
      const meta = JSON.stringify({ version: 'v1-terrain-tile', kind, variant, wPx: TERRAIN_TILE_W, hPx: TERRAIN_TILE_H })
      out.push(codex.register({
        class: 'terrain', desc: `tile: ${kind}`, kind, meta, footprint: { w: 1, h: 1 },
        png, widthPx: TERRAIN_TILE_W, heightPx: TERRAIN_TILE_H, status: 'ready',
        score: 10, attempts: 1, costUsd: 0,
      }))
    }
  }
  return out
}
```

- [ ] **Step 1: failing tests** — `terrain.test.ts` (shared): manifest parses; wrong version rejects; variant out of range rejects. `terrainTiles.test.ts` (forge): `paintTerrainTile('grass', 0)` is 32×16; the four diamond corners `(16,0)`, `(16,15)`, `(0,7)`, `(31,7)` are opaque and every opaque pixel is a MASTER_PALETTE color (palette law); center `(16,8)` opaque, corner `(0,0)` transparent; variants 0..3 differ (byte-compare a 8×4 center crop); `road` base color `0xD4BC9E` differs from `grass` base `0x93B573` (visually distinct law).
- [ ] **Step 2: RED** — `pnpm vitest run packages/forge/src/terrainTiles.test.ts packages/shared/src/terrain.test.ts` fails (modules missing).
- [ ] **Step 3: implement** per the code above (~70 lines shared, ~80 lines forge).
- [ ] **Step 4: GREEN** + full suite + `pnpm typecheck` (additive only — golden untouched, forge has no world-state dependency).
- [ ] **Step 5: Commit** — `feat(forge): palette-true terrain tile painter + codex ingest (grass/earth/stone/road)`

---

### Task 2: Web tileset renderer — textured ground bake with flat-diamond fallback

**Files:**
- Create: `packages/web/src/render/tileset.ts`, `packages/web/src/render/tileset.test.ts`
- Modify: `packages/web/src/render/ground.ts` (add `tilesetPlan` + bake branch), `packages/web/src/render/scene.ts` (`rebakeGround` accepts records)

**Interfaces:**
- Consumes: `TileId` (`@sj/engine/state`), `AssetRecord`/`parseTerrainTileManifest`/`TerrainTileKind` (`@sj/shared`), `groundPlan`/`TILE_COLORS` (C6), `tileToScreen`/`TILE_W`/`TILE_H` (C6 T10).
- Produces (binding for Task 12 gate):

```ts
// packages/web/src/render/tileset.ts
import type { AssetRecord, TerrainTileKind } from '@sj/shared'
import { resolveAsset } from './textures.js'

export const TERRAIN_KIND_FALLBACK: TerrainTileKind = 'grass'
// C9 Task 1b extends TileId with a road tile (id 7); this table gains `7: 'road'` then.
export const TILE_KIND: Record<number, TerrainTileKind> = {
  0: 'grass', 1: 'earth', 2: 'water', 3: 'forest', 4: 'rock', 5: 'sand', 6: 'farmland',
}
export function tileKind(id: number): TerrainTileKind { return TILE_KIND[id] ?? TERRAIN_KIND_FALLBACK }

export const TILE_VARIANT_SALT = 0x9e3779b9
export function tileVariant(x: number, y: number): number {
  // parentheses required: % binds tighter than >>>, so `>>> 0 % 4` is just `>>> 0` (controller-caught)
  return ((Math.imul(x + TILE_VARIANT_SALT, 0x27d4eb2d) ^ Math.imul(y + TILE_VARIANT_SALT, 0x165667b1)) >>> 0) % 4
}

export type TerrainTex = { kind: TerrainTileKind; variant: number; manifest: TerrainTileManifest | null; url: string | null }
// Four variant records share one kind, so a single resolveAsset lookup CANNOT select variants —
// as originally drafted ~3 of 4 tiles silently fell back to flat diamonds (controller-caught).
// Scan all ready 'terrain' records of the kind and match manifest.variant; a missing exact
// variant falls back to the first record of the kind (textured beats flat). The bake needs the
// texture URL, so TerrainTex carries it (textureUrlFor from textures.ts).
export function resolveTerrainTile(records: AssetRecord[], id: number, x: number, y: number): TerrainTex {
  const kind = tileKind(id)
  const variant = tileVariant(x, y)
  const candidates = records
    .filter((r) => r.class === 'terrain' && r.kind === kind && r.status === 'ready')
    .map((r) => ({ rec: r, manifest: parseTerrainTileManifest(r.meta) }))
    .filter((c): c is { rec: AssetRecord; manifest: TerrainTileManifest } => c.manifest !== null)
  const hit = candidates.find((c) => c.manifest.variant === variant) ?? candidates[0] ?? null
  return { kind, variant, manifest: hit?.manifest ?? null, url: hit !== null ? textureUrlFor(hit.rec) : null }
}
```

`ground.ts` addition — textured bake; `records` empty → C6 flat diamonds (asset independence):

```ts
export type TilePlan = { sx: number; sy: number; tex: TerrainTileManifest | null; url: string | null; fallback: number }
export function tilesetPlan(terrain: TileId[][], records: AssetRecord[]): TilePlan[] {
  const cells: TilePlan[] = []
  for (let y = 0; y < terrain.length; y++) for (let x = 0; x < terrain[y]!.length; x++) {
    const { sx, sy } = tileToScreen(x, y)
    const { manifest, url } = resolveTerrainTile(records, terrain[y]![x]!, x, y)
    cells.push({ sx, sy, tex: manifest, url, fallback: TILE_COLORS[terrain[y]![x]!] ?? 0x93b573 })
  }
  return cells
}
```

Bake rule (exact): `rebakeGround(terrain, records)` draws `tilesetPlan` into the existing `RenderTexture` — a `Sprite` per textured tile (texture resolved via the codex URL, drawn 1:1 at `tileToScreen`, NEAREST already global from C6 T11) and a flat diamond (`Graphics`) per fallback tile. Textures cached per `(kind, variant)` (≤ 32), loaded through the existing `TextureBook`. The whole plan is one bake pass — spec §15 "one draw call" holds for the baked Sprite.

- [ ] **Step 1: failing tests** (pure, no DOM): `tileKind` exact (`0→'grass'`, `6→'farmland'`, unknown id `99→'grass'`); `tileVariant` deterministic and stable (same `(x,y)` twice equal; a 4×4 sweep hits all 4 variants); `resolveTerrainTile` with all 4 variant records returns the manifest whose `variant` matches `tileVariant(x,y)` plus its `url`; with only variant-0 records it falls back to variant 0's manifest (textured beats flat); with no terrain records → `manifest === null && url === null`; `tilesetPlan` on a 2×2 map returns 4 entries with exact `sx/sy` and `tex === null` when `records` is empty.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(web): textured terrain tileset renderer with flat-diamond fallback`

---

### Task 3: Showcase town map — plaza, roads, plots, riverbank (genesis fixture)

**Files:**
- Create: `packages/gateway/src/showcaseMap.ts`, `packages/gateway/src/showcaseMap.test.ts`
- Modify: `packages/gateway/src/devWorld.ts` (dev world opts gain `map: 'scripted' | 'showcase'`, default `'scripted'` — G6 behavior unchanged until the gate opts in)

**Interfaces:**
- Consumes: `TileId` (`@sj/engine/state`), Zod 4.
- Produces (binding for Tasks 10/12 — the interior + gate scenes run against this map):

```ts
import { z } from 'zod'
export const SHOWCASE_W = 48, SHOWCASE_H = 48
export const ROAD_TILE = 7   // C9 Task 1b TileId; the map authors it, the engine folds it once C9 lands
export const ShowcaseStructureSchema = z.object({
  kind: z.enum(['hut', 'storehouse', 'shed']), x: z.number().int().min(0), y: z.number().int().min(0),
  w: z.number().int().min(1).max(4), h: z.number().int().min(1).max(4),
}).strict()
export const ShowcaseMapSchema = z.object({
  terrain: z.array(z.array(z.number().int().min(0).max(7))),
  structures: z.array(ShowcaseStructureSchema),
}).strict()
export type ShowcaseMap = z.infer<typeof ShowcaseMapSchema>
export function makeShowcaseMap(): ShowcaseMap
```

Map design (pure, deterministic, founders-world consistent — spec §10): a forking river along the west edge (`water`, y-split at the fork), meadow (`grass`) filling the center, a forest band on the east edge (`forest`), a rocky hill at the north-east corner (`rock`); a central **plaza** (`road`-textured stone, a 5×4 rectangle at (24,24)); a **road network** (1-wide `ROAD_TILE` spines) connecting the plaza to four building plots — a hut plot (30,20), a storehouse plot (20,20), a shed plot (26,30) — and a **riverbank path** (a `ROAD_TILE` strip running north–south along the river bend). One `standing_stone`-adjacent open meadow tile at the plaza's north edge (the stone is C8 content; C10 reserves the tile, does not place the structure). Structure placement: the three structures sit on their plots exactly as `ShowcaseStructureSchema` rows; every plot's door tile (south-center, C9 `doorTile` law) has a `ROAD_TILE` adjacent.

- [ ] **Step 1: failing tests** — `makeShowcaseMap()` parses under `ShowcaseMapSchema`; deterministic (two calls deep-equal); dimensions 48×48; road connectivity: BFS from the plaza over `ROAD_TILE`/plaza tiles reaches the door tile of every structure plot; every structure sits on `grass`/`earth` (buildable) with a road tile adjacent to its south-center door; the river is a contiguous water run on the west edge; the forest band is non-empty on the east edge.
- [ ] **Step 2: RED.** **Step 3: implement** (~120 lines: terrain grid literal + 3 structure rows + a small connectivity self-check helper used only by tests).
- [ ] **Step 4: GREEN + suite + typecheck.** Note in the commit body: the map authors `ROAD_TILE = 7`; folding it requires C9 Task 1b's `TileId`/`TERRAIN_COST` extension — until then the dev world keeps `map:'scripted'`.
- [ ] **Step 5: Commit** — `feat(gateway): designed showcase town map — plaza, roads, plots, riverbank`

---

### Task 4: Documentary UI shell — status strip, lens hints, real empty states

**Files:**
- Create: `packages/web/src/ui/townStats.ts`, `packages/web/src/ui/townStats.test.ts`, `packages/web/src/ui/StatusStrip.tsx`
- Modify: `packages/web/src/App.tsx` (render `<StatusStrip/>` + lens count hints), `packages/web/src/ui/chrome.css` (strip + hint tokens), `packages/web/src/ui/RosterPanel.tsx`/`ChroniclePanel.tsx`/`SocietyLens.tsx` (empty-state copy)

**Interfaces:**
- Consumes: `WorldStore`, `tickToMoment` (`@sj/shared`), `WorldState` (`@sj/engine/state`).
- Produces:

```ts
// townStats.ts — pure, no DOM; the strip is a thin render over it
export type TownStats = { day: number; time: string; weather: string; alive: number; total: number }
export function townStats(state: WorldState | null, tick: number): TownStats {
  const m = tickToMoment(tick)
  const agents = state ? Object.values(state.agents) : []
  const alive = agents.filter((a) => a.alive).length
  return { day: m.day, time: m.time, weather: state?.weather.kind ?? '—', alive, total: agents.length }
}
export type LensHint = { lens: Lens; count: number | null; hint: string }
export function lensHints(stats: TownStats, recentEvents: SimEvent[]): LensHint[]
//  map: 'Walk the town'; inspector: `Townsfolk (${alive})`; chronicle: `Chronicle (${recentEvents.length})`;
//  bonds/moments: hint text only (counts arrive with Tasks 7/8 via a lensCounts override)
```

`StatusStrip.tsx` (exact): a top-bar strip under the lens tabs — left: pixel clock `Day N HH:MM` + weather glyph; right: `Townsfolk N` (alive) + `·` + weather kind. Every glyph is a palette hex (no emoji). Lens bar gains per-lens hint text (title/aria-label) and a count badge where `count !== null`; NO gamification wording ("progress", "score", "level" are banned strings — asserted in the copy scan of Step 4).

Empty-state copy (documentary, exact strings):
- Roster: `"No one walks the town yet — the first footsteps are still to come."` (kept) + sub-line `"The founders arrive at dawn."`
- Chronicle: `"Day one is still unwritten. The town's ledger fills as the townsfolk live it."`
- Bonds: `"No bonds recorded yet — watch long enough and the town will braid its own ties."`
- Moments: `"Nothing worth replaying yet — the first recorded day is still ahead."` (Task 9 renders it; copy defined here)

- [ ] **Step 1: failing tests** — `townStats`: fixture state with 3 alive + 1 dead → `{alive:3, total:4}`; weather passthrough; `tickToMoment` math exact at a boundary tick (day 0 00:00). `lensHints`: chronicle count equals `recentEvents.length`; no hint string contains `progress|score|level|quest|points` (case-insensitive — the gamification ban as a test).
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck; manual check:** boot against the Task 8 C6 dev world → the strip shows a live clock + weather + `Townsfok 4`, tabs carry hints, empty lenses show the new copy.
- [ ] **Step 5: Commit** — `feat(web): documentary status strip, lens hints, and real empty states`

---

### Task 5: Interaction polish — hover name tags, click-to-inspect everywhere, keyboard nav, focus rings

**Files:**
- Create: `packages/web/src/render/nameTags.ts`, `packages/web/src/ui/interaction.ts`, tests `packages/web/src/ui/interaction.test.ts`
- Modify: `packages/web/src/render/characters.ts` (hover → name tag), `packages/web/src/render/entities.ts` (item/crop hover + click → detail popover), `packages/web/src/ui/chrome.css` (focus-ring completion), `packages/web/src/App.tsx` (arrow-key lens cycling)

**Interfaces:**
- Consumes: `WorldState`/`Structure`/`Item`/`Crop` (`@sj/engine/state`), Scene, `Lens`/`LENSES` (C6 T9), `TextureBook` (BitmapText tag reuse from `bubbles.ts` pattern).
- Produces:

```ts
// interaction.ts — pure
export function hoverLabel(state: WorldState, kind: 'agent' | 'structure' | 'item' | 'crop', id: string): string | null
//  (named hoverLabel, NOT nameTagText — charAnim.ts already exports nameTagText(name) for the sprite tag)
//  agent → "<name>"; structure → "<kind> — built by <name>" or "<kind>"; item → "<kind> ×<qty>" (+ " · <owner>'s" when owned, C9 §2);
//  crop → "<kind> (stage <n>/4)"; unknown id → null
export function lensFromKey(key: string): Lens | null   // ArrowRight → next, ArrowLeft → prev (cyclic); else null
export function itemCropDetail(state: WorldState, kind: 'item' | 'crop', id: string): string | null
//  item → "kind ×qty, owned by X" / crop → "kind, planted day D, stage n" — the popover line
```

`nameTags.ts` (Pixi): a shared `BitmapText` tag (cream fill, ink border, 9px — reuse `bubbles.ts` `BUBBLE_FILL`/`BUBBLE_INK`); `pointerover` on an agent/structure/item/crop sprite shows the tag above the sprite's feet (`EMOTE_ABOVE_HEAD_PX` from C6 T13), `pointerout` hides it. Structures/items/crops gain `eventMode:'static'` + `pointertap` → item/crop detail popover (reuse `entities.ts` `showPopover`), agents keep their existing select route (C6 fix 3 hit area — polished, not rebuilt).

Keyboard (exact): lens tabs already buttons; add `ArrowLeft`/`ArrowRight` at the app level (when focus is not in an input) to cycle lenses via `lensFromKey`; canvas arrow-pan/+−/Home already live (C6 StageMount); ensure `:focus-visible` outlines exist on every interactive element (tabs, cam buttons, legend chips, moment links, roster cards) — fill the CSS gaps, no new focus system.

- [ ] **Step 1: failing tests** — `hoverLabel`: agent exact; structure `'hut — built by builder'` vs no-builder `'hut'`; item `'bread ×3'` and owned `'bread ×3 · Rahel's'`; crop stage; unknown → null. `lensFromKey`: ArrowRight/Left cycle with wraparound; other keys → null. `itemCropDetail` exact strings.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(web): hover name tags, click-to-inspect everywhere, keyboard lens cycling, focus rings`

---

### Task 6: Chronicle events — important-event log, icons, scrub-to-event, real chapter anchors

**Files:**
- Create: `packages/shared/src/chronicle.ts` + `chronicle.test.ts`; `packages/gateway/src/narratorApi.ts` + `narratorApi.test.ts`; `packages/web/src/ui/importantFeed.ts` + `importantFeed.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/gateway/src/api.ts` (mount `/api/chronicle`), `packages/gateway/src/server.ts` (`GatewayOpts` gains `narratorDbPath?: string`), `packages/web/src/ui/ChroniclePanel.tsx` (Important sub-view), `packages/web/src/ui/Timeline.tsx` (chapter anchors from the real reader)

**Interfaces:**
- Consumes: `SimEvent` (`@sj/shared`), `NarratorStore`/`chaptersInRange`/`milestones` (`@sj/narrator`), `WorldMirror`, event store `SELECT`.
- Produces (binding for Task 12 + C8 rehearsal):

```ts
// packages/shared/src/chronicle.ts
export const CHRONICLE_WEIGHTS: Record<string, number> = {
  agent_died: 20, agent_born: 18, co_slept: 12, structure_completed: 10,
  fire_ignited: 9, fire_spread: 7, structure_inscribed: 6, mystery_event: 4,
}
export const CHRONICLE_ICONS: Record<string, string> = {
  agent_died: 'cross', agent_born: 'spark', co_slept: 'heart', structure_completed: 'house',
  fire_ignited: 'flame', fire_spread: 'flame', structure_inscribed: 'quill', mystery_event: 'star',
}
export const ChronicleEntrySchema = z.object({
  seq: z.number().int().positive(), tick: z.number().int().nonnegative(),
  type: z.string().min(1), icon: z.string().min(1), label: z.string().min(1),
}).strict()
export type ChronicleEntry = z.infer<typeof ChronicleEntrySchema>
```

```ts
// packages/web/src/ui/importantFeed.ts — human-framed labels (no mechanics vocabulary)
export function chronicleLabel(ev: SimEvent, state: WorldState | null): string | null
//  agent_died → '<Name> has died (<cause>).'  agent_born → '<Name> was born.'
//  co_slept → '<A> and <B> kept house together.'  structure_completed → 'The <kind> is finished.'
//  fire_ignited → 'Fire! The <kind> is burning.'  structure_inscribed → 'New words carved on the <kind>.'
//  mystery_event → '<prose>' (authored table lookup)  unknown → null (forward-compatible)
```

`narratorApi.ts` (gateway): `mountNarratorApi(router, deps)` where `deps.narratorDb` is a readonly `new Database(narratorPath, { readonly: true })` (or absent → the C6 stub shapes). Endpoints: `/api/chronicle?fromTick=&toTick=` scans events for `CHRONICLE_WEIGHTS` keys (prepared `SELECT seq, tick, type, payload FROM events WHERE type IN (…) AND tick BETWEEN ? AND ? ORDER BY seq`), labels via `chronicleLabel` semantics (gateway-side, mirroring the web formatter), merges narrator `milestones()` as `first` entries (icon `'spark'`); `/api/chapters` returns `NarratorStore.chaptersInRange(0, now).map(c => ({day: c.day, title: c.title}))` (the real C7 reader, replacing the C6 `[]`); `/api/milestones` returns the C7 firsts ledger `{kind, label, day, tick}`. Missing `narrator.db` → all three return typed empties (`[]`), never 500.

- [ ] **Step 1: failing tests** — `chronicle.test.ts`: weights/icon coverage (every weight key has an icon; every icon key is weighted). `importantFeed.test.ts`: `chronicleLabel` exact strings for died/born/co_slept/completed/inscribed with a fixture state (names resolve); unknown future type → null. `narratorApi.test.ts`: seed a temp world DB with a scripted event sequence (spawns, a death, a `structure_completed`, a `co_slept`) + a real `narrator.db` (via `openNarratorDb`/`migrateNarratorTables` + `NarratorStore.insertChapter`/`insertMilestone`); assert `/api/chronicle` returns only weighted types in tick order with correct icons, `/api/chapters` returns the real chapter title (NOT `[]`), `/api/milestones` returns the first; absent narrator.db → all `[]`.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(gateway+web): important-event chronicle, icons, scrub-to-event, real C7 chapter anchors`

---

### Task 7: Bonds redesign — detail panel + redesigned graph (stub-friendly vs C9 T11/T12)

**Files:**
- Create: `packages/shared/src/bonds.ts` + `bonds.test.ts`; `packages/gateway/src/bonds.ts` + `bonds.test.ts`; `packages/web/src/ui/bondsModel.ts` + `bondsModel.test.ts`; `packages/web/src/ui/BondDetailPanel.tsx`
- Modify: `packages/shared/src/index.ts`, `packages/gateway/src/api.ts` (mount `/api/bonds`), `packages/web/src/ui/SocietyLens.tsx` (edge hover/click → detail), `packages/web/src/App.tsx` (bonds lens count)

**Interfaces:**
- Consumes: events (`agent_spoke`, `action_completed {verb:'give'|'teach'|'attack'}`, `co_slept` [C9 T11], `agent_born` [C9 T12]), `WorldMirror.state()` (names).
- Produces (binding — C9 T11/T12 must satisfy this shape; the proxy stands in until then):

```ts
// packages/shared/src/bonds.ts
export const BondKindSchema = z.enum(['partner', 'kin', 'friend', 'rival', 'owe', 'work'])
export type BondKind = z.infer<typeof BondKindSchema>
export const BondEventSchema = z.object({ tick: z.number().int().nonnegative(), kind: z.string().min(1), note: z.string().min(1) }).strict()
export const BondSchema = z.object({
  id: z.string().min(1),                       // pairKey(a,b) sorted join
  aId: z.string().min(1), bId: z.string().min(1),
  kind: BondKindSchema,
  strength: z.number().min(0),
  formedTick: z.number().int().nonnegative(),
  lastUpdatedTick: z.number().int().nonnegative(),
  history: z.array(BondEventSchema),
}).strict()
export type Bond = z.infer<typeof BondSchema>
export const BondsResponseSchema = z.object({ bonds: z.array(BondSchema), asOfTick: z.number().int().nonnegative() }).strict()
```

Deterministic proxy rules (exact — mirror C6's society proxy, extended): `agent_spoke` pairs within `TALK_WINDOW_TICKS` + earshot → `friend` (weight +1); `action_completed give` → `owe`; `teach` → `work`; `attack` → `rival`; `co_slept` → `partner`; `agent_born` parent links → `kin` for each parent↔child pair. Each event appends a `history` entry `{tick, kind, note}` with a human-framed note (`"spoke together"`, `"gave something away"`, `"kept house together"`, `"parent and child"`). `strength` = history length; `formedTick` = first history tick; `lastUpdatedTick` = last. When C9 T11/T12 lands, this module's reader swaps to C9's relationship rows; the `BondSchema`/`BondsResponseSchema` shape does not change (C6 stub-swap precedent).

`bondsModel.ts` (web, pure): `toBondGraph(api: BondsResponse)` → `{ nodes, links }` — link color by `kind` (`partner:0xE8785A rose, kin:0x8A6FA8, friend:0x7FB0C9, rival:0x9E5A5C, owe:0xF2C879, work:0x93B573`), width `1+log2(strength)`; node size `6+2·degree`. `BondDetailPanel.tsx`: kind label, strength bar (0..max strength in the response), formed/last-updated as `tickToMoment` day+time, and the `history` timeline (tick-stamped notes, newest first). Edge hover shows a tooltip `A — kind — B`; edge click opens the detail panel.

- [ ] **Step 1: failing tests** — `bonds.test.ts` (gateway): seed a scripted sequence (a talk pair, a give, a co_slept, a birth with parents) → `/api/bonds` returns the exact bonds: `partner` bond with `strength 1` + history `['kept house together']`; `kin` bonds parent↔child; `owe` from the give; `formedTick` = earliest tick; `lastUpdatedTick` = latest; a pair with no events → no bond. `bondsModel.test.ts`: exact link colors/widths; `strength 4 → width 3`; node size by degree. Missing C9 data (only talk events) still yields the `friend` bond (stub law).
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(gateway+web): bonds — detail panel and redesigned graph over the C9 relationship contract (stub proxy)`

---

### Task 8: Moments — player state machine + `/api/moments` (pure, TDD)

**Files:**
- Create: `packages/shared/src/moments.ts` + `moments.test.ts`; `packages/web/src/ui/momentsPlayer.ts` + `momentsPlayer.test.ts`
- Modify: `packages/shared/src/index.ts`, `packages/gateway/src/narratorApi.ts` (`/api/moments`), `packages/web/src/ui/route.ts` (`momentId` route extension + `route.test.ts`)

**Interfaces:**
- Consumes: `NarratorStore.scenesForDay`/`chaptersForDay` (`@sj/narrator`), `momentToTick`/`tickToMoment` (`@sj/shared`).
- Produces (binding for Task 9 + Task 12):

```ts
// packages/shared/src/moments.ts
export const MomentSchema = z.object({
  id: z.number().int().positive(),             // narrator scene id
  day: z.number().int().nonnegative(),
  startTick: z.number().int().nonnegative(),
  endTick: z.number().int().nonnegative(),
  title: z.string().min(1),
  cast: z.array(z.string().min(1)),
  location: z.string().nullable(),
}).strict()
export type Moment = z.infer<typeof MomentSchema>
export const MomentsResponseSchema = z.object({ moments: z.array(MomentSchema) }).strict()
```

```ts
// packages/web/src/ui/momentsPlayer.ts — pure state machine
export const PLAY_SPEEDS = [1, 2, 4, 8] as const
export type PlaySpeed = typeof PLAY_SPEEDS[number]
export const MOMENT_STEP_MS = 500            // at 1×, advance one tick per 500ms wall-clock
export type PlayerState = { status: 'idle' | 'playing' | 'paused'; tick: number; speed: PlaySpeed }
export function tickPlayer(prev: PlayerState, deltaMs: number, startTick: number, endTick: number): PlayerState
//  pure accumulator — PlayerState carries NO wall-clock anchor (the drafted formula referenced an
//  undeclared `startMs`; controller-fixed). The rAF loop owns the clock and passes elapsed ms since
//  the previous call: playing → tick = clamp(prev.tick + floor(deltaMs / MOMENT_STEP_MS) · speed, startTick, endTick)
//  tick reaches endTick → { status:'idle', tick: endTick, speed } (playback ends); paused/idle → unchanged
export function seekPlayer(prev: PlayerState, frac: number, startTick: number, endTick: number): PlayerState
//  tick = startTick + round(frac · (endTick − startTick)); playing continues from there
```

`/api/moments` (gateway): scans narrator scenes — `NarratorStore.scenesForDay(d)` for every day 0..current, title = the day's chapter title when a chapter exists else `Day ${d}`; `cast`/`location` straight from the scene row. Returns `MomentsResponse`; empty until C7 narrates a day (the designed empty state from Task 4 renders).

`route.ts` extension — `/moment/<id>` (2 segments) vs the existing `/moment/:day/:time` (3 segments):

```ts
export type Route = { lens: Lens; moment: { day: number; time: string } | null; momentId: number | null; agentId: string | null }
// parseRoute: segs.length === 3 && segs[0] === 'moment' → day/time (existing);
//            segs.length === 2 && segs[0] === 'moment' && /^\d+$/ → momentId
// routeToPath: momentId set → `/moment/${momentId}`; else existing day/time path
```

- [ ] **Step 1: failing tests** — `moments.test.ts`: schema round-trip; rejects negative tick. `momentsPlayer.test.ts`: `tickPlayer` at 1× advances 1 tick per 500ms of accumulated `deltaMs`; speed 4 advances 4× faster (feed `deltaMs: 500` repeatedly, assert tick deltas); sub-500ms deltas advance 0 ticks; clamps to `endTick` and flips to `idle` at the end; `seekPlayer` at frac 0.5 lands on the midpoint tick; paused preserves tick. `route.test.ts`: `parseRoute('/moment/42')` → `{momentId:42}`; `/moment/41/14:30` → `{moment:{day:41,time:'14:30'}}` (regression); `/moment/abc` → both null; round-trip preserves `momentId`.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(shared+gateway+web): moments contract, /api/moments, pure player, /moment/<id> deep-link`

---

### Task 9: Moments lens — list, thumbnails, playback controls, empty state

**Files:**
- Create: `packages/web/src/ui/MomentsLens.tsx`, `packages/web/src/ui/momentThumb.ts` + `momentThumb.test.ts`
- Modify: `packages/web/src/App.tsx` (mount MomentsLens on `lens==='director'`, wire `/moment/<id>` load + player scrub), `packages/web/src/ui/chrome.css` (moments list + player chrome)

**Interfaces:**
- Consumes: `/api/moments` (Task 8), `MomentPlayer` (`momentsPlayer.ts`), `ObservatoryHandle.scrub`/`goLive` (C6 socket), Scene `setZoom`/`centerOn`, `Moment`/`tickToMoment`.
- Produces:

```ts
// momentThumb.ts — deterministic pixel postcard (no image generation)
export type ThumbLabel = { day: number; cast: string; location: string | null }
export function thumbLabel(m: Moment): ThumbLabel   // first 2 cast names joined ', ' else 'the town'
export function thumbTitle(m: Moment): string       // m.title
```

`MomentsLens.tsx` (exact): replaces the C6 auto-cut director as the `director` lens' surface (the TV auto-cut stays available behind a `LIVE` toggle — it is a lens *view*, not a game). Renders: a moment list (postcard thumbnail = pixel-frame `div` with day stamp + cast line + location glyph, all palette hexes), each row click → load that moment; a player strip — play/pause toggle, a seek bar over `[startTick, endTick]`, a speed control cycling `1×/2×/4×/8×`. Play drives `tickPlayer` on a rAF loop, calling `handle.scrub(tick)` each step; scrub keeps the address bar at `/moment/<id>` (deep-link shareable). Zero moments → the Task 4 empty-state copy (exact string). `LIVE` returns to the town via `handle.goLive()` + `routeToPath` clearing `momentId`.

- [ ] **Step 1: failing tests** — `momentThumb.test.ts`: `thumbLabel` joins ≤2 cast names; empty cast → `'the town'`; `thumbTitle` passthrough.
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck; manual check:** with a narrated dev world, the moments list shows recorded days; play advances the scrub banner day/time at 1× and 4×; cold-reload `/moment/<id>` reproduces the moment.
- [ ] **Step 5: Commit** — `feat(web): moments lens — recorded-day list, postcard thumbnails, playback controls`

---

### Task 10: Interior scenes — layouts, occupancy, transition (pure, TDD)

**Files:**
- Create: `packages/web/src/render/interiors.ts`, `packages/web/src/render/interiors.test.ts`

**Interfaces:**
- Consumes: `WorldState`/`Structure`/`AgentBody` (`@sj/engine/state`), `insideId` (C9 Task 2), `Item.loc {t:'structure'}`.
- Produces (binding for Task 11 + Task 12):

```ts
export type InteriorKind = 'hut' | 'storehouse' | 'shed'
export const INTERIOR_KINDS: InteriorKind[] = ['hut', 'storehouse', 'shed']
export type FurnishingKind = 'bed' | 'hearth' | 'table' | 'shelf' | 'crate' | 'tools'
export type Furnishing = { kind: FurnishingKind; slot: { x: number; y: number } }
export const INTERIOR_LAYOUTS: Record<InteriorKind, Furnishing[]> = {
  hut:        [{ kind: 'bed', slot: { x: 2, y: 1 } }, { kind: 'hearth', slot: { x: 0, y: 2 } }, { kind: 'table', slot: { x: 1, y: 2 } }],
  storehouse: [{ kind: 'shelf', slot: { x: 0, y: 1 } }, { kind: 'shelf', slot: { x: 1, y: 1 } }, { kind: 'crate', slot: { x: 2, y: 2 } }],
  shed:       [{ kind: 'tools', slot: { x: 1, y: 1 } }, { kind: 'crate', slot: { x: 2, y: 1 } }],
}
export function interiorOf(state: WorldState, structureId: string): {
  structure: Structure; kind: InteriorKind; occupants: string[]; items: string[]
} | null
//  structure by id; kind = structure.kind when in INTERIOR_KINDS else null;
//  occupants = agent ids with insideId === structureId (C9 §1); items = item ids with loc {t:'structure', id}
export function bedSlots(kind: InteriorKind, sleeping: string[]): Record<string, { x: number; y: number }>
//  each sleeping occupant (C9 Task 2b) gets the next bed slot; non-bed kinds → no mapping
export type InteriorPhase = 'town' | 'entering' | 'inside' | 'exiting'
export const INTERIOR_FADE_MS = 260
export function interiorTransition(prev: InteriorPhase, entered: boolean, nowMs: number): InteriorPhase
//  entered=true → town→entering→inside; entered=false → inside→exiting→town; time-gated by INTERIOR_FADE_MS
```

Semantics (exact): occupancy is engine truth — C9's `insideId`. The viewer *camera* entering an interior is presentation-only (follow an entering agent, or click a structure door to "look inside"); it never writes `insideId`. Sleep-in-bed is C9 Task 2b's law; C10 renders a sleeping occupant on a `bed` slot. Items stored in the structure (already `loc {t:'structure'}`) render on `shelf`/`crate` slots in storehouse/shed.

- [ ] **Step 1: failing tests** — `interiorOf`: a hut with two occupants inside (fixture `insideId`) + one item stored → exact `occupants`/`items`/`kind`; a `standing_stone` kind → null; empty interior → occupants `[]`. `bedSlots('hut', [a, b])` maps both to distinct bed slots; `bedSlots('shed', [a])` → `{}` (shed has no beds — sleep law only in private kinds). `interiorTransition`: `town →entered→ entering →inside`; `inside →entered=false→ exiting →town`; time-gated (before `INTERIOR_FADE_MS` stays in the phase).
- [ ] **Step 2: RED.** **Step 3: implement.** **Step 4: GREEN + suite + typecheck.**
- [ ] **Step 5: Commit** — `feat(web): interior layouts, occupancy mapping, and enter/exit transition (pure)`

---

### Task 11: Interior scenes — Pixi assembly, occupancy rendering, back-to-town

**Files:**
- Create: `packages/web/src/render/interiorScene.ts`
- Modify: `packages/web/src/App.tsx` (follow-selection → interior trigger + back-to-town affordance), `packages/web/src/render/StageMount.tsx` (mount the interior sub-scene), `packages/web/src/ui/chrome.css` (back-to-town button + interior fade veil)

**Interfaces:**
- Consumes: `Scene`, `WorldStore.onEvents`, `interiorOf`/`interiorTransition`/`INTERIOR_LAYOUTS` (Task 10), `TextureBook`/`textureUrlFor` (furniture placeholders via codex `item`/`terrain` classes), character sprites (`characters.ts` layer).
- Produces:

```ts
export type InteriorScene = {
  setActive(structureId: string | null): void     // null → back to town
  isActive(): boolean
  destroy(): void
}
export function createInteriorScene(scene: Scene, store: WorldStore, book: TextureBook, charLayer: CharacterLayer): InteriorScene
```

Behavior (exact):
- Trigger: the viewer's **followed agent** (inspector follow-cam) emits `agent_entered` (store `onEvents` watches `agent_entered`/`agent_exited` for the followed id) → `interiorTransition('entering')` → fade the world container out, fade the interior sub-scene in over `INTERIOR_FADE_MS`. Or a **door click** on a complete enterable structure (hut/storehouse/shed) opens the same interior view (presentation-only look-inside). `agent_exited` → fade back.
- The interior sub-scene is a separate Pixi `Container` sibling of `world`: a room backdrop (a `Graphics` floor diamond sized to the structure footprint × 2, warm cream `0xF6E8D5`, ink rim), the `INTERIOR_LAYOUTS[kind]` furniture as placeholder sprites (codex `item` class, fallback `makePlaceholder`), stored items on `shelf`/`crate` slots, and occupants at their slots — sleeping on `bed` (lying pose row already in the character sheet), awake at the `hearth`/`table`. The main world keeps rendering underneath (the outside world stays on the main scene — user ruling).
- Back-to-town: a chrome button (top-left of the interior view, pixel-styled, `"Back to town"`) calls `setActive(null)` → fade the interior out, world back. This is viewer-camera only; no engine call.
- Tone rule: the fade is structural (not a cartoon effect) and is NOT suppressed under grave tone; furniture/occupant animation obeys the existing tone director.

- [ ] **Step 1: manual check** (Pixi assembly — pure logic is Task 10's tests): with the dev world + a scripted enter/exit (or the gate fixture), following an agent who enters a hut fades to the hut interior (bed + hearth + table), the sleeping occupant lies on the bed, the outside town stays visible after "Back to town", and an exiting agent fades back to the map. Record screenshots for the gate.
- [ ] **Step 2: suite + typecheck green** (no new pure unit surface; Task 10 carries the determinism).
- [ ] **Step 3: Commit** — `feat(web): interior scenes — occupancy rendering, enter/exit fades, back-to-town`

---

### Task 12: GATE G10 — two browsers, 60fps, scrub, interior, moments, chronicle jump

**Files:**
- Create: `packages/gateway/src/g10.test.ts` (the automated half)
- Modify: none elsewhere — this task PROVES, it does not build (except wiring the gate map opts, Task 3's `map:'showcase'` flag, already declared).

**Automated half** (`g10.test.ts`, CI-green required):
1. **Tileset + map:** `makeShowcaseMap()` parses and is road-connected (Task 3 invariants); `tilesetPlan` on the showcase terrain returns a `tex` for every `grass`/`road` tile once `registerTerrainTiles`-produced records exist, and `tex === null` (fallback) with an empty record set.
2. **Determinism:** `registerTerrainTiles` twice over a fresh codex yields byte-identical PNGs (painter is pure); `makeShowcaseMap()` twice deep-equals; `momentToTick`/`tickToMoment` round-trips for the `/moment/<id>` path.
3. **Chronicle/bonds/moments parity:** a scripted world DB + narrator.db drives `/api/chronicle` (weighted types only, tick-ordered), `/api/bonds` (exact partner/kin/owe bonds), `/api/moments` (scenes → moments); absent narrator.db → all `[]`.
4. **Interior purity:** `interiorOf` + `interiorTransition` + `bedSlots` invariants from Task 10 re-asserted end-to-end on a C9-shaped state fixture (an `insideId` occupant, a stored item).
5. **FULL repo suite green:** goldens G1/G2 untouched — `pnpm test` output attached to the report. C10 writes no world state; the golden hash cannot move.

**Human-evidenced half** (protocol, evidence pasted into the gate report — screenshots + numbers):
1. `pnpm --filter @sj/gateway dev:world` (showcase map + real 2.5s ticks) + `pnpm --filter @sj/web dev`; open TWO different browsers (Chrome + Firefox) at `localhost:5173`.
2. **60fps:** `FpsOverlay` 60s rolling average ≥ 58 in BOTH browsers on the map lens with textured ground, ambient motion, and weather active. Screenshot both overlays.
3. **Scrub:** drag the timeline to an earlier day — textured terrain + structures + agents match that moment; deep-link `/moment/<day>/<time>` cold-reload reproduces it.
4. **Interior enter/exit:** follow an agent who enters a hut → fade to the hut interior (bed/hearth/table, sleeping occupant on the bed); "Back to town" returns; an exit fades back. Before/after screenshots.
5. **Moments playback:** open a recorded day from the Moments list → play advances the view at 1× and 4×; pause holds; seek jumps; `/moment/<id>` cold-reload reproduces it.
6. **Chronicle event jump:** click a death entry in the important-event feed → the timeline scrubs to that tick and the scrub banner shows the death's day/time.

- [ ] **Step 1: write `g10.test.ts` (RED where meaningful).**
- [ ] **Step 2: automated half GREEN; full suite + typecheck GREEN.**
- [ ] **Step 3: run the human protocol; collect evidence into the gate report.**
- [ ] **Step 4: Commit** — `test(observatory): GATE G10 — dual-viewer parity, scrub, interior, moments, chronicle jump` + tag `gate-g10`.

---

## Self-review notes (done at authoring)

- Every user ruling maps to a task: textured ground + road network (1, 2), showcase town layout (3), documentary UI shell with no gamification (4 — the ban is a test), interaction affordances (5), important-event chronicle + scrub-to-event + chapter anchors (6), bonds redesign over the C9 relationship contract (7), moments working (8, 9), interior scenes (10, 11), gate (12). **Task count: 12.**
- C9 dependencies are explicit and stub-safe: Task 2 renders the road tile only once C9 Task 1b extends `TileId` (the table holds the `7:'road'` entry behind a comment); Task 3 authors `ROAD_TILE = 7` as genesis input and keeps the dev world on `map:'scripted'` until C9 folds it; Task 7's bond proxy satisfies the `BondSchema` C9 T11/T12 must fill; Tasks 10/11 render occupancy against C9's `insideId`/`agent_entered`/`agent_exited`/sleep-in-bed and render empty until those events flow. No task silently assumes a later chunk's symbol — every cross-chunk name is declared in the Interfaces blocks and marked.
- C7 dependencies: `/api/chapters` (real reader), `/api/milestones`, `/api/moments` open `narrator.db` readonly and return typed empties when absent — the C6 `[]` stub is replaced, not removed.
- Spec §15 frontend table still has a home: ref-mounted Pixi (C6), pixel-perfect consts (C6), dimetric bake (Task 2 rebuilds the bake with textures), hot-load (Task 2 reuses `TextureBook` + explicit unload), react-force-graph-2d (Task 7), plain ws + serialize-once (unchanged).
- Determinism: painter and map are pure; ground variety is a deterministic `(x,y)` hash (bake-stable, not RNG); viewer-side RNG (if any ambient effect is added) is presentation-only per C6 Task 14. C10 never writes `events`; goldens cannot move.
- Placeholder-language scan: no TBDs; every algorithm has exact constants or exact rules; the C7/C9-shaped endpoints return typed empties by design, documented as such.
- Type consistency pass: `TerrainTileManifestSchema.kind` matches `TerrainTileKind` in both shared and forge (single source `packages/shared/src/terrain.ts`); `tileKind`/`tileVariant`/`resolveTerrainTile` names consistent Task 2↔Task 12; `BondSchema`/`BondsResponseSchema` consistent Task 7↔gate; `MomentSchema`/`MomentPlayer`/`momentId` consistent Tasks 8↔9↔12; `interiorOf`/`interiorTransition`/`bedSlots` consistent Tasks 10↔11↔12.
- "Marriages" in the chronicle brief is implemented as `co_slept` → "kept house together" (the partnership inference, C9 §3); marriage is never authored and the word only appears if the narrator detects the town inventing it — flagged here rather than hidden.

## AMENDMENT (2026-08-16 pm2, controller — from the C11 addendum)

Task 2's single-pass `rebakeGround` is a KNOWN SUPERSESSION POINT: C11 §9 (128×128 map +
growth) replaces it with a chunked bake (`CHUNK_TILES`, `chunkOf`, dirty-chunk rebake) that
C12 §8 consumes. Build Task 2 as planned (correct at 48×48 scale) but keep the bake entry
point behind one function seam so the chunked bake swaps in without touching callers.

AMENDMENT (2026-08-16 evening, A8 ruling round — from the C13 addendum): Task 3's 48×48
`makeShowcaseMap` is SUPERSEDED as the showcase/genesis fixture by C13's `makeCityTemplate()`
(districts, 11 furnished prebuilt buildings, autotiled road grid, growth plots, 128×128 per
C11 §9); it remains a dev fixture only — build Task 3 as planned, and keep `map: 'scripted' |
'showcase'` open to a third `'city'` value when C13 lands. Additionally, Task 2's road tile
rendering gains a declared seam: when `TilesetManifest.autotile` exists (C13 §4), `tilesetPlan`
resolves road tiles via `roadAutotile(neighbors)` from `@sj/shared`; flat road variants remain
the fallback — no Task 2 rework, additive only.
