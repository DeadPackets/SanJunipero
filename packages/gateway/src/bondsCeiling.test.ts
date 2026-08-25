import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import {
  BOND_RECENT_ACTS, BondsResponseSchema, DEFAULT_CONFIG, type SimEvent,
} from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { buildBonds } from './bonds.js'

/**
 * ★ `/api/bonds` WAS THE LARGEST UNBOUNDED THING ON THE SERVED SURFACE.
 *
 * Every `Bond` carried every act that ever formed it. Measured on this machine against the loud
 * town below, one `/api/bonds` body:
 *
 *   | sim-day | events  | before        | after    |
 *   |--------:|--------:|--------------:|---------:|
 *   |       5 |  84 206 |  19 925 075 B | 69 048 B |
 *   |      10 | 168 401 |  40 198 599 B | 70 951 B |
 *   |      20 | 336 790 |  80 948 509 B | 71 023 B |
 *   |      40 | 673 568 | 162 435 950 B | 71 025 B |
 *
 * Strictly linear in events before, and FLAT after: 69 048 → 71 025 while the log grows 8×.
 * The panel polls this every 30 s, per viewer, on a stream given to strangers.
 *
 * ★ WHY TWO TRANCHES AND NOT ONE DEEP WORLD. A ceiling on a single measurement passes on a fixed
 * overhead exactly as well as on a bound. GROWTH is the property, so what is asserted is the
 * SECOND tranche: three times the events, and the body must barely move.
 *
 * ★ AND WHY IT ALSO CHECKS THE ANSWER. "The body did not grow" is satisfiable by a body that
 * says `{bonds: []}` — the vacuous guard this project has found twenty times over. So the town
 * must be fully tied, the rollup must account for six figures of acts the window cannot hold,
 * and the totals must agree with `strength`.
 *
 * MUTATION-PROVED. Removing the window's bound in `foldBond` — 821 450 acts on 66 ties:
 *   clean:  79 333 more events grew the bonds body by     3 035 B (67 942 → 70 977)
 *   mutant: 79 333 more events grew the bonds body by 21 875 140 B (3 028 266 → 24 903 406)
 */
const GRASS: TileId[][] = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0 as TileId))
const AGENTS = 12
const PAIRS = (AGENTS * (AGENTS - 1)) / 2
const FIRST_TRANCHE_TICKS = 2_000
const SECOND_TRANCHE_TICKS = 14_000
/** The window is 24 acts and the rollup is six rows, so the only thing that may grow at all is
 *  the number of DIGITS in a count. Measured growth over this tranche is ~2 KB. */
const GROWTH_CEILING_BYTES = 8_192

const ids = Array.from({ length: AGENTS }, (_, i) => `a${i}`)

describe('★ the bonds body has a ceiling that does not depend on the town’s age', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sj-bondceil-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('three times the events must not be three times the body', () => {
    const dbPath = join(dir, 'loud.db')
    const worldDb = openDb(dbPath)
    const store = new EventStore(worldDb)
    // Deterministic and deliberately LOUD. The founders showcase falls silent on sim-day 3 and
    // ties nobody to anybody after it, so it would pass this without proving anything.
    let s = 123456789
    const rnd = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const loop = new TickLoop({
      store, state: genesisState(DEFAULT_CONFIG, GRASS), rng: new RngStreams('loud'),
      snapshotEveryTicks: 1000,
      onTick: ({ tick, emit }) => {
        if (tick === 1) for (const [i, id] of ids.entries()) {
          emit('agent_spawned', { id, name: `A${i}`, x: (i * 5) % 60, y: (i * 7) % 60, ageDays: 7300 })
        }
        for (let k = 0; k < 4; k++) {
          emit('agent_spoke', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!, text: 'a word',
            x: Math.floor(rnd() * 30), y: Math.floor(rnd() * 30),
          })
        }
        if (tick % 3 === 0) {
          emit('action_started', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!, verb: 'give',
            params: { targetId: ids[Math.floor(rnd() * AGENTS)]! }, duration: 2,
          })
        }
        if (tick % 3 === 2) emit('action_completed', { agentId: ids[Math.floor(rnd() * AGENTS)]!, verb: 'give' })
      },
    })

    const apiDb = new Database(dbPath, { readonly: true })
    const sel = apiDb.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq')
    const bodyAt = (tick: number): string => {
      const events = (sel.all() as Array<{ seq: number; tick: number; type: string; payload: string }>)
        .map((r) => ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }) as SimEvent)
      return JSON.stringify(buildBonds(events, DEFAULT_CONFIG.movement.earshotRadius, tick))
    }

    for (let i = 0; i < FIRST_TRANCHE_TICKS; i++) loop.step()
    const firstEvents = store.lastSeq()
    const firstBody = bodyAt(FIRST_TRANCHE_TICKS)

    for (let i = 0; i < SECOND_TRANCHE_TICKS; i++) loop.step()
    const addedEvents = store.lastSeq() - firstEvents
    const secondBody = bodyAt(FIRST_TRANCHE_TICKS + SECOND_TRANCHE_TICKS)
    const growth = secondBody.length - firstBody.length

    // ── the second tranche really is the larger one ────────────────────────────────────────
    expect(addedEvents, 'the deeper tranche must dwarf the first').toBeGreaterThan(firstEvents * 2)

    // ── and the answer is real, so the bound is a bound over something ─────────────────────
    const parsed = BondsResponseSchema.parse(JSON.parse(secondBody))
    expect(parsed.bonds, 'a town this loud ties every pair').toHaveLength(PAIRS)
    const acts = parsed.bonds.reduce((n, b) => n + b.strength, 0)
    expect(acts, 'six figures of acts formed these ties').toBeGreaterThan(100_000)
    for (const b of parsed.bonds) {
      expect(b.recent.length, b.id).toBeLessThanOrEqual(BOND_RECENT_ACTS)
      expect(b.acts.reduce((n, a) => n + a.count, 0), `${b.id} rollup counts the whole history`)
        .toBe(b.strength)
      expect(b.strength, `${b.id} outgrew its window many times over`).toBeGreaterThan(BOND_RECENT_ACTS)
    }

    // ── the property: bytes are a fact about the population, not about the age ─────────────
    expect(
      growth,
      `${addedEvents} more events (${acts} acts on ${PAIRS} ties) grew the bonds body by`
      + ` ${growth} B, from ${firstBody.length} to ${secondBody.length}`,
    ).toBeLessThan(GROWTH_CEILING_BYTES)

    apiDb.close()
    worldDb.close()
  })
})
