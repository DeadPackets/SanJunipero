import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MINUTES_PER_DAY, dayPhaseFromTick } from '@sj/shared'
import type { WorldState } from '@sj/engine/state'
import { createWorldStore, type WorldStore } from '../state/worldStore.js'
import { WEATHER_GLYPH } from '../ui/townStats.js'
import {
  ARC_BOX,
  SUN_DOWN_MIN,
  SUN_UP_MIN,
  arcPercent,
  arcPoint,
  GOLDEN_ELEVATION,
  SHADOW_MAX_STRETCH,
  SHADOW_REST,
  dayWord,
  moonAltitude,
  shadowCast,
  skyKind,
  skyToken,
  skyWord,
} from '../ui/skyModel.js'
import { SkyArc } from './SkyArc.js'

const CSS = readFileSync(new URL('../ui/chrome.css', import.meta.url), 'utf8')
const at = (h: number, min = 0): number => h * 60 + min

describe('★ 5A — one traveller, one curve, and the position is the clock', () => {
  it('puts the sun on the arc between its rise and its set, and the moon on the rest', () => {
    expect(skyToken(at(5)).kind).toBe('sun')
    expect(skyToken(at(12)).kind).toBe('sun')
    expect(skyToken(at(20, 59)).kind).toBe('sun')
    expect(skyToken(at(21)).kind).toBe('moon')
    expect(skyToken(at(0)).kind).toBe('moon')
    expect(skyToken(at(4, 59)).kind).toBe('moon')
  })

  // The arc and the light on the town read one boundary, or they disagree about when it got dark.
  it('★ agrees with the only phase derivation in the codebase', () => {
    for (let m = 0; m < MINUTES_PER_DAY; m += 7) {
      const night = dayPhaseFromTick(m) === 'night'
      expect(skyToken(m).kind === 'moon', `${m}`).toBe(night)
    }
    expect(SUN_UP_MIN).toBe(at(5))
    expect(SUN_DOWN_MIN).toBe(at(21))
  })

  it('starts each traveller at the left of the road and lands it at the right', () => {
    expect(skyToken(SUN_UP_MIN).along).toBe(0)
    expect(skyToken(SUN_DOWN_MIN - 1).along).toBeCloseTo(1, 1)
    expect(skyToken(SUN_DOWN_MIN).along).toBe(0)
    expect(skyToken(at(12)).along).toBeCloseTo(0.4375, 4)
  })

  it('walks it forward hour by hour, and never backwards inside a day', () => {
    let last = -1
    for (let m = SUN_UP_MIN; m < SUN_DOWN_MIN; m += 30) {
      const x = arcPoint(skyToken(m).along).x
      expect(x, `${m}`).toBeGreaterThan(last)
      last = x
    }
  })

  it('reads the day from a later tick, not just from the first one', () => {
    expect(skyToken(3 * MINUTES_PER_DAY + at(12)).along).toBeCloseTo(skyToken(at(12)).along, 6)
  })
})

describe('the curve the token is placed on', () => {
  it('rises to its peak at the middle and comes back down', () => {
    const [rise, noon, set] = [arcPoint(0), arcPoint(0.5), arcPoint(1)]
    expect(noon.y).toBeLessThan(rise.y)
    expect(noon.y).toBeLessThan(set.y)
    expect(rise.y).toBeCloseTo(set.y, 6)
    expect(noon.x).toBeCloseTo(ARC_BOX.w / 2, 6)
  })

  it('stays inside the box it is drawn in, whatever it is handed', () => {
    for (const along of [-1, 0, 0.25, 0.5, 0.75, 1, 2, Number.NaN]) {
      const p = arcPercent(Number.isNaN(along) ? 0 : along)
      expect(p.left, `${along}`).toBeGreaterThanOrEqual(0)
      expect(p.left, `${along}`).toBeLessThanOrEqual(100)
      expect(p.top, `${along}`).toBeGreaterThanOrEqual(0)
      expect(p.top, `${along}`).toBeLessThanOrEqual(100)
    }
  })
})

describe('the words beside the road', () => {
  it('carries the day and the season, in capitals the pixel face can set', () => {
    expect(dayWord(at(15, 57))).toBe('DAY 0 · SPRING')
    expect(dayWord(12 * MINUTES_PER_DAY)).toBe('DAY 12 · SUMMER')
  })

  it('names the weather and the temperature it actually is', () => {
    const state = { weather: { kind: 'storm', temperatureC: 4 } } as unknown as WorldState
    expect(skyWord(state)).toBe('STORM 4°')
    expect(skyKind(state)).toBe('storm')
  })

  it('says nothing about a sky it has not been told, rather than inventing one', () => {
    expect(skyWord(null)).toBe('')
    expect(WEATHER_GLYPH[skyKind(null)]).toBeDefined()
  })

  // WEATHER_GLYPH was written and never mounted; the bar is its home.
  it('has a drawn glyph for every kind the world can report', () => {
    for (const kind of ['sunny', 'cloudy', 'rain', 'storm', 'snow']) {
      expect(WEATHER_GLYPH[kind], kind).toBeDefined()
    }
  })
})

