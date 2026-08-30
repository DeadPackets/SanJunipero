// @slow — the mortality half: the second clock, the four afflictions, the nine ways to die and
// the one night a fever crosses a room. Scripted actors only: no LLM, no network.
import { describe, it, expect } from 'vitest'
import {
  DAYS_PER_YEAR,
  MINUTES_PER_DAY,
  SimConfigSchema,
  thirstDecayPerTick,
  type SimConfig,
} from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { doorTile } from './interiors.js'
import { composePerception } from './perception.js'
import { RngStreams } from './rng.js'
import { genesisState, thirstOf, type TileId, type WorldState } from './state.js'
import { DEATH_CAUSES, type DeathCause } from './systems/mortality.js'
import { PALE_MUSHROOM, type PendingEvent } from './verbs/index.js'
import { createWorldTick } from './worldTick.js'
import { changesOf, ev, grid } from './testutil/world.js'

// A quiet sky, no mysteries and no fauna: every event this gate names is one a scripted actor
// or a named system caused. Old age is switched off except in the one row that is about it.
const QUIET = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  fauna: { enabled: false },
  regrowth: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse({ ...QUIET, aging: { deathOfOldAgeEnabled: false } })

// Every cause this file actually produced, checked against DEATH_CAUSES in the last row.
const CAUSES_SEEN = new Set<DeathCause>()

const MAP = (n = 24): TileId[][] => grid(n)

type Spawn = { id: string; x: number; y: number; ageDays?: number }

function spawn(s: WorldState, config: SimConfig, a: Spawn): WorldState {
  return fold(
    s,
    ev('agent_spawned', { id: a.id, name: a.id, x: a.x, y: a.y, ageDays: a.ageDays ?? 7300 }),
    config,
  )
}

type Box = { id: string; kind: string; x: number; y: number; w: number; h: number }

function raise(s: WorldState, config: SimConfig, box: Box): WorldState {
  const planned = fold(
    s,
    ev('structure_planned', {
      ...box,
      maxHp: 50,
      flammable: true,
      builderId: 'script',
    }),
    config,
  )
  return fold(planned, ev('structure_completed', { id: box.id }), config)
}

const indoors = (s: WorldState, config: SimConfig, id: string, box: Box): WorldState => {
  const door = doorTile(s, s.structures[box.id]!)!
  const moved = fold(s, ev('agent_moved', { id, x: door.x, y: door.y }), config)
  return fold(moved, ev('agent_entered', { agentId: id, structureId: box.id }), config)
}

// One full world pass at a chosen tick — the real pipeline, so a row that passes here passes
// in a running town.
function pass(
  s: WorldState,
  config: SimConfig,
  tick: number,
  seed = 'g11a',
): {
  state: WorldState
  events: PendingEvent[]
} {
  const advanced = fold({ ...s, tick: tick - 1 }, ev('tick_advanced', {}, tick), config)
  return createWorldTick(config, new RngStreams(seed))(advanced)
}

// Run the world forward from `from` until `stop` says so or the window runs out. Returns every
// event with the tick it landed on, which is what a "dies on schedule" row needs.
function runUntil(
  s: WorldState,
  config: SimConfig,
  from: number,
  limit: number,
  stop: (state: WorldState, events: PendingEvent[], tick: number) => boolean,
  seed = 'g11a',
): {
  state: WorldState
  log: { tick: number; type: string; payload: unknown }[]
  tick: number
} {
  let state = s
  const log: { tick: number; type: string; payload: unknown }[] = []
  for (let tick = from; tick < from + limit; tick++) {
    const out = pass(state, config, tick, seed)
    state = out.state
    for (const e of out.events) log.push({ tick, type: e.type, payload: e.payload })
    if (stop(state, out.events, tick)) return { state, log, tick }
  }
  return { state, log, tick: from + limit }
}

const died = (log: { tick: number; type: string; payload: unknown }[], id: string) =>
  log.find((e) => e.type === 'agent_died' && (e.payload as { agentId?: string }).agentId === id)

function noteCause(payload: unknown): void {
  const cause = (payload as { cause?: string }).cause
  if (cause !== undefined && (DEATH_CAUSES as readonly string[]).includes(cause))
    CAUSES_SEEN.add(cause as DeathCause)
}

const apply = (
  s: WorldState,
  config: SimConfig,
  events: PendingEvent[],
  tick: number,
): WorldState => events.reduce((acc, e) => fold(acc, ev(e.type, e.payload, tick), config), s)

