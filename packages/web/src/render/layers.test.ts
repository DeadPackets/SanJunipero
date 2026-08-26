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
  LAYERS,
  SORTED_LAYER,
  Z_AUTHORISED,
  applyDepthOrder,
  createLayers,
  literalZIndexOffenders,
} = await import('./layers.js')
const { structureDepthBox } = await import('./depth.js')
const { bigTown } = await import('./bigTown.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_SRC = join(HERE, '..')

function sourcesUnder(dir: string): Array<{ path: string; source: string }> {
  const out: Array<{ path: string; source: string }> = []
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
    const set = createLayers(world as never)
    expect(world.children).toHaveLength(8)
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
    expect(LAYERS.map((n) => set[n])).toEqual(world.children)
  })

  it('depth-sorts ONE layer and no other', () => {
    const set = createLayers(new MockContainer() as never)
    const sorted = LAYERS.filter(
      (n) => (set[n] as unknown as { sortableChildren: boolean }).sortableChildren,
    )
    expect(sorted).toEqual([SORTED_LAYER])
    expect(SORTED_LAYER).toBe('entities')
  })

  it('leaves only the sorted layer able to take a pointer', () => {
    const set = createLayers(new MockContainer() as never)
    for (const name of LAYERS) {
      const mode = (set[name] as unknown as { eventMode: string }).eventMode
      expect(mode, name).toBe(name === SORTED_LAYER ? '' : 'none')
    }
  })

  it('hands back a distinct container per layer', () => {
    const set = createLayers(new MockContainer() as never)
    expect(new Set(LAYERS.map((n) => set[n])).size).toBe(LAYERS.length)
  })
})

// ── the cull lives inside the one depth writer ────────────────────────────────────────────

type FakeNode = { zIndex: number; visible: boolean }
const nodeFor = (): FakeNode => ({ zIndex: -1, visible: true })

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
    expect(only.map((e, i) => [e.box.id, e.node.zIndex] as const)).toEqual(withCull)
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
