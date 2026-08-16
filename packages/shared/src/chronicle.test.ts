import { describe, expect, it } from 'vitest'
import {
  CHRONICLE_FALLBACK_ICON, CHRONICLE_ICONS, CHRONICLE_TYPES, CHRONICLE_WEIGHTS,
  ChronicleEntrySchema, ChronicleResponseSchema, chronicleIcon, chronicleLine,
  type ChronicleLookup,
} from './chronicle.js'
import type { SimEvent } from './events.js'

const NAMES: Record<string, string> = { a1: 'Rahel', a2: 'Tomas' }
const KINDS: Record<string, string> = { s1: 'hut', s2: 'storehouse' }
const look: ChronicleLookup = {
  agentName: (id) => NAMES[id] ?? id,
  structureKind: (id) => KINDS[id] ?? 'building',
  mysteryProse: (kind) => (kind === 'far_bell' ? 'A bell rings once, very far off.' : null),
}

const ev = (type: string, payload: unknown, tick = 5, seq = 1): SimEvent => ({ seq, tick, type, payload })

describe('the chronicle weight and icon tables', () => {
  it('gives every weighted type an icon and weighs every iconed type', () => {
    expect(Object.keys(CHRONICLE_WEIGHTS).sort()).toEqual(Object.keys(CHRONICLE_ICONS).sort())
  })

  it('exports the weighted types as the list the event scan selects on', () => {
    expect([...CHRONICLE_TYPES].sort()).toEqual(Object.keys(CHRONICLE_WEIGHTS).sort())
  })

  it('weights a death above a birth above a night kept, and every weight above zero', () => {
    expect(CHRONICLE_WEIGHTS.agent_died!).toBeGreaterThan(CHRONICLE_WEIGHTS.agent_born!)
    expect(CHRONICLE_WEIGHTS.agent_born!).toBeGreaterThan(CHRONICLE_WEIGHTS.co_slept!)
    for (const [type, w] of Object.entries(CHRONICLE_WEIGHTS)) expect(w, type).toBeGreaterThan(0)
  })

  it('falls back to one icon rather than rendering nothing for a future type', () => {
    expect(chronicleIcon('agent_died')).toBe('cross')
    expect(chronicleIcon('some_future_event')).toBe(CHRONICLE_FALLBACK_ICON)
  })
})

describe('ChronicleEntrySchema', () => {
  const entry = { seq: 3, tick: 0, type: 'agent_died', icon: 'cross', label: 'Rahel has died (hunger).' }

  it('round-trips a well-formed entry', () => {
    expect(ChronicleEntrySchema.parse(entry)).toEqual(entry)
    expect(ChronicleResponseSchema.parse({ entries: [entry] }).entries).toHaveLength(1)
  })

  it('refuses a stray field, an empty label and a negative tick', () => {
    expect(ChronicleEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, label: '' }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, tick: -1 }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, seq: 0 }).success).toBe(false)
  })
})

describe('chronicleLine', () => {
  it('writes a death, a birth and a night kept as the town would tell them', () => {
    expect(chronicleLine(ev('agent_died', { agentId: 'a1', cause: 'hunger' }), look))
      .toBe('Rahel has died (hunger).')
    expect(chronicleLine(ev('agent_born', { id: 'a3', name: 'Mira', motherId: 'a1', fatherId: 'a2' }), look))
      .toBe('Mira was born.')
    expect(chronicleLine(ev('co_slept', { aId: 'a1', bId: 'a2', day: 3 }), look))
      .toBe('Rahel and Tomas kept house together.')
  })

  it('writes the buildings — finished, burning, spreading, inscribed', () => {
    expect(chronicleLine(ev('structure_completed', { id: 's1' }), look)).toBe('The hut is finished.')
    expect(chronicleLine(ev('fire_ignited', { structureId: 's1', cause: 'hearth' }), look))
      .toBe('Fire! The hut is burning.')
    expect(chronicleLine(ev('fire_spread', { fromId: 's1', toId: 's2' }), look))
      .toBe('The fire has spread to the storehouse.')
    expect(chronicleLine(ev('structure_inscribed', { structureId: 's2', text: 'ours', agentId: 'a1' }), look))
      .toBe('New words carved on the storehouse.')
  })

  it('names an unknown id rather than inventing a person or a building', () => {
    expect(chronicleLine(ev('agent_died', { agentId: 'ghost', cause: 'cold' }), look))
      .toBe('ghost has died (cold).')
    expect(chronicleLine(ev('structure_completed', { id: 'gone' }), look)).toBe('The building is finished.')
  })

  it('tells a mystery in the authored prose, and says nothing when the prose is out of reach', () => {
    expect(chronicleLine(ev('mystery_event', { kind: 'far_bell' }), look))
      .toBe('A bell rings once, very far off.')
    expect(chronicleLine(ev('mystery_event', { kind: 'unheard_of' }), look)).toBeNull()
  })

  it('says nothing about a type it has no words for', () => {
    for (const type of ['tick_advanced', 'agent_moved', 'need_changed', 'some_future_event']) {
      expect(chronicleLine(ev(type, {}), look), type).toBeNull()
    }
  })

  it('never speaks of machinery — no line names a tool, a prompt or a model', () => {
    const lines = [
      chronicleLine(ev('agent_died', { agentId: 'a1', cause: 'hunger' }), look),
      chronicleLine(ev('agent_born', { name: 'Mira' }), look),
      chronicleLine(ev('co_slept', { aId: 'a1', bId: 'a2' }), look),
      chronicleLine(ev('structure_completed', { id: 's1' }), look),
    ]
    for (const l of lines) expect(l).not.toMatch(/\b(ai|llm|model|prompt|token|agent)\b/i)
  })
})
