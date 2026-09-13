import { afterEach, describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  ADULT_AGE_DAYS,
  DEFAULT_CONFIG,
  NO_PARAMS,
  namedParams,
  stateHash,
  type ClosedKey,
  type SimEvent,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { genesisState, type TileId, type WorldState } from './state.js'
import { loneCandidateFor, markUnderAnotherKey } from './verbs/autofill.js'
import { keysFor, registerVerb, unregisterVerb, VERBS, type VerbDef } from './verbs/index.js'

const CHAR_TILE: Record<string, TileId> = { '.': 0, '~': 2 }
let seq = 1
const ev = (type: string, payload: unknown): SimEvent => ({ seq: seq++, tick: 0, type, payload })

const OPEN = ['........', '........', '........', '........', '........', '........']
const WATERSIDE = ['.~......', '........', '........']

function world(rows: string[] = OPEN): WorldState {
  return genesisState(
    DEFAULT_CONFIG,
    rows.map((row) => Array.from(row).map((c) => CHAR_TILE[c]!)),
  )
}

function withAgent(s: WorldState, x: number, y: number): WorldState {
  return fold(s, ev('agent_spawned', { id: 'a1', name: 'a1', x, y, ageDays: ADULT_AGE_DAYS }))
}

function holding(s: WorldState, id: string, kind: string, charges?: number): WorldState {
  return fold(
    s,
    ev('item_spawned', {
      id,
      kind,
      qty: 1,
      ...(charges === undefined ? {} : { charges }),
      loc: { t: 'agent', id: 'a1' },
    }),
  )
}

function onGround(s: WorldState, id: string, kind: string, x: number, y: number): WorldState {
  return fold(s, ev('item_spawned', { id, kind, qty: 1, loc: { t: 'tile', x, y } }))
}

// A finished fire pit on one tile: stokeable, and warm on whichever side you stand.
function withFire(s: WorldState, id: string, x: number, y: number): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id,
      kind: 'fire_pit',
      x,
      y,
      w: 1,
      h: 1,
      maxHp: 50,
      flammable: true,
      builderId: 'a1',
    }),
  )
  return fold(planned, ev('structure_completed', { id }))
}

// A finished well: a building the fire verbs want nothing to do with.
function withWell(s: WorldState, id: string, x: number, y: number): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id,
      kind: 'well',
      x,
      y,
      w: 1,
      h: 1,
      maxHp: 30,
      flammable: false,
      builderId: 'a1',
    }),
  )
  return fold(planned, ev('structure_completed', { id }))
}

// A complete 2x2 house whose door lands one row south of its footprint.
function withHouse(s: WorldState, id: string, x: number): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      id,
      kind: 'house',
      x,
      y: 1,
      w: 2,
      h: 2,
      maxHp: 50,
      flammable: true,
      builderId: 'a1',
    }),
  )
  return fold(planned, ev('structure_completed', { id }))
}

const fill = (s: WorldState, verb: string, params: Record<string, unknown> = {}) =>
  loneCandidateFor(s, DEFAULT_CONFIG, 'a1', verb, params)

// One log folded onto one world. The seq is counted from the same place every time, so two
// states can only be told apart by what the events said.
function replay(s: WorldState, events: { type: string; payload: unknown }[]): WorldState {
  let out = s
  let n = 1
  for (const e of events) out = fold(out, { seq: n++, tick: 0, type: e.type, payload: e.payload })
  return out
}

