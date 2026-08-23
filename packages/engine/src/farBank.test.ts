// @slow — ★ THE END-TO-END PROOF THAT A BRIDGE OPENS THE FAR BANK.
//
// `townGrowth.test.ts` proves the town reaches ring 2 on the EAST bank, and that every plot
// west of the channel is refused, because nobody can get there. This is the other half of the
// ruling: a mind works out that the far bank is unreachable, an agent raises a deck over the
// two planks' width of channel at the ford, and the west of the river JOINS THE TOWN — with
// every invariant the claim seam proved still standing on the far side.
//
// The river stops being a wall and becomes a problem the town can solve. That is what this
// world exists to watch, and it is measured here on a real `TickLoop`, not asserted.
//
// Scripted policies only. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import {
  MINUTES_PER_DAY, SimConfigSchema, TOWN_SQUARE, T_ROAD, doorFrontOf, freePlots, grammarOf,
  latticeFloor, place, plotExtent, ringsStanding, stateHash, townSpacing, type SimConfig,
} from '@sj/shared'
import { openDb } from './db.js'
import { EventStore } from './eventStore.js'
import { replayFromGenesis } from './replay.js'
import { fold } from './fold.js'
import { RngStreams } from './rng.js'
import { TickLoop } from './tickLoop.js'
import { createWorldTick } from './worldTick.js'
import { genesisState, type Structure, type TileId, type WorldState } from './state.js'
import { GENESIS_RIVER_X, makeGenesisWorld } from './genesis/world.js'
import { submitIntent } from './intent.js'
import { isAdjacentToRect } from './verbs.js'
import { BRIDGE_KIND, bridgeAt } from './path.js'
import { claimInWorld, standingRects, townGroundOf, townWalkOf, townSquareOf } from './town.js'

// The same declared fixture dial `townGrowth.test.ts` uses: a house takes four hours here
// instead of two days, so a town that crosses a river fits inside a test suite. It changes how
// LONG a build takes and nothing whatever about WHERE it goes.
const HOUSE_TICKS = 240
const CFG: SimConfig = SimConfigSchema.parse({
  weather: { hourlyChangeChance: 0 },
  mystery: { chancePerDay: 0 },
  aging: { deathOfOldAgeEnabled: false },
  construction: { houseTicks: HOUSE_TICKS },
  structures: { recipes: { ...SimConfigSchema.parse({}).structures.recipes,
    house: { ...SimConfigSchema.parse({}).structures.recipes['house']!, durationTicks: HOUSE_TICKS } } },
})

const MASONS = 6
const DAYS = 3
const UPKEEP_EVERY = 240
const WET: ReadonlySet<number> = new Set([2, 10])

// ★ THE ONLY PLACE A SIX-PLANK DECK CAN SPAN. A spit of sand reaches out from the near bank at
// rows 50–53, so the channel there is two tiles instead of three — the world was authored that
// way so that feet and a bridge would converge on the same crossing. The deck is asked for at
// the WRITTEN 1×2, and the engine turns it; see the orientation test at the bottom.
const FORD_ROW = 51
const DECK = { x: GENESIS_RIVER_X - 1, y: FORD_ROW }   // 48, 51
const BANK_STAND = { x: GENESIS_RIVER_X + 1, y: FORD_ROW }  // 50, 51 — the sand, east of the deck

type Run = {
  loop: TickLoop; store: EventStore; genesisTerrain: TileId[][]
  growths: number; bridgeTick: number | null; crossedTick: number | null
}

/**
 * Six masons who want roofs. One of them is a bridgewright first: it walks to the sand at the
 * ford and lays a deck, and only then joins the others. Nobody ever names a coordinate for a
 * house — the two-step below is what a mind reads out of the perception line — and the deck is
 * the one exception the verb keeps, because the water decides where a bridge can stand.
 */
