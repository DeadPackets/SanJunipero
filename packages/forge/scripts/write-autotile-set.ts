// OFFLINE, $0. Paints the 15-tile road strip and merges the `autotile` block into the
// tileset manifest. Read-merge-write: C10's seasons/scaffolding blocks are never clobbered.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROAD_AUTOTILE_KEYS } from '@sj/shared'
import { encodeWebp } from '../src/post/raw.js'
import { paintRoadStrip } from '../src/roadTiles.js'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets')
const FILE = 'road-autotile.webp'

mkdirSync(DIR, { recursive: true })

const strip = paintRoadStrip()
writeFileSync(join(DIR, FILE), await encodeWebp(strip))
console.log(
  `wrote ${join(DIR, FILE)} — ${strip.width}x${strip.height}, ${ROAD_AUTOTILE_KEYS.length} tiles`,
)

const path = join(DIR, 'manifest.json')
const existing: Record<string, unknown> = existsSync(path)
  ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)
  : {}
const merged = {
  ...existing,
  autotile: {
    road: { file: FILE, tiles: Object.fromEntries(ROAD_AUTOTILE_KEYS.map((k, i) => [k, i])) },
  },
}
writeFileSync(path, `${JSON.stringify(merged, null, 2)}\n`)
console.log(
  `merged autotile block into ${path}${Object.keys(existing).length ? '' : ' (new file — C10 T1 will merge its seasons in)'}`,
)
