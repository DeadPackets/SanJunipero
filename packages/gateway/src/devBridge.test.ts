// @slow — the town a viewer opens can cross its own river.
//
// The channel is three tiles wide at every row and the deck recipe spans two, so `showcaseMap`
// lays a spit of sand across the eastmost column, as `GENESIS_FORD` does for the genesis world.
//
// Scripted policies only. No LLM, no network, $0.
import { describe, expect, it } from 'vitest'
import { RIVER_HALF, riverLocalDx, stateHash } from '@sj/shared'
import {
  BRIDGE_KIND, EventStore, RngStreams, TickLoop, bridgeAt, buildSiteOf, claimInWorld, fold,
  openDb, standingRects, type WorldState,
} from '@sj/engine'
import { SHOWCASE_CONFIG, devGenesisState, devTerrain } from './devWorld.js'
import { SHOWCASE_ANCHOR, showcaseDeck, showcaseSpan } from './showcaseMap.js'
import { bridgewrightIntent, foundersFor, makeFoundersOnTick, townStructuresFor } from './founders.js'

const RINGS = 3
const TICKS = 4320
const WATER = 2
const WRIGHT = 'omar'

const channelMid = (rings: number): number => SHOWCASE_ANCHOR.x + riverLocalDx(rings)

// ── the sweep: ask the engine, tile by tile, where a deck may stand ──────────────────────────

/** A world with one builder in it who is holding more planks than any deck needs. The builder
 *  is moved tile by tile; nothing else about the world changes. */
function builderWorld(rings: number): WorldState {
  const terrain = devTerrain('showcase', rings)
  const base = devGenesisState(SHOWCASE_CONFIG, terrain, 'showcase', rings)
  const withAgent = fold(base, {
    seq: 1, tick: 1, type: 'agent_spawned',
    payload: { id: 'wright', name: 'Wright', x: 0, y: 0, ageDays: 7300 },
  } as never, SHOWCASE_CONFIG)
  return fold(withAgent, {
    seq: 2, tick: 1, type: 'item_spawned',
    payload: { id: 'item_wood_wright', kind: 'wood', qty: 99, loc: { t: 'agent', id: 'wright' } },
  } as never, SHOWCASE_CONFIG)
}

const at = (s: WorldState, x: number, y: number): WorldState =>
  ({ ...s, agents: { ...s.agents, wright: { ...s.agents['wright']!, x, y } } })

/** The engine's own answer for a deck whose top-left corner is this tile, asked from every tile
 *  a builder could stand on. The best answer wins, so "not close enough" cannot mask a refusal. */
function deckAnswerAt(world: WorldState, x: number, y: number): string | null {
  let worst: string | null = 'nowhere to stand'
  for (const [dx, dy] of [[-1, 0], [2, 0], [0, -1], [0, 2], [-1, -1], [1, 1], [3, 0], [0, 3]] as const) {
    const a = buildSiteOf(at(world, x + dx, y + dy), SHOWCASE_CONFIG, 'wright', { kind: BRIDGE_KIND, x, y })
    if (a.refusal === null) return null
    if (!a.refusal.startsWith('not close enough')) worst = a.refusal
  }
  return worst
}

describe('★ WHERE A DECK MAY STAND IN THE SHOWCASE, asked of the engine and not of me', () => {
  const rings = RINGS
  const world = builderWorld(rings)
  const span = showcaseSpan(rings)
  const wet: { x: number; y: number }[] = []
  for (let y = 0; y < span; y++) {
    for (let x = 0; x < span; x++) if (world.terrain[y]![x] === WATER) wet.push({ x, y })
  }
  const answers = wet.map((t) => ({ ...t, refusal: deckAnswerAt(world, t.x, t.y) }))
  const accepted = answers.filter((a) => a.refusal === null)

  it('★ THE CHANNEL IS TWO TILES WIDE AT THE FORD AND THREE AT EVERY OTHER WET ROW', () => {
    const widths = new Map<number, number>()
    for (const t of wet) widths.set(t.y, (widths.get(t.y) ?? 0) + 1)
    const two = [...widths.entries()].filter(([, n]) => n === 2).map(([y]) => y).sort((a, b) => a - b)
    const other = [...widths.values()].filter((n) => n !== 2)
    // Four rows of two, every other wet row three — the shape `GENESIS_FORD` has and the
    // showcase did not. Before the ford: `two` is empty and every row is three.
    expect(two, 'no row of the channel is narrow enough for a two-plank deck').toHaveLength(4)
    expect(new Set(other), 'a row that is neither two nor three tiles wide').toEqual(new Set([3]))
    expect(two.map((y) => y - two[0]!), 'the ford is not four contiguous rows').toEqual([0, 1, 2, 3])
  })

  it('★ AND EXACTLY THE FOUR FORD ROWS ACCEPT A DECK — nowhere else in the channel does', () => {
    // The whole defect, as a number: this was 0 of 408.
    expect(accepted.length, `no water tile in the showcase accepts a bridge (of ${answers.length} tried)`)
      .toBe(4)
    const mid = channelMid(rings)
    for (const a of accepted) {
      expect(a.x, 'a deck was accepted off the west edge of the channel').toBe(mid - RIVER_HALF)
    }
    // and every refusal is one the engine writes, not a shape this test invented
    const tally = new Map<string, number>()
    for (const a of answers) if (a.refusal !== null) tally.set(a.refusal, (tally.get(a.refusal) ?? 0) + 1)
    expect([...tally.keys()].sort()).toEqual(['a bridge belongs over water', 'both ends must reach something solid'])
  })

  it('★ and the site the dev world hands its bridgewright is one the engine accepts', () => {
    const deck = showcaseDeck(SHOWCASE_ANCHOR, rings)
    expect(accepted.map((a) => `${a.x},${a.y}`), 'the demo names a crossing the water refuses')
      .toContain(`${deck.x},${deck.y}`)
  })
})

