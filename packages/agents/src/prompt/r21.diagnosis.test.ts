import { describe, expect, it } from 'vitest'
import {
  composePerception, doorTile, findPath, fold, genesisState, makeGenesisWorld, submitIntent,
  type WorldState,
} from '@sj/engine'
import { CITY_ANCHOR_DEFAULT, DEFAULT_CONFIG, FOUNDER_IDS, type SimEvent } from '@sj/shared'
import { perceptionToProse, type PerceptionPacket } from './prose.js'
import { CAPABILITIES } from './rulesOfBeing.js'

// R21 — WHY the town talks and cannot feed itself. Five candidate causes were named; these
// rows are the measurement that decides between them, taken on the SAME world the live gate
// runs on. Each row says which candidate it settles. The candidates that survive are the ones
// the batch fixes; the two that die here are recorded so nobody spends the effort twice.
//
// Companion prose: docs/superpowers/plans/c11-r21-diagnosis.md.

const CFG = DEFAULT_CONFIG
// The hour the live gate starts at: full daylight, so nothing here is an artifact of the dark.
const MORNING_TICK = 420

let seq = 0
const ev = (type: string, payload: unknown): SimEvent =>
  ({ seq: ++seq, tick: 0, type, payload } as unknown as SimEvent)

// The genesis town with its five founders each at their own doorway — the exact opening
// position `g11-deepworld.ts` builds before the first turn is asked for.
function genesisTown(): WorldState {
  const g = makeGenesisWorld(CFG)
  let s = genesisState(CFG, g.terrain)
  for (const e of g.events) s = fold(s, ev(e.type, e.payload), CFG)
  for (const id of FOUNDER_IDS) {
    const hut = Object.values(s.structures).find((st) => st.kind === 'hut' && st.owner === id)
    const door = hut === undefined ? null : doorTile(s, hut)
    if (door === null) throw new Error(`no doorway for ${id}`)
    s = fold(s, ev('agent_spawned', { id, name: id, x: door.x, y: door.y, ageDays: 10000 }), CFG)
  }
  return { ...s, tick: MORNING_TICK }
}

// The same mapping `EngineBridge` does, so these rows read the prose a mind actually reads.
function prosePacket(state: WorldState, agentId: string): PerceptionPacket {
  const p = composePerception(state, CFG, agentId, [])
  const a = state.agents[agentId]!
  return {
    ...p,
    self: {
      ...p.self,
      asleep: a.asleep,
      collapsed: a.collapsedSinceTick !== null,
      inventory: p.self.inventory.map((i) => ({ id: i.id, kind: i.kind, qty: i.qty, loc: i.loc })),
    },
    visible: {
      ...p.visible,
      items: p.visible.items.map((i) => ({
        id: i.id, kind: i.kind, qty: i.qty, loc: { t: 'tile' as const, x: i.x, y: i.y },
      })),
    },
  } as PerceptionPacket
}

const WORLD = {
  isWalkable: () => true,
  isEdible: (kind: string) => kind === 'bread' || kind === 'berries',
  waterAtHand: () => false,
  nearestWater: () => ({ x: 50, y: 62 }),
}

const proseFor = (state: WorldState, agentId: string): string =>
  perceptionToProse(prosePacket(state, agentId), undefined, WORLD)

// ------------------------------------------------- candidate 4: distance. REFUTED.

describe('R21 candidate 4 — "distance makes gathering irrational": REFUTED', () => {
  it('every founder is inside half an hour of a standing berry bush, on a path that exists', () => {
    const s = genesisTown()
    const steps: Record<string, number> = {}
    for (const id of FOUNDER_IDS) {
      const a = s.agents[id]!
      let best = Infinity
      for (const n of Object.values(s.forageables ?? {})) {
        if (n.kind !== 'berry_bush') continue
        const path = findPath(s, a, { x: n.x, y: n.y }, CFG)
        if (path !== null && path.length < best) best = path.length
      }
      steps[id] = best
    }
    // 17 to 21 tiles, and the ground costs one tick a tile to a body that is not debuffed.
    expect(Object.values(steps).every((n) => n >= 17 && n <= 21)).toBe(true)
    expect(CFG.movement.baseTicksPerTile).toBe(1)
    // The round trip is 2% of a sixteen-hour waking day. Distance is not what stopped them.
    const worstRoundTripTicks = Math.max(...Object.values(steps)) * 2 * CFG.movement.baseTicksPerTile
    expect(worstRoundTripTicks).toBeLessThan(0.05 * 16 * 60)
  })

  it('a herb patch is nearer still, and the healer never went to one either', () => {
    const s = genesisTown()
    const amara = s.agents.amara!
    const herb = Object.values(s.forageables ?? {}).filter((n) => n.kind === 'herb_patch')
    const best = Math.min(...herb.map((n) => findPath(s, amara, { x: n.x, y: n.y }, CFG)?.length ?? Infinity))
    expect(best).toBe(15)
  })
})

