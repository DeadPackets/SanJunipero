import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  CHRONICLE_WEIGHTS,
  DEFAULT_CONFIG,
  DISCOVERY_EVENT,
  chronicleIcon,
  chronicleLine,
  discoveryHeadline,
  stateHash,
  type ChronicleLookup,
  type SimEvent,
} from '@sj/shared'
import {
  EventStore,
  RngStreams,
  TickLoop,
  genesisState,
  openDb,
  replayFromGenesis,
  type TileId,
} from '@sj/engine'
// NO CROSS-PACKAGE IMPORTS: `packages/web` is a DOM/bundler project and `packages/agents` is not
// a gateway dependency, so their halves are read as SOURCE instead.
import { artNeededFor } from './discoveryArt.js'
import { readDiscoveries } from './discoveries.js'

const REPO = new URL('../../../', import.meta.url)
const read = (p: string): string => readFileSync(new URL(p, REPO), 'utf8')

const WEB_MARKS = new URL('../../web/src/ui/timelineMarks.ts', import.meta.url)
/** MARK_WEIGHT, read off the viewer's own table. Fails if a weight moves, or if the table is
 *  reshaped so this can no longer find it — never silently returns an empty set. */
function markWeights(): Record<string, number> {
  const src = readFileSync(WEB_MARKS, 'utf8')
  const body = /export const MARK_WEIGHT[^{]*\{([\s\S]*?)\n\}/.exec(src)?.[1]
  if (body === undefined) throw new Error('MARK_WEIGHT is not where GATE G-D can read it')
  const out: Record<string, number> = {}
  for (const [, k, v] of body.matchAll(/(\w+):\s*(\d+)/g)) out[k!] = Number(v)
  if (Object.keys(out).length < 9)
    throw new Error(`GATE G-D read only ${Object.keys(out).length} mark weights`)
  return out
}

const GRASS: TileId[][] = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0))

const PAYLOAD = {
  recipeId: 'recipe:waterskin',
  name: 'stitch a waterskin',
  kind: 'craft' as const,
  byId: 'a1',
  intent: 'i want to carry water in a stitched hide',
  makes: ['waterskin'],
}

const LOOK: ChronicleLookup = {
  agentName: () => 'Maret',
  structureKind: () => 'house',
  mysteryProse: () => null,
}

/** A world log with those rows in it, and nothing else — the shape the archive reads. */
function worldWith(rows: { tick: number; payload: unknown }[]): Database.Database {
  const db = openDb(':memory:')
  const store = new EventStore(db)
  for (const r of rows) store.append(r.tick, DISCOVERY_EVENT, r.payload)
  return db
}