function runTown(seed = 'far-bank'): Run {
  const { terrain, events: genesis } = makeGenesisWorld(CFG)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams(seed)
  const worldTick = createWorldTick(CFG, rng)
  const ids = Array.from({ length: MASONS }, (_, i) => `mason_${i}`)
  const WRIGHT = ids[0]!
  let bridgeTick: number | null = null
  let crossedTick: number | null = null
  const loop: TickLoop = new TickLoop({
    store, state: genesisState(CFG, terrain), rng, config: CFG, snapshotEveryTicks: 720,
    onTick: ({ tick, emit }) => {
      if (tick === 1) {
        for (const e of genesis) emit(e.type, e.payload)
        ids.forEach((id, i) => emit('agent_spawned', {
          id, name: id, x: TOWN_SQUARE.x + i + 1, y: TOWN_SQUARE.y + 1, ageDays: 7300,
        }))
      }
      // Declared fixture upkeep, exactly as the claim-seam proof does it: this is a proof about
      // the lattice and the river, not about the economy.
      if (tick % UPKEEP_EVERY === 0) {
        for (const id of ids) {
          if (loop.state.agents[id] === undefined) continue
          for (const need of ['hunger', 'energy', 'warmth', 'social'] as const) {
            emit('need_changed', { id, need, delta: 100 })
          }
          emit('thirst_changed', { id, delta: 100 })
        }
      }
      for (const e of worldTick(loop.state).events) emit(e.type, e.payload)

      const decked = bridgeAt(loop.state, DECK.x, DECK.y)
      if (decked && bridgeTick === null) bridgeTick = tick
      let claim = claimInWorld(loop.state, { along: 2, deep: 2 })
      if (crossedTick === null && claim !== null && claim.site.x < GENESIS_RIVER_X) crossedTick = tick

      for (const id of ids) {
        const a = loop.state.agents[id]
        if (a === undefined || !a.alive || a.activity !== null) continue
        const wood = Object.values(loop.state.items)
          .filter((i) => i.kind === 'wood' && i.loc.t === 'agent' && i.loc.id === id)
          .reduce((s, i) => s + i.qty, 0)
        if (wood < 10) emit('item_spawned', { id: `wood_${id}_${tick}`, kind: 'wood', qty: 10, loc: { t: 'agent', id } })

        // ★ THE BRIDGEWRIGHT. Until a deck stands it does nothing else, and it names the ONE
        // coordinate the verb still takes — because the water, not the town, decides here.
        if (id === WRIGHT && !decked) {
          if (isAdjacentToRect(a.x, a.y, { x: DECK.x, y: DECK.y, w: 2, h: 1 })) {
            const b = submitIntent(loop.state, CFG, id, 'build', { kind: BRIDGE_KIND, ...DECK })
            if (b.ok) for (const e of b.events) emit(e.type, e.payload)
            continue
          }
          const w = submitIntent(loop.state, CFG, id, 'walk', BANK_STAND)
          if (w.ok) for (const e of w.events) emit(e.type, e.payload)
          continue
        }

        if (claim === null) continue
        if (isAdjacentToRect(a.x, a.y, claim.site)) {
          const b = submitIntent(loop.state, CFG, id, 'build', { kind: 'house' })
          if (!b.ok) continue
          for (const e of b.events) emit(e.type, e.payload)
          claim = claimInWorld(loop.state, { along: 2, deep: 2 })
          continue
        }
        if (a.x === claim.door.x && a.y === claim.door.y) continue
        const w = submitIntent(loop.state, CFG, id, 'walk', { x: claim.door.x, y: claim.door.y })
        if (w.ok) for (const e of w.events) emit(e.type, e.payload)
      }
    },
  })
  for (let i = 0; i < DAYS * MINUTES_PER_DAY; i++) loop.step()
  return {
    loop, store, genesisTerrain: terrain, bridgeTick, crossedTick,
    growths: store.readFrom(0).filter((e) => e.type === 'world_grown').length,
  }
}

/** The plot a standing building sits on, or null for the monuments and the deck. */
function plotOf(state: WorldState, s: Structure) {
  const square = townSquareOf(state)!
  const g = grammarOf(square, s)
  for (const plot of freePlots(6, townGroundOf(state, square))) {
    const e = plotExtent(plot)
    if (e.dx <= g.dx && g.dx + s.w <= e.dx + e.w && e.dy <= g.dy && g.dy + s.h <= e.dy + e.h) return plot
  }
  return null
}

const massOf = (s: { x: number; y: number; w: number; h: number }) =>
  ({ dx: s.x, dy: s.y, w: s.w, h: s.h })

