// OFFLINE, $0. Lands the generated materials in the SHIPPED content directory. Read-merge-write,
// so neither the seasons half nor the autotile half of the manifest is ever clobbered.
// A material that was never generated falls back to its code-painted tile.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROAD_AUTOTILE_KEYS, SEASONS } from '@sj/shared'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import {
  SHEET_COLS, SHEET_ROWS, TERRAIN_TILE_H, TERRAIN_TILE_W, paintScaffolding, seasonTileNames,
} from '../src/terrainTiles.js'
import {
  MATERIAL_GRADES, ROAD_MATERIAL_ID, borderReport, deframe, gradeMaterial, materialContrast,
  materialMean, seamReport, seamlessMaterial, stencilRoadTile,
} from '../src/terrainGen.js'
import { tileSeamGate } from '../src/pixelGates.js'
import { MATERIALS_DIR, seasonSheets } from '../src/terrainIngest.js'
import { paintRoadAutotile } from '../src/roadTiles.js'

const C3 = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c3/materials'
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets')
const SCAFFOLDING_FILE = 'scaffolding.png', STRIP_FILE = 'road-autotile.png'

async function loadBook(): Promise<Map<string, RawImage>> {
  const book = new Map<string, RawImage>()
  if (!existsSync(C3)) return book
  for (const file of readdirSync(C3)) {
    if (!file.endsWith('.png')) continue
    book.set(file.replace(/\.png$/, '').replace(/_/g, ':'), await decodePng(readFileSync(join(C3, file))))
  }
  return book
}

const book = await loadBook()
console.log(`${book.size} generated materials in ${C3}`)
mkdirSync(DIR, { recursive: true })

// The materials ship WITH the repo: the gateway registers them into the codex at boot, and
// the renderer reads the codex. Without this the generated art never reaches a viewer.
mkdirSync(MATERIALS_DIR, { recursive: true })
// Prune first: the shipped directory is exactly what this run produces, never a pile of
// whatever any earlier run left. A stale v1 tile-sized material would otherwise keep being
// loaded by the gateway and keep failing the shipped-materials check.
for (const stale of readdirSync(MATERIALS_DIR)) {
  if (stale.endsWith('.png') && !book.has(stale.replace(/\.png$/, '').replace(/_/g, ':'))) {
    rmSync(join(MATERIALS_DIR, stale))
    console.log(`  pruned stale ${stale}`)
  }
}
const provenance: Record<string,
  { h: number; v: number; ring: number; deframed: number; wrapH: number; wrapV: number }> = {}
for (const [assetId, raw] of [...book]) {
  const { material: deframed, passes } = deframe(raw)
  // tone grading, measured against the v1 materials the user accepted structurally
  const kindOf = /^terrain:([a-z-]+):0$/.exec(assetId)?.[1] ?? ''
  const grade = MATERIAL_GRADES[kindOf]
  const graded = grade === undefined ? deframed : gradeMaterial(deframed, grade)
  // Last, because the crop and the grade both move the edges: close the wrap by
  // construction. Three live rounds proved the model will not draw one that closes itself.
  const material = seamlessMaterial(graded)
  if (grade !== undefined) {
    console.log(`  ${assetId.padEnd(24)} graded  mean ${materialMean(deframed).map((v) => Math.round(v)).join(',')}` +
      ` -> ${materialMean(material).map((v) => Math.round(v)).join(',')}` +
      `  contrast ${materialContrast(deframed).toFixed(0)} -> ${materialContrast(material).toFixed(0)}`)
  }
  book.set(assetId, material)
  const seam = seamReport(material), border = borderReport(material), bar = tileSeamGate(material)
  provenance[assetId] = {
    h: Number(seam.horizontalDelta.toFixed(2)), v: Number(seam.verticalDelta.toFixed(2)),
    ring: Number(border.ringDelta.toFixed(2)), deframed: passes,
    wrapH: Number(bar.wrapH.toFixed(2)), wrapV: Number(bar.wrapV.toFixed(2)),
  }
  writeFileSync(join(MATERIALS_DIR, `${assetId.replace(/:/g, '_')}.png`), await encodePng(material))
  console.log(`  ${assetId.padEnd(24)} h=${seam.horizontalDelta.toFixed(1)} v=${seam.verticalDelta.toFixed(1)} ` +
    `ring=${border.ringDelta.toFixed(1)} wrap=${bar.wrapH.toFixed(1)}/${bar.wrapV.toFixed(1)}` +
    `${passes > 0 ? ` (deframed x${passes})` : ''}${bar.ok ? '' : '  SEAM'}${border.framed ? '  STILL FRAMED' : ''}`)
}
// A deframed material is ALLOWED a looser wrap: the crop that removed the frame is what damaged
// the wrap, and a frame is the worse artifact. The test reads this instead of a list of exceptions.
writeFileSync(join(MATERIALS_DIR, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`)
console.log(`shipped ${book.size} materials into ${MATERIALS_DIR}`)

// four seasonal sheets, graded off the generated seasonal materials (replaces D-3's guesses)
const sheets = seasonSheets(book)
for (const season of SEASONS) {
  const img = sheets[season]
  writeFileSync(join(DIR, `${season}.png`), await encodePng(img))
  console.log(`wrote ${season}.png — ${img.width}x${img.height}`)
}
if (!existsSync(join(DIR, SCAFFOLDING_FILE))) {
  writeFileSync(join(DIR, SCAFFOLDING_FILE), await encodePng(paintScaffolding()))
}

// the 15-cell road strip, every shape cut from ONE generated road surface
const road = book.get(ROAD_MATERIAL_ID) ?? null
const width = ROAD_AUTOTILE_KEYS.length * TERRAIN_TILE_W
const strip: RawImage = { width, height: TERRAIN_TILE_H, data: new Uint8ClampedArray(width * TERRAIN_TILE_H * 4) }
ROAD_AUTOTILE_KEYS.forEach((key, k) => {
  const tile = road === null ? paintRoadAutotile(key) : stencilRoadTile(road, key)
  for (let y = 0; y < TERRAIN_TILE_H; y++) {
    strip.data.set(
      tile.data.subarray(y * TERRAIN_TILE_W * 4, (y + 1) * TERRAIN_TILE_W * 4),
      (y * width + k * TERRAIN_TILE_W) * 4,
    )
  }
})
writeFileSync(join(DIR, STRIP_FILE), await encodePng(strip))
console.log(`wrote ${STRIP_FILE} — ${width}x${TERRAIN_TILE_H}, ${road === null ? 'CODE-PAINTED (no generated road)' : 'generated surface'}`)

// read-merge-write: every key the renderer consumes, both halves preserved
const path = join(DIR, 'manifest.json')
const existing = (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) as Record<string, unknown>
const { tileW: _w, tileH: _h, cols: _c, rows: _r, seasons: _s, scaffolding: _sc, autotile: _a, ...rest } = existing
const merged = {
  tileW: TERRAIN_TILE_W, tileH: TERRAIN_TILE_H, cols: SHEET_COLS, rows: SHEET_ROWS,
  seasons: Object.fromEntries(SEASONS.map((s) => [s, { file: `${s}.png`, tiles: seasonTileNames() }])),
  scaffolding: { file: SCAFFOLDING_FILE },
  autotile: { road: { file: STRIP_FILE, tiles: Object.fromEntries(ROAD_AUTOTILE_KEYS.map((k, i) => [k, i])) } },
  ...rest,
}
writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`)
console.log(`merged manifest — both halves present, kept ${Object.keys(rest).join(', ') || 'nothing else'}`)
