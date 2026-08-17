import { describe, expect, it } from 'vitest'
import {
  composePerception, doorTile, fold, genesisState, makeGenesisWorld, searchPath, submitIntent,
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

// A capped search returns how far it got, not how far it is: half the genesis forage table
// is across the river, and `findPath` answers those with a partial that reads like a short
// walk. Every distance below is a real one.
function walk(state: WorldState, agentId: string, x: number, y: number): number | null {
  const r = searchPath(state, state.agents[agentId]!, { x, y }, CFG)
  return r === null || r.capped ? null : r.path.length
}

const nearestOfKind = (state: WorldState, agentId: string, kind: string): number | null => {
  let best: number | null = null
  for (const n of Object.values(state.forageables ?? {})) {
    if (n.kind !== kind) continue
    const d = walk(state, agentId, n.x, n.y)
    if (d !== null && (best === null || d < best)) best = d
  }
  return best
}

describe('R21 candidate 4 — "distance makes gathering irrational": REFUTED', () => {
  it('the bushes that were always there are a twenty-minute walk, and the ground is one tick a tile', () => {
    const s = genesisTown()
    // The four authored bushes, before R14 put three more in the town's own meadow: 17 to 21
    // steps from a founder's door, every one of them on a path that finishes.
    const authored = [{ x: 62, y: 44 }, { x: 68, y: 47 }, { x: 59, y: 92 }, { x: 71, y: 96 }]
    const nearest = FOUNDER_IDS.map((id) => {
      const d = authored.map((b) => walk(s, id, b.x, b.y)).filter((n): n is number => n !== null)
      return Math.min(...d)
    })
    expect(nearest).toEqual([20, 18, 17, 18, 21])
    expect(CFG.movement.baseTicksPerTile).toBe(1)
    // The worst round trip is under 5% of a sixteen-hour waking day. Distance is not what
    // stopped them, so this is an effectiveness defect before it is an abundance one.
    expect(Math.max(...nearest) * 2 * CFG.movement.baseTicksPerTile).toBeLessThan(0.05 * 16 * 60)
  })

  it('R14: three patches now stand inside the town, and the far bank is still a bridge away', () => {
    const s = genesisTown()
    // Every founder is a quarter-hour from a bush and the healer from his herbs, where before
    // the nearest bush was seventeen steps and every near herb patch was over the water.
    expect(FOUNDER_IDS.map((id) => nearestOfKind(s, id, 'berry_bush'))).toEqual([11, 10, 7, 6, 9])
    expect(FOUNDER_IDS.map((id) => nearestOfKind(s, id, 'herb_patch'))).toEqual([15, 12, 9, 6, 5])
    // And nothing over the water moved: the west bank answers a capped search, as it always did.
    for (const [x, y] of [[45, 62], [46, 66], [47, 70], [22, 100]] as Array<[number, number]>) {
      expect(walk(s, 'amara', x, y)).toBeNull()
    }
  })

  it('before R14 the healer had no herbs at all: every near patch is over the water', () => {
    const s = genesisTown()
    // The three authored herb patches. Two are on the far bank and answer a capped search;
    // the one that is reachable is fifty-four steps south, most of a working morning.
    expect(walk(s, 'amara', 46, 33)).toBeNull()
    expect(walk(s, 'amara', 46, 66)).toBeNull()
    expect(walk(s, 'amara', 52, 100)).toBe(54)
    // Seven of the twenty authored nodes are across the river — two herb patches, both clay
    // banks, all three stone outcrops and a reed bed. Nothing R14 adds is over there.
    const unreachable = Object.keys(s.forageables ?? {}).filter((id) => {
      const n = s.forageables![id]!
      return walk(s, 'amara', n.x, n.y) === null
    })
    expect(unreachable).toHaveLength(7)
  })
})

// ------------------------------------------------- candidate 2: perception. CONFIRMED.

describe('R21 candidate 2 — "perception omits it": CONFIRMED', () => {
  it('no animal is in sight on the first morning, and none was ever brought nearer', () => {
    const s = genesisTown()
    for (const id of FOUNDER_IDS) expect(composePerception(s, CFG, id, []).visible.fauna).toHaveLength(0)
    // The nearest thing with meat on it is a long walk away and it moves. `craft stew` wants
    // meat, meat wants a hunt, and a hunt wants a mark no mind has ever been given: that whole
    // chain is still broken at its first link, and it is why the shared stew never happened.
    const nearestBeast = Math.min(...Object.values(s.fauna ?? {})
      .filter((f) => f.kind !== 'fish')
      .map((f) => walk(s, 'amara', f.x, f.y) ?? Infinity))
    expect(nearestBeast).toBe(27)
    expect(nearestBeast).toBeGreaterThan(CFG.movement.sightRadius)
  })

  it('R14: every founder now wakes up looking at a patch they can name', () => {
    // `forage` wants a nodeId and a thing's mark "becomes known to you only once you stand
    // beside where it rests and see it". Before R14 sight stopped five tiles short of the
    // nearest bush and no mind could ever name one.
    expect(CFG.movement.sightRadius).toBe(12)
    const s = genesisTown()
    for (const id of FOUNDER_IDS) {
      const seen = composePerception(s, CFG, id, []).visible.forageables
      expect(seen.length).toBeGreaterThanOrEqual(2)
      // And what a mind is handed is a phrase and a mark, not a count of what is left in it.
      expect(seen.every((n) => n.prose.length > 0 && !/[0-9]/.test(n.prose))).toBe(true)
    }
    // Nadia, whose whole standing goal is berries, can name two of them from her own doorway.
    expect(composePerception(s, CFG, 'nadia', []).visible.forageables.map((n) => n.kind).sort())
      .toEqual(['berry_bush', 'berry_bush', 'herb_patch'])
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
    // hold none of them. R21-D: `eat` used to answer "not holding that" and stop there.
    expect(p.visible.items).toHaveLength(6)
    const bread = p.visible.items.find((i) => i.kind === 'bread')!
    expect(submitIntent(s, CFG, 'amara', 'eat', { itemId: bread.id })).toEqual(
      { ok: false, reason: 'not holding that — take it into your hands first' },
    )
    expect(submitIntent(s, CFG, 'amara', 'take', { itemId: bread.id }).ok).toBe(true)
    // A mark for nothing that exists still says only that the hands are empty.
    expect(submitIntent(s, CFG, 'amara', 'eat', { itemId: 'item_nowhere' })).toEqual(
      { ok: false, reason: 'not holding that' },
    )
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

// ------------------------------------------------- candidate 3: the refusals. CONFIRMED, FIXED.

describe('R21 candidate 3 — "refusal text teaches nothing": CONFIRMED, and R21-D answers it', () => {
  // Every designed survival-social overlap, asked from a founder's own doorway on the first
  // morning. The left column is what the world used to say and stop; the right is the door
  // the same refusal now leaves open (addendum §9).
  const NOW: ReadonlyArray<[string, Record<string, unknown>, string]> = [
    ['forage', {}, 'no forest nearby — berries, mushrooms and herbs grow in patches, and a patch is gathered by name once you can see one'],
    ['craft', { recipe: 'stew' }, 'not enough meat — meat comes off an animal you have hunted, or a fish out of the water'],
    ['craft', { recipe: 'garment' }, 'not enough cloth — cloth is woven from fiber'],
    ['build', { kind: 'hut', x: 66, y: 66 }, 'not close enough to build — stand within reach of (66, 66)'],
    ['tend', { targetId: 'yusuf' }, 'not adjacent to the patient — they are at (65, 62)'],
    ['give', { itemId: 'item_17', targetId: 'yusuf' }, 'not adjacent to give — they are at (65, 62)'],
    ['pave', { x: 62, y: 63 }, 'not enough stone — stone comes from the loose rock at the foot of an outcrop'],
  ]

  it('every refusal that used to be a wall now names a place or a source', () => {
    const s = genesisTown()
    for (const [verb, params, reason] of NOW) {
      expect({ verb, ...submitIntent(s, CFG, 'amara', verb, params) })
        .toEqual({ verb, ok: false, reason })
      expect(reason).toMatch(/ — /)
    }
  })

  it('the refusals that were already honest are left exactly as they were', () => {
    const s = genesisTown()
    // Nothing to teach: the water is not here, nothing is alight, and the mark is missing.
    for (const [verb, params, reason] of [
      ['fish', { x: 62, y: 62 }, 'no water there'],
      ['douse', { x: 62, y: 62 }, 'nothing is burning there'],
      ['hunt', {}, 'hunt needs a {faunaId}'],
    ] as ReadonlyArray<[string, Record<string, unknown>, string]>) {
      expect(submitIntent(s, CFG, 'amara', verb, params)).toEqual({ ok: false, reason })
    }
    // And the one that always did leave a door open still does.
    expect(submitIntent(s, CFG, 'amara', 'craft', { recipe: 'bread' })).toEqual({
      ok: false,
      reason: 'no such recipe: bread — perhaps someone nearby knows how, or it wants discovering.',
    })
  })

  it('a named node out of arm\u2019s reach is now refused with the place to stand', () => {
    const s = genesisTown()
    const id = Object.keys(s.forageables ?? {})
      .find((k) => s.forageables![k]!.kind === 'berry_bush')!
    const node = s.forageables![id]!
    expect(submitIntent(s, CFG, 'amara', 'forage', { nodeId: id })).toEqual({
      ok: false,
      reason: `not close enough to gather — the patch is at (${node.x}, ${node.y}); stand beside it`,
    })
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
