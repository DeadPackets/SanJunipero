import { describe, expect, it } from 'vitest'
import { ZOOM_STOPS, type ZoomStop } from '../render/camera.js'
import { LENSES, type Lens } from './route.js'
import { GAMIFICATION_BAN } from './townStats.js'
import {
  CONTROL_BAR_H, CONTROL_GLYPH, CONTROL_GLYPH_PALETTE, CONTROL_GLYPH_PX, CONTROL_GROUPS,
  actionFor, controlGlyph, controlItems, zoomTargetOf, type ControlCtx,
} from './controlBar.js'

const MASTER_PALETTE = [
  '#FFF6E9', '#F6E8D5', '#E8D5BC', '#D4BC9E', '#B89D7E', '#F2C879', '#E0A95E', '#C68A48',
  '#A66E38', '#7E512B', '#DCE8C8', '#B9D19A', '#93B573', '#6F9455', '#4F7040', '#F2C6C2',
  '#E09E9B', '#C47876', '#9E5A5C', '#D6EAF2', '#A8CFE0', '#7FB0C9', '#5A8CAB', '#3E6786',
  '#E9E2DA', '#CFC6BC', '#ABA198', '#857D75', '#5D5751', '#43394A', '#322B38', '#241F2B',
  '#171420', '#F7A66B', '#E8785A', '#8A6FA8', '#F4E289', '#F5D3B3', '#D9A876', '#9C6B47',
]

const EMOJI = /\p{Extended_Pictographic}/u

const base: ControlCtx = {
  lens: 'map', live: true, zoom: 1, following: null, insideId: null, hudHidden: false,
  townFits: true,
}

// ── ★ the overview control tells the truth about a town it cannot hold ────────────────────
//
// The stop ladder ends at 0.25, which holds four rings of the block grammar. Past that "The
// whole town" shows as much of the town as the ladder can and the rest is off screen. A
// control that quietly does most of what it says is worse than one that says what it can do.

describe('"The whole town" on a town that does not fit', () => {
  const fitItem = (townFits: boolean) =>
    controlItems({ ...base, townFits }).find((i) => i.id === 'fit')!

  it('offers the whole town while the whole town fits', () => {
    expect(fitItem(true).label).toBe('The whole town')
  })

  it('★ names what it will actually do once the town has outgrown the widest stop', () => {
    expect(fitItem(false).label).toBe('As much of the town as fits')
  })

  it('stays enabled either way — it still does the most useful thing it can', () => {
    for (const fits of [true, false]) expect(fitItem(fits).disabled).toBeUndefined()
  })

  it('is not a toggle, whichever it is saying', () => {
    for (const fits of [true, false]) expect(fitItem(fits).state).toBeUndefined()
  })
})

/** every context the bar can be asked about, as a small product */
function* contexts(): Generator<ControlCtx> {
  for (const lens of LENSES) {
    for (const live of [true, false]) {
      for (const zoom of ZOOM_STOPS) {
        for (const following of [null, 'amara']) {
          for (const insideId of [null, 'house1']) {
            for (const hudHidden of [true, false]) {
              for (const townFits of [true, false]) {
                yield { lens, live, zoom, following, insideId, hudHidden, townFits }
              }
            }
          }
        }
      }
    }
  }
}

describe('controlItems — the bar can only offer what the viewer can do', () => {
  it('fills every group, and never leaves one empty', () => {
    for (const ctx of contexts()) {
      const items = controlItems(ctx)
      for (const g of CONTROL_GROUPS) {
        expect(items.filter((i) => i.group === g).length, `${g} in ${JSON.stringify(ctx)}`)
          .toBeGreaterThan(0)
      }
    }
  })

  it('offers the way out of a room ONLY when the camera is in one', () => {
    expect(controlItems(base).map((i) => i.id)).not.toContain('exit-interior')
    expect(controlItems({ ...base, insideId: 'house1' }).map((i) => i.id)).toContain('exit-interior')
  })

  it('offers to stop following ONLY when it is following somebody', () => {
    expect(controlItems(base).map((i) => i.id)).not.toContain('unfollow')
    expect(controlItems({ ...base, following: 'amara' }).map((i) => i.id)).toContain('unfollow')
  })

  it('refuses a zoom it cannot do, and SAYS WHY in the town’s own words', () => {
    const wide = controlItems({ ...base, zoom: ZOOM_STOPS[0] }).find((i) => i.id === 'zoom-out')!
    const close = controlItems({ ...base, zoom: 4 }).find((i) => i.id === 'zoom-in')!
    expect(wide.disabled).toBe(true)
    expect(close.disabled).toBe(true)
    for (const item of [wide, close]) {
      expect(item.disabledReason, item.id).toBeTypeOf('string')
      expect(item.disabledReason!.length).toBeGreaterThan(8)
      expect(item.disabledReason!).not.toMatch(GAMIFICATION_BAN)
      expect(item.disabledReason!).not.toMatch(EMOJI)
    }
    const mid = controlItems({ ...base, zoom: 2 })
    expect(mid.find((i) => i.id === 'zoom-out')!.disabled).toBeUndefined()
    expect(mid.find((i) => i.id === 'zoom-in')!.disabled).toBeUndefined()
  })

  it('marks the lens the viewer is in, and only that one', () => {
    for (const lens of LENSES) {
      const on = controlItems({ ...base, lens }).filter((i) => i.group === 'lens' && i.state === 'on')
      expect(on.map((i) => i.id)).toEqual([`lens-${lens}`])
    }
  })

  it('every item has a spoken label and a glyph, and no label is an emoji', () => {
    for (const ctx of contexts()) {
      for (const item of controlItems(ctx)) {
        expect(item.label.length, item.id).toBeGreaterThan(2)
        expect(item.label, item.id).not.toMatch(EMOJI)
        expect(item.label, item.id).not.toMatch(GAMIFICATION_BAN)
        expect(CONTROL_GLYPH[item.glyph], `${item.id} → ${item.glyph}`).toBeDefined()
      }
    }
  })

  it('has no duplicate ids in any context', () => {
    for (const ctx of contexts()) {
      const ids = controlItems(ctx).map((i) => i.id)
      expect(new Set(ids).size, JSON.stringify(ctx)).toBe(ids.length)
    }
  })

  it('is pure — the same context twice gives the same bar', () => {
    expect(controlItems(base)).toEqual(controlItems(base))
  })
})

