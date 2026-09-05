import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  CHRONICLE_FALLBACK_ICON,
  CHRONICLE_ICONS,
  CHRONICLE_TYPES,
  CHRONICLE_WEIGHTS,
  ChronicleEntrySchema,
  ChronicleResponseSchema,
  FAR_BANK_PHRASE,
  NOT_CHRONICLED,
  UNNAMED_CONSTRUCT_COPY,
  CHRONICLE_CAST_MAX,
  FOUNDING_TICK,
  SAYING_MAX,
  chronicleCast,
  chronicleIcon,
  chronicleLine,
  constructLine,
  faunaSightingLine,
  type ChronicleLookup,
} from './chronicle.js'
import type { SimEvent } from './events.js'

const NAMES: Record<string, string> = { a1: 'Rahel', a2: 'Tomas', a3: 'Mira' }
const KINDS: Record<string, string> = { s1: 'house', s2: 'storehouse' }
const look: ChronicleLookup = {
  agentName: (id) => NAMES[id] ?? id,
  structureKind: (id) => KINDS[id] ?? 'building',
  mysteryProse: (kind) => (kind === 'far_bell' ? 'A bell rings once, very far off.' : null),
}

const ev = (type: string, payload: unknown, tick = 5, seq = 1): SimEvent => ({
  seq,
  tick,
  type,
  payload,
})

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
  const entry = {
    seq: 3,
    tick: 0,
    type: 'agent_died',
    icon: 'cross',
    label: 'Rahel has died (hunger).',
  }

  it('round-trips a well-formed entry, with or without a cast', () => {
    expect(ChronicleEntrySchema.parse(entry)).toEqual(entry)
    const cast = { ...entry, agentIds: ['a1'] }
    expect(ChronicleEntrySchema.parse(cast)).toEqual(cast)
    expect(ChronicleResponseSchema.parse({ entries: [entry] }).entries).toHaveLength(1)
  })

  it('refuses a stray field, an empty label and a negative tick', () => {
    expect(ChronicleEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, label: '' }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, tick: -1 }).success).toBe(false)
    expect(ChronicleEntrySchema.safeParse({ ...entry, seq: 0 }).success).toBe(false)
  })
})

// ★ /api/heat scores the LIVE tick, so a replayed chronicle line had nobody to frame and the
// director round-robined one stranger's face per 60 ticks. The line has to say who it is about.
describe('★ chronicleCast — who a chronicle line is about', () => {
  const isAgent = (id: string): boolean => id in NAMES

  it('★ takes the people out of a payload and leaves the things behind', () => {
    expect(chronicleCast(ev('agent_tended', { agentId: 'a1', tenderId: 'a2' }), isAgent)).toEqual([
      'a1',
      'a2',
    ])
    expect(chronicleCast(ev('structure_completed', { id: 's1' }), isAgent)).toEqual([])
    expect(
      chronicleCast(ev('agent_born', { id: 'a1', name: 'Rahel', motherId: 'a2' }), isAgent),
    ).toEqual(['a1', 'a2'])
  })

  it('names nobody twice, and never more than a shot can frame', () => {
    expect(chronicleCast(ev('co_slept', { aId: 'a1', bId: 'a1' }), isAgent)).toEqual(['a1'])
    const crowd = Object.fromEntries(
      Array.from({ length: 9 }, (_, i) => [`k${i}`, `a${(i % 2) + 1}`]),
    )
    expect(chronicleCast(ev('gathering', crowd), isAgent).length).toBeLessThanOrEqual(
      CHRONICLE_CAST_MAX,
    )
  })

  it('answers empty for a line about the world rather than about anybody', () => {
    expect(chronicleCast(ev('world_grown', {}), isAgent)).toEqual([])
    expect(chronicleCast(ev('grave_placed', { name: 'Rahel' }), isAgent)).toEqual([])
  })
})

