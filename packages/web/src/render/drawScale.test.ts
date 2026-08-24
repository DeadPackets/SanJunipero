import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ITEM_PX } from './entities.js'
import { LIBRARY_TILE_PX, furnishingDivisor, furnishingScale } from './interiors.js'
import { CHAR_TARGET_PX } from './charAnim.js'
import { BUILDING_PX_PER_TILE } from './textures.js'
import { TILE_W } from './iso.js'

/**
 * ★ THE GATE THE CODEX CANNOT SEE.
 *
 * The art lane shipped 100 item records and 5 cast rigs and its coverage gate stayed green
 * through a defect that made every one of them draw wrong, because that gate reads the CODEX:
 * it asks whether a record exists, which it did. This one reads the RENDERER, and asks the only
 * question the codex cannot answer — **does the art reach the screen at a whole-number downscale
 * of the size it was authored at?**
 *
 * THE LAW, AT THE LEVEL IT ACTUALLY HOLDS. A sprite's WORLD size must be its authored size
 * divided by a whole number. The zoom is then an integer stop on top, which is the camera's own
 * law and not this one — `assetResolution.ts` is written to exactly this rule (`CHAR_FIGURE_PX =
 * 52 * 4` exists to make `CHAR_TARGET_PX / figureH` come out at 1/4, and `buildingCellPx` does
 * the same for a building), so this file holds the renderer to the authority the forge already
 * publishes rather than to a number invented here.
 *
 * WHY THE AUTHORED SIZES ARE READ OFF DISK. They live in `packages/forge/src/assetResolution.ts`
 * and `packages/forge/src/reCell.ts`, and `@sj/web` does not depend on `@sj/forge`. Restating
 * them here would be two constants free to drift apart in silence, which is the whole shape of
 * the defect this gate exists for. Every read asserts that it MATCHED, so a rename turns this
 * red instead of quietly measuring nothing.
 */

const FORGE = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../forge/src')

function forgeNumber(file: string, name: string): number {
  const src = readFileSync(resolve(FORGE, file), 'utf8')
  // `52 * BUILDING_ZOOM_STOP` is one of these, and the product is the point — a literal 156
  // would satisfy the arithmetic while losing the reason, so the reference is followed.
  const m = new RegExp(`export const ${name}\\s*=\\s*([0-9]+)(?:\\s*\\*\\s*([A-Z_][0-9A-Z_]*))?`).exec(src)
  expect(m, `${name} is no longer declared in forge/src/${file}`).not.toBeNull()
  const base = Number(m![1])
  if (m![2] === undefined) return base
  return base * forgeNumber(file, m![2])
}

function forgeTile(name: string): { w: number; h: number } {
  const src = readFileSync(resolve(FORGE, 'assetResolution.ts'), 'utf8')
  const m = new RegExp(`export const ${name} = \\{ w: ([0-9]+), h: ([0-9]+) \\}`).exec(src)
  expect(m, `${name} is no longer declared in forge/src/assetResolution.ts`).not.toBeNull()
  return { w: Number(m![1]), h: Number(m![2]) }
}

const WORLD_SPRITE_PX = forgeNumber('assetResolution.ts', 'WORLD_SPRITE_PX')
const ICON_PX = forgeNumber('assetResolution.ts', 'ICON_PX')
const CHAR_FIGURE_PX = forgeNumber('reCell.ts', 'CHAR_FIGURE_PX')
const BUILDING_ZOOM_STOP = forgeNumber('reCell.ts', 'BUILDING_ZOOM_STOP')
const TOWN_TILE = forgeTile('TOWN_TILE')
const INTERIOR_TILE = forgeTile('INTERIOR_TILE')

/** The one predicate. `authored / drawn` must be a whole number, and never below 1 — drawing a
 *  sprite BIGGER than it was authored is the other half of the same defect. */
const factorOf = (authoredPx: number, drawnPx: number): number => authoredPx / drawnPx
const isWholeDownscale = (authoredPx: number, drawnPx: number): boolean => {
  const f = factorOf(authoredPx, drawnPx)
  return Number.isInteger(f) && f >= 1
}

/** A footprint's span on a tile is `(w + h)` half-tiles — the same rule the forge sizes by. */
const spanOn = (w: number, h: number, tileW: number): number => (w + h) * (tileW / 2)

type Row = { klass: string; authoredPx: number; drawnPx: number; where: string }

/** Every class of art the renderer draws, with the size it is authored at and the size the
 *  renderer gives it in WORLD px. Read from the live constants, so a constant that moves moves
 *  this table with it. */
function drawTable(): Row[] {
  const rows: Row[] = [
    {
      klass: 'item, in the world', authoredPx: WORLD_SPRITE_PX, drawnPx: ITEM_PX,
      where: 'entities.ts ITEM_PX',
    },
    {
      klass: 'item, inventory icon', authoredPx: ICON_PX, drawnPx: HOLD_ICON_CSS_PX,
      where: 'chrome.css .hold-icon',
    },
    {
      klass: 'cast cell', authoredPx: CHAR_FIGURE_PX, drawnPx: CHAR_TARGET_PX,
      where: 'charAnim.ts CHAR_TARGET_PX',
    },
  ]
  for (const [w, h] of [[1, 1], [1, 2], [2, 2]] as const) {
    rows.push({
      klass: `furnishing ${w}x${h}, in a room`,
      authoredPx: spanOn(w, h, INTERIOR_TILE.w),
      // WHAT THE RENDERER ACTUALLY DOES, not what it ought to: the sprite is scaled by
      // `furnishingScale`, so this row goes red on the multiplier the tree carried.
      drawnPx: spanOn(w, h, INTERIOR_TILE.w) * furnishingScale(),
      where: 'interiors.ts furnishingScale',
    })
    rows.push({
      klass: `building ${w}x${h}`,
      authoredPx: spanOn(w, h, TOWN_TILE.w) * BUILDING_ZOOM_STOP,
      drawnPx: (w + h) * BUILDING_PX_PER_TILE,
      where: 'textures.ts buildingArt',
    })
  }
  return rows
}

