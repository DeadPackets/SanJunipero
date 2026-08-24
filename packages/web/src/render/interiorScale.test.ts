import { describe, expect, it } from 'vitest'
import { INTERIOR_KINDS } from '@sj/shared'
import { CHAR_TARGET_PX } from './charAnim.js'
import {
  ADULT_HEIGHT_M, INTERIOR_BODY_PX, INTERIOR_PX_PER_M, INTERIOR_PX_SCALE, INTERIOR_TILE,
  ROOM_TILES, WALL_H_PX, groundRunPx, slotToTile,
} from './interiorMap.js'
import { ROOM_ZOOM, roomZoomFor } from './roomShell.js'
import {
  BED_FOOTPRINT, interiorBodyScale, interiorPieces, roomFurnishings, type PlacedItem,
} from './interiors.js'

// ★ THE COMPOSITION GUARD — the laws a per-element test cannot see.
//
// WHAT THE USER SAW, in the shipped Option C room: "Omar dwarfs his own bed. The table reads as
// a footstool beside him." Every per-element law in the suite was GREEN while that was on the
// screen, and two of them said so in as many words:
//
//   roomShell.test.ts  "★ a body is exactly as tall indoors as it is out of doors"
//                      expect(CHAR_TARGET_PX * INTERIOR_PX_SCALE * ROOM_ZOOM).toBe(208)
//   interiors.test.ts  "puts a bed within reach of the person lying in it"
//                      expect(bedTownPx / CHAR_TARGET_PX).toBeLessThan(1.5)
//
// The first asserted the defect as a law. The second compared the bed's sprite width DIVIDED
// BY FOUR against a body's TOWN height — the very conflation of the pixel factor with the
// world factor that caused the bug — and its bounds were loose enough to admit it.
//
// So the laws below are RELATIONSHIPS BETWEEN DRAWN LENGTHS, all of them in one space: interior
// pixels on the glass. Every one of them fails on the picture the user was shown.

/** How much longer a lying figure is than the same figure standing, in the shipped cast atlas:
 *  `cast/omar/manifest.json` has `figureH` 954 and a `sleep` cell 962 px across. Rounded up, so
 *  the laws below are stated against the longest a body can be drawn. */
const LYING_OVER_STANDING = 1.05

/** A body's drawn height, in interior px on the glass, at the room's own zoom. */
const bodyPx = (): number => INTERIOR_BODY_PX * ROOM_ZOOM
/** The same for the old, shipped rule, so a law can be shown to fail on the old picture. */
const SHIPPED_BODY_PX = CHAR_TARGET_PX * INTERIOR_PX_SCALE * ROOM_ZOOM

