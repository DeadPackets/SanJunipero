import { describe, expect, it } from 'vitest'
import {
  composePerception,
  doorTile,
  fold,
  genesisState,
  makeables,
  makeGenesisWorld,
  searchPath,
  submitIntent,
  type WorldState,
} from '@sj/engine'
import { CITY_ANCHOR_DEFAULT, DEFAULT_CONFIG, FOUNDER_IDS, type SimEvent } from '@sj/shared'
import { makeablesLine, perceptionToProse, type PerceptionPacket } from './prose.js'
import { CAPABILITIES } from './rulesOfBeing.js'

// Each row measures one candidate cause on the same world the live gate runs on, and says
// which candidate it settles. When the town's layout moves these numbers move: keep the claim,
// carry the new number, and say so out loud when the claim itself changed.
// Companion prose: docs/superpowers/plans/c11-r21-diagnosis.md.

const CFG = DEFAULT_CONFIG
// The hour the live gate starts at: full daylight, so nothing here is an artifact of the dark.
const MORNING_TICK = 420

let seq = 0
const ev = (type: string, payload: unknown): SimEvent => ({ seq: ++seq, tick: 0, type, payload })

// The genesis town with its five founders each at their own doorway — the exact opening
// position `g11-deepworld.ts` builds before the first turn is asked for.
function genesisTown(): WorldState {
  const g = makeGenesisWorld(CFG)
  let s = genesisState(CFG, g.terrain)
  for (const e of g.events) s = fold(s, ev(e.type, e.payload), CFG)
  for (const id of FOUNDER_IDS) {
    const house = Object.values(s.structures).find((st) => st.kind === 'house' && st.owner === id)
    const door = house === undefined ? null : doorTile(s, house)
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
        id: i.id,
        kind: i.kind,
        qty: i.qty,
        loc: { t: 'tile' as const, x: i.x, y: i.y },
      })),
    },
  }
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

// A capped search returns how far it got, not how far it is, so every distance below is real.
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
    // The four authored bushes are 13 to 34 steps from a founder's door, all on paths that finish.
    const authored = [
      { x: 62, y: 44 },
      { x: 68, y: 47 },
      { x: 59, y: 92 },
      { x: 71, y: 96 },
    ]
    const nearest = FOUNDER_IDS.map((id) => {
      const d = authored.map((b) => walk(s, id, b.x, b.y)).filter((n): n is number => n !== null)
      return Math.min(...d)
    })
    expect(nearest).toEqual([34, 25, 13, 27, 20])
    expect(CFG.movement.baseTilesPerTick).toBe(3)
    // The worst round trip is under a tenth of a sixteen-hour waking day, so distance is not it.
    expect((Math.max(...nearest) * 2) / CFG.movement.baseTilesPerTick).toBeLessThan(0.1 * 16 * 60)
  })

  it('R14: the town keeps its own meadow, and the far bank is still a bridge away', () => {
    const s = genesisTown()
    // Every founder is a quarter-hour from a bush and from herbs, across two blocks now.
    expect(FOUNDER_IDS.map((id) => nearestOfKind(s, id, 'berry_bush'))).toEqual([
      10, 11, 13, 13, 10,
    ])
    expect(FOUNDER_IDS.map((id) => nearestOfKind(s, id, 'herb_patch'))).toEqual([11, 12, 13, 15, 8])
    // And nothing over the water moved: the west bank answers a capped search, as it always did.
    for (const [x, y] of [
      [45, 62],
      [46, 66],
      [47, 70],
      [22, 100],
    ] as [number, number][]) {
      expect(walk(s, 'amara', x, y)).toBeNull()
    }
  })

  it('before R14 the healer had no herbs at all: every near patch is over the water', () => {
    const s = genesisTown()
    // The three authored herb patches. Two are on the far bank and answer a capped search;
    // the one that is reachable is sixty-one steps south, most of a working morning.
    expect(walk(s, 'amara', 46, 33)).toBeNull()
    expect(walk(s, 'amara', 46, 66)).toBeNull()
    expect(walk(s, 'amara', 52, 100)).toBe(61)
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
  it('no animal worth eating is in sight on the first morning, and none was brought nearer', () => {
    const s = genesisTown()
    // Three of the five wake with something alive in view, but that is a hunt and not a meal.
    const inSight = FOUNDER_IDS.map((id) =>
      composePerception(s, CFG, id, [])
        .visible.fauna.map((f) => f.kind)
        .sort(),
    )
    expect(inSight).toEqual([['deer'], [], ['deer', 'rabbit'], ['rabbit'], ['rabbit']])
    // `craft stew` wants meat, meat wants a hunt, and a hunt wants a mark no mind was given.
    const nearestBeast = Math.min(
      ...Object.values(s.fauna ?? {})
        .filter((f) => f.kind !== 'fish')
        .map((f) => walk(s, 'amara', f.x, f.y) ?? Infinity),
    )
    expect(nearestBeast).toBe(14)
    expect(nearestBeast).toBeGreaterThan(CFG.movement.sightRadius)
  })

  it('R14: every founder now wakes up looking at a patch they can name', () => {
    // `forage` wants a nodeId, and a mark is known only once a body stands beside the thing.
    expect(CFG.movement.sightRadius).toBe(12)
    const s = genesisTown()
    for (const id of FOUNDER_IDS) {
      const seen = composePerception(s, CFG, id, []).visible.forageables
      expect(seen.length).toBeGreaterThanOrEqual(2)
      // And what a mind is handed is a phrase and a mark, not a count of what is left in it.
      expect(seen.every((n) => n.prose.length > 0 && !/[0-9]/.test(n.prose))).toBe(true)
    }
    // Nadia, whose whole standing goal is berries, can name two of them from her own doorway.
    expect(
      composePerception(s, CFG, 'nadia', [])
        .visible.forageables.map((n) => n.kind)
        .sort(),
    ).toEqual(['berry_bush', 'berry_bush', 'herb_patch', 'pale_mushroom_patch'])
  })

  it('a body carries no visible condition: the healer cannot see the fever standing next to him', () => {
    const s = genesisTown()
    // Salma wakes with the staged fever the live gate seeds, and she dies of it.
    const sick = fold(
      s,
      ev('agent_afflicted', { agentId: 'salma', kind: 'illness', severity: 3 }),
      CFG,
    )
    // Read from omar, who shares the south block's street with her: amara is two blocks north
    // now, and forty tiles is well beyond anybody's sight.
    const salma = composePerception(sick, CFG, 'omar', []).visible.agents.find(
      (a) => a.id === 'salma',
    )
    expect(salma).toBeDefined()
    // R21-C. A pair of eyes used to get a name, a place, a verb, asleep, collapsed and an age
    // band, and nothing about the body under it. It now gets the ailment too, in words.
    expect(salma!.condition).toBe('flushed with fever')
    expect(proseFor(sick, 'omar')).toContain(
      'salma (salma) stands at (74, 113), flushed with fever.',
    )

    // And a town with nothing wrong with it reads exactly as it always did.
    expect(proseFor(s, 'omar')).toContain('salma (salma) stands at (74, 113).')
  })
})

