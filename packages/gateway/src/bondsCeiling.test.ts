import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { BOND_RECENT_ACTS, BondsResponseSchema, DEFAULT_CONFIG, type SimEvent } from '@sj/shared'
import { EventStore, RngStreams, TickLoop, genesisState, openDb, type TileId } from '@sj/engine'
import { buildBonds } from './bonds.js'

/** Every bond's act list is capped — the served surface must not grow with the log. */
const GRASS: TileId[][] = Array.from({ length: 64 }, () => Array.from({ length: 64 }, () => 0))
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
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('three times the events must not be three times the body', () => {
    const dbPath = join(dir, 'loud.db')
    const worldDb = openDb(dbPath)
    const store = new EventStore(worldDb)
    // Deterministic and deliberately LOUD. The founders showcase falls silent on sim-day 3 and
    // ties nobody to anybody after it, so it would pass this without proving anything.
    let s = 123456789
    const rnd = (): number => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648
    const loop = new TickLoop({
      store,
      state: genesisState(DEFAULT_CONFIG, GRASS),
      rng: new RngStreams('loud'),
      snapshotEveryTicks: 1000,
      onTick: ({ tick, emit }) => {
        if (tick === 1)
          for (const [i, id] of ids.entries()) {
            emit('agent_spawned', {
              id,
              name: `A${i}`,
              x: (i * 5) % 60,
              y: (i * 7) % 60,
              ageDays: 7300,
            })
          }
        for (let k = 0; k < 4; k++) {
          emit('agent_spoke', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!,
            text: 'a word',
            x: Math.floor(rnd() * 30),
            y: Math.floor(rnd() * 30),
          })
        }
        if (tick % 3 === 0) {
          emit('action_started', {
            agentId: ids[Math.floor(rnd() * AGENTS)]!,
            verb: 'give',
            params: { targetId: ids[Math.floor(rnd() * AGENTS)]! },
            duration: 2,
          })
        }
        if (tick % 3 === 2)
          emit('action_completed', { agentId: ids[Math.floor(rnd() * AGENTS)]!, verb: 'give' })
      },
    })

    const apiDb = new Database(dbPath, { readonly: true })
    const sel = apiDb.prepare('SELECT seq, tick, type, payload FROM events ORDER BY seq')
    const bodyAt = (tick: number): string => {
      const events = (
        sel.all() as { seq: number; tick: number; type: string; payload: string }[]
      ).map((r) => ({ seq: r.seq, tick: r.tick, type: r.type, payload: JSON.parse(r.payload) }))
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
      expect(
        b.acts.reduce((n, a) => n + a.count, 0),
        `${b.id} rollup counts the whole history`,
      ).toBe(b.strength)
      expect(b.strength, `${b.id} outgrew its window many times over`).toBeGreaterThan(
        BOND_RECENT_ACTS,
      )
    }

    // ── the property: bytes are a fact about the population, not about the age ─────────────
    expect(
      growth,
      `${addedEvents} more events (${acts} acts on ${PAIRS} ties) grew the bonds body by` +
        ` ${growth} B, from ${firstBody.length} to ${secondBody.length}`,
    ).toBeLessThan(GROWTH_CEILING_BYTES)

    apiDb.close()
    worldDb.close()
  })
})
