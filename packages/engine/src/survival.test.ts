import { describe, it, expect } from 'vitest'
import { MINUTES_PER_DAY, SimConfigSchema, type SimConfig } from '@sj/shared'
import { fold } from './fold.js'
import { submitIntent } from './intent.js'
import { RngStreams } from './rng.js'
import { genesisState, type AgentBody, type TileId, type WorldState } from './state.js'
import { createWorldTick, type WorldTickResult } from './worldTick.js'
import { ev, grid } from './testutil/world.js'

// World one killed all five founders on day 2 of hunger while forty-one units of food sat in
// buildings. These are the numbers that says cannot happen again, and the road out of the fall.

const quiet = {
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  mapGrowth: { enabled: false },
  fauna: { enabled: false },
  desirePaths: { enabled: false },
}
const CFG: SimConfig = SimConfigSchema.parse(quiet)

const map = (): TileId[][] => grid(12)
const at = (day: number, hour: number): number => day * MINUTES_PER_DAY + hour * 60 + 30
const SPRING_NIGHT = at(1, 22)
const SPRING_DAY = at(1, 12)

function world(tick: number, extra: Partial<AgentBody> = {}, id = 'a1'): WorldState {
  let s = genesisState(CFG, map())
  s = fold(s, ev('tick_advanced', {}, tick - 1), CFG)
  s = fold(s, ev('agent_spawned', { id, name: id, x: 4, y: 4, ageDays: 7300 }, tick - 1), CFG)
  const a = {
    ...s.agents[id]!,
    ...extra,
    needs: { ...s.agents[id]!.needs, ...(extra.needs ?? {}) },
  }
  return { ...s, agents: { ...s.agents, [id]: a } }
}

function tickOnce(s: WorldState, config = CFG): WorldTickResult {
  return createWorldTick(
    config,
    new RngStreams('sv'),
  )(fold(s, ev('tick_advanced', {}, s.tick + 1), config))
}

// The streams are built once for the whole run: reseeding them every tick was half this file's
// runtime, and `quiet` is what makes these worlds insensitive to the draws anyway.
function run(s: WorldState, ticks: number, config = CFG): WorldState {
  const tick = createWorldTick(config, new RngStreams('sv'))
  let cur = s
  for (let i = 0; i < ticks; i++)
    cur = tick(fold(cur, ev('tick_advanced', {}, cur.tick + 1), config)).state
  return cur
}

// A lit hearth two tiles off, which is what "standing near its own fire" means to the engine.
function withFire(s: WorldState, fueledUntilTick: number): WorldState {
  let cur = fold(
    s,
    ev(
      'structure_planned',
      {
        id: 'structure_1',
        kind: 'fire_pit',
        x: 6,
        y: 4,
        w: 1,
        h: 1,
        maxHp: 10,
        flammable: false,
        builderId: 'a1',
      },
      s.tick,
    ),
    CFG,
  )
  cur = fold(cur, ev('structure_completed', { id: 'structure_1' }, cur.tick), CFG)
  return {
    ...cur,
    structures: {
      ...cur.structures,
      structure_1: { ...cur.structures.structure_1!, fueledUntilTick },
    },
  }
}

const HOUR = 60
const DAY = MINUTES_PER_DAY