describe('loneCandidateFor', () => {
  it('fills eat from the one edible thing in the satchel', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(fill(s, 'eat')).toEqual({ itemId: 'item_bread_1' })
  })

  it('leaves eat alone when two things in the satchel are edible', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    expect(fill(s, 'eat')).toBeNull()
  })

  it('leaves eat alone when nothing held is edible, and when the food is already named', () => {
    const empty = holding(withAgent(world(), 1, 1), 'item_axe_1', 'axe')
    expect(fill(empty, 'eat')).toBeNull()
    const one = holding(empty, 'item_bread_1', 'bread')
    expect(fill(one, 'eat', { itemId: 'item_bread_1' })).toBeNull()
  })

  it('fills enter from the one door within reach, and not from two', () => {
    const one = withHouse(withAgent(world(), 2, 3), 'structure_1', 2)
    expect(fill(one, 'enter')).toEqual({ structureId: 'structure_1' })
    const two = withHouse(withHouse(withAgent(world(), 3, 3), 'structure_1', 2), 'structure_2', 4)
    expect(fill(two, 'enter')).toBeNull()
  })

  it('fills take from the one thing in reach, and not from a second on the ground', () => {
    const one = onGround(withAgent(world(), 2, 2), 'item_wood_1', 'wood', 2, 3)
    expect(fill(one, 'take')).toEqual({ itemId: 'item_wood_1' })
    expect(fill(onGround(one, 'item_stone_2', 'stone', 1, 2), 'take')).toBeNull()
    // Seen across the meadow is not close enough to close a hand around.
    expect(fill(onGround(withAgent(world(), 2, 2), 'item_wood_1', 'wood', 6, 5), 'take')).toBeNull()
  })

  it('fills drop and read from the one thing held that each of them takes', () => {
    const wood = holding(withAgent(world(), 1, 1), 'item_wood_1', 'wood')
    expect(fill(wood, 'drop')).toEqual({ itemId: 'item_wood_1' })
    expect(fill(holding(wood, 'item_axe_2', 'axe'), 'drop')).toBeNull()
    // A note is the only thing there is to read, however full the hands are otherwise.
    const note = fold(
      wood,
      ev('item_spawned', {
        id: 'item_note_1',
        kind: 'note',
        qty: 1,
        text: 'the well is dry',
        loc: { t: 'agent', id: 'a1' },
      }),
    )
    expect(fill(note, 'read')).toEqual({ itemId: 'item_note_1' })
    expect(fill(wood, 'read')).toBeNull()
  })

  it('fills fill from the one vessel held while there is water to kneel at', () => {
    const wet = ['..~.....', '........', '........', '........', '........', '........']
    const one = holding(withAgent(world(wet), 2, 1), 'item_skin_1', 'waterskin')
    expect(fill(one, 'fill')).toEqual({ itemId: 'item_skin_1' })
    expect(fill(holding(one, 'item_bucket_2', 'bucket'), 'fill')).toBeNull()
    expect(fill(holding(withAgent(world(wet), 2, 1), 'item_wood_1', 'wood'), 'fill')).toBeNull()
  })

  // 98 of the phase 1 gate's 402 refusals were `stoke` with its fire left null — the largest
  // bucket, and the one reading the table did not have.
  it('fills stoke from the one fire beside the body, lit or cold', () => {
    const cold = withFire(withAgent(world(), 2, 2), 'structure_fire_1', 2, 3)
    expect(fill(cold, 'stoke')).toBeNull() // nothing to feed it with
    const fuelled = holding(cold, 'item_wood_1', 'wood')
    expect(fill(fuelled, 'stoke')).toEqual({ structureId: 'structure_fire_1' })
    // Two fires equally in reach: the mind must say which, and the refusal is right.
    expect(fill(withFire(fuelled, 'structure_fire_2', 1, 2), 'stoke')).toBeNull()
    // One four paces off is no reading at all — `stoke.validate` asks arm's reach itself.
    const far = holding(withFire(withAgent(world(), 2, 2), 'structure_fire_1', 6, 5), 'i_w', 'wood')
    expect(fill(far, 'stoke')).toBeNull()
  })

  // Guessing which person someone meant reads as a bug in the story, and inventing words for a
  // mind is worse. Neither is in the table, and a row here says so out loud.
  it('never reads in a person or a word: give, teach and speak stay refused', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = fold(s, ev('agent_spawned', { id: 'a2', name: 'a2', x: 2, y: 1, ageDays: ADULT_AGE_DAYS }))
    for (const verb of ['give', 'teach', 'speak']) {
      expect([verb, fill(s, verb)]).toEqual([verb, null])
    }
  })
})

