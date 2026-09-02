import { describe, expect, it } from 'vitest'
import { NO_PARAMS, type ClosedIntentParams } from '@sj/shared'
import { bindObvious, BOUND_VERBS } from './bindObvious.js'
import { quietMeadowPacket } from '../testutil/fixtures.js'
import type { PerceptionPacket } from '../prompt/prose.js'

const SELF = { x: 12, y: 9 }

type Held = PerceptionPacket['self']['inventory'][number]
type Seen = PerceptionPacket['visible']['structures'][number]

const item = (id: string, kind: string, x = SELF.x, y = SELF.y): Held => ({
  id,
  kind,
  qty: 1,
  loc: { t: 'tile', x, y },
})

const holds = (...items: Held[]): PerceptionPacket => ({
  ...quietMeadowPacket,
  self: { ...quietMeadowPacket.self, inventory: items },
})

const roof = (id: string, x: number, y: number, extra: Partial<Seen> = {}): Seen => ({
  id,
  kind: 'house',
  x,
  y,
  w: 1,
  h: 1,
  burning: false,
  stage: 'complete',
  ...extra,
})

const sees = (structures: Seen[], items: Held[] = [], atHand: string[] = []): PerceptionPacket => ({
  ...quietMeadowPacket,
  reach: { atHand, noFooting: [] },
  visible: { ...quietMeadowPacket.visible, structures, items },
})

const blank: ClosedIntentParams = NO_PARAMS
const bind = (verb: string, packet: PerceptionPacket, params: ClosedIntentParams = blank) =>
  bindObvious(verb, params, packet)