describe('★ THE WRIGHT STOPS WHEN THE DECK IS UP, and the reason it needed its own guard', () => {
  // Asked of the pure function with a fresh body: in a run the wright is too tired to price a
  // second deck, so the errand check masks the completion check.
  const rings = RINGS
  const deck = showcaseDeck(SHOWCASE_ANCHOR, rings)
  const stand = { x: deck.x + deck.w, y: deck.y }
  const rested = (s: WorldState): WorldState => ({
    ...s,
    agents: { ...s.agents, wright: { ...s.agents['wright']!, ...stand,
      needs: { ...s.agents['wright']!.needs, energy: 100 } } },
  })

  it('★ asks for the deck while the water is open, and for nothing once it is decked', () => {
    const open = rested(builderWorld(rings))
    expect(bridgewrightIntent(open, SHOWCASE_CONFIG, 'wright', deck))
      .toEqual({ verb: 'build', params: { kind: BRIDGE_KIND, x: deck.x, y: deck.y } })
    const crossed = fold(open, {
      seq: 3, tick: 2, type: 'structure_planned',
      payload: { id: 'deck', kind: BRIDGE_KIND, ...deck, maxHp: 20, flammable: false, builderId: 'wright' },
    } as never, SHOWCASE_CONFIG)
    const done = fold(crossed, {
      seq: 4, tick: 3, type: 'structure_completed', payload: { id: 'deck' },
    } as never, SHOWCASE_CONFIG)
    expect(bridgeAt(done, deck.x, deck.y)).toBe(true)
    expect(bridgewrightIntent(rested(done), SHOWCASE_CONFIG, 'wright', deck),
      'a rested wright starts a second deck on the first one').toBeNull()
  })
})

// ── the run: a founder lays a deck and the town crosses ──────────────────────────────────────

type Seen = { type: string; tick: number; payload: Record<string, unknown> }
type Run = {
  state: WorldState; events: Seen[]; store: EventStore
  terrain: ReturnType<typeof devTerrain>; deckTick: number | null; crossedTick: number | null
}

function runDevWorld(bridge: boolean, ticks = TICKS): Run {
  const config = SHOWCASE_CONFIG
  const terrain = devTerrain('showcase', RINGS)
  const structures = townStructuresFor('showcase', RINGS)
  const store = new EventStore(openDb(':memory:'))
  const rng = new RngStreams('g6')
  const events: Seen[] = []
  const deck = showcaseDeck(SHOWCASE_ANCHOR, RINGS)
  const mid = channelMid(RINGS)
  let deckTick: number | null = null
  let crossedTick: number | null = null
  const inner = makeFoundersOnTick(config, rng, () => loop.state, {
    interiors: true, builders: true, structures, founders: foundersFor(structures), holdings: true,
    ...(bridge ? { deck } : {}),
  })
  const loop: TickLoop = new TickLoop({
    store, state: devGenesisState(config, terrain, 'showcase', RINGS), rng, config,
    snapshotEveryTicks: 720,
    onTick: (ctx) => {
      inner({
        tick: ctx.tick,
        emit: (type, payload) => {
          events.push({ type, tick: ctx.tick, payload: (payload ?? {}) as Record<string, unknown> })
          ctx.emit(type, payload)
        },
      })
      if (deckTick === null && bridgeAt(loop.state, deck.x, deck.y)) deckTick = ctx.tick
      const claim = claimInWorld(loop.state, { along: 2, deep: 2 })
      if (crossedTick === null && claim !== null && claim.site.x < mid) crossedTick = ctx.tick
    },
  })
  for (let t = 0; t < ticks; t++) loop.step()
  return { state: loop.state, events, store, terrain, deckTick, crossedTick }
}

