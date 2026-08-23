import { describe, expect, it } from 'vitest'
import { EventStore, openDb } from '@sj/engine'
import { openAgentDb } from '../memory/schema.js'
import { MemoryStore } from '../memory/store.js'
import { FakeEmbedder } from '../testutil/fakeEmbedder.js'
import { buildHouseholdSeed } from './memorySeed.js'
import { FORBIDDEN_FRAMING } from '../prompt/rulesOfBeing.js'

const CHILD = 'agent_7'
const MOTHER = 'amara'
const FATHER = 'yusuf'
const HOME = 'structure_1'
const STRANGER = 'nadia'

function seedWorld(): EventStore {
  const store = new EventStore(openDb(':memory:'))
  let tick = 0
  const at = (t: number, type: string, payload: unknown) => {
    tick = t
    store.append(t, type, payload)
  }
  at(10, 'structure_planned', {
    id: HOME, kind: 'house', x: 4, y: 4, w: 2, h: 2, maxHp: 40, flammable: true, builderId: FATHER, owner: FATHER,
  })
  at(20, 'structure_completed', { id: HOME })
  at(25, 'structure_inscribed', { structureId: HOME, text: 'we raised this in the rain', agentId: MOTHER })
  at(30, 'agent_spoke', { agentId: MOTHER, text: 'The seed is in the ground.', x: 4, y: 5 })
  at(31, 'agent_spoke', { agentId: STRANGER, text: 'None of your business.', x: 20, y: 20 })
  at(40, 'item_spawned', { id: 'item_3', kind: 'wheat', qty: 2, loc: { t: 'agent', id: MOTHER }, owner: MOTHER })
  at(41, 'item_spawned', { id: 'item_4', kind: 'fish', qty: 1, loc: { t: 'agent', id: STRANGER }, owner: STRANGER })
  at(50, 'item_moved', { id: 'item_3', loc: { t: 'structure', id: HOME } })
  at(60, 'item_taken', { itemId: 'item_3', kind: 'wheat', takerId: STRANGER, ownerId: MOTHER, x: 4, y: 4 })
  at(70, 'agent_born', { id: CHILD, name: 'Mira', sex: 'f', motherId: MOTHER, fatherId: FATHER, x: 4, y: 4 })
  at(80, 'agent_spoke', { agentId: FATHER, text: 'She has her mother’s hands.', x: 4, y: 4 })
  void tick
  return store
}

const OPTS = { childId: CHILD, motherId: MOTHER, fatherId: FATHER, homeStructureId: HOME, upToTick: 100 }

describe('buildHouseholdSeed (T25)', () => {
  it('every entry traces to a real event id in the log', () => {
    const store = seedWorld()
    const seed = buildHouseholdSeed(store, OPTS)
    const seqs = new Set(store.readFrom(0).map((e) => e.seq))

    expect(seed.length).toBeGreaterThan(0)
    for (const entry of seed) {
      const refs = entry.tags.filter((t) => t.startsWith('event:'))
      expect(refs).toHaveLength(1)
      expect(seqs.has(Number(refs[0]!.slice('event:'.length)))).toBe(true)
      expect(entry.importance).toBeGreaterThanOrEqual(1)
      expect(entry.importance).toBeLessThanOrEqual(10)
      expect(entry.text).not.toMatch(FORBIDDEN_FRAMING)
    }
  })

  it('keeps the household and the parents, and drops a stranger’s private business', () => {
    const seed = buildHouseholdSeed(seedWorld(), OPTS)
    const all = seed.map((s) => s.text).join('\n')

    expect(all).toContain('The seed is in the ground.')
    expect(all).toContain('we raised this in the rain')
    expect(all).toContain('She has her mother’s hands.')
    expect(all).toContain('You were born')
    // Nothing that happened across town to people who are not the household.
    expect(all).not.toContain('None of your business.')
    expect(all).not.toContain('fish')
  })

  it('is phrased second-hand: never in a parent’s own first person', () => {
    const seed = buildHouseholdSeed(seedWorld(), OPTS)
    for (const entry of seed) {
      expect(entry.text).not.toMatch(/^I\b/)
      expect(entry.tags).toContain('household')
    }
    expect(seed.some((s) => s.tags.includes('mother'))).toBe(true)
    expect(seed.some((s) => s.tags.includes('father'))).toBe(true)
  })

  it('NEVER quotes a parent’s private memory store — the trap', async () => {
    const store = seedWorld()
    const parentDb = openAgentDb(':memory:')
    const parentMem = new MemoryStore(parentDb, MOTHER, await FakeEmbedder.create())
    const SECRET = 'I have never told anyone that I hid the last of the seed corn.'
    await parentMem.insertMemory({ tick: 35, kind: 'journal', text: SECRET, importance: 9, tags: { people: [], place: 'house', objects: [], topics: [] } })

    const seed = buildHouseholdSeed(store, OPTS)
    for (const entry of seed) expect(entry.text).not.toContain('hid the last of the seed corn')
    expect(seed.map((s) => s.text).join('\n')).not.toContain(SECRET)
  })

  it('respects upToTick and max, newest kept', () => {
    const store = seedWorld()
    const early = buildHouseholdSeed(store, { ...OPTS, upToTick: 25 })
    expect(early.map((s) => s.text).join('\n')).not.toContain('The seed is in the ground.')
    expect(early.map((s) => s.text).join('\n')).toContain('we raised this in the rain')

    const capped = buildHouseholdSeed(store, { ...OPTS, max: 2 })
    expect(capped).toHaveLength(2)
    expect(capped[capped.length - 1]!.text).toContain('mother’s hands')
  })

  it('a household with no recorded past seeds nothing rather than inventing one', () => {
    const empty = new EventStore(openDb(':memory:'))
    expect(buildHouseholdSeed(empty, OPTS)).toEqual([])
  })
})
