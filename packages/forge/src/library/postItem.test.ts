import { describe, it, expect } from 'vitest'
import { candidateRank, countIslands } from './postItem.js'

function image(w: number, h: number, on: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (on(x, y)) data.set([176, 124, 78, 255], (y * w + x) * 4)
  return { width: w, height: h, data }
}

describe('countIslands', () => {
  it('counts 4-connected opaque components, and none in a clear image', () => {
    expect(countIslands(image(8, 8, (x, y) => x < 3 && y < 3))).toBe(1)
    expect(countIslands(image(8, 8, (x, y) => (x < 3 && y < 3) || (x > 5 && y > 5)))).toBe(2)
    expect(countIslands({ width: 2, height: 1, data: new Uint8ClampedArray(8) })).toBe(0)
  })
})

describe('candidateRank', () => {
  it('ranks a clean single silhouette above one with floating debris', () => {
    const clean = { islands: 1, opaqueFrac: 0.4 }
    expect(candidateRank(clean)).toBeLessThan(candidateRank({ ...clean, islands: 3 }))
    // Among equally clean candidates the fuller cell wins.
    expect(candidateRank(clean)).toBeLessThan(candidateRank({ ...clean, opaqueFrac: 0.2 }))
  })
})
