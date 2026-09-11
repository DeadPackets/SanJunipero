import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('pixi.js', () => {
  class Container {
    children: Container[] = []
    sortableChildren = false
    eventMode = ''
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
  }
  return { Container }
})

const { Container: MockContainer } = await import('pixi.js')
const {
  GRADED_LAYERS,
  LAYERS,
  SCREEN_LAYERS,
  SORTED_LAYER,
  Z_AUTHORISED,
  applyDepthOrder,
  createDepthGate,
  createLayers,
  createScreenLayers,
  literalZIndexOffenders,
} = await import('./layers.js')
const { bodyDepthBox, structureDepthBox } = await import('./depth.js')
const { bigTown } = await import('./bigTown.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, '..')

function sourcesUnder(dir: string): { path: string; source: string }[] {
  const out: { path: string; source: string }[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...sourcesUnder(p))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
    out.push({ path: relative(WEB_SRC, p), source: readFileSync(p, 'utf8') })
  }
  return out
}

describe('createLayers', () => {
  it('adds exactly the eight layers, in the order they paint', () => {
    const world = new MockContainer()
    const { layers: set, graded, attention } = createLayers(world)
    expect(LAYERS).toEqual([
      'ground',
      'groundDecal',
      'shadow',
      'entities',
      'overhead',
      'worldText',
      'bubbles',
      'overlay',
    ])
    // the picture layers sit inside `graded`, the word layers beside it: one paint order
    const painted = [...graded.children, ...world.children.slice(1)]
    expect(world.children[0]).toBe(attention)
    expect(attention.children).toEqual([graded])
    expect(LAYERS.map((n) => set[n])).toEqual(painted)
  })

  // ★ Two filtered nodes, not one array: `atmosphere.ts` assigns `graded.filters` outright when
  // the weather turns, so a second pass sharing that array would be wiped by the next storm.
  // Pixi also hands the screen's own origin only to the OUTER filter, and the band needs it.
  it('★ wraps the graded picture in a second node for the band, inside the world', () => {
    const world = new MockContainer()
    const { graded, attention } = createLayers(world)
    expect(attention).not.toBe(graded)
    expect(world.children.indexOf(attention)).toBe(0)
    expect(attention.children.indexOf(graded)).toBe(0)
  })

  it('★ grades the picture and never the words (D5)', () => {
    const { layers: set, graded } = createLayers(new MockContainer())
    expect(GRADED_LAYERS).toEqual(['ground', 'groundDecal', 'shadow', 'entities', 'overhead'])
    for (const n of LAYERS)
      expect(graded.children.includes(set[n]), n).toBe(GRADED_LAYERS.includes(n))
  })

  it('depth-sorts ONE layer and no other', () => {
    const { layers: set } = createLayers(new MockContainer())
    const sorted = LAYERS.filter(
      (n) => (set[n] as unknown as { sortableChildren: boolean }).sortableChildren,
    )
    expect(sorted).toEqual([SORTED_LAYER])
    expect(SORTED_LAYER).toBe('entities')
  })

  it('leaves only the sorted layer able to take a pointer', () => {
    const { layers: set } = createLayers(new MockContainer())
    for (const name of LAYERS) {
      const mode = (set[name] as unknown as { eventMode: string }).eventMode
      expect(mode, name).toBe(name === SORTED_LAYER ? '' : 'none')
    }
  })

  it('hands back a distinct container per layer', () => {
    const { layers: set } = createLayers(new MockContainer())
    expect(new Set(LAYERS.map((n) => set[n])).size).toBe(LAYERS.length)
  })
})

