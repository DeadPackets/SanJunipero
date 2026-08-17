import { describe, it, expect } from 'vitest'
import { CHUNK_TILES, chunkOf, chunksTouched } from './chunk.js'

describe('chunkOf', () => {
  it('is 32 tiles square', () => {
    expect(CHUNK_TILES).toBe(32)
  })
  it('puts the origin in chunk 0,0 and (33,64) in chunk 1,2', () => {
    expect(chunkOf(0, 0)).toEqual({ cx: 0, cy: 0 })
    expect(chunkOf(33, 64)).toEqual({ cx: 1, cy: 2 })
  })
  it('splits on the boundary, not one tile late', () => {
    expect(chunkOf(31, 31)).toEqual({ cx: 0, cy: 0 })
    expect(chunkOf(32, 32)).toEqual({ cx: 1, cy: 1 })
  })
})

describe('chunksTouched', () => {
  it('a 1x3 bridge spanning x 31 to 33 touches both chunks', () => {
    expect(chunksTouched([{ x: 31, y: 0 }, { x: 32, y: 0 }, { x: 33, y: 0 }])).toEqual(['0,0', '1,0'])
  })
  it('dedupes and sorts', () => {
    expect(chunksTouched([{ x: 40, y: 40 }, { x: 0, y: 0 }, { x: 41, y: 41 }]))
      .toEqual(['0,0', '1,1'])
  })
  it('is empty for no coordinates', () => {
    expect(chunksTouched([])).toEqual([])
  })
})
