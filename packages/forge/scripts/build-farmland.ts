// OFFLINE, $0.00 — rebuild the farmland material the user rejected.
//
// `terrain_farmland_0` self-tiled into rows of isometric cottages because the style anchor
// attached to every terrain call IS a cottage and the model copied it whole. Regenerating
// with a GROUND material as the reference fixed the subject and then hit the wall the terrain
// round documented: three attempts, blocked on the wrap, the eye scoring tiling 1.67/10, a
// drawn field boundary every time. Its own output self-tiles into a lattice of dark bands —
// the same failure in a second costume.
//
// So the soil is a material the model DID draw and the user already has in the game
// (`terrain_earth_0`), graded to damp ploughed brown, and the furrow is arithmetic.
//
//   node node_modules/.pnpm/tsx@4.23.12/node_modules/tsx/dist/cli.mjs \
//     packages/forge/scripts/build-farmland.ts
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, encodePng } from '../src/post/raw.js'
import { gradeMaterial, seamReport, borderReport, materialVeto, selfTile3x3 } from '../src/terrainGen.js'
import { FURROW_DEPTH, FURROW_LIP, FURROW_PITCH_PX, ploughFurrows } from '../src/plough.js'
import { paletteGate } from '../src/pixelGates.js'

const MATERIALS = join(dirname(fileURLToPath(import.meta.url)), '..', 'content', 'tilesets', 'materials')

// Measured off the v1 farmland tone in terrainTiles.ts (base #A66E38): the same soil family,
// a touch darker and damper than bare turned earth.
export const FARMLAND_GRADE = { targetMean: [150, 104, 62] as const, contrast: 1.1 }

const earth = await decodePng(readFileSync(join(MATERIALS, 'terrain_earth_0.png')))
const soil = gradeMaterial(earth, { targetMean: FARMLAND_GRADE.targetMean, contrast: FARMLAND_GRADE.contrast })
const farmland = ploughFurrows(soil)

const s = seamReport(farmland), b = borderReport(farmland)
const veto = materialVeto(farmland)
const bar = paletteGate(farmland).failures
console.log(`furrow pitch ${FURROW_PITCH_PX}, depth ${FURROW_DEPTH}, lip ${FURROW_LIP}`)
console.log(`seam h=${s.horizontalDelta.toFixed(1)} v=${s.verticalDelta.toFixed(1)} ring=${b.ringDelta.toFixed(1)}`)
console.log(`veto: ${veto ?? 'none'}`)
console.log(`palette: ${bar.join('; ') || 'clean'}`)

// ★ THIS FILE HAD NO CONTROL FLOW IN IT AT ALL. `materialVeto` and `paletteGate` were printed
// and the material written whatever they said — and unlike the other probes in this sweep it
// writes COMMITTED content, `content/tilesets/materials/terrain_farmland_0.png`. The seam is
// already consumed, by `terrainIngest.test.ts` over every shipped material; these two were not
// consumed anywhere.
if (veto !== null || bar.length > 0) throw new Error(
  `the farmland material FAILS its own gates and was not written.\n    `
  + `${[...(veto === null ? [] : [`veto: ${veto}`]), ...bar].join('\n    ')}\n`
  + `  The shipped material on disk is untouched.`)

writeFileSync(join(MATERIALS, 'terrain_farmland_0.png'), await encodePng(farmland))
const S = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad'
writeFileSync(`${S}/fqc2/plough/shipped-3x3.png`, await encodePng(selfTile3x3(farmland)))
console.log('wrote content/tilesets/materials/terrain_farmland_0.png')