// ------------------------------------------------- candidate 2: perception. CONFIRMED.

describe('R21 candidate 2 — "perception omits it": CONFIRMED', () => {
  it('not one founder can see a single forageable node or a single animal on the first morning', () => {
    const s = genesisTown()
    for (const id of FOUNDER_IDS) {
      const p = composePerception(s, CFG, id, [])
      expect(p.visible.forageables).toHaveLength(0)
      expect(p.visible.fauna).toHaveLength(0)
    }
  })

  it('the horizon is shorter than the nearest food: a mind can never name the node it needs', () => {
    // `forage` wants a nodeId and a thing's mark "becomes known to you only once you stand
    // beside where it rests and see it". Sight stops four tiles short of the nearest bush.
    expect(CFG.movement.sightRadius).toBe(12)
    const s = genesisTown()
    const nadia = s.agents.nadia!
    const nearest = Math.min(...Object.values(s.forageables ?? {})
      .filter((n) => n.kind === 'berry_bush')
      .map((n) => findPath(s, nadia, { x: n.x, y: n.y }, CFG)?.length ?? Infinity))
    expect(nearest).toBeGreaterThan(CFG.movement.sightRadius)
  })

  it('a body carries no visible condition: the healer cannot see the fever standing next to him', () => {
    const s = genesisTown()
    // Salma wakes with the staged fever the live gate seeds, and she dies of it.
    const sick = fold(s, ev('agent_afflicted', { agentId: 'salma', kind: 'illness', severity: 3 }), CFG)
    const salma = composePerception(sick, CFG, 'omar', []).visible.agents.find((a) => a.id === 'salma')
    expect(salma).toBeDefined()
    // R21-C. A pair of eyes used to get a name, a place, a verb, asleep, collapsed and an age
    // band, and nothing about the body under it. It now gets the ailment too, in words.
    expect(salma!.condition).toBe('flushed with fever')
    expect(proseFor(sick, 'omar')).toContain('salma (salma) stands at (74, 62), flushed with fever.')

    // And a town with nothing wrong with it reads exactly as it always did.
    expect(proseFor(s, 'omar')).toContain('salma (salma) stands at (74, 62).')
  })
})

// ------------------------------------------------- candidate 1: the prose. CONFIRMED, PRIMARY.

