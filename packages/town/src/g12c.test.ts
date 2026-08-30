import { describe, expect, it } from 'vitest'
import { doorTile, makeCityTemplate } from '@sj/shared'
import { devTown } from './devTown.js'
import { FOUNDERS, foundersFor, townStructuresFor } from './founders.js'

// This half lives in the gateway because `@sj/web` is private, DOM-typed and bundler-resolved,
// so a gateway test cannot import its modules without breaking `tsc -b`.

describe('U3 — the dev showcase is the REAL town, not a four-building stub', () => {
  const town = devTown()

  it('stands all eleven, where the screenshot showed four', () => {
    expect(town.structures).toHaveLength(11)
    expect(townStructuresFor('showcase')).toHaveLength(11)
  })

  it('gives the five houses five different owners', () => {
    const houses = town.structures.filter((s) => s.kind === 'house')
    expect(houses).toHaveLength(5)
    const owners = houses.map((h) => h.owner)
    expect(owners.filter((o) => o !== null)).toHaveLength(5)
    expect(new Set(owners).size).toBe(5)
  })
})

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

  it('names the FIVE founders the town is seeded with', () => {
    expect(FOUNDERS).toHaveLength(5)
    expect(new Set(FOUNDERS.map((f) => f.id)).size).toBe(5)
  })
})