// Submit an intent and let the world finish it. One-tick verbs are done in one pass.
function act(
  s: WorldState,
  config: SimConfig,
  tick: number,
  agentId: string,
  verb: string,
  params: Record<string, unknown> = {},
  seed = 'g11a',
): { state: WorldState; events: PendingEvent[]; refusal: string | null } {
  const started = submitIntent(s, config, agentId, verb, params)
  if (!started.ok) return { state: s, events: [], refusal: started.reason }
  const withIntent = apply(s, config, started.events, tick)
  const out = pass(withIntent, config, tick + 1, seed)
  return { state: out.state, events: out.events, refusal: null }
}

// ------------------------------------------------------------------ thirst, the second clock

describe('G11a-M1: thirst is a clock of its own, and it kills on a schedule arithmetic can name', () => {
  const START = 1860 // day 1, 07:00 — no dawn recovery pass and no midnight inside the window

  function parched(config: SimConfig = CFG): WorldState {
    let s = spawn(genesisState(config, MAP()), config, { id: 'dry', x: 5, y: 5 })
    s = fold(
      s,
      ev('needs_changed', { id: 'dry', changes: [{ need: 'thirst', delta: -100 }] }, START - 1),
      config,
    )
    return { ...s, tick: START - 1 }
  }

  it('bills the derived rate — 0.6 of hunger — on every living body, every tick', () => {
    expect(thirstDecayPerTick(CFG)).toBeCloseTo(CFG.needs.hungerDecayPerTick * 0.6, 12)
    const s = spawn(genesisState(CFG, MAP()), CFG, { id: 'dry', x: 5, y: 5 })
    const out = pass({ ...s, tick: START - 1 }, CFG, START)
    const billed = out.events.flatMap(changesOf).filter((c) => c.need === 'thirst')
    expect(billed).toHaveLength(1)
    expect(billed[0]!.delta).toBeCloseTo(-thirstDecayPerTick(CFG), 12)
    expect(thirstOf(out.state.agents.dry!)).toBeCloseTo(100 - thirstDecayPerTick(CFG), 12)
  })

  // The oracle states the model out loud: the thirst drain every tick, one fatigue rung the
  // moment the body goes down, and death the tick the bar reaches the floor.
  function scheduledDeathTick(config: SimConfig, start: number): number {
    let hp = config.health.maxHp
    let rung = 0
    for (let tick = start; ; tick++) {
      hp = Math.max(
        0,
        hp - (config.mortality.thirstHpDrainPerTick + config.mortality.drainPerTick.fatigue * rung),
      )
      if (hp <= config.health.deathHp) return tick
      if (rung === 0 && hp < config.health.collapseHp) rung = 1
    }
  }

  it('a body denied water dies on that tick, and the death is named for the thirst', () => {
    const expected = scheduledDeathTick(CFG, START)
    const { log } = runUntil(parched(), CFG, START, 1200, (st) => !st.agents.dry!.alive)
    const death = died(log, 'dry')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('thirst')
    expect(death!.tick).toBe(expected)
  })

  it('a drink resets the clock — from open water, from a well, and from a waterskin', () => {
    // Open water: a river tile beside the body.
    const s = parched()
    s.terrain[5]![6] = 2
    let out = act(s, CFG, START, 'dry', 'drink')
    expect(out.refusal).toBeNull()
    expect(thirstOf(out.state.agents.dry!)).toBeGreaterThanOrEqual(CFG.thirst.drinkRestore)

    // A well, on dry ground: the same restore through a different mouth.
    let w = parched()
    w = raise(w, CFG, { id: 'structure_9', kind: 'well', x: 6, y: 5, w: 1, h: 1 })
    out = act(w, CFG, START, 'dry', 'drink')
    expect(out.refusal).toBeNull()
    expect(thirstOf(out.state.agents.dry!)).toBeGreaterThanOrEqual(CFG.thirst.drinkRestore)

    // A waterskin carried away from any water at all, and it spends a charge.
    let k = parched()
    k = fold(
      k,
      ev(
        'item_spawned',
        {
          id: 'item_skin',
          kind: 'waterskin',
          qty: 1,
          loc: { t: 'agent', id: 'dry' },
          charges: 2,
        },
        START - 1,
      ),
      CFG,
    )
    out = act(k, CFG, START, 'dry', 'drink', { itemId: 'item_skin' })
    expect(out.refusal).toBeNull()
    expect(thirstOf(out.state.agents.dry!)).toBeGreaterThanOrEqual(CFG.thirst.drinkRestore)
    expect(out.state.items.item_skin!.charges).toBe(1)

    // And with nothing in reach and nothing in hand, the world says no.
    expect(act(parched(), CFG, START, 'dry', 'drink').refusal).toBe('no water within reach')
  })
})

