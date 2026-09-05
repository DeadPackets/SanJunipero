import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { strictSchemaFaults } from './strictSchema.js'

describe('strictSchemaFaults', () => {
  it('passes a flat closed object with every key required and nullable in place of optional', () => {
    const s = z.object({ a: z.string(), b: z.number().nullable(), c: z.array(z.string()) }).strict()
    expect(strictSchemaFaults(s)).toEqual([])
  })

  it('names an optional key, an open object and a oneOf, with the path', () => {
    expect(strictSchemaFaults(z.object({ a: z.string().optional() }))).toEqual(['root: optional a'])
    expect(strictSchemaFaults(z.looseObject({ a: z.string() }))).toEqual(['root: open object'])
    const union = z.discriminatedUnion('k', [
      z.object({ k: z.literal('x') }).strict(),
      z.object({ k: z.literal('y') }).strict(),
    ])
    expect(strictSchemaFaults(union)).toContain('root: oneOf')
    const nested = z
      .object({ hits: z.array(z.object({ q: z.string().optional() }).strict()) })
      .strict()
    expect(strictSchemaFaults(nested)).toEqual(['root.hits.items: optional q'])
  })
})
