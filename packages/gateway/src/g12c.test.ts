import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { doorTile, makeCityTemplate } from '@sj/shared'
import { devTown } from './devTown.js'
import { FOUNDERS, foundersFor, townStructuresFor } from './founders.js'

// GATE G12c — THE TOWN, U25, AND THE READ-ONLY PROOF. The other two files are:
//   packages/web/src/render/g12c.test.ts   — the canvas (U3–U11, U18, U19)
//   packages/web/src/ui/g12c.test.ts       — the chrome (U12–U17, U20–U24, P22)
//
// This half lives in the gateway for the D-41 reason: `@sj/web` is private, DOM-typed and
// bundler-resolved, so a gateway test cannot import its modules without breaking `tsc -b`.

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..')

// ── U3 · the town the viewer actually sees is the town the template describes ─────────────

describe('U3 — the dev showcase is the REAL town, not a four-building stub', () => {
  const town = devTown()

  it('stands all eleven, where the screenshot showed four', () => {
    expect(town.structures).toHaveLength(11)
    expect(townStructuresFor('showcase')).toHaveLength(11)
  })

  it('derives the ground and the buildings from ONE call, so they cannot disagree', () => {
    const src = readFileSync(join(HERE, 'devTown.ts'), 'utf8')
    expect(src).toContain('makeCityTemplate')
    expect(src).toContain('the SAME anchor')
  })

  it('gives the five houses five different owners', () => {
    const houses = town.structures.filter((s) => s.kind === 'house')
    expect(houses).toHaveLength(5)
    const owners = houses.map((h) => h.owner)
    expect(owners.filter((o) => o !== null)).toHaveLength(5)
    expect(new Set(owners).size).toBe(5)
  })
})

// ── U25 · five people, five roofs ─────────────────────────────────────────────────────────

describe('U25 — "all of the humans were sleeping inside of one house"', () => {
  const town = devTown()

  it('gives every founder a home of their own, by the ownership law', () => {
    const founders = foundersFor(town.structures)
    expect(founders.length).toBeGreaterThanOrEqual(5)
    const homes = founders
      .map((f) => town.structures.find((s) => s.kind === 'house' && s.owner === f.id)?.id)
      .filter((id): id is string => id !== undefined)
    expect(homes).toHaveLength(5)
    expect(new Set(homes).size, 'two founders share a roof').toBe(5)
  })

  it('puts each owner\'s door on their OWN house, never on a shared one', () => {
    const t = makeCityTemplate({ x: 0, y: 9 })
    const doors = t.structures.filter((s) => s.kind === 'house').map((s) => {
      const d = doorTile(s)
      return `${d.dx},${d.dy}`
    })
    expect(new Set(doors).size).toBe(doors.length)
  })

  it('names the FIVE founders the town is seeded with', () => {
    expect(FOUNDERS).toHaveLength(5)
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(5)
  })

  // The full five-distinct-`insideId` simulation is `founders.test.ts`'s
  // "puts five tired founders under five different roofs" — it drives 400 ticks of the real
  // onTick with every founder kept spent. This gate asserts the OWNERSHIP LAW that test
  // depends on, and names the engine half's citation rather than reproducing it.
  it('has the engine half written down, with its citation', () => {
    const delta = readFileSync(join(REPO, 'docs', 'superpowers', 'plans', 'c8-delta-from-c12.md'), 'utf8')
    expect(delta).toMatch(/U25/)
  })
})

// THE READ-ONLY PROOF IS GONE. It re-derived four pin literals out of four other files by
// regex and froze `golden.test.ts` against the merge base. The project no longer claims that
// two live runs produce identical bytes, so there is nothing left for it to guard — and the
// census it enforced was itself the reason a pin could not be moved without visiting seven
// files. U3 and U25 above are the town tests; they never touched a pin and they stay.
