import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodePng } from './post/raw.js'
import { paletteGate } from './pixelGates.js'
import { MASTER_PALETTE } from './palette.js'
import { REFERENCE_CONTENT_DIR, listCommittedBuildings } from './buildingArt.js'
import { loadReferenceSheet, paletteSwatchPng, REF_SWATCH_COLS, REF_SWATCH_PX } from './referenceSheet.js'

// ★ A DEPENDENCY NOTHING ASSERTED THE EXISTENCE OF.
//
// This loader demanded `ref-1.png`, `ref-2.png` and `ref-3.png`, and those three files have
// never existed in this repository. Every caller therefore threw on its first line, and the
// discovery lane's `discoveryArt` shipped as a tested no-op because of it — a feature silently
// degraded by a file nobody ever checked was there. The old tests could not catch that: all
// three wrote their fixtures into a temp dir first, so they proved the loader could read files
// that exist somewhere, never that the reference this repo actually ships resolves.
//
// It resolves now, and it resolves to a colour chart. See the module header for the two
// separate rounds of measurement that say a picture of a different object must never be
// attached to a generation.

describe('loadReferenceSheet', () => {
  it('resolves against the repository as shipped — no curation step, no missing file', async () => {
    const refs = await loadReferenceSheet()
    expect(refs).toHaveLength(1)
    expect(refs[0]!.length).toBeGreaterThan(0)
  })

  it('carries the palette and NOTHING a generation could copy the shape of', async () => {
    const swatch = await decodePng(await paletteSwatchPng())
    expect(swatch.width).toBe(REF_SWATCH_COLS * REF_SWATCH_PX)
    expect(swatch.height).toBe(Math.ceil(MASTER_PALETTE.length / REF_SWATCH_COLS) * REF_SWATCH_PX)
    // Every pixel is a palette member: there is no subject, no outline and no background.
    expect(paletteGate(swatch).failures).toEqual([])
    // and every member is present, so the chart is the whole palette and not a sample of it
    const seen = new Set<number>()
    for (let i = 0; i < swatch.data.length; i += 4)
      seen.add((swatch.data[i]! << 16) | (swatch.data[i + 1]! << 8) | swatch.data[i + 2]!)
    expect(seen.size).toBe(MASTER_PALETTE.length)
  })

  it('is code-painted, so it cannot go missing the way the library did', async () => {
    expect((await paletteSwatchPng()).equals(await paletteSwatchPng())).toBe(true)
  })

  // The anchor is not deleted — it is the craft record and style-bible.md points at it. What
  // changed is that nothing attaches it to a generation any more.
  it('attaches no picture of an object: not the anchor, not a committed cell', async () => {
    const refs = await loadReferenceSheet()
    expect(refs[0]!.equals(await paletteSwatchPng()), 'the only reference is the swatch').toBe(true)
    const anchor = readFileSync(join(REFERENCE_CONTENT_DIR, 'style-anchor.png'))
    expect(refs.some((r) => r.equals(anchor)), 'the anchor is committed but never attached').toBe(false)
    // and nor is any of the art this project has since authored
    for (const b of listCommittedBuildings())
      expect(refs.some((r) => r.equals(b.png)), b.dir).toBe(false)
  })
})
