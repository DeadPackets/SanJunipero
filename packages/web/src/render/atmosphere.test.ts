import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class Point {
    x = 0
    y = 0
    set(x: number, y: number = x): void {
      this.x = x
      this.y = y
    }
  }
  class Container {
    children: Container[] = []
    visible = true
    alpha = 1
    width = 0
    height = 0
    tint = 0xffffff
    mask: unknown = null
    filters: unknown[] = []
    eventMode = ''
    blendMode = ''
    autoGarbageCollect = true
    rotation = 0
    position = new Point()
    scale = new Point()
    anchor = new Point()
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {}
  }
  class Sprite extends Container {}
  class Graphics extends Container {
    rect(): this {
      return this
    }
    poly(): this {
      return this
    }
    fill(): this {
      return this
    }
    clear(): this {
      return this
    }
  }
  class ColorMatrixFilter {
    static writes = 0
    #m: number[] = []
    get matrix(): number[] {
      return this.#m
    }
    set matrix(v: number[]) {
      ColorMatrixFilter.writes++
      this.#m = v
    }
  }
  return { ColorMatrixFilter, Container, Graphics, Point, Sprite, Texture: { WHITE: {} } }
})
import type { WorldState } from '@sj/engine/state'
import type { Scene } from './scene.js'
import {
  MOON_COLOR,
  MOON_MAX_ALPHA,
  SKY_MAX_ALPHA,
  SUN_ALPHA,
  SUN_GOLDEN_ALPHA,
  createAtmosphere,
  skyAlpha,
  sunAlpha,
} from './atmosphere.js'
import { SUN_DOWN_MIN, SUN_UP_MIN, moonAltitude, shadowCast, sunLight } from '../ui/skyModel.js'
import { MOTION } from '../ui/motion.js'
import { clockTint, sunTint, weatherTransmit } from './tints.js'

describe('the sky gradient (U4)', () => {
  it('peaks at dawn and dusk and sits at a third of that at noon and midnight', () => {
    expect(skyAlpha(0.5)).toBeCloseTo(SKY_MAX_ALPHA, 6)
    expect(skyAlpha(0)).toBeCloseTo(SKY_MAX_ALPHA * 0.35, 6)
    expect(skyAlpha(1)).toBeCloseTo(SKY_MAX_ALPHA * 0.35, 6)
    for (let s = 0; s <= 1; s += 0.01) expect(skyAlpha(s)).toBeLessThanOrEqual(SKY_MAX_ALPHA)
  })
})

type Node = {
  children: Node[]
  tint: number
  alpha: number
  visible: boolean
  rotation: number
  blendMode: string
  mask: unknown
  filters: unknown[]
}
const drive = (): {
  atm: ReturnType<typeof createAtmosphere>
  flash: Node
  weather: Node
  lights: Node
  graded: Node
  clock: (ms: number) => void
  state: (tick: number, weather: string) => WorldState
} => {
  const node = (): Node => ({
    children: [],
    tint: 0,
    alpha: 1,
    visible: true,
    rotation: 0,
    blendMode: '',
    mask: null,
    filters: [],
  })
  const flash = node(),
    weather = node(),
    lights = node(),
    graded = node()
  const add =
    (n: Node) =>
    (...cs: Node[]) =>
      n.children.push(...cs)
  const ticker = { lastTime: 0 }
  const scene = {
    app: {
      renderer: { generateTexture: () => ({ source: {} }) },
      screen: { width: 800, height: 600 },
      ticker,
    },
    screen: {
      flash,
      weather,
      lights: { ...lights, addChild: add(lights) },
    },
    graded,
  } as unknown as Scene
  const terrain = [
    [0, 0],
    [0, 0],
  ]
  const state = (tick: number, weather2: string): WorldState =>
    ({ tick, terrain, weather: { kind: weather2 } }) as unknown as WorldState
  return {
    atm: createAtmosphere(scene),
    flash,
    weather,
    lights,
    graded,
    clock: (ms) => (ticker.lastTime = ms),
    state,
  }
}

