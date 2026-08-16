import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { SimEvent } from '@sj/shared'
import type { SceneSegment } from './types.js'
import { DEFAULT_DETECT_CONFIG, detectInstitutions } from './institutions.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({ seq, tick, type, payload })
const act = (seq: number, tick: number, agentId: string, verb: string): SimEvent =>
  ev(seq, tick, 'action_completed', { agentId, verb })

const scene = (day: number, eventIds: number[], cast: string[]): SceneSegment => ({
  day, startTick: day * 1440, endTick: day * 1440 + 100, eventIds, cast, location: null,
})

// omar+yusuf co-appear in 4 scenes (>= groupMinCoScenes 3); nadia appears alone.
const scenes: SceneSegment[] = [
  scene(0, [1, 2], ['omar', 'yusuf']),
  scene(0, [3, 4], ['omar', 'yusuf']),
  scene(1, [5, 6], ['omar', 'yusuf']),
  scene(2, [7, 8, 9, 10, 11, 12], ['omar', 'yusuf']),
  scene(2, [13], ['nadia']),
]

// omar tends 3x (role); omar+yusuf fish 5x total (rule: 2 agents, 5 actions).
const events: SimEvent[] = [
  act(1, 0, 'omar', 'tend'),
  act(2, 1, 'omar', 'fish'),
  act(3, 10, 'omar', 'tend'),
  ev(4, 11, 'agent_moved', { id: 'yusuf', x: 1, y: 1 }),
  act(5, 1440, 'omar', 'tend'),
  ev(6, 1441, 'agent_moved', { id: 'omar', x: 2, y: 2 }),
  act(7, 2880, 'omar', 'fish'),
  act(8, 2881, 'omar', 'fish'),
  act(9, 2882, 'yusuf', 'fish'),
  act(10, 2883, 'yusuf', 'fish'),
  ev(11, 2884, 'agent_moved', { id: 'omar', x: 3, y: 3 }),
  ev(12, 2885, 'agent_moved', { id: 'yusuf', x: 3, y: 4 }),
  ev(13, 2900, 'agent_moved', { id: 'nadia', x: 9, y: 9 }),
]

describe('detectInstitutions', () => {
  const out = detectInstitutions(scenes, events)

  it('emits the caretaker role for omar with the 3 tend seqs', () => {
    const role = out.find((i) => i.kind === 'role' && i.name === 'the caretaker')
    expect(role).toBeDefined()
    expect(role!.memberIds).toEqual(['omar'])
    expect(role!.sourceEventIds).toEqual([1, 3, 5])
    expect(role!.foundingSceneId).toBe(0) // scene of the first tend
  })

  it('emits the omar & yusuf group, excluding nadia', () => {
    const group = out.find((i) => i.kind === 'group')
    expect(group).toBeDefined()
    expect(group!.memberIds).toEqual(['omar', 'yusuf']) // sorted
    expect(group!.name).toBe('omar & yusuf')
    expect(group!.foundingSceneId).toBe(0) // earliest shared scene
    expect(group!.sourceEventIds).toEqual([1, 2]) // founding scene's eventIds
  })

  it('emits the people-fish rule with 2 members and 5 source events', () => {
    const rule = out.find((i) => i.kind === 'rule')
    expect(rule).toBeDefined()
    expect(rule!.name).toBe('people fish')
    expect(rule!.memberIds).toEqual(['omar', 'yusuf'])
    expect(rule!.sourceEventIds).toEqual([2, 7, 8, 9, 10])
    expect(rule!.foundingSceneId).toBe(0) // scene of the first fish (seq 2)
  })

  it('nadia gets no role and no group; tend is not a rule (one agent)', () => {
    expect(out.some((i) => i.memberIds.includes('nadia'))).toBe(false)
    expect(out.some((i) => i.kind === 'rule' && i.name === 'people tend')).toBe(false)
  })

  it('give is excluded from rules (a trade first, not a norm)', () => {
    const gives = [1, 2, 3, 4].map((n) => act(n, n, n % 2 ? 'omar' : 'yusuf', 'give'))
    const giveScenes = [scene(0, [1, 2, 3, 4], ['omar', 'yusuf'])]
    expect(detectInstitutions(giveScenes, gives, DEFAULT_DETECT_CONFIG).filter((i) => i.kind === 'rule')).toEqual([])
  })

  it('persists via NarratorStore round-trip', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    for (const i of out) store.insertInstitution(i)
    const got = store.institutions()
    expect(got).toHaveLength(out.length)
    expect(got.map(({ id: _id, ...rest }) => rest)).toEqual(out)
  })
})