describe('createScreenLayers — the stack over the world', () => {
  it('paints the flash and the weather under the night quad, and the lights over it', () => {
    expect(SCREEN_LAYERS).toEqual(['flash', 'weather', 'night', 'lights', 'bloom'])
    const stage = new MockContainer()
    const set = createScreenLayers(stage)
    expect(SCREEN_LAYERS.map((n) => set[n])).toEqual(stage.children)
  })

  // ★ The night IS a multiply quad, so it only ever darkens what is already painted. Rain and
  // snow sat over it and were the brightest thing on screen at 2 a.m.
  it('★ keeps the weather under the multiply, where the night can reach it', () => {
    const at = (n: string): number => (SCREEN_LAYERS as readonly string[]).indexOf(n)
    expect(at('weather')).toBeLessThan(at('night'))
    expect(at('flash')).toBeLessThan(at('night'))
    expect(at('lights')).toBeGreaterThan(at('night'))
  })

  // ★ The bloom reads the lights and draws over them. In the same layer it would capture the
  // glow it made last frame and run away inside three seconds.
  it('★ paints the bloom over the lights it was made from, never among them', () => {
    const at = (n: string): number => (SCREEN_LAYERS as readonly string[]).indexOf(n)
    expect(at('bloom')).toBe(SCREEN_LAYERS.length - 1)
    expect(at('bloom')).toBeGreaterThan(at('lights'))
  })

  it('is event-inert throughout: a full-screen quad that took a click would end panning', () => {
    const set = createScreenLayers(new MockContainer())
    for (const n of SCREEN_LAYERS)
      expect((set[n] as unknown as { eventMode: string }).eventMode, n).toBe('none')
  })
})

// ── the cull lives inside the one depth writer ────────────────────────────────────────────

type FakeNode = { zIndex: number; visible: boolean; alpha: number }
const nodeFor = (): FakeNode => ({ zIndex: -1, visible: true, alpha: 1 })

describe('applyDepthOrder culls to the viewport', () => {
  const VIEW = { x: 0, y: 0, w: 800, h: 600 }

  it('hides what the view cannot reach and shows what it can', () => {
    const near = { box: structureDepthBox('near', { x: 8, y: 8, w: 2, h: 2 }), node: nodeFor() }
    const far = { box: structureDepthBox('far', { x: 900, y: 900, w: 2, h: 2 }), node: nodeFor() }
    applyDepthOrder([near, far] as never, VIEW)
    expect(near.node.visible).toBe(true)
    expect(far.node.visible).toBe(false)
  })

  it('brings a node back the moment the view reaches it again', () => {
    const e = { box: structureDepthBox('e', { x: 300, y: 300, w: 2, h: 2 }), node: nodeFor() }
    applyDepthOrder([e] as never, VIEW)
    expect(e.node.visible).toBe(false)
    applyDepthOrder([e] as never, { x: -8000, y: 0, w: 16000, h: 16000 })
    expect(e.node.visible).toBe(true)
  })

  it('★ keeps the sorted set under DEPTH_BUDGET on a town that would blow past it', () => {
    const entries = bigTown(3).map((s) => ({ box: structureDepthBox(s.id, s), node: nodeFor() }))
    expect(entries.length).toBeGreaterThan(256) // the fallback would fire without a cull
    const counts = applyDepthOrder(entries as never, VIEW)
    expect(counts.drawn).toBeLessThan(256)
    expect(counts.drawn + counts.culled).toBe(entries.length)
  })

  it('gives a depth only to what it drew — a hidden node keeps the one it had', () => {
    const near = { box: structureDepthBox('near', { x: 8, y: 8, w: 2, h: 2 }), node: nodeFor() }
    const far = { box: structureDepthBox('far', { x: 900, y: 900, w: 2, h: 2 }), node: nodeFor() }
    applyDepthOrder([near, far] as never, VIEW)
    expect(near.node.zIndex).toBe(0)
    expect(far.node.zIndex).toBe(-1)
  })

  it('orders the survivors exactly as it would have with nothing else in the frame', () => {
    const all = bigTown(1).map((s) => ({ box: structureDepthBox(s.id, s), node: nodeFor() }))
    const view = { x: -200, y: 0, w: 800, h: 600 }
    applyDepthOrder(all as never, view)
    const withCull = all
      .filter((e) => e.node.visible)
      .map((e) => [e.box.id, e.node.zIndex] as const)
    const only = all.filter((e) => e.node.visible).map((e) => ({ box: e.box, node: nodeFor() }))
    applyDepthOrder(only as never, { x: -1e6, y: -1e6, w: 2e6, h: 2e6 })
    expect(only.map((e) => [e.box.id, e.node.zIndex] as const)).toEqual(withCull)
  })
})

