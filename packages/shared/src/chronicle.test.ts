import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CHRONICLE_FALLBACK_ICON, CHRONICLE_ICONS, CHRONICLE_TYPES, CHRONICLE_WEIGHTS,
  ChronicleEntrySchema, ChronicleResponseSchema, FAR_BANK_PHRASE, NOT_CHRONICLED,
  UNNAMED_CONSTRUCT_COPY, chronicleIcon, chronicleLine, constructLine, faunaSightingLine,
  type ChronicleLookup,
} from './chronicle.js'
import type { SimEvent } from './events.js'

const NAMES: Record<string, string> = { a1: 'Rahel', a2: 'Tomas' }
const KINDS: Record<string, string> = { s1: 'house', s2: 'storehouse' }
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
      .toBe('Rahel starved.')
    expect(chronicleLine(ev('agent_born', { id: 'a3', name: 'Mira', motherId: 'a1', fatherId: 'a2' }), look))
      .toBe('Mira was born.')
    expect(chronicleLine(ev('co_slept', { aId: 'a1', bId: 'a2', day: 3 }), look))
      .toBe('Rahel and Tomas kept house together.')
  })

  it('writes the buildings — finished, burning, spreading, inscribed', () => {
    expect(chronicleLine(ev('structure_completed', { id: 's1' }), look)).toBe('The house is finished.')
    expect(chronicleLine(ev('fire_ignited', { structureId: 's1', cause: 'hearth' }), look))
      .toBe('Fire! The house is burning.')
    expect(chronicleLine(ev('fire_spread', { fromId: 's1', toId: 's2' }), look))
      .toBe('The fire has spread to the storehouse.')
    expect(chronicleLine(ev('structure_inscribed', { structureId: 's2', text: 'ours', agentId: 'a1' }), look))
      .toBe('New words carved on the storehouse.')
  })

  it('names an unknown id rather than inventing a person or a building', () => {
    expect(chronicleLine(ev('agent_died', { agentId: 'ghost', cause: 'unrecorded' }), look))
      .toBe('ghost has died.')
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

// The nine ways the engine can name a death (mortality.ts DEATH_CAUSES), each with the
// sentence the town would use. Held here rather than imported: shared sits under the engine.
const DEATH_CAUSES = [
  'injury', 'poison', 'illness', 'fatigue', 'exposure', 'hunger', 'thirst', 'slain', 'old_age',
]

describe('the C11 vocabulary', () => {
  it('covers every event the fold knows — weighted, or silent on purpose', () => {
    const fold = readFileSync(new URL('../../engine/src/fold.ts', import.meta.url), 'utf8')
    const types = [...fold.matchAll(/case '([a-z_]+)':/g)].map((m) => m[1]!)
    expect(types.length).toBeGreaterThan(70)
    for (const type of types) {
      const known = CHRONICLE_WEIGHTS[type] !== undefined || NOT_CHRONICLED.has(type)
      expect(known, `${type} is neither chronicled nor deliberately silent`).toBe(true)
    }
  })

  it('never both weighs and silences the same event', () => {
    for (const type of Object.keys(CHRONICLE_WEIGHTS)) expect(NOT_CHRONICLED.has(type), type).toBe(false)
  })

  it('gives every way of dying its own human sentence', () => {
    const said = DEATH_CAUSES.map((cause) => chronicleLine(ev('agent_died', { agentId: 'a1', cause }), look))
    expect(new Set(said).size).toBe(DEATH_CAUSES.length)
    for (const line of said) {
      expect(line).toMatch(/^Rahel /)
      expect(line).not.toMatch(/[0-9]/)
    }
    expect(chronicleLine(ev('agent_died', { agentId: 'a1', cause: 'exposure' }), look)).toBe('Rahel froze.')
  })

  it('says the body plainly — hurt, ill, poisoned, worse, mending, cared for, buried', () => {
    expect(chronicleLine(ev('agent_harmed', { agentId: 'a1', amount: 12, source: 'attack' }), look))
      .toBe('Rahel was hurt.')
    expect(chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 1 }), look))
      .toBe('Rahel has fallen ill.')
    expect(chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }), look))
      .toBe('Rahel was poisoned.')
    expect(chronicleLine(ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 2 }), look))
      .toBe('Rahel grows worse.')
    expect(chronicleLine(ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), look))
      .toBe('Rahel is on the mend.')
    expect(chronicleLine(ev('agent_tended', { agentId: 'a1', tenderId: 'a2' }), look))
      .toBe('Tomas cared for Rahel.')
    expect(chronicleLine(ev('grave_placed', { id: 'g1', agentId: 'a1', name: 'Rahel', x: 1, y: 1 }), look))
      .toBe('A grave was made for Rahel.')
  })

  it('speaks of the work: a road, a channel, a felled tree, a fire beaten back, a beast taken', () => {
    expect(chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 0, to: 7, reason: 'paved', byId: 'a1' }), look))
      .toBe('Rahel laid a stretch of road.')
    expect(chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 0, to: 2, reason: 'channel', byId: 'a1' }), look))
      .toBe('A channel now carries water to the fields.')
    expect(chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 3, to: 0, reason: 'cleared', byId: 'a1' }), look))
      .toBe('Rahel felled a tree.')
    expect(chronicleLine(ev('fire_extinguished', { structureId: 's1', cause: 'doused', agentId: 'a1' }), look))
      .toBe('Rahel beat back the fire.')
    expect(chronicleLine(ev('fauna_killed', { id: 'f1', kind: 'deer', x: 1, y: 1, byId: 'a1' }), look))
      .toBe('Rahel brought down a deer.')
    expect(chronicleLine(ev('world_grown', { edge: 'n', depth: 4, tiles: [[0]] }), look))
      .toBe('The world is wider than it was.')
  })

  it('keeps the coined word whole, and says how it reached whoever noticed', () => {
    expect(chronicleLine(ev('agent_expressed', { agentId: 'a1', verb: 'dance', x: 1, y: 1, sense: 'sight' }), look))
      .toBe('Rahel was seen to dance.')
    expect(chronicleLine(ev('agent_expressed', { agentId: 'a1', verb: 'sing', x: 1, y: 1, sense: 'sound' }), look))
      .toBe('Rahel was heard to sing.')
    expect(chronicleLine(ev('agent_expressed', { agentId: 'a1', verb: 'mourn', targetId: 'a2', x: 1, y: 1 }), look))
      .toBe('Rahel was seen to mourn for Tomas.')
  })

  it('says nothing at all for the ground wearing, the rain putting a fire out, or a body drinking', () => {
    for (const reason of ['worn', 'overgrown', 'seeded', 'grown', 'tilled']) {
      expect(chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 0, to: 8, reason }), look), reason).toBeNull()
    }
    expect(chronicleLine(ev('fire_extinguished', { structureId: 's1', cause: 'rain' }), look)).toBeNull()
    for (const type of ['agent_drank', 'item_filled', 'fauna_moved', 'forageable_regrown']) {
      expect(chronicleLine(ev(type, {}), look), type).toBeNull()
    }
  })

  it('reads no temperature anywhere — the cold is a cause of death, never a number', () => {
    expect(NOT_CHRONICLED.has('weather_changed')).toBe(true)
    expect(NOT_CHRONICLED.has('need_changed')).toBe(true)
    expect(chronicleLine(ev('weather_changed', { kind: 'snow', temperatureC: -12 }), look)).toBeNull()
  })

  it('phrases a herd on the far bank as seen and not as had', () => {
    expect(faunaSightingLine('deer', true)).toBe(`a deer ${FAR_BANK_PHRASE}`)
    expect(faunaSightingLine('deer', false)).toBe('a deer')
    expect(FAR_BANK_PHRASE).toBe('across the river')
  })

  it('tells a gathering by the name they gave it, or says plainly that they have not', () => {
    expect(constructLine({ name: 'the Long Turning' }))
      .toBe('They have taken to gathering, and they call it the Long Turning.')
    expect(constructLine({ name: null })).toContain(UNNAMED_CONSTRUCT_COPY)
    expect(constructLine({ name: null })).not.toMatch(/festival|council|market|faith/i)
  })

  it('never names the machinery, a stat, or a bare number, in any line it can write', () => {
    const lines = [
      ...DEATH_CAUSES.map((cause) => chronicleLine(ev('agent_died', { agentId: 'a1', cause }), look)),
      chronicleLine(ev('agent_harmed', { agentId: 'a1', amount: 12, source: 'fire' }), look),
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 3 }), look),
      chronicleLine(ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 3 }), look),
      chronicleLine(ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), look),
      chronicleLine(ev('agent_tended', { agentId: 'a1', tenderId: 'a2' }), look),
      chronicleLine(ev('grave_placed', { id: 'g1', agentId: 'a1', name: 'Rahel', x: 1, y: 1 }), look),
      chronicleLine(ev('fire_extinguished', { structureId: 's1', cause: 'doused', agentId: 'a1' }), look),
      chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 0, to: 7, reason: 'paved', byId: 'a1' }), look),
      chronicleLine(ev('world_grown', { edge: 'n', depth: 4, tiles: [[0]] }), look),
      chronicleLine(ev('fauna_killed', { id: 'f1', kind: 'deer', x: 1, y: 1, byId: 'a1' }), look),
      chronicleLine(ev('agent_expressed', { agentId: 'a1', verb: 'dance', x: 1, y: 1 }), look),
      constructLine({ name: null }),
    ]
    for (const line of lines) {
      expect(line).not.toBeNull()
      expect(line).not.toMatch(/\b(hp|severity|affliction|config|tier|roll|construct|milestone)\b/i)
      expect(line).not.toMatch(/[0-9]/)
      expect(line).not.toMatch(/\b(ai|llm|model|prompt|token)\b/i)
    }
  })

  it('gives every new weighted type an icon, and holds the two tables together', () => {
    expect(Object.keys(CHRONICLE_WEIGHTS).sort()).toEqual(Object.keys(CHRONICLE_ICONS).sort())
    expect([...CHRONICLE_TYPES].sort()).toEqual(Object.keys(CHRONICLE_WEIGHTS).sort())
    expect(chronicleIcon('tile_changed')).toBe('road')
    expect(chronicleIcon('never_heard_of_it')).toBe(CHRONICLE_FALLBACK_ICON)
  })
})