describe('★ the bar the viewer actually gets', () => {
  const stormyStore = (tick: number): WorldStore => ({
    ...createWorldStore(),
    getTick: () => tick,
    getState: () =>
      ({ tick, weather: { kind: 'storm', temperatureC: 4 } }) as unknown as WorldState,
  })
  const bar = (tick: number): string =>
    renderToStaticMarkup(createElement(SkyArc, { store: stormyStore(tick) }))

  it('prints the day, the season, the weather and the temperature', () => {
    const html = bar(at(15, 57))
    expect(html).toContain('DAY 0 · SPRING')
    expect(html).toContain('STORM 4°')
  })

  it('puts the token where the hour puts it, and moves it when the hour does', () => {
    const noon = bar(at(12))
    const evening = bar(at(20))
    const pct = (html: string): number => Number(/left:([\d.]+)%/.exec(html)?.[1])
    expect(pct(noon)).toBeGreaterThan(0)
    expect(pct(evening)).toBeGreaterThan(pct(noon))
    expect(noon).toContain('data-kind="sun"')
    expect(bar(at(1))).toContain('data-kind="moon"')
  })

  it('draws the road as a shape rather than borrowing a glyph from the reader’s font', () => {
    expect(bar(at(12))).toContain('<path')
    expect(bar(at(12))).not.toMatch(/[☀-➿]/u)
  })
})

