import { describe, expect, it, vi } from 'vitest'
import type { WorldState } from '@sj/engine/state'
import type { WorldStore } from '../state/worldStore.js'
import type { Scene } from './scene.js'

const seen = vi.hoisted(() => ({ programs: [] as { fragment: string }[] }))

vi.mock('pixi.js', () => {
  class Container {
    children: Container[] = []
    destroyed = false
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {
      this.destroyed = true
    }
  }
  class Sprite extends Container {
    texture: unknown = null
    filters: unknown[] = []
    blendMode = ''
    alpha = 1
    visible = true
    eventMode = ''
    autoGarbageCollect = true
    size: [number, number] = [0, 0]
    setSize(w: number, h: number): void {
      this.size = [w, h]
    }
  }
  class Filter {
    resources: Record<string, { uniforms: Record<string, Float32Array> }>
    constructor(opts: { resources: Record<string, Record<string, { value: Float32Array }>> }) {
      this.resources = {}
      for (const [group, members] of Object.entries(opts.resources)) {
        const uniforms: Record<string, Float32Array> = {}
        for (const [name, u] of Object.entries(members)) uniforms[name] = u.value
        this.resources[group] = { uniforms }
      }
    }
    destroy(): void {}
  }
  const RenderTexture = {
    create: (o: { width: number; height: number; resolution: number; scaleMode: string }) => ({
      ...o,
      pixelWidth: Math.round(o.width * o.resolution),
      pixelHeight: Math.round(o.height * o.resolution),
      destroy: (): void => {},
    }),
  }
  return {
    Container,
    Sprite,
    Filter,
    RenderTexture,
    GlProgram: {
      from: (o: { fragment: string }) => {
        seen.programs.push(o)
        return {}
      },
    },
    defaultFilterVert: '',
  }
})

const {
  BLOOM_SCALE,
  BLOOM_STRENGTH,
  BLOOM_TAPS,
  BLOOM_TAPS_REDUCED,
  BLOOM_THRESHOLD,
  bloomBuffer,
  createBloom,
  litFraction,
} = await import('./bloom.js')
const {
  BREATH_AMP,
  FIRE_ALPHA,
  GLOW_BASE_ALPHA,
  GLOW_COLOR,
  POOL_COLOR,
  POOL_MAX_ALPHA,
  poolDiscAlpha,
} = await import('./lightPools.js')

