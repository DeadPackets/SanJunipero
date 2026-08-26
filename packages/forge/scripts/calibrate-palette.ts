// Renders the 40-swatch palette under all 5 atmosphere tints into one sheet.
// Output: packages/forge/out/calibration/palette-tints.png — HUMAN SIGN-OFF GATE
// for locking the palette (record approval in content/style-bible.md).
import { mkdirSync, writeFileSync } from 'node:fs'
import { MASTER_PALETTE, paletteRgb } from '../src/palette.js'
import { TINTS, applyTint } from '../src/tints.js'
import { encodePng, type RawImage } from '../src/post/raw.js'

const SW = 24,
  COLS = 8,
  ROWS = 5,
  GAP = 4 // 24px swatches, 8×5 grid per tint block
const blockW = COLS * (SW + GAP) + GAP,
  blockH = ROWS * (SW + GAP) + GAP

function paletteBlock(): RawImage {
  const data = new Uint8ClampedArray(blockW * blockH * 4)
  // dark ground behind swatches so pastels read against something
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 0x24
    data[i + 1] = 0x1f
    data[i + 2] = 0x2b
    data[i + 3] = 255
  }
  paletteRgb().forEach(([r, g, b], idx) => {
    const cx = GAP + (idx % COLS) * (SW + GAP),
      cy = GAP + Math.floor(idx / COLS) * (SW + GAP)
    for (let y = cy; y < cy + SW; y++)
      for (let x = cx; x < cx + SW; x++) {
        const p = (y * blockW + x) * 4
        data[p] = r
        data[p + 1] = g
        data[p + 2] = b
        data[p + 3] = 255
      }
  })
  return { width: blockW, height: blockH, data }
}

const base = paletteBlock()
const moods = ['day', 'night', 'dawn', 'storm', 'winter'] as const
const sheet: RawImage = {
  width: blockW,
  height: blockH * moods.length,
  data: new Uint8ClampedArray(blockW * blockH * moods.length * 4),
}
moods.forEach((m, i) => {
  sheet.data.set(applyTint(base, TINTS[m]).data, i * blockW * blockH * 4)
})

mkdirSync('packages/forge/out/calibration', { recursive: true })
writeFileSync('packages/forge/out/calibration/palette-tints.png', await encodePng(sheet))
console.log(
  `wrote palette-tints.png — tint order top→bottom: ${moods.join(', ')} (${MASTER_PALETTE.length} colors)`,
)