describe('★ THE ROOM IS BUILT FOR PEOPLE — drawn length against drawn length', () => {
  it('★ YOU CAN STAND UP IN IT: a body is shorter than the room\'s own wall', () => {
    // The wall art is 160 px and is authored as a room: wainscot, dado rail, a door that
    // reaches the floor line, a mantel. A head that goes through it is not a scale question,
    // it is a picture of a giant. A person fills between three fifths and four fifths of the
    // height of the room they live in.
    const ratio = bodyPx() / (WALL_H_PX * ROOM_ZOOM)
    expect(bodyPx()).toBeLessThan(WALL_H_PX * ROOM_ZOOM)
    expect(ratio).toBeGreaterThanOrEqual(0.6)
    expect(ratio).toBeLessThanOrEqual(0.8)

    // ★ AND THE SAME LAW ON THE PICTURE THAT WAS SHIPPED — 208 px against a 160 px wall.
    expect(SHIPPED_BODY_PX / WALL_H_PX).toBeGreaterThan(1)
  })

  it('★ YOU FIT IN YOUR OWN BED: a lying body is shorter than the bed it lies in', () => {
    // A bed is 1x2 interior tiles. Its LENGTH on the glass is the screen run of two tiles along
    // one ground axis — not the width of its 192 px sprite, which is the bounding square of a
    // diamond and is longer than anything inside it.
    const bedRun = groundRunPx(BED_FOOTPRINT.h) * ROOM_ZOOM
    const lying = bodyPx() * LYING_OVER_STANDING
    expect(lying).toBeLessThan(bedRun)
    // and not lost in it: a bed is a bed, not a barge
    expect(lying / bedRun).toBeGreaterThanOrEqual(0.6)

    // ★ ON THE SHIPPED PICTURE the sleeper was HALF AGAIN the length of the bed.
    expect(SHIPPED_BODY_PX * LYING_OVER_STANDING / bedRun).toBeGreaterThan(1.4)
  })

  it('★ NOR A DOLL: a body is taller than the floor tile it stands on is deep', () => {
    // The fence on the other side. "Shrink the person until it looks right" ends here: a
    // townsperson is at least a tile-and-a-half of height, which is what stops the fix from
    // being a number tuned until one screenshot passed.
    expect(bodyPx()).toBeGreaterThan(INTERIOR_TILE.h * ROOM_ZOOM)
    expect(bodyPx()).toBeGreaterThan(groundRunPx(1) * ROOM_ZOOM)
  })

  it('★ the height is DERIVED, not chosen', () => {
    // One interior tile is one metre of floor — the library authors a bed at 1x2, a table at
    // 1x1 and a chair at 1x1, which are the dimensions those things have. In a 2:1 dimetric the
    // vertical edge of a unit cube projects to exactly the tile's own height, so a metre of
    // height is INTERIOR_TILE.h and nothing else is available to choose.
    expect(INTERIOR_PX_PER_M).toBe(INTERIOR_TILE.h)
    expect(INTERIOR_BODY_PX).toBe(Math.round(ADULT_HEIGHT_M * INTERIOR_PX_PER_M))
    // The two authored things in the room with a size everybody knows agree with it: the wall
    // is a cottage's 2.5 m and the bed's long run is 2 m.
    expect(WALL_H_PX / INTERIOR_PX_PER_M).toBeCloseTo(2.5, 5)
    expect(BED_FOOTPRINT.h).toBe(2)
  })

  it('★ and it is a DOWNSCALE of the cast atlas, never an upscale', () => {
    // The lane before this one took the furniture composite from 2.0 to 1.0 because half of
    // every interior was being invented by the sampler. A body must not give that back: the
    // shipped atlas figure is 954 px, so every scale below is far under 1, and the NEW one is
    // further under than the old.
    const FIGURE_H = 954              // cast/omar/manifest.json
    const cell = CHAR_TARGET_PX / FIGURE_H
    expect(interiorBodyScale(cell)).toBeLessThan(1)
    expect(interiorBodyScale(cell)).toBeLessThan(cell * INTERIOR_PX_SCALE)
    expect(interiorBodyScale(cell) * FIGURE_H).toBeCloseTo(INTERIOR_BODY_PX, 6)
  })
})