describe('GATE G-D — a discovery is credited, recorded, replayed, served, marked and drawn', () => {
  it('1. reaches the world log through the tick, and replays bit-identically', () => {
    const store = new EventStore(openDb(':memory:'))
    const before = stateHash(genesisState(DEFAULT_CONFIG, GRASS))
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('gd'),
      config: DEFAULT_CONFIG,
      snapshotEveryTicks: 600,
      onTick: ({ tick, emit }) => {
        if (tick === 1) emit(DISCOVERY_EVENT, PAYLOAD)
      },
    })
    loop.step()

    expect(store.readFrom(0).some((e: SimEvent) => e.type === DISCOVERY_EVENT)).toBe(true)
    expect(stateHash(replayFromGenesis(store, DEFAULT_CONFIG, GRASS))).toBe(stateHash(loop.state))
    // the fold is a passthrough: the only thing a tick carrying a discovery changed is the clock
    expect(loop.state.tick).toBe(1)
    expect(before).not.toBe('')
  })

  it('1b. the live run announces it — the seam is wired, not merely available', () => {
    const bridge = read('packages/agents/src/runtime/bridge.ts')
    // announcements drain at the TOP of the tick, before queued intents, or the log would read
    // "used the verb" before "the verb existed"
    expect(bridge).toContain('announce(type: string')
    expect(bridge.indexOf('this.#announcements = []')).toBeLessThan(
      bridge.indexOf('const queue = this.#queue'),
    )

    const live = read('packages/agents/scripts/g11-deepworld.ts')
    const wired = ['onCodified', 'bridge.announce', 'discoveryArt.onDiscovery'].map((needle) =>
      live.indexOf(needle),
    )
    expect(
      wired.every((i) => i > 0),
      'the live seam is not wired',
    ).toBe(true)
    expect([...wired].sort((a, b) => a - b)).toEqual(wired) // in that order
  })

  it('2. carries all four credits, and the archive resolves the inventor to a name', () => {
    const db = worldWith([{ tick: 40, payload: PAYLOAD }])
    const [row] = readDiscoveries(db, (id) => (id === 'a1' ? 'Maret' : id))
    expect(row!.by).toBe('Maret') // who
    expect(row!.byId).toBe('a1')
    expect(row!.tick).toBe(40) // when
    expect(row!.intent).toBe(PAYLOAD.intent) // from what
    expect(row!.makes).toEqual(['waterskin']) // what it unlocked
  })

  it('3. reads as a sentence, weighted second in the feed, with a glyph of its own', () => {
    const ev: SimEvent = { seq: 1, tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }
    expect(chronicleLine(ev, LOOK)).toBe('Maret found the way of it — stitch a waterskin.')
    expect(CHRONICLE_WEIGHTS.discovery_made).toBe(19)
    expect(CHRONICLE_WEIGHTS.agent_died!).toBeGreaterThan(19)
    expect(chronicleIcon('discovery_made')).toBe('key')
  })

  it('4. is the heaviest thing on the scrub bar', () => {
    const w = markWeights()
    expect(Object.keys(w)).toHaveLength(9)
    expect(w.discovery).toBe(18)
    expect(Math.max(...Object.values(w))).toBe(18)
  })

  it('5. never quotes the mind’s own words where a mind can read them', () => {
    const ev: SimEvent = { seq: 1, tick: 40, type: DISCOVERY_EVENT, payload: PAYLOAD }
    const line = chronicleLine(ev, LOOK)!
    expect(line).not.toContain(PAYLOAD.intent)
    expect(discoveryHeadline({ ...PAYLOAD, by: 'Maret' })).not.toContain(PAYLOAD.intent)
    // and the archive, which no agent can reach, is the one place that DOES carry it
    expect(
      readDiscoveries(worldWith([{ tick: 40, payload: PAYLOAD }]), () => 'Maret')[0]!.intent,
    ).toBe(PAYLOAD.intent)
  })

  it('6. asks the forge for the one thing nobody has drawn', () => {
    expect(artNeededFor(PAYLOAD.makes, new Set())).toEqual(['waterskin'])
    expect(artNeededFor(PAYLOAD.makes, new Set(['waterskin']))).toEqual([])
  })

  it('7. NOT VACUOUS: a payload with no inventor never becomes a record', () => {
    const noCredit = { ...PAYLOAD, byId: undefined }
    expect(readDiscoveries(worldWith([{ tick: 40, payload: noCredit }]), (id) => id)).toEqual([])
  })

  it('8. NOT VACUOUS: the archive is non-empty for the world it is measured on', () => {
    expect(
      readDiscoveries(worldWith([{ tick: 40, payload: PAYLOAD }]), () => 'Maret').length,
    ).toBeGreaterThan(0)
  })

  it('9. the coined word travels the same road, and is not the craft', () => {
    const word = {
      recipeId: 'express:dance',
      name: 'dance',
      kind: 'word' as const,
      byId: 'a2',
      intent: 'i want to dance by the fire',
      makes: [] as string[],
    }
    const rows = readDiscoveries(
      worldWith([
        { tick: 40, payload: PAYLOAD },
        { tick: 90, payload: word },
      ]),
      (id) => (id === 'a1' ? 'Maret' : 'Sena'),
    )
    expect(rows.map((r) => r.kind)).toEqual(['craft', 'word'])
    expect(
      chronicleLine(
        { seq: 2, tick: 90, type: DISCOVERY_EVENT, payload: word },
        { ...LOOK, agentName: () => 'Sena' },
      ),
    ).toBe('Sena gave the town a word for it — dance.')
    expect(artNeededFor(word.makes, new Set())).toEqual([])
  })
})