// ------------------------------------------------- candidate 1: the prose. CONFIRMED, PRIMARY.

describe('R21 candidate 1 — "the prose never names the opportunity": CONFIRMED', () => {
  it('a body indoors is told to go indoors: the prose gives an instruction the world refuses', () => {
    // Nadia's house stands roofless in the founding valley now, and a body cannot be under a
    // roof that is not there. This test is about the sentence, so it puts the roof back on.
    const roofless = Object.values(genesisTown().structures).find(
      (st) => st.kind === 'house' && st.owner === 'nadia',
    )!
    const s = fold(genesisTown(), ev('structure_completed', { id: roofless.id }), CFG)
    const house = s.structures[roofless.id]!
    expect(house.stage).toBe('complete')
    const inside: WorldState = {
      ...s,
      agents: {
        ...s.agents,
        nadia: { ...s.agents.nadia!, insideId: house.id, x: house.x, y: house.y },
      },
    }
    const prose = proseFor(inside, 'nadia')
    // R21-A. No line said she was under a roof, and the roof line sent her to its own doorway.
    expect(prose).toContain(`You stand inside the house (${house.id}) at (79, 99).`)
    expect(prose).toContain('Four walls are around you')
    expect(prose).toContain('this is the roof you are under; the way out is at (81, 99).')
    expect(prose).not.toContain('stand there and you can go in')
    // The world's answer to the instruction that used to be given: both acts now stand, the
    // first because she is already under that roof, the second by way of its door.
    expect(submitIntent(inside, CFG, 'nadia', 'enter', { structureId: house.id }).ok).toBe(true)
    expect(submitIntent(inside, CFG, 'nadia', 'walk', { x: 68, y: 47 }).ok).toBe(true)
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
    expect(proseFor(walking, 'nadia')).toContain(
      'Your legs are already carrying you toward (68, 47)',
    )

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
      agents: {
        ...s.agents,
        nadia: { ...s.agents.nadia!, thirst: 10, needs: { ...s.agents.nadia!.needs, hunger: 10 } },
      },
    }
    const prose = perceptionToProse(prosePacket(dry, 'nadia'), undefined, {
      ...WORLD,
      nearestFood: () => ({ x: 68, y: 60, kind: 'bread' }),
    })
    expect(prose).toContain('The nearest water you know of lies at (50, 62)')
    // R21-B. The stomach used to get a sensation and no road; it now gets the road thirst
    // has had, and only when the hands are empty.
    expect(prose).toContain('Hunger is all you can think about.')
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
    expect(fed).toContain('Your satchel holds bread (held_loaf). You could eat it now.')
    expect(fed).not.toContain('The nearest food you know of')
  })

  it('loneliness is given a road, and it waits below the survival ones', () => {
    const s = genesisTown()
    const world = { ...WORLD, nearestPerson: () => ({ x: 62, y: 55, name: 'Omar' }) }
    const lonely: WorldState = {
      ...s,
      agents: {
        ...s.agents,
        nadia: { ...s.agents.nadia!, needs: { ...s.agents.nadia!.needs, social: 10 } },
      },
    }
    const prose = perceptionToProse(prosePacket(lonely, 'nadia'), undefined, world)
    expect(prose).toContain('Loneliness settles over you.')
    expect(prose).toContain('The nearest person you know of is Omar, at (62, 55).')

    // One road a turn: a dry throat outranks a lonely one and the social line goes quiet.
    const dry: WorldState = {
      ...lonely,
      agents: { ...lonely.agents, nadia: { ...lonely.agents.nadia!, thirst: 10 } },
    }
    const thirsty = perceptionToProse(prosePacket(dry, 'nadia'), undefined, world)
    expect(thirsty).toContain('The nearest water you know of lies at (50, 62)')
    expect(thirsty).not.toContain('The nearest person you know of')
  })

  it('a founder wakes with an empty satchel and the loaves on a shelf behind a wall', () => {
    const s = genesisTown()
    const p = composePerception(s, CFG, 'amara', [])
    expect(p.self.inventory).toHaveLength(0)
    // Six things, all of them on the house's shelf; the doorway peek shows them and the hands
    // hold none of them. R21-D: `eat` used to answer "not holding that" and stop there.
    expect(p.visible.items).toHaveLength(6)
    const bread = p.visible.items.find((i) => i.kind === 'bread')!
    expect(submitIntent(s, CFG, 'amara', 'take', { itemId: bread.id }).ok).toBe(true)
    // R21-D: the same reach `take` measures is now reach enough to eat, so no turn is spent.
    expect(submitIntent(s, CFG, 'amara', 'eat', { itemId: bread.id }).ok).toBe(true)
    // A mark for nothing that exists still says only that the hands are empty.
    expect(submitIntent(s, CFG, 'amara', 'eat', { itemId: 'item_nowhere' })).toEqual({
      ok: false,
      reason: 'not holding that',
    })
  })

  it('the makeable vocabulary reached block 1 and the perception, and neither ever said it', () => {
    // `build` wants a kind and `craft` wants a recipe, and by the canon-vocabulary law a word
    // a mind is never given is a word it never uses. Nothing in the prompt names one.
    const buildable = Object.keys(CFG.structures.recipes).sort()
    const craftable = Object.keys(CFG.crafting.recipes).sort()
    // The kinds the world plants and nobody raises need a row too; an empty `inputs` keeps them
    // out of `makeables`.
    expect(buildable).toEqual([
      'bridge',
      'cabin',
      'cottage',
      'farmhouse',
      'fire_pit',
      'grave',
      'house',
      'lamp_post',
      'storehouse',
      'well',
    ])
    expect(craftable).toEqual(['cloth', 'garment', 'plank'])
    // The one place a mind is taught its verbs asks for both nouns and names neither.
    expect(CAPABILITIES).toContain('give kind, the thing to raise')
    expect(CAPABILITIES).toContain('give recipe, the name of what you shape')
    // Not one buildable kind, and only the two recipes whose product another verb needs in hand.
    for (const noun of [...buildable, 'plank', 'cloth', 'stew']) {
      expect(CAPABILITIES.includes(noun)).toBe(false)
    }
    expect(CAPABILITIES).toContain('the garment you hold')
    expect(CAPABILITIES).toContain('the torch or lamp you hold')
    const s = genesisTown()
    const everyProse = FOUNDER_IDS.map((id) => proseFor(s, id)).join(' ')
    // The id is READ from the world, not retyped: a template edit renumbers the mints. A named
    // place is called by its name now, so the sentence opens with what the town calls it.
    const well = Object.values(s.structures).find((x) => x.kind === 'well')!
    expect(everyProse).toContain(`The well (${well.id}) stands at`)
    for (const noun of ['house', 'bridge', 'grave', ...craftable, 'stew', 'torch']) {
      expect(everyProse).not.toMatch(
        new RegExp(`(build|craft|raise|shape|make)[^.]{0,40}${noun}`, 'i'),
      )
    }
    // R-H closed it, and neither of these two places is where: block 1 is byte-frozen and the
    // perception is the day log. `makeablesLine` speaks it in block 6, once per turn.
    expect(makeablesLine(makeables(CFG))).toContain('a house (10 wood)')
  })
})

