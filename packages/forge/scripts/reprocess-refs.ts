// OFFLINE — zero API spend. Re-post-processes the approved reference raws through
// the v2 chain (chromaKey -> snapToGrid, native size: no forced 64px, no quantize,
// no outline pass) so they match the locked recipe.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { snapToGrid, detectArtScale, defringe, upscaleNearest } from '../src/sheet.js'
import { scratch } from './scratch.js'

const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
const SE_COTTAGE = scratch('c5', 'building-facing', 'candidates', '1.png')
const OUT = 'packages/forge/out/refs-v2'
const DURABLE = scratch('c5', 'refs-v2')
mkdirSync(OUT, { recursive: true })
mkdirSync(DURABLE, { recursive: true })


const inputs: [string, string][] = [
  ['building-1', `${REF_CANDIDATES}/building-1.png`],
  ['item-1', `${REF_CANDIDATES}/item-1.png`],
  ['se-cottage', SE_COTTAGE],
]
for (const [name, path] of inputs) {
  const keyed = chromaKey(await decodePng(readFileSync(path)))
  const snapped = defringe(snapToGrid(keyed))
  console.log(`${name}: art scale ${detectArtScale(keyed)}, native ${snapped.width}x${snapped.height}`)
  const png = await encodePng(snapped)
  writeFileSync(`${OUT}/${name}.png`, png)
  writeFileSync(`${DURABLE}/${name}.png`, png)
  writeFileSync(`${DURABLE}/${name}-4x.png`, await encodePng(upscaleNearest(snapped, 4)))
}
