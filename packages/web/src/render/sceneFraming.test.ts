import { describe, expect, it } from 'vitest'
import { FIT_MARGIN_PX, fitsAt, ZOOM_STOPS } from './camera.js'
import { TILE_H, TILE_W, tileToScreen } from './iso.js'
import { SCENE_MARGIN_TILES, sceneBox, sceneCast, sceneShot } from './sceneFraming.js'

const STAGE = { w: 1280, h: 720 }
const at = (x: number, y: number): { sx: number; sy: number } => tileToScreen(x, y)

// A well, two people beside it, and a third far enough off that the fit decides the shot where
// the pair's own box is small enough for the cap to.
const AMARA = at(10, 10)
const SALMA = at(12, 10)
const NADIR = at(40, 40)

describe('★ the camera frames the room, not the faces in it', () => {
  it('keeps a tile and a half of ground on every side of the whole cast', () => {
    const box = sceneBox([AMARA, SALMA])!
    expect(box.minX).toBe(Math.min(AMARA.sx, SALMA.sx) - SCENE_MARGIN_TILES * TILE_W)
    expect(box.maxX).toBe(Math.max(AMARA.sx, SALMA.sx) + SCENE_MARGIN_TILES * TILE_W)
    expect(box.minY).toBe(Math.min(AMARA.sy, SALMA.sy) - SCENE_MARGIN_TILES * TILE_H)
    expect(box.maxY).toBe(Math.max(AMARA.sy, SALMA.sy) + SCENE_MARGIN_TILES * TILE_H)
  })

  it('has no shot to ask for when it has nobody to frame', () => {
    expect(sceneBox([])).toBe(null)
    expect(sceneShot([], STAGE)).toBe(null)
  })

  it('★ picks the closest named stop that still holds both of them, margin kept', () => {
    const shot = sceneShot([AMARA, NADIR], STAGE)!
    const box = sceneBox([AMARA, NADIR])!
    expect(fitsAt(box, STAGE, shot.stop), 'the pair does not fit at the stop it chose').toBe(true)
    // and it is the CLOSEST such stop: one rung in would spill the margin, or there is no rung
    const closer = ZOOM_STOPS[ZOOM_STOPS.indexOf(shot.stop) + 1]
    if (closer !== undefined) expect(fitsAt(box, STAGE, closer)).toBe(false)
  })

  it('★ widens for a third participant across the square', () => {
    const two = sceneShot([AMARA, SALMA], STAGE)!
    const three = sceneShot([AMARA, SALMA, NADIR], STAGE)!
    expect(three.stop, 'a wider room asks for a wider shot').toBeLessThan(two.stop)
    expect(fitsAt(sceneBox([AMARA, SALMA, NADIR])!, STAGE, three.stop)).toBe(true)
  })

  it('centres on the room, so nobody in it sits outside the picture', () => {
    const shot = sceneShot([AMARA, SALMA, NADIR], STAGE)!
    const half = { w: STAGE.w / shot.stop / 2, h: STAGE.h / shot.stop / 2 }
    for (const p of [AMARA, SALMA, NADIR]) {
      expect(Math.abs(p.sx - shot.sx)).toBeLessThan(half.w)
      expect(Math.abs(p.sy - shot.sy)).toBeLessThan(half.h)
    }
  })

  it('falls to the widest stop rather than cutting a cast the stage cannot hold', () => {
    const scattered = [at(0, 0), at(400, 400)]
    const shot = sceneShot(scattered, STAGE)!
    expect(shot.stop).toBe(ZOOM_STOPS[0])
  })

  it('leaves the stage margin the rest of the town leaves', () => {
    expect(FIT_MARGIN_PX).toBe(24)
  })

  it('★ never stands closer than 3, however tight the cast is', () => {
    for (const stage of [STAGE, { w: 1920, h: 1080 }]) {
      for (const cast of [[AMARA], [AMARA, SALMA]]) {
        const where = `${cast.length} on a ${stage.w} stage`
        expect(fitsAt(sceneBox(cast)!, stage, 4), `${where}: 4 was refused by the fit`).toBe(true)
        expect(sceneShot(cast, stage)!.stop, where).toBe(3)
      }
    }
  })

  // The stop a two-hander a tile apart gets on each screen a viewer brings. A twelve-tile floor
  // cannot fit a phone at any usable stop and gave the first two 0.5, the whole valley.
  const VIEWPORTS = [
    { w: 390, h: 844, stop: 2 },
    { w: 430, h: 932, stop: 2 },
    { w: 820, h: 1180, stop: 3 },
    { w: 1280, h: 720, stop: 3 },
    { w: 1920, h: 1080, stop: 3 },
  ]

  it('★ shows a phone the pair rather than the valley, and holds them at every size', () => {
    for (const v of VIEWPORTS) {
      const shot = sceneShot([AMARA, SALMA], v)!
      expect(shot.stop, `${v.w}x${v.h}`).toBe(v.stop)
      expect(fitsAt(sceneBox([AMARA, SALMA])!, v, shot.stop), `${v.w}x${v.h}`).toBe(true)
    }
  })
})

describe('★ a scene the map does not draw takes nobody', () => {
  it('frames only the participants the exterior view has a body for', () => {
    expect(sceneCast(['amara', 'salma'], new Set(['salma']))).toEqual(['amara'])
  })

  it('is empty when every one of them has gone indoors', () => {
    expect(sceneCast(['amara', 'salma'], new Set(['amara', 'salma']))).toEqual([])
  })
})
