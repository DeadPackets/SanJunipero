import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FACINGS, TILE_H, TILE_W, depthKey, facingFrom, screenToTile, tileToScreen } from './iso.js'

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

  // ★ AND THAT SWEEP ON ITS OWN IS A VACUOUS GUARD, WHICH IS WHY THE NEXT ONE EXISTS.
  //
  // It samples only `tileToScreen`'s OWN OUTPUT — the lattice vertices, the exactly-measure-zero
  // set of points where a rounding rule and a flooring rule cannot disagree. It passed for the
  // whole life of a `screenToTile` that answered with the tile whose top vertex was nearest
  // rather than the tile the point is standing ON, i.e. the neighbour to the south for every
  // point in a tile's lower half. `ground.ts` states the convention this violated in its own
  // header: tile (x, y) covers `[x, x+1] × [y, y+1]`.
  it('★ names the tile a point is STANDING ON, everywhere inside the tile', () => {
    for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) {
      // the four quadrants of the tile's own diamond, plus its centre
      for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.2], [0.8, 0.2], [0.2, 0.8], [0.8, 0.8]] as const) {
        const sx = (x + fx - (y + fy)) * (TILE_W / 2)
        const sy = (x + fx + y + fy) * (TILE_H / 2)
        expect(screenToTile(sx, sy), `(${x}+${fx}, ${y}+${fy})`).toEqual({ x, y })
      }
    }
  })

  it('★ THE DEFECT, reproduced: rounding answers with the tile to the SOUTH', () => {
    // the centre of tile (3, 4) — the point a viewer is over when they click the middle of it
    const sx = (3.5 - 4.5) * (TILE_W / 2), sy = (3.5 + 4.5) * (TILE_H / 2)
    const rounded = {
      x: Math.round((sx / (TILE_W / 2) + sy / (TILE_H / 2)) / 2),
      y: Math.round((sy / (TILE_H / 2) - sx / (TILE_W / 2)) / 2),
    }
    expect(rounded).toEqual({ x: 4, y: 5 })          // the landed answer: one tile off in BOTH axes
    expect(screenToTile(sx, sy)).toEqual({ x: 3, y: 4 })
  })

  it('★ and the minimap no longer shifts the point half a tile before asking', () => {
    const src = readFileSync(new URL('./minimap.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/screenToTile\([^)]*-\s*TILE_H\s*\/\s*2\)/)
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

  it('facingFrom maps the four axes to the four facings', () => {
    expect(facingFrom(1, 0)).toBe('se')
    expect(facingFrom(0, 1)).toBe('sw')
    expect(facingFrom(-1, 0)).toBe('nw')
    expect(facingFrom(0, -1)).toBe('ne')
  })
})

// ── ★ WHICH WAY A BODY IS POINTED, AND THE RULE THAT DECIDES IT ───────────────────────────
//
// THE COMPLAINT, verbatim: "some of the characters have their sprites facing the wrong
// direction when walking."
//
// The landed rule classified the WORLD vector (`|dx|` vs `|dy|`, then the sign of one world
// axis) and labelled the answer with SCREEN names. The four cardinals are the one set of
// inputs on which those two frames agree, and the four cardinals were the whole of the landed
// test — `facingFrom maps axes and breaks ties toward x`, six assertions, four of them
// cardinal and the other two both on the `+dx +dy` diagonal. It could not see the defect.
//
// Everything below is stated against the PROJECTION instead, because the projection is what
// the viewer's eye is doing.

describe('a facing is a screen direction, so the screen decides it', () => {
  const cases: Array<[number, number]> = []
  for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) cases.push([dx, dy])

  // Where each facing's art points, as a screen quadrant. `se` is drawn walking toward the
  // bottom-right of the picture, and so on; a zero component is the tie the facing sits on.
  const QUADRANT: Record<string, { sx: -1 | 0 | 1; sy: -1 | 0 | 1 }> = {
    se: { sx: 1, sy: 1 }, sw: { sx: -1, sy: 1 }, ne: { sx: 1, sy: -1 }, nw: { sx: -1, sy: -1 },
  }
  const sign = (n: number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0)

  it('★ points every body into the screen quadrant it is actually travelling into', () => {
    for (const [dx, dy] of cases) {
      if (dx === 0 && dy === 0) continue
      const f = facingFrom(dx, dy)
      expect(f, `${dx},${dy}`).not.toBeNull()
      const { sx, sy } = tileToScreen(dx, dy) // the projection, not a restatement of it
      const q = QUADRANT[f!]!
      // A zero screen component is a tie the facing is allowed to break either way; a NONZERO
      // one is travel the viewer can see, and the art must agree with it.
      if (sx !== 0) expect(sign(sx), `${dx},${dy} → ${f} goes the wrong way across the screen`).toBe(q.sx)
      if (sy !== 0) expect(sign(sy), `${dx},${dy} → ${f} shows the wrong side of the body`).toBe(q.sy)
    }
  })

  // Not vacuous: a rule that answered `sw` for everything, or that only ever picked front
  // views, satisfies nothing here.
  it('uses all four, and uses each of them for a whole quadrant of travel', () => {
    const seen = new Map<string, number>()
    for (const [dx, dy] of cases) {
      const f = facingFrom(dx, dy)
      if (f !== null) seen.set(f, (seen.get(f) ?? 0) + 1)
    }
    expect([...seen.keys()].sort()).toEqual(['ne', 'nw', 'se', 'sw'])
    for (const [f, n] of seen) expect(n, `${f} is barely reachable`).toBeGreaterThanOrEqual(6)
  })

  // ★ THE ONE THE OLD RULE BROKE. Swapping dx and dy reflects the motion across the screen's
  // vertical axis — `sx` flips, `sy` is untouched — so the facing must reflect with it and
  // keep the same side of the body to the camera. The old rule answered `se` (a FRONT view)
  // for (+1,−1) and `nw` (a BACK view) for (−1,+1): two bodies crossing the screen in mirrored
  // directions, one facing the camera and one facing away.
  const MIRROR: Record<string, string> = { se: 'sw', sw: 'se', ne: 'nw', nw: 'ne' }

  it('★ mirrors left-right when the motion mirrors left-right', () => {
    for (const [dx, dy] of cases) {
      const { sx } = tileToScreen(dx, dy)
      if (sx === 0) continue // its own mirror; four facings cannot answer that symmetrically
      expect(facingFrom(dy, dx), `mirror of ${dx},${dy}`).toBe(MIRROR[facingFrom(dx, dy)!])
    }
  })

  it('turns a body right around when it walks back the way it came', () => {
    const ABOUT: Record<string, string> = { se: 'nw', nw: 'se', sw: 'ne', ne: 'sw' }
    for (const [dx, dy] of cases) {
      const { sx, sy } = tileToScreen(dx, dy)
      if (sx === 0 || sy === 0) continue // the two documented ties, asserted by name below
      expect(facingFrom(-dx, -dy), `reverse of ${dx},${dy}`).toBe(ABOUT[facingFrom(dx, dy)!])
    }
  })

  // ★ PURE DEPTH — the case the brief said to look at first. Equal +dx +dy is zero sideways
  // travel and maximum depth, so either hand is honest; what is NOT honest is showing a body's
  // back while it walks toward the camera. Both ties take the right-hand facing so the pair
  // stays a mirror of itself under reversal.
  it('walks a pure-depth diagonal toward the camera facing the camera', () => {
    expect(tileToScreen(1, 1)).toEqual({ sx: 0, sy: 16 }) // straight down the screen
    for (const n of [1, 2, 5]) expect(facingFrom(n, n)).toBe('se')
    expect(tileToScreen(-1, -1)).toEqual({ sx: 0, sy: -16 }) // straight up the screen
    for (const n of [1, 2, 5]) expect(facingFrom(-n, -n)).toBe('ne')
  })

  // ★ PURE SIDEWAYS. `sy = 0`: the body is neither approaching nor receding, and it keeps its
  // face to the camera going both ways. The old rule gave (−1,+1) a BACK view.
  it('keeps a body crossing the screen facing the camera, both ways', () => {
    expect(tileToScreen(1, -1)).toEqual({ sx: 32, sy: 0 })
    expect(tileToScreen(-1, 1)).toEqual({ sx: -32, sy: 0 })
    expect(facingFrom(1, -1)).toBe('se')
    expect(facingFrom(-1, 1)).toBe('sw')
  })

  // ★ A BODY THAT HAS NOT MOVED HAS NO FACING. The old rule answered `se` — `|0| >= |0|` and
  // `0 >= 0` — so a still body was turned to face the bottom-right of the screen by arithmetic.
  it('has no answer for no motion, rather than a wrong one', () => {
    expect(facingFrom(0, 0)).toBeNull()
    expect(facingFrom(0.0, -0.0)).toBeNull()
  })
})

describe('the facing roster is written down once', () => {
  it('is the atlas column order, and the forge agrees letter for letter', () => {
    expect([...FACINGS]).toEqual(['sw', 'se', 'ne', 'nw'])
    // `@sj/web` does not depend on `@sj/forge` (drawScale.test.ts holds that boundary), so the
    // only check available is to read the literal off disk. A reordered forge roster re-cuts
    // every v2 placeholder sheet's columns, and this is what says so.
    const forge = readFileSync(
      new URL('../../../forge/src/sheet.ts', import.meta.url), 'utf8')
    const m = /export const FACINGS = \[([^\]]*)\] as const/.exec(forge)
    expect(m, 'forge/sheet.ts no longer declares FACINGS the way this reads it').not.toBeNull()
    expect(m![1]!.split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean))
      .toEqual([...FACINGS])
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
