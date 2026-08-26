// Packs the 24 v4 cells into ONE atlas + manifest so a character is a single codex record.
// The renderer trusts only the manifest rects, so the layout here is free to change.
import type { CharacterAtlasManifest, AtlasCell } from '@sj/shared'
import type { RawImage } from './post/raw.js'
import { FACINGS, POSES_V2 } from './sheet.js'
import { cellAnchor } from './hires.js'
import { CELL_NAMES_V4 } from './mirror.js'

export function packCharacterAtlas(
  cells: Map<string, RawImage>,
  figureH: number,
): { image: RawImage; manifest: CharacterAtlasManifest } {
  const missing = CELL_NAMES_V4.filter((n) => !cells.has(n))
  if (missing.length) throw new Error(`packCharacterAtlas: missing cells ${missing.join(', ')}`)

  const rows = FACINGS.map((f) => POSES_V2.map((p) => `${p}-${f}`))
  const rowH = rows.map((names) => Math.max(...names.map((n) => cells.get(n)!.height)))
  const width = Math.max(...rows.map((names) => names.reduce((s, n) => s + cells.get(n)!.width, 0)))
  const height = rowH.reduce((s, h) => s + h, 0)

  const image: RawImage = { width, height, data: new Uint8ClampedArray(width * height * 4) }
  const anchors: Record<string, AtlasCell> = {}
  let y = 0
  rows.forEach((names, ri) => {
    let x = 0
    for (const name of names) {
      const img = cells.get(name)!
      for (let sy = 0; sy < img.height; sy++) {
        image.data.set(
          img.data.subarray(sy * img.width * 4, (sy + 1) * img.width * 4),
          ((y + sy) * width + x) * 4,
        )
      }
      const a = cellAnchor(img)
      anchors[name] = { x, y, w: img.width, h: img.height, feetX: a.feetX, feetY: a.feetY }
      x += img.width
    }
    y += rowH[ri]!
  })
  return { image, manifest: { version: 'v4-hires-atlas', figureH, cells: anchors } }
}
