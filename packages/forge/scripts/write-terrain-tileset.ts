// OFFLINE, $0. Paints the four seasonal 4×4 ground sheets and the scaffolding sprite, then
// merges the tileW/seasons/scaffolding blocks into the tileset manifest. Read-merge-write:
// C13's `autotile` block is never clobbered.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEASONS } from '@sj/shared'
import { encodeWebp } from '../src/post/raw.js'
import {
  SHEET_COLS,
  SHEET_ROWS,
  TERRAIN_TILE_H,
  TERRAIN_TILE_W,
  paintTilesetSheets,
  seasonTileNames,
} from '../src/terrainTiles.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets')
const SCAFFOLDING_FILE = 'scaffolding.webp'

mkdirSync(DIR, { recursive: true })

const sheets = paintTilesetSheets()
for (const season of SEASONS) {
  const img = sheets.seasons[season]
  writeFileSync(join(DIR, `${season}.webp`), await encodeWebp(img))
  console.log(`wrote ${season}.webp — ${img.width}x${img.height}`)
}
writeFileSync(join(DIR, SCAFFOLDING_FILE), await encodeWebp(sheets.scaffolding))
console.log(`wrote ${SCAFFOLDING_FILE} — ${sheets.scaffolding.width}x${sheets.scaffolding.height}`)

const tiles = seasonTileNames()
const path = join(DIR, 'manifest.json')
const existing = (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) as Record<
  string,
  unknown
>
const REGENERATED = ['tileW', 'tileH', 'cols', 'rows', 'seasons', 'scaffolding']
const rest = Object.fromEntries(Object.entries(existing).filter(([k]) => !REGENERATED.includes(k)))
const merged = {
  tileW: TERRAIN_TILE_W,
  tileH: TERRAIN_TILE_H,
  cols: SHEET_COLS,
  rows: SHEET_ROWS,
  seasons: Object.fromEntries(SEASONS.map((s) => [s, { file: `${s}.webp`, tiles }])),
  scaffolding: { file: SCAFFOLDING_FILE },
  ...rest,
}
writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`)
console.log(
  `merged seasons + scaffolding into ${path}; kept ${Object.keys(rest).join(', ') || 'nothing else'}`,
)
