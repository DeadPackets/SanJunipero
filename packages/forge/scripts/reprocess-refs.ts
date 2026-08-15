// OFFLINE — zero API spend. Re-post-processes the approved reference raws through
// the v2 chain (chromaKey -> snapToGrid, native size: no forced 64px, no quantize,
// no outline pass) so they match the locked recipe.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { decodePng, encodePng, type RawImage } from '../src/post/raw.js'
import { chromaKey } from '../src/post/chromaKey.js'
import { snapToGrid, detectArtScale } from '../src/sheet.js'

const REF_CANDIDATES = '/Users/deadpackets/workspace/SanJunipero/.claude/scratch/c5/reference-candidates'
const SE_COTTAGE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/building-facing/candidates/1.png'
const OUT = 'packages/forge/out/refs-v2'
const DURABLE = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5/refs-v2'
mkdirSync(OUT, { recursive: true })
mkdirSync(DURABLE, { recursive: true })

function upscaleNearest(img: RawImage, k: number): RawImage {
  const out = new Uint8ClampedArray(img.width * k * img.height * k * 4)
  for (let y = 0; y < img.height * k; y++) for (let x = 0; x < img.width * k; x++) {
    const s = ((y / k | 0) * img.width + (x / k | 0)) * 4
    out.set(img.data.subarray(s, s + 4), (y * img.width * k + x) * 4)
  }
  return { width: img.width * k, height: img.height * k, data: out }
}

const inputs: [string, string][] = [
  ['building-1', `${REF_CANDIDATES}/building-1.png`],
  ['item-1', `${REF_CANDIDATES}/item-1.png`],
  ['se-cottage', SE_COTTAGE],
]
for (const [name, path] of inputs) {
  const keyed = chromaKey(await decodePng(readFileSync(path)))
  const snapped = snapToGrid(keyed)
  console.log(`${name}: art scale ${detectArtScale(keyed)}, native ${snapped.width}x${snapped.height}`)
  const png = await encodePng(snapped)
  writeFileSync(`${OUT}/${name}.png`, png)
  writeFileSync(`${DURABLE}/${name}.png`, png)
  writeFileSync(`${DURABLE}/${name}-4x.png`, await encodePng(upscaleNearest(snapped, 4)))
}
