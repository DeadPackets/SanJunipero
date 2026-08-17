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
  LAYERS, SORTED_LAYER, Z_AUTHORISED, createLayers, literalZIndexOffenders,
} = await import('./layers.js')

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
      'ground', 'groundDecal', 'shadow', 'entities', 'overhead', 'worldText', 'bubbles', 'overlay',
    ])
    expect(LAYERS.map((n) => set[n])).toEqual(world.children)
  })

  it('depth-sorts ONE layer and no other', () => {
    const set = createLayers(new MockContainer() as never)
    const sorted = LAYERS.filter((n) => (set[n] as unknown as { sortableChildren: boolean }).sortableChildren)
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

describe('literalZIndexOffenders', () => {
  it('finds an assignment in a file with no business making one', () => {
    expect(literalZIndexOffenders([{ path: 'render/bubbles.ts', source: 'x\nnode.zIndex = 1e9\n' }]))
      .toEqual(['render/bubbles.ts:2 — node.zIndex = 1e9'])
  })

  it('says nothing about the files that own a sort', () => {
    for (const path of Z_AUTHORISED) {
      expect(literalZIndexOffenders([{ path, source: 'sprite.zIndex = i\n' }])).toEqual([])
    }
  })

  it('is not fooled by a read, a comparison or a comment', () => {
    const source = 'const a = s.zIndex\nif (a.zIndex === b.zIndex) f()\n// b.zIndex = 3 was the bug\n'
    expect(literalZIndexOffenders([{ path: 'render/ambient.ts', source }])).toEqual([])
  })

  it('THE REAL SCAN: no module outside the layer authority writes a zIndex', () => {
    const offenders = literalZIndexOffenders(sourcesUnder(WEB_SRC))
    expect(offenders, `magic depth numbers still in the wild:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