// ------------------------------------------------------------------ poison, illness, the hand

describe('G11a-M2: a pale mushroom, an affliction, and the two hands that lift it', () => {
  const START = 1860

  function eater(): WorldState {
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'eater', x: 5, y: 5 })
    s = spawn(s, CFG, { id: 'healer', x: 6, y: 5 })
    s = fold(
      s,
      ev(
        'item_spawned',
        {
          id: 'item_cap',
          kind: PALE_MUSHROOM,
          qty: 1,
          loc: { t: 'agent', id: 'eater' },
        },
        START - 1,
      ),
      CFG,
    )
    s = fold(
      s,
      ev(
        'item_spawned',
        {
          id: 'item_herb',
          kind: 'herb',
          qty: 1,
          loc: { t: 'agent', id: 'healer' },
        },
        START - 1,
      ),
      CFG,
    )
    return { ...s, tick: START - 1 }
  }

  // The poison roll is drawn from the `illness` stream at emission; a seed whose first draw
  // falls under the dial is the forced roll, and its opposite is the forced miss.
  const seedWhoseFirstIllnessDrawIsBelow = (dial: number, want: boolean): string => {
    for (let i = 0; i < 500; i++) {
      const seed = `poison-${i}`
      if (new RngStreams(seed).get('illness').next() < dial === want) return seed
    }
    throw new Error('no seed found')
  }

  it('a forced roll poisons the eater; the opposite roll leaves a clean body', () => {
    const hit = seedWhoseFirstIllnessDrawIsBelow(CFG.mortality.poisonChanceSpoiled, true)
    const out = act(eater(), CFG, START, 'eater', 'eat', { itemId: 'item_cap' }, hit)
    expect(out.state.agents.eater!.afflictions).toEqual([
      { kind: 'poison', severity: 1, sinceTick: START + 1 },
    ])

    const miss = seedWhoseFirstIllnessDrawIsBelow(CFG.mortality.poisonChanceSpoiled, false)
    const clean = act(eater(), CFG, START, 'eater', 'eat', { itemId: 'item_cap' }, miss)
    expect(clean.state.agents.eater!.afflictions).toBeUndefined()
  })

  it('tend with a herb lifts it, and the patient is stamped as tended', () => {
    const hit = seedWhoseFirstIllnessDrawIsBelow(CFG.mortality.poisonChanceSpoiled, true)
    const poisoned = act(eater(), CFG, START, 'eater', 'eat', { itemId: 'item_cap' }, hit).state
    expect(poisoned.agents.eater!.afflictions).toHaveLength(1)

    // `tend` takes three ticks, so the intent is submitted and the world runs it out.
    const started = submitIntent(poisoned, CFG, 'healer', 'tend', {
      targetId: 'eater',
      itemId: 'item_herb',
    })
    expect(started.ok).toBe(true)
    const withIntent = apply(
      poisoned,
      CFG,
      (started as { events: PendingEvent[] }).events,
      START + 2,
    )
    const { state } = runUntil(
      withIntent,
      CFG,
      START + 3,
      8,
      (st) => st.agents.healer!.activity === null,
    )
    expect(state.agents.eater!.afflictions).toBeUndefined()
    expect(state.agents.eater!.tendedTick).toBeDefined()
    expect(state.items.item_herb).toBeUndefined() // the last leaf is spent, so the stack is gone
  })

  it('untreated, the same poison finishes the body and the death says so', () => {
    const hit = seedWhoseFirstIllnessDrawIsBelow(CFG.mortality.poisonChanceSpoiled, true)
    const poisoned = act(eater(), CFG, START, 'eater', 'eat', { itemId: 'item_cap' }, hit).state
    // Nothing else is wrong with this body: it is the poison and the ladder the poison drives.
    const { log } = runUntil(poisoned, CFG, START + 2, 4000, (st) => !st.agents.eater!.alive)
    const death = died(log, 'eater')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('poison')
  })
})

