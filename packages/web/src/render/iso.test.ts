import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { TILE_H, TILE_W, depthKey, facingFrom, screenToTile, tileToScreen } from './iso.js'

describe('dimetric math', () => {
  it('uses the 32×16 base tile', () => {
    expect(TILE_W).toBe(32)
    expect(TILE_H).toBe(16)
  })

  it('tileToScreen follows the spec formula', () => {
    expect(tileToScreen(3, 1)).toEqual({ sx: 32, sy: 32 })
    expect(tileToScreen(0, 0)).toEqual({ sx: 0, sy: 0 })
  })

  it('screenToTile inverts a lattice sweep', () => {
    for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) {
      const { sx, sy } = tileToScreen(x, y)
      expect(screenToTile(sx, sy)).toEqual({ x, y })
    }
  })

  it('depthKey increases along +x+y and is stable within a diagonal', () => {
    expect(depthKey(2, 3)).toBeLessThan(depthKey(3, 2))
    let prev = -Infinity
    for (let s = 0; s < 6; s++) {
      const k = depthKey(s, 0)
      expect(k).toBeGreaterThan(prev)
      prev = k
    }
    expect(depthKey(1, 1)).toBeGreaterThan(depthKey(2, 0) - 1000) // same diagonal band
  })

  it('facingFrom maps axes and breaks ties toward x', () => {
    expect(facingFrom(1, 0)).toBe('se')
    expect(facingFrom(0, 1)).toBe('sw')
    expect(facingFrom(-1, 0)).toBe('nw')
    expect(facingFrom(0, -1)).toBe('ne')
    expect(facingFrom(1, 1)).toBe('se')
    expect(facingFrom(-2, -2)).toBe('nw')
  })
})

// ── ★ THE FOSSIL, AND THE LINE THAT KEEPS IT DEAD ─────────────────────────────────────────
//
// `depthKey`'s doc comment said it was "the minimap's cheap draw order". No minimap existed —
// `ui/hudLayout.ts` said so outright — and the sentence cost the camera lane real time: it read
// it, believed a minimap was there, and planned around one. There is a minimap now, and it does
// not use this. A comment asserting a fact nothing enforces is the defect this project keeps
// finding; a comment asserting a fact that was NEVER true is the same defect with a longer fuse.

describe('depthKey says what it is for, and it is not the minimap', () => {
  const src = readFileSync(new URL('./iso.ts', import.meta.url), 'utf8')
  const doc = src.slice(0, src.indexOf('export function depthKey'))

  it('no longer claims the minimap draws with it', () => {
    expect(doc).not.toMatch(/minimap's cheap draw order/)
  })

  it('★ and the minimap really does not — it never sorts anything', () => {
    const map = readFileSync(new URL('./minimap.ts', import.meta.url), 'utf8')
    const view = readFileSync(new URL('./MinimapView.tsx', import.meta.url), 'utf8')
    expect(map).not.toMatch(/depthKey|zIndex|sortableChildren/)
    expect(view).not.toMatch(/depthKey|zIndex|sortableChildren/)
  })

  it('names the two files that DO keep it alive, so the next reader can check', () => {
    for (const who of ['depth.test.ts', 'occlusion.test.ts']) expect(doc, who).toContain(who)
  })
})