// 83 of 139 refusal episodes in the phase 1 gate were an act the table could have bound, turned
// away with "name it" while the real obstacle stood somewhere else entirely.
describe('the refusal names what is actually in the way', () => {
  const refuse = (s: WorldState, verb: string, params: Record<string, unknown> = {}) => {
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', verb, params)
    return r.ok ? null : r.reason
  }

  it('says there is no water rather than asking which vessel, holding one', () => {
    const dry = holding(withAgent(world(), 1, 1), 'item_skin_1', 'waterskin')
    expect(refuse(dry, 'fill')).toBe('no water within reach')
    // A null under the key is no key at all, and reads the same way.
    expect(refuse(dry, 'fill', { itemId: null })).toBe('no water within reach')
  })

  it('says the fire wants wood rather than asking which fire, standing at one', () => {
    const cold = withFire(withAgent(world(), 2, 2), 'structure_fire_1', 2, 3)
    expect(refuse(cold, 'stoke')).toBe('not enough wood — wood comes from felling a tree')
    // A well answers what a name the world does not hold answers, so it is no candidate at all
    // and the one fire still speaks alone: a town full of buildings does not mute this.
    expect(refuse(withWell(cold, 'structure_well_1', 5, 5), 'stoke')).toBe(
      'not enough wood — wood comes from felling a tree',
    )
  })

  it('leaves the honest refusal when the things in hand disagree about why', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_skin_1', 'waterskin')
    s = holding(s, 'item_axe_2', 'axe')
    // One is dry, the other holds no water at all: two obstacles, and no one sentence for them.
    expect(refuse(s, 'fill')).toBe('filling needs the vessel named')
  })

  it('leaves an act the world can read alone, and one nothing at all is in the way of', () => {
    const wet = ['..~.....', '........', '........', '........', '........', '........']
    const one = holding(withAgent(world(wet), 2, 1), 'item_skin_1', 'waterskin')
    expect(refuse(one, 'fill')).toBeNull()
    const two = holding(one, 'item_bucket_2', 'bucket')
    expect(refuse(two, 'fill')).toBe(
      'which one, the bucket (item_bucket_2) or the waterskin (item_skin_1)?',
    )
  })

  // Machinery words never reach a mind: `MACHINE_REASON` blanks a reason spelled in braces or a
  // registry name, and the sentences above are the town's own.
  it('surfaces nothing a mind could not be told', () => {
    const cold = withFire(withAgent(world(), 2, 2), 'structure_fire_1', 2, 3)
    const dry = holding(withAgent(world(), 1, 1), 'item_skin_1', 'waterskin')
    for (const said of [refuse(cold, 'stoke'), refuse(dry, 'fill')]) {
      expect([said, /[{}]/.test(said ?? '')]).toEqual([said, false])
    }
  })
})

// Nothing wrote to the table at runtime, so every word the arbiter has ever minted was born in
// the state `stoke` was in: refused on its first blank object, and charged a repair call for it.
describe('a minted verb brings its own row', () => {
  const MINTED = ['recipe:bless', 'recipe:wager', 'recipe:hail']
  afterEach(() => {
    for (const kind of MINTED) unregisterVerb(kind)
  })

  // Shaped as `verbFromCharter` shapes one: it reads the keys its charter named, and judges each
  // of them the way the tier-1 verbs do — a thing in these hands, a building at this elbow.
  const minted = (kind: string, reads: ClosedKey[]): VerbDef => ({
    kind,
    reads,
    validate(state, _config, agentId, params) {
      for (const key of reads) {
        const id = params[key]
        if (typeof id !== 'string') return `name ${key}, the thing it is for`
        if (key === 'itemId') {
          const loc = state.items[id]?.loc
          if (loc?.t !== 'agent' || loc.id !== agentId) return 'not in your hands'
        }
        if (key === 'structureId' && state.structures[id] === undefined)
          return 'you must be beside it'
        if (key === 'targetId' && state.agents[id]?.alive !== true) return 'no one there'
      }
      return null
    },
    duration: () => 1,
    onComplete: () => [],
  })

  const neighbour = (s: WorldState, x: number, y: number): WorldState =>
    fold(s, ev('agent_spawned', { id: 'a2', name: 'a2', x, y, ageDays: ADULT_AGE_DAYS }))

  it('reads in the one thing held, and asks when two of them fit', () => {
    registerVerb(minted('recipe:bless', ['itemId']))
    const one = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(fill(one, 'recipe:bless')).toEqual({ itemId: 'item_bread_1' })
    expect(fill(holding(one, 'item_fish_2', 'fish'), 'recipe:bless')).toBeNull()
  })

  // The phase 4 gate in miniature: a word one mind coined, used by another that named no object.
  it('reads in the one building for a second mind that left the object blank', () => {
    registerVerb(minted('recipe:bless', ['structureId']))
    const s = neighbour(withFire(withAgent(world(), 2, 2), 'structure_fire_1', 2, 3), 3, 3)
    expect(loneCandidateFor(s, DEFAULT_CONFIG, 'a2', 'recipe:bless', {})).toEqual({
      structureId: 'structure_fire_1',
    })
    const r = submitIntent(s, DEFAULT_CONFIG, 'a2', 'recipe:bless', { ...NO_PARAMS })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      agentId: 'a2',
      params: { structureId: 'structure_fire_1' },
    })
  })

  // Which thing and which person is two questions, and a row can answer one. It gets none, and
  // refuses in its own words the way `give` does.
  it('leaves a verb that reads two marks to refuse', () => {
    registerVerb(minted('recipe:wager', ['itemId', 'targetId']))
    const s = neighbour(holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread'), 2, 1)
    expect(fill(s, 'recipe:wager')).toBeNull()
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'recipe:wager', {})).toEqual({
      ok: false,
      reason: 'name itemId, the thing it is for',
    })
  })

  it('never reads in a person, however alone in the valley they are', () => {
    registerVerb(minted('recipe:hail', ['targetId']))
    const s = neighbour(withAgent(world(), 1, 1), 2, 1)
    expect(fill(s, 'recipe:hail')).toBeNull()
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'recipe:hail', {})).toEqual({
      ok: false,
      reason: 'name targetId, the thing it is for',
    })
  })

  // A verb retires after fourteen unused days, and a row outliving its verb would answer for a
  // word the town no longer has.
  it('loses the row when the verb goes', () => {
    const held = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    registerVerb(minted('recipe:bless', ['itemId']))
    expect(fill(held, 'recipe:bless')).toEqual({ itemId: 'item_bread_1' })
    unregisterVerb('recipe:bless')
    // The same word coined again, this time reading nothing: a surviving row would still bind.
    registerVerb(minted('recipe:bless', []))
    expect(fill(held, 'recipe:bless')).toBeNull()
  })

  it('is derived state: minting one moves nothing in the world', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const before = stateHash(s)
    registerVerb(minted('recipe:bless', ['itemId']))
    expect(fill(s, 'recipe:bless')).toEqual({ itemId: 'item_bread_1' })
    expect(stateHash(s)).toBe(before)
  })
})