describe('the teeth: how long a body has, in ticks it can count', () => {
  // Every number below is derived from the dials, so a change to a dial moves the assertion
  // rather than quietly moving the world out from under it.
  const decay = CFG.needs.hungerDecayPerTick
  const toCollapse = (100 - CFG.needs.collapseThreshold) / decay
  const toEmpty = 100 / decay

  it('a body that never eats stays on its feet for six in-game days, not two', () => {
    // World one: 100 / 0.035 put Amara on the ground at tick 2715, in-game day 2. D1 put the
    // same fall a week out, so a hungry body is a thread a town has time to notice and pull.
    expect(2715).toBeLessThan(3 * DAY)
    expect(toCollapse).toBeGreaterThan(6 * DAY)
    expect(Math.round(toCollapse)).toBe(9500)
  })

  it('and it is a whole day past the fall before the drain has taken the body', () => {
    const graced = toEmpty + CFG.mortality.hungerGraceTicks
    // hp bleeds at the fatigue rung from the fall, then at both once the grace runs out.
    const fatigue = CFG.mortality.drainPerTick.fatigue
    const hpAtGrace = CFG.health.maxHp - (graced - toCollapse) * fatigue
    const toDeath = graced + hpAtGrace / (fatigue + CFG.mortality.hungerHpDrainPerTick)
    expect(toDeath - toCollapse).toBeGreaterThan(DAY)
    // World one gave Amara 1131 ticks of it; the floor is now comfortably above that.
    expect(toDeath - toCollapse).toBeGreaterThan(1131)
  })

  it('leaves the absolute starvation clock behind the hp, so hp is what tells the story', () => {
    expect(toEmpty + CFG.needs.deathAfterZeroHungerTicks).toBeGreaterThan(toEmpty + 1440)
  })

  it('keeps the warning ladder well clear of the fall it warns about', () => {
    // The prose says "eat today" at 25; the body falls at 5. That gap is the whole warning.
    const ticksOfWarning = (25 - CFG.needs.collapseThreshold) / decay
    expect(ticksOfWarning).toBeGreaterThan(12 * HOUR)
  })
})

describe('the cold keeps its teeth and loses its speed', () => {
  it('takes a whole spring night to spend the warmth a fed body starts with', () => {
    // The storm that broke over world one was 4C: 14 base - 6 night - 4 storm. What changed is
    // not the thermometer but how long being out in it takes to cost anything.
    const bare = {
      ...world(SPRING_NIGHT, { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 } }),
      weather: { kind: 'storm', temperatureC: 4 },
    }
    const dawn = run(bare, 8 * HOUR)
    // Warmth still in the body is the cold having cost it no energy at all yet.
    expect(dawn.agents.a1!.needs.warmth).toBeGreaterThan(0)
    expect(90 / CFG.warmth.exposureDecayPerTick).toBeGreaterThan(8 * HOUR)
  })
})

describe('a fed body in a day-2 storm', () => {
  const stormy = (s: WorldState): WorldState => ({
    ...s,
    weather: { kind: 'storm', temperatureC: 4 },
  })

  it('stands through the whole night beside its own fire, needing nothing', () => {
    const fed = world(SPRING_NIGHT, { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 } })
    const night = run(stormy(withFire(fed, SPRING_NIGHT + 8 * HOUR)), 8 * HOUR)
    const a = night.agents.a1!
    expect(a.alive).toBe(true)
    expect(a.collapsedSinceTick).toBeNull()
    expect(a.hp).toBe(CFG.health.maxHp)
    expect(a.needs.warmth).toBeGreaterThan(50)
  })

  it('stands through it out in the open too, with hours to spare', () => {
    const fed = world(SPRING_NIGHT, { needs: { hunger: 90, energy: 90, warmth: 90, social: 90 } })
    const night = run(stormy(fed), 6 * HOUR)
    expect(night.agents.a1!.collapsedSinceTick).toBeNull()
    expect(night.agents.a1!.alive).toBe(true)
  })
})