describe('actionFor — total over everything the bar can render', () => {
  it('answers every id in every context, with no throw and no undefined', () => {
    for (const ctx of contexts()) {
      for (const item of controlItems(ctx)) {
        const a = actionFor(item)
        expect(a, item.id).toBeDefined()
        expect(a.kind, item.id).toBeTypeOf('string')
      }
    }
  })

  it('routes each control to the thing it names', () => {
    const of = (id: string, ctx = base): ReturnType<typeof actionFor> =>
      actionFor(controlItems(ctx).find((i) => i.id === id)!)
    expect(of('live')).toEqual({ kind: 'live' })
    expect(of('zoom-out')).toEqual({ kind: 'zoom', dir: -1 })
    expect(of('zoom-in')).toEqual({ kind: 'zoom', dir: 1 })
    expect(of('fit')).toEqual({ kind: 'fit' })
    expect(of('unfollow', { ...base, following: 'amara' })).toEqual({ kind: 'follow', agentId: null })
    expect(of('exit-interior', { ...base, insideId: 'house1' })).toEqual({ kind: 'exit-interior' })
    for (const lens of LENSES) expect(of(`lens-${lens}`)).toEqual({ kind: 'lens', lens })
  })

  it('the view toggle asks for the opposite of where it is', () => {
    const of = (hudHidden: boolean): ReturnType<typeof actionFor> =>
      actionFor(controlItems({ ...base, hudHidden }).find((i) => i.id === 'hud')!)
    expect(of(false)).toEqual({ kind: 'hud', op: 'hide' })
    expect(of(true)).toEqual({ kind: 'hud', op: 'show' })
  })

  it('every lens a route can hold is reachable from the bar', () => {
    const reachable = controlItems(base)
      .filter((i) => i.group === 'lens')
      .map((i) => (actionFor(i) as { lens: Lens }).lens)
    expect([...reachable].sort()).toEqual([...LENSES].sort())
  })

  it('a zoom action lands on a real stop and clamps at the ends', () => {
    expect(zoomTargetOf(1, 1)).toBe(2)
    expect(zoomTargetOf(0.5 as ZoomStop, -1)).toBe(0.25)
    expect(zoomTargetOf(0.25 as ZoomStop, -1)).toBe(0.25)
    expect(zoomTargetOf(4, 1)).toBe(4)
    for (const z of ZOOM_STOPS) {
      for (const d of [1, -1] as const) {
        expect(ZOOM_STOPS as readonly number[]).toContain(zoomTargetOf(z, d))
      }
    }
  })
})

describe('the glyphs — drawn, never typed', () => {
  it('every glyph is 8×8 and paints only MASTER_PALETTE members', () => {
    for (const [id, pixels] of Object.entries(CONTROL_GLYPH)) {
      expect(pixels.length, id).toBeGreaterThan(0)
      for (const [x, y, fill] of pixels) {
        expect(x, id).toBeGreaterThanOrEqual(0)
        expect(x, id).toBeLessThan(CONTROL_GLYPH_PX)
        expect(y, id).toBeGreaterThanOrEqual(0)
        expect(y, id).toBeLessThan(CONTROL_GLYPH_PX)
        expect(MASTER_PALETTE, `${id} ${fill}`).toContain(fill.toUpperCase())
      }
    }
    for (const fill of CONTROL_GLYPH_PALETTE) {
      expect(MASTER_PALETTE, fill).toContain(fill.toUpperCase())
    }
  })

  it('no glyph id is a character from anybody’s font', () => {
    for (const id of Object.keys(CONTROL_GLYPH)) expect(id).not.toMatch(EMOJI)
  })

  it('an unknown glyph falls back rather than vanishing', () => {
    expect(controlGlyph('no-such-glyph').length).toBeGreaterThan(0)
  })

  it('the bar is at least a touch target tall', () => {
    expect(CONTROL_BAR_H).toBeGreaterThanOrEqual(44)
  })
})