describe('G11a-M3: a fever that is never lifted worsens until it kills', () => {
  // Midnight is the illness turn; a dial of 1 makes every night a worse one.
  const HARSH: SimConfig = SimConfigSchema.parse({
    ...QUIET,
    aging: { deathOfOldAgeEnabled: false },
    illness: { dailyWorsenChance: 1 },
  })

  it('worsens at midnight and dies of the sickness', () => {
    // Seeded an hour before midnight, so the nightly turn lands while the body still has hp:
    // at severity 2 the drain finishes it before the next midnight comes round.
    let s = spawn(genesisState(HARSH, MAP()), HARSH, { id: 'ill', x: 5, y: 5 })
    s = fold(
      s,
      ev('agent_afflicted', { agentId: 'ill', kind: 'illness', severity: 1 }, 1380),
      HARSH,
    )
    s = { ...s, tick: 1380 }
    const { state, log } = runUntil(s, HARSH, 1381, 40000, (st) => !st.agents.ill!.alive)
    const worsened = log.filter(
      (e) =>
        e.type === 'affliction_worsened' && (e.payload as { kind?: string }).kind === 'illness',
    )
    expect(worsened.length).toBeGreaterThanOrEqual(1)
    expect((worsened[0]!.payload as { severity: number }).severity).toBe(2)
    const death = died(log, 'ill')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('illness')
    expect(state.agents.ill!.alive).toBe(false)
  })
})

// ------------------------------------------------------------------ the hand behind the wound

describe('G11a-M4: a blow struck by a hand, a death that names the hand, and a third pair of eyes', () => {
  const START = 1860

  function brawl(): WorldState {
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'bruiser', x: 5, y: 5 })
    s = spawn(s, CFG, { id: 'victim', x: 6, y: 5 })
    s = spawn(s, CFG, { id: 'witness', x: 8, y: 5 })
    return { ...s, tick: START - 1 }
  }

  // The combat roll decides who goes down; a seed is picked so the attacker wins.
  const attackerWins = (): string => {
    for (let i = 0; i < 500; i++) {
      const seed = `brawl-${i}`
      const out = act(brawl(), CFG, START, 'bruiser', 'attack', { targetId: 'victim' }, seed)
      const hurt = out.events.find((e) => e.type === 'agent_injured')
      if ((hurt?.payload as { agentId?: string } | undefined)?.agentId === 'victim') return seed
    }
    throw new Error('no seed found where the attacker wins')
  }

  it('the wound carries the hand that made it, so the death can be a killing', () => {
    const seed = attackerWins()
    const out = act(brawl(), CFG, START, 'bruiser', 'attack', { targetId: 'victim' }, seed)
    const wound = out.state.agents.victim!.afflictions?.find((x) => x.kind === 'injury')
    expect(wound).toBeDefined()
    expect(wound!.sourceId).toBe('bruiser')

    const { log } = runUntil(out.state, CFG, START + 2, 40000, (st) => !st.agents.victim!.alive)
    const death = died(log, 'victim')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect(death!.payload).toMatchObject({ cause: 'slain', byId: 'bruiser' })
  })

  it('the third actor sees the blow land, and a wall would have hidden it', () => {
    const seed = attackerWins()
    const out = act(brawl(), CFG, START, 'bruiser', 'attack', { targetId: 'victim' }, seed)
    const injured = out.events.filter((e) => e.type === 'agent_injured')
    expect(injured).toHaveLength(1)

    // The witness stands eight tiles off in plain daylight: the victim is inside her horizon.
    const packet = composePerception(out.state, CFG, 'witness', [])
    expect(packet.visible.agents.map((a) => a.id).sort()).toEqual(['bruiser', 'victim'])

    // Take the same two bodies indoors and the witness outside sees neither of them.
    let walled = raise(brawl(), CFG, { id: 'structure_9', kind: 'house', x: 4, y: 4, w: 2, h: 2 })
    walled = indoors(walled, CFG, 'bruiser', {
      id: 'structure_9',
      kind: 'house',
      x: 4,
      y: 4,
      w: 2,
      h: 2,
    })
    walled = indoors(walled, CFG, 'victim', {
      id: 'structure_9',
      kind: 'house',
      x: 4,
      y: 4,
      w: 2,
      h: 2,
    })
    expect(composePerception(walled, CFG, 'witness', []).visible.agents).toEqual([])
  })

  it('a stone is set on the tile the body fell on', () => {
    const seed = attackerWins()
    const wounded = act(
      brawl(),
      CFG,
      START,
      'bruiser',
      'attack',
      { targetId: 'victim' },
      seed,
    ).state
    const { state, log } = runUntil(
      wounded,
      CFG,
      START + 2,
      40000,
      (st) => !st.agents.victim!.alive,
    )
    const grave = log.find(
      (e) => e.type === 'grave_placed' && (e.payload as { agentId?: string }).agentId === 'victim',
    )
    expect(grave).toBeDefined()
    const at = grave!.payload as { x: number; y: number; id: string }
    const body = state.agents.victim!
    expect({ x: at.x, y: at.y }).toEqual({ x: body.x, y: body.y })
    expect(state.structures[at.id]!.kind).toBe('grave')
  })
})