// ★ The sort is the frame's most expensive pass and its inputs move only when a body steps, a
// thing appears or the camera moves. A town asleep paid for it sixty times a second.
describe('★ the depth gate keeps the sort off a still frame', () => {
  const VIEW = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 }
  const entry = (
    id: string,
    x: number,
    y: number,
  ): { box: ReturnType<typeof structureDepthBox>; node: FakeNode } => ({
    box: structureDepthBox(id, { x, y, w: 2, h: 2 }),
    node: nodeFor(),
  })

  it('opens on the first frame and closes while nothing moves', () => {
    const gate = createDepthGate()
    const town = [entry('a', 4, 4), entry('b', 9, 9)]
    expect(gate(town as never, VIEW)).toBe(true)
    expect(gate(town as never, VIEW)).toBe(false)
    expect(gate(town as never, VIEW)).toBe(false)
  })

  it('opens when a body steps, when the camera moves, and when a thing arrives or leaves', () => {
    const gate = createDepthGate()
    const a = entry('a', 4, 4)
    const town = [a, entry('b', 9, 9)]
    gate(town as never, VIEW)

    a.box.x0 += 0.02 // a walker between two tiles
    expect(gate(town as never, VIEW)).toBe(true)
    expect(gate(town as never, VIEW)).toBe(false)

    expect(gate(town as never, { ...VIEW, x: VIEW.x + 1 })).toBe(true)

    town.push(entry('c', 12, 12))
    expect(gate(town as never, { ...VIEW, x: VIEW.x + 1 })).toBe(true)
    town.pop()
    expect(gate(town as never, { ...VIEW, x: VIEW.x + 1 })).toBe(true)
  })

  it('★ opens when a sprite is replaced under an id that did not change', () => {
    const gate = createDepthGate()
    const a = entry('a', 4, 4)
    gate([a] as never, VIEW)
    expect(gate([{ box: a.box, node: nodeFor() }] as never, VIEW)).toBe(true)
  })
})

// ── occlusion relief ──────────────────────────────────────────────────────────────────────
// ★ A house is drawn (w + h) · 32 px over its feet line while one tile of ground recession is
// 8 px, so a roof paints across about eight tiles and the sort is RIGHT to bury what is behind
// it. The picture may not lose a body over that, so the roof gives way instead of the order.

