// OFFLINE, $0.00 — rebuild the farmland material the user rejected.
// The soil is `terrain_earth_0` graded and the furrow is arithmetic; every generated attempt
// self-tiled into a lattice, because the style anchor attached to a terrain call IS a cottage.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng, encodeWebp } from '../src/post/raw.js'
import {
  gradeMaterial,
  seamReport,
  borderReport,
  materialVeto,
  selfTile3x3,
} from '../src/terrainGen.js'
import { FURROW_DEPTH, FURROW_LIP, FURROW_PITCH_PX, ploughFurrows } from '../src/plough.js'
import { PALETTE_DISTANCE_MAX, paletteDistance } from '../src/pixelGates.js'
import { scratch } from './scratch.js'

const S = scratch()

const MATERIALS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'content',
  'tilesets',
  'materials',
)

// Measured off the v1 farmland tone in terrainTiles.ts (base #A66E38): the same soil family,
// a touch darker and damper than bare turned earth.
export const FARMLAND_GRADE = { targetMean: [150, 104, 62] as const, contrast: 1.1 }

const earth = await decodePng(readFileSync(join(MATERIALS, 'terrain_earth_0.webp')))
const soil = gradeMaterial(earth, {
  targetMean: FARMLAND_GRADE.targetMean,
  contrast: FARMLAND_GRADE.contrast,
})
const farmland = ploughFurrows(soil)

const s = seamReport(farmland),
  b = borderReport(farmland)
const veto = materialVeto(farmland)
// The grade keeps the soil's own colours, so what is measured is DISTANCE, not membership.
const dist = paletteDistance(farmland)
const bar =
  dist <= PALETTE_DISTANCE_MAX
    ? []
    : [`palette distance ${dist.toFixed(1)} over ${PALETTE_DISTANCE_MAX}`]
console.log(`furrow pitch ${FURROW_PITCH_PX}, depth ${FURROW_DEPTH}, lip ${FURROW_LIP}`)
console.log(
  `seam h=${s.horizontalDelta.toFixed(1)} v=${s.verticalDelta.toFixed(1)} ring=${b.ringDelta.toFixed(1)}`,
)
console.log(`veto: ${veto ?? 'none'}`)
console.log(`palette distance ${dist.toFixed(1)}: ${bar.join('; ') || 'clean'}`)

// `materialVeto` and the palette distance are binding here because this writes COMMITTED content;
// the seam gate is instead consumed by `terrainIngest.test.ts` over every shipped material.
if (veto !== null || bar.length > 0)
  throw new Error(
    `the farmland material FAILS its own gates and was not written.\n    ` +
      `${[...(veto === null ? [] : [`veto: ${veto}`]), ...bar].join('\n    ')}\n` +
      `  The shipped material on disk is untouched.`,
  )

writeFileSync(join(MATERIALS, 'terrain_farmland_0.webp'), await encodeWebp(farmland))
mkdirSync(`${S}/fqc2/plough`, { recursive: true })
writeFileSync(`${S}/fqc2/plough/shipped-3x3.png`, await encodePng(selfTile3x3(farmland)))
console.log('wrote content/tilesets/materials/terrain_farmland_0.webp')