describe('R21 candidate 1 — "the prose never names the opportunity": CONFIRMED', () => {
  it('a body indoors is told to go indoors: the prose gives an instruction the world refuses', () => {
    const s = genesisTown()
    const hut = Object.values(s.structures).find((st) => st.kind === 'hut' && st.owner === 'nadia')!
    const inside: WorldState = {
      ...s,
      agents: { ...s.agents, nadia: { ...s.agents.nadia!, insideId: hut.id, x: hut.x, y: hut.y } },
    }
    const prose = proseFor(inside, 'nadia')
    // R21-A. The defect was that no line said she was under a roof, and the one line about
    // the roof she was under told her to walk to its doorway and go in — 59 of the run's 222
    // refusals. Both halves are now said the other way round.
    expect(prose).toContain(`You stand inside the hut (${hut.id}) at (68, 60).`)
    expect(prose).toContain('Four walls are around you')
    expect(prose).toContain('this is the roof you are under; the way out is at (68, 62).')
    expect(prose).not.toContain('stand there and you can go in')
    // The world's answer to the instruction that used to be given, twice over.
    expect(submitIntent(inside, CFG, 'nadia', 'enter', { structureId: hut.id })).toEqual(
      { ok: false, reason: 'already inside' },
    )
    expect(submitIntent(inside, CFG, 'nadia', 'walk', { x: 68, y: 47 })).toEqual(
      { ok: false, reason: 'you are indoors; step outside first' },
    )
  })

  it('a body already walking is told it is standing still', () => {
    const s = genesisTown()
    const walking: WorldState = {
      ...s,
      agents: {
        ...s.agents,
        nadia: {
          ...s.agents.nadia!,
          activity: { verb: 'walk', params: { x: 68, y: 47 }, ticksRemaining: 17 },
        },
      },
    }
    // R21-A. The packet carried it and the prose dropped it; now the legs say where they
    // are going, so a mind that has already set out does not set out again.
    const p = composePerception(walking, CFG, 'nadia', [])
    expect(p.self.activity).toBe('walk')
    expect(p.self.activityToward).toEqual({ x: 68, y: 47 })
    expect(proseFor(walking, 'nadia'))
      .toContain('Your legs are already carrying you toward (68, 47)')

    // A pair of hands busy with something that is not a walk says so without a destination.
    const cutting: WorldState = {
      ...s,
      agents: {
        ...s.agents,
        nadia: { ...s.agents.nadia!, activity: { verb: 'chop', params: {}, ticksRemaining: 8 } },
      },
    }
    expect(proseFor(cutting, 'nadia')).toContain('you are partway through chop')
  })

  it('thirst is given a road and hunger is not, and the run drank fifteen times and ate once', () => {
    const s = genesisTown()
    const dry: WorldState = {
      ...s,
      agents: { ...s.agents, nadia: { ...s.agents.nadia!, thirst: 10, needs: { ...s.agents.nadia!.needs, hunger: 10 } } },
    }
    const prose = perceptionToProse(prosePacket(dry, 'nadia'), undefined, {
      ...WORLD,
      nearestFood: () => ({ x: 68, y: 60, kind: 'bread' }),
    })
    expect(prose).toContain('The nearest water you know of lies at (50, 62)')
    // R21-B. The stomach used to get a sensation and no road; it now gets the road thirst
    // has had, and only when the hands are empty.
    expect(prose).toContain('Your stomach gnaws at you')
    expect(prose).toContain('The nearest food you know of is bread at (68, 60).')

    // A hand already holding a loaf is told about the loaf, not sent across town for one.
    const held: WorldState = {
      ...dry,
      items: {
        ...dry.items,
        held_loaf: { id: 'held_loaf', kind: 'bread', qty: 1, loc: { t: 'agent', id: 'nadia' } },
      },
    }
    const fed = perceptionToProse(prosePacket(held, 'nadia'), undefined, {
      ...WORLD,
      nearestFood: () => ({ x: 0, y: 0, kind: 'berries' }),
    })
    expect(fed).toContain('Your satchel holds bread (held_loaf) — you could eat it now.')
    expect(fed).not.toContain('The nearest food you know of')
  })

  it('a founder wakes with an empty satchel and the loaves on a shelf behind a wall', () => {
    const s = genesisTown()
    const p = composePerception(s, CFG, 'amara', [])
    expect(p.self.inventory).toHaveLength(0)
    // Six things, all of them on the hut's shelf; the doorway peek shows them and the hands
    // hold none of them. `eat` answers "not holding that" and the road there is never named.
    expect(p.visible.items).toHaveLength(6)
    const bread = p.visible.items.find((i) => i.kind === 'bread')!
    expect(submitIntent(s, CFG, 'amara', 'eat', { itemId: bread.id })).toEqual(
      { ok: false, reason: 'not holding that' },
    )
    expect(submitIntent(s, CFG, 'amara', 'take', { itemId: bread.id }).ok).toBe(true)
  })

  it('the makeable vocabulary is never spoken: seven nouns the world knows and no mind is given', () => {
    // `build` wants a kind and `craft` wants a recipe, and by the canon-vocabulary law a word
    // a mind is never given is a word it never uses. Nothing in the prompt names one.
    const buildable = Object.keys(CFG.structures.recipes).sort()
    const craftable = Object.keys(CFG.crafting.recipes).sort()
    expect(buildable).toEqual(['bridge', 'grave', 'hut', 'well'])
    expect(craftable).toEqual(['cloth', 'garment', 'plank'])
    // The one place a mind is taught its verbs asks for both nouns and names neither, and
    // nothing else in the prompt fills the gap. `well` is the exception that proves it: the
    // word reaches a mind only as a building already standing, never as one it could raise.
    expect(CAPABILITIES).toContain('give kind, the thing to raise')
    expect(CAPABILITIES).toContain('give recipe, the name of what you shape')
    // Not one of the four buildable kinds, and of the six recipes only the two whose product
    // another verb happens to need in hand — and those two are named as things to hold, never
    // as things to shape.
    for (const noun of [...buildable, 'plank', 'cloth', 'stew']) {
      expect(CAPABILITIES.includes(noun)).toBe(false)
    }
    expect(CAPABILITIES).toContain('the garment you hold')
    expect(CAPABILITIES).toContain('the torch or lamp you hold')
    const s = genesisTown()
    const everyProse = FOUNDER_IDS.map((id) => proseFor(s, id)).join(' ')
    expect(everyProse).toContain('A well (structure_9) stands at')
    for (const noun of ['hut', 'bridge', 'grave', ...craftable, 'stew', 'torch']) {
      expect(everyProse).not.toMatch(new RegExp(`(build|craft|raise|shape|make)[^.]{0,40}${noun}`, 'i'))
    }
  })
})

