/**
 * THROWAWAY MOCK data pump for the liveness page. It spends nothing and calls no model:
 * everything below is read out of the product's own modules so the BASELINE panel is the
 * product's own arithmetic and not a second opinion about it.
 *
 *   node_modules/.bin/tsx mocks/liveness/gen.ts
 *
 * Writes mocks/liveness/scene.json. The page renders from that file and from the COMMITTED
 * art under packages/forge/content, reached through the `art` symlink — no asset is copied,
 * resized, recoloured or regenerated on the way in.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ROAD_AUTOTILE_KEYS, materialKind, townSpan, type AssetRecord, type RoadAutotileKey,
} from '../../packages/shared/src/index.js'
import { devTown } from '../../packages/gateway/src/devTown.js'
import { showcaseSpan, SHOWCASE_ANCHOR } from '../../packages/gateway/src/showcaseMap.js'
import { TILE_H, TILE_W, tileToScreen } from '../../packages/web/src/render/iso.js'
import {
  CALM_ROAD_KIND, MATERIAL_REPEAT_PX, MATERIAL_ROTATIONS_DEG, OCTAVE_ALPHA, OCTAVE_SCALE,
  ROAD_SHOULDER_DARK, ROAD_SHOULDER_LIGHT, groundField, materialMatrix, octaveMatrix,
  roadRibbonPolys, roadShoulderBands,
} from '../../packages/web/src/render/groundField.js'
import { BUILDING_PX_PER_TILE } from '../../packages/web/src/render/textures.ts'
import { CANOPY_PX, SHIMMER_PX, TREES_MAX, SHIMMER_MAX, canopyBlocks, sampleDecorations }
  from '../../packages/web/src/render/ambient.js'
import {
  CHUNK_BYTES_PER_PX, CHUNK_PX_H, CHUNK_PX_W, GPU_MIN_MAX_TEXTURE_PX, allChunks, groundGrid,
  wholeMapTextureBytes,
} from '../../packages/web/src/render/groundChunks.js'
import { listCommittedBuildings } from '../../packages/forge/src/buildingArt.js'
import { MASTER_PALETTE } from '../../packages/forge/src/palette.js'

const HERE = dirname(fileURLToPath(import.meta.url))

// ── the town the product wakes into ────────────────────────────────────────────────────────
const town = devTown()
const terrain = town.terrain
const H = terrain.length, W = terrain[0]!.length

// ── the ground field, asked of the renderer's own function ─────────────────────────────────
//
// `groundField` resolves a material through the codex, so it is handed a codex: one ready
// record per material kind, whose id is the material's own file name. The url it hands back is
// therefore `/assets/<file>.png`, which the page rewrites to the committed file.
const MATERIALS = ['grass', 'earth', 'water', 'forest', 'rock', 'sand', 'farmland', 'road',
  CALM_ROAD_KIND] as const
const records: AssetRecord[] = MATERIALS.map((k, i) => ({
  id: `terrain_${k}_0`, seq: i + 1, class: 'terrain', kind: materialKind(k), desc: k,
  meta: null, status: 'ready', score: null, attempts: 1, costUsd: 0,
  widthPx: MATERIAL_REPEAT_PX, heightPx: MATERIAL_REPEAT_PX, footprint: null,
  createdAt: 0,
} as unknown as AssetRecord))

const field = groundField(terrain, records)

const matToFile = (url: string | null): string | null =>
  url === null ? null : `art/tilesets/materials/${url.slice('/assets/'.length)}`

// A Pixi Matrix is (a,b,c,d,tx,ty) — the same six numbers a DOMMatrix takes, so the page can
// hand the product's own sampling transform straight to a canvas pattern.
const six = (m: { a: number; b: number; c: number; d: number; tx: number; ty: number }):
  number[] => [m.a, m.b, m.c, m.d, m.tx, m.ty]

const KEY_INDEX = new Map<RoadAutotileKey, number>(ROAD_AUTOTILE_KEYS.map((k, i) => [k, i]))

const layers = field.layers.map((l, i) => ({
  id: l.id,
  kind: l.kind,
  material: matToFile(l.url),
  fallback: l.fallback,
  matrix: six(materialMatrix(l.id, i)),
  octave: six(octaveMatrix(l.id, i)),
  // sx, sy, road key index (-1 = a plain diamond)
  shapes: l.shapes.map((s) => [s.sx, s.sy, s.roadKey === null ? -1 : KEY_INDEX.get(s.roadKey)!]),
}))

const roadGeom = ROAD_AUTOTILE_KEYS.map((k) => {
  const bands = roadShoulderBands(k)
  return { key: k, ribbon: roadRibbonPolys(k), dark: bands.dark, light: bands.light }
})

// ── the eleven things that stand on it ─────────────────────────────────────────────────────
const committed = new Map(listCommittedBuildings().map((b) => [b.codexKind, b]))
const cellFor = (kind: string, facing: string): { dir: string; m: typeof committed extends
  Map<string, infer V> ? V extends { manifest: infer M } ? M : never : never } | null => {
  const hit = committed.get(facing === 'sw' ? kind : `${kind}:${facing}`) ?? committed.get(kind)
  return hit === undefined ? null : { dir: hit.dir, m: hit.manifest }
}

const structures = town.structures.map((s) => {
  const art = cellFor(s.kind, s.facing)
  const ground = tileToScreen(s.x + s.w / 2 - 0.5, s.y + s.h / 2 - 0.5)
  const target = (s.w + s.h) * BUILDING_PX_PER_TILE
  return {
    id: s.id, kind: s.kind, x: s.x, y: s.y, w: s.w, h: s.h, owner: s.owner, facing: s.facing,
    sx: ground.sx, sy: ground.sy,
    cell: art === null ? null : `art/buildings/${art.dir}/cell.png`,
    cellW: art?.m.cell.w ?? null, cellH: art?.m.cell.h ?? null,
    anchorX: art === null ? 0.5 : art.m.cell.feetX / art.m.cell.w,
    anchorY: art === null ? 1 : art.m.cell.feetY / art.m.cell.h,
    scale: art === null ? 1 : Math.min(target / art.m.cell.w, target / art.m.cell.h),
  }
})

// ── the decoration layer, as it actually samples ───────────────────────────────────────────
const decorations = sampleDecorations(terrain)

// ── the ground-bake budget, at the ring counts the brief asks for ──────────────────────────
const bakeAt = (rings: number): Record<string, number | boolean> => {
  const span = showcaseSpan(rings)
  // The town at this ring count, so the scatter's own numbers are measured and not extrapolated.
  const t = devTown(SHOWCASE_ANCHOR, rings).terrain
  let grass = 0, road = 0
  for (const row of t) for (const v of row) { if (v === 0) grass++; else if (v === 7) road++ }
  const fieldW = (span + span) * (TILE_W / 2), fieldH = (span + span) * (TILE_H / 2)
  const grid = groundGrid(fieldW, fieldH, span * (TILE_W / 2))
  const chunks = allChunks(grid)
  const largest = Math.max(...chunks.map((c) => Math.max(c.texW, c.texH)))
  return {
    rings,
    townSpanTiles: townSpan(rings),
    showcaseSpanTiles: span,
    tiles: span * span,
    fieldW, fieldH,
    wholeMapMB: wholeMapTextureBytes(fieldW, fieldH) / 1024 / 1024,
    wholeMapFitsGpuFloor: Math.max(fieldW, fieldH) <= GPU_MIN_MAX_TEXTURE_PX,
    chunks: chunks.length,
    chunkLargestDimPx: largest,
    chunkMB: CHUNK_PX_W * CHUNK_PX_H * CHUNK_BYTES_PER_PX / 1024 / 1024,
    chunkTexMB: (CHUNK_PX_W + 1) * (CHUNK_PX_H + 1) * CHUNK_BYTES_PER_PX / 1024 / 1024,
    groundShapes: span * span,
    grass, road,
  }
}

const scene = {
  generatedFrom: 'devTown() at SHOWCASE_ANCHOR, one ring — the town the product wakes into',
  anchor: SHOWCASE_ANCHOR,
  w: W, h: H,
  tileW: TILE_W, tileH: TILE_H,
  offsetX: field.offsetX,
  fieldW: field.widthPx, fieldH: field.heightPx,
  terrain: terrain.map((row) => row.map((t) => t.toString(36)).join('')),
  layers,
  roadKeys: ROAD_AUTOTILE_KEYS,
  roadGeom,
  roadShoulderDark: ROAD_SHOULDER_DARK,
  roadShoulderLight: ROAD_SHOULDER_LIGHT,
  octaveAlpha: OCTAVE_ALPHA,
  octaveScale: OCTAVE_SCALE,
  materialRepeatPx: MATERIAL_REPEAT_PX,
  materialRotationsDeg: MATERIAL_ROTATIONS_DEG,
  structures,
  decorations,
  canopy: { px: CANOPY_PX, blocks: canopyBlocks(), treesMax: TREES_MAX, shimmerMax: SHIMMER_MAX,
    shimmerPx: SHIMMER_PX },
  palette: MASTER_PALETTE,
  bake: [1, 2, 3].map(bakeAt),
}

mkdirSync(HERE, { recursive: true })
writeFileSync(join(HERE, 'scene.json'), JSON.stringify(scene))

const counts = new Map<string, number>()
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const k = String(terrain[y]![x])
  counts.set(k, (counts.get(k) ?? 0) + 1)
}
console.log(`terrain ${W}×${H} = ${W * H} tiles`)
console.log('tile ids:', [...counts].sort().map(([k, v]) => `${k}:${v}`).join(' '))
console.log(`structures ${structures.length}, with committed art ${structures.filter(s => s.cell !== null).length}`)
console.log(`decorations ${decorations.length} (${decorations.filter(d => d.kind === 'tree').length} trees,`,
  `${decorations.filter(d => d.kind === 'shimmer').length} shimmers)`)
console.log('ground layers:', layers.map((l) => `${l.id}=${l.shapes.length}`).join(' '))
for (const b of scene.bake) console.log('bake', JSON.stringify(b))
