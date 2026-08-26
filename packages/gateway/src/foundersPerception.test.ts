// The perception packet is O(world) — every agent, every structure and every item through a
// per-tile visibility test — and the scripted tick built one per free-handed founder per tick
// whether or not the patrol policy that reads it was ever reached. The REAL function is
// counted here, not replaced by a stub.
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sj/engine', async (importOriginal) => {
  const real = await importOriginal<typeof import('@sj/engine')>()
  return { ...real, composePerception: vi.fn(real.composePerception) }
})

const {
  EventStore, RngStreams, TickLoop, composePerception, fold, genesisState, makeFixtureMap, openDb,
} = await import('@sj/engine')
const { SHOWCASE_CONFIG, devGenesisState, devTerrain } = await import('./devWorld.js')
const { showcaseDeck } = await import('./showcaseMap.js')
const { foundersFor, makeFoundersOnTick, townStructuresFor } = await import('./founders.js')

const TICKS = 600
const RINGS = 1
const LAMPS = 8

/** The shape `pnpm stream` runs: the showcase map with builders, lamps and the deck. */
function streamRun(): number {
  const structures = townStructuresFor('showcase', RINGS)
  let planned = 0
  const inner = makeFoundersOnTick(
    SHOWCASE_CONFIG, new RngStreams('perception-lane'), () => loop.state, {
      interiors: true, builders: true, structures, founders: foundersFor(structures),
      holdings: true, lamps: LAMPS, deck: showcaseDeck(undefined, RINGS),
    })
  const loop: TickLoop = new TickLoop({
    store: new EventStore(openDb(':memory:')),
    state: devGenesisState(SHOWCASE_CONFIG, devTerrain('showcase', RINGS), 'showcase', RINGS),
    rng: new RngStreams('perception-lane-world'), config: SHOWCASE_CONFIG, snapshotEveryTicks: 720,
    onTick: (ctx) => inner({
      tick: ctx.tick,
      emit: (type, payload) => { if (type === 'structure_planned') planned++; ctx.emit(type, payload) },
    }),
  })
  for (let t = 0; t < TICKS; t++) loop.step()
  return planned
}

/** The frozen fixture with builders only — a town whose founders do fall through to the patrol. */
function patrolRun(): void {
  let state = genesisState(SHOWCASE_CONFIG, makeFixtureMap())
  const onTick = makeFoundersOnTick(
    SHOWCASE_CONFIG, new RngStreams('perception-patrol'), () => state, { builders: true })
  let seq = 0
  for (let tick = 1; tick <= TICKS; tick++) {
    const emitted: Array<{ type: string; payload: unknown }> = []
    onTick({ tick, emit: (type, payload) => emitted.push({ type, payload }) })
    for (const e of emitted) state = fold(state, { seq: ++seq, tick, ...e }, SHOWCASE_CONFIG)
  }
}

describe('★ the scripted tick composes a perception only when it uses one', () => {
  it('builds none on a stream whose earlier intents always win', () => {
    const counted = vi.mocked(composePerception)
    counted.mockClear()
    // the run does real work, so a packet count of zero is not "nothing happened"
    expect(streamRun()).toBeGreaterThan(1)
    // MEASURED on this fixture: 28 packets built and thrown away when it was composed above the
    // `??` chain. The patrol policy is never reached in these 600 ticks.
    expect(counted.mock.calls.length).toBe(0)
  })

  it('still builds one on the ticks the patrol policy IS reached', () => {
    const counted = vi.mocked(composePerception)
    counted.mockClear()
    patrolRun()
    expect(counted.mock.calls.length).toBeGreaterThan(0)
  })
})
