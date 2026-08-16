// TEMP probe: re-runs the item post chain over already-paid raws. No key, no spend.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { decodePng, encodePng } from '../src/post/raw.js'
import { upscaleNearest } from '../src/sheet.js'
import { toSpriteCell, candidateRank } from '../src/library/postItem.js'

const dir = process.env.DIR!
const px = Number(process.env.PX ?? '16')
const out = process.env.OUT!
const raws = readdirSync(join(dir, 'candidates')).filter(f => f.endsWith('-raw.png')).sort()
const tiles: Buffer[] = []
for (const f of raws) {
  const r = await decodePng(readFileSync(join(dir, 'candidates', f)))
  const c = toSpriteCell(r, px)
  console.log(f, 'pitch', c.pitch.toFixed(2), 'islands', c.islands, 'fill', c.opaqueFrac.toFixed(2), 'rank', candidateRank(c).toFixed(3))
  tiles.push(await sharp(await encodePng(upscaleNearest(c.cell, Math.floor(192 / px)))).png().toBuffer())
}
const W = 192
await sharp({ create: { width: W * tiles.length, height: W, channels: 4, background: { r: 233, g: 226, b: 218, alpha: 1 } } })
  .composite(tiles.map((input, i) => ({ input, left: i * W, top: 0 }))).png().toBuffer()
  .then(b => writeFileSync(out, b))
console.log('wrote', out)