describe('where the atmosphere draws (D1, D5, D27)', () => {
  it('draws the sky in `lights`, screened and masked to the ground', () => {
    const { lights } = drive()
    expect(rampsOf(lights)[0]!.blendMode).toBe('screen')
    // masked to the ground's outline — no hard edge on the void
    expect(planeOf(lights).mask).not.toBeNull()
  })

  // ★ THE NIGHT IS IN THE GRADE, WHICH IS UNDER THE WORDS. It was a full-screen multiply quad
  // on `app.stage`, over `worldText` and `bubbles`, and AA_RATIO priced NIGHT_FLOOR at 0.590.
  it('★ puts the night on `scene.graded` and on no quad at all, at an hour with no weather', () => {
    const { atm, flash, weather, lights, graded, state } = drive()
    atm.update(state(0, 'sunny'))
    expect(graded.filters).toHaveLength(1)
    const night = clockTint(0)
    const m = (graded.filters[0] as { matrix: number[] }).matrix
    expect(m[0]).toBeCloseTo(((night >> 16) & 0xff) / 255, 6)
    expect(m[6]).toBeCloseTo(((night >> 8) & 0xff) / 255, 6)
    expect(m[12]).toBeCloseTo((night & 0xff) / 255, 6)
    // nothing multiplies the stage: no layer the atmosphere owns holds a full-screen quad
    for (const n of [flash, weather, lights])
      expect(n.children.some((c) => c.blendMode === 'multiply')).toBe(false)
  })

  it('★ grades `scene.graded` and never the world: speech stays out of the weather', () => {
    const { atm, graded, state } = drive()
    atm.update(state(720, 'storm'))
    expect(graded.filters).toHaveLength(1)
    atm.update(state(720, 'sunny'))
    expect(graded.filters).toHaveLength(0) // full day, clear sky: identity, so nothing attached
  })

  // ★ `update` runs once a frame. The matrix is a pure function of the weather kind and the
  // hour, and assigning it dirties the filter's uniform group — an 80-byte re-upload at 60 fps.
  it('★ writes the grading matrix when the weather or the hour changes, not on every frame', async () => {
    const { ColorMatrixFilter } = (await import('pixi.js')) as unknown as {
      ColorMatrixFilter: { writes: number }
    }
    const { atm, clock, state } = drive()
    atm.update(state(720, 'rain'))
    const written = ColorMatrixFilter.writes
    for (let i = 1; i <= 30; i++) atm.update(state(720 + i, 'rain'))
    expect(ColorMatrixFilter.writes, 'a frame of rain at noon is not new weather').toBe(written)

    atm.update(state(760, 'storm'))
    expect(ColorMatrixFilter.writes).toBe(written + 1)

    // the night cross-fades, so dusk reaches the diagonal as the clock runs, not on the tick
    clock(2000)
    atm.update(state(1200, 'storm'))
    clock(2000 + MOTION.ambient.ms)
    atm.update(state(1200, 'storm'))
    const dusk = ColorMatrixFilter.writes
    expect(dusk, 'dusk moves the diagonal too').toBeGreaterThan(written + 1)
    atm.update(state(1200, 'storm'))
    expect(ColorMatrixFilter.writes, 'and a still frame at dusk writes nothing').toBe(dusk)
  })

  // ★ The quad used to darken these two on its way past. Proved on a real GL context: a plain
  // child of a tinted layer reads back 0x414b7b, and an added one reads back the tint times it.
  it('★ takes the night off the clock and hands it to the sky and the screen layers', () => {
    const { atm, flash, weather, lights, state } = drive()
    atm.update(state(240, 'sunny'))
    const night = clockTint(240)
    expect(rampsOf(lights)[0]!.tint).toBe(night)
    expect(rampsOf(lights)[0]!.alpha).toBeCloseTo(skyAlpha(0), 6)
    expect(flash.tint).toBe(night)
    expect(weather.tint).toBe(night)
  })

  it('★ leaves the flash and the rain at their own colour in full daylight', () => {
    const { atm, flash, weather, state } = drive()
    atm.update(state(720, 'sunny'))
    expect(flash.tint).toBe(0xffffff)
    expect(weather.tint).toBe(0xffffff)
  })
})