// ------------------------------------------------------------------ the ladder, cold and warm

describe('G11a-M5: the fatigue ladder, and the winter night that renames it', () => {
  it('a body kept from sleep climbs the ladder and the last rung kills it', () => {
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'weary', x: 5, y: 5 })
    // Empty the bar the ladder is climbed on, and leave the belly full so hunger is not the
    // thing that takes her: this row is about the falling, not the fasting.
    s = fold(
      s,
      ev('needs_changed', { id: 'weary', changes: [{ need: 'energy', delta: -100 }] }, 1859),
      CFG,
    )
    s = { ...s, tick: 1859 }
    const { state, log } = runUntil(s, CFG, 1860, 40000, (st) => !st.agents.weary!.alive, 'ladder')
    const rungs = log
      .filter((e) => e.type === 'agent_afflicted' || e.type === 'affliction_worsened')
      .filter((e) => (e.payload as { kind?: string }).kind === 'fatigue')
    expect(rungs.length).toBeGreaterThanOrEqual(1)
    const death = died(log, 'weary')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('fatigue')
    expect(state.agents.weary!.alive).toBe(false)
  })

  it('the same rung, driven by a night the cold billed, is named for the cold', () => {
    // Deep winter, out of doors, nothing worn: the cold takes the energy and the ladder does
    // the killing — which is the one road cold takes to a grave.
    const WINTER_TICK = 3 * 30 * MINUTES_PER_DAY + 22 * 60 // winter, night
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'cold', x: 5, y: 5 })
    // No warmth left to spend, a little energy still to lose — the cold only reaches the
    // energy bar once the warmth bar is empty, and only while there is energy to take.
    s = fold(
      s,
      ev(
        'needs_changed',
        { id: 'cold', changes: [{ need: 'warmth', delta: -100 }] },
        WINTER_TICK - 1,
      ),
      CFG,
    )
    s = fold(
      s,
      ev(
        'needs_changed',
        { id: 'cold', changes: [{ need: 'energy', delta: -80 }] },
        WINTER_TICK - 1,
      ),
      CFG,
    )
    s = fold(s, ev('hp_changed', { agentId: 'cold', delta: -80 }, WINTER_TICK - 1), CFG)
    s = { ...s, tick: WINTER_TICK - 1 }
    const first = pass(s, CFG, WINTER_TICK)
    const chilled = first.events.flatMap(changesOf).filter((c) => c.reason === 'exposure')
    expect(chilled).toHaveLength(1)
    expect(first.state.agents.cold!.coldTicksSinceRecovery).toBe(1)

    const { log } = runUntil(
      first.state,
      CFG,
      WINTER_TICK + 1,
      40000,
      (st) => !st.agents.cold!.alive,
    )
    const death = died(log, 'cold')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('exposure')
  })
})

describe('G11a-M6: the two clocks with no affliction behind them, and the one that needs no cause', () => {
  it('an empty belly is its own death', () => {
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'starved', x: 5, y: 5 })
    s = fold(
      s,
      ev('needs_changed', { id: 'starved', changes: [{ need: 'hunger', delta: -100 }] }, 1859),
      CFG,
    )
    s = { ...s, tick: 1859 }
    const { log } = runUntil(s, CFG, 1860, 40000, (st) => !st.agents.starved!.alive)
    const death = died(log, 'starved')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('hunger')
  })

  it('a wound with no hand behind it is named for the wound', () => {
    let s = spawn(genesisState(CFG, MAP()), CFG, { id: 'hurt', x: 5, y: 5 })
    s = fold(s, ev('agent_afflicted', { agentId: 'hurt', kind: 'injury', severity: 3 }, 1859), CFG)
    s = { ...s, tick: 1859 }
    const { log } = runUntil(s, CFG, 1860, 40000, (st) => !st.agents.hurt!.alive)
    const death = died(log, 'hurt')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('injury')
    expect(death!.payload).not.toHaveProperty('byId')
  })

  it('an old body goes in its sleep, with a stone of its own', () => {
    // The one row that switches the old-age roll back on, at a dial that makes the night certain.
    const OLD: SimConfig = SimConfigSchema.parse({
      ...QUIET,
      aging: { deathOfOldAgeEnabled: true, naturalDeathBaseChancePerDay: 1 },
    })
    let s = spawn(genesisState(OLD, MAP()), OLD, {
      id: 'elder',
      x: 5,
      y: 5,
      ageDays: 70 * DAYS_PER_YEAR,
    })
    s = { ...s, tick: MINUTES_PER_DAY - 1 }
    const out = pass(s, OLD, MINUTES_PER_DAY)
    const death = out.events.find((e) => e.type === 'agent_died')
    expect(death).toBeDefined()
    noteCause(death!.payload)
    expect((death!.payload as { cause: string }).cause).toBe('old_age')
    expect(out.events.some((e) => e.type === 'grave_placed')).toBe(true)
  })
})