describe('a collapse has a road out of it', () => {
  const downed = (extra: Partial<AgentBody> = {}, tick = SPRING_DAY): WorldState => {
    const s = world(tick, { needs: { hunger: 2, energy: 60, warmth: 60, social: 60 }, ...extra })
    return tickOnce(s).state
  }

  it('puts the body on the ground in the first place', () => {
    expect(downed().agents.a1!.collapsedSinceTick).not.toBeNull()
  })

  it('a neighbour who holds food out feeds it to them, and they stand again', () => {
    let s = downed()
    s = fold(
      s,
      ev('agent_spawned', { id: 'a2', name: 'a2', x: 5, y: 4, ageDays: 7300 }, s.tick),
      CFG,
    )
    s = fold(
      s,
      ev(
        'item_spawned',
        { id: 'item_1', kind: 'bread', qty: 1, loc: { t: 'agent', id: 'a2' } },
        s.tick,
      ),
      CFG,
    )
    const r = submitIntent(s, CFG, 'a2', 'give', { itemId: 'item_1', targetId: 'a1' })
    expect(r.ok).toBe(true)
    for (const e of r.ok ? r.events : []) s = fold(s, ev(e.type, e.payload, s.tick), CFG)
    const after = run(s, 3)
    // One loaf is 60 hunger, which clears the collapse line on its own.
    expect(after.agents.a1!.needs.hunger).toBeGreaterThan(CFG.needs.collapseThreshold)
    expect(after.agents.a1!.collapsedSinceTick).toBeNull()
    // The loaf went into the body, not into its hands: nothing was transferred.
    expect(after.items.item_1?.qty ?? 0).toBe(0)
  })

  it('a body down with hp gone mends by the tick when it is fed and out of the cold', () => {
    const hurt = downed({ hp: 4, needs: { hunger: 80, energy: 60, warmth: 60, social: 60 } })
    expect(hurt.agents.a1!.collapsedSinceTick).not.toBeNull()
    // The fall put fatigue on the body, and that drain runs against the mending: the net is
    // what gets it back on its feet, and it has to be positive or there is no road out at all.
    const net = CFG.health.downedRecoveryHpPerTick - CFG.mortality.drainPerTick.fatigue
    expect(net).toBeGreaterThan(0)
    const ticks = Math.ceil((CFG.health.collapseHp - hurt.agents.a1!.hp) / net)
    const back = run(hurt, ticks + 5)
    expect(back.agents.a1!.hp).toBeGreaterThanOrEqual(CFG.health.collapseHp)
    expect(back.agents.a1!.collapsedSinceTick).toBeNull()
    // And it is quick enough to be worth waiting for: a few hours, not a day of dawns.
    expect(ticks).toBeLessThan(4 * HOUR)
  })

  it('does not mend a body that is still starving, however long it lies there', () => {
    const starving = downed({ hp: 4 })
    const later = run(starving, 4 * HOUR)
    expect(later.agents.a1!.hp).toBeLessThanOrEqual(4)
    expect(later.agents.a1!.collapsedSinceTick).not.toBeNull()
  })

  it('lets the body call for help, which world one refused it', () => {
    const s = downed()
    // Amara tried this fifteen times and was refused every time; she died ten feet from a door.
    expect(submitIntent(s, CFG, 'a1', 'speak', { text: 'help' }).ok).toBe(true)
  })

  it('lets it drag itself one tile, at a crawl, and no further', () => {
    let s = downed()
    const far = submitIntent(s, CFG, 'a1', 'walk', { x: 9, y: 9 })
    expect(far.ok).toBe(false)
    expect(far.ok === false && far.reason).toMatch(/drag yourself/)

    const near = submitIntent(s, CFG, 'a1', 'walk', { x: 5, y: 4 })
    expect(near.ok).toBe(true)
    const started = near.ok ? near.events.find((e) => e.type === 'action_started') : undefined
    const cost = CFG.movement.crawlTickMultiplier
    expect((started?.payload as { duration: number } | undefined)!.duration).toBe(cost)

    // The whole crawl, not just its price: a duration nothing honours buys the body an arrival
    // on the first tick and an `interrupted` for the rest, which is what this caught.
    for (const e of near.ok ? near.events : []) s = fold(s, ev(e.type, e.payload, s.tick), CFG)
    const midway = run(s, cost - 1)
    expect([midway.agents.a1!.x, midway.agents.a1!.y]).toEqual([4, 4])
    const arrived = run(midway, 1)
    expect([arrived.agents.a1!.x, arrived.agents.a1!.y]).toEqual([5, 4])
    expect(arrived.agents.a1!.activity).toBeNull()
  })

  // World one's Nadia crossed the hunger line in her sleep and never woke: a body that is asleep
  // AND down cannot eat, call out or crawl, which is no road out at all.
  it('wakes the body that goes down in its sleep, on the tick it goes down', () => {
    const sleeping = world(SPRING_DAY, {
      asleep: true,
      needs: { hunger: 2, energy: 60, warmth: 60, social: 60 },
    })
    const r = tickOnce(sleeping)
    const types = r.events.map((e) => e.type)
    expect(types).toContain('agent_collapsed')
    expect(types).toContain('agent_woke')
    expect(r.state.agents.a1!.asleep).toBe(false)
    expect(r.state.agents.a1!.collapsedSinceTick).not.toBeNull()
    // Awake and down is the state the road out is built for.
    expect(submitIntent(r.state, CFG, 'a1', 'speak', { text: 'help' }).ok).toBe(true)
  })

  it("but lying down again while down stays the body's own choice, and standing comes first", () => {
    let s = downed()
    const r = submitIntent(s, CFG, 'a1', 'sleep', {})
    expect(r.ok).toBe(true)
    for (const e of r.ok ? r.events : []) s = fold(s, ev(e.type, e.payload, s.tick), CFG)
    s = run(s, 1)
    expect(s.agents.a1!.asleep).toBe(true)
    expect(s.agents.a1!.collapsedSinceTick).not.toBeNull()

    // Fed where it lies: the collapse lifts and the sleep does not. Standing first, waking after.
    s = fold(
      s,
      ev('needs_changed', { id: 'a1', changes: [{ need: 'hunger', delta: 60 }] }, s.tick),
      CFG,
    )
    expect(s.agents.a1!.collapsedSinceTick).toBeNull()
    expect(s.agents.a1!.asleep).toBe(true)
  })

  it('still refuses the hands: a body on the ground does not build or chop', () => {
    const s = downed()
    for (const verb of ['build', 'chop', 'take', 'give']) {
      const r = submitIntent(s, CFG, 'a1', verb, {})
      expect([verb, r.ok]).toEqual([verb, false])
      expect(r.ok === false && r.reason).toBe('collapsed and unable to act')
    }
  })
})