const rekey = (s: WorldState, verb: string, params: Record<string, unknown>) =>
  markUnderAnotherKey(s, DEFAULT_CONFIG, 'a1', verb, params)

describe('markUnderAnotherKey', () => {
  it('reads the mark the act named under a word the verb does not use', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_bread_1' })).toEqual({ itemId: 'item_bread_1' })
  })

  it('reads a building named under the wrong word too, not only a held thing', () => {
    const s = withHouse(withAgent(world(), 2, 3), 'structure_1', 2)
    expect(rekey(s, 'enter', { itemId: 'structure_1' })).toEqual({ structureId: 'structure_1' })
  })

  it('does not guess when two marks are named', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_bread_1', nodeId: 'item_bread_1' })).toBeNull()
  })

  it('leaves an act that named its own object, and one that named nothing', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { itemId: 'item_bread_1' })).toBeNull()
    expect(rekey(s, 'eat', {})).toBeNull()
  })

  it('never reads words or numbers as a mark', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { text: 'item_bread_1' })).toBeNull()
    expect(rekey(s, 'walk', { x: 1 })).toBeNull()
  })

  it('leaves a mark that fits nowhere, so the world still refuses it', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(rekey(s, 'eat', { targetId: 'item_nothing' })).toBeNull()
    expect(rekey(s, 'sneeze', { targetId: 'item_bread_1' })).toBeNull()
  })
})

describe('submitIntent', () => {
  it('starts the filled act as if the mind had named the loaf', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {})
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const started = r.events.find((e) => e.type === 'action_started')!
    expect(started.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_bread_1' },
    })
  })

  it('reaches for the one skin only when there is no water to kneel at', () => {
    const dry = holding(withAgent(world(), 1, 1), 'item_skin_1', 'waterskin', 1)
    const started = (s: WorldState) => {
      const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'drink', {})
      expect(r.ok).toBe(true)
      return r.ok
        ? (r.events.find((e) => e.type === 'action_started')!.payload as {
            params: Record<string, unknown>
          })
        : null
    }
    expect(started(dry)!.params).toEqual({ itemId: 'item_skin_1' })
    // At the bank the paramless act is already good, so nothing is read into it.
    const bank = holding(withAgent(world(['.~......', '........']), 1, 1), 'i2', 'waterskin', 1)
    expect(started(bank)!.params).toEqual({})
  })

  it('starts the act on the mark it named, whatever word it arrived under', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', { targetId: 'item_fish_2' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Two edibles, so nothing could have been read in: only the mind's own naming got this act
    // started, and it got the fish it asked for rather than the loaf.
    expect(r.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_fish_2' },
    })
  })

  // The closed grammar answers every key it did not use with null, and a verdict handed straight
  // to the world arrives that way. A null is no mark, so the readings below are the same ones.
  it('reads a params object filled with nulls exactly as one that named nothing', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const r = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', { ...NO_PARAMS })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      verb: 'eat',
      params: { itemId: 'item_bread_1' },
    })
    // And the one mark it did name is still read off a body of nulls, under the wrong word.
    const named = submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {
      ...NO_PARAMS,
      targetId: 'item_bread_1',
    })
    expect(named.ok).toBe(true)
    if (!named.ok) return
    expect(named.events.find((e) => e.type === 'action_started')!.payload).toMatchObject({
      params: { itemId: 'item_bread_1' },
    })
  })

  it('still refuses an act the world cannot read one way, and names the two readings', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', {})).toEqual({
      ok: false,
      reason: 'which one, the bread (item_bread_1) or the fish (item_fish_2)?',
    })
  })
})

