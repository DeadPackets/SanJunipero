import { describe, expect, it, vi } from 'vitest'
import type { Container } from 'pixi.js'
import type { Scene } from './scene.js'
import type { SceneRingBounds } from './sceneRing.js'

const seen = vi.hoisted(() => ({ programs: [] as { fragment: string }[] }))

vi.mock('pixi.js', () => {
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
  return {
    Filter,
    GlProgram: {
      from: (o: { fragment: string }) => {
        seen.programs.push(o)
        return {}
      },
    },
    defaultFilterVert: '',
  }
})

const { ATTENTION_FADE_MS, BAND_TILES, DESATURATE, castBand, createAttention } = await import(
  './attention.js'
)
const { TILE_H, TILE_W } = await import('./iso.js')

type Rig = {
  node: { filters: unknown[] }
  scene: Scene
  tick: (atMs: number) => void
  band: () => Float32Array | null
  set: (next: {
    ring?: SceneRingBounds | null
    picked?: string | null
    subject?: string | null
    zoom?: number
    pan?: { x: number; y: number }
  }) => void
}

function rig(): Rig {
  const state = {
    ring: null as SceneRingBounds | null,
    picked: null as string | null,
    subject: null as string | null,
    zoom: 1,
    pan: { x: 0, y: 0 },
  }
  const node = { filters: [] as unknown[] }
  const scene = {
    app: { ticker: { lastTime: 0 } },
    world: { scale: { x: state.zoom }, position: state.pan },
    ring: { bounds: () => state.ring },
    get pickedId() {
      return state.picked
    },
    get cameraSubject() {
      return state.subject
    },
    pointOf: (_kind: string, id: string) => (id === 'gone' ? null : { sx: 400, sy: 200 }),
    wantsMotion: () => true,
  } as unknown as Scene
  const att = createAttention(scene, node as unknown as Container)
  return {
    node,
    scene,
    tick: (atMs) => {
      ;(scene.app.ticker as { lastTime: number }).lastTime = atMs
      att.tick()
    },
    band: () => {
      const f = node.filters[0] as
        | { resources: { bandUniforms: { uniforms: { uBand: Float32Array } } } }
        | undefined
      return f === undefined ? null : f.resources.bandUniforms.uniforms.uBand
    },
    set: (next) => {
      Object.assign(state, next)
      ;(scene.world as { scale: { x: number } }).scale.x = state.zoom
      ;(scene.world as { position: { x: number; y: number } }).position = state.pan
    },
  }
}

const RING: SceneRingBounds = { sceneId: 's1', sx: 100, sy: 50, rx: 64, ry: 32 }

describe('castBand — who the camera is about', () => {
  it('★ takes the cast from the world’s own open scene, never from a guess about who is near', () => {
    const r = rig()
    r.set({ ring: RING, picked: 'someone-else' })
    const band = castBand(r.scene)
    expect(band).toEqual({ sx: 100, sy: 50, r: 64 + BAND_TILES * TILE_W })
  })

  it('widens with a cast that stands wider, and squares the ring’s iso aspect first', () => {
    const r = rig()
    r.set({ ring: { ...RING, rx: 10, ry: 90 } })
    expect(castBand(r.scene)?.r).toBe((90 * TILE_W) / TILE_H + BAND_TILES * TILE_W)
  })

  it('falls back to the body the viewer picked, then to the one the camera chose', () => {
    const r = rig()
    r.set({ picked: 'ada', subject: 'bo' })
    expect(castBand(r.scene)).toEqual({ sx: 400, sy: 200, r: BAND_TILES * TILE_W })
    r.set({ picked: null })
    expect(castBand(r.scene)).toEqual({ sx: 400, sy: 200, r: BAND_TILES * TILE_W })
    r.set({ subject: null })
    expect(castBand(r.scene)).toBeNull()
    r.set({ subject: 'gone' }) // on the map but not placed this frame
    expect(castBand(r.scene)).toBeNull()
  })
})

describe('the depth of attention band', () => {
  // ★ A pass attached with nothing to say still forces the whole picture through an offscreen
  // round trip. With no cast there is nothing to say, so the filter comes off entirely.
  it('★ carries no filter at all while the town has no cast', () => {
    const r = rig()
    for (const t of [0, 100, 1000]) r.tick(t)
    expect(r.node.filters).toEqual([])
  })

  it('attaches once a scene opens and writes the band in screen pixels for this camera', () => {
    const r = rig()
    r.set({ ring: RING, zoom: 2, pan: { x: 30, y: -10 } })
    r.tick(0)
    r.tick(ATTENTION_FADE_MS)
    const band = r.band()
    expect(r.node.filters).toHaveLength(1)
    expect(band?.[0]).toBe(100 * 2 + 30)
    expect(band?.[1]).toBe(50 * 2 - 10)
    expect(band?.[2]).toBe((64 + BAND_TILES * TILE_W) * 2)
  })

  it('ramps to full desaturation over the fade and never past it', () => {
    const r = rig()
    r.set({ ring: RING })
    r.tick(0)
    expect(r.band()).toBeNull() // the first tick has no elapsed time to ramp over
    r.tick(ATTENTION_FADE_MS / 2)
    expect(r.band()?.[3]).toBeCloseTo(DESATURATE / 2, 5)
    r.tick(ATTENTION_FADE_MS)
    expect(r.band()?.[3]).toBeCloseTo(DESATURATE, 5)
    r.tick(ATTENTION_FADE_MS * 4)
    expect(r.band()?.[3]).toBeCloseTo(DESATURATE, 5)
  })

  it('★ fades back out and then takes the whole pass off when the scene closes', () => {
    const r = rig()
    r.set({ ring: RING })
    r.tick(0)
    r.tick(ATTENTION_FADE_MS)
    expect(r.node.filters).toHaveLength(1)
    r.set({ ring: null })
    r.tick(ATTENTION_FADE_MS * 1.5)
    expect(r.band()?.[3]).toBeCloseTo(DESATURATE / 2, 5)
    expect(r.node.filters).toHaveLength(1) // still fading, still costing
    r.tick(ATTENTION_FADE_MS * 2)
    expect(r.node.filters).toEqual([])
  })

  it('★ is the chain’s first rung: shedding it takes the pass off, not just its strength', () => {
    const node = { filters: [] as unknown[] }
    const r = rig()
    r.set({ ring: RING })
    const att = createAttention(r.scene, node as unknown as Container)
    const at = (ms: number): void => {
      ;(r.scene.app.ticker as { lastTime: number }).lastTime = ms
      att.tick()
    }
    at(0)
    at(ATTENTION_FADE_MS)
    expect(node.filters).toHaveLength(1)
    att.setEnabled(false)
    at(ATTENTION_FADE_MS * 2)
    expect(node.filters).toEqual([])
  })

  it('snaps rather than ramps for a reader who asked for no motion', () => {
    const r = rig()
    ;(r.scene as unknown as { wantsMotion: () => boolean }).wantsMotion = () => false
    r.set({ ring: RING })
    r.tick(0)
    expect(r.band()?.[3]).toBeCloseTo(DESATURATE, 5)
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
})