describe('a discovery, in the town’s own words', () => {
  const craft = ev('discovery_made', {
    recipeId: 'recipe:waterskin', name: 'stitch a waterskin', kind: 'craft',
    byId: 'a1', intent: 'i want to carry water in a stitched hide', makes: ['waterskin'],
  })
  const word = ev('discovery_made', {
    recipeId: 'express:dance', name: 'dance', kind: 'word',
    byId: 'a1', intent: 'i want to dance by the fire', makes: [],
  })

  it('sits second in the feed — under a death, over a birth', () => {
    expect(CHRONICLE_WEIGHTS['discovery_made']).toBe(19)
    expect(CHRONICLE_WEIGHTS['agent_died']).toBeGreaterThan(19)
    expect(CHRONICLE_WEIGHTS['agent_born']).toBeLessThan(19)
  })

  it('has a glyph of its own, shared with nothing else', () => {
    expect(chronicleIcon('discovery_made')).toBe('key')
    const others = Object.entries(CHRONICLE_ICONS).filter(([t]) => t !== 'discovery_made')
    expect(others.map(([, i]) => i)).not.toContain('key')
  })

  it('credits the person by name and says what they worked out', () => {
    expect(chronicleLine(craft, look)).toBe('Rahel found the way of it — stitch a waterskin.')
    expect(chronicleLine(word, look)).toBe('Rahel gave the town a word for it — dance.')
  })

  it('NEVER puts the mind’s own words into a line a mind can read', () => {
    for (const line of [chronicleLine(craft, look), chronicleLine(word, look)]) {
      expect(line).not.toContain('i want to')
      expect(line).not.toContain('stitched hide')
      expect(line).not.toContain('by the fire')
    }
  })

  it('says nothing rather than something wrong when the payload is not one', () => {
    expect(chronicleLine(ev('discovery_made', { kind: 'craft', byId: 'a1' }), look)).toBeNull()
  })

  it('keeps the machinery out of both sentences', () => {
    for (const line of [chronicleLine(craft, look), chronicleLine(word, look)]) {
      expect(line).not.toMatch(/\b(ai|llm|model|prompt|token|agent|recipe|verb)\b/i)
    }
  })
})