// ── what the town actually puts in `screen.lights` ────────────────────────────────────────
// Premultiplied luminance at a light's own core: the sprite's alpha times the baked disc times
// the luminance of its tint. This is the buffer the bloom thresholds, so these are the numbers
// the threshold has to sit between.
const lumaOf = (hex: number): number =>
  (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255
const CORE = poolDiscAlpha(0)
const EMITTED = {
  lampPoolAtBrightest:
    (POOL_MAX_ALPHA + (BREATH_AMP * POOL_MAX_ALPHA) / FIRE_ALPHA) * CORE * lumaOf(POOL_COLOR),
  windowAtBreath: (GLOW_BASE_ALPHA + 2 * BREATH_AMP) * CORE * lumaOf(GLOW_COLOR),
  windowAtRest: GLOW_BASE_ALPHA * CORE * lumaOf(GLOW_COLOR),
  fire: FIRE_ALPHA * lumaOf(POOL_COLOR),
}

describe('★ the threshold, measured against the lights this town actually has', () => {
  it('★ leaves every lamp pool out, at the brightest breath it can take', () => {
    expect(EMITTED.lampPoolAtBrightest).toBeLessThan(BLOOM_THRESHOLD)
    expect(litFraction(EMITTED.lampPoolAtBrightest)).toBe(0)
  })

  it('★ lets a lit window through on its in-breath, so a bloom means somebody is awake', () => {
    expect(EMITTED.windowAtBreath).toBeGreaterThan(BLOOM_THRESHOLD)
    expect(litFraction(EMITTED.windowAtBreath)).toBeGreaterThan(0.2)
    // and at rest it is under, so the window breathes into the bloom rather than sitting in it
    expect(litFraction(EMITTED.windowAtRest)).toBe(0)
  })

  it('lets a fire through at every point of its flicker', () => {
    expect(litFraction(EMITTED.fire)).toBeGreaterThan(0.5)
    expect(litFraction(FIRE_ALPHA - BREATH_AMP * lumaOf(POOL_COLOR))).toBeGreaterThan(0)
  })

  // ★ The briefed 0.72 was written for a buffer with headroom over white. This one has none:
  // it is 8-bit premultiplied, and the brightest thing the town can put in it is a fire.
  it('★ would be black at the briefed 0.72, because no light in the town reaches it', () => {
    const brightest = Math.max(...Object.values(EMITTED))
    expect(brightest).toBeLessThan(0.72)
  })
})

describe('★ the bloom buffer sits on the pixel grid', () => {
  it('★ gives one texel a whole number of device pixels, at every size and every DPR', () => {
    for (const [w, h] of [
      [2560, 1440],
      [1280, 720],
      [1281, 719],
      [1, 1],
      [1920, 1080],
    ]) {
      for (const res of [1, 2, 3]) {
        const b = bloomBuffer(w!, h!, res)
        expect(Number.isInteger(b.texW), `${String(w)}x${String(h)}@${String(res)}`).toBe(true)
        expect(Number.isInteger(b.texH)).toBe(true)
        // the sprite is drawn at cssW, so this is device pixels per texel, and it must be whole
        expect((b.cssW * res) / b.texW).toBe(1 / BLOOM_SCALE)
        expect((b.cssH * res) / b.texH).toBe(1 / BLOOM_SCALE)
        // and it must cover the screen rather than fall a pixel short of it
        expect(b.cssW).toBeGreaterThanOrEqual(w!)
        expect(b.cssH).toBeGreaterThanOrEqual(h!)
      }
    }
  })
})

// ── the pass itself ───────────────────────────────────────────────────────────────────────

type Rig = {
  bloom: ReturnType<typeof createBloom>
  targets: () => unknown[]
  containers: () => string[]
  composite: () => { visible: boolean; alpha: number; blendMode: string; size: [number, number] }
  taps: () => number
  world: (next: { tick: number; burning?: boolean }) => void
}

type FilterLike = { resources: { bloomUniforms: { uniforms: { uBloom: Float32Array } } } }

function rig(start: { tick: number; burning?: boolean } = { tick: 0 }): Rig {
  const drawn: { container: unknown; target: unknown }[] = []
  const lightsLayer = { name: 'lights' }
  const bloomLayer = {
    name: 'bloom',
    children: [] as unknown[],
    addChild: (c: unknown) => bloomLayer.children.push(c),
  }
  const scene = {
    app: {
      screen: { width: 2560, height: 1440 },
      renderer: {
        resolution: 1,
        render: (o: { container: unknown; target: unknown }) => drawn.push(o),
      },
    },
    screen: { lights: lightsLayer, bloom: bloomLayer },
  } as unknown as Scene

  let state = { tick: start.tick, structures: { h1: { burning: start.burning === true } } }
  let notify = (): void => {}
  const store = {
    getState: () => state as unknown as WorldState,
    subscribe: (fn: () => void) => {
      notify = fn
      return () => {}
    },
  } as unknown as WorldStore

  const bloom = createBloom(scene, store)
  const composite = (): {
    visible: boolean
    alpha: number
    blendMode: string
    size: [number, number]
  } => bloomLayer.children[0] as never
  return {
    bloom,
    targets: () => drawn.map((d) => d.target),
    containers: () => drawn.map((d) => (d.container as { name?: string }).name ?? 'offstage'),
    composite,
    taps: () => {
      const host = drawn.find((d) => (d.container as { name?: string }).name === undefined)
      const sprite = (host?.container as { children: { filters: FilterLike[] }[] }).children[0]!
      return sprite.filters[0]!.resources.bloomUniforms.uniforms.uBloom[3]!
    },
    world: (next) => {
      state = { tick: next.tick, structures: { h1: { burning: next.burning === true } } }
      notify()
    },
  }
}

describe('★ the bloom pass', () => {
  it('★ captures the lights and never its own output: the glow lives in a layer above them', () => {
    const r = rig({ tick: 0 }) // deep night, every lamp lit
    r.bloom.tick()
    expect(r.containers()).toEqual(['lights', 'offstage'])
    // two targets, both render textures, and neither of them is the screen
    expect(r.targets()).toHaveLength(2)
    expect(r.targets().every((t) => t !== null && t !== undefined)).toBe(true)
    expect(r.targets()[0]).not.toBe(r.targets()[1])
  })

  it('screens the glow back at the strength the brief set, over the whole screen', () => {
    const r = rig({ tick: 0 })
    r.bloom.tick()
    const c = r.composite()
    expect(c.blendMode).toBe('screen')
    expect(c.alpha).toBe(BLOOM_STRENGTH)
    expect(c.size).toEqual([2560, 1440])
    expect(c.visible).toBe(true)
  })

  // ★ Nothing in the town is over the threshold at noon, and a capture of a black screen still
  // pays for every pixel of it. Half of every sim day was the whole pass, spent on nothing.
  it('★ runs no pass at all at midday, and comes back for a fire', () => {
    const r = rig({ tick: 720 }) // full day
    r.bloom.tick()
    expect(r.targets()).toEqual([])
    expect(r.composite().visible).toBe(false)
    r.world({ tick: 720, burning: true })
    r.bloom.tick()
    expect(r.targets()).toHaveLength(2)
    expect(r.composite().visible).toBe(true)
  })

  it('★ is the chain’s third rung: shed, it renders nothing and shows nothing', () => {
    const r = rig({ tick: 0 })
    r.bloom.setEnabled(false)
    r.bloom.tick()
    expect(r.targets()).toEqual([])
    expect(r.composite().visible).toBe(false)
    r.bloom.setEnabled(true)
    r.bloom.tick()
    expect(r.targets()).toHaveLength(2)
  })
})

describe('the bloomRadius rung', () => {
  it('halves the directions the blur samples, and puts them back', () => {
    const r = rig({ tick: 0 })
    r.bloom.tick()
    expect(r.taps()).toBe(BLOOM_TAPS)
    r.bloom.setRadius(false)
    expect(r.taps()).toBe(BLOOM_TAPS_REDUCED)
    r.bloom.setRadius(true)
    expect(r.taps()).toBe(BLOOM_TAPS)
  })
})

// ── ★ the shader pixi actually compiles ──────────────────────────────────────────────────
//
// A filter fragment is not TypeScript and no typecheck reads it. Both rules below were learnt
// from a real GL context: the pass linked or compiled to nothing, and every unit test stayed
// green because every unit test drives a fake renderer.

describe('★ the shader pixi actually compiles', () => {
  /** Pixi's own filter VERTEX declares these at highp, and it compiles a filter as GLSL ES 1.00
   *  under a `precision mediump float` preamble. A precision that disagrees across the two
   *  stages fails to LINK, and the whole subtree under the filter then draws nothing. */
  const SHARED_WITH_THE_VERTEX = ['uInputSize', 'uInputPixel', 'uOutputFrame', 'uGlobalFrame']

  it("★ declares every uniform it shares with pixi's filter vertex at highp", () => {
    for (const name of SHARED_WITH_THE_VERTEX) {
      const at = new RegExp(`uniform\\s+(\\w+\\s+)?vec4\\s+${name}\\s*;`).exec(
        seen.programs[0]!.fragment,
      )
      if (at === null) continue
      expect(at[1]?.trim(), name).toBe('highp')
    }
  })

  it('★ compares no loop against a uniform: GLSL ES 1.00 forbids it and the shader will not build', () => {
    const loops = [
      ...seen.programs[0]!.fragment.matchAll(
        /for\s*\([^;]*;[^;]*?([<>]=?)\s*([A-Za-z_][\w.]*|\d+)\s*;/g,
      ),
    ]
    expect(loops.length).toBeGreaterThan(0)
    for (const [, , bound] of loops) expect(Number.isInteger(Number(bound)), bound).toBe(true)
  })
})
