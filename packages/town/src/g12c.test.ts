import { describe, expect, it } from 'vitest'
import { doorTile, founderSeat, makeCityTemplate } from '@sj/shared'
import { devTown } from './devTown.js'
import { FOUNDER_ROSTER, foundersFor, townStructuresFor } from './founders.js'

// This half lives in the gateway because `@sj/web` is private, DOM-typed and bundler-resolved,
// so a gateway test cannot import its modules without breaking `tsc -b`.

describe('U3 — the dev showcase is the REAL town, not a four-building stub', () => {
  const town = devTown()

  it('stands all thirteen, where the screenshot showed four', () => {
    expect(town.structures).toHaveLength(13)
    expect(townStructuresFor('showcase')).toHaveLength(13)
  })

  it('gives the seven houses seven different owners', () => {
    const houses = town.structures.filter((s) => s.kind === 'house')
    expect(houses).toHaveLength(7)
    const owners = houses.map((h) => h.owner)
    expect(owners.filter((o) => o !== null)).toHaveLength(7)
    expect(new Set(owners).size).toBe(7)
  })
})

describe('U25 — "all of the humans were sleeping inside of one house"', () => {
  const town = devTown()

  // Eight roofs for twelve: a couple shares a house and the cottage row holds three, by the
  // seating law; nobody is left to the storehouse floor.
  it('gives every founder a roof of their household, by the seating law', () => {
    const founders = foundersFor(town.structures)
    expect(founders).toHaveLength(12)
    const homes = founders
      .map((f) => town.structures.find((s) => s.name === founderSeat(f.id))?.id)
      .filter((id): id is string => id !== undefined)
    expect(homes).toHaveLength(12)
    expect(new Set(homes).size).toBe(8)
  })

  it("puts each owner's door on their OWN house, never on a shared one", () => {
    const t = makeCityTemplate({ x: 0, y: 9 })
    const doors = t.structures
      .filter((s) => s.kind === 'house')
      .map((s) => {
        const d = doorTile(s)
        return `${d.dx},${d.dy}`
      })
    expect(new Set(doors).size).toBe(doors.length)
  })

  it('names the TWELVE founders the town is seeded with', () => {
    expect(FOUNDER_ROSTER).toHaveLength(12)
    expect(new Set(FOUNDER_ROSTER.map((f) => f.id)).size).toBe(12)
  })
})
