import { describe, it, expect } from 'vitest'
import { DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { composePerception } from './perception.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStream } from './rng.js'
import { VERBS } from './verbs.js'

// Inscription is `write` on a surface nobody can carry away: the town's first
// public text. Any completed structure takes it, and the last hand wins.

const RNG = RngStream.seed('inscribe-test', 'actions')
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const MAP = (): TileId[][] => Array.from({ length: 24 }, () => Array.from({ length: 24 }, (): TileId => 0))

// A 2x2 structure at (2,1); its door is the tile south of centre, (2,3).
function world(kind = 'house', stage: 'construction' | 'complete' = 'complete'): WorldState {
  let s = genesisState(DEFAULT_CONFIG, MAP())
  s = fold(s, ev('structure_planned', {
    id: 'structure_1', kind, x: 2, y: 1, w: 2, h: 2, maxHp: 20, flammable: true, builderId: 'a1',
  }))
  if (stage === 'complete') s = fold(s, ev('structure_completed', { id: 'structure_1' }))
  return s
}

// Noon: the witness radius scales with the light on the thing looked at, and
// ten paces at midnight is past it. What is carved is not about the dark.
const withCarver = (s: WorldState, x: number, y: number): WorldState =>
  ({ ...fold(s, ev('agent_spawned', { id: 'a1', name: 'Rahel', x, y, ageDays: 7300 })), tick: 720 })

const goInside = (s: WorldState): WorldState =>
  fold(fold(s, ev('agent_moved', { id: 'a1', x: 2, y: 3 })), ev('agent_entered', { agentId: 'a1', structureId: 'structure_1' }))

const apply = (s: WorldState, params: Record<string, unknown>): WorldState =>
  VERBS.inscribe!.onComplete(s, DEFAULT_CONFIG, 'a1', params, RNG)
    .reduce((acc, e) => fold(acc, ev(e.type, e.payload)), s)

describe('verb: inscribe', () => {
  it('is a registered verb that takes three ticks — a deliberate act', () => {
    expect(VERBS.inscribe).toBeDefined()
    expect(VERBS.inscribe!.duration(world(), DEFAULT_CONFIG, 'a1', {})).toBe(3)
  })

  it('carves a house wall from just outside it', () => {
    const s = withCarver(world(), 4, 2)
    const params = { structureId: 'structure_1', text: 'here we kept the winter out' }
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', params).ok).toBe(true)
    expect(apply(s, params).structures.structure_1!.inscription)
      .toEqual({ text: 'here we kept the winter out', by: 'a1' })
  })

  it('carves it from inside too', () => {
    const s = goInside(withCarver(world(), 2, 4))
    const params = { structureId: 'structure_1', text: 'the fire goes here' }
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', params).ok).toBe(true)
    expect(apply(s, params).structures.structure_1!.inscription!.text).toBe('the fire goes here')
  })

  it('carves the standing stone — if they mark it, that is their culture', () => {
    const s = withCarver(world('standing_stone'), 4, 2)
    const params = { structureId: 'structure_1', text: 'we came from the river' }
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', params).ok).toBe(true)
    expect(apply(s, params).structures.structure_1!.inscription!.text).toBe('we came from the river')
  })

  it('overwriting keeps only the latest in state; the log keeps the palimpsest', () => {
    const s = withCarver(world(), 4, 2)
    const first = ev('structure_inscribed', { structureId: 'structure_1', text: 'first', agentId: 'a1' })
    const second = ev('structure_inscribed', { structureId: 'structure_1', text: 'second', agentId: 'a2' })
    const after = fold(fold(s, first), second)
    expect(after.structures.structure_1!.inscription).toEqual({ text: 'second', by: 'a2' })
    expect([first, second].map((e) => (e.payload as { text: string }).text)).toEqual(['first', 'second'])
  })

  it('refuses an unfinished building, an absent one, and a wall out of reach', () => {
    const text = 'anything'
    expect(submitIntent(withCarver(world('house', 'construction'), 4, 2), DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_1', text }))
      .toMatchObject({ ok: false, reason: 'it is not finished' })
    expect(submitIntent(withCarver(world(), 4, 2), DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'ghost', text }))
      .toMatchObject({ ok: false, reason: 'there is nothing there to mark' })
    expect(submitIntent(withCarver(world(), 9, 9), DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_1', text }))
      .toMatchObject({ ok: false, reason: 'not close enough to mark it' })
  })

  it('refuses empty text and anything past 280 characters', () => {
    const s = withCarver(world(), 4, 2)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_1', text: '' }))
      .toMatchObject({ ok: false, reason: 'inscribe needs {structureId, text} of 1 to 280 characters' })
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_1', text: 'x'.repeat(281) }))
      .toMatchObject({ ok: false, reason: 'inscribe needs {structureId, text} of 1 to 280 characters' })
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_1', text: 'x'.repeat(280) }).ok).toBe(true)
  })

  it('a wall stops the chisel — indoors you can only mark the room you are in', () => {
    let s = withCarver(world(), 2, 4)
    s = fold(s, ev('structure_planned', {
      id: 'structure_2', kind: 'house', x: 8, y: 1, w: 1, h: 1, maxHp: 20, flammable: true, builderId: 'a1',
    }))
    s = fold(s, ev('structure_completed', { id: 'structure_2' }))
    s = goInside(s)
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'inscribe', { structureId: 'structure_2', text: 'no' }))
      .toMatchObject({ ok: false, reason: 'a wall is in the way' })
  })

  it('the fold throws for a structure that is not there', () => {
    expect(() => fold(world(), ev('structure_inscribed', { structureId: 'ghost', text: 'x', agentId: 'a1' })))
      .toThrow(/unknown structure ghost/)
  })
})

describe('perception: inscriptions', () => {
  const inscribed = (): WorldState =>
    fold(world(), ev('structure_inscribed', { structureId: 'structure_1', text: 'the ford', agentId: 'a1' }))

  it('at arm’s length you read the words', () => {
    const s = withCarver(inscribed(), 4, 2)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.structures[0]!
    expect(seen.hasInscription).toBe(true)
    expect(seen.inscription).toEqual({ text: 'the ford', by: 'a1' })
  })

  it('from inside you read them too', () => {
    const s = goInside(withCarver(inscribed(), 2, 4))
    expect(composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.structures[0]!.inscription)
      .toEqual({ text: 'the ford', by: 'a1' })
  })

  it('at ten paces you see only that something is written there', () => {
    const s = withCarver(inscribed(), 12, 5)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.structures[0]!
    expect(seen.hasInscription).toBe(true)
    expect(seen.inscription).toBeUndefined()
  })

  it('an unmarked wall carries neither field, so a plain world reads as it always did', () => {
    const s = withCarver(world(), 4, 2)
    const seen = composePerception(s, DEFAULT_CONFIG, 'a1', []).visible.structures[0]!
    expect(seen.hasInscription).toBeUndefined()
    expect(seen.inscription).toBeUndefined()
  })
})