// ------------------------------------------------------------------ contagion

describe('G11a-M7: a fever crosses a room, respects the radius, and stops at a wall', () => {
  const SURE: SimConfig = SimConfigSchema.parse({
    ...QUIET,
    aging: { deathOfOldAgeEnabled: false },
    illness: { dailyWorsenChance: 0, contagionChance: 1 },
  })
  const OFF: SimConfig = SimConfigSchema.parse({
    ...QUIET,
    aging: { deathOfOldAgeEnabled: false },
    illness: { dailyWorsenChance: 0, contagionEnabled: false },
  })
  const HOUSE: Box = { id: 'structure_1', kind: 'house', x: 4, y: 4, w: 2, h: 2 }

  // A carrier and three others: one in the same room, one just inside the radius outdoors,
  // one just outside it.
  function ward(config: SimConfig): WorldState {
    const radius = config.illness.contagionRadius
    let s = raise(genesisState(config, MAP()), config, HOUSE)
    s = spawn(s, config, { id: 'carrier', x: 10, y: 10 })
    s = spawn(s, config, { id: 'roommate', x: 10, y: 10 })
    s = spawn(s, config, { id: 'near', x: 10 + radius, y: 10 })
    s = spawn(s, config, { id: 'far', x: 10 + radius + 1, y: 10 })
    // Severity 2, not 1: with the worsen dial pinned off a first-rung fever simply lifts at
    // midnight, and a carrier who recovers before the turn is no carrier at all.
    s = fold(
      s,
      ev('agent_afflicted', { agentId: 'carrier', kind: 'illness', severity: 2 }, 60),
      config,
    )
    return { ...s, tick: MINUTES_PER_DAY - 1 }
  }

  const sickIds = (s: WorldState): string[] =>
    Object.keys(s.agents)
      .sort()
      .filter((id) => s.agents[id]!.afflictions?.some((x) => x.kind === 'illness') === true)

  it('outdoors it reaches exactly as far as the radius says and no further', () => {
    const out = pass(ward(SURE), SURE, MINUTES_PER_DAY)
    expect(sickIds(out.state)).toEqual(['carrier', 'near', 'roommate'])
    expect(out.state.agents.far!.afflictions).toBeUndefined()
  })

  it('four walls are the air: a co-occupant catches it at any distance, and nobody outside does', () => {
    // The carrier and one other share a room; the near body is a tile from the doorway.
    let s = ward(SURE)
    s = indoors(s, SURE, 'carrier', HOUSE)
    s = indoors(s, SURE, 'roommate', HOUSE)
    const door = doorTile(s, s.structures[HOUSE.id]!)!
    s = fold(
      s,
      ev('agent_moved', { id: 'near', x: door.x + 1, y: door.y }, MINUTES_PER_DAY - 1),
      SURE,
    )
    const out = pass(s, SURE, MINUTES_PER_DAY)
    expect(sickIds(out.state)).toEqual(['carrier', 'roommate'])
    expect(out.state.agents.near!.afflictions).toBeUndefined()
  })

  it('with the flag off, nobody catches anything at all', () => {
    const out = pass(ward(OFF), OFF, MINUTES_PER_DAY)
    expect(sickIds(out.state)).toEqual(['carrier'])
    expect(out.events.filter((e) => e.type === 'agent_afflicted')).toEqual([])
  })
})

// ------------------------------------------------------------------ the roll-up

describe('G11a-M8: every way the world knows how to die was produced by this suite', () => {
  it('covers DEATH_CAUSES exactly, with nothing left theoretical', () => {
    expect([...CAUSES_SEEN].sort()).toEqual([...DEATH_CAUSES].sort())
  })
})
