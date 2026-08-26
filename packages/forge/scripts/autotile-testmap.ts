// OFFLINE, no spend. The ring + cross + stubs map exercising all 15 road autotile keys. Emits
// the tile grid JSON and a self-contained 4x dimetric composite from `paintRoadAutotile`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROAD_AUTOTILE_KEYS, roadAutotile, type RoadAutotileKey } from '@sj/shared'
import { encodePng, type RawImage } from '../src/post/raw.js'
import { upscaleNearest } from '../src/sheet.js'
import { checkerBackground, compositeOver } from '../src/visionQa/rubric.js'
import { paintRoadAutotile, TILE_W, TILE_H } from '../src/roadTiles.js'
import { scratch } from './scratch.js'

const C13 = scratch('c13')
const OUT = process.env.OUT ?? join(C13, 'reports')
const SCALE = Number(process.env.SCALE ?? '4')

const MAP_W = 15,
  MAP_H = 9

// A hollow ring (four corners, both straights), a two-tile branch off each ring edge (the four
// T junctions and four caps), and a detached plus (the cross). Branches are two tiles long so
// a branch reads as a branch and not as a flare on the ring.
// biome-ignore format: pixel grid
const RING = [
  ...Array.from({ length: 5 }, (_, i) => [2 + i, 2] as const),
  ...Array.from({ length: 5 }, (_, i) => [2 + i, 6] as const),
  [2, 3], [2, 4], [2, 5], [6, 3], [6, 4], [6, 5],
] as const
// biome-ignore format: pixel grid
const BRANCHES = [[4, 1], [4, 0], [4, 7], [4, 8], [1, 4], [0, 4], [7, 4], [8, 4]] as const
// biome-ignore format: pixel grid
const PLUS = [[12, 2], [12, 3], [12, 4], [12, 5], [12, 6], [10, 4], [11, 4], [13, 4], [14, 4]] as const

const cells = new Set([...RING, ...BRANCHES, ...PLUS].map(([x, y]) => `${x},${y}`))
const on = (x: number, y: number): boolean => cells.has(`${x},${y}`)

type Cell = { x: number; y: number; key: RoadAutotileKey }
const grid: Cell[] = [...cells]
  .map((k) => k.split(',').map(Number) as [number, number])
  .sort((a, b) => a[1] - b[1] || a[0] - b[0])
  .map(([x, y]) => ({
    x,
    y,
    key: roadAutotile({ n: on(x, y - 1), e: on(x + 1, y), s: on(x, y + 1), w: on(x - 1, y) }),
  }))

const used = new Set(grid.map((c) => c.key))
const missing = ROAD_AUTOTILE_KEYS.filter((k) => !used.has(k))
if (missing.length) {
  console.error(`test map does not exercise ${missing.length} key(s): ${missing.join(', ')}`)
  process.exit(1)
}

// Dimetric placement: tile (x,y) lands at ((x-y)*TILE_W/2, (x+y)*TILE_H/2).
const sx = (c: { x: number; y: number }) => ((c.x - c.y) * TILE_W) / 2
const sy = (c: { x: number; y: number }) => ((c.x + c.y) * TILE_H) / 2
const minX = Math.min(...grid.map(sx)),
  maxX = Math.max(...grid.map(sx))
const minY = Math.min(...grid.map(sy)),
  maxY = Math.max(...grid.map(sy))

const map: RawImage = checkerBackground(maxX - minX + TILE_W, maxY - minY + TILE_H)
// Painter's order: back to front, so a nearer tile overlaps the one behind it.
for (const c of [...grid].sort((a, b) => a.x + a.y - (b.x + b.y)))
  compositeOver(map, paintRoadAutotile(c.key), sx(c) - minX, sy(c) - minY)

mkdirSync(OUT, { recursive: true })
const png = join(OUT, 'autotile-testmap.png')
const json = join(OUT, 'autotile-testmap.json')
writeFileSync(png, await encodePng(upscaleNearest(map, SCALE)))
writeFileSync(
  json,
  JSON.stringify(
    {
      version: 'v1-autotile-testmap',
      mapW: MAP_W,
      mapH: MAP_H,
      tileW: TILE_W,
      tileH: TILE_H,
      keysExercised: [...used].sort(),
      cells: grid,
    },
    null,
    2,
  ),
)
console.log(
  `wrote ${png} (${map.width * SCALE}x${map.height * SCALE}) and ${json} — ` +
    `${grid.length} tiles, all ${used.size}/15 keys exercised`,
)