// ── ★ THE MOON ON THE ARC LIGHTS THE ROOFS UNDER IT (task 18) ────────────────────────────

// The three ramps now sit inside ONE masked group, in paint order: the sky, the moon, the sun.
// They are named by that order rather than by `.at(-1)`, which used to mean the moon.
const planeOf = (lights: Node): Node => lights.children.find((c) => c.children.length > 0)!
const rampsOf = (lights: Node): Node[] =>
  planeOf(lights).children.filter((c) => c.blendMode === 'screen')
const moonOf = (lights: Node): Node => rampsOf(lights)[1]!
const sunOf = (lights: Node): Node => rampsOf(lights)[2]!

describe('★ the moon', () => {
  it('★ is a second screened ramp in `lights`, over the same masked ground', () => {
    const { lights } = drive()
    expect(rampsOf(lights)).toHaveLength(3)
    expect(moonOf(lights).tint).toBe(MOON_COLOR)
    // ★ ONE mask for the group, not one per ramp: three masked siblings measured 11 draw calls
    // a frame on the bench and the masked group measures 5.
    expect(planeOf(lights).mask).not.toBeNull()
    for (const r of rampsOf(lights)) expect(r.mask).toBeNull()
  })

  it('★ is dark all day and rides its own altitude at night', () => {
    const { atm, lights, state } = drive()
    atm.update(state(720, 'sunny'))
    expect(moonOf(lights).alpha).toBe(0)
    atm.update(state(60, 'sunny'))
    expect(moonOf(lights).alpha).toBeCloseTo(MOON_MAX_ALPHA * moonAltitude(60), 6)
    expect(moonOf(lights).alpha).toBeGreaterThan(0)
  })

  it('★ is cool where every other light in the town is warm, and stays under its ceiling', () => {
    expect((MOON_COLOR >> 16) & 0xff).toBeLessThan(MOON_COLOR & 0xff)
    const { atm, lights, state } = drive()
    for (let m = 0; m < 1440; m += 7) {
      atm.update(state(m, 'sunny'))
      expect(moonOf(lights).alpha, `minute ${m}`).toBeLessThanOrEqual(MOON_MAX_ALPHA)
    }
    expect(MOON_MAX_ALPHA).toBeLessThanOrEqual(0.2)
  })
})

// ── ★ THE SUN, ADDED INTO THE HIGHLIGHTS ─────────────────────────────────────────────────