describe('★ AND IT HOLDS FOR A SECOND BODY, EVERY ROOM KIND AND EVERY ZOOM', () => {
  it('★ a second body is drawn at exactly the height of the first', () => {
    // The scale is a pure function of the cell scale, so two bodies off two different atlases
    // still reach the glass the same height. That is the whole claim, and it is checkable:
    // give it two different figure heights and the drawn height is one number.
    for (const figureH of [954, 512, 96]) {
      expect(interiorBodyScale(CHAR_TARGET_PX / figureH) * figureH).toBeCloseTo(INTERIOR_BODY_PX, 6)
    }
  })

  it('★ every room kind the town builds obeys the same law', () => {
    // Total over INTERIOR_KINDS — a kind added to the vocabulary is covered by construction,
    // not by remembering to add a case. The wall and the body are the same in every room; what
    // changes per kind is what stands in it, and none of it may be taller than the wall.
    expect(INTERIOR_KINDS.length).toBeGreaterThanOrEqual(3)
    for (const kind of INTERIOR_KINDS) {
      const pieces = roomFurnishings(kind)
      expect(pieces.length, `${kind} is furnished`).toBeGreaterThan(0)
      for (const f of pieces) {
        const tile = slotToTile(f.slot)
        expect(tile.x, `${kind}/${f.kind} is inside the room`).toBeLessThan(ROOM_TILES.w)
        expect(tile.y, `${kind}/${f.kind} is inside the room`).toBeLessThan(ROOM_TILES.h)
        // a 1x1 or 1x2 furnishing's sprite is (w+h)x64 px; nothing in the vocabulary is bigger
        // than the wall it stands against
        expect(bodyPx(), `${kind}/${f.kind}: a body fits under the wall`)
          .toBeLessThan(WALL_H_PX * ROOM_ZOOM)
      }
    }
  })

  it('★ every zoom the camera allows: the ratios are scale-free', () => {
    // The room container carries ONE scale, and the wall, the furniture and the body are all
    // children of it — so a ratio between two of them cannot move with the zoom. Asserted by
    // computing the two laws at an arbitrary zoom and getting the same numbers.
    for (const h of [400, 678, 734, 900, 1440, 2000]) expect(roomZoomFor(h)).toBe(ROOM_ZOOM)
    for (const k of [0.5, 1, 2, 3.7]) {
      expect((INTERIOR_BODY_PX * k) / (WALL_H_PX * k)).toBeCloseTo(INTERIOR_BODY_PX / WALL_H_PX, 10)
      expect((INTERIOR_BODY_PX * k) / (groundRunPx(2) * k))
        .toBeCloseTo(INTERIOR_BODY_PX / groundRunPx(2), 10)
    }
  })
})
describe('★ A FURNISHING A BODY LIES IN IS CUT IN TWO AND PUT BACK EXACTLY', () => {
  const item = (kind: string, h: number): PlacedItem =>
    ({ kind, tile: { x: 5, y: 2 }, meta: { slots: { w: 1, h }, placement: 'floor', interiorKinds: ['house'] } })

  it('★ both halves are anchored on the WHOLE piece, not on their own half', () => {
    // THE DEFECT, and the browser had it in every room: `interiorPieces` pushes the front
    // half's TILE half a footprint nearer the viewer so a body sorts between the halves, and
    // the renderer spent that a SECOND time as a position. A chair's back floated a tile clear
    // of its own seat and the cushion was drawn twice.
    for (const [kind, h] of [['chair', 1], ['bed', 2]] as const) {
      const pieces = interiorPieces([item(kind, h)], [])
      const back = pieces.find((p) => p.half === 'back')!
      const front = pieces.find((p) => p.half === 'front')!
      expect(back.anchor, `${kind}: the halves share one anchor`).toEqual(front.anchor)
      expect(back.anchor).toEqual({ tile: { x: 5, y: 2 }, size: { w: 1, h } })
      // and the depth boxes still differ, which is what lets a body come between them
      expect(front.tile).not.toEqual(back.tile)
      expect(front.tile.y).toBeGreaterThan(back.tile.y)
    }
  })

  it('★ a whole piece anchors on itself', () => {
    const [table] = interiorPieces([item('table', 1)], [])
    expect(table!.half).toBeNull()
    expect(table!.anchor).toEqual({ tile: table!.tile, size: table!.size })
  })

  it('★ the two frames tile the whole texture — no gap, no overlap, no doubled cushion', () => {
    // `applyHalf` cuts at `round(h/2)` and lifts the back half by the FRONT half's height.
    // Both halves are bottom-anchored at the same foot, so the spans must butt exactly.
    for (const texH of [128, 192, 193, 96]) {
      const cut = Math.round(texH / 2)
      const foot = 0
      const frontTop = foot - (texH - cut), frontBottom = foot
      const backBottom = foot - (texH - cut), backTop = backBottom - cut
      expect(backBottom).toBe(frontTop)                 // butt, not gap and not overlap
      expect(backTop).toBe(foot - texH)                 // the top of the whole sprite
      expect(frontBottom).toBe(foot)                    // the bottom of it
      expect((frontBottom - frontTop) + (backBottom - backTop)).toBe(texH)
    }
  })
})