// ------------------------------------------------- candidate 3: the refusals. CONFIRMED, FIXED.

describe('R21 candidate 3 — "refusal text teaches nothing": CONFIRMED, and R21-D answers it', () => {
  // Every designed survival-social overlap, asked from a founder's doorway on the first morning.
  const NOW: readonly [string, Record<string, unknown>, string][] = [
    [
      'forage',
      {},
      'no forest nearby — berries, mushrooms and herbs grow in patches, and a patch is gathered by name once you can see one',
    ],
    [
      'craft',
      { recipe: 'stew' },
      'not enough meat — meat comes off an animal you have hunted, or a fish out of the water',
    ],
    ['craft', { recipe: 'garment' }, 'not enough cloth — cloth is woven from fiber'],
    // A cottage and not a house: `build {kind:'house'}` from amara's own roofless walls is
    // accepted, because walls within reach are walls she can carry on.
    [
      'build',
      { kind: 'cottage' },
      'the town keeps ground for a cottage — go and stand at (100, 88)',
    ],
    ['tend', { targetId: 'yusuf' }, 'not adjacent to the patient — they are at (67, 75)'],
    [
      'give',
      { itemId: 'item_17', targetId: 'yusuf' },
      'not adjacent to give — they are at (67, 75)',
    ],
    [
      'pave',
      { x: 80, y: 67 },
      'not enough stone — stone comes from the loose rock at the foot of an outcrop',
    ],
  ]

  it('every refusal that used to be a wall now names a place or a source', () => {
    const s = genesisTown()
    for (const [verb, params, reason] of NOW) {
      expect({ verb, ...submitIntent(s, CFG, 'amara', verb, params) }).toEqual({
        verb,
        ok: false,
        reason,
      })
      expect(reason).toMatch(/ — /)
    }
  })

  // A body beside walls of the kind it means to raise resumes them, and resuming spends nothing.
  it('★ walls within reach are not a refusal any more — they are the job', () => {
    const s = genesisTown()
    const r = submitIntent(s, CFG, 'amara', 'build', { kind: 'house' })
    expect(r.ok, r.ok ? '' : r.reason).toBe(true)
    // No `structure_planned`: she joined what stood rather than claiming fresh ground.
    expect(r.ok && r.events.map((e) => e.type)).toEqual(['action_started'])
    const started = r.ok ? (r.events[0]!.payload as { duration: number }) : { duration: -1 }
    expect(started.duration, 'a whole house, not the roof that is missing').toBeLessThan(2880)
  })

  it('the refusals that were already honest are left exactly as they were', () => {
    const s = genesisTown()
    // Nothing to teach: the water is not here, nothing is alight, and the mark is missing.
    for (const [verb, params, reason] of [
      ['fish', { x: 62, y: 62 }, 'no water there'],
      ['douse', { x: 62, y: 62 }, 'nothing is burning there'],
      ['hunt', {}, 'a hunt needs the animal named'],
    ] as readonly [string, Record<string, unknown>, string][]) {
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
    const id = Object.keys(s.forageables ?? {}).find(
      (k) => s.forageables![k]!.kind === 'berry_bush',
    )!
    const node = s.forageables![id]!
    expect(submitIntent(s, CFG, 'amara', 'forage', { nodeId: id })).toEqual({
      ok: false,
      reason: `not close enough to gather — the patch is at (${node.x}, ${node.y}); stand beside it`,
    })
  })
})

// ------------------------------------------------- the town the diagnosis is about

describe('R21 — the shape of the founding site, so the abundance pass has a baseline', () => {
  // The homes are a place, not a line: three kinds of house, gaps of two to four tiles, and one
  // household at the landing. The anchor did not move, only where the template puts the roofs.
  it('five doorways, and the anchor the template was laid from', () => {
    const s = genesisTown()
    expect(CITY_ANCHOR_DEFAULT).toEqual({ x: 43, y: 56 })
    expect(FOUNDER_IDS.map((id) => [s.agents[id]!.x, s.agents[id]!.y])).toEqual([
      [81, 68],
      [67, 75],
      [81, 99],
      [67, 113],
      [74, 113],
    ])
  })
})