describe('★ a bridge opens the far bank, and the town grows across the water', () => {
  const run = runTown()
  const state = run.loop.state
  const square = townSquareOf(state)!
  const all = Object.values(state.structures)
  const built = all.filter((s) => s.builtBy?.startsWith('mason_') === true)
  const houses = built.filter((s) => s.kind === 'house')
  const decks = all.filter((s) => s.kind === BRIDGE_KIND)
  // The channel's array column moves when the world grows west, so "the far bank" is measured
  // against where the river actually is now, never against the authored 49.
  const riverX = square.x + (GENESIS_RIVER_X - TOWN_SQUARE.x)
  const west = houses.filter((s) => s.x + s.w <= riverX)
  const size = { w: state.terrain[0]!.length, h: state.terrain.length }

  it('★ an agent built a bridge, and the town then crossed the river', () => {
    // eslint-disable-next-line no-console
    console.log(`[far-bank] ${DAYS * MINUTES_PER_DAY} ticks, ${MASONS} masons:`
      + ` deck complete at tick ${run.bridgeTick}, first claim west of the channel at tick ${run.crossedTick};`
      + ` ${houses.length} houses (${west.length} on the FAR BANK), ${all.length} standing,`
      + ` world ${size.w}x${size.h}, ${run.growths} growths`)
    expect(decks).toHaveLength(1)
    expect(decks[0]!.builtBy).toBe('mason_0')
    expect(decks[0]!.stage).toBe('complete')
    expect(run.bridgeTick).not.toBeNull()
    // ★ THE ORDER IS THE WHOLE CLAIM. `crossedTick` is the FIRST tick in the entire run at
    // which the claim pointed west of the channel, and it is not before the deck stood — so
    // in 764 ticks of trying, the far bank was never once offered. Measured, the two are the
    // SAME tick: the crossing opens the moment the last plank lands, not a tick later.
    expect(run.crossedTick!).toBeGreaterThanOrEqual(run.bridgeTick!)
    expect(run.crossedTick! - run.bridgeTick!).toBeLessThan(2)
    expect(west.length).toBeGreaterThanOrEqual(4)
    expect(ringsStanding(square, standingRects(state), townGroundOf(state, square))).toBe(2)
  })

  it('★ the deck really spans the channel, and every far-bank house is west of it', () => {
    const d = decks[0]!
    // Every tile of the deck is over water the world still holds — it is a crossing, not a
    // land reclamation, and nothing paved the river.
    for (let x = d.x; x < d.x + d.w; x++)
      expect(WET.has(state.terrain[d.y]![x]!), `deck tile ${x},${d.y}`).toBe(true)
    // A foot on solid ground at each end, which is what makes it a crossing at all.
    expect(WET.has(state.terrain[d.y]![d.x - 1]!)).toBe(false)
    expect(WET.has(state.terrain[d.y]![d.x + d.w]!)).toBe(false)
    for (const s of west) expect(s.x + s.w, `${s.id} at ${s.x},${s.y}`).toBeLessThanOrEqual(riverX)
  })

  // ★ NON-VACUITY, THE WAY THIS PROJECT LEARNED TO ASK FOR IT. Take the deck out of the same
  // final world and ask the same question: the far bank shuts. Nothing cached it open.
  it('★ and it is the DECK that opens it: pull the deck and the far bank closes again', () => {
    const withoutDeck: WorldState = {
      ...state,
      structures: Object.fromEntries(Object.entries(state.structures).filter(([, s]) => s.kind !== BRIDGE_KIND)),
    }
    expect(townWalkOf(state, square)(DECK.x - square.x, DECK.y - square.y)).toBe(true)
    expect(townWalkOf(withoutDeck, square)(DECK.x - square.x, DECK.y - square.y)).toBe(false)
    // Free the plots the far-bank houses hold, so the only thing deciding is the crossing.
    const eastOnly: WorldState = {
      ...withoutDeck,
      structures: Object.fromEntries(
        Object.entries(withoutDeck.structures).filter(([, s]) => !(s.x + s.w <= riverX && s.kind === 'house'))),
    }
    const shut = claimInWorld(eastOnly, { along: 2, deep: 2 })
    expect(shut).not.toBeNull()
    expect(shut!.site.x, 'the far bank is offered with no deck standing').toBeGreaterThan(riverX)
    // …and with the deck back, the same world offers the west again.
    const open = claimInWorld({ ...eastOnly, structures: { ...eastOnly.structures, deck: decks[0]! } },
      { along: 2, deep: 2 })
    expect(open!.site.x).toBeLessThan(riverX)
  })

  it('★ a HALF-BUILT deck opens nothing — scaffolding over open water is not a crossing', () => {
    const halfBuilt: WorldState = {
      ...state,
      structures: Object.fromEntries(Object.entries(state.structures)
        .map(([k, s]) => [k, s.kind === BRIDGE_KIND ? { ...s, stage: 'construction' as const } : s])),
    }
    expect(townWalkOf(halfBuilt, square)(DECK.x - square.x, DECK.y - square.y)).toBe(false)
  })

  it('★ every building standing in the town is dry, in the world, and road-fronted', () => {
    let offPlot = 0
    for (const s of all) {
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          expect(state.terrain[y]?.[x], `${s.kind} off the world at ${x},${y}`).toBeDefined()
          // DRY — with the deck named as the one deliberate exception, because a bridge that
          // did not stand on water would not be a bridge.
          if (s.kind !== BRIDGE_KIND)
            expect(WET.has(state.terrain[y]![x]!), `${s.kind} in water at ${x},${y}`).toBe(false)
        }
      const plot = plotOf(state, s)
      if (plot === null) { offPlot++; continue }
      const along = plot.face === 'sw' ? s.w : s.h
      const deep = plot.face === 'sw' ? s.h : s.w
      const front = doorFrontOf(place(plot, s.kind, along, deep, null))
      const at = { x: square.x + front.dx, y: square.y + front.dy }
      expect(state.terrain[at.y]?.[at.x], `${s.kind} at ${s.x},${s.y} fronts ${at.x},${at.y}`).toBe(T_ROAD)
    }
    // The well, the fire pit and the deck: none of them stands on a plot, and none of them can.
    expect(all.filter((s) => plotOf(state, s) === null).map((s) => s.kind).sort())
      .toEqual(['bridge', 'fire_pit', 'well'])
    expect(offPlot).toBe(3)
    // Non-vacuity: the far-bank houses are among the ones that DID find a plot and a road.
    expect(west.every((s) => plotOf(state, s) !== null)).toBe(true)
  })

  // ★ TASK 3 — TWO NUMBERS, NAMED SEPARATELY. The old whole-town figure was dominated by two
  // 1×1 monuments the lattice never governed; a 2×1 deck now joins them, and the old proxy for
  // "governed" — bigger than 1×1 — would have counted it. Being ON A PLOT is the test.
  it('★ and the two spacing numbers are reported apart, because they measure different things', () => {
    const governed = all.filter((s) => plotOf(state, s) !== null).map(massOf)
    const ungoverned = all.filter((s) => plotOf(state, s) === null).map(massOf)
    const sp = townSpacing(governed, ungoverned)
    // eslint-disable-next-line no-console
    console.log(`[far-bank] lattice floor over ${sp.governed} plot-seated buildings:`
      + ` ${sp.latticeFloor.toFixed(4)} px (exhaustive floor ${latticeFloor().closest.toFixed(4)});`
      + ` whole-town minimum over all ${sp.governed + sp.ungoverned}, monuments and deck included:`
      + ` ${sp.wholeTown.toFixed(4)} px`)
    // THE INVARIANT. Only these pairs the exhaustive survey is a claim about.
    expect(sp.latticeFloor).toBeGreaterThanOrEqual(latticeFloor().closest)
    expect(latticeFloor().closest).toBeCloseTo(86.1626, 3)
    // NOT THE INVARIANT, and it is a smaller number: the well and the fire pit, as ever.
    expect(sp.wholeTown).toBeCloseTo(73.7564, 3)
    expect(sp.wholeTown).toBeLessThan(sp.latticeFloor)
    expect(sp.ungoverned).toBe(3)
    // The 2×1 deck is ungoverned. The old proxy would have filed it under the floor.
    expect(ungoverned.filter((s) => s.w > 1 || s.h > 1)).toHaveLength(1)
  })

  it('★ and not one tile in the town holds two buildings, nor one plot two roofs', () => {
    const seen = new Set<string>()
    for (const s of all)
      for (let y = s.y; y < s.y + s.h; y++)
        for (let x = s.x; x < s.x + s.w; x++) {
          expect(seen.has(`${x},${y}`), `two buildings on ${x},${y}`).toBe(false)
          seen.add(`${x},${y}`)
        }
    const perPlot = new Map<string, number>()
    for (const s of all) {
      const plot = plotOf(state, s)
      if (plot === null) continue
      perPlot.set(`${plot.block.i},${plot.block.j}/${plot.slot}`,
        (perPlot.get(`${plot.block.i},${plot.block.j}/${plot.slot}`) ?? 0) + 1)
    }
    expect(perPlot.size).toBe(all.length - 3)
    for (const [k, n] of perPlot) expect(n, k).toBe(1)
  })

  it('★ and the whole run replays from genesis, event for event, to the same hash', () => {
    expect(stateHash(replayFromGenesis(run.store, CFG, run.genesisTerrain))).toBe(stateHash(state))
  })

  it('★ and a second run of the same world reaches the same town, tile for tile', () => {
    const twin = runTown()
    expect(standingRects(twin.loop.state)).toEqual(standingRects(state))
    expect(stateHash(twin.loop.state)).toBe(stateHash(state))
  }, 120_000)

  // ★ A TURNED BRIDGE IS A TURNED BRIDGE, AND THE ENGINE SAYS SO.
  //
  // The recipe writes the deck 1 wide and 2 deep. The only crossing in the world runs
  // EAST–WEST, so `buildFootprint` turns it and the structure that stands is 2×1. The engine
  // therefore already publishes the orientation, in `w` and `h`, on `structure_planned` and in
  // `state.structures` — the renderer is handed both and resolves its cell on `kind` alone.
  //
  // ★ THE PRECEDENT, CHECKED: the world-growth lane found `farmhouse-se`/`cottage-se` declaring
  // the unturned footprint and it survived because every downstream measure was a function of
  // `w + h`, which a transpose preserves. `buildingArt` scales to `(w + h) × 32`, so the deck's
  // turn is invisible to the geometry for exactly the same reason — and visible to the eye,
  // because a plank deck is not transpose-symmetric the way a scale factor is. That is an ART
  // seam, not an engine one: it needs a second cell, and `packages/forge` is not this lane's.
  it('★ the deck the engine stands is TURNED, and w/h is where it says so', () => {
    const d = decks[0]!
    expect(CFG.structures.recipes[BRIDGE_KIND]).toMatchObject({ w: 1, h: 2 })
    expect({ w: d.w, h: d.h }, 'the ford runs east-west, so the written 1x2 was turned').toEqual({ w: 2, h: 1 })
    // The turn is in the log too, not only in the folded state — so a replay draws it the same.
    const planned = run.store.readFrom(0)
      .find((e) => e.type === 'structure_planned' && (e.payload as { kind: string }).kind === BRIDGE_KIND)!
    expect(planned.payload).toMatchObject({ kind: BRIDGE_KIND, w: 2, h: 1 })
    // And a transpose is invisible to the one measure the art layer takes off the footprint,
    // which is why nothing downstream has ever caught it.
    expect(d.w + d.h).toBe(CFG.structures.recipes[BRIDGE_KIND]!.w + CFG.structures.recipes[BRIDGE_KIND]!.h)
  })

  // ★ `scaffolding` IS A STAGE, NOT A KIND — the ruling, so it is not left ambiguous a third
  // time. A house being built is a HOUSE that is not finished; calling it a scaffolding would
  // make the kind lie about what is being raised and would change on completion, which is a
  // second source of truth for something `stage` already says. The engine publishes `stage` on
  // every structure and a renderer that wants to draw poles and canvas reads that.
  it('★ nothing the engine can build is ever OF KIND scaffolding — the stage is the channel', () => {
    expect(Object.keys(CFG.structures.recipes)).not.toContain('scaffolding')
    expect(all.map((s) => s.kind)).not.toContain('scaffolding')
    // The state a renderer must draw for really is reachable, and it is reachable on a HOUSE:
    // mid-run, houses stand half-raised under their own kind.
    const midRun = run.store.readFrom(0).filter((e) => e.tick <= run.bridgeTick! + 120)
      .reduce((s, ev) => fold(s, ev, CFG), genesisState(CFG, run.genesisTerrain))
    const raising = Object.values(midRun.structures).filter((s) => s.stage === 'construction')
    expect(raising.length, 'no building was under construction to draw').toBeGreaterThan(0)
    for (const s of raising) expect(['house', BRIDGE_KIND]).toContain(s.kind)
  })
})
