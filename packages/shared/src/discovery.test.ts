import { describe, expect, it } from 'vitest'
import {
  DISCOVERY_EVENT,
  DiscoveryRecordSchema,
  DiscoveryResponseSchema,
  discoveryHeadline,
} from './discovery.js'

const ROW = {
  seq: 12,
  tick: 3600,
  recipeId: 'recipe:waterskin',
  name: 'stitch a waterskin',
  kind: 'craft' as const,
  byId: 'a1',
  by: 'Maret',
  intent: 'i want to try carrying water in a stitched hide',
  makes: ['waterskin'],
}

describe('the discovery record', () => {
  it('names the event type once, for every plane', () => {
    expect(DISCOVERY_EVENT).toBe('discovery_made')
  })

  it('accepts a whole row and refuses a row missing its credit', () => {
    expect(DiscoveryRecordSchema.parse(ROW)).toEqual(ROW)
    const { byId: _byId, ...noCredit } = ROW
    expect(DiscoveryRecordSchema.safeParse(noCredit).success).toBe(false)
  })

  it('refuses an unknown field rather than carrying it to the viewer', () => {
    expect(DiscoveryRecordSchema.safeParse({ ...ROW, verdictJson: '{}' }).success).toBe(false)
  })

  it('lets a word carry no products, and a craft carry several', () => {
    expect(DiscoveryRecordSchema.parse({ ...ROW, kind: 'word', makes: [] }).makes).toEqual([])
    expect(
      DiscoveryRecordSchema.parse({ ...ROW, makes: ['waterskin', 'cord'] }).makes,
    ).toHaveLength(2)
  })

  it('wraps a list of rows', () => {
    expect(DiscoveryResponseSchema.parse({ discoveries: [ROW] }).discoveries).toHaveLength(1)
  })

  it('gives a craft and a word different headlines, and neither quotes the intent', () => {
    const craft = discoveryHeadline({ kind: 'craft', name: 'stitch a waterskin', by: 'Maret' })
    const word = discoveryHeadline({ kind: 'word', name: 'dance', by: 'Maret' })
    expect(craft).toBe('Maret worked out stitch a waterskin')
    expect(word).toBe('Maret found a word: dance')
    for (const line of [craft, word]) expect(line).not.toContain('carrying water')
  })
})
