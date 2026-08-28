import { describe, expect, it } from 'vitest'
import {
  CONSTRUCT_TYPES,
  ConstructRecordSchema,
  ConstructRowSchema,
  ConstructsResponseSchema,
  type ConstructRecord,
} from './constructSchema.js'

const row = {
  id: 'construct_21_20',
  type: 'festival',
  name: 'Long Table',
  name_provenance: '{"eventSeq":9,"quote":"we call it the Long Table","byId":"bex"}',
  anchor: '{"x":21,"y":20}',
  participants: '["ada","bex","cass"]',
  first_tick: 1200,
  recurrences: '[{"tick":2640,"participants":["ada","bex"]}]',
}

const record: ConstructRecord = {
  id: 'construct_21_20',
  type: 'festival',
  name: 'Long Table',
  members: ['ada', 'bex', 'cass'],
  firstDay: 0,
  gatherings: 2,
  anchor: { x: 21, y: 20 },
  quote: 'we call it the Long Table',
  saidBy: 'bex',
}

describe('ConstructRowSchema', () => {
  it('reads a registry row back whole, JSON columns still text', () => {
    expect(ConstructRowSchema.parse(row)).toEqual(row)
  })

  it('accepts a gathering with no name and no ground', () => {
    const bare = ConstructRowSchema.parse({
      ...row,
      name: null,
      name_provenance: null,
      anchor: null,
    })
    expect(bare.name).toBeNull()
    expect(bare.anchor).toBeNull()
  })

  it('falls a type nobody has a word for back to custom rather than dropping the row', () => {
    expect(ConstructRowSchema.parse({ ...row, type: 'parliament' }).type).toBe('custom')
  })

  it('refuses a negative tick and a nameless id', () => {
    expect(ConstructRowSchema.safeParse({ ...row, first_tick: -1 }).success).toBe(false)
    expect(ConstructRowSchema.safeParse({ ...row, id: '' }).success).toBe(false)
  })
})

describe('ConstructRecordSchema', () => {
  it('round-trips what the route serves', () => {
    expect(ConstructRecordSchema.parse(record)).toEqual(record)
  })

  it('refuses a stray field, a zero gathering count and a type off the taxonomy', () => {
    expect(ConstructRecordSchema.safeParse({ ...record, extra: 1 }).success).toBe(false)
    expect(ConstructRecordSchema.safeParse({ ...record, gatherings: 0 }).success).toBe(false)
    expect(ConstructRecordSchema.safeParse({ ...record, type: 'parliament' }).success).toBe(false)
  })

  it('carries every kind the recognizer may name', () => {
    for (const type of CONSTRUCT_TYPES)
      expect(ConstructRecordSchema.safeParse({ ...record, type }).success).toBe(true)
  })
})

describe('ConstructsResponseSchema', () => {
  it('is a bare array — a town that keeps nothing serves an empty one, an object is refused', () => {
    expect(ConstructsResponseSchema.parse([record])).toHaveLength(1)
    expect(ConstructsResponseSchema.parse([])).toEqual([])
    expect(ConstructsResponseSchema.safeParse({ constructs: [] }).success).toBe(false)
  })
})