describe('★ the sun', () => {
  it('★ is a third screened ramp on the same mask, warm from `SUN_STOPS`', () => {
    const { atm, lights, state } = drive()
    atm.update(state(780, 'sunny'))
    const sun = sunOf(lights)
    expect(sun.tint).toBe(sunTint(780))
    expect((sun.tint >> 16) & 0xff).toBeGreaterThan(sun.tint & 0xff) // warm: red over blue
  })

  it('★ is not drawn at all between the sun going down and coming up again', () => {
    const { atm, lights, state } = drive()
    for (const m of [SUN_DOWN_MIN, 1350, 0, 120, SUN_UP_MIN - 1]) {
      atm.update(state(m, 'sunny'))
      expect(sunOf(lights).visible, `minute ${m}`).toBe(false)
      expect(sunOf(lights).alpha, `minute ${m}`).toBe(0)
    }
  })

  it('★ turns its bright edge onto the sun, and away from the shadow the same minute casts', () => {
    const { atm, lights, state } = drive()
    const noon = (SUN_UP_MIN + SUN_DOWN_MIN) / 2
    atm.update(state(noon, 'sunny'))
    expect(sunOf(lights).rotation).toBeCloseTo(0, 6) // overhead: the ramp stands up

    for (const m of [SUN_UP_MIN + 60, noon - 120, noon + 120, SUN_DOWN_MIN - 60]) {
      atm.update(state(m, 'sunny'))
      const turn = sunOf(lights).rotation
      expect(Math.sign(turn), `minute ${m}`).toBe(Math.sign(sunLight(m).x))
      const cast = shadowCast(m)
      if (cast.dx !== 0) expect(Math.sign(cast.dx), `minute ${m}`).toBe(-Math.sign(turn))
    }
  })

  it('★ goes when the post chain sheds its last rung, and the sky and the moon stay', () => {
    const { atm, lights, state } = drive()
    atm.update(state(780, 'sunny'))
    const lit = { sun: sunOf(lights).alpha, sky: rampsOf(lights)[0]!.alpha }
    expect(lit.sun).toBeGreaterThan(0)

    atm.setSun(false)
    expect(sunOf(lights).visible).toBe(false)
    atm.update(state(780, 'sunny'))
    expect(sunOf(lights).visible).toBe(false)
    expect(rampsOf(lights)[0]!.alpha).toBe(lit.sky)

    atm.setSun(true)
    atm.update(state(780, 'sunny'))
    expect(sunOf(lights).visible).toBe(true)
    expect(sunOf(lights).alpha).toBe(lit.sun)
  })

  it('★ never outshines the sky it hangs in, and the golden band is its loudest hour', () => {
    const { atm, lights, state } = drive()
    let loudest = 0
    let loudestMin = -1
    for (let m = 0; m < 1440; m++) {
      atm.update(state(m, 'sunny'))
      const a = sunOf(lights).alpha
      expect(a, `minute ${m}`).toBeLessThanOrEqual(SKY_MAX_ALPHA)
      if (a > loudest) {
        loudest = a
        loudestMin = m
      }
    }
    expect(sunAlpha(sunLight(loudestMin)).toFixed(6)).toBe(loudest.toFixed(6))
    expect(sunLight(loudestMin).golden).toBeGreaterThan(0.9) // the loudest minute is a golden one
    expect(loudest).toBeGreaterThan(SUN_ALPHA) // and it is louder than the sun overhead
    expect(SUN_GOLDEN_ALPHA).toBeGreaterThan(0)
  })
})

// ── ★ THE WEATHER REACHES THE SKY'S OWN LIGHT ────────────────────────────────────────────

describe('★ a cloud deck dims the sky, not only the ground', () => {
  it('★ takes the same transmittance off the moon, the ramp and the sun that it takes off the ground', () => {
    const { atm, lights, state } = drive()
    const read = (): number[] => [
      rampsOf(lights)[0]!.alpha,
      moonOf(lights).alpha,
      sunOf(lights).alpha,
    ]
    atm.update(state(300, 'sunny'))
    const clear = read()
    atm.update(state(300, 'storm'))
    const under = read()
    const t = weatherTransmit('storm')
    expect(t).toBeLessThan(1)
    for (let i = 0; i < clear.length; i++)
      expect(under[i]!, `light ${i}`).toBeCloseTo(clear[i]! * t, 9)
  })

  it('★ is dimmest under the deck that takes most off the ground', () => {
    expect(weatherTransmit('sunny')).toBe(1)
    expect(weatherTransmit('nothing the town has a word for')).toBe(1)
    expect(weatherTransmit('storm')).toBeLessThan(weatherTransmit('rain'))
    expect(weatherTransmit('rain')).toBeLessThan(weatherTransmit('snow'))
    expect(weatherTransmit('snow')).toBeLessThan(weatherTransmit('cloudy'))
    expect(weatherTransmit('cloudy')).toBeLessThan(1)
  })
})
