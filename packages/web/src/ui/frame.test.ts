import { describe, expect, it } from 'vitest'
import {
  BAND_MIN_PX,
  LETTERBOX_FRACTION,
  STRIP_CARD_W,
  STRIP_GAP,
  frameLayout,
  straddlers,
  stripLayout,
  type Frame,
} from './frame.js'
import { CONTROL_BAR_H } from './controlBar.js'

const STAGE = { w: 1728, h: 880 }
const area = (f: Frame): number => f.w * f.h

describe('frameLayout — the stage is a picture between two bands, and nothing else', () => {
  it('gives both bands exactly the letterbox fraction, rounded once', () => {
    const l = frameLayout(STAGE, true)
    const band = Math.round(STAGE.h * LETTERBOX_FRACTION)
    expect(band).toBe(106)
    expect(l.bandTop.h).toBe(band)
    expect(l.bandBottom.h).toBe(band)
    expect(l.bandTop.y).toBe(0)
    expect(l.bandBottom.y).toBe(STAGE.h - band)
  })

  it('partitions the stage exactly — no gap and no overlap, at any height', () => {
    for (const h of [880, 881, 601, 1000, 137]) {
      const l = frameLayout({ w: STAGE.w, h }, true)
      expect(area(l.bandTop) + area(l.picture) + area(l.bandBottom), `h=${h}`).toBe(STAGE.w * h)
      expect(l.picture.y, `h=${h}`).toBe(l.bandTop.y + l.bandTop.h)
      expect(l.bandBottom.y, `h=${h}`).toBe(l.picture.y + l.picture.h)
    }
  })

  it('is the whole stage and two bands of nothing when the day is not playing', () => {
    const l = frameLayout(STAGE, false)
    expect(l.bandTop.h).toBe(0)
    expect(l.bandBottom.h).toBe(0)
    expect(l.picture).toEqual({ x: 0, y: 0, w: STAGE.w, h: STAGE.h })
  })

  it('never returns a negative picture, however short the stage gets', () => {
    for (const h of [0, 1, 8]) {
      const l = frameLayout({ w: 400, h }, true)
      expect(l.picture.h, `h=${h}`).toBeGreaterThanOrEqual(0)
      expect(area(l.bandTop) + area(l.picture) + area(l.bandBottom), `h=${h}`).toBe(400 * h)
    }
  })

  // Task 77's bar and the bottom band cannot both own the bottom of the stage. The band is
  // deeper than the bar, so the bar docks INTO it rather than under it.
  it('returns a bottom band the control bar can dock inside', () => {
    expect(frameLayout(STAGE, true).bandBottom.h).toBeGreaterThanOrEqual(CONTROL_BAR_H)
  })

  // ★ THE ONE THE BROWSER FOUND. A 594px stage puts 12% at 71px, and a postcard is 80: the
  // strip grew to hold one, the top band did not, and the frame was 71 over 88.
  it('keeps the two bands equal, and deep enough for a postcard, on a short stage', () => {
    for (const h of [594, 620, 700, 880]) {
      const l = frameLayout({ w: 1280, h }, true)
      expect(l.bandTop.h, `h=${h}`).toBe(l.bandBottom.h)
      expect(l.bandTop.h, `h=${h}`).toBeGreaterThanOrEqual(BAND_MIN_PX)
    }
  })
})

describe('straddlers — P19s mechanical guard on the band edges', () => {
  const l = frameLayout(STAGE, true)
  const RAIL_INSET = 13 // 0.8rem at the default 16px root

  it('catches the moments rail as it was laid out before this task', () => {
    const railAsItWas = {
      id: 'moments-rail',
      x: RAIL_INSET,
      y: RAIL_INSET,
      w: 240,
      h: STAGE.h - 2 * RAIL_INSET,
    }
    expect(straddlers([railAsItWas], l)).toEqual(['moments-rail'])
  })

  it('passes a strip that IS the bottom band, and a card that sits inside the picture', () => {
    const strip = { id: 'film-strip', ...l.bandBottom }
    const inPicture = { id: 'subtitle', x: 400, y: l.picture.y + 40, w: 300, h: 40 }
    expect(straddlers([strip, inPicture], l)).toEqual([])
  })

  it('names every straddler, in the order it was given them', () => {
    const boxes = [
      { id: 'a', x: 0, y: l.picture.y - 4, w: 10, h: 40 }, // crosses the top edge
      { id: 'ok', x: 0, y: l.picture.y + 4, w: 10, h: 10 },
      { id: 'b', x: 0, y: l.bandBottom.y - 4, w: 10, h: 40 }, // crosses the bottom edge
    ]
    expect(straddlers(boxes, l)).toEqual(['a', 'b'])
  })

  it('does not call a box that merely TOUCHES an edge a straddler', () => {
    const flush = { id: 'flush', x: 0, y: l.picture.y, w: 10, h: l.picture.h }
    expect(straddlers([flush], l)).toEqual([])
  })

  it('finds nothing at all when there are no bands to straddle', () => {
    const none = frameLayout(STAGE, false)
    expect(straddlers([{ id: 'anything', x: 0, y: 0, w: STAGE.w, h: STAGE.h }], none)).toEqual([])
  })
})

describe('stripLayout — the filmstrip, scrolled so the open day is the one you are looking at', () => {
  const PITCH = STRIP_CARD_W + STRIP_GAP
  const BAND = 1200

  it('spaces every card by one card and one gap', () => {
    const { offsets } = stripLayout(6, 0, BAND)
    expect(offsets).toHaveLength(6)
    for (let i = 0; i < offsets.length; i++) expect(offsets[i]).toBe(i * PITCH)
  })

  it('centres the open card in the band', () => {
    const { offsets, scrollX } = stripLayout(20, 10, BAND)
    const centre = offsets[10]! + STRIP_CARD_W / 2 - scrollX
    expect(centre).toBeCloseTo(BAND / 2, 6)
  })

  it('clamps at both ends rather than scrolling past the first or last day', () => {
    expect(stripLayout(20, 0, BAND).scrollX).toBe(0)
    const total = 20 * PITCH - STRIP_GAP
    expect(stripLayout(20, 19, BAND).scrollX).toBe(total - BAND)
  })

  it('does not scroll at all when every day already fits', () => {
    expect(stripLayout(3, 2, BAND).scrollX).toBe(0)
  })

  it('is empty and does not throw on a town with no days yet', () => {
    expect(stripLayout(0, 0, BAND)).toEqual({ offsets: [], scrollX: 0 })
    expect(stripLayout(0, -1, 0)).toEqual({ offsets: [], scrollX: 0 })
  })

  it('treats no open day as the start of the record', () => {
    expect(stripLayout(20, -1, BAND).scrollX).toBe(0)
  })

  it('gives a card a real target to press at the smallest hit floor', () => {
    expect(STRIP_CARD_W).toBeGreaterThanOrEqual(24)
    expect(STRIP_GAP).toBeGreaterThan(0)
  })
})
