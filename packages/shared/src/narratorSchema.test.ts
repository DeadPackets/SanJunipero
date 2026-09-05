import { describe, expect, it } from 'vitest'
import { milestoneFromRow, type MilestoneRow } from './narratorSchema.js'

const row = (over: Partial<MilestoneRow> = {}): MilestoneRow => ({
  kind: 'first_death',
  label: 'The first death',
  event_seq: 9000,
  day: 0,
  tick: 50,
  tier: '3',
  domain: 'ritual',
  agent_ids: '["alice","bob"]',
  construct_id: null,
  name_provenance: null,
  ...over,
})

describe('milestoneFromRow', () => {
  it('parses the JSON columns and the TEXT tier', () => {
    expect(milestoneFromRow(row())).toEqual({
      kind: 'first_death',
      label: 'The first death',
      eventSeq: 9000,
      day: 0,
      tick: 50,
      tier: 3,
      domain: 'ritual',
      agentIds: ['alice', 'bob'],
      nameProvenance: null,
    })
  })

  // ★ The wire carried the construct taxonomy, the construct's raw id, and the raw id of
  // whoever gave it its name.
  it('★ serves no word for the machinery and no id of any kind', () => {
    const served = milestoneFromRow(
      row({
        kind: 'first_name_structure_fire_pit_39_39',
        construct_id: 'structure_fire_pit_39_39',
        name_provenance: JSON.stringify({
          name: 'the Long Sit',
          sourceKind: 'speech',
          eventSeq: 8999,
          quote: 'we should call it the Long Sit',
          byId: 'alice',
        }),
      }),
    )
    expect(JSON.stringify(served)).not.toContain('structure_fire_pit_39_39')
    expect(served).not.toHaveProperty('constructId')
    expect(served.nameProvenance).toEqual({
      name: 'the Long Sit',
      sourceKind: 'speech',
      eventSeq: 8999,
      quote: 'we should call it the Long Sit',
    })
    for (const type of ['festival', 'faith', 'council', 'market', 'custom'])
      expect(milestoneFromRow(row({ kind: `first_${type}` })).kind, type).not.toContain(type)
  })

  it('★ and still gives every first a key of its own', () => {
    const kinds = ['festival', 'faith', 'council', 'market', 'custom'].map(
      (t) => milestoneFromRow(row({ kind: `first_${t}` })).kind,
    )
    expect(new Set(kinds).size).toBe(kinds.length)
  })
})
