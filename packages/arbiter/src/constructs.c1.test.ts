import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, MINUTES_PER_DAY, type SimEvent } from '@sj/shared'
import type { LlmClient } from '@sj/llm'
import { detectCandidates } from './constructs.js'
import { runConstructPass } from './constructs.js'
import { ConstructStore } from './constructStore.js'
import { openArbiterDb } from './schema.js'
import { ScriptedLlm } from './testutil/scriptedLlm.js'

let seq = 0
const ev = (tick: number, type: string, payload: unknown): SimEvent => ({
  seq: ++seq,
  tick,
  type,
  payload,
})
const at = (day: number, minute: number) => day * MINUTES_PER_DAY + minute
const spawn = () =>
  ['a', 'b', 'c'].map((id, i) => ev(0, 'agent_spawned', { id, name: id, x: 60 + i, y: 60 }))
const move = (tick: number, id: string, x: number, y: number) =>
  ev(tick, 'agent_moved', { id, x, y })
const visit = (day: number, minute = 360): SimEvent[] => [
  move(at(day, minute), 'a', 10, 10),
  move(at(day, minute), 'b', 11, 10),
  move(at(day, minute), 'c', 12, 10),
  ev(at(day, minute + 1), 'agent_expressed', { agentId: 'a', verb: 'dance', x: 10, y: 10 }),
  move(at(day, minute + 2), 'a', 60, 60),
  move(at(day, minute + 2), 'b', 61, 60),
  move(at(day, minute + 2), 'c', 62, 60),
]

describe('C1 observed gatherings', () => {
  it('rejects the audit visits at 06:00, 10:00 and 14:00 when no bodies overlap', () => {
    const visits = [0, 1, 2].flatMap((i) => [
      move(at(0, 360 + i * 240), ['a', 'b', 'c'][i]!, 10 + i, 10),
      move(at(0, 362 + i * 240), ['a', 'b', 'c'][i]!, 60 + i, 60),
    ])
    expect(detectCandidates([...spawn(), ...visits], DEFAULT_CONFIG)).toEqual([])
  })

  it('accepts three distinct simultaneous visits at the same outdoor place', () => {
    const [candidate] = detectCandidates(
      [...spawn(), ...visit(0), ...visit(1), ...visit(2)],
      DEFAULT_CONFIG,
    )
    expect(candidate?.gatherings.map((g) => g.participants)).toEqual([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ])
    expect(candidate?.signals.expressive).toBe(3)
  })

  it('does not merge distinct rooms in the same footprint', () => {
    const rooms = [0, 1, 2].flatMap((day) => {
      const tick = at(day, 360)
      return [
        ...['a', 'b', 'c'].map((id, i) => move(tick, id, 10 + i, 10)),
        ev(tick, 'agent_entered', { agentId: 'a', structureId: 'house-left' }),
        ev(tick, 'agent_entered', { agentId: 'b', structureId: 'house-left' }),
        ev(tick, 'agent_entered', { agentId: 'c', structureId: 'house-right' }),
        ...['a', 'b', 'c'].map((id) => ev(tick + 1, 'agent_departed', { agentId: id })),
      ]
    })
    expect(detectCandidates([...spawn(), ...rooms], DEFAULT_CONFIG)).toEqual([])
  })

  it('uses a shared room id as the indoor place anchor', () => {
    const rooms = [0, 1, 2].flatMap((day) => {
      const tick = at(day, 360)
      return [
        ...['a', 'b', 'c'].map((id, i) => move(tick, id, 10 + i, 10)),
        ...['a', 'b', 'c'].map((id) =>
          ev(tick + 1, 'agent_entered', { agentId: id, structureId: 'hall' }),
        ),
        ev(tick + 2, 'agent_spoke', { agentId: 'a', text: 'We meet.', x: 10, y: 10 }),
        ...['a', 'b', 'c'].map((id) =>
          ev(tick + 3, 'agent_exited', { agentId: id, structureId: 'hall' }),
        ),
      ]
    })
    expect(detectCandidates([...spawn(), ...rooms], DEFAULT_CONFIG)[0]?.anchor).toBe('hall')
  })

  it('counts a gathering spanning midnight once, then a later return', () => {
    const first = visit(0, MINUTES_PER_DAY - 1).filter(
      (e) => e.type !== 'agent_moved' || e.tick !== MINUTES_PER_DAY + 1,
    )
    const afterMidnight = [
      ev(MINUTES_PER_DAY + 1, 'agent_spoke', { agentId: 'a', text: 'still here', x: 10, y: 10 }),
    ]
    expect(
      detectCandidates([...spawn(), ...first, ...afterMidnight, ...visit(2)], DEFAULT_CONFIG),
    ).toEqual([])
  })

  it('keeps distinct observed uses at one place and does not rewrite a legacy label', async () => {
    const events = [...spawn(), ...visit(0), ...visit(1), ...visit(2)]
    for (const day of [0, 1, 2]) {
      const tick = at(day, 361)
      events.push(ev(tick, 'item_taken', { takerId: 'b', id: `gift-${day}`, x: 11, y: 10 }))
    }
    const candidates = detectCandidates(events, DEFAULT_CONFIG)
    expect(candidates.map((c) => c.use).sort()).toEqual(['expressive', 'goods'])
    const db = openArbiterDb(':memory:')
    const store = new ConstructStore(db)
    const llm = new ScriptedLlm(({ user }) => ({
      rulings: [...user.matchAll(/^- (\S+)/gmu)].map((m) => ({
        key: m[1]!,
        type: m[1]!.includes('goods') ? 'market' : 'festival',
      })),
    }))
    await runConstructPass({
      events,
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: llm as unknown as LlmClient,
    })
    const rows = store.all()
    expect(rows.map((r) => r.type).sort()).toEqual(['festival', 'market'])
    await runConstructPass({
      events,
      baseConfig: DEFAULT_CONFIG,
      store,
      llm: llm as unknown as LlmClient,
    })
    expect(
      store
        .all()
        .map((r) => r.type)
        .sort(),
    ).toEqual(['festival', 'market'])
    expect(llm.objectCalls).toBe(1)
    db.close()
  })

  it('accepts recorded scene participation when movement samples do not overlap', () => {
    const scenes = [0, 1, 2].flatMap((day) => {
      const tick = at(day, 600)
      const id = `scene-${day}`
      return [
        ev(tick, 'scene_opened', {
          id,
          kind: 'gathering',
          participants: ['a', 'b', 'c'],
          topic: null,
          stakes: 1,
        }),
        ev(tick + 1, 'scene_line', { id, agentId: 'a', text: 'We meet.', move: 'tell' }),
        ev(tick + 2, 'scene_closed', {
          id,
          summary: 'They part.',
          deltas: [],
          closeReason: 'ended',
        }),
      ]
    })
    const [candidate] = detectCandidates([...spawn(), ...scenes], DEFAULT_CONFIG)
    expect(candidate?.participants).toEqual(['a', 'b', 'c'])
    expect(candidate?.gatherings).toHaveLength(3)
  })
})
