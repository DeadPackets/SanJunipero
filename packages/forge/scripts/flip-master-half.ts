// Zero-spend master repair: horizontally mirror ONE half of a cached two-figure
// master raw (legal for characters — v3 mirror standard; buildings never). Used when
// a generated master's front figure faces bottom-LEFT (SW) instead of bottom-right:
// flipping the left half in place fixes the facing without a paid regen.
// Env: FLIP_CHAR (production dir), FLIP_SRC key, FLIP_OUT key, FLIP_HALF left|right.
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import { decodePng, encodePng } from '../src/post/raw.js'

const CHAR = process.env.FLIP_CHAR
const SRC = process.env.FLIP_SRC
const OUT = process.env.FLIP_OUT
const HALF = process.env.FLIP_HALF ?? 'left'
if (!CHAR || !SRC || !OUT) throw new Error('FLIP_CHAR, FLIP_SRC, FLIP_OUT required')
if (HALF !== 'left' && HALF !== 'right') throw new Error('FLIP_HALF must be left or right')

const SCRATCH = '/private/tmp/claude-501/-Users-deadpackets-workspace-SanJunipero/461805e8-9eb9-4d32-b2ea-e2ef16ce8545/scratchpad/c5'
const RAWS = `${SCRATCH}/production/${CHAR}/raws`
const srcPath = `${RAWS}/${SRC}.png`
if (!existsSync(srcPath)) throw new Error(`source raw missing: ${srcPath}`)

const img = await decodePng(readFileSync(srcPath))
const mid = Math.floor(img.width / 2)
const [x0, x1] = HALF === 'left' ? [0, mid] : [mid, img.width]
for (let y = 0; y < img.height; y++) {
  for (let a = x0, b = x1 - 1; a < b; a++, b--) {
    const i = (y * img.width + a) * 4, j = (y * img.width + b) * 4
    for (let k = 0; k < 4; k++) {
      const t = img.data[i + k]!
      img.data[i + k] = img.data[j + k]!
      img.data[j + k] = t
    }
  }
}
writeFileSync(`${RAWS}/${OUT}.png`, await encodePng(img))
console.log(`${OUT}: written (${HALF} half of ${SRC} mirrored, ${img.width}x${img.height})`)