// ------------------------------------------------- candidate 3: the refusals. CONFIRMED.

describe('R21 candidate 3 — "refusal text teaches nothing": CONFIRMED', () => {
  // Every designed survival-social overlap, asked from a founder's own doorway on the first
  // morning, and what the world says back. Only one of these leaves a door open.
  const EXPECTED: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['forage', {}, 'no forest nearby'],
    ['hunt', {}, 'hunt needs a {faunaId}'],
    ['fish', { x: 62, y: 62 }, 'no water there'],
    ['craft', { recipe: 'stew' }, 'not enough meat'],
    ['craft', { recipe: 'garment' }, 'not enough cloth'],
    ['build', { kind: 'hut', x: 66, y: 66 }, 'not close enough to build'],
    ['tend', { targetId: 'yusuf' }, 'not adjacent to the patient'],
    ['douse', { x: 62, y: 62 }, 'nothing is burning there'],
    ['pave', { x: 62, y: 63 }, 'not enough stone'],
  ]

  it('nine refusals, and not one of them names where to go or what to carry', () => {
    const s = genesisTown()
    for (const [verb, params, reason] of EXPECTED) {
      expect({ verb, ...submitIntent(s, CFG, 'amara', verb, params) })
        .toEqual({ verb, ok: false, reason })
      // A door left open would name a place, a distance, or a thing to fetch. None do.
      expect(reason).not.toMatch(/\(\d+, ?\d+\)|steps|perhaps|try|fetch/)
    }
  })

  it('the one refusal that does teach is the craft the world has never heard of', () => {
    const s = genesisTown()
    expect(submitIntent(s, CFG, 'amara', 'craft', { recipe: 'bread' })).toEqual({
      ok: false,
      reason: 'no such recipe: bread — perhaps someone nearby knows how, or it wants discovering.',
    })
  })

  it('a named node out of arm’s reach is refused without a distance or a direction', () => {
    const s = genesisTown()
    const bush = Object.values(s.forageables ?? {}).find((n) => n.kind === 'berry_bush')!
    const id = Object.keys(s.forageables ?? {}).find((k) => s.forageables![k] === bush)!
    expect(submitIntent(s, CFG, 'amara', 'forage', { nodeId: id })).toEqual(
      { ok: false, reason: 'not close enough to gather' },
    )
  })
})

// ------------------------------------------------- the town the diagnosis is about

describe('R21 — the shape of the founding site, so the abundance pass has a baseline', () => {
  it('five doorways in a row, and the anchor the template was laid from', () => {
    const s = genesisTown()
    expect(CITY_ANCHOR_DEFAULT).toEqual({ x: 48, y: 56 })
    expect(FOUNDER_IDS.map((id) => [s.agents[id]!.x, s.agents[id]!.y])).toEqual(
      [[62, 62], [65, 62], [68, 62], [71, 62], [74, 62]],
    )
  })
})
