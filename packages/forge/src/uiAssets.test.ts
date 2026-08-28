import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodePng, type RawImage } from './post/raw.js'
import { alphaBinaryGate, magentaPixels } from './pixelGates.js'
import { UI_CONTENT_DIR, UI_PIECE_IDS, UI_PX_DIR, loadUiManifest } from './uiAssets.js'

const manifest = loadUiManifest()

/** Every column of a horizontal strip, or every row of a vertical one, drawn the same — which is
 *  what lets a nine-slice edge repeat or stretch without a seam appearing in it. */
function seam(
  img: RawImage,
  o: { x0: number; x1: number; y0: number; y1: number },
  along: 'columns' | 'rows',
): string | null {
  const at = (x: number, y: number): string =>
    [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)].join(',')
  for (let y = o.y0; y < o.y1; y++)
    for (let x = o.x0; x < o.x1; x++) {
      const [rx, ry] = along === 'columns' ? [o.x0, y] : [x, o.y0]
      if (at(x, y) !== at(rx, ry)) return `${x},${y} differs from ${rx},${ry}`
    }
  return null
}

describe('the Signpost UI rasters', () => {
  it('names every piece W1 and W2 were promised, and nothing else', () => {
    expect(Object.keys(manifest.pieces).sort()).toEqual([...UI_PIECE_IDS].sort())
  })

  for (const [id, e] of Object.entries(manifest.pieces)) {
    describe(id, () => {
      const png = readFileSync(join(UI_CONTENT_DIR, e.file))
      const img = decodePng(png) // one decode, shared by every case below

      it('is the same bytes in content/ui and in the web px directory', () => {
        expect(readFileSync(join(UI_PX_DIR, e.file)).equals(png)).toBe(true)
      })

      it(`is ${e.w}x${e.h} with binary alpha and no surviving background`, async () => {
        const raw = await img
        expect([raw.width, raw.height]).toEqual([e.w, e.h])
        expect(alphaBinaryGate(raw).failures).toEqual([])
        expect(magentaPixels(raw)).toBe(0)
      })

      if (e.slice !== null) {
        const s = e.slice
        it(`tiles cleanly on a ${s} px slice`, async () => {
          const raw = await img
          expect(2 * s).toBeLessThan(Math.min(e.w, e.h))
          const mid = { x0: s, x1: e.w - s, y0: s, y1: e.h - s }
          expect(seam(raw, { ...mid, y0: 0, y1: s }, 'columns')).toBeNull() // top edge
          expect(seam(raw, { ...mid, y0: e.h - s, y1: e.h }, 'columns')).toBeNull() // bottom
          expect(seam(raw, { ...mid, x0: 0, x1: s }, 'rows')).toBeNull() // left edge
          expect(seam(raw, { ...mid, x0: e.w - s, x1: e.w }, 'rows')).toBeNull() // right
          expect(seam(raw, mid, 'columns')).toBeNull() // the middle, both ways
          expect(seam(raw, mid, 'rows')).toBeNull()
        })
      }
    })
  }
})
