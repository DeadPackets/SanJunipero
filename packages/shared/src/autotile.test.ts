import { describe, it, expect } from 'vitest'
import {
  ROAD_AUTOTILE_CODEX_PREFIX, ROAD_AUTOTILE_KEYS, RoadAutotileKeySchema, roadAutotile,
  roadAutotileKind, type RoadNeighbors,
} from './autotile.js'

const F = false, T = true
// 16 explicit rows — the expectation is authored, never computed from the implementation.
const TABLE: Array<[RoadNeighbors, string]> = [
  [{ n: F, e: F, s: F, w: F }, 'cap-s'],        // isolated (deviation 3)
  [{ n: T, e: F, s: F, w: F }, 'cap-n'],
  [{ n: F, e: T, s: F, w: F }, 'cap-e'],
  [{ n: T, e: T, s: F, w: F }, 'corner-ne'],
  [{ n: F, e: F, s: T, w: F }, 'cap-s'],
  [{ n: T, e: F, s: T, w: F }, 'straight-ns'],
  [{ n: F, e: T, s: T, w: F }, 'corner-es'],
  [{ n: T, e: T, s: T, w: F }, 't-no-w'],
  [{ n: F, e: F, s: F, w: T }, 'cap-w'],
  [{ n: T, e: F, s: F, w: T }, 'corner-wn'],
  [{ n: F, e: T, s: F, w: T }, 'straight-ew'],
  [{ n: T, e: T, s: F, w: T }, 't-no-s'],
  [{ n: F, e: F, s: T, w: T }, 'corner-sw'],
  [{ n: T, e: F, s: T, w: T }, 't-no-e'],
  [{ n: F, e: T, s: T, w: T }, 't-no-n'],
  [{ n: T, e: T, s: T, w: T }, 'cross'],
]

describe('ROAD_AUTOTILE_KEYS', () => {
  it('holds exactly 15 distinct keys', () => {
    expect(ROAD_AUTOTILE_KEYS).toHaveLength(15)
    expect(new Set(ROAD_AUTOTILE_KEYS).size).toBe(15)
  })
  it('parses through the schema and rejects an invented key', () => {
    expect(RoadAutotileKeySchema.parse('cap-s')).toBe('cap-s')
    expect(() => RoadAutotileKeySchema.parse('cap-x')).toThrow()
    for (const k of ROAD_AUTOTILE_KEYS) expect(RoadAutotileKeySchema.parse(k)).toBe(k)
  })
})

describe('roadAutotileKind', () => {
  it('gives all 15 keys a distinct prefixed codex kind', () => {
    const kinds = ROAD_AUTOTILE_KEYS.map(roadAutotileKind)
    expect(new Set(kinds).size).toBe(15)
    expect(kinds.every((k) => k.startsWith(ROAD_AUTOTILE_CODEX_PREFIX))).toBe(true)
    expect(roadAutotileKind('cross')).toBe('road:cross')
  })

  it('never collides with the flat road kind', () => {
    expect(ROAD_AUTOTILE_KEYS.map(roadAutotileKind)).not.toContain('road')
  })
})

describe('roadAutotile', () => {
  it.each(TABLE)('%j maps to its authored key', (nb, key) => {
    expect(roadAutotile(nb)).toBe(key)
  })

  it('is total and surjective over the 16 combinations', () => {
    const image = new Set(TABLE.map(([nb]) => roadAutotile(nb)))
    expect(image).toEqual(new Set(ROAD_AUTOTILE_KEYS))
    expect(TABLE).toHaveLength(16)
  })

  it('sends the isolated tile to cap-s', () => {
    expect(roadAutotile({ n: F, e: F, s: F, w: F })).toBe('cap-s')
  })

  it('is pure — same input, same output, no module state', () => {
    const nb = { n: T, e: F, s: T, w: T }
    const first = roadAutotile(nb)
    for (const [other] of TABLE) roadAutotile(other)
    expect(roadAutotile(nb)).toBe(first)
    expect(roadAutotile({ ...nb })).toBe(first)
  })
})