/** `.hold-icon { width: 16px }` — read from the sheet rather than restated, for the same reason
 *  the forge's numbers are. */
const HOLD_ICON_CSS_PX = (() => {
  const css = readFileSync(
    resolve(fileURLToPath(new URL('.', import.meta.url)), '../ui/chrome.css'), 'utf8')
  const m = /\.hold-icon \{\s*flex: none; width: ([0-9]+)px; height: ([0-9]+)px;/.exec(css)
  if (m === null) throw new Error('.hold-icon no longer declares its own size in chrome.css')
  if (m[1] !== m[2]) throw new Error(`.hold-icon is not square: ${m[1]} x ${m[2]}`)
  return Number(m[1])
})()

describe('★ every item and every cast cell reaches the screen at a whole-number downscale', () => {
  it('publishes the table', () => {
    const rows = drawTable().map((r) => {
      const f = factorOf(r.authoredPx, r.drawnPx)
      const ok = isWholeDownscale(r.authoredPx, r.drawnPx) ? 'ok  ' : '★BAD'
      return `${ok} ${r.klass.padEnd(26)} authored ${String(r.authoredPx).padStart(4)} px`
        + ` -> drawn ${String(r.drawnPx).padStart(4)} px  = ${f.toFixed(3).padStart(7)}x`
        + `   (${r.where})`
    })
    // eslint-disable-next-line no-console
    console.log(`DRAW SCALE — authored size over world size\n${rows.join('\n')}`)
    expect(rows.length).toBeGreaterThan(0)
  })

  for (const r of drawTable()) {
    it(`${r.klass}: ${r.authoredPx} px authored, drawn at ${r.drawnPx} px`, () => {
      expect(
        isWholeDownscale(r.authoredPx, r.drawnPx),
        `${r.where}: ${r.authoredPx} / ${r.drawnPx} = ${factorOf(r.authoredPx, r.drawnPx)}`
        + ' — not a whole number, so the art is resampled onto a grid it was not drawn on',
      ).toBe(true)
    })
  }

  it('the world item lands 1:1 at the deepest zoom stop, as the cast already does', () => {
    // This is what the whole-number rule BUYS: at the stop a viewer looks closest at, no
    // resampling happens at all. It is why `CHAR_FIGURE_PX` is `52 * 4` and not some other
    // number, and the item now shares the reason rather than merely the arithmetic.
    expect(WORLD_SPRITE_PX / ITEM_PX).toBe(BUILDING_ZOOM_STOP)
    expect(CHAR_FIGURE_PX / CHAR_TARGET_PX).toBe(BUILDING_ZOOM_STOP)
  })

  it('ITEM_PX is the world span of a 1x1 footprint, not a number chosen to divide', () => {
    // Two derivations that had to agree, and do: the art's (128 / 4) and the ground's
    // (1+1) half-tiles of a 32 px tile. Either alone would be a fitted constant.
    expect(ITEM_PX).toBe(spanOn(1, 1, TOWN_TILE.w))
    expect(ITEM_PX).toBe(WORLD_SPRITE_PX / BUILDING_ZOOM_STOP)
  })
})

// ★ OPTION C RETIRED THE DIVISOR. It was 2 against a scene zoom of 4 — a composite of 2, so
// every 128 px library sprite was pixel-DOUBLED by the camera on its way to the glass. The
// room's unit is now the interior tile the art is already authored against, at a scene zoom of
// 1, so the factor is 1 and nothing in the room is resampled at all.
describe('★ the room draws library art at NATIVE size — no upscale and no downscale', () => {
  it('the divisor is the authored tile over the tile the room lays it on, and it is one', () => {
    expect(LIBRARY_TILE_PX).toBe(INTERIOR_TILE.w)
    expect(furnishingDivisor()).toBe(LIBRARY_TILE_PX / INTERIOR_TILE.w)
    expect(furnishingDivisor()).toBe(1)
    expect(furnishingScale()).toBe(1)
  })

  it('★ it is the SAME factor for every footprint — a bed and a bowl agree about the room', () => {
    for (const [w, h] of [[1, 1], [1, 2], [2, 1], [2, 2], [3, 2]] as const) {
      const authored = spanOn(w, h, INTERIOR_TILE.w)
      const ground = spanOn(w, h, INTERIOR_TILE.w)
      expect(authored / ground).toBe(furnishingDivisor())
      expect(authored * furnishingScale()).toBe(ground)
    }
  })

  it('a furnishing lands ON its own ground, neither over nor inside it', () => {
    expect(spanOn(1, 1, INTERIOR_TILE.w) * furnishingScale()).toBe(INTERIOR_TILE.w)
    // and the town tile is still the interior tile's own quarter, so the doorway is a push-in
    expect(INTERIOR_TILE.w / TOWN_TILE.w).toBe(4)
    expect(TILE_W).toBe(TOWN_TILE.w)
  })

  it('the factor is whole and at least one, so the room can never inflate art', () => {
    expect(Number.isInteger(furnishingDivisor())).toBe(true)
    expect(furnishingDivisor()).toBeGreaterThanOrEqual(1)
    expect(furnishingScale()).toBeLessThanOrEqual(1)
  })
})