// The seam proved for the whole registry, not for `eat` alone: each verb parses a `.strict()`
// schema of its own keys, so the thirteen must be stripped before any of them sees them.
describe('every registered verb across the closed-params seam', () => {
  const NAMED: Record<string, unknown> = { itemId: 'item_bread_1', x: 1, y: 1, kind: 'bread' }

  it('reads the stripped answer exactly as the sparse one the world has always passed', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    expect(Object.keys(VERBS).length).toBeGreaterThan(30)
    for (const [verb, def] of Object.entries(VERBS)) {
      expect(namedParams({ ...NO_PARAMS, ...NAMED }), verb).toEqual(NAMED)
      expect(
        def.validate(s, DEFAULT_CONFIG, 'a1', namedParams({ ...NO_PARAMS, ...NAMED })),
        verb,
      ).toEqual(def.validate(s, DEFAULT_CONFIG, 'a1', NAMED))
    }
  })

  it('is refused by most of them with the nulls left on, so the stripping is load-bearing', () => {
    const s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    const refused = Object.values(VERBS).filter(
      (def) => def.validate(s, DEFAULT_CONFIG, 'a1', { ...NO_PARAMS, ...NAMED }) !== null,
    )
    expect(refused.length).toBeGreaterThan(20)
  })
})

// ★ THE DEFECT THIS BLOCK IS THE REGRESSION TEST FOR. A mind answers with every key it can think
// of — 94 of one rehearsal's 153 walks carried three or more — and each verb's params schema is
// strict. So an act that had named its fire, its loaf, its axe, its door and its skin was refused
// for the keys lying beside them, in words that blamed the name it had in fact written:
// "stoking needs the fire named", said to a body standing at the fire it had just named.
describe('an act named right and answered wide', () => {
  // Keys none of these five verbs reads: two coordinates guessed for a thing that has an id.
  const WIDE = { x: 51, y: 46, description: 'the fire in the long house', text: 'warmth' }

  const CASES: { verb: string; named: Record<string, unknown>; at: () => WorldState }[] = [
    {
      verb: 'stoke',
      named: { structureId: 'structure_fire_1' },
      at: () =>
        holding(
          withFire(withAgent(world(), 1, 1), 'structure_fire_1', 1, 2),
          'item_wood_1',
          'wood',
        ),
    },
    {
      verb: 'eat',
      named: { itemId: 'item_bread_1' },
      at: () => holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread'),
    },
    {
      verb: 'take',
      named: { itemId: 'item_wood_1' },
      at: () => onGround(withAgent(world(), 2, 2), 'item_wood_1', 'wood', 2, 3),
    },
    {
      verb: 'enter',
      named: { structureId: 'structure_house_1' },
      at: () => withHouse(withAgent(world(), 2, 3), 'structure_house_1', 2),
    },
    {
      verb: 'fill',
      named: { itemId: 'item_skin_1' },
      at: () => holding(withAgent(world(WATERSIDE), 1, 1), 'item_skin_1', 'waterskin', 0),
    },
  ]

  const startedBy = (r: ReturnType<typeof submitIntent>): Record<string, unknown> => {
    if (!r.ok) throw new Error(r.reason)
    return r.events.find((e) => e.type === 'action_started')!.payload as Record<string, unknown>
  }

  it('starts on the thing it named, however many keys arrived beside it', () => {
    for (const c of CASES) {
      const r = submitIntent(c.at(), DEFAULT_CONFIG, 'a1', c.verb, { ...c.named, ...WIDE })
      expect(r.ok ? null : r.reason, c.verb).toBeNull()
      // And the log records the act rather than the answer: a key the verb never read was
      // never part of what happened, and the state hash must not carry it.
      expect(startedBy(r), c.verb).toMatchObject({ verb: c.verb })
      expect(startedBy(r).params, c.verb).toEqual(c.named)
    }
  })

  it('reads the wide answer exactly as the sparse one the world has always passed', () => {
    for (const c of CASES) {
      const s = c.at()
      expect(
        submitIntent(s, DEFAULT_CONFIG, 'a1', c.verb, { ...c.named, ...WIDE }),
        c.verb,
      ).toEqual(submitIntent(s, DEFAULT_CONFIG, 'a1', c.verb, c.named))
      // Including the act that named nothing at all, which the world reads in for itself.
      expect(submitIntent(s, DEFAULT_CONFIG, 'a1', c.verb, WIDE), c.verb).toEqual(
        submitIntent(s, DEFAULT_CONFIG, 'a1', c.verb, {}),
      )
    }
  })

  it('still asks which one when the act named nothing and two things fit', () => {
    let s = holding(withAgent(world(), 1, 1), 'item_bread_1', 'bread')
    s = holding(s, 'item_fish_2', 'fish')
    expect(submitIntent(s, DEFAULT_CONFIG, 'a1', 'eat', WIDE)).toEqual({
      ok: false,
      reason: 'which one, the bread (item_bread_1) or the fish (item_fish_2)?',
    })
  })

  // A second, hand-written list of each verb's keys is the drift this seam is built without: it
  // could not know a word the town coined an hour ago. This one did not exist when the seam did.
  it('takes every key set off the verb itself, so a word minted now is laundered too', () => {
    const CastParams = z.object({ structureId: z.string() }).strict()
    const cast: VerbDef = {
      kind: 'cast',
      params: CastParams,
      validate: (_state, _config, _agentId, params) =>
        CastParams.safeParse(params).success ? null : 'casting needs the stone named',
      duration: () => 1,
      onComplete: () => [],
    }
    registerVerb(cast)
    try {
      expect(keysFor(cast)).toEqual(['structureId'])
      const r = submitIntent(withAgent(world(), 1, 1), DEFAULT_CONFIG, 'a1', 'cast', {
        structureId: 'structure_1',
        ...WIDE,
      })
      expect(startedBy(r).params).toEqual({ structureId: 'structure_1' })
    } finally {
      unregisterVerb('cast')
    }
    // And a charter verb, which brings no schema — only the closed keys its rulebook row reads.
    const bless: VerbDef = {
      kind: 'recipe:bless',
      reads: ['structureId'],
      validate: () => null,
      duration: () => 1,
      onComplete: () => [],
    }
    expect(keysFor(bless)).toEqual(['structureId'])
  })

  // What the log loses, the fold must never have needed. The walk is the one that proves it: its
  // path is laid again from the recorded params, and nowhere else.
  it('replays a log written from a wide answer to the state the live run left', () => {
    const walked = () => withAgent(world(), 0, 0)
    const runs: { name: string; at: () => WorldState; r: ReturnType<typeof submitIntent> }[] = [
      ...CASES.map((c) => ({
        name: c.verb,
        at: c.at,
        r: submitIntent(c.at(), DEFAULT_CONFIG, 'a1', c.verb, { ...c.named, ...WIDE }),
      })),
      {
        name: 'walk',
        at: walked,
        r: submitIntent(walked(), DEFAULT_CONFIG, 'a1', 'walk', {
          x: 3,
          y: 0,
          description: 'off to the mill',
          recipe: 'bread',
        }),
      },
    ]
    for (const run of runs) {
      if (!run.r.ok) throw new Error(`${run.name}: ${run.r.reason}`)
      const log = JSON.parse(JSON.stringify(run.r.events)) as { type: string; payload: unknown }[]
      expect(stateHash(replay(run.at(), log)), run.name).toBe(
        stateHash(replay(run.at(), run.r.events)),
      )
    }
  })

  // R2. Hands with nothing that holds water in them, and the world knows it: sending the mind
  // back for a word it could not have written refused one body's `fill` ten times in three days.
  it('tells empty hands what is absent rather than asking for the vessel', () => {
    const dry = withAgent(world(WATERSIDE), 1, 1)
    const absent = { ok: false, reason: 'not holding that' }
    expect(submitIntent(dry, DEFAULT_CONFIG, 'a1', 'fill', {})).toEqual(absent)
    expect(submitIntent(dry, DEFAULT_CONFIG, 'a1', 'fill', WIDE)).toEqual(absent)
  })
})
