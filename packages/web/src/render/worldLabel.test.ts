import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let installed = new Set<string>()
let bitmapThrows = false
let textThrows = false

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
    eventMode = ''
    position = new Point()
    width = 0 // real Pixi: a getter over the bounds, 0 for a container with no children
    height = 0
    addChild(...cs: Container[]): void {
      this.children.push(...cs)
    }
    destroy(): void {}
  }
  class BitmapText extends Container {
    text: string
    anchor = new Point()
    width = 40
    height = 10
    style: unknown
    constructor(opts?: { text?: string; style?: unknown }) {
      super()
      if (bitmapThrows) throw new Error("Cannot read properties of null (reading 'alphaMode')")
      this.text = opts?.text ?? ''
      this.style = opts?.style
    }
  }
  class Text extends Container {
    text: string
    anchor = new Point()
    resolution = 1
    width = 40
    height = 10
    constructor(opts?: { text?: string; style?: unknown }) {
      super()
      if (textThrows) throw new Error('no canvas in this environment')
      this.text = opts?.text ?? ''
    }
  }
  const Cache = { has: (key: string) => installed.has(key) }
  return { BitmapText, Cache, Container, Point, Text }
})

const { BitmapText: MockBitmapText, Text: MockText } = await import('pixi.js')
const {
  LABEL_RESOLUTION,
  WORLD_FONT_FAMILY,
  bitmapFontKey,
  bitmapFontInstalled,
  createWorldLabel,
} = await import('./worldLabel.js')
const { WORLD_INKS, inkedFace } = await import('./textFaces.js')

const INK = 0x43394a
const style = { fontFamily: WORLD_FONT_FAMILY, fontSize: 12, fill: INK }
/** The atlas is baked per ink, so this is the key the label actually looks for. */
const ATLAS = `${inkedFace(WORLD_FONT_FAMILY, INK)}-bitmap`

beforeEach(() => {
  installed = new Set()
  bitmapThrows = false
  textThrows = false
})

describe('bitmapFontInstalled', () => {
  it('asks the cache under the key Pixi actually stores a dynamic font at', () => {
    expect(bitmapFontKey('monospace')).toBe('monospace-bitmap')
    expect(bitmapFontInstalled('monospace')).toBe(false)
    installed.add('monospace-bitmap')
    expect(bitmapFontInstalled('monospace')).toBe(true)
  })
})

describe('createWorldLabel — a missing font costs one label, never the view', () => {
  it('degrades to a canvas glyph when the bitmap font is not installed', () => {
    const label = createWorldLabel('Nadia', style)
    expect(label).toBeInstanceOf(MockText)
    expect(label.text).toBe('Nadia')
    expect((label as unknown as { resolution: number }).resolution).toBe(LABEL_RESOLUTION)
  })

  it('uses the bitmap font the moment one is installed — no call site changes', () => {
    installed.add(ATLAS)
    expect(createWorldLabel('Nadia', style)).toBeInstanceOf(MockBitmapText)
  })

  it('survives a BitmapText that throws anyway — the reported blank-canvas crash', () => {
    installed.add(ATLAS)
    bitmapThrows = true
    const label = createWorldLabel('Nadia', style)
    expect(label).toBeInstanceOf(MockText)
    expect(label.text).toBe('Nadia')
  })

  it('degrades to NOTHING rather than throwing when even a canvas glyph fails', () => {
    installed.add(ATLAS)
    bitmapThrows = true
    textThrows = true
    const label = createWorldLabel('Nadia', style)
    expect(label.text).toBe('')
    expect(label.width).toBe(0)
    expect(label.height).toBe(0)
    label.anchor.set(0.5, 1) // every caller does this; a void label must take it
  })

  // The i7 defect: one white atlas plus a per-glyph tint rendered every world glyph white,
  // measured at 1.1:1 over its own cream slab.
  it('asks for the atlas baked in the ink it wants, never a white one it would have to tint', () => {
    installed.add(ATLAS)
    const label = createWorldLabel('Nadia', style) as unknown as { style: { fontFamily: string } }
    expect(label.style.fontFamily).toBe(inkedFace(WORLD_FONT_FAMILY, INK))
    expect(label.style.fontFamily).not.toBe(WORLD_FONT_FAMILY)
  })

  it('falls back to a canvas glyph for an ink with no atlas — a glyph that draws its own colour', () => {
    installed.add(ATLAS)
    expect(createWorldLabel('Nadia', { ...style, fill: 0x00ff00 })).toBeInstanceOf(MockText)
  })

  it('has an atlas for every ink the world writes in', () => {
    for (const ink of WORLD_INKS) installed.add(`${inkedFace(WORLD_FONT_FAMILY, ink)}-bitmap`)
    for (const ink of WORLD_INKS) {
      expect(createWorldLabel('Nadia', { ...style, fill: ink }), String(ink)).toBeInstanceOf(
        MockBitmapText,
      )
    }
  })

  it('is safe to build with no text at all — the state every hover tag starts in', () => {
    expect(() => createWorldLabel('', style)).not.toThrow()
    expect(createWorldLabel('', style).text).toBe('')
  })
})

describe('the guard: one place decides, so a new label cannot reintroduce the crash', () => {
  const HERE = dirname(fileURLToPath(import.meta.url))
  const sources = (dir: string): string[] => {
    const out: string[] = []
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        out.push(...sources(p))
        continue
      }
      if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
      out.push(p)
    }
    return out
  }

  it('leaves no module but worldLabel.ts constructing a BitmapText', () => {
    const offenders = sources(join(HERE, '..'))
      .filter((f) => !f.endsWith('worldLabel.ts'))
      .filter((f) => /new\s+BitmapText\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders, `these can blank the canvas:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('leaves no module but worldLabel.ts constructing a bare Text either', () => {
    const offenders = sources(join(HERE, '..'))
      .filter((f) => !f.endsWith('worldLabel.ts'))
      .filter((f) => /new\s+Text\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