describe('★ a roof that hides a body goes translucent, and holds', () => {
  const VIEW = { x: -1e6, y: -1e6, w: 2e6, h: 2e6 }
  const HOUSE = { x: 20, y: 20, w: 2, h: 2 }
  const scene = (
    bx: number,
    by: number,
  ): {
    house: { box: ReturnType<typeof structureDepthBox>; node: FakeNode }
    body: { box: ReturnType<typeof bodyDepthBox>; node: FakeNode }
    at: (now: number) => void
  } => {
    const house = { box: structureDepthBox('house', HOUSE), node: nodeFor() }
    const body = { box: bodyDepthBox('body', bx, by), node: nodeFor() }
    return {
      house,
      body,
      at: (now) => {
        applyDepthOrder([house, body] as never, VIEW, now)
      },
    }
  }

  it('fades the roof to 0.4 over 180 ms once it is painting over somebody', () => {
    const s = scene(20, 18) // two tiles north of the house, and swallowed by its art
    s.at(0)
    expect(s.house.node.zIndex).toBeGreaterThan(s.body.node.zIndex)
    expect(s.house.node.alpha).toBe(1)
    s.at(90)
    expect(s.house.node.alpha).toBeCloseTo(0.7, 5)
    s.at(180)
    expect(s.house.node.alpha).toBeCloseTo(0.4, 5)
    s.at(400)
    expect(s.house.node.alpha).toBeCloseTo(0.4, 5)
  })

  it('never writes the alpha of a roof that is hiding nobody, so an art fade is left alone', () => {
    const s = scene(40, 40)
    for (const t of [0, 180, 1000, 5000]) s.at(t)
    expect(s.house.node.alpha).toBe(1)
  })

  // ★ The slot is only a reason to give way when somebody is standing in it: a body wearing no
  // mark owns nothing above its crown, and a roof that fades for an empty 28 px band hides nobody.
  describe('★ the glyph slot over a crown', () => {
    const overSlot = (
      overhead: { visible: boolean } | undefined,
    ): { roof: { node: FakeNode }; alphaAt: (now: number) => number } => {
      const body = { box: bodyDepthBox('body', 20, 18), node: nodeFor(), overhead }
      const roof = {
        box: {
          ...structureDepthBox('house', HOUSE),
          sy0: body.box.sy0 - 120,
          sy1: body.box.sy0 - 20, // art bottom above the crown, inside the slot
        },
        node: nodeFor(),
      }
      return {
        roof,
        alphaAt: (now) => {
          applyDepthOrder([body, roof] as never, VIEW, now)
          return roof.node.alpha
        },
      }
    }

    it('★ is claimed by a body wearing a mark, and the roof over it gives way', () => {
      const s = overSlot({ visible: true })
      s.alphaAt(0)
      expect(s.alphaAt(180)).toBeCloseTo(0.4, 5)
    })

    it('★ and is nobody at all when the slot is empty, so the roof stays whole', () => {
      const s = overSlot({ visible: false })
      for (const t of [0, 180, 1000]) expect(s.alphaAt(t)).toBe(1)
      const none = overSlot(undefined) // a body layer that publishes no slot claims none
      for (const t of [0, 180, 1000]) expect(none.alphaAt(t)).toBe(1)
    })
  })

  it('holds the relief a whole second before it may let go', () => {
    const s = scene(20, 18)
    s.at(0)
    s.at(180)
    expect(s.house.node.alpha).toBeCloseTo(0.4, 5)
    s.body.box = bodyDepthBox('body', 40, 40) // and off they go
    for (const t of [300, 700, 999]) {
      s.at(t)
      expect(s.house.node.alpha, `${t} ms`).toBeCloseTo(0.4, 5)
    }
    s.at(1000) // the exit may start here, and takes 260 ms
    expect(s.house.node.alpha).toBeCloseTo(0.4, 5)
    s.at(1130)
    expect(s.house.node.alpha).toBeCloseTo(0.7, 5)
    s.at(1260)
    expect(s.house.node.alpha).toBe(1)
  })

  it('★ cannot strobe: a body pacing a wall edge changes the roof at most once a second', () => {
    const s = scene(20, 18)
    let prev = s.house.node.alpha
    let dir = 0
    let ramps = 0
    for (let t = 0; t <= 4000; t += 20) {
      s.body.box = bodyDepthBox('body', 20, Math.floor(t / 100) % 2 === 0 ? 18 : 40)
      s.at(t)
      const d = Math.sign(s.house.node.alpha - prev)
      if (d !== 0 && d !== dir) ramps++
      if (d !== 0) dir = d
      prev = s.house.node.alpha
    }
    // Without the dwell the body crosses cover 40 times over these four seconds.
    expect(ramps).toBeGreaterThan(0)
    expect(ramps).toBeLessThanOrEqual(5)
  })

  it('keeps the depth gate open until the fade has finished, then lets the frame rest', () => {
    const gate = createDepthGate()
    const s = scene(20, 18)
    s.at(0)
    expect(gate([s.house, s.body] as never, VIEW)).toBe(true)
    s.at(90)
    expect(gate([s.house, s.body] as never, VIEW)).toBe(true) // nothing moved, the fade did
    s.at(180)
    expect(gate([s.house, s.body] as never, VIEW)).toBe(false)
  })
})

describe('literalZIndexOffenders', () => {
  it('finds an assignment in a file with no business making one', () => {
    expect(
      literalZIndexOffenders([{ path: 'render/bubbles.ts', source: 'x\nnode.zIndex = 1e9\n' }]),
    ).toEqual(['render/bubbles.ts:2 — node.zIndex = 1e9'])
  })

  it('says nothing about the files that own a sort', () => {
    for (const path of Z_AUTHORISED) {
      expect(literalZIndexOffenders([{ path, source: 'sprite.zIndex = i\n' }])).toEqual([])
    }
  })

  it('is not fooled by a read, a comparison or a comment', () => {
    const source =
      'const a = s.zIndex\nif (a.zIndex === b.zIndex) f()\n// b.zIndex = 3 was the bug\n'
    expect(literalZIndexOffenders([{ path: 'render/ambient.ts', source }])).toEqual([])
  })

  it('THE REAL SCAN: no module outside the layer authority writes a zIndex', () => {
    const offenders = literalZIndexOffenders(sourcesUnder(WEB_SRC))
    expect(
      offenders,
      `magic depth numbers still in the wild:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})