describe('bindObvious: one candidate binds, none and two do not', () => {
  it('stoke takes the one hearth in reach, lit or cold', () => {
    const lit = roof('structure_fire', SELF.x, SELF.y + 1, { kind: 'fire_pit', hearth: 'lit' })
    const cold = roof('structure_cold', SELF.x - 1, SELF.y, { kind: 'fire_pit', hearth: 'cold' })
    expect(bind('stoke', sees([lit])).structureId).toBe('structure_fire')
    expect(bind('stoke', sees([cold])).structureId).toBe('structure_cold')
    expect(bind('stoke', sees([lit, cold])).structureId).toBeNull()
    expect(bind('stoke', sees([])).structureId).toBeNull()
  })

  it('stoke leaves a hearth out of arm’s reach, and one behind walls you are not in', () => {
    const far = roof('structure_fire', SELF.x + 4, SELF.y, { kind: 'fire_pit', hearth: 'lit' })
    expect(bind('stoke', sees([far])).structureId).toBeNull()
    const indoors = sees([roof('structure_fire', SELF.x, SELF.y, { hearth: 'lit' })])
    const elsewhere: PerceptionPacket = {
      ...indoors,
      self: { ...indoors.self, inside: { id: 'structure_other', kind: 'house' } },
    }
    expect(bind('stoke', elsewhere).structureId).toBeNull()
  })

  it('take reaches for the one thing at hand and never for two', () => {
    const wood = item('item_wood', 'wood')
    const stone = item('item_stone', 'stone')
    expect(bind('take', sees([], [wood], ['item_wood'])).itemId).toBe('item_wood')
    expect(bind('take', sees([], [wood, stone], ['item_wood', 'item_stone'])).itemId).toBeNull()
    // Seen, but not close enough to close a hand around.
    expect(bind('take', sees([], [wood], [])).itemId).toBeNull()
  })

  it('enter takes the roof whose doorway is underfoot, and not one a pace away', () => {
    const here = roof('structure_home', SELF.x, SELF.y - 1, { door: { ...SELF } })
    const beside = roof('structure_barn', SELF.x + 2, SELF.y, {
      door: { x: SELF.x + 1, y: SELF.y },
    })
    expect(bind('enter', sees([here])).structureId).toBe('structure_home')
    expect(bind('enter', sees([beside])).structureId).toBeNull()
    expect(bind('enter', sees([here, beside])).structureId).toBe('structure_home')
  })

  it('fill takes the one vessel in the hands', () => {
    expect(bind('fill', holds(item('item_skin', 'waterskin'))).itemId).toBe('item_skin')
    const two = holds(item('item_skin', 'waterskin'), item('item_bucket', 'bucket'))
    expect(bind('fill', two).itemId).toBeNull()
    expect(bind('fill', holds(item('item_wood', 'wood'))).itemId).toBeNull()
  })

  it('eat takes the one thing held that is food', () => {
    expect(bind('eat', holds(item('item_bread', 'bread'), item('item_axe', 'axe'))).itemId).toBe(
      'item_bread',
    )
    const two = holds(item('item_bread', 'bread'), item('item_fish', 'fish'))
    expect(bind('eat', two).itemId).toBeNull()
    expect(bind('eat', holds(item('item_axe', 'axe'))).itemId).toBeNull()
  })

  it('drop takes the one thing held, whatever it is', () => {
    expect(bind('drop', holds(item('item_wood', 'wood'))).itemId).toBe('item_wood')
    expect(
      bind('drop', holds(item('item_wood', 'wood'), item('item_axe', 'axe'))).itemId,
    ).toBeNull()
    expect(bind('drop', holds()).itemId).toBeNull()
  })

  it('read takes the one piece of writing held', () => {
    expect(bind('read', holds(item('item_note', 'note'), item('item_axe', 'axe'))).itemId).toBe(
      'item_note',
    )
    const two = holds(item('item_note', 'note'), item('item_note_2', 'note'))
    expect(bind('read', two).itemId).toBeNull()
    expect(bind('read', holds(item('item_axe', 'axe'))).itemId).toBeNull()
  })

  it('never guesses a person, and never puts words in a mouth', () => {
    const packet = sees(
      [roof('structure_home', SELF.x, SELF.y - 1, { door: { ...SELF } })],
      [item('item_bread', 'bread')],
      ['item_bread'],
    )
    const withCompany: PerceptionPacket = {
      ...packet,
      self: { ...packet.self, inventory: [item('item_bread', 'bread')] },
      visible: {
        ...packet.visible,
        agents: [
          {
            id: 'nadia',
            name: 'Nadia',
            x: SELF.x + 1,
            y: SELF.y,
            activityVerb: null,
            collapsed: false,
            asleep: false,
          },
        ],
      },
    }
    for (const verb of ['give', 'teach', 'speak']) {
      expect([verb, bind(verb, withCompany)]).toEqual([verb, blank])
    }
  })

  it('leaves an act that already named its object, and every key it did not read', () => {
    const packet = holds(item('item_bread', 'bread'))
    const named: ClosedIntentParams = { ...blank, itemId: 'item_fish' }
    expect(bind('eat', packet, named).itemId).toBe('item_fish')
    expect(bind('eat', packet).structureId).toBeNull()
    expect(Object.keys(bind('eat', packet))).toEqual(Object.keys(blank))
  })

  it('reads a blank word as no mark at all', () => {
    const packet = holds(item('item_bread', 'bread'))
    expect(bind('eat', packet, { ...blank, itemId: '  ' }).itemId).toBe('item_bread')
  })
})

// The phase 1 gate counted 402 refusals; 283 of them were a verb named with its object left
// null. These are the seven texts that shape carries — dropping a verb here brings one back.
const REFUSAL_OF: Record<string, string> = {
  stoke: 'stoking needs the fire named',
  take: 'taking needs the thing to lift',
  enter: 'going inside needs the building you mean',
  fill: 'filling needs the vessel named',
  eat: 'eating needs the food named',
  drop: 'setting a thing down needs the thing named',
  read: 'reading needs the writing named',
}

describe('the refusals this reading removes', () => {
  it('covers every verb whose blank-object refusal the gate measured, and no other', () => {
    expect(BOUND_VERBS).toEqual(Object.keys(REFUSAL_OF).sort())
  })

  it('binds none of the acts that take a person or words', () => {
    for (const verb of ['give', 'teach', 'speak', 'walk', 'build']) {
      expect(BOUND_VERBS).not.toContain(verb)
    }
  })
})
