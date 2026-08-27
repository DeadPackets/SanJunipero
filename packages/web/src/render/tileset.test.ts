import { describe, it, expect } from 'vitest'
import type { TileId } from '@sj/engine/state'
import { roadNeighborsAt, tileKind } from './tileset.js'

describe('tileKind', () => {
  it('maps every engine TileId, road included', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tileKind)).toEqual([
      'grass',
      'earth',
      'water',
      'forest',
      'rock',
      'sand',
      'farmland',
      'road',
    ])
  })

  it('falls back to grass for an id the engine does not emit yet', () => {
    expect(tileKind(99)).toBe('grass')
  })
})

describe('roadNeighborsAt', () => {
  it('reads the four orthogonal road neighbours and treats off-map as empty', () => {
    const t: TileId[][] = [
      [0, 7, 0],
      [7, 7, 7],
      [0, 0, 0],
    ]
    expect(roadNeighborsAt(t, 1, 1)).toEqual({ n: true, e: true, s: false, w: true })
    expect(roadNeighborsAt(t, 0, 0)).toEqual({ n: false, e: true, s: true, w: false })
  })
})