describe('the bar is quiet chrome, and does not fight the town', () => {
  // ★ ONE GROUP, bounded and centred. Spread edge to edge on a 1440px window the arc stretches
  // to a 556px smear 26px tall and its position stops meaning anything — the 900px failure,
  // arriving from the other end.
  it('takes the signpost’s inset at the top and stays a bounded, centred group', () => {
    const body = /\.sky-bar \{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(body).toMatch(/top: max\(var\(--mark-inset\), env\(safe-area-inset-/)
    expect(body).toContain('left: 50%')
    expect(body).toContain('translate: -50% 0')
    expect(body).toMatch(/width: min\(var\(--sky-w\)/)
    expect(body).toMatch(/max\(var\(--mark-inset\), env\(safe-area-inset-left\)\)/)
    expect(body).toContain('pointer-events: none')
  })

  it('carries its own ground: the sheet’s one halo on the words, a deep stroke under the road', () => {
    expect(/\.sky-chip \{([^}]*)\}/.exec(CSS)?.[1]).toContain('text-shadow: var(--halo-deep)')
    // ...and the halo itself is ink on every side, stated once in `:root`
    const halo = /--halo-deep:([^;]*);/.exec(CSS)?.[1] ?? ''
    for (const offset of ['1px 0 0 var(--deep)', '-1px 0 0 var(--deep)', '0 1px 0 var(--deep)']) {
      expect(halo, offset).toContain(offset)
    }
    expect(/\.sky-arc-ground \{([^}]*)\}/.exec(CSS)?.[1]).toContain('stroke: var(--deep)')
  })

  it('★ eases a position and runs no loop at all', () => {
    const token = /\.sky-token \{ transition:([^;]*);/.exec(CSS.replace(/\s+/g, ' '))?.[1] ?? ''
    expect(token).toContain('left')
    expect(token).toContain('top')
    expect(CSS).not.toMatch(/@keyframes sky-/)
    // ...and the easing is inside a no-preference guard, like every other motion in the sheet
    expect(CSS).toMatch(
      /@media \(prefers-reduced-motion: no-preference\) \{[^}]*\.sky-token \{ transition:/,
    )
  })

  // Below 900px the arc flattens and the position stops meaning anything, so it goes.
  it('drops the road rather than lie about the hour on a narrow window', () => {
    expect(CSS.replace(/\s+/g, ' ')).toMatch(
      /@media \(max-width: 900px\) \{.*?\.sky-arc \{ display: none/,
    )
  })

  // ★ THE PHONE COLLISION: `width: auto` on an absolutely positioned box whose only offset is
  // `left: 50%` shrinks to fit inside HALF the viewport — 195px on a 390px phone. Two nowrap
  // chips overran it and the second started before the first had finished: `DAY 0 · SPRINGLOUDY 8°`.
  it('★ keeps the two chips apart on a phone, rather than printing them into each other', () => {
    const narrow = /@media \(max-width: 900px\) \{(.*?)\n\}/s.exec(CSS)?.[1] ?? ''
    const bar = /\.sky-bar \{([^}]*)\}/.exec(narrow)?.[1] ?? ''
    expect(bar, 'the narrow bar must be restated').not.toBe('')
    expect(bar, 'half a viewport is not a width').not.toMatch(/width: auto/)
    expect(bar).toContain('justify-content: space-between')
    expect(bar).toContain('gap: var(--s-5)')
    // ...and it still takes the whole width the inset leaves it, so space-between has a span
    expect(bar).toMatch(/width: calc\(100% - 2 \* max\(var\(--mark-inset\)/)
  })

  it('leaves the stamp its corner by sitting above it, and stands down in the stream frame', () => {
    expect(/\.stage-stamp \{([^}]*)\}/.exec(CSS)?.[1]).toMatch(
      /top: calc\(max\(var\(--mark-inset\)/,
    )
    expect(CSS.replace(/\s+/g, ' ')).toContain("[data-broadcast='on'] .sky-bar { display: none; }")
  })
})

// ── ★ THE SAME TRAVELLER, ON THE GROUND (task 18) ────────────────────────────────────────
//
// The arc says where the sun and the moon are. The light on the town has to read the SAME
// traveller, or the picture and the mark over it disagree about the hour.

describe('★ the moon lights the town it is drawn over', () => {
  it('★ is nothing while the sun is up, and highest in the middle of the night', () => {
    for (const h of [6, 12, 18, 20]) expect(moonAltitude(at(h)), `${h}:00`).toBe(0)
    expect(moonAltitude(at(21))).toBeCloseTo(0, 6)
    expect(moonAltitude(at(1))).toBeGreaterThan(0.99) // 21:00 to 05:00, so 01:00 is the top
  })

  it('rises and sets with the same token the arc puts on the road', () => {
    for (const m of [0, 200, 1300, 1439]) {
      const tok = skyToken(m)
      expect(moonAltitude(m) > 0, `minute ${m}`).toBe(tok.kind === 'moon' && tok.along > 0)
    }
    expect(moonAltitude(at(2))).toBeCloseTo(Math.sin(Math.PI * skyToken(at(2)).along), 12)
  })

  it('never leaves the unit band, at any minute of any day', () => {
    for (let m = 0; m < MINUTES_PER_DAY * 2; m++) {
      expect(moonAltitude(m)).toBeGreaterThanOrEqual(0)
      expect(moonAltitude(m)).toBeLessThanOrEqual(1)
    }
  })
})

describe('★ golden hour: a low sun throws a long shadow', () => {
  it('★ casts nothing at all at noon — the blob under the feet is the whole of it', () => {
    expect(shadowCast(at(12))).toEqual(SHADOW_REST)
  })

  it('★ draws out through the golden band and is home before the sun sets', () => {
    const dusk = shadowCast(at(20, 30))
    expect(dusk.scaleX).toBeGreaterThan(1.5)
    expect(dusk.scaleX).toBeLessThanOrEqual(SHADOW_MAX_STRETCH)
    const higher = shadowCast(at(17))
    expect(higher.scaleX).toBeLessThan(dusk.scaleX)
    expect(higher.scaleX).toBeGreaterThanOrEqual(1)
    // and nothing snaps at the minute the light goes: the last lit minute is already at rest
    expect(shadowCast(at(20, 59)).scaleX).toBeLessThan(1.05)
  })

  it('★ falls AWAY from the sun: east at dawn, west at dusk', () => {
    expect(shadowCast(at(6)).dx).toBeGreaterThan(0)
    expect(shadowCast(at(20, 30)).dx).toBeLessThan(0)
    expect(shadowCast(at(12)).dx).toBe(0)
  })

  it('★ softens as it lengthens — a long shadow is a weak one', () => {
    expect(shadowCast(at(20, 30)).alpha).toBeLessThan(1)
    expect(shadowCast(at(12)).alpha).toBe(1)
  })

  it('★ the night has no cast shadow at all: the moon is a wash, not a lamp', () => {
    for (const h of [22, 0, 3]) expect(shadowCast(at(h)), `${h}:00`).toEqual(SHADOW_REST)
  })

  it('is continuous and bounded across the whole day', () => {
    let prev = shadowCast(0)
    for (let m = 1; m < MINUTES_PER_DAY; m++) {
      const c = shadowCast(m)
      expect(c.scaleX).toBeGreaterThanOrEqual(1)
      expect(c.scaleX).toBeLessThanOrEqual(SHADOW_MAX_STRETCH)
      expect(Math.abs(c.scaleX - prev.scaleX), `minute ${m}`).toBeLessThan(0.1)
      prev = c
    }
  })

  it("the golden band is a fraction of the sun's own height, not an hour of its own", () => {
    expect(GOLDEN_ELEVATION).toBeGreaterThan(0)
    expect(GOLDEN_ELEVATION).toBeLessThan(1)
  })
})
