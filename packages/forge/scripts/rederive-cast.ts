// OFFLINE, $0.00 — re-derives every committed atlas from its own authored cells, so a change to
// `deriveSheet` reaches the shipped art. The authored cells are the `se` and `ne` strips plus the
// `se` sleeper; everything else in the atlas is a mirror the derivation makes again.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng, encodeWebp, visiblePixelDiffs, type RawImage } from '../src/post/raw.js'
import { CAST_CONTENT_DIR, listCommittedCast } from '../src/castArt.js'
import { deriveSheet, CELL_NAMES_V4 } from '../src/mirror.js'
import { packCharacterAtlas } from '../src/atlasV4.js'
import { alphaBinaryGate } from '../src/pixelGates.js'

const strip = (crop: (n: string) => RawImage, f: 'se' | 'ne') => ({
  idle: crop(`idle-${f}`),
  'contact-a': crop(`contact-a-${f}`),
  passing: crop(`passing-a-${f}`),
  'contact-b': crop(`contact-b-${f}`),
})

const refused: string[] = []

for (const c of listCommittedCast()) {
  const atlas = await decodePng(c.atlas)
  const crop = (name: string): RawImage => {
    const r = c.manifest.cells[name]!
    const out: RawImage = { width: r.w, height: r.h, data: new Uint8ClampedArray(r.w * r.h * 4) }
    for (let y = 0; y < r.h; y++) {
      const s = ((r.y + y) * atlas.width + r.x) * 4
      out.data.set(atlas.data.subarray(s, s + r.w * 4), y * r.w * 4)
    }
    return out
  }
  const cells = deriveSheet({
    strips: { se: strip(crop, 'se'), ne: strip(crop, 'ne') },
    sleep: crop('sleep-se'),
  })
  const { image, manifest } = packCharacterAtlas(cells, c.manifest.figureH)
  const bar = alphaBinaryGate(image).failures
  if (bar.length > 0) {
    refused.push(`${c.id}: ${bar.join('; ')}`)
    console.log(`${c.id}: REFUSED — ${bar.join('; ')}`)
    continue
  }
  const dir = join(CAST_CONTENT_DIR, c.id)
  writeFileSync(join(dir, 'atlas.webp'), await encodeWebp(image))
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const moved = CELL_NAMES_V4.filter((n) => visiblePixelDiffs(crop(n), cells.get(n)!) > 0)
  console.log(`${c.id}: ${moved.length === 0 ? 'unchanged' : `redrew ${moved.join(', ')}`}`)
}

if (refused.length > 0)
  throw new Error(`${refused.length} atlas(es) FAIL the pixel bar and were not written:
    ${refused.join('\n    ')}`)
