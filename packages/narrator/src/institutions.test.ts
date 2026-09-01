import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { pastParticiple, type SimEvent, verbPhrase, verbPhrasePast } from '@sj/shared'
import type { SceneSegment } from './types.js'
import { DEFAULT_DETECT_CONFIG, detectInstitutions } from './institutions.js'
import { migrateNarratorTables } from './schema.js'
import { NarratorStore } from './store.js'

const ev = (seq: number, tick: number, type: string, payload: unknown = {}): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})
const act = (seq: number, tick: number, agentId: string, verb: string): SimEvent =>
  ev(seq, tick, 'action_completed', { agentId, verb })

const scene = (day: number, eventIds: number[], cast: string[]): SceneSegment => ({
  day,
  startTick: day * 1440,
  endTick: day * 1440 + 100,
  eventIds,
  cast,
  location: null,
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
  const nameOf = (id: string): string => id[0]!.toUpperCase() + id.slice(1)
  const out = detectInstitutions(scenes, events, DEFAULT_DETECT_CONFIG, nameOf)

  it('emits the caretaker role for omar with the 3 tend seqs', () => {
    const role = out.find((i) => i.kind === 'role' && i.name === 'the caretaker')
    expect(role).toBeDefined()
    expect(role!.memberIds).toEqual(['omar'])
    expect(role!.sourceEventIds).toEqual([1, 3, 5])
    expect(role!.foundingSceneIndex).toBe(0) // scene of the first tend
  })

  it('emits the omar & yusuf group, excluding nadia', () => {
    const group = out.find((i) => i.kind === 'group')
    expect(group).toBeDefined()
    expect(group!.memberIds).toEqual(['omar', 'yusuf']) // sorted
    expect(group!.name).toBe('Omar & Yusuf')
    expect(group!.foundingSceneIndex).toBe(0) // earliest shared scene
    expect(group!.sourceEventIds).toEqual([1, 2]) // founding scene's eventIds
  })

  it('emits the people-fish rule with 2 members and 5 source events', () => {
    const rule = out.find((i) => i.kind === 'rule')
    expect(rule).toBeDefined()
    expect(rule!.name).toBe('people fish')
    expect(rule!.memberIds).toEqual(['omar', 'yusuf'])
    expect(rule!.sourceEventIds).toEqual([2, 7, 8, 9, 10])
    expect(rule!.foundingSceneIndex).toBe(0) // scene of the first fish (seq 2)
  })

  it('nadia gets no role and no group; tend is not a rule (one agent)', () => {
    expect(out.some((i) => i.memberIds.includes('nadia'))).toBe(false)
    expect(out.some((i) => i.kind === 'rule' && i.name === 'people tend')).toBe(false)
  })

  it('give is excluded from rules (a trade first, not a norm)', () => {
    const gives = [1, 2, 3, 4].map((n) => act(n, n, n % 2 ? 'omar' : 'yusuf', 'give'))
    const giveScenes = [scene(0, [1, 2, 3, 4], ['omar', 'yusuf'])]
    expect(
      detectInstitutions(giveScenes, gives, DEFAULT_DETECT_CONFIG).filter((i) => i.kind === 'rule'),
    ).toEqual([])
  })

  it('uses real past tense in descriptions (no "teached"/"builded")', () => {
    const teachBuild: SimEvent[] = [
      act(1, 0, 'omar', 'teach'),
      act(2, 1, 'omar', 'teach'),
      act(3, 2, 'omar', 'teach'),
      act(4, 3, 'yusuf', 'build'),
      act(5, 4, 'yusuf', 'build'),
      act(6, 5, 'yusuf', 'build'),
      act(7, 6, 'nadia', 'forage'),
      act(8, 7, 'nadia', 'forage'),
      act(9, 8, 'nadia', 'forage'),
    ]
    const tbScenes = [scene(0, [1, 2, 3, 4, 5, 6, 7, 8, 9], ['omar', 'yusuf', 'nadia'])]
    const roles = detectInstitutions(tbScenes, teachBuild, DEFAULT_DETECT_CONFIG, nameOf).filter(
      (i) => i.kind === 'role',
    )
    const descs = roles.map((r) => r.description)
    expect(descs).toContain('Omar has taught 3 times')
    expect(descs).toContain('Yusuf has built 3 times')
    expect(descs).toContain('Nadia has foraged 3 times')
    expect(descs.join(' ')).not.toMatch(/teached|builded|foragee?ed/)
  })

  it('persists via NarratorStore round-trip (index mapped to a store id by the caller)', () => {
    const db = new Database(':memory:')
    migrateNarratorTables(db)
    const store = new NarratorStore(db)
    const mapped = out.map(({ foundingSceneIndex, ...rest }) => ({
      ...rest,
      foundingSceneId: foundingSceneIndex + 1,
    }))
    const ids = mapped.map((i) => store.insertInstitution(i))
    const got = store.institutions()
    expect(got).toHaveLength(out.length)
    expect(got).toEqual(mapped.map((i, n) => ({ ...i, id: ids[n] })))
  })
})

// Run D named 9 of 10 institutions with strings like "5 people have taked 21 times".
describe('past participles in institution descriptions', () => {
  it('the four verbs run D broke read as English', () => {
    expect(pastParticiple('take')).toBe('taken')
    expect(pastParticiple('eat')).toBe('eaten')
    expect(pastParticiple('sleep')).toBe('slept')
    expect(pastParticiple('wake')).toBe('woken')
  })

  // Every other irregular the engine can emit as an `action_completed` verb.
  it('covers the engine verbs that are not regular', () => {
    expect(pastParticiple('speak')).toBe('spoken')
    expect(pastParticiple('build')).toBe('built')
    expect(pastParticiple('teach')).toBe('taught')
    expect(pastParticiple('give')).toBe('given')
    expect(pastParticiple('read')).toBe('read')
    expect(pastParticiple('wear')).toBe('worn')
    expect(pastParticiple('write')).toBe('written')
    expect(pastParticiple('drink')).toBe('drunk')
  })

  it('regular verbs still inflect, e-drop and doubling included', () => {
    expect(pastParticiple('fish')).toBe('fished')
    expect(pastParticiple('forage')).toBe('foraged')
    expect(pastParticiple('chop')).toBe('chopped')
    expect(pastParticiple('craft')).toBe('crafted')
    expect(pastParticiple('harvest')).toBe('harvested')
  })

  // Run D: "3 people have express:mourned 7 times". A coined verb is a slug, not a word.
  it('humanizes a coined verb slug instead of leaking the machine id', () => {
    expect(verbPhrasePast('express:mourn')).toBe('mourned')
    expect(verbPhrasePast('recipe:plank')).toBe('made plank')
    expect(verbPhrasePast('dig_channel')).toBe('dug channel')
    expect(verbPhrasePast('fish')).toBe('fished')
  })

  it('the present form names the same slug without a namespace', () => {
    expect(verbPhrase('express:mourn')).toBe('mourn')
    expect(verbPhrase('recipe:plank')).toBe('make plank')
    expect(verbPhrase('dig_channel')).toBe('dig channel')
    expect(verbPhrase('fish')).toBe('fish')
  })

  it('the rule description uses the participle', () => {
    const rule = detectInstitutions(scenes, events).find((i) => i.kind === 'rule')
    expect(rule!.description).toBe('2 people have fished 5 times')
  })
})