describe('chronicleLine', () => {
  it('writes a death, a birth and a night kept as the town would tell them', () => {
    expect(chronicleLine(ev('agent_died', { agentId: 'a1', cause: 'hunger' }), look)).toBe(
      'Rahel starved.',
    )
    expect(
      chronicleLine(
        ev('agent_born', { id: 'a3', name: 'Mira', motherId: 'a1', fatherId: 'a2' }),
        look,
      ),
    ).toBe('Mira was born.')
    expect(chronicleLine(ev('co_slept', { aId: 'a1', bId: 'a2', day: 3 }), look)).toBe(
      'Rahel and Tomas kept house together.',
    )
  })

  it('writes the buildings — finished, burning, spreading, inscribed', () => {
    expect(chronicleLine(ev('structure_completed', { id: 's1' }), look)).toBe(
      'The house is finished.',
    )
    expect(chronicleLine(ev('fire_ignited', { structureId: 's1', cause: 'hearth' }), look)).toBe(
      'Fire! The house is burning.',
    )
    expect(chronicleLine(ev('fire_spread', { fromId: 's1', toId: 's2' }), look)).toBe(
      'The fire has spread to the storehouse.',
    )
    expect(
      chronicleLine(
        ev('structure_inscribed', { structureId: 's2', text: 'ours', agentId: 'a1' }),
        look,
      ),
    ).toBe('New words carved on the storehouse.')
  })

  it('names an unknown id rather than inventing a person or a building', () => {
    expect(chronicleLine(ev('agent_died', { agentId: 'ghost', cause: 'unrecorded' }), look)).toBe(
      'ghost has died.',
    )
    expect(chronicleLine(ev('structure_completed', { id: 'gone' }), look)).toBe(
      'The building is finished.',
    )
  })

  it('tells a mystery in the authored prose, and says nothing when the prose is out of reach', () => {
    expect(chronicleLine(ev('mystery_event', { kind: 'far_bell' }), look)).toBe(
      'A bell rings once, very far off.',
    )
    expect(chronicleLine(ev('mystery_event', { kind: 'unheard_of' }), look)).toBeNull()
  })

  it('says nothing about a type it has no words for', () => {
    for (const type of ['tick_advanced', 'agent_moved', 'needs_changed', 'some_future_event']) {
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
  'injury',
  'poison',
  'illness',
  'fatigue',
  'exposure',
  'hunger',
  'thirst',
  'slain',
  'old_age',
]

// The four ways a body can be afflicted (engine state.ts AFFLICTION_KINDS), held here for the
// same reason DEATH_CAUSES is: shared sits under the engine and cannot import it.
const AFFLICTION_KINDS = ['fatigue', 'illness', 'injury', 'poison']

describe('the rules the town writes for itself', () => {
  it('reads the keys the engine actually writes on the four law events', () => {
    const defs = readFileSync(new URL('../../engine/src/events.def.ts', import.meta.url), 'utf8')
    const keysOf = (name: string): string[] => {
      const at = defs.indexOf(`export const ${name} = z`)
      expect(at, name).toBeGreaterThan(-1)
      const body = defs.slice(at, defs.indexOf('.strict()', at))
      return [...body.matchAll(/(\w+):\s*(?:z\.|[A-Z])/g)].map((m) => m[1]!).sort()
    }
    expect(keysOf('LawProposed')).toEqual(['agentId', 'lawId', 'text'])
    expect(keysOf('LawBroken')).toEqual(['agentId', 'lawId', 'verb', 'witnesses'])
    expect(keysOf('LawRepealed')).toEqual(['agentId', 'lawId', 'text'])
  })

  // The wording of a rule is the town's, quoted; ours is only the frame around it.
  it('quotes the sentence the town said, and never the id it was filed under', () => {
    const text = 'Nobody takes from the store after dark.'
    expect(chronicleLine(ev('law_proposed', { lawId: 'law_1', agentId: 'a1', text }), look)).toBe(
      `Rahel put a rule to the room: “${text}”`,
    )
    expect(
      chronicleLine(
        ev('law_ratified', {
          lawId: 'law_1',
          agentId: 'a1',
          text,
          why: 'the store is a place and the night is a clock',
          predicate: { kind: 'forbid', verb: 'take' },
          votes: { for: ['a1'], against: [] },
        }),
        look,
      ),
    ).toBe(`The town agreed: “${text}”`)
    expect(chronicleLine(ev('law_repealed', { lawId: 'law_1', agentId: 'a2', text }), look)).toBe(
      `The town let a rule go: “${text}”`,
    )
    for (const type of ['law_proposed', 'law_ratified', 'law_repealed', 'law_broken']) {
      const line = chronicleLine(
        ev(type, { lawId: 'law_1', agentId: 'a1', text, verb: 'take', witnesses: ['a2'] }),
        look,
      )
      expect(line, type).not.toMatch(/law_|_id|\ba1\b|\ba2\b/)
    }
  })

  it('names who saw a rule broken, and says nothing about eyes that were not there', () => {
    const broke = (witnesses: string[]): string | null =>
      chronicleLine(
        ev('law_broken', { lawId: 'law_1', agentId: 'a1', verb: 'take', witnesses }),
        look,
      )
    expect(broke([])).toBe('Rahel did what the town agreed against.')
    expect(broke(['a2'])).toBe('Rahel did what the town agreed against, and Tomas saw.')
    expect(broke(['a2', 'a3'])).toBe(
      'Rahel did what the town agreed against, and Tomas and Mira saw.',
    )
  })

  it('weighs a rule passing above the roof it is written under, and a proposal below both', () => {
    expect(CHRONICLE_WEIGHTS.law_ratified!).toBeGreaterThan(CHRONICLE_WEIGHTS.structure_completed!)
    expect(CHRONICLE_WEIGHTS.law_repealed!).toBeLessThan(CHRONICLE_WEIGHTS.law_ratified!)
    expect(CHRONICLE_WEIGHTS.law_proposed!).toBeLessThan(CHRONICLE_WEIGHTS.law_broken!)
    for (const type of ['law_proposed', 'law_ratified', 'law_broken', 'law_repealed'])
      expect(NOT_CHRONICLED.has(type), type).toBe(false)
    expect(chronicleIcon('law_ratified')).toBe('quill')
    expect(chronicleIcon('law_broken')).toBe('flame')
  })
})

describe('the acts two people choose', () => {
  // Shared sits under the engine, so the schemas cannot be imported here: the guard below reads
  // their source instead and holds the keys these lines index against the engine's own.
  it('reads the keys the engine actually writes on the five relationship events', () => {
    const defs = readFileSync(new URL('../../engine/src/events.def.ts', import.meta.url), 'utf8')
    const keysOf = (name: string): string[] => {
      const at = defs.indexOf(`export const ${name} = z`)
      expect(at, name).toBeGreaterThan(-1)
      const body = defs.slice(at, defs.indexOf('.strict()', at))
      return [...body.matchAll(/(\w+):\s*(?:z\.|[A-Z])/g)].map((m) => m[1]!).sort()
    }
    expect(keysOf('Invited')).toEqual(['agentId', 'byId', 'verb'])
    expect(keysOf('InvitationRefused')).toEqual(['agentId', 'byId', 'verb', 'witnesses'])
    expect(keysOf('PartnershipFormed')).toEqual(['aId', 'bId'])
    expect(keysOf('PartnershipDissolved')).toEqual(['aId', 'bId', 'byId'])
  })

  it('tells the paper who asked, who said yes and who would not', () => {
    expect(chronicleLine(ev('invited', { agentId: 'a2', byId: 'a1', verb: 'court' }), look)).toBe(
      'Rahel asked Tomas to walk out.',
    )
    expect(chronicleLine(ev('invited', { agentId: 'a2', byId: 'a1', verb: 'propose' }), look)).toBe(
      'Rahel asked Tomas to be their partner.',
    )
    expect(
      chronicleLine(ev('invitation_accepted', { agentId: 'a2', byId: 'a1', verb: 'court' }), look),
    ).toBe('Tomas said yes to Rahel.')
    expect(
      chronicleLine(
        ev('invitation_refused', {
          agentId: 'a2',
          byId: 'a1',
          verb: 'propose',
          witnesses: ['a3'],
        }),
        look,
      ),
    ).toBe('Tomas refused Rahel a life together.')
    expect(chronicleLine(ev('partnership_formed', { aId: 'a1', bId: 'a2' }), look)).toBe(
      'Rahel and Tomas are partners now.',
    )
  })

  it('names the one who walked out of the partnership, not whichever id sorts first', () => {
    expect(
      chronicleLine(ev('partnership_dissolved', { aId: 'a1', bId: 'a2', byId: 'a2' }), look),
    ).toBe('Tomas has left Rahel.')
    expect(
      chronicleLine(ev('partnership_dissolved', { aId: 'a1', bId: 'a2', byId: 'a1' }), look),
    ).toBe('Rahel has left Tomas.')
  })

  it('keeps a bedding private but for the shut door', () => {
    expect(
      chronicleLine(ev('invited', { agentId: 'a2', byId: 'a1', verb: 'lie_with' }), look),
    ).toBeNull()
    expect(
      chronicleLine(
        ev('invitation_refused', { agentId: 'a2', byId: 'a1', verb: 'lie_with', witnesses: [] }),
        look,
      ),
    ).toBeNull()
    expect(
      chronicleLine(
        ev('invitation_accepted', { agentId: 'a2', byId: 'a1', verb: 'lie_with' }),
        look,
      ),
    ).toBe('Rahel and Tomas went in and shut the door.')
    // The partnership line one weight above says it in the same breath; two lines for one yes
    // would read as two moments.
    expect(
      chronicleLine(
        ev('invitation_accepted', { agentId: 'a2', byId: 'a1', verb: 'propose' }),
        look,
      ),
    ).toBeNull()
  })

  it('weighs a parting above a night kept under one roof, and names nobody by id', () => {
    expect(CHRONICLE_WEIGHTS.partnership_dissolved!).toBeGreaterThan(CHRONICLE_WEIGHTS.co_slept!)
    expect(CHRONICLE_WEIGHTS.partnership_formed!).toBeGreaterThan(CHRONICLE_WEIGHTS.invited!)
    for (const type of [
      'invited',
      'invitation_accepted',
      'invitation_refused',
      'partnership_formed',
      'partnership_dissolved',
    ]) {
      expect(NOT_CHRONICLED.has(type), type).toBe(false)
      expect(CHRONICLE_WEIGHTS[type], type).toBeGreaterThan(0)
    }
    const line = chronicleLine(ev('partnership_formed', { aId: 'a1', bId: 'a2' }), look)!
    expect(line).not.toMatch(/a1|a2|_/)
  })

  it('frames both bodies of a relationship line and never the verb', () => {
    const isAgent = (id: string): boolean => id === 'a1' || id === 'a2'
    expect(
      chronicleCast(ev('invited', { agentId: 'a2', byId: 'a1', verb: 'court' }), isAgent),
    ).toEqual(['a2', 'a1'])
    expect(chronicleCast(ev('partnership_formed', { aId: 'a1', bId: 'a2' }), isAgent)).toEqual([
      'a1',
      'a2',
    ])
  })
})

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
    for (const type of Object.keys(CHRONICLE_WEIGHTS))
      expect(NOT_CHRONICLED.has(type), type).toBe(false)
  })

  it('gives every way of dying its own human sentence', () => {
    const said = DEATH_CAUSES.map((cause) =>
      chronicleLine(ev('agent_died', { agentId: 'a1', cause }), look),
    )
    expect(new Set(said).size).toBe(DEATH_CAUSES.length)
    for (const line of said) {
      expect(line).toMatch(/^Rahel /)
      expect(line).not.toMatch(/[0-9]/)
    }
    expect(chronicleLine(ev('agent_died', { agentId: 'a1', cause: 'exposure' }), look)).toBe(
      'Rahel froze.',
    )
  })

  // escalateFatigue mints agent_afflicted{kind:'fatigue'}, which once narrated as "has fallen ill":
  // five founders shown as an epidemic on the dev world's first night. Every kind needs its own sentence.
  it('gives every way of being afflicted its own human sentence', () => {
    const said = AFFLICTION_KINDS.map((kind) =>
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind, severity: 1 }), look),
    )
    expect(new Set(said).size).toBe(AFFLICTION_KINDS.length)
    for (const line of said) {
      expect(line).toMatch(/^Rahel /)
      expect(line).not.toMatch(/[0-9]/)
    }
    // Named, not merely distinct: exhaustion must not be able to read as sickness.
    expect(
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'fatigue', severity: 1 }), look),
    ).not.toMatch(/ill|sick|fever/i)
  })

  it('says the body plainly — hurt, ill, poisoned, worse, mending, cared for, buried', () => {
    expect(
      chronicleLine(ev('agent_harmed', { agentId: 'a1', amount: 12, source: 'attack' }), look),
    ).toBe('Rahel was hurt.')
    expect(
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 1 }), look),
    ).toBe('Rahel has fallen ill.')
    expect(
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'poison', severity: 1 }), look),
    ).toBe('Rahel was poisoned.')
    expect(
      chronicleLine(
        ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 2 }),
        look,
      ),
    ).toBe('Rahel grows worse.')
    expect(
      chronicleLine(ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), look),
    ).toBe('Rahel is on the mend.')
    expect(chronicleLine(ev('agent_tended', { agentId: 'a1', tenderId: 'a2' }), look)).toBe(
      'Tomas cared for Rahel.',
    )
    expect(
      chronicleLine(
        ev('grave_placed', { id: 'g1', agentId: 'a1', name: 'Rahel', x: 1, y: 1 }),
        look,
      ),
    ).toBe('A grave was made for Rahel.')
  })

  it('speaks of the work: a road, a channel, a felled tree, a fire beaten back, a beast taken', () => {
    expect(
      chronicleLine(
        ev('tile_changed', { x: 1, y: 1, from: 0, to: 7, reason: 'paved', byId: 'a1' }),
        look,
      ),
    ).toBe('Rahel laid a stretch of road.')
    expect(
      chronicleLine(
        ev('tile_changed', { x: 1, y: 1, from: 0, to: 2, reason: 'channel', byId: 'a1' }),
        look,
      ),
    ).toBe('A channel now carries water to the fields.')
    expect(
      chronicleLine(
        ev('tile_changed', { x: 1, y: 1, from: 3, to: 0, reason: 'cleared', byId: 'a1' }),
        look,
      ),
    ).toBe('Rahel felled a tree.')
    expect(
      chronicleLine(
        ev('fire_extinguished', { structureId: 's1', cause: 'doused', agentId: 'a1' }),
        look,
      ),
    ).toBe('Rahel beat back the fire.')
    expect(
      chronicleLine(ev('fauna_killed', { id: 'f1', kind: 'deer', x: 1, y: 1, byId: 'a1' }), look),
    ).toBe('Rahel brought down a deer.')
    expect(chronicleLine(ev('world_grown', { edge: 'n', depth: 4, tiles: [[0]] }), look)).toBe(
      'The world is wider than it was.',
    )
  })

  it('keeps the coined word whole, and says how it reached whoever noticed', () => {
    expect(
      chronicleLine(
        ev('agent_expressed', { agentId: 'a1', verb: 'dance', x: 1, y: 1, sense: 'sight' }),
        look,
      ),
    ).toBe('Rahel was seen to dance.')
    expect(
      chronicleLine(
        ev('agent_expressed', { agentId: 'a1', verb: 'sing', x: 1, y: 1, sense: 'sound' }),
        look,
      ),
    ).toBe('Rahel was heard to sing.')
    expect(
      chronicleLine(
        ev('agent_expressed', { agentId: 'a1', verb: 'mourn', targetId: 'a2', x: 1, y: 1 }),
        look,
      ),
    ).toBe('Rahel was seen to mourn for Tomas.')
  })

  it('says nothing at all for the ground wearing, the rain putting a fire out, or a body drinking', () => {
    for (const reason of ['worn', 'overgrown', 'seeded', 'grown', 'tilled']) {
      expect(
        chronicleLine(ev('tile_changed', { x: 1, y: 1, from: 0, to: 8, reason }), look),
        reason,
      ).toBeNull()
    }
    expect(
      chronicleLine(ev('fire_extinguished', { structureId: 's1', cause: 'rain' }), look),
    ).toBeNull()
    for (const type of ['agent_drank', 'item_filled', 'fauna_moved', 'forageable_regrown']) {
      expect(chronicleLine(ev(type, {}), look), type).toBeNull()
    }
  })

  it('reads no temperature anywhere — the cold is a cause of death, never a number', () => {
    expect(NOT_CHRONICLED.has('weather_changed')).toBe(true)
    expect(NOT_CHRONICLED.has('needs_changed')).toBe(true)
    expect(
      chronicleLine(ev('weather_changed', { kind: 'snow', temperatureC: -12 }), look),
    ).toBeNull()
  })

  it('phrases a herd on the far bank as seen and not as had', () => {
    expect(faunaSightingLine('deer', true)).toBe(`a deer ${FAR_BANK_PHRASE}`)
    expect(faunaSightingLine('deer', false)).toBe('a deer')
    expect(FAR_BANK_PHRASE).toBe('across the river')
  })

  it('tells a gathering by the name they gave it, or says plainly that they have not', () => {
    expect(constructLine({ name: 'the Long Turning' })).toBe(
      'They have taken to gathering, and they call it the Long Turning.',
    )
    expect(constructLine({ name: null })).toContain(UNNAMED_CONSTRUCT_COPY)
    expect(constructLine({ name: null })).not.toMatch(/festival|council|market|faith/i)
  })

  it('never names the machinery, a stat, or a bare number, in any line it can write', () => {
    const lines = [
      ...DEATH_CAUSES.map((cause) =>
        chronicleLine(ev('agent_died', { agentId: 'a1', cause }), look),
      ),
      chronicleLine(ev('agent_harmed', { agentId: 'a1', amount: 12, source: 'fire' }), look),
      chronicleLine(ev('agent_afflicted', { agentId: 'a1', kind: 'illness', severity: 3 }), look),
      chronicleLine(
        ev('affliction_worsened', { agentId: 'a1', kind: 'illness', severity: 3 }),
        look,
      ),
      chronicleLine(ev('affliction_recovered', { agentId: 'a1', kind: 'illness' }), look),
      chronicleLine(ev('agent_tended', { agentId: 'a1', tenderId: 'a2' }), look),
      chronicleLine(
        ev('grave_placed', { id: 'g1', agentId: 'a1', name: 'Rahel', x: 1, y: 1 }),
        look,
      ),
      chronicleLine(
        ev('fire_extinguished', { structureId: 's1', cause: 'doused', agentId: 'a1' }),
        look,
      ),
      chronicleLine(
        ev('tile_changed', { x: 1, y: 1, from: 0, to: 7, reason: 'paved', byId: 'a1' }),
        look,
      ),
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
    recipeId: 'recipe:waterskin',
    name: 'stitch a waterskin',
    kind: 'craft',
    byId: 'a1',
    intent: 'i want to carry water in a stitched hide',
    makes: ['waterskin'],
  })
  const word = ev('discovery_made', {
    recipeId: 'express:dance',
    name: 'dance',
    kind: 'word',
    byId: 'a1',
    intent: 'i want to dance by the fire',
    makes: [],
  })

  it('sits second in the feed — under a death, over a birth', () => {
    expect(CHRONICLE_WEIGHTS.discovery_made).toBe(19)
    expect(CHRONICLE_WEIGHTS.agent_died).toBeGreaterThan(19)
    expect(CHRONICLE_WEIGHTS.agent_born).toBeLessThan(19)
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

// Task 17: the feed carries what people SAID to each other, not only what happened to them.
describe('a scene reaches the feed as the summary it closed on', () => {
  const SUMMARY =
    'Rahel promised Tomas four fish for tomorrow, then conceded the fifth; Tomas fixed the count and named himself its keeper.'
  const closed = ev('scene_closed', {
    id: 'scene_7',
    summary: SUMMARY,
    participants: ['a1', 'a2'],
    deltas: [],
    closeReason: 'ended',
  })

  it('is weighted over a rule let go and under a parting, with a spark of its own', () => {
    expect(CHRONICLE_WEIGHTS.scene_closed).toBe(14)
    expect(CHRONICLE_WEIGHTS.scene_closed!).toBeGreaterThan(CHRONICLE_WEIGHTS.law_repealed!)
    expect(CHRONICLE_WEIGHTS.scene_closed!).toBeLessThan(CHRONICLE_WEIGHTS.partnership_dissolved!)
    expect(chronicleIcon('scene_closed')).toBe('spark')
    expect(NOT_CHRONICLED.has('scene_closed')).toBe(false)
  })

  it('prints the summary as the line, and nothing at all for a scene that said nothing', () => {
    expect(chronicleLine(closed, look)).toBe(SUMMARY)
    expect(chronicleLine(ev('scene_closed', { id: 'scene_8', summary: '  ' }), look)).toBeNull()
  })

  it('frames the cast the scene carried, and nobody when it carried none', () => {
    const isAgent = (id: string): boolean => id in NAMES
    expect(chronicleCast(closed, isAgent)).toEqual(['a1', 'a2'])
    expect(chronicleCast(ev('scene_closed', { id: 'scene_8', summary: 'x' }), isAgent)).toEqual([])
  })
})

describe('somebody walking into the town', () => {
  const spawn = (tick: number): SimEvent =>
    ev('agent_spawned', { id: 'a1', name: 'Rahel', x: 1, y: 1, ageDays: 7000 }, tick)

  // founders.ts:613 and scripted.ts:209 both stand the whole cast up on tick 1, so `tick > 0`
  // would have read day 0 as twelve strangers walking in.
  it('says nothing of the founding — the town began with those people', () => {
    expect(chronicleLine(spawn(0), look)).toBeNull()
    expect(chronicleLine(spawn(FOUNDING_TICK), look)).toBeNull()
    expect(FOUNDING_TICK).toBe(1)
  })

  it('reads as an arrival on any tick after it, by name and never by id', () => {
    const line = chronicleLine(spawn(900), look)!
    expect(line).toBe('Rahel came to the town.')
    expect(line).not.toMatch(/a1|_/)
    expect(CHRONICLE_WEIGHTS.agent_spawned).toBe(12)
    expect(chronicleIcon('agent_spawned')).toBe('star')
    expect(NOT_CHRONICLED.has('agent_spawned')).toBe(false)
  })
})

describe('a discovery says why, in the words it was said in', () => {
  const made = (payload: Record<string, unknown>): SimEvent =>
    ev('discovery_made', {
      recipeId: 'recipe:pegs',
      name: 'shape wooden pegs',
      kind: 'craft',
      byId: 'a1',
      intent: 'shape the dry wood into pegs',
      ...payload,
    })

  it('appends the spoken reason when there is one, and reads as today when there is not', () => {
    expect(chronicleLine(made({ saying: 'The roof will not hold without them.' }), look)).toBe(
      'Rahel found the way of it — shape wooden pegs. “The roof will not hold without them.”',
    )
    expect(chronicleLine(made({}), look)).toBe('Rahel found the way of it — shape wooden pegs.')
  })

  it('clips a reason that runs on, so a feed line stays a line', () => {
    const long = `${'the grain runs long and the wood is dry '.repeat(6)}end`
    const line = chronicleLine(made({ saying: long }), look)!
    expect(line).toContain('…”')
    expect(line.slice(line.indexOf('“') + 1, -1).length).toBe(SAYING_MAX)
    expect(line).not.toContain('end')
  })
})

describe('every weighted type has words to print', () => {
  const PAYLOADS: Record<string, unknown> = {
    agent_died: { agentId: 'a1', cause: 'hunger' },
    discovery_made: { name: 'a thing', kind: 'craft', byId: 'a1' },
    agent_born: { id: 'a3', name: 'Mira', motherId: 'a1' },
    law_ratified: { lawId: 'l1', agentId: 'a1', text: 'no fires indoors' },
    partnership_formed: { aId: 'a1', bId: 'a2' },
    world_grown: {},
    partnership_dissolved: { aId: 'a1', bId: 'a2', byId: 'a1' },
    scene_closed: { id: 's', summary: 'They settled it.' },
    law_repealed: { lawId: 'l1', agentId: 'a1', text: 'no fires indoors' },
    grave_placed: { name: 'Rahel' },
    invitation_accepted: { byId: 'a1', agentId: 'a2', verb: 'court' },
    agent_spawned: { id: 'a1', name: 'Rahel' },
    agent_arrived: { id: 'a9', name: 'Mira' },
    agent_departed: { agentId: 'a1' },
    structure_completed: { id: 's1' },
    invitation_refused: { byId: 'a1', agentId: 'a2', verb: 'propose' },
    fire_ignited: { structureId: 's1' },
    fire_extinguished: { structureId: 's1', cause: 'doused', agentId: 'a1' },
    agent_harmed: { agentId: 'a1' },
    agent_afflicted: { agentId: 'a1', kind: 'illness' },
    invited: { byId: 'a1', agentId: 'a2', verb: 'court' },
    law_broken: { lawId: 'l1', agentId: 'a1', verb: 'chop', witnesses: [] },
    fire_spread: { toId: 's2' },
    law_proposed: { agentId: 'a1', text: 'no fires indoors' },
    structure_inscribed: { structureId: 's1' },
    affliction_recovered: { agentId: 'a1' },
    affliction_worsened: { agentId: 'a1' },
    agent_tended: { agentId: 'a1', tenderId: 'a2' },
    fauna_killed: { byId: 'a1', kind: 'deer' },
    mystery_event: { kind: 'far_bell' },
    tile_changed: { byId: 'a1', reason: 'paved' },
    co_slept: { aId: 'a1', bId: 'a2', day: 2 },
    agent_expressed: { agentId: 'a1', verb: 'express:dance', sense: 'sound' },
  }

  it('has a payload and a sentence for every type the feed selects on', () => {
    expect(Object.keys(PAYLOADS).sort()).toEqual([...CHRONICLE_TYPES].sort())
    for (const type of CHRONICLE_TYPES) {
      const line = chronicleLine(ev(type, PAYLOADS[type], 900), look)
      expect(line, `${type} has no line`).not.toBeNull()
      expect(line, type).not.toMatch(/\ba[0-9]\b|_/)
    }
  })
})

// Payload shapes from the arrivals design §2; the zod schemas land with the engine's own lane.
describe('the road, both ways', () => {
  const arrived = ev('agent_arrived', {
    id: 'a9',
    name: 'Mira',
    sex: 'f',
    ageDays: 11_315,
    x: 65,
    y: 127,
  })
  const departed = ev('agent_departed', { agentId: 'a1' })

  it('says who came up the road and who went down it', () => {
    expect(chronicleLine(arrived, look)).toBe('Mira came up the valley road.')
    expect(chronicleLine(departed, look)).toBe('Rahel went down the valley road.')
  })

  it('names the arrival off its own payload, because the roster has no stranger in it', () => {
    // `a9` is nobody `look` knows; the line still reads as a person, not as an id.
    expect(chronicleLine(arrived, look)).not.toContain('a9')
    expect(chronicleLine(ev('agent_arrived', { id: 'a9' }), look)).toBeNull()
  })

  it('marks an arrival like a star and a leaving like a flame', () => {
    expect(chronicleIcon('agent_arrived')).toBe('star')
    expect(chronicleIcon('agent_departed')).toBe('flame')
  })

  it('weighs an arrival above a leaving, and both under a death', () => {
    expect(CHRONICLE_WEIGHTS.agent_arrived!).toBeGreaterThan(CHRONICLE_WEIGHTS.agent_departed!)
    expect(CHRONICLE_WEIGHTS.agent_departed!).toBeGreaterThan(CHRONICLE_WEIGHTS.law_broken!)
    expect(CHRONICLE_WEIGHTS.agent_arrived!).toBeLessThan(CHRONICLE_WEIGHTS.agent_died!)
  })

  it('frames the two people it is about', () => {
    const isAgent = (id: string): boolean => id === 'a1' || id === 'a9'
    expect(chronicleCast(arrived, isAgent)).toEqual(['a9'])
    expect(chronicleCast(departed, isAgent)).toEqual(['a1'])
  })
})