describe('the world-one profile, rerun', () => {
  // The same world: spring, a body that spawns full and never eats, and the storm that broke
  // over the founders at tick 2640. World one lost Amara at 2715.
  const AMARA_FELL = 2715
  const STORM = 2640

  // Asleep, so the only clock running is the one under test. Hunger drains at the same rate
  // awake or asleep, indoors or out — the post-mortem measured exactly two values across
  // 15,978 deltas — while sleep holds energy still, the way a night in a bed did for the five.
  const sleeper = (): WorldState =>
    world(1, { asleep: true, needs: { hunger: 100, energy: 100, warmth: 100, social: 100 } })

  it('leaves the body standing at the tick world one lost its first founder', () => {
    let s = sleeper()
    s = run(s, STORM - 1)
    s = { ...s, weather: { kind: 'storm', temperatureC: 4 } }
    s = run(s, AMARA_FELL - STORM)
    const a = s.agents.a1!
    expect(a.alive).toBe(true)
    expect(a.collapsedSinceTick).toBeNull()
    // Under the old rate this body was at 4.98 and on the ground; it is now nowhere near it.
    expect(100 - AMARA_FELL * 0.035).toBeLessThan(CFG.needs.collapseThreshold)
    expect(a.needs.hunger).toBeGreaterThan(35)
  })

  it('but a body that never eats at all still dies, because that is not a rate problem', () => {
    // The honest limit of retuning: world one's founders ate nothing for 11,681 ticks. No
    // survivable number saves that. What saves them is being warned, and being helped up.
    // D1 buys a week and a half before the grave; it does not buy forever.
    expect(run(sleeper(), 10 * DAY).agents.a1!.alive).toBe(false)
  })
})

describe('death is still on the table', () => {
  it('sustained total neglect kills, it just takes days instead of one', () => {
    const doomed = world(SPRING_DAY, { needs: { hunger: 0, energy: 50, warmth: 50, social: 50 } })
    const dead = run(doomed, 2 * DAY)
    expect(dead.agents.a1!.alive).toBe(false)
  })

  it('and a body left alone from noon to midnight is not in any danger at all', () => {
    // Half a day awake, which is all a body gets before energy sends it to bed either way.
    const fine = world(SPRING_DAY, {
      needs: { hunger: 100, energy: 100, warmth: 100, social: 100 },
    })
    const later = run(fine, 12 * HOUR)
    expect(later.agents.a1!.alive).toBe(true)
    expect(later.agents.a1!.collapsedSinceTick).toBeNull()
    expect(later.agents.a1!.hp).toBe(CFG.health.maxHp)
  })
})