describe('★ THE DEV WORLD CROSSES ITS OWN RIVER — a founder builds a deck, the far bank opens', () => {
  const run = runDevWorld(true)
  const mid = channelMid(RINGS)
  const decks = Object.values(run.state.structures).filter((s) => s.kind === BRIDGE_KIND)
  const west = Object.values(run.state.structures).filter((s) => s.kind === 'house' && s.x + s.w <= mid - RIVER_HALF)
  console.log(
    `[dev-bridge] showcase rings=${RINGS}, ${TICKS} ticks: deck complete at tick ${run.deckTick}, `
    + `first claim west of the channel at tick ${run.crossedTick}; `
    + `${Object.values(run.state.structures).filter((s) => s.kind === 'house').length} houses `
    + `(${west.length} on the FAR BANK), ${standingRects(run.state).length} standing`,
  )

  it('★ A FOUNDER LAYS A DECK, through the real build verb, in the world a viewer opens', () => {
    expect(decks, 'nothing bridged the channel').toHaveLength(1)
    const deck = decks[0]!
    expect(deck.builtBy, 'the deck was not raised by a founder').toBe(WRIGHT)
    expect(deck.stage).toBe('complete')
    // Written 1×2, turned by the engine, because the only crossing in this town runs east-west.
    expect({ w: deck.w, h: deck.h }).toEqual({ w: 2, h: 1 })
    for (let dx = 0; dx < deck.w; dx++) {
      expect(run.state.terrain[deck.y]![deck.x + dx], 'a plank of the deck is not over water').toBe(WATER)
    }
    expect(run.state.terrain[deck.y]![deck.x - 1], 'the west end reaches no bank').not.toBe(WATER)
    expect(run.state.terrain[deck.y]![deck.x + deck.w], 'the east end reaches no spit').not.toBe(WATER)
  })

  it('★ AND THE DECK IS WHAT OPENS IT — the claim never points west before one stands', () => {
    expect(run.deckTick, 'no deck ever stood').not.toBeNull()
    expect(run.crossedTick, 'the town was never offered a plot across the water').not.toBeNull()
    expect(run.crossedTick!, 'the far bank was offered before the deck existed')
      .toBeGreaterThan(run.deckTick!)
    // Reachability is the deck's; ORDER is the claim's — the town still had east plots ahead of
    // it in the register, and the two are separated below by taking the deck away again.
    expect(run.deckTick).toBe(766)
    expect(run.crossedTick).toBe(1088)
  })

  it('★ AND IT IS THE DECK AND NOTHING CACHED: take it away and the claim goes back east', () => {
    const mid = channelMid(RINGS)
    const withDeck = claimInWorld(run.state, { along: 2, deep: 2 })
    expect(withDeck, 'the town has nowhere left at all').not.toBeNull()
    expect(withDeck!.site.x, 'the claim is not west of the channel to begin with').toBeLessThan(mid)
    const deck = decks[0]!
    const gone = { ...run.state, structures: Object.fromEntries(
      Object.entries(run.state.structures).filter(([, s]) => s.kind !== BRIDGE_KIND)) }
    const without = claimInWorld(gone, { along: 2, deep: 2 })
    expect(without, 'nowhere at all once the deck is gone').not.toBeNull()
    expect(without!.site.x, 'the far bank is still offered with no deck standing')
      .toBeGreaterThan(mid)
    // and scaffolding over open water is not a crossing either
    const half = { ...run.state, structures: { ...run.state.structures,
      [deck.id]: { ...deck, stage: 'construction' as const } } }
    expect(claimInWorld(half, { along: 2, deep: 2 })!.site.x, 'a half-built deck opened the bank')
      .toBeGreaterThan(mid)
  })

  it('★ AND HOUSES STAND ON THE FAR BANK, on plots the town claimed and nobody named', () => {
    expect(west.length, 'no house stands west of the channel').toBeGreaterThan(0)
    const builds = run.events.filter((e) => e.type === 'action_started' && e.payload['verb'] === 'build')
    const houses = builds.filter((b) => (b.payload['params'] as { kind: string }).kind === 'house')
    for (const b of houses) {
      expect(Object.keys(b.payload['params'] as object).sort(), 'a coordinate reached a house')
        .toEqual(['kind'])
    }
    for (const s of west) {
      for (let dy = 0; dy < s.h; dy++) for (let dx = 0; dx < s.w; dx++) {
        expect(run.state.terrain[s.y + dy]![s.x + dx], `${s.x + dx},${s.y + dy} is water`).not.toBe(WATER)
      }
    }
  })

  it('★ and the town survives crossing — nobody worked themselves onto the ground', () => {
    expect(run.events.filter((e) => e.type === 'agent_collapsed')).toEqual([])
  })

  it('★ and the whole run replays from genesis, event for event, to the same hash', () => {
    const from = devGenesisState(SHOWCASE_CONFIG, run.terrain, 'showcase', RINGS)
    const replayed = run.store.readFrom(0).reduce((s, ev) => fold(s, ev, SHOWCASE_CONFIG), from)
    expect(stateHash(replayed)).toBe(stateHash(run.state))
  })

  it('bridge OFF is the landed world exactly — no deck, and nothing west of the water', () => {
    const off = runDevWorld(false)
    expect(Object.values(off.state.structures).filter((s) => s.kind === BRIDGE_KIND)).toEqual([])
    expect(off.crossedTick, 'the far bank opened with no deck standing').toBeNull()
    expect(standingRects(off.state).length).toBeGreaterThan(11)
  })

  it('★ and it is deterministic — a second run crosses on the same tick', () => {
    const twin = runDevWorld(true)
    expect(twin.deckTick).toBe(run.deckTick)
    expect(stateHash(twin.state)).toBe(stateHash(run.state))
  }, 180_000)
})
